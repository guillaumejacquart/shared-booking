import * as invitesDal from "@/dal/invites";
import * as membersDal from "@/dal/members";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import { getDashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { Tabs } from "@/components/ui";
import SettingsForm from "./SettingsForm";
import InviteForm from "../equipe/InviteForm";
import RemoveMemberButton from "../equipe/RemoveMemberButton";
import RoomsManager from "../salles/RoomsManager";

export type SettingsTab = "general" | "team" | "rooms";

/** Paramètres du cabinet (owner) : général, équipe, salles. */
export default async function ParametresPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getDashboardContext();
  if (ctx.role !== "owner") {
    return <p className="text-sm text-mist">{t("dashboard.forbidden")}</p>;
  }
  const sp = await searchParams;
  const rawTab = typeof sp.tab === "string" ? sp.tab : "general";
  const initial: SettingsTab = rawTab === "team" || rawTab === "rooms" ? rawTab : "general";

  const [office, members, pending, rooms, pracs] = await Promise.all([
    officesDal.getOfficeById(ctx.officeId),
    membersDal.listMembersWithUsers(ctx.officeId),
    invitesDal.listPendingInvites(ctx.officeId),
    roomsDal.listRoomsWithMembers(ctx.officeId),
    practitionersDal.listPractitionersByOffice(ctx.officeId),
  ]);
  if (!office) return null;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t("settings.title")}</h1>
      <Tabs<SettingsTab>
        initial={initial}
        param="tab"
        tabs={[
          { key: "general", label: t("settings.tabGeneral") },
          { key: "team", label: t("settings.tabTeam") },
          { key: "rooms", label: t("settings.tabRooms") },
        ]}
      >
        {{
          general: (
            <SettingsForm
              officeId={ctx.officeId}
              officeSlug={office.slug}
              initial={{
                name: office.name,
                address: office.address,
                enablePractitionerPages: office.enablePractitionerPages,
                enableOfficePage: office.enableOfficePage,
                bookingLeadTimeMin: office.bookingLeadTimeMin,
                cancelDeadlineHours: office.cancelDeadlineHours,
                reminderHoursBefore: office.reminderHoursBefore,
                defaultBufferAfterMin: office.defaultBufferAfterMin,
                themePalette: office.themePalette,
                themeMode: office.themeMode,
              }}
            />
          ),
          team: (
            <div className="flex flex-col gap-8">
              <section>
                <h2 className="mb-3 text-lg font-semibold">{t("team.title")}</h2>
                <InviteForm officeId={ctx.officeId} />
              </section>
              <section>
                <h2 className="mb-2 text-lg font-semibold">
                  {t("team.pending")} ({pending.length})
                </h2>
                {pending.length === 0 ? (
                  <p className="text-sm text-mist">—</p>
                ) : (
                  <ul className="grid gap-2">
                    {pending.map((i) => (
                      <li
                        key={i.id}
                        className="flex flex-wrap gap-2 rounded-2xl border border-line bg-card p-3 text-sm shadow-soft"
                      >
                        <span className="font-medium">{i.email}</span>
                        <span className="text-mist">{i.role}</span>
                        <span className="ml-auto text-mist">
                          expire le {new Date(i.expiresAt).toLocaleDateString("fr-FR")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section>
                <h2 className="mb-2 text-lg font-semibold">
                  {t("team.members")} ({members.length})
                </h2>
                <ul className="grid gap-2">
                  {members.map(({ member: m, user: u }) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-card p-3 text-sm shadow-soft"
                    >
                      <span className="font-medium">{u?.name ?? "?"}</span>
                      <span className="text-mist">{u?.email}</span>
                      <span className="text-mist">{m.role}</span>
                      {m.userId === ctx.userId ? null : (
                        <RemoveMemberButton
                          officeId={ctx.officeId}
                          memberId={m.id}
                          memberName={u?.name ?? u?.email ?? ""}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ),
          rooms: (
            <RoomsManager
              officeId={ctx.officeId}
              initial={rooms.map((r) => ({
                id: r.room.id,
                name: r.room.name,
                color: r.room.color,
                practitionerIds: r.practitionerIds,
              }))}
              practitioners={pracs.map((p) => ({ id: p.id, displayName: p.displayName }))}
            />
          ),
        }}
      </Tabs>
    </div>
  );
}
