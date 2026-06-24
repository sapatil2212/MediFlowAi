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
  X,
  Database,
  Mail,
  Smartphone,
  ChevronRight,
  TrendingUp,
  FileText,
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
  ArrowLeft
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
  toggleTenantStatusServerFn,
  getTenantFullProfileServerFn,
  deleteTenantServerFn
} from "../lib/admin";
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
  const [activeTab, setActiveTab] = useState<"overview" | "registry" | "demo">("overview");

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

  // Clipboard copy feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);

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
                  {activeTab === "demo" && "Demo Pipeline"}
                </h1>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {activeTab === "overview" && "Real-time metrics, signup distribution, and telemetry snapshots."}
                  {activeTab === "registry" && "Manage clinician accounts, billing status, and plan packages."}
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
    </div>
  );
}
