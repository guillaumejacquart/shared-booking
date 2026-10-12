import { notFound } from "next/navigation";

import { findBookingByValidateToken } from "@/dal/bookings";
import { formatBookingFr } from "@/lib/email";
import { t } from "@/lib/i18n";
import { parseMode, parsePalette } from "@/lib/theme";
import ValidateClient from "./ValidateClient";

/** Page praticien de validation en un clic (lien magique de l'email de demande). */
export default async function ValidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const cabinet = typeof sp.cabinet === "string" ? sp.cabinet : "";
  if (!token) notFound();

  const detail = await findBookingByValidateToken(token);
  if (
    !detail ||
    detail.office.slug !== cabinet ||
    detail.practitioner.slug !== slug
  ) {
    notFound();
  }
  const { booking, practitioner: prac, office } = detail;
  const pending =
    booking.status === "pending" && booking.validationRequired && !booking.validatedAt;

  return (
    <div
      data-palette={parsePalette(office.themePalette)}
      data-mode={parseMode(office.themeMode)}
      className="flex min-h-full flex-1 flex-col bg-surface text-ink"
    >
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <h1 className="mb-6 text-center text-2xl font-semibold tracking-tight">{t("validate.title")}</h1>
        {!pending ? (
          <p className="rounded-3xl border border-line bg-card p-6 text-center shadow-soft">
            {booking.status === "cancelled"
              ? t("validate.alreadyCancelled")
              : booking.status === "confirmed"
                ? t("validate.alreadyValidated")
                : t("validate.noLongerPending")}
          </p>
        ) : (
          <ValidateClient
            data={{
              practitionerName: prac.displayName,
              sessionName: booking.sessionNameSnapshot,
              startAt: booking.startAt.toISOString(),
              patientName: `${booking.patientFirstName} ${booking.patientLastName}`,
              notes: booking.notes,
              token,
            }}
            when={formatBookingFr(booking.startAt, office.timezone)}
          />
        )}
      </main>
    </div>
  );
}
