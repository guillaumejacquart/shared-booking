import { db } from "@/db/client";
import * as store from "@/dal/store";
import { getDashboardContext } from "@/lib/dashboard";
import { dateStrInTz } from "@/lib/timezone";
import { t } from "@/lib/i18n";
import { Tabs } from "@/components/ui";
import ProfileForm from "@/components/ProfileForm";
import SessionTypesManager from "../seances/SessionTypesManager";
import AvailabilityEditor from "../disponibilites/AvailabilityEditor";
import ExceptionsManager from "../disponibilites/ExceptionsManager";
import AvailabilityMonthLoader from "../disponibilites/AvailabilityMonthLoader";

export type ProfilTab = "profil" | "seances" | "disponibilites";

/** Hub praticien : profil public, séances, disponibilités. */
export default async function ProfilPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getDashboardContext();
  const tz = ctx.officeTimezone;
  const sp = await searchParams;
  const rawTab = typeof sp.tab === "string" ? sp.tab : "profil";
  const initial: ProfilTab =
    rawTab === "seances" || rawTab === "disponibilites" ? rawTab : "profil";

  const now = new Date();
  const [prac, types, rules, roomsWithMembers, exceptions] = await Promise.all([
    store.getPractitionerById(db, ctx.practitionerId),
    store.listSessionTypes(db, ctx.practitionerId),
    store.listRules(db, ctx.practitionerId),
    store.listRoomsWithMembers(db, ctx.officeId),
    store.listExceptions(
      db,
      ctx.practitionerId,
      dateStrInTz(new Date(now.getTime() - 30 * 86_400_000), tz),
      dateStrInTz(new Date(now.getTime() + 365 * 86_400_000), tz),
    ),
  ]);
  const rooms = roomsWithMembers
    .filter((r) => r.practitionerIds.length === 0 || r.practitionerIds.includes(ctx.practitionerId))
    .map((r) => ({ id: r.room.id, name: r.room.name }));

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t("dashboard.profile")}</h1>
      <Tabs<ProfilTab>
        initial={initial}
        tabs={[
          { key: "profil", label: t("profile.tabProfile") },
          { key: "seances", label: t("profile.tabSessionTypes") },
          { key: "disponibilites", label: t("profile.tabAvailability") },
        ]}
      >
        {{
          profil: prac ? (
            <ProfileForm
              practitionerId={ctx.practitionerId}
              initial={{
                displayName: prac.displayName,
                slug: prac.slug,
                bio: prac.bio,
                publicContact: prac.publicContact,
              }}
            />
          ) : null,
          seances: (
            <SessionTypesManager
              practitionerId={ctx.practitionerId}
              initial={types.map((s) => ({
                id: s.id,
                name: s.name,
                description: s.description,
                durationMin: s.durationMin,
                bufferAfterMin: s.bufferAfterMin,
                priceDisplay: s.priceDisplay,
                active: s.active,
                requiresPayment: s.requiresPayment,
                priceCents: s.priceCents,
                currency: s.currency,
                requiresValidation: s.requiresValidation,
              }))}
            />
          ),
          disponibilites: (
            <div className="flex flex-col gap-8">
              <section>
                <h2 className="mb-1 text-lg font-semibold">{t("availability.title")}</h2>
                <p className="mb-3 text-sm text-zinc-500">{t("availability.regularHint")}</p>
                <AvailabilityEditor
                  practitionerId={ctx.practitionerId}
                  initial={rules.map((r) => ({
                    key: r.id,
                    weekday: r.weekday,
                    startTime: r.startTime,
                    endTime: r.endTime,
                    roomId: r.roomId,
                  }))}
                  rooms={rooms}
                />
              </section>
              <section>
                <h2 className="mb-3 text-lg font-semibold">{t("availability.calTitle")}</h2>
                <AvailabilityMonthLoader practitionerId={ctx.practitionerId} />
              </section>
              <section>
                <h2 className="mb-3 text-lg font-semibold">{t("availability.exceptions")}</h2>
                <ExceptionsManager
                  practitionerId={ctx.practitionerId}
                  initial={exceptions.map((x) => ({
                    id: x.id,
                    date: x.date,
                    kind: x.kind,
                    startTime: x.startTime,
                    endTime: x.endTime,
                    fullDay: x.fullDay,
                    roomId: x.roomId,
                    reason: x.reason,
                  }))}
                  rooms={rooms}
                />
              </section>
            </div>
          ),
        }}
      </Tabs>
    </div>
  );
}
