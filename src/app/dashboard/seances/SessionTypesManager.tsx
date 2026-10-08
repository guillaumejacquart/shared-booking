"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { sendJson } from "@/lib/api-client";
import { FormMessage } from "@/components/ui";
import NewSessionTypeForm from "@/components/session-types/NewSessionTypeForm";
import SessionTypeCard from "@/components/session-types/SessionTypeCard";
import type { PublicVariant } from "@/app/api/session-types/variants";
import type { Room, SessionTypeRow } from "@/components/session-types/types";

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
  // Erreurs globales : suppression + création (la sauvegarde par carte
  // affiche son propre retour : chargement, confirmation, erreur).
  const [error, setError] = useState<string | null>(null);

  function patch(id: string, data: Partial<SessionTypeRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...data } : row)));
  }

  /** Sauvegarde une carte : rejette en cas d'échec (retour affiché par la carte). */
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
  }

  function onCreated(row: SessionTypeRow) {
    // Mise à jour optimiste : `initial` n'est lu qu'au montage.
    setRows((prev) => [...prev, row]);
    router.refresh();
  }

  return (
    <div>
      <div className="grid gap-2">
        {rows.map((row) => (
          <SessionTypeCard
            key={row.id}
            row={row}
            rooms={rooms}
            paymentsReady={paymentsReady}
            onChange={(data) => patch(row.id, data)}
            onSave={() => save(row)}
            onDelete={() => void remove(row.id)}
          />
        ))}
      </div>
      <NewSessionTypeForm practitionerId={practitionerId} rooms={rooms} paymentsReady={paymentsReady} defaultRequiresValidation={defaultRequiresValidation} onCreated={onCreated} onError={setError} />
      <div className="mt-2 flex flex-col gap-1">
        <FormMessage tone="error">{error ?? ""}</FormMessage>
      </div>
    </div>
  );
}
