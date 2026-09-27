import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Briefcase,
  Download,
  Folder,
  Loader2,
  Package,
  Plus,
  Search as SearchIcon,
  Sigma,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useAppDialogs } from "@/components/AppDialogs";
import { cn } from "@/lib/utils";

type FgDoc = Doc<"finishedGoods">;

const inputCls =
  "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30";

const selectCls =
  "h-9 w-full rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50";

/** Sentinel option value meaning “create a project while adding this product”. */
const NEW_PROJECT = "__new_project__";

/** Label + control + optional hint, used by the new-product popup. */
function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-destructive">*</span>}
      </span>
      {children}
      {hint && (
        <span className="block text-[10px] text-muted-foreground/70">{hint}</span>
      )}
    </label>
  );
}

/** Section heading inside the popup. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Products page: add-product form + Excel-style listing of FG products with costs. */
export default function ProductForm({
  finishedGoods,
  onSelectFg,
  activeFgId,
  initialProject,
}: {
  finishedGoods: FgDoc[];
  onSelectFg: (id: Id<"finishedGoods">) => void;
  activeFgId: Id<"finishedGoods"> | null;
  initialProject?: string | null;
}) {
  const removeFg = useMutation(api.costing.removeFinishedGood);
  const { confirm } = useAppDialogs();
  const addFg = useMutation(api.costing.addFinishedGood);
  const addProjectM = useMutation(api.costing.addProject);
  const { format: money, code: currencyCode, symbol } = useWorkspaceCurrency();

  // managed master data for dropdowns
  const masterUnits = useQuery(api.costing.listUnits);
  const masterCategories = useQuery(api.costing.listCategories);
  const projectDocs = useQuery(api.costing.listProjects);
  const units = masterUnits ?? [];
  const parentCategories = (masterCategories ?? []).filter((c) => c.parentId === undefined);
  const allCategories = masterCategories ?? [];
  const subsOf = (name: string) => {
    const parent = parentCategories.find((c) => c.name === name);
    if (!parent) return [];
    return allCategories.filter((c) => c.parentId === parent._id);
  };
  const [project, setProject] = useState("");
  const [jobId, setJobId] = useState<string>("");
  const [newProjectName, setNewProjectName] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [unit, setUnit] = useState("");
  const [qty, setQty] = useState("");
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [note, setNote] = useState("");
  const [markup, setMarkup] = useState("0");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);

  // when arriving from the Projects tab, pre-filter and pre-select that project
  const [lastInitialProject, setLastInitialProject] = useState<string | null>(
    null,
  );
  if (initialProject && initialProject !== lastInitialProject) {
    setLastInitialProject(initialProject);
    setProjectFilter(initialProject);
    setProject(initialProject);
  }

  // product costs across all FGs (single query, grouped client-side)
  const allItems = useQuery(api.costing.listAllItems);
  const costByFg = useMemo(() => {
    const map = new Map<Id<"finishedGoods">, number>();
    for (const item of allItems ?? []) {
      if (item.fgId === undefined) continue;
      map.set(item.fgId, (map.get(item.fgId) ?? 0) + item.qty * item.unitPrice);
    }
    return map;
  }, [allItems]);

  // every project that exists as a record, plus names still only on products
  const projects = useMemo(() => {
    const names = new Set<string>();
    for (const p of projectDocs ?? []) names.add(p.name);
    for (const f of finishedGoods) {
      if (f.projectName !== undefined) names.add(f.projectName);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [projectDocs, finishedGoods]);

  // jobs under the currently selected project (for the job dropdown)
  const allJobs = useQuery(api.jobs.listJobs);
  const selectedProjectId = useMemo(
    () => (projectDocs ?? []).find((p) => p.name === project)?._id,
    [projectDocs, project],
  );
  const projectJobs = useMemo(
    () =>
      selectedProjectId === undefined
        ? []
        : (allJobs ?? []).filter((j) => j.projectId === selectedProjectId),
    [allJobs, selectedProjectId],
  );
  const jobNameOf = (id: Id<"projectJobs"> | undefined) => {
    if (id === undefined) return undefined;
    return (allJobs ?? []).find((j) => j._id === id)?.name;
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return finishedGoods
      .filter((f) => {
        if (projectFilter !== "all" && f.projectName !== projectFilter) return false;
        if (!q) return true;
        return (
          f.name.toLowerCase().includes(q) ||
          (f.projectName ?? "").toLowerCase().includes(q) ||
          (f.code ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        a.projectName === b.projectName
          ? a.name.localeCompare(b.name)
          : (a.projectName ?? "").localeCompare(b.projectName ?? ""),
      );
  }, [finishedGoods, search, projectFilter]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const isNewProject = project === NEW_PROJECT;
    const cleanProject = (isNewProject ? newProjectName : project).trim();
    const cleanName = name.trim();
    if (isNewProject && !cleanProject) {
      toast.error("Name the new project.");
      return;
    }
    if (!cleanName) {
      toast.error("Give the product a name.");
      return;
    }
    const markupNum = Number(markup) || 0;
    if (markupNum < 0) {
      toast.error("Markup can't be negative.");
      return;
    }
    setSaving(true);
    try {
      if (isNewProject) {
        // keep the Projects tab in sync — best effort, the product matters more
        try {
          await addProjectM({ name: cleanProject });
        } catch {
          /* ignore: the product can still be created under this project name */
        }
      }
      const id = await addFg({
        projectName: cleanProject || undefined,
        jobId: jobId !== "" ? (jobId as Id<"projectJobs">) : undefined,
        name: cleanName,
        code: code.trim() || undefined,
        qty: Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : undefined,
        unit: unit.trim() || undefined,
        category: category.trim() || undefined,
        subCategory: subCategory.trim() || undefined,
        note: note.trim() || undefined,
        currency: symbol,
        markupPct: markupNum,
      });
      toast.success(`“${cleanName}” created — open it to add materials.`);
      onSelectFg(id);
      setName("");
      setCode("");
      setCategory("");
      setSubCategory("");
      setNote("");
      setMarkup("0");
      setProject(cleanProject);
      setJobId("");
      setNewProjectName("");
      setShowForm(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't create the product.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (fg: FgDoc) => {
    // production holds raw materials out of stock, so it must be stopped
    // first — the server refuses the delete otherwise
    if (fg.productionStartedAt !== undefined) {
      await confirm({
        title: `“${fg.name}” is in production`,
        message:
          "Stop production before deleting this product. Stopping puts the raw materials it is using back into stock.",
        confirmLabel: "Got it",
        danger: true,
      });
      return;
    }
    const ok = await confirm({
      title: `Delete “${fg.name}”?`,
      message:
        "The product and all its costing lines will be permanently removed, and it will disappear from the Tasks page as well. This cannot be undone.",
      confirmLabel: "Delete product",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeFg({ id: fg._id });
      toast.success("Product deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the product.");
    }
  };

  const exportCsv = () => {
    const lines = [
      [
        "Project Code",
        "Project",
        "Product Code",
        "Product",
        "Unit",
        "Margin %",
        `Cost (${currencyCode})`,
        `Sales Price (${currencyCode})`,
      ].join(","),
      ...rows.map((f) => {
        const cost = costByFg.get(f._id) ?? 0;
        const total = cost * (1 + (f.markupPct ?? 0) / 100);
        return [
          `"${(f.projectCode ?? "").replace(/"/g, '""')}"`,
          `"${(f.projectName ?? "Standalone").replace(/"/g, '""')}"`,
          `"${(f.code ?? "").replace(/"/g, '""')}"`,
          `"${f.name.replace(/"/g, '""')}"`,
          f.unit ?? "",
          String(f.markupPct ?? 0),
          cost.toFixed(2),
          total.toFixed(2),
        ].join(",");
      }),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* new-product trigger */}
      <button
        type="button"
        onClick={() => setShowForm(true)}
        className="flex w-full items-center gap-1.5 rounded-xl border border-dashed bg-card/60 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-3.5" />
        New product (FG) — name, code, unit, margin… project is optional
      </button>

      {/* new-product popup — the master-data manager lives INSIDE it, never
          nested in a <form> (nested forms are invalid HTML and would make its
          Add buttons submit the product form instead) */}
      <Dialog open={showForm} onOpenChange={(open) => !open && setShowForm(false)}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b border-border/60 px-5 py-4">
            <DialogTitle className="flex items-center gap-2.5 text-base">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Package className="size-4" />
              </span>
              New product (FG)
            </DialogTitle>
            <DialogDescription className="text-xs">
              Products are standalone — no project or job needed to start. Code
              is auto-assigned; cost and sales price come from the BOM sheet.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
            <form id="new-product-form" onSubmit={handleCreate} className="space-y-5">
                <Group title="Product">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="Project"
                      hint="Optional — leave empty for a standalone product; attach to a project later"
                    >
                      <select
                        value={project}
                        onChange={(e) => {
                          setProject(e.target.value);
                          setJobId(""); // job list depends on the project
                          if (e.target.value !== NEW_PROJECT) setNewProjectName("");
                        }}
                        aria-label="Project"
                        className={selectCls}
                      >
                        <option value="">Standalone (no project)</option>
                        {projects.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                        <option value={NEW_PROJECT}>＋ New project…</option>
                      </select>
                    </Field>
                    <Field
                      label="Job / task"
                      hint="Optional — pick a project first to choose a job"
                    >
                      <select
                        value={jobId}
                        onChange={(e) => setJobId(e.target.value)}
                        aria-label="Job"
                        disabled={
                          project === "" ||
                          project === NEW_PROJECT ||
                          projectJobs.length === 0
                        }
                        className={selectCls}
                      >
                        <option value="">No specific job</option>
                        {projectJobs.map((j) => (
                          <option key={j._id} value={j._id}>
                            {j.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Product name" required>
                      <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Wooden chair"
                        aria-label="Product name"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Product code" hint="Leave blank to auto-assign FG0001, FG0002…">
                      <Input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="Auto (FG0001)"
                        aria-label="Product code"
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Sold per (unit)" hint="Used on quotes and costing sheets">
                      <select
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        aria-label="Sold per unit"
                        className={selectCls}
                      >
                        <option value="">Not set</option>
                        {units.map((u) => (
                          <option key={u._id} value={u.name}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Qty" hint="Shown next to the name in every product row">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        placeholder="e.g. 12"
                        aria-label="Product quantity"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  {project === NEW_PROJECT && (
                    <div className="sm:col-span-2">
                      <Field
                        label="New project name"
                        required
                        hint="A project record is created with its own PR code, and this product goes inside it."
                      >
                        <Input
                          autoFocus
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          placeholder="e.g. Office renovation"
                          aria-label="New project name"
                          className={inputCls}
                        />
                      </Field>
                    </div>
                  )}
                </Group>

                <Group title="Classification">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Category">
                      <select
                        value={category}
                        onChange={(e) => {
                          setCategory(e.target.value);
                          setSubCategory("");
                        }}
                        aria-label="Category"
                        className={selectCls}
                      >
                        <option value="">Not set</option>
                        {parentCategories.map((c) => (
                          <option key={c._id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field
                      label="Sub-category"
                      hint={
                        !category
                          ? "Pick a category first"
                          : subsOf(category).length === 0
                            ? "No sub-categories for this category yet"
                            : undefined
                      }
                    >
                      <select
                        value={subCategory}
                        onChange={(e) => setSubCategory(e.target.value)}
                        aria-label="Sub-category"
                        disabled={!category || subsOf(category).length === 0}
                        className={selectCls}
                      >
                        <option value="">Not set</option>
                        {subsOf(category).map((c) => (
                          <option key={c._id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </Group>

                <Group title="Pricing">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Currency" hint="From Settings → Organisation">
                      <p className="flex h-9 items-center gap-2 rounded-md border border-dashed bg-muted/30 px-2.5 text-sm">
                        <span className="font-medium">{currencyCode}</span>
                        <span className="text-muted-foreground">{symbol}</span>
                      </p>
                    </Field>
                    <Field
                      label="Margin %"
                      hint="Sales price = Cost × (1 + Margin %)"
                    >
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={markup}
                        onChange={(e) => setMarkup(e.target.value)}
                        placeholder="0"
                        aria-label="Margin percent"
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <div className="grid gap-3 rounded-xl border border-dashed bg-muted/30 p-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        Cost — calculated
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Total of the product's costing lines. Edit them on the
                        product's costing sheet.
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                        Sales price — calculated
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Cost plus the margin above. Both stay in sync with the
                        costing sheet.
                      </p>
                    </div>
                  </div>
                </Group>

                <Group title="Notes">
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    placeholder="Finish, dimensions, anything the costing sheet should mention…"
                    aria-label="Product note"
                    className="min-h-16 resize-y rounded-lg text-sm"
                  />
                </Group>
            </form>
          </div>

          <DialogFooter className="border-t border-border/60 px-5 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-product-form"
              size="sm"
              className="rounded-lg"
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Create product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* listing sheet — matches the raw-materials sheet */}
      <section className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <p className="text-sm font-semibold">
            Products
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {rows.length} item{rows.length === 1 ? "" : "s"}
              {projects.length > 0 ? ` · ${projects.length} projects` : ""}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search product, code…"
                className="w-40 rounded-lg border bg-background py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Filter by project"
              className="rounded-lg border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {rows.length > 0 && (
              <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-xs" onClick={exportCsv}>
                <Download className="size-3" />
                CSV
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                <th className="w-10 px-3 py-2 font-semibold">#</th>
                <th className="w-40 px-3 py-2 font-semibold">Project</th>
                <th className="px-3 py-2 font-semibold">Product</th>
                <th className="w-32 px-3 py-2 font-semibold">Job</th>
                <th className="w-24 px-3 py-2 font-semibold">Code</th>
                <th className="w-16 px-3 py-2 font-semibold">Unit</th>
                <th className="w-28 px-3 py-2 font-semibold">Category</th>
                <th className="w-16 px-3 py-2 text-right font-semibold">Margin %</th>
                <th className="w-24 px-3 py-2 text-right font-semibold">Cost</th>
                <th className="w-28 px-3 py-2 text-right font-semibold">Sales price</th>
                <th className="w-16 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {allItems === undefined || finishedGoods === undefined ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
                    Loading products…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                    {search || projectFilter !== "all"
                      ? "Nothing matches the current search/filter."
                      : "No products yet — create your first FG above."}
                  </td>
                </tr>
              ) : (
                rows.map((f, i) => {
                  const cost = costByFg.get(f._id) ?? 0;
                  const total = cost * (1 + (f.markupPct ?? 0) / 100);
                  const active = activeFgId === f._id;
                  return (
                    <tr
                      key={f._id}
                      className={cn(
                        "group/row transition-colors hover:bg-accent/40",
                        active && "bg-primary/[0.06]",
                      )}
                    >
                      <td className="px-3 py-1 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Folder className="size-3 shrink-0 text-sky-500/80" />
                          <span className="truncate">
                            {f.projectName ?? "Standalone"}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {f.jobId !== undefined ? (
                            <>
                              <Briefcase className="size-3 shrink-0 text-sky-500/80" />
                              <span className="truncate">
                                {jobNameOf(f.jobId) ?? "—"}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          type="button"
                          onClick={() => onSelectFg(f._id)}
                          className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-primary/5"
                          title="Open costing sheet"
                        >
                          <Package
                            className={cn(
                              "size-4 shrink-0",
                              active ? "text-primary" : "text-muted-foreground/70",
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "block truncate text-sm font-medium",
                                active && "text-primary",
                              )}
                            >
                              {f.name}
                            </span>
                            {f.note && (
                              <span className="block truncate text-[10px] text-muted-foreground/80">
                                {f.note}
                              </span>
                            )}
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                        {f.code || "—"}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">{f.unit ?? "—"}</td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground">
                        {f.category ? f.category : "—"}
                        {f.subCategory ? ` › ${f.subCategory}` : ""}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                        {(f.markupPct ?? 0) > 0 ? `+${f.markupPct}%` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                        {money(cost)}
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums text-primary">
                        {money(total)}
                      </td>
                      <td className="px-2 py-1 text-center">
                        <span className="hidden gap-1 group-hover/row:inline-flex">
                          <button
                            type="button"
                            aria-label={`Open “${f.name}”`}
                            title="Open costing sheet"
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                            onClick={() => onSelectFg(f._id)}
                          >
                            <Sigma className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete “${f.name}”`}
                            title="Delete product"
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-destructive"
                            onClick={() => void handleDelete(f)}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-3 text-xs text-muted-foreground">
        Click a product to open its costing sheet — add raw materials with quantities and custom
        lines, then read the total with markup. Cost updates live as you edit the sheet.
      </p>
    </div>
  );
}
