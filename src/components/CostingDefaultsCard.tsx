import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save, SlidersHorizontal } from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const inputCls =
  "h-9 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30";

const selectCls =
  "h-9 w-full cursor-pointer appearance-none rounded-lg border bg-card px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/30";

/** Reads a numeric field, treating a blank as "not set" rather than zero. */
const numOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

/**
 * The values a new raw material or product starts with.
 *
 * Held here rather than hard-coded in each form so a firm can say "everything
 * we add is sold per pcs, classed as Furniture, taxed at 18%" once, and every
 * new record opens that way. The unit and categories are chosen from the
 * managed master data below, so a rename follows through instead of leaving a
 * stale name behind.
 */
export default function CostingDefaultsCard({
  units,
  categories,
}: {
  units: Doc<"costUnits">[];
  categories: Doc<"costCategories">[];
}) {
  const saved = useQuery(api.settings.getCostingDefaults);
  const setDefaults = useMutation(api.settings.setCostingDefaults);

  const [unitId, setUnitId] = useState<Id<"costUnits"> | "">("");
  const [categoryId, setCategoryId] = useState<Id<"costCategories"> | "">("");
  const [subCategoryId, setSubCategoryId] = useState<
    Id<"costCategories"> | ""
  >("");
  const [salesTax, setSalesTax] = useState("");
  const [purchaseTax, setPurchaseTax] = useState("");
  const [saving, setSaving] = useState(false);

  // mirror the saved choices once they load, so the card opens on them
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || saved === undefined) return;
    if (saved !== null) {
      setUnitId(saved.unitId ?? "");
      setCategoryId(saved.categoryId ?? "");
      setSubCategoryId(saved.subCategoryId ?? "");
      setSalesTax(
        saved.salesTaxPct !== undefined ? String(saved.salesTaxPct) : "",
      );
      setPurchaseTax(
        saved.purchaseTaxPct !== undefined ? String(saved.purchaseTaxPct) : "",
      );
    }
    setHydrated(true);
  }, [saved, hydrated]);

  const topCategories = useMemo(
    () => categories.filter((c) => c.parentId === undefined),
    [categories],
  );
  const subCategories = useMemo(
    () =>
      categoryId === ""
        ? []
        : categories.filter((c) => c.parentId === categoryId),
    [categories, categoryId],
  );

  /** A category's sub-category must belong to it, so clear a stale one. */
  const pickCategory = (next: Id<"costCategories"> | "") => {
    setCategoryId(next);
    const stillOffered =
      next !== "" &&
      categories.some((c) => c._id === subCategoryId && c.parentId === next);
    if (!stillOffered) setSubCategoryId("");
  };

  const save = async () => {
    setSaving(true);
    try {
      await setDefaults({
        unitId: unitId === "" ? null : unitId,
        categoryId: categoryId === "" ? null : categoryId,
        subCategoryId: subCategoryId === "" ? null : subCategoryId,
        salesTaxPct: numOrNull(salesTax),
        purchaseTaxPct: numOrNull(purchaseTax),
      });
      toast.success(
        "Defaults saved — new materials and products will start with them.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the defaults.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex items-start gap-2">
        <SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Defaults for new items</p>
          <p className="text-xs text-muted-foreground">
            What a new raw material or product opens with, so the same choices
            are not retyped on every record.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium">Unit</span>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value as Id<"costUnits"> | "")}
            aria-label="Default unit"
            className={selectCls}
          >
            <option value="">No default</option>
            {units.map((u) => (
              <option key={u._id} value={u._id}>
                {u.abbreviation?.trim() || u.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium">Category</span>
          <select
            value={categoryId}
            onChange={(e) =>
              pickCategory(e.target.value as Id<"costCategories"> | "")
            }
            aria-label="Default category"
            className={selectCls}
          >
            <option value="">No default</option>
            {topCategories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="text-xs font-medium">Sub-category</span>
          <select
            value={subCategoryId}
            onChange={(e) =>
              setSubCategoryId(e.target.value as Id<"costCategories"> | "")
            }
            disabled={categoryId === "" || subCategories.length === 0}
            aria-label="Default sub-category"
            className={cn(selectCls, "disabled:opacity-50")}
          >
            <option value="">
              {categoryId === "" ? "Pick a category first" : "No default"}
            </option>
            {subCategories.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="text-xs font-medium">Sales tax</span>
            <div className="relative">
              <Input
                type="number"
                min={0}
                max={100}
                step="any"
                value={salesTax}
                onChange={(e) => setSalesTax(e.target.value)}
                placeholder="Not set"
                aria-label="Default sales tax percent"
                className={cn(inputCls, "pr-8 text-right tabular-nums")}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                %
              </span>
            </div>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium">Purchase tax</span>
            <div className="relative">
              <Input
                type="number"
                min={0}
                max={100}
                step="any"
                value={purchaseTax}
                onChange={(e) => setPurchaseTax(e.target.value)}
                placeholder="Not set"
                aria-label="Default purchase tax percent"
                className={cn(inputCls, "pr-8 text-right tabular-nums")}
              />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                %
              </span>
            </div>
          </label>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 rounded-lg text-xs"
          onClick={() => void save()}
          disabled={saving || saved === undefined}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save defaults
        </Button>
        <span className="text-[11px] text-muted-foreground">
          Sub-category applies only when its category is the default too.
        </span>
      </div>
    </div>
  );
}
