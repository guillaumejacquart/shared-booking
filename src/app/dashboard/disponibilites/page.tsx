import { redirect } from "next/navigation";

export default function DisponibilitesRedirect() {
  redirect("/dashboard/profil?tab=disponibilites");
}
