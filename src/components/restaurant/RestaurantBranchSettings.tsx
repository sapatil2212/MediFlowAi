// ─────────────────────────────────────────────────────────────────────────────
// RestaurantBranchSettings.tsx — the `Multi Location` Settings sub-tab (Req 9.1-9.8).
//
// The restaurant Branch (Location) directory. Every term in this panel is
// `Branch`/`Branches` (Req 9.1). The panel:
//
//   1. Lists every Branch_Account of the resolved Restaurant_Tenant with the
//      Branch name, address, contact details (email, phone, city/state/pincode,
//      manager), and active/inactive state (Req 9.2), and shows the centralized
//      location plan-limit message of the current subscription plan.
//   2. Under `operate`, creates a Branch from a name, a login email not already
//      in use, optional contact/address fields, and a password of at least eight
//      characters matching its confirmation. Field failures surface as a
//      validation summary; an in-use email shows the stable message; a plan-limit
//      refusal shows the message plus an upgrade control; a valid request that
//      cannot be stored shows the stable failure message — none of these create a
//      Branch (Req 9.2, 9.8, 10.7, 10.8).
//   3. Under `operate`, edits a stored Branch's name, contact/address fields,
//      manager, and active state. The login email is NOT editable server-side. A
//      new password of at least eight characters replaces the stored password; an
//      edit WITHOUT a new password retains the stored password unchanged — the
//      password fields are optional and left blank preserve the existing hash.
//   4. Deactivates/reactivates a Branch through an explicit confirmation; the
//      server stores the inactive state and revokes the branch's sessions.
//   5. Deletes a Branch through an explicit confirmation, leaving every other
//      Branch unchanged.
//   6. Under `view_only`, renders the Branches read-only with NO create, edit,
//      delete, or activation controls at all (Req 9.8).
//
// The owner branch-scope selector, forced branch-session scope, and the scoped
// query/dialog reset when the selected branch changes all live in the Settings
// shell (`restaurant.tsx`): this panel only forwards `requestedLocationId`
// verbatim on every call and is remounted by the shell's keyed container when
// the scope changes, so its dialog/query state resets by construction. The
// `stored` list returned by the server is kept separate from each mutating form
// `draft`; a failed save leaves the stored list untouched and never shows
// success. Every server interaction is an injected callback with a production
// default, exactly like `RestaurantUsersSettings.tsx`.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Power,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  createRestaurantBranchServerFn,
  deleteRestaurantBranchServerFn,
  getRestaurantBranchesServerFn,
  setRestaurantBranchActiveServerFn,
  updateRestaurantBranchServerFn,
  type CreateRestaurantBranchResult,
  type DeactivateRestaurantBranchResult,
  type DeleteRestaurantBranchResult,
  type RestaurantBranch,
  type RestaurantBranchesListView,
  type UpdateRestaurantBranchResult,
} from "../../lib/restaurant-settings";
import type { FieldError } from "../../lib/restaurant-settings-model";
import type { RestaurantPermission } from "../../lib/restaurant-availability";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable callback contracts. Each mirrors the matching `createServerFn`
// signature so the production server function drops in as the default and a
// fake drops in for the DOM suite.
// ─────────────────────────────────────────────────────────────────────────────

export type FetchRestaurantBranches = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<RestaurantBranchesListView>;

export type CreateRestaurantBranch = (opts: {
  data: {
    name: string;
    email: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    managerName?: string;
    password: string;
    confirmation: string;
    requestedLocationId?: string | null;
  };
}) => Promise<CreateRestaurantBranchResult>;

export type UpdateRestaurantBranch = (opts: {
  data: {
    id: string;
    name: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    managerName?: string;
    password?: string;
    confirmation?: string;
    isActive?: boolean;
    requestedLocationId?: string | null;
  };
}) => Promise<UpdateRestaurantBranchResult>;

export type SetRestaurantBranchActive = (opts: {
  data: { id: string; isActive: boolean; requestedLocationId?: string | null };
}) => Promise<DeactivateRestaurantBranchResult>;

export type DeleteRestaurantBranch = (opts: {
  data: { id: string; requestedLocationId?: string | null };
}) => Promise<DeleteRestaurantBranchResult>;

const inputClass =
  "mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-500";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1";

function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() || fallback;
}

/** Reduces a list of field errors to the first message per field. */
function errorMap(errors: FieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of errors) if (!map[e.field]) map[e.field] = e.message;
  return map;
}

function FieldMessage({ message }: { message: string }) {
  return <span className="mt-1 block pl-1 text-[10px] font-bold text-red-500">{message}</span>;
}

/** Joins the address/city/state/pincode fragments a Branch has into one line. */
function addressLine(branch: RestaurantBranch): string {
  return [branch.address, branch.city, branch.state, branch.pincode]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(", ");
}

// The create/edit form draft. An `id` of null is a create; a set `id` edits the
// matching stored Branch. The password fields are always blank on open: a blank
// password on edit retains the stored hash. The email field is only used on
// create — the server does not accept an email change on edit.
interface BranchFormState {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  managerName: string;
  password: string;
  confirmation: string;
  isActive: boolean;
}

function emptyForm(): BranchFormState {
  return {
    id: null,
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    managerName: "",
    password: "",
    confirmation: "",
    isActive: true,
  };
}

export interface RestaurantBranchSettingsProps {
  /** The resolved `locations` permission (Req 9.8). */
  permission: RestaurantPermission;
  /** Owner-selected branch scope; forwarded verbatim to every server call. */
  requestedLocationId?: string | null;
  /** Opens the `Manage Plans` tab for the plan-limit upgrade control. */
  onUpgrade?: () => void;
  fetchBranches?: FetchRestaurantBranches;
  createBranch?: CreateRestaurantBranch;
  updateBranch?: UpdateRestaurantBranch;
  setBranchActive?: SetRestaurantBranchActive;
  deleteBranch?: DeleteRestaurantBranch;
}

export function RestaurantBranchSettings({
  permission,
  requestedLocationId = null,
  onUpgrade,
  fetchBranches = getRestaurantBranchesServerFn as unknown as FetchRestaurantBranches,
  createBranch = createRestaurantBranchServerFn as unknown as CreateRestaurantBranch,
  updateBranch = updateRestaurantBranchServerFn as unknown as UpdateRestaurantBranch,
  setBranchActive = setRestaurantBranchActiveServerFn as unknown as SetRestaurantBranchActive,
  deleteBranch = deleteRestaurantBranchServerFn as unknown as DeleteRestaurantBranch,
}: RestaurantBranchSettingsProps) {
  const [view, setView] = useState<RestaurantBranchesListView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // The plan-limit refusal message; when present the upgrade control shows.
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [form, setForm] = useState<BranchFormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Explicit inline confirmations for the destructive actions.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchBranches({ data: { requestedLocationId } });
      setView(res);
    } catch (err) {
      setLoadError(errorText(err, "Could not load the branches"));
    } finally {
      setLoading(false);
    }
  }, [fetchBranches, requestedLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // `view_only`/`none` render no mutation controls at all (Req 9.8).
  const canManage = permission === "operate";
  const viewOnly = permission === "view_only";
  const branches = view?.branches ?? [];
  const planLimit = view?.planLimit ?? null;

  const clearFeedback = () => {
    setFormError(null);
    setSuccess(null);
    setUpgradeMessage(null);
  };

  const openCreate = () => {
    clearFeedback();
    setFieldErrors({});
    setForm(emptyForm());
  };

  const openEdit = (branch: RestaurantBranch) => {
    clearFeedback();
    setFieldErrors({});
    setForm({
      id: branch.id,
      name: branch.name,
      email: branch.email,
      phone: branch.phone,
      address: branch.address,
      city: branch.city,
      state: branch.state,
      pincode: branch.pincode,
      managerName: branch.managerName,
      password: "",
      confirmation: "",
      isActive: branch.isActive,
    });
  };

  const closeForm = () => {
    setForm(null);
    setFieldErrors({});
  };

  // ── Create / edit submit ────────────────────────────────────────────────────

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canManage || !form) return;
      clearFeedback();
      setFieldErrors({});
      setSaving(true);
      try {
        if (form.id) {
          // Edit — the login email is not editable; a blank password retains the hash.
          const result = await updateBranch({
            data: {
              id: form.id,
              name: form.name,
              phone: form.phone,
              address: form.address,
              city: form.city,
              state: form.state,
              pincode: form.pincode,
              managerName: form.managerName,
              password: form.password.trim() === "" ? undefined : form.password,
              confirmation: form.confirmation.trim() === "" ? undefined : form.confirmation,
              isActive: form.isActive,
              requestedLocationId,
            },
          });
          if (result.status === "updated") {
            setSuccess("Branch updated");
            closeForm();
            await load();
          } else if (result.status === "validation_failed") {
            setFieldErrors(errorMap(result.errors));
          } else {
            // not_found / storage_failed — stable message, no change.
            setFormError(result.message);
          }
        } else {
          // Create.
          const result = await createBranch({
            data: {
              name: form.name,
              email: form.email,
              phone: form.phone,
              address: form.address,
              city: form.city,
              state: form.state,
              pincode: form.pincode,
              managerName: form.managerName,
              password: form.password,
              confirmation: form.confirmation,
              requestedLocationId,
            },
          });
          if (result.status === "created") {
            setSuccess("Branch added");
            closeForm();
            await load();
          } else if (result.status === "validation_failed") {
            setFieldErrors(errorMap(result.errors));
          } else if (result.status === "plan_limit_exceeded") {
            // Plan-limit refusal plus the upgrade navigation control.
            setUpgradeMessage(result.message);
          } else {
            // email_taken / storage_failed — stable message, no branch created.
            setFormError(result.message);
          }
        }
      } catch (err) {
        setFormError(errorText(err, "Could not save the branch"));
      } finally {
        setSaving(false);
      }
    },
    [canManage, createBranch, form, load, requestedLocationId, updateBranch],
  );

  // ── Deactivate / reactivate ──────────────────────────────────────────────────

  const changeActive = useCallback(
    async (branch: RestaurantBranch, isActive: boolean) => {
      setBusyId(branch.id);
      clearFeedback();
      try {
        const result = await setBranchActive({
          data: { id: branch.id, isActive, requestedLocationId },
        });
        if (result.status === "updated") {
          setConfirmDeactivateId(null);
          setSuccess(isActive ? "Branch reactivated" : "Branch deactivated");
          await load();
        } else {
          setFormError(result.message);
          setConfirmDeactivateId(null);
        }
      } catch (err) {
        setFormError(errorText(err, "Could not update the branch"));
        setConfirmDeactivateId(null);
      } finally {
        setBusyId(null);
      }
    },
    [load, requestedLocationId, setBranchActive],
  );

  // ── Delete ──────────────────────────────────────────────────────────────────

  const remove = useCallback(
    async (branch: RestaurantBranch) => {
      setBusyId(branch.id);
      clearFeedback();
      try {
        const result = await deleteBranch({ data: { id: branch.id, requestedLocationId } });
        if (result.status === "deleted") {
          setConfirmDeleteId(null);
          setSuccess("Branch deleted");
          await load();
        } else {
          setFormError(result.message);
          setConfirmDeleteId(null);
        }
      } catch (err) {
        setFormError(errorText(err, "Could not delete the branch"));
        setConfirmDeleteId(null);
      } finally {
        setBusyId(null);
      }
    },
    [deleteBranch, load, requestedLocationId],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Branches</h3>
          <p className="text-[11px] font-semibold text-zinc-400">
            Each branch registers its own dining tables, dining areas, menu, and closure days
            {!canManage && " · view only"}
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {/* The centralized location plan-limit message of the current subscription. */}
      {planLimit && (
        <p
          data-testid="branches-plan-message"
          className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] font-semibold text-zinc-500"
        >
          {planLimit.message}
        </p>
      )}

      {/* Req 9.8 — a view-only role sees the branches but no controls. */}
      {viewOnly && (
        <p
          data-testid="branches-view-only"
          className="flex items-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
        >
          <Lock className="h-3.5 w-3.5" /> Your role can view but not change the branches.
        </p>
      )}

      {loadError && (
        <p role="alert" className="flex items-center gap-1 text-[11px] font-bold text-red-500">
          <AlertCircle className="h-3.5 w-3.5" /> {loadError}
        </p>
      )}

      {formError && (
        <p role="alert" className="flex items-center gap-1 text-[11px] font-bold text-red-500">
          <AlertCircle className="h-3.5 w-3.5" /> {formError}
        </p>
      )}

      {/* A plan-limit refusal plus the upgrade navigation control. */}
      {upgradeMessage && (
        <div
          role="alert"
          data-testid="branches-upgrade"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] font-bold text-amber-700"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{upgradeMessage}</span>
          {onUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              data-testid="branches-upgrade-button"
              className="inline-flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-[10px] font-bold text-white hover:bg-amber-600 cursor-pointer transition-colors"
            >
              Upgrade plan <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </div>
      )}

      {success && (
        <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> {success}
        </p>
      )}

      {/* Req 9.2 — the branch directory with name, address, contact, active state. */}
      {branches.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-10 text-center text-xs font-semibold text-zinc-400">
          No branches yet.
        </div>
      ) : (
        <div
          className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200"
          data-testid="branches-list"
        >
          {branches.map((branch) => {
            const address = addressLine(branch);
            return (
              <div
                key={branch.id}
                data-testid={`branch-row-${branch.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-3"
              >
                <div className="min-w-[10rem] flex-1">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-brand" />
                    <span className="text-xs font-bold text-zinc-800">{branch.name}</span>
                    <span
                      data-testid={`branch-state-${branch.id}`}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                        branch.isActive
                          ? "bg-emerald-50 text-emerald-600"
                          : "bg-zinc-100 text-zinc-400",
                      )}
                    >
                      {branch.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-semibold text-zinc-400">
                    <span className="inline-flex items-center gap-1">
                      <Mail className="h-3 w-3" /> {branch.email}
                    </span>
                    {branch.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="h-3 w-3" /> {branch.phone}
                      </span>
                    )}
                    {branch.managerName && (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" /> {branch.managerName}
                      </span>
                    )}
                    {address && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3 w-3" /> {address}
                      </span>
                    )}
                  </div>
                </div>

                {/* Req 9.8 — the action cluster is present only under `operate`. */}
                {canManage && (
                  <div className="ml-auto flex items-center gap-1.5">
                    {confirmDeleteId === branch.id ? (
                      <>
                        <span className="text-[10px] font-bold text-red-500">Delete?</span>
                        <button
                          type="button"
                          onClick={() => void remove(branch)}
                          disabled={busyId === branch.id}
                          className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          {busyId === branch.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-400 cursor-pointer"
                        >
                          <X className="h-3 w-3" /> Cancel
                        </button>
                      </>
                    ) : confirmDeactivateId === branch.id ? (
                      <>
                        <span className="text-[10px] font-bold text-amber-600">Deactivate?</span>
                        <button
                          type="button"
                          onClick={() => void changeActive(branch, false)}
                          disabled={busyId === branch.id}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          {busyId === branch.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Power className="h-3 w-3" />
                          )}
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeactivateId(null)}
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-400 cursor-pointer"
                        >
                          <X className="h-3 w-3" /> Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(branch)}
                          aria-label={`Edit ${branch.name}`}
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        {branch.isActive ? (
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeactivateId(branch.id);
                              clearFeedback();
                            }}
                            aria-label={`Deactivate ${branch.name}`}
                            className="inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100 cursor-pointer transition-colors"
                          >
                            <Power className="h-3 w-3" /> Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void changeActive(branch, true)}
                            disabled={busyId === branch.id}
                            aria-label={`Reactivate ${branch.name}`}
                            className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer transition-colors"
                          >
                            {busyId === branch.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Power className="h-3 w-3" />
                            )}
                            Reactivate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeleteId(branch.id);
                            clearFeedback();
                          }}
                          aria-label={`Delete ${branch.name}`}
                          className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 cursor-pointer transition-colors"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Req 9.8 — the create control, absent entirely under view_only. */}
      {canManage && !form && (
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 py-2 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors"
        >
          <Plus className="h-3.5 w-3.5 text-brand" /> Add a branch
        </button>
      )}

      {/* The create/edit form. Its submit is the create/edit confirmation. */}
      {canManage && form && (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-200 p-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-brand" />
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {form.id ? "Edit branch" : "Add a branch"}
            </h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Branch name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                placeholder="Downtown branch"
                maxLength={100}
                aria-label="Branch name"
                className={cn(inputClass, fieldErrors.name && "border-red-300")}
              />
              {fieldErrors.name && <FieldMessage message={fieldErrors.name} />}
            </label>
            <label className="block">
              <span className={labelClass}>
                {form.id ? "Login email (not editable)" : "Login email"}
              </span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => (f ? { ...f, email: e.target.value } : f))}
                placeholder="branch@example.com"
                aria-label="Branch login email"
                disabled={form.id !== null}
                className={cn(inputClass, fieldErrors.email && "border-red-300")}
              />
              {fieldErrors.email && <FieldMessage message={fieldErrors.email} />}
            </label>
            <label className="block">
              <span className={labelClass}>Phone (optional)</span>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm((f) => (f ? { ...f, phone: e.target.value } : f))}
                placeholder="+1 555 000 1234"
                aria-label="Branch phone"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Manager name (optional)</span>
              <input
                type="text"
                value={form.managerName}
                onChange={(e) => setForm((f) => (f ? { ...f, managerName: e.target.value } : f))}
                placeholder="Alex Doe"
                aria-label="Branch manager name"
                className={inputClass}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelClass}>Address (optional)</span>
              <input
                type="text"
                value={form.address}
                onChange={(e) => setForm((f) => (f ? { ...f, address: e.target.value } : f))}
                placeholder="123 Market Street"
                aria-label="Branch address"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>City (optional)</span>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm((f) => (f ? { ...f, city: e.target.value } : f))}
                placeholder="City"
                aria-label="Branch city"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>State (optional)</span>
              <input
                type="text"
                value={form.state}
                onChange={(e) => setForm((f) => (f ? { ...f, state: e.target.value } : f))}
                placeholder="State"
                aria-label="Branch state"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Pincode (optional)</span>
              <input
                type="text"
                value={form.pincode}
                onChange={(e) => setForm((f) => (f ? { ...f, pincode: e.target.value } : f))}
                placeholder="000000"
                aria-label="Branch pincode"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>
                {form.id ? "New password (optional)" : "Password"}
              </span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => (f ? { ...f, password: e.target.value } : f))}
                placeholder={form.id ? "Leave blank to keep current" : "At least 8 characters"}
                autoComplete="new-password"
                aria-label={form.id ? "New branch password" : "Branch password"}
                className={cn(inputClass, fieldErrors.password && "border-red-300")}
              />
              {fieldErrors.password && <FieldMessage message={fieldErrors.password} />}
            </label>
            <label className="block">
              <span className={labelClass}>Confirm password</span>
              <input
                type="password"
                value={form.confirmation}
                onChange={(e) => setForm((f) => (f ? { ...f, confirmation: e.target.value } : f))}
                placeholder={form.id ? "Leave blank to keep current" : "Repeat the password"}
                autoComplete="new-password"
                aria-label="Confirm branch password"
                className={cn(inputClass, fieldErrors.confirmation && "border-red-300")}
              />
              {fieldErrors.confirmation && <FieldMessage message={fieldErrors.confirmation} />}
            </label>
          </div>

          {/* Active/inactive state is editable on edit only (create defaults to active). */}
          {form.id && (
            <label className="flex items-center gap-2 pl-1">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => (f ? { ...f, isActive: e.target.checked } : f))}
                aria-label="Branch is active"
                className="h-3.5 w-3.5 rounded border-zinc-300 text-brand focus:ring-brand"
              />
              <span className="text-[11px] font-semibold text-zinc-600">Branch is active</span>
            </label>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-2 text-[11px] font-bold text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer transition-colors"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Building2 className="h-3.5 w-3.5" />}
              {form.id ? "Save branch" : "Create branch"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 py-2 text-[11px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default RestaurantBranchSettings;
