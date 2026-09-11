import { headers } from "next/headers";

import { auth } from "./auth";

/** Session côté serveur (Route Handlers / Server Components). */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
