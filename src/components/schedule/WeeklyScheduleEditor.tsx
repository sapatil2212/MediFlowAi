// ─────────────────────────────────────────────────────────────────────────────
// WeeklyScheduleEditor — the "Weekly Availability Schedule" screen shared by
// every dashboard (clinic, salon, institute, gym, professional practice).
//
// Each weekday is split into three fixed sessions:
//   Morning    12:00 AM → 12:00 PM
//   Afternoon  12:00 PM →  4:00 PM
//   Evening     4:00 PM → 12:00 AM
// Every session can be switched on/off and given its own hours inside its
// band. Slot length and breaks stay per day. All rules live in the pure
// modules `day-sessions.ts` / `schedule-editor-model.ts`; this file is the view.
//
// The editor loads and saves the schedule itself, so a dashboard only renders
// <WeeklyScheduleEditor member={doctor} onClose={...} />.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Coffee,
  Copy,
  Loader2,
  MinusCircle,
  Moon,
  Plus,
  RotateCcw,
  Save,
  Sun,
  Sunrise,
  X,
} from "lucide-react";
import { getDoctorScheduleServerFn, saveDoctorScheduleServerFn } from "@/lib/auth";
import { FloatingMenu } from "@/components/ui/floating-menu";
import { normalizeBreaks, totalBreakMinutes, type BreakSlot } from "@/lib/doctor-schedule-breaks";
import {
  SESSION_BANDS,
  SESSION_KEYS,
  bandRangeLabel,
  formatClockLabel,
  parseClock,
  sessionWindows,
  type DaySessions,
  type SessionKey,
  type SessionWindow,
} from "@/lib/day-sessions";
import {
  SLOT_LENGTH_OPTIONS,
  WEEKDAY_NAMES,
  WEEKDAY_SHORT,
  addBreak,
  applyTemplateToActiveDays,
  copyBreakToDays,
  copyHoursToDays,
  editorDaysFromRows,
  isScheduleDirty,
  removeBreak,
  sessionTimeOptions,
  setEnabledDays,
  setSession,
  setSlotDuration,
  suggestBreak,
  summarizeDay,
  templateFromDays,
  toSavePayload,
  toggleDay,
  updateBreak,
  updateSessionWindow,
  validateEditorDays,
  type EditorDay,
} from "@/lib/schedule-editor-model";

export interface WeeklyScheduleEditorProps {
  /** The practitioner / staff member whose week is edited. */
  member: { id: string; name: string };
  onClose: () => void;
  /** Label of the header's back button. */
  backLabel?: string;
  /** Dashboard toast hook; the editor also shows its own inline messages. */
  onNotify?: (type: "success" | "error", message: string) => void;
}

const SESSION_ICONS: Record<SessionKey, React.ElementType> = {
  morning: Sunrise,
  afternoon: Sun,
  evening: Moon,
};

const PRESETS: { label: string; days: number[]; Icon: React.ElementType }[] = [
  { label: "Mon – Fri", days: [1, 2, 3, 4, 5], Icon: Briefcase },
  { label: "Mon – Sat", days: [1, 2, 3, 4, 5, 6], Icon: Building2 },
  { label: "All 7 Days", days: [0, 1, 2, 3, 4, 5, 6], Icon: CalendarDays },
  { label: "Weekends Only", days: [0, 6], Icon: Sunrise },
  { label: "Clear All", days: [], Icon: RotateCcw },
];

const SAVED_CLOSE_DELAY_MS = 1200;

/** "Midnight" / "Noon" / "9:30 AM" — short enough for the narrow pickers. */
function timeOptionLabel(value: string): string {
  const m = parseClock(value, true);
  if (m === null) return value;
  if (m === 0 || m === 1440) return "Midnight";
  if (m === 720) return "Noon";
  return formatClockLabel(m);
}

function slotLengthOptions(current: number): number[] {
  const set = new Set<number>(SLOT_LENGTH_OPTIONS);
  if (Number.isFinite(current) && current > 0) set.add(current);
  return [...set].sort((a, b) => a - b);
}

// ─── small building blocks ─────────────────────────────────────────────────

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
        checked ? "bg-brand" : "bg-zinc-300"
      }`}
    >
      <span
        className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-3.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

function TimeSelect({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-1.5 py-1 text-[11px] font-semibold text-zinc-700 focus:outline-none focus:border-brand cursor-pointer"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {timeOptionLabel(o)}
        </option>
      ))}
    </select>
  );
}

/** One session (Morning / Afternoon / Evening) of one day. */
function SessionTile({
  sessionKey,
  window: win,
  slotCount,
  slotDuration,
  onChange,
  compact = false,
}: {
  sessionKey: SessionKey;
  window: SessionWindow;
  slotCount: number | null;
  slotDuration: number;
  onChange: (patch: Partial<SessionWindow>) => void;
  compact?: boolean;
}) {
  const band = SESSION_BANDS[sessionKey];
  const Icon = SESSION_ICONS[sessionKey];
  const startMin = parseClock(win.start);
  const startOptions = sessionTimeOptions(sessionKey, "start", 15, win.start);
  const endOptions = sessionTimeOptions(sessionKey, "end", 15, win.end).filter((o) => {
    const m = parseClock(o, sessionKey === "evening");
    return o === win.end || startMin === null || (m !== null && m > startMin);
  });

  return (
    <div
      className={`rounded-xl border p-2.5 transition-colors ${
        win.enabled
          ? "border-brand/25 bg-white shadow-xs"
          : "border-dashed border-zinc-200 bg-zinc-50/70"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              win.enabled ? "bg-brand/10 text-brand" : "bg-zinc-100 text-zinc-400"
            }`}
          >
            <Icon className="h-3 w-3" />
          </span>
          <div className="min-w-0">
            <p
              className={`text-[11px] font-bold leading-tight ${
                win.enabled ? "text-zinc-800" : "text-zinc-400"
              }`}
            >
              {band.label}
            </p>
            {!compact && (
              <p className="text-[9px] font-medium text-zinc-400 leading-tight truncate">
                {bandRangeLabel(sessionKey)}
              </p>
            )}
          </div>
        </div>
        <Switch
          checked={win.enabled}
          onChange={(enabled) => onChange({ enabled })}
          label={`${band.label} session`}
        />
      </div>

      {win.enabled ? (
        <>
          <div className="mt-2 flex items-center gap-1">
            <TimeSelect
              value={win.start}
              options={startOptions}
              onChange={(start) => onChange({ start })}
              label={`${band.label} start time`}
            />
            <span className="text-[10px] font-bold text-zinc-400">→</span>
            <TimeSelect
              value={win.end}
              options={endOptions}
              onChange={(end) => onChange({ end })}
              label={`${band.label} end time`}
            />
          </div>
          {slotCount !== null &&
            (slotCount > 0 ? (
              <p className="mt-1.5 text-[9px] font-bold text-emerald-600">
                {slotCount} slot{slotCount === 1 ? "" : "s"}
              </p>
            ) : (
              <p className="mt-1.5 flex items-center gap-1 text-[9px] font-bold text-amber-600">
                <AlertTriangle className="h-2.5 w-2.5 shrink-0" />
                No {slotDuration}-min slot starts here
              </p>
            ))}
        </>
      ) : (
        <p className="mt-2 text-[9px] font-semibold text-zinc-400">Off — not bookable</p>
      )}
    </div>
  );
}

/** Day picker used by the "Copy … to" menus. */
function CopyToDaysMenu({
  open,
  title,
  fromDay,
  days,
  onClose,
  onApply,
}: {
  open: boolean;
  title: string;
  fromDay: number;
  days: EditorDay[];
  onClose: () => void;
  onApply: (targets: number[]) => void;
}) {
  const [targets, setTargets] = useState<number[]>([]);
  useEffect(() => {
    if (open) setTargets([]);
  }, [open]);
  const candidates = days.filter((d) => d.enabled && d.dayOfWeek !== fromDay);
  return (
    <FloatingMenu open={open} matchWidth={false} align="right" side="top" onClose={onClose}>
      <div className="bg-white border border-zinc-200 rounded-xl shadow-xl p-3 min-w-[200px]">
        <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider mb-2">{title}</p>
        {candidates.length === 0 ? (
          <p className="text-[10px] text-zinc-400 mb-2">Turn on another day first.</p>
        ) : (
          <div className="flex flex-wrap gap-1 mb-2">
            <button
              type="button"
              onClick={() =>
                setTargets((prev) =>
                  prev.length === candidates.length ? [] : candidates.map((d) => d.dayOfWeek),
                )
              }
              className="rounded-full px-2 py-0.5 text-[9px] font-bold border border-brand/30 text-brand bg-brand/5 cursor-pointer"
            >
              {targets.length === candidates.length ? "None" : "All"}
            </button>
            {candidates.map((d) => {
              const checked = targets.includes(d.dayOfWeek);
              return (
                <button
                  key={d.dayOfWeek}
                  type="button"
                  aria-pressed={checked}
                  onClick={() =>
                    setTargets((prev) =>
                      checked ? prev.filter((x) => x !== d.dayOfWeek) : [...prev, d.dayOfWeek],
                    )
                  }
                  className={`rounded-full px-2 py-0.5 text-[9px] font-bold border transition-all cursor-pointer ${
                    checked
                      ? "bg-black text-white border-zinc-800"
                      : "bg-zinc-50 border-zinc-200 text-zinc-500 hover:border-zinc-800/40"
                  }`}
                >
                  {WEEKDAY_SHORT[d.dayOfWeek]}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex gap-1.5 border-t border-zinc-100 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-full border border-zinc-200 py-1 text-[9px] font-bold text-zinc-400 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={targets.length === 0}
            onClick={() => {
              onApply(targets);
              onClose();
            }}
            className="flex-1 rounded-full bg-black text-white py-1 text-[9px] font-bold cursor-pointer disabled:opacity-40 flex items-center justify-center gap-1"
          >
            <Check className="h-2.5 w-2.5" /> Apply
          </button>
        </div>
      </div>
    </FloatingMenu>
  );
}

function BreakRow({
  day,
  index,
  br,
  days,
  windows,
  onChange,
  onRemove,
  onCopy,
}: {
  day: number;
  index: number;
  br: BreakSlot;
  days: EditorDay[];
  windows: { startMin: number; endMin: number }[];
  onChange: (patch: Partial<BreakSlot>) => void;
  onRemove: () => void;
  onCopy: (targets: number[]) => void;
}) {
  const [copyOpen, setCopyOpen] = useState(false);
  const norm = normalizeBreaks([br])[0];
  const mins = norm ? norm.endMin - norm.startMin : 0;
  // A break that touches no working session removes no slot: say so instead
  // of letting the slot count look wrong.
  const outside =
    !!norm && !windows.some((w) => norm.startMin < w.endMin && norm.endMin > w.startMin);
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-200 text-[8px] font-black text-amber-800 shrink-0">
        {index + 1}
      </span>
      <input
        type="text"
        value={br.label}
        maxLength={40}
        placeholder="Break name (e.g. Lunch)"
        aria-label="Break name"
        onChange={(e) => onChange({ label: e.target.value })}
        className="w-28 rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-semibold focus:outline-none focus:border-amber-400 text-zinc-700"
      />
      <Coffee className="h-3 w-3 text-amber-400 shrink-0" />
      <input
        type="time"
        value={br.start}
        aria-label="Break start"
        onChange={(e) => onChange({ start: e.target.value })}
        className="rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none focus:border-amber-400"
      />
      <span className="text-amber-400 text-[10px] font-bold">→</span>
      <input
        type="time"
        value={br.end}
        aria-label="Break end"
        onChange={(e) => onChange({ end: e.target.value })}
        className="rounded-lg border border-amber-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none focus:border-amber-400"
      />
      {mins > 0 ? (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 border border-amber-200 px-2 py-0.5 text-[9px] font-bold text-amber-700">
          <MinusCircle className="h-2.5 w-2.5" /> {mins} min
          {outside && " · outside sessions"}
        </span>
      ) : (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[9px] font-bold text-red-500">
          <X className="h-2.5 w-2.5" />
          {!br.start || !br.end ? "Set both times" : "End must be after start"}
        </span>
      )}
      <div className="relative ml-auto">
        <button
          type="button"
          onClick={() => setCopyOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white hover:bg-brand/5 hover:border-brand/30 hover:text-brand px-2 py-0.5 text-[9px] font-bold text-zinc-400 transition-all cursor-pointer"
        >
          <Copy className="h-2.5 w-2.5" /> Copy to days
        </button>
        {copyOpen && (
          <CopyToDaysMenu
            open={copyOpen}
            title="Copy this break to:"
            fromDay={day}
            days={days}
            onClose={() => setCopyOpen(false)}
            onApply={onCopy}
          />
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove break"
        className="inline-flex items-center gap-0.5 text-[9px] font-bold text-red-400 hover:text-red-600 cursor-pointer"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function DayCard({
  day,
  days,
  error,
  setDays,
}: {
  day: EditorDay;
  days: EditorDay[];
  error?: string;
  setDays: React.Dispatch<React.SetStateAction<EditorDay[]>>;
}) {
  const [copyOpen, setCopyOpen] = useState(false);
  const d = day.dayOfWeek;
  const summary = summarizeDay(day);
  const breakMins = totalBreakMinutes(normalizeBreaks(day.breaks));
  const windows = sessionWindows(day.sessions);

  return (
    <div
      className={`rounded-xl border bg-brand/[0.025] ${error ? "border-red-300" : "border-brand/15"}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-[9px] font-black">
            {WEEKDAY_NAMES[d].slice(0, 2)}
          </span>
          <span className="text-xs font-bold text-zinc-700">{WEEKDAY_NAMES[d]}</span>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[9px] font-bold ${
              summary.total > 0
                ? "bg-emerald-50 border-emerald-100 text-emerald-600"
                : "bg-red-50 border-red-100 text-red-500"
            }`}
          >
            <CheckCircle2 className="h-3 w-3" /> {summary.total} slots
          </span>
          {breakMins > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-600">
              <Coffee className="h-2.5 w-2.5" /> {breakMins} min break
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-400 font-semibold">Slot</span>
            <select
              value={day.slotDuration}
              onChange={(e) => setDays((prev) => setSlotDuration(prev, d, Number(e.target.value)))}
              className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold focus:outline-none focus:border-brand cursor-pointer"
            >
              {slotLengthOptions(day.slotDuration).map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setCopyOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white hover:bg-brand/5 hover:border-brand/30 hover:text-brand px-2.5 py-1 text-[9px] font-bold text-zinc-400 transition-all cursor-pointer"
            >
              <Copy className="h-3 w-3" /> Copy hours
            </button>
            {copyOpen && (
              <CopyToDaysMenu
                open={copyOpen}
                title={`Copy ${WEEKDAY_SHORT[d]} sessions & slot length to:`}
                fromDay={d}
                days={days}
                onClose={() => setCopyOpen(false)}
                onApply={(targets) => setDays((prev) => copyHoursToDays(prev, d, targets))}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => setDays((prev) => addBreak(prev, d, suggestBreak(day.breaks.length)))}
            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white hover:bg-amber-50 hover:border-amber-200 hover:text-amber-600 px-2.5 py-1 text-[9px] font-bold text-zinc-400 transition-all cursor-pointer"
          >
            <Coffee className="h-3 w-3" /> <Plus className="h-2.5 w-2.5" /> Add Break
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-3 pb-3">
        {SESSION_KEYS.map((key) => (
          <SessionTile
            key={key}
            sessionKey={key}
            window={day.sessions[key]}
            slotCount={summary.bySession[key]}
            slotDuration={day.slotDuration}
            onChange={(patch) => setDays((prev) => setSession(prev, d, key, patch))}
          />
        ))}
      </div>

      {error && (
        <p className="mx-3 mb-3 flex items-start gap-1.5 rounded-lg bg-red-50 border border-red-100 px-2.5 py-1.5 text-[10px] font-semibold text-red-600">
          <AlertTriangle className="h-3 w-3 mt-px shrink-0" /> {error}
        </p>
      )}

      {day.breaks.length > 0 && (
        <div className="border-t border-amber-100 bg-amber-50/40 divide-y divide-amber-100/70 rounded-b-xl">
          {day.breaks.map((br, i) => (
            <BreakRow
              key={i}
              day={d}
              index={i}
              br={br}
              days={days}
              windows={windows}
              onChange={(patch) => setDays((prev) => updateBreak(prev, d, i, patch))}
              onRemove={() => setDays((prev) => removeBreak(prev, d, i))}
              onCopy={(targets) => setDays((prev) => copyBreakToDays(prev, d, i, targets))}
            />
          ))}
          <div className="px-3 py-1.5">
            <button
              type="button"
              onClick={() => setDays((prev) => addBreak(prev, d, suggestBreak(day.breaks.length)))}
              className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-500 hover:text-amber-700 cursor-pointer"
            >
              <Plus className="h-3 w-3" /> Add another break
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── the editor ────────────────────────────────────────────────────────────

export function WeeklyScheduleEditor({
  member,
  onClose,
  backLabel = "Back",
  onNotify,
}: WeeklyScheduleEditorProps) {
  const [days, setDays] = useState<EditorDay[]>(() => editorDaysFromRows([]));
  const [baseline, setBaseline] = useState<EditorDay[] | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [template, setTemplate] = useState<{ sessions: DaySessions; slotDuration: number }>(() =>
    templateFromDays([]),
  );
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notifyRef = useRef(onNotify);
  notifyRef.current = onNotify;

  // Load this member's week. A stale response (member switched mid-flight)
  // is ignored so one person's hours can never be saved onto another.
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setLoadError("");
    setSavedMsg("");
    setSaveError("");
    getDoctorScheduleServerFn({ data: member.id })
      .then((rows: any[]) => {
        if (cancelled) return;
        const loaded = editorDaysFromRows(rows as any);
        setDays(loaded);
        setBaseline(loaded);
        setTemplate(templateFromDays(loaded));
        setLoadState("ready");
      })
      .catch((e: any) => {
        if (cancelled) return;
        const msg = e?.message || "Couldn't load this schedule";
        setLoadError(msg);
        setLoadState("error");
        notifyRef.current?.("error", msg);
      });
    return () => {
      cancelled = true;
    };
  }, [member.id, reloadToken]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const errors = useMemo(() => validateEditorDays(days), [days]);
  const enabledDays = days.filter((d) => d.enabled);
  const weeklySlots = enabledDays.reduce((sum, d) => sum + summarizeDay(d).total, 0);
  const dirty = baseline !== null && isScheduleDirty(days, baseline);
  const errorCount = Object.keys(errors).length;

  const requestClose = useCallback(() => {
    if (dirty && !savedMsg && typeof window !== "undefined") {
      if (!window.confirm("Discard your unsaved schedule changes?")) return;
    }
    onClose();
  }, [dirty, savedMsg, onClose]);

  const handleSave = async () => {
    setSaveError("");
    setSavedMsg("");
    if (enabledDays.length === 0) {
      setSaveError(
        "Turn on at least one working day. To pause bookings for a while, add a leave instead.",
      );
      return;
    }
    if (errorCount > 0) {
      setSaveError(
        `Fix ${errorCount === 1 ? "the highlighted day" : `the ${errorCount} highlighted days`} before saving.`,
      );
      return;
    }
    setSaving(true);
    try {
      const res: any = await saveDoctorScheduleServerFn({
        data: { doctorId: member.id, schedules: toSavePayload(days) },
      });
      if (res?.success) {
        setBaseline(days);
        setSavedMsg("Weekly availability saved successfully!");
        notifyRef.current?.("success", "Weekly availability saved");
        closeTimer.current = setTimeout(onClose, SAVED_CLOSE_DELAY_MS);
      } else {
        throw new Error("Failed to save schedule");
      }
    } catch (e: any) {
      const msg = e?.message || "Failed to save schedule";
      setSaveError(msg);
      notifyRef.current?.("error", msg);
    } finally {
      setSaving(false);
    }
  };

  const templateSummary = summarizeDay({
    dayOfWeek: 0,
    enabled: true,
    slotDuration: template.slotDuration,
    sessions: template.sessions,
    breaks: [],
  });

  return (
    <div className="space-y-5 border border-brand/20 bg-gradient-to-br from-brand/[0.02] to-indigo-50/30 rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
        <div>
          <h4 className="text-sm font-bold text-zinc-800 flex items-center gap-2">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand/10">
              <Calendar className="h-3.5 w-3.5 text-brand" />
            </span>
            Weekly Availability Schedule
          </h4>
          <p className="text-[10px] text-zinc-400 mt-0.5 pl-8">
            Configure working hours for <strong className="text-zinc-600">{member.name}</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={requestClose}
          className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-full px-3 py-1.5 transition-colors cursor-pointer"
        >
          <ChevronLeft className="h-3 w-3" /> {backLabel}
        </button>
      </div>

      {/* How sessions work */}
      <div className="grid grid-cols-3 gap-1.5">
        {SESSION_KEYS.map((key) => {
          const Icon = SESSION_ICONS[key];
          return (
            <div
              key={key}
              className="flex items-center gap-2 rounded-xl border border-zinc-150 bg-white px-2.5 py-2"
            >
              <Icon className="h-3.5 w-3.5 text-brand shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-zinc-700 leading-tight">
                  {SESSION_BANDS[key].label}
                </p>
                <p className="text-[9px] text-zinc-400 leading-tight truncate">
                  {bandRangeLabel(key)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {loadState === "loading" && (
        <div className="flex items-center justify-center gap-2 py-10 text-[11px] font-semibold text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin text-brand" /> Loading schedule…
        </div>
      )}

      {loadState === "error" && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-center space-y-2">
          <p className="text-xs font-bold text-red-600">{loadError}</p>
          <button
            type="button"
            onClick={() => setReloadToken((t) => t + 1)}
            className="rounded-full bg-black text-white px-4 py-1.5 text-[10px] font-bold cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {loadState === "ready" && (
        <>
          {/* Quick presets + same hours for every active day */}
          <div className="bg-white rounded-xl border border-zinc-150 p-3.5 space-y-3">
            <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
              Quick Presets — Apply to all days at once
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(({ label, days: presetDays, Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDays((prev) => setEnabledDays(prev, presetDays))}
                  className="flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 hover:bg-brand/5 hover:border-brand/30 px-3 py-1.5 text-[10px] font-bold text-zinc-600 hover:text-brand transition-all cursor-pointer"
                >
                  <Icon className="h-3 w-3" /> {label}
                </button>
              ))}
            </div>

            <div className="space-y-2 pt-2 border-t border-zinc-100">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider">
                  Apply same sessions to all active days
                </p>
                <div className="flex items-center gap-1.5">
                  <select
                    value={template.slotDuration}
                    aria-label="Slot length for all active days"
                    onChange={(e) =>
                      setTemplate((t) => ({ ...t, slotDuration: Number(e.target.value) }))
                    }
                    className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold focus:outline-none focus:border-brand cursor-pointer"
                  >
                    {slotLengthOptions(template.slotDuration).map((m) => (
                      <option key={m} value={m}>
                        {m} min slots
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={enabledDays.length === 0}
                    onClick={() =>
                      setDays((prev) =>
                        applyTemplateToActiveDays(prev, template.sessions, template.slotDuration),
                      )
                    }
                    title={enabledDays.length === 0 ? "Turn on a day first" : undefined}
                    className="rounded-full bg-black text-white text-[10px] font-bold px-3 py-1.5 hover:bg-black/90 cursor-pointer flex items-center gap-1 disabled:opacity-40"
                  >
                    <Check className="h-3 w-3" /> Apply
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {SESSION_KEYS.map((key) => (
                  <SessionTile
                    key={key}
                    compact
                    sessionKey={key}
                    window={template.sessions[key]}
                    slotCount={templateSummary.bySession[key]}
                    slotDuration={template.slotDuration}
                    onChange={(patch) =>
                      setTemplate((t) => ({
                        ...t,
                        sessions: {
                          ...t.sessions,
                          [key]: updateSessionWindow(t.sessions[key], key, patch, t.slotDuration),
                        },
                      }))
                    }
                  />
                ))}
              </div>
            </div>
          </div>

          {/* 7-day overview: click to switch a day on/off */}
          <div className="grid grid-cols-7 gap-1.5">
            {days.map((d) => {
              const summary = d.enabled ? summarizeDay(d) : null;
              const hasError = !!errors[d.dayOfWeek];
              return (
                <button
                  key={d.dayOfWeek}
                  type="button"
                  aria-pressed={d.enabled}
                  onClick={() => setDays((prev) => toggleDay(prev, d.dayOfWeek))}
                  className={`flex flex-col items-center rounded-xl border-2 px-1 py-2.5 text-center transition-all cursor-pointer ${
                    d.enabled
                      ? hasError
                        ? "border-red-300 bg-red-50/40"
                        : "border-brand bg-brand/8 shadow-sm"
                      : "border-zinc-150 bg-white hover:border-zinc-250"
                  }`}
                >
                  <span
                    className={`text-[9px] font-black uppercase tracking-wider ${d.enabled ? "text-brand" : "text-zinc-400"}`}
                  >
                    {WEEKDAY_SHORT[d.dayOfWeek]}
                  </span>
                  <div
                    className={`mt-1.5 h-7 w-7 rounded-full flex items-center justify-center ${
                      d.enabled ? "bg-black text-white" : "bg-zinc-100 text-zinc-350"
                    }`}
                  >
                    {d.enabled ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </div>
                  {d.enabled ? (
                    <>
                      <span className="mt-1.5 flex gap-0.5" aria-hidden="true">
                        {SESSION_KEYS.map((key) => (
                          <span
                            key={key}
                            title={SESSION_BANDS[key].label}
                            className={`inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[7px] font-black ${
                              d.sessions[key].enabled
                                ? "bg-brand text-white"
                                : "bg-zinc-100 text-zinc-300"
                            }`}
                          >
                            {SESSION_BANDS[key].label[0]}
                          </span>
                        ))}
                      </span>
                      <span className="mt-1 text-[8px] font-bold text-brand/70">
                        {summary?.total ?? 0} slots
                      </span>
                    </>
                  ) : (
                    <span className="mt-1.5 text-[8px] font-semibold text-zinc-300">Off</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Per-day sessions, slot length and breaks */}
          <div className="space-y-2">
            <p className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider pl-1 flex items-center gap-1">
              <Clock className="h-3 w-3" /> Sessions per Active Day
            </p>
            {enabledDays.map((d) => (
              <DayCard
                key={d.dayOfWeek}
                day={d}
                days={days}
                error={errors[d.dayOfWeek]}
                setDays={setDays}
              />
            ))}
            {enabledDays.length === 0 && (
              <div className="text-center py-6 text-zinc-350 text-xs font-semibold">
                Click on days above to activate them ↑
              </div>
            )}
          </div>

          {savedMsg && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center">
              <p className="text-xs font-bold text-emerald-600 flex items-center justify-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> {savedMsg}
              </p>
            </div>
          )}
          {saveError && (
            <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-center">
              <p className="text-xs font-bold text-red-600 flex items-center justify-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> {saveError}
              </p>
            </div>
          )}

          <div className="flex flex-wrap justify-between items-center gap-2 border-t border-zinc-100 pt-3">
            <span className="text-[10px] text-zinc-400">
              {enabledDays.length} working day{enabledDays.length !== 1 ? "s" : ""} · {weeklySlots}{" "}
              slots per week
              {dirty && !savedMsg && (
                <span className="ml-1.5 font-bold text-amber-600">· Unsaved changes</span>
              )}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={requestClose}
                className="rounded-full border border-zinc-200 px-4 py-2 text-xs font-semibold text-zinc-500 hover:bg-zinc-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !!savedMsg}
                onClick={handleSave}
                className="rounded-full bg-black text-white px-5 py-2 text-xs font-bold hover:bg-black/90 shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save Schedule
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default WeeklyScheduleEditor;
