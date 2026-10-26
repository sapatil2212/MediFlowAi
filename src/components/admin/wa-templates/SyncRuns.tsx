// ─────────────────────────────────────────────────────────────────────────────
// SyncRuns.tsx — the WaTemplateSyncRun history + a manual "Sync all" trigger.
//
// Lists recent sync runs (trigger, status, scanned/updated/created/skipped,
// error, timing) from waTemplateSyncRuns and lets the admin kick a full sync
// via waSyncAll. Read-only otherwise.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { waTemplateSyncRunsServerFn, waSyncAllServerFn } from "../../../lib/admin";

interface SyncRunRow {
  id: string;
  trigger: string;
  status: string;
  scanned: number;
  updated: number;
  created: number;
  skipped: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function SyncRuns() {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [rows, setRows] = useState<SyncRunRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await waTemplateSyncRunsServerFn({ data: {} })) as {
        ok: boolean;
        rows?: SyncRunRow[];
        error?: string;
      };
      if (res.ok && res.rows) setRows(res.rows);
      else toast.error(res.error || "Could not load sync runs.");
    } catch (e: any) {
      toast.error(e?.message || "Could not load sync runs.");
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
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="sync-runs">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-700">Sync runs</h3>
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

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading sync runs…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Trigger</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold">Scanned</th>
                <th className="px-3 py-2 text-left font-semibold">Updated</th>
                <th className="px-3 py-2 text-left font-semibold">Created</th>
                <th className="px-3 py-2 text-left font-semibold">Skipped</th>
                <th className="px-3 py-2 text-left font-semibold">Started</th>
                <th className="px-3 py-2 text-left font-semibold">Error</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-zinc-400">
                    No sync runs yet.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-zinc-100">
                  <td className="px-3 py-2 text-zinc-600">{r.trigger}</td>
                  <td className="px-3 py-2 text-zinc-600">{r.status}</td>
                  <td className="px-3 py-2 text-zinc-600">{r.scanned}</td>
                  <td className="px-3 py-2 text-zinc-600">{r.updated}</td>
                  <td className="px-3 py-2 text-zinc-600">{r.created}</td>
                  <td className="px-3 py-2 text-zinc-600">{r.skipped}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {new Date(r.startedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-red-500">
                    {r.errorCode ? `${r.errorCode}: ${r.errorMessage || ""}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default SyncRuns;
