"use client";

import { useState } from "react";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, Checkbox, Field, FormMessage, TextInput, Textarea } from "@/components/ui";
import type { SlotDto } from "@/hooks/useAvailableSlots";

interface PatientFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  notes: string;
  website: string; // honeypot
}

const EMPTY: PatientFields = { firstName: "", lastName: "", email: "", phone: "", notes: "", website: "" };

type SubmitResult = { slot: SlotDto } | { redirect: string } | { error: string };

async function postBooking(slug: string, payload: Record<string, unknown>): Promise<SubmitResult> {
  const result = await sendJson<SlotDto & { checkoutUrl?: string }>(`/api/p/${slug}/bookings`, "POST", payload);
  if (!result.ok) return { error: result.status === 409 ? t("booking.taken") : result.error };
  if (result.data.checkoutUrl) return { redirect: result.data.checkoutUrl };
  return { slot: { startAt: result.data.startAt, endAt: result.data.endAt } };
}

export default function PatientForm({
  slug,
  sessionTypeId,
  startAt,
  onConfirmed,
}: {
  slug: string;
  sessionTypeId: string;
  startAt: string;
  onConfirmed: (slot: SlotDto) => void;
}) {
  const [fields, setFields] = useState<PatientFields>(EMPTY);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function bind(name: keyof PatientFields) {
    return {
      value: fields[name],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setFields((prev) => ({ ...prev, [name]: event.target.value })),
    };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await postBooking(slug, {
        sessionTypeId,
        startAt,
        patientFirstName: fields.firstName,
        patientLastName: fields.lastName,
        patientEmail: fields.email,
        patientPhone: fields.phone || undefined,
        notes: fields.notes || undefined,
        consent,
        website: fields.website || undefined,
      });
      if ("error" in result) setFormError(result.error);
      // Séance payante : redirection vers Stripe Checkout.
      else if ("redirect" in result) window.location.href = result.redirect;
      else onConfirmed(result.slot);
    } catch {
      setFormError(t("booking.errorGeneric"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("booking.firstName")}>
          <TextInput {...bind("firstName")} required maxLength={100} autoComplete="given-name" />
        </Field>
        <Field label={t("booking.lastName")}>
          <TextInput {...bind("lastName")} required maxLength={100} autoComplete="family-name" />
        </Field>
      </div>
      <Field label={t("booking.email")}>
        <TextInput type="email" {...bind("email")} required maxLength={254} autoComplete="email" />
      </Field>
      <Field label={t("booking.phoneOptional")}>
        <TextInput type="tel" {...bind("phone")} maxLength={30} autoComplete="tel" />
      </Field>
      <Field label={t("booking.notesOptional")} hint={t("booking.notesPlaceholder")}>
        <Textarea {...bind("notes")} maxLength={500} rows={3} />
      </Field>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
        <span>{t("booking.consent")}</span>
      </label>
      {/* Honeypot anti-bot : hors écran, jamais rempli par un humain. */}
      <input
        type="text"
        name="website"
        {...bind("website")}
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
  );
}
