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
  PackageMinus,
  Printer,
  Search as SearchIcon,
  Sigma,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { Suspense, lazy, useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useAppDialogs } from "@/components/AppDialogs";
import { ProductionButton } from "@/components/FlaggedLists";
import ProductCodeInline from "@/components/ProductCodeInline";
import ProductTagsInline from "@/components/ProductTagsInline";
import { batchCost, batchQty, costByProduct } from "@/lib/product-cost";
import MoneyBracket from "@/components/MoneyBracket";
import PriorityChip from "@/components/PriorityChip";
import CustomersPanel from "@/components/CustomersPanel";
import ProductionsBoard from "@/components/ProductionsBoard";
import PageTabs from "@/components/PageTabs";
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
import {
  PROJECT_STATUS_FINISH,
  projectStatusesOrDefaults,
} from "@/lib/project-statuses";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { isFlaggedProjectWork } from "@/lib/project-work";
import {
  JobDialog,
  AddProductToJobDialog,
} from "@/components/ProjectDialogs";
import FilterMenu, { type FilterOption } from "@/components/FilterMenu";

// the side panels are big, so they are only fetched when one is actually open
const ProjectDetailPanel = lazy(() => import("@/components/ProjectDetailPanel"));
const ProductDetailPanel = lazy(() => import("@/components/ProductDetailPanel"));

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

/**
 * What a product's cost bracket reads: "3 PCS × $500.00 = $1,500.00". The
 * quantity lives in here rather than beside the name, so the whole arithmetic
 * is one readable chip. A product with no quantity set is one of itself, and
 * the breakdown would only be noise.
 */
function productCostLabel(
  fg: FgDoc,
  unitCost: number,
  money: (n: number) => string,
): string {
  const qty = batchQty(fg);
  const total = unitCost * qty;
  if (qty <= 1) return money(total);
  const count = fg.unit ? `${qty} ${fg.unit}` : String(qty);
  return `${count} × ${money(unitCost)} = ${money(total)}`;
}
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
  const [tab, setTab] = useState<
    "projects" | "jobs" | "products" | "customers" | "productions"
  >("projects");
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
  const projects = useQuery(api.costing.listProjects);
  const allItems = useQuery(api.costing.listAllItems);
  const allJobs = useQuery(api.jobs.listJobs);
  const allCustomers = useQuery(api.contacts.listCustomers);

  /**
   * How much work is in Productions. A flagged product already flags its job,
   * so counting all three would count one piece of work three times — only the
   * deepest flagged thing is counted.
   */
  const productionsCount = useMemo(() => {
    const flaggedFgs = finishedGoods.filter(isFlaggedProjectWork);
    const covered = new Set<string>();
    for (const f of flaggedFgs) {
      for (const jid of f.jobIds ?? (f.jobId !== undefined ? [f.jobId] : [])) {
        covered.add(jid);
      }
    }
    return (
      flaggedFgs.length +
      (allJobs ?? []).filter((j) => j.isFlagged && !covered.has(j._id)).length
    );
  }, [finishedGoods, allJobs]);
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
  const setProjectFlag = useMutation(api.costing.setProjectFlag);
  const addProjectM = useMutation(api.costing.addProject);
  const removeFgM = useMutation(api.costing.removeFinishedGood);
  const detachFromJobM = useMutation(api.costing.detachFromJob);
  const detachFromProjectM = useMutation(api.costing.detachFromProject);
  const [creatingProject, setCreatingProject] = useState<string | null>(null);
  const { confirm } = useAppDialogs();

  /**
   * The side panel on the right shows one thing at a time — a project, a job
   * or a product — exactly as the Tasks page does with its task and subtask
   * panels. Clicking whatever is already open closes it again.
   */
  const [pane, setPane] = useState<{
    kind: "project" | "job" | "product";
    id: string;
  } | null>(null);
  const openNode = useCallback(
    (kind: "project" | "job" | "product", id: string) =>
      setPane((current) =>
        current !== null && current.kind === kind && current.id === id
          ? null
          : { kind, id },
      ),
    [],
  );

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

  /**
   * Toggle the flag on a job. Flagging flags all of its products too; a job
   * that is only flagged because a product is flagged under it cannot be
   * unflagged until that product clears its own flag.
   */
  const toggleJobFlag = async (job: JobDoc) => {
    setFlagBusy(`j:${job._id}`);
    try {
      await setJobFlag({ id: job._id, flagged: !job.isFlagged });
      toast.success(
        job.isFlagged
          ? "Flag removed from the job."
          : "Job flagged — its products and project were flagged too.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the flag.");
    } finally {
      setFlagBusy(null);
    }
  };

  /**
   * Toggle the flag on a project. Flagging cascades down through every job
   * and product under it; the project keeps the flag for as long as anything
   * beneath it is still flagged.
   */
  const toggleProjectFlag = async (project: ProjectDoc) => {
    setFlagBusy(`p:${project._id}`);
    try {
      await setProjectFlag({ id: project._id, flagged: !project.isFlagged });
      toast.success(
        project.isFlagged
          ? "Flag removed from the project."
          : "Project flagged — its jobs and products were flagged too.",
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
          : "Product flagged — its job and project are flagged too.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the flag.");
    } finally {
      setFlagBusy(null);
    }
  };

  const costByFg = useMemo(
    () => costByProduct(allItems ?? []),
    [allItems],
  );

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
      // the sheet prices one product, so the quantity decides what it costs;
      // the project value is that cost — margin is not added on top
      const c = batchCost(costByFg.get(fg._id) ?? 0, fg);
      row.cost += c;
      row.total += c;
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
      jobs: filtered.reduce((s, p) => s + p.jobs.length, 0),
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
        `Value (${defaultCurrencyCode})`,
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
          p.total.toFixed(2),
        ].join(","),
      ),
      `,,,TOTAL,,,"",,${totals.products},${totals.total.toFixed(2)}`,
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
    if (tab === "customers" || tab === "productions") return [];
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

  /**
   * Deleting a job from the Job list. The server refuses it while any
   * product is still linked, so say so up front rather than failing a click.
   */
  const handleDeleteJobFromList = async (job: JobDoc, productCount: number) => {
    if (productCount > 0) {
      await confirm({
        title: `“${job.name}” still has ${productCount} product${productCount === 1 ? "" : "s"}`,
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
      toast.error(e instanceof Error ? e.message : "Failed.");
    }
  };

  /**
   * The document the side panel is showing, looked up from the live lists so
   * it always reflects the newest edit rather than a stale copy.
   */
  const paneDoc = useMemo(() => {
    if (pane === null) return null;
    if (pane.kind === "project") {
      return (projects ?? []).find((p) => String(p._id) === pane.id) ?? null;
    }
    if (pane.kind === "job") {
      return (allJobs ?? []).find((j) => String(j._id) === pane.id) ?? null;
    }
    return finishedGoods.find((f) => String(f._id) === pane.id) ?? null;
  }, [pane, projects, allJobs, finishedGoods]);

  /** The project a job in the panel sits under, for its subtitle line. */
  const paneJobParent = useMemo(() => {
    if (pane === null || pane.kind !== "job") return undefined;
    const job = (allJobs ?? []).find((j) => String(j._id) === pane.id);
    if (job === undefined) return undefined;
    return (projects ?? []).find((p) => p._id === job.projectId)?.name;
  }, [pane, allJobs, projects]);

  /**
   * Take a product out of the project — or out of one job inside it. The
   * product itself is never deleted: it drops back to a standalone item and
   * stays in the Products list with its recipe, cost and stock. A product
   * that is in production or already finished is refused, because its costs
   * and units are part of the project's record.
   */
  const handleRemoveProductFromProject = async (
    fg: FgDoc,
    where: {
      projectName: string;
      jobId?: Id<"projectJobs">;
      jobName?: string;
    },
  ) => {
    const from = where.jobId !== undefined ? `job “${where.jobName}”` : `“${where.projectName}”`;
    const ok = await confirm({
      title: `Remove “${fg.name}” from ${from}?`,
      message:
        "The product is not deleted — it becomes a standalone item and stays in Products with its recipe, cost and stock. Only its link to this project is removed.",
      confirmLabel: "Remove from project",
      danger: true,
    });
    if (!ok) return;
    try {
      if (where.jobId !== undefined) {
        await detachFromJobM({ fgId: fg._id, jobId: where.jobId });
      } else {
        await detachFromProjectM({ fgId: fg._id });
      }
      toast.success(
        `“${fg.name}” removed from ${from} — it is still in Products.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't remove that product.",
      );
    }
  };

  /** Delete the product the side panel is showing, after the usual confirm. */
  const handleDeleteProductFromPane = async (fg: FgDoc) => {
    const ok = await confirm({
      title: `Delete product “${fg.name}”?`,
      message:
        "The product is permanently removed along with its costs and files. Take it out of its project or job first. This cannot be undone.",
      confirmLabel: "Delete product",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeFgM({ id: fg._id });
      setPane(null);
      toast.success("Product deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete that product.",
      );
    }
  };

  /** What the print header should say about the active filter. */
  const tabLabel =
    tab === "projects"
      ? "projects"
      : tab === "jobs"
        ? "jobs"
        : tab === "products"
          ? "products"
          : "customers";
  /** Productions brings its own filters, so the shared ones step aside. */
  const usesSharedSearch = tab !== "customers" && tab !== "productions";

  /**
   * The filter in the tab bar follows the active tab, so one control covers
   * every list without each section having to draw its own.
   */
  const activeFilterOptions =
    tab === "projects"
      ? PROJECT_FILTERS
      : tab === "jobs"
        ? JOB_FILTERS
        : tab === "products"
          ? PRODUCT_FILTERS
          : PROJECT_FILTERS;
  const activeFilterLabel = `Show ${tab === "projects" ? "projects" : tab}`;
  const activeFilterIcon =
    tab === "projects" ? Folder : tab === "jobs" ? Briefcase : Package;
  const activeFilter =
    tab === "projects"
      ? flagFilter
      : tab === "jobs"
        ? jobFilter
        : tab === "products"
          ? productFilter
          : flagFilter;
  const setActiveFilter = (next: string) => {
    if (tab === "jobs") setJobFilter(next as JobFilter);
    else if (tab === "products") setProductFilter(next as ProductFilter);
    else setFlagFilter(next as "all" | "flagged");
  };

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
    <div className="mt-4 space-y-4">
      {printing && usesSharedSearch && (
        <ProjectsPrintSheet
          tab={tab}
          rows={printRows}
          search={search}
          filterLabel={printFilterLabel}
          onPrinted={() => setPrinting(false)}
        />
      )}

      <div className="grid items-start lg:grid-cols-[1fr_auto]">
      <div className="min-w-0 space-y-4">
      {/* ── Tabs: one list per level of the hierarchy ───────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTabs
          label="Projects sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "projects", label: "Projects", icon: Folder, count: rows.length },
            { id: "jobs", label: "Jobs", icon: Briefcase, count: allJobs?.length ?? 0 },
            { id: "products", label: "Products", icon: Package, count: finishedGoods.length },
            { id: "customers", label: "Customers", icon: Users, count: allCustomers?.length },
            { id: "productions", label: "Productions", icon: Briefcase, count: productionsCount },
          ]}
        />
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {/* one search box and one filter for every tab — they read the same
              field, so switching tabs keeps whatever was typed */}
          {usesSharedSearch ? (
            <>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${tabLabel}…`}
                  aria-label={`Search ${tabLabel}`}
                  className="h-7 w-44 rounded-lg border bg-card pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <FilterMenu
                value={activeFilter}
                options={activeFilterOptions}
                onChange={setActiveFilter}
                label={activeFilterLabel}
                icon={activeFilterIcon}
              />
            </>
          ) : null}
          {onNewProject && tab === "projects" && (
            <button
              type="button"
              onClick={onNewProject}
              aria-label="New project"
              title="New project — with due date, assignee, description & more"
              className="grid size-7 shrink-0 place-items-center rounded-lg border border-dashed border-primary/40 text-primary transition-colors hover:bg-primary/10"
            >
              <Plus className="size-3.5" />
            </button>
          )}
          {usesSharedSearch && (
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
          filter={jobFilter}
          onOpenProject={onOpenProject}
          onEditJob={(job, projectName) =>
            setJobDialog({
              projectId: job.projectId,
              projectLabel: projectName,
              job,
            })
          }
          onDeleteJob={(job, productCount) =>
            void handleDeleteJobFromList(job, productCount)
          }
          onOpenNode={(kind, id) => openNode(kind, id)}
        />
      )}

      {tab === "products" && (
        <ProductsList
          finishedGoods={finishedGoods}
          costByFg={costByFg}
          search={search}
          filter={productFilter}
          onOpenProduct={onOpenProduct}
          onOpenNode={(kind, id) => openNode(kind, id)}
        />
      )}

      {tab === "customers" && <CustomersPanel />}

      {tab === "productions" && <ProductionsBoard />}

      {/* listing sheet */}
      <section
        className={cn(
          "mt-3 overflow-hidden rounded-2xl border bg-card shadow-sm",
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
          <div className="flex shrink-0 items-center gap-1.5">
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
              : "No projects yet — use the + button to add one."}
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
                      className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Show / hide jobs & products"
                      aria-expanded={expanded === p.key}
                      aria-label={`Show or hide the jobs in ${p.name}`}
                    >
                      <ChevronDown
                        className={cn(
                          "size-3.5 transition-transform",
                          expanded === p.key && "rotate-180",
                        )}
                      />
                    </button>
                    {/* the name opens the side panel, exactly as a task does */}
                    <button
                      type="button"
                      onClick={() => {
                        if (detail) {
                          openNode("project", String(detail._id));
                          setExpanded(p.key);
                        } else {
                          setExpanded(expanded === p.key ? null : p.key);
                        }
                      }}
                      className="flex min-w-0 items-center gap-2 text-left"
                      title={
                        detail
                          ? "Open the project's side panel"
                          : "Show / hide jobs & products"
                      }
                    >
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
                      {detail && (
                        <button
                          type="button"
                          title={
                            detail.isFlagged
                              ? "Remove flag from this project"
                              : "Flag this project — flags its jobs and products too"
                          }
                          aria-label={
                            detail.isFlagged
                              ? `Remove flag from \u201c${p.name}\u201d`
                              : `Flag \u201c${p.name}\u201d`
                          }
                          className={cn(
                            "grid size-6 shrink-0 place-items-center rounded-md transition-colors",
                            detail.isFlagged
                              ? "text-amber-500"
                              : "text-muted-foreground/40 hover:text-amber-500",
                          )}
                          onClick={() => void toggleProjectFlag(detail)}
                          disabled={flagBusy !== null}
                        >
                          {flagBusy === `p:${detail._id}` ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Flag
                              className={cn(
                                "size-3",
                                detail.isFlagged && "fill-current",
                              )}
                            />
                          )}
                        </button>
                      )}
                      <button
                          type="button"
                          aria-label={`Jobs of “${p.name}”`}
                          title="Show / hide jobs"
                          className={cn(
                            "flex h-6 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium",
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
                          className="flex h-6 items-center gap-1 rounded-full border border-dashed border-primary/40 px-1.5 text-[10px] font-medium text-primary transition-colors hover:bg-primary/10"
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
                        <MoneyBracket
                          amount={money(p.total)}
                          tone="primary"
                          title="Project value — the production cost of its products, margin not added"
                        />
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
                          // a job can only be finished once every product is,
                          // so the count of finished ones is shown up front
                          const doneProducts = allJobProducts.filter(
                            (f) =>
                              f.isCompleted === true ||
                              f.projectStatus === PROJECT_STATUS_FINISH,
                          ).length;
                          // a flagged product holds its job's flag: the job
                          // cannot be unflagged until the product is
                          const hasFlaggedProduct = allJobProducts.some(
                            (f) => f.isFlagged,
                          );
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
                              <button
                                type="button"
                                title="Open the job's side panel"
                                className="min-w-0 cursor-pointer truncate font-medium hover:text-primary hover:underline"
                                onClick={() => openNode("job", String(job._id))}
                              >
                                {job.name}
                              </button>
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
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px]",
                                  products === 0
                                    ? "bg-muted text-muted-foreground"
                                    : doneProducts === products
                                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                                )}
                                title={
                                  products === 0
                                    ? "No products on this job yet"
                                    : `${doneProducts} of ${products} finished${
                                        doneProducts < products
                                          ? " — the job cannot be finished yet"
                                          : ""
                                      }`
                                }
                              >
                                {products === 0
                                  ? "0 products"
                                  : `${doneProducts}/${products} products done`}
                              </span>
                              {allJobProducts.length > 0 && (
                                <MoneyBracket
                                  amount={money(
                                    allJobProducts.reduce(
                                      (sum, f) =>
                                        sum + batchCost(costByFg.get(f._id) ?? 0, f),
                                      0,
                                    ),
                                  )}
                                  tone="cost"
                                  title="Total production cost of this job's products"
                                />
                              )}
                              <button
                                type="button"
                                title={
                                  job.status === "completed"
                                    ? "Completed — all flagged products are done"
                                    : job.isFlagged && hasFlaggedProduct
                                      ? "Held by a flagged product — remove that flag first"
                                      : job.isFlagged
                                        ? "Remove flag from this job"
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
                                disabled={flagBusy !== null || (job.isFlagged && hasFlaggedProduct)}
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
                                    title="Open the product's side panel"
                                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                                    onClick={() => openNode("product", String(fg._id))}
                                  >
                                    <Package className="size-3 shrink-0 text-sky-500/80" />
                                    <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                                      <span className="flex min-w-0 max-w-full items-baseline gap-1.5">
                                        <span className="min-w-0 truncate font-medium">
                                          {fg.name}
                                        </span>
                                        <ProductCodeInline code={fg.code} />
                                        <MoneyBracket
                                          amount={productCostLabel(fg, costByFg.get(fg._id) ?? 0, money)}
                                          tone="cost"
                                          title="Quantity × unit cost = production cost for the whole batch"
                                        />
                                        <ProductTagsInline tags={fg.tags} />
                                      </span>
                                      {fg.note && (
                                        <span className="w-full truncate text-[10px] text-muted-foreground/80">
                                          {fg.note}
                                        </span>
                                      )}
                                    </span>
                                    <Sigma className="size-3 shrink-0 text-muted-foreground/40" />
                                  </button>
                                  <PriorityChip priority={fg.priority} />
                                  <button
                                    type="button"
                                    title="Add materials and custom lines to this product's costing sheet"
                                    aria-label={`Add materials to “${fg.name}”`}
                                    className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-primary"
                                    onClick={() => onOpenProduct?.(fg._id)}
                                  >
                                    <Plus className="size-3" />
                                  </button>
                                  <ProductionButton fg={fg} />
                                  <button
                                    type="button"
                                    title="Remove from this job — the product stays in Products"
                                    aria-label={`Remove “${fg.name}” from this job`}
                                    className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive"
                                    onClick={() =>
                                      void handleRemoveProductFromProject(fg, {
                                        projectName: p.name,
                                        jobId: job._id,
                                        jobName: job.name,
                                      })
                                    }
                                  >
                                    <PackageMinus className="size-3" />
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
                            title="Open the product's side panel"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={() => openNode("product", String(fg._id))}
                          >
                            <Package className="size-3 shrink-0 text-sky-500/80" />
                            <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                              <span className="flex min-w-0 max-w-full items-baseline gap-1.5">
                                <span className="min-w-0 truncate font-medium">
                                  {fg.name}
                                </span>
                                <ProductCodeInline code={fg.code} />
                                <MoneyBracket
                                  amount={productCostLabel(fg, costByFg.get(fg._id) ?? 0, money)}
                                  tone="cost"
                                  title="Quantity × unit cost = production cost for the whole batch"
                                />
                                <ProductTagsInline tags={fg.tags} />
                              </span>
                              {fg.note && (
                                <span className="w-full truncate text-[10px] text-muted-foreground/80">
                                  {fg.note}
                                </span>
                              )}
                            </span>
                            <Sigma className="size-3 shrink-0 text-muted-foreground/40" />
                          </button>
                          <PriorityChip priority={fg.priority} />
                          <button
                            type="button"
                            title="Add materials and custom lines to this product's costing sheet"
                            aria-label={`Add materials to “${fg.name}”`}
                            className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-primary"
                            onClick={() => onOpenProduct?.(fg._id)}
                          >
                            <Plus className="size-3" />
                          </button>
                          <button
                            type="button"
                            title="Remove from this project — the product stays in Products"
                            aria-label={`Remove “${fg.name}” from this project`}
                            className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-destructive"
                            onClick={() =>
                              void handleRemoveProductFromProject(fg, {
                                projectName: p.name,
                              })
                            }
                          >
                            <PackageMinus className="size-3" />
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
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/70 bg-primary/5 px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Products: {totals.products} · Jobs: {totals.jobs}
            </span>
            <MoneyBracket
              amount={money(totals.total)}
              tone="primary"
              title="Total project value — the production cost of every product, quantities included, margin not added"
              className="text-[11px]"
            />
          </div>
        )}
      </section>
      </div>

      {/* the side panel — one project, job or product at a time */}
      {pane !== null && paneDoc !== null && (
        <div className="mt-4 min-w-0 lg:mt-3">
          <Suspense fallback={null}>
            {pane.kind === "product" ? (
              <ProductDetailPanel
                key={`product:${pane.id}`}
                fg={paneDoc as FgDoc}
                jobs={allJobs ?? []}
                projects={projects ?? []}
                onClose={() => setPane(null)}
                onDelete={() => void handleDeleteProductFromPane(paneDoc as FgDoc)}
                canEdit={onEditProject !== undefined}
              />
            ) : (
              <ProjectDetailPanel
                key={`${pane.kind}:${pane.id}`}
                kind={pane.kind}
                doc={paneDoc as ProjectDoc | JobDoc}
                parentLabel={paneJobParent}
                onClose={() => setPane(null)}
                onDelete={
                  pane.kind === "project"
                    ? onDeleteProject
                      ? () => onDeleteProject(paneDoc as ProjectDoc)
                      : undefined
                    : () => {
                        const job = paneDoc as JobDoc;
                        const count = finishedGoods.filter(
                          (f) =>
                            f.jobId === job._id || (f.jobIds ?? []).includes(job._id),
                        ).length;
                        void handleDeleteJobFromList(job, count);
                      }
                }
                canEdit={onEditProject !== undefined}
              />
            )}
          </Suspense>
        </div>
      )}
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        A project groups jobs, and jobs group finished goods — its cost and
        total are the sum of all its products. Click a project, job or product
        name to open its side panel, or the chevron to expand a project's jobs.
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
    </div>
  );
}
