import { Suspense } from "react";

import AuthForm from "@/components/AuthForm";
import { isGoogleConfigured } from "@/lib/env";

// Rendu à chaque requête : `isGoogleConfigured` dépend de l'environnement
// runtime du conteneur (voir login/page.tsx).
export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <Suspense>
      <AuthForm mode="signup" googleSso={isGoogleConfigured} />
    </Suspense>
  );
}
