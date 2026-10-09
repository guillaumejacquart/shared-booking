import { Suspense } from "react";

import AuthForm from "@/components/AuthForm";
import { isGoogleConfigured } from "@/lib/env";

export default function SignupPage() {
  return (
    <Suspense>
      <AuthForm mode="signup" googleSso={isGoogleConfigured} />
    </Suspense>
  );
}
