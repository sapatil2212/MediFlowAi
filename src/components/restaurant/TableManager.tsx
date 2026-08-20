// ─────────────────────────────────────────────────────────────────────────────
// TableManager.tsx — the `Tables` Settings sub-tab (Req 4.8-4.13, 5.8, 5.10,
// 9.3-9.7).
//
// The registry-backed table directory. Unlike the earlier free-text version,
// the Table_Area is now chosen ONLY from the restaurant's stored Dining_Areas
// (Req 5.8): the selector lists exactly the scope's `selectableAreas`, and a
// save sends the chosen area id so the server keeps `area`/`areaId`
// synchronized. Each table also carries its stored table-scoped Closure_Day
// count (Req 4.12) and opens a per-table closure calendar with month navigation
// and create/delete controls (Req 4.2, 4.4, 4.8, 4.13).
//
// Everything is location-scoped (Req 9.3-9.7): `requestedLocationId` (the
// owner-selected branch, or null for the primary restaurant) is forwarded
// verbatim on every call, and the server derives the authoritative scope.
//
// Every create / edit / deactivate / delete control — for both tables AND their
// closures — is withheld when the resolved `restaurant_config` permission is not
// `operate` (Req 5.10, 4.13). The server refuses those writes regardless. Every
// server interaction is an injected callback with a production default, so the
// DOM suite drives request/response timing exactly like
// `RestaurantProfilePanel.test.tsx`.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  Power,
  Trash2,
  X,
} from "lucide-react";
import {
  deleteRestaurantClosureServerFn,
  listRestaurantClosuresServerFn,
  createRestaurantClosureServerFn,
  deleteRestaurantTableServerFn,
  listRestaurantTablesServerFn,
  saveRestaurantTableServerFn,
  type CreateRestaurantClosureResult,
  type DeleteRestaurantClosureResult,
  type DeleteRestaurantTableResult,
  type RestaurantClosuresView,
  type RestaurantTablesView,
  type SaveRestaurantTableResult,
} from "../../lib/restaurant-settings";
import {
  LIMITS as SETTINGS_LIMITS,
  type ClosureDay,
  type ClosureScope,
  type DiningArea,
  type FieldError,
} from "../../lib/restaurant-settings-model";
import { LIMITS, orderTables, type RestaurantPermission } from "../../lib/restaurant-availability";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable callback contracts (one per consumed server function).
// ─────────────────────────────────────────────────────────────────────────────

export type FetchRestaurantTables = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<RestaurantTablesView>;

export type SaveRestaurantTable = (opts: {
  data: {
    tableId?: string | null;
    name: string;
    seatCapacity: number | null;
    areaId: string;
    displayOrder?: number | null;
    state?: string;
    requestedLocationId?: string | null;
  };
}) => Promise<SaveRestaurantTableResult>;

export type DeleteRestaurantTable = (opts: {
  data: { tableId: string; requestedLocationId?: string | null };
}) => Promise<DeleteRestaurantTableResult>;

export type FetchRestaurantClosures = (opts: {
  data: {
    year: number;
    month: number;
    scope?: ClosureScope | null;
    requestedLocationId?: string | null;
  };
}) => Promise<RestaurantClosuresView>;

export type CreateRestaurantClosure = (opts: {
  data: {
    date: string;
    scope: ClosureScope;
    reason?: string;
    isHoliday?: boolean;
    requestedLocationId?: string | null;
  };
}) => Promise<CreateRestaurantClosureResult>;

export type DeleteRestaurantClosure = (opts: {
  data: { closureId: string; requestedLocationId?: string | null };
}) => Promise<DeleteRestaurantClosureResult>;

type TableRow = RestaurantTablesView["tables"][number];

interface TableFormState {
  id: string | null;
  name: string;
  seatCapacity: string;
  areaId: string;
  displayOrder: string;
}

const EMPTY_FORM: TableFormState = {
  id: null,
  name: "",
  seatCapacity: "",
  areaId: "",
  displayOrder: "",
};

const inputClass =
  "mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1";

function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() || fallback;
}

function errorMap(errors: FieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of errors) if (!map[e.field]) map[e.field] = e.message;
  return map;
}

interface TableManagerProps {
  /** The resolved `restaurant_config` permission (Req 5.10, 4.13). */
  permission: RestaurantPermission;
  /** Owner-selected branch scope; forwarded verbatim to every server call. */
  locationId?: string | null;
  fetchTables?: FetchRestaurantTables;
  saveTable?: SaveRestaurantTable;
  deleteTable?: DeleteRestaurantTable;
  fetchClosures?: FetchRestaurantClosures;
  createClosure?: CreateRestaurantClosure;
  deleteClosure?: DeleteRestaurantClosure;
}

export function TableManager({
  permission,
  locationId = null,
  fetchTables = listRestaurantTablesServerFn as unknown as FetchRestaurantTables,
  saveTable = saveRestaurantTableServerFn as unknown as SaveRestaurantTable,
  deleteTable = deleteRestaurantTableServerFn as unknown as DeleteRestaurantTable,
  fetchClosures = listRestaurantClosuresServerFn as unknown as FetchRestaurantClosures,
  createClosure = createRestaurantClosureServerFn as unknown as CreateRestaurantClosure,
  deleteClosure = deleteRestaurantClosureServerFn as unknown as DeleteRestaurantClosure,
}: TableManagerProps) {
  const [view, setView] = useState<RestaurantTablesView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<TableFormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [closureTableId, setClosureTableId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchTables({ data: { requestedLocationId: locationId } });
      setView(res);
    } catch (err) {
      setLoadError(errorText(err, "Could not load the table registry"));
    } finally {
      setLoading(false);
    }
  }, [fetchTables, locationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The server view's `canManage` is authoritative; the permission prop agrees.
  const canWrite = (view?.canManage ?? permission === "operate") && permission === "operate";
  const tables = view?.tables ?? [];
  const areas = view?.selectableAreas ?? [];
  const ordered = useMemo(() => orderTables(tables), [tables]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
  };

  const startEdit = (t: TableRow) => {
    // Resolve the table's stored area to a selectable registry id.
    const match = areas.find((a) => a.id === t.areaId) ?? areas.find((a) => a.name === t.area);
    setForm({
      id: t.id,
      name: t.name,
      seatCapacity: String(t.seatCapacity),
      areaId: match?.id ?? "",
      displayOrder: String(t.displayOrder),
    });
    setFieldErrors({});
    setFormError(null);
    setSuccess(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    setFormError(null);
    setSuccess(null);
    setFieldErrors({});

    setSaving(true);
    try {
      const result = await saveTable({
        data: {
          tableId: form.id,
          name: form.name,
          seatCapacity: form.seatCapacity.trim() === "" ? null : Number(form.seatCapacity),
          areaId: form.areaId,
          displayOrder: form.displayOrder.trim() === "" ? null : Number(form.displayOrder),
          requestedLocationId: locationId,
        },
      });
      if (result.status === "saved") {
        setSuccess(form.id ? "Table updated" : "Table added");
        resetForm();
        await load();
      } else if (result.status === "invalid") {
        setFieldErrors(errorMap(result.errors));
      } else {
        // duplicate / not_found — the stable message.
        setFormError(result.message);
      }
    } catch (err) {
      setFormError(errorText(err, "Could not save the table"));
    } finally {
      setSaving(false);
    }
  };

  const toggleState = async (t: TableRow) => {
    setBusyId(t.id);
    setFormError(null);
    setSuccess(null);
    try {
      const result = await saveTable({
        data: {
          tableId: t.id,
          name: t.name,
          seatCapacity: t.seatCapacity,
          areaId: t.areaId ?? areas.find((a) => a.name === t.area)?.id ?? "",
          displayOrder: t.displayOrder,
          state: t.state === "active" ? "inactive" : "active",
          requestedLocationId: locationId,
        },
      });
      if (result.status === "saved") {
        await load();
      } else if (result.status === "invalid") {
        setFormError(result.errors[0]?.message ?? "Could not change the table state");
      } else {
        setFormError(result.message);
      }
    } catch (err) {
      setFormError(errorText(err, "Could not change the table state"));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (t: TableRow) => {
    setBusyId(t.id);
    setFormError(null);
    setSuccess(null);
    try {
      const result = await deleteTable({
        data: { tableId: t.id, requestedLocationId: locationId },
      });
      if (result.status === "deleted") {
        setConfirmDeleteId(null);
        setSuccess("Table deleted");
        await load();
      } else {
        setFormError(result.message);
        setConfirmDeleteId(null);
      }
    } catch (err) {
      setFormError(errorText(err, "Could not delete the table"));
      setConfirmDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  const closureTable = ordered.find((t) => t.id === closureTableId) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Dining tables</h3>
          <p className="text-[11px] font-semibold text-zinc-400">
            {tables.length} of {LIMITS.tablesPerTenant} tables registered
            {!canWrite && " · view only"}
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {loadError && (
        <p role="alert" className="flex items-center gap-1 text-[11px] font-bold text-red-500">
          <AlertCircle className="h-3.5 w-3.5" /> {loadError}
        </p>
      )}

      {/* The table rows, each with its area, stored closure count (Req 4.12), and
          a control to open the per-table closure calendar. */}
      {ordered.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-10 text-center text-xs font-semibold text-zinc-400">
          No dining tables yet.
        </div>
      ) : (
        <div
          className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200"
          data-testid="tables-list"
        >
          {ordered.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
              <span className="text-xs font-bold text-zinc-800">{t.name}</span>
              <span className="text-[11px] font-semibold text-zinc-400">
                {t.area} · seats {t.seatCapacity} · order {t.displayOrder} ·{" "}
                {t.state === "active" ? "Active" : "Inactive"}
              </span>
              <span
                data-testid={`table-closure-count-${t.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold text-zinc-500"
              >
                <CalendarDays className="h-3 w-3" /> {t.closureCount}{" "}
                {t.closureCount === 1 ? "closure" : "closures"}
              </span>

              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setClosureTableId((id) => (id === t.id ? null : t.id))}
                  aria-expanded={closureTableId === t.id}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
                >
                  <CalendarDays className="h-3 w-3" /> Closures
                </button>

                {/* Every mutating control is withheld under `view_only` (Req 5.10). */}
                {canWrite && (
                  <>
                    <button
                      type="button"
                      onClick={() => startEdit(t)}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleState(t)}
                      disabled={busyId === t.id}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      <Power className="h-3 w-3" />{" "}
                      {t.state === "active" ? "Deactivate" : "Activate"}
                    </button>
                    {confirmDeleteId === t.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void remove(t)}
                          disabled={busyId === t.id}
                          className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          {busyId === t.id ? (
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
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteId(t.id);
                          setFormError(null);
                        }}
                        aria-label={`Delete ${t.name}`}
                        className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 cursor-pointer transition-colors"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {formError && (
        <p role="alert" className="flex items-center gap-1 text-[11px] font-bold text-red-500">
          <AlertCircle className="h-3.5 w-3.5" /> {formError}
        </p>
      )}
      {success && (
        <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> {success}
        </p>
      )}

      {/* The per-table closure calendar (Req 4.2, 4.4, 4.8, 4.12, 4.13). */}
      {closureTable && (
        <TableClosureCalendar
          key={closureTable.id}
          table={closureTable}
          canWrite={canWrite}
          requestedLocationId={locationId}
          fetchClosures={fetchClosures}
          createClosure={createClosure}
          deleteClosure={deleteClosure}
          onClose={() => setClosureTableId(null)}
          onClosuresChanged={() => void load()}
        />
      )}

      {/* The create / edit form. Absent under `view_only` (Req 5.10). */}
      {canWrite && (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-200 p-4">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-brand" />
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {form.id ? "Edit table" : "Add a table"}
            </h4>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Table name</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Window 1"
                maxLength={LIMITS.tableName.max}
                className={cn(inputClass, fieldErrors.name && "border-red-300")}
              />
              {fieldErrors.name && <FieldMessage message={fieldErrors.name} />}
            </label>

            <label className="block">
              <span className={labelClass}>Seat capacity</span>
              <input
                type="number"
                inputMode="numeric"
                value={form.seatCapacity}
                onChange={(e) => setForm((f) => ({ ...f, seatCapacity: e.target.value }))}
                placeholder="4"
                className={cn(inputClass, fieldErrors.seatCapacity && "border-red-300")}
              />
              {fieldErrors.seatCapacity && <FieldMessage message={fieldErrors.seatCapacity} />}
            </label>

            {/* Req 5.8 — the Table_Area selector offers ONLY the stored areas. */}
            <label className="block">
              <span className={labelClass}>Dining area</span>
              <select
                value={form.areaId}
                aria-label="Dining area"
                onChange={(e) => setForm((f) => ({ ...f, areaId: e.target.value }))}
                className={cn(inputClass, fieldErrors.areaId && "border-red-300")}
              >
                <option value="">Select a dining area</option>
                {areas.map((a: DiningArea) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {fieldErrors.areaId && <FieldMessage message={fieldErrors.areaId} />}
            </label>

            <label className="block">
              <span className={labelClass}>Display order (optional)</span>
              <input
                type="number"
                inputMode="numeric"
                value={form.displayOrder}
                onChange={(e) => setForm((f) => ({ ...f, displayOrder: e.target.value }))}
                placeholder="next in area"
                className={cn(inputClass, fieldErrors.displayOrder && "border-red-300")}
              />
              {fieldErrors.displayOrder && <FieldMessage message={fieldErrors.displayOrder} />}
            </label>
          </div>

          {fieldErrors.tables && <FieldMessage message={fieldErrors.tables} />}

          <div className="flex items-center justify-end gap-2">
            {form.id && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-full border border-zinc-200 px-4 py-2 text-[11px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 active:scale-[0.98] cursor-pointer transition-all"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {form.id ? "Save table" : "Add table"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-table closure calendar (Req 4.2, 4.4, 4.8, 4.12, 4.13)
//
// A month grid interpreted in the tenant timezone with previous/next
// navigation. Every stored table-scoped Closure_Day of the displayed month is
// marked. Under `operate`, selecting an unblocked day reveals a create control
// (reason + holiday flag), and a stored closure can be deleted. Under
// `view_only` the calendar renders read-only with NO create or delete control.
// ─────────────────────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function todayMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function TableClosureCalendar({
  table,
  canWrite,
  requestedLocationId,
  fetchClosures,
  createClosure,
  deleteClosure,
  onClose,
  onClosuresChanged,
}: {
  table: TableRow;
  canWrite: boolean;
  requestedLocationId: string | null;
  fetchClosures: FetchRestaurantClosures;
  createClosure: CreateRestaurantClosure;
  deleteClosure: DeleteRestaurantClosure;
  onClose: () => void;
  onClosuresChanged: () => void;
}) {
  const scope = useMemo<ClosureScope>(() => ({ type: "table", tableId: table.id }), [table.id]);

  const [{ year, month }, setMonth] = useState(todayMonth);
  const [closures, setClosures] = useState<ClosureDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [isHoliday, setIsHoliday] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchClosures({ data: { year, month, scope, requestedLocationId } });
      setClosures(res.closures);
    } catch (err) {
      setError(errorText(err, "Could not load the closures"));
    } finally {
      setLoading(false);
    }
  }, [fetchClosures, year, month, scope, requestedLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDate = useMemo(() => {
    const map = new Map<string, ClosureDay>();
    for (const c of closures) map.set(c.date, c);
    return map;
  }, [closures]);

  const gotoMonth = (delta: number) => {
    setSelectedDate(null);
    setMonth((prev) => {
      const zero = prev.month - 1 + delta;
      const y = prev.year + Math.floor(zero / 12);
      const m = ((zero % 12) + 12) % 12;
      return { year: y, month: m + 1 };
    });
  };

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(`${year}-${pad2(month)}-${pad2(d)}`);

  const selectedClosure = selectedDate ? (byDate.get(selectedDate) ?? null) : null;

  const create = async () => {
    if (!canWrite || !selectedDate) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createClosure({
        data: { date: selectedDate, scope, reason: reason.trim(), isHoliday, requestedLocationId },
      });
      if (result.status === "created") {
        setReason("");
        setIsHoliday(false);
        setSelectedDate(null);
        await load();
        onClosuresChanged();
      } else if (result.status === "invalid") {
        setError(result.errors[0]?.message ?? "The closure could not be created");
      } else {
        // duplicate / not_found
        setError(result.message);
      }
    } catch (err) {
      setError(errorText(err, "The closure could not be created"));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (closure: ClosureDay) => {
    if (!canWrite) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteClosure({ data: { closureId: closure.id, requestedLocationId } });
      if (result.status === "deleted") {
        setSelectedDate(null);
        await load();
        onClosuresChanged();
      } else {
        setError(result.message);
      }
    } catch (err) {
      setError(errorText(err, "The closure could not be removed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid={`table-closure-calendar-${table.id}`}
      aria-label={`Closures for ${table.name}`}
      className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50/40 p-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-brand" />
          <h4 className="text-[11px] font-bold text-zinc-800">Closures · {table.name}</h4>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the closure calendar"
          className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Month navigation (Req 4.2). */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => gotoMonth(-1)}
          aria-label="Previous month"
          className="rounded-full border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:bg-zinc-50 cursor-pointer"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span data-testid="closure-month-label" className="text-[11px] font-bold text-zinc-700">
          {MONTH_LABELS[month - 1]} {year}
        </span>
        <button
          type="button"
          onClick={() => gotoMonth(1)}
          aria-label="Next month"
          className="rounded-full border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:bg-zinc-50 cursor-pointer"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1 text-[11px] font-bold text-red-500">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-1 text-center text-[9px] font-bold uppercase text-zinc-400"
          >
            {label}
          </div>
        ))}
        {cells.map((date, index) => {
          if (date === null) return <div key={`empty-${index}`} />;
          const closed = byDate.has(date);
          const day = Number(date.slice(8, 10));
          const selected = selectedDate === date;
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelectedDate(date)}
              data-testid={`closure-day-${date}`}
              aria-pressed={selected}
              className={cn(
                "flex h-8 items-center justify-center rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer",
                closed
                  ? "border-rose-200 bg-rose-100 text-rose-700"
                  : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                selected && "ring-2 ring-brand",
              )}
            >
              {day}
            </button>
          );
        })}
      </div>

      {loading && (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-zinc-300" />
        </div>
      )}

      {/* The selected date's create/delete controls (Req 4.4, 4.8, 4.13). */}
      {selectedDate && (
        <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-3">
          <p className="text-[11px] font-bold text-zinc-700">{selectedDate}</p>
          {selectedClosure ? (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-zinc-500">
                Closed{selectedClosure.reason ? ` · ${selectedClosure.reason}` : ""}
                {selectedClosure.isHoliday ? " · Holiday" : ""}
              </p>
              {selectedClosure.affectedBookingCount > 0 && (
                <p className="text-[10px] font-semibold text-amber-600">
                  {selectedClosure.affectedBookingCount} booking
                  {selectedClosure.affectedBookingCount === 1 ? "" : "s"} on this table that date
                </p>
              )}
              {canWrite && (
                <button
                  type="button"
                  onClick={() => void remove(selectedClosure)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  Remove closure
                </button>
              )}
            </div>
          ) : canWrite ? (
            <div className="space-y-2">
              <label className="block">
                <span className={labelClass}>Reason (optional)</span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={SETTINGS_LIMITS.closureReason.max}
                  placeholder="Maintenance"
                  aria-label="Closure reason"
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 pl-1 text-[11px] font-semibold text-zinc-600">
                <input
                  type="checkbox"
                  checked={isHoliday}
                  onChange={(e) => setIsHoliday(e.target.checked)}
                />
                Public holiday
              </label>
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-1.5 text-[10px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 cursor-pointer transition-all"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Block this date
              </button>
            </div>
          ) : (
            <p className="text-[10px] font-semibold text-zinc-400">Not blocked.</p>
          )}
        </div>
      )}
    </section>
  );
}

function FieldMessage({ message }: { message: string }) {
  return (
    <p className="mt-1 flex items-center gap-1 pl-1 text-[10px] font-bold text-red-500">
      <AlertCircle className="h-3 w-3" /> {message}
    </p>
  );
}

export default TableManager;
