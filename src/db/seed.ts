import "dotenv/config";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { auth } from "@/lib/auth";
import * as s from "@/db/schema";

/**
 * Jeu de démo (miroir du pilote SPEC.md §1) : 1 cabinet, 3 praticiennes,
 * 1 salle partagée + 1 salle exclusive, types de séances et dispos hebdo.
 * Idempotent (relançable). Comptes créés via Better Auth.
 *
 *   SQLITE_PATH=./local.db npm run db:push && npm run db:seed
 */
const PASSWORD = process.env.SEED_PASSWORD ?? "demo-demo-1234";

async function ensureUser(name: string, email: string): Promise<string> {
  const existing = await db
    .select()
    .from(s.user)
    .where(eq(s.user.email, email))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const res = (await auth.api.signUpEmail({
    body: { name, email, password: PASSWORD },
  })) as unknown as { user?: { id: string } };
  if (!res?.user) throw new Error(`signup impossible pour ${email}`);
  return res.user.id;
}

async function put(table: "office" | "room" | "member" | "practitioner" | "roomMember" | "sessionType" | "availabilityRule", row: Record<string, unknown>) {
  const tables = {
    office: s.office,
    room: s.room,
    member: s.member,
    practitioner: s.practitioner,
    roomMember: s.roomMember,
    sessionType: s.sessionType,
    availabilityRule: s.availabilityRule,
  } as const;
  await db
    .insert(tables[table])
    .values(row as never)
    .onConflictDoNothing();
}

async function main() {
  const camille = await ensureUser("Camille", "camille@example.com");
  const karim = await ensureUser("Karim", "karim@example.com");
  const lea = await ensureUser("Léa", "lea@example.com");

  await put("office", {
    id: "demo-office",
    name: "Cabinet des Tilleuls",
    slug: "tilleuls",
    address: "12 rue des Lilas, Lyon",
    enablePractitionerPages: true,
    enableOfficePage: true,
  });

  await put("room", { id: "demo-a", officeId: "demo-office", name: "Salle A", color: "#4e7a5b" });
  await put("room", { id: "demo-cedre", officeId: "demo-office", name: "Salle Cèdre", color: "#96603a" });

  await put("member", { id: "m-cam", officeId: "demo-office", userId: camille, role: "owner" });
  await put("member", { id: "m-kar", officeId: "demo-office", userId: karim, role: "practitioner" });
  await put("member", { id: "m-lea", officeId: "demo-office", userId: lea, role: "practitioner" });

  await put("practitioner", { id: "p-cam", officeId: "demo-office", userId: camille, displayName: "Camille", slug: "camille", bio: "Sophrologie et accompagnement au bien-être." });
  await put("practitioner", { id: "p-kar", officeId: "demo-office", userId: karim, displayName: "Karim", slug: "karim", bio: "Massage bien-être." });
  await put("practitioner", { id: "p-lea", officeId: "demo-office", userId: lea, displayName: "Léa", slug: "lea", bio: "Réflexologie." });

  await put("roomMember", { id: "rm-a-cam", roomId: "demo-a", practitionerId: "p-cam" });
  await put("roomMember", { id: "rm-a-kar", roomId: "demo-a", practitionerId: "p-kar" });
  await put("roomMember", { id: "rm-a-lea", roomId: "demo-a", practitionerId: "p-lea" });
  await put("roomMember", { id: "rm-c-cam", roomId: "demo-cedre", practitionerId: "p-cam" });

  await put("sessionType", { id: "st-cam-1", practitionerId: "p-cam", name: "Première séance", durationMin: 60, bufferAfterMin: 15, priceDisplay: "70 €" });
  await put("sessionType", { id: "st-cam-2", practitionerId: "p-cam", name: "Suivi", durationMin: 45, bufferAfterMin: 10, priceDisplay: "60 €" });
  await put("sessionType", { id: "st-kar-1", practitionerId: "p-kar", name: "Massage bien-être", durationMin: 60, bufferAfterMin: 10, priceDisplay: "65 €" });
  await put("sessionType", { id: "st-lea-1", practitionerId: "p-lea", name: "Découverte", durationMin: 30, bufferAfterMin: 10, priceDisplay: "35 €" });
  await put("sessionType", { id: "st-lea-2", practitionerId: "p-lea", name: "Séance complète", durationMin: 60, bufferAfterMin: 15, priceDisplay: "60 €" });

  await put("availabilityRule", { id: "ar-1", practitionerId: "p-cam", weekday: 1, startTime: "09:00", endTime: "12:00" });
  await put("availabilityRule", { id: "ar-2", practitionerId: "p-cam", weekday: 3, startTime: "09:00", endTime: "12:00" });
  await put("availabilityRule", { id: "ar-3", practitionerId: "p-cam", weekday: 2, startTime: "14:00", endTime: "18:00" });
  await put("availabilityRule", { id: "ar-4", practitionerId: "p-kar", weekday: 1, startTime: "14:00", endTime: "18:00" });
  await put("availabilityRule", { id: "ar-5", practitionerId: "p-kar", weekday: 4, startTime: "09:00", endTime: "12:00" });
  await put("availabilityRule", { id: "ar-6", practitionerId: "p-lea", weekday: 5, startTime: "09:00", endTime: "12:00" });
  await put("availabilityRule", { id: "ar-7", practitionerId: "p-lea", weekday: 6, startTime: "09:00", endTime: "12:00" });

  console.log("✓ Seed démo appliqué (mot de passe : %s)", PASSWORD);
  console.log("  Cabinet : http://localhost:3000/o/tilleuls");
  console.log("  Camille : http://localhost:3000/p/camille");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
