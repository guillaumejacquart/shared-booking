/**
 * Limiteur de débit en mémoire (fenêtre glissante par clé).
 * Suffisant en mono-processus (un conteneur sur le VPS) pour freiner le spam
 * de réservations ; à externaliser (Redis/DB) si multi-instances un jour.
 */

const hits = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs = Date.now(),
): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => t > nowMs - windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(nowMs);
  hits.set(key, recent);
  return true;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
