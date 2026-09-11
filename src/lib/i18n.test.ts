import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import fr from "@/messages/fr.json";

function lookup(key: string): unknown {
  let node: unknown = fr;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("i18n catalog", () => {
  it("chaque clé t(\"…\") utilisée existe dans fr.json", () => {
    const missing: string[] = [];
    for (const file of sourceFiles("src")) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/\bt\(\s*\"([^\"]+)\"/g)) {
        const key = match[1];
        if (typeof lookup(key) !== "string" && !missing.includes(`${key} (${file})`)) {
          missing.push(`${key} (${file})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
