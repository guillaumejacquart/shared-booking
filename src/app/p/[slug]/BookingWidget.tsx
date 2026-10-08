"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { ANALYTICS_EVENTS, trackClientEvent } from "@/lib/analytics";
import { toKey } from "@/lib/calendar";
import { fullFmt, timeFmt } from "@/lib/format";
import {
  formatOnsitePaymentMethods,
  formatPayablePrice,
  type OnsitePaymentMethod,
} from "@/lib/onsite-payments";
import { Button } from "@/components/ui";
import SlotPicker from "@/components/SlotPicker";
import BookingConfirmation from "@/components/booking/BookingConfirmation";
import PatientForm from "@/components/booking/PatientForm";
import OnsitePaymentNotice, {
  type OnsitePaymentNoticeInfo,
} from "@/components/booking/OnsitePaymentNotice";
import SessionTypeList, { type SessionSelection } from "@/components/booking/SessionTypeList";
import { displayPrice, type SessionTypeOpt } from "@/components/booking/format";
import { useAvailableSlots, type SlotDto } from "@/hooks/useAvailableSlots";

function slotLabel(startAt: string): string {
  const start = new Date(startAt);
  return `${fullFmt.format(start)} à ${timeFmt.format(start)}`;
}

function defaultSelection(sessionTypes: SessionTypeOpt[]): SessionSelection | null {
  const first = sessionTypes[0];
  const variant = first?.variants[0];
  if (!first || !variant) return null;
  return { typeId: first.id, variantId: variant.id };
}

const ONSITE_METHOD_KEYS: Record<OnsitePaymentMethod, string> = {
  especes: "onsite.methodEspeces",
  carte: "onsite.methodCarte",
  virement: "onsite.methodVirement",
  cheque: "onsite.methodCheque",
};

export interface OnsitePaymentInfo {
  methods: OnsitePaymentMethod[];
  note: string | null;
}

export default function BookingWidget({
  slug,
  sessionTypes,
  onsitePayment,
}: {
  slug: string;
  sessionTypes: SessionTypeOpt[];
  onsitePayment: OnsitePaymentInfo;
}) {
  const [selection, setSelection] = useState<SessionSelection | null>(() =>
    defaultSelection(sessionTypes),
  );
  const { allSlots, byDay, availableDays, loading } = useAvailableSlots(
    slug,
    selection?.typeId ?? "",
    56,
    selection?.variantId,
  );
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string>("");
  const [confirmed, setConfirmed] = useState<SlotDto | null>(null);

  const next = allSlots[0] ?? null;
  const daySlots = day ? (byDay.get(day) ?? []) : [];
  const selectedType = sessionTypes.find((sessionType) => sessionType.id === selection?.typeId);
  const selectedVariant = selectedType?.variants.find(
    (variant) => variant.id === selection?.variantId,
  );

  function pickSelection(nextSelection: SessionSelection) {
    setSelection(nextSelection);
    setDay(null);
    setSlot("");
  }

  function pickDay(key: string) {
    setDay(key);
    setSlot("");
  }

  function pickSlot(startAt: string) {
    setSlot(startAt);
    trackClientEvent(ANALYTICS_EVENTS.BOOKING_SLOT_SELECTED, {
      practitionerSlug: slug,
      ...(selection ? { sessionTypeId: selection.typeId } : {}),
    });
  }

  function pickNext() {
    if (!next) return;
    setDay(toKey(new Date(next.startAt)));
    pickSlot(next.startAt);
  }

  if (sessionTypes.length === 0) {
    return <p className="text-sm text-mist">{t("booking.noSessionTypes")}</p>;
  }

  // Prix à régler sur place : séance sans paiement en ligne + tarif affiché
  // non gratuit. Les moyens acceptés viennent du réglage praticien.
  const onsitePrice =
    selectedType && !selectedType.requiresPayment && selectedVariant
      ? formatPayablePrice(selectedVariant.priceDisplay, selectedType.currency)
      : null;
  const onsiteMethods = formatOnsitePaymentMethods(
    onsitePayment.methods,
    Object.fromEntries(
      onsitePayment.methods.map((method) => [method, t(ONSITE_METHOD_KEYS[method])]),
    ) as Record<OnsitePaymentMethod, string>,
  );
  const note = onsitePayment.note?.trim() ? onsitePayment.note.trim() : null;
  const onsiteNotice: OnsitePaymentNoticeInfo | null = onsitePrice
    ? { price: onsitePrice, methods: onsiteMethods, note }
    : null;

  if (confirmed) {
    return (
      <BookingConfirmation
        sessionName={selectedType?.name}
        slot={confirmed}
        onsiteNotice={onsiteNotice}
      />
    );
  }

  const variantPrice = selectedVariant
    ? displayPrice(
        selectedVariant,
        selectedType?.currency ?? "eur",
        selectedType?.requiresPayment ?? false,
      )
    : null;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("booking.chooseSession")}</h2>
        <SessionTypeList sessionTypes={sessionTypes} selected={selection} onSelect={pickSelection} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("booking.chooseSlot")}</h2>
        {!loading && next && !slot ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-brand-soft p-4 text-ink">
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
          onSelectSlot={pickSlot}
        />
      </section>

      {slot ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t("booking.yourDetails")}</h2>
          <p className="mb-3 text-sm text-mist">
            {selectedType?.name}
            {selectedVariant
              ? ` — ${t("booking.minutes", { min: selectedVariant.durationMin })}${variantPrice ? ` · ${variantPrice}` : ""}`
              : null}{" "}
            — {slotLabel(slot)}
            {onsitePrice ? ` · ${t("booking.payOnSite")}` : null}
          </p>
          {onsiteNotice ? (
            <div className="mb-3">
              <OnsitePaymentNotice info={onsiteNotice} />
            </div>
          ) : null}
          <PatientForm
            slug={slug}
            sessionTypeId={selection?.typeId ?? ""}
            sessionVariantId={selection?.variantId}
            startAt={slot}
            onConfirmed={setConfirmed}
          />
        </section>
      ) : null}
    </div>
  );
}
