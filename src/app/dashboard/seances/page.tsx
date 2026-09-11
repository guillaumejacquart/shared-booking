import { redirect } from "next/navigation";

export default function SeancesRedirect() {
  redirect("/dashboard/profil?tab=seances");
}
