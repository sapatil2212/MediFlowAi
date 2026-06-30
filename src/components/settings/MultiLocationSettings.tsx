import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  MapPin,
  Plus,
  Loader2,
  Check,
  X,
  Edit3,
  Trash2,
  Power,
  Info,
  AlertCircle,
  CheckCircle2,
  Lock,
  Eye,
  Mail,
  Phone,
  Building2,
  UserCog,
  Search,
} from "lucide-react";
import {
  getLocationsServerFn,
  getLocationLimitsServerFn,
  createLocationServerFn,
  updateLocationServerFn,
  deleteLocationServerFn,
} from "../../lib/auth";

interface LocationRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  managerName: string | null;
  isActive: number;
  createdAt: string;
}

interface LocationLimits {
  plan: string;
  tier: "basic" | "premium" | "enterprise";
  count: number;
  max: number | null;
}

interface MultiLocationSettingsProps {
  user: any;
  onSwitchToPlans?: () => void;
  professionLabels?: {
    sectionTitle?: string;
    sectionDescription?: string;
    singular?: string;
    plural?: string;
  };
}

const defaultLabels = {
  sectionTitle: "Multi-Location Branches",
  sectionDescription: "Create separate login credentials for each location/branch. Each location can log in with its own email and password to access the workspace dashboard.",
  singular: "Location",
  plural: "Locations",
};

function getDisplayPlan(plan: string | undefined | null): string {
  if (!plan || plan === "Trial" || plan === "Solo") return "Basic";
  if (plan === "Clinic") return "Premium";
  if (plan === "Hospital" || plan === "Custom") return "Enterprise";
  return plan;
}

function getPlanInfoText(limits: LocationLimits | null): string {
  if (!limits) return "";
  if (limits.tier === "basic") return "Multi-Location is not available on the Basic plan. Upgrade to Premium or Enterprise to add branches.";
  if (limits.tier === "premium") return "Premium plan allows up to 1 sub-location. Upgrade to Enterprise for unlimited locations.";
  return "Enterprise plan allows unlimited locations.";
}

export default function MultiLocationSettings({
  user,
  onSwitchToPlans,
  professionLabels,
}: MultiLocationSettingsProps) {
  const labels = { ...defaultLabels, ...(professionLabels || {}) };

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [limits, setLimits] = useState<LocationLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    managerName: "",
    password: "",
    confirmPassword: "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [viewing, setViewing] = useState<LocationRow | null>(null);
  const [toDelete, setToDelete] = useState<LocationRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAdmin = user?.role === "admin";

  const refresh = async () => {
    setLoading(true);
    try {
      const [locs, lims] = await Promise.all([
        getLocationsServerFn(),
        getLocationLimitsServerFn(),
      ]);
      setLocations(locs as LocationRow[]);
      setLimits(lims as LocationLimits);
    } catch (e) {
      console.error("Failed to load locations:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) refresh();
    else setLoading(false);
  }, [isAdmin]);

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      pincode: "",
      managerName: "",
      password: "",
      confirmPassword: "",
    });
    setEditing(null);
    setErrorMsg("");
    setSuccessMsg("");
    setShowPwd(false);
  };

  const startCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const startEdit = (loc: LocationRow) => {
    setEditing(loc);
    setForm({
      name: loc.name,
      email: loc.email,
      phone: loc.phone || "",
      address: loc.address || "",
      city: loc.city || "",
      state: loc.state || "",
      pincode: loc.pincode || "",
      managerName: loc.managerName || "",
      password: "",
      confirmPassword: "",
    });
    setErrorMsg("");
    setSuccessMsg("");
    setShowPwd(false);
    setShowForm(true);
  };

  const handleSave = async () => {
    setErrorMsg("");
    setSuccessMsg("");

    if (!form.name.trim()) { setErrorMsg("Location name is required"); return; }
    if (!editing) {
      if (!form.email.trim()) { setErrorMsg("Login email is required"); return; }
      if (!/\S+@\S+\.\S+/.test(form.email)) { setErrorMsg("Please enter a valid login email address"); return; }
      if (!form.password) { setErrorMsg("Password is required"); return; }
    }
    if (form.password && form.password.length < 8) { setErrorMsg("Password must be at least 8 characters"); return; }
    if (form.password && form.password !== form.confirmPassword) { setErrorMsg("Passwords do not match"); return; }

    setSaving(true);
    try {
      if (editing) {
        await updateLocationServerFn({
          data: {
            id: editing.id,
            name: form.name,
            phone: form.phone,
            address: form.address,
            city: form.city,
            state: form.state,
            pincode: form.pincode,
            managerName: form.managerName,
            password: form.password || undefined,
          },
        });
        setSuccessMsg("Location updated successfully");
      } else {
        await createLocationServerFn({
          data: {
            name: form.name,
            email: form.email,
            password: form.password,
            phone: form.phone,
            address: form.address,
            city: form.city,
            state: form.state,
            pincode: form.pincode,
            managerName: form.managerName,
          },
        });
        setSuccessMsg("Location created successfully");
      }
      await refresh();
      setTimeout(() => {
        setShowForm(false);
        resetForm();
      }, 900);
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to save location");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (loc: LocationRow) => {
    try {
      await updateLocationServerFn({
        data: { id: loc.id, isActive: loc.isActive ? 0 : 1 },
      });
      await refresh();
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to update status");
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteLocationServerFn({ data: toDelete.id });
      setToDelete(null);
      await refresh();
    } catch (e: any) {
      setErrorMsg(e.message || "Failed to delete location");
    } finally {
      setDeleting(false);
    }
  };

  const filteredLocations = search.trim()
    ? locations.filter((l) =>
        [l.name, l.email, l.city, l.managerName]
          .filter(Boolean)
          .some((s) => (s as string).toLowerCase().includes(search.toLowerCase()))
      )
    : locations;

  const displayPlan = getDisplayPlan(user?.subscriptionPlan);
  const reachedLimit = !!limits && limits.max !== null && limits.count >= limits.max;
  const planAllows = !!limits && limits.tier !== "basic";

  // Non-admin view
  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center space-y-2 animate-in fade-in duration-300">
        <MapPin className="h-8 w-8 text-zinc-200 mx-auto" />
        <p className="text-xs font-bold text-zinc-500">Admin access required</p>
        <p className="text-[10px] text-zinc-400">Only the workspace admin can manage locations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-brand" />
          <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">{labels.sectionTitle}</h4>
        </div>
        <button
          type="button"
          onClick={startCreate}
          disabled={!planAllows || reachedLimit}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-black text-white px-4 py-2 text-[10px] font-bold hover:bg-black/90 cursor-pointer transition-all disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed"
        >
          <Plus className="h-3 w-3" /> Add Location
        </button>
      </div>

      {/* Description */}
      <p className="text-[11px] text-zinc-500 leading-relaxed">{labels.sectionDescription}</p>

      {/* Plan info banner */}
      {limits && (
        <div
          className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-2xl border p-3.5 text-[11px] ${
            limits.tier === "basic"
              ? "border-amber-200 bg-amber-50"
              : reachedLimit
                ? "border-amber-200 bg-amber-50"
                : "border-brand/15 bg-brand/5"
          }`}
        >
          <div className="flex items-start gap-2">
            <Info
              className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${
                limits.tier === "basic" || reachedLimit ? "text-amber-600" : "text-brand"
              }`}
            />
            <div className="space-y-0.5">
              <p className="font-bold text-zinc-700">
                Current plan: <span className="text-brand">{displayPlan}</span>
                {limits.max !== null && (
                  <span className="text-zinc-500 font-semibold">
                    {" "}— {limits.count} of {limits.max} location{limits.max === 1 ? "" : "s"} used
                  </span>
                )}
                {limits.max === null && (
                  <span className="text-zinc-500 font-semibold"> — unlimited locations</span>
                )}
              </p>
              <p className="text-zinc-500 leading-relaxed">{getPlanInfoText(limits)}</p>
            </div>
          </div>
          {(limits.tier === "basic" || (reachedLimit && limits.tier === "premium")) && onSwitchToPlans && (
            <button
              type="button"
              onClick={onSwitchToPlans}
              className="shrink-0 rounded-full bg-amber-500 hover:bg-amber-600 text-white px-3.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer shadow-sm active:scale-[0.98]"
            >
              Upgrade Plan
            </button>
          )}
        </div>
      )}

      {/* Create / Edit form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="rounded-2xl border border-zinc-200 bg-white p-5 space-y-4"
          >
            <h5 className="text-xs font-bold text-zinc-800 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-brand" />
              {editing ? `Edit ${labels.singular}` : `Create New ${labels.singular}`}
            </h5>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">{labels.singular} Name *</span>
                <input
                  type="text"
                  value={form.name}
                  placeholder="e.g. Andheri West Branch"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Login Email *</span>
                <input
                  type="email"
                  value={form.email}
                  placeholder="branch@example.com"
                  disabled={!!editing}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all disabled:opacity-60"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Phone (optional)</span>
                <input
                  type="tel"
                  value={form.phone}
                  placeholder="+91 9876543210"
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Manager Name (optional)</span>
                <input
                  type="text"
                  value={form.managerName}
                  placeholder="Branch manager full name"
                  onChange={(e) => setForm((f) => ({ ...f, managerName: e.target.value }))}
                  className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Address</span>
                <input
                  type="text"
                  value={form.address}
                  placeholder="Street, area, landmark"
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">City</span>
                <input
                  type="text"
                  value={form.city}
                  placeholder="Mumbai"
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">State</span>
                  <input
                    type="text"
                    value={form.state}
                    placeholder="MH"
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                    className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">Pincode</span>
                  <input
                    type="text"
                    value={form.pincode}
                    placeholder="400053"
                    onChange={(e) => setForm((f) => ({ ...f, pincode: e.target.value }))}
                    className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all"
                  />
                </label>
              </div>
              <label className="block relative">
                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">
                  {editing ? "New Password (leave blank to keep)" : "Password *"}
                </span>
                <input
                  type={showPwd ? "text" : "password"}
                  value={form.password}
                  placeholder={editing ? "Leave blank to keep current" : "Min 8 characters"}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 pr-10 text-xs font-semibold focus:outline-none focus:border-brand transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-7 text-zinc-400 hover:text-zinc-600 cursor-pointer"
                >
                  <Lock className="h-3.5 w-3.5" />
                </button>
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-zinc-400 uppercase pl-1">
                  Confirm Password{!editing ? " *" : ""}
                </span>
                <input
                  type={showPwd ? "text" : "password"}
                  value={form.confirmPassword}
                  placeholder="Re-enter password"
                  onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                  className="mt-1 w-full rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold focus:outline-none focus:border-brand transition-all"
                />
              </label>
            </div>

            {errorMsg && (
              <div className="rounded-2xl bg-red-50 border border-red-100 p-3.5 text-[11px] font-bold text-red-700 text-left space-y-2 flex flex-col items-start w-full">
                <div className="flex items-center gap-1.5 text-red-800">
                  <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
                  <span>{errorMsg.toLowerCase().includes("upgrade") || errorMsg.toLowerCase().includes("plan") ? "Plan Restriction" : "Error"}</span>
                </div>
                <p className="leading-relaxed font-medium">{errorMsg}</p>
                {errorMsg.toLowerCase().includes("upgrade") && onSwitchToPlans && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      onSwitchToPlans();
                    }}
                    className="rounded-full bg-red-600 hover:bg-red-700 text-white px-3.5 py-1.5 text-[10px] font-bold transition-all cursor-pointer shadow-sm active:scale-[0.98]"
                  >
                    Upgrade Plan Now
                  </button>
                )}
              </div>
            )}
            {successMsg && (
              <div className="rounded-full bg-emerald-50 border border-emerald-100 px-4 py-2 text-[10px] font-bold text-emerald-600 flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {successMsg}
              </div>
            )}

            <div className="flex gap-2 justify-end pt-1 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="rounded-full border border-zinc-200 px-5 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="rounded-full bg-black text-white px-5 py-2 text-xs font-bold hover:bg-black/90 disabled:opacity-60 cursor-pointer flex items-center gap-1.5"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {editing ? `Update ${labels.singular}` : `Create ${labels.singular}`}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search bar (only when at least one location exists) */}
      {!loading && locations.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
          <input
            type="text"
            placeholder="Search locations by name, email, city, manager..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-full border border-zinc-200 bg-white pl-10 pr-4 py-2 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-brand focus:outline-none transition-all"
          />
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-10 gap-2 text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading locations...
        </div>
      ) : locations.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center space-y-2">
          <MapPin className="h-8 w-8 text-zinc-200 mx-auto" />
          <p className="text-xs font-bold text-zinc-400">No locations yet</p>
          <p className="text-[10px] text-zinc-300">
            {limits?.tier === "basic"
              ? "Upgrade to Premium or Enterprise to add locations."
              : 'Click "Add Location" to create a new branch with its own login.'}
          </p>
        </div>
      ) : filteredLocations.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center space-y-2">
          <Search className="h-7 w-7 text-zinc-200 mx-auto" />
          <p className="text-xs font-bold text-zinc-400">No locations match "{search}"</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50">
                <th className="px-4 py-3 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Location</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider hidden sm:table-cell">Login</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider hidden lg:table-cell">City</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-zinc-400 uppercase tracking-wider hidden md:table-cell">Status</th>
                <th className="px-4 py-3 text-center text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {filteredLocations.map((loc) => (
                <tr key={loc.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full flex items-center justify-center text-white text-[9px] font-black shrink-0 bg-gradient-to-br from-brand to-brand-light">
                        <MapPin className="h-3 w-3" />
                      </div>
                      <div className="min-w-0">
                        <span className="block font-semibold text-zinc-800 truncate max-w-[160px]">{loc.name}</span>
                        {loc.managerName && (
                          <span className="block text-[9px] text-zinc-400 font-normal truncate max-w-[160px]">
                            Manager: {loc.managerName}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="text-zinc-500 truncate max-w-[180px] block">{loc.email}</span>
                    {loc.phone && <span className="text-zinc-400 text-[10px] block">{loc.phone}</span>}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <span className="text-zinc-500">{loc.city || "—"}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                        loc.isActive ? "bg-emerald-50 text-emerald-600" : "bg-zinc-100 text-zinc-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${loc.isActive ? "bg-emerald-500" : "bg-zinc-300"}`} />
                      {loc.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        onClick={() => setViewing(loc)}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-brand transition-colors cursor-pointer"
                        title="View"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(loc)}
                        className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-indigo-600 transition-colors cursor-pointer"
                        title="Edit"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(loc)}
                        className={`p-1.5 rounded-lg hover:bg-zinc-100 transition-colors cursor-pointer ${
                          loc.isActive ? "text-emerald-600" : "text-zinc-400"
                        }`}
                        title={loc.isActive ? "Deactivate" : "Activate"}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setToDelete(loc)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-600 transition-colors cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* View Location Modal */}
      <AnimatePresence>
        {viewing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm"
            onClick={() => setViewing(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-zinc-200 overflow-hidden"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-brand" />
                  <h3 className="text-sm font-bold text-zinc-900">Location Details</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setViewing(null)}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-400 transition-colors cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-6 py-5 space-y-5">
                <div className="flex items-center gap-4">
                  <div className="h-14 w-14 rounded-full flex items-center justify-center text-white shrink-0 bg-gradient-to-br from-brand to-brand-light">
                    <MapPin className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-900 truncate">{viewing.name}</p>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border mt-1 ${
                        viewing.isActive
                          ? "bg-emerald-50 border-emerald-100 text-emerald-700"
                          : "bg-zinc-50 border-zinc-100 text-zinc-500"
                      }`}
                    >
                      <Power className="h-2.5 w-2.5" />
                      {viewing.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl bg-zinc-50 border border-zinc-100 divide-y divide-zinc-100">
                  {[
                    { label: "Email", value: viewing.email, icon: Mail },
                    { label: "Phone", value: viewing.phone || "—", icon: Phone },
                    { label: "Manager", value: viewing.managerName || "—", icon: UserCog },
                    { label: "Address", value: viewing.address || "—", icon: MapPin },
                    { label: "City / State", value: [viewing.city, viewing.state].filter(Boolean).join(", ") || "—", icon: Building2 },
                    { label: "Pincode", value: viewing.pincode || "—", icon: Info },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="flex items-start gap-3 px-4 py-2.5">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400 mt-0.5" />
                      <span className="text-[10px] font-bold text-zinc-400 w-20 shrink-0 pt-px">{label}</span>
                      <span className="text-xs font-semibold text-zinc-700 break-words">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-6 py-3 border-t border-zinc-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setViewing(null)}
                  className="rounded-full border border-zinc-200 px-5 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const loc = viewing;
                    setViewing(null);
                    if (loc) startEdit(loc);
                  }}
                  className="rounded-full bg-black text-white px-5 py-2 text-xs font-bold hover:bg-black/90 cursor-pointer flex items-center gap-1.5"
                >
                  <Edit3 className="h-3 w-3" /> Edit
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {toDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-950/40 backdrop-blur-sm"
            onClick={() => !deleting && setToDelete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-zinc-200 overflow-hidden"
            >
              <div className="px-6 py-5 space-y-4 text-center">
                <div className="h-12 w-12 rounded-full bg-red-50 border border-red-100 flex items-center justify-center mx-auto text-red-600">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-zinc-900">Delete Location?</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    This will permanently remove <strong className="text-zinc-800">{toDelete.name}</strong> and its login credentials. This action cannot be undone.
                  </p>
                </div>
              </div>
              <div className="px-6 py-3 border-t border-zinc-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setToDelete(null)}
                  disabled={deleting}
                  className="rounded-full border border-zinc-200 px-5 py-2 text-xs font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="rounded-full bg-red-600 hover:bg-red-700 text-white px-5 py-2 text-xs font-bold cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
