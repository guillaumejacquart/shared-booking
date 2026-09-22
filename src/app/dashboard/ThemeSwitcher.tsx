"use client";

import { useEffect, useState } from "react";

import ThemePicker from "@/components/ThemePicker";
import { Button, Modal } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  DEFAULT_MODE,
  PALETTE_LABEL_KEYS,
  PALETTE_SWATCH,
  parseMode,
  parsePalette,
  type PaletteId,
  type ThemeMode,
} from "@/lib/theme";

/** Applique le thème au document (aperçu instantané, sans rechargement). */
function applyTheme(palette: PaletteId, mode: ThemeMode) {
  document.documentElement.dataset.palette = palette;
  document.documentElement.dataset.mode = mode;
}

/**
 * Sélecteur de thème dans la navigation du dashboard.
 * Thème effectif = choix personnel, sinon ambiance du cabinet (mode
 * système). Choisir ici crée le choix personnel (surcharge durable).
 * Persiste via PATCH /api/preferences (qui pose aussi les cookies).
 */
export default function ThemeSwitcher({
  officePalette,
  userPalette,
  userMode,
}: {
  officePalette: string;
  userPalette: string | null;
  userMode: string | null;
}) {
  const effective: { palette: PaletteId; mode: ThemeMode } = {
    palette: userPalette ? parsePalette(userPalette) : parsePalette(officePalette),
    mode: userMode ? parseMode(userMode) : DEFAULT_MODE,
  };
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = useState<PaletteId>(effective.palette);
  const [mode, setMode] = useState<ThemeMode>(effective.mode);
  const followingOffice = userPalette === null;

  useEffect(() => {
    applyTheme(palette, mode);
  }, [palette, mode]);

  function preview(p: PaletteId, m: ThemeMode) {
    setPalette(p);
    setMode(m);
    applyTheme(p, m);
  }

  async function persist(p: PaletteId, m: ThemeMode) {
    preview(p, m);
    try {
      await fetch("/api/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ palette: p, mode: m }),
      });
    } catch {
      // Aperçu conservé même si la persistance échoue.
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("theme.appearance")}
        title={
          followingOffice
            ? t("theme.followingOffice")
            : t("theme.appearance")
        }
        className="flex h-8 items-center gap-2 rounded-full border border-brand bg-brand-soft px-3 text-sm font-medium text-brand-deep shadow-soft transition-all duration-200 hover:bg-brand hover:text-brand-ink"
      >
        <span
          aria-hidden
          className="h-4 w-4 rounded-full ring-1 ring-black/10"
          style={{ backgroundColor: PALETTE_SWATCH[palette] }}
        />
        <span>{t(PALETTE_LABEL_KEYS[palette])}</span>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t("theme.appearance")}>
        {followingOffice ? (
          <p className="mb-4 text-sm text-mist">{t("theme.followingOffice")}</p>
        ) : null}
        <ThemePicker
          palette={palette}
          mode={mode}
          onPalette={(p) => void persist(p, mode)}
          onMode={(m) => void persist(palette, m)}
        />
        <div className="mt-5 flex justify-end">
          <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
            {t("common.close")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
