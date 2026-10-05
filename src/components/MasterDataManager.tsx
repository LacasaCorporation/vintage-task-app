import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  ArrowRightLeft,
  Check,
  ChevronRight,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  Ruler,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "@/lib/toast";
import { useAppDialogs } from "@/components/AppDialogs";
import { cn } from "@/lib/utils";

type UnitDoc = Doc<"costUnits">;
type CategoryDoc = Doc<"costCategories">;

/** Trim a float to at most 6 decimals so 1/12 doesn't print as 0.083333333333. */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * Manage units, categories, and sub-categories (create / rename / delete).
 *
 * Units form a conversion tree: a *base* unit (e.g. `pcs`) has no parent, and a
 * *derived* unit (e.g. `dozen`) points at the unit it converts to with a factor
 * (`1 dozen = 12 pcs`). Derived units nest, so pcs → dozen → box all work.
 */
export default function MasterDataManager({
  units,
  categories,
  onClose,
  embedded = false,
}: {
  units: UnitDoc[];
  categories: CategoryDoc[];
  /** Present only when shown as a dismissible panel (the Settings tab owns it). */
  onClose?: () => void;
  /** Drop the outer card chrome when placed inside an existing section. */
  embedded?: boolean;
}) {
  const addUnit = useMutation(api.costing.addUnit);
  const renameUnitM = useMutation(api.costing.renameUnit);
  const removeUnitM = useMutation(api.costing.removeUnit);
  const setConversionM = useMutation(api.costing.setUnitConversion);
  const addCategoryM = useMutation(api.costing.addCategory);
  const renameCategoryM = useMutation(api.costing.renameCategory);
  const removeCategoryM = useMutation(api.costing.removeCategory);
  const seedDefaultsM = useMutation(api.costing.seedDefaultMasterData);
  const { confirm } = useAppDialogs();

  const [tab, setTab] = useState<"units" | "categories">("units");
  const [newUnit, setNewUnit] = useState("");
  const [newUnitAbbrev, setNewUnitAbbrev] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newSubFor, setNewSubFor] = useState<Id<"costCategories"> | null>(null);
  const [newSubName, setNewSubName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingAbbrev, setEditingAbbrev] = useState("");
  const [busy, setBusy] = useState(false);

  // Units: derived-unit creator and conversion editor state.
  const [childFor, setChildFor] = useState<Id<"costUnits"> | null>(null);
  const [childName, setChildName] = useState("");
  const [childAbbrev, setChildAbbrev] = useState("");
  const [childFactor, setChildFactor] = useState("12");
  const [convFor, setConvFor] = useState<Id<"costUnits"> | null>(null);
  const [convParent, setConvParent] = useState<string>("");
  const [convFactor, setConvFactor] = useState<string>("");

  const parents = categories.filter((c) => c.parentId === undefined);
  const subsOf = (id: Id<"costCategories">) =>
    categories.filter((c) => c.parentId === id);

  const unitById = new Map(units.map((u) => [u._id, u] as const));
  const unitRoots = units.filter((u) => u.parentId === undefined);
  const childrenOfUnit = (id: Id<"costUnits">) =>
    units.filter((u) => u.parentId === id);

  /** Every unit nested under `id` — used to stop a unit becoming its own ancestor. */
  const unitDescendants = (id: Id<"costUnits">): Set<string> => {
    const out = new Set<string>();
    const walk = (parentId: Id<"costUnits">) => {
      for (const u of units) {
        if (u.parentId === parentId) {
          out.add(u._id);
          walk(u._id);
        }
      }
    };
    walk(id);
    return out;
  };

  const startEdit = (id: string, name: string, abbreviation = "") => {
    setEditingId(id);
    setEditingName(name);
    setEditingAbbrev(abbreviation);
  };

  const commitEdit = async () => {
    const id = editingId;
    const clean = editingName.trim();
    setEditingId(null);
    if (!id || !clean) return;
    setBusy(true);
    try {
      if (tab === "units")
        await renameUnitM({
          id: id as UnitDoc["_id"],
          name: clean,
          abbreviation: editingAbbrev.trim(),
        });
      else await renameCategoryM({ id: id as CategoryDoc["_id"], name: clean });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't rename.");
    } finally {
      setBusy(false);
    }
  };

  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newUnit.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await addUnit({
        name: clean,
        abbreviation: newUnitAbbrev.trim() || undefined,
      });
      setNewUnit("");
      setNewUnitAbbrev("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the unit.");
    } finally {
      setBusy(false);
    }
  };

  const handleAddUnitChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!childFor) return;
    const clean = childName.trim();
    const factor = Number(childFactor);
    if (!clean) return;
    if (!Number.isFinite(factor) || factor <= 0) {
      toast.error("The conversion factor must be greater than zero.");
      return;
    }
    setBusy(true);
    try {
      await addUnit({
        name: clean,
        parentId: childFor,
        factor,
        abbreviation: childAbbrev.trim() || undefined,
      });
      setChildName("");
      setChildAbbrev("");
      setChildFor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the unit.");
    } finally {
      setBusy(false);
    }
  };

  const startConversion = (u: UnitDoc) => {
    setConvFor(u._id);
    setConvParent(u.parentId ?? "");
    setConvFactor(u.factor !== undefined ? String(u.factor) : "12");
  };

  const commitConversion = async (u: UnitDoc) => {
    const target = convFor === u._id;
    if (!target) return;
    setBusy(true);
    try {
      if (convParent === "") {
        await setConversionM({ id: u._id, parentId: null });
      } else {
        const factor = Number(convFactor);
        if (!Number.isFinite(factor) || factor <= 0) {
          toast.error("The conversion factor must be greater than zero.");
          return;
        }
        await setConversionM({
          id: u._id,
          parentId: convParent as UnitDoc["_id"],
          factor,
        });
      }
      setConvFor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the conversion.");
    } finally {
      setBusy(false);
    }
  };

  const clearConversion = async (u: UnitDoc) => {
    setBusy(true);
    try {
      await setConversionM({ id: u._id, parentId: null });
      setConvFor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't clear the conversion.");
    } finally {
      setBusy(false);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newCat.trim();
    if (!clean) return;
    setBusy(true);
    try {
      await addCategoryM({ name: clean });
      setNewCat("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the category.");
    } finally {
      setBusy(false);
    }
  };

  const handleAddSub = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newSubName.trim();
    if (!clean || !newSubFor) return;
    setBusy(true);
    try {
      await addCategoryM({ name: clean, parentId: newSubFor });
      setNewSubName("");
      setNewSubFor(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the sub-category.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Fill the firm with the standard units, categories and sub-categories, so
   * the unit dropdowns on materials and products have something to offer from
   * the start. Anything already named the same is left untouched.
   */
  const handleSeedDefaults = async () => {
    const ok = await confirm({
      title: "Create the default units and categories?",
      message:
        "Adds the standard set — pieces, kg, litres, metres, hours and the rest, plus categories like Raw Material, Packaging and Consumable with their sub-categories. Anything you have already named the same is kept as it is.",
      confirmLabel: "Create defaults",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const added = await seedDefaultsM();
      const total = added.units + added.categories + added.subCategories;
      if (total === 0) {
        toast.info("Everything is already set up — nothing was added.");
        return;
      }
      const parts = [
        added.units > 0 ? `${added.units} unit${added.units === 1 ? "" : "s"}` : null,
        added.categories > 0
          ? `${added.categories} categor${added.categories === 1 ? "y" : "ies"}`
          : null,
        added.subCategories > 0
          ? `${added.subCategories} sub-categor${added.subCategories === 1 ? "y" : "ies"}`
          : null,
      ].filter((p): p is string => p !== null);
      toast.success(`Added ${parts.join(", ")}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't create the defaults.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteUnit = async (u: UnitDoc) => {
    const kids = childrenOfUnit(u._id);
    const ok = await confirm({
      title: `Delete unit “${u.name}”?`,
      message:
        kids.length > 0
          ? `Its ${kids.length} derived ${kids.length === 1 ? "unit keeps" : "units keep"} their value — they are re-measured against ${u.parentId !== undefined ? `“${unitById.get(u.parentId)?.name ?? "the parent unit"}”` : "no unit"}. Items using this unit keep their stored value.`
          : "Items using this unit keep their stored value — nothing else changes.",
      confirmLabel: "Delete unit",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeUnitM({ id: u._id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the unit.");
    }
  };

  const handleDeleteCategory = async (c: CategoryDoc) => {
    const subs = subsOf(c._id);
    const ok = await confirm({
      title: `Delete “${c.name}”?`,
      message:
        subs.length > 0
          ? `This category and its ${subs.length} sub-${subs.length === 1 ? "category" : "categories"} will be removed. Existing items keep their stored value.`
          : "Existing items keep their stored value — nothing else changes.",
      confirmLabel: "Delete category",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeCategoryM({ id: c._id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the category.");
    }
  };

  const editRowCls =
    "w-full rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary/30";
  const smallInputCls =
    "h-7 rounded-md border bg-card px-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30";

  /** One unit and, recursively, its derived units. */
  const renderUnit = (u: UnitDoc): React.ReactNode => {
    const kids = childrenOfUnit(u._id);
    const parent = u.parentId !== undefined ? unitById.get(u.parentId) : undefined;
    const candidates = units.filter(
      (c) => c._id !== u._id && !unitDescendants(u._id).has(c._id),
    );
    const invFactor =
      convFactor !== "" && Number(convFactor) > 0
        ? fmtNum(1 / Number(convFactor))
        : "";

    return (
      <div key={u._id} className="rounded-lg border bg-background px-2 py-1.5">
        <div className="flex items-center gap-1">
          <ChevronRight
            className={cn(
              "size-2.5 shrink-0 text-muted-foreground/50",
              kids.length === 0 && "opacity-0",
            )}
          />
          {editingId === u._id ? (
            <span className="flex min-w-0 flex-1 items-center gap-1">
              <input
                autoFocus
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                className={cn(editRowCls, "h-7 text-xs")}
              />
              <input
                value={editingAbbrev}
                onChange={(e) => setEditingAbbrev(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                placeholder="Abbrev."
                aria-label="Unit abbreviation"
                className={cn(editRowCls, "h-7 w-24 shrink-0 text-xs")}
              />
              <button
                type="button"
                aria-label="Save"
                className="grid size-6 place-items-center rounded-md text-emerald-600 hover:bg-accent"
                onClick={() => void commitEdit()}
              >
                <Check className="size-3" />
              </button>
              <button
                type="button"
                aria-label="Cancel"
                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
                onClick={() => setEditingId(null)}
              >
                <X className="size-3" />
              </button>
            </span>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {u.name}
                {u.fullName !== undefined &&
                  u.fullName.trim() !== "" &&
                  u.fullName.trim() !== u.name && (
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      {u.fullName}
                    </span>
                  )}
                {parent !== undefined && (
                  <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                    1 = {fmtNum(u.factor ?? 1)} {parent.name}
                  </span>
                )}
              </span>
              <div className="ml-5 flex flex-wrap items-center gap-0.5">
                <button
                  type="button"
                  aria-label={`Convert ${u.name}`}
                  title="Convert to another unit"
                  className={cn(
                    "grid size-7 place-items-center rounded-md text-xs font-medium hover:text-primary",
                    u.parentId !== undefined
                      ? "text-primary/70"
                      : "text-muted-foreground/50",
                  )}
                  onClick={() => startConversion(u)}
                >
                  <ArrowRightLeft className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Add derived unit under ${u.name}`}
                  title="Add a larger unit that converts to this one"
                  className="grid size-7 place-items-center rounded-md text-xs font-medium text-muted-foreground/50 hover:text-primary"
                onClick={() => {
                  setChildFor(u._id);
                  setChildName("");
                  setChildAbbrev("");
                  setChildFactor("12");
                }}
                >
                  <Plus className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Rename ${u.name}`}
                  title="Rename"
                  className="grid size-7 place-items-center rounded-md text-xs font-medium text-muted-foreground/50 hover:text-foreground"
                  onClick={() => startEdit(u._id, u.name, u.abbreviation ?? "")}
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${u.name}`}
                  title="Delete"
                  className="grid size-7 place-items-center rounded-md text-xs font-medium text-muted-foreground/50 hover:text-destructive"
                  onClick={() => void handleDeleteUnit(u)}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </>
          )}
        </div>

        {convFor === u._id && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void commitConversion(u);
            }}
            className="mt-2 ml-1 flex flex-wrap items-start gap-2 border-b border-border/60 pb-2 text-xs"
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              <span className="text-muted-foreground">1 {u.name} =</span>
              <input
                type="number"
                step="any"
                min="0"
                value={convFactor}
                onChange={(e) => setConvFactor(e.target.value)}
                disabled={convParent === ""}
                className={cn(smallInputCls, "w-20", convParent === "" && "opacity-50")}
              />
              <select
                value={convParent}
                onChange={(e) => setConvParent(e.target.value)}
                className={cn(smallInputCls, "max-w-36")}
              >
                <option value="">— base unit —</option>
                {candidates.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {convParent !== "" && (
              <div className="text-muted-foreground">
                ↔ 1 {unitById.get(convParent as UnitDoc["_id"])?.name} =
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={invFactor}
                  onChange={(e) =>
                    setConvFactor(
                      e.target.value === "" ? "" : String(1 / Number(e.target.value)),
                    )
                  }
                  className={cn(smallInputCls, "w-20")}
                />
                {u.name}
              </div>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-1">
              <Button
                type="submit"
                size="sm"
                variant="outline"
                className="h-7 rounded-md px-2"
                disabled={busy}
              >
                {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              </Button>
              {u.parentId !== undefined && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-md px-2"
                  title="Make this a base unit"
                  onClick={() => void clearConversion(u)}
                >
                  <Trash2 className="size-3" />
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 rounded-md px-2"
                onClick={() => setConvFor(null)}
              >
                <X className="size-3" />
              </Button>
            </div>
          </form>
        )}

        {childFor === u._id && (
          <form
            onSubmit={handleAddUnitChild}
            className="mt-1 ml-4 flex flex-wrap items-center gap-1"
          >
            <input
              autoFocus
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              placeholder="Larger unit, e.g. dozen"
              className={cn(smallInputCls, "min-w-0 flex-1")}
            />
            <input
              value={childAbbrev}
              onChange={(e) => setChildAbbrev(e.target.value)}
              placeholder="Abbrev."
              aria-label="Unit abbreviation"
              className={cn(smallInputCls, "w-24 shrink-0")}
            />
            <span className="text-xs text-muted-foreground">1 =</span>
            <input
              type="number"
              step="any"
              min="0"
              value={childFactor}
              onChange={(e) => setChildFactor(e.target.value)}
              className={cn(smallInputCls, "w-16")}
            />
            <span className="text-xs text-muted-foreground">{u.name}</span>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="h-7 rounded-md px-2"
              disabled={busy}
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 rounded-md px-2"
              onClick={() => setChildFor(null)}
            >
              <X className="size-3" />
            </Button>
          </form>
        )}

        {kids.length > 0 && (
          <div className="ml-4 mt-1 space-y-1 border-l border-border/60 pl-2">
            {kids.map((c) => renderUnit(c))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(!embedded && "rounded-xl border bg-card p-3 shadow-sm")}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setTab("units")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              tab === "units"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Ruler className="size-3" />
            Units
          </button>
          <button
            type="button"
            onClick={() => setTab("categories")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              tab === "categories"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FolderTree className="size-3" />
            Categories
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 rounded-lg text-xs"
            disabled={busy}
            onClick={() => void handleSeedDefaults()}
            title="Create the standard units, categories and sub-categories"
          >
            <Sparkles className="size-3" />
            Create defaults
          </Button>
          {onClose && (
          <button
            type="button"
            aria-label="Close manager"
            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
          )}
        </div>
      </div>

      {tab === "units" ? (
        <>
          <form onSubmit={handleAddUnit} className="mb-2 flex gap-1.5">
            <input
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              placeholder="Unit name, e.g. Kilogram…"
              className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
            />
            <input
              value={newUnitAbbrev}
              onChange={(e) => setNewUnitAbbrev(e.target.value)}
              placeholder="Abbrev., e.g. kg"
              aria-label="Unit abbreviation"
              className="h-8 w-28 shrink-0 rounded-lg border bg-background px-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
            />
            <Button type="submit" size="sm" variant="outline" className="h-8 rounded-lg" disabled={busy}>
              <Plus className="size-3.5" />
              Add
            </Button>
          </form>
          <p className="mb-2 px-0.5 text-[11px] text-muted-foreground">
            Convert between units with{" "}
            <ArrowRightLeft className="inline size-3 align-[-2px]" /> — e.g. set{" "}
            <span className="font-medium text-foreground">1 dozen = 12 pcs</span>. Derived
            units nest, so pcs → dozen → box works too.
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {unitRoots.map((u) => renderUnit(u))}
            {units.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                No units yet — add the ones you cost with.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <form onSubmit={handleAddCategory} className="mb-2 flex gap-1.5">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder="New category, e.g. Wood…"
              className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
            />
            <Button type="submit" size="sm" variant="outline" className="h-8 rounded-lg" disabled={busy}>
              <Plus className="size-3.5" />
              Add
            </Button>
          </form>
          <div className="max-h-44 space-y-1 overflow-y-auto">
            {parents.map((c) => {
              const subs = subsOf(c._id);
              return (
                <div key={c._id} className="rounded-lg border bg-background px-2 py-1.5">
                  <div className="flex items-center gap-1">
                    <Tag className="size-3 shrink-0 text-primary/70" />
                    {editingId === c._id ? (
                      <span className="flex min-w-0 flex-1 items-center gap-1">
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitEdit();
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className={cn(editRowCls, "h-7 text-xs")}
                        />
                        <button
                          type="button"
                          aria-label="Save"
                          className="grid size-6 place-items-center rounded-md text-emerald-600 hover:bg-accent"
                          onClick={() => void commitEdit()}
                        >
                          <Check className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Cancel"
                          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                        <button
                          type="button"
                          aria-label={`Add sub-category under ${c.name}`}
                          title="Add sub-category"
                          className="grid size-5 place-items-center rounded-md text-muted-foreground/60 hover:text-primary"
                          onClick={() => setNewSubFor(c._id)}
                        >
                          <Plus className="size-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Rename ${c.name}`}
                          className="grid size-5 place-items-center rounded-md text-muted-foreground/60 hover:text-foreground"
                          onClick={() => startEdit(c._id, c.name)}
                        >
                          <Pencil className="size-2.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete ${c.name}`}
                          className="grid size-5 place-items-center rounded-md text-muted-foreground/60 hover:text-destructive"
                          onClick={() => void handleDeleteCategory(c)}
                        >
                          <Trash2 className="size-2.5" />
                        </button>
                      </>
                    )}
                  </div>
                  {subs.length > 0 && (
                    <div className="ml-4 mt-1 space-y-0.5 border-l border-border/60 pl-2">
                      {subs.map((s) =>
                        editingId === s._id ? (
                          <span key={s._id} className="flex items-center gap-1 py-0.5">
                            <input
                              autoFocus
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commitEdit();
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              className={cn(editRowCls, "h-7 text-xs")}
                            />
                            <button
                              type="button"
                              aria-label="Save"
                              className="grid size-6 place-items-center rounded-md text-emerald-600 hover:bg-accent"
                              onClick={() => void commitEdit()}
                            >
                              <Check className="size-3" />
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel"
                              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent"
                              onClick={() => setEditingId(null)}
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ) : (
                          <span key={s._id} className="group/s flex items-center gap-1 py-0.5">
                            <ChevronRight className="size-2.5 shrink-0 text-muted-foreground/50" />
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                              {s.name}
                            </span>
                            <button
                              type="button"
                              aria-label={`Rename ${s.name}`}
                              className="grid size-5 place-items-center rounded-md text-muted-foreground/50 opacity-0 hover:text-foreground group-hover/s:opacity-100"
                              onClick={() => startEdit(s._id, s.name)}
                            >
                              <Pencil className="size-2.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${s.name}`}
                              className="grid size-5 place-items-center rounded-md text-muted-foreground/50 opacity-0 hover:text-destructive group-hover/s:opacity-100"
                              onClick={() =>
                                void removeCategoryM({ id: s._id }).catch(() =>
                                  toast.error("Couldn't delete the sub-category."),
                                )
                              }
                            >
                              <Trash2 className="size-2.5" />
                            </button>
                          </span>
                        ),
                      )}
                    </div>
                  )}
                  {newSubFor === c._id && (
                    <form onSubmit={handleAddSub} className="mt-1 ml-4 flex gap-1">
                      <input
                        autoFocus
                        value={newSubName}
                        onChange={(e) => setNewSubName(e.target.value)}
                        placeholder="Sub-category name…"
                        className="h-7 min-w-0 flex-1 rounded-md border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <Button type="submit" size="sm" variant="outline" className="h-7 rounded-md px-2" disabled={busy}>
                        {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-md px-2"
                        onClick={() => setNewSubFor(null)}
                      >
                        <X className="size-3" />
                      </Button>
                    </form>
                  )}
                </div>
              );
            })}
            {parents.length === 0 && (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                No categories yet — add your first one above.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
