import { t } from "@/lib/i18n";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** Appel JSON vers nos routes API ; l'erreur est déjà un message affichable. */
export async function sendJson<T = unknown>(
  url: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
): Promise<ApiResult<T>> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    return { ok: false, status: res.status, error: (json?.error as string) || t("booking.errorGeneric") };
  }
  return { ok: true, data: json as T };
}
