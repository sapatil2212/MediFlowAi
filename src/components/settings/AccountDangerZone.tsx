import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, HeartCrack, Loader2, PowerOff, Trash2, X } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// AccountDangerZone — the destructive controls at the bottom of Manage Plans.
//
// Shared by every dashboard so "deactivate plan" and "delete account" behave
// identically everywhere. Only the workspace owner sees the actions; staff and
// location accounts get nothing.
//
// Deleting does NOT lock the workspace — access continues while the request is
// pending (a background sweep does the permanent removal later). The customer is
// never shown a countdown; they only see "deletion is in progress" and a way to
// change their mind via the "sorry to see you leaving" modal.
// ─────────────────────────────────────────────────────────────────────────────

type ToastKind = "success" | "error" | "info";

interface AccountDangerZoneProps {
  user: { role?: string | null } | null;
  showToast: (type: ToastKind, message: string) => void;
  /** Called after deactivate so the host can refresh its session copy. */
  onChanged?: () => void | Promise<void>;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export default function AccountDangerZone({ user, showToast, onChanged }: AccountDangerZoneProps) {
  const isOwner = !user?.role || user.role === "admin";

  const [deletionPending, setDeletionPending] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [confirmKind, setConfirmKind] = useState<"deactivate" | "delete" | null>(null);
  const [busy, setBusy] = useState<"deactivate" | "delete" | "cancel" | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const { getAccountDeletionStatusServerFn } = await import("../../lib/account-lifecycle");
      const res = await getAccountDeletionStatusServerFn();
      setDeletionPending(res.pending);
      // Surface the "sorry to see you leaving" modal whenever a deletion is
      // outstanding, so the customer always has a one-click way to undo.
      if (res.pending) setShowLeaveModal(true);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (isOwner) void loadStatus();
  }, [isOwner, loadStatus]);

  const handleDeactivate = useCallback(async () => {
    setBusy("deactivate");
    try {
      const { deactivatePlanServerFn } = await import("../../lib/account-lifecycle");
      const res = await deactivatePlanServerFn();
      showToast("success", res.message);
      await onChanged?.();
    } catch (err) {
      showToast("error", errorMessage(err, "Could not deactivate the plan."));
    } finally {
      setBusy(null);
      setConfirmKind(null);
    }
  }, [showToast, onChanged]);

  const handleDelete = useCallback(async () => {
    setBusy("delete");
    try {
      const { requestAccountDeletionServerFn } = await import("../../lib/account-lifecycle");
      await requestAccountDeletionServerFn();
      setDeletionPending(true);
      setConfirmKind(null);
      setShowLeaveModal(true);
      showToast("success", "Your account deletion is in progress.");
    } catch (err) {
      showToast("error", errorMessage(err, "Could not submit the deletion request."));
    } finally {
      setBusy(null);
    }
  }, [showToast]);

  const handleCancelDeletion = useCallback(async () => {
    setBusy("cancel");
    try {
      const { cancelAccountDeletionServerFn } = await import("../../lib/account-lifecycle");
      await cancelAccountDeletionServerFn();
      setDeletionPending(false);
      setShowLeaveModal(false);
      showToast("success", "Your account deletion has been cancelled. Welcome back!");
    } catch (err) {
      showToast("error", errorMessage(err, "Could not cancel the deletion."));
    } finally {
      setBusy(null);
    }
  }, [showToast]);

  if (!isOwner) return null;

  return (
    <>
      <div className="rounded-3xl border border-red-200 bg-red-50/40 p-6">
        <div className="flex items-start gap-2.5">
          <div className="rounded-xl bg-red-100 p-2 text-red-600">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-red-700">Danger zone</h3>
            <p className="mt-0.5 text-xs font-medium text-red-600/80">
              These actions affect your whole workspace. Please be certain.
            </p>
          </div>
        </div>

        {deletionPending ? (
          <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-red-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <div>
                <p className="text-xs font-bold text-zinc-800">Account deletion is in progress</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                  You still have full access. Changed your mind? You can cancel anytime.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleCancelDeletion()}
              disabled={busy === "cancel"}
              className="shrink-0 rounded-lg bg-zinc-900 px-4 py-2 text-[11px] font-bold text-white transition-all hover:bg-zinc-800 disabled:opacity-60"
            >
              {busy === "cancel" ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" /> Cancelling...
                </span>
              ) : (
                "Cancel deletion"
              )}
            </button>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {/* Deactivate plan */}
            <div className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start gap-2.5">
                <PowerOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <p className="text-xs font-bold text-zinc-800">Deactivate current plan</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                    Stop AutoPay renewals. Your plan stays active until the current period ends.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmKind("deactivate")}
                className="mt-3 rounded-lg border border-amber-300 bg-white py-2 text-[11px] font-bold text-amber-700 transition-all hover:bg-amber-50"
              >
                Deactivate plan
              </button>
            </div>

            {/* Delete account */}
            <div className="flex flex-col justify-between rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start gap-2.5">
                <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div>
                  <p className="text-xs font-bold text-zinc-800">Delete account</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">
                    Permanently remove your workspace and all its data. This cannot be undone once
                    it completes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmKind("delete")}
                className="mt-3 rounded-lg bg-red-600 py-2 text-[11px] font-bold text-white transition-all hover:bg-red-700"
              >
                Delete my account
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm dialog (deactivate / delete) */}
      <AnimatePresence>
        {confirmKind && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl"
            >
              <div className="flex items-start gap-3">
                <div
                  className={`rounded-xl p-2 ${confirmKind === "delete" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"}`}
                >
                  {confirmKind === "delete" ? (
                    <Trash2 className="h-4 w-4" />
                  ) : (
                    <PowerOff className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-black text-zinc-900">
                    {confirmKind === "delete" ? "Delete your account?" : "Deactivate your plan?"}
                  </h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                    {confirmKind === "delete"
                      ? "This starts permanent deletion of your workspace and all its data. You'll keep access in the meantime and can cancel from your dashboard."
                      : "AutoPay renewals will stop. Your plan remains active until the end of the current period."}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmKind(null)}
                  disabled={busy !== null}
                  className="flex-1 rounded-lg border border-zinc-200 bg-white py-2 text-[11px] font-bold text-zinc-600 transition-all hover:bg-zinc-50 disabled:opacity-60"
                >
                  Keep my account
                </button>
                <button
                  type="button"
                  onClick={() =>
                    confirmKind === "delete" ? void handleDelete() : void handleDeactivate()
                  }
                  disabled={busy !== null}
                  className={`flex-1 rounded-lg py-2 text-[11px] font-bold text-white transition-all disabled:opacity-60 ${
                    confirmKind === "delete"
                      ? "bg-red-600 hover:bg-red-700"
                      : "bg-amber-500 hover:bg-amber-600"
                  }`}
                >
                  {busy ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" /> Working...
                    </span>
                  ) : confirmKind === "delete" ? (
                    "Yes, delete"
                  ) : (
                    "Yes, deactivate"
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* "Sorry to see you leaving" — the cancel-deletion surface */}
      <AnimatePresence>
        {showLeaveModal && deletionPending && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              className="relative w-full max-w-md overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white shadow-2xl"
            >
              <button
                type="button"
                onClick={() => setShowLeaveModal(false)}
                aria-label="Close"
                className="absolute right-4 top-4 z-10 cursor-pointer rounded-full p-1.5 text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-600"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="bg-gradient-to-br from-red-50 via-white to-white px-7 pt-9 pb-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100">
                  <HeartCrack className="h-6 w-6 text-red-500" />
                </div>
                <h2 className="text-xl font-black tracking-tight text-zinc-900">
                  We're sorry to see you leaving us
                </h2>
                <p className="mx-auto mt-2 max-w-sm text-xs font-medium leading-relaxed text-zinc-500">
                  Your account deletion is in progress. You'll keep full access in the meantime — if
                  you've changed your mind, you can cancel the deletion right now.
                </p>
              </div>
              <div className="space-y-2.5 px-7 pb-7">
                <button
                  type="button"
                  onClick={() => void handleCancelDeletion()}
                  disabled={busy === "cancel"}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand py-2.5 text-xs font-bold text-white shadow-sm shadow-brand/25 transition-all hover:bg-brand/90 disabled:opacity-60"
                >
                  {busy === "cancel" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancelling...
                    </>
                  ) : (
                    "Cancel account deletion"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLeaveModal(false)}
                  className="w-full rounded-lg py-2 text-[11px] font-semibold text-zinc-500 transition-colors hover:text-zinc-800"
                >
                  Continue with deletion
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
