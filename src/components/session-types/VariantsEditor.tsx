"use client";

import { useId } from "react";

import { t } from "@/lib/i18n";
import { Button, InfoTooltip, NumberInput, TextInput } from "@/components/ui";
import type { SessionTypeVariantRow } from "./types";

/**
 * Éditeur de déclinaisons durée/prix d'une séance : une mini-table compacte
 * (une ligne par déclinaison) au lieu d'une carte par variante. Les ids
 * temporaires (`new-…`) deviennent de vraies variantes à la sauvegarde.
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
  // Préfixe des ids des labels sr-only (les ids variantes seuls pourraient
  // collisionner entre la carte d'édition et le formulaire de création).
  const formId = useId();

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
      <p className="text-sm font-medium">{t("sessionTypesAdmin.variants")}</p>
      {/* Aide prix globale : avant, elle était répétée sous chaque variante. */}
      <p className="mt-0.5 text-xs text-mist">{t("sessionTypesAdmin.priceHint")}</p>
      <div className="mt-1.5 w-fit max-w-full overflow-x-auto rounded-xl border border-line">
        <table className="w-auto text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-mist">
              <th scope="col" className="px-1.5 py-1 font-medium">
                {t("sessionTypesAdmin.duration")} <span className="text-faint">(min)</span>
              </th>
              <th scope="col" className="px-1.5 py-1 font-medium">
                <span className="inline-flex items-center gap-1">
                  {t("sessionTypesAdmin.bufferShort")} <span className="text-faint">(min)</span>
                  <InfoTooltip text={t("sessionTypesAdmin.bufferHint")} />
                </span>
              </th>
              <th scope="col" className="px-1.5 py-1 font-medium">
                {t("sessionTypesAdmin.price")}
              </th>
              {showPriceCents ? (
                <th scope="col" className="px-1.5 py-1 font-medium">
                  <span className="inline-flex items-center gap-1">
                    {t("sessionTypesAdmin.priceCents")}
                    <InfoTooltip text={t("sessionTypesAdmin.priceCentsHint")} />
                  </span>
                </th>
              ) : null}
              <th scope="col" className="w-9 px-1 py-1">
                <span className="sr-only">{t("sessionTypesAdmin.removeVariant")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {variants.map((variant, index) => {
              const durationId = `${formId}-${variant.id}-duration`;
              const bufferId = `${formId}-${variant.id}-buffer`;
              const priceId = `${formId}-${variant.id}-price`;
              const priceCentsId = `${formId}-${variant.id}-price-cents`;
              return (
                <tr key={variant.id} className="border-b border-line last:border-0">
                  <td className="px-1.5 py-1">
                    <label className="sr-only" htmlFor={durationId}>
                      {t("sessionTypesAdmin.duration")}
                    </label>
                    <NumberInput
                      id={durationId}
                      compact
                      value={variant.durationMin}
                      min={5}
                      max={480}
                      onChange={(event) => patch(index, { durationMin: Number(event.target.value) })}
                      className="w-12"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <label className="sr-only" htmlFor={bufferId}>
                      {t("sessionTypesAdmin.buffer")}
                    </label>
                    <NumberInput
                      id={bufferId}
                      compact
                      value={variant.bufferAfterMin}
                      min={0}
                      max={480}
                      onChange={(event) => patch(index, { bufferAfterMin: Number(event.target.value) })}
                      className="w-12"
                    />
                  </td>
                  <td className="px-1.5 py-1">
                    <label className="sr-only" htmlFor={priceId}>
                      {t("sessionTypesAdmin.price")}
                    </label>
                    <TextInput
                      id={priceId}
                      compact
                      widthClass="w-24"
                      value={variant.priceDisplay ?? ""}
                      onChange={(event) => patch(index, { priceDisplay: event.target.value })}
                      maxLength={30}
                      required
                    />
                  </td>
                  {showPriceCents ? (
                    <td className="px-1.5 py-1">
                      <label className="sr-only" htmlFor={priceCentsId}>
                        {t("sessionTypesAdmin.priceCents")}
                      </label>
                      <NumberInput
                        id={priceCentsId}
                        compact
                        wide
                        unit="€"
                        value={variant.priceCents != null ? variant.priceCents / 100 : ""}
                        min={1}
                        onChange={(event) =>
                          patch(index, {
                            priceCents:
                              event.target.value === "" ? null : Math.round(Number(event.target.value) * 100),
                          })
                        }
                      />
                    </td>
                  ) : null}
                  <td className="px-1 py-1 text-center">
                    {variants.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        aria-label={t("sessionTypesAdmin.removeVariant")}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-mist transition-colors hover:bg-wash hover:text-ink"
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {variants.length < 6 ? (
        <Button type="button" size="sm" variant="ghost" onClick={add} className="mt-1">
          {t("sessionTypesAdmin.addVariant")}
        </Button>
      ) : null}
    </div>
  );
}
