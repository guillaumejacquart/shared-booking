import { redirect } from "next/navigation";

/** Le calendrier unifié est la page d'arrivée du dashboard. */
export default function DashboardRedirect() {
  redirect("/dashboard/calendrier");
}
