import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ArrowUpDown,
  Building,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
  Link2,
  Loader2,
  Mail,
  Phone,
  Receipt,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteCustomPlanRequestServerFn,
  deleteCustomPlanTenantServerFn,
  getCustomPlanPaymentsServerFn,
  getCustomPlanRequestsServerFn,
  recordManualPaymentServerFn,
  reviewCustomPlanRequestServerFn,
  updateCustomPlanDetailsServerFn,
} from "@/lib/custom-plan-requests";
import { PRACTICE_SIZE_OPTIONS, PROFESSION_OPTIONS } from "@/lib/tenant-provisioning";
import {
  ACTION_HINT,
  ACTION_LABEL,
  AMOUNT_LIMITS,
  availableActions,
  BILLING_INTERVALS,
  computeExpiry,
  CUSTOM_PLAN_STATUSES,
  defaultTermMonths,
  formatTermLabel,
  formatTermsLabel,
  listPriceFor,
  MANUAL_PAYMENT_METHODS,
  monthlyEquivalent,
  normalizeBillingInterval,
  normalizeGrantedPlan,
  normalizeStatus,
  PAYMENT_COLLECTION_MODES,
  referenceHintForMethod,
  STATUS_LABEL,
  STATUS_TONE,
  TERM_MONTHS_LIMITS,
  type BillingInterval,
  type CustomPlanAction,
  type CustomPlanStatus,
  type ManualPaymentMethod,
  type PaymentCollectionMode,
} from "@/lib/custom-plan";
import { PLAN_TIERS, type PlanTier } from "@/lib/feature-access";

export interface CustomPlanRequestRow {
  id: string;
  referenceId: string;
  name: string;
  email: string;
  phone: string;
  businessName: string;
  profession: string;
  practiceSize: string;
  requirements: string | null;
  status: string;
  grantedPlan: string | null;
  grantedAmount: number | null;
  billingInterval: string;
  termMonths: number | null;
  adminNotes: string | null;
  collectionMode: string | null;
  paymentToken: string | null;
  paymentOrderId: string | null;
  paidAt: string | null;
  tenantId: string | null;
  userId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  activatedAt: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
  tenantSubscriptionStatus?: string | null;
  tenantSubscriptionPlan?: string | null;
  tenantSubscriptionExpiresAt?: string | null;
  tenantPaymentAmount?: number | null;
}

/** Builds the tenant-facing pay link from a request's token (client-side origin). */
function paymentLinkFor(token: string | null): string | null {
  if (!token) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "https://bookmytime.tech";
  return `${origin}/unlock?ref=${encodeURIComponent(token)}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Server functions reject with an Error; anything else gets the fallback copy. */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(value?: string | null, withTime = false): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function StatusBadge({ status }: { status: CustomPlanStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${STATUS_TONE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** The editable terms held by the review dialog. */
interface TermsDraft {
  grantedPlan: PlanTier;
  grantedAmount: string;
  billingInterval: BillingInterval;
  termMonths: string;
  adminNotes: string;
  /** For approval: who collects the first payment. */
  collectionMode: PaymentCollectionMode;
}

function draftFromRow(row: CustomPlanRequestRow): TermsDraft {
  const interval = normalizeBillingInterval(row.billingInterval);
  const plan = normalizeGrantedPlan(row.grantedPlan);
  return {
    grantedPlan: plan,
    // A never-priced request prefills with the tier's list price so the super
    // admin adjusts a real number rather than starting from a blank field.
    grantedAmount: String(row.grantedAmount ?? listPriceFor(plan)),
    billingInterval: interval,
    termMonths: String(row.termMonths ?? defaultTermMonths(interval)),
    adminNotes: row.adminNotes ?? "",
    collectionMode: (row.collectionMode as PaymentCollectionMode) || "online",
  };
}

/** The editable requester/tenant identity fields. */
interface DetailsDraft {
  name: string;
  email: string;
  phone: string;
  businessName: string;
  profession: string;
  practiceSize: string;
}

function detailsFromRow(row: CustomPlanRequestRow): DetailsDraft {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    businessName: row.businessName,
    profession: row.profession,
    practiceSize: row.practiceSize,
  };
}

/** The collect-payment form held by the manage dialog. */
interface CollectDraft {
  amount: string;
  method: ManualPaymentMethod;
  reference: string;
  note: string;
}

function collectDraftFromRow(row: CustomPlanRequestRow): CollectDraft {
  const plan = normalizeGrantedPlan(row.grantedPlan);
  return {
    // Prefill with the agreed amount so the common case (collecting the negotiated
    // sum) is one click; the super admin can still change it for a top-up.
    amount: String(row.grantedAmount ?? listPriceFor(plan)),
    method: "UPI",
    reference: "",
    note: "",
  };
}

/** A ledger row rendered in the manage dialog's recent-payments list. */
interface CustomPlanPaymentItem {
  id: string;
  orderId: string;
  cfPaymentId: string | null;
  amount: number;
  status: string;
  orderStatus: string | null;
  paymentMode: string | null;
  gateway: string | null;
  createdAt: string;
}

/** Border+text tone for a payment status chip. */
function paymentStatusTone(status: string): string {
  const s = (status || "").toUpperCase();
  if (s === "SUCCESS") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (s === "PENDING") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-red-200 bg-red-50 text-red-600";
}

/**
 * Super Admin panel for managing enterprise custom plan requests.
 *
 * Capabilities:
 * - List requests by status with live search
 * - Approve with negotiated tier/price (provisions tenant and emails pay link or unlocks directly)
 * - Record offline payment (switches Awaiting Payment -> Active)
 * - Collect a payment any number of times against a provisioned workspace, with
 *   method (UPI/card/cash/transfer/cheque) + reference id — each logged and
 *   extending paid access — plus a recent-payments ledger
 * - Resend payment link (Awaiting Payment)
 * - Revise plan & price on an active tenant (immediate upgrade/downgrade)
 * - Suspend / resume active tenant
 * - Reject pending requests
 *
 * Every mutation goes through the shared `reviewCustomPlanRequestServerFn` so
 * the server can enforce status transitions, recalculate MRR, provision the
 * tenant, sync subscription rows, and dispatch transactional emails.
 *
 * Non-admin callers never see this panel; if rendered outside super admin role,
 * the server will reject.
 */
export function CustomPlansPanel({ onTenantsChanged }: { onTenantsChanged?: () => void }) {
  const [rows, setRows] = useState<CustomPlanRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | CustomPlanStatus>("all");

  const toggleSearch = () => {
    if (!isSearchOpen) {
      setIsSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else if (!searchQuery) {
      setIsSearchOpen(false);
    }
  };

  const [selected, setSelected] = useState<CustomPlanRequestRow | null>(null);
  const [draft, setDraft] = useState<TermsDraft | null>(null);
  const [details, setDetails] = useState<DetailsDraft | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [confirmingPurge, setConfirmingPurge] = useState(false);
  const [purging, setPurging] = useState(false);
  const [pendingAction, setPendingAction] = useState<CustomPlanAction | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [collect, setCollect] = useState<CollectDraft | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [payments, setPayments] = useState<CustomPlanPaymentItem[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);

  const fetchRows = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getCustomPlanRequestsServerFn();
      setRows((data as CustomPlanRequestRow[]) || []);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load custom plans"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const fetchPayments = useCallback(async (id: string) => {
    setPaymentsLoading(true);
    try {
      const result = await getCustomPlanPaymentsServerFn({ data: { id } });
      setPayments((result.payments as CustomPlanPaymentItem[]) || []);
    } catch {
      // A ledger read failing must not break the dialog — show an empty list.
      setPayments([]);
    } finally {
      setPaymentsLoading(false);
    }
  }, []);

  const openReview = (row: CustomPlanRequestRow) => {
    setSelected(row);
    setDraft(draftFromRow(row));
    setDetails(detailsFromRow(row));
    setCollect(collectDraftFromRow(row));
    setPayments([]);
    setConfirmingPurge(false);
    // Only provisioned workspaces have a ledger to show / collect against.
    if (row.userId) void fetchPayments(row.id);
  };

  const closeReview = () => {
    setSelected(null);
    setDraft(null);
    setDetails(null);
    setCollect(null);
    setPayments([]);
    setConfirmingPurge(false);
    setPendingAction(null);
  };

  const handleCollectPayment = async () => {
    if (!selected || !collect) return;
    setCollecting(true);
    try {
      const result = await recordManualPaymentServerFn({
        data: {
          id: selected.id,
          amount: Number(collect.amount),
          method: collect.method,
          reference: collect.reference,
          note: collect.note,
        },
      });
      toast.success(
        `Recorded ${formatInr(result.amount)} via ${result.method}. Active through ${formatDate(
          result.expiresAt,
        )}.`,
      );
      // Keep the amount/method for a possible follow-up, but clear the one-off fields.
      setCollect((previous) => (previous ? { ...previous, reference: "", note: "" } : previous));
      await fetchPayments(selected.id);
      await fetchRows(true);
      onTenantsChanged?.();
    } catch (error) {
      toast.error(errorMessage(error, "Could not record the payment."));
    } finally {
      setCollecting(false);
    }
  };

  const handleSaveDetails = async () => {
    if (!selected || !details) return;
    setSavingDetails(true);
    try {
      await updateCustomPlanDetailsServerFn({ data: { id: selected.id, ...details } });
      toast.success("Customer details updated.");
      await fetchRows(true);
      onTenantsChanged?.();
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the details."));
    } finally {
      setSavingDetails(false);
    }
  };

  const handlePurge = async () => {
    if (!selected) return;
    setPurging(true);
    try {
      await deleteCustomPlanTenantServerFn({ data: { id: selected.id } });
      toast.success(`Deleted ${selected.businessName} and its workspace.`);
      closeReview();
      await fetchRows(true);
      onTenantsChanged?.();
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete this account."));
    } finally {
      setPurging(false);
      setConfirmingPurge(false);
    }
  };

  const summary = useMemo(() => {
    const counts = { pending: 0, awaitingPayment: 0, active: 0, suspended: 0, rejected: 0, mrr: 0 };
    for (const row of rows) {
      const status = normalizeStatus(row.status);
      if (status === "Pending") counts.pending += 1;
      if (status === "PaymentPending") counts.awaitingPayment += 1;
      if (status === "Suspended") counts.suspended += 1;
      if (status === "Rejected") counts.rejected += 1;
      if (status === "Active") {
        counts.active += 1;
        counts.mrr += monthlyEquivalent(
          row.grantedAmount ?? 0,
          normalizeBillingInterval(row.billingInterval),
        );
      }
    }
    return counts;
  }, [rows]);

  const filteredRows = useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const status = normalizeStatus(row.status);
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (!needle) return true;
      return [
        row.referenceId,
        row.name,
        row.email,
        row.phone,
        row.businessName,
        row.profession,
        row.tenantId || "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, searchQuery, statusFilter]);

  const handleAction = async (action: CustomPlanAction) => {
    if (!selected || !draft) return;
    setPendingAction(action);
    try {
      const result = await reviewCustomPlanRequestServerFn({
        data: {
          id: selected.id,
          action,
          grantedPlan: draft.grantedPlan,
          grantedAmount: Number(draft.grantedAmount),
          billingInterval: draft.billingInterval,
          termMonths: Number(draft.termMonths),
          adminNotes: draft.adminNotes,
          collectionMode: draft.collectionMode,
        },
      });

      if (action === "approve" && draft.collectionMode === "online") {
        toast.success("Workspace provisioned. Payment link emailed to the tenant.");
      } else if (action === "approve" || action === "recordPayment") {
        toast.success(`Payment recorded — workspace ${result.tenantId || ""} is live.`);
      } else if (action === "resendLink") {
        toast.success("Payment link re-sent to the tenant.");
      } else {
        toast.success(`${ACTION_LABEL[action]} — done. Request is now ${result.status}.`);
      }

      // Surface the pay link so the admin can share it directly if email fails.
      if (result.paymentLink) {
        const link = result.paymentLink;
        toast("Payment link ready", {
          description: link,
          action: {
            label: "Copy",
            onClick: () => {
              void copyToClipboard(link).then((ok) =>
                ok ? toast.success("Link copied") : toast.error("Could not copy"),
              );
            },
          },
        });
      }

      closeReview();
      await fetchRows(true);
      // Every action except a pure resend can change a User row (provisioning,
      // activation, revision, suspension, resumption, rejection), so refresh the
      // dashboard's tenant list + MRR.
      if (action !== "resendLink") onTenantsChanged?.();
    } catch (error) {
      toast.error(errorMessage(error, "Action failed"));
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async (row: CustomPlanRequestRow) => {
    setDeletingId(row.id);
    try {
      await deleteCustomPlanRequestServerFn({ data: { id: row.id } });
      toast.success(`Request ${row.referenceId} deleted.`);
      if (selected?.id === row.id) closeReview();
      await fetchRows(true);
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete this request"));
    } finally {
      setDeletingId(null);
    }
  };

  const selectedStatus = selected ? normalizeStatus(selected.status) : "Pending";
  const actions = selected ? availableActions(selectedStatus) : [];
  const draftAmount = Number(draft?.grantedAmount ?? 0);
  const draftTerm = Number(draft?.termMonths ?? 0);
  const previewExpiry =
    draft && Number.isFinite(draftTerm) && draftTerm >= TERM_MONTHS_LIMITS.min
      ? computeExpiry(new Date(), draftTerm)
      : null;

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Awaiting review",
            value: summary.pending,
            hint: "Needs a decision",
            icon: AlertCircle,
            color: "bg-amber-50 text-amber-600",
          },
          {
            label: "Awaiting payment",
            value: summary.awaitingPayment,
            hint: "Provisioned · unpaid",
            icon: Clock3,
            color: "bg-violet-50 text-violet-600",
          },
          {
            label: "Active",
            value: summary.active,
            hint: "Live workspaces",
            icon: CheckCircle2,
            color: "bg-emerald-50 text-emerald-600",
          },
          {
            label: "Custom MRR",
            value: formatInr(summary.mrr),
            hint: "Monthly equivalent",
            icon: Sparkles,
            color: "bg-blue-50 text-[#0059C6]",
          },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div
              key={card.label}
              className="flex items-start justify-between rounded-xl border border-zinc-200 bg-white p-4 transition-all hover:border-[#0059C6]/30"
            >
              <div>
                <span className="block text-xl font-black tracking-tight text-zinc-950">
                  {card.value}
                </span>
                <span className="mt-1 block text-[10px] font-semibold text-zinc-400">
                  {card.hint}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className={`flex size-7 items-center justify-center rounded-lg ${card.color}`}>
                  <Icon className="size-3.5" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                  {card.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Table */}
      <div className="space-y-5 rounded-2xl border border-zinc-200/80 bg-white p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-3 border-b border-zinc-150 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 pr-2">
            <h2 className="text-sm font-bold text-zinc-900">Custom Plan Requests</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 max-w-xl">
              Approve to provision the workspace with unlimited access, then collect payment online
              or mark it paid. Revising a live plan upgrades or downgrades that tenant immediately.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            {/* Expandable Search with animation */}
            <div className="relative flex items-center">
              <AnimatePresence initial={false}>
                {isSearchOpen || searchQuery ? (
                  <motion.div
                    key="search-input"
                    initial={{ width: 34, opacity: 0 }}
                    animate={{ width: 260, opacity: 1 }}
                    exit={{ width: 34, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="relative flex items-center"
                  >
                    <Search className="pointer-events-none absolute left-2.5 size-3.5 text-zinc-400" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search business, contact, ref..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          if (searchQuery) setSearchQuery("");
                          else setIsSearchOpen(false);
                        }
                      }}
                      className="h-8.5 w-full rounded-xl border border-zinc-200 bg-zinc-50/70 pl-8 pr-7 text-xs font-medium text-zinc-800 transition-colors placeholder:text-zinc-400 focus:border-[#0059C6] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (searchQuery) setSearchQuery("");
                        else setIsSearchOpen(false);
                      }}
                      className="absolute right-1.5 flex size-5 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700"
                      title={searchQuery ? "Clear search" : "Close search"}
                    >
                      <X className="size-3" />
                    </button>
                  </motion.div>
                ) : (
                  <motion.button
                    key="search-btn"
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    type="button"
                    onClick={toggleSearch}
                    title="Search by business, contact, ref, or workspace..."
                    className="flex size-8.5 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-2xs transition-all hover:border-[#0059C6] hover:text-[#0059C6] active:scale-95"
                  >
                    <Search className="size-3.5" />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>

            {/* Status Filter */}
            <div className="flex h-8.5 items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-2.5 shadow-2xs transition-colors hover:border-zinc-300">
              <ArrowUpDown className="size-3.5 shrink-0 text-zinc-400" />
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as "all" | CustomPlanStatus)
                }
                className="cursor-pointer border-none bg-transparent pr-1 text-xs font-semibold text-zinc-700 focus:outline-none"
              >
                <option value="all">All statuses</option>
                {CUSTOM_PLAN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </div>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => void fetchRows()}
              disabled={loading}
              title="Refresh requests"
              className="flex size-8.5 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-2xs transition-all hover:border-[#0059C6] hover:text-[#0059C6] active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20">
              <Loader2 className="size-7 animate-spin text-zinc-900" />
              <span className="text-xs font-bold text-zinc-400">Loading custom plans...</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="py-20 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-zinc-150 bg-zinc-50">
                <Sparkles className="size-5 text-zinc-400" />
              </div>
              <h3 className="mt-4 text-xs font-bold text-zinc-700">
                No custom plan requests match this view
              </h3>
              <p className="mt-1 text-[10px] text-zinc-400">
                Enquiries from the pricing page&apos;s custom plan card land here automatically.
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[1080px] border-collapse text-left">
              <thead>
                <tr className="border-b border-zinc-150 text-[10px] uppercase tracking-wider text-zinc-400">
                  <th className="pb-3 pl-3 font-bold">Requester</th>
                  <th className="pb-3 font-bold">Business</th>
                  <th className="pb-3 font-bold">Agreed terms</th>
                  <th className="pb-3 font-bold">Workspace</th>
                  <th className="pb-3 font-bold">Status</th>
                  <th className="pb-3 pr-3 text-right font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 text-xs text-zinc-700">
                {filteredRows.map((row) => {
                  const status = normalizeStatus(row.status);
                  const interval = normalizeBillingInterval(row.billingInterval);
                  return (
                    <tr key={row.id} className="group transition-colors hover:bg-slate-50/50">
                      <td className="py-4 pl-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-extrabold text-zinc-900">{row.name}</span>
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[9px] font-black text-zinc-600">
                              {row.referenceId}
                            </span>
                          </div>
                          <div className="text-[10px] font-semibold text-zinc-400">
                            <span>{row.email}</span>
                            <span className="mx-1.5">•</span>
                            <span>{row.phone}</span>
                          </div>
                          <span className="block text-[10px] font-semibold text-zinc-400">
                            Submitted {formatDate(row.createdAt, true)}
                          </span>
                        </div>
                      </td>

                      <td className="py-4">
                        <div className="space-y-1">
                          <span className="block font-bold text-zinc-800">{row.businessName}</span>
                          <span className="block text-[10px] font-semibold text-zinc-400">
                            {row.profession}
                          </span>
                          <span className="block text-[10px] font-semibold text-zinc-400">
                            {row.practiceSize}
                          </span>
                        </div>
                      </td>

                      <td className="py-4">
                        {row.grantedPlan ? (
                          <div className="space-y-1">
                            <span className="block font-bold text-zinc-800">
                              {row.grantedPlan} ·{" "}
                              {formatTermsLabel(row.grantedAmount ?? 0, interval)}
                            </span>
                            <span className="block text-[10px] font-semibold text-zinc-400">
                              {formatTermLabel(row.termMonths ?? defaultTermMonths(interval))} term
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] font-semibold text-zinc-400">
                            Not priced yet
                          </span>
                        )}
                      </td>

                      <td className="py-4">
                        {row.tenantId ? (
                          <div className="space-y-1">
                            <span className="block font-mono text-[11px] font-bold text-zinc-800">
                              {row.tenantId}
                            </span>
                            <span className="block text-[10px] font-semibold text-zinc-400">
                              Live plan: {row.tenantSubscriptionPlan || "—"} ·{" "}
                              {row.tenantSubscriptionStatus || "—"}
                            </span>
                            <span className="block text-[10px] font-semibold text-zinc-400">
                              Renews {formatDate(row.tenantSubscriptionExpiresAt)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] font-semibold text-zinc-400">
                            Not provisioned
                          </span>
                        )}
                      </td>

                      <td className="py-4">
                        <div className="space-y-2">
                          <StatusBadge status={status} />
                          {row.reviewedAt && (
                            <span className="block text-[10px] font-semibold text-zinc-400">
                              {status === "Active" && row.activatedAt
                                ? `Activated ${formatDate(row.activatedAt, true)}`
                                : `Reviewed ${formatDate(row.reviewedAt, true)}`}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-4 pr-3">
                        <div className="flex items-center justify-end gap-2">
                          <a
                            href={`mailto:${row.email}`}
                            title="Email requester"
                            className="rounded-xl border border-zinc-200 p-2 text-zinc-600 transition-all hover:border-zinc-300 hover:bg-zinc-50"
                          >
                            <Mail className="size-3.5" />
                          </a>
                          <a
                            href={`tel:${row.phone}`}
                            title="Call requester"
                            className="rounded-xl border border-zinc-200 p-2 text-zinc-600 transition-all hover:border-zinc-300 hover:bg-zinc-50"
                          >
                            <Phone className="size-3.5" />
                          </a>
                          {status === "PaymentPending" && row.paymentToken && (
                            <button
                              type="button"
                              title="Copy payment link"
                              onClick={() => {
                                const link = paymentLinkFor(row.paymentToken);
                                if (link)
                                  void copyToClipboard(link).then((ok) =>
                                    ok
                                      ? toast.success("Payment link copied")
                                      : toast.error("Could not copy"),
                                  );
                              }}
                              className="cursor-pointer rounded-xl border border-violet-200 p-2 text-violet-600 transition-all hover:bg-violet-50"
                            >
                              <Link2 className="size-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openReview(row)}
                            className="cursor-pointer rounded-xl bg-[#0059C6] px-3 py-2 text-[10px] font-extrabold text-white transition-all hover:bg-[#0047A0]"
                          >
                            Manage
                          </button>
                          {!row.userId && (
                            <button
                              type="button"
                              onClick={() => void handleDelete(row)}
                              disabled={deletingId === row.id}
                              title="Delete request"
                              className="cursor-pointer rounded-xl border border-zinc-200 p-2 text-zinc-400 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                            >
                              {deletingId === row.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="size-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Review / manage dialog */}
      <AnimatePresence>
        {selected && draft && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-zinc-950/60 p-3 sm:p-5 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cpp-title"
              className="my-auto flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-200/80 bg-white shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-100 bg-white px-5 py-3.5 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#0059C6]/10 text-[#0059C6]">
                    <Building className="size-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 id="cpp-title" className="text-sm font-bold text-zinc-900">
                        {selected.businessName}
                      </h3>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-zinc-600">
                        {selected.referenceId}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      {selected.name} · {selected.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <StatusBadge status={selectedStatus} />
                  <button
                    type="button"
                    onClick={closeReview}
                    aria-label="Close"
                    className="flex size-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4 text-xs">
                {/* Editable customer details */}
                {details && (
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-3.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        Customer details
                      </h4>
                      <button
                        type="button"
                        onClick={() => void handleSaveDetails()}
                        disabled={savingDetails}
                        className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-white shadow-xs transition-all hover:bg-zinc-800 disabled:opacity-50"
                      >
                        {savingDetails ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Save className="size-3" />
                        )}
                        Save details
                      </button>
                    </div>

                    <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Full name
                        </span>
                        <input
                          value={details.name}
                          onChange={(e) =>
                            setDetails((p) => (p ? { ...p, name: e.target.value } : p))
                          }
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Phone
                        </span>
                        <input
                          value={details.phone}
                          onChange={(e) =>
                            setDetails((p) => (p ? { ...p, phone: e.target.value } : p))
                          }
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Email
                        </span>
                        <input
                          type="email"
                          value={details.email}
                          onChange={(e) =>
                            setDetails((p) => (p ? { ...p, email: e.target.value } : p))
                          }
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Business name
                        </span>
                        <input
                          value={details.businessName}
                          onChange={(e) =>
                            setDetails((p) => (p ? { ...p, businessName: e.target.value } : p))
                          }
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Business type
                        </span>
                        <select
                          value={details.profession}
                          onChange={(e) =>
                            setDetails((p) => (p ? { ...p, profession: e.target.value } : p))
                          }
                          className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        >
                          {PROFESSION_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Team size
                        </span>
                        <select
                          value={details.practiceSize}
                          onChange={(e) =>
                            setDetails((p) => (p ? { ...p, practiceSize: e.target.value } : p))
                          }
                          className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        >
                          {PRACTICE_SIZE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                {/* Stated requirements */}
                {selected.requirements && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      Stated requirement
                    </span>
                    <p className="mt-1 text-xs leading-relaxed text-zinc-700">
                      {selected.requirements}
                    </p>
                  </div>
                )}

                {/* Negotiated Terms */}
                <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-3.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                        Negotiated terms
                      </h4>
                      <p className="text-[10px] text-zinc-400">
                        The granted tier unlocks features. Price feeds MRR and billing records.
                      </p>
                    </div>
                  </div>

                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                        Granted plan
                      </span>
                      <select
                        value={draft.grantedPlan}
                        onChange={(event) => {
                          const plan = event.target.value as PlanTier;
                          const listed = listPriceFor(plan);
                          setDraft((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  grantedPlan: plan,
                                  grantedAmount:
                                    listed > 0 ? String(listed) : previous.grantedAmount,
                                }
                              : previous,
                          );
                        }}
                        className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                      >
                        {PLAN_TIERS.map((tier) => (
                          <option key={tier} value={tier}>
                            {tier}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                        Billing interval
                      </span>
                      <select
                        value={draft.billingInterval}
                        onChange={(event) => {
                          const interval = event.target.value as BillingInterval;
                          setDraft((previous) =>
                            previous
                              ? {
                                  ...previous,
                                  billingInterval: interval,
                                  termMonths: String(defaultTermMonths(interval)),
                                }
                              : previous,
                          );
                        }}
                        className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                      >
                        {BILLING_INTERVALS.map((interval) => (
                          <option key={interval} value={interval}>
                            {interval === "yearly" ? "Yearly" : "Monthly"}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                        Amount per cycle (INR)
                      </span>
                      <input
                        type="number"
                        min={AMOUNT_LIMITS.min}
                        max={AMOUNT_LIMITS.max}
                        step="1"
                        value={draft.grantedAmount}
                        onChange={(event) =>
                          setDraft((previous) =>
                            previous
                              ? { ...previous, grantedAmount: event.target.value }
                              : previous,
                          )
                        }
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                        Committed term (months)
                      </span>
                      <input
                        type="number"
                        min={TERM_MONTHS_LIMITS.min}
                        max={TERM_MONTHS_LIMITS.max}
                        step="1"
                        value={draft.termMonths}
                        onChange={(event) =>
                          setDraft((previous) =>
                            previous ? { ...previous, termMonths: event.target.value } : previous,
                          )
                        }
                        className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                      />
                    </label>
                  </div>

                  {/* Financial Preview Card */}
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200/90 bg-white px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                        Preview
                      </span>
                      <span className="text-xs font-bold text-zinc-900">
                        {formatTermsLabel(draftAmount, draft.billingInterval)}
                      </span>
                      <span className="text-xs text-zinc-400">·</span>
                      <span className="text-[11px] font-medium text-zinc-500">
                        MRR:{" "}
                        <strong className="text-zinc-700 font-semibold">
                          {formatInr(monthlyEquivalent(draftAmount, draft.billingInterval))}
                        </strong>
                      </span>
                    </div>
                    {previewExpiry && (
                      <span className="text-[10px] font-medium text-zinc-500">
                        Renews {formatDate(previewExpiry.toISOString())}
                      </span>
                    )}
                  </div>

                  <label className="mt-2.5 block">
                    <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                      Internal notes
                    </span>
                    <textarea
                      rows={2}
                      value={draft.adminNotes}
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous ? { ...previous, adminNotes: event.target.value } : previous,
                        )
                      }
                      placeholder="Agreed discount, contract reference, sign-off notes..."
                      className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                    />
                  </label>
                </div>

                {/* Payment collection */}
                {(selectedStatus === "Pending" || selectedStatus === "PaymentPending") && (
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-3.5">
                    <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      <CreditCard className="size-3" /> Payment collection
                    </h4>

                    {selectedStatus === "Pending" ? (
                      <>
                        <p className="mt-0.5 text-[10px] text-zinc-400">
                          Approving provisions the workspace. Select how payment is collected:
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {PAYMENT_COLLECTION_MODES.map((mode) => {
                            const active = draft.collectionMode === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() =>
                                  setDraft((previous) =>
                                    previous ? { ...previous, collectionMode: mode } : previous,
                                  )
                                }
                                className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-all ${
                                  active
                                    ? "border-[#0059C6] bg-white ring-1 ring-[#0059C6]/20 shadow-xs"
                                    : "border-zinc-200 bg-white hover:border-zinc-300"
                                }`}
                              >
                                <span
                                  className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md ${active ? "bg-[#0059C6] text-white" : "bg-zinc-100 text-zinc-500"}`}
                                >
                                  {mode === "online" ? (
                                    <Wallet className="size-3" />
                                  ) : (
                                    <CheckCircle2 className="size-3" />
                                  )}
                                </span>
                                <span>
                                  <span className="block text-xs font-bold text-zinc-800">
                                    {mode === "online" ? "Tenant pays online" : "Mark as paid"}
                                  </span>
                                  <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
                                    {mode === "online"
                                      ? "Email secure payment link. Unlocks on payment."
                                      : "Collected offline. Unlocks workspace immediately."}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="mt-2.5 space-y-2">
                        <div className="flex items-center justify-between rounded-lg bg-violet-50/80 px-3 py-2 border border-violet-100">
                          <span className="text-xs font-semibold text-violet-900">
                            Awaiting payment of{" "}
                            <strong>{formatTermsLabel(draftAmount, draft.billingInterval)}</strong>
                          </span>
                          <span className="rounded bg-violet-100/80 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">
                            {selected.collectionMode === "manual"
                              ? "Offline collection"
                              : "Online link"}
                          </span>
                        </div>
                        {selected.paymentToken && (
                          <div className="flex items-center gap-1.5">
                            <input
                              readOnly
                              value={paymentLinkFor(selected.paymentToken) || ""}
                              className="w-full truncate rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-[10px] text-zinc-600"
                            />
                            <button
                              type="button"
                              title="Copy payment link"
                              onClick={() => {
                                const link = paymentLinkFor(selected.paymentToken);
                                if (link)
                                  void copyToClipboard(link).then((ok) =>
                                    ok
                                      ? toast.success("Link copied")
                                      : toast.error("Could not copy"),
                                  );
                              }}
                              className="shrink-0 rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-600 transition-all hover:bg-zinc-50"
                            >
                              <Copy className="size-3.5" />
                            </button>
                          </div>
                        )}
                        <p className="text-[10px] leading-relaxed text-zinc-400">
                          Use <strong>Mark as paid</strong> if payment was collected offline, or{" "}
                          <strong>Resend payment link</strong> to dispatch an email.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Provisioned workspace status */}
                {selected.tenantId && (
                  <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-3">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                      Provisioned workspace
                    </span>
                    <p className="mt-1 text-xs font-medium text-emerald-950">
                      <span className="font-mono font-bold">{selected.tenantId}</span> · live plan{" "}
                      <span className="font-semibold">
                        {selected.tenantSubscriptionPlan || "—"}
                      </span>{" "}
                      ·{" "}
                      <span className="font-semibold">
                        {selected.tenantSubscriptionStatus || "—"}
                      </span>{" "}
                      · renews {formatDate(selected.tenantSubscriptionExpiresAt)}
                    </p>
                  </div>
                )}

                {/* Collect a payment — repeatable, offline settlement for a provisioned workspace */}
                {selected.userId && collect && (
                  <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/40 p-3.5">
                    <h4 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                      <Wallet className="size-3" /> Collect a payment
                    </h4>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-zinc-400">
                      Record a payment collected offline (UPI, card machine, cash, transfer…). Each
                      entry is logged to the ledger and extends the workspace&apos;s paid access by
                      one term. Collect as many times as you need — earlier collections are kept.
                    </p>

                    <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Amount received (INR)
                        </span>
                        <input
                          type="number"
                          min={1}
                          max={AMOUNT_LIMITS.max}
                          step="1"
                          value={collect.amount}
                          onChange={(event) =>
                            setCollect((previous) =>
                              previous ? { ...previous, amount: event.target.value } : previous,
                            )
                          }
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Payment method
                        </span>
                        <select
                          value={collect.method}
                          onChange={(event) =>
                            setCollect((previous) =>
                              previous
                                ? { ...previous, method: event.target.value as ManualPaymentMethod }
                                : previous,
                            )
                          }
                          className="w-full cursor-pointer rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        >
                          {MANUAL_PAYMENT_METHODS.map((method) => (
                            <option key={method} value={method}>
                              {method}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Reference / transaction ID
                          {collect.method !== "Cash" && collect.method !== "Other" && (
                            <span className="text-red-500"> *</span>
                          )}
                        </span>
                        <input
                          value={collect.reference}
                          onChange={(event) =>
                            setCollect((previous) =>
                              previous ? { ...previous, reference: event.target.value } : previous,
                            )
                          }
                          placeholder={referenceHintForMethod(collect.method)}
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        />
                      </label>

                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-[10px] font-semibold text-zinc-500">
                          Note (optional)
                        </span>
                        <input
                          value={collect.note}
                          onChange={(event) =>
                            setCollect((previous) =>
                              previous ? { ...previous, note: event.target.value } : previous,
                            )
                          }
                          placeholder="e.g. collected at reception, partial advance…"
                          className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-800 transition-colors focus:border-[#0059C6] focus:outline-none focus:ring-2 focus:ring-[#0059C6]/10"
                        />
                      </label>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] leading-relaxed text-zinc-400">
                        Records an offline payment — this never charges a card.
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleCollectPayment()}
                        disabled={collecting}
                        className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#0059C6] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition-all hover:bg-[#0047A0] disabled:opacity-60"
                      >
                        {collecting ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-3" />
                        )}
                        Record payment
                      </button>
                    </div>

                    {/* Recent payments ledger for this workspace */}
                    <div className="mt-3 border-t border-zinc-200/70 pt-2.5">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                          <Receipt className="size-3" /> Recent payments
                        </span>
                        {paymentsLoading && (
                          <Loader2 className="size-3 animate-spin text-zinc-400" />
                        )}
                      </div>
                      {payments.length === 0 ? (
                        <p className="mt-1.5 text-[10px] text-zinc-400">
                          {paymentsLoading ? "Loading…" : "No payments recorded yet."}
                        </p>
                      ) : (
                        <ul className="mt-1.5 space-y-1">
                          {payments.map((payment) => (
                            <li
                              key={payment.id}
                              className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200/70 bg-white px-2.5 py-1.5"
                            >
                              <div className="min-w-0">
                                <span className="block text-xs font-bold text-zinc-800">
                                  {formatInr(payment.amount)}
                                  <span className="ml-1.5 font-medium text-zinc-500">
                                    · {payment.paymentMode || payment.gateway || "—"}
                                  </span>
                                </span>
                                <span className="block truncate text-[10px] text-zinc-400">
                                  {payment.cfPaymentId ? `Ref ${payment.cfPaymentId} · ` : ""}
                                  {payment.gateway === "Manual" ? "Offline · " : ""}
                                  {formatDate(payment.createdAt, true)}
                                </span>
                              </div>
                              <span
                                className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${paymentStatusTone(
                                  payment.status,
                                )}`}
                              >
                                {payment.status}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action bar */}
              <div className="space-y-2.5 border-t border-zinc-100 bg-zinc-50/80 px-5 py-3.5 shrink-0">
                {actions.length === 0 ? (
                  <p className="text-xs font-medium text-zinc-500">
                    This request is closed. No further actions are available.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {actions.map((action) => {
                      const destructive = action === "reject" || action === "suspend";
                      const primary =
                        action === "approve" || action === "recordPayment" || action === "revise";
                      const label =
                        action === "approve" && draft.collectionMode === "manual"
                          ? "Approve & mark paid"
                          : ACTION_LABEL[action];
                      return (
                        <button
                          key={action}
                          type="button"
                          onClick={() => void handleAction(action)}
                          disabled={pendingAction !== null}
                          title={ACTION_HINT[action]}
                          className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all disabled:opacity-60 ${
                            primary
                              ? "bg-[#0059C6] text-white shadow-xs hover:bg-[#0047A0]"
                              : destructive
                                ? "border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                : "border border-zinc-200 bg-white text-zinc-700 shadow-xs hover:bg-zinc-100"
                          }`}
                        >
                          {pendingAction === action && <Loader2 className="size-3 animate-spin" />}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] leading-relaxed text-zinc-400">
                  {actions.length > 0
                    ? ACTION_HINT[actions[0]]
                    : "Rejected requests are kept for the record."}{" "}
                  Every decision emails the requester automatically.
                </p>

                {/* Permanent deletion */}
                <div className="border-t border-zinc-200/80 pt-2">
                  {confirmingPurge ? (
                    <div className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] font-medium leading-relaxed text-red-800">
                        Permanently delete <strong>{selected.businessName}</strong>
                        {selected.tenantId ? ` and workspace ${selected.tenantId}` : ""}? This
                        cannot be undone.
                      </p>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          type="button"
                          onClick={() => setConfirmingPurge(false)}
                          disabled={purging}
                          className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handlePurge()}
                          disabled={purging}
                          className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          {purging && <Loader2 className="size-3 animate-spin" />}
                          Delete permanently
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingPurge(true)}
                      className="flex items-center gap-1 text-[10px] font-semibold text-red-500 transition-colors hover:text-red-700"
                    >
                      <Trash2 className="size-3" />
                      Delete this customer &amp; workspace permanently
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
