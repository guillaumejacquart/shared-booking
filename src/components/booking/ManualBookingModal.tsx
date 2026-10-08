"use client";

import { useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { dateStrInTz, partsInTz, zonedTimeToUtc } from "@/lib/timezone";
import type { ManualFormData, RoomAvailability } from "@/services/bookings";
import { Button, Checkbox, Field, FormMessage, Modal, Select, TextInput, Textarea } from "@/components/ui";

/**
 * Saisie manuelle d'une réservation (praticien, pour un patient).
 * Horaire libre + salle au choix ; le contrôle live (`/api/rooms/availability`)
 * aide à choisir, la garde serveur tranche au submit (409 = déjà pris,
 * le formulaire garde les champs saisis).
 */
export default function ManualBookingModal({
  formData,
  open,
  initialStartAt,
  onClose,
  onCreated,
}: {
  formData: ManualFormData;
  open: boolean;
  initialStartAt: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [sessionTypeId, setSessionTypeId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [roomId, setRoomId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [overrideOff, setOverrideOff] = useState(false);
  const [availability, setAvailability] = useState<RoomAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Garde anti-course : ignore les réponses dispo d'une requête dépassée.
  const latestQuery = useRef<string | null>(null);

  const sessionType = formData.sessionTypes.find((entry) => entry.id === sessionTypeId) ?? null;

  // Pré-remplissage à l'ouverture (ajustement pendant le rendu : la modale
  // peut s'ouvrir avec une sélection calendrier différente à chaque fois).
  const openKey = open ? `open:${initialStartAt ?? ""}` : "closed";
  const [appliedOpenKey, setAppliedOpenKey] = useState("closed");
  if (appliedOpenKey !== openKey) {
    setAppliedOpenKey(openKey);
    if (open) {
      const firstType = formData.sessionTypes[0] ?? null;
      setSessionTypeId(firstType?.id ?? "");
      setVariantId(firstType?.variants[0]?.id ?? "");
      setRoomId("");
      setOverrideOff(false);
      setAvailability(null);
      setFormError(null);
      if (initialStartAt) {
        const prefill = partsInTz(new Date(initialStartAt), formData.timezone);
        setDate(`${prefill.year}-${prefill.month}-${prefill.day}`);
        setTime(`${prefill.hour === "24" ? "00" : prefill.hour}:${prefill.minute}`);
      } else {
        setDate(dateStrInTz(new Date(), formData.timezone));
        setTime("");
      }
    }
  }

  // Clé de la requête dispo : un changement invalide l'affichage précédent.

  // Contrôle live des salles (debounce) : synchronise avec le serveur.
  const queryKey =
    open && sessionTypeId && date && time
      ? `${sessionTypeId}|${variantId}|${date}|${time}`
      : null;
  const [appliedQuery, setAppliedQuery] = useState<string | null>(null);
  if (appliedQuery !== queryKey) {
    setAppliedQuery(queryKey);
    setAvailability(null);
    setChecking(queryKey !== null);
  }
  useEffect(() => {
    if (!open || !queryKey) return;
    const startAt = zonedTimeToUtc(date, time, formData.timezone).toISOString();
    const fetchKey = queryKey;
    latestQuery.current = fetchKey;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ sessionTypeId, startAt });
      if (variantId) params.set("sessionVariantId", variantId);
      fetch(`/api/rooms/availability?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: RoomAvailability | null) => {
          if (fetchKey !== latestQuery.current) return;
          setAvailability(data);
          // Pré-sélection uniquement si rien n'est choisi : ne jamais
          // arracher le choix explicite (sinon l'option désactivée mais
          // sélectionnée passerait quand même au submit).
          if (data) {
            setRoomId((current) =>
              current === "" ? (data.rooms.find((room) => room.free)?.id ?? "") : current,
            );
          }
        })
        .catch(() => setAvailability(null))
        .finally(() => setChecking(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, queryKey, sessionTypeId, variantId, date, time, formData.timezone]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!sessionTypeId || !roomId) return;
    // Une option désactivée mais déjà sélectionnée reste soumise :
    // refuser explicitement plutôt que de compter sur le `disabled`.
    if (roomOccupied) {
      setFormError(t("manualBooking.roomTakenError"));
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const startAt = zonedTimeToUtc(date, time, formData.timezone).toISOString();
      const result = await sendJson("/api/bookings/manual", "POST", {
        sessionTypeId,
        ...(variantId ? { sessionVariantId: variantId } : {}),
        startAt,
        roomId,
        patientFirstName: firstName.trim(),
        patientLastName: lastName.trim(),
        patientEmail: email.trim(),
        ...(phone.trim() ? { patientPhone: phone.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        overrideOff,
      });
      if (!result.ok) {
        setFormError(result.error);
        return;
      }
      onCreated();
    } catch {
      setFormError(t("booking.errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  const practitionerBusy = availability?.practitioner.status === "busy";
  const offDetected = availability?.practitioner.status === "off";
  // Salle sélectionnée occupée (ou inconnue) au dernier contrôle : bloque.
  // Sans contrôle frais (`availability` nul), on laisse passer : le serveur tranche (409).
  const roomOccupied = availability
    ? !(availability.rooms.find((entry) => entry.id === roomId)?.free ?? false)
    : false;

  return (
    <Modal open={open} onClose={onClose} title={t("manualBooking.title")}>
      {formData.sessionTypes.length === 0 ? (
        <p className="text-sm text-mist">{t("manualBooking.noSessionTypes")}</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("manualBooking.session")}>
              <Select
                value={sessionTypeId}
                onChange={(event) => {
                  const next = formData.sessionTypes.find((entry) => entry.id === event.target.value);
                  setSessionTypeId(event.target.value);
                  setVariantId(next?.variants[0]?.id ?? "");
                }}
              >
                {formData.sessionTypes.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("manualBooking.variant")}>
              <Select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
                {(sessionType?.variants ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {t("booking.minutes", { min: entry.durationMin })}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("manualBooking.date")}>
              <TextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </Field>
            <Field label={t("manualBooking.time")}>
              <TextInput type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
            </Field>
          </div>
          <Field label={t("manualBooking.room")}>
            <Select value={roomId} onChange={(event) => setRoomId(event.target.value)} required>
              <option value="">—</option>
              {(availability?.rooms ?? formData.rooms).map((room) => {
                const live = availability?.rooms.find((entry) => entry.id === room.id);
                const occupied = live ? !live.free : false;
                return (
                  <option key={room.id} value={room.id} disabled={occupied}>
                    {room.name}
                    {occupied ? ` (${t("manualBooking.roomOccupied")})` : ""}
                  </option>
                );
              })}
            </Select>
          </Field>
          {checking ? <p className="text-xs text-mist">{t("manualBooking.checking")}</p> : null}
          {roomOccupied ? (
            <FormMessage tone="error">{t("manualBooking.roomTakenError")}</FormMessage>
          ) : null}
          {practitionerBusy ? (
            <FormMessage tone="error">{t("manualBooking.practitionerBusy")}</FormMessage>
          ) : null}
          {offDetected ? (
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox checked={overrideOff} onChange={(event) => setOverrideOff(event.target.checked)} />
              <span>
                {t("manualBooking.offWarning", {
                  reason: availability?.practitioner.reason
                    ? ` (${availability.practitioner.reason})`
                    : "",
                })}{" "}
                {t("manualBooking.overrideOff")}
              </span>
            </label>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("booking.firstName")}>
              <TextInput value={firstName} onChange={(event) => setFirstName(event.target.value)} required maxLength={100} autoComplete="off" />
            </Field>
            <Field label={t("booking.lastName")}>
              <TextInput value={lastName} onChange={(event) => setLastName(event.target.value)} required maxLength={100} autoComplete="off" />
            </Field>
          </div>
          <Field label={t("booking.email")}>
            <TextInput type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} autoComplete="off" />
          </Field>
          <Field label={t("booking.phoneOptional")}>
            <TextInput type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} autoComplete="off" />
          </Field>
          <Field label={t("booking.notesOptional")}>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} rows={2} />
          </Field>
          <FormMessage tone="error">{formError ?? ""}</FormMessage>
          <Button type="submit" size="lg" disabled={submitting || !roomId || practitionerBusy || roomOccupied}>
            {submitting ? t("manualBooking.submitting") : t("manualBooking.submit")}
          </Button>
        </form>
      )}
    </Modal>
  );
}
