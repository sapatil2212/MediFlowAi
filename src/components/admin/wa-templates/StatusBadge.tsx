// ─────────────────────────────────────────────────────────────────────────────
// StatusBadge.tsx — renders a template's Meta status as a coloured pill.
//
// Uses normalizeStatus() from the shared model (R-LIST-09): a known status gets
// a themed colour and a human label; an UNKNOWN or legacy value renders safely
// as its raw text with a neutral style (never crashes, never throws).
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeStatus } from "../../../lib/wa-template-model";

const KNOWN_STYLES: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  IN_APPEAL: "bg-amber-100 text-amber-700",
  REJECTED: "bg-red-100 text-red-700",
  DISABLED: "bg-red-100 text-red-700",
  PAUSED: "bg-orange-100 text-orange-700",
  LIMIT_EXCEEDED: "bg-orange-100 text-orange-700",
  ARCHIVED: "bg-zinc-200 text-zinc-600",
  DELETED: "bg-zinc-200 text-zinc-600",
  PENDING_DELETION: "bg-zinc-200 text-zinc-600",
};

const KNOWN_LABELS: Record<string, string> = {
  APPROVED: "Approved",
  PENDING: "Pending",
  IN_APPEAL: "In Appeal",
  REJECTED: "Rejected",
  DISABLED: "Disabled",
  PAUSED: "Paused",
  LIMIT_EXCEEDED: "Limit Exceeded",
  ARCHIVED: "Archived",
  DELETED: "Deleted",
  PENDING_DELETION: "Pending Deletion",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { raw, normalized, known } = normalizeStatus(status);
  if (!raw) {
    return (
      <span className="inline-block rounded px-2 py-0.5 text-xs font-semibold bg-zinc-100 text-zinc-500">
        Draft
      </span>
    );
  }
  const style = known ? KNOWN_STYLES[normalized] : "bg-zinc-100 text-zinc-600";
  const label = known ? (KNOWN_LABELS[normalized] ?? normalized) : raw;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${style}`}
      title={raw}
      data-known={known ? "true" : "false"}
    >
      {label}
      {known && label !== raw && <span className="sr-only"> ({raw})</span>}
    </span>
  );
}

export default StatusBadge;
