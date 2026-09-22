"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { timeFmt } from "@/lib/format";
import { Button, ConfirmButton, FormMessage } from "@/components/ui";
import SlotPicker from "@/components/SlotPicker";
import { useAvailableSlots } from "@/hooks/useAvailableSlots";

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

  const { byDay, availableDays, loading } = useAvailableSlots(
    data.practitionerSlug,
    data.sessionTypeId,
    28,
  );
  const [day, setDay] = useState<string | null>(null);
  const [newSlot, setNewSlot] = useState("");

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
      <p className="rounded-3xl border border-line bg-card p-6 text-center shadow-soft">
        {t("manage.cancelled")}
      </p>
    );
  }

  if (status !== "confirmed") {
    return (
      <p className="rounded-3xl border border-line bg-card p-6 text-center shadow-soft">
        {t("manage.completed")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-3xl border border-line bg-card p-6 shadow-soft">
        <h2 className="text-lg font-semibold">
          {data.sessionName} {t("manage.with")} {data.practitionerName}
        </h2>
        <p className="mt-1 text-mist">{when}</p>
        {rescheduled ? (
          <p className="mt-3 text-sm text-ok">
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
        <SlotPicker
          availableDays={availableDays}
          day={day}
          slots={daySlots.map((s) => s.startAt)}
          selected={newSlot}
          loading={loading}
          onSelectDay={(key) => {
            setDay(key);
            setNewSlot("");
          }}
          onSelectSlot={setNewSlot}
        />
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
