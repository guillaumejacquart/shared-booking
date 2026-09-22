import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODE,
  DEFAULT_PALETTE,
  PALETTES,
  THEME_MODES,
  parseMode,
  parsePalette,
} from "./theme";

describe("theme", () => {
  it("parsePalette accepte les palettes connues, défaut sinon", () => {
    for (const p of PALETTES) expect(parsePalette(p)).toBe(p);
    expect(parsePalette("zinc")).toBe(DEFAULT_PALETTE);
    expect(parsePalette(undefined)).toBe(DEFAULT_PALETTE);
    expect(parsePalette(null)).toBe(DEFAULT_PALETTE);
    expect(parsePalette(42)).toBe(DEFAULT_PALETTE);
  });

  it("parseMode accepte les modes connus, défaut sinon", () => {
    for (const m of THEME_MODES) expect(parseMode(m)).toBe(m);
    expect(parseMode("sombre")).toBe(DEFAULT_MODE);
    expect(parseMode(undefined)).toBe(DEFAULT_MODE);
  });

  it("six palettes bien-être proposées", () => {
    expect(PALETTES).toEqual(["sauge", "brume", "lavande", "sable", "lotus", "cedre"]);
  });
});
