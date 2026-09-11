import fr from "@/messages/fr.json";

/**
 * Accès typé au catalogue de chaînes (français uniquement pour le MVP).
 * Toutes les chaînes UI passent par ici : l'ajout d'une locale (ex. `en.json`)
 * ou la migration vers `next-intl` se fera en un seul point.
 */
type Nested = { [key: string]: string | Nested };

function lookup(dict: Nested, key: string): string {
  const parts = key.split(".");
  let node: string | Nested = dict;
  for (const p of parts) {
    if (typeof node !== "object" || !(p in node)) return key;
    node = node[p];
  }
  return typeof node === "string" ? node : key;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(fr as unknown as Nested, key);
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(`{${k}}`, String(v)),
    raw,
  );
}

export const STR = fr;
