import { X, Check, RefreshCw, Sparkles } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// First-login welcome modal.
//
// Shown once (per browser) after a user signs up and logs in for the first
// time. Greets them, confirms their free trial is active on their subscribed
// plan, and lets them either pay for a month one-time or set up recurring
// AutoPay — reusing the dashboard's existing handlers.
// ─────────────────────────────────────────────────────────────────────────────

type Tier = "Basic" | "Premium" | "Enterprise";

interface WelcomeTrialModalProps {
  open: boolean;
  onClose: () => void;
  user: any;
  processingPlan: string | null;
  /** One-time monthly payment (existing dashboard handler). */
  onPayNow: (plan: string) => void;
  /** Recurring AutoPay mandate setup (existing dashboard handler). */
  onAutoPay: (plan: "Basic" | "Premium") => void;
}

const PRICES: Record<string, string> = { Basic: "₹999", Premium: "₹1,499" };

const PLAN_FEATURES: Record<string, string[]> = {
  Basic: [
    "1 professional dashboard",
    "Unlimited appointments / mo",
    "QR code booking",
    "WhatsApp notifications",
    "Standard support",
  ],
  Premium: [
    "Up to 5 professionals + 1 sub-location",
    "Unlimited appointments & records",
    "WhatsApp alerts included",
    "Receptionist dashboard",
    "Priority support",
  ],
};

export default function WelcomeTrialModal({
  open,
  onClose,
  user,
  processingPlan,
  onPayNow,
  onAutoPay,
}: WelcomeTrialModalProps) {
  if (!open) return null;

  const rawPlan = (user?.subscriptionPlan || "").toLowerCase();
  const currentTier: Tier =
    rawPlan.includes("enterprise") || rawPlan.includes("hospital")
      ? "Enterprise"
      : rawPlan.includes("premium")
        ? "Premium"
        : "Basic";

  // Trial days remaining (7-day trial from account creation).
  const expiryTime = user?.createdAt
    ? new Date(user.createdAt).getTime() + 7 * 24 * 60 * 60 * 1000
    : Date.now() + 7 * 24 * 60 * 60 * 1000;
  const trialEndsInDays = Math.max(0, Math.ceil((expiryTime - Date.now()) / (1000 * 60 * 60 * 24)));

  // Which plans to present: the current one first, then the alternative.
  const sellable: Array<"Basic" | "Premium"> =
    currentTier === "Premium" ? ["Premium", "Basic"] : ["Basic", "Premium"];

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative bg-white rounded-[1.75rem] border border-zinc-200/70 w-full max-w-2xl shadow-2xl my-8 overflow-hidden">
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 transition-all cursor-pointer"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Header */}
        <div className="bg-gradient-to-br from-brand/10 via-white to-white px-7 pt-8 pb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10">
            <Sparkles className="h-6 w-6 text-brand" />
          </div>
          <h2 className="text-xl font-black text-zinc-900 tracking-tight">
            Welcome to BookMyTime{user?.name ? `, ${String(user.name).split(" ")[0]}` : ""}!
          </h2>
          <p className="mt-1.5 text-xs text-zinc-500 font-medium max-w-md mx-auto leading-relaxed">
            Your account is ready. Your{" "}
            <span className="font-bold text-amber-600">free trial of the {currentTier} plan is active</span>
            {trialEndsInDays > 0 ? ` for ${trialEndsInDays} more day${trialEndsInDays === 1 ? "" : "s"}` : ""}.
            Activate anytime below to keep your workspace running without interruption.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid gap-4 px-7 pb-7 sm:grid-cols-2">
          {sellable.map((plan) => {
            const isCurrent = plan === currentTier;
            const busy = processingPlan === plan;
            return (
              <div
                key={plan}
                className={`relative flex flex-col rounded-2xl border-2 p-5 transition-all ${
                  isCurrent ? "border-brand/60 bg-brand/[0.02]" : "border-zinc-200"
                }`}
              >
                {isCurrent && (
                  <span className="absolute -top-2.5 left-4 rounded-full bg-amber-500 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
                    Your Trial Plan
                  </span>
                )}
                <h3 className="text-sm font-black text-zinc-900">{plan} Plan</h3>
                <p className="mt-1 flex items-baseline gap-1">
                  <span className="text-2xl font-black text-zinc-900">{PRICES[plan]}</span>
                  <span className="text-xs text-zinc-500">/month</span>
                </p>
                <ul className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3 flex-1">
                  {PLAN_FEATURES[plan].map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-[11px] text-zinc-600">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-brand" />
                      <span className="text-left">{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 space-y-2">
                  <button
                    type="button"
                    disabled={!!processingPlan}
                    onClick={() => onAutoPay(plan)}
                    className="w-full rounded-lg bg-brand py-2 text-[11px] font-bold text-white transition-all hover:bg-brand/90 shadow-sm shadow-brand/25 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {busy ? "Starting…" : `Set up AutoPay · ${PRICES[plan]}/mo`}
                  </button>
                  <button
                    type="button"
                    disabled={!!processingPlan}
                    onClick={() => onPayNow(plan)}
                    className="w-full rounded-lg border border-zinc-200 bg-white py-2 text-[11px] font-bold text-zinc-600 transition-all hover:border-brand/30 hover:text-brand disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {busy ? "Processing…" : `Pay once (1 month) · ${PRICES[plan]}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-100 px-7 py-4 text-center">
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-semibold text-zinc-500 hover:text-zinc-800 transition-colors cursor-pointer"
          >
            Maybe later — continue exploring my trial
          </button>
          <p className="mt-1.5 text-[9px] text-zinc-400">
            AutoPay renews automatically every month · Cancel anytime · Secured by Cashfree
          </p>
        </div>
      </div>
    </div>
  );
}
