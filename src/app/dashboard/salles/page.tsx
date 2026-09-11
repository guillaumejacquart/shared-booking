import { redirect } from "next/navigation";

export default function SallesRedirect() {
  redirect("/dashboard/parametres?tab=rooms");
}
