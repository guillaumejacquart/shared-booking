"use client";

import { useEffect, useMemo, useState } from "react";

import { t } from "@/lib/i18n";
import { toKey } from "@/lib/calendar";
import { timeFmt } from "@/lib/format";
import { Button, Calendar, ConfirmButton, FormMessage } from "@/components/ui";
import TimeSlotGrid from "@/components/TimeSlotGrid";

export interface ManageData {
  practitionerName: string;
  sessionName: string;
  startAt: string;
  status: string;
  sessionTypeId: string;
  practitionerSlug: string;
  rescheduleToken: string;
  cancelToken: string;
}

interface SlotDto {
  startAt: string;
  endAt: string;
}

export default function ManageClient({
  data,
  when,
}: {
  data: ManageData;
  when: string;
}) {
  const [status, setStatus] = useState(data.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescheduled, setRescheduled] = useState(false);

  const [allSlots, setAllSlots] = useState<SlotDto[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [newSlot, setNewSlot] = useState("");

  useEffect(() => {
    let cancelled = false;
    const today = toKey(new Date());
    fetch(`/api/p/${data.practitionerSlug}/slots?sessionTypeId=${data.sessionTypeId}&from=${today}&days=28`)
      .then((r) => (r.ok ? r.json() : { slots: [] }))
      .then((j) => {
        if (!cancelled) setAllSlots(j.slots ?? []);
      })
      .catch(() => {
        if (!cancelled) setAllSlots([]);
      });
    return () => {
      cancelled = true;
    };
  }, [data.practitionerSlug, data.sessionTypeId]);

  const byDay = useMemo(() => {
    const map = new Map<string, SlotDto[]>();
    for (const s of allSlots) {
      const key = toKey(new Date(s.startAt));
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }
    return map;
  }, [allSlots]);
  const availableDays = useMemo(() => new Set(byDay.keys()), [byDay]);
  const daySlots = day ? (byDay.get(day) ?? []) : [];

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/b/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.cancelToken, by: "patient" }),
      });
      if (res.status === 410) {
        setError(t("manage.deadlinePassed"));
        return;
      }
      if (!res.ok) {
        setError(t("booking.errorGeneric"));
        return;
      }
      setStatus("cancelled");
    } catch {
      setError(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function reschedule() {
    if (!newSlot) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/b/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.rescheduleToken, newStartAt: newSlot }),
      });
      if (res.status === 410) {
        setError(t("manage.deadlinePassed"));
        return;
      }
      if (!res.ok) {
        setError(t("booking.errorGeneric"));
        return;
      }
      setRescheduled(true);
    } catch {
      setError(t("booking.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (status === "cancelled") {
    return (
      <p className="rounded-2xl border border-zinc-200 p-6 text-center dark:border-zinc-800">
        {t("manage.cancelled")}
      </p>
    );
  }

  if (status !== "confirmed") {
    return (
      <p className="rounded-2xl border border-zinc-200 p-6 text-center dark:border-zinc-800">
        {t("manage.completed")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">
          {data.sessionName} {t("manage.with")} {data.practitionerName}
        </h2>
        <p className="mt-1 text-zinc-600 dark:text-zinc-300">{when}</p>
        {rescheduled ? (
          <p className="mt-3 text-sm text-green-700 dark:text-green-300">
            {t("manage.rescheduled")}
          </p>
        ) : null}
        <div className="mt-4">
          <ConfirmButton confirmLabel={t("manage.cancelConfirm")} onConfirm={cancel} busy={busy}>
            {t("manage.cancelButton")}
          </ConfirmButton>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("manage.rescheduleTitle")}</h2>
        <Calendar
          initialMonth={new Date()}
          selected={day}
          availableDays={availableDays}
          onSelect={(key) => {
            setDay(key);
            setNewSlot("");
          }}
          renderDay={(key) =>
            availableDays.has(key) && key !== day ? (
              <span className="h-1 w-1 rounded-full bg-zinc-400" />
            ) : null
          }
        />
        {day ? (
          daySlots.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">{t("booking.noSlots")}</p>
          ) : (
            <div className="mt-3">
              <TimeSlotGrid
                slots={daySlots.map((s) => s.startAt)}
                selected={newSlot}
                onSelect={setNewSlot}
              />
            </div>
          )
        ) : (
          <p className="mt-3 text-sm text-zinc-500">{t("booking.selectDay")}</p>
        )}
        {newSlot ? (
          <Button disabled={busy} onClick={reschedule} className="mt-3">
            {t("manage.rescheduleButton")} — {timeFmt.format(new Date(newSlot))}
          </Button>
        ) : null}
      </section>

      <FormMessage tone="error">{error ?? ""}</FormMessage>
    </div>
  );
}
