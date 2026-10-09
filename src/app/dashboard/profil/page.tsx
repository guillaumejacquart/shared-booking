import * as availabilityDal from "@/dal/availability";
import * as officesDal from "@/dal/offices";
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
import OnsitePaymentSettings from "@/components/OnsitePaymentSettings";
import { parseOnsitePaymentMethods } from "@/lib/onsite-payments";
import GoogleAgendaSettings, {
  type GoogleCalendar,
} from "@/components/GoogleAgendaSettings";
import ApiTokensSettings from "@/components/ApiTokensSettings";
import { sortRooms } from "@/services/room-order";
import RoomsMissingAlert from "@/components/RoomsMissingAlert";
import StripeConnectSettings from "@/components/StripeConnectSettings";
import SessionTypesManager from "../seances/SessionTypesManager";
import AvailabilityEditor from "../disponibilites/AvailabilityEditor";
import ExceptionsManager from "../disponibilites/ExceptionsManager";
import AvailabilityMonthLoader from "../disponibilites/AvailabilityMonthLoader";

export type ProfilTab = "profil" | "seances" | "disponibilites" | "google" | "api" | "paiements" | "parametres";

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
    rawTab === "seances" || rawTab === "disponibilites" || rawTab === "google" || rawTab === "api" || rawTab === "paiements" || rawTab === "parametres"
      ? rawTab
      : "profil";
  const backFromStripe = sp.stripe === "retour" || sp.stripe === "refresh";
  // Échec OAuth Standard : message transmis par le callback (texte brut,
  // affiché tel quel par le composant — jamais interprété comme HTML),
  // ou message générique si l'accès a été refusé côté Stripe.
  const stripeOAuthError =
    sp.stripe === "erreur"
      ? (typeof sp.msg === "string" && sp.msg.length > 0
        ? sp.msg.slice(0, 300)
        : t("stripeConnect.oauthDenied"))
      : null;

  const now = new Date();
  const [prac, office, types, variants, rules, roomsWithMembers, exceptions, compatibleRooms, googleStatus, connectStatus, apiTokens] = await Promise.all([
    practitionersDal.getPractitionerById(ctx.practitionerId),
    officesDal.getOfficeById(ctx.officeId),
    sessionTypesDal.listSessionTypes(ctx.practitionerId),
    sessionTypesDal.listVariantsByPractitioner(ctx.practitionerId),
    availabilityDal.listRules(ctx.practitionerId),
    roomsDal.listRoomsWithMembers(ctx.officeId),
    availabilityDal.listExceptions(ctx.practitionerId,
      dateStrInTz(new Date(now.getTime() - 30 * 86_400_000), tz),
      dateStrInTz(new Date(now.getTime() + 365 * 86_400_000), tz),),
    sessionTypesDal.listCompatibleRoomsByPractitioner(ctx.practitionerId),
    services.google.getGoogleStatus(ctx.userId),
    services.stripeConnect.getConnectStatus(ctx.userId),
    services.apiTokens.list({ requesterUserId: ctx.userId }),
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
  const rooms = sortRooms(
    roomsWithMembers.filter(
      (entry) => entry.practitionerIds.length === 0 || entry.practitionerIds.includes(ctx.practitionerId),
    ),
  ).map((entry) => ({ id: entry.room.id, name: entry.room.name }));
  const compatibleByType = new Map<string, string[]>();
  for (const compat of compatibleRooms) {
    const list = compatibleByType.get(compat.sessionTypeId) ?? [];
    list.push(compat.roomId);
    compatibleByType.set(compat.sessionTypeId, list);
  }
  const variantsByType = new Map<string, typeof variants[number]["variant"][]>();
  for (const { sessionTypeId, variant } of variants) {
    const list = variantsByType.get(sessionTypeId) ?? [];
    list.push(variant);
    variantsByType.set(sessionTypeId, list);
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
          { key: "api", label: t("profile.tabApi") },
          { key: "paiements", label: t("profile.tabPayments") },
        ]}
      >
        {{
          profil: prac ? (
            <ProfileForm
              practitionerId={ctx.practitionerId}
              officeSlug={ctx.officeSlug}
              officePageEnabled={office?.enableOfficePage ?? false}
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
              initial={types.map((sessionType) => ({
                id: sessionType.id,
                name: sessionType.name,
                description: sessionType.description,
                active: sessionType.active,
                requiresPayment: sessionType.requiresPayment,
                currency: sessionType.currency,
                requiresValidation: sessionType.requiresValidation,
                variants: (variantsByType.get(sessionType.id) ?? []).map((variant) => ({
                  id: variant.id,
                  durationMin: variant.durationMin,
                  bufferAfterMin: variant.bufferAfterMin,
                  priceDisplay: variant.priceDisplay,
                  priceCents: variant.priceCents,
                })),
                compatibleRoomIds: compatibleByType.get(sessionType.id) ?? [],
              }))}
              rooms={rooms}
            />
          ),
          disponibilites: (
            <div className="flex flex-col gap-8">
              <section>
                <h2 className="mb-1 text-lg font-semibold">{t("availability.title")}</h2>
                <p className="mb-3 text-sm text-mist">{t("availability.regularHint")}</p>
                {rooms.length === 0 && roomsWithMembers.length > 0 ? (
                  <div className="mb-3">
                    <RoomsMissingAlert variant="unassigned" isOwner={ctx.role === "owner"} />
                  </div>
                ) : null}
                <AvailabilityEditor
                  practitionerId={ctx.practitionerId}
                  initial={rules.map((rule) => ({
                    key: rule.id,
                    weekday: rule.weekday,
                    startTime: rule.startTime,
                    endTime: rule.endTime,
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
                  initial={exceptions.map((exception) => ({
                    id: exception.id,
                    date: exception.date,
                    kind: exception.kind,
                    startTime: exception.startTime,
                    endTime: exception.endTime,
                    fullDay: exception.fullDay,
                    roomId: exception.roomId,
                    reason: exception.reason,
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
                <GoogleAgendaSettings
                  initialStatus={googleStatus}
                  initialCalendars={googleCalendars}
                />
              </section>
            </div>
          ),
          api: (
            <div className="flex flex-col gap-4">
              <section>
                <h2 className="mb-1 text-lg font-semibold">{t("profile.tabApi")}</h2>
                <ApiTokensSettings initial={apiTokens} />
              </section>
            </div>
          ),
          paiements: prac ? (
            <div className="flex flex-col gap-8">
              <section>
                <h2 className="mb-1 text-lg font-semibold">{t("stripeConnect.title")}</h2>
                <StripeConnectSettings initialStatus={stripeStatus} oauthError={stripeOAuthError} />
              </section>
              <section>
                <h2 className="mb-1 text-lg font-semibold">{t("onsite.title")}</h2>
                <OnsitePaymentSettings
                  practitionerId={ctx.practitionerId}
                  initial={{
                    methods: parseOnsitePaymentMethods(prac.onsitePaymentMethods),
                    note: prac.onsitePaymentNote,
                  }}
                />
              </section>
            </div>
          ) : null,
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
