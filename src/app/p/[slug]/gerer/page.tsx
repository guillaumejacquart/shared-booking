import { notFound } from "next/navigation";

import { db } from "@/db/client";
import { findBookingByCancelToken } from "@/dal/bookings";
import { formatBookingFr } from "@/lib/email";
import { t } from "@/lib/i18n";
import ManageClient from "./ManageClient";

/** Page de gestion via lien magique (annulation / report patient). */
export default async function ManagePage({
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

  const detail = await findBookingByCancelToken(db, token);
  if (
    !detail ||
    detail.office.slug !== cabinet ||
    detail.practitioner.slug !== slug
  ) {
    notFound();
  }
  const { booking: b, practitioner: prac, office } = detail;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t("manage.title")}</h1>
      {b.status === "cancelled" ? (
        <p className="rounded-2xl border border-zinc-200 p-6 text-center dark:border-zinc-800">
          {t("manage.alreadyCancelled")}
        </p>
      ) : (
        <ManageClient
          data={{
            practitionerName: prac.displayName,
            sessionName: b.sessionNameSnapshot,
            startAt: b.startAt.toISOString(),
            status: b.status,
            sessionTypeId: b.sessionTypeId,
            practitionerSlug: prac.slug,
            rescheduleToken: b.rescheduleToken,
            cancelToken: b.cancelToken,
          }}
          when={formatBookingFr(b.startAt, office.timezone)}
        />
      )}
    </main>
  );
}
