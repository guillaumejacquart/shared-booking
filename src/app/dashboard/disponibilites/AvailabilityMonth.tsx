"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import frLocale from "@fullcalendar/core/locales/fr";
import type { DateSelectArg, DatesSetArg, EventInput } from "@fullcalendar/core";

import "@/components/FullCalendarTheme.css";

import { t } from "@/lib/i18n";
import { fromKey, toKey } from "@/lib/calendar";
import { AVAILABILITIES_CHANGED } from "@/lib/availabilities-events";
import { Button, Field, FormMessage, Select, TextInput } from "@/components/ui";

const TZ = "Europe/Paris";

interface Rule {
  weekday: number;
  startTime: string;
  endTime: string;
}
interface Exception {
  id: string;
  date: string;
  kind: string;
  startTime: string | null;
  endTime: string | null;
  fullDay: boolean;
  roomId: string | null;
}
interface Booking {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
}
interface MonthData {
  rules: Rule[];
  exceptions: Exception[];
  bookings: Booking[];
  rooms: { id: string; name: string }[];
}

/** 0 = dimanche … 6 = samedi, vu à Paris. */
function weekdayParis(d: Date): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
}

/**
 * Vue mensuelle des disponibilités : fond vert = ouvert, rouge = fermé,
 * événements = RDV. Sélection (clic ou glisser) : fermer / rouvrir.
 * `ssr: false` via import dynamique (voir page).
 */
export default function AvailabilityMonth({ practitionerId }: { practitionerId: string }) {
  const router = useRouter();
  const [data, setData] = useState<MonthData | null>(null);
  const [range, setRange] = useState<{ from: string; days: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Sélection fermée en attente d'ouverture exceptionnelle (horaires + salle).
  const [pendingOpen, setPendingOpen] = useState<string[] | null>(null);
  const [openStart, setOpenStart] = useState("09:00");
  const [openEnd, setOpenEnd] = useState("18:00");
  const [openRoomId, setOpenRoomId] = useState("");

  // Requêtes dédupliquées par plage : `datesSet` peut être réémis à chaque
  // rendu FullCalendar — sans garde, fetch → setState → rendu → boucle.
  // Seules les mutations forcent le rechargement (`force: true`).
  const lastFetched = useRef<string | null>(null);
  const inFlight = useRef<string | null>(null);
  const fetchRange = useCallback(async (from: string, days: number, force = false) => {
    const key = `${from}/${days}`;
    if (!force && (lastFetched.current === key || inFlight.current === key)) return;
    inFlight.current = key;
    try {
      const res = await fetch(`/api/disponibilites/month?from=${from}&days=${days}`);
      if (res.ok) {
        setData(await res.json());
        setRange({ from, days });
        lastFetched.current = key;
      }
    } finally {
      if (inFlight.current === key) inFlight.current = null;
    }
  }, []);

  // Recharge après les mutations de l'éditeur / de la liste d'exceptions.
  // Le miroir `ref` est synchronisé dans un effet (jamais pendant le rendu).
  const rangeRef = useRef(range);
  useEffect(() => {
    rangeRef.current = range;
  }, [range]);
  useEffect(() => {
    const handler = () => {
      const r = rangeRef.current;
      if (r) void fetchRange(r.from, r.days, true);
    };
    window.addEventListener(AVAILABILITIES_CHANGED, handler);
    return () => window.removeEventListener(AVAILABILITIES_CHANGED, handler);
  }, [fetchRange]);

  function onDatesSet(arg: DatesSetArg) {
    const from = toKey(arg.start);
    const days = Math.max(1, Math.round((arg.end.getTime() - arg.start.getTime()) / 86_400_000));
    void fetchRange(from, days);
  }

  const events: EventInput[] = useMemo(() => {
    if (!data || !range) return [];
    const out: EventInput[] = [];
    const offByDate = new Map<string, Exception[]>();
    for (const x of data.exceptions) {
      if (x.kind !== "off") continue;
      const list = offByDate.get(x.date) ?? [];
      list.push(x);
      offByDate.set(x.date, list);
    }
    const extraDates = new Set(data.exceptions.filter((x) => x.kind === "extra").map((x) => x.date));

    // Fond vert (ouvert) / rouge (fermé) sur chaque jour de la plage chargée.
    const base = fromKey(range.from);
    for (let i = 0; i < range.days; i++) {
      const d = new Date(base.getTime() + i * 86_400_000);
      const key = toKey(d);
      const open = data.rules.some((r) => r.weekday === weekdayParis(d)) || extraDates.has(key);
      const fullOff = (offByDate.get(key) ?? []).some((x) => x.fullDay);
      if (fullOff) {
        out.push({ start: key, end: key, display: "background", color: "var(--danger-bg)" });
      } else if (open) {
        out.push({ start: key, end: key, display: "background", color: "var(--brand-soft)" });
      }
    }
    // Fermetures partielle : bandeau rouge sur la plage horaire.
    for (const [date, list] of offByDate) {
      for (const x of list) {
        if (x.fullDay || !x.startTime || !x.endTime) continue;
        out.push({
          start: `${date}T${x.startTime}:00`,
          end: `${date}T${x.endTime}:00`,
          display: "background",
          color: "var(--danger-bg)",
        });
      }
    }
    for (const b of data.bookings) {
      if (b.status === "cancelled") continue;
      // Pastille horaire sans libellé (vue mois uniquement).
      out.push({ id: b.id, start: b.startAt, end: b.endAt, title: "", color: "var(--brand)" });
    }
    return out;
  }, [data, range]);

  function regularOpen(key: string) {
    if (!data) return false;
    return data.rules.some((r) => r.weekday === weekdayParis(fromKey(key)));
  }

  function extrasOf(key: string) {
    return (data?.exceptions ?? []).filter((x) => x.date === key && x.kind === "extra");
  }

  function isOpenDay(key: string) {
    if (!data) return false;
    if (data.exceptions.some((x) => x.kind === "extra" && x.date === key)) return true;
    return regularOpen(key);
  }

  function dayState(key: string) {
    const offs = (data?.exceptions ?? []).filter((x) => x.date === key && x.kind === "off");
    const fullOff = offs.find((x) => x.fullDay);
    const bookings = (data?.bookings ?? []).filter(
      (b) => b.status !== "cancelled" && toKey(new Date(b.startAt)) === key,
    );
    const ro = regularOpen(key);
    const extras = extrasOf(key);
    return { fullOff, bookings, regularOpen: ro, extras, open: ro || extras.length > 0 };
  }

  /** Pré-remplit le formulaire d'ouverture (horaires = 1re règle, sinon 9h-18h). */
  function startOpening(keys: string[]) {
    const fallback = data?.rules[0];
    setOpenStart(fallback?.startTime ?? "09:00");
    setOpenEnd(fallback?.endTime ?? "18:00");
    setOpenRoomId((data?.rooms ?? [])[0]?.id ?? "");
    setPendingOpen(keys);
    setHint(null);
  }

  async function deleteException(id: string) {
    await fetch(`/api/exceptions/${id}?practitionerId=${practitionerId}`, { method: "DELETE" });
  }

  async function toggleDay(key: string) {
    if (!data) return;
    const { fullOff, bookings, regularOpen: ro, extras } = dayState(key);
    setHint(null);
    setPendingOpen(null);
    if (bookings.length > 0 && !fullOff) {
      setHint(t("availability.hasBookings", { n: bookings.length }));
      return;
    }
    setBusy(true);
    try {
      if (fullOff) {
        // Rouvre : supprime la fermeture (les ouvertures éventuelles restent).
        await deleteException(fullOff.id);
      } else if (!ro && extras.length > 0) {
        // Annule l'ouverture exceptionnelle au lieu d'empiler une fermeture.
        for (const x of extras) await deleteException(x.id);
      } else if (!ro) {
        // Jour hors horaires habituels : propose une ouverture exceptionnelle.
        startOpening([key]);
        return;
      } else {
        const res = await fetch("/api/exceptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ practitionerId, date: key, kind: "off", fullDay: true }),
        });
        if (!res.ok) throw new Error();
      }
      if (range) await fetchRange(range.from, range.days, true);
      // La liste des exceptions (rendue côté serveur) ne se met à jour
      // qu'au refresh : on le déclenche pour un retour visuel immédiat.
      router.refresh();
    } catch {
      setHint(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function closeRange(keys: string[]) {
    if (!data) return;
    setBusy(true);
    setHint(null);
    let skipped = 0;
    let closed = 0;
    let changed = 0;
    try {
      for (const key of keys) {
        const { fullOff, bookings, regularOpen: ro, extras } = dayState(key);
        if (fullOff) continue;
        if (bookings.length > 0) {
          skipped++;
          continue;
        }
        if (!ro && extras.length > 0) {
          // Annule l'ouverture exceptionnelle au lieu d'empiler une fermeture.
          for (const x of extras) await deleteException(x.id);
          changed++;
          continue;
        }
        // Ignore les jours déjà fermés (hors ouvertures habituelles) :
        // créer une fermeture dessus serait sans effet.
        if (!ro) {
          closed++;
          continue;
        }
        const res = await fetch("/api/exceptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ practitionerId, date: key, kind: "off", fullDay: true }),
        });
        if (res.ok) changed++;
      }
      const hints: string[] = [];
      if (skipped > 0) hints.push(t("availability.rangeSkipped", { n: skipped }));
      if (closed > 0) hints.push(t("availability.rangeClosedSkipped", { n: closed }));
      if (hints.length > 0) setHint(hints.join(" "));
      if (changed > 0 && range) {
        await fetchRange(range.from, range.days, true);
        router.refresh();
      }
    } catch {
      setHint(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  /** Crée une ouverture exceptionnelle (horaires + salle) sur chaque jour. */
  async function createOpenings(keys: string[]) {
    if (!data) return;
    setHint(null);
    if (openStart >= openEnd) {
      setHint(t("availability.invalidHours"));
      return;
    }
    if (!openRoomId) {
      setHint(t("availability.needRoom"));
      return;
    }
    setBusy(true);
    let skipped = 0;
    let created = 0;
    try {
      for (const key of keys) {
        const { fullOff, bookings, extras } = dayState(key);
        if (bookings.length > 0 || extras.length > 0) {
          skipped++;
          continue;
        }
        // Nettoie une fermeture redondante avant d'ouvrir (sinon elle
        // continuerait de bloquer les créneaux).
        if (fullOff) await deleteException(fullOff.id);
        const res = await fetch("/api/exceptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            practitionerId,
            date: key,
            kind: "extra",
            fullDay: false,
            startTime: openStart,
            endTime: openEnd,
            roomId: openRoomId,
          }),
        });
        if (!res.ok) throw new Error();
        created++;
      }
      if (skipped > 0 && created === 0) setHint(t("availability.alreadyOpen"));
      else if (skipped > 0) setHint(t("availability.rangeSkipped", { n: skipped }));
      if (created > 0 && range) {
        await fetchRange(range.from, range.days, true);
        router.refresh();
      }
      setPendingOpen(null);
    } catch {
      setHint(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function onSelect(info: DateSelectArg) {
    // end exclusif → clés calendaires de la sélection.
    const keys: string[] = [];
    for (let d = new Date(info.start); d < info.end; d = new Date(d.getTime() + 86_400_000)) {
      keys.push(toKey(d));
    }
    info.view.calendar.unselect();
    if (busy || !data) return;
    if (keys.length <= 1) {
      void toggleDay(keys[0] ?? toKey(info.start));
      return;
    }
    // Plage entièrement hors horaires habituels → ouverture exceptionnelle
    // (horaires + salle) plutôt que fermetures sans effet.
    const closable = keys.filter((k) => {
      const s = dayState(k);
      return (s.regularOpen || s.extras.length > 0) && !s.fullOff && s.bookings.length === 0;
    });
    const openable = keys.filter((k) => {
      const s = dayState(k);
      return !s.regularOpen && s.extras.length === 0 && s.bookings.length === 0;
    });
    if (openable.length > 0 && closable.length === 0) {
      startOpening(openable);
      return;
    }
    setPendingOpen(null);
    void closeRange(keys);
  }

  return (
    <div>
      <p className="mb-2 text-xs text-mist">{t("availability.calHint")}</p>
      <FullCalendar
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        headerToolbar={{ left: "prev,today,next", center: "title", right: "" }}
        locales={[frLocale]}
        locale="fr"
        timeZone={TZ}
        firstDay={1}
        height="auto"
        selectable
        selectMirror
        unselectAuto
        select={onSelect}
        datesSet={onDatesSet}
        events={events}
      />
      {busy ? (
        <div className="mt-3">
          <Button size="sm" disabled>
            {t("booking.loading")}
          </Button>
        </div>
      ) : null}
      {pendingOpen && data ? (
        <div className="mt-3 rounded-2xl border border-line bg-card p-3 shadow-soft">
          <p className="mb-2 text-sm font-medium">
            {t("availability.openTitle")} ·{" "}
            {pendingOpen.length === 1
              ? pendingOpen[0]
              : `${pendingOpen[0]} → ${pendingOpen[pendingOpen.length - 1]} (${pendingOpen.length} j)`}
          </p>
          {(data.rooms ?? []).length === 0 ? (
            <FormMessage tone="error">{t("availability.needRoom")}</FormMessage>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Début">
                <TextInput
                  type="time"
                  value={openStart}
                  onChange={(e) => setOpenStart(e.target.value)}
                  required
                />
              </Field>
              <Field label="Fin">
                <TextInput
                  type="time"
                  value={openEnd}
                  onChange={(e) => setOpenEnd(e.target.value)}
                  required
                />
              </Field>
              <Field label={t("availability.room")}>
                <Select value={openRoomId} onChange={(e) => setOpenRoomId(e.target.value)}>
                  {data.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button size="sm" disabled={busy} onClick={() => void createOpenings(pendingOpen)}>
                {t("availability.createOpening")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPendingOpen(null)}>
                {t("availability.cancel")}
              </Button>
            </div>
          )}
        </div>
      ) : null}
      <div className="mt-2">
        <FormMessage tone="error">{hint ?? ""}</FormMessage>
      </div>
    </div>
  );
}
