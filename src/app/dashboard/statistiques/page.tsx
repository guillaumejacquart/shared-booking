import { services } from "@/lib/container";
import { getDashboardContext } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { dateStrInTz, tzOffsetMs } from "@/lib/timezone";
import { statsFileName } from "@/lib/stats-export";
import { Badge, Card } from "@/components/ui";
import StatsExportButton from "./StatsExportButton";
import type { StatsStatusFilter } from "@/services/stats";

/**
 * Statistiques du praticien connecté : KPIs, activité par semaine, mix des
 * séances, recettes estimées et détail exportable en CSV. Filtres partagés
 * par toute la page via les searchParams (période sur la date de séance).
 */

const DAY_MS = 86_400_000;
const DEFAULT_RANGE = "90";

function addDays(day: string, delta: number): string {
  const [year, month, dayNum] = day.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, dayNum + delta, 12));
  return shifted.toISOString().slice(0, 10);
}

/** Début de journée murale (fuseau cabinet) en instant UTC. */
function dayStartUtc(day: string, timezone: string): Date {
  const offset = tzOffsetMs(timezone, new Date(`${day}T12:00:00Z`));
  return new Date(Date.parse(`${day}T00:00:00Z`) - offset);
}

function isDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function parseStatus(value: unknown): StatsStatusFilter {
  return value === "honored" || value === "upcoming" || value === "cancelled" ? value : "all";
}

function formatDay(day: string, timezone: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

function formatPrice(cents: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: (currency ?? "eur").toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${(currency ?? "").toUpperCase()}`.trim();
  }
}

export default async function StatistiquesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await getDashboardContext();
  const timezone = ctx.officeTimezone;
  const params = await searchParams;

  const today = dateStrInTz(new Date(), timezone);
  const rawRange = typeof params.range === "string" ? params.range : DEFAULT_RANGE;
  const range = ["30", "90", "365", "year", "custom"].includes(rawRange) ? rawRange : DEFAULT_RANGE;

  let fromDay = addDays(today, -89);
  let toDayExclusive = addDays(today, 1);
  if (range === "30") {
    fromDay = addDays(today, -29);
  } else if (range === "365") {
    fromDay = addDays(today, -364);
  } else if (range === "year") {
    fromDay = `${today.slice(0, 4)}-01-01`;
  } else if (range === "custom" && isDay(params.from) && isDay(params.to) && params.from < params.to) {
    const customDays = Math.round((Date.parse(params.to) - Date.parse(params.from)) / DAY_MS);
    if (customDays <= 370) {
      fromDay = params.from;
      toDayExclusive = params.to;
    }
  }
  const status = parseStatus(params.status);
  const sessionTypeId = typeof params.sessionTypeId === "string" && params.sessionTypeId !== "" ? params.sessionTypeId : undefined;
  const roomId = typeof params.roomId === "string" && params.roomId !== "" ? params.roomId : undefined;

  const stats = await services.stats.getStats({
    userId: ctx.userId,
    from: dayStartUtc(fromDay, timezone),
    to: dayStartUtc(toDayExclusive, timezone),
    status,
    sessionTypeId,
    roomId,
  });

  const dayFmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, hour: "2-digit", minute: "2-digit" });
  const weekMax = Math.max(1, ...stats.weekly.map((week) => week.honored + week.cancelled));
  const detailCount = stats.rows.length;
  const scope = t("stats.scope", {
    count: detailCount,
    from: formatDay(fromDay, timezone),
    to: formatDay(addDays(toDayExclusive, -1), timezone),
  });
  const unknownBy = stats.kpis.cancelled - stats.kpis.cancelledByPatient - stats.kpis.cancelledByPractitioner;

  const selectStyles = "rounded-xl border border-line bg-card px-2 py-1.5 text-sm";
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">{t("stats.title")}</h1>
          <p className="text-sm text-mist">{scope}</p>
        </div>
        <StatsExportButton rows={stats.rows} timezone={timezone} fileName={statsFileName(fromDay, addDays(toDayExclusive, -1))} />
      </div>

      <Card title={t("stats.period")}>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t("stats.period")}
            <select name="range" defaultValue={range} className={selectStyles}>
              <option value="30">{t("stats.range30")}</option>
              <option value="90">{t("stats.range90")}</option>
              <option value="365">{t("stats.range365")}</option>
              <option value="year">{t("stats.rangeYear")}</option>
              <option value="custom">{t("stats.rangeCustom")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("stats.from")}
            <input type="date" name="from" defaultValue={fromDay} className={selectStyles} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("stats.to")}
            <input type="date" name="to" defaultValue={addDays(toDayExclusive, -1)} className={selectStyles} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("stats.status")}
            <select name="status" defaultValue={status} className={selectStyles}>
              <option value="all">{t("stats.statusAll")}</option>
              <option value="honored">{t("stats.statusHonored")}</option>
              <option value="upcoming">{t("stats.statusUpcoming")}</option>
              <option value="cancelled">{t("stats.statusCancelled")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("stats.session")}
            <select name="sessionTypeId" defaultValue={sessionTypeId ?? ""} className={selectStyles}>
              <option value="">{t("stats.allSessions")}</option>
              {stats.options.sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))}
            </select>
          </label>
          {stats.options.rooms.length > 1 ? (
            <label className="flex flex-col gap-1 text-sm">
              {t("stats.room")}
              <select name="roomId" defaultValue={roomId ?? ""} className={selectStyles}>
                <option value="">{t("stats.allRooms")}</option>
                {stats.options.rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="submit" className="rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-ink">
            {t("stats.apply")}
          </button>
        </form>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi title={t("stats.honored")} value={String(stats.kpis.honored)} tone="green" />
        <Kpi title={t("stats.upcoming")} value={String(stats.kpis.upcoming)} tone="amber" />
        <Kpi
          title={t("stats.cancelRate")}
          value={stats.kpis.cancelRate === null ? t("stats.noData") : `${stats.kpis.cancelRate} %`}
          tone="red"
          hint={`${t("stats.byPatient")} : ${stats.kpis.cancelledByPatient} · ${t("stats.byPractitioner")} : ${stats.kpis.cancelledByPractitioner}${
            unknownBy > 0 ? ` · ${t("stats.byUnknown")} : ${unknownBy}` : ""
          }`}
        />
        <Kpi
          title={t("stats.returningRate")}
          value={stats.kpis.returningRate === null ? t("stats.noData") : `${stats.kpis.returningRate} %`}
          tone="zinc"
          hint={`${t("stats.medianLead")} : ${stats.kpis.medianLeadDays === null ? t("stats.noData") : `${stats.kpis.medianLeadDays} ${t("stats.days")}`}`}
        />
      </div>

      <div className="mt-4">
        <Card title={t("stats.weeklyTitle")}>
          {stats.weekly.length === 0 ? (
            <p className="text-sm text-mist">{t("stats.weeklyEmpty")}</p>
          ) : (
            <div className="flex items-end gap-2 overflow-x-auto pb-1" role="img" aria-label={t("stats.weeklyTitle")}>
              {stats.weekly.map((week) => (
                <div key={week.weekStart} className="flex w-14 shrink-0 flex-col items-center gap-1">
                  <div className="flex h-28 w-full items-end justify-center gap-1">
                    <div
                      className="w-4 rounded-t bg-green-600"
                      style={{ height: `${Math.max(week.honored > 0 ? 6 : 2, (week.honored / weekMax) * 100)}%` }}
                      title={`${t("stats.kindHonored")} : ${week.honored}`}
                    />
                    <div
                      className="w-4 rounded-t bg-red-400"
                      style={{ height: `${Math.max(week.cancelled > 0 ? 6 : 2, (week.cancelled / weekMax) * 100)}%` }}
                      title={`${t("stats.kindCancelled")} : ${week.cancelled}`}
                    />
                  </div>
                  <span className="text-[11px] text-mist">{formatDay(week.weekStart, timezone).replace(/^[a-zéû]+\.?\s/, "")}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card title={t("stats.bySessionTitle")}>
          {stats.bySession.length === 0 ? (
            <p className="text-sm text-mist">{t("stats.detailEmpty")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-mist">
                  <th className="py-1 pr-2 font-medium">{t("stats.colSession")}</th>
                  <th className="py-1 pr-2 text-right font-medium">{t("stats.colCount")}</th>
                  <th className="py-1 pr-2 text-right font-medium">{t("stats.colHonored")}</th>
                  <th className="py-1 text-right font-medium">{t("stats.colHours")}</th>
                </tr>
              </thead>
              <tbody>
                {stats.bySession.map((session) => (
                  <tr key={session.name} className="border-t border-line">
                    <td className="py-1.5 pr-2">{session.name}</td>
                    <td className="py-1.5 pr-2 text-right">{session.count}</td>
                    <td className="py-1.5 pr-2 text-right">{session.honored}</td>
                    <td className="py-1.5 text-right">{Math.round((session.minutes / 60) * 10) / 10} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={t("stats.revenueTitle")}>
          {stats.revenue.totals.length === 0 ? (
            <p className="text-sm text-mist">{t("stats.revenueEmpty")}</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {stats.revenue.totals.map((total) => (
                <li key={total.currency} className="flex justify-between">
                  <span className="uppercase text-mist">{total.currency}</span>
                  <strong>{formatPrice(total.cents, total.currency)}</strong>
                </li>
              ))}
            </ul>
          )}
          {stats.revenue.unknownPriceCount > 0 ? (
            <p className="mt-2 text-xs text-mist">{t("stats.revenueUnknown", { count: stats.revenue.unknownPriceCount })}</p>
          ) : null}
        </Card>
      </div>

      <div className="mt-4">
        <Card title={t("stats.detailTitle")} description={stats.truncated ? t("stats.truncated", { max: stats.rows.length }) : undefined}>
          {stats.rows.length === 0 ? (
            <p className="text-sm text-mist">{t("stats.detailEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-mist">
                    <th className="py-1 pr-2 font-medium">{t("stats.colWhen")}</th>
                    <th className="py-1 pr-2 font-medium">{t("stats.colSession")}</th>
                    <th className="py-1 pr-2 text-right font-medium">{t("stats.colDuration")}</th>
                    <th className="py-1 pr-2 font-medium">{t("stats.colStatus")}</th>
                    <th className="py-1 pr-2 text-right font-medium">{t("stats.colPrice")}</th>
                    <th className="py-1 text-right font-medium">{t("stats.colLead")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.rows.map((row) => {
                    const start = new Date(row.startAt);
                    return (
                      <tr key={row.id} className="border-t border-line">
                        <td className="py-1.5 pr-2">
                          {dayFmt.format(start)} · {timeFmt.format(start)}
                        </td>
                        <td className="py-1.5 pr-2">{row.sessionName}</td>
                        <td className="py-1.5 pr-2 text-right">{row.durationMin} min</td>
                        <td className="py-1.5 pr-2">
                          <KindBadge kind={row.kind} />
                        </td>
                        <td className="py-1.5 pr-2 text-right">
                          {row.priceCents === null ? t("stats.noData") : formatPrice(row.priceCents, row.currency)}
                        </td>
                        <td className="py-1.5 text-right">
                          {row.leadDays === null ? t("stats.noData") : `${row.leadDays} ${t("stats.days")}`}
                          {row.isReturning ? ` · ${t("stats.colReturning")}` : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Kpi({ title, value, tone, hint }: { title: string; value: string; tone: "green" | "amber" | "red" | "zinc"; hint?: string }) {
  return (
    <div className="rounded-3xl border border-line bg-card p-4 shadow-soft">
      <p className="text-sm text-mist">{title}</p>
      <p className="mt-1 text-2xl font-semibold">
        <Badge tone={tone}>{value}</Badge>
      </p>
      {hint ? <p className="mt-1 text-xs text-mist">{hint}</p> : null}
    </div>
  );
}

function KindBadge({ kind }: { kind: "honored" | "upcoming" | "cancelled" | "pending" }) {
  if (kind === "honored") return <Badge tone="green">{t("stats.kindHonored")}</Badge>;
  if (kind === "upcoming") return <Badge tone="amber">{t("stats.kindUpcoming")}</Badge>;
  if (kind === "cancelled") return <Badge tone="red">{t("stats.kindCancelled")}</Badge>;
  return <Badge tone="zinc">{t("stats.kindPending")}</Badge>;
}
