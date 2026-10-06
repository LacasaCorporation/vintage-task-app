import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/checkbox";
import ProductQtyStepper from "@/components/ProductQtyStepper";
import ProductCodeInline from "@/components/ProductCodeInline";
import ProductTagsInline from "@/components/ProductTagsInline";
import PriorityChip from "@/components/PriorityChip";
import StatusSelect from "@/components/StatusSelect";
import {
  Briefcase,
  CalendarRange,
  ChartGantt,
  ChevronDown,
  Diamond,
  Flag,
  Folder,
  GripVertical,
  MoveHorizontal,
  SquareKanban,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  middleProjectStatuses,
  PROJECT_STATUS_FINISH,
  projectStatusesOrDefaults,
  productLockedReason,
} from "@/lib/project-statuses";
import {
  DueChips,
  ProductionButton,
  fgProjectStatus,
  jobProjectStatus,
  matchesStatusFilter,
  projectDocStatus,
  sortFgs,
  sortJobs,
  tagChip,
  type FgDoc,
  type FlagStatusFilter,
  type FlaggedData,
  type FlaggedSel,
  type JobDoc,
  type SortMode,
} from "@/components/FlaggedLists";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "@/lib/toast";

/**
 * How the workspace is drawn. `list` and `hierarchy` are the two reading
 * orders of the same tree, `board` and `report` the two views of the products;
 * `kanban` and `gantt` are the planning pair over projects and jobs — the
 * board says where each one stands in the workflow, the timeline says when the
 * dated work lands.
 */
export type WorkspaceView =
  | "list"
  | "hierarchy"
  | "board"
  | "report"
  | "kanban"
  | "gantt";

/** The view buttons offered for each level filter. */
export const VIEWS_BY_FILTER: Record<string, { view: WorkspaceView; label: string; icon: string }[]> = {
  projects: [
    { view: "list", label: "Project list", icon: "list" },
    { view: "hierarchy", label: "Project hierarchy", icon: "tree" },
    { view: "kanban", label: "Kanban board", icon: "kanban" },
    { view: "gantt", label: "Gantt timeline", icon: "gantt" },
  ],
  jobs: [
    { view: "list", label: "Job list", icon: "list" },
    { view: "hierarchy", label: "Job hierarchy", icon: "tree" },
    { view: "kanban", label: "Kanban board", icon: "kanban" },
    { view: "gantt", label: "Gantt timeline", icon: "gantt" },
  ],
  products: [
    { view: "list", label: "Product list", icon: "list" },
    { view: "board", label: "Board view", icon: "board" },
    { view: "report", label: "Production report", icon: "report" },
  ],
};

/** Which view a level filter falls back to when the current one isn't offered. */
export const DEFAULT_VIEW_BY_FILTER: Record<string, WorkspaceView> = {
  // the project → job → product tree is the Projects view; the Jobs filter
  // shows each job with its own product lines, so the tree lives here
  projects: "hierarchy",
  jobs: "hierarchy",
  products: "list",
};

/** The view that is actually shown: the chosen one, or that filter's default. */
export function resolveView(filter: string, view: WorkspaceView): WorkspaceView {
  const allowed = VIEWS_BY_FILTER[filter]?.map((entry) => entry.view) ?? ["list"];
  return allowed.includes(view) ? view : (DEFAULT_VIEW_BY_FILTER[filter] ?? "list");
}

const CHECK_CLS =
  "size-5 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-3";
const CHECK_CLS_SM =
  "size-4 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-2.5";

/** Products of a job, from the same `finishedGoods` list the filters use. */
function productsOfJob(fgs: FgDoc[], jobId: Id<"projectJobs">): FgDoc[] {
  return fgs.filter((f) => f.jobId === jobId || (f.jobIds ?? []).includes(jobId));
}

/**
 * Projects filter — hierarchy view: every project, the jobs inside it and the
 * products inside each job, each level collapsible so a big portfolio can be
 * walked without scrolling past everything.
 */
export function ProjectHierarchy({
  projects,
  jobs,
  fgs,
  projectStatuses: configuredProjectStatuses,
  statusFilter = "all",
  sortMode = "manual",
  selection,
  onSelect,
  busyKey,
  onToggleJob,
  onToggleFg,
}: {
  projects: Doc<"projects">[];
  jobs: JobDoc[];
  fgs: FgDoc[];
  projectStatuses?: string[];
  statusFilter?: FlagStatusFilter;
  sortMode?: SortMode;
  selection?: FlaggedSel;
  onSelect?: (sel: FlaggedSel) => void;
  busyKey: string | null;
  onToggleJob: (job: JobDoc) => void;
  onToggleFg: (fg: FgDoc) => void;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // stable key so the memo below only re-runs when the status list changes
  const statusKey = projectStatuses.join("|");
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const visible = useMemo(
    () =>
      projects.filter((project) =>
        matchesStatusFilter(
          statusFilter ?? "all",
          projectDocStatus(project, projectStatuses),
          project.status === "completed" || project.status === "cancelled",
        ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, statusFilter, statusKey],
  );

  if (visible.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <Folder className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">
          {statusFilter === "all" ? "No projects yet" : "No projects in this status"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {statusFilter === "all"
            ? "Create a project in the Projects page and it will show up here."
            : "Choose another status filter to see more projects."}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/70">
      {visible.map((project) => {
        const status = projectDocStatus(project, projectStatuses);
        const projectDone = status === PROJECT_STATUS_FINISH;
        const isCollapsed = collapsed.has(project._id);
        const projectJobs = sortJobs(
          jobs.filter(
            (job) =>
              job.projectId === project._id &&
              matchesStatusFilter(
                statusFilter ?? "all",
                jobProjectStatus(job, projectStatuses),
                job.status === "completed",
              ),
          ),
          sortMode,
        );
        const projectProducts = fgs.filter((f) =>
          productJobIds(f).some((jid) => projectJobs.some((j) => j._id === jid)),
        );
        return (
          <li
            key={project._id}
            className={cn(
              "transition-colors",
              projectDone && "opacity-60",
              selection?.kind === "project" &&
                selection.id === project._id &&
                "bg-primary/[0.04]",
            )}
          >
            {/* project header: doubles as the collapse toggle */}
            <div
              className={cn(
                "flex flex-wrap items-center gap-2 px-4 py-3",
                projectDone && "opacity-60",
              )}
            >
              <button
                type="button"
                onClick={() => toggle(project._id)}
                aria-expanded={!isCollapsed}
                title={isCollapsed ? "Expand project" : "Collapse project"}
                className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 transition-transform",
                    isCollapsed && "-rotate-90",
                  )}
                />
              </button>
              <Folder
                className={cn(
                  "size-4 shrink-0",
                  projectDone ? "text-emerald-500" : "text-sky-500/80",
                )}
              />
              <button
                type="button"
                onClick={() => onSelect?.({ kind: "project", id: project._id })}
                className={cn(
                  "min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium",
                  projectDone && "text-muted-foreground line-through",
                )}
              >
                {project.name}
              </button>
              {project.code && (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {project.code}
                </span>
              )}
              {project.client && <span className={tagChip}>{project.client}</span>}
              <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-sky-700 dark:text-sky-400">
                {projectJobs.length} job{projectJobs.length === 1 ? "" : "s"}
              </span>
              <span className="shrink-0 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-violet-700 dark:text-violet-400">
                {projectProducts.length} product
                {projectProducts.length === 1 ? "" : "s"}
              </span>
              <DueChips dueAt={project.dueAt} />
              <span className={tagChip}>{status}</span>
            </div>

            {isCollapsed ? null : (
              <div className="border-l border-border/60 pb-2 pl-7">
                {projectJobs.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">
                    No jobs match this status filter.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {projectJobs.map((job) => (
                      <li key={job._id}>
                        <JobRow
                          job={job}
                          fgs={fgs}
                          projectStatuses={projectStatuses}
                          statusFilter={statusFilter}
                          busyKey={busyKey}
                          selection={selection}
                          onSelect={onSelect}
                          onToggleJob={onToggleJob}
                          onToggleFg={onToggleFg}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One job with its products, as a collapsible branch of the hierarchy. */
function JobRow({
  job,
  fgs,
  projectStatuses,
  statusFilter,
  busyKey,
  selection,
  onSelect,
  onToggleJob,
  onToggleFg,
}: {
  job: JobDoc;
  fgs: FgDoc[];
  projectStatuses: string[];
  statusFilter: FlagStatusFilter;
  busyKey: string | null;
  selection?: FlaggedSel;
  onSelect?: (sel: FlaggedSel) => void;
  onToggleJob: (job: JobDoc) => void;
  onToggleFg: (fg: FgDoc) => void;
}) {
  const [open, setOpen] = useState(true);
  const setFgStatusM = useMutation(api.costing.setFgProjectStatus);
  const allProducts = productsOfJob(fgs, job._id);
  const products = sortFgs(
    allProducts.filter((f) =>
      matchesStatusFilter(
        statusFilter ?? "all",
        fgProjectStatus(f, projectStatuses),
        f.isCompleted ?? false,
      ),
    ),
    "manual",
  );
  const done = jobProjectStatus(job, projectStatuses) === PROJECT_STATUS_FINISH;
  const allProductsDone =
    allProducts.length > 0 && allProducts.every((f) => f.isCompleted);
  const disabled = busyKey !== null || (!done && !allProductsDone);

  return (
    <div
      className={cn(
        "rounded-lg bg-muted/40",
        selection?.kind === "job" && selection.id === job._id && "bg-primary/10",
      )}
    >
      <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
        <Checkbox
          checked={done}
          disabled={disabled}
          onCheckedChange={() => onToggleJob(job)}
          aria-label={
            done ? `Reopen job “${job.name}”` : `Mark job “${job.name}” as done`
          }
          title={
            !done && !allProductsDone
              ? allProducts.length === 0
                ? "No products to complete yet"
                : "Complete all products first"
              : undefined
          }
          className={CHECK_CLS}
        />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          title={open ? "Hide products" : "Show products"}
          className="grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ChevronDown
            className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
          />
        </button>
        <Flag
          className={cn(
            "size-3.5 shrink-0",
            done ? "fill-emerald-400 text-emerald-500" : "fill-amber-400 text-amber-500",
          )}
        />
        <Briefcase className="size-3.5 shrink-0 text-sky-500/80" />
        <button
          type="button"
          onClick={() => onSelect?.({ kind: "job", id: job._id })}
          className={cn(
            "min-w-0 flex-1 cursor-pointer truncate text-left font-medium",
            done && "text-muted-foreground line-through",
          )}
        >
          {job.name}
        </button>
        {allProducts.length > 0 && (
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              done
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-muted text-muted-foreground",
            )}
            title="Products completed"
          >
            {allProducts.filter((f) => f.isCompleted).length}/{allProducts.length}
          </span>
        )}
        <DueChips dueAt={job.dueAt} />
        <span className={tagChip}>{jobProjectStatus(job, projectStatuses)}</span>
      </div>

      {open && products.length > 0 && (
        <ul className="mt-0.5 space-y-1 pb-1 pl-7">
          {products.map((fg) => (
            <li
              key={fg._id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-lg bg-card px-2 py-1 text-xs transition-colors hover:bg-accent",
                selection?.kind === "fg" && selection.id === fg._id && "bg-primary/10",
                fg.isCompleted && "opacity-60",
              )}
            >
              <Checkbox
                checked={fg.isCompleted ?? false}
                disabled={busyKey !== null}
                onCheckedChange={() => onToggleFg(fg)}
                aria-label={
                  fg.isCompleted
                    ? `Reopen product “${fg.name}”`
                    : `Mark product “${fg.name}” as done`
                }
                className={CHECK_CLS_SM}
              />
              <button
                type="button"
                onClick={() => onSelect?.({ kind: "fg", id: fg._id })}
                className={cn(
                  "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 text-left",
                  fg.isCompleted && "text-muted-foreground line-through",
                )}
              >
                <span className="flex min-w-0 max-w-full items-baseline gap-1.5">
                  <span className="min-w-0 truncate">{fg.name}</span>
                  <ProductCodeInline code={fg.code} />
                  <ProductTagsInline tags={fg.tags} />
                </span>
                {fg.note && (
                  <span className="w-full truncate text-[10px] text-muted-foreground/80 line-through-0">
                    {fg.note}
                  </span>
                )}
              </button>
              {/* extra quantity for a product already on this job — the batch
                  used to be asked for once, at the moment of linking */}
              <ProductQtyStepper
                fgId={fg._id}
                jobId={job._id}
                qty={fg.qty}
                unit={fg.unit}
                frozen={productLockedReason(fg) !== null}
                frozenReason={productLockedReason(fg) ?? undefined}
              />
              <DueChips
                dueAt={fg.dueAt ?? job.dueAt}
                inherited={fg.dueAt === undefined && job.dueAt !== undefined}
              />
              <PriorityChip priority={fg.priority} />
              {/* the status is readable here, but only editable once the
                  product is actually in production */}
              <StatusSelect
                value={fgProjectStatus(fg, projectStatuses)}
                statuses={middleProjectStatuses(
                  projectStatuses,
                  fgProjectStatus(fg, projectStatuses),
                )}
                disabled={fg.productionStartedAt === undefined}
                title={
                  fg.productionStartedAt === undefined
                    ? "Start production to change the status"
                    : "Change the status"
                }
                onChange={(status) =>
                  void setFgStatusM({ id: fg._id, status }).catch((error) =>
                    toast.error(
                      error instanceof Error
                        ? error.message
                        : "Couldn't update the product status.",
                    ),
                  )
                }
              />
              <ProductionButton fg={fg} jobId={job._id} hideStatusPill />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The job ids a product belongs to, whichever field holds them. */
function productJobIds(fg: FgDoc): Id<"projectJobs">[] {
  return (fg.jobIds ?? (fg.jobId ? [fg.jobId] : [])) as Id<"projectJobs">[];
}

/**
 * Jobs filter — list view: one flat row per job, with the project it belongs to
 * as a tag. The hierarchy view is the same data nested one level deeper.
 */
export function JobFlatList({
  data,
  allJobs,
  allFgs,
  projectStatuses: configuredProjectStatuses,
  statusFilter = "all",
  sortMode = "manual",
  selection,
  onSelect,
  busyKey,
  onToggleJob,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  allFgs: FgDoc[];
  projectStatuses?: string[];
  statusFilter?: FlagStatusFilter;
  sortMode?: SortMode;
  selection?: FlaggedSel;
  onSelect?: (sel: FlaggedSel) => void;
  busyKey: string | null;
  onToggleJob: (job: JobDoc) => void;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );

  const rows = sortJobs(allJobs, sortMode).filter(
    (job) =>
      matchesStatusFilter(
        statusFilter ?? "all",
        jobProjectStatus(job, projectStatuses),
        job.status === "completed",
      ) &&
      // the Jobs filter lists what has to be made, so a job with no products
      // has no line to show
      productsOfJob(allFgs, job._id).length > 0,
  );

  if (rows.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <Briefcase className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">
          {statusFilter === "all"
            ? "No jobs with products"
            : "No jobs in this status"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {statusFilter === "all"
            ? "This filter lists each job together with the products it has to make. Add a product to a job and it shows up here."
            : "Choose another status filter to see more jobs."}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/70">
      {rows.map((job) => {
        const done = jobProjectStatus(job, projectStatuses) === PROJECT_STATUS_FINISH;
        const allProducts = productsOfJob(allFgs, job._id);
        const allProductsDone =
          allProducts.length > 0 && allProducts.every((f) => f.isCompleted);
        const disabled = busyKey !== null || (!done && !allProductsDone);
        const product = allProducts.find((f) => f.productionStartedAt !== undefined);
        return (
          <li
            key={job._id}
            className={cn(
              "flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm transition-colors",
              done && "opacity-60",
              selection?.kind === "job" && selection.id === job._id && "bg-primary/[0.04]",
            )}
          >
            <Checkbox
              checked={done}
              disabled={disabled}
              onCheckedChange={() => onToggleJob(job)}
              aria-label={
                done ? `Reopen job “${job.name}”` : `Mark job “${job.name}” as done`
              }
              title={
                !done && !allProductsDone
                  ? allProducts.length === 0
                    ? "No products to complete yet"
                    : "Complete all products first"
                  : undefined
              }
              className={CHECK_CLS}
            />
            <Flag
              className={cn(
                "size-3.5 shrink-0",
                done
                  ? "fill-emerald-400 text-emerald-500"
                  : "fill-amber-400 text-amber-500",
              )}
            />
            <Briefcase className="size-3.5 shrink-0 text-sky-500/80" />
            <button
              type="button"
              onClick={() => onSelect?.({ kind: "job", id: job._id })}
              className={cn(
                "min-w-0 flex-1 cursor-pointer truncate text-left font-medium",
                done && "text-muted-foreground line-through",
              )}
            >
              {job.name}
            </button>
            {allProducts.length > 0 && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                  done
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted text-muted-foreground",
                )}
                title="Products completed"
              >
                {allProducts.filter((f) => f.isCompleted).length}/{allProducts.length}
              </span>
            )}
            {product && (
              <span
                className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                title={`“${product.name}” is in production`}
              >
                In production
              </span>
            )}
            <DueChips dueAt={job.dueAt} />
            <span className={tagChip}>{data.projectNameOf(job)}</span>
            <span className={tagChip}>{jobProjectStatus(job, projectStatuses)}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ── Planning views: the board and the timeline ────────────────────────────
//
// The hierarchy says what is inside what. These two answer the planning
// questions instead: the Kanban board says where each project or job stands in
// the workflow, and the Gantt timeline says when the dated work lands. Both
// read the same projects, jobs and products the tree does, and both write
// through the same `projectStatus` field the tree's own chips write — so a card
// dragged on the board is a chip moved in the tree, and the two never disagree.

/**
 * The colour of a status, by its position in the workflow rather than its name.
 * The statuses are renameable, so this keeps the two ends of the workflow — the
 * first status and Finish — the same two colours whatever the reader called
 * them, with the middle of the workflow in violet.
 */
function statusAccent(index: number, total: number): string {
  if (index <= 0) return "bg-sky-500";
  if (index >= total - 1) return "bg-emerald-500";
  return "bg-violet-500";
}

/** The same status colour, as ink for an icon rather than a fill. */
function statusInk(index: number, total: number): string {
  if (index <= 0) return "text-sky-500";
  if (index >= total - 1) return "text-emerald-500";
  return "text-violet-500";
}

/** One card on the board, whichever level it came from. */
type BoardCard = {
  key: string;
  projectId?: Id<"projects">;
  jobId?: Id<"projectJobs">;
  name: string;
  code?: string;
  /** the project a job belongs to, or the client a project is for */
  tag?: string;
  dueAt?: number;
  status: string;
  done: boolean;
  /** jobs (and their products) under a project */
  jobs?: number;
  products?: number;
  /** products finished out of the products linked to a job */
  progress?: { done: number; total: number };
};

/**
 * Projects or Jobs filter — Kanban view: one column per Projects status, one
 * card per project (or per job).
 *
 * A card can be dragged into another column, or moved with the status dropdown
 * it carries — the drag is for the mouse, the dropdown for touch, keyboard and
 * screen readers. Either way the move writes the row's `projectStatus`, which
 * is the same field the hierarchy chips and the Finish guard read, so the
 * server's own rules (all products done before a job finishes, all jobs done
 * before a project does) still hold: a refusal comes back as a toast and the
 * card stays where it was.
 */
export function ProjectKanban({
  mode,
  projects,
  jobs,
  fgs,
  projectStatuses: configuredProjectStatuses,
  statusFilter = "all",
  sortMode = "manual",
  selection,
  onSelect,
  canEdit = true,
}: {
  mode: "projects" | "jobs";
  projects: Doc<"projects">[];
  jobs: JobDoc[];
  fgs: FgDoc[];
  projectStatuses?: string[];
  statusFilter?: FlagStatusFilter;
  sortMode?: SortMode;
  selection?: FlaggedSel;
  onSelect?: (sel: FlaggedSel) => void;
  /** False for viewers — the board then reads without offering a move. */
  canEdit?: boolean;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );
  const setProjectStatusM = useMutation(api.costing.setProjectProjectStatus);
  const setJobStatusM = useMutation(api.jobs.setJobProjectStatus);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const cards = useMemo<BoardCard[]>(() => {
    const keep = (status: string, done: boolean) =>
      matchesStatusFilter(statusFilter ?? "all", status, done);

    if (mode === "jobs") {
      const projectNameOf = new Map(
        projects.map((project) => [String(project._id), project.name] as const),
      );
      return sortJobs(jobs, sortMode).flatMap((job) => {
        const status = jobProjectStatus(job, projectStatuses);
        const done = status === PROJECT_STATUS_FINISH;
        if (!keep(status, done)) return [];
        const products = productsOfJob(fgs, job._id);
        return [
          {
            key: `j:${job._id}`,
            jobId: job._id,
            name: job.name,
            code: job.code,
            tag: projectNameOf.get(String(job.projectId)) ?? "Project",
            dueAt: job.dueAt,
            status,
            done,
            products: products.length,
            progress: {
              done: products.filter((product) => product.isCompleted).length,
              total: products.length,
            },
          },
        ];
      });
    }

    return projects.flatMap((project) => {
      const status = projectDocStatus(project, projectStatuses);
      const done = status === PROJECT_STATUS_FINISH;
      if (!keep(status, done)) return [];
      const projectJobs = jobs.filter((job) => job.projectId === project._id);
      const jobIds = new Set(projectJobs.map((job) => String(job._id)));
      const products = fgs.filter((fg) =>
        productJobIds(fg).some((jobId) => jobIds.has(String(jobId))),
      );
      return [
        {
          key: `p:${project._id}`,
          projectId: project._id,
          name: project.name,
          code: project.code,
          tag: project.client,
          dueAt: project.dueAt,
          status,
          done,
          jobs: projectJobs.length,
          products: products.length,
        },
      ];
    });
  }, [mode, projects, jobs, fgs, projectStatuses, statusFilter, sortMode]);

  /** Write a card's move through the workflow, or explain why it was refused. */
  const move = async (key: string | null, status: string) => {
    if (!canEdit || key === null) return;
    const card = cards.find((entry) => entry.key === key);
    if (card === undefined || card.status === status) {
      setDragging(null);
      setDropTarget(null);
      return;
    }
    setBusyKey(card.key);
    try {
      if (card.jobId !== undefined) await setJobStatusM({ id: card.jobId, status });
      else if (card.projectId !== undefined)
        await setProjectStatusM({ id: card.projectId, status });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't move the card.",
      );
    } finally {
      setBusyKey(null);
      setDragging(null);
      setDropTarget(null);
    }
  };

  if (cards.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <SquareKanban className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">Nothing to plan yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === "jobs"
            ? "Flag a job in the Projects page and it lands on this board."
            : "Flag work under a project and the project lands on this board."}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto p-3">
      <ul className="flex min-w-max items-start gap-3">
        {projectStatuses.map((status, index) => {
          const column = cards.filter((card) => card.status === status);
          const accent = statusAccent(index, projectStatuses.length);
          const isTarget = dragging !== null && dropTarget === status;
          return (
            <li
              key={status}
              aria-label={`${status} — ${column.length} ${column.length === 1 ? "card" : "cards"}`}
              onDragOver={(event) => {
                if (!canEdit || dragging === null) return;
                // without this the drop is never allowed
                event.preventDefault();
                setDropTarget(status);
              }}
              onDragLeave={(event) => {
                // dragleave also fires on the way over a card inside the
                // column, so only a move to something outside counts
                if (
                  event.currentTarget.contains(event.relatedTarget as Node | null)
                )
                  return;
                setDropTarget((current) => (current === status ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                void move(dragging, status);
              }}
              className={cn(
                "flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border bg-muted/30 transition-colors",
                isTarget && "border-primary/50 bg-primary/[0.06]",
              )}
            >
              <span className={cn("h-1 w-full", accent)} />
              <div className="flex items-center gap-2 px-3 py-2">
                <span className={cn("size-2 shrink-0 rounded-full", accent)} />
                <span className="min-w-0 truncate text-xs font-semibold">
                  {status}
                </span>
                <span className="ml-auto shrink-0 rounded-full bg-card px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                  {column.length}
                </span>
              </div>
              <ul className="flex min-h-16 flex-col gap-2 px-2 pb-2">
                {column.length === 0 ? (
                  <li className="grid flex-1 place-items-center rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
                    {isTarget ? "Drop here" : "Empty"}
                  </li>
                ) : (
                  column.map((card) => {
                    const selected =
                      card.jobId !== undefined
                        ? selection?.kind === "job" && selection.id === card.jobId
                        : selection?.kind === "project" &&
                          selection.id === card.projectId;
                    return (
                      <li
                        key={card.key}
                        className={cn(
                          "overflow-hidden rounded-lg border bg-card shadow-sm transition-opacity",
                          selected && "border-primary/40",
                          dragging === card.key && "opacity-40",
                          busyKey === card.key && "opacity-60",
                        )}
                      >
                        {/* the draggable body stops short of the status
                            dropdown, so picking a status never starts a drag */}
                        <div
                          draggable={canEdit && busyKey === null}
                          onDragStart={() => setDragging(card.key)}
                          onDragEnd={() => {
                            setDragging(null);
                            setDropTarget(null);
                          }}
                          className={cn(
                            "flex flex-col gap-1.5 px-2.5 py-2.5",
                            canEdit && "cursor-grab active:cursor-grabbing",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              card.jobId !== undefined
                                ? onSelect?.({ kind: "job", id: card.jobId })
                                : card.projectId !== undefined &&
                                  onSelect?.({ kind: "project", id: card.projectId })
                            }
                            className={cn(
                              "flex min-w-0 items-center gap-1.5 text-left text-sm font-medium",
                              card.done && "text-muted-foreground line-through",
                            )}
                          >
                            {card.jobId !== undefined ? (
                              <Briefcase className="size-3.5 shrink-0 text-sky-500/80" />
                            ) : (
                              <Folder
                                className={cn(
                                  "size-3.5 shrink-0",
                                  card.done ? "text-emerald-500" : "text-sky-500/80",
                                )}
                              />
                            )}
                            <span className="min-w-0 truncate">{card.name}</span>
                          </button>
                          <span className="flex flex-wrap items-center gap-1">
                            {card.code && (
                              <span className="font-mono text-[10px] text-muted-foreground/70">
                                {card.code}
                              </span>
                            )}
                            {card.tag && <span className={tagChip}>{card.tag}</span>}
                          </span>
                          <span className="flex flex-wrap items-center gap-1">
                            {card.jobs !== undefined && (
                              <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-sky-700 dark:text-sky-400">
                                {card.jobs} job{card.jobs === 1 ? "" : "s"}
                              </span>
                            )}
                            {card.products !== undefined && card.progress === undefined && (
                              <span className="shrink-0 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-violet-700 dark:text-violet-400">
                                {card.products} product{card.products === 1 ? "" : "s"}
                              </span>
                            )}
                            {card.progress !== undefined && card.progress.total > 0 && (
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                                  card.done
                                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                    : "bg-muted text-muted-foreground",
                                )}
                                title="Products completed"
                              >
                                {card.progress.done}/{card.progress.total} products
                              </span>
                            )}
                            <DueChips dueAt={card.dueAt} />
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-2 py-1">
                          <StatusSelect
                            value={card.status}
                            statuses={projectStatuses}
                            disabled={!canEdit || busyKey !== null}
                            title={
                              canEdit
                                ? "Move to another status"
                                : "Read-only — you cannot change the status"
                            }
                            onChange={(next) => void move(card.key, next)}
                          />
                          {canEdit && (
                            <GripVertical
                              aria-hidden
                              className="size-3.5 shrink-0 text-muted-foreground/40"
                            />
                          )}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── The timeline ──────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
/** Wide enough for a name and its counts; matches the sticky label column. */
const GANTT_LABEL_W = 244;
/** Wide enough for the two due chips, which wrap when they need to. */
const GANTT_DUE_W = 132;

/** Midnight of a day, so a bar never drifts across a daylight-saving shift. */
function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function monthStart(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** The exclusive end of the month a timestamp falls in. */
function monthEnd(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
}

type MonthBand = { key: string; label: string; from: number; to: number };

/** The month columns across a span, each as its own share of the timeline. */
function monthBands(start: number, end: number): MonthBand[] {
  const bands: MonthBand[] = [];
  let cursor = monthStart(start);
  while (cursor < end) {
    const date = new Date(cursor);
    bands.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString(undefined, { month: "short", year: "numeric" }),
      from: cursor,
      to: monthEnd(cursor),
    });
    cursor = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
  }
  return bands;
}

/** A line drawn on the timeline. */
type GanttRow = {
  key: string;
  projectId?: Id<"projects">;
  jobId?: Id<"projectJobs">;
  name: string;
  code?: string;
  /** 0 for the level the filter is on, 1 for a project's jobs */
  depth: 0 | 1;
  start: number;
  end: number;
  /** the end is the parent project's due date, not the job's own */
  inherited?: boolean;
  status: string;
  done: boolean;
  meta?: string;
};

/** A bar being dragged along the timeline. */
type GanttDrag = {
  key: string;
  startX: number;
  /**
   * Pixels per day in the track that was grabbed, measured on pointerdown: the
   * track is as wide as the card allows it to be, so the day scale cannot be
   * worked out from the timeline alone.
   */
  pxPerDay: number;
  /** How many days the bar has been pulled, snapped to whole days. */
  days: number;
};

/** A row the timeline cannot draw, listed underneath instead. */
type GanttPending = {
  key: string;
  projectId?: Id<"projects">;
  jobId?: Id<"projectJobs">;
  name: string;
  meta?: string;
};

/**
 * Projects or Jobs filter — Gantt view: one bar per project (or job) from the
 * day it was created to the day it is due, with a milestone at the due date.
 *
 * Only a due date can end a bar, so anything still without one is listed below
 * the chart rather than drawn at a made-up width — planning starts by giving it
 * a date. A job with no due date of its own inherits the project's, the same
 * way its due chips already do, and its milestone is drawn hollow to say so.
 *
 * Rescheduling is done by dragging a bar to the day it should land on (arrow
 * keys do the same a day at a time), which writes the existing `dueAt` through
 * `updateProject` / `updateJob` — a bar only ever moves its end date, because
 * its start is the day the work was created and that cannot be moved.
 */
export function ProjectGantt({
  mode,
  projects,
  jobs,
  fgs,
  projectStatuses: configuredProjectStatuses,
  statusFilter = "all",
  sortMode = "manual",
  selection,
  onSelect,
  canEdit = true,
}: {
  mode: "projects" | "jobs";
  projects: Doc<"projects">[];
  jobs: JobDoc[];
  fgs: FgDoc[];
  projectStatuses?: string[];
  statusFilter?: FlagStatusFilter;
  sortMode?: SortMode;
  selection?: FlaggedSel;
  onSelect?: (sel: FlaggedSel) => void;
  /** False for viewers — the bars then read without offering a drag. */
  canEdit?: boolean;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );
  const updateProjectM = useMutation(api.costing.updateProject);
  const updateJobM = useMutation(api.jobs.updateJob);
  const [drag, setDrag] = useState<GanttDrag | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // the date a row is going to have, held until the write comes back so a
  // dragged bar never snaps to its old place while the round trip is in flight
  const [pendingEnd, setPendingEnd] = useState<{ key: string; end: number } | null>(
    null,
  );
  // read once per mount rather than on every render, so the today line and the
  // overdue rings stay put while the page is open
  const [today] = useState(() => dayStart(Date.now()));

  const { rows, unscheduled } = useMemo(() => {
    const charted: GanttRow[] = [];
    const pending: GanttPending[] = [];
    const keep = (status: string, done: boolean) =>
      matchesStatusFilter(statusFilter ?? "all", status, done);
    const plural = (count: number, noun: string) =>
      `${count} ${noun}${count === 1 ? "" : "s"}`;

    if (mode === "jobs") {
      for (const job of sortJobs(jobs, sortMode)) {
        const status = jobProjectStatus(job, projectStatuses);
        const done = status === PROJECT_STATUS_FINISH;
        if (!keep(status, done)) continue;
        const project = projects.find((entry) => entry._id === job.projectId);
        const products = productsOfJob(fgs, job._id);
        const finished = products.filter((product) => product.isCompleted).length;
        const meta = [
          project?.name ?? "Project",
          products.length > 0 ? `${finished}/${products.length} products` : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(" · ");
        if (job.dueAt === undefined) {
          pending.push({ key: `j:${job._id}`, jobId: job._id, name: job.name, meta });
          continue;
        }
        charted.push({
          key: `j:${job._id}`,
          jobId: job._id,
          name: job.name,
          code: job.code,
          depth: 0,
          start: job._creationTime,
          end: job.dueAt,
          status,
          done,
          meta,
        });
      }
      return { rows: charted, unscheduled: pending };
    }

    for (const project of projects) {
      const status = projectDocStatus(project, projectStatuses);
      const done = status === PROJECT_STATUS_FINISH;
      if (!keep(status, done)) continue;
      const projectJobs = sortJobs(
        jobs.filter((job) => job.projectId === project._id),
        sortMode,
      );
      const jobIds = new Set(projectJobs.map((job) => String(job._id)));
      const products = fgs.filter((fg) =>
        productJobIds(fg).some((jobId) => jobIds.has(String(jobId))),
      );
      const meta = `${plural(projectJobs.length, "job")} · ${plural(products.length, "product")}`;
      if (project.dueAt === undefined) {
        pending.push({
          key: `p:${project._id}`,
          projectId: project._id,
          name: project.name,
          meta,
        });
        continue;
      }
      charted.push({
        key: `p:${project._id}`,
        projectId: project._id,
        name: project.name,
        code: project.code,
        depth: 0,
        start: project._creationTime,
        end: project.dueAt,
        status,
        done,
        meta,
      });
      for (const job of projectJobs) {
        const jobStatus = jobProjectStatus(job, projectStatuses);
        const jobDone = jobStatus === PROJECT_STATUS_FINISH;
        if (!keep(jobStatus, jobDone)) continue;
        // a job with no due date of its own is planned against the project's
        const end = job.dueAt ?? project.dueAt;
        const jobProducts = productsOfJob(fgs, job._id);
        const jobFinished = jobProducts.filter(
          (product) => product.isCompleted,
        ).length;
        charted.push({
          key: `j:${job._id}`,
          jobId: job._id,
          name: job.name,
          code: job.code,
          depth: 1,
          start: job._creationTime,
          end,
          inherited: job.dueAt === undefined,
          status: jobStatus,
          done: jobDone,
          meta:
            jobProducts.length > 0
              ? `${jobFinished}/${jobProducts.length} products`
              : undefined,
        });
      }
    }
    return { rows: charted, unscheduled: pending };
  }, [mode, projects, jobs, fgs, projectStatuses, statusFilter, sortMode]);

  const timeline = useMemo(() => {
    const stamps = rows.flatMap((row) => [row.start, row.end]);
    stamps.push(today);
    // a two-year horizon either side of today keeps a stray date in 2099 from
    // stretching the chart into thousands of unreadable columns
    const horizon = 400 * DAY_MS;
    const min = monthStart(
      Math.max(Math.min(...stamps), today - horizon),
    );
    const max = monthEnd(Math.min(Math.max(...stamps), today + horizon));
    const span = Math.max(max - min, DAY_MS);
    return {
      min,
      max,
      bands: monthBands(min, max),
      /** Where a timestamp sits across the track, as a percentage. */
      pct: (at: number) =>
        ((Math.min(Math.max(at, min), max) - min) / span) * 100,
      // ~3.2px a day, so a short span still fills the card and a long one scrolls
      trackWidth: Math.max(Math.round(span / DAY_MS) * 3.2, 420),
      /** How many days the track spans, for turning a drag into whole days. */
      days: span / DAY_MS,
    };
  }, [rows, today]);

  /**
   * The date a row has been dragged to, while that is still worth showing.
   *
   * Once the write lands the stored date and the server's are the same, so the
   * override stops applying on its own — there is nothing to clean up and no
   * second render to schedule, and a bar can never be left sitting on a date
   * the server refused.
   */
  const overrideFor = (row: GanttRow): number | null => {
    if (pendingEnd === null || pendingEnd.key !== row.key) return null;
    return row.end === pendingEnd.end ? null : pendingEnd.end;
  };

  /**
   * Move a line by whole days and write it back. Each press of an arrow key
   * counts from the date already on screen rather than the stored one, so a
   * run of them adds up instead of each one landing on the same day.
   */
  const reschedule = async (row: GanttRow, days: number) => {
    const base = overrideFor(row) ?? dayStart(row.end);
    // a bar can never end before the day the work itself was created
    const end = Math.max(base + days * DAY_MS, dayStart(row.start));
    if (end === base) return;
    setPendingEnd({ key: row.key, end });
    setBusyKey(row.key);
    try {
      if (row.jobId !== undefined) await updateJobM({ id: row.jobId, dueAt: end });
      else if (row.projectId !== undefined)
        await updateProjectM({ id: row.projectId, dueAt: end });
    } catch (error) {
      setPendingEnd(null);
      toast.error(
        error instanceof Error ? error.message : "Couldn't reschedule that line.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  if (rows.length === 0 && unscheduled.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <ChartGantt className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">Nothing to schedule yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === "jobs"
            ? "Flag a job in the Projects page and it lands on this timeline."
            : "Flag work under a project and the project lands on this timeline."}
        </p>
      </div>
    );
  }

  const todayPct = timeline.pct(today);

  return (
    <div>
      {rows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="h-3 w-px bg-primary/60" /> Today
            </span>
            {canEdit && (
              <span className="inline-flex items-center gap-1">
                <MoveHorizontal className="size-3" />
                Drag a bar to change its due date
                <span className="text-muted-foreground/60">
                  · arrow keys move a day
                </span>
              </span>
            )}
            {projectStatuses.map((status, index) => (
              <span key={status} className="inline-flex items-center gap-1">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    statusAccent(index, projectStatuses.length),
                  )}
                />
                {status}
              </span>
            ))}
            <span className="ml-auto tabular-nums">
              {timeline.bands.length} month
              {timeline.bands.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <div
              style={{
                minWidth: timeline.trackWidth + GANTT_LABEL_W + GANTT_DUE_W,
              }}
            >
              {/* month header */}
              <div className="flex h-8 border-b border-border/60 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                <div
                  className="sticky left-0 z-20 flex shrink-0 items-center border-r border-border/60 bg-card px-3"
                  style={{ width: GANTT_LABEL_W }}
                >
                  {mode === "jobs" ? "Job" : "Project"}
                </div>
                <div className="relative flex-1">
                  {timeline.bands.map((band) => (
                    <span
                      key={band.key}
                      className="absolute top-0 flex h-full items-center overflow-hidden border-l border-border/50 px-1.5 whitespace-nowrap"
                      style={{
                        left: `${timeline.pct(band.from)}%`,
                        width: `${timeline.pct(band.to) - timeline.pct(band.from)}%`,
                      }}
                    >
                      {band.label}
                    </span>
                  ))}
                </div>
                <div
                  className="flex shrink-0 items-center justify-end border-l border-border/60 bg-card pr-3"
                  style={{ width: GANTT_DUE_W }}
                >
                  Due
                </div>
              </div>

              <div className="relative">
                {rows.map((row) => {
                  const statusIndex = projectStatuses.indexOf(row.status);
                  const accent = statusAccent(statusIndex, projectStatuses.length);
                  const ink = statusInk(statusIndex, projectStatuses.length);
                  const dragging = drag !== null && drag.key === row.key;
                  const override = overrideFor(row);
                  // the day the bar is currently planned for: the server's, or
                  // the one the reader has just dragged it to
                  const scheduledEnd = override ?? dayStart(row.end);
                  const preview = dragging
                    ? Math.max(
                        scheduledEnd + drag.days * DAY_MS,
                        dayStart(row.start),
                      )
                    : override;
                  const end = preview ?? row.end;
                  const from = timeline.pct(row.start);
                  const to = timeline.pct(end);
                  const overdue = !row.done && end < today;
                  const selected =
                    row.jobId !== undefined
                      ? selection?.kind === "job" && selection.id === row.jobId
                      : selection?.kind === "project" &&
                        selection.id === row.projectId;
                  return (
                    <div
                      key={row.key}
                      className={cn(
                        "flex h-12 border-b border-border/40 transition-colors last:border-b-0 hover:bg-accent/30",
                        row.depth === 1 && "bg-muted/20",
                        selected && "bg-primary/[0.04]",
                      )}
                    >
                      <div
                        className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-border/60 bg-card px-3"
                        style={{ width: GANTT_LABEL_W }}
                      >
                        {row.depth === 0 ? (
                          <Folder
                            className={cn(
                              "size-3.5 shrink-0",
                              row.done ? "text-emerald-500" : "text-sky-500/80",
                            )}
                          />
                        ) : (
                          <Briefcase className="ml-3 size-3 shrink-0 text-sky-500/80" />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={() =>
                              row.jobId !== undefined
                                ? onSelect?.({ kind: "job", id: row.jobId })
                                : row.projectId !== undefined &&
                                  onSelect?.({ kind: "project", id: row.projectId })
                            }
                            title="Open this line's side panel"
                            className={cn(
                              "min-w-0 truncate text-left hover:underline",
                              row.depth === 0
                                ? "text-xs font-medium"
                                : "text-[11px] font-medium",
                              row.done && "text-muted-foreground line-through",
                            )}
                          >
                            {row.name}
                          </button>
                          <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                            {row.code && (
                              <span className="shrink-0 font-mono text-muted-foreground/70">
                                {row.code}
                              </span>
                            )}
                            {row.meta && <span className="truncate">{row.meta}</span>}
                          </span>
                        </span>
                      </div>

                      <div className="relative flex-1">
                        <span
                          role={canEdit ? "button" : undefined}
                          tabIndex={canEdit ? 0 : undefined}
                          aria-label={
                            canEdit
                              ? `${row.name} — ${row.status}, due ${new Date(end).toLocaleDateString()}. Press the left or right arrow key to reschedule it.`
                              : `${row.name} — ${row.status}, due ${new Date(end).toLocaleDateString()}`
                          }
                          onPointerDown={(event) => {
                            if (!canEdit || busyKey !== null) return;
                            const track = event.currentTarget.parentElement;
                            const width = track?.getBoundingClientRect().width ?? 0;
                            if (width <= 0 || timeline.days <= 0) return;
                            // stops the drag from selecting the row's text
                            event.preventDefault();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            setDrag({
                              key: row.key,
                              startX: event.clientX,
                              pxPerDay: width / timeline.days,
                              days: 0,
                            });
                          }}
                          onPointerMove={(event) => {
                            if (drag === null || drag.key !== row.key) return;
                            setDrag({
                              ...drag,
                              days: Math.round(
                                (event.clientX - drag.startX) / drag.pxPerDay,
                              ),
                            });
                          }}
                          onPointerUp={(event) => {
                            if (drag === null || drag.key !== row.key) return;
                            event.currentTarget.releasePointerCapture(event.pointerId);
                            const { days } = drag;
                            setDrag(null);
                            // a click that did not move the bar is left alone
                            if (days !== 0) void reschedule(row, days);
                          }}
                          onPointerCancel={() => setDrag(null)}
                          onKeyDown={(event) => {
                            if (!canEdit) return;
                            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                              return;
                            event.preventDefault();
                            const step = (event.shiftKey ? 7 : 1) * (event.key === "ArrowRight" ? 1 : -1);
                            void reschedule(row, step);
                          }}
                          className={cn(
                            "absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full",
                            accent,
                            row.done && "opacity-40",
                            overdue && "ring-1 ring-destructive/60",
                            canEdit &&
                              "cursor-grab touch-none active:cursor-grabbing",
                            dragging && "ring-2 ring-primary/70",
                            busyKey === row.key && "animate-pulse",
                          )}
                          style={{
                            left: `${from}%`,
                            width: `${Math.max(to - from, 0.6)}%`,
                          }}
                          title={
                            canEdit
                              ? `${row.status} — created ${new Date(row.start).toLocaleDateString()}. Drag to change the due date.`
                              : `${row.status} — created ${new Date(row.start).toLocaleDateString()}${overdue ? ", overdue" : ""}`
                          }
                        />
                        <Diamond
                          className={cn(
                            "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 fill-card",
                            ink,
                            row.inherited && preview === null && "fill-transparent",
                          )}
                          style={{ left: `${to}%` }}
                        />
                        {/* the day being dragged to, following the bar */}
                        {drag !== null && dragging && (
                          <span
                            className={cn(
                              "pointer-events-none absolute -top-1.5 z-20 -translate-x-1/2 rounded-md border bg-popover px-1.5 py-0.5 text-[10px] font-medium tabular-nums shadow-sm",
                              drag.days === 0 && "text-muted-foreground",
                            )}
                            style={{ left: `${to}%` }}
                          >
                            {drag.days === 0
                              ? new Date(end).toLocaleDateString()
                              : `${drag.days > 0 ? "+" : "−"}${Math.abs(drag.days)}d · ${new Date(end).toLocaleDateString()}`}
                          </span>
                        )}
                      </div>

                      <div
                        className="flex shrink-0 flex-wrap items-center justify-end gap-1 border-l border-border/60 bg-card pr-3 pl-2"
                        style={{ width: GANTT_DUE_W }}
                      >
                        <DueChips
                          dueAt={end}
                          inherited={row.inherited && preview === null}
                        />
                      </div>
                    </div>
                  );
                })}

                {/* month rules and the today line, over the bars so the whole
                    thing reads as one chart */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 z-10"
                  style={{ left: GANTT_LABEL_W, right: GANTT_DUE_W }}
                >
                  {timeline.bands.map((band) => (
                    <span
                      key={band.key}
                      className="absolute inset-y-0 w-px bg-border/40"
                      style={{ left: `${timeline.pct(band.from)}%` }}
                    />
                  ))}
                  <span
                    className="absolute inset-y-0 w-px bg-primary/60"
                    style={{ left: `${todayPct}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <p className="flex items-center gap-2 border-b border-border/60 px-3 py-3 text-xs text-muted-foreground">
          <ChartGantt className="size-4 shrink-0 text-muted-foreground/50" />            Nothing here has a due date yet, so there is no bar to draw. Set one and
          it moves onto the timeline.
        </p>
      )}

      {unscheduled.length > 0 && (
        <div className="px-3 py-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <CalendarRange className="size-3.5" />
            No due date
            <span className="font-normal normal-case">({unscheduled.length})</span>
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {unscheduled.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  onClick={() =>
                    row.jobId !== undefined
                      ? onSelect?.({ kind: "job", id: row.jobId })
                      : row.projectId !== undefined &&
                        onSelect?.({ kind: "project", id: row.projectId })
                  }
                  title={`Open “${row.name}” and give it a due date`}
                  className="inline-flex max-w-72 items-center gap-1.5 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] transition-colors hover:border-primary/40 hover:bg-primary/10"
                >
                  <span className="min-w-0 truncate">{row.name}</span>
                  {row.meta && (
                    <span className="shrink-0 text-muted-foreground">{row.meta}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Open one and set a due date from its side panel to plan it on the
            timeline.
          </p>
        </div>
      )}
    </div>
  );
}
