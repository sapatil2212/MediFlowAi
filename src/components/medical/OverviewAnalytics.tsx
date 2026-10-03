/**
 * OverviewAnalytics.tsx
 *
 * The two interactive charts at the top of the medical dashboard Overview tab:
 * appointment volume over time and status distribution.
 *
 * This replaces a pair of static charts that were hard-coded inline in
 * medical.tsx. The data was already live (it comes from getAnalyticsServerFn,
 * which reads the Appointment table directly), but the UI exposed no way to
 * reshape it. This component adds:
 *
 *   - Auto-refresh on an interval with a visible "updated Ns ago" indicator and
 *     a manual refresh button, so "real-time" is actually observable.
 *   - A chart-type toggle (area / bar) for the volume trend.
 *   - Sorting on both charts — the trend by time or by volume, the distribution
 *     by workflow order, by count or alphabetically — plus asc/desc.
 *   - An interactive donut whose active slice expands on hover, paired with a
 *     clickable legend/table that drives the same selection.
 *
 * It is a presentational component: it never fetches. The parent owns the data
 * and the refresh action so there is a single source of truth for analytics
 * across the dashboard.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Sector,
} from "recharts";
import {
  Activity,
  BarChart3,
  LineChart as LineChartIcon,
  Loader2,
  RefreshCw,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types — the subset of getAnalyticsServerFn's result this component reads.
// ---------------------------------------------------------------------------

export interface MonthlyTrendPoint {
  month: string; // "YYYY-MM"
  count: number;
}

export interface StatusBreakdownPoint {
  status: string;
  count: number;
}

export interface OverviewAnalyticsData {
  monthlyTrend?: MonthlyTrendPoint[];
  statusBreakdown?: StatusBreakdownPoint[];
  scorecard?: { totalAppointments?: number };
}

export interface OverviewAnalyticsProps {
  data: OverviewAnalyticsData | null;
  loading: boolean;
  /** Trigger a re-fetch in the parent. */
  onRefresh: () => void;
  /** Enable the polling interval. Defaults to true. */
  autoRefresh?: boolean;
  /** Poll interval in ms. Defaults to 30s. */
  refreshIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  Completed: "#10b981",
  Confirmed: "#0f766e",
  Pending: "#f59e0b",
  Cancelled: "#ef4444",
};
const FALLBACK_COLOR = "#6366f1";
/** Workflow order a receptionist thinks in, not alphabetical. */
const STATUS_WORKFLOW = ["Pending", "Confirmed", "Completed", "Cancelled"];

type TrendSort = "time" | "volume";
type DistSort = "workflow" | "count" | "name";
type SortDir = "asc" | "desc";
type ChartKind = "area" | "bar";

function formatMonthLabel(monthStr: string): string {
  if (!monthStr) return "";
  // "YYYY-MM" → "Mon 'YY"; building the Date from parts avoids TZ drift.
  const [y, m] = monthStr.split("-").map(Number);
  if (!y || !m) return monthStr;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? FALLBACK_COLOR;
}

function displayStatus(status: string): string {
  return status === "Pending" ? "Pending Review" : status;
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function DirectionToggle({
  dir,
  onToggle,
  title,
}: {
  dir: SortDir;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white p-1 text-zinc-500 hover:text-brand hover:border-brand/40 transition-colors cursor-pointer"
    >
      {dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
    </button>
  );
}

function RelativeTime({ since }: { since: number | null }) {
  // Re-render once a second so "updated Ns ago" actually ticks.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!since) return null;
  const secs = Math.max(0, Math.round((Date.now() - since) / 1000));
  const label = secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
  return <span className="text-[10px] font-semibold text-zinc-400">updated {label}</span>;
}

const EmptyState = ({ message }: { message: string }) => (
  <div className="h-full w-full bg-zinc-50/60 rounded-xl flex flex-col items-center justify-center text-center px-4">
    <BarChart3 className="h-7 w-7 text-zinc-300 mb-2" />
    <p className="text-xs font-semibold text-zinc-500">No appointment data yet</p>
    <p className="text-[10px] text-zinc-400 mt-0.5">{message}</p>
  </div>
);

const LoadingState = () => (
  <div className="h-full w-full bg-zinc-50 rounded-xl flex items-center justify-center animate-pulse">
    <Loader2 className="h-6 w-6 text-zinc-300 animate-spin" />
  </div>
);

const chartTooltipStyle = {
  background: "rgba(255, 255, 255, 0.95)",
  border: "1px solid #e4e4e7",
  borderRadius: "12px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
  fontSize: "11px",
} as const;

// ---------------------------------------------------------------------------
// Active donut slice — expands the hovered/selected segment.
// ---------------------------------------------------------------------------

interface ActiveSliceProps {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
  fill: string;
}

function ActiveSlice(props: unknown) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } =
    props as ActiveSliceProps;
  return (
    <g>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={outerRadius + 8}
        outerRadius={outerRadius + 10}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
        opacity={0.4}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OverviewAnalytics({
  data,
  loading,
  onRefresh,
  autoRefresh = true,
  refreshIntervalMs = 30_000,
}: OverviewAnalyticsProps) {
  const [chartKind, setChartKind] = useState<ChartKind>("area");
  const [trendSort, setTrendSort] = useState<TrendSort>("time");
  const [trendDir, setTrendDir] = useState<SortDir>("asc");
  const [distSort, setDistSort] = useState<DistSort>("workflow");
  const [distDir, setDistDir] = useState<SortDir>("desc");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  // Stamp the update time whenever a fresh payload arrives.
  useEffect(() => {
    if (!loading && data) setLastUpdated(Date.now());
  }, [data, loading]);

  // Latest callback / loading flag, read inside the timer. Depending on them
  // directly re-created the interval on every parent render (onRefresh is a new
  // function each time) and on every loading toggle, so the 30s cadence kept
  // resetting and could effectively never fire.
  const onRefreshRef = useRef(onRefresh);
  const loadingRef = useRef(loading);
  onRefreshRef.current = onRefresh;
  loadingRef.current = loading;

  // Poll. Skips a tick while a request is in flight so responses don't stack up.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (!loadingRef.current) onRefreshRef.current();
    }, refreshIntervalMs);
    return () => clearInterval(id);
  }, [autoRefresh, refreshIntervalMs]);

  const trendData = useMemo(() => {
    const points = (data?.monthlyTrend ?? []).map((t) => ({
      key: t.month,
      name: formatMonthLabel(t.month),
      Appointments: t.count,
    }));
    const sorted = [...points].sort((a, b) => {
      const cmp =
        trendSort === "time" ? a.key.localeCompare(b.key) : a.Appointments - b.Appointments;
      return trendDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data?.monthlyTrend, trendSort, trendDir]);

  const totalAppointments = data?.scorecard?.totalAppointments ?? 0;

  const distData = useMemo(() => {
    const points = (data?.statusBreakdown ?? []).map((s) => ({
      status: s.status,
      name: displayStatus(s.status),
      value: s.count,
      color: statusColor(s.status),
    }));
    const sorted = [...points].sort((a, b) => {
      let cmp: number;
      if (distSort === "count") cmp = a.value - b.value;
      else if (distSort === "name") cmp = a.name.localeCompare(b.name);
      else {
        // workflow order; unknown statuses sink to the bottom
        const ai = STATUS_WORKFLOW.indexOf(a.status);
        const bi = STATUS_WORKFLOW.indexOf(b.status);
        cmp = (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      }
      return distDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [data?.statusBreakdown, distSort, distDir]);

  const hasTrend = trendData.length > 0;
  const hasDist = distData.length > 0;
  // Spinner only on the first load. A background refresh keeps the current
  // charts on screen instead of blanking them every 30 seconds.
  const ready = !!data || !loading;

  return (
    <div className="space-y-3">
      {/* Section-level live indicator + manual refresh */}
      <div className="flex items-center justify-end gap-2">
        <RelativeTime since={lastUpdated} />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          title="Refresh analytics"
          aria-label="Refresh analytics"
          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-500 hover:text-brand hover:border-brand/40 transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* ───────────────── Chart A: Volume Trend ───────────────── */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                Appointment Volume Trends
              </h4>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                Clinical consultation velocity over time
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-0.5 shrink-0">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>

          {/* Controls: chart type, sort field, direction */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-zinc-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setChartKind("area")}
                aria-pressed={chartKind === "area"}
                title="Area chart"
                className={`px-2 py-1 flex items-center gap-1 text-[10px] font-bold transition-colors cursor-pointer ${
                  chartKind === "area"
                    ? "bg-brand text-white"
                    : "bg-white text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                <LineChartIcon className="h-3 w-3" /> Area
              </button>
              <button
                type="button"
                onClick={() => setChartKind("bar")}
                aria-pressed={chartKind === "bar"}
                title="Bar chart"
                className={`px-2 py-1 flex items-center gap-1 text-[10px] font-bold border-l border-zinc-200 transition-colors cursor-pointer ${
                  chartKind === "bar"
                    ? "bg-brand text-white"
                    : "bg-white text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                <BarChart3 className="h-3 w-3" /> Bar
              </button>
            </div>

            <select
              value={trendSort}
              onChange={(e) => setTrendSort(e.target.value as TrendSort)}
              aria-label="Sort volume trend by"
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[10px] font-bold text-zinc-600 focus:outline-none cursor-pointer"
            >
              <option value="time">By period</option>
              <option value="volume">By volume</option>
            </select>
            <DirectionToggle
              dir={trendDir}
              onToggle={() => setTrendDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={`Sort ${trendDir === "asc" ? "ascending" : "descending"}`}
            />
          </div>

          <div className="h-[240px] w-full">
            {!ready ? (
              <LoadingState />
            ) : hasTrend ? (
              <ResponsiveContainer width="100%" height="100%">
                {chartKind === "area" ? (
                  <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorAppointments" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0f766e" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="#a1a1aa"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#a1a1aa"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      cursor={{ stroke: "#0f766e", strokeWidth: 1, strokeOpacity: 0.2 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="Appointments"
                      stroke="#0f766e"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#colorAppointments)"
                      animationDuration={800}
                      activeDot={{ r: 5, strokeWidth: 2 }}
                    />
                  </AreaChart>
                ) : (
                  <BarChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                    <XAxis
                      dataKey="name"
                      stroke="#a1a1aa"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#a1a1aa"
                      fontSize={10}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      cursor={{ fill: "#0f766e", fillOpacity: 0.06 }}
                    />
                    <Bar
                      dataKey="Appointments"
                      fill="#0f766e"
                      radius={[6, 6, 0, 0]}
                      animationDuration={800}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            ) : (
              <EmptyState message="Trends will appear here once you start receiving bookings." />
            )}
          </div>
        </div>

        {/* ───────────────── Chart B: Distribution ───────────────── */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-zinc-800 uppercase tracking-tight">
                Appointment Distribution
              </h4>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                Real-time status and outcome metrics
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-zinc-500 bg-zinc-50 border border-zinc-200/50 rounded-full px-2.5 py-0.5 shrink-0">
              <Activity className="h-3 w-3" />
              Performance
            </span>
          </div>

          {/* Sort controls */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={distSort}
              onChange={(e) => setDistSort(e.target.value as DistSort)}
              aria-label="Sort distribution by"
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[10px] font-bold text-zinc-600 focus:outline-none cursor-pointer"
            >
              <option value="workflow">Workflow order</option>
              <option value="count">By count</option>
              <option value="name">By name</option>
            </select>
            <DirectionToggle
              dir={distDir}
              onToggle={() => setDistDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={`Sort ${distDir === "asc" ? "ascending" : "descending"}`}
            />
          </div>

          <div className="h-[240px] w-full flex items-center justify-center relative">
            {!ready ? (
              <LoadingState />
            ) : hasDist ? (
              <div className="w-full h-full flex flex-col sm:flex-row items-center justify-center gap-4">
                <div className="relative w-[160px] h-[160px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={distData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={3}
                        dataKey="value"
                        animationDuration={800}
                        activeIndex={activeIndex ?? undefined}
                        activeShape={ActiveSlice}
                        onMouseEnter={(_, i) => setActiveIndex(i)}
                        onMouseLeave={() => setActiveIndex(null)}
                      >
                        {distData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                      {activeIndex !== null && distData[activeIndex]
                        ? distData[activeIndex].name
                        : "Total"}
                    </span>
                    <span className="text-xl font-extrabold text-zinc-800">
                      {activeIndex !== null && distData[activeIndex]
                        ? distData[activeIndex].value
                        : totalAppointments}
                    </span>
                  </div>
                </div>

                {/* Interactive legend/table — hover syncs with the donut */}
                <div className="flex flex-wrap sm:flex-col gap-1.5 text-[11px] justify-center sm:justify-start">
                  {distData.map((item, index) => {
                    const pct =
                      totalAppointments > 0
                        ? Math.round((item.value / totalAppointments) * 100)
                        : 0;
                    const active = activeIndex === index;
                    return (
                      <button
                        key={item.status}
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onMouseLeave={() => setActiveIndex(null)}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors cursor-pointer ${
                          active ? "bg-zinc-100" : "hover:bg-zinc-50"
                        }`}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="font-semibold text-zinc-600 min-w-[86px]">
                          {item.name}
                        </span>
                        <span className="font-bold text-zinc-800 tabular-nums">{item.value}</span>
                        <span className="text-[9px] font-semibold text-zinc-400 tabular-nums">
                          {pct}%
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState message="Status breakdown will appear once appointments are recorded." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
