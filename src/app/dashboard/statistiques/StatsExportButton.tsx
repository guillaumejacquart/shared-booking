"use client";

import { t } from "@/lib/i18n";
import type { StatsRow } from "@/services/stats";

/**
 * Export CSV de exactement ce qui est filtré (lignes déjà chargées pour
 * l'écran, pas de route API supplémentaire). UTF-8 + BOM pour Excel,
 * séparateur `;`. Sans nom/email/téléphone (le nominatif reste dans
 * l'onglet Réservations).
 */

function csvCell(value: string): string {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function kindLabel(kind: StatsRow["kind"]): string {
  if (kind === "honored") return t("stats.kindHonored");
  if (kind === "upcoming") return t("stats.kindUpcoming");
  if (kind === "cancelled") return t("stats.kindCancelled");
  return t("stats.kindPending");
}

export default function StatsExportButton({
  rows,
  timezone,
  fileName,
}: {
  rows: StatsRow[];
  timezone: string;
  fileName: string;
}) {
  const dayFmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  });

  function download(): void {
    const header = [
      "date_seance",
      "heure",
      "seance",
      "duree_min",
      "statut",
      "annule_par",
      "delai_resa_jours",
      "revenant",
      "salle",
      "prix_centimes",
      "devise",
    ].join(";");
    const lines = rows.map((row) => {
      const start = new Date(row.startAt);
      return [
        dayFmt.format(start),
        timeFmt.format(start),
        csvCell(row.sessionName),
        String(row.durationMin),
        csvCell(kindLabel(row.kind)),
        row.cancelledBy ?? "",
        row.leadDays === null ? "" : String(row.leadDays),
        row.isReturning ? t("stats.yes") : t("stats.no"),
        csvCell(row.roomName),
        row.priceCents === null ? "" : String(row.priceCents),
        row.currency ?? "",
      ].join(";");
    });
    const blob = new Blob([`﻿${header}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      disabled={rows.length === 0}
      className="rounded-full border border-line bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-wash disabled:opacity-50"
    >
      {t("stats.export")}
    </button>
  );
}
