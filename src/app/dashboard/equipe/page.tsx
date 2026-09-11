import { redirect } from "next/navigation";

export default function EquipeRedirect() {
  redirect("/dashboard/parametres?tab=team");
}
