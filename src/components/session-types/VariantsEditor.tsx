"use client";

import { t } from "@/lib/i18n";
import { Button, Field, NumberInput, TextInput } from "@/components/ui";
import type { SessionTypeVariantRow } from "./types";

/**
 * Éditeur de déclinaisons durée/prix d'une séance. Chaque ligne porte sa
 * durée, son battement et son prix (texte libre + montant débité si payant).
 * Les ids temporaires (`new-…`) deviennent de vraies variantes à la sauvegarde.
 */
export function newVariantKey(): string {
  return `new-${crypto.randomUUID()}`;
}

export function isNewVariantKey(id: string): boolean {
  return id.startsWith("new-");
}

export default function VariantsEditor({
  variants,
  showPriceCents,
  onChange,
}: {
  variants: SessionTypeVariantRow[];
  /** Séance payante : chaque déclinaison porte son montant débité. */
  showPriceCents: boolean;
  onChange: (variants: SessionTypeVariantRow[]) => void;
}) {
  function patch(index: number, data: Partial<SessionTypeVariantRow>) {
    onChange(variants.map((variant, position) => (position === index ? { ...variant, ...data } : variant)));
  }

  function add() {
    const last = variants[variants.length - 1];
    onChange([
      ...variants,
      {
        id: newVariantKey(),
        durationMin: (last?.durationMin ?? 60) + 30,
        bufferAfterMin: last?.bufferAfterMin ?? 10,
        priceDisplay: null,
        priceCents: null,
      },
    ]);
  }

  function remove(index: number) {
    onChange(variants.filter((entry, position) => position !== index));
  }

  return (
    <div className="mt-2">
      <p className="mb-1 text-sm font-medium">{t("sessionTypesAdmin.variants")}</p>
      <div className="grid gap-2">
        {variants.map((variant, index) => (
          <div
            key={variant.id}
            className="grid items-end gap-2 rounded-xl border border-line p-2 sm:grid-cols-2 xl:grid-cols-4"
          >
            <Field label={t("sessionTypesAdmin.duration")}>
              <NumberInput
                unit="min"
                value={variant.durationMin}
                min={5}
                max={480}
                onChange={(event) =>
                  patch(index, { durationMin: Number(event.target.value) })
                }
              />
            </Field>
            <Field
              label={t("sessionTypesAdmin.buffer")}
              tooltip={t("sessionTypesAdmin.bufferHint")}
              tooltipAlign="right"
            >
              <NumberInput
                unit="min"
                value={variant.bufferAfterMin}
                min={0}
                max={480}
                onChange={(event) =>
                  patch(index, { bufferAfterMin: Number(event.target.value) })
                }
              />
            </Field>
            <Field label={t("sessionTypesAdmin.price")} hint={t("sessionTypesAdmin.priceHint")}>
              <TextInput
                value={variant.priceDisplay ?? ""}
                onChange={(event) => patch(index, { priceDisplay: event.target.value })}
                maxLength={30}
                required
              />
            </Field>
            <div className="flex items-end gap-2">
              {showPriceCents ? (
                <div className="grow">
                  <Field
                    label={t("sessionTypesAdmin.priceCents")}
                    hint={t("sessionTypesAdmin.priceCentsHint")}
                  >
                    <NumberInput
                      unit="€"
                      value={variant.priceCents != null ? variant.priceCents / 100 : ""}
                      min={1}
                      onChange={(event) =>
                        patch(index, {
                          priceCents:
                            event.target.value === ""
                              ? null
                              : Math.round(Number(event.target.value) * 100),
                        })
                      }
                    />
                  </Field>
                </div>
              ) : null}
              {variants.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(index)}
                  aria-label={t("sessionTypesAdmin.removeVariant")}
                >
                  ✕
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {variants.length < 6 ? (
        <Button type="button" size="sm" variant="ghost" onClick={add} className="mt-1">
          {t("sessionTypesAdmin.addVariant")}
        </Button>
      ) : null}
    </div>
  );
}
