import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { z } from "zod";

import {
  ConflictError,
  DeadlineError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/errors";
import { readJsonBody, route, toResponse } from "./errors";

async function body(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

describe("toResponse", () => {
  it("mappe chaque erreur métier vers statut + code stables", async () => {
    const cases: [unknown, number, string][] = [
      [new NotFoundError("X"), 404, "NOT_FOUND"],
      [new ValidationError("X"), 400, "VALIDATION"],
      [new ConflictError("X"), 409, "CONFLICT"],
      [new DeadlineError("X"), 410, "DEADLINE"],
      [new ForbiddenError("X"), 403, "FORBIDDEN"],
    ];
    for (const [err, status, code] of cases) {
      const res = toResponse(err);
      expect(res.status).toBe(status);
      expect(await body(res)).toMatchObject({ error: "X", code });
    }
  });

  it("expose le détail des erreurs de validation (champ fautif)", async () => {
    const schema = z.object({ durationMin: z.number().int().min(5) });
    const parsed = schema.safeParse({ durationMin: 0 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const res = toResponse(parsed.error);
    expect(res.status).toBe(400);
    const json = await body(res);
    expect(json.code).toBe("VALIDATION");
    expect(JSON.stringify(json.details)).toContain("durationMin");
  });

  it("inclut le message d'origine en dev, générique en prod", async () => {
    const res = toResponse(new Error("boom précis"));
    expect(res.status).toBe(500);
    // NODE_ENV=test ≠ production → message inclus.
    expect(await body(res)).toMatchObject({ error: "boom précis", code: "INTERNAL" });
  });
});

describe("readJsonBody", () => {
  const post = (payload: string) =>
    new Request("http://localhost/api", { method: "POST", body: payload });

  it("retourne l'objet JSON tel quel", async () => {
    expect(await readJsonBody(post(JSON.stringify({ a: 1 })))).toEqual({ a: 1 });
  });

  it("lève une ValidationError (400) sur JSON invalide", async () => {
    await expect(readJsonBody(post("pas du json"))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("retourne {} pour un JSON valide non-objet", async () => {
    expect(await readJsonBody(post("[1,2]"))).toEqual({});
  });
});

describe("route", () => {
  it("mappe une erreur levée par le handler en réponse HTTP", async () => {
    const handler = route(async () => {
      throw new NotFoundError("X");
    });
    const res = await handler(new NextRequest("http://localhost/api"));
    expect(res.status).toBe(404);
    expect(await body(res)).toMatchObject({ code: "NOT_FOUND" });
  });
});
