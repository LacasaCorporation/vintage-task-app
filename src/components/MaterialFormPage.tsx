import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  ChevronRight,
  Hash,
  Info,
  Layers,
  Loader2,
  Package,
  Percent,
  Plus,
  Save,
  ScrollText,
  Tags,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import UnitDetails from "@/components/UnitDetails";

type MaterialDoc = Doc<"rawMaterials">;

const inputCls =
  "h-10 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30";

const selectCls =
  "h-10 w-full cursor-pointer appearance-none rounded-lg border bg-card px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/30";

/** The slabs most firms charge, offered so nobody types 18 for the nth time. */
const TAX_PRESETS = [0, 5, 12, 18, 28] as const;

/** Reads a numeric field, treating a blank as "not set" rather than zero. */
const num = (value: string): number | undefined =>
  value.trim() === "" ? undefined : Number.isFinite(Number(value)) ? Number(value) : undefined;

/**
 * One field: label, control, and the sentence that explains what the number
 * is for. Grouped into sections so the page reads as a document rather than a
 * wall of boxes.
 */
function Field({
  label,
  hint,
  icon: Icon,
  required,
  children,
}: {
  label: string;
  hint?: string;
  icon?: typeof Package;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1.5 text-xs font-medium">
        {Icon !== undefined && <Icon className="size-3.5 text-muted-foreground" />}
        {label}
        {required === true && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint !== undefined && (
        <p className="text-[11px] leading-snug text-muted-foreground/85">{hint}</p>
      )}
    </div>
  );
}

/** A titled block of fields, so the page has a shape you can scan. */
function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: typeof Package;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex items-start gap-3 border-b bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent px-5 py-3.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/**
 * The whole raw-material record, on a page of its own.
 *
 * It used to be a five-field popup opened from a costing sheet, which stopped
 * being enough the moment stock control and tax rates had somewhere to live:
 * a master record is set up once and read for years, so it deserves the same
 * treatment as a document — its own address, room to breathe, and a place to
 * put every standard field rather than the three that fitted in a modal.
 *
 * Works for a new material and for editing one, and hands the saved id back so
 * whatever opened it can select the record straight away.
 */
export default function MaterialFormPage({
  editing,
  initialName,
  onDone,
}: {
  /** The material being edited, or null for a new one. */
  editing: MaterialDoc | null;
  /** The material already being looked for, prefilled as the new name. */
  initialName?: string;
  /**
   * Saved or abandoned — either way the record is done with, so the page hands
   * control back to the list it came from.
   */
  onDone: () => void;
}) {
  const addMaterial = useMutation(api.costing.addMaterial);
  const updateMaterial = useMutation(api.costing.updateMaterial);
  const { format: money } = useWorkspaceCurrency();

  // managed master data, so the dropdowns offer the same values as the rest
  // of the app instead of free text that can drift
  const units = useQuery(api.costing.listUnits);
  const masterCategories = useQuery(api.costing.listCategories);
  const topCategories = useMemo(
    () => (masterCategories ?? []).filter((c) => c.parentId === undefined),
    [masterCategories],
  );

  const [name, setName] = useState(editing?.name ?? initialName ?? "");
  const [code, setCode] = useState(editing?.code ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [subCategory, setSubCategory] = useState(editing?.subCategory ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? "");
  const [price, setPrice] = useState(
    editing !== null ? String(editing.pricePerUnit) : "0.00",
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [minStock, setMinStock] = useState(
    editing?.minStock !== undefined ? String(editing.minStock) : "0",
  );
  const [reorderLevel, setReorderLevel] = useState(
    editing?.reorderLevel !== undefined ? String(editing.reorderLevel) : "0",
  );
  const [salesTax, setSalesTax] = useState(
    editing?.salesTaxPct !== undefined ? String(editing.salesTaxPct) : "0",
  );
  const [purchaseTax, setPurchaseTax] = useState(
    editing?.purchaseTaxPct !== undefined ? String(editing.purchaseTaxPct) : "0",
  );
  const [saving, setSaving] = useState(false);

  /** Sub-categories belong to the category above them, so they narrow as you choose. */
  const subCategories = useMemo(() => {
    const parent = topCategories.find((c) => c.name === category);
    if (parent === undefined) return [];
    return (masterCategories ?? []).filter((c) => c.parentId === parent._id);
  }, [masterCategories, topCategories, category]);

  // choosing a category that has sub-categories must not leave a sub-category
  // behind that belongs to the old parent
  const pickCategory = (next: string) => {
    setCategory(next);
    const stillOffered = subCategories.some((c) => c.name === subCategory);
    if (next !== category && !stillOffered) setSubCategory("");
  };

  const priceNum = num(price);
  const onHand = editing?.stock ?? editing?.opening ?? 0;
  const minNum = num(minStock);
  const reorderNum = num(reorderLevel);
  const short = minNum !== undefined && onHand < minNum;
  const reorderSuggested =
    reorderNum !== undefined && reorderNum > 0 && onHand <= reorderNum;

  const taxPresets = (
    setter: (value: string) => void,
    current: string,
    label: string,
  ) => (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {TAX_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => setter(String(preset))}
          aria-label={`Set ${label} to ${preset}%`}
          className={cn(
            "rounded-lg border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
            "hover:border-primary/50 hover:bg-primary/10",
            Number(current) === preset
              ? "border-primary/40 bg-primary/10 text-primary"
              : "text-muted-foreground",
          )}
        >
          {preset}%
        </button>
      ))}
    </div>
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (clean === "") {
      toast.error("Give the material a name.");
      return;
    }
    if (priceNum === undefined || priceNum < 0) {
      toast.error("Enter a valid price per unit.");
      return;
    }
    setSaving(true);
    try {
      if (editing !== null) {
        await updateMaterial({
          id: editing._id,
          // sent back unchanged: the code is fixed once created
          code: editing.code ?? "",
          name: clean,
          category: category.trim() || undefined,
          subCategory: subCategory.trim() || undefined,
          unit: unit.trim() || editing.unit,
          pricePerUnit: priceNum,
          note: note.trim() || undefined,
          minStock: num(minStock),
          reorderLevel: num(reorderLevel),
          salesTaxPct: num(salesTax),
          purchaseTaxPct: num(purchaseTax),
        });
      } else {
        await addMaterial({
          code: code.trim() || undefined,
          name: clean,
          category: category.trim() || undefined,
          subCategory: subCategory.trim() || undefined,
          unit: unit.trim() || "pcs",
          pricePerUnit: priceNum,
          note: note.trim() || undefined,
          minStock: num(minStock),
          reorderLevel: num(reorderLevel),
          salesTaxPct: num(salesTax),
          purchaseTaxPct: num(purchaseTax),
        });
      }
      if (editing === null && unit.trim() === "") {
        toast.info("No unit chosen — saved as “pcs”.");
      }
      toast.success(
        editing !== null
          ? `“${clean}” updated.`
          : `“${clean}” added to raw materials.`,
      );
      onDone();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the material.",
      );
    } finally {
      setSaving(false);
    }
  };

  const crumbs = ["Costing", "Raw materials", editing !== null ? "Edit material" : "New material"];

  return (
    <div className="min-h-screen bg-background">
      {/* ── where you are, and a way back ─────────────────────────── */}
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 py-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs"
            onClick={onDone}
          >
            <ArrowLeft className="size-3.5" /> Materials
          </Button>
          <nav
            aria-label="Breadcrumb"
            className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex"
          >
            {crumbs.map((crumb, i) => (
              <span key={`${crumb}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="size-3" />}
                <span
                  className={cn(
                    i === crumbs.length - 1 && "font-medium text-foreground",
                  )}
                >
                  {crumb}
                </span>
              </span>
            ))}
          </nav>
          <p className="ml-auto flex items-center gap-2 text-sm font-semibold sm:hidden">
            <Package className="size-4 text-muted-foreground" />
            {editing !== null ? "Edit material" : "New material"}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 pt-6 pb-10">
        {/* ── the title, and what this record is for ───────────────── */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Package className="size-4" />
              </span>
              {editing !== null ? "Edit raw material" : "New raw material"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              One master record every costing sheet, purchase bill and stock
              ledger reads. Set it once and it stays right.
            </p>
          </div>
          {editing !== null && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px]">
                {editing.code ?? "—"}
              </Badge>
              <Badge variant="outline" className="text-[11px]">
                {onHand.toLocaleString()} {editing.unit} on hand
              </Badge>
            </div>
          )}
        </div>

        <form onSubmit={handleSave} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-5">
            {/* ── identity ─────────────────────────────────────────── */}
            <Section
              title="Identity"
              description="What this material is called, and how it is identified"
              icon={Package}
            >
              <div className="sm:col-span-2">
                <Field label="Name" icon={Package} required>
                  <Input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Oak board"
                    aria-label="Material name"
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field
                label="Code"
                icon={Hash}
                hint={
                  editing !== null
                    ? "Fixed once created — every bill and ledger line quotes it."
                    : "Leave blank and one is generated (RM0001)."
                }
              >
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Auto (RM0001)"
                  disabled={editing !== null}
                  aria-label="Material code"
                  className={cn(inputCls, "font-mono")}
                />
              </Field>
              <Field label="Unit" icon={Boxes} hint="What one of it is — kg, m, pcs, L.">
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  aria-label="Unit"
                  className={selectCls}
                >
                  <option value="">Not set</option>
                  {(units ?? []).map((u) => (
                    <option key={u._id} value={u.name}>
                      {u.abbreviation?.trim() || u.name}
                    </option>
                  ))}
                </select>
                <UnitDetails unit={unit} units={units ?? []} />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Description"
                  icon={ScrollText}
                  hint="A line about the material — grade, finish, supplier's wording."
                >
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. 18mm solid oak, planed both faces"
                    aria-label="Description"
                    rows={3}
                    className="w-full resize-y rounded-lg border bg-card px-3 py-2 text-sm outline-none transition-shadow placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
                  />
                </Field>
              </div>
            </Section>

            {/* ── classification ───────────────────────────────────── */}
            <Section
              title="Classification"
              description="Where it sits among the other materials"
              icon={Layers}
            >
              <Field
                label="Category"
                icon={Layers}
                hint="The broad group — Wood, Metal, Finish."
              >
                <select
                  value={category}
                  onChange={(e) => pickCategory(e.target.value)}
                  aria-label="Category"
                  className={selectCls}
                >
                  <option value="">Not set</option>
                  {topCategories.map((c) => (
                    <option key={c._id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="Sub-category"
                icon={Tags}
                hint={
                  category === ""
                    ? "Pick a category first — sub-categories belong to one."
                    : subCategories.length === 0
                      ? `No sub-categories under ${category} yet.`
                      : undefined
                }
              >
                <select
                  value={subCategory}
                  onChange={(e) => setSubCategory(e.target.value)}
                  disabled={category === "" || subCategories.length === 0}
                  aria-label="Sub-category"
                  className={cn(selectCls, "disabled:opacity-50")}
                >
                  <option value="">Not set</option>
                  {subCategories.map((c) => (
                    <option key={c._id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </Section>

            {/* ── pricing ──────────────────────────────────────────── */}
            <Section
              title="Pricing"
              description="What one of it costs to buy"
              icon={TrendingDown}
            >
              <Field
                label="Price per unit"
                icon={TrendingDown}
                required
                hint="The master cost every costing sheet prices this material at."
              >
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    aria-label="Price per unit"
                    className={cn(inputCls, "pr-12 text-right tabular-nums")}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                    {unit.trim() === "" ? "per unit" : `per ${unit.trim()}`}
                  </span>
                </div>
              </Field>
            </Section>

            {/* ── stock control ────────────────────────────────────── */}
            <Section
              title="Stock control"
              description="When this material is running low"
              icon={Boxes}
            >
              <Field
                label="Minimum stock"
                icon={TrendingDown}
                hint="Below this the material counts as short. Advisory — it never blocks a bill."
              >
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  placeholder="0"
                  aria-label="Minimum stock"
                  className={cn(inputCls, "text-right tabular-nums")}
                />
              </Field>
              <Field
                label="Reorder level"
                icon={TrendingUp}
                hint="The quantity worth raising a purchase order for."
              >
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={reorderLevel}
                  onChange={(e) => setReorderLevel(e.target.value)}
                  placeholder="0"
                  aria-label="Reorder level"
                  className={cn(inputCls, "text-right tabular-nums")}
                />
              </Field>
            </Section>

            {/* ── tax ──────────────────────────────────────────────── */}
            <Section
              title="Default tax"
              description="The rates this material usually carries"
              icon={Percent}
            >
              <div className="space-y-1.5">
                <Field
                  label="Sales tax"
                  icon={Percent}
                  hint="Offered when this material goes out on an invoice."
                >
                  <div className="relative">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={salesTax}
                      onChange={(e) => setSalesTax(e.target.value)}
                      placeholder="0"
                      aria-label="Default sales tax percent"
                      className={cn(inputCls, "pr-9 text-right tabular-nums")}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                </Field>
                {taxPresets(setSalesTax, salesTax, "sales tax")}
              </div>
              <div className="space-y-1.5">
                <Field
                  label="Purchase tax"
                  icon={Percent}
                  hint="Offered when this material is bought on a bill."
                >
                  <div className="relative">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step="any"
                      value={purchaseTax}
                      onChange={(e) => setPurchaseTax(e.target.value)}
                      placeholder="0"
                      aria-label="Default purchase tax percent"
                      className={cn(inputCls, "pr-9 text-right tabular-nums")}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                </Field>
                {taxPresets(setPurchaseTax, purchaseTax, "purchase tax")}
              </div>
            </Section>
          </div>

          {/* ── the record as it will stand, and the actions ──────── */}
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
            <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
              <div className="border-b bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent px-4 py-3">
                <p className="text-xs font-semibold">Summary</p>
                <p className="text-[11px] text-muted-foreground">
                  What gets saved, as it stands right now
                </p>
              </div>
              <dl className="space-y-2.5 px-4 py-3.5 text-sm">
                <Row label="Name" value={name.trim() === "" ? "—" : name.trim()} />
                <Row
                  label="Code"
                  value={editing?.code ?? (code.trim() === "" ? "Auto" : code.trim())}
                  mono
                />
                <Row
                  label="Category"
                  value={
                    category === ""
                      ? "—"
                      : subCategory === ""
                        ? category
                        : `${category} › ${subCategory}`
                  }
                />
                <Row label="Unit" value={unit.trim() === "" ? "pcs" : unit.trim()} />
                <Row
                  label="Price"
                  value={priceNum !== undefined ? money(priceNum) : "—"}
                />
                <Row
                  label="Stock control"
                  value={
                    minNum === undefined && reorderNum === undefined
                      ? "Not set"
                      : [
                          minNum !== undefined ? `min ${minNum}` : null,
                          reorderNum !== undefined ? `reorder ${reorderNum}` : null,
                        ]
                          .filter((v) => v !== null)
                          .join(" · ")
                  }
                />
                <Row
                  label="Tax"
                  value={
                    salesTax === "" && purchaseTax === ""
                      ? "Not set"
                      : [
                          salesTax === "" ? null : `sale ${salesTax}%`,
                          purchaseTax === "" ? null : `purchase ${purchaseTax}%`,
                        ]
                          .filter((v) => v !== null)
                          .join(" · ")
                  }
                />
                {editing !== null && (
                  <Row
                    label="On hand"
                    value={`${onHand.toLocaleString()} ${editing.unit}`}
                  />
                )}
              </dl>
            </div>

            {(short || reorderSuggested) && (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {short
                  ? `On hand is below the minimum of ${minNum}.`
                  : `On hand has reached the reorder level of ${reorderNum}.`}
              </p>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-10 flex-1 rounded-lg"
                onClick={onDone}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="h-10 flex-1 gap-1.5 rounded-lg"
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : editing !== null ? (
                  <Save className="size-3.5" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                {editing !== null ? "Save changes" : "Add material"}
              </Button>
            </div>

            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              {editing !== null
                ? "The code cannot change once created — every bill and ledger line quotes it."
                : "Added to the raw-materials list. Every costing sheet, bill and ledger reads it from there."}
            </p>
          </aside>
        </form>
      </main>
    </div>
  );
}

/** One label / value line in the summary rail. */
function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 truncate text-right font-medium",
          mono === true && "font-mono text-xs",
        )}
      >
        {value}
      </dd>
    </div>
  );
}