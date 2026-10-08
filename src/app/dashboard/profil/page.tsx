import * as availabilityDal from "@/dal/availability";
import * as practitionersDal from "@/dal/practitioners";
import * as roomsDal from "@/dal/rooms";
import * as sessionTypesDal from "@/dal/session-types";
import { services } from "@/lib/container";
import { getDashboardContext } from "@/lib/dashboard";
import { dateStrInTz } from "@/lib/timezone";
import { t } from "@/lib/i18n";
import { Tabs } from "@/components/ui";
import ProfileForm from "@/components/ProfileForm";
import PractitionerSettingsForm from "@/components/PractitionerSettingsForm";
import GoogleAgendaSettings, {
  type GoogleCalendar,
} from "@/components/GoogleAgendaSettings";
import StripeConnectSettings from "@/components/StripeConnectSettings";
import SessionTypesManager from "../seances/SessionTypesManager";
import AvailabilityEditor from "../disponibilites/AvailabilityEditor";
import ExceptionsManager from "../disponibilites/ExceptionsManager";
import AvailabilityMonthLoader from "../disponibilites/AvailabilityMonthLoader";

export type ProfilTab = "profil" | "seances" | "disponibilites" | "google" | "paiements" | "parametres";

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
    rawTab === "seances" || rawTab === "disponibilites" || rawTab === "google" || rawTab === "paiements" || rawTab === "parametres"
      ? rawTab
      : "profil";
  const backFromStripe = sp.stripe === "retour" || sp.stripe === "refresh";

  const now = new Date();
  const [prac, types, rules, roomsWithMembers, exceptions, compatibleRooms, googleStatus, connectStatus] = await Promise.all([
    practitionersDal.getPractitionerById(ctx.practitionerId),
    sessionTypesDal.listSessionTypes(ctx.practitionerId),
    availabilityDal.listRules(ctx.practitionerId),
    roomsDal.listRoomsWithMembers(ctx.officeId),
    availabilityDal.listExceptions(ctx.practitionerId,
      dateStrInTz(new Date(now.getTime() - 30 * 86_400_000), tz),
      dateStrInTz(new Date(now.getTime() + 365 * 86_400_000), tz),),
    sessionTypesDal.listCompatibleRoomsByPractitioner(ctx.practitionerId),
    services.google.getGoogleStatus(ctx.userId),
    services.stripeConnect.getConnectStatus(ctx.userId),
  ]);
  // Retour d'onboarding Stripe : re-synchronise les flags (best-effort).
  const stripeStatus = backFromStripe
    ? await services.stripeConnect.refreshConnectStatus(ctx.userId).catch(() => connectStatus)
    : connectStatus;
  // La liste des agendas exige un appel Google : échec silencieux (le
  // sélecteur retombe sur l'agenda principal, rechargeable côté client).
  const googleCalendars: GoogleCalendar[] = await services.google
    .listGoogleCalendars(ctx.userId)
    .catch(() => []);
  const rooms = roomsWithMembers
    .filter((r) => r.practitionerIds.length === 0 || r.practitionerIds.includes(ctx.practitionerId))
    .sort((a, b) =>
      a.room.sortOrder - b.room.sortOrder ||
      a.room.name.localeCompare(b.room.name) ||
      (a.room.id < b.room.id ? -1 : a.room.id > b.room.id ? 1 : 0))
    .map((r) => ({ id: r.room.id, name: r.room.name }));
  const compatibleByType = new Map<string, string[]>();
  for (const c of compatibleRooms) {
    const list = compatibleByType.get(c.sessionTypeId) ?? [];
    list.push(c.roomId);
    compatibleByType.set(c.sessionTypeId, list);
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">{t("dashboard.profile")}</h1>
      <Tabs<ProfilTab>
        initial={initial}
        param="tab"
        tabs={[
          { key: "profil", label: t("profile.tabProfile") },
          { key: "parametres", label: t("profile.tabSettings") },
          { key: "seances", label: t("profile.tabSessionTypes") },
          { key: "disponibilites", label: t("profile.tabAvailability") },
          { key: "google", label: t("profile.tabGoogle") },
          { key: "paiements", label: t("profile.tabPayments") },
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
              paymentsReady={stripeStatus.ready}
              defaultRequiresValidation={prac?.requiresValidationDefault ?? false}
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
                compatibleRoomIds: compatibleByType.get(s.id) ?? [],
              }))}
              rooms={rooms}
            />
          ),
          disponibilites: (
            <div className="flex flex-col gap-8">
              <section>
                <h2 className="mb-1 text-lg font-semibold">{t("availability.title")}</h2>
                <p className="mb-3 text-sm text-mist">{t("availability.regularHint")}</p>
                <AvailabilityEditor
                  practitionerId={ctx.practitionerId}
                  initial={rules.map((r) => ({
                    key: r.id,
                    weekday: r.weekday,
                    startTime: r.startTime,
                    endTime: r.endTime,
                  }))}
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
          google: (
            <div className="flex flex-col gap-4">
              <section>
                <h2 className="mb-1 text-lg font-semibold">{t("profile.tabGoogle")}</h2>
                <p className="mb-3 text-sm text-mist">{t("google.connectHint")}</p>
                <GoogleAgendaSettings
                  initialStatus={googleStatus}
                  initialCalendars={googleCalendars}
                />
              </section>
            </div>
          ),
          paiements: (
            <div className="flex flex-col gap-4">
              <section>
                <h2 className="mb-1 text-lg font-semibold">{t("profile.tabPayments")}</h2>
                <StripeConnectSettings initialStatus={stripeStatus} />
              </section>
            </div>
          ),
          parametres: prac ? (
            <PractitionerSettingsForm
              practitionerId={ctx.practitionerId}
              initial={{
                slotStepMin: prac.slotStepMin ?? 15,
                requiresValidationDefault: prac.requiresValidationDefault ?? false,
              }}
            />
          ) : null,
        }}
      </Tabs>
    </div>
  );
}
