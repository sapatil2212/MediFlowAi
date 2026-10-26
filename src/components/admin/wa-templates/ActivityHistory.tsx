// ─────────────────────────────────────────────────────────────────────────────
// ActivityHistory.tsx — the WaTemplateActivity audit trail (R-SUB/R-LIFE).
//
// Lists activity rows (action, redacted detail, actor, time) for a single
// template when `templateId` is given, or the global recent activity when it is
// null. Detail is already redacted by the service (no phone/patient fields).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { waTemplateActivityServerFn } from "../../../lib/admin";

interface ActivityRow {
  id: string;
  templateId: string | null;
  action: string;
  detail: unknown | null;
  actorId: string | null;
  createdAt: string;
}

export function ActivityHistory({ templateId }: { templateId?: string | null }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ActivityRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await waTemplateActivityServerFn({
        data: { id: templateId ?? null },
      })) as { ok: boolean; rows?: ActivityRow[]; error?: string };
      if (res.ok && res.rows) setRows(res.rows);
      else toast.error(res.error || "Could not load activity.");
    } catch (e: any) {
      toast.error(e?.message || "Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading activity…
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="activity-history">
      <h3 className="text-sm font-semibold text-zinc-700">Activity</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">No activity recorded yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <div className="font-medium text-zinc-800">{r.action}</div>
                {r.detail != null && (
                  <div className="text-xs text-zinc-500">{JSON.stringify(r.detail)}</div>
                )}
              </div>
              <time className="shrink-0 text-xs text-zinc-400">
                {new Date(r.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ActivityHistory;
