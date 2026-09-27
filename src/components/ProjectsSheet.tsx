import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  ChevronDown,
  CircleCheck,
  Download,
  Flag,
  Folder,
  Loader2,
  Package,
  PackagePlus,
  Pause,
  Pencil,
  Play,
  Plus,
  Printer,
  Search as SearchIcon,
  Sigma,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useAppDialogs } from "@/components/AppDialogs";
import { ProductionButton } from "@/components/FlaggedLists";
import ProductQtyInline from "@/components/ProductQtyInline";
import CustomersPanel from "@/components/CustomersPanel";
import {
  JobsList,
  ProductsList,
  keepsJob,
  keepsProduct,
  JOB_FILTERS,
  PRODUCT_FILTERS,
  type JobFilter,
  type ProductFilter,
} from "@/components/ProjectsTabs";
import { projectStatusesOrDefaults } from "@/lib/project-statuses";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import {
  JobDialog,
  AddProductToJobDialog,
  EditProductDialog,
} from "@/components/ProjectDialogs";
import FilterMenu, { type FilterOption } from "@/components/FilterMenu";

const PROJECT_FILTERS: readonly FilterOption<"all" | "flagged">[] = [
  { value: "all", label: "All items", hint: "Every project" },
  { value: "flagged", label: "Flagged", hint: "On the Projects board" },
];
import ProjectsPrintSheet, {
  buildPrintRows,
  type PrintRow,
} from "@/components/ProjectsPrintSheet";
import { cn } from "@/lib/utils";

type FgDoc = Doc<"finishedGoods">;
type ProjectDoc = Doc<"projects">;
type JobDoc = Doc<"projectJobs">;

const STATUS_META: Record<
  string,
  { label: string; chip: string }
> = {
  planning: {
    label: "Planning",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  in_progress: {
    label: "In progress",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  on_hold: {
    label: "On hold",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  cancelled: {
    label: "Cancelled",
    chip: "bg-muted text-muted-foreground",
  },
};

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
};

const JOB_STATUS_META: Record<
  string,
  { label: string; chip: string }
> = {
  planning: {
    label: "Planning",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  in_progress: {
    label: "In progress",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  paused: {
    label: "Paused",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  cancelled: {
    label: "Cancelled",
    chip: "bg-muted text-muted-foreground",
  },
};

function dueLabel(dueAt: number): { text: string; overdue: boolean } {
  const due = new Date(dueAt);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const overdue = dueAt < startOfToday;
  const days = Math.ceil((dueAt - startOfToday) / 86_400_000);
  let text: string;
  if (days === 0) text = "Due today";
  else if (days === 1) text = "Due tomorrow";
  else if (days > 1) text = `Due in ${days}d`;
  else text = `${-days}d overdue`;
  return {
    text: `${text} · ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    overdue,
  };
}

type ProjectRow = {
  key: string;
  name: string;
  code?: string;
  project?: ProjectDoc;
  products: number;
  cost: number;
  total: number;
  fgIds: Id<"finishedGoods">[];
  jobs: JobDoc[];
};

/** Projects listing sheet — one row per project with its jobs and details. */
export default function ProjectsSheet({
  finishedGoods,
  loading,
  onOpenProject,
  onNewProject,
  onNewProduct,
  onEditProject,
  onDeleteProject,
  onOpenProduct,
}: {
  finishedGoods: FgDoc[];
  loading: boolean;
  onOpenProject: (projectName: string) => void;
  onNewProject?: () => void;
  onNewProduct?: (projectName: string) => void;
  onEditProject?: (project: ProjectDoc) => void;
  onDeleteProject?: (project: ProjectDoc) => void;
  onOpenProduct?: (fgId: Id<"finishedGoods">) => void;
}) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"projects" | "jobs" | "products" | "customers">(
    "projects",
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [flagFilter, setFlagFilter] = useState<"all" | "flagged">("all");
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [productFilter, setProductFilter] = useState<ProductFilter>("all");
  const [printing, setPrinting] = useState(false);
  const [flagBusy, setFlagBusy] = useState<string | null>(null);
  const [jobDialog, setJobDialog] = useState<{
    projectId: Id<"projects">;
    projectLabel: string;
    job: JobDoc | null;
  } | null>(null);
  const [addProductJob, setAddProductJob] = useState<{
    job: JobDoc;
    projectLabel: string;
  } | null>(null);
  const [editProduct, setEditProduct] = useState<FgDoc | null>(null);
  const projects = useQuery(api.costing.listProjects);
  const allItems = useQuery(api.costing.listAllItems);
  const allJobs = useQuery(api.jobs.listJobs);
  const allCustomers = useQuery(api.contacts.listCustomers);
  const { format: money, code: defaultCurrencyCode } = useWorkspaceCurrency();
  const projectStatusesList = projectStatusesOrDefaults(
    useQuery(api.settings.listProjectStatuses),
  );
  /** The project a job sits under, for search and print labels. */
  const projectNameForJob = useCallback(
    (job: JobDoc) =>
      (projects ?? []).find((p) => p._id === job.projectId)?.name ??
      "Unassigned",
    [projects],
  );
  const pauseJob = useMutation(api.jobs.pauseJob);
  const resumeJob = useMutation(api.jobs.resumeJob);
  const completeJob = useMutation(api.jobs.completeJob);
  const removeJob = useMutation(api.jobs.removeJob);
  const updateJob = useMutation(api.jobs.updateJob);
  const setJobFlag = useMutation(api.jobs.setJobFlag);
  const setFgFlag = useMutation(api.costing.setFgFlag);
  const removeFg = useMutation(api.costing.removeFinishedGood);
  const addProjectM = useMutation(api.costing.addProject);
  const [creatingProject, setCreatingProject] = useState<string | null>(null);
  const { confirm } = useAppDialogs();

  /**
   * Delete a product from its row. Products go first in the delete order, and
   * production has to be stopped before one can be removed, so a running
   * product is stopped at with an explanation instead of a confirm.
   */
  const handleDeleteProduct = async (fg: FgDoc) => {
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
        "The product and its costing lines are permanently removed, and it disappears from the Tasks page too. Its job and project stay.",
      confirmLabel: "Delete product",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeFg({ id: fg._id });
      toast.success("Product deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the product.",
      );
    }
  };

  /**
   * Promote a name-only project (one that only exists as a projectName on its
   * products) into a real project record, so jobs can be attached to it.
   */
  const createProjectRecord = async (name: string) => {
    setCreatingProject(name);
    try {
      await addProjectM({ name });
      toast.success(`Project “${name}” created — you can add jobs to it now.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't create the project.",
      );
    } finally {
      setCreatingProject(null);
    }
  };

  /** All FG products — the clone picker searches across every project. */
  const allProducts = finishedGoods;

  /** Toggle the flag on a job (a flagged job shows all of its products). */
  const toggleJobFlag = async (job: JobDoc) => {
    setFlagBusy(`j:${job._id}`);
    try {
      await setJobFlag({ id: job._id, flagged: !job.isFlagged });
      toast.success(
        job.isFlagged
          ? "Flag removed from job and all its products."
          : "Job flagged — all its products were flagged too.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the flag.");
    } finally {
      setFlagBusy(null);
    }
  };

  /** Toggle the flag on a product (flagged products are subtasks of their job). */
  const toggleFgFlag = async (fg: FgDoc) => {
    setFlagBusy(`f:${fg._id}`);
    try {
      await setFgFlag({ id: fg._id, flagged: !fg.isFlagged });
      toast.success(
        fg.isFlagged
          ? "Flag removed from product."
          : "Product flagged — its job is flagged too.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the flag.");
    } finally {
      setFlagBusy(null);
    }
  };

  const costByFg = useMemo(() => {
    const map = new Map<Id<"finishedGoods">, number>();
    for (const item of allItems ?? []) {
      if (item.fgId === undefined) continue;
      map.set(item.fgId, (map.get(item.fgId) ?? 0) + item.qty * item.unitPrice);
    }
    return map;
  }, [allItems]);

  /** Merge the project entity (details) with its FG aggregation (numbers). */
  const rows = useMemo<ProjectRow[]>(() => {
    // Aggregate FGs by project name. Standalone products (no project) are
    // ignored here — they live in the Products tab only.
    const agg = new Map<string, ProjectRow>();
    for (const fg of finishedGoods) {
      if (fg.projectName === undefined) continue;
      const row = agg.get(fg.projectName) ?? {
        key: `n:${fg.projectName}`,
        name: fg.projectName,
        code: fg.projectCode,
        products: 0,
        cost: 0,
        total: 0,
        fgIds: [],
        jobs: [],
      };
      row.products += 1;
      const c = costByFg.get(fg._id) ?? 0;
      row.cost += c;
      row.total += c * (1 + (fg.markupPct ?? 0) / 100);
      row.fgIds.push(fg._id);
      agg.set(fg.projectName, row);
    }
    // Overlay the project entity details + its jobs.
    const out = new Map<string, ProjectRow>();
    for (const project of projects ?? []) {
      const a = agg.get(project.name);
      out.set(project.name, {
        key: `p:${project._id}`,
        name: project.name,
        code: project.code ?? a?.code,
        project,
        products: a?.products ?? 0,
        cost: a?.cost ?? 0,
        total: a?.total ?? 0,
        fgIds: a?.fgIds ?? [],
        jobs: (allJobs ?? []).filter((j) => j.projectId === project._id),
      });
    }
    // Name-only projects (legacy, no entity) keep working.
    for (const [name, a] of agg) {
      if (!out.has(name)) out.set(name, { ...a, jobs: [] as JobDoc[] });
    }
    return Array.from(out.values()).sort((x, y) => y.total - x.total);
  }, [finishedGoods, projects, costByFg, allJobs]);

  const filtered = useMemo(() => {
    let list = rows;
    if (flagFilter === "flagged") {
      // only projects that have something flagged in them
      list = list.filter((p) => {
        return (
          p.jobs.some((j) => j.isFlagged) ||
          finishedGoods.some(
            (f) => f.isFlagged && f.projectName === p.name,
          )
        );
      });
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q) ||
        (p.project?.client ?? "").toLowerCase().includes(q) ||
        (p.project?.assignee ?? "").toLowerCase().includes(q),
    );
  }, [rows, search, flagFilter, finishedGoods]);

  const totals = useMemo(
    () => ({
      products: filtered.reduce((s, p) => s + p.products, 0),
      cost: filtered.reduce((s, p) => s + p.cost, 0),
      total: filtered.reduce((s, p) => s + p.total, 0),
    }),
    [filtered],
  );

  const exportCsv = () => {
    const lines = [
      [
        "Code",
        "Project",
        "Client",
        "Assignee",
        "Status",
        "Priority",
        "Due date",
        `Budget (${defaultCurrencyCode})`,
        "Products",
        `Cost (${defaultCurrencyCode})`,
        `Sales Price (${defaultCurrencyCode})`,
      ].join(","),
      ...filtered.map((p) =>
        [
          `"${(p.code ?? "").replace(/"/g, '""')}"`,
          `"${p.name.replace(/"/g, '""')}"`,
          `"${(p.project?.client ?? "").replace(/"/g, '""')}"`,
          `"${(p.project?.assignee ?? "").replace(/"/g, '""')}"`,
          p.project?.status ? STATUS_META[p.project.status]?.label ?? p.project.status : "",
          p.project?.priority ?? "",
          p.project?.dueAt
            ? new Date(p.project.dueAt).toLocaleDateString()
            : "",
          p.project?.budget?.toFixed(2) ?? "",
          String(p.products),
          p.cost.toFixed(2),
          p.total.toFixed(2),
        ].join(","),
      ),
      `,,,TOTAL,,,"",,${totals.products},${totals.cost.toFixed(2)},${totals.total.toFixed(2)}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "projects.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  /** The rows the print sheet renders: the current tab, current filters. */
  const printRows: PrintRow[] = useMemo(() => {
    if (tab === "customers") return [];
    if (tab === "projects") {
      const projectDocs = (projects ?? []).filter((p) =>
        filtered.some((row) => row.project?._id === p._id),
      );
      return buildPrintRows(
        "projects",
        projectDocs,
        allJobs ?? [],
        finishedGoods,
        costByFg,
        projectStatusesList,
      );
    }
    if (tab === "jobs") {
      const all = buildPrintRows(
        "jobs",
        projects ?? [],
        allJobs ?? [],
        finishedGoods,
        costByFg,
        projectStatusesList,
      );
      const jobIdsInSearch = new Set(
        (allJobs ?? [])
          .filter((job) => {
            if (!keepsJob(job, jobFilter)) return false;
            const q = search.trim().toLowerCase();
            if (!q) return true;
            return (
              job.name.toLowerCase().includes(q) ||
              (job.code ?? "").toLowerCase().includes(q) ||
              projectNameForJob(job).toLowerCase().includes(q)
            );
          })
          .map((job) => job._id),
      );
      return all.filter((row) => jobIdsInSearch.has(row.id as Id<"projectJobs">));
    }
    const allProducts = buildPrintRows(
      "products",
      projects ?? [],
      allJobs ?? [],
      finishedGoods,
      costByFg,
      projectStatusesList,
    );
    const q = search.trim().toLowerCase();
    return allProducts.filter((row) => {
      const fg = finishedGoods.find((f) => f._id === row.id);
      if (fg === undefined) return false;
      if (!keepsProduct(fg, productFilter)) return false;
      if (!q) return true;
      return (
        fg.name.toLowerCase().includes(q) ||
        (fg.code ?? "").toLowerCase().includes(q) ||
        (fg.projectName ?? "").toLowerCase().includes(q) ||
        (fg.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [tab, projects, allJobs, finishedGoods, costByFg, filtered, search, jobFilter, productFilter, projectStatusesList, projectNameForJob]);

  /** What the print header should say about the active filter. */
  const printFilterLabel =
    tab === "jobs"
      ? jobFilter === "all"
        ? null
        : JOB_FILTERS.find((o) => o.value === jobFilter)?.label ?? null
      : tab === "products"
        ? productFilter === "all"
          ? null
          : PRODUCT_FILTERS.find((o) => o.value === productFilter)?.label ?? null
        : flagFilter === "all"
          ? null
          : "flagged only";

  return (
    <div>
      {printing && tab !== "customers" && (
        <ProjectsPrintSheet
          tab={tab}
          rows={printRows}
          search={search}
          filterLabel={printFilterLabel}
          onPrinted={() => setPrinting(false)}
        />
      )}
      {/* ── Tabs: one list per level of the hierarchy ───────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
          {(
            [
              ["projects", "Projects", Folder, rows.length],
              ["jobs", "Jobs", Briefcase, allJobs?.length ?? 0],
              ["products", "Products", Package, finishedGoods.length],
              ["customers", "Customers", Users, allCustomers?.length],
            ] as const
          ).map(([id, label, Icon, count]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
              {count !== undefined && (
                <span className="tabular-nums opacity-70">({count})</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-[11px] text-muted-foreground">
            {tab === "projects" &&
              "A project groups jobs, and jobs group finished goods — its cost and total are the sum of all its products."}
            {tab === "jobs" &&
              "Every job with the cost and sales value of the products under it."}
            {tab === "products" &&
              "Every product across all projects, with its production state."}
            {tab === "customers" &&
              "Everyone your projects are for, and the projects behind each one."}
          </p>
          {tab !== "customers" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPrinting(true)}
              className="h-7 shrink-0 rounded-lg text-xs"
            >
              <Printer className="size-3" /> Print
            </Button>
          )}
        </div>
      </div>

      {tab === "jobs" && (
        <JobsList
          jobs={allJobs ?? []}
          projects={projects}
          finishedGoods={finishedGoods}
          costByFg={costByFg}
          search={search}
          onSearch={setSearch}
          filter={jobFilter}
          onFilterChange={setJobFilter}
          onOpenProject={onOpenProject}
        />
      )}

      {tab === "products" && (
        <ProductsList
          finishedGoods={finishedGoods}
          costByFg={costByFg}
          search={search}
          onSearch={setSearch}
          filter={productFilter}
          onFilterChange={setProductFilter}
          onOpenProduct={onOpenProduct}
        />
      )}

      {tab === "customers" && <CustomersPanel />}

      {/* new project bar */}
      {onNewProject && tab === "projects" && (
        <button
          type="button"
          onClick={onNewProject}
          className="flex w-full items-center gap-1.5 rounded-xl border border-dashed bg-card/60 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
          New project — with due date, assignee, description &amp; more
        </button>
      )}

      {/* listing sheet */}
      <section
        className={cn(
          "mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm",
          tab !== "projects" && "hidden",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <p className="text-sm font-semibold">
            Projects
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {filtered.length} project{filtered.length === 1 ? "" : "s"} ·{" "}
              {totals.products} product{totals.products === 1 ? "" : "s"}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects…"
                className="w-40 rounded-lg border bg-background py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <FilterMenu
              value={flagFilter}
              options={PROJECT_FILTERS}
              onChange={setFlagFilter}
              label="Show projects"
              icon={Folder}
            />
            {filtered.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-lg text-xs"
                onClick={exportCsv}
              >
                <Download className="size-3" />
                CSV
              </Button>
            )}
          </div>
        </div>

        {loading || projects === undefined || allItems === undefined || allJobs === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading projects…
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search
              ? `Nothing matches “${search}”.`
              : "No projects yet — create one above."}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.map((p) => {
              const detail = p.project;
              const status = detail?.status
                ? STATUS_META[detail.status]
                : undefined;
              const due = detail?.dueAt !== undefined ? dueLabel(detail.dueAt) : null;
              // products booked to this project that hang off none of its jobs
              const looseProducts = finishedGoods.filter((f) => {
                if ((f.projectName ?? "").trim().toLowerCase() !== p.name.trim().toLowerCase())
                  return false;
                const inAJob = p.jobs.some(
                  (j) => f.jobId === j._id || (f.jobIds ?? []).includes(j._id),
                );
                if (inAJob) return false;
                return flagFilter === "flagged" ? f.isFlagged === true : true;
              });
              return (
                <li
                  key={p.key}
                  className="group/row px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === p.key ? null : p.key)}
                      className="flex min-w-0 items-center gap-2 text-left"
                      title="Show / hide jobs & products"
                    >
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          expanded === p.key && "rotate-180",
                        )}
                      />
                      <Folder className="size-4 shrink-0 text-sky-500/80" />
                      <span className="truncate text-sm font-medium hover:text-primary">
                        {p.name}
                      </span>
                    </button>
                    {p.code && (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                        {p.code}
                      </span>
                    )}
                    {detail?.client && (
                      <span
                        className="inline-flex min-w-0 max-w-48 shrink items-center gap-1 truncate text-[11px] text-muted-foreground"
                        title={`Client: ${detail.client}`}
                      >
                        <User className="size-2.5 shrink-0" />
                        <span className="truncate">{detail.client}</span>
                      </span>
                    )}
                    {status && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          status.chip,
                        )}
                      >
                        {status.label}
                      </span>
                    )}
                    {detail?.priority && (
                      <span
                        className="size-2 shrink-0 rounded-full"
                        title={`Priority: ${detail.priority}`}
                      >
                        <span
                          className={cn(
                            "block size-2 rounded-full",
                            PRIORITY_DOT[detail.priority] ?? "bg-muted-foreground",
                          )}
                        />
                      </span>
                    )}
                    {due && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                          due.overdue
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {due.text}
                      </span>
                    )}

                    {/* actions */}
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <button
                          type="button"
                          aria-label={`Jobs of “${p.name}”`}
                          title="Show / hide jobs"
                          className={cn(
                            "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            expanded === p.key
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setExpanded(expanded === p.key ? null : p.key)}
                        >
                          <Briefcase className="size-3" />
                          {p.jobs.length} job{p.jobs.length === 1 ? "" : "s"}
                          <ChevronDown
                            className={cn(
                              "size-3 transition-transform",
                              expanded === p.key && "rotate-180",
                            )}
                          />
                        </button>
                      {detail && (
                        <button
                          type="button"
                          aria-label={`New job under “${p.name}”`}
                          title="Create a job (task) under this project"
                          className="flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-1.5 py-0.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10"
                          onClick={() => {
                            setExpanded(p.key);
                            setJobDialog({
                              projectId: detail._id,
                              projectLabel: p.name,
                              job: null,
                            });
                          }}
                        >
                          <Plus className="size-3" />
                          Job
                        </button>
                      )}
                      <span className="hidden items-center gap-1 text-xs tabular-nums text-muted-foreground group-hover/row:inline-flex sm:inline-flex">
                        {detail?.budget !== undefined && (
                          <span
                            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                            title="Budget"
                          >
                            Budget {money(detail.budget)}
                          </span>
                        )}
                        <span
                          className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                          title="Actual sales total"
                        >
                          {money(p.total)}
                        </span>
                      </span>
                      {onEditProject && detail && (
                        <button
                          type="button"
                          aria-label={`Edit “${p.name}”`}
                          title="Edit project details"
                          className="grid size-6 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-primary"
                          onClick={() => onEditProject(detail)}
                        >
                          <Pencil className="size-3" />
                        </button>
                      )}
                      {onDeleteProject && detail && (
                        <button
                          type="button"
                          aria-label={`Delete “${p.name}”`}
                          title="Delete project"
                          className="grid size-6 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive"
                          onClick={() => onDeleteProject(detail)}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Open products of “${p.name}”`}
                        title="Open its products"
                        className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                        onClick={() => onOpenProject(p.name)}
                      >
                        <Package className="size-3.5" />
                      </button>
                      {onNewProduct && (
                        <button
                          type="button"
                          aria-label={`New product under “${p.name}”`}
                          title="New product under this project"
                          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                          onClick={() => onNewProduct(p.name)}
                        >
                          <Sigma className="size-3.5" />
                        </button>
                      )}
                    </span>
                  </div>

                  {/* second line: description / assignee */}
                  {(detail?.description || detail?.assignee) && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-6 text-[11px] text-muted-foreground">
                      {detail?.assignee && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <User className="size-3" />
                          {detail.assignee}
                        </span>
                      )}
                      {detail?.description && (
                        <span className="truncate opacity-80">
                          {detail.description}
                        </span>
                      )}
                    </p>
                  )}

                  {/* jobs of this project */}
                  {expanded === p.key && (
                    <div className="mt-2 ml-6 space-y-1 rounded-xl border border-dashed bg-muted/20 p-2">
                      {p.jobs.length === 0 ? (
                        <div className="px-1 py-1.5 text-[11px] text-muted-foreground">
                          {detail ? (
                            <p>
                              No jobs yet — a job is a task inside this project; its
                              products hang off the job.
                            </p>
                          ) : (
                            <p>
                              This project only exists as a name on its products, so it
                              has no jobs yet. Create the project record and jobs can
                              be added to it.
                            </p>
                          )}
                          {!detail && (
                            <button
                              type="button"
                              className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-dashed px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent"
                              onClick={() => void createProjectRecord(p.name)}
                              disabled={creatingProject !== null}
                            >
                              {creatingProject === p.name ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <Folder className="size-3" />
                              )}
                              Create project record
                            </button>
                          )}
                        </div>
                      ) : (
                        p.jobs.map((job) => {
                          const meta = job.status
                            ? JOB_STATUS_META[job.status]
                            : undefined;
                          const allJobProducts = finishedGoods.filter(
                            (f) =>
                              f.jobId === job._id ||
                              (f.jobIds ?? []).includes(job._id),
                          );
                          // Flagged view: a flagged job shows ALL its
                          // products; a normal job shows only its flagged
                          // products (as subtasks under the job line).
                          const jobProducts =
                            flagFilter === "flagged"
                              ? job.isFlagged
                                ? allJobProducts
                                : allJobProducts.filter((f) => f.isFlagged)
                              : allJobProducts;
                          const products = allJobProducts.length;
                          // in flagged view hide normal jobs with nothing flagged
                          if (
                            flagFilter === "flagged" &&
                            !job.isFlagged &&
                            !allJobProducts.some((f) => f.isFlagged)
                          )
                            return null;
                          return (
                            <div key={job._id} className="space-y-0.5">
                              <div
                                className="group/job flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-card px-2 py-1.5 text-xs"
                              >
                              <Briefcase className="size-3 shrink-0 text-sky-500/80" />
                              <span className="font-medium">{job.name}</span>
                              {job.code && (
                                <span className="font-mono text-[10px] text-muted-foreground/70">
                                  {job.code}
                                </span>
                              )}
                              {meta && (
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                    meta.chip,
                                  )}
                                >
                                  {meta.label}
                                </span>
                              )}
                              {job.priority && (
                                <span
                                  className={cn(
                                    "size-1.5 shrink-0 rounded-full",
                                    PRIORITY_DOT[job.priority] ??
                                      "bg-muted-foreground",
                                  )}
                                  title={`Priority: ${job.priority}`}
                                />
                              )}
                              {job.dueAt !== undefined && (
                                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                                  {new Date(job.dueAt).toLocaleDateString(
                                    undefined,
                                    { month: "short", day: "numeric" },
                                  )}
                                </span>
                              )}
                              {job.assignee && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <User className="size-2.5" />
                                  {job.assignee}
                                </span>
                              )}
                              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {products} product{products === 1 ? "" : "s"}
                              </span>
                              <button
                                type="button"
                                title={
                                  job.status === "completed"
                                    ? "Completed — all flagged products are done"
                                    : job.isFlagged
                                      ? "Remove flag (products stay)"
                                      : "Flag this job — flags all its products too"
                                }
                                aria-label={
                                  job.isFlagged
                                    ? "Remove flag from job"
                                    : "Flag job"
                                }
                                className={cn(
                                  "flex size-5 shrink-0 items-center justify-center rounded-md transition-colors",
                                  job.isFlagged && job.status === "completed"
                                    ? "text-emerald-600"
                                    : job.isFlagged
                                      ? "text-amber-500"
                                      : "text-muted-foreground/40 hover:text-amber-500",
                                )}
                                onClick={() => void toggleJobFlag(job)}
                                disabled={flagBusy !== null}
                              >
                                {flagBusy === `j:${job._id}` ? (
                                  <Loader2 className="size-3 animate-spin" />
                                ) : (
                                  <Flag
                                    className={cn(
                                      "size-3",
                                      job.isFlagged &&
                                        (job.status === "completed"
                                          ? "fill-current text-emerald-600"
                                          : "fill-current"),
                                    )}
                                  />
                                )}
                              </button>

                              <span className="ml-auto flex shrink-0 items-center gap-0.5">
                                {(job.status === "planning" ||
                                  job.status === "paused") && (
                                  <button
                                    type="button"
                                    title="Start / resume work"
                                    aria-label="Resume job"
                                    className="hidden size-5 place-items-center rounded-md text-muted-foreground hover:text-emerald-600 group-hover/job:grid"
                                    onClick={async () => {
                                      try {
                                        if (job.status === "paused") {
                                          await resumeJob({ id: job._id });
                                          toast.success("Job resumed.");
                                        } else {
                                          await updateJob({
                                            id: job._id,
                                            status: "in_progress",
                                          });
                                          toast.success("Job started.");
                                        }
                                      } catch (e) {
                                        toast.error(
                                          e instanceof Error
                                            ? e.message
                                            : "Failed.",
                                        );
                                      }
                                    }}
                                  >
                                    <Play className="size-3" />
                                  </button>
                                )}
                                {job.status === "in_progress" && (
                                  <button
                                    type="button"
                                    title="Pause work"
                                    aria-label="Pause job"
                                    className="hidden size-5 place-items-center rounded-md text-muted-foreground hover:text-amber-600 group-hover/job:grid"
                                    onClick={async () => {
                                      try {
                                        await pauseJob({ id: job._id });
                                        toast.success("Job paused.");
                                      } catch (e) {
                                        toast.error(
                                          e instanceof Error
                                            ? e.message
                                            : "Failed.",
                                        );
                                      }
                                    }}
                                  >
                                    <Pause className="size-3" />
                                  </button>
                                )}
                                {job.status !== "completed" &&
                                  job.status !== "cancelled" && (
                                    <button
                                      type="button"
                                      title="Mark completed"
                                      aria-label="Complete job"
                                      className="hidden size-5 place-items-center rounded-md text-muted-foreground hover:text-emerald-600 group-hover/job:grid"
                                      onClick={async () => {
                                        try {
                                          await completeJob({ id: job._id });
                                          toast.success("Job completed.");
                                        } catch (e) {
                                          toast.error(
                                            e instanceof Error
                                              ? e.message
                                              : "Failed.",
                                          );
                                        }
                                      }}
                                    >
                                      <CircleCheck className="size-3" />
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  title="Edit job"
                                  aria-label="Edit job"
                                  className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-primary"
                                  onClick={() => {
                                    if (!detail) return;
                                    setJobDialog({
                                      projectId: detail._id,
                                      projectLabel: p.name,
                                      job,
                                    });
                                  }}
                                >
                                  <Pencil className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  title="Delete job"
                                  aria-label="Delete job"
                                  className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive"
                                  onClick={async () => {
                                    // products are the first level of the delete
                                    // order, so a job waits until they are gone
                                    const products = finishedGoods.filter(
                                      (f) =>
                                        f.jobId === job._id ||
                                        (f.jobIds ?? []).includes(job._id),
                                    );
                                    if (products.length > 0) {
                                      await confirm({
                                        title: `“${job.name}” still has ${products.length} product${products.length === 1 ? "" : "s"}`,
                                        message:
                                          "Delete the products first — stopping production where needed — and then the job can be deleted.",
                                        confirmLabel: "Got it",
                                        danger: true,
                                      });
                                      return;
                                    }
                                    const ok = await confirm({
                                      title: `Delete job “${job.name}”?`,
                                      message:
                                        "The job will be permanently removed and will disappear from the Tasks page as well. This cannot be undone.",
                                      confirmLabel: "Delete job",
                                      danger: true,
                                    });
                                    if (!ok) return;
                                    try {
                                      await removeJob({ id: job._id });
                                      toast.success("Job deleted.");
                                    } catch (e) {
                                      toast.error(
                                        e instanceof Error
                                          ? e.message
                                          : "Failed.",
                                      );
                                    }
                                  }}
                                >
                                  <Trash2 className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  title="Add product to this job"
                                  aria-label="Add product to this job"
                                  className="grid size-5 place-items-center rounded-md text-muted-foreground hover:text-primary"
                                  onClick={() =>
                                    setAddProductJob({
                                      job,
                                      projectLabel: p.name,
                                    })
                                  }
                                >
                                  <PackagePlus className="size-3" />
                                </button>
                              </span>
                              </div>

                              {/* product lines under this job */}
                              {jobProducts.map((fg) => (
                                <div
                                  key={fg._id}
                                  className="flex w-full items-center gap-2 rounded-lg bg-card px-2 py-1 pl-6 pr-1.5 text-xs transition-colors hover:bg-accent"
                                >
                                  <button
                                    type="button"
                                    title="Open this product's costing sheet"
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                    onClick={() => onOpenProduct?.(fg._id)}
                                  >
                                    <Package className="size-3 shrink-0 text-sky-500/80" />
                                    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                                      <span className="flex min-w-0 max-w-full items-baseline gap-1.5">
                                        <span className="min-w-0 truncate font-medium">
                                          {fg.name}
                                        </span>
                                        <ProductQtyInline qty={fg.qty} unit={fg.unit} className="text-[10px]" />
                                      </span>
                                      {fg.note && (
                                        <span className="w-full truncate text-[10px] text-muted-foreground/80">
                                          {fg.note}
                                        </span>
                                      )}
                                    </span>
                                    {fg.code && (
                                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                                        {fg.code}
                                      </span>
                                    )}
                                    <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                      {money(costByFg.get(fg._id) ?? 0)}
                                    </span>
                                    <Sigma className="size-3 shrink-0 text-muted-foreground/40" />
                                  </button>
                                  <button
                                    type="button"
                                    title="Edit product"
                                    aria-label={`Edit product “${fg.name}”`}
                                    className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-primary"
                                    onClick={() => setEditProduct(fg)}
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    title={
                                      fg.productionStartedAt !== undefined
                                        ? "Stop production before deleting"
                                        : "Delete product"
                                    }
                                    aria-label={`Delete product “${fg.name}”`}
                                    className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive"
                                    onClick={() => void handleDeleteProduct(fg)}
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                  <ProductionButton fg={fg} />
                                  <button
                                    type="button"
                                    title={
                                      fg.isFlagged
                                        ? "Remove flag from product"
                                        : "Flag product — show it under its job"
                                    }
                                    aria-label={
                                      fg.isFlagged
                                        ? "Remove flag from product"
                                        : "Flag product"
                                    }
                                    className={cn(
                                      "grid size-5 shrink-0 place-items-center rounded-md transition-colors",
                                      fg.isFlagged
                                        ? "text-amber-500"
                                        : "text-muted-foreground/40 hover:text-amber-500",
                                    )}
                                    onClick={() => void toggleFgFlag(fg)}
                                    disabled={flagBusy !== null}
                                  >
                                    {flagBusy === `f:${fg._id}` ? (
                                      <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                      <Flag
                                        className={cn(
                                          "size-3",
                                          fg.isFlagged && "fill-current",
                                        )}
                                      />
                                    )}
                                  </button>
                                </div>
                              ))}
                              <button
                                type="button"
                                className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                onClick={() =>
                                  setAddProductJob({
                                    job,
                                    projectLabel: p.name,
                                  })
                                }
                              >
                                <PackagePlus className="size-3" />
                                Add product to “{job.name}”
                              </button>
                            </div>
                          );
                        })
                      )}
                      {/* loose products (no job) */}
                      {looseProducts.map((fg) => (
                        <div
                          key={fg._id}
                          className="flex w-full items-center gap-2 rounded-lg bg-card px-2 py-1 pl-6 pr-1.5 text-xs transition-colors hover:bg-accent"
                        >
                          <button
                            type="button"
                            title="Open this product's costing sheet"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => onOpenProduct?.(fg._id)}
                          >
                            <Package className="size-3 shrink-0 text-sky-500/80" />
                            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                              <span className="flex min-w-0 max-w-full items-baseline gap-1.5">
                                <span className="min-w-0 truncate font-medium">
                                  {fg.name}
                                </span>
                                <ProductQtyInline qty={fg.qty} unit={fg.unit} className="text-[10px]" />
                              </span>
                              {fg.note && (
                                <span className="w-full truncate text-[10px] text-muted-foreground/80">
                                  {fg.note}
                                </span>
                              )}
                            </span>
                            {fg.code && (
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                                {fg.code}
                              </span>
                            )}
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                              {money(costByFg.get(fg._id) ?? 0)}
                            </span>
                            <Sigma className="size-3 shrink-0 text-muted-foreground/40" />
                          </button>
                          <button
                            type="button"
                            title="Edit product"
                            aria-label={`Edit product “${fg.name}”`}
                            className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-primary"
                            onClick={() => setEditProduct(fg)}
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            type="button"
                            title={
                              fg.productionStartedAt !== undefined
                                ? "Stop production before deleting"
                                : "Delete product"
                            }
                            aria-label={`Delete product “${fg.name}”`}
                            className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive"
                            onClick={() => void handleDeleteProduct(fg)}
                          >
                            <Trash2 className="size-3" />
                          </button>
                          <button
                            type="button"
                            title={
                              fg.isFlagged
                                ? "Remove flag from product"
                                : "Flag product — show it under its job"
                            }
                            aria-label={
                              fg.isFlagged
                                ? "Remove flag from product"
                                : "Flag product"
                            }
                            className={cn(
                              "grid size-5 shrink-0 place-items-center rounded-md transition-colors",
                              fg.isFlagged
                                ? "text-amber-500"
                                : "text-muted-foreground/40 hover:text-amber-500",
                            )}
                            onClick={() => void toggleFgFlag(fg)}
                            disabled={flagBusy !== null}
                          >
                            {flagBusy === `f:${fg._id}` ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Flag
                                className={cn(
                                  "size-3",
                                  fg.isFlagged && "fill-current",
                                )}
                              />
                            )}
                          </button>
                        </div>
                      ))}
                      {detail && (
                        <button
                          type="button"
                          className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          onClick={() =>
                            setJobDialog({
                              projectId: detail._id,
                              projectLabel: p.name,
                              job: null,
                            })
                          }
                        >
                          <Plus className="size-3" />
                          New job under “{p.name}”
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length > 0 && (
          <div className="flex items-center justify-end gap-4 border-t border-border/70 bg-primary/5 px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Products: {totals.products} · Cost {money(totals.cost)}
            </span>
            <span className="font-display text-sm font-bold tabular-nums text-primary">
              Sales {money(totals.total)}
            </span>
          </div>
        )}
      </section>

      <p className="mt-3 text-xs text-muted-foreground">
        A project groups jobs, and jobs group finished goods — its cost and
        total are the sum of all its products. Click a project name to expand
        its jobs, or the package icon to open its products.
      </p>

      {jobDialog && (
        <JobDialog
          projectId={jobDialog.projectId}
          projectLabel={jobDialog.projectLabel}
          job={jobDialog.job}
          onClose={() => setJobDialog(null)}
        />
      )}

      {addProductJob && (
        <AddProductToJobDialog
          job={addProductJob.job}
          projectLabel={addProductJob.projectLabel}
          allProducts={allProducts}
          onOpenProduct={(fgId) => onOpenProduct?.(fgId)}
          onClose={() => setAddProductJob(null)}
        />
      )}

      {editProduct && (
        <EditProductDialog
          fg={editProduct}
          onClose={() => setEditProduct(null)}
        />
      )}
    </div>
  );
}
