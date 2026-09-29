import { describe, expect, it } from "vitest";

import { slugify, uniquePractitionerSlug } from "./team";

describe("slugify", () => {
  it("normalise accents, casse et séparateurs", () => {
    expect(slugify("Élodie Martin")).toBe("elodie-martin");
    expect(slugify("  Jean--Dupont  ")).toBe("jean-dupont");
  });

  it("repli sur 'praticien' si vide", () => {
    expect(slugify("!!!")).toBe("praticien");
  });
});

describe("uniquePractitionerSlug", () => {
  it("retourne base si libre", async () => {
    await expect(uniquePractitionerSlug("nadia", async () => false)).resolves.toBe("nadia");
  });

  it("suffixe -2, -3 jusqu'au premier libre", async () => {
    const taken = new Set(["nadia", "nadia-2"]);
    const slug = await uniquePractitionerSlug("nadia", async (s) => taken.has(s));
    expect(slug).toBe("nadia-3");
  });
});
