import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import bmtLogo from "../assets/bmt-logo.png";
import { logoutServerFn } from "../lib/auth";
import {
  createCustomPlanAutoPayServerFn,
  createCustomPlanCheckoutServerFn,
  getWorkspaceUnlockContextServerFn,
  verifyCustomPlanAutoPayServerFn,
  verifyCustomPlanCheckoutServerFn,
} from "../lib/custom-plan-requests";

export const Route = createFileRoute("/unlock")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { ref?: string; order_id?: string; sub_id?: string } => ({
    ref: typeof search.ref === "string" ? search.ref : undefined,
    order_id: typeof search.order_id === "string" ? search.order_id : undefined,
    sub_id: typeof search.sub_id === "string" ? search.sub_id : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Activate your workspace — BookMyTime" },
      { name: "description", content: "Complete payment to activate your BookMyTime workspace." },
    ],
  }),
  component: UnlockPage,
});

type UnlockContext = Awaited<ReturnType<typeof getWorkspaceUnlockContextServerFn>>;

// The Cashfree v3 SDK, loaded globally by routes/__root.tsx.
type CashfreeInstance = {
  checkout: (opts: { paymentSessionId: string; redirectTarget?: string }) => Promise<unknown>;
  subscriptionsCheckout?: (opts: {
    subsSessionId: string;
    redirectTarget?: string;
  }) => Promise<{ error?: { message?: string } } | undefined>;
};
function cashfreeSdk(): ((opts: { mode: string }) => CashfreeInstance) | null {
  if (typeof window === "undefined") return null;
  const factory = (window as unknown as { Cashfree?: unknown }).Cashfree;
  return typeof factory === "function"
    ? (factory as (opts: { mode: string }) => CashfreeInstance)
    : null;
}

function UnlockPage() {
  const { ref, order_id, sub_id } = Route.useSearch();
  const navigate = useNavigate();

  const [ctx, setCtx] = useState<UnlockContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [paying, setPaying] = useState(false);
  const [settingAutoPay, setSettingAutoPay] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [activated, setActivated] = useState(false);

  const loadContext = useCallback(async () => {
    try {
      const result = await getWorkspaceUnlockContextServerFn({ data: { token: ref } });
      setCtx(result);
      if (result.found && !result.locked && result.status === "Active") {
        setActivated(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your workspace details.");
    } finally {
      setLoading(false);
    }
  }, [ref]);

  // Confirm a returned payment first (one-time order OR AutoPay mandate), then
  // load the current state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (order_id) {
        setVerifying(true);
        try {
          const res = await verifyCustomPlanCheckoutServerFn({ data: { orderId: order_id } });
          if (!cancelled && res.paid && res.activated) setActivated(true);
        } catch {
          /* fall through to context load, which shows the still-locked state */
        } finally {
          if (!cancelled) setVerifying(false);
        }
      } else if (sub_id) {
        setVerifying(true);
        try {
          const res = await verifyCustomPlanAutoPayServerFn({ data: { subscriptionRef: sub_id } });
          if (!cancelled && res.active) setActivated(true);
        } catch {
          /* fall through to context load */
        } finally {
          if (!cancelled) setVerifying(false);
        }
      }
      if (!cancelled) await loadContext();
    })();
    return () => {
      cancelled = true;
    };
  }, [order_id, sub_id, loadContext]);

  const handlePay = async () => {
    setPaying(true);
    setError("");
    try {
      const res = await createCustomPlanCheckoutServerFn({ data: { token: ref } });
      if (!res.success || !res.payment_session_id) {
        throw new Error("Could not start the payment. Please try again.");
      }
      const cf = cashfreeSdk();
      if (!cf) throw new Error("Payment gateway failed to load. Please refresh and try again.");
      const cashfree = cf({ mode: res.environment === "production" ? "production" : "sandbox" });
      await cashfree.checkout({
        paymentSessionId: res.payment_session_id,
        redirectTarget: "_self",
      });
      // On redirectTarget "_self" the browser leaves this page and returns to
      // /unlock?ref=..&order_id=.., where the verify effect takes over.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment could not be started.");
      setPaying(false);
    }
  };

  const handleAutoPay = async () => {
    setSettingAutoPay(true);
    setError("");
    try {
      const res = await createCustomPlanAutoPayServerFn({ data: { token: ref } });
      if (!res.success || !res.subscription_session_id) {
        throw new Error("Could not start AutoPay. Please try again.");
      }
      const cf = cashfreeSdk();
      if (!cf) throw new Error("Payment gateway failed to load. Please refresh and try again.");
      const cashfree = cf({ mode: res.mode === "production" ? "production" : "sandbox" });
      if (typeof cashfree.subscriptionsCheckout !== "function") {
        throw new Error("This gateway build doesn't support AutoPay. Please use Pay once instead.");
      }
      const result = await cashfree.subscriptionsCheckout({
        subsSessionId: res.subscription_session_id,
        redirectTarget: "_self",
      });
      if (result && result.error) {
        throw new Error(result.error.message || "AutoPay checkout could not be opened.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "AutoPay could not be started.");
      setSettingAutoPay(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutServerFn();
    } catch {
      /* ignore */
    }
    navigate({ to: "/login" });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 via-white to-zinc-100 px-4 py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-grid bg-radial-fade opacity-40" />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
          <img src={bmtLogo} alt="BookMyTime" className="h-9 w-auto object-contain" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-500 transition-colors hover:text-zinc-800"
          >
            <LogOut className="size-3.5" /> Sign out
          </button>
        </div>

        {loading || verifying ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-20">
            <Loader2 className="size-7 animate-spin text-zinc-900" />
            <p className="text-xs font-semibold text-zinc-500">
              {verifying ? "Confirming your payment..." : "Loading your workspace..."}
            </p>
          </div>
        ) : activated || (ctx?.found && ctx.status === "Active") ? (
          /* ── Paid / active ── */
          <div className="px-6 py-12 text-center">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 18 }}
              className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-50 ring-1 ring-emerald-100"
            >
              <CheckCircle2 className="size-9 text-emerald-500" strokeWidth={2.2} />
            </motion.div>
            <h1 className="mt-5 text-lg font-bold tracking-tight text-zinc-900">
              Your workspace is active
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
              Payment confirmed. Your custom plan is live with unlimited access to every feature.
            </p>
            <button
              type="button"
              onClick={() => navigate({ to: "/dashboard" })}
              className="mt-7 w-full rounded-xl bg-zinc-900 py-3 text-xs font-bold text-white transition-all hover:bg-zinc-800"
            >
              Go to my dashboard
            </button>
          </div>
        ) : ctx?.found && ctx.locked ? (
          /* ── Locked — payment required ── */
          <div className="px-6 py-7">
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div>
                <p className="text-xs font-bold text-amber-800">Access not granted yet</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700">
                  Your workspace is ready but locked. Complete the payment below to unlock it.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Sparkles className="size-5" />
              </span>
              <div>
                <h1 className="text-base font-bold tracking-tight text-zinc-900">
                  {ctx.businessName}
                </h1>
                <p className="text-[11px] font-semibold text-zinc-400">
                  {ctx.planLabel} · Ref {ctx.referenceId}
                </p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Amount due
                </span>
                <span className="text-2xl font-black tracking-tight text-zinc-900">
                  {ctx.amountLabel}
                </span>
              </div>
              <div className="mt-3 space-y-1.5 border-t border-zinc-200 pt-3 text-[11px] text-zinc-500">
                <div className="flex justify-between">
                  <span>Plan</span>
                  <span className="font-semibold text-zinc-700">{ctx.planLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span>Billing</span>
                  <span className="font-semibold text-zinc-700 capitalize">
                    {ctx.billingInterval}
                  </span>
                </div>
              </div>
            </div>

            {ctx.role && ctx.role !== "admin" ? (
              <div className="mt-5 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[11px] leading-relaxed text-zinc-500">
                Only the workspace owner can complete this payment. Please ask them to sign in and
                pay to unlock access for everyone.
              </div>
            ) : (
              <div className="mt-5 space-y-2.5">
                {/* AutoPay is the recommended path — collects now AND renews monthly. */}
                <button
                  type="button"
                  onClick={handleAutoPay}
                  disabled={settingAutoPay || paying}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 py-3.5 text-sm font-bold text-white transition-all hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-60"
                >
                  {settingAutoPay ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Opening secure checkout...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="size-4" /> Set up AutoPay · {ctx.amountLabel}
                    </>
                  )}
                </button>
                <p className="text-center text-[10px] font-medium text-zinc-400">
                  Renews automatically each month · Cancel anytime
                </p>
                <button
                  type="button"
                  onClick={handlePay}
                  disabled={paying || settingAutoPay}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white py-3 text-xs font-bold text-zinc-700 transition-all hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60"
                >
                  {paying ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Opening secure checkout...
                    </>
                  ) : (
                    <>
                      <Lock className="size-3.5" /> Pay once ({ctx.amountLabel.split(" / ")[0]})
                    </>
                  )}
                </button>
              </div>
            )}

            {error && (
              <p className="mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-center text-[11px] font-semibold text-red-600">
                {error}
              </p>
            )}

            <div className="mt-5 flex items-center justify-center gap-1.5 text-[10px] font-medium text-zinc-400">
              <ShieldCheck className="size-3.5" />
              Secured by Cashfree. Access unlocks automatically once payment is confirmed.
            </div>
          </div>
        ) : (
          /* ── Nothing pending for this link/session ── */
          <div className="px-6 py-12 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-zinc-150 bg-zinc-50">
              <Lock className="size-6 text-zinc-400" />
            </div>
            <h1 className="mt-5 text-base font-bold tracking-tight text-zinc-900">
              No pending payment
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-zinc-500">
              {error ||
                "We couldn't find a workspace awaiting payment for this link. If you've already paid, try signing in."}
            </p>
            <button
              type="button"
              onClick={() => navigate({ to: "/login" })}
              className="mt-7 w-full rounded-xl bg-zinc-900 py-3 text-xs font-bold text-white transition-all hover:bg-zinc-800"
            >
              Go to sign in
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
