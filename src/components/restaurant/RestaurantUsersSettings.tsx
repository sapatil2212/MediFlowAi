// ─────────────────────────────────────────────────────────────────────────────
// RestaurantUsersSettings.tsx — the `Manage Users` Settings sub-tab (Req 8.1-8.15).
//
// The restaurant SubUser directory, expressed with the same complete lifecycle
// the five category dashboards offer. The panel:
//
//   1. Lists every Sub_User of the resolved scope with the Sub_User name, email
//      address, phone number, role, and active state (Req 8.2), and displays the
//      shared Plan_Limit_Message of the current subscription plan (Req 8.3).
//   2. Under `operate`, creates a Sub_User from a name, an email not already in
//      use, a role of `reception` or `doctor`, and a password of at least eight
//      characters that matches the confirmation (Req 8.4). Field failures surface
//      as a validation summary (Req 8.10, 8.11); an in-use email shows the stable
//      message (Req 8.12); a valid request that cannot be stored shows the stable
//      failure message (Req 8.14) — none of these create a Sub_User.
//   3. Under `operate`, edits a stored Sub_User's name, phone, role, and active
//      state (Req 8.5). A new password of at least eight characters replaces the
//      stored password (Req 8.6); an edit WITHOUT a new password retains the
//      stored password unchanged (Req 8.7) — the password fields are optional and
//      left blank preserve the existing hash server-side.
//   4. Deactivates a Sub_User through an explicit confirmation; the server stores
//      the inactive state and revokes sessions so Feature Access denies the
//      account immediately (Req 8.8). Reactivation is a direct toggle.
//   5. Deletes a Sub_User through an explicit confirmation, leaving every other
//      Sub_User unchanged (Req 8.9).
//   6. When creation or a role change is refused because the plan permits no
//      further account of the requested role, shows the refusal message together
//      with a control that opens the `Manage Plans` tab (Req 8.13); nothing is
//      created or changed.
//   7. Under `view_only`, renders the Sub_Users read-only with NO create, edit,
//      delete, or activation controls at all (Req 8.15).
//
// Everything is branch-scope aware: `requestedLocationId` (the owner-selected
// branch, or null for the primary restaurant) is forwarded verbatim on every
// call and the server derives the authoritative scope. The `stored` list
// returned by the server is kept separate from each mutating form `draft`; a
// failed save leaves the stored list untouched and never shows success. Every
// server interaction is an injected callback with a production default, so the
// DOM suite drives request/response timing exactly like `MenuSettings.test.tsx`.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  Loader2,
  Lock,
  Mail,
  Pencil,
  Phone,
  Power,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import {
  createRestaurantUserServerFn,
  deleteRestaurantUserServerFn,
  getRestaurantUsersServerFn,
  setRestaurantUserActiveServerFn,
  updateRestaurantUserServerFn,
  type CreateRestaurantUserResult,
  type DeactivateRestaurantUserResult,
  type DeleteRestaurantUserResult,
  type RestaurantUsersListView,
  type UpdateRestaurantUserResult,
} from "../../lib/restaurant-settings";
import {
  SUB_USER_ROLES,
  type FieldError,
  type SubUser,
  type SubUserRole,
} from "../../lib/restaurant-settings-model";
import type { RestaurantPermission } from "../../lib/restaurant-availability";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable callback contracts. Each mirrors the matching `createServerFn`
// signature so the production server function drops in as the default and a
// fake drops in for the DOM suite.
// ─────────────────────────────────────────────────────────────────────────────

export type FetchRestaurantUsers = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<RestaurantUsersListView>;

export type CreateRestaurantUser = (opts: {
  data: {
    name: string;
    email: string;
    phone?: string;
    role: string;
    password: string;
    confirmation: string;
    requestedLocationId?: string | null;
  };
}) => Promise<CreateRestaurantUserResult>;

export type UpdateRestaurantUser = (opts: {
  data: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    role: string;
    password?: string;
    confirmation?: string;
    isActive?: boolean;
    requestedLocationId?: string | null;
  };
}) => Promise<UpdateRestaurantUserResult>;

export type SetRestaurantUserActive = (opts: {
  data: { id: string; isActive: boolean; requestedLocationId?: string | null };
}) => Promise<DeactivateRestaurantUserResult>;

export type DeleteRestaurantUser = (opts: {
  data: { id: string; requestedLocationId?: string | null };
}) => Promise<DeleteRestaurantUserResult>;

const inputClass =
  "mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all";
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

function roleLabel(role: SubUserRole): string {
  return role === "reception" ? "Reception" : "Doctor";
}

// The create/edit form draft. An `id` of null is a create; a set `id` edits the
// matching stored Sub_User. The password fields are always blank on open: a
// blank password on edit retains the stored hash (Req 8.7).
interface UserFormState {
  id: string | null;
  name: string;
  email: string;
  phone: string;
  role: SubUserRole;
  password: string;
  confirmation: string;
  isActive: boolean;
}

function emptyForm(): UserFormState {
  return {
    id: null,
    name: "",
    email: "",
    phone: "",
    role: "reception",
    password: "",
    confirmation: "",
    isActive: true,
  };
}

export interface RestaurantUsersSettingsProps {
  /** The resolved `users` permission (Req 8.15). */
  permission: RestaurantPermission;
  /** Owner-selected branch scope; forwarded verbatim to every server call. */
  requestedLocationId?: string | null;
  /** Opens the `Manage Plans` tab for the plan-limit upgrade control (Req 8.13). */
  onUpgrade?: () => void;
  fetchUsers?: FetchRestaurantUsers;
  createUser?: CreateRestaurantUser;
  updateUser?: UpdateRestaurantUser;
  setUserActive?: SetRestaurantUserActive;
  deleteUser?: DeleteRestaurantUser;
}

export function RestaurantUsersSettings({
  permission,
  requestedLocationId = null,
  onUpgrade,
  fetchUsers = getRestaurantUsersServerFn as unknown as FetchRestaurantUsers,
  createUser = createRestaurantUserServerFn as unknown as CreateRestaurantUser,
  updateUser = updateRestaurantUserServerFn as unknown as UpdateRestaurantUser,
  setUserActive = setRestaurantUserActiveServerFn as unknown as SetRestaurantUserActive,
  deleteUser = deleteRestaurantUserServerFn as unknown as DeleteRestaurantUser,
}: RestaurantUsersSettingsProps) {
  const [view, setView] = useState<RestaurantUsersListView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // The plan-limit refusal message; when present the upgrade control shows (Req 8.13).
  const [upgradeMessage, setUpgradeMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [form, setForm] = useState<UserFormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Explicit inline confirmations (Req 8.8, 8.9).
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeactivateId, setConfirmDeactivateId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchUsers({ data: { requestedLocationId } });
      setView(res);
    } catch (err) {
      setLoadError(errorText(err, "Could not load the team members"));
    } finally {
      setLoading(false);
    }
  }, [fetchUsers, requestedLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // `view_only`/`none` render no mutation controls at all (Req 8.15).
  const canManage = permission === "operate";
  const viewOnly = permission === "view_only";
  const users = view?.users ?? [];
  const planLimits = view?.planLimits ?? null;

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

  const openEdit = (user: SubUser) => {
    clearFeedback();
    setFieldErrors({});
    setForm({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      password: "",
      confirmation: "",
      isActive: user.isActive,
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
          // Edit — password is optional; a blank password retains the hash (Req 8.7).
          const result = await updateUser({
            data: {
              id: form.id,
              name: form.name,
              email: form.email,
              phone: form.phone,
              role: form.role,
              password: form.password.trim() === "" ? undefined : form.password,
              confirmation: form.confirmation.trim() === "" ? undefined : form.confirmation,
              isActive: form.isActive,
              requestedLocationId,
            },
          });
          if (result.status === "updated") {
            setSuccess("Team member updated");
            closeForm();
            await load();
          } else if (result.status === "validation_failed") {
            setFieldErrors(errorMap(result.errors));
          } else if (result.status === "role_limit_exceeded") {
            // Req 8.13 — refusal plus the upgrade navigation control.
            setUpgradeMessage(result.message);
          } else {
            // email_taken / not_found / storage_failed — stable message, no change.
            setFormError(result.message);
          }
        } else {
          // Create (Req 8.4).
          const result = await createUser({
            data: {
              name: form.name,
              email: form.email,
              phone: form.phone,
              role: form.role,
              password: form.password,
              confirmation: form.confirmation,
              requestedLocationId,
            },
          });
          if (result.status === "created") {
            setSuccess("Team member added");
            closeForm();
            await load();
          } else if (result.status === "validation_failed") {
            setFieldErrors(errorMap(result.errors));
          } else if (result.status === "role_limit_exceeded") {
            // Req 8.13 — refusal plus the upgrade navigation control.
            setUpgradeMessage(result.message);
          } else {
            // email_taken / storage_failed — stable message, no user created.
            setFormError(result.message);
          }
        }
      } catch (err) {
        setFormError(errorText(err, "Could not save the team member"));
      } finally {
        setSaving(false);
      }
    },
    [canManage, createUser, form, load, requestedLocationId, updateUser],
  );

  // ── Deactivate / reactivate (Req 8.8) ────────────────────────────────────────

  const changeActive = useCallback(
    async (user: SubUser, isActive: boolean) => {
      setBusyId(user.id);
      clearFeedback();
      try {
        const result = await setUserActive({
          data: { id: user.id, isActive, requestedLocationId },
        });
        if (result.status === "updated") {
          setConfirmDeactivateId(null);
          setSuccess(isActive ? "Team member reactivated" : "Team member deactivated");
          await load();
        } else {
          setFormError(result.message);
          setConfirmDeactivateId(null);
        }
      } catch (err) {
        setFormError(errorText(err, "Could not update the team member"));
        setConfirmDeactivateId(null);
      } finally {
        setBusyId(null);
      }
    },
    [load, requestedLocationId, setUserActive],
  );

  // ── Delete (Req 8.9) ──────────────────────────────────────────────────────────

  const remove = useCallback(
    async (user: SubUser) => {
      setBusyId(user.id);
      clearFeedback();
      try {
        const result = await deleteUser({ data: { id: user.id, requestedLocationId } });
        if (result.status === "deleted") {
          setConfirmDeleteId(null);
          setSuccess("Team member deleted");
          await load();
        } else {
          setFormError(result.message);
          setConfirmDeleteId(null);
        }
      } catch (err) {
        setFormError(errorText(err, "Could not delete the team member"));
        setConfirmDeleteId(null);
      } finally {
        setBusyId(null);
      }
    },
    [deleteUser, load, requestedLocationId],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Manage users</h3>
          <p className="text-[11px] font-semibold text-zinc-400">
            Front-of-house and staff logins for this restaurant
            {!canManage && " · view only"}
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {/* Req 8.3 — the shared plan-limit message of the current subscription. */}
      {planLimits && (
        <p
          data-testid="users-plan-message"
          className="rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-[11px] font-semibold text-zinc-500"
        >
          {planLimits.message}
        </p>
      )}

      {/* Req 8.15 — a view-only role sees the users but no controls. */}
      {viewOnly && (
        <p
          data-testid="users-view-only"
          className="flex items-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
        >
          <Lock className="h-3.5 w-3.5" /> Your role can view but not change the team members.
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

      {/* Req 8.13 — a plan-limit refusal plus the upgrade navigation control. */}
      {upgradeMessage && (
        <div
          role="alert"
          data-testid="users-upgrade"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] font-bold text-amber-700"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{upgradeMessage}</span>
          {onUpgrade && (
            <button
              type="button"
              onClick={onUpgrade}
              data-testid="users-upgrade-button"
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

      {/* Req 8.2 — the user directory with name, email, phone, role, active state. */}
      {users.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-10 text-center text-xs font-semibold text-zinc-400">
          No team members yet.
        </div>
      ) : (
        <div
          className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200"
          data-testid="users-list"
        >
          {users.map((user) => (
            <div
              key={user.id}
              data-testid={`user-row-${user.id}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3.5 py-3"
            >
              <div className="min-w-[8rem] flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-800">{user.name}</span>
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                    {roleLabel(user.role)}
                  </span>
                  <span
                    data-testid={`user-state-${user.id}`}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                      user.isActive
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-zinc-100 text-zinc-400",
                    )}
                  >
                    {user.isActive ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] font-semibold text-zinc-400">
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {user.email}
                  </span>
                  {user.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {user.phone}
                    </span>
                  )}
                </div>
              </div>

              {/* Req 8.15 — the action cluster is present only under `operate`. */}
              {canManage && (
                <div className="ml-auto flex items-center gap-1.5">
                  {confirmDeleteId === user.id ? (
                    <>
                      <span className="text-[10px] font-bold text-red-500">Delete?</span>
                      <button
                        type="button"
                        onClick={() => void remove(user)}
                        disabled={busyId === user.id}
                        className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {busyId === user.id ? (
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
                  ) : confirmDeactivateId === user.id ? (
                    <>
                      <span className="text-[10px] font-bold text-amber-600">Deactivate?</span>
                      <button
                        type="button"
                        onClick={() => void changeActive(user, false)}
                        disabled={busyId === user.id}
                        className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 cursor-pointer transition-colors"
                      >
                        {busyId === user.id ? (
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
                        onClick={() => openEdit(user)}
                        aria-label={`Edit ${user.name}`}
                        className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      {user.isActive ? (
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmDeactivateId(user.id);
                            clearFeedback();
                          }}
                          aria-label={`Deactivate ${user.name}`}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100 cursor-pointer transition-colors"
                        >
                          <Power className="h-3 w-3" /> Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void changeActive(user, true)}
                          disabled={busyId === user.id}
                          aria-label={`Reactivate ${user.name}`}
                          className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-600 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          {busyId === user.id ? (
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
                          setConfirmDeleteId(user.id);
                          clearFeedback();
                        }}
                        aria-label={`Delete ${user.name}`}
                        className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 cursor-pointer transition-colors"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Req 8.4, 8.15 — the create control, absent entirely under view_only. */}
      {canManage && !form && (
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 py-2 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors"
        >
          <UserPlus className="h-3.5 w-3.5 text-brand" /> Add a team member
        </button>
      )}

      {/* The create/edit form. Its submit is the create/edit confirmation. */}
      {canManage && form && (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-200 p-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-brand" />
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {form.id ? "Edit team member" : "Add a team member"}
            </h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                placeholder="Alex Doe"
                maxLength={100}
                aria-label="Team member name"
                className={cn(inputClass, fieldErrors.name && "border-red-300")}
              />
              {fieldErrors.name && <FieldMessage message={fieldErrors.name} />}
            </label>
            <label className="block">
              <span className={labelClass}>Email address</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => (f ? { ...f, email: e.target.value } : f))}
                placeholder="alex@example.com"
                aria-label="Team member email"
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
                aria-label="Team member phone"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className={labelClass}>Role</span>
              <select
                value={form.role}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, role: e.target.value as SubUserRole } : f))
                }
                aria-label="Team member role"
                className={cn(inputClass, "appearance-none", fieldErrors.role && "border-red-300")}
              >
                {SUB_USER_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
              {fieldErrors.role && <FieldMessage message={fieldErrors.role} />}
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
                aria-label={form.id ? "New password" : "Password"}
                className={cn(inputClass, fieldErrors.password && "border-red-300")}
              />
              {fieldErrors.password && <FieldMessage message={fieldErrors.password} />}
            </label>
            <label className="block">
              <span className={labelClass}>Confirm password</span>
              <input
                type="password"
                value={form.confirmation}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, confirmation: e.target.value } : f))
                }
                placeholder={form.id ? "Confirm new password" : "Re-enter password"}
                autoComplete="new-password"
                aria-label="Confirm password"
                className={cn(inputClass, fieldErrors.confirmation && "border-red-300")}
              />
              {fieldErrors.confirmation && <FieldMessage message={fieldErrors.confirmation} />}
            </label>
          </div>

          {/* Editing exposes the active-state toggle (Req 8.5). */}
          {form.id && (
            <label className="flex items-center gap-2 pl-1">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => (f ? { ...f, isActive: e.target.checked } : f))}
                aria-label="Team member active"
                className="h-3.5 w-3.5 rounded border-zinc-300 text-brand focus:ring-brand"
              />
              <span className="text-[11px] font-semibold text-zinc-600">Account is active</span>
            </label>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="rounded-full border border-zinc-200 px-4 py-2 text-[11px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 active:scale-[0.98] cursor-pointer transition-all"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {form.id ? "Save team member" : "Add team member"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function FieldMessage({ message }: { message: string }) {
  return (
    <p className="mt-1 flex items-center gap-1 pl-1 text-[10px] font-bold text-red-500">
      <AlertCircle className="h-3 w-3" /> {message}
    </p>
  );
}

export default RestaurantUsersSettings;
