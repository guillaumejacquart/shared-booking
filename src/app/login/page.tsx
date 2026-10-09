import { Suspense } from "react";

import AuthForm from "@/components/AuthForm";
import { isGoogleConfigured } from "@/lib/env";

// Rendu à chaque requête : `isGoogleConfigured` dépend de l'environnement
// runtime du conteneur. En statique, la valeur du build (CI, sans les vars
// Google) serait figée et le bouton SSO n'apparaîtrait jamais en prod.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm mode="login" googleSso={isGoogleConfigured} />
    </Suspense>
  );
}
