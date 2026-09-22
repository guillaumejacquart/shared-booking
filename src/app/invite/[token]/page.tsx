import Link from "next/link";

import * as invitesDal from "@/dal/invites";
import * as officesDal from "@/dal/offices";
import { getSession } from "@/lib/session";
import { inviteStatus } from "@/lib/invites";
import { t } from "@/lib/i18n";
import AcceptInviteButton from "./AcceptInviteButton";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const inv = await invitesDal.getInviteByToken(token);
  if (!inv) {
    return (
      <main className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <p>{t("invite.invalid")}</p>
      </main>
    );
  }
  const office = await officesDal.getOfficeById(inv.officeId);
  const session = await getSession();
  const status = inviteStatus(inv);

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{office?.name}</h1>
      <p className="mt-2 text-sm text-mist">
        {t("invite.for", { email: inv.email })}
      </p>
      <div className="mt-6">
        {status === "accepted" ? (
          <p>{t("invite.accepted")}</p>
        ) : status === "expired" ? (
          <p>{t("invite.expired")}</p>
        ) : !session ? (
          <div className="flex flex-col gap-2 text-sm">
            <p>{t("invite.loginFirst")}</p>
            <Link className="underline" href={`/login?next=/invite/${token}`}>
              {t("auth.loginButton")}
            </Link>
            <Link className="underline" href={`/signup?next=/invite/${token}`}>
              {t("auth.signupButton")}
            </Link>
          </div>
        ) : session.user.email.toLowerCase() !== inv.email.toLowerCase() ? (
          <p>{t("invite.wrongEmail", { email: session.user.email })}</p>
        ) : (
          <AcceptInviteButton token={token} />
        )}
      </div>
    </main>
  );
}
