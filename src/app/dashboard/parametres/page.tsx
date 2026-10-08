import * as invitesDal from "@/dal/invites";
import * as membersDal from "@/dal/members";
import * as officesDal from "@/dal/offices";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import { services } from "@/lib/container";
import { getDashboardContext } from "@/lib/dashboard";
import { isSubscriptionEnabled } from "@/lib/env";
import { t } from "@/lib/i18n";
import { Tabs } from "@/components/ui";
import BillingSettings from "@/components/BillingSettings";
import SettingsForm from "./SettingsForm";
import InviteForm from "../equipe/InviteForm";
import MemberRoleSelect from "../equipe/MemberRoleSelect";
import RemoveMemberButton from "../equipe/RemoveMemberButton";
import RoomsManager from "../salles/RoomsManager";

export type SettingsTab = "general" | "team" | "rooms" | "abonnement";

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
  // Onglet Abonnement masqué quand le feature flag est off : toute URL
  // `?tab=abonnement` retombe sur l'onglet général.
  const initial: SettingsTab =
    rawTab === "team" || rawTab === "rooms" || (rawTab === "abonnement" && isSubscriptionEnabled)
      ? rawTab
      : "general";
  const backFromCheckout = sp.abo === "ok" && isSubscriptionEnabled;

  const [office, members, pending, rooms, pracs, billingStatus] = await Promise.all([
    officesDal.getOfficeById(ctx.officeId),
    membersDal.listMembersWithUsers(ctx.officeId),
    invitesDal.listPendingInvites(ctx.officeId),
    roomsDal.listRoomsWithMembers(ctx.officeId),
    practitionersDal.listPractitionersByOffice(ctx.officeId),
    isSubscriptionEnabled
      ? services.billing.getBillingStatus(ctx.userId)
      : Promise.resolve(null),
  ]);
  if (!office) return null;
  // Retour du checkout : re-synchronise le statut depuis Stripe (best-effort).
  const billing =
    backFromCheckout && billingStatus
      ? await services.billing.refreshBillingStatus(ctx.userId).catch(() => billingStatus)
      : billingStatus;

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
          ...(isSubscriptionEnabled
            ? [{ key: "abonnement" as SettingsTab, label: t("settings.tabBilling") }]
            : []),
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
                    {pending.map((invite) => (
                      <li
                        key={invite.id}
                        className="flex flex-wrap gap-2 rounded-2xl border border-line bg-card p-3 text-sm shadow-soft"
                      >
                        <span className="font-medium">{invite.email}</span>
                        <span className="text-mist">{invite.role}</span>
                        <span className="ml-auto text-mist">
                          expire le {new Date(invite.expiresAt).toLocaleDateString("fr-FR")}
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
                  {members.map(({ member: member, user: memberUser }) => (
                    <li
                      key={member.id}
                      className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-card p-3 text-sm shadow-soft"
                    >
                      <span className="font-medium">{memberUser?.name ?? "?"}</span>
                      <span className="text-mist">{memberUser?.email}</span>
                      <MemberRoleSelect
                        officeId={ctx.officeId}
                        memberId={member.id}
                        currentRole={member.role}
                      />
                      {member.userId === ctx.userId ? null : (
                        <RemoveMemberButton
                          officeId={ctx.officeId}
                          memberId={member.id}
                          memberName={memberUser?.name ?? memberUser?.email ?? ""}
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
              initial={rooms.map((room) => ({
                id: room.room.id,
                name: room.room.name,
                color: room.room.color,
                practitionerIds: room.practitionerIds,
              }))}
              practitioners={pracs.map((prac) => ({ id: prac.id, displayName: prac.displayName }))}
            />
          ),
          abonnement: billing ? (
            <div className="flex flex-col gap-4">
              <section>
                <h2 className="mb-1 text-lg font-semibold">{t("settings.tabBilling")}</h2>
                <BillingSettings initialStatus={billing} />
              </section>
            </div>
          ) : null,
        }}
      </Tabs>
    </div>
  );
}
