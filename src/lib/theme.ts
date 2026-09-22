/**
 * Thèmes d'apparence : palettes bien-être + mode clair/sombre/système.
 *
 * Deux portées :
 * - personnelle (dashboard) : chaque utilisateur choisit palette + mode,
 *   persistés en base (`user_preferences`) et en cookies pour un rendu
 *   sans flash dès le HTML initial ;
 * - cabinet (pages publiques) : le responsable choisit l'« ambiance »
 *   (`office.themePalette`) ; le mode suit toujours l'appareil du patient
 *   (`system`), jamais imposé par le cabinet.
 */

export const PALETTES = [
  "sauge",
  "brume",
  "lavande",
  "sable",
  "lotus",
  "cedre",
] as const;
export type PaletteId = (typeof PALETTES)[number];

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const COOKIE_PALETTE = "sb-palette";
export const COOKIE_MODE = "sb-mode";

export const DEFAULT_PALETTE: PaletteId = "sauge";
export const DEFAULT_MODE: ThemeMode = "system";

/** Libellés i18n (clés `theme.palette.*`). */
export const PALETTE_LABEL_KEYS: Record<PaletteId, string> = {
  sauge: "theme.palette.sauge",
  brume: "theme.palette.brume",
  lavande: "theme.palette.lavande",
  sable: "theme.palette.sable",
  lotus: "theme.palette.lotus",
  cedre: "theme.palette.cedre",
};

export function parsePalette(value: unknown): PaletteId {
  return typeof value === "string" &&
    (PALETTES as readonly string[]).includes(value)
    ? (value as PaletteId)
    : DEFAULT_PALETTE;
}

export function parseMode(value: unknown): ThemeMode {
  return typeof value === "string" &&
    (THEME_MODES as readonly string[]).includes(value)
    ? (value as ThemeMode)
    : DEFAULT_MODE;
}

export interface ThemePreference {
  palette: PaletteId;
  mode: ThemeMode;
}

/** Couleur représentative (pastille du sélecteur), une par palette. */
export const PALETTE_SWATCH: Record<PaletteId, string> = {
  sauge: "#4e7a5b",
  brume: "#477791",
  lavande: "#776da6",
  sable: "#a9764f",
  lotus: "#a9667c",
  cedre: "#8a6a45",
};
