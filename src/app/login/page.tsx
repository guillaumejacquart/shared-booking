import { Suspense } from "react";

import AuthForm from "@/components/AuthForm";
import { isGoogleConfigured } from "@/lib/env";

export default function LoginPage() {
  return (
    <Suspense>
      <AuthForm mode="login" googleSso={isGoogleConfigured} />
    </Suspense>
  );
}
