// ─────────────────────────────────────────────────────────────────────────────
// DiningAreasSettings.tsx — the `Dining Areas` Settings sub-tab (Req 5.1-5.10).
//
// The dining-area registry takes the place of the Category_Dashboard category
// registry, expressed in restaurant terms. The panel:
//
//   1. Lists every stored Dining_Area of the resolved scope in the canonical
//      order (Area_Display_Order ascending, then Area_Name ascending compared
//      case-insensitively) together with the count of assigned Dining_Tables
//      (Req 5.1). The server returns the areas already ordered.
//   2. Under `operate`, creates a Dining_Area from a trimmed 1-to-30-character
//      Area_Name (Req 5.2, 5.3); a duplicate name or an out-of-range name shows
//      the stable message and stores nothing (Req 5.5, 5.6).
//   3. Under `operate`, deletes a Dining_Area with zero assigned tables; a
//      delete of an area that still owns tables is refused with a message that
//      names the assigned-table count (Req 5.4, 5.7).
//   4. Treats the synthetic `Main` area (returned when the scope holds no stored
//      area, Req 5.9) as read-only: it carries no stored id, so it offers no
//      delete control and is never counted as a duplicate by the server.
//   5. Under `view_only`, renders the areas read-only with NO create or delete
//      controls at all (Req 5.10).
//
// Every server interaction is an injected callback with a production default, so
// the DOM suite drives request/response timing exactly like
// `RestaurantProfilePanel.test.tsx` does.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  LayoutDashboard,
  Loader2,
  Lock,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  createRestaurantDiningAreaServerFn,
  deleteRestaurantDiningAreaServerFn,
  listRestaurantDiningAreasServerFn,
  type CreateRestaurantDiningAreaResult,
  type DeleteRestaurantDiningAreaResult,
  type RestaurantDiningAreasView,
} from "../../lib/restaurant-settings";
import {
  EFFECTIVE_MAIN_AREA_ID,
  LIMITS,
  type DiningArea,
  type FieldError,
} from "../../lib/restaurant-settings-model";
import type { RestaurantPermission } from "../../lib/restaurant-availability";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable callback contracts. Each mirrors the matching `createServerFn`
// signature so the production server functions drop in as the default and a
// fake drops in for the DOM suite.
// ─────────────────────────────────────────────────────────────────────────────

export type ListRestaurantDiningAreas = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<RestaurantDiningAreasView>;

export type CreateRestaurantDiningArea = (opts: {
  data: { name: string; displayOrder?: number | null; requestedLocationId?: string | null };
}) => Promise<CreateRestaurantDiningAreaResult>;

export type DeleteRestaurantDiningArea = (opts: {
  data: { areaId: string; requestedLocationId?: string | null };
}) => Promise<DeleteRestaurantDiningAreaResult>;

const inputClass =
  "mt-1 block w-full rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all";
const labelClass = "text-[10px] font-bold uppercase tracking-wider text-zinc-400 pl-1";

function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message.trim() || fallback;
}

/** The first `name` field error, or null. */
function nameErrorOf(errors: FieldError[]): string | null {
  const found = errors.find((e) => e.field === "name");
  return found?.message ?? errors[0]?.message ?? null;
}

export interface DiningAreasSettingsProps {
  /** The resolved `restaurant_config` permission (Req 5.10). */
  permission: RestaurantPermission;
  /** Owner-selected branch scope; forwarded verbatim to every server call. */
  requestedLocationId?: string | null;
  listAreas?: ListRestaurantDiningAreas;
  createArea?: CreateRestaurantDiningArea;
  deleteArea?: DeleteRestaurantDiningArea;
}

export function DiningAreasSettings({
  permission,
  requestedLocationId = null,
  listAreas = listRestaurantDiningAreasServerFn as unknown as ListRestaurantDiningAreas,
  createArea = createRestaurantDiningAreaServerFn as unknown as CreateRestaurantDiningArea,
  deleteArea = deleteRestaurantDiningAreaServerFn as unknown as DeleteRestaurantDiningArea,
}: DiningAreasSettingsProps) {
  const [view, setView] = useState<RestaurantDiningAreasView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await listAreas({ data: { requestedLocationId } });
      setView(res);
    } catch (err) {
      setLoadError(errorText(err, "Could not load the dining areas"));
    } finally {
      setLoading(false);
    }
  }, [listAreas, requestedLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The server view's `canManage` is authoritative; the permission prop is a
  // client hint that agrees with it. `view_only`/`none` render no controls.
  const canManage = (view?.canManage ?? permission === "operate") && permission === "operate";

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canManage) return;
      setNameError(null);
      setFormError(null);
      setSuccess(null);

      const trimmed = name.trim();
      if (trimmed.length < LIMITS.areaName.min || trimmed.length > LIMITS.areaName.max) {
        setNameError(`Enter a dining area name of 1 to ${LIMITS.areaName.max} characters`);
        return;
      }

      setSaving(true);
      try {
        const result = await createArea({ data: { name: trimmed, requestedLocationId } });
        if (result.status === "created") {
          setName("");
          setSuccess("Dining area added");
          await load();
        } else if (result.status === "invalid") {
          setNameError(nameErrorOf(result.errors));
        } else {
          // duplicate — the stable already-exists message (Req 5.6).
          setNameError(result.message);
        }
      } catch (err) {
        setFormError(errorText(err, "Could not create the dining area"));
      } finally {
        setSaving(false);
      }
    },
    [canManage, createArea, load, name, requestedLocationId],
  );

  const remove = useCallback(
    async (area: DiningArea) => {
      setBusyId(area.id);
      setFormError(null);
      setSuccess(null);
      try {
        const result = await deleteArea({ data: { areaId: area.id, requestedLocationId } });
        if (result.status === "deleted") {
          setConfirmDeleteId(null);
          setSuccess("Dining area deleted");
          await load();
        } else {
          // assigned_tables (Req 5.7) or not_found — show the stable message and
          // leave the area in place.
          setFormError(result.message);
          setConfirmDeleteId(null);
        }
      } catch (err) {
        setFormError(errorText(err, "Could not delete the dining area"));
        setConfirmDeleteId(null);
      } finally {
        setBusyId(null);
      }
    },
    [deleteArea, load, requestedLocationId],
  );

  const areas = view?.areas ?? [];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Dining areas</h3>
          <p className="text-[11px] font-semibold text-zinc-400">
            Group your tables into seating zones such as Main, Terrace, or Private Room
            {!canManage && " · view only"}
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {/* Req 5.10 — a view-only role sees the areas but no controls. */}
      {view?.readOnly && (
        <p
          data-testid="dining-areas-view-only"
          className="flex items-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
        >
          <Lock className="h-3.5 w-3.5" /> Your role can view but not change the dining areas.
        </p>
      )}

      {loadError && (
        <p role="alert" className="flex items-center gap-1 text-[11px] font-bold text-red-500">
          <AlertCircle className="h-3.5 w-3.5" /> {loadError}
        </p>
      )}

      {/* Req 5.1 — the ordered registry with assigned-table counts. */}
      {areas.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-10 text-center text-xs font-semibold text-zinc-400">
          No dining areas yet.
        </div>
      ) : (
        <div
          className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200"
          data-testid="dining-areas-list"
        >
          {areas.map((area) => {
            const synthetic = area.id === EFFECTIVE_MAIN_AREA_ID;
            return (
              <div key={area.id} className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
                <LayoutDashboard className="h-3.5 w-3.5 text-zinc-300" />
                <span className="text-xs font-bold text-zinc-800">{area.name}</span>
                <span
                  data-testid={`dining-area-count-${area.id}`}
                  className="text-[11px] font-semibold text-zinc-400"
                >
                  {area.tableCount} {area.tableCount === 1 ? "table" : "tables"}
                  {synthetic && " · default"}
                </span>

                {/* Delete is offered only under `operate`, and never for the
                    synthetic `Main` fallback, which has no stored id (Req 5.9, 5.10). */}
                {canManage && !synthetic && (
                  <div className="ml-auto flex items-center gap-1.5">
                    {confirmDeleteId === area.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void remove(area)}
                          disabled={busyId === area.id}
                          className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          {busyId === area.id ? (
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
                          setConfirmDeleteId(area.id);
                          setFormError(null);
                        }}
                        aria-label={`Delete ${area.name}`}
                        className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 cursor-pointer transition-colors"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
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

      {/* Req 5.2, 5.10 — the create control, absent entirely under `view_only`. */}
      {canManage && (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-200 p-4">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-brand" />
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Add a dining area
            </h4>
          </div>
          <label className="block">
            <span className={labelClass}>Area name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Terrace"
              maxLength={LIMITS.areaName.max}
              aria-label="Dining area name"
              className={cn(inputClass, nameError && "border-red-300")}
            />
            {nameError && (
              <p className="mt-1 flex items-center gap-1 pl-1 text-[10px] font-bold text-red-500">
                <AlertCircle className="h-3 w-3" /> {nameError}
              </p>
            )}
          </label>
          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 active:scale-[0.98] cursor-pointer transition-all"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add dining area
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default DiningAreasSettings;
