// ─────────────────────────────────────────────────────────────────────────────
// MenuSettings.tsx — the `Menu` Settings sub-tab (Req 6.1-6.8, 6.12-6.14,
// 9.3-9.7).
//
// The dashboard menu editor. The panel:
//
//   1. Lists every stored Menu_Category of the resolved scope in the canonical
//      order (Category_Display_Order ascending, then Category_Name ascending
//      compared case-insensitively), each with its Menu_Items in the same
//      display-order/name order (Req 6.1). The server returns the tree already
//      ordered; the panel renders it verbatim.
//   2. Shows the per-tenant limits (40 categories / 500 items) with the current
//      counts (Req 6.12), so an operator sees how much headroom remains.
//   3. Under `operate`, creates/edits/deletes categories and items (Req 6.2).
//      Item and category submissions surface every field error the server
//      returns as a validation summary (Req 6.4, 6.5); a cap hit shows the
//      stable max message (Req 6.13) and changes nothing.
//   4. Toggles a Menu_Item between `available` and `unavailable`; an
//      `unavailable` item is kept in the dashboard tree with its state shown
//      (Req 6.8).
//   5. Deletes a Menu_Category through the two-step cascade (Req 6.6, 6.7):
//      the first click calls the preview server fn and shows the returned item
//      count; only a second confirmed click deletes the category and its items.
//   6. Under `view_only`/`none`, renders the whole tree read-only with NO
//      create, edit, delete, or state controls at all (Req 6.14).
//
// Everything is branch-scope aware (Req 9.3-9.7): `requestedLocationId` (the
// owner-selected branch, or null for the primary restaurant) is forwarded
// verbatim on every call, and the server derives the authoritative scope. Each
// mutating form keeps a `draft` state separate from the `stored` tree returned
// by the server; a failed save leaves the stored tree untouched and never shows
// success. Every server interaction is an injected callback with a production
// default, so the DOM suite drives request/response timing exactly like
// `DiningAreasSettings.test.tsx`.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import {
  confirmDeleteRestaurantMenuCategoryServerFn,
  deleteRestaurantMenuItemServerFn,
  getRestaurantMenuServerFn,
  previewRestaurantMenuCategoryDeletionServerFn,
  saveRestaurantMenuCategoryServerFn,
  saveRestaurantMenuItemServerFn,
  setRestaurantMenuItemStateServerFn,
  type ConfirmDeleteRestaurantMenuCategoryResult,
  type DeleteRestaurantMenuItemResult,
  type PreviewRestaurantMenuCategoryDeletionResult,
  type RestaurantMenuView,
  type SaveRestaurantMenuCategoryResult,
  type SaveRestaurantMenuItemResult,
  type SetRestaurantMenuItemStateResult,
} from "../../lib/restaurant-settings";
import { LIMITS, type FieldError, type MenuCategory, type MenuItem } from "../../lib/restaurant-settings-model";
import type { RestaurantPermission } from "../../lib/restaurant-availability";
import { cn } from "../../lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Injectable callback contracts. Each mirrors the matching `createServerFn`
// signature so the production server function drops in as the default and a
// fake drops in for the DOM suite.
// ─────────────────────────────────────────────────────────────────────────────

export type FetchRestaurantMenu = (opts?: {
  data?: { requestedLocationId?: string | null };
}) => Promise<RestaurantMenuView>;

export type SaveRestaurantMenuCategory = (opts: {
  data: {
    categoryId?: string | null;
    name: string;
    displayOrder?: number | null;
    requestedLocationId?: string | null;
  };
}) => Promise<SaveRestaurantMenuCategoryResult>;

export type SaveRestaurantMenuItem = (opts: {
  data: {
    itemId?: string | null;
    categoryId: string;
    name: string;
    priceMinor: number | null;
    description?: string;
    displayOrder?: number | null;
    state?: string;
    requestedLocationId?: string | null;
  };
}) => Promise<SaveRestaurantMenuItemResult>;

export type SetRestaurantMenuItemState = (opts: {
  data: { itemId: string; state: string; requestedLocationId?: string | null };
}) => Promise<SetRestaurantMenuItemStateResult>;

export type DeleteRestaurantMenuItem = (opts: {
  data: { itemId: string; requestedLocationId?: string | null };
}) => Promise<DeleteRestaurantMenuItemResult>;

export type PreviewRestaurantMenuCategoryDeletion = (opts: {
  data: { categoryId: string; requestedLocationId?: string | null };
}) => Promise<PreviewRestaurantMenuCategoryDeletionResult>;

export type ConfirmDeleteRestaurantMenuCategory = (opts: {
  data: { categoryId: string; requestedLocationId?: string | null };
}) => Promise<ConfirmDeleteRestaurantMenuCategoryResult>;

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

/** Formats a whole number of minor currency units as a major-unit amount. */
function formatPrice(priceMinor: number): string {
  return (priceMinor / 100).toFixed(2);
}

interface CategoryFormState {
  id: string | null;
  name: string;
  displayOrder: string;
}

interface ItemFormState {
  id: string | null;
  categoryId: string;
  name: string;
  priceMinor: string;
  description: string;
  displayOrder: string;
}

const EMPTY_CATEGORY_FORM: CategoryFormState = { id: null, name: "", displayOrder: "" };

function emptyItemForm(categoryId: string): ItemFormState {
  return { id: null, categoryId, name: "", priceMinor: "", description: "", displayOrder: "" };
}

export interface MenuSettingsProps {
  /** The resolved `restaurant_config` permission (Req 6.14). */
  permission: RestaurantPermission;
  /** Owner-selected branch scope; forwarded verbatim to every server call. */
  requestedLocationId?: string | null;
  fetchMenu?: FetchRestaurantMenu;
  saveCategory?: SaveRestaurantMenuCategory;
  saveItem?: SaveRestaurantMenuItem;
  setItemState?: SetRestaurantMenuItemState;
  deleteItem?: DeleteRestaurantMenuItem;
  previewCategoryDeletion?: PreviewRestaurantMenuCategoryDeletion;
  confirmCategoryDeletion?: ConfirmDeleteRestaurantMenuCategory;
}

export function MenuSettings({
  permission,
  requestedLocationId = null,
  fetchMenu = getRestaurantMenuServerFn as unknown as FetchRestaurantMenu,
  saveCategory = saveRestaurantMenuCategoryServerFn as unknown as SaveRestaurantMenuCategory,
  saveItem = saveRestaurantMenuItemServerFn as unknown as SaveRestaurantMenuItem,
  setItemState = setRestaurantMenuItemStateServerFn as unknown as SetRestaurantMenuItemState,
  deleteItem = deleteRestaurantMenuItemServerFn as unknown as DeleteRestaurantMenuItem,
  previewCategoryDeletion = previewRestaurantMenuCategoryDeletionServerFn as unknown as PreviewRestaurantMenuCategoryDeletion,
  confirmCategoryDeletion = confirmDeleteRestaurantMenuCategoryServerFn as unknown as ConfirmDeleteRestaurantMenuCategory,
}: MenuSettingsProps) {
  const [view, setView] = useState<RestaurantMenuView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Category create/edit draft (Req 6.2). `null` means the form is closed.
  const [categoryForm, setCategoryForm] = useState<CategoryFormState | null>(null);
  const [categoryErrors, setCategoryErrors] = useState<Record<string, string>>({});
  const [savingCategory, setSavingCategory] = useState(false);

  // Item create/edit draft (Req 6.2). `null` means no item form is open.
  const [itemForm, setItemForm] = useState<ItemFormState | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [savingItem, setSavingItem] = useState(false);

  // Two-step category cascade (Req 6.6, 6.7). Holds the previewed count until
  // the operator confirms or cancels the delete.
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState<{
    id: string;
    name: string;
    itemCount: number;
  } | null>(null);

  // Inline single-item delete confirmation.
  const [confirmItemDeleteId, setConfirmItemDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetchMenu({ data: { requestedLocationId } });
      setView(res);
    } catch (err) {
      setLoadError(errorText(err, "Could not load the menu"));
    } finally {
      setLoading(false);
    }
  }, [fetchMenu, requestedLocationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // The server view's `canManage` is authoritative; the permission prop is a
  // client hint that agrees with it. `view_only`/`none` render no controls.
  const canManage = (view?.canManage ?? permission === "operate") && permission === "operate";
  const categories = view?.categories ?? [];

  const itemCount = useMemo(
    () => categories.reduce((total, c) => total + c.items.length, 0),
    [categories],
  );
  const atCategoryLimit = categories.length >= LIMITS.menuCategoriesPerTenant;
  const atItemLimit = itemCount >= LIMITS.menuItemsPerTenant;

  const clearFeedback = () => {
    setFormError(null);
    setSuccess(null);
  };

  // ── Category create/edit ──────────────────────────────────────────────────

  const openCreateCategory = () => {
    clearFeedback();
    setCategoryErrors({});
    setCategoryForm({ ...EMPTY_CATEGORY_FORM });
  };

  const openEditCategory = (category: MenuCategory) => {
    clearFeedback();
    setCategoryErrors({});
    setCategoryForm({
      id: category.id,
      name: category.name,
      displayOrder: String(category.displayOrder),
    });
  };

  const submitCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !categoryForm) return;
    clearFeedback();
    setCategoryErrors({});
    setSavingCategory(true);
    try {
      const result = await saveCategory({
        data: {
          categoryId: categoryForm.id,
          name: categoryForm.name,
          displayOrder:
            categoryForm.displayOrder.trim() === "" ? null : Number(categoryForm.displayOrder),
          requestedLocationId,
        },
      });
      if (result.status === "saved") {
        setSuccess(categoryForm.id ? "Menu category updated" : "Menu category added");
        setCategoryForm(null);
        await load();
      } else if (result.status === "invalid") {
        setCategoryErrors(errorMap(result.errors));
      } else {
        // duplicate / limit / not_found — the stable message.
        setFormError(result.message);
      }
    } catch (err) {
      setFormError(errorText(err, "Could not save the menu category"));
    } finally {
      setSavingCategory(false);
    }
  };

  // ── Category two-step cascade delete (Req 6.6, 6.7) ────────────────────────

  const startCategoryDelete = async (category: MenuCategory) => {
    clearFeedback();
    setBusyId(category.id);
    try {
      const result = await previewCategoryDeletion({
        data: { categoryId: category.id, requestedLocationId },
      });
      if (result.status === "preview") {
        // Show the returned cascade count; nothing is deleted yet (Req 6.6).
        setPendingCategoryDelete({
          id: category.id,
          name: category.name,
          itemCount: result.itemCount,
        });
      } else {
        setFormError(result.message);
      }
    } catch (err) {
      setFormError(errorText(err, "Could not prepare the category deletion"));
    } finally {
      setBusyId(null);
    }
  };

  const confirmCategoryDelete = async () => {
    if (!pendingCategoryDelete) return;
    const target = pendingCategoryDelete;
    setBusyId(target.id);
    clearFeedback();
    try {
      const result = await confirmCategoryDeletion({
        data: { categoryId: target.id, requestedLocationId },
      });
      if (result.status === "deleted") {
        setPendingCategoryDelete(null);
        setSuccess(
          result.deletedItemCount === 1
            ? "Menu category and 1 item deleted"
            : `Menu category and ${result.deletedItemCount} items deleted`,
        );
        await load();
      } else {
        setFormError(result.message);
        setPendingCategoryDelete(null);
      }
    } catch (err) {
      setFormError(errorText(err, "Could not delete the menu category"));
      setPendingCategoryDelete(null);
    } finally {
      setBusyId(null);
    }
  };

  // ── Item create/edit ──────────────────────────────────────────────────────

  const openCreateItem = (categoryId: string) => {
    clearFeedback();
    setItemErrors({});
    setItemForm(emptyItemForm(categoryId));
  };

  const openEditItem = (item: MenuItem) => {
    clearFeedback();
    setItemErrors({});
    setItemForm({
      id: item.id,
      categoryId: item.categoryId,
      name: item.name,
      priceMinor: String(item.priceMinor),
      description: item.description,
      displayOrder: String(item.displayOrder),
    });
  };

  const submitItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !itemForm) return;
    clearFeedback();
    setItemErrors({});
    setSavingItem(true);
    try {
      const result = await saveItem({
        data: {
          itemId: itemForm.id,
          categoryId: itemForm.categoryId,
          name: itemForm.name,
          priceMinor: itemForm.priceMinor.trim() === "" ? null : Number(itemForm.priceMinor),
          description: itemForm.description,
          displayOrder:
            itemForm.displayOrder.trim() === "" ? null : Number(itemForm.displayOrder),
          requestedLocationId,
        },
      });
      if (result.status === "saved") {
        setSuccess(itemForm.id ? "Menu item updated" : "Menu item added");
        setItemForm(null);
        await load();
      } else if (result.status === "invalid") {
        setItemErrors(errorMap(result.errors));
      } else {
        // limit / not_found — the stable message.
        setFormError(result.message);
      }
    } catch (err) {
      setFormError(errorText(err, "Could not save the menu item"));
    } finally {
      setSavingItem(false);
    }
  };

  // ── Item state toggle (Req 6.8) ────────────────────────────────────────────

  const toggleItemState = async (item: MenuItem) => {
    setBusyId(item.id);
    clearFeedback();
    try {
      const next = item.state === "available" ? "unavailable" : "available";
      const result = await setItemState({
        data: { itemId: item.id, state: next, requestedLocationId },
      });
      if (result.status === "saved") {
        await load();
      } else if (result.status === "invalid") {
        setFormError(result.errors[0]?.message ?? "Could not change the item state");
      } else {
        setFormError(result.message);
      }
    } catch (err) {
      setFormError(errorText(err, "Could not change the item state"));
    } finally {
      setBusyId(null);
    }
  };

  // ── Item delete ─────────────────────────────────────────────────────────────

  const removeItem = async (item: MenuItem) => {
    setBusyId(item.id);
    clearFeedback();
    try {
      const result = await deleteItem({ data: { itemId: item.id, requestedLocationId } });
      if (result.status === "deleted") {
        setConfirmItemDeleteId(null);
        setSuccess("Menu item deleted");
        await load();
      } else {
        setFormError(result.message);
        setConfirmItemDeleteId(null);
      }
    } catch (err) {
      setFormError(errorText(err, "Could not delete the menu item"));
      setConfirmItemDeleteId(null);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-zinc-900">Menu</h3>
          {/* Req 6.12 — per-tenant limits with the current counts. */}
          <p data-testid="menu-limits" className="text-[11px] font-semibold text-zinc-400">
            {categories.length} of {LIMITS.menuCategoriesPerTenant} categories · {itemCount} of{" "}
            {LIMITS.menuItemsPerTenant} items
            {!canManage && " · view only"}
          </p>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
      </div>

      {/* Req 6.14 — a view-only role sees the menu but no controls. */}
      {view?.readOnly && (
        <p
          data-testid="menu-view-only"
          className="flex items-center gap-1.5 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700"
        >
          <Lock className="h-3.5 w-3.5" /> Your role can view but not change the menu.
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
      {success && (
        <p className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> {success}
        </p>
      )}

      {/* Req 6.1 — the ordered category/item tree. */}
      {categories.length === 0 && !loading ? (
        <div className="rounded-2xl border border-dashed border-zinc-200 py-10 text-center text-xs font-semibold text-zinc-400">
          No menu categories yet.
        </div>
      ) : (
        <div className="space-y-3" data-testid="menu-list">
          {categories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              canManage={canManage}
              busyId={busyId}
              pendingDelete={
                pendingCategoryDelete?.id === category.id ? pendingCategoryDelete : null
              }
              confirmItemDeleteId={confirmItemDeleteId}
              atItemLimit={atItemLimit}
              onEditCategory={() => openEditCategory(category)}
              onDeleteCategory={() => void startCategoryDelete(category)}
              onConfirmCategoryDelete={() => void confirmCategoryDelete()}
              onCancelCategoryDelete={() => setPendingCategoryDelete(null)}
              onAddItem={() => openCreateItem(category.id)}
              onEditItem={openEditItem}
              onToggleItemState={(item) => void toggleItemState(item)}
              onRequestItemDelete={(id) => {
                setConfirmItemDeleteId(id);
                clearFeedback();
              }}
              onCancelItemDelete={() => setConfirmItemDeleteId(null)}
              onConfirmItemDelete={(item) => void removeItem(item)}
            />
          ))}
        </div>
      )}

      {/* Req 6.2, 6.14 — the create-category control, absent under view_only. */}
      {canManage && !categoryForm && (
        <button
          type="button"
          onClick={openCreateCategory}
          disabled={atCategoryLimit}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-4 py-2 text-[11px] font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer transition-colors"
        >
          <Plus className="h-3.5 w-3.5 text-brand" /> Add a menu category
        </button>
      )}
      {canManage && atCategoryLimit && !categoryForm && (
        <p className="text-[10px] font-semibold text-amber-600">
          You have reached the maximum of {LIMITS.menuCategoriesPerTenant} menu categories.
        </p>
      )}

      {/* The category create/edit form. */}
      {canManage && categoryForm && (
        <form onSubmit={submitCategory} className="space-y-3 rounded-2xl border border-zinc-200 p-4">
          <div className="flex items-center gap-2">
            <UtensilsCrossed className="h-4 w-4 text-brand" />
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {categoryForm.id ? "Edit menu category" : "Add a menu category"}
            </h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Category name</span>
              <input
                type="text"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm((f) => (f ? { ...f, name: e.target.value } : f))}
                placeholder="Starters"
                maxLength={LIMITS.menuCategoryName.max}
                aria-label="Menu category name"
                className={cn(inputClass, categoryErrors.name && "border-red-300")}
              />
              {categoryErrors.name && <FieldMessage message={categoryErrors.name} />}
            </label>
            <label className="block">
              <span className={labelClass}>Display order (optional)</span>
              <input
                type="number"
                inputMode="numeric"
                value={categoryForm.displayOrder}
                onChange={(e) =>
                  setCategoryForm((f) => (f ? { ...f, displayOrder: e.target.value } : f))
                }
                placeholder="next"
                aria-label="Menu category display order"
                className={cn(inputClass, categoryErrors.displayOrder && "border-red-300")}
              />
              {categoryErrors.displayOrder && <FieldMessage message={categoryErrors.displayOrder} />}
            </label>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCategoryForm(null)}
              className="rounded-full border border-zinc-200 px-4 py-2 text-[11px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingCategory}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 active:scale-[0.98] cursor-pointer transition-all"
            >
              {savingCategory && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {categoryForm.id ? "Save category" : "Add category"}
            </button>
          </div>
        </form>
      )}

      {/* The item create/edit form. Its category is fixed by the row that opened it. */}
      {canManage && itemForm && (
        <form onSubmit={submitItem} className="space-y-3 rounded-2xl border border-zinc-200 p-4">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-brand" />
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              {itemForm.id ? "Edit menu item" : "Add a menu item"}
            </h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Item name</span>
              <input
                type="text"
                value={itemForm.name}
                onChange={(e) => setItemForm((f) => (f ? { ...f, name: e.target.value } : f))}
                placeholder="Margherita pizza"
                maxLength={LIMITS.menuItemName.max}
                aria-label="Menu item name"
                className={cn(inputClass, itemErrors.name && "border-red-300")}
              />
              {itemErrors.name && <FieldMessage message={itemErrors.name} />}
            </label>
            <label className="block">
              <span className={labelClass}>Price (minor units)</span>
              <input
                type="number"
                inputMode="numeric"
                value={itemForm.priceMinor}
                onChange={(e) =>
                  setItemForm((f) => (f ? { ...f, priceMinor: e.target.value } : f))
                }
                placeholder="1200"
                aria-label="Menu item price"
                className={cn(inputClass, itemErrors.priceMinor && "border-red-300")}
              />
              {itemErrors.priceMinor && <FieldMessage message={itemErrors.priceMinor} />}
            </label>
            <label className="block sm:col-span-2">
              <span className={labelClass}>Description (optional)</span>
              <textarea
                value={itemForm.description}
                onChange={(e) =>
                  setItemForm((f) => (f ? { ...f, description: e.target.value } : f))
                }
                placeholder="Fresh tomato, mozzarella, and basil"
                maxLength={LIMITS.menuItemDescription.max}
                aria-label="Menu item description"
                rows={2}
                className={cn(
                  "mt-1 block w-full rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 focus:border-brand focus:outline-none transition-all",
                  itemErrors.description && "border-red-300",
                )}
              />
              {itemErrors.description && <FieldMessage message={itemErrors.description} />}
            </label>
            <label className="block">
              <span className={labelClass}>Display order (optional)</span>
              <input
                type="number"
                inputMode="numeric"
                value={itemForm.displayOrder}
                onChange={(e) =>
                  setItemForm((f) => (f ? { ...f, displayOrder: e.target.value } : f))
                }
                placeholder="next in category"
                aria-label="Menu item display order"
                className={cn(inputClass, itemErrors.displayOrder && "border-red-300")}
              />
              {itemErrors.displayOrder && <FieldMessage message={itemErrors.displayOrder} />}
            </label>
          </div>
          {itemErrors.categoryId && <FieldMessage message={itemErrors.categoryId} />}
          {itemErrors.itemCount && <FieldMessage message={itemErrors.itemCount} />}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setItemForm(null)}
              className="rounded-full border border-zinc-200 px-4 py-2 text-[11px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingItem}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-950 px-5 py-2 text-[11px] font-bold text-white hover:bg-zinc-850 disabled:opacity-50 active:scale-[0.98] cursor-pointer transition-all"
            >
              {savingItem && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {itemForm.id ? "Save item" : "Add item"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Category card — one collapsible category with its ordered items.
// ─────────────────────────────────────────────────────────────────────────────

function CategoryCard({
  category,
  canManage,
  busyId,
  pendingDelete,
  confirmItemDeleteId,
  atItemLimit,
  onEditCategory,
  onDeleteCategory,
  onConfirmCategoryDelete,
  onCancelCategoryDelete,
  onAddItem,
  onEditItem,
  onToggleItemState,
  onRequestItemDelete,
  onCancelItemDelete,
  onConfirmItemDelete,
}: {
  category: MenuCategory;
  canManage: boolean;
  busyId: string | null;
  pendingDelete: { id: string; name: string; itemCount: number } | null;
  confirmItemDeleteId: string | null;
  atItemLimit: boolean;
  onEditCategory: () => void;
  onDeleteCategory: () => void;
  onConfirmCategoryDelete: () => void;
  onCancelCategoryDelete: () => void;
  onAddItem: () => void;
  onEditItem: (item: MenuItem) => void;
  onToggleItemState: (item: MenuItem) => void;
  onRequestItemDelete: (id: string) => void;
  onCancelItemDelete: () => void;
  onConfirmItemDelete: (item: MenuItem) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      className="rounded-2xl border border-zinc-200"
      data-testid={`menu-category-${category.id}`}
    >
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`Toggle ${category.name}`}
          className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 cursor-pointer"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <UtensilsCrossed className="h-3.5 w-3.5 text-zinc-300" />
        <span className="text-xs font-bold text-zinc-800">{category.name}</span>
        <span className="text-[11px] font-semibold text-zinc-400">
          {category.items.length} {category.items.length === 1 ? "item" : "items"} · order{" "}
          {category.displayOrder}
        </span>

        {canManage && (
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onEditCategory}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
            >
              <Pencil className="h-3 w-3" /> Edit
            </button>
            {pendingDelete ? (
              <>
                <button
                  type="button"
                  onClick={onConfirmCategoryDelete}
                  disabled={busyId === category.id}
                  data-testid={`menu-category-confirm-delete-${category.id}`}
                  className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
                >
                  {busyId === category.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                  {/* Req 6.6 — the returned cascade count is shown before confirming. */}
                  Delete category and {pendingDelete.itemCount}{" "}
                  {pendingDelete.itemCount === 1 ? "item" : "items"}
                </button>
                <button
                  type="button"
                  onClick={onCancelCategoryDelete}
                  className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-400 cursor-pointer"
                >
                  <X className="h-3 w-3" /> Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onDeleteCategory}
                disabled={busyId === category.id}
                aria-label={`Delete ${category.name}`}
                className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
              >
                {busyId === category.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="divide-y divide-zinc-100 border-t border-zinc-100">
          {category.items.length === 0 ? (
            <p className="px-3.5 py-3 text-[11px] font-semibold text-zinc-400">
              No items in this category yet.
            </p>
          ) : (
            category.items.map((item) => (
              <div
                key={item.id}
                data-testid={`menu-item-${item.id}`}
                className="flex flex-wrap items-center gap-2 px-3.5 py-2.5"
              >
                <span className="text-xs font-bold text-zinc-800">{item.name}</span>
                <span className="text-[11px] font-semibold text-zinc-400">
                  {formatPrice(item.priceMinor)}
                </span>
                <span
                  data-testid={`menu-item-state-${item.id}`}
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold",
                    item.state === "available"
                      ? "bg-emerald-50 text-emerald-600"
                      : "bg-zinc-100 text-zinc-500",
                  )}
                >
                  {item.state === "available" ? "Available" : "Unavailable"}
                </span>

                {canManage && (
                  <div className="ml-auto flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onToggleItemState(item)}
                      disabled={busyId === item.id}
                      aria-label={
                        item.state === "available"
                          ? `Mark ${item.name} unavailable`
                          : `Mark ${item.name} available`
                      }
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer transition-colors"
                    >
                      {item.state === "available" ? (
                        <EyeOff className="h-3 w-3" />
                      ) : (
                        <Eye className="h-3 w-3" />
                      )}
                      {item.state === "available" ? "Mark unavailable" : "Mark available"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditItem(item)}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-50 cursor-pointer transition-colors"
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </button>
                    {confirmItemDeleteId === item.id ? (
                      <>
                        <button
                          type="button"
                          onClick={() => onConfirmItemDelete(item)}
                          disabled={busyId === item.id}
                          className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 disabled:opacity-50 cursor-pointer transition-colors"
                        >
                          {busyId === item.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Trash2 className="h-3 w-3" />
                          )}
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={onCancelItemDelete}
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[10px] font-bold text-zinc-400 cursor-pointer"
                        >
                          <X className="h-3 w-3" /> Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRequestItemDelete(item.id)}
                        aria-label={`Delete ${item.name}`}
                        className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-2.5 py-1 text-[10px] font-bold text-red-500 hover:bg-red-100 cursor-pointer transition-colors"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )}

          {canManage && (
            <div className="px-3.5 py-2.5">
              <button
                type="button"
                onClick={onAddItem}
                disabled={atItemLimit}
                className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-[10px] font-bold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer transition-colors"
              >
                <Plus className="h-3 w-3 text-brand" /> Add item to {category.name}
              </button>
            </div>
          )}
        </div>
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

export default MenuSettings;
