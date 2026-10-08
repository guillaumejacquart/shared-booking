"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t } from "@/lib/i18n";
import { sendJson } from "@/lib/api-client";
import { Button, Checkbox, FormMessage, Modal } from "@/components/ui";
import NewSessionTypeForm from "@/components/session-types/NewSessionTypeForm";
import SessionTypeCard from "@/components/session-types/SessionTypeCard";
import type { PublicVariant } from "@/app/api/session-types/variants";
import type { Room, SessionTypeRow } from "@/components/session-types/types";

/**
 * Liste des séances en table compacte ; l'édition et la création se font
 * en modale (qui embarque le formulaire complet : carte actuelle en `bare`).
 */
export default function SessionTypesManager({
  practitionerId,
  initial,
  rooms,
  paymentsReady,
  defaultRequiresValidation = false,
}: {
  practitionerId: string;
  initial: SessionTypeRow[];
  rooms: Room[];
  /** Compte Stripe du praticien prêt à encaisser (`charges_enabled`). */
  paymentsReady: boolean;
  /** Défaut praticien : pré-remplit la case validation des nouvelles séances. */
  defaultRequiresValidation?: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<SessionTypeRow[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Erreurs globales : suppression + création (la sauvegarde en modale
  // affiche son propre retour, puis ferme à la réussite).
  const [error, setError] = useState<string | null>(null);

  const editing = rows.find((row) => row.id === editingId) ?? null;

  function patch(id: string, data: Partial<SessionTypeRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...data } : row)));
  }

  /** Sauvegarde une séance : rejette en cas d'échec (retour affiché par la carte). */
  async function save(row: SessionTypeRow): Promise<void> {
    const url = `/api/session-types/${row.id}?practitionerId=${practitionerId}`;
    const result = await sendJson<{ variants: PublicVariant[] }>(url, "PATCH", { practitionerId, ...row });
    if (!result.ok) throw new Error(result.error);
    // La sauvegarde réconcilie les déclinaisons : on récupère les ids serveurs
    // (sinon une 2e sauvegarde dupliquerait les variantes nouvellement créées).
    patch(row.id, { variants: result.data.variants });
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const result = await sendJson(`/api/session-types/${id}?practitionerId=${practitionerId}`, "DELETE");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows((prev) => prev.filter((row) => row.id !== id));
    if (editingId === id) setEditingId(null);
  }

  /** Bascule Actif depuis la table : sauvegarde immédiate, retour arrière en cas d'échec. */
  async function toggleActive(row: SessionTypeRow, active: boolean) {
    const previous = row.active;
    patch(row.id, { active });
    setError(null);
    try {
      await save({ ...row, active });
    } catch (err) {
      patch(row.id, { active: previous });
      setError(err instanceof Error ? err.message : t("booking.errorGeneric"));
    }
  }

  function onCreated(row: SessionTypeRow) {
    // Mise à jour optimiste : `initial` n'est lu qu'au montage.
    setRows((prev) => [...prev, row]);
    setCreating(false);
    router.refresh();
  }

  function variantLines(row: SessionTypeRow): string[] {
    return row.variants.map((variant) => {
      const raw = variant.priceDisplay?.trim() || "…";
      const price = raw === "…" || raw.endsWith("€") ? raw : `${raw} €`;
      return `${variant.durationMin} min · ${price}`;
    });
  }

  function roomSummary(row: SessionTypeRow): string {
    if (row.compatibleRoomIds.length === 0) return t("sessionTypesAdmin.allRooms");
    return row.compatibleRoomIds
      .map((roomId) => rooms.find((room) => room.id === roomId)?.name ?? "?")
      .join(", ");
  }

  return (
    <div>
      <div className="mb-2">
        <Button size="sm" onClick={() => setCreating(true)}>
          + {t("sessionTypesAdmin.newTitle")}
        </Button>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-mist">
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("sessionTypesAdmin.name")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("sessionTypesAdmin.variants")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("sessionTypesAdmin.compatibleRooms")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("sessionTypesAdmin.options")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("sessionTypesAdmin.status")}
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">{t("sessionTypesAdmin.edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <p className="font-medium">{row.name}</p>
                    {row.description ? (
                      <p className="line-clamp-1 max-w-48 text-xs text-mist">{row.description}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-mist">
                    {variantLines(row).map((line) => (
                      <p key={line} className="whitespace-nowrap">
                        {line}
                      </p>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-mist">{roomSummary(row)}</td>
                  <td className="px-3 py-2 text-xs text-mist">
                    {row.requiresPayment ? <p>{t("sessionTypesAdmin.paymentShort")}</p> : null}
                    {row.requiresValidation ? <p>{t("sessionTypesAdmin.validationShort")}</p> : null}
                    {!row.requiresPayment && !row.requiresValidation ? (
                      <p className="text-faint">—</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={row.active}
                      aria-label={t("sessionTypesAdmin.active")}
                      onChange={(event) => void toggleActive(row, event.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setEditingId(row.id)}>
                      {t("sessionTypesAdmin.edit")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-mist">{t("sessionTypesAdmin.empty")}</p>
      )}
      <div className="mt-2 flex flex-col gap-1">
        <FormMessage tone="error">{error ?? ""}</FormMessage>
      </div>
      <Modal open={editing !== null} onClose={() => setEditingId(null)} title={editing?.name ?? ""}>
        {editing ? (
          <SessionTypeCard
            bare
            row={editing}
            rooms={rooms}
            paymentsReady={paymentsReady}
            onChange={(data) => patch(editing.id, data)}
            onSave={() => save(editing).then(() => setEditingId(null))}
            onDelete={() => void remove(editing.id)}
          />
        ) : null}
      </Modal>
      <Modal open={creating} onClose={() => setCreating(false)} title={t("sessionTypesAdmin.newTitle")}>
        <NewSessionTypeForm
          bare
          practitionerId={practitionerId}
          rooms={rooms}
          paymentsReady={paymentsReady}
          defaultRequiresValidation={defaultRequiresValidation}
          onCreated={onCreated}
          onError={setError}
        />
      </Modal>
    </div>
  );
}
