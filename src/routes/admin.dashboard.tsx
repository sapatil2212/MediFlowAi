import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Users,
  IndianRupee,
  PhoneCall,
  Activity,
  LogOut,
  Search,
  Filter,
  Sliders,
  Calendar,
  Phone,
  Plus,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Building,
  UserPlus,
  User,
  X,
  Database,
  Mail,
  Smartphone,
  ChevronRight,
  TrendingUp,
  FileText,
  Eye,
  UserCheck,
  Clipboard,
  ClipboardCheck,
  Check,
  RefreshCw,
  Play,
  Moon,
  Sun,
  Menu,
  FileSpreadsheet,
  Clock3,
  Edit2,
  Power,
  Trash2,
  ArrowLeft,
  CreditCard,
  XCircle,
  Ban
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  getSuperAdminSessionServerFn,
  getSuperAdminDashboardDataServerFn,
  updateTenantSaasServerFn,
  createTenantAdminServerFn,
  logoutSuperAdminServerFn,
  controlWhatsAppServerFn,
  getSubscriptionHistoryServerFn,
  getPaymentHistoryServerFn,
  syncAllPaymentsFromCashfreeServerFn,
  toggleTenantStatusServerFn,
  getTenantFullProfileServerFn,
  deleteTenantServerFn,
  createPaymentServerFn,
  updatePaymentServerFn,
  deletePaymentServerFn
} from "../lib/admin";
import {
  getAdminSubscriptionsServerFn,
  getAdminSubscriptionPaymentsServerFn,
  syncAllSubscriptionsFromCashfreeServerFn,
  createAdminSubscriptionServerFn,
  updateAdminSubscriptionServerFn,
  deleteAdminSubscriptionServerFn,
  createAdminSubscriptionPaymentServerFn
} from "../lib/subscription";
import {
  getDemoAppointmentsServerFn,
  updateDemoAppointmentServerFn,
  type DemoAppointmentStatus,
} from "../lib/demo";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Platform Owner Console — BookMyTime" },
      { name: "description", content: "Platform settings, billing and system monitoring." },
    ],
  }),
  component: AdminDashboardPage,
});

interface Tenant {
  id: string;
  name: string;
  email: string;
  phone: string;
  clinicName: string;
  practiceSize: string;
  tenantId: string;
  subscriptionStatus: string;
  subscriptionPlan: string;
  subscriptionExpiresAt: string | null;
  paymentMethod: string;
  paymentAmount: number;
  billingInterval: string;
  virtualPhoneNumber: string;
  callLimit: number;
  callsHandled: number;
  createdAt: string;
}

interface Metrics {
  totalTenants: number;
  totalMRR: number;
  totalCallsHandled: number;
  activePaid: number;
  trialing: number;
  totalAppointments: number;
  totalDoctors: number;
  totalSoapNotes: number;
  dbLatency: number;
  whatsappState: string;
  whatsappQrUrl: string;
  whatsappNumber: string;
  whatsappQueue: number;
  whatsappLogs: Array<{
    timestamp: string;
    recipient: string;
    message: string;
    status: "sent" | "failed";
  }>;
}

interface TrendData {
  month: string;
  count: number;
}

interface DemoAppointment {
  id: string;
  referenceId: string;
  name: string;
  email: string;
  phone: string;
  organization: string;
  city: string;
  businessType: string;
  teamSize: string;
  preferredDate: string;
  preferredTime: string;
  preferredMode: string;
  message: string | null;
  status: DemoAppointmentStatus;
  adminNotes: string | null;
  source: string;
  lastContactedAt: string | null;
  createdAt: string;
  updatedAt: string;
}


const CustomChartTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-zinc-200/80 bg-white/90 backdrop-blur-md p-3.5 shadow-xl space-y-1">
        <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">{payload[0].payload.month}</p>
        <p className="text-sm font-black text-zinc-950 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-zinc-950" />
          {payload[0].value} Signups
        </p>
      </div>
    );
  }
  return null;
};

const CustomPieTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-xl border border-zinc-200/80 bg-white/90 backdrop-blur-md p-3.5 shadow-xl space-y-1">
        <p className="text-[10px] font-extrabold text-zinc-400 uppercase tracking-wider">{payload[0].name} Tier</p>
        <p className="text-xs font-black text-zinc-955 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-zinc-800" />
          {payload[0].value} Tenants
        </p>
      </div>
    );
  }
  return null;
};

function AdminDashboardPage() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [demoAppointments, setDemoAppointments] = useState<DemoAppointment[]>([]);
  const [controllingWA, setControllingWA] = useState(false);
  const [updatingDemoId, setUpdatingDemoId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics>({
    totalTenants: 0,
    totalMRR: 0,
    totalCallsHandled: 0,
    activePaid: 0,
    trialing: 0,
    totalAppointments: 0,
    totalDoctors: 0,
    totalSoapNotes: 0,
    dbLatency: 0,
    whatsappState: "DISCONNECTED",
    whatsappQrUrl: "",
    whatsappNumber: "",
    whatsappQueue: 0,
    whatsappLogs: [],
  });

  // Active Dashboard Tab View
  const [activeTab, setActiveTab] = useState<"overview" | "registry" | "payments" | "subscriptions" | "demo">("overview");

  // Recurring subscriptions (AutoPay) admin state
  const [subscriptionRows, setSubscriptionRows] = useState<any[]>([]);
  const [subscriptionSummary, setSubscriptionSummary] = useState<{
    totalCount: number; activeCount: number; cancelledCount: number; onHoldCount: number; activeMrr: number; failedRenewals: number;
    collectedAmount: number; failedAmount: number; successCount: number;
  }>({ totalCount: 0, activeCount: 0, cancelledCount: 0, onHoldCount: 0, activeMrr: 0, failedRenewals: 0, collectedAmount: 0, failedAmount: 0, successCount: 0 });
  const [loadingSubscriptions, setLoadingSubscriptions] = useState(false);
  const [syncingSubscriptions, setSyncingSubscriptions] = useState(false);
  const [subAdminStatusFilter, setSubAdminStatusFilter] = useState("all");
  const [subAdminSearch, setSubAdminSearch] = useState("");
  // Per-subscription payment ledger modal (super admin)
  const [subPaymentsModal, setSubPaymentsModal] = useState<{ subscription: any; payments: any[] } | null>(null);
  const [loadingSubPayments, setLoadingSubPayments] = useState(false);

  const openSubscriptionPayments = async (subscriptionRef: string) => {
    setLoadingSubPayments(true);
    setSubPaymentsModal({ subscription: { subscriptionRef }, payments: [] });
    try {
      const res = await getAdminSubscriptionPaymentsServerFn({ data: { subscriptionRef } });
      setSubPaymentsModal({ subscription: res.subscription, payments: res.payments || [] });
    } catch (err: any) {
      toast.error("Failed to load subscription payments: " + err.message);
      setSubPaymentsModal(null);
    } finally {
      setLoadingSubPayments(false);
    }
  };

  // Payment History states
  const [paymentRows, setPaymentRows] = useState<any[]>([]);
  const [paymentSummary, setPaymentSummary] = useState<{
    totalCount: number; successCount: number; failedCount: number; cancelledCount: number; pendingCount: number; totalReceived: number;
    failedAmount: number; cancelledAmount: number; pendingAmount: number;
  }>({ totalCount: 0, successCount: 0, failedCount: 0, cancelledCount: 0, pendingCount: 0, totalReceived: 0, failedAmount: 0, cancelledAmount: 0, pendingAmount: 0 });
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [syncingPayments, setSyncingPayments] = useState(false);
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("all");
  const [paymentSearchQuery, setPaymentSearchQuery] = useState("");

  // Payment Dynamic Sorting State
  const [paymentSortField, setPaymentSortField] = useState<string>("createdAt");
  const [paymentSortOrder, setPaymentSortOrder] = useState<"asc" | "desc">("desc");

  // Payment CRUD Drawer / Modal States
  const [viewPaymentDetails, setViewPaymentDetails] = useState<any | null>(null);
  const [isRecordPaymentOpen, setIsRecordPaymentOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<any | null>(null);
  const [deletingPayment, setDeletingPayment] = useState<any | null>(null);

  // Subscription Dynamic Sorting State
  const [subSortField, setSubSortField] = useState<string>("createdAt");
  const [subSortOrder, setSubSortOrder] = useState<"asc" | "desc">("desc");

  // Subscription CRUD Drawer / Modal States
  const [viewSubDetails, setViewSubDetails] = useState<any | null>(null);
  const [isProvisionSubOpen, setIsProvisionSubOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<any | null>(null);
  const [logPaymentSub, setLogPaymentSub] = useState<any | null>(null);
  const [deletingSub, setDeletingSub] = useState<any | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [demoSearchQuery, setDemoSearchQuery] = useState("");
  const [demoStatusFilter, setDemoStatusFilter] = useState("all");

  // Edit Drawer States
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [editStatus, setEditStatus] = useState("Trialing");
  const [editPlan, setEditPlan] = useState("Trial");
  const [editExpiry, setEditExpiry] = useState("");
  const [editPaymentMethod, setEditPaymentMethod] = useState("None");
    const [editPaymentAmount, setEditPaymentAmount] = useState(0);
  const [editBillingInterval, setEditBillingInterval] = useState("monthly");
  const [updating, setUpdating] = useState(false);
  const [subHistory, setSubHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [togglingTenantId, setTogglingTenantId] = useState<string | null>(null);
  
  // Delete Modal States
  const [deletingTenant, setDeletingTenant] = useState<Tenant | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Full Profile State
  const [selectedTenantProfile, setSelectedTenantProfile] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);

  // Add Tenant Modal States
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addClinicName, setAddClinicName] = useState("");
  const [addPracticeSize, setAddPracticeSize] = useState("1-3 providers");
  const [addPassword, setAddPassword] = useState("clinic123");
  const [creating, setCreating] = useState(false);
  const [createdResult, setCreatedResult] = useState<any>(null);

  // View Subscription payments ledger state
  const [viewSubPayments, setViewSubPayments] = useState<any[]>([]);
  const [loadingViewSubPayments, setLoadingViewSubPayments] = useState(false);

  // States for Recording Manual Payment
  const [addPayTenantId, setAddPayTenantId] = useState("");
  const [addPayPlan, setAddPayPlan] = useState("Pro");
  const [addPayAmount, setAddPayAmount] = useState(0);
  const [addPayStatus, setAddPayStatus] = useState("SUCCESS");
  const [addPayMethod, setAddPayMethod] = useState("UPI");
  const [addPayName, setAddPayName] = useState("");
  const [addPayEmail, setAddPayEmail] = useState("");
  const [addPayPhone, setAddPayPhone] = useState("");
  const [addPayDate, setAddPayDate] = useState("");

  // States for Editing Payment
  const [editPayAmount, setEditPayAmount] = useState(0);
  const [editPayStatus, setEditPayStatus] = useState("SUCCESS");
  const [editPayMethod, setEditPayMethod] = useState("UPI");
  const [editPayReason, setEditPayReason] = useState("");
  const [editPayName, setEditPayName] = useState("");
  const [editPayEmail, setEditPayEmail] = useState("");
  const [editPayPhone, setEditPayPhone] = useState("");

  // States for Provisioning Subscription
  const [addSubTenantId, setAddSubTenantId] = useState("");
  const [addSubPlan, setAddSubPlan] = useState("Pro");
  const [addSubAmount, setAddSubAmount] = useState(0);
  const [addSubStatus, setAddSubStatus] = useState("ACTIVE");
  const [addSubInterval, setAddSubInterval] = useState("MONTH");
  const [addSubIntervals, setAddSubIntervals] = useState(1);
  const [addSubNextCharge, setAddSubNextCharge] = useState("");
  const [addSubPeriodStart, setAddSubPeriodStart] = useState("");
  const [addSubPeriodEnd, setAddSubPeriodEnd] = useState("");
  const [addSubName, setAddSubName] = useState("");
  const [addSubEmail, setAddSubEmail] = useState("");
  const [addSubPhone, setAddSubPhone] = useState("");

  // States for Editing Subscription
  const [editSubPlan, setEditSubPlan] = useState("Pro");
  const [editSubAmount, setEditSubAmount] = useState(0);
  const [editSubStatus, setEditSubStatus] = useState("ACTIVE");
  const [editSubInterval, setEditSubInterval] = useState("MONTH");
  const [editSubIntervals, setEditSubIntervals] = useState(1);
  const [editSubNextCharge, setEditSubNextCharge] = useState("");
  const [editSubPeriodStart, setEditSubPeriodStart] = useState("");
  const [editSubPeriodEnd, setEditSubPeriodEnd] = useState("");
  const [editSubCancelAtEnd, setEditSubCancelAtEnd] = useState(0);
  const [editSubName, setEditSubName] = useState("");
  const [editSubEmail, setEditSubEmail] = useState("");
  const [editSubPhone, setEditSubPhone] = useState("");

  // States for Logging Subscription Payment
  const [logPayAmount, setLogPayAmount] = useState(0);
  const [logPayStatus, setLogPayStatus] = useState("SUCCESS");
  const [logPayMethod, setLogPayMethod] = useState("UPI");
  const [logPayType, setLogPayType] = useState("CHARGE");
  const [logPayDate, setLogPayDate] = useState("");
  const [logPayRemarks, setLogPayRemarks] = useState("");

  // Load payments linked to the subscription when viewing sub details
  useEffect(() => {
    if (viewSubDetails) {
      setLoadingViewSubPayments(true);
      getAdminSubscriptionPaymentsServerFn({ data: { subscriptionRef: viewSubDetails.subscriptionRef } })
        .then(res => setViewSubPayments(res.payments || []))
        .catch(err => toast.error("Failed to load payments ledger: " + err.message))
        .finally(() => setLoadingViewSubPayments(false));
    } else {
      setViewSubPayments([]);
    }
  }, [viewSubDetails]);

  // Set default values for add/edit states on modal trigger
  useEffect(() => {
    if (editingPayment) {
      setEditPayAmount(Number(editingPayment.amount) || 0);
      setEditPayStatus(editingPayment.status);
      setEditPayMethod(editingPayment.paymentMode || "UPI");
      setEditPayReason(editingPayment.failureReason || "");
      setEditPayName(editingPayment.customerName || "");
      setEditPayEmail(editingPayment.customerEmail || "");
      setEditPayPhone(editingPayment.customerPhone || "");
    }
  }, [editingPayment]);

  useEffect(() => {
    if (editingSub) {
      setEditSubPlan(editingSub.planTier);
      setEditSubAmount(Number(editingSub.amount) || 0);
      setEditSubStatus(editingSub.status);
      setEditSubInterval(editingSub.intervalType || "MONTH");
      setEditSubIntervals(Number(editingSub.intervals) || 1);
      setEditSubNextCharge(editingSub.nextChargeAt ? new Date(editingSub.nextChargeAt).toISOString().substring(0, 10) : "");
      setEditSubPeriodStart(editingSub.currentPeriodStart ? new Date(editingSub.currentPeriodStart).toISOString().substring(0, 10) : "");
      setEditSubPeriodEnd(editingSub.currentPeriodEnd ? new Date(editingSub.currentPeriodEnd).toISOString().substring(0, 10) : "");
      setEditSubCancelAtEnd(Number(editingSub.cancelAtPeriodEnd) || 0);
      setEditSubName(editingSub.customerName || "");
      setEditSubEmail(editingSub.customerEmail || "");
      setEditSubPhone(editingSub.customerPhone || "");
    }
  }, [editingSub]);

  useEffect(() => {
    if (logPaymentSub) {
      setLogPayAmount(Number(logPaymentSub.amount) || 0);
      setLogPayStatus("SUCCESS");
      setLogPayMethod("UPI");
      setLogPayType("CHARGE");
      setLogPayDate("");
      setLogPayRemarks("Manual charge entry");
    }
  }, [logPaymentSub]);

  // Handlers for payments CRUD
  const handleRecordPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addPayTenantId) {
      toast.error("Please select a tenant clinic");
      return;
    }
    try {
      await createPaymentServerFn({
        data: {
          tenantId: addPayTenantId,
          plan: addPayPlan,
          amount: Number(addPayAmount),
          status: addPayStatus,
          paymentMode: addPayMethod,
          customerName: addPayName || undefined,
          customerEmail: addPayEmail || undefined,
          customerPhone: addPayPhone || undefined,
          createdAt: addPayDate || undefined,
        }
      });
      toast.success("Offline payment recorded successfully!");
      setIsRecordPaymentOpen(false);
      fetchPaymentHistory();
      fetchDashboardData();
      // Reset state
      setAddPayTenantId("");
      setAddPayAmount(0);
      setAddPayName("");
      setAddPayEmail("");
      setAddPayPhone("");
      setAddPayDate("");
    } catch (err: any) {
      toast.error("Failed to record payment: " + err.message);
    }
  };

  const handleEditPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayment) return;
    try {
      await updatePaymentServerFn({
        data: {
          id: editingPayment.id,
          type: editingPayment.type,
          amount: Number(editPayAmount),
          status: editPayStatus,
          paymentMode: editPayMethod,
          failureReason: editPayReason || undefined,
          customerName: editPayName || undefined,
          customerEmail: editPayEmail || undefined,
          customerPhone: editPayPhone || undefined,
        }
      });
      toast.success("Payment log updated successfully!");
      setEditingPayment(null);
      fetchPaymentHistory();
      fetchDashboardData();
    } catch (err: any) {
      toast.error("Failed to update payment log: " + err.message);
    }
  };

  const handleDeletePaymentSubmit = async () => {
    if (!deletingPayment) return;
    try {
      await deletePaymentServerFn({
        data: {
          id: deletingPayment.id,
          type: deletingPayment.type,
        }
      });
      toast.success("Payment log deleted successfully");
      setDeletingPayment(null);
      fetchPaymentHistory();
      fetchDashboardData();
    } catch (err: any) {
      toast.error("Failed to delete payment log: " + err.message);
    }
  };

  // Handlers for subscription CRUD
  const handleProvisionSubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addSubTenantId) {
      toast.error("Please select a tenant clinic");
      return;
    }
    try {
      await createAdminSubscriptionServerFn({
        data: {
          tenantId: addSubTenantId,
          planTier: addSubPlan,
          amount: Number(addSubAmount),
          status: addSubStatus,
          intervalType: addSubInterval,
          intervals: Number(addSubIntervals),
          nextChargeAt: addSubNextCharge || null,
          currentPeriodStart: addSubPeriodStart || null,
          currentPeriodEnd: addSubPeriodEnd || null,
          customerName: addSubName || undefined,
          customerEmail: addSubEmail || undefined,
          customerPhone: addSubPhone || undefined,
        }
      });
      toast.success("Custom subscription provisioned successfully!");
      setIsProvisionSubOpen(false);
      fetchAdminSubscriptions();
      fetchDashboardData();
      // Reset state
      setAddSubTenantId("");
      setAddSubAmount(0);
      setAddSubName("");
      setAddSubEmail("");
      setAddSubPhone("");
      setAddSubNextCharge("");
      setAddSubPeriodStart("");
      setAddSubPeriodEnd("");
    } catch (err: any) {
      toast.error("Failed to provision subscription: " + err.message);
    }
  };

  const handleEditSubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSub) return;
    try {
      await updateAdminSubscriptionServerFn({
        data: {
          id: editingSub.id,
          planTier: editSubPlan,
          amount: Number(editSubAmount),
          status: editSubStatus,
          intervalType: editSubInterval,
          intervals: Number(editSubIntervals),
          nextChargeAt: editSubNextCharge || null,
          currentPeriodStart: editSubPeriodStart || null,
          currentPeriodEnd: editSubPeriodEnd || null,
          cancelAtPeriodEnd: editSubCancelAtEnd,
          customerName: editSubName || undefined,
          customerEmail: editSubEmail || undefined,
          customerPhone: editSubPhone || undefined,
        }
      });
      toast.success("Subscription updated successfully!");
      setEditingSub(null);
      fetchAdminSubscriptions();
      fetchDashboardData();
    } catch (err: any) {
      toast.error("Failed to update subscription: " + err.message);
    }
  };

  const handleLogPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logPaymentSub) return;
    try {
      await createAdminSubscriptionPaymentServerFn({
        data: {
          subscriptionRef: logPaymentSub.subscriptionRef,
          amount: Number(logPayAmount),
          status: logPayStatus,
          paymentMethod: logPayMethod,
          paymentType: logPayType,
          paidAt: logPayDate || null,
          remarks: logPayRemarks || null,
        }
      });
      toast.success("Cycle payment logged successfully!");
      setLogPaymentSub(null);
      fetchAdminSubscriptions();
      fetchDashboardData();
    } catch (err: any) {
      toast.error("Failed to log payment: " + err.message);
    }
  };

  const handleDeleteSubSubmit = async () => {
    if (!deletingSub) return;
    try {
      await deleteAdminSubscriptionServerFn({
        data: {
          id: deletingSub.id,
        }
      });
      toast.success("Subscription deleted successfully");
      setDeletingSub(null);
      fetchAdminSubscriptions();
      fetchDashboardData();
    } catch (err: any) {
      toast.error("Failed to delete subscription: " + err.message);
    }
  };

  // Clipboard copy feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handlePaymentSort = (field: string) => {
    if (paymentSortField === field) {
      setPaymentSortOrder(paymentSortOrder === "asc" ? "desc" : "asc");
    } else {
      setPaymentSortField(field);
      setPaymentSortOrder("desc");
    }
  };

  const handleSubSort = (field: string) => {
    if (subSortField === field) {
      setSubSortOrder(subSortOrder === "asc" ? "desc" : "asc");
    } else {
      setSubSortField(field);
      setSubSortOrder("desc");
    }
  };

  // Authenticate Admin
  useEffect(() => {
    async function checkAuth() {
      try {
        const session = await getSuperAdminSessionServerFn();
        if (!session) {
          window.location.href = "/admin/login";
        } else {
          setAdmin(session);
          fetchDashboardData();
        }
      } catch (err) {
        window.location.href = "/admin/login";
      } finally {
        setLoadingSession(false);
      }
    }
    checkAuth();
  }, []);

  const fetchDashboardData = async () => {
    setLoadingData(true);
    try {
      const [data, demoData] = await Promise.all([
        getSuperAdminDashboardDataServerFn(),
        getDemoAppointmentsServerFn(),
      ]);
      setTenants(data.tenants);
      setTrends(data.signupTrends || []);
      setMetrics(data.metrics);
      setDemoAppointments(demoData || []);
    } catch (err: any) {
      toast.error("Failed to load dashboard metrics: " + err.message);
    } finally {
      setLoadingData(false);
    }
  };

  const fetchPaymentHistory = async () => {
    setLoadingPayments(true);
    try {
      const res = await getPaymentHistoryServerFn({
        data: {
          status: paymentStatusFilter === "all" ? undefined : paymentStatusFilter,
          search: paymentSearchQuery || undefined,
        },
      });
      setPaymentRows(res.rows || []);
      setPaymentSummary(res.summary);
    } catch (err: any) {
      toast.error("Failed to load payment history: " + err.message);
    } finally {
      setLoadingPayments(false);
    }
  };

  // Generate (view or download) a branded PDF invoice for a PaymentHistory row.
  const openPaymentInvoice = async (p: any, mode: "view" | "download") => {
    try {
      const { viewInvoice, downloadInvoice } = await import("../lib/pdf-invoice");
      const data = {
        clinicName: p.clinicName,
        customerName: p.customerName,
        customerEmail: p.customerEmail,
        customerPhone: p.customerPhone,
        plan: p.plan,
        amount: Number(p.amount),
        currency: p.currency,
        status: p.status,
        paymentMethod: p.paymentMode,
        transactionType: "One-time Payment",
        cfPaymentId: p.cfPaymentId,
        cfOrderId: p.orderId,
        transactionRef: p.id,
        paidAt: p.updatedAt || p.createdAt,
        createdAt: p.createdAt,
      };
      if (mode === "view") await viewInvoice(data);
      else await downloadInvoice(data);
    } catch (err: any) {
      console.error("[Invoice] generation failed:", err);
      toast.error("Could not generate invoice: " + err.message);
    }
  };

  // Reconcile every non-terminal payment against Cashfree, then refresh.
  const syncPaymentsFromCashfree = async () => {
    setSyncingPayments(true);
    try {
      const res = await syncAllPaymentsFromCashfreeServerFn();
      console.log("[AdminSync] Payments reconciled:", res);
      const backfillNote = res.backfilled ? `${res.backfilled} recovered from accounts, ` : "";
      toast.success(`${backfillNote}synced ${res.reconciled}/${res.scanned} pending${res.promoted ? ` — ${res.promoted} now paid` : ""}`);
      await fetchPaymentHistory();
    } catch (err: any) {
      console.error("[AdminSync] Payment sync failed:", err);
      toast.error("Cashfree payment sync failed: " + err.message);
    } finally {
      setSyncingPayments(false);
    }
  };

  // Load payment history when the tab is opened or filters change.
  useEffect(() => {
    if (activeTab === "payments") {
      fetchPaymentHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, paymentStatusFilter]);

  const fetchAdminSubscriptions = async () => {
    setLoadingSubscriptions(true);
    try {
      const res = await getAdminSubscriptionsServerFn({
        data: {
          status: subAdminStatusFilter === "all" ? undefined : subAdminStatusFilter,
          search: subAdminSearch || undefined,
        },
      });
      setSubscriptionRows(res.rows || []);
      setSubscriptionSummary(res.summary);
    } catch (err: any) {
      toast.error("Failed to load subscriptions: " + err.message);
    } finally {
      setLoadingSubscriptions(false);
    }
  };

  // Reconcile every subscription + its payment ledger against Cashfree, then refresh.
  const syncSubscriptionsFromCashfree = async () => {
    setSyncingSubscriptions(true);
    try {
      const res = await syncAllSubscriptionsFromCashfreeServerFn();
      console.log("[AdminSync] Subscriptions reconciled:", res);
      toast.success(`Synced ${res.reconciled}/${res.scanned} subscriptions — ${res.paymentsSynced} payments recorded`);
      await fetchAdminSubscriptions();
    } catch (err: any) {
      console.error("[AdminSync] Subscription sync failed:", err);
      toast.error("Cashfree subscription sync failed: " + err.message);
    } finally {
      setSyncingSubscriptions(false);
    }
  };

  useEffect(() => {
    if (activeTab === "subscriptions") {
      fetchAdminSubscriptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, subAdminStatusFilter]);

  const handleLogout = async () => {
    try {
      await logoutSuperAdminServerFn();
      toast.success("Successfully logged out from administrative console.");
      setTimeout(() => {
        window.location.href = "/admin/login";
      }, 1000);
    } catch (err: any) {
      toast.error("Failed to log out: " + err.message);
    }
  };

  const handleToggleStatus = async (t: Tenant) => {
    setTogglingTenantId(t.id);
    try {
      const res = await toggleTenantStatusServerFn({ data: { id: t.id } });
      setTenants((prev) => prev.map((item) => item.id === t.id ? { ...item, subscriptionStatus: res.newStatus } : item));
    } catch (err: any) {
      toast.error(err.message || "Failed to toggle status.");
    } finally {
      setTogglingTenantId(null);
    }
  };

  const handleDeleteTenant = (tenant: Tenant) => {
    setDeletingTenant(tenant);
  };

  const executeDeleteTenant = async () => {
    if (!deletingTenant) return;
    setIsDeleting(true);
    try {
      await deleteTenantServerFn({ data: { id: deletingTenant.id } });
      toast.success("Tenant deleted successfully");
      setDeletingTenant(null);
      fetchDashboardData();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete tenant");
    } finally {
      setIsDeleting(false);
    }
  };

  // WhatsApp engine trigger action
  const handleControlWhatsApp = async (action: "disconnect" | "initialize") => {
    setControllingWA(true);
    try {
      await controlWhatsAppServerFn({ data: { action } });
      toast.success(`WhatsApp service action [${action}] triggered successfully.`);
      // Delay fetch to let microservice process action
      setTimeout(fetchDashboardData, 1500);
    } catch (err: any) {
      toast.error("Failed to execute WhatsApp action: " + err.message);
    } finally {
      setControllingWA(false);
    }
  };

  // Open Full Profile View
  const openTenantProfile = async (t: Tenant) => {
    setEditingTenant(t);
    setEditStatus(t.subscriptionStatus);
    setEditPlan(t.subscriptionPlan);
    
    let expiryVal = "";
    if (t.subscriptionExpiresAt) {
      if (typeof t.subscriptionExpiresAt === "string") {
        expiryVal = t.subscriptionExpiresAt.substring(0, 10);
      } else if ((t.subscriptionExpiresAt as any) instanceof Date || Object.prototype.toString.call(t.subscriptionExpiresAt) === '[object Date]') {
        expiryVal = new Date(t.subscriptionExpiresAt).toISOString().substring(0, 10);
      }
    }
    setEditExpiry(expiryVal);
    setEditPaymentMethod(t.paymentMethod);
    setEditPaymentAmount(t.paymentAmount);
    setEditBillingInterval(t.billingInterval);

    setLoadingProfile(true);
    setSelectedTenantProfile(null);
    try {
      const profileData = await getTenantFullProfileServerFn({ data: t.id });
      setSelectedTenantProfile(profileData);
    } catch (err: any) {
      toast.error("Failed to load tenant profile: " + err.message);
    } finally {
      setLoadingProfile(false);
    }
  };

  // Submit Edit Form
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTenant) return;
    setUpdating(true);
    try {
      await updateTenantSaasServerFn({
        data: {
          id: editingTenant.id,
          subscriptionStatus: editStatus,
          subscriptionPlan: editPlan,
          subscriptionExpiresAt: editExpiry || null,
          paymentMethod: editPaymentMethod,
          paymentAmount: Number(editPaymentAmount),
          billingInterval: editBillingInterval,
          virtualPhoneNumber: editingTenant.virtualPhoneNumber,
          callLimit: editingTenant.callLimit,
          callsHandled: editingTenant.callsHandled
        }
      });
      toast.success(`Successfully updated ${editingTenant.clinicName} SaaS metrics!`);
      setEditingTenant(null);
      fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || "Failed to update configuration.");
    } finally {
      setUpdating(false);
    }
  };

  // Submit Create Form
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await createTenantAdminServerFn({
        data: {
          name: addName,
          email: addEmail,
          phone: addPhone,
          clinicName: addClinicName,
          practiceSize: addPracticeSize,
          password: addPassword
        }
      });
      setCreatedResult(res);
      toast.success("Tenant registered successfully!");
      // Reset form
      setAddName("");
      setAddEmail("");
      setAddPhone("");
      setAddClinicName("");
      fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || "Failed to provision new tenant.");
    } finally {
      setCreating(false);
    }
  };

  // Copy to clipboard helper
  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    toast.success("Copied to clipboard!");
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Generate initials for avatar
  const getInitials = (name: string) => {
    return name.substring(0, 2).toUpperCase();
  };

  // Generate dynamic color class for clinic initial avatar
  const getColorClass = (name: string) => {
    const colors = [
      "bg-zinc-50 text-zinc-700 border-zinc-200",
      "bg-zinc-100 text-zinc-800 border-zinc-300",
      "bg-slate-50 text-slate-700 border-slate-200",
      "bg-slate-100 text-slate-800 border-slate-300",
    ];
    const sum = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return colors[sum % colors.length];
  };

  const formatCurrencyInr = (amount: number) =>
    `₹${Number(amount || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const formatDate = (value: string | null, withTime = false) => {
    if (!value) return "Not set";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(
      "en-IN",
      withTime
        ? {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
          }
        : {
            day: "numeric",
            month: "short",
            year: "numeric",
          }
    );
  };

  const getDaysLeft = (value: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return Math.ceil((parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const handleDemoStatusUpdate = async (demo: DemoAppointment, status: DemoAppointmentStatus) => {
    setUpdatingDemoId(demo.id);
    try {
      await updateDemoAppointmentServerFn({
        data: {
          id: demo.id,
          status,
          adminNotes: demo.adminNotes || "",
        },
      });
      setDemoAppointments((prev) =>
        prev.map((item) =>
          item.id === demo.id
            ? {
                ...item,
                status,
                lastContactedAt:
                  status === "Contacted" || status === "Scheduled" || status === "Completed"
                    ? new Date().toISOString()
                    : item.lastContactedAt,
                updatedAt: new Date().toISOString(),
              }
            : item
        )
      );
      toast.success(`Demo request ${demo.referenceId} marked as ${status}.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to update demo request.");
    } finally {
      setUpdatingDemoId(null);
    }
  };

  // Search and filter list
  const filteredTenants = tenants.filter((t) => {
    const queryMatch =
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.clinicName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.tenantId.toLowerCase().includes(searchQuery.toLowerCase());

    const planMatch = planFilter === "all" || t.subscriptionPlan.toLowerCase() === planFilter.toLowerCase();
    const statusMatch = statusFilter === "all" || t.subscriptionStatus.toLowerCase() === statusFilter.toLowerCase();

    return queryMatch && planMatch && statusMatch;
  });

  const filteredDemoAppointments = demoAppointments.filter((item) => {
    const query = demoSearchQuery.trim().toLowerCase();
    const queryMatch =
      !query ||
      item.name.toLowerCase().includes(query) ||
      item.organization.toLowerCase().includes(query) ||
      item.email.toLowerCase().includes(query) ||
      item.phone.toLowerCase().includes(query) ||
      item.referenceId.toLowerCase().includes(query);

    const statusMatch =
      demoStatusFilter === "all" || item.status.toLowerCase() === demoStatusFilter.toLowerCase();

    return queryMatch && statusMatch;
  });

  const demoSummary = {
    total: demoAppointments.length,
    fresh: demoAppointments.filter((item) => item.status === "New").length,
    contacted: demoAppointments.filter((item) => item.status === "Contacted").length,
    scheduled: demoAppointments.filter((item) => item.status === "Scheduled").length,
  };

  // Calculate SVG Coordinates dynamically based on real trends from database
  const maxTrendCount = Math.max(...trends.map(t => t.count), 1);
  const chartPoints = trends.map((t, idx) => {
  const x = idx * 20; // 0, 20, 40, 60, 80, 100 for 6 months
    const y = 100 - ((t.count / maxTrendCount) * 65 + 15); // Scale y between 15% and 80% height
    return { x, y, count: t.count, month: t.month };
  });

  const svgLinePath = chartPoints.length > 0 ? `M ${chartPoints.map(p => `${p.x} ${p.y}`).join(" L ")}` : "";

  // Calculate Plan Distribution for Pie Chart
  const planCounts = tenants.reduce((acc: Record<string, number>, t) => {
    const plan = t.subscriptionPlan || "Trial";
    acc[plan] = (acc[plan] || 0) + 1;
    return acc;
  }, {});
  
  const planData = Object.keys(planCounts).map((plan) => ({
    name: plan,
    value: planCounts[plan],
  }));

  // Computed sorted payments
  const sortedPaymentRows = [...paymentRows].sort((a, b) => {
    let valA = a[paymentSortField];
    let valB = b[paymentSortField];

    if (paymentSortField === "customerName") {
      valA = a.customerName || a.clinicName || "";
      valB = b.customerName || b.clinicName || "";
    } else if (paymentSortField === "amount") {
      valA = Number(a.amount) || 0;
      valB = Number(b.amount) || 0;
    } else if (paymentSortField === "createdAt") {
      valA = new Date(a.createdAt).getTime();
      valB = new Date(b.createdAt).getTime();
    }

    if (valA === undefined || valA === null) valA = "";
    if (valB === undefined || valB === null) valB = "";

    if (typeof valA === "string") valA = valA.toLowerCase();
    if (typeof valB === "string") valB = valB.toLowerCase();

    if (valA < valB) return paymentSortOrder === "asc" ? -1 : 1;
    if (valA > valB) return paymentSortOrder === "asc" ? 1 : -1;
    return 0;
  });

  // Computed sorted subscriptions
  const sortedSubscriptionRows = [...subscriptionRows].sort((a, b) => {
    let valA = a[subSortField];
    let valB = b[subSortField];

    if (subSortField === "clinicName") {
      valA = a.clinicName || a.customerName || "";
      valB = b.clinicName || b.customerName || "";
    } else if (subSortField === "amount") {
      valA = Number(a.amount) || 0;
      valB = Number(b.amount) || 0;
    } else if (subSortField === "createdAt") {
      valA = new Date(a.createdAt).getTime();
      valB = new Date(b.createdAt).getTime();
    }

    if (valA === undefined || valA === null) valA = "";
    if (valB === undefined || valB === null) valB = "";

    if (typeof valA === "string") valA = valA.toLowerCase();
    if (typeof valB === "string") valB = valB.toLowerCase();

    if (valA < valB) return subSortOrder === "asc" ? -1 : 1;
    if (valA > valB) return subSortOrder === "asc" ? 1 : -1;
    return 0;
  });

  const PIE_COLORS = ["rgb(24, 24, 27)", "rgb(5, 150, 105)", "rgb(161, 161, 170)", "rgb(228, 228, 231)"];  if (loadingSession) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 text-zinc-800 font-sans">
        <div className="relative flex items-center justify-center mb-6">
          <div className="absolute h-14 w-14 animate-ping rounded-full bg-zinc-100" />
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 shadow-md">
            <Activity className="h-5 w-5 text-white" />
          </div>
        </div>
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 animate-pulse">
          Verifying administrative access keys...
        </h2>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-zinc-50 font-sans text-zinc-900 relative">

      {/* ── Left Sidebar ── */}
      <aside className="hidden w-60 shrink-0 border-r border-zinc-200 bg-white p-4 flex-col justify-between md:flex">
        <div className="space-y-6">
          {/* Brand */}
          <div className="flex items-center gap-2.5 px-2 pt-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-950 text-white shadow-sm">
              <Sliders className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-black tracking-tight text-zinc-950 leading-none">Control Panel</p>
              <p className="text-[9px] font-medium text-zinc-400 mt-0.5">SaaS Administration</p>
            </div>
          </div>

          {/* Nav Items */}
          <nav className="space-y-0.5">
            {[
              { id: "overview",    label: "Overview",     icon: TrendingUp },
              { id: "registry",   label: "Tenants",      icon: Building },
              { id: "payments",   label: "Payments",     icon: CreditCard },
              { id: "subscriptions", label: "Subscriptions", icon: RefreshCw },
              { id: "demo",       label: "Demos",        icon: Calendar },
            ].map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    if (tab.id === "registry") { setSearchQuery(""); setPlanFilter("all"); setStatusFilter("all"); }
                  }}
                  className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold transition-all cursor-pointer ${
                    active
                      ? "bg-zinc-950 text-white shadow-sm"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer — Admin user card */}
        <div className="space-y-3">
          <div className="w-full rounded-2xl bg-zinc-50 border border-zinc-200/60 p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-zinc-200 border border-zinc-300 flex items-center justify-center text-zinc-700 font-bold text-xs shrink-0">
              {getInitials((admin?.name || "BookMyTime Admin").replace(/MediFlow/gi, "BookMyTime"))}
            </div>
            <div className="overflow-hidden flex-1 min-w-0">
              <h4 className="text-xs font-bold text-zinc-900 truncate leading-tight">{(admin?.name || "BookMyTime Admin").replace(/MediFlow/gi, "BookMyTime")}</h4>
              <span className="text-[9px] font-medium text-zinc-400 truncate block">Platform Administrator</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main Content Area ── */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header Strip */}
        <header className="h-16 border-b border-zinc-200 bg-white px-4 sm:px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {/* Page breadcrumb */}
            <div className="flex">
              <span className="text-xs font-semibold text-zinc-500">
                {activeTab === "overview" && "Platform Overview"}
                {activeTab === "registry" && "Tenants Directory"}
                {activeTab === "payments" && "Payment History"}
                {activeTab === "subscriptions" && "Recurring Subscriptions"}
                {activeTab === "demo" && "Demo Appointments"}
              </span>
            </div>
          </div>

          {/* Right-side controls */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={fetchDashboardData}
              disabled={loadingData}
              className="flex items-center justify-center size-9 border border-zinc-200 bg-white rounded-xl text-zinc-500 hover:text-zinc-800 transition-colors active:scale-[0.98] cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={`size-4 ${loadingData ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 py-6 space-y-6">

            {/* Page Title */}
            <div className="flex items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-black tracking-tight text-zinc-950">
                  {activeTab === "overview" && "Platform Overview"}
                  {activeTab === "registry" && "Tenants Directory"}
                  {activeTab === "payments" && "Payment History"}
                  {activeTab === "subscriptions" && "Recurring Subscriptions"}
                  {activeTab === "demo" && "Demo Pipeline"}
                </h1>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {activeTab === "overview" && "Real-time metrics, signup distribution, and telemetry snapshots."}
                  {activeTab === "registry" && "Manage clinician accounts, billing status, and plan packages."}
                  {activeTab === "payments" && "Every Cashfree payment attempt — received, failed, cancelled, and pending."}
                  {activeTab === "subscriptions" && "Cashfree AutoPay mandates — active, cancelled, on-hold, and renewal health."}
                  {activeTab === "demo" && "Track incoming public demo requests, follow-up status, and booking intent."}
                </p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-100 px-2.5 py-1.5 rounded-full shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Sync
              </span>
            </div>

            {/* VIEW: OVERVIEW */}
            {activeTab === "overview" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 relative overflow-hidden group hover:shadow-sm transition-all">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.06] pointer-events-none">
                      <IndianRupee className="size-16 text-zinc-900" />
                    </div>
                    <span className="block text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Recurring Revenue</span>
                    <span className="block text-2xl font-black text-zinc-950 tracking-tight mt-2">{formatCurrencyInr(metrics.totalMRR)}</span>
                    <span className="block text-[9px] text-emerald-600 font-bold mt-1.5 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                      Live monthly run rate
                    </span>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 relative overflow-hidden group hover:shadow-sm transition-all">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.06] pointer-events-none">
                      <Building className="size-16 text-zinc-900" />
                    </div>
                    <span className="block text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Tenants Provisioned</span>
                    <span className="block text-2xl font-black text-zinc-950 tracking-tight mt-2">{metrics.totalTenants}</span>
                    <div className="flex gap-2 text-[9px] font-bold mt-1.5">
                      <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded border border-emerald-100">{metrics.activePaid} Paid</span>
                      <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded border border-zinc-200">{metrics.trialing} Free</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 relative overflow-hidden group hover:shadow-sm transition-all">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.06] pointer-events-none">
                      <PhoneCall className="size-16 text-zinc-900" />
                    </div>
                    <span className="block text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Calls Logged</span>
                    <span className="block text-2xl font-black text-zinc-950 tracking-tight mt-2">{metrics.totalCallsHandled.toLocaleString()}</span>
                    <span className="block text-[9px] text-zinc-500 font-bold mt-1.5">AI Telephony outbox volume</span>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 relative overflow-hidden group hover:shadow-sm transition-all">
                    <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.06] pointer-events-none">
                      <Activity className="size-16 text-zinc-900" />
                    </div>
                    <span className="block text-[10px] font-extrabold text-zinc-400 uppercase tracking-widest">Platform Activity</span>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-2xl font-black text-zinc-950 tracking-tight">{metrics.totalDoctors}</span>
                      <span className="text-[10px] font-bold text-zinc-400">Providers</span>
                    </div>
                    <div className="flex gap-2 text-[9px] text-zinc-500 font-bold mt-1.5 flex-wrap">
                      <span className="flex items-center gap-1"><Calendar className="size-3" /> {metrics.totalAppointments} Appts</span>
                      <span>•</span>
                      <span className="flex items-center gap-1"><FileText className="size-3" /> {metrics.totalSoapNotes} SOAP</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Area Chart: Tenant Signup Distribution */}
                  <div className="lg:col-span-2 border border-zinc-200/80 rounded-2xl p-5 bg-white space-y-4">
                    <div className="flex items-center justify-between border-b border-zinc-150 pb-3">
                      <div>
                        <h3 className="text-xs font-extrabold text-zinc-955 uppercase tracking-wider flex items-center gap-2">
                          <TrendingUp className="size-4 text-zinc-650" />
                          Tenant Signup Distribution
                        </h3>
                        <p className="text-[10px] text-zinc-400 mt-0.5">Cumulative client growth based on signup timestamps.</p>
                      </div>
                      <span className="text-[10px] font-extrabold text-zinc-800 bg-zinc-100 px-2.5 py-0.5 rounded-lg border border-zinc-200">
                        {metrics.totalTenants} Registered
                      </span>
                    </div>
                    <div className="h-56 w-full rounded-2xl border border-zinc-200/80 bg-slate-50/30 p-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorSignups" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="rgb(24, 24, 27)" stopOpacity={0.08}/>
                              <stop offset="95%" stopColor="rgb(24, 24, 27)" stopOpacity={0.00}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                          <XAxis 
                            dataKey="month" 
                            stroke="#94a3b8" 
                            fontSize={9} 
                            fontWeight={700} 
                            tickLine={false} 
                            axisLine={false} 
                            dy={10} 
                          />
                          <YAxis 
                            stroke="#94a3b8" 
                            fontSize={9} 
                            fontWeight={700} 
                            tickLine={false} 
                            axisLine={false} 
                            dx={-10} 
                            allowDecimals={false}
                          />
                          <ChartTooltip content={<CustomChartTooltip />} cursor={{ stroke: '#f1f5f9', strokeWidth: 1.5 }} />
                          <Area 
                            type="monotone" 
                            dataKey="count" 
                            stroke="rgb(24, 24, 27)" 
                            strokeWidth={2.5} 
                            fillOpacity={1} 
                            fill="url(#colorSignups)" 
                            activeDot={{ r: 5, strokeWidth: 1.5, stroke: "white", fill: "rgb(24, 24, 27)" }} 
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Doughnut Chart: Plan Distribution */}
                  <div className="border border-zinc-200/80 rounded-2xl p-5 bg-white flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-center justify-between border-b border-zinc-150 pb-3">
                        <div>
                          <h3 className="text-xs font-extrabold text-zinc-955 uppercase tracking-wider flex items-center gap-2">
                            <Activity className="size-4 text-zinc-650" />
                            SaaS Tier Distribution
                          </h3>
                          <p className="text-[10px] text-zinc-400 mt-0.5">Subscription plan levels across registered tenants.</p>
                        </div>
                      </div>
                      <div className="h-44 w-full flex items-center justify-center relative mt-2">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={planData}
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={68}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {planData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                              ))}
                            </Pie>
                            <ChartTooltip content={<CustomPieTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-2 border-t border-zinc-150/60">
                      {planData.map((item, idx) => (
                        <div key={item.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }} />
                            <span className="font-semibold text-zinc-550">{item.name} Tier</span>
                          </div>
                          <span className="font-extrabold text-zinc-900">{item.value} ({tenants.length > 0 ? ((item.value / tenants.length) * 100).toFixed(0) : 0}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW: TENANTS REGISTRY */}
            {activeTab === "registry" && !selectedTenantProfile && (
              <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 space-y-5">
                <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between border-b border-zinc-100 pb-4">
                  <div>
                    <h2 className="text-sm font-extrabold text-zinc-900">Tenants</h2>
                    <p className="text-[10px] text-zinc-400 mt-0.5">Manage billing details, limits, and settings for active tenants ({filteredTenants.length}).</p>
                  </div>
                  <div className="flex flex-wrap gap-2 w-full lg:w-auto items-center justify-end">
                    <div className="relative w-full sm:w-60">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Search tenants, director name, or ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-xl border border-zinc-200 bg-zinc-50/50 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all font-semibold"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 border border-zinc-200 bg-white rounded-xl px-3 py-2">
                      <Filter className="size-3.5 text-zinc-400" />
                      <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)} className="bg-transparent text-xs text-zinc-700 font-extrabold focus:outline-none border-none pr-1">
                        <option value="all">All Plans</option>
                        <option value="trial">Trial</option>
                        <option value="pro">Pro</option>
                        <option value="enterprise">Enterprise</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-1.5 border border-zinc-200 bg-white rounded-xl px-3 py-2">
                      <Activity className="size-3.5 text-zinc-400" />
                      <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-transparent text-xs text-zinc-700 font-extrabold focus:outline-none border-none pr-1">
                        <option value="all">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="trialing">Trialing</option>
                        <option value="cancelled">Deactivated</option>
                        <option value="past due">Past Due</option>
                      </select>
                    </div>
                  </div>
                </div>

              {loadingData ? (
                <div className="flex flex-col items-center justify-center py-24 gap-3">
                  <Loader2 className="size-7 text-zinc-900 animate-spin" />
                  <span className="text-xs text-zinc-400 font-bold">Synchronizing database indices...</span>
                </div>
              ) : filteredTenants.length === 0 ? (
                <div className="text-center py-20 space-y-3">
                  <div className="flex size-12 items-center justify-center rounded-full bg-zinc-50 border border-zinc-150 mx-auto">
                    <AlertCircle className="size-5 text-zinc-400" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-zinc-700">No Tenant Records Found</h3>
                    <p className="text-[10px] text-zinc-400 max-w-xs mx-auto mt-1">Try refining your search queries or register a new tenant.</p>
                  </div>
                </div>
              ) : (
                <table className="w-full text-left border-collapse min-w-[950px]">
                  <thead>
                    <tr className="border-b border-zinc-150 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                      <th className="pb-3 pl-3">Tenant & ID</th>
                      <th className="pb-3">Director Contact</th>
                      <th className="pb-3">Subscription</th>
                      <th className="pb-3">Days Left</th>
                      <th className="pb-3 text-right pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-xs text-zinc-700">
                    {filteredTenants.map((t) => {
                      const usagePercent = Math.min(100, (t.callsHandled / (t.callLimit || 100)) * 100);
                      const isLimitDanger = usagePercent > 90;
                      const isLimitWarning = usagePercent > 75 && usagePercent <= 90;
                      const clinicColor = getColorClass(t.clinicName);
                      const daysLeft = getDaysLeft(t.subscriptionExpiresAt);
                      
                      return (
                        <tr key={t.id} className="hover:bg-slate-50/40 transition-colors group">
                          
                          {/* Tenant Avatar & ID */}
                          <td className="py-4 pl-3">
                            <div className="flex items-center gap-3">
                              <div className={`flex size-9 items-center justify-center rounded-xl border text-xs font-black shrink-0 ${clinicColor}`}>
                                {getInitials(t.clinicName)}
                              </div>
                              <div className="space-y-1">
                                <span className="font-extrabold text-zinc-900 text-xs leading-tight block group-hover:text-zinc-950 transition-colors">
                                  {t.clinicName}
                                </span>
                                <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-medium">
                                  <span>ID: <code className="text-[9px] text-zinc-650 bg-zinc-100 border border-zinc-200/50 px-1 py-0.5 rounded font-mono">{t.tenantId}</code></span>
                                  <span>•</span>
                                  <span>Created: {new Date(t.createdAt).toLocaleDateString()}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Contact details */}
                          <td className="py-4">
                            <span className="block font-bold text-zinc-800 leading-tight">{t.name}</span>
                            <span className="block text-[10px] text-zinc-400 font-semibold mt-0.5 leading-none">{t.email}</span>
                          </td>

                          {/* Subscription indicators */}
                          <td className="py-4 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${
                                t.subscriptionStatus === 'Active' ? 'bg-emerald-50 text-emerald-700 border-emerald-150' :
                                t.subscriptionStatus === 'Trialing' ? 'bg-zinc-150 text-zinc-700 border-zinc-250' :
                                t.subscriptionStatus === 'Cancelled' ? 'bg-zinc-100 text-zinc-650 border-zinc-200' :
                                'bg-red-50 text-red-700 border-red-150'
                              }`}>
                                {t.subscriptionStatus === 'Cancelled' ? 'Deactivated' : t.subscriptionStatus}
                              </span>
                              <span className="text-[10px] font-extrabold text-zinc-550">{t.subscriptionPlan} Tier</span>
                            </div>
                            <div className="text-[10px] text-zinc-400 font-semibold flex gap-1.5 items-center">
                              <span>{formatCurrencyInr(t.paymentAmount)}/{t.billingInterval === 'yearly' ? 'yr' : 'mo'}</span>
                              {t.subscriptionExpiresAt && (
                                <>
                                  <span>•</span>
                                  <span>Renews: {formatDate(t.subscriptionExpiresAt)}</span>
                                </>
                              )}
                            </div>
                          </td>

                          {/* Days Left metrics */}
                          <td className="py-4">
                            <div className="flex items-center gap-1.5 text-xs font-bold">
                              {daysLeft !== null ? (
                                <span className={daysLeft < 7 ? "text-red-600" : daysLeft < 14 ? "text-amber-600" : "text-emerald-600"}>
                                  {daysLeft} days
                                </span>
                              ) : (
                                <span className="text-zinc-400">N/A</span>
                              )}
                            </div>
                          </td>

                          {/* Action modifiers */}
                          <td className="py-4 text-right pr-3">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => toast.info("Edit user flow coming soon")}
                                className="p-1.5 rounded-xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-600 transition-all cursor-pointer active:scale-[0.98]"
                                title="Edit Tenant"
                              >
                                <Edit2 className="size-3.5" />
                              </button>
                              <button
                                onClick={() => handleToggleStatus(t)}
                                disabled={togglingTenantId === t.id}
                                className={`p-1.5 rounded-xl border border-zinc-200 hover:border-zinc-300 transition-all cursor-pointer active:scale-[0.98] ${t.subscriptionStatus === 'Active' ? 'text-emerald-600 hover:bg-emerald-50' : 'text-zinc-600 hover:bg-zinc-50'}`}
                                title={t.subscriptionStatus === 'Active' ? 'Deactivate User' : 'Activate User'}
                              >
                                {togglingTenantId === t.id ? <Loader2 className="size-3.5 animate-spin text-zinc-500" /> : <Power className="size-3.5" />}
                              </button>
                              <button
                                onClick={() => handleDeleteTenant(t)}
                                className="p-1.5 rounded-xl border border-red-100 hover:border-red-200 hover:bg-red-50 text-red-600 transition-all cursor-pointer active:scale-[0.98]"
                                title="Delete Tenant"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                              <button
                                onClick={() => openTenantProfile(t)}
                                className="px-2.5 py-1.5 text-[10px] font-extrabold rounded-xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-700 hover:text-zinc-955 transition-all cursor-pointer flex items-center gap-1 active:scale-[0.98]"
                                title="Modify Config"
                              >
                                Config
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

            {/* VIEW: FULL TENANT PROFILE */}
            {activeTab === "registry" && selectedTenantProfile && (
              <div className="space-y-6">
                <div className="flex items-center gap-4 border-b border-zinc-200 pb-4">
                  <button onClick={() => { setSelectedTenantProfile(null); setEditingTenant(null); }} className="p-2 rounded-full hover:bg-zinc-100 transition-colors cursor-pointer">
                    <ArrowLeft className="size-5 text-zinc-500" />
                  </button>
                  <div>
                    <h2 className="text-xl font-black text-zinc-950">{editingTenant?.clinicName} Profile</h2>
                    <p className="text-xs text-zinc-500">ID: <code className="bg-zinc-100 px-1 py-0.5 rounded font-mono">{editingTenant?.tenantId}</code> • Created: {new Date(editingTenant?.createdAt || "").toLocaleDateString()}</p>
                  </div>
                </div>

                {(() => {
                  const prof = (selectedTenantProfile.user?.profession || "").toLowerCase();
                  let l1 = "Doctors", l2 = "Patients", l3 = "Appointments", l4 = "SOAP Notes";
                  if (prof.includes("gym") || prof.includes("fitness")) { l1 = "Trainers"; l2 = "Members"; l3 = "Classes"; l4 = "Workout Plans"; }
                  else if (prof.includes("beauty") || prof.includes("wellness")) { l1 = "Specialists"; l2 = "Clients"; l3 = "Bookings"; l4 = "Session Notes"; }
                  else if (prof.includes("education") || prof.includes("coach")) { l1 = "Instructors"; l2 = "Students"; l3 = "Classes"; l4 = "Progress Notes"; }
                  else if (prof.includes("legal") || prof.includes("consult")) { l1 = "Consultants"; l2 = "Clients"; l3 = "Meetings"; l4 = "Case Notes"; }
                  
                  return (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5">
                        <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">{l1}</span>
                        <span className="block text-2xl font-black text-zinc-950 mt-2">{selectedTenantProfile.metrics.doctors}</span>
                      </div>
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5">
                        <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">{l2}</span>
                        <span className="block text-2xl font-black text-zinc-950 mt-2">{selectedTenantProfile.metrics.patients}</span>
                      </div>
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5">
                        <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">{l3}</span>
                        <span className="block text-2xl font-black text-zinc-950 mt-2">{selectedTenantProfile.metrics.appointments}</span>
                      </div>
                      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5">
                        <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">{l4}</span>
                        <span className="block text-2xl font-black text-zinc-950 mt-2">{selectedTenantProfile.metrics.soapNotes}</span>
                      </div>
                    </div>
                  );
                })()}


                <div className="rounded-2xl border border-zinc-200/80 bg-white p-6">
                  <div className="flex items-center gap-4 mb-5">
                    {selectedTenantProfile.user?.profilePhoto ? (
                      <img src={selectedTenantProfile.user.profilePhoto} alt="Profile" className="h-14 w-14 rounded-full object-cover border border-zinc-200" />
                    ) : (
                      <div className="h-14 w-14 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-xl font-black text-zinc-400">
                        {selectedTenantProfile.user?.name?.charAt(0) || "U"}
                      </div>
                    )}
                    <div>
                      <h3 className="text-sm font-black text-zinc-950">Director Information</h3>
                      <p className="text-xs text-zinc-500 font-semibold">{selectedTenantProfile.user?.profession || "Healthcare Professional"}</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-y-5 gap-x-4">
                    <div>
                      <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">Full Name</span>
                      <span className="block text-xs font-bold text-zinc-800 mt-1">{selectedTenantProfile.user?.name}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">Email Address</span>
                      <span className="block text-xs font-bold text-zinc-800 mt-1 truncate" title={selectedTenantProfile.user?.email}>{selectedTenantProfile.user?.email}</span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">Phone Number</span>
                      <span className="block text-xs font-bold text-zinc-800 mt-1">{selectedTenantProfile.user?.phone}</span>
                    </div>
                    <div>
                      {(() => {
                        const prof = (selectedTenantProfile.user?.profession || "").toLowerCase();
                        let label = "Practice Size";
                        let staffStr = "providers";
                        if (prof.includes("gym") || prof.includes("fitness")) { label = "Facility Size"; staffStr = "trainers"; }
                        else if (prof.includes("beauty") || prof.includes("wellness")) { label = "Salon Size"; staffStr = "specialists"; }
                        else if (prof.includes("education") || prof.includes("coach")) { label = "Institute Size"; staffStr = "instructors"; }
                        else if (prof.includes("legal") || prof.includes("consult")) { label = "Firm Size"; staffStr = "consultants"; }
                        
                        const rawSize = selectedTenantProfile.user?.practiceSize || "Unknown";
                        const displaySize = rawSize.replace(/providers/i, staffStr);

                        return (
                          <>
                            <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">{label}</span>
                            <span className="block text-xs font-bold text-zinc-800 mt-1">{displaySize}</span>
                          </>
                        );
                      })()}
                    </div>
                    <div>
                      <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">WhatsApp Number</span>
                      <span className="block text-xs font-bold text-zinc-800 mt-1">{selectedTenantProfile.profile?.whatsappNo || "Not Connected"}</span>
                    </div>
                    <div>
                      {(() => {
                        const prof = (selectedTenantProfile.user?.profession || "").toLowerCase();
                        let addressLabel = "Clinic Address";
                        if (prof.includes("gym") || prof.includes("fitness")) { addressLabel = "Facility Address"; }
                        else if (prof.includes("beauty") || prof.includes("wellness")) { addressLabel = "Salon Address"; }
                        else if (prof.includes("education") || prof.includes("coach")) { addressLabel = "Institute Address"; }
                        else if (prof.includes("legal") || prof.includes("consult")) { addressLabel = "Office Address"; }
                        
                        return (
                          <>
                            <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">{addressLabel}</span>
                            <span className="block text-xs font-bold text-zinc-800 mt-1 truncate" title={selectedTenantProfile.profile?.address || ""}>
                              {selectedTenantProfile.profile?.address || "Not Provided"}
                            </span>
                          </>
                        );
                      })()}
                    </div>
                    <div>
                      <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">Public Booking Link</span>
                      <span className="block text-xs font-bold text-brand mt-1 truncate">
                        <a href={`/book/${selectedTenantProfile.user?.tenantId}`} target="_blank" rel="noreferrer" className="hover:underline">
                          /book/{selectedTenantProfile.user?.tenantId}
                        </a>
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] font-extrabold text-zinc-400 uppercase">Last Updated</span>
                      <span className="block text-xs font-bold text-zinc-800 mt-1">
                        {selectedTenantProfile.user?.updatedAt ? new Date(selectedTenantProfile.user.updatedAt).toLocaleString("en-IN") : "N/A"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 space-y-6">
                    <div className="rounded-2xl border border-zinc-200/80 bg-white p-6">
                      <h3 className="text-sm font-black text-zinc-950 mb-4">Modify System Config</h3>
                      <form onSubmit={handleEditSubmit} id="edit-profile-form" className="space-y-6">
                        {/* Section 1: Subscriptions */}
                        <div className="space-y-4">
                          <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-widest pl-1">Subscription & Billing</span>
                          
                          <div className="grid grid-cols-2 gap-3.5">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-zinc-550 pl-1">SaaS Status</label>
                              <select
                                value={editStatus}
                                onChange={(e) => setEditStatus(e.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-850 focus:border-zinc-300 focus:bg-white focus:outline-none transition-all select-light font-extrabold"
                              >
                                <option value="Active">Active</option>
                                <option value="Trialing">Trialing</option>
                                <option value="Cancelled">Deactivated</option>
                                <option value="Past Due">Past Due</option>
                              </select>
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-zinc-550 pl-1">Plan Tier</label>
                              <select
                                value={editPlan}
                                onChange={(e) => setEditPlan(e.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-850 focus:border-zinc-300 focus:bg-white focus:outline-none transition-all select-light font-extrabold"
                              >
                                <option value="Trial">Trial</option>
                                <option value="Basic">Basic</option>
                                <option value="Solo">Solo</option>
                                <option value="Pro">Pro</option>
                                <option value="Premium">Premium</option>
                                <option value="Clinic">Clinic</option>
                                <option value="Enterprise">Enterprise</option>
                                <option value="Hospital">Hospital</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3.5">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-zinc-550 pl-1">Price (INR)</label>
                              <input
                                type="number"
                                step="0.01"
                                value={editPaymentAmount}
                                onChange={(e) => setEditPaymentAmount(Number(e.target.value))}
                                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs text-zinc-850 font-extrabold focus:border-zinc-400 focus:bg-white focus:outline-none transition-all"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-zinc-550 pl-1">Period</label>
                              <select
                                value={editBillingInterval}
                                onChange={(e) => setEditBillingInterval(e.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-850 focus:border-zinc-300 focus:bg-white focus:outline-none transition-all select-light font-extrabold"
                              >
                                <option value="monthly">monthly</option>
                                <option value="yearly">yearly</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3.5">
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-zinc-550 pl-1">Expiration Date</label>
                              <input
                                type="date"
                                value={editExpiry}
                                onChange={(e) => setEditExpiry(e.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs text-zinc-850 font-bold focus:border-zinc-400 focus:bg-white focus:outline-none transition-all"
                              />
                            </div>

                            <div className="space-y-1.5">
                              <label className="text-[10px] font-bold text-zinc-550 pl-1">Payment Method</label>
                              <select
                                value={editPaymentMethod}
                                onChange={(e) => setEditPaymentMethod(e.target.value)}
                                className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-xs text-zinc-850 focus:border-zinc-300 focus:bg-white focus:outline-none transition-all select-light font-extrabold"
                              >
                                <option value="None">None</option>
                                <option value="Credit Card">Credit Card</option>
                                <option value="PayPal">PayPal</option>
                                <option value="Invoice">Invoice</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="h-[1px] bg-zinc-150" />

                        {/* Section 2: Plan Permissions */}
                        <div className="space-y-4">
                          <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-widest pl-1">Plan Permissions</span>
                          
                          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-zinc-500 uppercase">Selected Tier</span>
                              <span className="rounded bg-brand/10 px-2 py-0.5 text-[10px] font-bold text-brand">{editPlan || "Trial"}</span>
                            </div>
                            
                            <ul className="space-y-2 pt-2 border-t border-zinc-200">
                              {(() => {
                                const p = editPlan || "Trial";
                                const prof = (selectedTenantProfile?.user?.profession || "").toLowerCase();
                                
                                let noun = "appointments", records = "client", staff = "Professionals", action = "Consultation", aiFeat = "AI-based Voice Rx";
                                if (prof.includes("gym") || prof.includes("fitness")) {
                                  noun = "classes"; records = "member"; staff = "Trainers"; action = "Member"; aiFeat = "AI-based Workout Gen";
                                } else if (prof.includes("beauty") || prof.includes("wellness")) {
                                  noun = "bookings"; records = "client"; staff = "Specialists"; action = "Session"; aiFeat = "AI-based Treatment Notes";
                                } else if (prof.includes("education") || prof.includes("coach")) {
                                  noun = "classes"; records = "student"; staff = "Instructors"; action = "Student"; aiFeat = "AI-based Lesson Plans";
                                } else if (prof.includes("legal") || prof.includes("consult")) {
                                  noun = "meetings"; records = "client"; staff = "Consultants"; action = "Case"; aiFeat = "AI-based Case Summaries";
                                } else {
                                  noun = "appointments"; records = "patient"; staff = "Doctors"; action = "Consultation"; aiFeat = "AI-based Voice Rx";
                                }

                                if (p === "Enterprise" || p === "Hospital") {
                                  return [
                                    "Unlimited dashboards & locations",
                                    `Unlimited ${noun} / mo`,
                                    `Unlimited ${records} records`,
                                    "Multi QR Code Booking",
                                    "Meta Verified WhatsApp integration",
                                    "Custom API & integrations",
                                    "Dedicated AI fine-tuning"
                                  ].map((feat, i) => (
                                    <li key={i} className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                                      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                      {feat}
                                    </li>
                                  ));
                                } else if (p === "Premium" || p === "Pro" || p === "Clinic") {
                                  return [
                                    "1 dashboard",
                                    `2,000 ${noun} / mo`,
                                    `Up to 5,000 ${records} records`,
                                    "WhatsApp alerts included",
                                    "Advanced AI assistant",
                                    `Multi-user dashboards (Reception & ${staff})`,
                                    aiFeat,
                                    `${action} tracking`
                                  ].map((feat, i) => (
                                    <li key={i} className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                                      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                      {feat}
                                    </li>
                                  ));
                                } else {
                                  return [
                                    "1 dashboard",
                                    `500 ${noun} / mo`,
                                    `Up to 500 ${records} records`,
                                    "QR Code Booking",
                                    "Standard AI assistant",
                                    "Standard Support"
                                  ].map((feat, i) => (
                                    <li key={i} className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                                      <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                      {feat}
                                    </li>
                                  ));
                                }
                              })()}
                            </ul>
                          </div>
                        </div>
                      </form>

                      <div className="flex gap-2.5 pt-6 mt-6 border-t border-zinc-150">
                        <button
                          type="button"
                          onClick={() => { setSelectedTenantProfile(null); setEditingTenant(null); }}
                          disabled={updating}
                          className="flex-1 rounded-xl border border-zinc-200 py-3 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer active:scale-[0.98]"
                        >
                          Discard Changes
                        </button>
                        <button
                          type="submit"
                          form="edit-profile-form"
                          disabled={updating}
                          className="flex-1 rounded-xl bg-zinc-950 hover:bg-zinc-850 py-3 text-xs font-extrabold text-white transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 shadow-md"
                        >
                          {updating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Save Configuration
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-1 space-y-6">
                    <div className="rounded-2xl border border-zinc-200/80 bg-white p-6 h-full max-h-[600px] flex flex-col">
                      <h3 className="text-sm font-black text-zinc-950 mb-4">Subscription History</h3>
                      
                      {loadingProfile ? (
                        <div className="flex items-center justify-center py-6 text-zinc-455 text-xs gap-1.5">
                          <Loader2 className="h-4 w-4 animate-spin text-zinc-550" />
                          Loading logs...
                        </div>
                      ) : selectedTenantProfile.history.length === 0 ? (
                        <p className="text-[10px] text-zinc-450 italic">No subscription logs found for this tenant.</p>
                      ) : (
                        <div className="space-y-5 overflow-y-auto pr-2 flex-1">
                          {selectedTenantProfile.history.map((item: any, idx: number) => (
                            <div key={item.id || idx} className="relative pl-4 border-l border-zinc-200 text-[10px] space-y-1.5">
                              {/* Circle bullet */}
                              <div className="absolute -left-[4.5px] top-1.5 size-2 rounded-full bg-zinc-400 ring-4 ring-white" />
                              
                              <div className="flex items-center justify-between font-bold text-zinc-500">
                                <span>{new Date(item.changedAt).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                  hour12: true
                                })}</span>
                                <span className="text-[8px] px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-650 uppercase tracking-wider font-extrabold">
                                  {item.changedBy}
                                </span>
                              </div>
                              
                              <div className="text-zinc-800">
                                <span className="font-extrabold text-zinc-450">Status: </span>
                                <span className="text-zinc-500">{item.previousStatus}</span>
                                <span className="text-zinc-400 font-normal"> → </span>
                                <span className="font-extrabold text-zinc-950">{item.newStatus}</span>
                              </div>

                              <div className="text-zinc-800">
                                <span className="font-extrabold text-zinc-450">Plan: </span>
                                <span className="text-zinc-500">{item.previousPlan}</span>
                                <span className="text-zinc-400 font-normal"> → </span>
                                <span className="font-extrabold text-zinc-950">{item.newPlan}</span>
                                <span className="text-zinc-900 font-extrabold"> ({item.newPlan === "Trial" ? "Free" : `₹${item.amount || 0}/${item.billingInterval}`})</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW: PAYMENT HISTORY */}
            {activeTab === "payments" && (
              <div className="space-y-6 animate-in fade-in duration-300">
                {/* Summary cards */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Total Received</span>
                    <p className="text-xl font-black text-emerald-600">{formatCurrencyInr(paymentSummary.totalReceived)}</p>
                    <p className="text-[10px] text-zinc-400 font-semibold">{paymentSummary.successCount} successful payments</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Failed</span>
                    <p className="text-xl font-black text-red-600">{formatCurrencyInr(paymentSummary.failedAmount)}</p>
                    <p className="text-[10px] text-zinc-400 font-semibold">{paymentSummary.failedCount} declined / errored</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Cancelled</span>
                    <p className="text-xl font-black text-zinc-600">{formatCurrencyInr(paymentSummary.cancelledAmount)}</p>
                    <p className="text-[10px] text-zinc-400 font-semibold">{paymentSummary.cancelledCount} dropped / abandoned</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Pending</span>
                    <p className="text-xl font-black text-amber-600">{formatCurrencyInr(paymentSummary.pendingAmount)}</p>
                    <p className="text-[10px] text-zinc-400 font-semibold">{paymentSummary.pendingCount} awaiting completion</p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Total Attempts</span>
                    <p className="text-xl font-black text-zinc-900">{paymentSummary.totalCount}</p>
                    <p className="text-[10px] text-zinc-400 font-semibold">All-time checkout events</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 space-y-5">
                  <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between border-b border-zinc-100 pb-4">
                    <div>
                      <h2 className="text-sm font-extrabold text-zinc-900">Unified Transaction Ledger</h2>
                      <p className="text-[10px] text-zinc-400 mt-0.5">Every checkout order attempt and recurring AutoPay cycle recorded ({paymentRows.length} fetched).</p>
                    </div>
                    <div className="flex flex-wrap gap-2 w-full lg:w-auto items-center justify-end">
                      <div className="relative w-full sm:w-64">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400" />
                        <input
                          type="text"
                          placeholder="Search order ID, email, phone, or name..."
                          value={paymentSearchQuery}
                          onChange={(e) => setPaymentSearchQuery(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") fetchPaymentHistory(); }}
                          className="w-full pl-9 pr-4 py-2 rounded-xl border border-zinc-200 bg-zinc-50/50 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all font-semibold"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 border border-zinc-200 bg-white rounded-xl px-3 py-2">
                        <Filter className="size-3.5 text-zinc-400" />
                        <select value={paymentStatusFilter} onChange={(e) => setPaymentStatusFilter(e.target.value)} className="bg-transparent text-xs text-zinc-700 font-extrabold focus:outline-none border-none pr-1">
                          <option value="all">All Statuses</option>
                          <option value="SUCCESS">Received</option>
                          <option value="FAILED">Failed</option>
                          <option value="CANCELLED">Cancelled</option>
                          <option value="PENDING">Pending</option>
                        </select>
                      </div>
                      <button
                        onClick={() => setIsRecordPaymentOpen(true)}
                        className="flex items-center gap-1.5 h-9 px-3.5 bg-zinc-950 text-white rounded-xl text-xs font-extrabold hover:bg-zinc-800 transition-colors active:scale-[0.98] cursor-pointer shadow-sm"
                      >
                        <Plus className="size-3.5" />
                        Record Offline
                      </button>
                      <button
                        onClick={syncPaymentsFromCashfree}
                        disabled={syncingPayments || loadingPayments}
                        className="flex items-center gap-2 h-9 px-3.5 border border-emerald-200 bg-emerald-50 rounded-xl text-emerald-700 text-xs font-extrabold hover:bg-emerald-100 transition-colors active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                        title="Reconcile pending/failed orders directly against Cashfree"
                      >
                        <RefreshCw className={`size-3.5 ${syncingPayments ? "animate-spin" : ""}`} />
                        {syncingPayments ? "Syncing..." : "Sync"}
                      </button>
                      <button
                        onClick={fetchPaymentHistory}
                        disabled={loadingPayments}
                        className="flex items-center justify-center size-9 border border-zinc-200 bg-white rounded-xl text-zinc-500 hover:text-zinc-800 transition-colors active:scale-[0.98] cursor-pointer"
                        title="Refresh"
                      >
                        <RefreshCw className={`size-4 ${loadingPayments ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </div>

                  {loadingPayments ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-3">
                      <Loader2 className="size-7 text-zinc-900 animate-spin" />
                      <span className="text-xs text-zinc-400 font-bold">Loading unified payment ledger...</span>
                    </div>
                  ) : sortedPaymentRows.length === 0 ? (
                    <div className="text-center py-20 space-y-3">
                      <div className="flex size-12 items-center justify-center rounded-full bg-zinc-50 border border-zinc-150 mx-auto">
                        <CreditCard className="size-5 text-zinc-400" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-zinc-700">No Payment Records Found</h3>
                        <p className="text-[10px] text-zinc-400 max-w-xs mx-auto mt-1">Try adjusting your search query/filters, or log a manual transaction.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[1100px]">
                        <thead>
                          <tr className="border-b border-zinc-150 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                            <th className="pb-3 pl-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handlePaymentSort("customerName")}>
                              Customer & Order {paymentSortField === "customerName" && (paymentSortOrder === "asc" ? " ▲" : " ▼")}
                            </th>
                            <th className="pb-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handlePaymentSort("plan")}>
                              Plan {paymentSortField === "plan" && (paymentSortOrder === "asc" ? " ▲" : " ▼")}
                            </th>
                            <th className="pb-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handlePaymentSort("amount")}>
                              Amount {paymentSortField === "amount" && (paymentSortOrder === "asc" ? " ▲" : " ▼")}
                            </th>
                            <th className="pb-3">Payment Mode</th>
                            <th className="pb-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handlePaymentSort("status")}>
                              Status {paymentSortField === "status" && (paymentSortOrder === "asc" ? " ▲" : " ▼")}
                            </th>
                            <th className="pb-3">Type</th>
                            <th className="pb-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handlePaymentSort("createdAt")}>
                              Date {paymentSortField === "createdAt" && (paymentSortOrder === "asc" ? " ▲" : " ▼")}
                            </th>
                            <th className="pb-3 text-right pr-3">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100 text-xs text-zinc-700">
                          {sortedPaymentRows.map((p) => {
                            const statusStyle =
                              p.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700 border-emerald-150" :
                              p.status === "FAILED" ? "bg-red-50 text-red-700 border-red-150" :
                              p.status === "CANCELLED" ? "bg-zinc-100 text-zinc-650 border-zinc-200" :
                              "bg-amber-50 text-amber-700 border-amber-150";
                            const StatusIcon =
                              p.status === "SUCCESS" ? CheckCircle2 :
                              p.status === "FAILED" ? XCircle :
                              p.status === "CANCELLED" ? Ban :
                              Clock3;
                            const statusLabel =
                              p.status === "SUCCESS" ? "Received" :
                              p.status === "FAILED" ? "Failed" :
                              p.status === "CANCELLED" ? "Cancelled" :
                              "Pending";

                            return (
                              <tr key={p.id} className="hover:bg-slate-50/40 transition-colors group">
                                {/* Customer & Order */}
                                <td className="py-4 pl-3">
                                  <div className="space-y-1">
                                    <span className="font-extrabold text-zinc-900 text-xs leading-tight block">
                                      {p.customerName || p.clinicName || "—"}
                                    </span>
                                    <div className="text-[10px] text-zinc-400 font-medium space-y-0.5">
                                      {p.customerEmail && <div>{p.customerEmail}</div>}
                                      {p.customerPhone && <div>{p.customerPhone}</div>}
                                      <div className="flex items-center gap-1.5">
                                        <span>Order:</span>
                                        <code className="text-[9px] text-zinc-650 bg-zinc-100 border border-zinc-200/50 px-1 py-0.5 rounded font-mono">{p.orderId}</code>
                                      </div>
                                      {p.cfPaymentId && (
                                        <div className="flex items-center gap-1.5">
                                          <span>CF ID:</span>
                                          <code className="text-[9px] text-zinc-650 bg-zinc-100 border border-zinc-200/50 px-1 py-0.5 rounded font-mono">{p.cfPaymentId}</code>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>

                                {/* Plan / Amount */}
                                <td className="py-4">
                                  <span className="block text-[10px] text-zinc-450 font-semibold">{p.plan || "—"} Plan</span>
                                </td>

                                {/* Amount */}
                                <td className="py-4">
                                  <span className="block font-extrabold text-zinc-900 text-xs">{formatCurrencyInr(p.amount)}</span>
                                </td>

                                {/* Payment Mode */}
                                <td className="py-4">
                                  <span className="text-[11px] font-bold text-zinc-700">{p.paymentMode || "—"}</span>
                                </td>

                                {/* Status */}
                                <td className="py-4">
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${statusStyle}`}>
                                    <StatusIcon className="size-2.5" />
                                    {statusLabel}
                                  </span>
                                </td>

                                {/* Type */}
                                <td className="py-4">
                                  <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase tracking-wider ${
                                    p.type === "subscription" 
                                      ? "bg-purple-50 text-purple-700 border-purple-100" 
                                      : "bg-zinc-100 text-zinc-600 border-zinc-200"
                                  }`}>
                                    {p.type === "subscription" ? "AutoPay" : "Checkout"}
                                  </span>
                                </td>

                                {/* Date */}
                                <td className="py-4">
                                  <span className="text-[10px] text-zinc-500 font-semibold whitespace-nowrap">
                                    {new Date(p.createdAt).toLocaleString("en-US", {
                                      month: "short", day: "numeric", year: "numeric",
                                      hour: "numeric", minute: "2-digit", hour12: true
                                    })}
                                  </span>
                                </td>

                                {/* Actions */}
                                <td className="py-4 text-right pr-3">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      title="View payment details"
                                      onClick={() => setViewPaymentDetails(p)}
                                      className="p-1.5 rounded-xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-600 transition-all cursor-pointer active:scale-[0.98]"
                                    >
                                      <Eye className="size-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Edit transaction log"
                                      onClick={() => setEditingPayment(p)}
                                      className="p-1.5 rounded-xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-600 transition-all cursor-pointer active:scale-[0.98]"
                                    >
                                      <Edit2 className="size-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      title="Delete transaction log"
                                      onClick={() => setDeletingPayment(p)}
                                      className="p-1.5 rounded-xl border border-red-100 hover:border-red-200 hover:bg-red-50 text-red-600 transition-all cursor-pointer active:scale-[0.98]"
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* VIEW: RECURRING SUBSCRIPTIONS */}
            {activeTab === "subscriptions" && (() => {
              // Calculate custom SaaS telemetry values dynamically from rows
              const activeCount = subscriptionRows.filter(s => String(s.status).toUpperCase() === "ACTIVE").length;
              const cancelledCount = subscriptionRows.filter(s => String(s.status).toUpperCase() === "CANCELLED").length;
              const onHoldCount = subscriptionRows.filter(s => ["ON_HOLD", "PAUSED", "UNDER_RESOLUTION"].includes(String(s.status).toUpperCase())).length;
              
              const mrr = subscriptionSummary.activeMrr;
              const arr = mrr * 12;
              const arpu = activeCount > 0 ? mrr / activeCount : 0;
              const churnRate = (cancelledCount / (activeCount + cancelledCount || 1)) * 100;
              const recoveryRate = subscriptionSummary.successCount > 0 
                ? (subscriptionSummary.successCount / (subscriptionSummary.successCount + subscriptionSummary.failedRenewals || 1)) * 100 
                : 100;

              return (
                <div className="space-y-6 animate-in fade-in duration-300">
                  {/* SaaS Telemetry Metrics */}
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
                    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Active MRR</span>
                      <p className="text-xl font-black text-zinc-900">{formatCurrencyInr(mrr)}</p>
                      <p className="text-[10px] text-zinc-400 font-semibold">{activeCount} active mandates</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Estimated ARR</span>
                      <p className="text-xl font-black text-zinc-950">{formatCurrencyInr(arr)}</p>
                      <p className="text-[10px] text-zinc-400 font-semibold">Annual monthly run rate</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Avg Contract Size</span>
                      <p className="text-xl font-black text-indigo-600">{formatCurrencyInr(arpu)}</p>
                      <p className="text-[10px] text-zinc-400 font-semibold">Average monthly ARPU</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">AutoPay Collected</span>
                      <p className="text-xl font-black text-emerald-600">{formatCurrencyInr(subscriptionSummary.collectedAmount)}</p>
                      <p className="text-[10px] text-zinc-400 font-semibold">{subscriptionSummary.successCount} successful cycles</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Churn Rate</span>
                      <p className="text-xl font-black text-zinc-650">{churnRate.toFixed(1)}%</p>
                      <p className="text-[10px] text-zinc-400 font-semibold">{cancelledCount} deactivated total</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200/80 bg-white p-4 space-y-1.5 shadow-sm hover:shadow-md transition-shadow">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Billing Success</span>
                      <p className="text-xl font-black text-emerald-600">{recoveryRate.toFixed(1)}%</p>
                      <p className="text-[10px] text-zinc-400 font-semibold">{subscriptionSummary.failedRenewals} failed renewals</p>
                    </div>
                  </div>

                  {/* AutoPay Registry */}
                  <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 space-y-5">
                    <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between border-b border-zinc-100 pb-4">
                      <div>
                        <h2 className="text-sm font-extrabold text-zinc-900">AutoPay Mandates</h2>
                        <p className="text-[10px] text-zinc-400 mt-0.5">Manage subscription contracts, tiers, and payment ledgers ({subscriptionRows.length} fetched).</p>
                      </div>
                      <div className="flex flex-wrap gap-2 w-full lg:w-auto items-center justify-end">
                        <div className="relative w-full sm:w-64">
                          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400" />
                          <input
                            type="text"
                            placeholder="Search tenant, email, or subscription ID..."
                            value={subAdminSearch}
                            onChange={(e) => setSubAdminSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") fetchAdminSubscriptions(); }}
                            className="w-full pl-9 pr-4 py-2 rounded-xl border border-zinc-200 bg-zinc-50/50 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all font-semibold"
                          />
                        </div>
                        <div className="flex items-center gap-1.5 border border-zinc-200 bg-white rounded-xl px-3 py-2">
                          <Filter className="size-3.5 text-zinc-400" />
                          <select value={subAdminStatusFilter} onChange={(e) => setSubAdminStatusFilter(e.target.value)} className="bg-transparent text-xs text-zinc-700 font-extrabold focus:outline-none border-none pr-1">
                            <option value="all">All Statuses</option>
                            <option value="ACTIVE">Active</option>
                            <option value="ON_HOLD">On Hold</option>
                            <option value="CANCELLED">Cancelled</option>
                            <option value="INITIALIZED">Initialized</option>
                          </select>
                        </div>
                        <button
                          onClick={() => setIsProvisionSubOpen(true)}
                          className="flex items-center gap-1.5 h-9 px-3.5 bg-zinc-950 text-white rounded-xl text-xs font-extrabold hover:bg-zinc-850 transition-colors active:scale-[0.98] cursor-pointer shadow-sm"
                        >
                          <Plus className="size-3.5" />
                          Provision Custom
                        </button>
                        <button
                          onClick={syncSubscriptionsFromCashfree}
                          disabled={syncingSubscriptions || loadingSubscriptions}
                          className="flex items-center gap-2 h-9 px-3.5 border border-emerald-200 bg-emerald-50 rounded-xl text-emerald-700 text-xs font-extrabold hover:bg-emerald-100 transition-colors active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                          title="Reconcile every subscription + payment ledger directly against Cashfree"
                        >
                          <RefreshCw className={`size-3.5 ${syncingSubscriptions ? "animate-spin" : ""}`} />
                          {syncingSubscriptions ? "Syncing..." : "Sync"}
                        </button>
                        <button
                          onClick={fetchAdminSubscriptions}
                          disabled={loadingSubscriptions}
                          className="flex items-center justify-center size-9 border border-zinc-200 bg-white rounded-xl text-zinc-500 hover:text-zinc-800 transition-colors active:scale-[0.98] cursor-pointer"
                          title="Refresh"
                        >
                          <RefreshCw className={`size-4 ${loadingSubscriptions ? "animate-spin" : ""}`} />
                        </button>
                      </div>
                    </div>

                    {loadingSubscriptions ? (
                      <div className="flex flex-col items-center justify-center py-24 gap-3">
                        <Loader2 className="size-7 text-zinc-900 animate-spin" />
                        <span className="text-xs text-zinc-400 font-bold">Loading subscriptions...</span>
                      </div>
                    ) : sortedSubscriptionRows.length === 0 ? (
                      <div className="text-center py-20 space-y-3">
                        <div className="flex size-12 items-center justify-center rounded-full bg-zinc-50 border border-zinc-150 mx-auto">
                          <RefreshCw className="size-5 text-zinc-400" />
                        </div>
                        <div>
                          <h3 className="text-xs font-bold text-zinc-700">No Subscriptions Found</h3>
                          <p className="text-[10px] text-zinc-400 max-w-xs mx-auto mt-1">Recurring AutoPay mandates will appear here once tenants subscribe.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[1000px]">
                          <thead>
                            <tr className="border-b border-zinc-150 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                              <th className="pb-3 pl-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handleSubSort("clinicName")}>
                                Tenant & Subscription {subSortField === "clinicName" && (subSortOrder === "asc" ? " ▲" : " ▼")}
                              </th>
                              <th className="pb-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handleSubSort("planTier")}>
                                Plan / Tier {subSortField === "planTier" && (subSortOrder === "asc" ? " ▲" : " ▼")}
                              </th>
                              <th className="pb-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handleSubSort("amount")}>
                                Price {subSortField === "amount" && (subSortOrder === "asc" ? " ▲" : " ▼")}
                              </th>
                              <th className="pb-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handleSubSort("status")}>
                                Status {subSortField === "status" && (subSortOrder === "asc" ? " ▲" : " ▼")}
                              </th>
                              <th className="pb-3">Next Renewal</th>
                              <th className="pb-3 cursor-pointer select-none hover:text-zinc-700" onClick={() => handleSubSort("createdAt")}>
                                Created {subSortField === "createdAt" && (subSortOrder === "asc" ? " ▲" : " ▼")}
                              </th>
                              <th className="pb-3 text-right pr-3">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 text-xs text-zinc-700">
                            {sortedSubscriptionRows.map((s) => {
                              const st = String(s.status || "").toUpperCase();
                              const statusStyle =
                                st === "ACTIVE" ? "bg-emerald-50 text-emerald-700 border-emerald-150" :
                                st === "ON_HOLD" || st === "PAUSED" ? "bg-amber-50 text-amber-700 border-amber-150" :
                                st === "CANCELLED" ? "bg-zinc-100 text-zinc-650 border-zinc-200" :
                                "bg-sky-50 text-sky-700 border-sky-150";
                              const next = s.nextChargeAt || s.currentPeriodEnd;
                              return (
                                <tr key={s.id} className="hover:bg-slate-50/40 transition-colors group">
                                  <td className="py-4 pl-3">
                                    <span className="font-extrabold text-zinc-900 text-xs block">{s.clinicName || s.customerName || "—"}</span>
                                    <div className="text-[10px] text-zinc-400 font-medium mt-0.5 space-y-0.5">
                                      {s.customerEmail && <div>{s.customerEmail}</div>}
                                      <div className="flex items-center gap-1.5">
                                        <span>Sub:</span>
                                        <code className="text-[9px] text-zinc-650 bg-zinc-100 border border-zinc-200/50 px-1 py-0.5 rounded font-mono">{s.subscriptionRef}</code>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="py-4">
                                    <span className="font-extrabold text-zinc-900 text-xs uppercase">{s.planTier}</span>
                                  </td>
                                  <td className="py-4">
                                    <span className="block font-extrabold text-zinc-900 text-xs">{formatCurrencyInr(s.amount)}</span>
                                    <span className="block text-[10px] text-zinc-400 font-semibold mt-0.5">{s.intervalType === "YEAR" ? "Yearly" : "Monthly"} · {s.paymentMethod || "Mandate"}</span>
                                  </td>
                                  <td className="py-4">
                                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${statusStyle}`}>
                                      {st}
                                    </span>
                                  </td>
                                  <td className="py-4 text-zinc-600 font-semibold">
                                    {next ? new Date(next).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                                  </td>
                                  <td className="py-4">
                                    <span className="text-[10px] text-zinc-500 font-semibold whitespace-nowrap">
                                      {new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                    </span>
                                  </td>
                                  <td className="py-4 text-right pr-3">
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        title="View billing details"
                                        onClick={() => setViewSubDetails(s)}
                                        className="p-1.5 rounded-xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-600 transition-all cursor-pointer active:scale-[0.98]"
                                      >
                                        <Eye className="size-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Edit subscription mandate"
                                        onClick={() => setEditingSub(s)}
                                        className="p-1.5 rounded-xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-600 transition-all cursor-pointer active:scale-[0.98]"
                                      >
                                        <Edit2 className="size-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Record manual cycle payment"
                                        onClick={() => setLogPaymentSub(s)}
                                        className="p-1.5 rounded-xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-600 transition-all cursor-pointer active:scale-[0.98]"
                                      >
                                        <Plus className="size-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        title="Delete subscription mandate log"
                                        onClick={() => setDeletingSub(s)}
                                        className="p-1.5 rounded-xl border border-red-100 hover:border-red-200 hover:bg-red-50 text-red-600 transition-all cursor-pointer active:scale-[0.98]"
                                      >
                                        <Trash2 className="size-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

        {/* VIEW: DEMO APPOINTMENTS */}
        {activeTab === "demo" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                { label: "Total Requests", value: demoSummary.total, hint: "All captured leads" },
                { label: "Fresh Leads", value: demoSummary.fresh, hint: "Need first response" },
                { label: "Contacted", value: demoSummary.contacted, hint: "Follow-up started" },
                { label: "Scheduled", value: demoSummary.scheduled, hint: "Demo slot locked" },
              ].map((card) => (
                <div key={card.label} className="rounded-3xl border border-zinc-200/80 bg-white p-5">
                  <span className="block text-[10px] font-extrabold uppercase tracking-widest text-zinc-400">
                    {card.label}
                  </span>
                  <span className="mt-2 block text-3xl font-black tracking-tight text-zinc-950">
                    {card.value}
                  </span>
                  <span className="mt-2 block text-[10px] font-semibold text-zinc-500">{card.hint}</span>
                </div>
              ))}
            </div>

            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 space-y-6">
              <div className="flex flex-col gap-4 border-b border-zinc-150 pb-5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-sm font-extrabold text-zinc-900">Public Demo Requests</h2>
                  <p className="mt-0.5 text-[10px] text-zinc-400">
                    Every contact-page booking lands here with the preferred slot and outreach status.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      placeholder="Search by name, tenant, phone, or ref..."
                      value={demoSearchQuery}
                      onChange={(e) => setDemoSearchQuery(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50/50 py-2 pl-9 pr-4 text-xs font-semibold text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all shadow-inner"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2">
                    <Activity className="size-3.5 text-zinc-400" />
                    <select
                      value={demoStatusFilter}
                      onChange={(e) => setDemoStatusFilter(e.target.value)}
                      className="border-none bg-transparent pr-1 text-xs font-extrabold text-zinc-700 focus:outline-none"
                    >
                      <option value="all">All statuses</option>
                      <option value="new">New</option>
                      <option value="contacted">Contacted</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                {loadingData ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-20">
                    <Loader2 className="size-7 animate-spin text-zinc-900" />
                    <span className="text-xs font-bold text-zinc-400">Loading demo pipeline...</span>
                  </div>
                ) : filteredDemoAppointments.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-zinc-150 bg-zinc-50">
                      <Calendar className="size-5 text-zinc-400" />
                    </div>
                    <h3 className="mt-4 text-xs font-bold text-zinc-700">No demo bookings match this view</h3>
                    <p className="mt-1 text-[10px] text-zinc-400">
                      New contact-page bookings will start appearing here automatically.
                    </p>
                  </div>
                ) : (
                  <table className="min-w-[1120px] w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-zinc-150 text-[10px] uppercase tracking-wider text-zinc-400">
                        <th className="pb-3 pl-3 font-bold">Lead</th>
                        <th className="pb-3 font-bold">Organisation</th>
                        <th className="pb-3 font-bold">Requested Slot</th>
                        <th className="pb-3 font-bold">Mode</th>
                        <th className="pb-3 font-bold">Notes</th>
                        <th className="pb-3 font-bold">Status</th>
                        <th className="pb-3 pr-3 text-right font-bold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 text-xs text-zinc-700">
                      {filteredDemoAppointments.map((demo) => (
                        <tr key={demo.id} className="group transition-colors hover:bg-slate-50/50">
                          <td className="py-4 pl-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-zinc-900">{demo.name}</span>
                                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-black text-zinc-600">
                                  {demo.referenceId}
                                </span>
                              </div>
                              <div className="text-[10px] font-semibold text-zinc-400">
                                <span>{demo.email}</span>
                                <span className="mx-1.5">•</span>
                                <span>{demo.phone}</span>
                              </div>
                            </div>
                          </td>

                          <td className="py-4">
                            <div className="space-y-1">
                              <span className="block font-bold text-zinc-800">{demo.organization}</span>
                              <span className="block text-[10px] font-semibold text-zinc-400">
                                {demo.city} • {demo.businessType} • {demo.teamSize}
                              </span>
                            </div>
                          </td>

                          <td className="py-4">
                            <div className="space-y-1">
                              <span className="block font-bold text-zinc-800">
                                {formatDate(demo.preferredDate)}
                              </span>
                              <span className="block text-[10px] font-semibold text-zinc-400">
                                {demo.preferredTime}
                              </span>
                              <span className="block text-[10px] font-semibold text-zinc-400">
                                Submitted {formatDate(demo.createdAt, true)}
                              </span>
                            </div>
                          </td>

                          <td className="py-4">
                            <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[10px] font-extrabold text-zinc-700">
                              {demo.preferredMode}
                            </span>
                          </td>

                          <td className="py-4">
                            <p className="max-w-[240px] text-[11px] leading-5 text-zinc-500">
                              {demo.message || "No extra workflow notes shared."}
                            </p>
                          </td>

                          <td className="py-4">
                            <div className="space-y-2">
                              <span
                                className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-extrabold border ${
                                  demo.status === "New"
                                    ? "border-amber-200 bg-amber-50 text-amber-700"
                                    : demo.status === "Scheduled"
                                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                      : demo.status === "Completed"
                                        ? "border-zinc-300 bg-zinc-100 text-zinc-800"
                                        : demo.status === "Cancelled"
                                          ? "border-red-200 bg-red-50 text-red-700"
                                          : "border-sky-200 bg-sky-50 text-sky-700"
                                }`}
                              >
                                {demo.status}
                              </span>
                              {demo.lastContactedAt && (
                                <span className="block text-[10px] font-semibold text-zinc-400">
                                  Last touched {formatDate(demo.lastContactedAt, true)}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-4 pr-3">
                            <div className="flex items-center justify-end gap-2">
                              <a
                                href={`mailto:${demo.email}`}
                                className="rounded-xl border border-zinc-200 px-3 py-2 text-[10px] font-extrabold text-zinc-700 transition-all hover:border-zinc-300 hover:bg-zinc-50"
                              >
                                Email
                              </a>
                              <a
                                href={`tel:${demo.phone}`}
                                className="rounded-xl border border-zinc-200 px-3 py-2 text-[10px] font-extrabold text-zinc-700 transition-all hover:border-zinc-300 hover:bg-zinc-50"
                              >
                                Call
                              </a>
                              <select
                                value={demo.status}
                                onChange={(e) =>
                                  handleDemoStatusUpdate(demo, e.target.value as DemoAppointmentStatus)
                                }
                                disabled={updatingDemoId === demo.id}
                                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[10px] font-extrabold text-zinc-700 focus:outline-none"
                              >
                                <option value="New">New</option>
                                <option value="Contacted">Contacted</option>
                                <option value="Scheduled">Scheduled</option>
                                <option value="Completed">Completed</option>
                                <option value="Cancelled">Cancelled</option>
                              </select>
                              {updatingDemoId === demo.id && <Loader2 className="size-4 animate-spin text-zinc-500" />}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}


      </div>
    </div>
  </main>



      {/* MODAL: Provision New Tenant */}
      <AnimatePresence>
        {isAddOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-white border border-zinc-200 rounded-[2.5rem] w-full max-w-lg mx-4 shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zinc-150 p-6">
                <div>
                  <h3 className="text-sm font-black text-zinc-950">Provision New Tenant</h3>
                  <p className="text-[10px] text-zinc-555 mt-0.5">Register and setup new tenant portal access.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="rounded-full p-2 text-zinc-405 hover:bg-zinc-100 hover:text-zinc-800 transition-all cursor-pointer"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              {/* Form / Result Body */}
              <div className="p-6">
                {createdResult ? (
                  <div className="space-y-4">
                    <div className="flex flex-col items-center gap-2 py-4 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 border border-emerald-100">
                        <CheckCircle2 className="size-7 text-emerald-600 animate-bounce" />
                      </div>
                      <h4 className="text-sm font-black text-zinc-900">Workspace Provisioned Successfully!</h4>
                      <p className="text-[10px] text-zinc-500 max-w-xs leading-normal">The administrator profile is live. Provide these credentials to the director:</p>
                    </div>

                    <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-4 space-y-3.5 shadow-inner">
                      
                      {/* Workspace Link */}
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-400 font-bold uppercase tracking-wider text-[9px]">Workspace URL</span>
                        <div className="flex items-center gap-2">
                          <code className="text-zinc-900 font-mono text-[11px] font-bold select-all bg-zinc-100 border border-zinc-200 px-2 py-0.5 rounded">
                            {`/book/${createdResult.tenantId}`}
                          </code>
                          <button
                            onClick={() => copyToClipboard(`/book/${createdResult.tenantId}`, "link")}
                            className="p-1 hover:bg-zinc-200/50 rounded transition-colors text-zinc-500 hover:text-zinc-800"
                            title="Copy link"
                          >
                            {copiedField === "link" ? <Check className="size-3.5 text-emerald-600" /> : <Clipboard className="size-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Admin Email */}
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-400 font-bold uppercase tracking-wider text-[9px]">Admin Email</span>
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-zinc-800 select-all">{createdResult.email}</span>
                          <button
                            onClick={() => copyToClipboard(createdResult.email, "email")}
                            className="p-1 hover:bg-zinc-200/50 rounded transition-colors text-zinc-500 hover:text-zinc-800"
                            title="Copy email"
                          >
                            {copiedField === "email" ? <Check className="size-3.5 text-emerald-600" /> : <Clipboard className="size-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Password */}
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-400 font-bold uppercase tracking-wider text-[9px]">Temporary Password</span>
                        <div className="flex items-center gap-2">
                          <code className="font-mono bg-white border border-zinc-250 px-2.5 py-0.5 rounded text-zinc-850 text-[11px] font-black select-all">
                            {createdResult.tempPassword}
                          </code>
                          <button
                            onClick={() => copyToClipboard(createdResult.tempPassword, "password")}
                            className="p-1 hover:bg-zinc-200/50 rounded transition-colors text-zinc-500 hover:text-zinc-800"
                            title="Copy password"
                          >
                            {copiedField === "password" ? <Check className="size-3.5 text-emerald-600" /> : <Clipboard className="size-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => setIsAddOpen(false)}
                      className="w-full rounded-2xl bg-zinc-950 border border-zinc-200 py-3 text-xs font-extrabold text-white hover:bg-zinc-850 transition-all mt-4 cursor-pointer shadow-md active:scale-[0.98]"
                    >
                      Complete Provisioning
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleAddSubmit} className="space-y-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-450 uppercase tracking-widest pl-1">Tenant / Facility Name</label>
                      <div className="relative">
                        <Building className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                        <input
                          type="text"
                          placeholder="e.g. Seattle Grace Hospital"
                          value={addClinicName}
                          onChange={(e) => setAddClinicName(e.target.value)}
                          className="w-full rounded-2xl border border-zinc-200 bg-zinc-50/50 pl-10 pr-4 py-3 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all shadow-inner font-semibold"
                          required
                          disabled={creating}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-450 uppercase tracking-widest pl-1">Practice Size</label>
                      <select
                        value={addPracticeSize}
                        onChange={(e) => setAddPracticeSize(e.target.value)}
                        className="w-full rounded-2xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-3 text-xs text-zinc-850 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all select-light font-extrabold"
                        disabled={creating}
                      >
                        <option value="1-3 providers">1-3 providers (Small Clinic)</option>
                        <option value="4-10 providers">4-10 providers (Medium Facility)</option>
                        <option value="11+ providers">11+ providers (Hospital / Enterprise)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-455 uppercase tracking-widest pl-1">Medical Director (Owner Name)</label>
                      <div className="relative">
                        <UserCheck className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
                        <input
                          type="text"
                          placeholder="e.g. Dr. Meredith Grey"
                          value={addName}
                          onChange={(e) => setAddName(e.target.value)}
                          className="w-full rounded-2xl border border-zinc-200 bg-zinc-50/50 pl-10 pr-4 py-3 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all shadow-inner font-semibold"
                          required
                          disabled={creating}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-455 uppercase tracking-widest pl-1">Director Email</label>
                        <input
                          type="email"
                          placeholder="owner@facility.com"
                          value={addEmail}
                          onChange={(e) => setAddEmail(e.target.value)}
                          className="w-full rounded-2xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-3 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all shadow-inner font-semibold"
                          required
                          disabled={creating}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-455 uppercase tracking-widest pl-1">Phone Number</label>
                        <input
                          type="text"
                          placeholder="e.g. 7745868073"
                          value={addPhone}
                          onChange={(e) => setAddPhone(e.target.value)}
                          className="w-full rounded-2xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-3 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all shadow-inner font-semibold"
                          required
                          disabled={creating}
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-455 uppercase tracking-widest pl-1">Custom Temporary Password (Optional)</label>
                      <input
                        type="text"
                        value={addPassword}
                        onChange={(e) => setAddPassword(e.target.value)}
                        className="w-full rounded-2xl border border-zinc-200 bg-zinc-50/50 px-3.5 py-3 text-xs text-zinc-850 font-bold focus:border-zinc-405 focus:bg-white focus:outline-none transition-all shadow-inner"
                        disabled={creating}
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2.5 pt-4">
                      <button
                        type="button"
                        onClick={() => setIsAddOpen(false)}
                        disabled={creating}
                        className="flex-1 rounded-2xl border border-zinc-200 py-3 text-xs font-extrabold text-zinc-500 hover:text-zinc-850 hover:bg-zinc-55 transition-all cursor-pointer active:scale-[0.98]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={creating}
                        className="flex-1 rounded-2xl bg-zinc-950 hover:bg-zinc-850 py-3 text-xs font-extrabold text-white transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 shadow-md"
                      >
                        {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Provision Account
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* MODAL: Delete Confirmation */}
      <AnimatePresence>
        {deletingTenant && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-white border border-zinc-200 rounded-3xl w-full max-w-sm mx-4 shadow-2xl overflow-hidden p-6 text-center relative"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 border border-red-100 mb-4">
                <AlertCircle className="size-7 text-red-600" />
              </div>
              <h3 className="text-lg font-black text-zinc-950 mb-2">Delete Tenant Data?</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-6">
                Are you sure you want to completely delete the tenant <span className="font-bold text-zinc-800">"{deletingTenant.clinicName}"</span>? This action cannot be undone and will erase all data associated with it.
              </p>
              
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeletingTenant(null)}
                  disabled={isDeleting}
                  className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={executeDeleteTenant}
                  disabled={isDeleting}
                  className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 py-2.5 text-xs font-extrabold text-white transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-md active:scale-[0.98]"
                >
                  {isDeleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Subscription payments + invoices modal */}
      <AnimatePresence>
        {subPaymentsModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="relative bg-white rounded-[1.5rem] border border-zinc-200 w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 shrink-0">
                <div>
                  <h3 className="text-sm font-black text-zinc-900">Subscription Payments</h3>
                  <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">
                    {subPaymentsModal.subscription?.clinicName || subPaymentsModal.subscription?.customerName || subPaymentsModal.subscription?.subscriptionRef}
                  </p>
                </div>
                <button type="button" onClick={() => setSubPaymentsModal(null)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="overflow-y-auto p-5">
                {loadingSubPayments ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Loader2 className="size-6 text-zinc-900 animate-spin" />
                    <span className="text-xs text-zinc-400 font-bold">Syncing payments from Cashfree...</span>
                  </div>
                ) : subPaymentsModal.payments.length === 0 ? (
                  <div className="text-center py-14 text-xs text-zinc-400 font-semibold">
                    No payments recorded for this subscription yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {subPaymentsModal.payments.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-150 bg-zinc-50/40 px-4 py-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-black text-zinc-900">{formatCurrencyInr(p.amount)}</span>
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${
                              p.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700 border-emerald-150" :
                              p.status === "FAILED" ? "bg-red-50 text-red-700 border-red-150" :
                              "bg-amber-50 text-amber-700 border-amber-150"
                            }`}>{p.status}</span>
                            {p.paymentType && <span className="text-[9px] font-bold text-zinc-400 uppercase">{p.paymentType}</span>}
                          </div>
                          <div className="text-[10px] text-zinc-400 font-medium mt-1 space-y-0.5 truncate">
                            <div>{p.paymentMethod || "Cashfree"} · {new Date(p.paidAt || p.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
                            {p.cfPaymentId && <div>CF Payment: <code className="text-[9px] bg-zinc-100 border border-zinc-200/50 px-1 rounded font-mono">{p.cfPaymentId}</code></div>}
                            {p.cfTxnId && <div>Txn: <code className="text-[9px] bg-zinc-100 border border-zinc-200/50 px-1 rounded font-mono">{p.cfTxnId}</code></div>}
                          </div>
                        </div>
                        <div className="shrink-0 flex items-center gap-1.5">
                          {(["view", "download"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              title={mode === "view" ? "View invoice" : "Download invoice"}
                              onClick={async () => {
                                try {
                                  const { viewInvoice, downloadInvoice } = await import("../lib/pdf-invoice");
                                  const sub = subPaymentsModal.subscription || {};
                                  const data = {
                                    clinicName: sub.clinicName, customerName: sub.customerName, customerEmail: sub.customerEmail, customerPhone: sub.customerPhone,
                                    plan: sub.planTier, amount: Number(p.amount), status: p.status, paymentMethod: p.paymentMethod, paymentType: p.paymentType,
                                    transactionType: p.paymentType === "AUTH" ? "Mandate Registration" : "Subscription Renewal",
                                    cfPaymentId: p.cfPaymentId, cfTxnId: p.cfTxnId, cfOrderId: p.cfOrderId, subscriptionRef: sub.subscriptionRef,
                                    transactionRef: p.id, paidAt: p.paidAt, createdAt: p.createdAt,
                                  };
                                  if (mode === "view") await viewInvoice(data);
                                  else await downloadInvoice(data);
                                } catch (err: any) {
                                  toast.error("Could not generate invoice: " + err.message);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-zinc-600 hover:text-brand hover:border-brand/30 transition-colors cursor-pointer"
                            >
                              {mode === "view" ? <><Eye className="size-3" /> View</> : <><FileText className="size-3" /> PDF</>}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Record Manual Offline Payment */}
      <AnimatePresence>
        {isRecordPaymentOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="bg-white rounded-3xl border border-zinc-200 w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                <div>
                  <h3 className="text-sm font-black text-zinc-900">Record Offline Manual Payment</h3>
                  <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">Manually log a custom bank transfer, cash, or offline payment.</p>
                </div>
                <button type="button" onClick={() => setIsRecordPaymentOpen(false)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleRecordPaymentSubmit} className="overflow-y-auto p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Select Clinic / Tenant *</label>
                  <select
                    required
                    value={addPayTenantId}
                    onChange={(e) => {
                      const selected = tenants.find(t => t.tenantId === e.target.value);
                      setAddPayTenantId(e.target.value);
                      if (selected) {
                        setAddPayName(selected.name || "");
                        setAddPayEmail(selected.email || "");
                        setAddPayPhone(selected.phone || "");
                        setAddPayAmount(selected.subscriptionPlan === "Premium" ? 9999 : selected.subscriptionPlan === "Pro" ? 4999 : 2499);
                      }
                    }}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                  >
                    <option value="">-- Choose Clinic / Tenant --</option>
                    {tenants.map(t => (
                      <option key={t.id} value={t.tenantId}>{t.clinicName} ({t.name})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Plan Identifier *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Pro, Premium, Basic"
                      value={addPayPlan}
                      onChange={(e) => setAddPayPlan(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Amount (INR) *</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={addPayAmount}
                      onChange={(e) => setAddPayAmount(Number(e.target.value))}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Payment Mode *</label>
                    <select
                      value={addPayMethod}
                      onChange={(e) => setAddPayMethod(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="UPI">UPI / GPay / PhonePe</option>
                      <option value="BANK_TRANSFER">Bank Transfer (IMPS/NEFT)</option>
                      <option value="CASH">Offline Cash</option>
                      <option value="CARD">Credit / Debit Card</option>
                      <option value="OFFLINE">Other Offline</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Status *</label>
                    <select
                      value={addPayStatus}
                      onChange={(e) => setAddPayStatus(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="SUCCESS">SUCCESS (Received)</option>
                      <option value="PENDING">PENDING (Awaiting)</option>
                      <option value="FAILED">FAILED (Rejected)</option>
                      <option value="CANCELLED">CANCELLED</option>
                    </select>
                  </div>
                </div>

                <div className="border-t border-zinc-100 pt-3 space-y-3">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider block">Customer Details (Overrides)</span>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Customer Name</label>
                    <input
                      type="text"
                      placeholder="Full Name"
                      value={addPayName}
                      onChange={(e) => setAddPayName(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400">Customer Email</label>
                      <input
                        type="email"
                        placeholder="email@example.com"
                        value={addPayEmail}
                        onChange={(e) => setAddPayEmail(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400">Customer Phone</label>
                      <input
                        type="text"
                        placeholder="Phone Number"
                        value={addPayPhone}
                        onChange={(e) => setAddPayPhone(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Transaction Date (Backdate)</label>
                  <input
                    type="date"
                    value={addPayDate}
                    onChange={(e) => setAddPayDate(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                  />
                </div>

                <div className="flex gap-2.5 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsRecordPaymentOpen(false)}
                    className="flex-1 rounded-xl border border-zinc-200 py-3 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-zinc-950 hover:bg-zinc-800 py-3 text-xs font-extrabold text-white transition-all shadow-md active:scale-[0.98]"
                  >
                    Log Payment Entry
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Edit Payment Entry */}
      <AnimatePresence>
        {editingPayment && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="bg-white rounded-3xl border border-zinc-200 w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                <div>
                  <h3 className="text-sm font-black text-zinc-900">Adjust Transaction Log</h3>
                  <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">Order ID: {editingPayment.orderId}</p>
                </div>
                <button type="button" onClick={() => setEditingPayment(null)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleEditPaymentSubmit} className="overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Amount (INR)</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={editPayAmount}
                      onChange={(e) => setEditPayAmount(Number(e.target.value))}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Payment Mode</label>
                    <input
                      type="text"
                      placeholder="e.g. UPI, CARD, BANK_TRANSFER"
                      value={editPayMethod}
                      onChange={(e) => setEditPayMethod(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Status</label>
                  <select
                    value={editPayStatus}
                    onChange={(e) => setEditPayStatus(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                  >
                    <option value="SUCCESS">SUCCESS (Received)</option>
                    <option value="PENDING">PENDING (Awaiting)</option>
                    <option value="FAILED">FAILED (Rejected)</option>
                    <option value="CANCELLED">CANCELLED</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Remarks / Failure Reason</label>
                  <textarea
                    rows={2}
                    placeholder="Enter payment notes, remarks, check number, or gateway failure reason."
                    value={editPayReason}
                    onChange={(e) => setEditPayReason(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold resize-none"
                  />
                </div>

                <div className="border-t border-zinc-100 pt-3 space-y-3">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider block">Customer Details Override</span>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Customer Name</label>
                    <input
                      type="text"
                      value={editPayName}
                      onChange={(e) => setEditPayName(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400">Customer Email</label>
                      <input
                        type="email"
                        value={editPayEmail}
                        onChange={(e) => setEditPayEmail(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400">Customer Phone</label>
                      <input
                        type="text"
                        value={editPayPhone}
                        onChange={(e) => setEditPayPhone(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingPayment(null)}
                    className="flex-1 rounded-xl border border-zinc-200 py-3 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-zinc-950 hover:bg-zinc-800 py-3 text-xs font-extrabold text-white transition-all shadow-md active:scale-[0.98]"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Delete Payment Log Confirmation */}
      <AnimatePresence>
        {deletingPayment && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-white border border-zinc-200 rounded-3xl w-full max-w-sm shadow-2xl p-6 text-center relative"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 border border-red-150 mb-4">
                <AlertCircle className="size-7 text-red-600" />
              </div>
              <h3 className="text-lg font-black text-zinc-950 mb-2">Delete Payment Record?</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-6">
                Are you sure you want to delete the transaction log for <span className="font-extrabold text-zinc-800">{deletingPayment.customerName || deletingPayment.clinicName}</span> of amount <span className="font-bold text-zinc-800">{formatCurrencyInr(deletingPayment.amount)}</span>? This action is permanent and cannot be undone.
              </p>
              
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeletingPayment(null)}
                  className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeletePaymentSubmit}
                  className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 py-2.5 text-xs font-extrabold text-white transition-all cursor-pointer shadow-md active:scale-[0.98]"
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DRAWER: View Payment Info Details */}
      <AnimatePresence>
        {viewPaymentDetails && (
          <div className="fixed inset-0 z-[110] flex justify-end bg-black/40 backdrop-blur-xs">
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="h-full w-full max-w-md bg-white border-l border-zinc-200 shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-zinc-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-zinc-955">Payment Metadata Specs</h3>
                  <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">Order ID: {viewPaymentDetails.orderId}</p>
                </div>
                <button
                  onClick={() => setViewPaymentDetails(null)}
                  className="p-1.5 rounded-lg hover:bg-zinc-50 text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  <X className="size-4.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Visual Status Header */}
                <div className="bg-zinc-50 rounded-2xl border border-zinc-150 p-4 flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border ${
                    viewPaymentDetails.status === "SUCCESS" ? "bg-emerald-50 text-emerald-600 border-emerald-150" :
                    viewPaymentDetails.status === "FAILED" ? "bg-red-50 text-red-600 border-red-150" :
                    "bg-amber-50 text-amber-600 border-amber-150"
                  }`}>
                    <CreditCard className="size-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">Transaction Amount</span>
                    <span className="text-lg font-black text-zinc-950 block">{formatCurrencyInr(viewPaymentDetails.amount)}</span>
                  </div>
                  <div className="ml-auto">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase border ${
                      viewPaymentDetails.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700 border-emerald-150" :
                      viewPaymentDetails.status === "FAILED" ? "bg-red-50 text-red-700 border-red-150" :
                      "bg-amber-50 text-amber-700 border-amber-150"
                    }`}>
                      {viewPaymentDetails.status}
                    </span>
                  </div>
                </div>

                {/* Primary Specs */}
                <div className="space-y-3.5">
                  <h4 className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Transaction Specs</h4>
                  <div className="rounded-2xl border border-zinc-155 bg-white divide-y divide-zinc-100 text-xs">
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-500">Transaction ID</span>
                      <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-800">{viewPaymentDetails.id}</code>
                    </div>
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-505">Cashfree Order ID</span>
                      <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-800">{viewPaymentDetails.orderId}</code>
                    </div>
                    {viewPaymentDetails.cfPaymentId && (
                      <div className="flex items-center justify-between p-3.5">
                        <span className="font-semibold text-zinc-500">CF Payment ID</span>
                        <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-800">{viewPaymentDetails.cfPaymentId}</code>
                      </div>
                    )}
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-500">Payment Mode</span>
                      <span className="font-bold text-zinc-800">{viewPaymentDetails.paymentMode || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-500">Billing Type</span>
                      <span className="font-extrabold text-purple-700 capitalize text-[10px] px-1.5 py-0.5 rounded bg-purple-50 border border-purple-100 uppercase">
                        {viewPaymentDetails.type === "subscription" ? "AutoPay Recurring" : "Checkout One-time"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-500">Date Logged</span>
                      <span className="font-bold text-zinc-700">
                        {new Date(viewPaymentDetails.createdAt).toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Customer Details */}
                <div className="space-y-3.5">
                  <h4 className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Clinician / Subscriber</h4>
                  <div className="rounded-2xl border border-zinc-150 bg-white p-4 space-y-3 text-xs">
                    <div className="flex items-start gap-2.5">
                      <User className="size-4 text-zinc-400 mt-0.5" />
                      <div>
                        <span className="text-[10px] text-zinc-400 block font-semibold">Subscriber Name</span>
                        <span className="font-bold text-zinc-900">{viewPaymentDetails.customerName || viewPaymentDetails.clinicName || "—"}</span>
                      </div>
                    </div>
                    {viewPaymentDetails.customerEmail && (
                      <div className="flex items-start gap-2.5">
                        <Mail className="size-4 text-zinc-400 mt-0.5" />
                        <div>
                          <span className="text-[10px] text-zinc-400 block font-semibold">Subscriber Email</span>
                          <span className="font-bold text-zinc-900 select-all">{viewPaymentDetails.customerEmail}</span>
                        </div>
                      </div>
                    )}
                    {viewPaymentDetails.customerPhone && (
                      <div className="flex items-start gap-2.5">
                        <Phone className="size-4 text-zinc-400 mt-0.5" />
                        <div>
                          <span className="text-[10px] text-zinc-400 block font-semibold">Subscriber Contact</span>
                          <span className="font-bold text-zinc-900">{viewPaymentDetails.customerPhone}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Failure reason if failed */}
                {viewPaymentDetails.failureReason && (
                  <div className="bg-red-50/50 rounded-2xl border border-red-150 p-4 space-y-1">
                    <span className="text-[10px] font-extrabold text-red-700 uppercase tracking-wider block">Gateway Failure / Remarks Log</span>
                    <p className="text-xs text-red-950 font-medium leading-relaxed">{viewPaymentDetails.failureReason}</p>
                  </div>
                )}
              </div>

              {/* Invoice generation at footer */}
              {viewPaymentDetails.status === "SUCCESS" && (
                <div className="p-6 border-t border-zinc-100 bg-zinc-50 shrink-0 flex gap-2">
                  {(["view", "download"] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={async () => {
                        try {
                          const { viewInvoice, downloadInvoice } = await import("../lib/pdf-invoice");
                          const data = {
                            clinicName: viewPaymentDetails.clinicName,
                            customerName: viewPaymentDetails.customerName,
                            customerEmail: viewPaymentDetails.customerEmail,
                            customerPhone: viewPaymentDetails.customerPhone,
                            plan: viewPaymentDetails.plan || "Pro",
                            amount: Number(viewPaymentDetails.amount),
                            status: viewPaymentDetails.status,
                            paymentMethod: viewPaymentDetails.paymentMode,
                            paymentType: viewPaymentDetails.type === "subscription" ? "RECURRING" : "CHECKOUT",
                            transactionType: viewPaymentDetails.type === "subscription" ? "Subscription Renewal" : "Setup Fee / Checkout",
                            cfPaymentId: viewPaymentDetails.cfPaymentId,
                            cfOrderId: viewPaymentDetails.orderId,
                            transactionRef: viewPaymentDetails.id,
                            paidAt: viewPaymentDetails.createdAt,
                            createdAt: viewPaymentDetails.createdAt,
                          };
                          if (mode === "view") await viewInvoice(data);
                          else await downloadInvoice(data);
                        } catch (err: any) {
                          toast.error("Could not generate invoice: " + err.message);
                        }
                      }}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 bg-white py-3 text-xs font-extrabold text-zinc-700 hover:text-brand hover:border-brand/30 transition-all cursor-pointer active:scale-[0.98] shadow-sm"
                    >
                      {mode === "view" ? <><Eye className="size-3.5" /> View Invoice</> : <><FileText className="size-3.5" /> Download Invoice</>}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Provision Custom Subscription */}
      <AnimatePresence>
        {isProvisionSubOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="bg-white rounded-3xl border border-zinc-200 w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                <div>
                  <h3 className="text-sm font-black text-zinc-900">Provision Custom Subscription Mandate</h3>
                  <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">Establish a manual, recurring SaaS subscription contract for a tenant.</p>
                </div>
                <button type="button" onClick={() => setIsProvisionSubOpen(false)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleProvisionSubSubmit} className="overflow-y-auto p-6 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Select Clinic / Tenant *</label>
                  <select
                    required
                    value={addSubTenantId}
                    onChange={(e) => {
                      const selected = tenants.find(t => t.tenantId === e.target.value);
                      setAddSubTenantId(e.target.value);
                      if (selected) {
                        setAddSubName(selected.name || "");
                        setAddSubEmail(selected.email || "");
                        setAddSubPhone(selected.phone || "");
                        setAddSubAmount(selected.subscriptionPlan === "Premium" ? 9999 : selected.subscriptionPlan === "Pro" ? 4999 : 2499);
                        setAddSubPlan(selected.subscriptionPlan || "Pro");
                      }
                    }}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                  >
                    <option value="">-- Choose Clinic / Tenant --</option>
                    {tenants.map(t => (
                      <option key={t.id} value={t.tenantId}>{t.clinicName} ({t.name})</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Plan / Tier *</label>
                    <select
                      value={addSubPlan}
                      onChange={(e) => {
                        setAddSubPlan(e.target.value);
                        setAddSubAmount(e.target.value === "Premium" ? 9999 : e.target.value === "Pro" ? 4999 : 2499);
                      }}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="Basic">Basic</option>
                      <option value="Pro">Pro</option>
                      <option value="Premium">Premium</option>
                      <option value="Clinic">Clinic</option>
                      <option value="Enterprise">Enterprise</option>
                      <option value="Solo">Solo</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Billing Amount (INR) *</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={addSubAmount}
                      onChange={(e) => setAddSubAmount(Number(e.target.value))}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1 space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Interval *</label>
                    <select
                      value={addSubInterval}
                      onChange={(e) => setAddSubInterval(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="MONTH">Monthly</option>
                      <option value="YEAR">Yearly</option>
                    </select>
                  </div>
                  <div className="col-span-1 space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Intervals *</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={addSubIntervals}
                      onChange={(e) => setAddSubIntervals(Number(e.target.value))}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    />
                  </div>
                  <div className="col-span-1 space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Status *</label>
                    <select
                      value={addSubStatus}
                      onChange={(e) => setAddSubStatus(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="ON_HOLD">ON_HOLD</option>
                      <option value="CANCELLED">CANCELLED</option>
                      <option value="INITIALIZED">INITIALIZED</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Period Start</label>
                    <input
                      type="date"
                      value={addSubPeriodStart}
                      onChange={(e) => setAddSubPeriodStart(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 focus:bg-white focus:outline-none font-semibold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Period End</label>
                    <input
                      type="date"
                      value={addSubPeriodEnd}
                      onChange={(e) => setAddSubPeriodEnd(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 focus:bg-white focus:outline-none font-semibold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Next Charge</label>
                    <input
                      type="date"
                      value={addSubNextCharge}
                      onChange={(e) => setAddSubNextCharge(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 focus:bg-white focus:outline-none font-semibold"
                    />
                  </div>
                </div>

                <div className="border-t border-zinc-100 pt-3 space-y-3">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider block">Customer Overrides</span>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Subscriber Name</label>
                    <input
                      type="text"
                      placeholder="Subscriber Full Name"
                      value={addSubName}
                      onChange={(e) => setAddSubName(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400">Subscriber Email</label>
                      <input
                        type="email"
                        placeholder="email@example.com"
                        value={addSubEmail}
                        onChange={(e) => setAddSubEmail(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400">Subscriber Phone</label>
                      <input
                        type="text"
                        placeholder="Phone Number"
                        value={addSubPhone}
                        onChange={(e) => setAddSubPhone(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsProvisionSubOpen(false)}
                    className="flex-1 rounded-xl border border-zinc-200 py-3 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-zinc-950 hover:bg-zinc-800 py-3 text-xs font-extrabold text-white transition-all shadow-md active:scale-[0.98]"
                  >
                    Provision Mandate
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Edit Subscription Mandate */}
      <AnimatePresence>
        {editingSub && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="bg-white rounded-3xl border border-zinc-200 w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                <div>
                  <h3 className="text-sm font-black text-zinc-900">Modify Subscription Mandate Specs</h3>
                  <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">Ref ID: {editingSub.subscriptionRef}</p>
                </div>
                <button type="button" onClick={() => setEditingSub(null)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleEditSubSubmit} className="overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Plan Tier</label>
                    <select
                      value={editSubPlan}
                      onChange={(e) => setEditSubPlan(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="Basic">Basic</option>
                      <option value="Pro">Pro</option>
                      <option value="Premium">Premium</option>
                      <option value="Clinic">Clinic</option>
                      <option value="Enterprise">Enterprise</option>
                      <option value="Solo">Solo</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Price (INR)</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={editSubAmount}
                      onChange={(e) => setEditSubAmount(Number(e.target.value))}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1 space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Interval</label>
                    <select
                      value={editSubInterval}
                      onChange={(e) => setEditSubInterval(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="MONTH">Monthly</option>
                      <option value="YEAR">Yearly</option>
                    </select>
                  </div>
                  <div className="col-span-1 space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Intervals</label>
                    <input
                      type="number"
                      required
                      min="1"
                      value={editSubIntervals}
                      onChange={(e) => setEditSubIntervals(Number(e.target.value))}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    />
                  </div>
                  <div className="col-span-1 space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Status</label>
                    <select
                      value={editSubStatus}
                      onChange={(e) => setEditSubStatus(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="ON_HOLD">ON_HOLD</option>
                      <option value="CANCELLED">CANCELLED</option>
                      <option value="INITIALIZED">INITIALIZED</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Period Start</label>
                    <input
                      type="date"
                      value={editSubPeriodStart}
                      onChange={(e) => setEditSubPeriodStart(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 focus:bg-white focus:outline-none font-semibold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Period End</label>
                    <input
                      type="date"
                      value={editSubPeriodEnd}
                      onChange={(e) => setEditSubPeriodEnd(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 focus:bg-white focus:outline-none font-semibold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Next Charge</label>
                    <input
                      type="date"
                      value={editSubNextCharge}
                      onChange={(e) => setEditSubNextCharge(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-800 focus:bg-white focus:outline-none font-semibold"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Cancel At Period End?</label>
                  <select
                    value={editSubCancelAtEnd}
                    onChange={(e) => setEditSubCancelAtEnd(Number(e.target.value))}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                  >
                    <option value={0}>No - Keep Auto-Renewing</option>
                    <option value={1}>Yes - Terminate on period end</option>
                  </select>
                </div>

                <div className="border-t border-zinc-100 pt-3 space-y-3">
                  <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider block">Customer Details Override</span>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-zinc-400">Subscriber Name</label>
                    <input
                      type="text"
                      value={editSubName}
                      onChange={(e) => setEditSubName(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400">Subscriber Email</label>
                      <input
                        type="email"
                        value={editSubEmail}
                        onChange={(e) => setEditSubEmail(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-400">Subscriber Phone</label>
                      <input
                        type="text"
                        value={editSubPhone}
                        onChange={(e) => setEditSubPhone(e.target.value)}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingSub(null)}
                    className="flex-1 rounded-xl border border-zinc-200 py-3 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-zinc-950 hover:bg-zinc-850 py-3 text-xs font-extrabold text-white transition-all shadow-md active:scale-[0.98]"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Record Subscription Cycle Payment (Log Charge) */}
      <AnimatePresence>
        {logPaymentSub && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              className="bg-white rounded-3xl border border-zinc-200 w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                <div>
                  <h3 className="text-sm font-black text-zinc-900">Log Subscription Charge / Renewal</h3>
                  <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">Subscriber: {logPaymentSub.clinicName || logPaymentSub.customerName}</p>
                </div>
                <button type="button" onClick={() => setLogPaymentSub(null)} className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleLogPaymentSubmit} className="overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Charge Amount (INR) *</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={logPayAmount}
                      onChange={(e) => setLogPayAmount(Number(e.target.value))}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Payment Mode *</label>
                    <select
                      value={logPayMethod}
                      onChange={(e) => setLogPayMethod(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="UPI">UPI / GPay / PhonePe</option>
                      <option value="BANK_TRANSFER">Bank Transfer (IMPS/NEFT)</option>
                      <option value="CASH">Offline Cash</option>
                      <option value="CARD">Credit / Debit Card</option>
                      <option value="OFFLINE">Other Offline</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Status *</label>
                    <select
                      value={logPayStatus}
                      onChange={(e) => setLogPayStatus(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="SUCCESS">SUCCESS (Paid)</option>
                      <option value="PENDING">PENDING (Awaiting)</option>
                      <option value="FAILED">FAILED (Rejected)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Txn Type *</label>
                    <select
                      value={logPayType}
                      onChange={(e) => setLogPayType(e.target.value)}
                      className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-bold"
                    >
                      <option value="CHARGE">CHARGE (Renewal Payment)</option>
                      <option value="AUTH">AUTH (Mandate Setup verification)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Paid Date</label>
                  <input
                    type="date"
                    value={logPayDate}
                    onChange={(e) => setLogPayDate(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Remarks / Notes</label>
                  <textarea
                    rows={2}
                    placeholder="Enter manual cycle references, invoice notes, or receipt metadata."
                    value={logPayRemarks}
                    onChange={(e) => setLogPayRemarks(e.target.value)}
                    className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-none font-semibold resize-none"
                  />
                </div>

                <div className="flex gap-2.5 pt-4">
                  <button
                    type="button"
                    onClick={() => setLogPaymentSub(null)}
                    className="flex-1 rounded-xl border border-zinc-200 py-3 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 rounded-xl bg-zinc-950 hover:bg-zinc-800 py-3 text-xs font-extrabold text-white transition-all shadow-md active:scale-[0.98]"
                  >
                    Record Cycle Payment
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Delete Subscription Confirmation */}
      <AnimatePresence>
        {deletingSub && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-white border border-zinc-200 rounded-3xl w-full max-w-sm shadow-2xl p-6 text-center relative"
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 border border-red-150 mb-4">
                <AlertCircle className="size-7 text-red-600" />
              </div>
              <h3 className="text-lg font-black text-zinc-950 mb-2">Delete Subscription Mandate?</h3>
              <p className="text-xs text-zinc-500 leading-relaxed mb-6">
                Are you sure you want to delete the subscription mandate log for <span className="font-extrabold text-zinc-800">{deletingSub.clinicName || deletingSub.customerName}</span>? This will wipe the billing contract logs from dashboard metrics, but will not cancel any actual live recurring payments in Cashfree.
              </p>
              
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeletingSub(null)}
                  className="flex-1 rounded-xl border border-zinc-200 py-2.5 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSubSubmit}
                  className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 py-2.5 text-xs font-extrabold text-white transition-all cursor-pointer shadow-md active:scale-[0.98]"
                >
                  Confirm Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* DRAWER: View Subscription Info Details */}
      <AnimatePresence>
        {viewSubDetails && (
          <div className="fixed inset-0 z-[110] flex justify-end bg-black/40 backdrop-blur-xs">
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="h-full w-full max-w-lg bg-white border-l border-zinc-200 shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="px-6 py-5 border-b border-zinc-100 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-zinc-950">Subscription Contract Specs</h3>
                  <p className="text-[10px] text-zinc-400 font-semibold mt-0.5">Ref ID: {viewSubDetails.subscriptionRef}</p>
                </div>
                <button
                  onClick={() => setViewSubDetails(null)}
                  className="p-1.5 rounded-lg hover:bg-zinc-50 text-zinc-400 hover:text-zinc-600 transition-colors"
                >
                  <X className="size-4.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Visual Status Header */}
                <div className="bg-zinc-50 rounded-2xl border border-zinc-150 p-4 flex items-center gap-3">
                  <div className={`p-2.5 rounded-xl border ${
                    String(viewSubDetails.status).toUpperCase() === "ACTIVE" ? "bg-emerald-50 text-emerald-600 border-emerald-150" :
                    String(viewSubDetails.status).toUpperCase() === "CANCELLED" ? "bg-zinc-100 text-zinc-600 border-zinc-200" :
                    "bg-amber-50 text-amber-600 border-amber-150"
                  }`}>
                    <Activity className="size-5" />
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider block">{viewSubDetails.planTier} Plan</span>
                    <span className="text-lg font-black text-zinc-950 block">
                      {formatCurrencyInr(viewSubDetails.amount)} <span className="text-xs font-bold text-zinc-400">/{viewSubDetails.intervalType === "YEAR" ? "yr" : "mo"}</span>
                    </span>
                  </div>
                  <div className="ml-auto">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase border ${
                      String(viewSubDetails.status).toUpperCase() === "ACTIVE" ? "bg-emerald-50 text-emerald-700 border-emerald-150" :
                      String(viewSubDetails.status).toUpperCase() === "CANCELLED" ? "bg-zinc-100 text-zinc-650 border-zinc-200" :
                      "bg-amber-50 text-amber-700 border-amber-150"
                    }`}>
                      {viewSubDetails.status}
                    </span>
                  </div>
                </div>

                {/* Primary Specs */}
                <div className="space-y-3.5">
                  <h4 className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Contract Details</h4>
                  <div className="rounded-2xl border border-zinc-150 bg-white divide-y divide-zinc-100 text-xs">
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-500">Subscription Ref</span>
                      <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-800 select-all">{viewSubDetails.subscriptionRef}</code>
                    </div>
                    {viewSubDetails.cfSubscriptionId && (
                      <div className="flex items-center justify-between p-3.5">
                        <span className="font-semibold text-zinc-505">Cashfree Sub ID</span>
                        <code className="bg-zinc-50 border border-zinc-200 px-1.5 py-0.5 rounded text-[10px] font-mono text-zinc-800">{viewSubDetails.cfSubscriptionId}</code>
                      </div>
                    )}
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-505">Billing Cycle</span>
                      <span className="font-bold text-zinc-800">{viewSubDetails.intervals} {viewSubDetails.intervalType}(s)</span>
                    </div>
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-505">Next Charge Date</span>
                      <span className="font-bold text-zinc-700">
                        {viewSubDetails.nextChargeAt ? new Date(viewSubDetails.nextChargeAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-505">Current Period</span>
                      <span className="font-bold text-zinc-700">
                        {viewSubDetails.currentPeriodStart ? new Date(viewSubDetails.currentPeriodStart).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—"}
                        {" → "}
                        {viewSubDetails.currentPeriodEnd ? new Date(viewSubDetails.currentPeriodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between p-3.5">
                      <span className="font-semibold text-zinc-505">Created Date</span>
                      <span className="font-bold text-zinc-700">
                        {new Date(viewSubDetails.createdAt).toLocaleString("en-IN")}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subscriber Info */}
                <div className="space-y-3.5">
                  <h4 className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Subscriber Clinic</h4>
                  <div className="rounded-2xl border border-zinc-150 bg-white p-4 space-y-3 text-xs">
                    <div className="flex items-start gap-2.5">
                      <User className="size-4 text-zinc-400 mt-0.5" />
                      <div>
                        <span className="text-[10px] text-zinc-400 block font-semibold">Subscriber Name</span>
                        <span className="font-bold text-zinc-900">{viewSubDetails.customerName || viewSubDetails.clinicName || "—"}</span>
                      </div>
                    </div>
                    {viewSubDetails.customerEmail && (
                      <div className="flex items-start gap-2.5">
                        <Mail className="size-4 text-zinc-400 mt-0.5" />
                        <div>
                          <span className="text-[10px] text-zinc-400 block font-semibold">Subscriber Email</span>
                          <span className="font-bold text-zinc-900 select-all">{viewSubDetails.customerEmail}</span>
                        </div>
                      </div>
                    )}
                    {viewSubDetails.customerPhone && (
                      <div className="flex items-start gap-2.5">
                        <Phone className="size-4 text-zinc-400 mt-0.5" />
                        <div>
                          <span className="text-[10px] text-zinc-400 block font-semibold">Subscriber Contact</span>
                          <span className="font-bold text-zinc-900">{viewSubDetails.customerPhone}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Subscription Payment History Ledger */}
                <div className="space-y-3.5">
                  <h4 className="text-[10px] font-extrabold uppercase text-zinc-400 tracking-wider">Payment Ledger History</h4>
                  {loadingViewSubPayments ? (
                    <div className="flex items-center justify-center py-6 text-zinc-400 text-xs gap-1.5">
                      <Loader2 className="h-4 w-4 animate-spin" /> Load billing history...
                    </div>
                  ) : viewSubPayments.length === 0 ? (
                    <p className="text-[10px] text-zinc-400 italic">No cycle payments recorded for this mandate yet.</p>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {viewSubPayments.map((p: any) => {
                        const isAuth = String(p.paymentType || "").toUpperCase() === "AUTH";
                        return (
                          <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-zinc-150 bg-zinc-50/50 px-3 py-2 text-xs">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-zinc-900">{formatCurrencyInr(p.amount)}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${
                                  p.status === "SUCCESS" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                                }`}>{p.status}</span>
                                {isAuth && (
                                  <span className="px-1.5 py-0.5 rounded text-[8px] font-black bg-zinc-100 text-zinc-500" title="Refundable mandate authorization, not a real charge">
                                    MANDATE
                                  </span>
                                )}
                              </div>
                              <div className="text-[9px] text-zinc-400 font-medium mt-0.5">
                                {new Date(p.paidAt || p.createdAt).toLocaleDateString("en-IN")} · {p.paymentMethod || "AutoPay"}
                              </div>
                            </div>
                            {p.status === "SUCCESS" && (
                              <div className="flex items-center gap-1 shrink-0">
                                {(["view", "download"] as const).map((mode) => (
                                  <button
                                    key={mode}
                                    onClick={async () => {
                                      try {
                                        const { viewInvoice, downloadInvoice } = await import("../lib/pdf-invoice");
                                        const data = {
                                          clinicName: viewSubDetails.clinicName,
                                          customerName: viewSubDetails.customerName,
                                          customerEmail: viewSubDetails.customerEmail,
                                          customerPhone: viewSubDetails.customerPhone,
                                          plan: viewSubDetails.planTier,
                                          amount: Number(p.amount),
                                          status: p.status,
                                          paymentMethod: p.paymentMethod,
                                          paymentType: p.paymentType,
                                          transactionType: isAuth ? "Mandate Registration" : "Subscription Renewal",
                                          cfPaymentId: p.cfPaymentId,
                                          cfOrderId: p.cfOrderId,
                                          subscriptionRef: viewSubDetails.subscriptionRef,
                                          transactionRef: p.id,
                                          paidAt: p.paidAt,
                                          createdAt: p.createdAt,
                                        };
                                        if (mode === "view") await viewInvoice(data);
                                        else await downloadInvoice(data);
                                      } catch (err: any) {
                                        toast.error("Failed to generate invoice: " + err.message);
                                      }
                                    }}
                                    className="p-1 border border-zinc-200 rounded hover:bg-white text-zinc-505 hover:text-zinc-800 transition-colors"
                                    title={mode === "view" ? "View invoice" : "Download invoice"}
                                  >
                                    {mode === "view" ? <Eye className="size-3" /> : <FileText className="size-3" />}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
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
