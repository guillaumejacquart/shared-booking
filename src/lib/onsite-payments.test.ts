import { describe, expect, it } from "vitest";

import {
  formatOnsitePaymentMethods,
  formatPayablePrice,
  formatPlainAmount,
  isFreePriceDisplay,
  ONSITE_METHOD_LABELS_FR,
  parseOnsitePaymentMethods,
} from "./onsite-payments";

describe("parseOnsitePaymentMethods", () => {
  it("parse le JSON stocké dans l'ordre canonique, sans doublons", () => {
    expect(parseOnsitePaymentMethods('["virement","especes","especes"]')).toEqual([
      "especes",
      "virement",
    ]);
  });

  it("ignore le JSON invalide, les inconnues et les non-tableaux", () => {
    expect(parseOnsitePaymentMethods(null)).toEqual([]);
    expect(parseOnsitePaymentMethods("")).toEqual([]);
    expect(parseOnsitePaymentMethods("n'importe quoi")).toEqual([]);
    expect(parseOnsitePaymentMethods('"especes"')).toEqual([]);
    expect(parseOnsitePaymentMethods('["especes","bitcoin",42,null]')).toEqual(["especes"]);
  });
});

describe("formatOnsitePaymentMethods", () => {
  it("énumère à la française", () => {
    expect(formatOnsitePaymentMethods([])).toBeNull();
    expect(formatOnsitePaymentMethods(["especes"])).toBe("espèces");
    expect(formatOnsitePaymentMethods(["especes", "carte"])).toBe("espèces et carte bancaire");
    expect(formatOnsitePaymentMethods(["especes", "carte", "virement"])).toBe(
      "espèces, carte bancaire et virement",
    );
  });

  it("accepte des libellés surchargés (UI via fr.json)", () => {
    expect(
      formatOnsitePaymentMethods(["cheque"], { ...ONSITE_METHOD_LABELS_FR, cheque: "Chèque" }),
    ).toBe("Chèque");
  });
});

describe("isFreePriceDisplay", () => {
  it("détecte gratuit / zéro / à définir", () => {
    expect(isFreePriceDisplay(null)).toBe(true);
    expect(isFreePriceDisplay("")).toBe(true);
    expect(isFreePriceDisplay("0")).toBe(true);
    expect(isFreePriceDisplay("0,00 €")).toBe(true);
    expect(isFreePriceDisplay("gratuit")).toBe(true);
    expect(isFreePriceDisplay("Gratuite")).toBe(true);
  });

  it("laisse passer les vrais tarifs et les textes libres", () => {
    expect(isFreePriceDisplay("60")).toBe(false);
    expect(isFreePriceDisplay("60 €")).toBe(false);
    expect(isFreePriceDisplay("sur devis")).toBe(false);
    expect(isFreePriceDisplay("à partir de 50 €")).toBe(false);
  });
});

describe("formatPayablePrice", () => {
  it("formate les montants nus, passe les textes libres, ignore le gratuit", () => {
    expect(formatPayablePrice("60", "eur")).toContain("60,00");
    expect(formatPayablePrice("60 €", "eur")).toBe("60 €");
    expect(formatPayablePrice("sur devis", "eur")).toBe("sur devis");
    expect(formatPayablePrice("0", "eur")).toBeNull();
    expect(formatPayablePrice(null, "eur")).toBeNull();
  });
});

describe("formatPlainAmount", () => {
  it("ne formate que les montants nus", () => {
    expect(formatPlainAmount("59,90", "eur")).toContain("59,90");
    expect(formatPlainAmount("sur devis", "eur")).toBeNull();
  });
});
