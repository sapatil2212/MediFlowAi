// ─────────────────────────────────────────────────────────────────────────────
// OperatingHours.tsx — the `Operating Hours` Settings sub-tab (Req 3.1-3.8,
// 4.1-4.11, 4.13).
//
// The parity model has two halves:
//
//   1. Weekly hours. Seven weekday rows, each with an Open_Time, a Close_Time
//      and a Closed_Flag. A separate `stored` snapshot backs the editable
//      `draft` so a rejected save re-renders the previously stored values
//      untouched (Req 3.2, 3.7). Under `operate` the panel offers at least three
//      named Hours_Presets (Req 3.3) and an apply-to-all control (Req 3.3): a
//      preset replaces the whole draft including closed flags (Req 3.4), and
//      apply-to-all rewrites only the open weekdays' draft times without
//      touching any closed flag (Req 3.5). Both shortcuts mutate the DRAFT only
//      through the pure helpers `applyHoursPreset`/`applyHoursToOpenDays`; the
//      stored snapshot is never changed until a valid save (Req 3.4, 3.5). Save
//      is all-or-nothing (Req 3.6, 3.7), decided first by the pure
//      `validateRestaurantOperatingHours` so every invalid weekday is named and
//      nothing is sent on a rejection.
//
//   2. Restaurant closures. A month calendar interpreted in the Tenant_Timezone
//      that marks every restaurant-scoped Closure_Date of the displayed month
//      (Req 4.1) with previous/next navigation (Req 4.2). Under `operate`,
//      selecting an unblocked day reveals a create control (reason + holiday
//      flag, Req 4.3) and a stored closure can be deleted (Req 4.4); a stored
//      closure that falls on a date with existing bookings shows the affected
//      Table_Booking count as a warning (Req 4.9).
//
// Under a resolved `restaurant_config` permission other than `operate` the whole
// sub-tab renders read-only: no preset, apply-to-all, or save control for hours
// (Req 3.8) and no create or delete control for closures (Req 4.13).
//
// Every server interaction is an injected callback with a production default, so
// the DOM suite drives request/response timing exactly like
// `RestaurantProfilePanel.test.tsx` and `DiningAreasSettings.test.tsx` do.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  Lock,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import {
  createRestaurantClosureServerFn,
  deleteRestaurantClosureServerFn,
  getRestaurantOperatingHoursServerFn,
  listRestaurantClosuresServerFn,
  saveRestaurantOperatingHoursServerFn,
  type CreateRestaurantClosureResult,
  type DeleteRestaurantClosureResult,
  type RestaurantClosuresView,
  type RestaurantOperatingHoursView,
  type SaveRestaurantOperatingHoursResult,
} from "../../lib/restaurant-settings";
import {
  applyHoursPreset,
  applyHoursToOpenDays,
  HOURS_PRESETS,
  LIMITS,
  RESTAURANT_WEEKDAY_NAMES,
  validateHoursPair,
  validateRestaurantOperatingHours,
  type ClosureDay,
  type ClosureScope,
  type DayHours,
  type FieldError,
  type HoursPreset,
} from "../../lib/restaurant-settings-model";
import type { RestaurantPermission } from "../../lib/restaurant-availability";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable callback contracts. Each mirrors the matching `createServerFn`
// signature so the production server function drops in as the default and a
// fake drops in for the DOM suite.
// ─────────────────────────────────────────────────────────────────────────────

export type FetchRestaurantOperatingHours = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<RestaurantOperatingHoursView>;

export type SaveRestaurantOperatingHours = (opts: {
  data: { days: DayHours[]; requestedLocationId?: string | null };
}) => Promise<SaveRestaurantOperatingHoursResult>;

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

interface OperatingHoursProps {
  /** The resolved `restaurant_config` permission (Req 3.8, 4.13). */
  permission: RestaurantPermission;
  /** Owner-selected branch scope; forwarded verbatim to every server call. */
  requestedLocationId?: string | null;
  fetchHours?: FetchRestaurantOperatingHours;
  saveHours?: SaveRestaurantOperatingHours;
  fetchClosures?: FetchRestaurantClosures;
  createClosure?: CreateRestaurantClosure;
  deleteClosure?: DeleteRestaurantClosure;
}

const CLOSED_DAY: DayHours = {
  dayOfWeek: 0,
  openTime: "00:00",
  closeTime: "00:00",
  isClosed: true,
};

function sevenDays(rows: DayHours[] | null | undefined): DayHours[] {
  return Array.from({ length: LIMITS.operatingHoursDays }, (_, dayOfWeek) => {
    const row = (rows ?? []).find((h) => h.dayOfWeek === dayOfWeek);
    return row ? { ...row, dayOfWeek } : { ...CLOSED_DAY, dayOfWeek };
  });
}

function errorMap(errors: FieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of errors) if (!map[e.field]) map[e.field] = e.message;
  return map;
}

function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() || fallback;
}

const timeInputClass =
  "rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-400";

export function OperatingHours({
  permission,
  requestedLocationId = null,
  fetchHours = getRestaurantOperatingHoursServerFn as unknown as FetchRestaurantOperatingHours,
  saveHours = saveRestaurantOperatingHoursServerFn as unknown as SaveRestaurantOperatingHours,
  fetchClosures = listRestaurantClosuresServerFn as unknown as FetchRestaurantClosures,
  createClosure = createRestaurantClosureServerFn as unknown as CreateRestaurantClosure,
  deleteClosure = deleteRestaurantClosureServerFn as unknown as DeleteRestaurantClosure,
}: OperatingHoursProps) {
  /** The stored values — the form reverts to these on a rejection (Req 3.7). */
  const [stored, setStored] = useState<DayHours[]>(sevenDays(null));
  const [days, setDays] = useState<DayHours[]>(sevenDays(null));
  const [canSave, setCanSave] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [applyOpen, setApplyOpen] = useState("09:00");
  const [applyClose, setApplyClose] = useState("22:00");
  const [applyError, setApplyError] = useState<string | null>(null);

  // The server view's `canSave` is authoritative; the permission prop agrees.
  const canWrite = canSave && permission === "operate";

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchHours({ data: { requestedLocationId } });
      const rows = sevenDays(res.days as DayHours[]);
      setStored(rows);
      setDays(rows);
      setCanSave(res.canSave);
    } catch (err) {
      setLoadError(errorText(err, "Could not load the operating hours."));
    } finally {
      setLoading(false);
    }
  }, [fetchHours, requestedLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (dayOfWeek: number, patch: Partial<DayHours>) => {
    setDays((rows) => rows.map((r) => (r.dayOfWeek === dayOfWeek ? { ...r, ...patch } : r)));
    setSuccess(null);
  };

  // Req 3.4 — a preset replaces the whole draft (including closed flags). The
  // pure helper never touches the stored snapshot, so nothing is persisted.
  const applyPreset = (preset: HoursPreset) => {
    if (!canWrite) return;
    setDays((rows) => applyHoursPreset(rows, preset));
    setFieldErrors({});
    setFormError(null);
    setApplyError(null);
    setSuccess(null);
  };

  // Req 3.5 — apply-to-all rewrites only the open weekdays' draft times and
  // changes no closed flag. An invalid time pair is reported and changes nothing.
  const applyToAll = () => {
    if (!canWrite) return;
    const pair = validateHoursPair(applyOpen, applyClose);
    if (!pair.ok) {
      setApplyError(pair.errors[0]?.message ?? "Enter a valid open and close time");
      return;
    }
    setApplyError(null);
    setDays((rows) => applyHoursToOpenDays(rows, applyOpen, applyClose));
    setFieldErrors({});
    setFormError(null);
    setSuccess(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    // Req 3.6, 3.7 — all seven days, all-or-nothing, decided by the pure validator.
    const result = validateRestaurantOperatingHours(days);
    if (!result.ok) {
      setFieldErrors(errorMap(result.errors));
      // Nothing is stored, so the stored values are what renders (Req 3.7).
      setDays(stored.map((r) => ({ ...r })));
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const res = await saveHours({ data: { days: result.value, requestedLocationId } });
      if (res.status === "saved") {
        const rows = sevenDays(res.days as DayHours[]);
        setStored(rows);
        setDays(rows);
        setSuccess("Operating hours saved");
      } else {
        // The server re-ran the same validator; name every offending weekday
        // and revert to the stored snapshot (Req 3.7).
        setFieldErrors(errorMap(res.errors));
        setDays(stored.map((r) => ({ ...r })));
      }
    } catch (err) {
      setFormError(errorText(err, "Could not save the operating hours."));
      setDays(stored.map((r) => ({ ...r })));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand" />
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Operating hours {!canWrite && "· view only"}
            </h3>
          </div>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
        </div>

        {/* Req 3.8, 4.13 — a view-only role sees the hours and closures but no controls. */}
        {!canWrite && !loading && (
          <p
            data-testid="operating-hours-view-only"
            className="flex items-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
          >
            <Lock className="h-3.5 w-3.5" /> Your role can view but not change the operating hours.
          </p>
        )}

        {loadError && (
          <p role="alert" className="flex items-center gap-1 text-[11px] font-bold text-red-500">
            <AlertCircle className="h-3.5 w-3.5" /> {loadError}
          </p>
        )}

        {/* Req 3.3 — at least three named presets and an apply-to-all control. */}
        {canWrite && (
          <div
            className="space-y-3 rounded-2xl border border-zinc-200 p-4"
            data-testid="hours-shortcuts"
          >
            <div className="flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-brand" />
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Quick presets
              </h4>
            </div>
            <div className="flex flex-wrap gap-2">
              {HOURS_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  data-testid={`hours-preset-${preset.name}`}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 cursor-pointer transition-colors"
                >
                  {preset.name}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-3">
              <label className="inline-flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Apply open
                </span>
                <input
                  type="time"
                  aria-label="Apply open time to all open days"
                  value={applyOpen}
                  onChange={(e) => setApplyOpen(e.target.value)}
                  className={timeInputClass}
                />
              </label>
              <label className="inline-flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Apply close
                </span>
                <input
                  type="time"
                  aria-label="Apply close time to all open days"
                  value={applyClose}
                  onChange={(e) => setApplyClose(e.target.value)}
                  className={timeInputClass}
                />
              </label>
              <button
                type="button"
                onClick={applyToAll}
                className="rounded-full border border-zinc-300 bg-white px-4 py-1.5 text-[11px] font-bold text-zinc-700 hover:bg-zinc-50 cursor-pointer transition-colors"
              >
                Apply to all open days
              </button>
            </div>
            {applyError && (
              <p
                role="alert"
                className="flex items-center gap-1 text-[10px] font-bold text-red-500"
              >
                <AlertCircle className="h-3 w-3" /> {applyError}
              </p>
            )}
          </div>
        )}

        <div
          className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200"
          data-testid="operating-hours-list"
        >
          {days.map((day) => {
            const message = fieldErrors[`hours.${day.dayOfWeek}`];
            return (
              <div
                key={day.dayOfWeek}
                className="px-3.5 py-2.5"
                data-testid={`hours-row-${day.dayOfWeek}`}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-24 text-xs font-bold text-zinc-800">
                    {RESTAURANT_WEEKDAY_NAMES[day.dayOfWeek]}
                  </span>

                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={day.isClosed}
                      disabled={!canWrite}
                      aria-label={`${RESTAURANT_WEEKDAY_NAMES[day.dayOfWeek]} closed`}
                      onChange={(e) => update(day.dayOfWeek, { isClosed: e.target.checked })}
                      className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-900"
                    />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Closed
                    </span>
                  </label>

                  <label className="inline-flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Open
                    </span>
                    <input
                      type="time"
                      value={day.openTime}
                      disabled={!canWrite || day.isClosed}
                      aria-label={`${RESTAURANT_WEEKDAY_NAMES[day.dayOfWeek]} open time`}
                      onChange={(e) => update(day.dayOfWeek, { openTime: e.target.value })}
                      className={cn(timeInputClass, message && "border-red-300")}
                    />
                  </label>

                  <label className="inline-flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Close
                    </span>
                    <input
                      type="time"
                      value={day.closeTime}
                      disabled={!canWrite || day.isClosed}
                      aria-label={`${RESTAURANT_WEEKDAY_NAMES[day.dayOfWeek]} close time`}
                      onChange={(e) => update(day.dayOfWeek, { closeTime: e.target.value })}
                      className={cn(timeInputClass, message && "border-red-300")}
                    />
                  </label>
                </div>

                {message && (
                  <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-red-500">
                    <AlertCircle className="h-3 w-3" /> {message}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {fieldErrors.hours && (
          <p role="alert" className="flex items-center gap-1 text-[11px] font-bold text-red-500">
            <AlertCircle className="h-3.5 w-3.5" /> {fieldErrors.hours}
          </p>
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

        {/* No save control at all under `view_only` (Req 3.8). */}
        {canWrite && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 active:scale-[0.98] cursor-pointer transition-all"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save operating hours
            </button>
          </div>
        )}
      </form>

      {/* Req 4.1-4.11, 4.13 — the restaurant-scoped closure calendar. */}
      <RestaurantClosureCalendar
        canWrite={canWrite}
        requestedLocationId={requestedLocationId}
        fetchClosures={fetchClosures}
        createClosure={createClosure}
        deleteClosure={deleteClosure}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Restaurant closure calendar (Req 4.1-4.11, 4.13)
//
// A month grid interpreted in the tenant timezone with previous/next
// navigation. Every stored restaurant-scoped Closure_Day of the displayed month
// is marked. Under `operate`, selecting an unblocked day reveals a create
// control (reason + holiday flag), and a stored closure can be deleted. A stored
// closure on a date with existing bookings shows the affected-booking count as a
// warning (Req 4.9). Under `view_only` the calendar renders read-only with NO
// create or delete control (Req 4.13).
// ─────────────────────────────────────────────────────────────────────────────

const RESTAURANT_SCOPE: ClosureScope = { type: "restaurant" };

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

function RestaurantClosureCalendar({
  canWrite,
  requestedLocationId,
  fetchClosures,
  createClosure,
  deleteClosure,
}: {
  canWrite: boolean;
  requestedLocationId: string | null;
  fetchClosures: FetchRestaurantClosures;
  createClosure: CreateRestaurantClosure;
  deleteClosure: DeleteRestaurantClosure;
}) {
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
      const res = await fetchClosures({
        data: { year, month, scope: RESTAURANT_SCOPE, requestedLocationId },
      });
      setClosures(res.closures);
    } catch (err) {
      setError(errorText(err, "Could not load the closures"));
    } finally {
      setLoading(false);
    }
  }, [fetchClosures, year, month, requestedLocationId]);

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
        data: {
          date: selectedDate,
          scope: RESTAURANT_SCOPE,
          reason: reason.trim(),
          isHoliday,
          requestedLocationId,
        },
      });
      if (result.status === "created") {
        setReason("");
        setIsHoliday(false);
        setSelectedDate(null);
        await load();
      } else if (result.status === "invalid") {
        setError(result.errors[0]?.message ?? "The closure could not be created");
      } else {
        // duplicate (Req 4.5) / not_found — the stable message.
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
      data-testid="restaurant-closure-calendar"
      aria-label="Restaurant closure days"
      className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50/40 p-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-brand" />
          <h3 className="text-[11px] font-bold text-zinc-800">
            Closure days {!canWrite && "· view only"}
          </h3>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
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

      {/* Month grid (Req 4.1). */}
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
              data-closed={closed ? "true" : "false"}
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

      {/* The selected-day detail: an existing closure with its affected-booking
          warning and delete control, or the create control for an open day. */}
      {selectedDate && (
        <div
          data-testid="closure-detail"
          className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-zinc-700">{selectedDate}</span>
            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              aria-label="Clear selected date"
              className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {selectedClosure ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-zinc-600">
                Blocked{selectedClosure.reason ? ` · ${selectedClosure.reason}` : ""}
                {selectedClosure.isHoliday && " · holiday"}
              </p>
              {/* Req 4.9 — affected-booking count warning. */}
              {selectedClosure.affectedBookingCount > 0 && (
                <p
                  data-testid="closure-affected-warning"
                  role="alert"
                  className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-700"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {selectedClosure.affectedBookingCount}{" "}
                  {selectedClosure.affectedBookingCount === 1 ? "booking" : "bookings"} on this date
                  will remain but guests cannot book anew.
                </p>
              )}
              {/* Req 4.13 — no delete control under view_only. */}
              {canWrite && (
                <button
                  type="button"
                  onClick={() => void remove(selectedClosure)}
                  disabled={busy}
                  aria-label={`Delete closure on ${selectedClosure.date}`}
                  className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
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
            // Req 4.3 — the create control (reason + holiday flag).
            <div className="space-y-2">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Reason (optional)
                </span>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={LIMITS.closureReason.max}
                  placeholder="Public holiday"
                  aria-label="Closure reason"
                  className="mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all"
                />
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={isHoliday}
                  onChange={(e) => setIsHoliday(e.target.checked)}
                  aria-label="Mark as public holiday"
                  className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-900"
                />
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Public holiday
                </span>
              </label>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void create()}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-4 py-1.5 text-[10px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 cursor-pointer transition-all"
                >
                  {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                  Block this date
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[11px] font-semibold text-zinc-400">Open for bookings.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Alias matching the design's component name. */
export const OperatingHoursSettings = OperatingHours;

export default OperatingHours;
