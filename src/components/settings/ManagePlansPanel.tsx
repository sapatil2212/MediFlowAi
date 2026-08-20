// ─────────────────────────────────────────────────────────────────────────────
// ManagePlansPanel — the shared "Manage Plans & Billing" experience.
//
// This is the whole billing surface the category dashboards render on their
// `Manage Plans` tab, extracted into one reusable component so any workspace
// shell can host it:
//
//   • the current plan / renewal / payment-method summary (card-on-file and the
//     `hasPaid` vs. free-trial distinction),
//   • the plan tier cards with their upgrade actions,
//   • the Cashfree recurring AutoPay mandate checkout (`subscriptionsCheckout`)
//     plus cancel / resume,
//   • the one-time Cashfree order checkout (`cashfree.checkout`),
//   • the subscription payment ledger and the one-time payment history, both
//     with viewable and downloadable PDF invoices,
//   • the post-return verification overlays and success modals for both flows.
//
// It holds NO assumptions about the hosting category: every label is generic,
// every amount is read from `PLAN_BILLING` in `lib/feature-access.ts` (never
// inlined), and the only inputs are the session account, a `showToast` callback
// and the resolved `plans` permission.
//
// The Cashfree SDK is the global `window.Cashfree` loaded from the script tag in
// `routes/__root.tsx` — this component adds no dependency of its own.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Building2,
  Calendar,
  Check,
  Clock,
  CreditCard,
  FileText,
  Loader2,
  Lock,
  Mail,
  Phone,
  RefreshCw,
  X,
} from "lucide-react";
import {
  PLAN_BILLING,
  PLAN_TIERS,
  amountToPlanTier,
  getPlanMonthlyAmount,
  normalizePlan,
  type PlanTier,
} from "../../lib/feature-access";

// ─────────────────────────────────────────────────────────────────────────────
// Props & view types
// ─────────────────────────────────────────────────────────────────────────────

/** The billing-relevant slice of the session account, all optional so any
 *  shell's own session type is structurally assignable. */
export interface ManagePlansAccount {
  id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  clinicName?: string | null;
  role?: string | null;
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
  paymentMethod?: string | null;
  paymentAmount?: number | string | null;
  createdAt?: string | null;
}

export type ManagePlansToastKind = "success" | "error" | "info";

export interface ManagePlansPanelProps {
  /** The signed-in account whose subscription is being managed. */
  user: ManagePlansAccount | null;
  /** The host shell's toast channel. */
  showToast: (type: ManagePlansToastKind, message: string) => void;
  /** The resolved permission for the `plans` feature. */
  permission: "operate" | "view_only" | "none";
  /**
   * The `?tab=` value the payment gateway should return to, so the host shell
   * re-opens this panel after the redirect. Defaults to `plans`, the id the
   * category dashboards use.
   */
  returnTabParam?: string;
  /** Invoked after a payment or mandate is verified, so the host can refresh
   *  its own copy of the session (plan gating recomputes from it). */
  onAccountRefresh?: () => void | Promise<void>;
}

interface SubscriptionRecord {
  subscriptionRef: string;
  planTier?: string | null;
  amount?: number | string | null;
  status?: string | null;
  paymentMethod?: string | null;
  nextChargeAt?: string | null;
  currentPeriodEnd?: string | null;
  gracePeriodEnds?: string | null;
}

interface SubscriptionPaymentRow {
  id: string;
  amount: number | string;
  status?: string | null;
  paymentMethod?: string | null;
  paymentType?: string | null;
  cfPaymentId?: string | null;
  cfTxnId?: string | null;
  cfOrderId?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
}

interface OneTimePaymentRow {
  id: string;
  orderId?: string | null;
  plan?: string | null;
  amount: number | string;
  status?: string | null;
  paymentMode?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  cfPaymentId?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

// The Cashfree v3 web SDK, loaded globally by the root document.
type CashfreeInstance = {
  checkout?: (opts: { paymentSessionId: string; returnUrl?: string }) => Promise<unknown>;
  subscriptionsCheckout?: (opts: {
    subsSessionId: string;
    redirectTarget?: string;
  }) => Promise<{ error?: { message?: string } } | undefined>;
};
type CashfreeFactory = (opts: { mode: "production" | "sandbox" }) => CashfreeInstance;

function cashfreeSdk(): CashfreeFactory | null {
  if (typeof window === "undefined") return null;
  const factory = (window as unknown as { Cashfree?: unknown }).Cashfree;
  return typeof factory === "function" ? (factory as CashfreeFactory) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan presentation — the copy only. Every amount comes from PLAN_BILLING.
// ─────────────────────────────────────────────────────────────────────────────

const PLAN_COPY: Record<PlanTier, { description: string; features: string[]; popular: boolean }> = {
  Basic: {
    description: "Best for independent practices.",
    features: [
      "1 professional dashboard",
      "multi QR Code Booking",
      "meta verified whatsapp intigration",
      "Priority Support",
      "unlimited appointments / mo",
      "unlimited client records",
      "AI action plans standard",
    ],
    popular: false,
  },
  Premium: {
    description: "For growing multi-professional clinics.",
    features: [
      "1 sub location",
      "Up to 5 professionals",
      "multi QR Code Booking",
      "meta verified whatsapp intigration",
      "Priority Support",
      "unlimited appointments / mo",
      "unlimited client records",
      "WhatsApp alerts included",
      "Receptionist dashboard",
    ],
    popular: true,
  },
  Enterprise: {
    description: "For complete healthcare systems.",
    features: [
      "Unlimited sub locations",
      "Unlimited professionals & locations",
      "Custom CRM & ERP integrations",
      "Dedicated AI fine-tuning",
      "Dedicated CSM & support",
    ],
    popular: false,
  },
};

const SUPPORT_EMAIL = "bookmytime1355@gmail.com";
const SUPPORT_PHONE_HREF = "tel:+919168081355";
const SUPPORT_PHONE_LABEL = "+91 9168 08 1355";

/** `₹1,499` — never a hardcoded amount, always a PLAN_BILLING value. */
function formatInr(amount: number): string {
  return `₹${Number(amount || 0).toLocaleString("en-IN")}`;
}

/** The price label of a tier: its monthly amount, or `Custom` when not self-serve. */
function planPriceLabel(tier: PlanTier): string {
  const billing = PLAN_BILLING[tier];
  return billing.selfServe && billing.monthly > 0 ? formatInr(billing.monthly) : "Custom";
}

function longDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function shortDate(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function errorMessage(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() || fallback;
}

function statusLabel(status: string | null | undefined): string {
  switch (String(status || "").toUpperCase()) {
    case "SUCCESS":
      return "Paid";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Pending";
  }
}

function statusTextClass(status: string | null | undefined): string {
  switch (String(status || "").toUpperCase()) {
    case "SUCCESS":
      return "text-emerald-600";
    case "FAILED":
      return "text-red-600";
    case "CANCELLED":
      return "text-zinc-500";
    default:
      return "text-amber-600";
  }
}

function statusDotClass(status: string | null | undefined): string {
  switch (String(status || "").toUpperCase()) {
    case "SUCCESS":
      return "bg-emerald-500";
    case "FAILED":
      return "bg-red-500";
    default:
      return "bg-amber-500";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The panel
// ─────────────────────────────────────────────────────────────────────────────

export default function ManagePlansPanel({
  user,
  showToast,
  permission,
  returnTabParam = "plans",
  onAccountRefresh,
}: ManagePlansPanelProps) {
  const canOperate = permission === "operate";

  // A local copy of the account so a verified payment reflects immediately in
  // the summary card, exactly as the category dashboards refresh their session.
  const [account, setAccount] = useState<ManagePlansAccount | null>(user);
  useEffect(() => {
    setAccount(user);
  }, [user]);

  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);

  // One-time Cashfree order flow
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState<{ plan: string; amount: number } | null>(
    null,
  );

  // Recurring Cashfree AutoPay (mandate) flow
  const [mySubscription, setMySubscription] = useState<SubscriptionRecord | null>(null);
  const [subPayments, setSubPayments] = useState<SubscriptionPaymentRow[]>([]);
  const [myPayments, setMyPayments] = useState<OneTimePaymentRow[]>([]);
  const [subActionLoading, setSubActionLoading] = useState(false);
  const [isVerifyingSubscription, setIsVerifyingSubscription] = useState(false);
  const [subscriptionSuccess, setSubscriptionSuccess] = useState<{
    plan: string;
    amount: number;
    pending?: boolean;
  } | null>(null);

  /** Re-reads the session so the plan summary (and the host's gating) is current. */
  const refreshAccount = useCallback(async () => {
    try {
      const { getCurrentUserServerFn } = await import("../../lib/auth");
      const fresh = await getCurrentUserServerFn();
      if (fresh) setAccount(fresh as ManagePlansAccount);
    } catch {
      /* non-fatal: the success modal already confirms the outcome */
    }
    try {
      await onAccountRefresh?.();
    } catch {
      /* non-fatal */
    }
  }, [onAccountRefresh]);

  /** The AutoPay mandate plus both payment ledgers. */
  const fetchMySubscription = useCallback(async () => {
    try {
      const { getMySubscriptionServerFn } = await import("../../lib/subscription");
      const res = await getMySubscriptionServerFn();
      setMySubscription((res.subscription as SubscriptionRecord | null) ?? null);
      setSubPayments((res.payments as SubscriptionPaymentRow[]) || []);
    } catch {
      /* non-fatal */
    }
    // One-time (non-recurring) Cashfree payments for this account so every
    // transaction has a viewable/downloadable invoice in the billing view.
    try {
      const { getMyPaymentHistoryServerFn } = await import("../../lib/auth");
      const ph = await getMyPaymentHistoryServerFn();
      setMyPayments((ph.rows as OneTimePaymentRow[]) || []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    if (account) void fetchMySubscription();
  }, [account, fetchMySubscription]);

  // ── Post-return verification: one-time order (?order_id=) ──────────────────
  const verifyReturnedPayment = useCallback(
    async (orderId: string) => {
      setIsVerifyingPayment(true);
      try {
        const { verifyAndProcessPaymentServerFn } = await import("../../lib/auth");
        const res = await verifyAndProcessPaymentServerFn({ data: { orderId } });
        if (res.success) {
          setPaymentSuccess({ plan: res.plan as string, amount: Number(res.amount) });
          await refreshAccount();
        } else {
          showToast("error", (res as { message?: string }).message || "Payment was not completed.");
        }
      } catch (err: unknown) {
        showToast(
          "error",
          errorMessage(
            err,
            "We couldn't verify your payment. Please contact support if you were charged.",
          ),
        );
      } finally {
        setIsVerifyingPayment(false);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.delete("order_id");
          window.history.replaceState({}, document.title, url.pathname + url.search);
        }
      }
    },
    [showToast, refreshAccount],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const orderId = new URLSearchParams(window.location.search).get("order_id");
    if (orderId) void verifyReturnedPayment(orderId);
  }, [verifyReturnedPayment]);

  // ── Post-return verification: AutoPay mandate (?sub_id=) ───────────────────
  const verifyReturnedSubscription = useCallback(
    async (subscriptionRef: string) => {
      setIsVerifyingSubscription(true);
      try {
        const { verifySubscriptionServerFn } = await import("../../lib/subscription");
        const res = await verifySubscriptionServerFn({ data: { subscriptionRef } });
        if (res.success) {
          setSubscriptionSuccess({ plan: res.plan as string, amount: Number(res.amount) });
          await refreshAccount();
        } else if (res.status === "BANK_APPROVAL_PENDING") {
          setSubscriptionSuccess({
            plan: res.plan as string,
            amount: Number(res.amount),
            pending: true,
          });
        } else {
          showToast("error", res.message || "Mandate authorization was not completed.");
        }
        void fetchMySubscription();
      } catch (err: unknown) {
        showToast(
          "error",
          errorMessage(
            err,
            "We couldn't verify your subscription. Please contact support if you were charged.",
          ),
        );
      } finally {
        setIsVerifyingSubscription(false);
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.delete("sub_id");
          window.history.replaceState({}, document.title, url.pathname + url.search);
        }
      }
    },
    [showToast, fetchMySubscription, refreshAccount],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const subId = new URLSearchParams(window.location.search).get("sub_id");
    if (subId) void verifyReturnedSubscription(subId);
  }, [verifyReturnedSubscription]);

  /** Where the gateway sends the browser back to — the host shell's plans tab. */
  const buildReturnPath = useCallback(() => {
    const pathname = typeof window === "undefined" ? "/" : window.location.pathname;
    return `${pathname}?tab=${encodeURIComponent(returnTabParam)}`;
  }, [returnTabParam]);

  // ── Recurring AutoPay mandate checkout ─────────────────────────────────────
  const handleSubscribeAutoPay = useCallback(
    async (planTier: "Basic" | "Premium") => {
      if (!canOperate) {
        showToast("error", "You don't have permission to change the subscription.");
        return;
      }
      if (!account || !account.email) {
        showToast("error", "Session expired. Please log in again.");
        return;
      }
      if (processingPlan) return;
      setProcessingPlan(planTier);
      showToast("info", "Setting up AutoPay mandate...");
      try {
        const { createSubscriptionServerFn } = await import("../../lib/subscription");
        const res = await createSubscriptionServerFn({
          data: { planTier, returnPath: buildReturnPath() },
        });
        if (!res.success || !res.subscription_session_id) {
          showToast("error", "Could not start the subscription. Please try again.");
          return;
        }
        const cf = cashfreeSdk();
        if (!cf) throw new Error("Payment gateway SDK failed to load. Please refresh the page.");
        const cashfree = cf({ mode: res.mode === "production" ? "production" : "sandbox" });
        if (typeof cashfree.subscriptionsCheckout !== "function") {
          throw new Error(
            "This payment gateway build doesn't support subscription checkout. Please contact support.",
          );
        }
        const result = await cashfree.subscriptionsCheckout({
          subsSessionId: res.subscription_session_id,
          redirectTarget: "_self",
        });
        if (result && result.error) {
          showToast("error", result.error.message || "Subscription checkout could not be opened.");
        }
      } catch (err: unknown) {
        showToast("error", errorMessage(err, "Failed to set up AutoPay."));
      } finally {
        setProcessingPlan(null);
      }
    },
    [account, processingPlan, showToast, canOperate, buildReturnPath],
  );

  const handleCancelAutoPay = useCallback(async () => {
    if (!mySubscription || subActionLoading || !canOperate) return;
    setSubActionLoading(true);
    try {
      const { cancelSubscriptionServerFn } = await import("../../lib/subscription");
      const res = await cancelSubscriptionServerFn({
        data: { subscriptionRef: mySubscription.subscriptionRef },
      });
      showToast("success", res.message);
      void fetchMySubscription();
    } catch (err: unknown) {
      showToast("error", errorMessage(err, "Failed to cancel subscription."));
    } finally {
      setSubActionLoading(false);
    }
  }, [mySubscription, subActionLoading, canOperate, showToast, fetchMySubscription]);

  const handleResumeAutoPay = useCallback(async () => {
    if (!mySubscription || subActionLoading || !canOperate) return;
    setSubActionLoading(true);
    try {
      const { resumeSubscriptionServerFn } = await import("../../lib/subscription");
      await resumeSubscriptionServerFn({
        data: { subscriptionRef: mySubscription.subscriptionRef },
      });
      showToast("success", "Subscription resumed. AutoPay is active again.");
      void fetchMySubscription();
    } catch (err: unknown) {
      showToast("error", errorMessage(err, "Failed to resume subscription."));
    } finally {
      setSubActionLoading(false);
    }
  }, [mySubscription, subActionLoading, canOperate, showToast, fetchMySubscription]);

  // ── One-time (pay for a single month) checkout ──────────────────────────────
  const handleUpgradeClick = useCallback(
    async (planName: string) => {
      if (!PLAN_BILLING[planName as PlanTier]?.selfServe) {
        setIsContactModalOpen(true);
        return;
      }
      if (!canOperate) {
        showToast("error", "You don't have permission to change the subscription.");
        return;
      }
      if (!account || !account.email) {
        showToast("error", "Session expired. Please log in again.");
        return;
      }
      if (processingPlan) return;
      setProcessingPlan(planName);
      showToast("info", "Initiating secure payment gateway...");
      try {
        const { createCashfreeOrderServerFn } = await import("../../lib/auth");
        const res = await createCashfreeOrderServerFn({
          data: {
            username: account.email,
            planName: planName as "Basic" | "Premium",
            returnPath: buildReturnPath(),
          },
        });
        if (res.success && res.payment_session_id) {
          const cf = cashfreeSdk();
          if (!cf) throw new Error("Payment gateway SDK failed to load. Please refresh the page.");
          const cashfree = cf({
            mode: res.environment === "production" ? "production" : "sandbox",
          });
          if (typeof cashfree.checkout !== "function") {
            throw new Error(
              "This payment gateway build doesn't support checkout. Please contact support.",
            );
          }
          await cashfree.checkout({
            paymentSessionId: res.payment_session_id,
            returnUrl: res.return_url,
          });
        } else {
          showToast("error", "Failed to initiate payment checkout. Please try again.");
        }
      } catch (err: unknown) {
        showToast("error", errorMessage(err, "Failed to trigger payment gateway."));
      } finally {
        setProcessingPlan(null);
      }
    },
    [account, showToast, processingPlan, canOperate, buildReturnPath],
  );

  // ── Derived plan / trial state (the card-on-file & `hasPaid` handling) ──────
  const summary = useMemo(() => {
    const currentTier = normalizePlan(account?.subscriptionPlan ?? null);

    const paymentMethodRaw = String(account?.paymentMethod || "").toLowerCase();
    const hasPaid =
      Number(account?.paymentAmount) > 0 &&
      paymentMethodRaw !== "" &&
      paymentMethodRaw !== "none" &&
      paymentMethodRaw !== "trial";
    const isTrialing = !hasPaid;

    const expiryTime = account?.subscriptionExpiresAt
      ? new Date(account.subscriptionExpiresAt).getTime()
      : account?.createdAt
        ? new Date(account.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000
        : Date.now() + 7 * 24 * 60 * 60 * 1000;
    const daysLeft = Math.max(0, Math.ceil((expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));

    return {
      currentTier,
      hasPaid,
      trialActive: isTrialing && expiryTime > Date.now(),
      daysLeft,
      expiryDateString: longDate(expiryTime),
      monthlyAmount: getPlanMonthlyAmount(account?.subscriptionPlan ?? null),
    };
  }, [account]);

  const { currentTier, hasPaid, trialActive, daysLeft, expiryDateString, monthlyAmount } = summary;
  const dayWord = daysLeft === 1 ? "day" : "days";
  const hasActiveAutoPay = String(mySubscription?.status || "").toUpperCase() === "ACTIVE";
  const currentPriceLabel = planPriceLabel(currentTier);

  /** The invoice payload shared by the view and download buttons. */
  const subscriptionInvoice = useCallback(
    (sub: SubscriptionRecord, p: SubscriptionPaymentRow) => ({
      clinicName: account?.clinicName,
      customerName: account?.name,
      customerEmail: account?.email,
      customerPhone: account?.phone,
      plan: sub.planTier,
      amount: Number(p.amount),
      status: p.status,
      paymentMethod: p.paymentMethod,
      paymentType: p.paymentType,
      transactionType: p.paymentType === "AUTH" ? "Mandate Registration" : "Subscription Renewal",
      cfPaymentId: p.cfPaymentId,
      cfTxnId: p.cfTxnId,
      cfOrderId: p.cfOrderId,
      subscriptionRef: sub.subscriptionRef,
      transactionRef: p.id,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    }),
    [account],
  );

  const oneTimeInvoice = useCallback(
    (p: OneTimePaymentRow) => ({
      clinicName: account?.clinicName,
      customerName: p.customerName || account?.name,
      customerEmail: p.customerEmail || account?.email,
      customerPhone: p.customerPhone || account?.phone,
      plan: p.plan || amountToPlanTier(Number(p.amount)),
      amount: Number(p.amount),
      status: p.status,
      paymentMethod: p.paymentMode,
      transactionType: "One-time Payment",
      cfPaymentId: p.cfPaymentId,
      cfOrderId: p.orderId,
      transactionRef: p.id,
      paidAt: p.updatedAt || p.createdAt,
      createdAt: p.createdAt,
    }),
    [account],
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────
  return (
    <motion.div
      key="plans"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-6"
    >
      {/* Header card with plan summary */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-6">
        <div>
          <h3 className="text-base font-bold text-zinc-900">Subscription &amp; Billing</h3>
          <p className="text-xs text-zinc-500 font-semibold mt-1">
            Manage your workspace plan, view usage quotas, and check subscription expiration.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Active Plan Card */}
          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-4.5 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Current Plan
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                  trialActive
                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                    : hasPaid
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                      : "bg-red-500/10 text-red-600 border-red-500/20"
                }`}
              >
                {trialActive ? "Free Trial" : hasPaid ? "Active" : "Trial Ended"}
              </span>
            </div>
            <div>
              <p className="text-2xl font-black text-zinc-800 tracking-tight">{currentTier} Plan</p>
              <p className="text-xs text-zinc-400 font-medium mt-1">
                {currentPriceLabel === "Custom" ? "Custom pricing" : `${currentPriceLabel} / month`}
              </p>
            </div>
          </div>

          {/* Expiration Card */}
          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-4.5 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Renewal Date / Expiration
              </span>
              <Calendar className="h-4 w-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-lg font-black text-zinc-800">{expiryDateString}</p>
              <p
                className={`text-xs font-medium mt-1 ${trialActive ? "text-amber-600" : "text-zinc-400"}`}
              >
                {trialActive
                  ? `Free trial ends in ${daysLeft} ${dayWord}`
                  : hasPaid
                    ? `Renews in ${daysLeft} ${dayWord}`
                    : "Trial period has ended"}
              </p>
            </div>
          </div>

          {/* Billing Method Card */}
          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/50 p-4.5 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Payment Method
              </span>
              <CreditCard className="h-4 w-4 text-zinc-400" />
            </div>
            <div>
              <p className="text-lg font-black text-zinc-800">
                {!hasPaid ? "No card on file" : account?.paymentMethod || "Cashfree"}
              </p>
              <p className="text-xs text-zinc-400 font-medium mt-1">
                Amount: {hasPaid ? formatInr(Number(account?.paymentAmount)) : "₹0.00 during trial"}
              </p>
            </div>
          </div>
        </div>

        {!canOperate && (
          <div className="flex items-start gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3.5">
            <Lock className="h-3.5 w-3.5 text-zinc-400 mt-0.5 shrink-0" />
            <p className="text-[11px] font-semibold text-zinc-500">
              You can view the billing details, but only the workspace owner can change the
              subscription.
            </p>
          </div>
        )}
      </div>

      {/* Recurring AutoPay mandate + its payment ledger */}
      {mySubscription &&
        (() => {
          const s = mySubscription;
          const st = String(s.status || "").toUpperCase();
          const nextRenewalStr = longDate(s.nextChargeAt || s.currentPeriodEnd);
          const badge =
            st === "ACTIVE"
              ? {
                  cls: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
                  label: "AutoPay Active",
                }
              : st === "ON_HOLD"
                ? {
                    cls: "bg-amber-500/10 text-amber-600 border-amber-500/20",
                    label: "Payment Retry",
                  }
                : st === "PAUSED"
                  ? { cls: "bg-amber-500/10 text-amber-600 border-amber-500/20", label: "Paused" }
                  : st === "CANCELLED"
                    ? { cls: "bg-zinc-100 text-zinc-600 border-zinc-200", label: "Cancelled" }
                    : {
                        cls: "bg-amber-500/10 text-amber-600 border-amber-500/20",
                        label: "Pending Authorization",
                      };
          return (
            <div className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-start gap-3">
                  <div className="rounded-xl bg-brand/10 p-2.5 shrink-0">
                    <RefreshCw className="h-5 w-5 text-brand" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-black text-zinc-900">Recurring AutoPay</h4>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${badge.cls}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 font-medium mt-1">
                      {s.planTier} plan · {formatInr(Number(s.amount))}/month ·{" "}
                      {s.paymentMethod || "Cashfree"}
                    </p>
                    <p className="text-[11px] text-zinc-400 font-medium mt-1">
                      {st === "CANCELLED"
                        ? `AutoPay cancelled — access continues until ${nextRenewalStr}.`
                        : st === "ON_HOLD"
                          ? `Last renewal failed. We'll retry automatically${
                              s.gracePeriodEnds
                                ? ` (grace period until ${new Date(s.gracePeriodEnds).toLocaleDateString("en-US")})`
                                : ""
                            }.`
                          : `Next automatic renewal on ${nextRenewalStr}.`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(st === "PAUSED" || st === "ON_HOLD") && canOperate && (
                    <button
                      type="button"
                      disabled={subActionLoading}
                      onClick={() => void handleResumeAutoPay()}
                      className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-white hover:bg-brand/90 disabled:opacity-60 cursor-pointer"
                    >
                      {subActionLoading ? "Working…" : "Resume AutoPay"}
                    </button>
                  )}
                  {st === "ACTIVE" && canOperate && (
                    <button
                      type="button"
                      disabled={subActionLoading}
                      onClick={() => void handleCancelAutoPay()}
                      className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-60 cursor-pointer"
                    >
                      {subActionLoading ? "Working…" : "Cancel AutoPay"}
                    </button>
                  )}
                </div>
              </div>
              {subPayments.length > 0 && (
                <div className="border-t border-zinc-100 pt-4">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">
                    Billing History
                  </p>
                  <div className="space-y-2">
                    {subPayments.slice(0, 6).map((p) => (
                      <div key={p.id} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${statusDotClass(p.status)}`}
                          />
                          <span className="font-semibold text-zinc-700">
                            {formatInr(Number(p.amount))}
                          </span>
                          <span className="text-zinc-400">· {p.paymentMethod || "Cashfree"}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-[10px] font-bold ${statusTextClass(p.status)}`}>
                            {statusLabel(p.status)}
                          </span>
                          <span className="text-[10px] text-zinc-400 font-medium">
                            {shortDate(p.paidAt || p.createdAt)}
                          </span>
                          <button
                            type="button"
                            title="View invoice"
                            onClick={async () => {
                              const { viewInvoice } = await import("../../lib/pdf-invoice");
                              await viewInvoice(subscriptionInvoice(s, p));
                            }}
                            className="text-zinc-500 hover:text-brand cursor-pointer inline-flex items-center gap-1 text-[10px] font-bold"
                          >
                            <FileText className="h-3.5 w-3.5" /> View
                          </button>
                          <button
                            type="button"
                            title="Download invoice"
                            onClick={async () => {
                              const { downloadInvoice } = await import("../../lib/pdf-invoice");
                              await downloadInvoice(subscriptionInvoice(s, p));
                            }}
                            className="text-brand hover:text-brand/80 cursor-pointer inline-flex items-center gap-1 text-[10px] font-bold"
                          >
                            <FileText className="h-3.5 w-3.5" /> PDF
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      {/* One-time payment history — every Cashfree transaction with an invoice */}
      {myPayments.length > 0 && (
        <div className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-brand/10 p-2.5 shrink-0">
              <CreditCard className="h-5 w-5 text-brand" />
            </div>
            <div>
              <h4 className="text-sm font-black text-zinc-900">Payment History</h4>
              <p className="text-[11px] text-zinc-400 font-medium">
                Every transaction with a downloadable invoice.
              </p>
            </div>
          </div>
          <div className="divide-y divide-zinc-100">
            {myPayments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-zinc-900">
                      {formatInr(Number(p.amount))}
                    </span>
                    <span className={`text-[10px] font-bold ${statusTextClass(p.status)}`}>
                      {statusLabel(p.status)}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 font-medium mt-0.5 truncate">
                    {p.plan ? `${p.plan} · ` : ""}
                    {p.paymentMode || "Cashfree"} · {shortDate(p.createdAt)}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-3">
                  <button
                    type="button"
                    title="View invoice"
                    onClick={async () => {
                      const { viewInvoice } = await import("../../lib/pdf-invoice");
                      await viewInvoice(oneTimeInvoice(p));
                    }}
                    className="text-zinc-500 hover:text-brand cursor-pointer inline-flex items-center gap-1 text-[10px] font-bold"
                  >
                    <FileText className="h-3.5 w-3.5" /> View
                  </button>
                  <button
                    type="button"
                    title="Download invoice"
                    onClick={async () => {
                      const { downloadInvoice } = await import("../../lib/pdf-invoice");
                      await downloadInvoice(oneTimeInvoice(p));
                    }}
                    className="text-brand hover:text-brand/80 cursor-pointer inline-flex items-center gap-1 text-[10px] font-bold"
                  >
                    <FileText className="h-3.5 w-3.5" /> PDF
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trial activation banner */}
      {trialActive && (
        <div className="rounded-3xl border border-amber-300/60 bg-gradient-to-br from-amber-50 to-orange-50/60 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-amber-500/15 p-2.5 shrink-0">
                <CreditCard className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h4 className="text-sm font-black text-zinc-900">
                  You're on a free trial of the {currentTier} plan
                </h4>
                <p className="text-xs text-zinc-600 font-medium mt-1 max-w-xl">
                  Your trial ends in{" "}
                  <span className="font-bold text-amber-700">
                    {daysLeft} {dayWord}
                  </span>
                  . Activate now to avoid any interruption — you'll be charged{" "}
                  <span className="font-bold">{formatInr(monthlyAmount)}/month</span> and your
                  subscription stays active without a break.
                </p>
              </div>
            </div>
            {canOperate && (
              <button
                type="button"
                disabled={!!processingPlan}
                onClick={() =>
                  void handleUpgradeClick(currentTier === "Premium" ? "Premium" : "Basic")
                }
                className="shrink-0 rounded-full bg-amber-500 px-5 py-2.5 text-xs font-bold text-white transition-all hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer shadow-lg shadow-amber-500/25"
              >
                {processingPlan ? "Processing…" : `Activate Now — Pay ${formatInr(monthlyAmount)}`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Plan tier cards */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-6 space-y-6">
        <div>
          <h4 className="text-sm font-bold text-zinc-900">Available Packages</h4>
          <p className="text-xs text-zinc-500 font-semibold mt-0.5">
            Upgrade or downgrade your current subscription at any time.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {PLAN_TIERS.map((tier) => {
            const copy = PLAN_COPY[tier];
            const priceLabel = planPriceLabel(tier);
            const isSelfServe = PLAN_BILLING[tier].selfServe;
            const isActive = currentTier === tier;
            return (
              <div
                key={tier}
                className={`relative flex flex-col rounded-2xl border p-6 transition-all ${
                  isActive
                    ? "bg-white text-zinc-900 border-emerald-400/70"
                    : copy.popular
                      ? "bg-white text-zinc-900 border-brand/25 scale-[1.02]"
                      : "bg-white text-zinc-900 border-zinc-200 hover:border-brand/20"
                }`}
              >
                {copy.popular && !isActive && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-brand to-cyan-400 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white whitespace-nowrap">
                    Most Popular
                  </span>
                )}
                {isActive && (
                  <span
                    className={`absolute -top-3 left-4 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white whitespace-nowrap ${
                      trialActive ? "bg-amber-500" : "bg-black"
                    }`}
                  >
                    {trialActive ? "Current · Trial" : "Current Plan"}
                  </span>
                )}

                <p className="text-xs font-bold uppercase tracking-wider text-brand">{tier}</p>
                <p className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-black tracking-tight">{priceLabel}</span>
                  {priceLabel !== "Custom" && <span className="text-sm text-zinc-500">/mo</span>}
                </p>
                <p className="mt-2 text-xs font-medium text-zinc-600">{copy.description}</p>

                <ul className="mt-5 flex-1 space-y-2.5 border-t border-zinc-200 pt-5">
                  {copy.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-xs">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                      <span className="text-zinc-700">{feat}</span>
                    </li>
                  ))}
                </ul>

                {(() => {
                  if (!isSelfServe) {
                    return (
                      <button
                        type="button"
                        onClick={() => setIsContactModalOpen(true)}
                        className="mt-6 w-full rounded-lg bg-zinc-900 py-2.5 text-xs font-bold text-white hover:bg-zinc-800 transition-all cursor-pointer"
                      >
                        Contact Support
                      </button>
                    );
                  }
                  if (isActive && hasPaid && !trialActive) {
                    return (
                      <button
                        type="button"
                        disabled
                        className="mt-6 w-full rounded-lg bg-black/10 text-brand border border-zinc-800/25 py-2.5 text-xs font-bold cursor-default"
                      >
                        Current Plan
                      </button>
                    );
                  }
                  if (hasActiveAutoPay) {
                    return (
                      <button
                        type="button"
                        disabled
                        className="mt-6 w-full rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 py-2.5 text-xs font-bold cursor-default flex items-center justify-center gap-1.5"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> AutoPay Active
                      </button>
                    );
                  }
                  if (!canOperate) {
                    return (
                      <button
                        type="button"
                        disabled
                        className="mt-6 w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2.5 text-xs font-bold text-zinc-400 cursor-default flex items-center justify-center gap-1.5"
                      >
                        <Lock className="h-3.5 w-3.5" /> Owner only
                      </button>
                    );
                  }
                  return (
                    <div className="mt-6 space-y-2">
                      <button
                        type="button"
                        disabled={!!processingPlan}
                        onClick={() => void handleSubscribeAutoPay(tier as "Basic" | "Premium")}
                        className="w-full rounded-lg bg-brand py-2.5 text-xs font-bold text-white hover:bg-brand/90 shadow-lg shadow-brand/25 transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        {processingPlan === tier
                          ? "Starting…"
                          : `Subscribe & AutoPay · ${priceLabel}/mo`}
                      </button>
                      <button
                        type="button"
                        disabled={!!processingPlan}
                        onClick={() => void handleUpgradeClick(tier)}
                        className="w-full rounded-lg border border-zinc-200 bg-white py-2 text-[11px] font-bold text-zinc-600 hover:border-brand/30 hover:text-brand transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {processingPlan === tier
                          ? "Processing…"
                          : `Or pay once for a month · ${priceLabel}`}
                      </button>
                    </div>
                  );
                })()}
                {isActive && trialActive && isSelfServe && (
                  <p className="mt-2 text-center text-[10px] font-semibold text-amber-600">
                    Free trial active · {daysLeft} {dayWord} left
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Verification overlays and result modals ───────────────────────── */}
      {isVerifyingPayment && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md text-white">
          <Loader2 className="h-10 w-10 animate-spin text-brand" />
          <p className="mt-4 text-sm font-bold tracking-wide">Verifying your payment...</p>
          <p className="text-xs text-zinc-300 mt-1">
            Please do not refresh the page or press back.
          </p>
        </div>
      )}

      {isVerifyingSubscription && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/60 backdrop-blur-md text-white">
          <Loader2 className="h-10 w-10 animate-spin text-brand" />
          <p className="mt-4 text-sm font-bold tracking-wide">Confirming your AutoPay mandate...</p>
          <p className="text-xs text-zinc-300 mt-1">
            Please do not refresh the page or press back.
          </p>
        </div>
      )}

      <AnimatePresence>
        {subscriptionSuccess && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="relative bg-white rounded-[1.75rem] border border-zinc-150 p-7 max-w-md w-full shadow-2xl text-center space-y-4"
            >
              <button
                type="button"
                onClick={() => setSubscriptionSuccess(null)}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.05 }}
                className={`flex h-14 w-14 items-center justify-center rounded-full mx-auto border ${
                  subscriptionSuccess.pending
                    ? "bg-amber-50 border-amber-100 text-amber-600"
                    : "bg-emerald-50 border-emerald-100 text-emerald-600"
                }`}
              >
                {subscriptionSuccess.pending ? (
                  <Clock className="h-7 w-7" />
                ) : (
                  <Check className="h-7 w-7" />
                )}
              </motion.div>
              <div className="space-y-2">
                <h3 className="text-lg font-black text-zinc-900 leading-tight">
                  {subscriptionSuccess.pending ? "Mandate Pending Approval" : "AutoPay Activated"}
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                  {subscriptionSuccess.pending ? (
                    `Your ${subscriptionSuccess.plan} mandate is awaiting bank approval. We'll activate your subscription automatically once it's confirmed.`
                  ) : (
                    <>
                      Your{" "}
                      <span className="font-bold text-zinc-800">{subscriptionSuccess.plan}</span>{" "}
                      subscription is active. You'll be charged{" "}
                      <span className="font-bold text-zinc-800">
                        {formatInr(subscriptionSuccess.amount)}/month
                      </span>{" "}
                      automatically — no manual renewals needed.
                    </>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSubscriptionSuccess(null)}
                className="w-full rounded-full bg-brand hover:bg-brand/90 py-2.5 text-xs font-bold text-white transition-all active:scale-95 cursor-pointer"
              >
                Done
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Enterprise "Contact Support" modal */}
      <AnimatePresence>
        {isContactModalOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="relative bg-white rounded-[1.75rem] border border-zinc-150 p-7 max-w-md w-full shadow-2xl text-center space-y-5"
            >
              <button
                type="button"
                onClick={() => setIsContactModalOpen(false)}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand/10 border border-brand/20 mx-auto text-brand">
                <Building2 className="h-6 w-6" />
              </div>

              <div className="space-y-1.5">
                <h3 className="text-lg font-black text-zinc-900 leading-tight">
                  Talk to Our Enterprise Team
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                  For custom pricing, unlimited locations, and dedicated support — reach out and
                  we'll get back to you shortly.
                </p>
              </div>

              <div className="space-y-2.5">
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/60 px-4 py-3 text-left hover:border-brand/30 hover:bg-brand/5 transition-all cursor-pointer"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-zinc-200 text-brand">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      Email
                    </p>
                    <p className="text-sm font-bold text-zinc-800">{SUPPORT_EMAIL}</p>
                  </div>
                </a>
                <a
                  href={SUPPORT_PHONE_HREF}
                  className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50/60 px-4 py-3 text-left hover:border-brand/30 hover:bg-brand/5 transition-all cursor-pointer"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-zinc-200 text-brand">
                    <Phone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      Phone
                    </p>
                    <p className="text-sm font-bold text-zinc-800">{SUPPORT_PHONE_LABEL}</p>
                  </div>
                </a>
              </div>

              <button
                type="button"
                onClick={() => setIsContactModalOpen(false)}
                className="w-full rounded-full bg-zinc-900 hover:bg-zinc-800 py-2.5 text-xs font-bold text-white transition-all active:scale-95 cursor-pointer"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {paymentSuccess && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              className="relative bg-white rounded-[1.75rem] border border-zinc-150 p-7 max-w-md w-full shadow-2xl text-center space-y-4"
            >
              <button
                type="button"
                onClick={() => setPaymentSuccess(null)}
                className="absolute top-4 right-4 rounded-full p-1 text-zinc-400 hover:bg-zinc-50 hover:text-zinc-600 transition-all cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>

              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.05 }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 border border-emerald-100 mx-auto text-emerald-600"
              >
                <Check className="h-7 w-7" />
              </motion.div>

              <div className="space-y-2">
                <h3 className="text-lg font-black text-zinc-900 leading-tight">
                  Payment Successful
                </h3>
                <p className="text-xs text-zinc-500 leading-relaxed font-medium">
                  Your <span className="font-bold text-zinc-800">{paymentSuccess.plan}</span>{" "}
                  subscription is now active.
                  {typeof paymentSuccess.amount === "number" &&
                    !Number.isNaN(paymentSuccess.amount) && (
                      <>
                        {" "}
                        A payment of{" "}
                        <span className="font-bold text-zinc-800">
                          {formatInr(paymentSuccess.amount)}
                        </span>{" "}
                        was received.
                      </>
                    )}
                </p>
                <p className="text-[11px] text-zinc-400 font-medium">
                  A confirmation has been recorded on your account. Thank you for choosing
                  BookMyTime.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setPaymentSuccess(null)}
                className="w-full rounded-full bg-brand hover:bg-brand/90 py-2.5 text-xs font-bold text-white transition-all active:scale-95 cursor-pointer"
              >
                Done
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
