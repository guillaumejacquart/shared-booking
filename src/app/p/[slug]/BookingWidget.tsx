"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { toKey } from "@/lib/calendar";
import { fullFmt, timeFmt } from "@/lib/format";
import { Button, Checkbox, Field, FormMessage, TextInput, Textarea } from "@/components/ui";
import SlotPicker from "@/components/SlotPicker";
import { useAvailableSlots } from "@/hooks/useAvailableSlots";

export interface SessionTypeOpt {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceDisplay: string | null;
  requiresPayment: boolean;
  priceCents: number | null;
  currency: string;
}

/** Prix affiché : texte libre ou montant Stripe formaté. */
export function displayPrice(s: SessionTypeOpt): string | null {
  if (s.priceDisplay) return s.priceDisplay;
  if (s.requiresPayment && s.priceCents) {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: s.currency }).format(s.priceCents / 100);
  }
  return null;
}

interface SlotDto {
  startAt: string;
  endAt: string;
}

export default function BookingWidget({
  slug,
  sessionTypes,
}: {
  slug: string;
  sessionTypes: SessionTypeOpt[];
}) {
  const [typeId, setTypeId] = useState(sessionTypes[0]?.id ?? "");
  const { allSlots, byDay, availableDays, loading } = useAvailableSlots(slug, typeId, 56);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string>("");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<SlotDto | null>(null);

  const next = allSlots[0] ?? null;
  const daySlots = day ? (byDay.get(day) ?? []) : [];
  const selectedType = sessionTypes.find((s) => s.id === typeId);

  function pickType(id: string) {
    setTypeId(id);
    setDay(null);
    setSlot("");
  }

  function pickDay(key: string) {
    setDay(key);
    setSlot("");
  }

  function pickNext() {
    if (!next) return;
    const key = toKey(new Date(next.startAt));
    setDay(key);
    setSlot(next.startAt);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/p/${slug}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionTypeId: typeId,
          startAt: slot,
          patientFirstName: firstName,
          patientLastName: lastName,
          patientEmail: email,
          patientPhone: phone || undefined,
          notes: notes || undefined,
          consent,
          website: website || undefined,
        }),
      });
      if (res.status === 409) {
        setFormError(t("booking.taken"));
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setFormError((j?.error as string) || t("booking.errorGeneric"));
        return;
      }
      const j = (await res.json()) as SlotDto & { checkoutUrl?: string };
      if (j.checkoutUrl) {
        // Séance payante : redirection vers Stripe Checkout.
        window.location.href = j.checkoutUrl;
        return;
      }
      setConfirmed({ startAt: j.startAt, endAt: j.endAt });
    } catch {
      setFormError(t("booking.errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  if (sessionTypes.length === 0) {
    return <p className="text-sm text-mist">{t("booking.noSessionTypes")}</p>;
  }

  if (confirmed) {
    return (
      <section className="rounded-2xl border bg-ok-bg p-6 text-center text-ok">
        <h2 className="text-xl font-semibold">{t("booking.successTitle")}</h2>
        <p className="mt-2 font-medium">
          {selectedType?.name} — {fullFmt.format(new Date(confirmed.startAt))} à{" "}
          {timeFmt.format(new Date(confirmed.startAt))}
        </p>
        <p className="mt-2 text-sm text-mist">{t("booking.successDetail")}</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("booking.chooseSession")}</h2>
        <div className="grid gap-2">
          {sessionTypes.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pickType(s.id)}
              className={`rounded-2xl border p-3 text-left transition-all duration-200 ${
                s.id === typeId
                  ? "border-brand bg-brand-soft shadow-soft"
                  : "border-line bg-card hover:border-brand"
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{s.name}</span>
                <span className="shrink-0 text-sm text-mist">
                  {t("booking.minutes", { min: s.durationMin })}
                  {displayPrice(s) ? ` · ${displayPrice(s)}` : ""}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {s.requiresPayment ? (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-deep">
                    {t("booking.payOnline")}
                  </span>
                ) : null}
              </div>
              {s.description ? (
                <p className="mt-1 text-sm text-mist">{s.description}</p>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("booking.chooseSlot")}</h2>
        {!loading && allSlots.length > 0 && next && !slot ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border bg-ok-bg p-4 text-ok">
            <p className="text-sm">
              <span className="font-semibold">{t("booking.nextSlot")} : </span>
              {fullFmt.format(new Date(next.startAt))} à {timeFmt.format(new Date(next.startAt))}
            </p>
            <Button size="sm" onClick={pickNext}>
              {t("booking.choose")}
            </Button>
          </div>
        ) : null}
        <SlotPicker
          availableDays={availableDays}
          day={day}
          slots={daySlots.map((s) => s.startAt)}
          selected={slot}
          loading={loading}
          onSelectDay={pickDay}
          onSelectSlot={setSlot}
        />
      </section>

      {slot ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("booking.yourDetails")}</h2>
          <p className="mb-3 text-sm text-mist">
            {selectedType?.name} — {fullFmt.format(new Date(slot))} à{" "}
            {timeFmt.format(new Date(slot))}
          </p>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("booking.firstName")}>
                <TextInput
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  maxLength={100}
                  autoComplete="given-name"
                />
              </Field>
              <Field label={t("booking.lastName")}>
                <TextInput
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  maxLength={100}
                  autoComplete="family-name"
                />
              </Field>
            </div>
            <Field label={t("booking.email")}>
              <TextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                maxLength={254}
                autoComplete="email"
              />
            </Field>
            <Field label={t("booking.phoneOptional")}>
              <TextInput
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={30}
                autoComplete="tel"
              />
            </Field>
            <Field label={t("booking.notesOptional")} hint={t("booking.notesPlaceholder")}>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                rows={3}
              />
            </Field>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
              <span>{t("booking.consent")}</span>
            </label>
            {/* Honeypot anti-bot */}
            <input
              type="text"
              name="website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="absolute -left-[9999px]"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
            />
            <FormMessage tone="error">{formError ?? ""}</FormMessage>
            <Button type="submit" size="lg" disabled={submitting || !consent}>
              {submitting ? t("booking.submitting") : t("booking.submit")}
            </Button>
          </form>
        </section>
      ) : null}
    </div>
  );
}
