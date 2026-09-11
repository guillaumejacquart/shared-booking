"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { Button, Checkbox, Field, FormMessage, NumberInput, TextInput } from "@/components/ui";

export interface SessionTypeRow {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  bufferAfterMin: number;
  priceDisplay: string | null;
  active: boolean;
  requiresPayment: boolean;
  priceCents: number | null;
  currency: string;
  requiresValidation: boolean;
}

export default function SessionTypesManager({
  practitionerId,
  initial,
}: {
  practitionerId: string;
  initial: SessionTypeRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<SessionTypeRow[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState("");
  const [durationMin, setDurationMin] = useState(60);
  const [bufferAfterMin, setBufferAfterMin] = useState(10);
  const [priceDisplay, setPriceDisplay] = useState("");
  const [requiresPayment, setRequiresPayment] = useState(false);
  const [priceEuros, setPriceEuros] = useState("");
  const [requiresValidation, setRequiresValidation] = useState(false);

  function patch(id: string, data: Partial<SessionTypeRow>) {
    setSaved(false);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...data } : r)));
  }

  async function save(row: SessionTypeRow) {
    setError(null);
    const res = await fetch(`/api/session-types/${row.id}?practitionerId=${practitionerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ practitionerId, ...row }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError((j?.error as string) || t("booking.errorGeneric"));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/session-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        practitionerId,
        name,
        durationMin,
        bufferAfterMin,
        priceDisplay: priceDisplay || undefined,
        requiresPayment,
        priceCents: requiresPayment ? Math.round(Number(priceEuros) * 100) : undefined,
        requiresValidation,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError((j?.error as string) || t("booking.errorGeneric"));
      return;
    }
    setName("");
    setPriceDisplay("");
    setRequiresPayment(false);
    setPriceEuros("");
    setRequiresValidation(false);
    // Mise à jour optimiste (même raison que RoomsManager : `initial` n'est lu qu'au montage).
    const created = (await res.json()) as { id: string };
    setRows((rs) => [
      ...rs,
      {
        id: created.id,
        name,
        description: null,
        durationMin,
        bufferAfterMin,
        priceDisplay: priceDisplay || null,
        active: true,
        requiresPayment,
        priceCents: requiresPayment ? Math.round(Number(priceEuros) * 100) : null,
        currency: "eur",
        requiresValidation,
      },
    ]);
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const res = await fetch(`/api/session-types/${id}?practitionerId=${practitionerId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError((j?.error as string) || t("booking.errorGeneric"));
      return;
    }
    setRows((rs) => rs.filter((r) => r.id !== id));
  }

  return (
    <div>
      <div className="grid gap-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("sessionTypesAdmin.name")}>
                <TextInput value={r.name} onChange={(e) => patch(r.id, { name: e.target.value })} maxLength={80} />
              </Field>
              <Field label={t("sessionTypesAdmin.price")}>
                <TextInput
                  value={r.priceDisplay ?? ""}
                  onChange={(e) => patch(r.id, { priceDisplay: e.target.value })}
                  maxLength={30}
                />
              </Field>
              <Field label={t("sessionTypesAdmin.duration")}>
                <NumberInput
                  unit="min"
                  value={r.durationMin}
                  min={5}
                  max={480}
                  onChange={(e) => patch(r.id, { durationMin: Number(e.target.value) })}
                />
              </Field>
              <Field label={t("sessionTypesAdmin.buffer")} hint={t("sessionTypesAdmin.bufferHint")}>
                <NumberInput
                  unit="min"
                  value={r.bufferAfterMin}
                  min={0}
                  max={480}
                  onChange={(e) => patch(r.id, { bufferAfterMin: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={r.active} onChange={(e) => patch(r.id, { active: e.target.checked })} />
                {t("sessionTypesAdmin.active")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={r.requiresPayment}
                  onChange={(e) => patch(r.id, { requiresPayment: e.target.checked })}
                />
                {t("sessionTypesAdmin.requiresPayment")}
              </label>
              {r.requiresPayment ? (
                <Field label={t("sessionTypesAdmin.priceCents")}>
                  <NumberInput
                    unit="€"
                    value={r.priceCents != null ? r.priceCents / 100 : ""}
                    min={1}
                    onChange={(e) =>
                      patch(r.id, {
                        priceCents: e.target.value === "" ? null : Math.round(Number(e.target.value) * 100),
                      })
                    }
                  />
                </Field>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={r.requiresValidation}
                  onChange={(e) => patch(r.id, { requiresValidation: e.target.checked })}
                />
                {t("sessionTypesAdmin.requiresValidation")}
              </label>
              <span className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => void save(r)}>
                  {t("sessionTypesAdmin.save")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(r.id)}>
                  {t("sessionTypesAdmin.delete")}
                </Button>
              </span>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={create} className="mt-4 rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("sessionTypesAdmin.name")}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Field label={t("sessionTypesAdmin.price")}>
            <TextInput value={priceDisplay} onChange={(e) => setPriceDisplay(e.target.value)} maxLength={30} />
          </Field>
          <Field label={t("sessionTypesAdmin.duration")}>
            <NumberInput unit="min" value={durationMin} min={5} max={480} onChange={(e) => setDurationMin(Number(e.target.value))} />
          </Field>
          <Field label={t("sessionTypesAdmin.buffer")} hint={t("sessionTypesAdmin.bufferHint")}>
            <NumberInput unit="min" value={bufferAfterMin} min={0} max={480} onChange={(e) => setBufferAfterMin(Number(e.target.value))} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={requiresPayment} onChange={(e) => setRequiresPayment(e.target.checked)} />
            {t("sessionTypesAdmin.requiresPayment")}
          </label>
          {requiresPayment ? (
            <Field label={t("sessionTypesAdmin.priceCents")}>
              <NumberInput unit="€" value={priceEuros} min={1} onChange={(e) => setPriceEuros(e.target.value)} required={requiresPayment} />
            </Field>
          ) : null}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={requiresValidation} onChange={(e) => setRequiresValidation(e.target.checked)} />
            {t("sessionTypesAdmin.requiresValidation")}
          </label>
        </div>
        <Button type="submit" size="sm" className="mt-3">
          {t("sessionTypesAdmin.create")}
        </Button>
      </form>
      <div className="mt-2 flex flex-col gap-1">
        <FormMessage tone="error">{error ?? ""}</FormMessage>
        {saved ? <FormMessage tone="ok">{t("dashboard.saved")}</FormMessage> : null}
      </div>
    </div>
  );
}
