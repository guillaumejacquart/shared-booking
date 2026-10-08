"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { t } from "@/lib/i18n";

export interface WeeklyDatum {
  label: string;
  honored: number;
  cancelled: number;
}

/**
 * Activité hebdomadaire (Recharts) : barres honorés / annulés avec légende
 * et infobulle au survol. Les libellés sont pré-formatés côté serveur
 * (fuseau du cabinet) ; les couleurs reprennent les badges de statut.
 */
export default function WeeklyChart({ data }: { data: WeeklyDatum[] }) {
  const honoredLabel = `${t("stats.kindHonored")}s`;
  const cancelledLabel = `${t("stats.kindCancelled")}s`;
  return (
    <div className="h-64 w-full" role="img" aria-label={t("stats.weeklyTitle")}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barGap={3}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--mist)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStart"
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--mist)" }}
            axisLine={false}
            tickLine={false}
            width={30}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              borderColor: "var(--line)",
              background: "var(--card)",
              color: "var(--ink)",
              fontSize: 12,
            }}
            labelStyle={{ fontWeight: 600 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="honored" name={honoredLabel} fill="#16a34a" radius={[6, 6, 0, 0]} maxBarSize={20} />
          <Bar dataKey="cancelled" name={cancelledLabel} fill="#f87171" radius={[6, 6, 0, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
