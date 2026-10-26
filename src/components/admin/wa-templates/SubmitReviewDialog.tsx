// ─────────────────────────────────────────────────────────────────────────────
// SubmitReviewDialog.tsx — the explicit submit-to-Meta confirmation (R-SUB).
//
// Shows the EXACT payload that waValidateDraft() returned (the same body sent to
// Meta), any validation warnings, and requires an explicit confirm. It never
// implies approval: the copy says the template is submitted for review and will
// be PENDING. After a successful create the caller passes `submittedStatus` and
// the dialog shows the returned status (PENDING) — never "approved"
// (R-LIST-11).
// ─────────────────────────────────────────────────────────────────────────────
import { Loader2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { StatusBadge } from "./StatusBadge";

export function SubmitReviewDialog({
  open,
  payload,
  warnings,
  submitting,
  submittedStatus,
  onConfirm,
  onClose,
}: {
  open: boolean;
  payload: unknown;
  warnings?: string[];
  submitting?: boolean;
  /** Set once Meta accepted the create (e.g. "PENDING"); switches to the result view. */
  submittedStatus?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const done = !!submittedStatus;
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{done ? "Submitted for review" : "Review and submit to Meta"}</DialogTitle>
          <DialogDescription>
            {done
              ? "Meta accepted the template. It is now pending Meta review — approval is not guaranteed and can take time."
              : "This is the exact payload sent to Meta's Message Templates API. Submitting does not approve the template; Meta reviews it and sets the status."}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-2 text-sm" data-testid="submit-result">
            <div className="flex items-center gap-2">
              <span className="text-zinc-600">Meta status:</span>
              <StatusBadge status={submittedStatus} />
            </div>
            <p className="text-zinc-500">Track its status in the list and details views.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {warnings && warnings.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 p-3 pl-7 text-xs text-amber-800">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <pre
              className="max-h-72 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700"
              data-testid="submit-payload"
            >
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        )}

        <DialogFooter>
          {done ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-4 py-2 text-sm font-semibold text-white cursor-pointer"
            >
              Close
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0059C6] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 cursor-pointer"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Confirm &amp; submit to Meta
              </button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SubmitReviewDialog;
