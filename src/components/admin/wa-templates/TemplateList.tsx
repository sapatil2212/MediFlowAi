// ─────────────────────────────────────────────────────────────────────────────
// TemplateList.tsx — the server-paginated template table (R-LIST).
//
// Twelve columns (name, language, category, source, Meta status, quality,
// notify kind, local state, op state, last submitted, last synced, updated) and
// server-side search / source-filter / status-filter / sort / paging via
// waTemplateList. Row actions (view, edit, clone, submit, archive, delete,
// reconcile) come from the shared allowedActions() matrix; a disallowed action
// shows its disabled reason via a title (R-LIST-08). Status renders through
// StatusBadge (R-LIST-09).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { waTemplateListServerFn } from "../../../lib/admin";
import { allowedActions, type TemplateAction } from "../../../lib/wa-template-model";
import type { TemplateRow } from "../../../lib/wa-template-repo";
import { StatusBadge } from "./StatusBadge";

const PAGE_SIZE = 20;

const COLUMNS = [
  "Name",
  "Language",
  "Category",
  "Source",
  "Meta status",
  "Quality",
  "Notify kind",
  "Local state",
  "Op state",
  "Last submitted",
  "Last synced",
  "Updated",
] as const;

const ROW_ACTIONS: { action: TemplateAction; label: string; destructive?: boolean }[] = [
  { action: "edit", label: "Edit" },
  { action: "clone", label: "Clone" },
  { action: "submit", label: "Submit" },
  { action: "archive", label: "Archive" },
  { action: "reconcile", label: "Check with Meta" },
  { action: "deleteDraft", label: "Delete draft", destructive: true },
  { action: "deleteMeta", label: "Delete from Meta", destructive: true },
];

function fmtDate(v: Date | string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function TemplateList({
  onOpen,
  onAction,
}: {
  onOpen?: (row: TemplateRow) => void;
  onAction?: (action: TemplateAction, row: TemplateRow) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [metaStatus, setMetaStatus] = useState("");
  const [sort, setSort] = useState<"name" | "updatedAt" | "createdAt" | "metaStatus">("updatedAt");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await waTemplateListServerFn({
        data: {
          search: search || undefined,
          source: source || undefined,
          metaStatus: metaStatus || undefined,
          sort,
          dir,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      })) as { ok: boolean; rows?: TemplateRow[]; total?: number; error?: string };
      if (res.ok && res.rows) {
        setRows(res.rows);
        setTotal(res.total ?? res.rows.length);
      } else {
        toast.error(res.error || "Could not list templates.");
      }
    } catch (e: any) {
      toast.error(e?.message || "Could not list templates.");
    } finally {
      setLoading(false);
    }
  }, [search, source, metaStatus, sort, dir, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSort = (col: "name" | "updatedAt" | "createdAt" | "metaStatus") => {
    if (sort === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(col);
      setDir("asc");
    }
    setPage(0);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-3" data-testid="template-list">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="sr-only">Search templates</span>
          <input
            className="input"
            placeholder="Search by name"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="block">
          <span className="sr-only">Filter by source</span>
          <select
            className="input"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All sources</option>
            <option value="LOCAL">Local</option>
            <option value="META">Meta</option>
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Filter by Meta status</span>
          <select
            className="input"
            value={metaStatus}
            onChange={(e) => {
              setMetaStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            <option value="APPROVED">Approved</option>
            <option value="PENDING">Pending</option>
            <option value="REJECTED">Rejected</option>
            <option value="PAUSED">Paused</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-zinc-500">
            <tr>
              {COLUMNS.map((c) => {
                const sortable =
                  c === "Name"
                    ? "name"
                    : c === "Updated"
                      ? "updatedAt"
                      : c === "Meta status"
                        ? "metaStatus"
                        : null;
                return (
                  <th key={c} className="px-3 py-2 text-left font-semibold">
                    {sortable ? (
                      <button
                        type="button"
                        className="cursor-pointer hover:text-zinc-800"
                        onClick={() => toggleSort(sortable as any)}
                      >
                        {c}
                        {sort === sortable ? (dir === "asc" ? " ▲" : " ▼") : ""}
                      </button>
                    ) : (
                      c
                    )}
                  </th>
                );
              })}
              <th className="px-3 py-2 text-left font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-6 text-center text-zinc-400">
                  <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-6 text-center text-zinc-400">
                  No templates yet.
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((r) => {
                const actions = allowedActions({
                  source: r.source,
                  metaStatus: r.metaStatus,
                  localState: r.localState,
                  opState: r.opState,
                  hasMediaHeader: r.headerType != null && !["NONE", "TEXT"].includes(r.headerType),
                });
                return (
                  <tr key={r.id} className="border-t border-zinc-100 align-top">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="font-medium text-[#0059C6] hover:underline cursor-pointer"
                        onClick={() => onOpen?.(r)}
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-zinc-600">{r.language}</td>
                    <td className="px-3 py-2 text-zinc-600">{r.metaCategory || r.category}</td>
                    <td className="px-3 py-2 text-zinc-600">{r.source}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={r.metaStatus} />
                    </td>
                    <td className="px-3 py-2 text-zinc-600">{r.qualityScore || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600">{r.notifyKind || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600">{r.localState || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600">{r.opState || "—"}</td>
                    <td className="px-3 py-2 text-zinc-600">{fmtDate(r.lastSubmittedAt)}</td>
                    <td className="px-3 py-2 text-zinc-600">{fmtDate(r.lastSyncedAt)}</td>
                    <td className="px-3 py-2 text-zinc-600">{fmtDate(r.updatedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {ROW_ACTIONS.map(({ action, label, destructive }) => {
                          const enabled = actions.allowed[action];
                          const reason = actions.reasons[action];
                          if (!enabled && !reason) return null;
                          return (
                            <button
                              key={action}
                              type="button"
                              disabled={!enabled}
                              title={!enabled ? reason : undefined}
                              aria-label={`${label} ${r.name}${!enabled && reason ? ` — ${reason}` : ""}`}
                              onClick={() => enabled && onAction?.(action, r)}
                              className={`rounded border px-2 py-0.5 text-xs cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                                destructive
                                  ? "border-red-200 text-red-600"
                                  : "border-zinc-200 text-zinc-600"
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          {total} template{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded-lg border border-zinc-300 px-3 py-1 disabled:opacity-50 cursor-pointer"
          >
            Previous
          </button>
          <span>
            Page {page + 1} / {pages}
          </span>
          <button
            type="button"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-zinc-300 px-3 py-1 disabled:opacity-50 cursor-pointer"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

export default TemplateList;
