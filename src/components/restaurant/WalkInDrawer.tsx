// ─────────────────────────────────────────────────────────────────────────────
// WalkInDrawer.tsx — seat a walk-in guest from the dashboard (Req 9.7, 9.13).
//
// Guest name, Party_Size, booking date, Booking_Slot and table selection, the
// last of these through the shared `TableLayoutView` in `select` mode so a
// walk-in is picked from exactly the layout a guest sees. Submits to
// `createWalkInBookingServerFn`, which validates with the SAME
// `validateBookingRequest` rules as the public path and creates the booking with
// Booking_Status `Seated` (Property 15).
//
// The drawer renders nothing but a disabled state when the resolved
// `restaurant_bookings` permission is not `operate` (Req 9.13); the server refuses
// the write regardless.
//
// Stale responses are discarded: each availability request carries an
// incrementing `reqId` and a response is applied only when its echoed
// `requestedDate` and `requestedPartySize` match the current selection and its
// `reqId` is the latest issued (Req 6.4). Changing the Party_Size or the date
// resets the table selection to `Any available table` BEFORE the fresh
// availability is applied (Req 6.13).
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, UserPlus, X } from "lucide-react";
import {
  DEFAULT_SETTINGS,
  MSG_MULTIPLE_TABLES_NEEDED,
  MSG_CLOSED_ON_DATE,
  MSG_NO_TABLE_FREE,
  TABLE_SELECTION_ANY_LABEL,
  orderTables,
  validateBookingRequest,
  type AvailabilitySlot,
  type DiningTable,
  type FieldError,
  type RestaurantPermission,
} from "../../lib/restaurant-availability";
import {
  createWalkInBookingServerFn,
  getRestaurantAvailabilityServerFn,
} from "../../lib/restaurant";
import { cn } from "../../lib/utils";
import {
  INITIAL_TABLE_SELECTION,
  TableLayoutView,
  selectStateOf,
  tableSelectionReducer,
  type TableSelectionState,
} from "./TableLayoutView";

interface WalkInDrawerProps {
  tenantId: string;
  /** The resolved `restaurant_bookings` permission (Req 9.13). */
  permission: RestaurantPermission;
  open: boolean;
  onClose: () => void;
  locationId?: string | null;
  /** Called after a walk-in commits, so the caller can refresh its list. */
  onCreated?: () => void;
}

interface AvailabilitySnapshot {
  reqId: number;
  requestedDate: string;
  requestedPartySize: number;
  maxPartySize: number;
  closed: boolean;
  outOfWindow: boolean;
  requiresMultipleTables: boolean;
  slots: AvailabilitySlot[];
  tables: DiningTable[];
}

interface WalkInResult {
  tokenNo: number;
  tableName: string;
  slotLabel: string;
  date: string;
  partySize: number;
  status: string;
}

function errorMap(errors: FieldError[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of errors) if (!map[e.field]) map[e.field] = e.message;
  return map;
}

/** Today in the browser's own zone — a form default only; the server recomputes. */
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const inputClass =
  "mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1";

export function WalkInDrawer({
  tenantId,
  permission,
  open,
  onClose,
  locationId,
  onCreated,
}: WalkInDrawerProps) {
  const canOperate = permission === "operate";

  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [date, setDate] = useState(localToday);
  const [slotStartMinutes, setSlotStartMinutes] = useState<number | null>(null);
  const [selection, setSelection] = useState<TableSelectionState>({ ...INITIAL_TABLE_SELECTION });

  const [snapshot, setSnapshot] = useState<AvailabilitySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<WalkInResult | null>(null);
  const [saving, setSaving] = useState(false);

  /** The latest issued request id — the stale-response guard (Req 6.4). */
  const reqIdRef = useRef(0);

  const loadAvailability = useCallback(
    async (forDate: string, forPartySize: number) => {
      if (!canOperate || !tenantId || forDate.trim() === "") return;

      reqIdRef.current += 1;
      const reqId = reqIdRef.current;
      setLoading(true);
      try {
        const res = await getRestaurantAvailabilityServerFn({
          data: {
            tenantId,
            date: forDate,
            partySize: forPartySize,
            locationId: locationId ?? null,
            reqId,
          },
        });

        // Apply only the response that matches the request we are still waiting
        // for AND the selection currently on screen (Req 6.4).
        if (res.reqId !== reqIdRef.current) return;
        if (res.requestedDate !== forDate || res.requestedPartySize !== forPartySize) return;

        setSnapshot({
          reqId: res.reqId,
          requestedDate: res.requestedDate,
          requestedPartySize: res.requestedPartySize,
          maxPartySize: res.maxPartySize,
          closed: res.closed,
          outOfWindow: res.outOfWindow,
          requiresMultipleTables: res.requiresMultipleTables,
          slots: res.slots as AvailabilitySlot[],
          tables: res.tables as DiningTable[],
        });
      } catch (e: any) {
        if (reqId === reqIdRef.current) setFormError(e?.message ?? "Could not load availability.");
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    },
    [canOperate, tenantId, locationId],
  );

  useEffect(() => {
    if (!open) return;
    void loadAvailability(date, partySize);
  }, [open, date, partySize, loadAvailability]);

  /** Req 6.13 — a Party_Size or date change clears the selection first. */
  const changeDate = (v: string) => {
    setDate(v);
    setSlotStartMinutes(null);
    setSelection(tableSelectionReducer(selection, { type: "reset" }));
    setSnapshot(null);
    setFieldErrors({});
    setResult(null);
  };

  const changePartySize = (v: number) => {
    setPartySize(v);
    setSlotStartMinutes(null);
    setSelection(tableSelectionReducer(selection, { type: "reset" }));
    setSnapshot(null);
    setFieldErrors({});
    setResult(null);
  };

  const slots = snapshot?.slots ?? [];
  const slot = slots.find((s) => s.startMinutes === slotStartMinutes) ?? null;
  const availableTableIds = slot?.availableTableIds ?? [];
  const tables = orderTables(snapshot?.tables ?? []);
  const maxPartySize = snapshot?.maxPartySize ?? DEFAULT_SETTINGS.maxPartySize;

  const activate = (t: DiningTable) => {
    setSelection((s) =>
      tableSelectionReducer(s, { type: "activate", table: t, availableTableIds }),
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setResult(null);

    // Same validator, same messages as the public path (Property 15).
    const validated = validateBookingRequest(
      {
        guestName,
        phone,
        partySize,
        date,
        slotStartMinutes: slotStartMinutes ?? undefined,
        tableIds: selection.selectedTableIds,
      },
      {
        maxPartySize,
        slots,
        tables,
        phoneRequired: false,
      },
    );

    if (!validated.ok) {
      setFieldErrors(errorMap(validated.errors));
      return;
    }
    setFieldErrors({});

    setSaving(true);
    try {
      const res = await createWalkInBookingServerFn({
        data: {
          guestName: validated.value.guestName,
          phone: validated.value.phone,
          partySize: validated.value.partySize,
          date: validated.value.date,
          slotStartMinutes: validated.value.slotStartMinutes,
          tableIds: validated.value.tableIds,
          locationId: locationId ?? null,
        },
      });
      setResult({
        tokenNo: res.tokenNo,
        tableName: res.tableName,
        slotLabel: res.slotLabel,
        date: res.date,
        partySize: res.partySize,
        status: res.status,
      });
      setGuestName("");
      setPhone("");
      setSelection({ ...INITIAL_TABLE_SELECTION });
      setSlotStartMinutes(null);
      onCreated?.();
      void loadAvailability(date, partySize);
    } catch (err: any) {
      setFormError(err?.message ?? "Could not seat the walk-in.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[60] w-full max-w-md transform bg-white shadow-2xl transition-transform duration-300 sm:w-[26rem]",
        open ? "translate-x-0" : "translate-x-full",
      )}
      aria-hidden={!open}
      // A closed drawer stays mounted for the slide transition, so it is made
      // inert as well as hidden — otherwise its controls stay in the tab order.
      inert={!open}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-bold text-zinc-900">Seat a walk-in</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Req 9.13 — nothing but a disabled state below `operate`. */}
        {!canOperate ? (
          <div className="flex-1 p-5">
            <p className="flex items-center gap-1.5 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] font-bold text-zinc-400">
              <AlertCircle className="h-3.5 w-3.5" /> You are not authorised to change bookings.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto p-5">
            <label className="block">
              <span className={labelClass}>Guest name</span>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Walk-in guest"
                className={cn(inputClass, fieldErrors.guestName && "border-red-300")}
              />
              {fieldErrors.guestName && <FieldMessage message={fieldErrors.guestName} />}
            </label>

            <label className="block">
              <span className={labelClass}>Phone (optional)</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="9876543210"
                className={cn(inputClass, fieldErrors.phone && "border-red-300")}
              />
              {fieldErrors.phone && <FieldMessage message={fieldErrors.phone} />}
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className={labelClass}>Party size</span>
                <select
                  value={String(partySize)}
                  onChange={(e) => changePartySize(Number(e.target.value))}
                  className={cn(
                    inputClass,
                    "cursor-pointer",
                    fieldErrors.partySize && "border-red-300",
                  )}
                >
                  {Array.from({ length: maxPartySize }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
                {fieldErrors.partySize && <FieldMessage message={fieldErrors.partySize} />}
              </label>

              <label className="block">
                <span className={labelClass}>Date</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => changeDate(e.target.value)}
                  className={cn(inputClass, fieldErrors.date && "border-red-300")}
                />
                {fieldErrors.date && <FieldMessage message={fieldErrors.date} />}
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className={labelClass}>Time</span>
                {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}
              </div>

              {snapshot?.closed && (
                <p className="text-[11px] font-bold text-amber-600">{MSG_CLOSED_ON_DATE}</p>
              )}
              {snapshot?.requiresMultipleTables && (
                <p className="text-[11px] font-bold text-amber-600">{MSG_MULTIPLE_TABLES_NEEDED}</p>
              )}

              {!snapshot?.closed && slots.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {slots.map((s) => (
                    <button
                      key={s.startMinutes}
                      type="button"
                      aria-pressed={slotStartMinutes === s.startMinutes}
                      onClick={() => {
                        setSlotStartMinutes(s.startMinutes);
                        // A different slot has a different Available_Table set.
                        setSelection(tableSelectionReducer(selection, { type: "reset" }));
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all cursor-pointer",
                        slotStartMinutes === s.startMinutes
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50",
                      )}
                    >
                      {s.label}
                      <span className="ml-1 font-semibold text-[10px] opacity-70">
                        ({s.availableCount})
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {fieldErrors.slot && <FieldMessage message={fieldErrors.slot} />}

              {/* A slot with no free table stays selectable (Req 6.10). */}
              {slot && slot.availableCount === 0 && (
                <p className="text-[11px] font-bold text-amber-600">{MSG_NO_TABLE_FREE}</p>
              )}
            </div>

            {slot && (
              <div className="space-y-2">
                <span className={labelClass}>
                  Tables · {TABLE_SELECTION_ANY_LABEL} unless some are picked
                </span>
                <TableLayoutView
                  tables={tables}
                  stateOf={selectStateOf(availableTableIds, selection.selectedTableIds)}
                  onActivate={activate}
                  mode="select"
                  message={selection.message}
                />
                {fieldErrors.tableIds && <FieldMessage message={fieldErrors.tableIds} />}
              </div>
            )}

            {formError && (
              <p className="flex items-center gap-1 text-[11px] font-bold text-red-500">
                <AlertCircle className="h-3.5 w-3.5" /> {formError}
              </p>
            )}

            {result && (
              <div className="space-y-1 rounded-2xl border border-emerald-100 bg-emerald-50 p-3">
                <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Seated · token #{result.tokenNo}
                </p>
                <p className="text-[11px] font-semibold text-emerald-700">
                  {result.tableName} · {result.date} · {result.slotLabel} · party of{" "}
                  {result.partySize}
                </p>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 active:scale-[0.98] cursor-pointer transition-all"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Seat walk-in
              </button>
            </div>
          </form>
        )}
      </div>
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

export default WalkInDrawer;
