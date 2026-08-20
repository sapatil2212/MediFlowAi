// ─────────────────────────────────────────────────────────────────────────────
// BookingRules.tsx — the `Booking Rules` Settings sub-tab (Req 4.3-4.11).
//
// Slot_Interval, Turn_Time, Max_Party_Size, Advance_Booking_Window and
// Min_Lead_Time, every control bounded by `LIMITS` and every value decided by the
// same pure `validateServiceSettings` the server function runs. The save is
// all-or-nothing with one message per offending field (Req 4.8), and under a
// resolved `restaurant_config` permission other than `operate` the stored values
// render read-only with no save control (Req 2.8, 4.11).
//
// Changing these rules never moves an existing Occupancy_Window: every stored
// Table_Booking carries its own Turn_Time snapshot (Req 4.12).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, SlidersHorizontal } from "lucide-react";
import {
  DEFAULT_SETTINGS,
  LIMITS,
  SLOT_INTERVALS,
  validateServiceSettings,
  type FieldError,
  type RestaurantPermission,
  type ServiceSettings,
} from "../../lib/restaurant-availability";
import { getRestaurantRulesServerFn, saveRestaurantSettingsServerFn } from "../../lib/restaurant";
import { cn } from "../../lib/utils";

interface BookingRulesProps {
  /** The resolved `restaurant_config` permission (Req 2.8). */
  permission: RestaurantPermission;
}

type FormState = {
  slotInterval: string;
  turnTime: string;
  maxPartySize: string;
  advanceBookingWindow: string;
  minLeadTime: string;
  timezone: string;
};

const toForm = (s: ServiceSettings): FormState => ({
  slotInterval: String(s.slotInterval),
  turnTime: String(s.turnTime),
  maxPartySize: String(s.maxPartySize),
  advanceBookingWindow: String(s.advanceBookingWindow),
  minLeadTime: String(s.minLeadTime),
  timezone: s.timezone,
});

function errorMap(errors: FieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of errors) if (!map[e.field]) map[e.field] = e.message;
  return map;
}

const inputClass =
  "mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all disabled:bg-zinc-50 disabled:text-zinc-500";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1";

export function BookingRules({ permission }: BookingRulesProps) {
  const canWrite = permission === "operate";

  const [stored, setStored] = useState<ServiceSettings>(DEFAULT_SETTINGS);
  const [form, setForm] = useState<FormState>(toForm(DEFAULT_SETTINGS));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await getRestaurantRulesServerFn();
      setStored(res.settings as ServiceSettings);
      setForm(toForm(res.settings as ServiceSettings));
    } catch (e: any) {
      setLoadError(e?.message ?? "Could not load the booking rules.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSuccess(null);
  };

  const numeric = (v: string): number | null => (v.trim() === "" ? null : Number(v));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    // Req 4.8 — all-or-nothing, one FieldError per offending field.
    const result = validateServiceSettings({
      slotInterval: numeric(form.slotInterval),
      turnTime: numeric(form.turnTime),
      maxPartySize: numeric(form.maxPartySize),
      advanceBookingWindow: numeric(form.advanceBookingWindow),
      minLeadTime: numeric(form.minLeadTime),
      timezone: form.timezone,
    });

    if (!result.ok) {
      setFieldErrors(errorMap(result.errors));
      // Nothing is stored, so the previously stored values stay in force.
      setForm(toForm(stored));
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const res = await saveRestaurantSettingsServerFn({ data: result.value });
      setStored(res.settings as ServiceSettings);
      setForm(toForm(res.settings as ServiceSettings));
      setSuccess("Booking rules saved");
    } catch (err: any) {
      setFormError(err?.message ?? "Could not save the booking rules.");
      setForm(toForm(stored));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-brand" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            Booking rules {!canWrite && "· view only"}
          </h3>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {loadError && (
        <p className="flex items-center gap-1 text-[11px] font-bold text-red-500">
          <AlertCircle className="h-3.5 w-3.5" /> {loadError}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Slot interval (minutes)</span>
          <select
            value={form.slotInterval}
            disabled={!canWrite}
            onChange={(e) => set({ slotInterval: e.target.value })}
            className={cn(
              inputClass,
              "cursor-pointer",
              fieldErrors.slotInterval && "border-red-300",
            )}
          >
            {SLOT_INTERVALS.map((v) => (
              <option key={v} value={String(v)}>
                {v} minutes
              </option>
            ))}
          </select>
          {fieldErrors.slotInterval && <FieldMessage message={fieldErrors.slotInterval} />}
        </label>

        <NumberField
          label={`Turn time (${LIMITS.turnTime.min}-${LIMITS.turnTime.max} minutes)`}
          value={form.turnTime}
          min={LIMITS.turnTime.min}
          max={LIMITS.turnTime.max}
          disabled={!canWrite}
          error={fieldErrors.turnTime}
          onChange={(v) => set({ turnTime: v })}
        />

        <NumberField
          label={`Max party size (${LIMITS.maxPartySize.min}-${LIMITS.maxPartySize.max})`}
          value={form.maxPartySize}
          min={LIMITS.maxPartySize.min}
          max={LIMITS.maxPartySize.max}
          disabled={!canWrite}
          error={fieldErrors.maxPartySize}
          onChange={(v) => set({ maxPartySize: v })}
        />

        <NumberField
          label={`Advance booking window (${LIMITS.advanceBookingWindow.min}-${LIMITS.advanceBookingWindow.max} days)`}
          value={form.advanceBookingWindow}
          min={LIMITS.advanceBookingWindow.min}
          max={LIMITS.advanceBookingWindow.max}
          disabled={!canWrite}
          error={fieldErrors.advanceBookingWindow}
          onChange={(v) => set({ advanceBookingWindow: v })}
        />

        <NumberField
          label={`Minimum lead time (${LIMITS.minLeadTime.min}-${LIMITS.minLeadTime.max} minutes)`}
          value={form.minLeadTime}
          min={LIMITS.minLeadTime.min}
          max={LIMITS.minLeadTime.max}
          disabled={!canWrite}
          error={fieldErrors.minLeadTime}
          onChange={(v) => set({ minLeadTime: v })}
        />

        <label className="block">
          <span className={labelClass}>Timezone</span>
          <input
            type="text"
            value={form.timezone}
            disabled={!canWrite}
            onChange={(e) => set({ timezone: e.target.value })}
            placeholder={DEFAULT_SETTINGS.timezone}
            className={cn(inputClass, fieldErrors.timezone && "border-red-300")}
          />
          {fieldErrors.timezone && <FieldMessage message={fieldErrors.timezone} />}
        </label>
      </div>

      {formError && (
        <p className="flex items-center gap-1 text-[11px] font-bold text-red-500">
          <AlertCircle className="h-3.5 w-3.5" /> {formError}
        </p>
      )}
      {success && (
        <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> {success}
        </p>
      )}

      {/* No save control at all under `view_only` (Req 2.8, 4.11). */}
      {canWrite && (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 active:scale-[0.98] cursor-pointer transition-all"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save booking rules
          </button>
        </div>
      )}
    </form>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  error,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  disabled: boolean;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(inputClass, error && "border-red-300")}
      />
      {error && <FieldMessage message={error} />}
    </label>
  );
}

function FieldMessage({ message }: { message: string }) {
  return (
    <p className="mt-1 flex items-center gap-1 pl-1 text-[10px] font-bold text-red-500">
      <AlertCircle className="h-3 w-3" /> {message}
    </p>
  );
}

export default BookingRules;
