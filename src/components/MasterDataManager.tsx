import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Check,
  ChevronRight,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  Ruler,
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

/** Manage units, categories, and sub-categories (create / rename / delete). */
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
  const addCategoryM = useMutation(api.costing.addCategory);
  const renameCategoryM = useMutation(api.costing.renameCategory);
  const removeCategoryM = useMutation(api.costing.removeCategory);
  const { confirm } = useAppDialogs();

  const [tab, setTab] = useState<"units" | "categories">("units");
  const [newUnit, setNewUnit] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newSubFor, setNewSubFor] = useState<Id<"costCategories"> | null>(null);
  const [newSubName, setNewSubName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [busy, setBusy] = useState(false);

  const parents = categories.filter((c) => c.parentId === undefined);
  const subsOf = (id: Id<"costCategories">) =>
    categories.filter((c) => c.parentId === id);

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const commitEdit = async () => {
    const id = editingId;
    const clean = editingName.trim();
    setEditingId(null);
    if (!id || !clean) return;
    setBusy(true);
    try {
      if (tab === "units") await renameUnitM({ id: id as UnitDoc["_id"], name: clean });
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
      await addUnit({ name: clean });
      setNewUnit("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the unit.");
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

  const handleDeleteUnit = async (u: UnitDoc) => {
    const ok = await confirm({
      title: `Delete unit “${u.name}”?`,
      message: "Items using this unit keep their stored value — nothing else changes.",
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

      {tab === "units" ? (
        <>
          <form onSubmit={handleAddUnit} className="mb-2 flex gap-1.5">
            <input
              value={newUnit}
              onChange={(e) => setNewUnit(e.target.value)}
              placeholder="New unit, e.g. kg, m, pcs…"
              className="h-8 min-w-0 flex-1 rounded-lg border bg-background px-2 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
            />
            <Button type="submit" size="sm" variant="outline" className="h-8 rounded-lg" disabled={busy}>
              <Plus className="size-3.5" />
              Add
            </Button>
          </form>
          <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
            {units.map((u) =>
              editingId === u._id ? (
                <span key={u._id} className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-7 w-24 rounded-md border bg-background px-1.5 text-xs outline-none focus:ring-2 focus:ring-primary/30"
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
                <span
                  key={u._id}
                  className="group/u inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pl-2.5 pr-1 text-xs"
                >
                  {u.name}
                  <button
                    type="button"
                    aria-label={`Rename ${u.name}`}
                    className="grid size-5 place-items-center rounded-full text-muted-foreground/50 hover:text-foreground"
                    onClick={() => startEdit(u._id, u.name)}
                  >
                    <Pencil className="size-2.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${u.name}`}
                    className="grid size-5 place-items-center rounded-full text-muted-foreground/50 hover:text-destructive"
                    onClick={() => void handleDeleteUnit(u)}
                  >
                    <Trash2 className="size-2.5" />
                  </button>
                </span>
              ),
            )}
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
