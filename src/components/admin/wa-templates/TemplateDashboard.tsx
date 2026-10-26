// ─────────────────────────────────────────────────────────────────────────────
// TemplateDashboard.tsx — summary cards from waTemplateDashboard (R-DASH).
//
// Eight cards: Total, Approved, Pending, Action Required, Inactive, Unknown,
// Last Meta sync, Last API OK. Counts come straight from the service summary
// (DashboardSummary: total, byBucket, byStatus, lastSyncOkAt, lastApiOkAt). The
// "Requiring Attention" grouping uses the model's attention buckets.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { waTemplateDashboardServerFn, waSyncAllServerFn } from "../../../lib/admin";
import { Skeleton } from "../../ui/skeleton";

interface DashboardSummary {
  total: number;
  byBucket: Record<string, number>;
  byStatus: Record<string, number>;
  lastSyncOkAt: string | null;
  lastApiOkAt: string | null;
}

function fmt(value: string | null): string {
  if (!value) return "Never";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleString();
}

export function TemplateDashboard() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await waTemplateDashboardServerFn({ data: {} })) as {
        ok: boolean;
        summary?: DashboardSummary;
        error?: string;
      };
      if (res.ok && res.summary) setSummary(res.summary);
      else toast.error(res.error || "Could not load the dashboard.");
    } catch (e: any) {
      toast.error(e?.message || "Could not load the dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const syncAll = async () => {
    setSyncing(true);
    try {
      const res = (await waSyncAllServerFn({ data: {} })) as { ok: boolean; error?: string };
      if (res.ok) {
        toast.success("Sync started.");
        await load();
      } else {
        toast.error(res.error || "Sync failed.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-lg" />
        ))}
      </div>
    );
  }

  const bucket = summary?.byBucket || {};
  const cards: { label: string; value: string | number; tone?: string }[] = [
    { label: "Total templates", value: summary?.total ?? 0 },
    { label: "Approved", value: bucket.approved || 0, tone: "emerald" },
    { label: "Pending", value: bucket.pending || 0, tone: "amber" },
    { label: "Action required", value: bucket.actionRequired || 0, tone: "red" },
    { label: "Inactive", value: bucket.inactive || 0 },
    { label: "Unknown status", value: bucket.unknown || 0 },
    { label: "Last Meta sync", value: fmt(summary?.lastSyncOkAt ?? null) },
    { label: "Last API OK", value: fmt(summary?.lastApiOkAt ?? null) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={syncAll}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-60 cursor-pointer"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Sync all from Meta
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-zinc-200 p-3">
            <div className="text-xs text-zinc-500">{c.label}</div>
            <div
              className={`mt-1 font-black ${
                typeof c.value === "number" ? "text-xl" : "text-sm font-semibold"
              } ${
                c.tone === "emerald"
                  ? "text-emerald-600"
                  : c.tone === "red"
                    ? "text-red-600"
                    : c.tone === "amber"
                      ? "text-amber-600"
                      : "text-zinc-900"
              }`}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TemplateDashboard;
