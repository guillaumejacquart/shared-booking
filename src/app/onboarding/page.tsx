import { redirect } from "next/navigation";

import { db } from "@/db/client";
import * as membersDal from "@/dal/members";
import { getSession } from "@/lib/session";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const memberships = await membersDal.listMemberships(db, session.user.id);
  if (memberships.length > 0) redirect("/dashboard");
  return <OnboardingForm userName={session.user.name} />;
}
