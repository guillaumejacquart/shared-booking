import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDb } from "@/test/memory-db";
import { setConnection } from "@/dal/connection";
import type { Db } from "@/dal/types";
import { acceptInvite, changeMemberRole, createInvite, listPendingInvites, removeMember, revokeInvite, selectOffice } from "@/services/team";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/services/errors";
import type { OutgoingEmail } from "@/lib/email";
import { ANALYTICS_EVENTS, type AnalyticsData, type AnalyticsEventName } from "@/lib/analytics";
import { fixedClock } from "@/lib/ports";
import { testPorts } from "@/test/ports";

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
  db = createMemoryDb();  setConnection(db);
  sent = [];
  await seed();
});

function ports() {
  return testPorts({ clock: fixedClock(NOW), sendEmail: async (email: OutgoingEmail) => void sent.push(email) });
}

describe("createInvite", () => {
  it("le owner invite par email et l'invitation est envoyée", async () => {
    const inv = await createInvite(ports(), {
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
      createInvite(ports(), {
        officeId: "o1",
        email: "x@example.com",
        role: "practitioner",
        requesterUserId: "other",
        origin: "http://localhost:3000",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("réinviter un membre actif est refusé", async () => {
    await expect(
      createInvite(ports(), {
        officeId: "o1",
        email: "other@example.com",
        role: "practitioner",
        requesterUserId: "owner1",
        origin: "http://localhost:3000",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

});

describe("createOffice", () => {
  it("crée cabinet + membre owner + praticien", async () => {
    const { createOffice } = await import("@/services/team");
    const res = await createOffice(ports(), {
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
    const { createOffice } = await import("@/services/team");
    await expect(
      createOffice(ports(), { userId: "owner1", userName: "Owner", name: "X", slug: "cabinet" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("acceptInvite", () => {
  it("crée membre + praticien quand l'email correspond", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "new1", name: "Nadia", email: "nadia@example.com" }]);
    const inv = await createInvite(ports(), {
      officeId: "o1", email: "nadia@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    const res = await acceptInvite(ports(), {
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
    const inv = await createInvite(ports(), {
      officeId: "o1", email: "nadia@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await expect(
      acceptInvite(ports(), { token: inv.token, userId: "new2", userEmail: "zoe@example.com", userName: "Zoe" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      acceptInvite(ports(), { token: "nope", userId: "new2", userEmail: "zoe@example.com", userName: "Zoe" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Expirée.
    await db.update(s.invite).set({ expiresAt: new Date("2026-09-01T00:00:00Z") }).where(eq(s.invite.id, inv.id));
    await expect(
      acceptInvite({ ...ports(), }, { token: inv.token, userId: "new2", userEmail: "nadia@example.com", userName: "Nadia" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("le slug est dédupliqué (nadia, nadia-2)", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([
      { id: "n1", name: "Nadia", email: "nadia@example.com" },
      { id: "n2", name: "Nadia", email: "nadia2@example.com" },
    ]);
    const i1 = await createInvite(ports(), {
      officeId: "o1", email: "nadia@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    const i2 = await createInvite(ports(), {
      officeId: "o1", email: "nadia2@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    const r1 = await acceptInvite(ports(), { token: i1.token, userId: "n1", userEmail: "nadia@example.com", userName: "Nadia" });
    const r2 = await acceptInvite(ports(), { token: i2.token, userId: "n2", userEmail: "nadia2@example.com", userName: "Nadia" });
    expect(r1.practitionerSlug).toBe("nadia");
    expect(r2.practitionerSlug).toBe("nadia-2");
  });

  it("accepter deux fois est un conflit", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "n3", name: "Noa", email: "noa@example.com" }]);
    const inv = await createInvite(ports(), {
      officeId: "o1", email: "noa@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await acceptInvite(ports(), { token: inv.token, userId: "n3", userEmail: "noa@example.com", userName: "Noa" });
    await expect(
      acceptInvite(ports(), { token: inv.token, userId: "n3", userEmail: "noa@example.com", userName: "Noa" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("invitations multi-cabinet", () => {
  async function seedSecondOffice() {
    const s = await import("@/db/schema");
    await db.insert(s.office).values({ id: "o2", name: "Vernoux", slug: "vernoux" });
    await db.insert(s.member).values([{ id: "m9", officeId: "o2", userId: "other", role: "owner" }]);
    // `owner1` a déjà un profil praticien dans son propre cabinet (o1).
    await db.insert(s.practitioner).values({
      id: "p-own",
      officeId: "o1",
      userId: "owner1",
      displayName: "Owner",
      slug: "owner",
    });
  }

  it("un utilisateur déjà praticien ailleurs peut accepter une invitation", async () => {
    await seedSecondOffice();
    const inv = await createInvite(ports(), {
      officeId: "o2", email: "owner@example.com", role: "practitioner",
      requesterUserId: "other", origin: "http://localhost:3000",
    });
    const res = await acceptInvite(ports(), {
      token: inv.token, userId: "owner1", userEmail: "owner@example.com", userName: "Owner",
    });
    expect(res.officeSlug).toBe("vernoux");

    const s = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");
    const members = await db
      .select()
      .from(s.member)
      .where(and(eq(s.member.officeId, "o2"), eq(s.member.userId, "owner1")));
    expect(members).toHaveLength(1);
    const pracs = await db
      .select()
      .from(s.practitioner)
      .where(and(eq(s.practitioner.officeId, "o2"), eq(s.practitioner.userId, "owner1")));
    expect(pracs).toHaveLength(1);
    expect(pracs[0].slug).toBe("owner-2"); // slug global déjà pris dans o1
  });

  it("réinviter un membre retiré puis accepter réactive le profil", async () => {
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await db.insert(s.user).values([{ id: "back1", name: "Bea", email: "bea@example.com" }]);
    const first = await createInvite(ports(), {
      officeId: "o1", email: "bea@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await acceptInvite(ports(), {
      token: first.token, userId: "back1", userEmail: "bea@example.com", userName: "Bea",
    });
    const memberId = (await db.select().from(s.member).where(eq(s.member.userId, "back1")))[0].id;
    const pracId = (await db.select().from(s.practitioner).where(eq(s.practitioner.userId, "back1")))[0].id;
    await removeMember({ officeId: "o1", memberId, requesterUserId: "owner1" });

    // Réinvitation autorisée malgré l'historique inactif…
    const second = await createInvite(ports(), {
      officeId: "o1", email: "bea@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    // …et l'acceptation réactive les mêmes lignes (pas de doublons).
    await acceptInvite(ports(), {
      token: second.token, userId: "back1", userEmail: "bea@example.com", userName: "Bea",
    });
    const members = await db.select().from(s.member).where(eq(s.member.userId, "back1"));
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe(memberId);
    expect(members[0].active).toBe(true);
    const pracs = await db.select().from(s.practitioner).where(eq(s.practitioner.userId, "back1"));
    expect(pracs).toHaveLength(1);
    expect(pracs[0].id).toBe(pracId);
    expect(pracs[0].active).toBe(true);
    const { invites } = await listPendingInvites({ officeId: "o1", requesterUserId: "owner1" });
    expect(invites).toHaveLength(0);
  });
});

describe("selectOffice", () => {
  async function seedTwoOffices() {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "dual", name: "Dual", email: "dual@example.com" }]);
    await db.insert(s.office).values([
      { id: "oA", name: "Cabinet A", slug: "cab-a" },
      { id: "oB", name: "Cabinet B", slug: "cab-b" },
    ]);
    await db.insert(s.member).values([
      { id: "mA", officeId: "oA", userId: "dual", role: "owner", createdAt: new Date("2026-01-01T00:00:00Z") },
      { id: "mB", officeId: "oB", userId: "dual", role: "practitioner", createdAt: new Date("2026-02-01T00:00:00Z") },
    ]);
    await db.insert(s.practitioner).values([
      { id: "pA", officeId: "oA", userId: "dual", displayName: "Dual", slug: "dual" },
      { id: "pB", officeId: "oB", userId: "dual", displayName: "Dual", slug: "dual-2" },
    ]);
  }

  it("mémorise le cabinet courant et la résolution praticien suit", async () => {
    await seedTwoOffices();
    const { getPrimaryPractitionerByUserId } = await import("@/dal/practitioners");
    const { getSelectedOfficeId } = await import("@/dal/users");
    // Défaut : premier cabinet d'appartenance.
    expect((await getPrimaryPractitionerByUserId("dual"))?.id).toBe("pA");
    const result = await selectOffice({ officeId: "oB", requesterUserId: "dual" });
    expect(result).toEqual({ officeId: "oB" });
    expect(await getSelectedOfficeId("dual")).toBe("oB");
    expect((await getPrimaryPractitionerByUserId("dual"))?.id).toBe("pB");
    // Retour au premier cabinet.
    await selectOffice({ officeId: "oA", requesterUserId: "dual" });
    expect((await getPrimaryPractitionerByUserId("dual"))?.id).toBe("pA");
  });

  it("refuse un cabinet sans appartenance active", async () => {
    await seedTwoOffices();
    // `other` n'est pas membre de oA ; `dual` n'est membre d'aucun cabinet `nope`.
    await expect(
      selectOffice({ officeId: "oA", requesterUserId: "other" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      selectOffice({ officeId: "nope", requesterUserId: "dual" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("accepter une invitation sélectionne le cabinet rejoint", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "joiner", name: "Nadia", email: "nadia@example.com" }]);
    const inv = await createInvite(ports(), {
      officeId: "o1", email: "nadia@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await acceptInvite(ports(), {
      token: inv.token, userId: "joiner", userEmail: "nadia@example.com", userName: "Nadia",
    });
    const { getSelectedOfficeId } = await import("@/dal/users");
    expect(await getSelectedOfficeId("joiner")).toBe("o1");
  });

  it("créer un cabinet le sélectionne", async () => {
    const { createOffice } = await import("@/services/team");
    const created = await createOffice(ports(), {
      userId: "owner1", userName: "Owner", name: "Second", slug: "second",
    });
    const { getSelectedOfficeId } = await import("@/dal/users");
    expect(await getSelectedOfficeId("owner1")).toBe(created.officeId);
  });
});

describe("analytics (Umami)", () => {
  it("office-created, invite-sent puis invite-accepted", async () => {
    const tracked: { event: AnalyticsEventName; data?: AnalyticsData }[] = [];
    const watched = () => testPorts({
      clock: fixedClock(NOW),
      sendEmail: async (email: OutgoingEmail) => void sent.push(email),
      analytics: { track: async (event, data) => void tracked.push({ event, data }) },
    });
    const { createOffice } = await import("@/services/team");
    await createOffice(watched(), {
      userId: "owner1", userName: "Owner", name: "Cabinet", slug: "nouveau",
    });
    const inv = await createInvite(watched(), {
      officeId: "o1", email: "nadia@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "new1", name: "Nadia", email: "nadia@example.com" }]);
    await acceptInvite(watched(), {
      token: inv.token, userId: "new1", userEmail: "nadia@example.com", userName: "Nadia",
    });
    expect(tracked.map((entry) => entry.event)).toEqual([
      ANALYTICS_EVENTS.OFFICE_CREATED,
      ANALYTICS_EVENTS.INVITE_SENT,
      ANALYTICS_EVENTS.INVITE_ACCEPTED,
    ]);
    expect(tracked[1].data).toMatchObject({ role: "practitioner" });
    expect(tracked[2].data).toMatchObject({ role: "practitioner" });
  });
});

describe("listPendingInvites", () => {
  it("le owner voit les invitations en attente", async () => {
    await createInvite(ports(), {
      officeId: "o1", email: "nouveau@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    const { invites } = await listPendingInvites({ officeId: "o1", requesterUserId: "owner1" });
    expect(invites).toHaveLength(1);
    expect(invites[0].email).toBe("nouveau@example.com");
  });

  it("un non-owner est refusé", async () => {
    await expect(
      listPendingInvites({ officeId: "o1", requesterUserId: "other" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("revokeInvite", () => {
  it("le owner annule une invitation en attente : le lien devient invalide", async () => {
    const created = await createInvite(ports(), {
      officeId: "o1", email: "revoque@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await revokeInvite({ officeId: "o1", inviteId: created.id, requesterUserId: "owner1" });

    const { invites } = await listPendingInvites({ officeId: "o1", requesterUserId: "owner1" });
    expect(invites).toHaveLength(0);
    await expect(
      acceptInvite(ports(), {
        token: created.token, userId: "other", userEmail: "revoque@example.com", userName: "Autre",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("un non-owner ne peut pas annuler une invitation", async () => {
    const created = await createInvite(ports(), {
      officeId: "o1", email: "revoque@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await expect(
      revokeInvite({ officeId: "o1", inviteId: created.id, requesterUserId: "other" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("404 sur invitation inconnue ou d'un autre cabinet", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.office).values({ id: "o2", name: "Autre", slug: "autre" });
    await db.insert(s.member).values([{ id: "m9", officeId: "o2", userId: "owner1", role: "owner" }]);
    const created = await createInvite(ports(), {
      officeId: "o1", email: "revoque@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await expect(
      revokeInvite({ officeId: "o1", inviteId: "nope", requesterUserId: "owner1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      revokeInvite({ officeId: "o2", inviteId: created.id, requesterUserId: "owner1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuse d'annuler une invitation déjà acceptée", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "new9", name: "Noa", email: "noa@example.com" }]);
    const created = await createInvite(ports(), {
      officeId: "o1", email: "noa@example.com", role: "practitioner",
      requesterUserId: "owner1", origin: "http://localhost:3000",
    });
    await acceptInvite(ports(), {
      token: created.token, userId: "new9", userEmail: "noa@example.com", userName: "Noa",
    });
    await expect(
      revokeInvite({ officeId: "o1", inviteId: created.id, requesterUserId: "owner1" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("removeMember", () => {
  async function seedPractitioner() {
    const s = await import("@/db/schema");
    await db.insert(s.practitioner).values({
      id: "p-other",
      officeId: "o1",
      userId: "other",
      displayName: "Other",
      slug: "other",
    });
    await db.insert(s.room).values({ id: "room-a", officeId: "o1", name: "Salle A", allowAll: false });
    await db.insert(s.roomMember).values({
      id: "rm-a",
      roomId: "room-a",
      practitionerId: "p-other",
    });
  }

  it("le owner retire un praticien : appartenance + praticien désactivés", async () => {
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    await seedPractitioner();

    await removeMember({ officeId: "o1", memberId: "m2", requesterUserId: "owner1" });

    const m = await db.select().from(s.member).where(eq(s.member.id, "m2"));
    expect(m[0].active).toBe(false);
    const p = await db.select().from(s.practitioner).where(eq(s.practitioner.id, "p-other"));
    expect(p[0].active).toBe(false);
    const rm = await db
      .select()
      .from(s.roomMember)
      .where(eq(s.roomMember.practitionerId, "p-other"));
    expect(rm).toHaveLength(0);
  });

  it("est idempotent (retirer deux fois)", async () => {
    await seedPractitioner();
    await removeMember({ officeId: "o1", memberId: "m2", requesterUserId: "owner1" });
    await expect(
      removeMember({ officeId: "o1", memberId: "m2", requesterUserId: "owner1" }),
    ).resolves.toBeUndefined();
  });

  it("un non-owner ne peut pas retirer un membre", async () => {
    await expect(
      removeMember({ officeId: "o1", memberId: "m1", requesterUserId: "other" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("un owner ne peut pas se retirer lui-même", async () => {
    await expect(
      removeMember({ officeId: "o1", memberId: "m1", requesterUserId: "owner1" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("404 sur membre inconnu", async () => {
    await expect(
      removeMember({ officeId: "o1", memberId: "nope", requesterUserId: "owner1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("changeMemberRole", () => {
  async function roleOf(memberId: string) {
    const s = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const rows = await db.select().from(s.member).where(eq(s.member.id, memberId));
    return rows[0]?.role;
  }

  it("le owner promeut un praticien en responsable", async () => {
    await changeMemberRole({ officeId: "o1", memberId: "m2", requesterUserId: "owner1", role: "owner" });
    expect(await roleOf("m2")).toBe("owner");
  });

  it("le owner rétrograde un responsable quand un autre reste", async () => {
    const s = await import("@/db/schema");
    await db.insert(s.user).values([{ id: "owner2", name: "Second", email: "second@example.com" }]);
    await db.insert(s.member).values([{ id: "m3", officeId: "o1", userId: "owner2", role: "owner" }]);
    await changeMemberRole({ officeId: "o1", memberId: "m3", requesterUserId: "owner1", role: "practitioner" });
    expect(await roleOf("m3")).toBe("practitioner");
  });

  it("refuse de rétrograder le dernier responsable", async () => {
    await expect(
      changeMemberRole({ officeId: "o1", memberId: "m1", requesterUserId: "owner1", role: "practitioner" }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await roleOf("m1")).toBe("owner");
  });

  it("est idempotent (même rôle)", async () => {
    await expect(
      changeMemberRole({ officeId: "o1", memberId: "m2", requesterUserId: "owner1", role: "practitioner" }),
    ).resolves.toBeUndefined();
  });

  it("un non-owner ne peut pas changer un rôle", async () => {
    await expect(
      changeMemberRole({ officeId: "o1", memberId: "m2", requesterUserId: "other", role: "owner" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("404 sur membre inconnu ou d'un autre cabinet", async () => {
    await expect(
      changeMemberRole({ officeId: "o1", memberId: "nope", requesterUserId: "owner1", role: "owner" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
