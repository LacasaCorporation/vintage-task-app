import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  ChevronRight,
  Factory,
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
import UnitDetails from "@/components/UnitDetails";

type FgDoc = Doc<"finishedGoods">;

const inputCls =
  "h-10 w-full rounded-lg border bg-card px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30";

const selectCls =
  "h-10 w-full cursor-pointer appearance-none rounded-lg border bg-card px-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-primary/30";

/** The slabs most firms charge, offered so nobody types 18 for the nth time. */
const TAX_PRESETS = [0, 5, 12, 18, 28] as const;

/** Sentinel option value meaning "create a project while adding this product". */
const NEW_PROJECT = "__new_project__";

/** Reads a numeric field, treating a blank as "not set" rather than zero. */
const num = (value: string): number | undefined =>
  value.trim() === ""
    ? undefined
    : Number.isFinite(Number(value))
      ? Number(value)
      : undefined;

/** Label, control and the sentence that explains what the number is for. */
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
        {Icon !== undefined && (
          <Icon className="size-3.5 text-muted-foreground" />
        )}
        {label}
        {required === true && <span className="text-destructive">*</span>}
      </label>
      {children}
      {hint !== undefined && (
        <p className="text-[11px] leading-snug text-muted-foreground/85">
          {hint}
        </p>
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

/**
 * The whole product record, on a page of its own.
 *
 * Deliberately the same shape as the raw-material form: a master record is set
 * up once and read for years, and the two are used side by side, so learning
 * one should teach the other. Every standard field a material carries is here —
 * classification, stock control, tax rates, description — alongside the ones
 * only a product has, like its project and the batch it is made in.
 *
 * Works for a new product and for editing one, and hands the saved id back so
 * whatever opened it can select the record straight away.
 */
export default function ProductFormPage({
  editing,
  initialProject,
  onSaved,
  onCancel,
  backLabel,
}: {
  /** The product being edited, or null for a new one. */
  editing: FgDoc | null;
  /** The project it should start under, when raised from one. */
  initialProject?: string | null;
  /**
   * Saved — the id is handed up so whatever opened the page can select the
   * product straight away.
   */
  onSaved: (id: Id<"finishedGoods">) => void;
  /** Abandoned — go back to the list without saving anything. */
  onCancel: () => void;
  /**
   * Optional label for the back button. When missing, the default
   * "Products" is used. Lets the user know they will return to a
   * specific origin view (e.g. Projects, Active, Purchase · Bills)
   * rather than to the generic product list.
   */
  backLabel?: string;
}) {
  const addProduct = useMutation(api.costing.addFinishedGood);
  const updateProduct = useMutation(api.costing.updateFinishedGood);

  // managed master data, so the dropdowns offer the same values as the rest
  // of the app instead of free text that can drift
  const units = useQuery(api.costing.listUnits);
  const masterCategories = useQuery(api.costing.listCategories);
  const projects = useQuery(api.costing.listProjects);
  const topCategories = useMemo(
    () => (masterCategories ?? []).filter((c) => c.parentId === undefined),
    [masterCategories],
  );

  const [project, setProject] = useState(
    editing?.projectName ?? initialProject ?? "",
  );
  /** The name of a project being made right now, while adding this product. */
  const [newProjectName, setNewProjectName] = useState("");
  const addProjectM = useMutation(api.costing.addProject);
  const [name, setName] = useState(editing?.name ?? "");
  const [code, setCode] = useState(editing?.code ?? "");
  const [unit, setUnit] = useState(editing?.unit ?? "");
  const [qty, setQty] = useState(
    editing?.qty !== undefined ? String(editing.qty) : "",
  );
  const [category, setCategory] = useState(editing?.category ?? "");
  const [subCategory, setSubCategory] = useState(editing?.subCategory ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [markup, setMarkup] = useState(
    editing?.markupPct !== undefined && editing.markupPct > 0
      ? String(editing.markupPct)
      : "",
  );
  const [minStock, setMinStock] = useState(
    editing?.minStock !== undefined ? String(editing.minStock) : "",
  );
  const [reorderLevel, setReorderLevel] = useState(
    editing?.reorderLevel !== undefined ? String(editing.reorderLevel) : "",
  );
  const [salesTax, setSalesTax] = useState(
    editing?.salesTaxPct !== undefined ? String(editing.salesTaxPct) : "",
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

  const onHand = editing?.stock ?? 0;
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
      toast.error("Give the product a name.");
      return;
    }
    // a project named inline is made first, then the product is raised under
    // it — the product must not fail because the group did not exist yet
    let projectName = project.trim();
    if (projectName === NEW_PROJECT) {
      const fresh = newProjectName.trim();
      if (fresh === "") {
        toast.error("Give the new project a name, or pick an existing one.");
        return;
      }
      try {
        await addProjectM({ name: fresh });
        projectName = fresh;
      } catch {
        // the product can still be created under this project name
        projectName = fresh;
      }
    }
    setSaving(true);
    try {
      /** Every field the server shares between create and edit. */
      const standard = {
        name: clean,
        category: category.trim() || undefined,
        subCategory: subCategory.trim() || undefined,
        unit: unit.trim() || undefined,
        note: note.trim() || undefined,
        qty: num(qty),
        markupPct: num(markup),
        salesTaxPct: num(salesTax),
        minStock: num(minStock),
        reorderLevel: num(reorderLevel),
      };
      const id =
        editing !== null
          ? await updateProduct({
              id: editing._id,
              // sent back unchanged: the code is fixed once created
              code: editing.code ?? "",
              ...standard,
              projectName: projectName || undefined,
            })
          : await addProduct({
              code: code.trim() || undefined,
              ...standard,
              projectName: projectName || undefined,
            });
      toast.success(
        editing !== null
          ? `“${clean}” updated.`
          : `“${clean}” added to products.`,
      );
      onSaved(id as Id<"finishedGoods">);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the product.",
      );
    } finally {
      setSaving(false);
    }
  };

  const resolvedBackLabel = backLabel ?? "Products";
  const crumbs = [
    "Costing",
    resolvedBackLabel,
    editing !== null ? "Edit product" : "New product",
  ];

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
            onClick={onCancel}
          >
            <ArrowLeft className="size-3.5" /> {resolvedBackLabel}
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
            {editing !== null ? "Edit product" : "New product"}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-[1180px] px-4 pt-6 pb-10">
        {/* ── the title, and what this record is for ───────────────── */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Factory className="size-4" />
              </span>
              {editing !== null ? "Edit product" : "New product"}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              One master record every quote, order and stock ledger reads. A
              product stands on its own — no project needed to start.
            </p>
          </div>
          {editing !== null && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px]">
                {editing.code ?? "—"}
              </Badge>
              <Badge variant="outline" className="text-[11px]">
                {onHand.toLocaleString()} {editing.unit ?? "pcs"} on hand
              </Badge>
            </div>
          )}
        </div>

        <form
          onSubmit={handleSave}
          className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
        >
          <div className="min-w-0 space-y-5">
            {/* ── identity ─────────────────────────────────────────── */}
            <Section
              title="Identity"
              description="What this product is called, and how it is identified"
              icon={Package}
            >
              <div className="sm:col-span-2">
                <Field label="Product name" icon={Package} required>
                  <Input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Wooden chair"
                    aria-label="Product name"
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field
                label="Code"
                icon={Hash}
                hint={
                  editing !== null
                    ? "Fixed once created — every quote, order and ledger line quotes it."
                    : "Leave blank and one is generated (FG0001)."
                }
              >
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Auto (FG0001)"
                  disabled={editing !== null}
                  aria-label="Product code"
                  className={cn(inputCls, "font-mono")}
                />
              </Field>
              <Field
                label="Project"
                icon={Layers}
                hint="Optional — products are standalone. Attach one to group it."
              >
                <div className="flex gap-2">
                  <select
                    value={project}
                    onChange={(e) => {
                      // the sentinel means "make a new one", handled below
                      setProject(e.target.value);
                    }}
                    aria-label="Project"
                    className={cn(selectCls, "min-w-0 flex-1")}
                  >
                    <option value="">Standalone (no project)</option>
                    {(projects ?? []).map((p) => (
                      <option key={p._id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                    <option value={NEW_PROJECT}>+ New project…</option>
                  </select>
                  {project === NEW_PROJECT && (
                    <Input
                      autoFocus
                      value={newProjectName}
                      onChange={(e) => setNewProjectName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setProject("");
                      }}
                      placeholder="Project name"
                      aria-label="New project name"
                      className={cn(inputCls, "w-40 shrink-0")}
                    />
                  )}
                </div>
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Description"
                  icon={ScrollText}
                  hint="A line about the product — finish, size, what it is made of."
                >
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Solid oak, natural finish, 450mm seat height"
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
              description="Where it sits among the other products"
              icon={Tags}
            >
              <Field
                label="Category"
                icon={Layers}
                hint="The broad group — Furniture, Joinery, Finish."
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

            {/* ── sold per, and made in ────────────────────────────── */}
            <Section
              title="Unit and batch"
              description="How it is sold, and how many are made at a time"
              icon={Boxes}
            >
              <Field
                label="Sold per (unit)"
                icon={Boxes}
                hint="Used on quotes and costing sheets — pcs, set, box."
              >
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
              <Field
                label="Batch qty"
                icon={Boxes}
                hint="How many are made per run — offered by default when production starts."
              >
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="e.g. 12"
                  aria-label="Batch quantity"
                  className={cn(inputCls, "text-right tabular-nums")}
                />
              </Field>
            </Section>

            {/* ── pricing ──────────────────────────────────────────── */}
            <Section
              title="Pricing"
              description="What one sells for, over its own cost"
              icon={TrendingUp}
            >
              <Field
                label="Markup"
                icon={TrendingUp}
                hint="Added to the cost from the recipe to reach the selling price."
              >
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={markup}
                    onChange={(e) => setMarkup(e.target.value)}
                    placeholder="0"
                    aria-label="Markup percent"
                    className={cn(inputCls, "pr-9 text-right tabular-nums")}
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              </Field>
            </Section>

            {/* ── stock control ────────────────────────────────────── */}
            <Section
              title="Stock control"
              description="When this product is running low"
              icon={Boxes}
            >
              <Field
                label="Minimum stock"
                icon={TrendingDown}
                hint="Below this the product counts as short. Advisory — it never blocks a sale."
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
                hint="The quantity worth making or buying again."
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
              description="The rate this product usually sells at"
              icon={Percent}
            >
              <div className="space-y-1.5 sm:col-span-2">
                <Field
                  label="Sales tax"
                  icon={Percent}
                  hint="Filled into each new invoice and sales order line for this product."
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
                <Row
                  label="Name"
                  value={name.trim() === "" ? "—" : name.trim()}
                />
                <Row
                  label="Code"
                  value={
                    editing?.code ?? (code.trim() === "" ? "Auto" : code.trim())
                  }
                  mono
                />
                <Row
                  label="Project"
                  value={
                    project === NEW_PROJECT
                      ? newProjectName.trim() === ""
                        ? "New — name it"
                        : newProjectName.trim()
                      : project.trim() === ""
                        ? "Standalone"
                        : project.trim()
                  }
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
                <Row
                  label="Sold per"
                  value={unit.trim() === "" ? "pcs" : unit.trim()}
                />
                <Row
                  label="Batch"
                  value={num(qty) !== undefined ? String(num(qty)) : "—"}
                />
                <Row
                  label="Markup"
                  value={num(markup) !== undefined ? `${num(markup)}%` : "—"}
                />
                <Row
                  label="Stock control"
                  value={
                    minNum === undefined && reorderNum === undefined
                      ? "Not set"
                      : [
                          minNum !== undefined ? `min ${minNum}` : null,
                          reorderNum !== undefined
                            ? `reorder ${reorderNum}`
                            : null,
                        ]
                          .filter((v) => v !== null)
                          .join(" · ")
                  }
                />
                <Row
                  label="Sales tax"
                  value={salesTax === "" ? "Not set" : `${salesTax}%`}
                />
                {editing !== null && (
                  <Row
                    label="On hand"
                    value={`${onHand.toLocaleString()} ${editing.unit ?? "pcs"}`}
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
                onClick={onCancel}
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
                {editing !== null ? "Save changes" : "Add product"}
              </Button>
            </div>

            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              {editing !== null
                ? "The code cannot change once created — every quote, order and ledger line quotes it."
                : "Cost and selling price come from the recipe, so the costing sheet stays the source of truth."}
            </p>
          </aside>
        </form>
      </main>
    </div>
  );
}
