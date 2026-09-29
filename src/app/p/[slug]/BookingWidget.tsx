"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { toKey } from "@/lib/calendar";
import { fullFmt, timeFmt } from "@/lib/format";
import { Button } from "@/components/ui";
import SlotPicker from "@/components/SlotPicker";
import BookingConfirmation from "@/components/booking/BookingConfirmation";
import PatientForm from "@/components/booking/PatientForm";
import SessionTypeList from "@/components/booking/SessionTypeList";
import type { SessionTypeOpt } from "@/components/booking/format";
import { useAvailableSlots, type SlotDto } from "@/hooks/useAvailableSlots";

function slotLabel(startAt: string): string {
  const start = new Date(startAt);
  return `${fullFmt.format(start)} à ${timeFmt.format(start)}`;
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
  const [confirmed, setConfirmed] = useState<SlotDto | null>(null);

  const next = allSlots[0] ?? null;
  const daySlots = day ? (byDay.get(day) ?? []) : [];
  const selectedType = sessionTypes.find((sessionType) => sessionType.id === typeId);

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
    setDay(toKey(new Date(next.startAt)));
    setSlot(next.startAt);
  }

  if (sessionTypes.length === 0) {
    return <p className="text-sm text-mist">{t("booking.noSessionTypes")}</p>;
  }

  if (confirmed) {
    return <BookingConfirmation sessionName={selectedType?.name} slot={confirmed} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("booking.chooseSession")}</h2>
        <SessionTypeList sessionTypes={sessionTypes} selectedId={typeId} onSelect={pickType} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("booking.chooseSlot")}</h2>
        {!loading && next && !slot ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border bg-ok-bg p-4 text-ok">
            <p className="text-sm">
              <span className="font-semibold">{t("booking.nextSlot")} : </span>
              {slotLabel(next.startAt)}
            </p>
            <Button size="sm" onClick={pickNext}>
              {t("booking.choose")}
            </Button>
          </div>
        ) : null}
        <SlotPicker
          availableDays={availableDays}
          day={day}
          slots={daySlots.map((daySlot) => daySlot.startAt)}
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
            {selectedType?.name} — {slotLabel(slot)}
          </p>
          <PatientForm slug={slug} sessionTypeId={typeId} startAt={slot} onConfirmed={setConfirmed} />
        </section>
      ) : null}
    </div>
  );
}
