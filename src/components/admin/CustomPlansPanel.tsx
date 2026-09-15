import { useCallback, useEffect, useMemo, useState } from "react";
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
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteCustomPlanRequestServerFn,
  getCustomPlanRequestsServerFn,
  reviewCustomPlanRequestServerFn,
} from "@/lib/custom-plan-requests";
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
  monthlyEquivalent,
  normalizeBillingInterval,
  normalizeGrantedPlan,
  normalizeStatus,
  PAYMENT_COLLECTION_MODES,
  STATUS_LABEL,
  STATUS_TONE,
  TERM_MONTHS_LIMITS,
  type BillingInterval,
  type CustomPlanAction,
  type CustomPlanStatus,
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

/**
 * Super admin console for negotiated (custom) plans.
 *
 * Owns the whole lifecycle of a deal: review the enquiry, set price + term, then
 * approve — which provisions the workspace with unlimited (Enterprise) access
 * and either emails the tenant a payment link (online) or unlocks immediately
 * against an offline payment (manual). From there it can mark payment received,
 * resend the link, upgrade/downgrade, suspend, or resume. Which buttons appear
 * is derived from the shared state machine, so the UI can never offer an action
 * the server will reject.
 */
export function CustomPlansPanel({ onTenantsChanged }: { onTenantsChanged?: () => void }) {
  const [rows, setRows] = useState<CustomPlanRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CustomPlanStatus>("all");

  const [selected, setSelected] = useState<CustomPlanRequestRow | null>(null);
  const [draft, setDraft] = useState<TermsDraft | null>(null);
  const [pendingAction, setPendingAction] = useState<CustomPlanAction | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  const openReview = (row: CustomPlanRequestRow) => {
    setSelected(row);
    setDraft(draftFromRow(row));
  };

  const closeReview = () => {
    setSelected(null);
    setDraft(null);
    setPendingAction(null);
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
      <div className="space-y-6 rounded-3xl border border-zinc-200/80 bg-white p-6">
        <div className="flex flex-col gap-4 border-b border-zinc-150 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-extrabold text-zinc-900">Custom Plan Requests</h2>
            <p className="mt-0.5 text-[10px] text-zinc-400">
              Approve to provision the workspace with unlimited access, then collect payment online
              or mark it paid. Revising a live plan upgrades or downgrades that tenant immediately.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search by business, contact, ref, or workspace..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 py-2 pl-9 pr-4 text-xs font-semibold text-zinc-800 shadow-inner transition-all placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2">
              <ArrowUpDown className="size-3.5 text-zinc-400" />
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as "all" | CustomPlanStatus)
                }
                className="border-none bg-transparent pr-1 text-xs font-extrabold text-zinc-700 focus:outline-none"
              >
                <option value="all">All statuses</option>
                {CUSTOM_PLAN_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => void fetchRows()}
              disabled={loading}
              title="Refresh"
              className="flex size-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 transition-all hover:border-[#0059C6] hover:text-[#0059C6] active:scale-95"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
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
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-950/40 p-4 backdrop-blur-sm sm:items-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              role="dialog"
              aria-modal="true"
              aria-labelledby="cpp-title"
              className="my-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-5">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#0059C6]/10 text-[#0059C6]">
                    <Building className="size-4" />
                  </span>
                  <div>
                    <h3 id="cpp-title" className="text-sm font-extrabold text-zinc-900">
                      {selected.businessName}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-zinc-500">
                      <span className="font-mono font-bold">{selected.referenceId}</span> ·{" "}
                      {selected.name} · {selected.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={selectedStatus} />
                  <button
                    type="button"
                    onClick={closeReview}
                    aria-label="Close"
                    className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </div>

              <div className="max-h-[65vh] space-y-5 overflow-y-auto px-6 py-5">
                {/* Requester snapshot */}
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: "Industry", value: selected.profession },
                    { label: "Team size", value: selected.practiceSize },
                    { label: "Phone", value: selected.phone },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="rounded-xl border border-zinc-150 bg-zinc-50/60 px-3.5 py-3"
                    >
                      <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                        {item.label}
                      </span>
                      <span className="mt-1 block text-[11px] font-bold text-zinc-800">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>

                {selected.requirements && (
                  <div className="rounded-xl border border-zinc-150 bg-white px-4 py-3.5">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      Stated requirement
                    </span>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600">
                      {selected.requirements}
                    </p>
                  </div>
                )}

                {/* Terms */}
                <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                  <h4 className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-500">
                    Negotiated terms
                  </h4>
                  <p className="mt-1 text-[10px] text-zinc-400">
                    The granted tier decides which features the workspace unlocks. The price is
                    yours to set — it feeds MRR and the tenant&apos;s billing record.
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Granted plan
                      </span>
                      <select
                        value={draft.grantedPlan}
                        onChange={(event) => {
                          const plan = event.target.value as PlanTier;
                          setDraft((previous) =>
                            previous ? { ...previous, grantedPlan: plan } : previous,
                          );
                        }}
                        className="w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs font-bold text-zinc-800 focus:border-[#0059C6] focus:outline-none"
                      >
                        {PLAN_TIERS.map((tier) => (
                          <option key={tier} value={tier}>
                            {tier}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
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
                        className="w-full cursor-pointer rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs font-bold text-zinc-800 focus:border-[#0059C6] focus:outline-none"
                      >
                        {BILLING_INTERVALS.map((interval) => (
                          <option key={interval} value={interval}>
                            {interval === "yearly" ? "Yearly" : "Monthly"}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
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
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs font-bold text-zinc-800 focus:border-[#0059C6] focus:outline-none"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
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
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs font-bold text-zinc-800 focus:border-[#0059C6] focus:outline-none"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-zinc-50 px-4 py-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Preview
                    </span>
                    <span className="text-[11px] font-bold text-zinc-800">
                      {formatTermsLabel(draftAmount, draft.billingInterval)}
                    </span>
                    <span className="text-[11px] font-semibold text-zinc-500">
                      MRR contribution{" "}
                      {formatInr(monthlyEquivalent(draftAmount, draft.billingInterval))}
                    </span>
                    {previewExpiry && (
                      <span className="text-[11px] font-semibold text-zinc-500">
                        Renews {formatDate(previewExpiry.toISOString())}
                      </span>
                    )}
                  </div>

                  <label className="mt-4 block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-zinc-400">
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
                      placeholder="Agreed discount, contract reference, who signed off..."
                      className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-xs text-zinc-800 focus:border-[#0059C6] focus:outline-none"
                    />
                  </label>
                </div>

                {/* Payment collection — how the first payment is taken. The
                    choice only applies when approving a pending request; once a
                    workspace is awaiting payment the section shows live status. */}
                {(selectedStatus === "Pending" || selectedStatus === "PaymentPending") && (
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <h4 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-zinc-500">
                      <CreditCard className="size-3.5" /> Payment collection
                    </h4>

                    {selectedStatus === "Pending" ? (
                      <>
                        <p className="mt-1 text-[10px] text-zinc-400">
                          Approving provisions the workspace now. Choose how the first payment is
                          collected — access unlocks only once it is confirmed.
                        </p>
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                                className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-all ${
                                  active
                                    ? "border-[#0059C6] bg-[#0059C6]/[0.04] ring-1 ring-[#0059C6]/20"
                                    : "border-zinc-200 hover:border-zinc-300"
                                }`}
                              >
                                <span
                                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg ${active ? "bg-[#0059C6] text-white" : "bg-zinc-100 text-zinc-500"}`}
                                >
                                  {mode === "online" ? (
                                    <Wallet className="size-3.5" />
                                  ) : (
                                    <CheckCircle2 className="size-3.5" />
                                  )}
                                </span>
                                <span>
                                  <span className="block text-[11px] font-bold text-zinc-800">
                                    {mode === "online" ? "Tenant pays online" : "Mark as paid"}
                                  </span>
                                  <span className="mt-0.5 block text-[10px] leading-relaxed text-zinc-500">
                                    {mode === "online"
                                      ? "Email a secure payment link. Unlocks on payment."
                                      : "Payment collected offline. Unlocks immediately."}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <div className="flex items-center justify-between rounded-xl bg-violet-50/70 px-3.5 py-2.5">
                          <span className="text-[11px] font-bold text-violet-800">
                            Awaiting payment of{" "}
                            {formatTermsLabel(draftAmount, draft.billingInterval)}
                          </span>
                          <span className="text-[10px] font-semibold text-violet-500">
                            {selected.collectionMode === "manual" ? "Offline" : "Online link"}
                          </span>
                        </div>
                        {selected.paymentToken && (
                          <div className="flex items-center gap-2">
                            <input
                              readOnly
                              value={paymentLinkFor(selected.paymentToken) || ""}
                              className="w-full truncate rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[10px] text-zinc-600"
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
                              className="shrink-0 rounded-lg border border-zinc-200 p-2 text-zinc-600 transition-all hover:bg-zinc-50"
                            >
                              <Copy className="size-3.5" />
                            </button>
                          </div>
                        )}
                        <p className="text-[10px] leading-relaxed text-zinc-400">
                          Use <strong>Mark as paid</strong> if you collected payment offline, or{" "}
                          <strong>Resend payment link</strong> to email a fresh link.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {selected.tenantId && (
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 px-4 py-3.5">
                    <span className="block text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                      Provisioned workspace
                    </span>
                    <p className="mt-1.5 text-[11px] font-semibold text-emerald-900">
                      <span className="font-mono">{selected.tenantId}</span> · live plan{" "}
                      {selected.tenantSubscriptionPlan || "—"} ·{" "}
                      {selected.tenantSubscriptionStatus || "—"} · renews{" "}
                      {formatDate(selected.tenantSubscriptionExpiresAt)}
                    </p>
                  </div>
                )}
              </div>

              {/* Action bar — driven entirely by the shared state machine. */}
              <div className="space-y-3 border-t border-zinc-100 bg-zinc-50/60 px-6 py-5">
                {actions.length === 0 ? (
                  <p className="text-[11px] font-semibold text-zinc-500">
                    This request is closed. No further actions are available.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {actions.map((action) => {
                      const destructive = action === "reject" || action === "suspend";
                      const primary = action === "approve" || action === "recordPayment";
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
                          className={`flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2.5 text-[11px] font-extrabold transition-all disabled:opacity-60 ${
                            primary
                              ? "bg-[#0059C6] text-white hover:bg-[#0047A0]"
                              : destructive
                                ? "border border-red-200 bg-white text-red-600 hover:bg-red-50"
                                : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
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
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
