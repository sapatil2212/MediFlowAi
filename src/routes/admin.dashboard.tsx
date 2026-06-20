import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Users,
  DollarSign,
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
  FileSpreadsheet
} from "lucide-react";
import { toast } from "sonner";
import {
  getSuperAdminSessionServerFn,
  getSuperAdminDashboardDataServerFn,
  updateTenantSaasServerFn,
  createTenantAdminServerFn,
  logoutSuperAdminServerFn,
  controlWhatsAppServerFn,
  getSubscriptionHistoryServerFn
} from "../lib/admin";

export const Route = createFileRoute("/admin/dashboard")({
  head: () => ({
    meta: [
      { title: "Platform Owner Console — MediFlow AI" },
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
}function AdminDashboardPage() {
  const navigate = useNavigate();
  const [admin, setAdmin] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [controllingWA, setControllingWA] = useState(false);
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
  const [activeTab, setActiveTab] = useState<"overview" | "registry" | "telephony" | "diagnostics">("overview");

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Edit Drawer States
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [editStatus, setEditStatus] = useState("Trialing");
  const [editPlan, setEditPlan] = useState("Trial");
  const [editExpiry, setEditExpiry] = useState("");
  const [editPaymentMethod, setEditPaymentMethod] = useState("None");
  const [editPaymentAmount, setEditPaymentAmount] = useState(0);
  const [editBillingInterval, setEditBillingInterval] = useState("monthly");
  const [editVirtualNumber, setEditVirtualNumber] = useState("+1 (415) 555-0100");
  const [editCallLimit, setEditCallLimit] = useState(100);
  const [editCallsHandled, setEditCallsHandled] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [subHistory, setSubHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

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
      const data = await getSuperAdminDashboardDataServerFn();
      setTenants(data.tenants);
      setTrends(data.signupTrends || []);
      setMetrics(data.metrics);
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

  // Open Edit Drawer
  const openEditDrawer = async (t: Tenant) => {
    setEditingTenant(t);
    setEditStatus(t.subscriptionStatus);
    setEditPlan(t.subscriptionPlan);
    setEditExpiry(t.subscriptionExpiresAt ? t.subscriptionExpiresAt.substring(0, 10) : "");
    setEditPaymentMethod(t.paymentMethod);
    setEditPaymentAmount(t.paymentAmount);
    setEditBillingInterval(t.billingInterval);
    setEditVirtualNumber(t.virtualPhoneNumber);
    setEditCallLimit(t.callLimit);
    setEditCallsHandled(t.callsHandled);

    setLoadingHistory(true);
    setSubHistory([]);
    try {
      const history = await getSubscriptionHistoryServerFn({ data: t.id });
      setSubHistory(history || []);
    } catch (err: any) {
      toast.error("Failed to load subscription history: " + err.message);
    } finally {
      setLoadingHistory(false);
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
          virtualPhoneNumber: editVirtualNumber,
          callLimit: Number(editCallLimit),
          callsHandled: Number(editCallsHandled)
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
      toast.success("Clinic tenant registered successfully!");
      // Reset form
      setAddName("");
      setAddEmail("");
      setAddPhone("");
      setAddClinicName("");
      fetchDashboardData();
    } catch (err: any) {
      toast.error(err.message || "Failed to provision new clinic tenant.");
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

  // Calculate SVG Coordinates dynamically based on real trends from database
  const maxTrendCount = Math.max(...trends.map(t => t.count), 1);
  const chartPoints = trends.map((t, idx) => {
    const x = idx * 20; // 0, 20, 40, 60, 80, 100 for 6 months
    const y = 100 - ((t.count / maxTrendCount) * 65 + 15); // Scale y between 15% and 80% height
    return { x, y, count: t.count, month: t.month };
  });

  const svgLinePath = chartPoints.length > 0 ? `M ${chartPoints.map(p => `${p.x} ${p.y}`).join(" L ")}` : "";

  if (loadingSession) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 text-zinc-800 font-sans">
        <div className="flex flex-col items-center gap-4">
          <div className="relative flex size-12 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 shadow-sm">
            <Activity className="size-5 text-white animate-pulse" />
          </div>
          <span className="text-xs font-semibold text-zinc-555">Verifying administrative access keys...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen bg-slate-50/70 text-zinc-800 font-sans selection:bg-zinc-900/10 selection:text-zinc-900 overflow-hidden">
      {/* Platform Owner Dashboard Side Menu */}
      <aside 
        className={`${
          sidebarCollapsed ? "w-20" : "w-64"
        } h-full border-r border-zinc-200/80 bg-white p-5 flex flex-col justify-between shrink-0 hidden md:flex transition-all duration-300 relative`}
      >
        <div className="space-y-8 flex-1 flex flex-col min-h-0">
          {/* Logo header */}
          <div className="flex items-center gap-3 overflow-hidden shrink-0">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-900 border border-zinc-800 shadow-sm">
              <Sliders className="size-5 text-white" />
            </div>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="whitespace-nowrap"
              >
                <span className="text-sm font-black tracking-tight text-zinc-950 block">Control Panel</span>
                <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-widest leading-none mt-0.5">SaaS Owner</span>
              </motion.div>
            )}
          </div>

          {/* Navigation Links with dynamic database clinics list */}
          <nav className="space-y-4 flex-1 overflow-hidden flex flex-col min-h-0">
            {/* SaaS Console Overview */}
            <div className="shrink-0">
              {!sidebarCollapsed && (
                <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider pl-2 mb-2">Platform Controls</span>
              )}
              <button 
                onClick={() => {
                  setActiveTab("overview");
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-2xl text-xs font-bold cursor-pointer transition-all border ${
                  activeTab === "overview"
                    ? "bg-zinc-100 border-zinc-200 text-zinc-950 shadow-sm"
                    : "border-transparent text-zinc-550 hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <Sliders className="size-4.5 text-zinc-550 shrink-0" />
                {!sidebarCollapsed && <span>SaaS Overview</span>}
              </button>
            </div>

            {/* Clinics Management Menus */}
            <div className="shrink-0 space-y-1">
              {!sidebarCollapsed && (
                <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider pl-2 mb-2">Clinics Management</span>
              )}
              
              {/* All Clinics */}
              <button 
                onClick={() => {
                  setActiveTab("registry");
                  setSearchQuery("");
                  setPlanFilter("all");
                  setStatusFilter("all");
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all border ${
                  (activeTab === "registry" && searchQuery === "" && statusFilter === "all")
                    ? "bg-zinc-100 border-zinc-200 text-zinc-950 shadow-sm"
                    : "border-transparent text-zinc-550 hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <Building className="size-4 shrink-0 text-zinc-400" />
                {!sidebarCollapsed && <span>All Registered</span>}
              </button>

              {/* Active Subscriptions */}
              <button 
                onClick={() => {
                  setActiveTab("registry");
                  setSearchQuery("");
                  setPlanFilter("all");
                  setStatusFilter("Active");
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all border ${
                  (activeTab === "registry" && statusFilter === "Active")
                    ? "bg-zinc-100 border-zinc-200 text-zinc-950 shadow-sm"
                    : "border-transparent text-zinc-550 hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <UserCheck className="size-4 shrink-0 text-zinc-400" />
                {!sidebarCollapsed && <span>Active Subscriptions</span>}
              </button>

              {/* Trial Accounts */}
              <button 
                onClick={() => {
                  setActiveTab("registry");
                  setSearchQuery("");
                  setPlanFilter("all");
                  setStatusFilter("Trialing");
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all border ${
                  (activeTab === "registry" && statusFilter === "Trialing")
                    ? "bg-zinc-100 border-zinc-200 text-zinc-950 shadow-sm"
                    : "border-transparent text-zinc-550 hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <Users className="size-4 shrink-0 text-zinc-400" />
                {!sidebarCollapsed && <span>Trial Accounts</span>}
              </button>

              {/* Telephony Configurations */}
              <button 
                onClick={() => {
                  setActiveTab("telephony");
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all border ${
                  activeTab === "telephony"
                    ? "bg-zinc-100 border-zinc-200 text-zinc-950 shadow-sm"
                    : "border-transparent text-zinc-550 hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <Phone className="size-4 shrink-0 text-zinc-400" />
                {!sidebarCollapsed && <span>Telephony Lines</span>}
              </button>

              {/* Engine Diagnostics Configuration */}
              <button 
                onClick={() => {
                  setActiveTab("diagnostics");
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all border ${
                  activeTab === "diagnostics"
                    ? "bg-zinc-100 border-zinc-200 text-zinc-950 shadow-sm"
                    : "border-transparent text-zinc-550 hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                <Activity className="size-4 shrink-0 text-zinc-400" />
                {!sidebarCollapsed && <span>Engine Diagnostics</span>}
              </button>

              {/* Provision Workspace link */}
              <button 
                onClick={() => {
                  setCreatedResult(null);
                  setIsAddOpen(true);
                }}
                className="w-full flex items-center gap-3 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer border border-transparent text-zinc-550 hover:text-zinc-900 hover:bg-zinc-50"
              >
                <Plus className="size-4 shrink-0 text-zinc-400" />
                {!sidebarCollapsed && <span>Provision Clinic</span>}
              </button>
            </div>

            {/* Live Registered Clinics List from DB */}
            <div className="flex-1 flex flex-col min-h-0 border-t border-zinc-100 pt-3">
              {!sidebarCollapsed && (
                <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider pl-2 mb-2">
                  Clinics List ({tenants.length})
                </span>
              )}
              <div className="flex-1 overflow-y-auto space-y-1 pr-1 scrollbar-thin select-none">
                {tenants.map((t) => {
                  const isActive = searchQuery.toLowerCase() === t.clinicName.toLowerCase() || searchQuery.toLowerCase() === t.tenantId.toLowerCase();
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        setActiveTab("registry");
                        setSearchQuery(t.clinicName);
                        setPlanFilter("all");
                        setStatusFilter("all");
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-bold transition-all border ${
                        isActive
                          ? "bg-zinc-100 border-zinc-200 text-zinc-950 shadow-sm"
                          : "border-transparent text-zinc-650 hover:text-zinc-900 hover:bg-zinc-50/80"
                      }`}
                      title={t.clinicName}
                    >
                      <Building className={`size-4 shrink-0 ${isActive ? "text-zinc-900" : "text-zinc-400"}`} />
                      {!sidebarCollapsed && (
                        <div className="truncate flex-1">
                          <span className="block truncate leading-tight">{t.clinicName}</span>
                          <span className="block text-[8px] text-zinc-450 truncate mt-0.5">{t.tenantId}</span>
                        </div>
                      )}
                      {!sidebarCollapsed && (
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                          t.subscriptionStatus === 'Active' ? 'bg-zinc-800' :
                          t.subscriptionStatus === 'Trialing' ? 'bg-zinc-450' :
                          'bg-zinc-200'
                        }`} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>
        </div>

        {/* Sidebar Footer details */}
        <div className="space-y-4 pt-6 border-t border-zinc-150 shrink-0">
          <div className="flex items-center gap-3 px-1.5 overflow-hidden">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-[10px] font-extrabold text-zinc-700 border border-zinc-200 shadow-sm">
              {getInitials(admin?.name || "SO")}
            </div>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="overflow-hidden whitespace-nowrap"
              >
                <span className="block text-xs font-black text-zinc-950 truncate leading-none mb-1">{admin?.name}</span>
                <span className="block text-[9px] font-semibold text-zinc-400 truncate leading-none">{admin?.email}</span>
              </motion.div>
            )}
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-zinc-550 hover:text-zinc-900 hover:bg-zinc-50 text-xs font-extrabold cursor-pointer transition-all border border-transparent hover:border-zinc-200"
          >
            <LogOut className="size-4.5 text-zinc-400 shrink-0" />
            {!sidebarCollapsed && <span>Sign Out Panel</span>}
          </button>
        </div>

        {/* Sidebar collapse handle toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute -right-3.5 top-7 size-7 rounded-full bg-white border border-zinc-200 shadow-md flex items-center justify-center hover:bg-zinc-50 hover:text-zinc-950 transition-colors"
        >
          <ChevronRight className={`size-4 transform transition-transform duration-300 ${sidebarCollapsed ? "" : "rotate-180"}`} />
        </button>
      </aside>

      {/* Main Administrative Control Area */}
      <main className="flex-1 h-full overflow-y-auto px-4 py-8 md:px-8 max-w-7xl mx-auto w-full space-y-8">
        
        {/* Top Header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-250/50 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[9px] font-extrabold bg-zinc-100 text-zinc-700 border border-zinc-200 uppercase tracking-wider">
                {activeTab === "overview" && "Platform Overview"}
                {activeTab === "registry" && "Workspace Registry"}
                {activeTab === "telephony" && "Telephony & Limits"}
                {activeTab === "diagnostics" && "System Diagnostics"}
              </span>
              <span className="text-[10px] text-zinc-400 font-bold">•</span>
              <span className="text-[10px] font-bold text-zinc-400 flex items-center gap-1">
                <RefreshCw className="size-3 text-zinc-300 animate-spin-slow" />
                Live Sync Enabled
              </span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-zinc-950 mt-1.5 uppercase font-sans">
              {activeTab === "overview" && "SaaS Control Center"}
              {activeTab === "registry" && "Clinics Workspace Directory"}
              {activeTab === "telephony" && "Virtual Line Registry"}
              {activeTab === "diagnostics" && "Server Engine Diagnostics"}
            </h1>
            <p className="text-xs font-medium text-zinc-500 mt-1">
              {activeTab === "overview" && "Real-time metrics, signup distribution, and telemetry snapshots."}
              {activeTab === "registry" && "Manage clinician accounts, billing status, and plan packages."}
              {activeTab === "telephony" && "Configure virtual reception lines, monthly call caps, and routing."}
              {activeTab === "diagnostics" && "Monitor database latency, SMTP server status, and WhatsApp Web gateway."}
            </p>
          </div>
          
          <div className="flex items-center gap-2.5 self-start sm:self-center">
            {/* Quick Refresh Button */}
            <button 
              onClick={fetchDashboardData} 
              disabled={loadingData}
              className="flex items-center justify-center size-10 border border-zinc-200 bg-white rounded-2xl text-zinc-555 hover:text-zinc-800 hover:bg-zinc-50 transition-colors active:scale-[0.98] cursor-pointer"
              title="Refresh Dashboard Data"
            >
              <RefreshCw className={`size-4 ${loadingData ? "animate-spin text-zinc-900" : ""}`} />
            </button>
            
            <button
              onClick={() => {
                setCreatedResult(null);
                setIsAddOpen(true);
              }}
              className="flex items-center gap-2 px-5 py-3 text-xs font-extrabold text-white bg-zinc-900 hover:bg-zinc-800 rounded-2xl transition-all active:scale-[0.98] cursor-pointer shadow-md hover:shadow-lg"
            >
              <Plus className="size-4 shrink-0" />
              Provision Clinic
            </button>
          </div>
        </div>

        {/* VIEW: OVERVIEW */}
        {activeTab === "overview" && (
          <div className="space-y-8">
            {/* Global SaaS Summary Scorecard Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* MRR Card */}
              <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 relative overflow-hidden group transition-all duration-200">
                <div className="absolute top-0 right-0 p-5 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
                  <DollarSign className="size-20 text-zinc-900" />
                </div>
                <span className="block text-[10px] font-extrabold text-zinc-405 uppercase tracking-widest">Recurring Revenue (MRR)</span>
                <span className="block text-3xl font-black text-zinc-955 tracking-tight mt-2.5">
                  ${metrics.totalMRR.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
                <span className="block text-[9px] text-emerald-600 font-bold mt-2 flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                  Live subscription cash stream
                </span>
              </div>

              {/* Total Clinics Card */}
              <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 relative overflow-hidden group transition-all duration-200">
                <div className="absolute top-0 right-0 p-5 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
                  <Building className="size-20 text-zinc-900" />
                </div>
                <span className="block text-[10px] font-extrabold text-zinc-405 uppercase tracking-widest">Clinics Provisioned</span>
                <span className="block text-3xl font-black text-zinc-955 tracking-tight mt-2.5">{metrics.totalTenants}</span>
                <div className="flex gap-2 text-[9px] text-zinc-550 font-bold mt-2.5">
                  <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-md border border-emerald-100">{metrics.activePaid} Paid</span>
                  <span className="px-1.5 py-0.5 bg-zinc-100 text-zinc-750 rounded-md border border-zinc-200">{metrics.trialing} Free</span>
                </div>
              </div>

              {/* Voice Calls Card */}
              <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 relative overflow-hidden group transition-all duration-200">
                <div className="absolute top-0 right-0 p-5 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
                  <PhoneCall className="size-20 text-zinc-900" />
                </div>
                <span className="block text-[10px] font-extrabold text-zinc-405 uppercase tracking-widest">Total Calls Logged</span>
                <span className="block text-3xl font-black text-zinc-955 tracking-tight mt-2.5">{metrics.totalCallsHandled.toLocaleString()}</span>
                <span className="block text-[9px] text-zinc-550 font-bold mt-2">AI Telephony outbox volume</span>
              </div>

              {/* System Aggregates Activity */}
              <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 relative overflow-hidden group transition-all duration-200">
                <div className="absolute top-0 right-0 p-5 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity">
                  <Activity className="size-20 text-zinc-900" />
                </div>
                <span className="block text-[10px] font-extrabold text-zinc-405 uppercase tracking-widest">Platform Activity</span>
                <div className="flex items-baseline gap-1 mt-2.5">
                  <span className="text-3xl font-black text-zinc-955 tracking-tight">{metrics.totalDoctors}</span>
                  <span className="text-[10px] font-bold text-zinc-400">Providers</span>
                </div>
                <div className="flex gap-2 text-[9px] text-zinc-550 font-bold mt-2 flex-wrap">
                  <span className="flex items-center gap-1"><Calendar className="size-3 text-zinc-500" /> {metrics.totalAppointments} Appts</span>
                  <span>•</span>
                  <span className="flex items-center gap-1"><FileText className="size-3 text-zinc-500" /> {metrics.totalSoapNotes} Soap Notes</span>
                </div>
              </div>
            </div>

            {/* Dynamic SVG Growth Trend Chart */}
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 space-y-4 flex flex-col justify-between">
              <div className="flex items-center justify-between border-b border-zinc-150 pb-3">
                <div>
                  <h3 className="text-xs font-extrabold text-zinc-950 uppercase tracking-wider flex items-center gap-2">
                    <TrendingUp className="size-4 text-zinc-500" />
                    Tenant signup distribution
                  </h3>
                  <p className="text-[10px] text-zinc-400 mt-0.5">Real-time cumulative client growth based on database signup timestamps.</p>
                </div>
                <span className="text-[10px] font-extrabold text-zinc-800 bg-zinc-100 px-2 py-0.5 rounded-lg border border-zinc-200">
                  {metrics.totalTenants} Clinics Registered
                </span>
              </div>
              
              {/* SVG area chart drawing */}
              <div className="relative h-44 w-full bg-slate-50/50 rounded-2xl border border-zinc-150 overflow-hidden flex items-end">
                <svg className="w-full h-full p-3 pb-6" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {/* Horizontal Grid lines */}
                  <line x1="0" y1="20" x2="100" y2="20" stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="3 3" />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="3 3" />
                  <line x1="0" y1="80" x2="100" y2="80" stroke="#e2e8f0" strokeWidth="0.5" strokeDasharray="3 3" />
                  
                  {/* Curve Line - single clean solid zinc-500 colored stroke */}
                  {svgLinePath && (
                    <motion.path 
                      d={svgLinePath} 
                      fill="none" 
                      stroke="rgb(113, 113, 122)" 
                      strokeWidth="2.5" 
                      strokeLinecap="round"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 1.2, ease: "easeOut" }}
                    />
                  )}
                  
                  {/* Nodes */}
                  {chartPoints.map((pt, idx) => (
                    <g key={idx} className="group/node cursor-pointer">
                      <circle 
                        cx={pt.x} 
                        cy={pt.y} 
                        r="3.5" 
                        fill="white" 
                        stroke="rgb(113, 113, 122)" 
                        strokeWidth="2" 
                        className="hover:r-5 transition-all"
                      />
                      <circle 
                        cx={pt.x} 
                        cy={pt.y} 
                        r="8" 
                        fill="rgb(113, 113, 122)" 
                        className="opacity-0 hover:opacity-10 transition-opacity" 
                      />
                    </g>
                  ))}
                </svg>
                
                {/* X-Axis month labels */}
                <div className="absolute bottom-2.5 left-0 right-0 px-5 flex justify-between text-[8px] text-zinc-405 font-extrabold tracking-widest uppercase">
                  {trends.map((t, idx) => (
                    <span key={idx} className="relative flex flex-col items-center">
                      <span>{t.month}</span>
                      <span className="block text-[8px] text-zinc-800 font-black mt-0.5">{t.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* VIEW: CLINICS REGISTRY */}
        {activeTab === "registry" && (
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 space-y-6">
            
            {/* Table Toolbar controls */}
            <div className="flex flex-col lg:flex-row gap-4 items-center justify-between border-b border-zinc-150 pb-5">
              <div>
                <h2 className="text-sm font-extrabold text-zinc-900">Clinics Workspace Registry</h2>
                <p className="text-[10px] text-zinc-400 mt-0.5">Manage billing details, limits, and settings for active tenants ({filteredTenants.length}).</p>
              </div>
              
              <div className="flex flex-wrap gap-2 w-full lg:w-auto items-center justify-end">
                {/* Search input */}
                <div className="relative w-full sm:w-60">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-3.5 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Search clinics, director name, or ID..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-xl border border-zinc-200 bg-zinc-50/50 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:outline-none transition-all shadow-inner font-semibold"
                  />
                </div>

                {/* Plan Filter */}
                <div className="flex items-center gap-1.5 border border-zinc-200 bg-white rounded-xl px-3 py-2">
                  <Filter className="size-3.5 text-zinc-400" />
                  <select
                    value={planFilter}
                    onChange={(e) => setPlanFilter(e.target.value)}
                    className="bg-transparent text-xs text-zinc-700 font-extrabold focus:outline-none border-none pr-1 select-light"
                  >
                    <option value="all">All Plans</option>
                    <option value="trial">Trial</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>

                {/* Status Filter */}
                <div className="flex items-center gap-1.5 border border-zinc-200 bg-white rounded-xl px-3 py-2">
                  <Activity className="size-3.5 text-zinc-400" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-transparent text-xs text-zinc-700 font-extrabold focus:outline-none border-none pr-1 select-light"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="trialing">Trialing</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="past due">Past Due</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Tenants Registry List Table */}
            <div className="overflow-x-auto">
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
                    <h3 className="text-xs font-bold text-zinc-700">No Clinic Records Found</h3>
                    <p className="text-[10px] text-zinc-400 max-w-xs mx-auto mt-1">Try refining your search queries or register a new clinic tenant.</p>
                  </div>
                </div>
              ) : (
                <table className="w-full text-left border-collapse min-w-[950px]">
                  <thead>
                    <tr className="border-b border-zinc-150 text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
                      <th className="pb-3 pl-3">Clinic & Tenant ID</th>
                      <th className="pb-3">Director Contact</th>
                      <th className="pb-3">SaaS Subscription</th>
                      <th className="pb-3">Receptionist Virtual Line</th>
                      <th className="pb-3 text-right pr-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 text-xs text-zinc-700">
                    {filteredTenants.map((t) => {
                      const usagePercent = Math.min(100, (t.callsHandled / (t.callLimit || 100)) * 100);
                      const isLimitDanger = usagePercent > 90;
                      const isLimitWarning = usagePercent > 75 && usagePercent <= 90;
                      const clinicColor = getColorClass(t.clinicName);
                      
                      return (
                        <tr key={t.id} className="hover:bg-slate-50/40 transition-colors group">
                          
                          {/* Clinic Avatar & ID */}
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
                                {t.subscriptionStatus}
                              </span>
                              <span className="text-[10px] font-extrabold text-zinc-550">{t.subscriptionPlan} Tier</span>
                            </div>
                            <div className="text-[10px] text-zinc-400 font-semibold flex gap-1.5 items-center">
                              <span>${Number(t.paymentAmount).toFixed(2)}/{t.billingInterval === 'yearly' ? 'yr' : 'mo'}</span>
                              {t.subscriptionExpiresAt && (
                                <>
                                  <span>•</span>
                                  <span>Renews: {new Date(t.subscriptionExpiresAt).toLocaleDateString()}</span>
                                </>
                              )}
                            </div>
                          </td>

                          {/* Telephony metrics */}
                          <td className="py-4 space-y-1">
                            <div className="flex items-center gap-1.5 text-[10px] text-zinc-650 font-bold">
                              <Phone className="size-3 text-zinc-450 shrink-0" />
                              <span>{t.virtualPhoneNumber || "+1 (415) 555-0100"}</span>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-zinc-400 font-semibold">
                              <span className={isLimitDanger ? "text-red-600 font-bold" : isLimitWarning ? "text-amber-600 font-bold" : ""}>
                                {t.callsHandled} / {t.callLimit} calls
                              </span>
                              <div className="w-20 bg-zinc-150 rounded-full h-1.5 overflow-hidden border border-zinc-200/50 relative">
                                <div
                                  className={`h-full rounded-full transition-all duration-300 ${
                                    isLimitDanger ? 'bg-red-500' :
                                    isLimitWarning ? 'bg-amber-500' :
                                    'bg-zinc-800'
                                  }`}
                                  style={{ width: `${usagePercent}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Edit modifiers button */}
                          <td className="py-4 text-right pr-3">
                            <button
                              onClick={() => openEditDrawer(t)}
                              className="px-3.5 py-2 text-[10px] font-extrabold rounded-xl border border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 text-zinc-700 hover:text-zinc-955 transition-all cursor-pointer flex items-center gap-1.5 ml-auto active:scale-[0.98]"
                            >
                              Modify Config
                              <ChevronRight className="size-3.5 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* VIEW: TELEPHONY LINES */}
        {activeTab === "telephony" && (
          <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 space-y-6">
            <div>
              <h2 className="text-sm font-extrabold text-zinc-900">Virtual Receptionist Lines & Caps</h2>
              <p className="text-[10px] text-zinc-400 mt-0.5">Configure virtual forwarding numbers and usage limit indicators for all active clinician portals.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tenants.map((t) => {
                const usagePercent = Math.min(100, (t.callsHandled / (t.callLimit || 100)) * 100);
                const isLimitDanger = usagePercent > 90;
                const isLimitWarning = usagePercent > 75 && usagePercent <= 90;
                const clinicColor = getColorClass(t.clinicName);
                
                return (
                  <div key={t.id} className="border border-zinc-200 rounded-3xl p-5 bg-zinc-50/20 flex flex-col justify-between space-y-4 hover:border-zinc-300 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className={`flex size-9 items-center justify-center rounded-xl border text-xs font-black shrink-0 ${clinicColor}`}>
                        {getInitials(t.clinicName)}
                      </div>
                      <div>
                        <h4 className="font-extrabold text-zinc-900 text-xs">{t.clinicName}</h4>
                        <span className="block text-[9px] text-zinc-450 font-mono mt-0.5">ID: {t.tenantId}</span>
                      </div>
                    </div>

                    <div className="space-y-2 bg-white rounded-2xl p-4 border border-zinc-150/60 shadow-inner">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-400 font-bold text-[9px] uppercase tracking-wider">Virtual Number</span>
                        <span className="font-extrabold text-zinc-800 flex items-center gap-1">
                          <Phone className="size-3 text-zinc-400" />
                          {t.virtualPhoneNumber || "+1 (415) 555-0100"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-400 font-bold text-[9px] uppercase tracking-wider">Monthly Limit</span>
                        <span className="font-extrabold text-zinc-800">{t.callLimit} Calls</span>
                      </div>
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-zinc-400 font-bold text-[9px] uppercase tracking-wider">Calls Handled</span>
                        <span className={`font-extrabold ${isLimitDanger ? "text-red-655" : isLimitWarning ? "text-amber-600" : "text-zinc-850"}`}>
                          {t.callsHandled} Calls
                        </span>
                      </div>
                      
                      <div className="space-y-1 pt-1.5">
                        <div className="flex justify-between text-[8px] text-zinc-400 font-bold uppercase">
                          <span>Usage Cap</span>
                          <span>{usagePercent.toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-zinc-100 rounded-full h-2 overflow-hidden border border-zinc-200 relative">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isLimitDanger ? 'bg-red-500' :
                              isLimitWarning ? 'bg-amber-500' :
                              'bg-zinc-800'
                            }`}
                            style={{ width: `${usagePercent}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => openEditDrawer(t)}
                      className="w-full py-2.5 text-[10px] font-extrabold rounded-xl border border-zinc-250 hover:border-zinc-350 bg-white hover:bg-zinc-50 text-zinc-700 hover:text-zinc-950 transition-all cursor-pointer shadow-sm flex items-center justify-center gap-1.5 active:scale-[0.98]"
                    >
                      Configure Line & Limit
                      <ChevronRight className="size-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW: ENGINE DIAGNOSTICS */}
        {activeTab === "diagnostics" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* TiDB cluster card */}
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-150 pb-3">
                  <div>
                    <h3 className="text-xs font-extrabold text-zinc-955 uppercase tracking-wider flex items-center gap-2">
                      <Database className="size-4 text-zinc-600" />
                      Database Engine
                    </h3>
                    <p className="text-[10px] text-zinc-400 mt-0.5">TiDB server clustering metrics and latency.</p>
                  </div>
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-150">
                    Online
                  </span>
                </div>

                <div className="rounded-2xl border border-zinc-150 bg-zinc-50/50 p-4 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-450 font-bold text-[9px] uppercase tracking-wider">Cluster Host</span>
                    <span className="font-mono text-zinc-700 text-[10px]">tidb-cloud-main-cluster</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-450 font-bold text-[9px] uppercase tracking-wider">Ping Latency</span>
                    <span className="font-extrabold text-zinc-800">{metrics.dbLatency} ms</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-450 font-bold text-[9px] uppercase tracking-wider">Active Shards</span>
                    <span className="font-extrabold text-zinc-800">3 Nodes</span>
                  </div>
                </div>
              </div>
            </div>

            {/* SMTP mail server card */}
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-150 pb-3">
                  <div>
                    <h3 className="text-xs font-extrabold text-zinc-955 uppercase tracking-wider flex items-center gap-2">
                      <Mail className="size-4 text-zinc-600" />
                      SMTP Mail Server
                    </h3>
                    <p className="text-[10px] text-zinc-400 mt-0.5">SMTP verification status and dispatch parameters.</p>
                  </div>
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-150">
                    Active
                  </span>
                </div>

                <div className="rounded-2xl border border-zinc-150 bg-zinc-50/50 p-4 space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-450 font-bold text-[9px] uppercase tracking-wider">Transporter host</span>
                    <span className="font-mono text-zinc-700 text-[10px]">smtp.gmail.com</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-450 font-bold text-[9px] uppercase tracking-wider">SSL Security</span>
                    <span className="font-extrabold text-zinc-800">TLS Enabled</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-zinc-450 font-bold text-[9px] uppercase tracking-wider">Auth Verified</span>
                    <span className="font-extrabold text-zinc-850">SMTP Handshake OK</span>
                  </div>
                </div>
              </div>
            </div>

            {/* WhatsApp system Web Status card */}
            <div className="rounded-3xl border border-zinc-200/80 bg-white p-6 space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-zinc-150 pb-3">
                  <div>
                    <h3 className="text-xs font-extrabold text-zinc-955 uppercase tracking-wider flex items-center gap-2">
                      <Smartphone className="size-4 text-zinc-650 animate-pulse-soft" />
                      WhatsApp Engine
                    </h3>
                    <p className="text-[10px] text-zinc-400 mt-0.5">QR Web gateway state controller.</p>
                  </div>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${
                    metrics.whatsappState === "CONNECTED" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    metrics.whatsappState === "QR_READY" ? "bg-amber-50 text-amber-700 border-amber-200" :
                    metrics.whatsappState === "CONNECTING" ? "bg-zinc-100 text-zinc-700 border-zinc-200 animate-pulse" :
                    "bg-zinc-100 text-zinc-650 border-zinc-200"
                  }`}>
                    {metrics.whatsappState}
                  </span>
                </div>

                <div className="border border-zinc-100 rounded-2xl p-3 bg-zinc-50/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="block text-[11px] font-extrabold text-zinc-800 leading-tight">WhatsApp Engine</span>
                      <span className="block text-[9px] text-zinc-400 font-bold leading-none mt-0.5">
                        {metrics.whatsappNumber ? `Connected: ${metrics.whatsappNumber}` : "Microservice active"}
                      </span>
                    </div>
                  </div>

                  {metrics.whatsappState === "QR_READY" && metrics.whatsappQrUrl && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white border border-zinc-200/80 rounded-xl p-3.5 flex flex-col items-center gap-2"
                    >
                      <span className="text-[9px] font-extrabold text-zinc-900 uppercase tracking-widest">Link Device Scanner</span>
                      <img 
                        src={metrics.whatsappQrUrl} 
                        alt="WhatsApp QR Code" 
                        className="size-36 border border-zinc-100 rounded-lg p-1 bg-zinc-50"
                      />
                      <p className="text-[8px] text-zinc-400 text-center leading-normal max-w-[200px]">
                        Scan this code with WhatsApp Web scanner inside "Linked Devices" to connect the AI notification bot.
                      </p>
                    </motion.div>
                  )}

                  <div className="flex gap-2 pt-1 border-t border-zinc-200/60">
                    {metrics.whatsappState === "CONNECTED" ? (
                      <button
                        onClick={() => handleControlWhatsApp("disconnect")}
                        disabled={controllingWA}
                        className="flex-1 py-2 text-[10px] font-extrabold text-red-700 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-150 hover:border-red-250 rounded-xl transition-all cursor-pointer active:scale-[0.98] flex items-center justify-center gap-1.5"
                      >
                        {controllingWA ? <Loader2 className="size-3 animate-spin text-red-700" /> : <X className="size-3" />}
                        Disconnect Session
                      </button>
                    ) : (
                      <button
                        onClick={() => handleControlWhatsApp("initialize")}
                        disabled={controllingWA}
                        className="flex-1 py-2 text-[10px] font-extrabold text-zinc-900 hover:text-white bg-zinc-100 hover:bg-zinc-900 border border-zinc-200 hover:border-zinc-900 rounded-xl transition-all cursor-pointer active:scale-[0.98] flex items-center justify-center gap-1.5"
                      >
                        {controllingWA ? <Loader2 className="size-3 animate-spin text-zinc-950" /> : <RefreshCw className="size-3" />}
                        Initialize QR Code
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* DRAWER: Slide-Out Configuration Editor */}
      <AnimatePresence>
        {editingTenant && (
          <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/20 backdrop-blur-sm">
            {/* Modal backdrop tap to dismiss */}
            <div className="absolute inset-0" onClick={() => setEditingTenant(null)} />

            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="relative w-full max-w-md h-full bg-white border-l border-zinc-200 shadow-2xl p-6 flex flex-col justify-between overflow-y-auto"
            >
              {/* Content wrapper */}
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-150 pb-5">
                  <div>
                    <h3 className="text-sm font-black text-zinc-950">Modify System Config</h3>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Configure billing and call variables for {editingTenant.clinicName}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingTenant(null)}
                    className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 transition-all cursor-pointer"
                  >
                    <X className="h-4.5 w-4.5" />
                  </button>
                </div>

                {/* Form fields */}
                <form onSubmit={handleEditSubmit} id="edit-drawer-form" className="space-y-5">
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
                          <option value="Cancelled">Cancelled</option>
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
                          <option value="Pro">Pro</option>
                          <option value="Enterprise">Enterprise</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3.5">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-550 pl-1">Price (USD)</label>
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

                  {/* Section 2: AI Call config */}
                  <div className="space-y-4">
                    <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-widest pl-1">Receptionist Calling Settings</span>
                    
                    <div className="grid grid-cols-2 gap-3.5">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-550 pl-1">Virtual Phone Number</label>
                        <input
                          type="text"
                          value={editVirtualNumber}
                          onChange={(e) => setEditVirtualNumber(e.target.value)}
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs text-zinc-855 font-bold focus:border-zinc-400 focus:bg-white focus:outline-none transition-all"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-zinc-550 pl-1">Monthly Call Limit</label>
                        <input
                          type="number"
                          value={editCallLimit}
                          onChange={(e) => setEditCallLimit(Number(e.target.value))}
                          className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs text-zinc-855 font-bold focus:border-zinc-400 focus:bg-white focus:outline-none transition-all"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-zinc-555 pl-1">Calls Handled (Current Month)</label>
                      <input
                        type="number"
                        value={editCallsHandled}
                        onChange={(e) => setEditCallsHandled(Number(e.target.value))}
                        className="w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs text-zinc-855 font-bold focus:border-zinc-400 focus:bg-white focus:outline-none transition-all"
                      />
                    </div>
                  </div>
                </form>

                <div className="h-[1px] bg-zinc-150" />

                {/* Subscription History Timeline */}
                <div className="space-y-3.5 pb-2">
                  <span className="block text-[9px] font-extrabold text-zinc-400 uppercase tracking-widest pl-1">Subscription History</span>
                  
                  {loadingHistory ? (
                    <div className="flex items-center justify-center py-6 text-zinc-455 text-xs gap-1.5 pl-1">
                      <Loader2 className="h-4 w-4 animate-spin text-zinc-550" />
                      Loading history logs...
                    </div>
                  ) : subHistory.length === 0 ? (
                    <p className="text-[10px] text-zinc-450 pl-1 italic">No subscription logs found for this clinic.</p>
                  ) : (
                    <div className="space-y-4 pl-1 max-h-[220px] overflow-y-auto pr-1">
                      {subHistory.map((item, idx) => (
                        <div key={item.id || idx} className="relative pl-4 border-l border-zinc-200 text-[10px] space-y-1">
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
                            <span className="text-zinc-900 font-extrabold"> ({item.newPlan === "Trial" ? "Free" : `$${item.amount || 0}/${item.billingInterval}`})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Submit Actions footer */}
              <div className="flex gap-2.5 pt-6 border-t border-zinc-150">
                <button
                  type="button"
                  onClick={() => setEditingTenant(null)}
                  disabled={updating}
                  className="flex-1 rounded-xl border border-zinc-200 py-3 text-xs font-extrabold text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  form="edit-drawer-form"
                  disabled={updating}
                  className="flex-1 rounded-xl bg-zinc-950 hover:bg-zinc-850 py-3 text-xs font-extrabold text-white transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5 shadow-md"
                >
                  {updating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save Configuration
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                  <h3 className="text-sm font-black text-zinc-950">Provision New Clinic Tenant</h3>
                  <p className="text-[10px] text-zinc-555 mt-0.5">Register and setup new clinician portal access.</p>
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
                      <p className="text-[10px] text-zinc-500 max-w-xs leading-normal">The clinic administrator profile is live. Provide these credentials to the medical clinic director:</p>
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
                      <label className="text-[10px] font-bold text-zinc-450 uppercase tracking-widest pl-1">Clinic / Facility Name</label>
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
    </div>
  );
}
