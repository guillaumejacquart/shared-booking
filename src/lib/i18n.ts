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
  for (const part of parts) {
    if (typeof node !== "object" || !(part in node)) return key;
    node = node[part];
  }
  return typeof node === "string" ? node : key;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(fr as unknown as Nested, key);
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    raw,
  );
}

export const STR = fr;
