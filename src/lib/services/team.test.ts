import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import type { Db } from "@/dal/types";
import { acceptInvite, createInvite, listPendingInvites } from "@/lib/services/team";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/services/errors";
import type { OutgoingEmail } from "@/lib/email";

let db: Db;
let sent: OutgoingEmail[];

const NOW = new Date("2026-09-14T06:00:00Z");

async function seed() {
  const s = await import("@/db/schema");
  await db.insert(s.user).values([
    { id: "owner1", name: "Owner", email: "owner@example.com" },
    { id: "other", name: "Other", email: "other@example.com" },
  ]);
  await db.insert(s.office).values({ id: "o1", name: "Cabinet", slug: "cabinet" });
  await db.insert(s.member).values([
    { id: "m1", officeId: "o1", userId: "owner1", role: "owner" },
    { id: "m2", officeId: "o1", userId: "other", role: "practitioner" },
  ]);
}

beforeEach(async () => {
  db = createMemoryDb();
  sent = [];
  await seed();
});

function deps() {
  return { tx: db, now: NOW, sendEmail: async (e: OutgoingEmail) => void sent.push(e) };
}

describe("createInvite", () => {
  it("le owner invite par email et l'invitation est envoyée", async () => {
    const inv = await createInvite(deps(), {
      officeId: "o1",
      email: "nouveau@example.com",
      role: "practitioner",
      requesterUserId: "owner1",
      origin: "http://localhost:3000",
    });
    expect(inv.token).toHaveLength(64);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("nouveau@example.com");
    expect(sent[0].text).toContain(`/invite/${inv.token}`);
  });

  it("un non-owner ne peut pas inviter", async () => {
    await expect(
      createInvite(deps(), {
        officeId: "o1",
        email: "x@example.com",
        role: "practitioner",
        requesterUserId: "other",
        origin: "http://localhost:3000",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

});

describe("createOffice", () => {
  it("crée cabinet + membre owner + praticien", async () => {
    const { createOffice } = await import("@/lib/services/team");
    const res = await createOffice(deps(), {
      userId: "owner1",
      userName: "Owner",
      name: "Cabinet du Centre",
      slug: "centre",
      address: "1 rue Principale",
    });
    expect(res.officeSlug).toBe("centre");
    expect(res.practitionerSlug).toBe("owner");

    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const members = await db.select().from(s.member).where(eq(s.member.userId, "owner1"));
    expect(members.some((m) => m.officeId === res.officeId && m.role === "owner")).toBe(true);
  });

  it("refuse un slug déjà pris (le format invalide est rejeté par le schéma)", async () => {
    const { createOffice } = await import("@/lib/services/team");
    await expect(
      createOffice(deps(), { userId: "owner1", userName: "Owner", name: "X", slug: "cabinet" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("acceptInvite", () => {
  it("crée membre + praticien quand l'email correspond", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "new1", name: "Nadia", email: "nadia@example.com" }]);
    const inv = await createInvite(deps(), {
      officeId: "o1", email: "nadia@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    const res = await acceptInvite(deps(), {
      token: inv.token, userId: "new1", userEmail: "nadia@example.com", userName: "Nadia",
    });
    expect(res.officeSlug).toBe("cabinet");
    expect(res.practitionerSlug).toBe("nadia");

    const { eq } = await import("drizzle-orm");
    const members = await db.select().from(s.member).where(eq(s.member.userId, "new1"));
    expect(members).toHaveLength(1);
    const pracs = await db.select().from(s.practitioner).where(eq(s.practitioner.userId, "new1"));
    expect(pracs).toHaveLength(1);
  });

  it("refuse si l'email ne correspond pas, si expirée ou déjà acceptée", async () => {
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.insert(s.user).values([{ id: "new2", name: "Zoe", email: "zoe@example.com" }]);
    const inv = await createInvite(deps(), {
      officeId: "o1", email: "nadia@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await expect(
      acceptInvite(deps(), { token: inv.token, userId: "new2", userEmail: "zoe@example.com", userName: "Zoe" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      acceptInvite(deps(), { token: "nope", userId: "new2", userEmail: "zoe@example.com", userName: "Zoe" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Expirée.
    await db.update(s.invite).set({ expiresAt: new Date("2026-09-01T00:00:00Z") }).where(eq(s.invite.id, inv.id));
    await expect(
      acceptInvite({ ...deps(), }, { token: inv.token, userId: "new2", userEmail: "nadia@example.com", userName: "Nadia" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("le slug est dédupliqué (nadia, nadia-2)", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([
      { id: "n1", name: "Nadia", email: "nadia@example.com" },
      { id: "n2", name: "Nadia", email: "nadia2@example.com" },
    ]);
    const i1 = await createInvite(deps(), {
      officeId: "o1", email: "nadia@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    const i2 = await createInvite(deps(), {
      officeId: "o1", email: "nadia2@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    const r1 = await acceptInvite(deps(), { token: i1.token, userId: "n1", userEmail: "nadia@example.com", userName: "Nadia" });
    const r2 = await acceptInvite(deps(), { token: i2.token, userId: "n2", userEmail: "nadia2@example.com", userName: "Nadia" });
    expect(r1.practitionerSlug).toBe("nadia");
    expect(r2.practitionerSlug).toBe("nadia-2");
  });

  it("accepter deux fois est un conflit", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "n3", name: "Noa", email: "noa@example.com" }]);
    const inv = await createInvite(deps(), {
      officeId: "o1", email: "noa@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await acceptInvite(deps(), { token: inv.token, userId: "n3", userEmail: "noa@example.com", userName: "Noa" });
    await expect(
      acceptInvite(deps(), { token: inv.token, userId: "n3", userEmail: "noa@example.com", userName: "Noa" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("listPendingInvites", () => {
  it("le owner voit les invitations en attente", async () => {
    await createInvite(deps(), {
      officeId: "o1", email: "nouveau@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    const { invites } = await listPendingInvites(deps(), { officeId: "o1", requesterUserId: "owner1" });
    expect(invites).toHaveLength(1);
    expect(invites[0].email).toBe("nouveau@example.com");
  });

  it("un non-owner est refusé", async () => {
    await expect(
      listPendingInvites(deps(), { officeId: "o1", requesterUserId: "other" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
