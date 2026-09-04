// ─────────────────────────────────────────────────────────────────────────────
// dashboards/restaurant.tsx — the Restaurant_Dashboard (Req 2.1-2.11).
//
// Same shell as the five existing category dashboards: `createFileRoute`, the
// `activeTab` state persisted to `localStorage` under `bmt_active_tab`, the mobile
// drawer and the mobile bottom bar, and the feature access resolved once from the
// session. Unlike those files this one COMPOSES the extracted components
// (`TableManager`, `OperatingHours`, `BookingRules`, `WalkInDrawer`,
// `TableLayoutView` through the first of those) instead of inlining thousands of
// lines of tab bodies.
//
// Guard order on mount, before any dashboard content renders (Req 2.2, 2.3):
//   1. the session resolves to no account          → redirect `/login`
//   2. profession !== "Restaurant and dining"      → redirect `/dashboard`
//      (including absent and empty values)
//   3. only then render
// Both decisions come from the pure `restaurantGuardDecision`, and the navigation
// from the pure `deriveRestaurantNavigation`, so this route agrees by construction
// with Properties 27 and 29 asserted in `restaurant-availability.test.ts`.
// ─────────────────────────────────────────────────────────────────────────────
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  Flame,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Pencil,
  Phone,
  PieChart as PieChartIcon,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  Upload,
  User,
  UserCheck,
  UserPlus,
  Users,
  Utensils,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import bmtLogo from "../../assets/bmt-logo.png";
import {
  createSubUserServerFn,
  deleteSubUserServerFn,
  getClinicProfileServerFn,
  getCurrentUserServerFn,
  getSubUsersServerFn,
  logoutServerFn,
  sendEmailChangeOtpServerFn,
  updateEmailServerFn,
  updatePasswordServerFn,
  updateProfileServerFn,
  uploadProfilePhotoServerFn,
} from "../../lib/auth";
import {
  createRestaurantGuestServerFn,
  createRestaurantReservationServerFn,
  deleteRestaurantBookingServerFn,
  deleteRestaurantGuestServerFn,
  getRestaurantBookingsServerFn,
  getRestaurantGuestsServerFn,
  getRestaurantOverviewServerFn,
  getRestaurantTablesServerFn,
  reassignRestaurantBookingServerFn,
  setRestaurantBookingStatusServerFn,
  updateRestaurantBookingServerFn,
  updateRestaurantGuestServerFn,
} from "../../lib/restaurant";
import {
  BOOKING_STATUSES,
  CORE_NAV_ENTRIES,
  DASHBOARD_TAB_ORDER,
  MSG_FEATURE_ACCESS_UNRESOLVED,
  PROFESSION_RESTAURANT,
  RESTAURANT_BOOKINGS_FEATURE,
  RESTAURANT_CONFIG_FEATURE,
  deriveRestaurantNavigation,
  restaurantGuardDecision,
  type DiningTable,
  type ResolvedAccessLike,
  type RestaurantGuardDecision,
  type RestaurantNavigation,
  type RestaurantPermission,
} from "../../lib/restaurant-availability";
import { resolveFeatureAccess } from "../../lib/feature-access";
import {
  getRestaurantSettingsBootstrapServerFn,
  type RestaurantSettingsBootstrap,
} from "../../lib/restaurant-settings";
import { MSG_NO_RESTAURANT_SETTINGS } from "../../lib/restaurant-settings-model";
import { BookingRules } from "../../components/restaurant/BookingRules";
import { DiningAreasSettings } from "../../components/restaurant/DiningAreasSettings";
import { MenuSettings } from "../../components/restaurant/MenuSettings";
import { OperatingHours } from "../../components/restaurant/OperatingHours";
import { RestaurantProfilePanel } from "../../components/restaurant/RestaurantProfilePanel";
import { RestaurantUsersSettings } from "../../components/restaurant/RestaurantUsersSettings";
import { TableManager } from "../../components/restaurant/TableManager";
import { WalkInDrawer } from "../../components/restaurant/WalkInDrawer";
import { WhatsAppAlertsSettings } from "../../components/restaurant/WhatsAppAlertsSettings";
import ManagePlansPanel from "../../components/settings/ManagePlansPanel";
import { RestaurantBranchSettings } from "../../components/restaurant/RestaurantBranchSettings";
import WhatsAppHub from "../../components/WhatsAppHub";
import { HelpSupportCard } from "../../components/HelpSupportCard";
import { cn } from "../../lib/utils";

export const Route = createFileRoute("/dashboards/restaurant")({
  head: () => ({
    meta: [
      { title: "Restaurant Dashboard — BookMyTime" },
      {
        name: "description",
        content:
          "Table bookings, dining tables, operating hours and booking rules for your restaurant.",
      },
    ],
  }),
  component: RestaurantDashboardPage,
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared view types — mirrored from the server function return shapes so the
// panels stay readable without importing server-only modules.
// ─────────────────────────────────────────────────────────────────────────────

interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  clinicName?: string;
  practiceSize?: string;
  tenantId?: string;
  profession?: string | null;
  role?: "admin" | "reception" | "doctor" | "location";
  subscriptionPlan?: string | null;
  subscriptionStatus?: string | null;
  subscriptionExpiresAt?: string | null;
  /** Billing fields the session carries, consumed by `ManagePlansPanel`. */
  paymentMethod?: string | null;
  paymentAmount?: number | string | null;
  createdAt?: string | null;
  profilePhoto?: string | null;
  locationId?: string | null;
  locationName?: string | null;
}

interface OccupancySlotView {
  startMinutes: number;
  label: string;
  occupiedCount: number;
  availableCount: number;
}

interface DayOccupancyView {
  date: string;
  closed: boolean;
  activeTableCount: number;
  slots: OccupancySlotView[];
  blockingPairs: number;
  occupancyRate: number;
}

interface RestaurantOverviewAnalyticsView {
  metrics: {
    totalBookings: number;
    todayBookings: number;
    upcomingBookings: number;
    completedBookings: number;
    cancelledBookings: number;
    totalGuests: number;
    todayGuests: number;
    upcomingGuests: number;
    activeTablesCount: number;
    totalTablesCount: number;
    totalCapacity: number;
    averagePartySize: number;
  };
  statusBreakdown: Array<{
    status: string;
    count: number;
    guestCount: number;
  }>;
  dailyTrends: Array<{
    date: string;
    label: string;
    bookings: number;
    guests: number;
  }>;
  hourlyRush: Array<{
    hour: string;
    hourNum: number;
    period: string;
    bookings: number;
    guests: number;
  }>;
  areaBreakdown: Array<{
    area: string;
    bookings: number;
    guests: number;
    tableCount: number;
  }>;
  recentBookings: BookingRowView[];
}

interface OverviewView {
  timezone: string;
  today: {
    date: string;
    bookingCount: number;
    partySizeSum: number;
    occupancyRate: number;
    activeTableCount: number;
    slotCount: number;
  };
  selected: DayOccupancyView;
  analytics?: RestaurantOverviewAnalyticsView;
}

interface BookingRowView {
  id: string;
  guestName: string;
  guestPhone: string;
  partySize: number | null;
  date: string;
  slotLabel: string;
  tableId: string | null;
  /** The Table_Group rendered for display, e.g. `T1 + T2`. */
  tableName: string;
  area: string | null;
  status: string;
  tokenNo: number | null;
  specialRequests: string;
  /** Every Dining_Table of this reservation's Booking_Group. */
  groupTables?: { id: string; name: string }[];
}

interface GuestRowView {
  id: string;
  guestNo: string;
  name: string;
  phone: string;
  email?: string | null;
  notes?: string | null;
  address?: string | null;
  bookingCount: number;
  lastBookingDate: string | null;
  noShowCount: number;
}

type ToastKind = "success" | "error" | "info";
type Toast = { id: string; type: ToastKind; message: string };

/** The confirmation contract `WhatsAppHub` expects from its host shell. */
type ConfirmDialogState = { open: boolean; title: string; message: string; onConfirm: () => void };

const NAV_ICONS: Record<string, LucideIcon> = {
  Overview: LayoutDashboard,
  Calendar: CalendarDays,
  "Bookings List": ClipboardList,
  Guests: Users,
  WhatsApp: MessageCircle,
  Settings: SettingsIcon,
  "Manage Plans": CreditCard,
};

/**
 * The Settings sub-tab bar entries in canonical render order (Req 1.2). This is
 * only the label/icon presentation: which of them is actually rendered is
 * decided by the guarded bootstrap's `navigation.visibleTabs`
 * (`deriveRestaurantSettingsNavigation`), which this list is filtered against.
 */
const SETTINGS_SUB_TAB_ENTRIES: ReadonlyArray<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "Restaurant Profile", label: "Restaurant Profile", icon: Building2 },
  { id: "Operating Hours", label: "Operating Hours", icon: Clock },
  { id: "Dining Areas", label: "Dining Areas", icon: LayoutDashboard },
  { id: "Tables", label: "Tables", icon: Utensils },
  { id: "Menu", label: "Menu", icon: ClipboardList },
  { id: "Booking Rules", label: "Booking Rules", icon: SlidersHorizontal },
  { id: "WhatsApp Alerts", label: "WhatsApp Alerts", icon: Smartphone },
  { id: "Multi Location", label: "Multi Location", icon: MapPin },
  { id: "Manage Users", label: "Manage Users", icon: Users },
];

/** The four entries of the mobile bottom bar, all of them core (never gated). */
const MOBILE_BAR_ENTRIES = ["Overview", "Calendar", "Bookings List", "Settings"] as const;

const inputClass =
  "mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-500";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1";
const cardClass = "rounded-2xl border border-zinc-200 bg-white p-5";

/** Today in the browser's own zone — a form default only; the server recomputes. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() || fallback;
}

function statusPillClass(status: string): string {
  switch (status) {
    case "Confirmed":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "Seated":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "Completed":
      return "bg-zinc-100 text-zinc-600 border-zinc-200";
    case "Cancelled":
      return "bg-rose-50 text-rose-700 border-rose-200";
    case "No Show":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-sky-50 text-sky-700 border-sky-200";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview (Req 9.9-9.11) and Calendar (Req 9.8)
//
// Both read `getRestaurantOverviewServerFn`, which returns today's Table_Booking
// count and Party_Size sum plus the per-slot occupied and available counts of the
// selected date, every number decided by the pure layer server-side.
// ─────────────────────────────────────────────────────────────────────────────

function SlotOccupancyGrid({ day }: { day: DayOccupancyView }) {
  if (day.closed) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 py-8 text-center text-xs font-semibold text-zinc-400">
        Closed on this date — no booking slots are generated.
      </div>
    );
  }
  if (day.slots.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 py-8 text-center text-xs font-semibold text-zinc-400">
        No booking slots for this date. Check the operating hours and the turn time.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {day.slots.map((slot) => {
        const total = slot.availableCount + slot.occupiedCount;
        const occPct = total > 0 ? Math.round((slot.occupiedCount / total) * 100) : 0;
        return (
          <div
            key={slot.startMinutes}
            className={cn(
              "rounded-2xl border p-3 text-left transition-all hover:shadow-sm",
              slot.availableCount === 0
                ? "border-rose-200 bg-rose-50/50"
                : "border-zinc-200 bg-white",
            )}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-zinc-850">{slot.label}</p>
              <span
                className={cn(
                  "text-[9px] font-extrabold px-1.5 py-0.5 rounded-full",
                  slot.availableCount === 0
                    ? "bg-rose-100 text-rose-700"
                    : occPct > 50
                    ? "bg-amber-100 text-amber-700"
                    : "bg-emerald-100 text-emerald-700",
                )}
              >
                {occPct}% full
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  slot.availableCount === 0
                    ? "bg-rose-500"
                    : occPct > 50
                    ? "bg-amber-500"
                    : "bg-emerald-500",
                )}
                style={{ width: `${occPct}%` }}
              />
            </div>
            <p className="mt-2 text-[10px] font-semibold text-zinc-500">
              {slot.availableCount} available · {slot.occupiedCount} occupied
            </p>
          </div>
        );
      })}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  trend,
  badge,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  trend?: string;
  badge?: string;
}) {
  return (
    <div className={cn(cardClass, "relative overflow-hidden group hover:border-zinc-300 transition-all")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-brand/10 text-brand">
            <Icon className="h-4 w-4" />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</p>
        </div>
        {badge ? (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-black text-zinc-900 tracking-tight">{value}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        {hint ? <p className="text-[10px] font-semibold text-zinc-400">{hint}</p> : <div />}
        {trend ? (
          <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
            <ArrowUpRight className="h-3 w-3" /> {trend}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function OverviewPanel({
  onOpenWalkIn,
  canOperateBookings,
  onNavigateTab,
}: {
  onOpenWalkIn: () => void;
  canOperateBookings: boolean;
  onNavigateTab?: (tab: string) => void;
}) {
  const [data, setData] = useState<OverviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>("");
  const [trendRange, setTrendRange] = useState<"7D" | "30D">("30D");
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);

  const fetchOverview = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setIsSyncing(true);
    setError(null);
    try {
      const res = await getRestaurantOverviewServerFn({ data: {} });
      setData(res as OverviewView);
      const now = new Date();
      setLastSyncTime(
        now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      );
    } catch (err) {
      if (!silent) setError(errorText(err, "Could not load the overview"));
    } finally {
      if (!silent) setLoading(false);
      setIsSyncing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchOverview(false);
  }, [fetchOverview]);

  // Real-time polling engine (every 8 seconds) and window focus sync
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchOverview(true);
      }
    }, 8000);

    const onFocus = () => {
      fetchOverview(true);
    };

    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchOverview]);

  const handleQuickStatus = async (bookingId: string, nextStatus: string) => {
    if (!canOperateBookings) return;
    setBusyBookingId(bookingId);
    try {
      await setRestaurantBookingStatusServerFn({
        data: {
          bookingId,
          status: nextStatus,
        },
      });
      await fetchOverview(true);
    } catch (e) {
      console.error("Failed to update status:", e);
    } finally {
      setBusyBookingId(null);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-brand" />
        <p className="text-xs font-bold text-zinc-500">Loading real-time restaurant analytics...</p>
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <div className="flex-1">{error}</div>
        <button
          type="button"
          onClick={() => fetchOverview(false)}
          className="rounded-full bg-rose-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-rose-700 cursor-pointer"
        >
          Try Again
        </button>
      </div>
    );
  }
  if (!data) return null;

  const analytics = data.analytics;
  const metrics = analytics?.metrics;

  const totalBookingsCount = metrics?.totalBookings ?? data.today.bookingCount;
  const todayBookingsCount = metrics?.todayBookings ?? data.today.bookingCount;
  const upcomingBookingsCount = metrics?.upcomingBookings ?? 0;
  const totalGuestsCount = metrics?.totalGuests ?? data.today.partySizeSum;
  const todayGuestsCount = metrics?.todayGuests ?? data.today.partySizeSum;
  const activeTables = metrics?.activeTablesCount ?? data.today.activeTableCount;
  const totalTables = metrics?.totalTablesCount ?? data.today.activeTableCount;
  const totalCapacity = metrics?.totalCapacity ?? 0;
  const completedBookings = metrics?.completedBookings ?? 0;
  const avgPartySize = metrics?.averagePartySize ?? 2.5;

  // Filter daily trends by selected range
  const rawDailyTrends = analytics?.dailyTrends ?? [];
  const displayedTrends =
    trendRange === "7D" ? rawDailyTrends.slice(-7) : rawDailyTrends.slice(-30);

  // Status colors palette
  const statusColors: Record<string, string> = {
    Confirmed: "#0f766e",
    Seated: "#3b82f6",
    Completed: "#10b981",
    Pending: "#f59e0b",
    Cancelled: "#ef4444",
    "No Show": "#8b5cf6",
  };

  const statusBreakdown = analytics?.statusBreakdown ?? [];
  const hourlyRush = analytics?.hourlyRush ?? [];
  const areaBreakdown = analytics?.areaBreakdown ?? [];
  const recentBookings = analytics?.recentBookings ?? [];

  return (
    <div className="space-y-6">
      {/* ── Top Bar: Real-time status, Date, Refresh & Walk-In CTA ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-2xl border border-zinc-200/80 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-bold">
            <LayoutDashboard className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-zinc-900">Live Restaurant Overview</h3>
              <span className="flex items-center gap-1.5 text-[10px] font-extrabold text-emerald-700 bg-emerald-50 border border-emerald-200/80 rounded-full px-2.5 py-0.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                Real-Time Sync
              </span>
            </div>
            <p className="mt-0.5 text-[10px] font-semibold text-zinc-400">
              {data.today.date} · {data.timezone} {lastSyncTime ? `· Updated ${lastSyncTime}` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchOverview(true)}
            disabled={isSyncing}
            className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-[11px] font-bold text-zinc-700 hover:bg-zinc-100 cursor-pointer transition-all disabled:opacity-50"
            title="Refresh overview metrics"
          >
            <RefreshCw className={cn("h-3.5 w-3.5 text-zinc-500", isSyncing && "animate-spin text-brand")} />
            <span>{isSyncing ? "Syncing..." : "Refresh"}</span>
          </button>

          {canOperateBookings ? (
            <button
              type="button"
              onClick={onOpenWalkIn}
              className="flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold text-white hover:bg-zinc-800 cursor-pointer shadow-xs transition-all"
            >
              <UserPlus className="h-3.5 w-3.5 text-emerald-400" />
              <span>Seat a walk-in</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Metric Scorecard Grid ── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={ClipboardList}
          label="Total Bookings"
          value={String(totalBookingsCount)}
          hint={`${totalGuestsCount} covers total`}
          badge="All time"
        />
        <StatCard
          icon={CalendarDays}
          label="Bookings Today"
          value={String(todayBookingsCount)}
          hint={`${todayGuestsCount} covers expected today`}
          badge="Today"
        />
        <StatCard
          icon={Clock}
          label="Upcoming"
          value={String(upcomingBookingsCount)}
          hint={`${metrics?.upcomingGuests ?? 0} upcoming guests`}
          badge="Scheduled"
        />
        <StatCard
          icon={TrendingUp}
          label="Occupancy Rate"
          value={`${data.today.occupancyRate}%`}
          hint={`${data.today.slotCount} slots · ${activeTables} tables`}
          badge="Today"
        />
        <StatCard
          icon={Utensils}
          label="Active Tables"
          value={`${activeTables} / ${totalTables}`}
          hint={`${totalCapacity} seats max capacity`}
          badge="Dining"
        />
        <StatCard
          icon={UserCheck}
          label="Diners Served"
          value={String(completedBookings)}
          hint={`Avg party: ${avgPartySize} guests`}
          badge="Completed"
        />
      </div>

      {/* ── Interactive Charts Section ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Chart 1: Reservation & Diner Volume Trends (AreaChart) */}
        <div className="lg:col-span-8 rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-brand" />
                <h4 className="text-xs font-bold text-zinc-900 uppercase tracking-tight">
                  Reservation & Guest Volume Trends
                </h4>
              </div>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                Daily bookings and dining covers over time
              </p>
            </div>
            <div className="flex items-center gap-1.5 bg-zinc-100 p-1 rounded-xl border border-zinc-200/60">
              <button
                type="button"
                onClick={() => setTrendRange("7D")}
                className={cn(
                  "px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer",
                  trendRange === "7D"
                    ? "bg-white text-zinc-900 shadow-xs"
                    : "text-zinc-500 hover:text-zinc-900",
                )}
              >
                7 Days
              </button>
              <button
                type="button"
                onClick={() => setTrendRange("30D")}
                className={cn(
                  "px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer",
                  trendRange === "30D"
                    ? "bg-white text-zinc-900 shadow-xs"
                    : "text-zinc-500 hover:text-zinc-900",
                )}
              >
                30 Days
              </button>
            </div>
          </div>

          <div className="h-[250px] w-full">
            {displayedTrends.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayedTrends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorBookings" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0f766e" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#0f766e" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="colorGuests" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="label" stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(255, 255, 255, 0.95)",
                      border: "1px solid #e4e4e7",
                      borderRadius: "14px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                      fontSize: "11px",
                      padding: "8px 12px",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="bookings"
                    name="Reservations"
                    stroke="#0f766e"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#colorBookings)"
                    activeDot={{ r: 5, fill: "#0f766e", stroke: "#fff", strokeWidth: 2 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="guests"
                    name="Guests / Covers"
                    stroke="#6366f1"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorGuests)"
                    activeDot={{ r: 4, fill: "#6366f1", stroke: "#fff", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full bg-zinc-50/60 rounded-xl flex flex-col items-center justify-center text-center px-4">
                <BarChart3 className="h-7 w-7 text-zinc-300 mb-2" />
                <p className="text-xs font-semibold text-zinc-600">No trend data yet</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Bookings and guest trends will populate here automatically as reservations are received.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-5 text-[11px] font-bold text-zinc-600 pt-1 border-t border-zinc-100">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-brand" /> Reservations
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-indigo-500" /> Diners (Covers)
            </span>
          </div>
        </div>

        {/* Chart 2: Status Breakdown (Donut PieChart) */}
        <div className="lg:col-span-4 rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PieChartIcon className="h-4 w-4 text-brand" />
                <h4 className="text-xs font-bold text-zinc-900 uppercase tracking-tight">
                  Status Breakdown
                </h4>
              </div>
              <span className="text-[10px] font-bold text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-full border border-zinc-200">
                Live
              </span>
            </div>
            <p className="text-[10px] text-zinc-400 mt-0.5">
              Distribution of reservation statuses
            </p>
          </div>

          <div className="h-[180px] w-full flex items-center justify-center relative my-auto">
            {statusBreakdown.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusBreakdown.map((s) => ({
                        name: s.status,
                        value: s.count,
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={46}
                      outerRadius={68}
                      paddingAngle={3}
                      dataKey="value"
                      animationDuration={1000}
                    >
                      {statusBreakdown.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={statusColors[entry.status] || "#64748b"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "rgba(255, 255, 255, 0.95)",
                        border: "1px solid #e4e4e7",
                        borderRadius: "12px",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                        fontSize: "11px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                    Total
                  </span>
                  <span className="text-lg font-black text-zinc-900">{totalBookingsCount}</span>
                </div>
              </>
            ) : (
              <div className="h-full w-full bg-zinc-50/60 rounded-xl flex flex-col items-center justify-center text-center px-4">
                <PieChartIcon className="h-6 w-6 text-zinc-300 mb-1" />
                <p className="text-xs font-semibold text-zinc-500">No status data</p>
              </div>
            )}
          </div>

          {/* Status Breakdown Legend Chips */}
          <div className="grid grid-cols-2 gap-2 text-[10px] font-bold pt-2 border-t border-zinc-100">
            {statusBreakdown.slice(0, 6).map((item) => (
              <div
                key={item.status}
                className="flex items-center justify-between p-1.5 rounded-lg bg-zinc-50 border border-zinc-100"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: statusColors[item.status] || "#64748b" }}
                  />
                  <span className="text-zinc-700 truncate">{item.status}</span>
                </div>
                <span className="text-zinc-900 font-extrabold ml-1">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Secondary Charts: Peak Dining Rush & Area Performance ── */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Chart 3: Peak Dining Rush & Hourly Demand */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-500" />
              <div>
                <h4 className="text-xs font-bold text-zinc-900 uppercase tracking-tight">
                  Peak Dining Rush & Hours
                </h4>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Hourly booking distribution (Lunch & Dinner rushes)
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
              Rush Velocity
            </span>
          </div>

          <div className="h-[200px] w-full">
            {hourlyRush.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourlyRush} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="hour" stroke="#a1a1aa" fontSize={9} tickLine={false} axisLine={false} />
                  <YAxis stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(255, 255, 255, 0.95)",
                      border: "1px solid #e4e4e7",
                      borderRadius: "12px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                      fontSize: "11px",
                    }}
                  />
                  <Bar dataKey="bookings" name="Bookings" fill="#0f766e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="guests" name="Guests" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full bg-zinc-50/60 rounded-xl flex flex-col items-center justify-center text-center px-4">
                <Clock className="h-6 w-6 text-zinc-300 mb-1" />
                <p className="text-xs font-semibold text-zinc-500">No hourly rush data yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Chart 4: Dining Area / Zone Distribution */}
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UtensilsCrossed className="h-4 w-4 text-brand" />
              <div>
                <h4 className="text-xs font-bold text-zinc-900 uppercase tracking-tight">
                  Dining Area Performance
                </h4>
                <p className="text-[10px] text-zinc-400 mt-0.5">
                  Bookings and table allocation across zones
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold text-brand bg-brand/10 border border-brand/20 px-2.5 py-0.5 rounded-full">
              Seating Areas
            </span>
          </div>

          <div className="h-[200px] w-full">
            {areaBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={areaBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="area" stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="#a1a1aa" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(255, 255, 255, 0.95)",
                      border: "1px solid #e4e4e7",
                      borderRadius: "12px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
                      fontSize: "11px",
                    }}
                  />
                  <Bar dataKey="bookings" name="Bookings" fill="#0f766e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="tableCount" name="Tables" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full w-full bg-zinc-50/60 rounded-xl flex flex-col items-center justify-center text-center px-4">
                <Utensils className="h-6 w-6 text-zinc-300 mb-1" />
                <p className="text-xs font-semibold text-zinc-500">No area data yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Live Recent Bookings Feed ── */}
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand" />
            <div>
              <h4 className="text-xs font-bold text-zinc-900 uppercase tracking-tight">
                Live Recent Bookings Feed
              </h4>
              <p className="text-[10px] text-zinc-400 mt-0.5">
                Latest customer table reservations and current status
              </p>
            </div>
          </div>
          {onNavigateTab ? (
            <button
              type="button"
              onClick={() => onNavigateTab("Bookings List")}
              className="flex items-center gap-1 text-[11px] font-bold text-brand hover:underline cursor-pointer"
            >
              View all bookings <ArrowUpRight className="h-3 w-3" />
            </button>
          ) : null}
        </div>

        {recentBookings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-zinc-100 text-zinc-400 font-bold uppercase tracking-wider text-[9px]">
                  <th className="py-2.5 px-3">Token #</th>
                  <th className="py-2.5 px-3">Guest</th>
                  <th className="py-2.5 px-3">Date & Time</th>
                  <th className="py-2.5 px-3">Party Size</th>
                  <th className="py-2.5 px-3">Table / Area</th>
                  <th className="py-2.5 px-3">Status</th>
                  {canOperateBookings ? <th className="py-2.5 px-3 text-right">Quick Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50 font-medium text-zinc-700">
                {recentBookings.map((b) => (
                  <tr key={b.id} className="hover:bg-zinc-50/80 transition-colors">
                    <td className="py-3 px-3 font-bold text-zinc-900">
                      {b.tokenNo ? `#${b.tokenNo}` : "—"}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-zinc-900">{b.guestName || "Guest"}</div>
                      <div className="text-[10px] text-zinc-400">{b.guestPhone || "No phone"}</div>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-zinc-800">{b.date}</div>
                      <div className="text-[10px] text-zinc-400">{b.slotLabel}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded-md bg-zinc-100 text-zinc-800">
                        <Users className="h-3 w-3 text-zinc-500" />
                        {b.partySize ?? 2} guests
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-bold text-zinc-850">{b.tableName || "Any Table"}</div>
                      <div className="text-[10px] text-zinc-400">{b.area || "Main Area"}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold",
                          statusPillClass(b.status),
                        )}
                      >
                        {b.status}
                      </span>
                    </td>
                    {canOperateBookings ? (
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {b.status === "Confirmed" ? (
                            <button
                              type="button"
                              disabled={busyBookingId === b.id}
                              onClick={() => handleQuickStatus(b.id, "Seated")}
                              className="rounded-lg bg-indigo-50 border border-indigo-200 px-2 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100 cursor-pointer disabled:opacity-50"
                            >
                              Seat
                            </button>
                          ) : null}
                          {b.status === "Seated" ? (
                            <button
                              type="button"
                              disabled={busyBookingId === b.id}
                              onClick={() => handleQuickStatus(b.id, "Completed")}
                              className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100 cursor-pointer disabled:opacity-50"
                            >
                              Complete
                            </button>
                          ) : null}
                          {b.status === "Pending" ? (
                            <button
                              type="button"
                              disabled={busyBookingId === b.id}
                              onClick={() => handleQuickStatus(b.id, "Confirmed")}
                              className="rounded-lg bg-brand/10 border border-brand/20 px-2 py-1 text-[10px] font-bold text-brand hover:bg-brand/20 cursor-pointer disabled:opacity-50"
                            >
                              Confirm
                            </button>
                          ) : null}
                          {b.status !== "Cancelled" && b.status !== "Completed" ? (
                            <button
                              type="button"
                              disabled={busyBookingId === b.id}
                              onClick={() => handleQuickStatus(b.id, "Cancelled")}
                              className="rounded-lg bg-zinc-50 border border-zinc-200 px-2 py-1 text-[10px] font-bold text-zinc-500 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 cursor-pointer disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-zinc-200 py-10 text-center text-xs font-semibold text-zinc-400">
            No reservations found in the system yet. Walk-ins or online bookings will appear here in real-time.
          </div>
        )}
      </div>

      {/* ── Today's Slots Occupancy Grid ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Today's Booking Slots Capacity
          </h4>
          <span className="text-[10px] font-bold text-zinc-500">
            {data.today.slotCount} slots generated
          </span>
        </div>
        <SlotOccupancyGrid day={data.selected} />
      </div>
    </div>
  );
}

function CalendarPanel() {
  const [date, setDate] = useState(localToday);
  const [data, setData] = useState<OverviewView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRestaurantOverviewServerFn({ data: { date } })
      .then((res) => {
        if (!cancelled) setData(res as OverviewView);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, "Could not load that date"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-zinc-850">Calendar</h3>
          <p className="mt-1 text-[10px] font-semibold text-zinc-400">
            Occupied and available tables per booking slot.
          </p>
        </div>
        <label className="block">
          <span className={labelClass}>Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={cn(inputClass, "w-44")}
          />
        </label>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              icon={CalendarDays}
              label="Selected date"
              value={data.selected.date}
              hint={data.selected.closed ? "Closed" : `${data.selected.slots.length} slots`}
            />
            <StatCard
              icon={Utensils}
              label="Active tables"
              value={String(data.selected.activeTableCount)}
            />
            <StatCard
              icon={TrendingUp}
              label="Occupancy rate"
              value={`${data.selected.occupancyRate}%`}
              hint={`${data.selected.blockingPairs} occupied table-slot pairs`}
            />
          </div>
          <SlotOccupancyGrid day={data.selected} />
        </>
      ) : null}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// Bookings List (Req 9.1-9.4, 9.6, 9.7, 9.12)
//
// Every filter, the two searches, the default ordering and the 25-row page size
// are decided by `getRestaurantBookingsServerFn` / the row-access layer — this
// panel only collects the criteria and renders the page it is handed, so the
// dashboard and any other caller page identically.
// ─────────────────────────────────────────────────────────────────────────────

interface BookingsPageView {
  permission: RestaurantPermission;
  rows: BookingRowView[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** A Dining_Table as the area/table filter selects and the reassign control need it. */
type TableOption = Pick<DiningTable, "id" | "name" | "seatCapacity" | "area" | "state">;

function BookingsListPanel({
  bookingsPermission,
  tenantId,
  walkInOpen,
  onWalkInOpenChange,
  showToast,
}: {
  bookingsPermission: RestaurantPermission;
  tenantId: string;
  walkInOpen: boolean;
  onWalkInOpenChange: (open: boolean) => void;
  showToast: (type: ToastKind, message: string) => void;
}) {
  const canOperate = bookingsPermission === "operate";

  // Committed filter criteria (Req 9.2, 9.3).
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statuses, setStatuses] = useState<string[]>([]);
  const [area, setArea] = useState("");
  const [tableId, setTableId] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");

  // The two search boxes debounce into the committed criteria above.
  const [nameInput, setNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");

  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);

  const [data, setData] = useState<BookingsPageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tables, setTables] = useState<TableOption[]>([]);

  // Modals for CRUD
  const [viewBooking, setViewBooking] = useState<BookingRowView | null>(null);
  const [editBooking, setEditBooking] = useState<BookingRowView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BookingRowView | null>(null);
  const [newResOpen, setNewResOpen] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPartySize, setEditPartySize] = useState(2);
  const [editTableId, setEditTableId] = useState("");
  const [editStatus, setEditStatus] = useState("Confirmed");
  const [editNotes, setEditNotes] = useState("");
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Create Reservation state
  const [resName, setResName] = useState("");
  const [resPhone, setResPhone] = useState("");
  const [resEmail, setResEmail] = useState("");
  const [resPartySize, setResPartySize] = useState(2);
  const [resDate, setResDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [resSlotLabel, setResSlotLabel] = useState("19:00");
  const [resTableId, setResTableId] = useState("");
  const [resStatus, setResStatus] = useState("Confirmed");
  const [resNotes, setResNotes] = useState("");
  const [submittingRes, setSubmittingRes] = useState(false);
  const [resError, setResError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setGuestName(nameInput.trim());
      setGuestPhone(phoneInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [nameInput, phoneInput]);

  useEffect(() => {
    let cancelled = false;
    getRestaurantTablesServerFn({ data: { includeInactive: true } })
      .then((res) => {
        if (!cancelled)
          setTables(((res as { tables?: TableOption[] }).tables ?? []) as TableOption[]);
      })
      .catch(() => {
        if (!cancelled) setTables([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getRestaurantBookingsServerFn({
      data: {
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        statuses: statuses.length > 0 ? statuses : null,
        area: area || null,
        tableId: tableId || null,
        guestName: guestName || null,
        guestPhone: guestPhone || null,
        page,
      },
    })
      .then((res) => {
        if (!cancelled) setData(res as unknown as BookingsPageView);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, "Could not load the bookings"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateFrom, dateTo, statuses, area, tableId, guestName, guestPhone, page, reload]);

  const areas = useMemo(() => {
    const seen = new Set<string>();
    for (const t of tables) if (t.area) seen.add(t.area);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [tables]);

  const toggleStatus = useCallback((status: string) => {
    setPage(1);
    setStatuses((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setDateFrom("");
    setDateTo("");
    setStatuses([]);
    setArea("");
    setTableId("");
    setNameInput("");
    setPhoneInput("");
    setPage(1);
  }, []);

  const changeStatus = useCallback(
    async (row: BookingRowView, status: string) => {
      if (!canOperate || status === row.status) return;
      setBusyId(row.id);
      try {
        await setRestaurantBookingStatusServerFn({ data: { bookingId: row.id, status } });
        showToast("success", `Booking marked ${status}`);
        setReload((n) => n + 1);
      } catch (err) {
        showToast("error", errorText(err, "Could not change the booking status"));
      } finally {
        setBusyId(null);
      }
    },
    [canOperate, showToast],
  );

  const reassign = useCallback(
    async (row: BookingRowView, targetTableId: string) => {
      if (!canOperate || !targetTableId || targetTableId === row.tableId) return;
      setBusyId(row.id);
      try {
        const res = await reassignRestaurantBookingServerFn({
          data: { bookingId: row.id, tableId: targetTableId },
        });
        showToast(
          "success",
          `Moved to ${(res as { tableName?: string }).tableName ?? "the selected table"}`,
        );
        setReload((n) => n + 1);
      } catch (err) {
        showToast("error", errorText(err, "Could not reassign the booking"));
      } finally {
        setBusyId(null);
      }
    },
    [canOperate, showToast],
  );

  const openEdit = (row: BookingRowView) => {
    setEditName(row.guestName);
    setEditPhone(row.guestPhone || "");
    setEditEmail("");
    setEditPartySize(row.partySize || 2);
    setEditTableId(row.tableId || "");
    setEditStatus(row.status);
    setEditNotes(row.specialRequests || "");
    setEditError(null);
    setEditBooking(row);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editBooking) return;
    if (!editName.trim()) {
      setEditError("Guest name is required.");
      return;
    }
    setSubmittingEdit(true);
    setEditError(null);
    try {
      await updateRestaurantBookingServerFn({
        data: {
          bookingId: editBooking.id,
          guestName: editName.trim(),
          phone: editPhone.trim() || undefined,
          email: editEmail.trim() || undefined,
          partySize: Number(editPartySize),
          tableId: editTableId || undefined,
          status: editStatus,
          specialRequests: editNotes.trim() || undefined,
        },
      });
      showToast("success", "Reservation details updated");
      setEditBooking(null);
      setReload((n) => n + 1);
    } catch (err) {
      setEditError(errorText(err, "Failed to update booking"));
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDeleteBooking = async (bookingId: string) => {
    setBusyId(bookingId);
    try {
      await deleteRestaurantBookingServerFn({ data: { bookingId } });
      showToast("success", "Reservation deleted and table released");
      setDeleteTarget(null);
      setReload((n) => n + 1);
    } catch (err) {
      showToast("error", errorText(err, "Failed to delete booking"));
    } finally {
      setBusyId(null);
    }
  };

  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resName.trim()) {
      setResError("Guest name is required.");
      return;
    }
    setSubmittingRes(true);
    setResError(null);
    try {
      const startMinutes = (() => {
        const parts = resSlotLabel.split(":");
        if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        return 19 * 60;
      })();

      await createRestaurantReservationServerFn({
        data: {
          guestName: resName.trim(),
          phone: resPhone.trim() || undefined,
          email: resEmail.trim() || undefined,
          partySize: Number(resPartySize),
          date: resDate,
          slotStartMinutes: startMinutes,
          slotLabel: resSlotLabel,
          tableIds: resTableId ? [resTableId] : null,
          status: resStatus,
          specialRequests: resNotes.trim() || undefined,
        },
      });
      showToast("success", `Reservation confirmed for ${resName.trim()}`);
      setNewResOpen(false);
      setResName("");
      setResPhone("");
      setResEmail("");
      setResNotes("");
      setReload((n) => n + 1);
    } catch (err) {
      setResError(errorText(err, "Failed to create reservation"));
    } finally {
      setSubmittingRes(false);
    }
  };

  const totalPages = data?.totalPages ?? 0;

  return (
    <div className="space-y-5">
      {/* ── Header with Title and Action CTAs ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-zinc-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-zinc-900">Reservations & Bookings List</h3>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">
              {data?.total ?? 0} {data?.total === 1 ? "Booking" : "Bookings"}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Real-time table occupancy, diner party allocations, and full reservation lifecycle control.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="p-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

          {canOperate ? (
            <>
              <button
                type="button"
                onClick={() => onWalkInOpenChange(true)}
                className="flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3.5 py-2 text-xs font-bold text-zinc-800 hover:bg-zinc-50 transition-all cursor-pointer shadow-xs"
              >
                <UserCheck className="h-3.5 w-3.5 text-brand" />
                <span>Seat Walk-in</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setResError(null);
                  setNewResOpen(true);
                }}
                className="flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 text-xs font-bold text-white hover:bg-zinc-800 transition-all cursor-pointer shadow-xs"
              >
                <Plus className="h-4 w-4 text-emerald-400" />
                <span>New Reservation</span>
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* ── Filters (Date Range, Area, Table, Name, Phone, Status) ── */}
      <div className={cn(cardClass, "space-y-4")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className={labelClass}>From date</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>To date</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className={labelClass}>Area</span>
            <select
              value={area}
              onChange={(e) => {
                setArea(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            >
              <option value="">Every area</option>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Table</span>
            <select
              value={tableId}
              onChange={(e) => {
                setTableId(e.target.value);
                setPage(1);
              }}
              className={inputClass}
            >
              <option value="">Every table</option>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} · seats {t.seatCapacity}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Guest name and phone search */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={labelClass}>Guest name</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Search by guest name"
                className={cn(inputClass, "pl-9 text-xs")}
              />
            </div>
          </label>
          <label className="block">
            <span className={labelClass}>Guest phone</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="Search by phone number"
                className={cn(inputClass, "pl-9 text-xs")}
              />
            </div>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={labelClass}>Status:</span>
          {BOOKING_STATUSES.map((status) => {
            const on = statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                onClick={() => toggleStatus(status)}
                aria-pressed={on}
                className={cn(
                  "rounded-full border px-3 py-1 text-[10px] font-bold transition-all cursor-pointer",
                  on
                    ? statusPillClass(status)
                    : "border-zinc-200 bg-white text-zinc-400 hover:text-zinc-600",
                )}
              >
                {status}
              </button>
            );
          })}
          <button
            type="button"
            onClick={clearFilters}
            className="ml-auto flex items-center gap-1.5 rounded-full border border-zinc-200 px-3 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer"
          >
            <X className="h-3 w-3" /> Clear filters
          </button>
        </div>
      </div>

      {/* ── Error, Loading & Data Table ── */}
      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-brand" />
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white py-14 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400 mb-3">
            <ClipboardList className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-zinc-800">No reservations match these filters</p>
          <p className="mt-1 text-xs text-zinc-400">Try clearing filters or taking a new booking.</p>
          {canOperate ? (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => onWalkInOpenChange(true)}
                className="rounded-full border border-zinc-200 px-4 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
              >
                Seat Walk-in
              </button>
              <button
                type="button"
                onClick={() => setNewResOpen(true)}
                className="rounded-full bg-zinc-950 px-4 py-1.5 text-xs font-bold text-white hover:bg-zinc-800 cursor-pointer"
              >
                + New Reservation
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-xs">
            <table className="w-full min-w-[920px] text-left text-xs">
              <thead className="border-b border-zinc-150 bg-zinc-50/80">
                <tr className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  <th className="px-4 py-3">Token</th>
                  <th className="px-4 py-3">Guest & Details</th>
                  <th className="px-4 py-3">Party</th>
                  <th className="px-4 py-3">Date & Slot</th>
                  <th className="px-4 py-3">Table & Area</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Reassign</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {data.rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "hover:bg-zinc-50/70 transition-colors",
                      busyId === row.id && "opacity-50 pointer-events-none",
                    )}
                  >
                    <td className="px-4 py-3.5 font-black text-zinc-800">
                      {row.tokenNo === null ? "—" : `#${row.tokenNo}`}
                    </td>

                    <td className="px-4 py-3.5">
                      <p className="font-bold text-zinc-900">{row.guestName}</p>
                      <p className="text-[11px] text-zinc-500 font-medium">{row.guestPhone || "No phone"}</p>
                      {row.specialRequests ? (
                        <p
                          className="mt-1 max-w-[15rem] truncate text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200/60 rounded px-1.5 py-0.5"
                          title={row.specialRequests}
                        >
                          {row.specialRequests}
                        </p>
                      ) : null}
                    </td>

                    <td className="px-4 py-3.5 font-bold text-zinc-800">
                      <span className="inline-flex items-center gap-1 bg-zinc-100 px-2 py-0.5 rounded-md text-[11px]">
                        <Utensils className="h-3 w-3 text-zinc-500" />
                        {row.partySize ?? "—"}
                      </span>
                    </td>

                    <td className="px-4 py-3.5">
                      <p className="font-bold text-zinc-800">{row.date}</p>
                      <p className="text-[11px] font-semibold text-brand flex items-center gap-1 mt-0.5">
                        <Clock className="h-3 w-3" /> {row.slotLabel}
                      </p>
                    </td>

                    <td className="px-4 py-3.5">
                      <p className="font-bold text-zinc-800">{row.tableName || "—"}</p>
                      <span className="text-[10px] text-zinc-400 font-medium">{row.area ?? "Main"}</span>
                    </td>

                    <td className="px-4 py-3.5">
                      {canOperate ? (
                        <select
                          value={row.status}
                          disabled={busyId === row.id}
                          onChange={(e) => void changeStatus(row, e.target.value)}
                          aria-label={`Status of booking for ${row.guestName}`}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[10px] font-bold cursor-pointer focus:outline-none",
                            statusPillClass(row.status),
                          )}
                        >
                          {BOOKING_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {status}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={cn(
                            "inline-block rounded-full border px-2.5 py-1 text-[10px] font-bold",
                            statusPillClass(row.status),
                          )}
                        >
                          {row.status}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3.5">
                      {!canOperate ? (
                        <span className="text-[10px] text-zinc-300">View only</span>
                      ) : (row.groupTables?.length ?? 0) > 1 ? (
                        <span className="text-[10px] font-semibold text-zinc-400">
                          {row.groupTables?.length} tables
                        </span>
                      ) : (
                        <select
                          value={row.tableId ?? ""}
                          disabled={busyId === row.id}
                          onChange={(e) => void reassign(row, e.target.value)}
                          aria-label={`Reassign table for ${row.guestName}`}
                          className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-600 cursor-pointer focus:border-brand focus:outline-none"
                        >
                          <option value="">Move table…</option>
                          {tables.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} (seats {t.seatCapacity})
                            </option>
                          ))}
                        </select>
                      )}
                    </td>

                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setViewBooking(row)}
                          className="p-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 transition-colors cursor-pointer"
                          title="View Details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {canOperate ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEdit(row)}
                              className="p-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-brand/10 hover:border-brand/30 hover:text-brand transition-colors cursor-pointer"
                              title="Edit Reservation"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(row)}
                              className="p-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition-colors cursor-pointer"
                              title="Delete Reservation"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[10px] font-semibold text-zinc-400">
              {data.total} booking{data.total === 1 ? "" : "s"} · page {data.page} of{" "}
              {Math.max(totalPages, 1)} · {data.pageSize} per page
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={data.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1.5 text-[10px] font-bold text-zinc-600 disabled:opacity-40 hover:bg-zinc-50 cursor-pointer disabled:cursor-not-allowed"
              >
                <ChevronLeft className="h-3 w-3" /> Previous
              </button>
              <button
                type="button"
                disabled={totalPages === 0 || data.page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1.5 text-[10px] font-bold text-zinc-600 disabled:opacity-40 hover:bg-zinc-50 cursor-pointer disabled:cursor-not-allowed"
              >
                Next <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── CREATE RESERVATION MODAL ── */}
      <AnimatePresence>
        {newResOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg bg-white rounded-3xl p-6 shadow-2xl border border-zinc-200 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
                    <Plus className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900">Create New Reservation</h4>
                    <p className="text-[10px] text-zinc-400">Book table allocations in advance</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setNewResOpen(false)}
                  className="p-1 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {resError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{resError}</span>
                </div>
              ) : null}

              <form onSubmit={handleCreateReservation} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Guest Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={resName}
                      onChange={(e) => setResName(e.target.value)}
                      placeholder="e.g. Priya Patel"
                      className={cn(inputClass, "w-full text-xs")}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={resPhone}
                      onChange={(e) => setResPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className={cn(inputClass, "w-full text-xs")}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Party Size (Covers)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={resPartySize}
                      onChange={(e) => setResPartySize(Math.max(1, parseInt(e.target.value) || 1))}
                      className={cn(inputClass, "w-full text-xs")}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      required
                      value={resDate}
                      onChange={(e) => setResDate(e.target.value)}
                      className={cn(inputClass, "w-full text-xs")}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Time Slot
                    </label>
                    <input
                      type="time"
                      required
                      value={resSlotLabel}
                      onChange={(e) => setResSlotLabel(e.target.value)}
                      className={cn(inputClass, "w-full text-xs")}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Assigned Table
                    </label>
                    <select
                      value={resTableId}
                      onChange={(e) => setResTableId(e.target.value)}
                      className={cn(inputClass, "w-full text-xs")}
                    >
                      <option value="">Auto-assign best table</option>
                      {tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.area || "Main"} · seats {t.seatCapacity})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Initial Status
                    </label>
                    <select
                      value={resStatus}
                      onChange={(e) => setResStatus(e.target.value)}
                      className={cn(inputClass, "w-full text-xs")}
                    >
                      {BOOKING_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                    Special Requests / Dietary Notes
                  </label>
                  <textarea
                    rows={2}
                    value={resNotes}
                    onChange={(e) => setResNotes(e.target.value)}
                    placeholder="e.g. Birthday celebration, Window table preferred..."
                    className={cn(inputClass, "w-full text-xs resize-none py-2")}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => setNewResOpen(false)}
                    disabled={submittingRes}
                    className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingRes}
                    className="flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-xs font-bold text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
                  >
                    {submittingRes ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Confirming...</span>
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Create Reservation</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── EDIT BOOKING MODAL ── */}
      <AnimatePresence>
        {editBooking && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-zinc-200 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
                    <Pencil className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900">Edit Reservation Details</h4>
                    <p className="text-[10px] text-zinc-400">
                      Token #{editBooking.tokenNo ?? "—"} · {editBooking.date} ({editBooking.slotLabel})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditBooking(null)}
                  className="p-1 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {editError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{editError}</span>
                </div>
              ) : null}

              <form onSubmit={handleSaveEdit} className="space-y-3.5">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                    Guest Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className={cn(inputClass, "w-full text-xs")}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className={cn(inputClass, "w-full text-xs")}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Party Size (Guests)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={editPartySize}
                      onChange={(e) => setEditPartySize(Math.max(1, parseInt(e.target.value) || 1))}
                      className={cn(inputClass, "w-full text-xs")}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Assigned Table
                    </label>
                    <select
                      value={editTableId}
                      onChange={(e) => setEditTableId(e.target.value)}
                      className={cn(inputClass, "w-full text-xs")}
                    >
                      <option value="">Keep current table</option>
                      {tables.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.area || "Main"} · seats {t.seatCapacity})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Status
                    </label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className={cn(inputClass, "w-full text-xs")}
                    >
                      {BOOKING_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                    Special Requests / Dietary Notes
                  </label>
                  <textarea
                    rows={2}
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    className={cn(inputClass, "w-full text-xs resize-none py-2")}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => setEditBooking(null)}
                    disabled={submittingEdit}
                    className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingEdit}
                    className="flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-xs font-bold text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
                  >
                    {submittingEdit ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5 text-emerald-400" />
                        <span>Save Changes</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── VIEW BOOKING DETAILS MODAL ── */}
      <AnimatePresence>
        {viewBooking && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-zinc-200 space-y-4"
            >
              <div className="flex items-start justify-between border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center font-black text-sm border border-brand/20">
                    {viewBooking.tokenNo ? `#${viewBooking.tokenNo}` : "—"}
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-zinc-900">{viewBooking.guestName}</h4>
                    <p className="text-[11px] text-zinc-400 font-semibold">{viewBooking.guestPhone || "No phone"}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setViewBooking(null)}
                  className="p-1 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2.5 rounded-xl bg-zinc-50 border border-zinc-100">
                    <span className="text-[9px] font-bold text-zinc-400 uppercase block">Date & Time</span>
                    <p className="font-bold text-zinc-800 mt-0.5">{viewBooking.date}</p>
                    <p className="text-[11px] font-semibold text-brand">{viewBooking.slotLabel}</p>
                  </div>
                  <div className="p-2.5 rounded-xl bg-zinc-50 border border-zinc-100">
                    <span className="text-[9px] font-bold text-zinc-400 uppercase block">Party & Table</span>
                    <p className="font-bold text-zinc-800 mt-0.5">{viewBooking.partySize} Guests</p>
                    <p className="text-[11px] font-semibold text-zinc-600">
                      {viewBooking.tableName || "Unassigned"} ({viewBooking.area || "Main"})
                    </p>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-zinc-50 border border-zinc-100 flex items-center justify-between">
                  <span className="text-[9px] font-bold text-zinc-400 uppercase">Status</span>
                  <span
                    className={cn(
                      "inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold",
                      statusPillClass(viewBooking.status),
                    )}
                  >
                    {viewBooking.status}
                  </span>
                </div>

                {viewBooking.specialRequests ? (
                  <div className="p-2.5 rounded-xl bg-amber-50/70 border border-amber-200/60 space-y-0.5">
                    <span className="text-[9px] font-bold text-amber-800 uppercase block">Special Requests</span>
                    <p className="text-xs font-medium text-amber-900">{viewBooking.specialRequests}</p>
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
                {canOperate ? (
                  <button
                    type="button"
                    onClick={() => {
                      const row = viewBooking;
                      setViewBooking(null);
                      openEdit(row);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit Reservation
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setViewBooking(null)}
                  className="rounded-full bg-zinc-950 px-5 py-2 text-xs font-bold text-white hover:bg-zinc-800 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── DELETE RESERVATION CONFIRMATION MODAL ── */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-zinc-200 space-y-4 text-center"
            >
              <div className="mx-auto h-12 w-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                <Trash2 className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-zinc-900">Delete Reservation?</h4>
                <p className="mt-1 text-xs text-zinc-500">
                  Are you sure you want to remove the booking for{" "}
                  <span className="font-bold text-zinc-800">{deleteTarget.guestName}</span> on {deleteTarget.date}?
                  This will release the table allocation.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={busyId === deleteTarget.id}
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyId === deleteTarget.id}
                  onClick={() => handleDeleteBooking(deleteTarget.id)}
                  className="flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 cursor-pointer disabled:opacity-50"
                >
                  {busyId === deleteTarget.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span>Delete Booking</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Req 9.7 — the walk-in path */}
      <WalkInDrawer
        tenantId={tenantId}
        permission={bookingsPermission}
        open={walkInOpen}
        onClose={() => onWalkInOpenChange(false)}
        onCreated={() => {
          setReload((n) => n + 1);
          showToast("success", "Walk-in seated");
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Guests (Req 10.3)
//
// Guest records reuse the tenant-scoped `Patient` registry, so this is a
// relabelled read: name, phone, linked Table_Booking count, most recent booking
// date and `No Show` count, all counted server-side.
// ─────────────────────────────────────────────────────────────────────────────

function GuestsPanel({
  canOperate = true,
  showToast,
}: {
  canOperate?: boolean;
  showToast?: (type: ToastKind, message: string) => void;
}) {
  const [guests, setGuests] = useState<GuestRowView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Modal states: 'create' | 'edit' | 'view' | 'delete' | null
  const [activeModal, setActiveModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; guest: GuestRowView }
    | { mode: "view"; guest: GuestRowView }
    | { mode: "delete"; guest: GuestRowView }
    | null
  >(null);

  // Form states for create & edit
  const [formName, setFormName] = useState("");
  const [formPhone, setFormPhone] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formAddress, setFormAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchGuests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getRestaurantGuestsServerFn();
      setGuests(((res as { guests?: GuestRowView[] }).guests ?? []) as GuestRowView[]);
    } catch (err) {
      setError(errorText(err, "Could not load the guests"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGuests();
  }, [fetchGuests]);

  const openCreateModal = () => {
    setFormName("");
    setFormPhone("");
    setFormEmail("");
    setFormNotes("");
    setFormAddress("");
    setFormError(null);
    setActiveModal({ mode: "create" });
  };

  const openEditModal = (guest: GuestRowView) => {
    setFormName(guest.name);
    setFormPhone(guest.phone || "");
    setFormEmail(guest.email || "");
    setFormNotes(guest.notes || "");
    setFormAddress(guest.address || "");
    setFormError(null);
    setActiveModal({ mode: "edit", guest });
  };

  const handleSaveGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError("Guest name is required.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      if (activeModal?.mode === "create") {
        await createRestaurantGuestServerFn({
          data: {
            name: formName.trim(),
            phone: formPhone.trim() || null,
            email: formEmail.trim() || null,
            notes: formNotes.trim() || null,
            address: formAddress.trim() || null,
          },
        });
        showToast?.("success", `Guest "${formName.trim()}" added successfully`);
      } else if (activeModal?.mode === "edit") {
        await updateRestaurantGuestServerFn({
          data: {
            id: activeModal.guest.id,
            name: formName.trim(),
            phone: formPhone.trim() || null,
            email: formEmail.trim() || null,
            notes: formNotes.trim() || null,
            address: formAddress.trim() || null,
          },
        });
        showToast?.("success", `Guest details for "${formName.trim()}" updated`);
      }
      setActiveModal(null);
      await fetchGuests();
    } catch (err) {
      setFormError(errorText(err, "Failed to save guest details"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteGuest = async (guestId: string) => {
    setSubmitting(true);
    try {
      await deleteRestaurantGuestServerFn({
        data: { id: guestId },
      });
      showToast?.("success", "Guest removed from directory");
      setActiveModal(null);
      await fetchGuests();
    } catch (err) {
      showToast?.("error", errorText(err, "Failed to delete guest"));
    } finally {
      setSubmitting(false);
    }
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return guests;
    return guests.filter(
      (g) =>
        g.name.toLowerCase().includes(needle) ||
        g.phone.toLowerCase().includes(needle) ||
        (g.email && g.email.toLowerCase().includes(needle)) ||
        (g.guestNo && g.guestNo.toLowerCase().includes(needle)) ||
        (g.notes && g.notes.toLowerCase().includes(needle)),
    );
  }, [guests, search]);

  const totalBookingsAcrossGuests = guests.reduce((sum, g) => sum + g.bookingCount, 0);
  const repeatGuestsCount = guests.filter((g) => g.bookingCount > 1).length;

  return (
    <div className="space-y-6">
      {/* ── Header with Title, Stats & Add Guest CTA ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-5 rounded-2xl border border-zinc-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-zinc-900">Guest Directory & CRM</h3>
            <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">
              {guests.length} {guests.length === 1 ? "Guest" : "Guests"}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            Manage your restaurant diner profiles, contact records, dietary preferences, and visit history.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchGuests}
            className="p-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw className="h-4 w-4" />
          </button>

          {canOperate ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2.5 text-xs font-bold text-white hover:bg-zinc-800 transition-all shadow-xs cursor-pointer"
            >
              <UserPlus className="h-4 w-4 text-emerald-400" />
              <span>Add New Guest</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* ── Quick CRM Summary Cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Total Registered Guests</p>
          <p className="mt-1 text-2xl font-black text-zinc-900">{guests.length}</p>
          <p className="mt-0.5 text-[10px] text-zinc-400">In your restaurant customer book</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Repeat Diners</p>
          <p className="mt-1 text-2xl font-black text-emerald-600">{repeatGuestsCount}</p>
          <p className="mt-0.5 text-[10px] text-zinc-400">Guests with 2+ completed visits</p>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Total Lifetime Reservations</p>
          <p className="mt-1 text-2xl font-black text-brand">{totalBookingsAcrossGuests}</p>
          <p className="mt-0.5 text-[10px] text-zinc-400">Bookings across all registered diners</p>
        </div>
      </div>

      {/* ── Search & Filter Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, email, notes, or guest ID..."
            className={cn(inputClass, "pl-10 text-xs")}
          />
        </div>
        {search ? (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="text-xs font-semibold text-zinc-500 hover:text-zinc-800 cursor-pointer"
          >
            Clear Search
          </button>
        ) : null}
      </div>

      {/* ── Error, Loading, and Table ── */}
      {error ? (
        <div className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchGuests}
            className="rounded-full bg-rose-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-rose-700 cursor-pointer"
          >
            Try Again
          </button>
        </div>
      ) : loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-brand" />
          <p className="text-xs font-semibold text-zinc-500">Loading guest records...</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 bg-white py-16 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-400 mb-3">
            <Users className="h-6 w-6" />
          </div>
          <p className="text-sm font-bold text-zinc-800">
            {guests.length === 0 ? "No guest records yet" : "No matching guests found"}
          </p>
          <p className="mt-1 text-xs text-zinc-400 max-w-sm mx-auto">
            {guests.length === 0
              ? "Add your customer profiles or seat walk-ins and reservations to build your diner book."
              : "Try adjusting your search query."}
          </p>
          {canOperate && guests.length === 0 ? (
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-zinc-950 px-4 py-2 text-xs font-bold text-white hover:bg-zinc-800 cursor-pointer"
            >
              <UserPlus className="h-4 w-4" /> Add Your First Guest
            </button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-xs">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="border-b border-zinc-150 bg-zinc-50/80">
              <tr className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                <th className="px-4 py-3">Guest</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3">Dietary / Notes</th>
                <th className="px-4 py-3">Bookings</th>
                <th className="px-4 py-3">Last Visit</th>
                <th className="px-4 py-3">No Shows</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visible.map((g) => {
                const initials = g.name
                  ? g.name
                      .split(" ")
                      .map((p) => p[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()
                  : "G";
                return (
                  <tr key={g.id} className="hover:bg-zinc-50/70 transition-colors">
                    {/* Guest Name & ID */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-brand/10 text-brand flex items-center justify-center font-extrabold text-[11px] shrink-0 border border-brand/20">
                          {initials}
                        </div>
                        <div>
                          <p className="font-bold text-zinc-900">{g.name}</p>
                          <span className="text-[10px] font-semibold text-zinc-400">{g.guestNo}</span>
                        </div>
                      </div>
                    </td>

                    {/* Contact (Phone / Email) */}
                    <td className="px-4 py-3.5">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-zinc-700 font-semibold">
                          <Phone className="h-3 w-3 text-zinc-400" />
                          <span>{g.phone || "No phone"}</span>
                        </div>
                        {g.email ? (
                          <div className="flex items-center gap-1 text-[11px] text-zinc-400 truncate max-w-[180px]">
                            <Mail className="h-3 w-3 text-zinc-400 shrink-0" />
                            <span className="truncate">{g.email}</span>
                          </div>
                        ) : null}
                      </div>
                    </td>

                    {/* Preferences & Dietary Notes */}
                    <td className="px-4 py-3.5">
                      {g.notes ? (
                        <div
                          className="max-w-[200px] truncate text-[11px] font-medium text-zinc-600 bg-amber-50/70 border border-amber-200/60 rounded-lg px-2.5 py-1"
                          title={g.notes}
                        >
                          {g.notes}
                        </div>
                      ) : (
                        <span className="text-[11px] text-zinc-300 italic">No notes</span>
                      )}
                    </td>

                    {/* Total Bookings */}
                    <td className="px-4 py-3.5 font-bold text-zinc-800">
                      <span className="inline-flex items-center gap-1 bg-zinc-100 px-2 py-0.5 rounded-md text-[11px]">
                        <Utensils className="h-3 w-3 text-zinc-500" />
                        {g.bookingCount} {g.bookingCount === 1 ? "visit" : "visits"}
                      </span>
                    </td>

                    {/* Last Visit */}
                    <td className="px-4 py-3.5 text-zinc-600 font-medium">
                      {g.lastBookingDate ? (
                        <div className="flex items-center gap-1.5">
                          <CalendarDays className="h-3.5 w-3.5 text-zinc-400" />
                          <span>{g.lastBookingDate}</span>
                        </div>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </td>

                    {/* No Show Badge */}
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          "inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-bold",
                          g.noShowCount > 0
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-zinc-200 bg-zinc-50 text-zinc-400",
                        )}
                      >
                        {g.noShowCount} {g.noShowCount === 1 ? "no-show" : "no-shows"}
                      </span>
                    </td>

                    {/* Action buttons */}
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setActiveModal({ mode: "view", guest: g })}
                          className="p-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 transition-colors cursor-pointer"
                          title="View Guest Details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {canOperate ? (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditModal(g)}
                              className="p-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-brand/10 hover:border-brand/30 hover:text-brand transition-colors cursor-pointer"
                              title="Edit Guest"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setActiveModal({ mode: "delete", guest: g })}
                              className="p-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition-colors cursor-pointer"
                              title="Delete Guest"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── CREATE / EDIT GUEST MODAL ── */}
      <AnimatePresence>
        {(activeModal?.mode === "create" || activeModal?.mode === "edit") && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-zinc-200 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-9 w-9 rounded-xl bg-brand/10 text-brand flex items-center justify-center">
                    {activeModal.mode === "create" ? (
                      <UserPlus className="h-4 w-4" />
                    ) : (
                      <Pencil className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900">
                      {activeModal.mode === "create" ? "Add New Guest Profile" : "Edit Guest Profile"}
                    </h4>
                    <p className="text-[10px] text-zinc-400">
                      {activeModal.mode === "create"
                        ? "Register a new diner in your restaurant book"
                        : `Editing ${activeModal.guest.guestNo}`}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="p-1 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {formError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              ) : null}

              <form onSubmit={handleSaveGuest} className="space-y-3.5">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                    Guest Full Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className={cn(inputClass, "w-full text-xs")}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Phone Number
                    </label>
                    <input
                      type="tel"
                      value={formPhone}
                      onChange={(e) => setFormPhone(e.target.value)}
                      placeholder="e.g. 9876543210"
                      className={cn(inputClass, "w-full text-xs")}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={formEmail}
                      onChange={(e) => setFormEmail(e.target.value)}
                      placeholder="e.g. rahul@example.com"
                      className={cn(inputClass, "w-full text-xs")}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                    Dietary Preferences, VIP Notes, or Allergy Info
                  </label>
                  <textarea
                    rows={2}
                    value={formNotes}
                    onChange={(e) => setFormNotes(e.target.value)}
                    placeholder="e.g. Vegetarian, Prefers corner booth, VIP guest, Peanut allergy..."
                    className={cn(inputClass, "w-full text-xs resize-none py-2")}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">
                    Address / City
                  </label>
                  <input
                    type="text"
                    value={formAddress}
                    onChange={(e) => setFormAddress(e.target.value)}
                    placeholder="e.g. Bandra West, Mumbai"
                    className={cn(inputClass, "w-full text-xs")}
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-100">
                  <button
                    type="button"
                    onClick={() => setActiveModal(null)}
                    disabled={submitting}
                    className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-xs font-bold text-white hover:bg-zinc-800 cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5 text-emerald-400" />
                        <span>{activeModal.mode === "create" ? "Save Guest" : "Update Profile"}</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── VIEW GUEST DETAILS MODAL ── */}
      <AnimatePresence>
        {activeModal?.mode === "view" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl border border-zinc-200 space-y-5"
            >
              <div className="flex items-start justify-between border-b border-zinc-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-2xl bg-brand/10 text-brand flex items-center justify-center font-extrabold text-base border border-brand/20">
                    {activeModal.guest.name
                      ? activeModal.guest.name
                          .split(" ")
                          .map((p) => p[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()
                      : "G"}
                  </div>
                  <div>
                    <h4 className="text-base font-bold text-zinc-900">{activeModal.guest.name}</h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600 border border-zinc-200">
                      {activeModal.guest.guestNo}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="p-1 rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-50 border border-zinc-100">
                  <span className="text-zinc-400 font-bold uppercase text-[9px]">Phone</span>
                  <span className="font-semibold text-zinc-800">{activeModal.guest.phone || "Not provided"}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-50 border border-zinc-100">
                  <span className="text-zinc-400 font-bold uppercase text-[9px]">Email</span>
                  <span className="font-semibold text-zinc-800">{activeModal.guest.email || "Not provided"}</span>
                </div>
                <div className="p-2.5 rounded-xl bg-zinc-50 border border-zinc-100 space-y-1">
                  <span className="text-zinc-400 font-bold uppercase text-[9px] block">Preferences & Notes</span>
                  <p className="font-medium text-zinc-700 italic">
                    {activeModal.guest.notes || "No dietary preferences or special notes recorded."}
                  </p>
                </div>
                {activeModal.guest.address ? (
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-50 border border-zinc-100">
                    <span className="text-zinc-400 font-bold uppercase text-[9px]">Address</span>
                    <span className="font-semibold text-zinc-800">{activeModal.guest.address}</span>
                  </div>
                ) : null}
                <div className="grid grid-cols-3 gap-2 pt-2 text-center">
                  <div className="p-2 rounded-xl bg-zinc-50 border border-zinc-100">
                    <p className="text-[9px] font-bold text-zinc-400 uppercase">Bookings</p>
                    <p className="text-sm font-black text-zinc-900 mt-0.5">{activeModal.guest.bookingCount}</p>
                  </div>
                  <div className="p-2 rounded-xl bg-zinc-50 border border-zinc-100">
                    <p className="text-[9px] font-bold text-zinc-400 uppercase">Last Visit</p>
                    <p className="text-[11px] font-bold text-zinc-800 mt-0.5">
                      {activeModal.guest.lastBookingDate ?? "—"}
                    </p>
                  </div>
                  <div className="p-2 rounded-xl bg-zinc-50 border border-zinc-100">
                    <p className="text-[9px] font-bold text-zinc-400 uppercase">No Shows</p>
                    <p className="text-sm font-black text-amber-600 mt-0.5">{activeModal.guest.noShowCount}</p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100">
                {canOperate ? (
                  <button
                    type="button"
                    onClick={() => openEditModal(activeModal.guest)}
                    className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-4 py-2 text-xs font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit Profile
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setActiveModal(null)}
                  className="rounded-full bg-zinc-950 px-5 py-2 text-xs font-bold text-white hover:bg-zinc-800 cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── DELETE CONFIRMATION MODAL ── */}
      <AnimatePresence>
        {activeModal?.mode === "delete" && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl border border-zinc-200 space-y-4 text-center"
            >
              <div className="mx-auto h-12 w-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                <Trash2 className="h-6 w-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-zinc-900">Delete Guest Record?</h4>
                <p className="mt-1 text-xs text-zinc-500">
                  Are you sure you want to remove <span className="font-bold text-zinc-800">{activeModal.guest.name}</span> ({activeModal.guest.guestNo})? Existing reservation records will be retained.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setActiveModal(null)}
                  className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => handleDeleteGuest(activeModal.guest.id)}
                  className="flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  <span>Delete Guest</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings › Restaurant Profile — DEPRECATED interim panel.
//
// Superseded by the extracted `RestaurantProfilePanel`
// (`src/components/restaurant/RestaurantProfilePanel.tsx`), which the Settings
// shell now mounts. This local component is retained only to avoid disturbing
// the surrounding module during the shell refactor (task 6.1) and is no longer
// wired into any sub-tab. It will be removed with the profile task cleanup.
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileFormState {
  clinicName: string;
  name: string;
  phone: string;
  practiceSize: string;
  address: string;
  email: string;
  contactNo: string;
  whatsappNo: string;
  landlineNo: string;
  shortDescription: string;
  services: string;
}

const EMPTY_PROFILE: ProfileFormState = {
  clinicName: "",
  name: "",
  phone: "",
  practiceSize: "",
  address: "",
  email: "",
  contactNo: "",
  whatsappNo: "",
  landlineNo: "",
  shortDescription: "",
  services: "",
};

function LegacyRestaurantProfilePanel({
  user,
  setUser,
  permission,
  showToast,
}: {
  user: SessionUser | null;
  setUser: (update: (prev: SessionUser | null) => SessionUser | null) => void;
  permission: RestaurantPermission;
  showToast: (type: ToastKind, message: string) => void;
}) {
  const canWrite = permission === "operate";
  const [form, setForm] = useState<ProfileFormState>(EMPTY_PROFILE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Booking portal clipboard state — the same two-second "Copied" flip the five
  // category dashboards use.
  const [copiedLink, setCopiedLink] = useState(false);
  const handleCopyLink = (bookingUrl: string) => {
    navigator.clipboard.writeText(bookingUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // Profile photo upload state
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");

  const bookingUrl =
    typeof window !== "undefined" ? `${window.location.origin}/book/${user?.tenantId}` : "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getClinicProfileServerFn()
      .then((res) => {
        if (cancelled) return;
        const row = (res ?? null) as Record<string, unknown> | null;
        const text = (key: string, fallback = "") => {
          const value = row?.[key];
          return value === null || value === undefined ? fallback : String(value);
        };
        setForm({
          clinicName: text("clinicName", user?.clinicName ?? ""),
          name: text("clinicianName", user?.name ?? ""),
          phone: text("phone", user?.phone ?? ""),
          practiceSize: text("practiceSize", user?.practiceSize ?? ""),
          address: text("address"),
          email: text("email", user?.email ?? ""),
          contactNo: text("contactNo"),
          whatsappNo: text("whatsappNo"),
          landlineNo: text("landlineNo"),
          shortDescription: text("shortDescription"),
          services: text("services"),
        });
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, "Could not load the restaurant profile"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const set = useCallback(<K extends keyof ProfileFormState>(key: K, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  async function save() {
    if (!canWrite) return;
    setSaving(true);
    try {
      await updateProfileServerFn({
        data: {
          name: form.name.trim(),
          phone: form.phone.trim(),
          clinicName: form.clinicName.trim(),
          practiceSize: form.practiceSize.trim() || "Solo Practice (1 provider)",
          address: form.address.trim(),
          email: form.email.trim(),
          contactNo: form.contactNo.trim(),
          whatsappNo: form.whatsappNo.trim(),
          landlineNo: form.landlineNo.trim(),
          shortDescription: form.shortDescription.trim(),
          services: form.services.trim(),
          // Keeps the account on the restaurant branch of every shared read.
          profession: PROFESSION_RESTAURANT,
        },
      });
      showToast("success", "Restaurant profile saved");
    } catch (err) {
      showToast("error", errorText(err, "Could not save the restaurant profile"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
      </div>
    );
  }

  const fields: Array<{
    key: keyof ProfileFormState;
    label: string;
    type?: string;
    wide?: boolean;
  }> = [
    { key: "clinicName", label: "Restaurant name" },
    { key: "name", label: "Owner / manager name" },
    { key: "phone", label: "Account phone" },
    { key: "practiceSize", label: "Team size" },
    { key: "email", label: "Public email", type: "email" },
    { key: "contactNo", label: "Contact number" },
    { key: "whatsappNo", label: "WhatsApp number" },
    { key: "landlineNo", label: "Landline" },
    { key: "address", label: "Address", wide: true },
    { key: "services", label: "Cuisine / services", wide: true },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div>
        <h3 className="text-sm font-bold text-zinc-850">Restaurant profile</h3>
        <p className="mt-1 text-[10px] font-semibold text-zinc-400">
          {canWrite
            ? "The details guests see on your public booking page."
            : "Stored details, read only for your role."}
        </p>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : null}

      {/* 1. Table Booking Portal — read-only affordances, so they stay visible
             for `view_only` too (Req 2.8). */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Utensils className="h-4 w-4 text-brand" />
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            Table Booking Portal
          </h4>
        </div>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">
              Booking Form URL
            </span>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={bookingUrl}
                readOnly
                className="w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs text-zinc-750 font-semibold focus:outline-none select-all"
              />
              <button
                type="button"
                onClick={() => handleCopyLink(bookingUrl)}
                className="rounded-full bg-zinc-950 hover:bg-zinc-850 px-4 py-2 text-xs font-semibold text-white transition-all cursor-pointer inline-flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {copiedLink ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy Link
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl bg-zinc-50 border border-zinc-150">
            {user?.tenantId ? (
              <div className="bg-white p-2.5 rounded-xl border border-zinc-200 shrink-0">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(bookingUrl)}`}
                  alt="Booking QR Code"
                  className="h-24 w-24 object-contain"
                />
              </div>
            ) : (
              <div className="h-24 w-24 bg-zinc-100 rounded-xl border border-zinc-200 animate-pulse shrink-0" />
            )}
            <div className="space-y-2 text-left w-full">
              <h5 className="text-xs font-bold text-zinc-850">Table Booking QR Code</h5>
              <p className="text-[10px] text-zinc-400 leading-normal">
                Display or print this QR code in your restaurant — on the entrance, the counter, or
                the table cards. Guests can scan it with any mobile device to book a table straight
                away.
              </p>
              <div className="flex gap-2">
                <a
                  href={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(bookingUrl)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-white hover:bg-zinc-100 text-zinc-700 border border-zinc-200 text-[10px] font-bold px-3 py-1.5 transition-colors cursor-pointer inline-flex items-center gap-1"
                >
                  <ExternalLink className="h-3 w-3" /> View Large QR
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <hr className="border-zinc-105" />

      {/* 2. Profile Photo — a write control, so `view_only` never sees it. */}
      {canWrite ? (
        <>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-brand" />
              <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                Profile Photo
              </h4>
            </div>
            <div className="flex items-center gap-5">
              {/* Avatar preview */}
              <div className="relative shrink-0">
                <div className="h-20 w-20 rounded-full overflow-hidden border-2 border-zinc-200 bg-zinc-100 flex items-center justify-center">
                  {photoPreview || user?.profilePhoto ? (
                    <img
                      src={photoPreview || user?.profilePhoto || ""}
                      alt="Profile"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-xl font-black text-brand">
                      {user?.name
                        ? user.name
                            .split(" ")
                            .map((n: string) => n[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()
                        : "BM"}
                    </span>
                  )}
                </div>
                {/* Camera overlay button */}
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="absolute bottom-0 right-0 h-6 w-6 rounded-full bg-brand flex items-center justify-center shadow-md border-2 border-white hover:bg-brand-dark transition-colors cursor-pointer"
                >
                  <Camera className="h-3 w-3 text-white" />
                </button>
              </div>
              {/* Upload controls */}
              <div className="flex-1 space-y-2">
                <p className="text-xs font-semibold text-zinc-700">Upload a profile photo</p>
                <p className="text-[10px] text-zinc-400">
                  JPG, PNG or WEBP · Max 5MB · Recommended 400×400px
                </p>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 5 * 1024 * 1024) {
                      setPhotoError("File too large. Max 5MB.");
                      return;
                    }
                    setPhotoError("");
                    // Preview
                    const reader = new FileReader();
                    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
                    reader.readAsDataURL(file);
                    // Upload to Cloudinary
                    setUploadingPhoto(true);
                    try {
                      const base64 = await new Promise<string>((resolve) => {
                        const r = new FileReader();
                        r.onload = (ev) => resolve(ev.target?.result as string);
                        r.readAsDataURL(file);
                      });
                      const res = await uploadProfilePhotoServerFn({
                        data: { base64, fileName: file.name },
                      });
                      if (res.success) {
                        setUser((prev) => (prev ? { ...prev, profilePhoto: res.url } : null));
                        setPhotoPreview(null);
                        showToast("success", "Profile photo updated!");
                      }
                    } catch (err) {
                      setPhotoError(errorText(err, "Upload failed"));
                    } finally {
                      setUploadingPhoto(false);
                      if (photoInputRef.current) photoInputRef.current.value = "";
                    }
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    disabled={uploadingPhoto}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-[10px] font-bold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {uploadingPhoto ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Upload className="h-3 w-3" />
                    )}
                    {uploadingPhoto ? "Uploading…" : "Choose Photo"}
                  </button>
                  {user?.profilePhoto && !uploadingPhoto ? (
                    <button
                      type="button"
                      onClick={async () => {
                        setUploadingPhoto(true);
                        try {
                          await uploadProfilePhotoServerFn({
                            data: { base64: "", fileName: "remove" },
                          });
                        } catch {
                          /* the row is cleared locally either way, as in the five category dashboards */
                        }
                        setUser((prev) => (prev ? { ...prev, profilePhoto: null } : null));
                        setPhotoPreview(null);
                        setUploadingPhoto(false);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-500 hover:bg-red-100 cursor-pointer transition-colors"
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                  ) : null}
                </div>
                {photoError ? (
                  <p className="text-[10px] font-bold text-red-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> {photoError}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <hr className="border-zinc-105" />
        </>
      ) : null}

      {/* 3. Profile details */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-brand" />
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
            Restaurant profile details
          </h4>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className={cn("block", field.wide && "sm:col-span-2")}>
              <span className={labelClass}>{field.label}</span>
              <input
                type={field.type ?? "text"}
                value={form[field.key]}
                disabled={!canWrite}
                onChange={(e) => set(field.key, e.target.value)}
                className={inputClass}
              />
            </label>
          ))}
        </div>

        <label className="block">
          <span className={labelClass}>About this restaurant</span>
          <textarea
            rows={3}
            value={form.shortDescription}
            disabled={!canWrite}
            onChange={(e) => set("shortDescription", e.target.value)}
            className="mt-1 block w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-500"
          />
        </label>

        {canWrite ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-800 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save profile
            </button>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-400">
            <ShieldAlert className="h-3.5 w-3.5" /> Your role can view these details but not change
            them.
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings › Manage Users (gated on `users`, Req 2.6, 2.7)
// ─────────────────────────────────────────────────────────────────────────────

interface SubUserRow {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  isActive?: number | boolean | null;
}

function ManageUsersPanel({
  canOperate,
  showToast,
}: {
  canOperate: boolean;
  showToast: (type: ToastKind, message: string) => void;
}) {
  const [rows, setRows] = useState<SubUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"reception" | "doctor">("reception");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSubUsersServerFn()
      .then((res) => {
        if (!cancelled) setRows((res ?? []) as SubUserRow[]);
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, "Could not load the team"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function create() {
    if (!canOperate) return;
    setSaving(true);
    try {
      await createSubUserServerFn({
        data: { name: name.trim(), email: email.trim(), phone: phone.trim(), role, password },
      });
      showToast("success", "Team member added");
      setName("");
      setEmail("");
      setPhone("");
      setPassword("");
      setReload((n) => n + 1);
    } catch (err) {
      showToast("error", errorText(err, "Could not add the team member"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!canOperate) return;
    try {
      await deleteSubUserServerFn({ data: id });
      showToast("success", "Team member removed");
      setReload((n) => n + 1);
    } catch (err) {
      showToast("error", errorText(err, "Could not remove the team member"));
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-zinc-850">Manage users</h3>
        <p className="mt-1 text-[10px] font-semibold text-zinc-400">
          Front-of-house logins for this restaurant. Reception can manage bookings; their
          configuration access is read only.
        </p>
      </div>

      {canOperate ? (
        <div className={cn(cardClass, "space-y-4")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <span className={labelClass}>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Phone</span>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value === "doctor" ? "doctor" : "reception")}
                className={inputClass}
              >
                <option value="reception">Reception / front of house</option>
                <option value="doctor">Staff (view only bookings)</option>
              </select>
            </label>
            <label className="block">
              <span className={labelClass}>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void create()}
                disabled={saving}
                className="flex w-full items-center justify-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-800 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <UserPlus className="h-3.5 w-3.5" />
                )}
                Add member
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-10 text-center text-xs font-semibold text-zinc-400">
          No additional logins yet.
        </div>
      ) : (
        <div className="divide-y divide-zinc-150 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-xs font-bold text-zinc-800">{row.name}</p>
                <p className="text-[10px] font-semibold text-zinc-400">
                  {row.email} · {row.role}
                </p>
              </div>
              {canOperate ? (
                <button
                  type="button"
                  onClick={() => void remove(row.id)}
                  className="flex items-center gap-1.5 rounded-full border border-rose-200 px-3 py-1.5 text-[10px] font-bold text-rose-600 hover:bg-rose-50 cursor-pointer"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings shell (Req 1.1-1.9, 2.1, 7.1, 8.1, 9.1, 9.6, 9.7, 10.1, 10.2)
//
// The shell consumes the guarded `getRestaurantSettingsBootstrap` read for its
// navigation permissions, account identity, and validated branch choices, then
// renders the nine canonical sub-tabs in order through the pure navigation
// helper. It defaults to the first visible sub-tab and falls back to it for an
// invalid or absent selection, renders the unresolved-access Profile-only state,
// renders the defensive empty state, exposes an owner-only branch selector, and
// mounts exactly one panel — remounting it on a branch change so scoped dialog
// and query state reset and hidden polling panels never mount.
//
// Only `Restaurant Profile` is wired to the extracted `RestaurantProfilePanel`
// here; the remaining bodies keep the interim editors already present in this
// route (`OperatingHours`, `TableManager`, `BookingRules`, `WhatsAppAlertsSettings`,
// `MultiLocationSettings`, `ManageUsersPanel`) or a placeholder for the two new
// tabs (`Dining Areas`, `Menu`). Tasks 7.3/7.4/8.2/9.2/10.2/10.4 replace them.
// ─────────────────────────────────────────────────────────────────────────────

/** The injected bootstrap read. Defaults to the guarded server function. */
export type FetchRestaurantSettingsBootstrap = (opts?: {
  data?: { requestedTab?: string | null; requestedLocationId?: string | null };
}) => Promise<RestaurantSettingsBootstrap>;

/** A not-yet-built sub-tab body. Later tasks replace these with real editors. */
function SettingsPlaceholderPanel({ label }: { label: string }) {
  return (
    <div
      data-testid={`settings-placeholder-${label}`}
      className="rounded-2xl border border-dashed border-zinc-200 py-12 text-center"
    >
      <SettingsIcon className="mx-auto h-5 w-5 text-zinc-300" />
      <p className="mt-2 text-xs font-semibold text-zinc-400">{label} settings are coming soon.</p>
    </div>
  );
}

export function SettingsPanel({
  user,
  setUser,
  showToast,
  onGoToPlans,
  fetchBootstrap = getRestaurantSettingsBootstrapServerFn as unknown as FetchRestaurantSettingsBootstrap,
}: {
  user: SessionUser | null;
  setUser: (update: (prev: SessionUser | null) => SessionUser | null) => void;
  showToast: (type: ToastKind, message: string) => void;
  onGoToPlans: () => void;
  fetchBootstrap?: FetchRestaurantSettingsBootstrap;
}) {
  // The owner-selected branch scope. `null` is the primary (unscoped) restaurant.
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  // The requested sub-tab; reconciled against the derived visible set below.
  const [selectedTab, setSelectedTab] = useState<string | null>(null);

  const [bootstrap, setBootstrap] = useState<RestaurantSettingsBootstrap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-read the guarded bootstrap on mount and whenever the owner changes the
  // branch scope, so navigation, identity, and branch choices stay authoritative.
  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchBootstrap({ data: { requestedLocationId: selectedBranchId } })
      .then((res) => {
        if (!cancelled) setBootstrap(res);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(errorText(err, "Could not load the restaurant settings"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchBootstrap, selectedBranchId]);

  const heading = (
    <div className="border-b border-zinc-100 pb-4">
      <h3 className="text-base font-bold text-zinc-900 leading-none">
        Workspace & Restaurant Management
      </h3>
      <p className="text-[10px] text-zinc-400 mt-1.5 leading-relaxed">
        Configure your restaurant profile, operating hours, dining areas, tables, menu, booking
        rules, WhatsApp alerts, branches, and users.
      </p>
    </div>
  );

  if (loading && !bootstrap) {
    return (
      <div className="w-full space-y-6">
        {heading}
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-300" />
          <span className="sr-only">Loading the restaurant settings</span>
        </div>
      </div>
    );
  }

  if ((loadError && !bootstrap) || !bootstrap) {
    return (
      <div className="w-full space-y-6">
        {heading}
        <div
          role="alert"
          className="flex items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700"
        >
          <AlertCircle className="h-4 w-4" />{" "}
          {loadError ?? "Could not load the restaurant settings"}
        </div>
      </div>
    );
  }

  const { navigation, permissions, branchChoices } = bootstrap;
  const visibleTabs = navigation.visibleTabs;
  const configPermission = (permissions?.restaurant_config.permission ??
    "none") as RestaurantPermission;
  const canOperateUsers = permissions?.users.permission === "operate";
  const showBranchSelector = permissions?.locations.visible === true;

  // First visible tab is the default and the fallback for an invalid selection.
  const active =
    selectedTab && (visibleTabs as readonly string[]).includes(selectedTab)
      ? selectedTab
      : (visibleTabs[0] ?? null);

  // The presentation list filtered against the derived visible set and order.
  const tabs = SETTINGS_SUB_TAB_ENTRIES.filter((sub) =>
    (visibleTabs as readonly string[]).includes(sub.id),
  );
  const activeEntry = tabs.find((tab) => tab.id === active) ?? tabs[0];
  const ActiveIcon = activeEntry?.icon ?? SettingsIcon;

  // Changing the branch resets the active panel: the keyed container remounts,
  // dropping any scoped dialog/query state without touching tenant-wide surfaces.
  const branchKey = selectedBranchId ?? "primary";

  const renderBody = () => {
    switch (active) {
      case "Restaurant Profile":
        return <RestaurantProfilePanel requestedLocationId={selectedBranchId} />;
      case "Operating Hours":
        return (
          <OperatingHours permission={configPermission} requestedLocationId={selectedBranchId} />
        );
      case "Dining Areas":
        return (
          <DiningAreasSettings
            permission={configPermission}
            requestedLocationId={selectedBranchId}
          />
        );
      case "Tables":
        return <TableManager permission={configPermission} locationId={selectedBranchId} />;
      case "Menu":
        return (
          <MenuSettings permission={configPermission} requestedLocationId={selectedBranchId} />
        );
      case "Booking Rules":
        return <BookingRules permission={configPermission} />;
      case "WhatsApp Alerts":
        return (
          <WhatsAppAlertsSettings requestedLocationId={selectedBranchId} showToast={showToast} />
        );
      case "Multi Location":
        return (
          <RestaurantBranchSettings
            permission={(permissions?.locations.permission ?? "none") as RestaurantPermission}
            requestedLocationId={selectedBranchId}
            onUpgrade={onGoToPlans}
          />
        );
      case "Manage Users":
        return (
          <RestaurantUsersSettings
            permission={(permissions?.users.permission ?? "none") as RestaurantPermission}
            requestedLocationId={selectedBranchId}
            onUpgrade={onGoToPlans}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full space-y-6 transition-all duration-300">
      {heading}

      {/* Req 1.9 — unresolved feature access surfaces the documented message. */}
      {navigation.message ? (
        <div
          role="status"
          data-testid="settings-access-message"
          className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-800"
        >
          <ShieldAlert className="h-4 w-4" /> {navigation.message}
        </div>
      ) : null}

      {visibleTabs.length === 0 ? (
        // Req 1.8 — defensive empty state: no selector and no body.
        <div
          data-testid="settings-empty-state"
          className="rounded-2xl border border-dashed border-zinc-200 py-12 text-center"
        >
          <ShieldAlert className="mx-auto h-5 w-5 text-zinc-300" />
          <p className="mt-2 text-xs font-semibold text-zinc-400">{MSG_NO_RESTAURANT_SETTINGS}</p>
        </div>
      ) : (
        <>
          {/* Owner-only branch selector (Req 9.6, 9.7). */}
          {showBranchSelector ? (
            <div className="flex flex-col gap-1 sm:max-w-xs">
              <label
                htmlFor="settings-branch-select"
                className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1"
              >
                Branch
              </label>
              <select
                id="settings-branch-select"
                data-testid="settings-branch-select"
                value={selectedBranchId ?? ""}
                onChange={(e) => setSelectedBranchId(e.target.value ? e.target.value : null)}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none"
              >
                <option value="">Primary location</option>
                {branchChoices.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                    {branch.isActive ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Req 1.4 — Compact_Viewport single-select dropdown. */}
          <div className="md:hidden">
            <label htmlFor="settings-subtab-select" className="sr-only">
              Settings section
            </label>
            <div className="relative">
              <ActiveIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand" />
              <select
                id="settings-subtab-select"
                data-testid="settings-subtab-select"
                value={active ?? ""}
                onChange={(e) => setSelectedTab(e.target.value)}
                className="w-full appearance-none rounded-xl border border-zinc-200 bg-white pl-9 pr-4 py-2.5 text-xs font-bold uppercase tracking-wider text-zinc-800 shadow-sm focus:border-brand focus:outline-none cursor-pointer"
              >
                {tabs.map((tab) => (
                  <option key={tab.id} value={tab.id}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Req 1.5 — horizontal bar at 768 px and above. */}
          <div
            role="tablist"
            aria-label="Restaurant settings sections"
            className="hidden md:flex pb-2 gap-4 scrollbar-none border-b border-zinc-150"
          >
            {tabs.map((sub) => {
              const isActive = active === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-current={isActive ? "page" : undefined}
                  data-testid={`settings-subtab-${sub.id}`}
                  onClick={() => setSelectedTab(sub.id)}
                  className={`text-[10px] font-extrabold px-0 py-0 pb-2 border-b-2 transition-all whitespace-nowrap cursor-pointer uppercase tracking-wider ${
                    isActive
                      ? "text-zinc-900 border-zinc-900"
                      : "text-zinc-400 border-transparent hover:text-zinc-600"
                  }`}
                >
                  {sub.label}
                </button>
              );
            })}
          </div>

          {/* Req 1.6, 10.2 — exactly one panel is mounted; a branch change
              remounts it via the scoped key so its state resets. */}
          <div
            key={`${active}-${branchKey}`}
            data-testid="settings-active-panel"
            data-active-tab={active ?? ""}
          >
            {renderBody()}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Manage Plans (gated on `plans`, Req 2.6, 2.7)
//
// The tab body is the shared `ManagePlansPanel`, which carries the same billing
// experience as the five category dashboards: the plan/renewal/payment-method
// summary, the plan tier cards, the Cashfree AutoPay mandate checkout, the
// one-time order checkout, the subscription ledger and the invoiced payment
// history. It stays plan-gated by `deriveRestaurantNavigation` — this component
// only renders when `plans` resolves visible.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// The shell (Req 2.1-2.4, 2.10, 2.11)
// ─────────────────────────────────────────────────────────────────────────────

function RestaurantDashboardPage() {
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<string>("Overview");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const [user, setUser] = useState<SessionUser | null>(null);
  const [guard, setGuard] = useState<RestaurantGuardDecision | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [walkInOpen, setWalkInOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const profileDropdownRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((type: ToastKind, message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // Restore the last active tab, with a ?tab= param taking precedence — the same
  // convention, and the same `bmt_active_tab` key, as the five category shells.
  useEffect(() => {
    setIsClient(true);
    try {
      const valid = DASHBOARD_TAB_ORDER as readonly string[];
      const fromUrl = new URLSearchParams(window.location.search).get("tab");
      const stored = window.localStorage.getItem("bmt_active_tab");
      const restore =
        fromUrl && valid.includes(fromUrl)
          ? fromUrl
          : stored && valid.includes(stored)
            ? stored
            : null;
      if (restore) setActiveTab(restore);
    } catch {
      /* ignore storage/URL access errors */
    }
  }, []);

  useEffect(() => {
    if (!isClient) return;
    try {
      window.localStorage.setItem("bmt_active_tab", activeTab);
    } catch {
      /* ignore storage errors */
    }
  }, [activeTab, isClient]);

  // ── The mount guard (Req 2.1, 2.2, 2.3) ────────────────────────────────────
  // No account → `/login`. A non-restaurant profession, including absent and
  // empty, → `/dashboard`. Only `render` reaches any dashboard content.
  useEffect(() => {
    getCurrentUserServerFn()
      .then((res) => {
        const account = (res ?? null) as SessionUser | null;
        const decision = restaurantGuardDecision({
          hasAccount: Boolean(account),
          profession: account?.profession ?? null,
        });
        setGuard(decision);
        if (decision === "login") {
          navigate({ to: "/login" });
        } else if (decision === "dashboard") {
          navigate({ to: "/dashboard" });
        } else {
          setUser(account);
        }
      })
      .catch(() => {
        setGuard("login");
        navigate({ to: "/login" });
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, [navigate]);

  // Close profile dropdown on outside click
  useEffect(() => {
    if (!profileDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (profileDropdownRef.current && !profileDropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileDropdownOpen]);

  // Feature access resolved once from the session. `null` means it could not be
  // resolved, which `deriveRestaurantNavigation` turns into the core-only
  // navigation plus the documented message (Req 2.10).
  const featureAccess = useMemo<ResolvedAccessLike | null>(() => {
    if (!user) return null;
    try {
      return resolveFeatureAccess({
        role: (user.role ?? "admin") as "admin" | "reception" | "doctor" | "location",
        profession: user.profession ?? null,
        subscriptionPlan: user.subscriptionPlan ?? null,
        subscriptionStatus: user.subscriptionStatus ?? null,
        subscriptionExpiresAt: user.subscriptionExpiresAt ?? null,
        isActive: true,
      }) as ResolvedAccessLike;
    } catch {
      return null;
    }
  }, [user]);

  const navigation = useMemo<RestaurantNavigation>(
    () => deriveRestaurantNavigation({ access: featureAccess, requestedTab: activeTab }),
    [featureAccess, activeTab],
  );

  // Req 2.11 — a requested tab that is not visible renders `Overview`.
  const effectiveTab = navigation.effectiveTab;

  const handleLogout = useCallback(async () => {
    try {
      if (typeof window !== "undefined") {
        localStorage.removeItem("bmt_active_tab");
        localStorage.removeItem("bmt_admin_active_tab");
      }
      await logoutServerFn();
      navigate({ to: "/login" });
    } catch (err) {
      showToast("error", errorText(err, "Could not sign out"));
    }
  }, [navigate, showToast]);

  const openWalkIn = useCallback(() => {
    setActiveTab("Bookings List");
    setWalkInOpen(true);
  }, []);

  // Re-reads the session after a payment or an AutoPay mandate is verified, so
  // the plan-derived gating recomputes from the new subscription.
  const refreshSessionUser = useCallback(async () => {
    try {
      const res = await getCurrentUserServerFn();
      if (res) setUser(res as SessionUser);
    } catch {
      /* non-fatal: the billing panel already confirms the outcome */
    }
  }, []);

  // ── Nothing renders until the guard resolves to `render` ────────────────────
  if (checkingAuth) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-200 border-t-brand" />
      </div>
    );
  }
  if (guard !== "render" || !user) return null;

  const navEntries = navigation.tabs;

  const renderTab = () => {
    switch (effectiveTab) {
      case "Calendar":
        return <CalendarPanel />;
      case "Bookings List":
        return (
          <BookingsListPanel
            bookingsPermission={navigation.bookingsPermission}
            tenantId={user.tenantId ?? ""}
            walkInOpen={walkInOpen}
            onWalkInOpenChange={setWalkInOpen}
            showToast={showToast}
          />
        );
      case "Guests":
        return (
          <GuestsPanel
            canOperate={navigation.canWriteBookings}
            showToast={showToast}
          />
        );
      case "WhatsApp":
        return (
          <WhatsAppHub
            user={user}
            showToast={showToast}
            setConfirmDialog={setConfirmDialog}
            canOperate={featureAccess?.whatsapp?.permission === "operate"}
          />
        );
      case "Settings":
        return (
          <SettingsPanel
            user={user}
            setUser={setUser}
            showToast={showToast}
            onGoToPlans={() => setActiveTab("Manage Plans")}
          />
        );
      case "Manage Plans":
        return (
          <ManagePlansPanel
            user={user}
            showToast={showToast}
            permission={(featureAccess?.plans?.permission ?? "none") as RestaurantPermission}
            returnTabParam="Manage Plans"
            onAccountRefresh={refreshSessionUser}
          />
        );
      default:
        return (
          <OverviewPanel
            onOpenWalkIn={openWalkIn}
            canOperateBookings={navigation.canWriteBookings}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
        );
    }
  };

  // ── Shell chrome, identical in structure to the five category dashboards ────
  const roleLabel =
    user.role === "admin"
      ? "Restaurant Admin"
      : user.role === "location"
        ? "Branch Account"
        : user.role === "reception"
          ? "Front of House"
          : "Staff";

  const initials = user.name
    ? user.name
        .split(" ")
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "BM";

  const signOutButton = (onBefore?: () => void) => (
    <button
      type="button"
      onClick={() => {
        onBefore?.();
        void handleLogout();
      }}
      className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold hover:bg-red-50 cursor-pointer text-red-600 transition-colors"
    >
      <LogOut className="h-4 w-4" />
      Sign Out
    </button>
  );

  const navButton = (tab: string, onNavigate: () => void) => {
    const Icon = NAV_ICONS[tab] ?? LayoutDashboard;
    const on = effectiveTab === tab;
    return (
      <button
        key={tab}
        type="button"
        onClick={onNavigate}
        className={cn(
          "flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-xs font-semibold transition-all duration-250 cursor-pointer active:scale-[0.98]",
          on ? "bg-zinc-950 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800",
        )}
      >
        <Icon className={cn("h-4 w-4", on ? "text-white" : "text-zinc-400")} />
        <span>{tab}</span>
      </button>
    );
  };

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-zinc-50 font-sans text-zinc-900">
      {/* Mobile Drawer (Sidebar Overlay) */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 z-50 bg-zinc-950 backdrop-blur-sm md:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 z-[55] flex w-72 flex-col justify-between border-r border-zinc-200 bg-white p-5 shadow-2xl md:hidden"
            >
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center px-4">
                    <img
                      src={bmtLogo}
                      alt="BookMyTime Logo"
                      className="h-14 w-auto object-contain"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsMobileMenuOpen(false)}
                    aria-label="Close the menu"
                    className="cursor-pointer rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600"
                  >
                    <X className="h-4.5 w-4.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2 rounded-2xl border border-zinc-200/60 bg-zinc-50 p-3">
                  <Utensils className="h-4 w-4 shrink-0 text-brand" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-zinc-800">
                      {user.clinicName || "Your restaurant"}
                    </p>
                    <p className="truncate text-[10px] font-semibold text-zinc-400">
                      {user.locationName || "Primary location"}
                    </p>
                  </div>
                </div>

                <nav className="space-y-1">
                  {navEntries.map((tab) =>
                    navButton(tab, () => {
                      setActiveTab(tab);
                      setIsMobileMenuOpen(false);
                    }),
                  )}
                </nav>
              </div>

              {/* Sidebar Footer */}
              <div className="space-y-3">
                <HelpSupportCard />
                {signOutButton(() => setIsMobileMenuOpen(false))}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* ──────────────────────────────────────────────
          1. Sidebar Navigation Layout
          ────────────────────────────────────────────── */}
      <aside className="hidden w-64 shrink-0 flex-col justify-between border-r border-zinc-200 bg-white p-4 md:flex">
        <div className="space-y-6">
          {/* Brand Logo Header */}
          <div className="flex items-center px-4">
            <img src={bmtLogo} alt="BookMyTime Logo" className="h-14 w-auto object-contain" />
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-zinc-200/60 bg-zinc-50 p-3">
            <Utensils className="h-4 w-4 shrink-0 text-brand" />
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-zinc-800">
                {user.clinicName || "Your restaurant"}
              </p>
              <p className="truncate text-[10px] font-semibold text-zinc-400">
                {user.locationName || "Primary location"}
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            {navEntries.map((tab) => navButton(tab, () => setActiveTab(tab)))}
          </nav>
        </div>

        {/* Sidebar Footer */}
        <div className="space-y-3">
          <HelpSupportCard />
          {signOutButton()}
        </div>
      </aside>

      {/* ──────────────────────────────────────────────
          2. Main Content Workspace Area
          ────────────────────────────────────────────── */}
      <main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        {/* Header Strip */}
        <header className="h-16 border-b border-zinc-200 bg-white px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Mobile Menu Button */}
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="Open the menu"
              className="md:hidden p-1.5 rounded-xl border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 cursor-pointer active:scale-95 transition-all"
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
          </div>

          {/* Right side — profile dropdown */}
          <div className="flex items-center gap-2.5">
            {/* Profile pill with dropdown */}
            <div className="relative" ref={profileDropdownRef}>
              <button
                type="button"
                onClick={() => setProfileDropdownOpen((v) => !v)}
                className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 px-2.5 py-1.5 transition-colors cursor-pointer group"
              >
                {/* Avatar */}
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-[11px] font-black shrink-0 overflow-hidden"
                  style={{
                    background: user.profilePhoto
                      ? "transparent"
                      : "linear-gradient(135deg, #14b8a6 0%, #6366f1 100%)",
                  }}
                >
                  {user.profilePhoto ? (
                    <img
                      src={user.profilePhoto}
                      alt={user.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initials
                  )}
                </div>
                {/* Name + role */}
                <div className="text-left hidden sm:block">
                  <p className="text-xs font-bold text-zinc-900 leading-tight truncate max-w-[120px]">
                    {user.name || "Restaurant"}
                  </p>
                  <p className="text-[10px] text-zinc-400 leading-tight truncate max-w-[120px]">
                    {roleLabel}
                  </p>
                </div>
                <ChevronDown className={`h-3.5 w-3.5 text-zinc-400 hidden sm:block transition-transform duration-200 ${profileDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Profile Dropdown Menu */}
              <AnimatePresence>
                {profileDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 rounded-xl border border-zinc-200 bg-white shadow-lg overflow-hidden"
                  >
                    {/* User info header */}
                    <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50/50">
                      <p className="text-xs font-bold text-zinc-900 truncate">
                        {user?.name || "Restaurant"}
                      </p>
                      <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                        {user?.email || ""}
                      </p>
                    </div>
                    {/* Menu items */}
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab("Settings");
                          setProfileDropdownOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
                      >
                        <SettingsIcon className="h-3.5 w-3.5 text-zinc-400" />
                        Settings
                      </button>
                      <div className="border-t border-zinc-100 mx-2" />
                      <button
                        type="button"
                        onClick={() => {
                          setProfileDropdownOpen(false);
                          void handleLogout();
                        }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                      >
                        <LogOut className="h-3.5 w-3.5" />
                        Log Out
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Tab Content Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-6">
          {/* Req 2.10 — unresolved feature access renders the core entries only. */}
          {!navigation.accessResolved ? (
            <div className="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-800">
              <ShieldAlert className="h-4 w-4" />{" "}
              {navigation.message ?? MSG_FEATURE_ACCESS_UNRESOLVED}
            </div>
          ) : null}

          {renderTab()}
        </div>

        {/* Mobile Bottom Navigation Bar — core entries only, never gated. */}
        <nav className="z-40 flex h-16 shrink-0 select-none items-center justify-around border-t border-zinc-200 bg-white px-2 pb-safe md:hidden">
          {MOBILE_BAR_ENTRIES.map((tab) => {
            const Icon = NAV_ICONS[tab] ?? LayoutDashboard;
            const on = effectiveTab === tab;
            return (
              <button
                type="button"
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex h-full flex-1 cursor-pointer flex-col items-center justify-center py-1 text-[9px] font-bold transition-all active:scale-95",
                  on ? "text-brand" : "text-zinc-400 hover:text-zinc-655",
                )}
              >
                <Icon
                  className={cn(
                    "mb-1 h-4.5 w-4.5",
                    on ? "text-brand animate-pulse" : "text-zinc-400",
                  )}
                />
                <span>{tab}</span>
              </button>
            );
          })}
        </nav>
      </main>

      {/* Confirmation dialog, shared with `WhatsAppHub` */}
      {confirmDialog?.open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={() => setConfirmDialog(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-[1.75rem] border border-zinc-200/60 bg-white p-5 shadow-2xl">
            <h3 className="text-sm font-bold text-zinc-850">{confirmDialog.title}</h3>
            <p className="mt-2 text-xs font-semibold text-zinc-500">{confirmDialog.message}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDialog(null)}
                className="cursor-pointer rounded-full border border-zinc-200 px-4 py-2 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const run = confirmDialog.onConfirm;
                  setConfirmDialog(null);
                  run();
                }}
                className="cursor-pointer rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold text-white hover:bg-zinc-800"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex w-[min(24rem,92vw)] -translate-x-1/2 flex-col gap-2 md:bottom-6">
        <AnimatePresence>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              className={cn(
                "pointer-events-auto flex items-center gap-2 rounded-2xl border px-4 py-3 text-xs font-semibold shadow-sm",
                toast.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : toast.type === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-700"
                    : "border-zinc-200 bg-white text-zinc-700",
              )}
            >
              {toast.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : toast.type === "error" ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <Building2 className="h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0">{toast.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
