"use client";

import {
  PALETTES,
  PALETTE_LABEL_KEYS,
  PALETTE_SWATCH,
  THEME_MODES,
  type PaletteId,
  type ThemeMode,
} from "@/lib/theme";
import { t } from "@/lib/i18n";

/**
 * Sélecteur d'apparence partagé : pastilles de palettes (+ aperçu instantané
 * via `onPreview`) et choix du mode. La persistance est gérée par l'appelant.
 */
export default function ThemePicker({
  palette,
  mode,
  onPalette,
  onMode,
  showMode = true,
}: {
  palette: PaletteId;
  mode: ThemeMode;
  onPalette: (p: PaletteId) => void;
  onMode: (m: ThemeMode) => void;
  showMode?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap gap-2">
          {PALETTES.map((p) => {
            const active = p === palette;
            return (
              <button
                key={p}
                type="button"
                onClick={() => onPalette(p)}
                aria-pressed={active}
                title={t(PALETTE_LABEL_KEYS[p])}
                aria-label={t(PALETTE_LABEL_KEYS[p])}
                style={{ backgroundColor: PALETTE_SWATCH[p] }}
                className={`h-9 w-9 rounded-full transition-all duration-200 ${
                  active
                    ? "scale-110 ring-2 ring-brand ring-offset-2 ring-offset-card"
                    : "hover:scale-105 opacity-80 hover:opacity-100"
                }`}
              />
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-mist">{t(PALETTE_LABEL_KEYS[palette])}</p>
      </div>
      {showMode ? (
        <div
          role="group"
          aria-label={t("theme.appearance")}
          className="flex w-fit gap-1 rounded-full border border-line bg-card p-1"
        >
          {THEME_MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              aria-pressed={m === mode}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                m === mode ? "bg-brand text-brand-ink shadow-soft" : "text-mist hover:text-ink"
              }`}
            >
              {t(`theme.mode.${m}`)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
