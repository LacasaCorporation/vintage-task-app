import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/checkbox";
import ProductQtyStepper from "@/components/ProductQtyStepper";
import ProductCodeInline from "@/components/ProductCodeInline";
import ProductTagsInline from "@/components/ProductTagsInline";
import PriorityChip from "@/components/PriorityChip";
import StatusSelect from "@/components/StatusSelect";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Briefcase,
  CalendarDays,
  CalendarRange,
  ChartGantt,
  ChevronDown,
  Diamond,
  Eye,
  EyeOff,
  Flag,
  Folder,
  GripVertical,
  MoveHorizontal,
  Package,
  Plus,
  Rows3,
  SquareKanban,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  isStageDone,
  middleProjectStatuses,
  PROJECT_STATUS_FINISH,
  projectStatusDetailsOrDefaults,
  projectStatusesOrDefaults,
  productLockedReason,
  stageStatusColor,
  STAGE_STATUSES,
  statusAssignee,
  statusColor,
  statusCompletion,
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
import { useFgStatusChange } from "@/lib/useFgStatusChange";
import {
  DAY_MS,
  draggedDates,
  limitsFrom,
  shrinkRefusal,
  windowDate,
  withinRefusal,
  type DateLimits,
  type DateWindow,
  type ScheduleGrip,
} from "@/lib/schedule-window";
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
    { view: "gantt", label: "Production timeline", icon: "gantt" },
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
        const projectDone = isStageDone(status);
        const isCollapsed = collapsed.has(project._id);
        // the project's completion, counted from the products under it: how
        // many are finished over how many there are (its jobs when it holds
        // no products at all)
        const allProjectJobs = jobs.filter(
          (job) => job.projectId === project._id,
        );
        const jobsFinished = allProjectJobs.filter((job) =>
          isStageDone(jobProjectStatus(job, projectStatuses)),
        ).length;
        const allJobIds = new Set(allProjectJobs.map((job) => String(job._id)));
        const projectFgs = fgs.filter((fg) =>
          productJobIds(fg).some((jid) => allJobIds.has(String(jid))),
        );
        const productsFinished = projectFgs.filter(
          (fg) => fg.isCompleted === true,
        ).length;
        // exactly how much of the project is done: products finished over
        // the products in the project — each product counting as one — with
        // the same ratio falling back to the jobs when the project holds
        // none. Two of five products made is 40%, three of three jobs done
        // is 100%, etc.
        const percent =
          projectFgs.length > 0
            ? (productsFinished / projectFgs.length) * 100
            : allProjectJobs.length > 0
              ? (jobsFinished / allProjectJobs.length) * 100
              : 0;
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
              {(projectFgs.length > 0 || allProjectJobs.length > 0) && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                    percent >= 100
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                  title={
                    projectFgs.length > 0
                      ? `${productsFinished} of ${projectFgs.length} products finished`
                      : `${jobsFinished} of ${allProjectJobs.length} jobs completed`
                  }
                >
                  {percent}%
                </span>
              )}
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
  const changeFgStatus = useFgStatusChange();
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
  const done = isStageDone(jobProjectStatus(job, projectStatuses));
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
                projectColors
                disabled={fg.productionStartedAt === undefined}
                title={
                  fg.productionStartedAt === undefined
                    ? "Start production to change the status"
                    : "Change the status"
                }
                onChange={(status) => void changeFgStatus(fg, status)}
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
        const done = isStageDone(jobProjectStatus(job, projectStatuses));
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
 * The colour of a status is read in `statusColor`: its own if the workflow's
 * editor gave it one, otherwise its position — the first status and Finish
 * keep the same two colours whatever the reader called them, with the middle
 * of the workflow in violet.
 */

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
  /** completion, 0–100: the ratio of the products that are finished */
  percent?: number;
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
  // the same statuses with the details the editor keeps: which colour each
  // column wears, the completion a product there counts for, who owns the stage
  const statusDetails = projectStatusDetailsOrDefaults(
    useQuery(api.settings.listProjectStatusDetails),
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
        const done = isStageDone(status);
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
            // a job's percentage is the ratio of its products finished
            percent:
              products.length > 0
                ? (products.filter((product) => product.isCompleted).length * 100)
                    / products.length
                : undefined,
          },
        ];
      });
    }

    return projects.flatMap((project) => {
      const status = projectDocStatus(project, projectStatuses);
      const done = isStageDone(status);
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
          // the project's percentage moves with its products too: how many
          // of them are finished, over how many there are — an exact ratio, so a
          // project with 1 of 3 products made reads as 33.3% and the labels that
          // round may show 33% while the exact figure stays held
          progress: undefined,
          percent:
            products.length > 0
              ? (products.filter((product) => product.isCompleted).length * 100)
                  / products.length
              : undefined,
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
        {STAGE_STATUSES.map((status) => {
          const column = cards.filter((card) => card.status === status);
          // a job or project stage wears its own colour; unlike a product's
          // status it carries no percentage of completion — that number is
          // always the roll-up of the work inside the row
          const color = stageStatusColor(status);
          const accent = color.fill;
          const owner = statusAssignee(statusDetails, status);
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
              {/* who the stage belongs to, when somebody was given — the
                  stages carry no percentage of their own */}
              {owner !== null && (
                <div className="flex items-center gap-1.5 px-3 pb-2 text-[10px] text-muted-foreground">
                  <span
                    className="inline-flex min-w-0 items-center gap-1"
                    title={`${status} is owned by ${owner}`}
                  >
                    <UserRound className="size-3 shrink-0" />
                    <span className="truncate">{owner}</span>
                  </span>
                </div>
              )}
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
                            {card.products !== undefined &&
                              (card.progress === undefined ||
                                card.progress.total === 0) && (
                                <span className="shrink-0 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-violet-700 dark:text-violet-400">
                                  {card.products} product{card.products === 1 ? "" : "s"}
                                </span>
                              )}
                            {card.progress !== undefined &&
                              card.progress.total > 0 && (
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                                    card.done
                                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                      : "bg-muted text-muted-foreground",
                                  )}
                                  title="Products finished"
                                >
                                  {card.progress.done}/{card.progress.total} products
                                </span>
                              )}
                            {card.percent !== undefined && (
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                                  card.percent >= 100
                                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                    : "bg-muted text-muted-foreground",
                                )}
                                title="Completion, from the products finished"
                              >
                                {card.percent}%
                              </span>
                            )}
                            <DueChips dueAt={card.dueAt} />
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-border/60 bg-muted/30 px-2 py-1">
                          <StatusSelect
                            value={card.status}
                            statuses={[...STAGE_STATUSES]}
                            projectColors
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

/** Wide enough for a name and its counts; matches the sticky label column. */
const GANTT_LABEL_W = 244;
/**
 * The two editable date columns along the right edge. Narrow enough that the
 * chart still gets most of the width on a laptop, wide enough for a date.
 */
const GANTT_START_W = 112;
const GANTT_END_W = 112;
/** Both date columns together — the chrome the chart itself is not drawn in. */
const GANTT_DATE_W = GANTT_START_W + GANTT_END_W;

/**
 * How tall a row is drawn, in pixels. A timeline is read by comparing many
 * lines at once, so the default squeezes them together — about a third more of
 * the run fits on screen — while comfortable is the roomy row for anyone who
 * wants the names easier to pick out.
 */
const GANTT_ROW_H = { compact: 34, comfy: 48 } as const;

/** Where the row-density choice is remembered between visits. */
const GANTT_DENSITY_KEY = "slate.ganttRows";

/** Midnight of a day, so a bar never drifts across a daylight-saving shift. */
function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * A date input's own `YYYY-MM-DD` value for a timestamp, in the reader's
 * zone — `toISOString` would shift the day across midnight for most of the
 * world, which is exactly the bug a date-only field has to avoid.
 */
function dateInputValue(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A date input's value back as a timestamp at local midnight. A date-only
 * string parses as UTC, so the time is spelled out to keep it on the day it
 * was typed in.
 */
function dateInputTime(value: string): number | null {
  if (value === "") return null;
  const at = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(at) ? null : at;
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

/** The widest the track is ever drawn, so a long span stays a chart, not a wall. */
const GANTT_MAX_TRACK = 5000;
/** Narrower than this a band cannot hold its own label, so the axis coarsens. */
const GANTT_MIN_BAND = 34;

/** The step the axis is built from. */
type BandUnit = "day" | "week" | "month" | "quarter";

/** The axis steps, finest first, with the days each one covers. */
const GANTT_UNITS: readonly { id: BandUnit; days: number }[] = [
  { id: "day", days: 1 },
  { id: "week", days: 7 },
  { id: "month", days: 30.4375 },
  { id: "quarter", days: 91.3125 },
];

/** How finely the axis is drawn — the scale buttons the reader gets. */
type GanttZoom = "day" | "week" | "month" | "quarter";

const GANTT_ZOOMS: readonly {
  id: GanttZoom;
  label: string;
  unit: BandUnit;
  /** How much room one day of the span gets at this scale. */
  pxPerDay: number;
}[] = [
  { id: "day", label: "Days", unit: "day", pxPerDay: 44 },
  { id: "week", label: "Weeks", unit: "week", pxPerDay: 14 },
  { id: "month", label: "Months", unit: "month", pxPerDay: 4 },
  { id: "quarter", label: "Quarters", unit: "quarter", pxPerDay: 1.6 },
];

/**
 * The scale that suits a span, so a month of work opens on day columns and two
 * years of it opens on quarters rather than on an unreadable smear.
 */
function pickZoom(spanDays: number): GanttZoom {
  if (spanDays <= 45) return "day";
  if (spanDays <= 120) return "week";
  if (spanDays <= 420) return "month";
  return "quarter";
}

/** The start of the step a timestamp falls in — the axis is snapped to these. */
function alignToUnit(ms: number, unit: BandUnit): number {
  const date = new Date(ms);
  if (unit === "day") return dayStart(ms);
  if (unit === "week") {
    // weeks run Monday → Sunday, the working week these plans are read in
    const weekday = (date.getDay() + 6) % 7;
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() - weekday,
    ).getTime();
  }
  if (unit === "month") return monthStart(ms);
  return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1).getTime();
}

/**
 * The next boundary along. Built on the calendar rather than by adding 24 hours
 * so a day or a week stays a day or a week across a daylight-saving change.
 */
function addUnit(ms: number, unit: BandUnit): number {
  const date = new Date(ms);
  if (unit === "day")
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  if (unit === "week")
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7).getTime();
  if (unit === "month")
    return new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
  return new Date(date.getFullYear(), date.getMonth() + 3, 1).getTime();
}

/** A band's label, shortened to whatever its own width can hold. */
function bandLabel(ms: number, unit: BandUnit, widthPx: number): string {
  const date = new Date(ms);
  if (unit === "day")
    return widthPx >= 74
      ? date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })
      : String(date.getDate());
  if (unit === "week")
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (unit === "month")
    return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
}

type GanttBand = { key: string; from: number; to: number };

/**
 * The axis columns across a span. The first one starts on a step boundary, not
 * on the span's own edge, which is why the caller measures the chart from
 * `bands[0].from`: a stub half-band at the left edge would carry a label that
 * does not match the days it actually draws.
 */
function ganttBands(start: number, end: number, unit: BandUnit): GanttBand[] {
  const bands: GanttBand[] = [];
  let cursor = alignToUnit(start, unit);
  // the span is bounded by the horizon and every step moves forwards, so this
  // cap only ever stops a runaway, never a real range
  while (cursor < end && bands.length < 400) {
    const to = addUnit(cursor, unit);
    bands.push({ key: `${unit}:${cursor}`, from: cursor, to });
    cursor = to;
  }
  return bands;
}

/**
 * A repeating stripe that shades Saturday and Sunday, phase-aligned to the
 * first day of the range: one background instead of one element per day.
 *
 * A single seven-day period is walked and the runs are always closed on day
 * seven, which is what makes the repeat seamless — the colour at day seven is
 * the colour at day zero by construction.
 */
function weekendShading(fromMs: number, pxPerDay: number): string {
  const startWeekday = new Date(dayStart(fromMs)).getDay();
  const shaded = (offset: number) => {
    const weekday = (startWeekday + offset) % 7;
    return weekday === 0 || weekday === 6;
  };
  const runs: { on: boolean; to: number }[] = [];
  let on = shaded(0);
  for (let day = 1; day <= 7; day += 1) {
    const next = day === 7 ? shaded(0) : shaded(day);
    if (next !== on) {
      runs.push({ on, to: day });
      on = next;
    }
  }
  runs.push({ on, to: 7 });
  let at = 0;
  const stops = runs.map((run) => {
    const stop = `${run.on ? "rgba(120,130,150,0.16)" : "transparent"} ${at * pxPerDay}px ${run.to * pxPerDay}px`;
    at = run.to;
    return stop;
  });
  return `repeating-linear-gradient(to right, ${stops.join(", ")})`;
}

/** The three levels of the plan, deepest last. */
type PlanLevel = "project" | "job" | "product";

/**
 * The fill of a bar, by the level it belongs to.
 *
 * A project, the jobs inside it and the products inside those are three
 * different things sharing one chart, so the colour says which one a bar is
 * before its name is read — and the same colour is used in the legend and on
 * the level's icon, so the chart is readable at a glance. The line's status is
 * still on it: the milestone at its end is inked with the workflow colour and
 * the label column carries its dot.
 */
const LEVEL_FILL: Record<PlanLevel, string> = {
  project: "bg-indigo-500",
  job: "bg-sky-500",
  product: "bg-teal-500",
};

/** The same level colour, as ink for an icon. */
const LEVEL_INK: Record<PlanLevel, string> = {
  project: "text-indigo-500",
  job: "text-sky-500",
  product: "text-teal-500",
};

const LEVEL_LABEL: Record<PlanLevel, string> = {
  project: "Project",
  job: "Job",
  product: "Product",
};

const PLAN_LEVELS: readonly PlanLevel[] = ["project", "job", "product"];

/** How a line is named in a refusal, and what it has to stay inside. */
const PLAN_SUBJECT: Record<PlanLevel, string> = {
  project: "this project",
  job: "this job",
  product: "this product",
};
const PLAN_CONTAINER: Record<PlanLevel, string> = {
  project: "project",
  job: "job",
  product: "job",
};
/** What a line carries, for the refusal when it is pulled in too far. */
const PLAN_CONTENTS: Record<PlanLevel, string> = {
  project: "jobs",
  job: "products",
  product: "products",
};

/**
 * A window, or nothing at all when neither end of it is dated — an undated
 * parent puts no limit on the work inside it.
 */
function windowOf(start?: number, end?: number): DateWindow | undefined {
  return start === undefined && end === undefined
    ? undefined
    : { start, end };
}

/** The own dates of a set of records, as the shrink limits of their parent. */
function ownDates(records: readonly { startAt?: number; dueAt?: number }[]) {
  return records.map((record) => ({
    startAt: record.startAt,
    dueAt: record.dueAt,
  }));
}

/** A line drawn on the timeline. */
type GanttRow = {
  key: string;
  /** Which level it is drawn at — the bar's colour comes from this. */
  level: PlanLevel;
  projectId?: Id<"projects">;
  jobId?: Id<"projectJobs">;
  fgId?: Id<"finishedGoods">;
  name: string;
  code?: string;
  /** 0 for the level the filter is on, 1 for its children, 2 for a product */
  depth: 0 | 1 | 2;
  /**
   * The key of the group this line sits inside — the project a job belongs
   * to, the job a product belongs to. Undefined for a line that heads its own
   * group, or one drawn flat (the Products filter), so hiding a group always
   * puts away exactly the lines underneath it.
   */
  parentKey?: string;
  /** The day the bar starts: the planned start, or the day it was created. */
  start: number;
  /** The day the bar ends — the start again when nothing dates the line. */
  end: number;
  /** False when neither the line nor its parents carry an end date. */
  endKnown: boolean;
  /** The day the line was created; where a cleared start falls back to. */
  fallbackStart: number;
  /** The line's own stored dates — undefined means it is inheriting one. */
  ownStart?: number;
  ownEnd?: number;
  status: string;
  done: boolean;
  meta?: string;
  /** Products finished out of the products this line carries. */
  progress?: { done: number; total: number };
  /**
   * How complete this line reads, 0–100: a product from the status it sits
   * in, a job or a project from the ratio of the products under them that are
   * finished. It is what the inlay on the bar fills to and the number the bar
   * carries — never the stage's own percentage, which a job or project does
   * not have.
   */
  percent?: number;
  /** The window the line has to stay inside: its parent's planned dates. */
  bounds?: DateWindow;
  /** What the line's own children stop it being shrunk past. */
  limits?: DateLimits;
};

/** Which part of a bar a drag has hold of. */
type GanttGrip = ScheduleGrip;

/** A bar being dragged along the timeline. */
type GanttDrag = {
  key: string;
  grip: GanttGrip;
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

/**
 * A write in flight: the dates it sets (null = unset that date) and the dates
 * to keep drawing until the stored row agrees with them.
 */
type GanttPending = {
  key: string;
  startAt: number | null;
  dueAt: number | null;
  shown: { start: number; end: number };
};

/**
 * Projects, Jobs or Products filter — Gantt view: one bar per line of the
 * project → job → product hierarchy, drawn from the day it is planned to
 * start to the day it is due, with a milestone at the end.
 *
 * Either date is the line's own when it has one and otherwise inherited the
 * way its due chips already are — a job with no dates of its own is planned
 * against its project, a product against its job — and a line with no start of
 * its own is drawn from the day it was created. A line nothing dates at all is
 * still listed, with an empty End column, rather than left off the chart.
 *
 * Rescheduling is a drag: the body of a bar moves the whole line, an edge
 * moves just that date, and both write `startAt` / `dueAt` through
 * `updateProject` / `updateJob` / `updateFinishedGood`. The arrow keys do the
 * same a day at a time, and the two columns at the right set either date
 * exactly.
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
  onNewProject,
  onNewJob,
}: {
  mode: "projects" | "jobs" | "products";
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
  /** Opens the page's own new-project dialog, when creating is allowed. */
  onNewProject?: () => void;
  /** Opens the page's own new-job dialog under the chosen project. */
  onNewJob?: (projectId: Id<"projects">, projectLabel: string) => void;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );
  // the statuses with the details the editor keeps, so the legend, the bars'
  // ink and a resting pointer's card all wear the colour the board wears
  const statusDetails = projectStatusDetailsOrDefaults(
    useQuery(api.settings.listProjectStatusDetails),
  );
  const updateProjectM = useMutation(api.costing.updateProject);
  const updateJobM = useMutation(api.jobs.updateJob);
  const updateFgM = useMutation(api.costing.updateFinishedGood);
  const moveProjectM = useMutation(api.costing.moveProjectTimeline);
  const moveJobM = useMutation(api.jobs.moveJobTimeline);
  // the create menu nests a job under a project, so it offers every project
  // rather than only the ones this board happens to be showing
  const allProjectsQuery = useQuery(api.costing.listProjects);
  const [drag, setDrag] = useState<GanttDrag | null>(null);
  // compact by default: the chart is about seeing the whole run at once
  const [dense, setDense] = useState(() => {
    try {
      return window.localStorage.getItem(GANTT_DENSITY_KEY) !== "comfy";
    } catch {
      // storage can be unavailable — the chart still starts compact
      return true;
    }
  });
  const toggleDensity = () =>
    setDense((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(GANTT_DENSITY_KEY, next ? "compact" : "comfy");
      } catch {
        // remembered for this session only — the toggle still works
      }
      return next;
    });
  const rowH = dense ? GANTT_ROW_H.compact : GANTT_ROW_H.comfy;
  // the groups whose lines are put away, by row key — the label column's own
  // hide control, so a long plan can be read one level at a time
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  // the line whose bar the pointer is over — what the hover card is showing
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // the dates a row is being written to, held until the stored row agrees —
  // so a dragged bar never snaps back mid-round-trip
  const [pending, setPending] = useState<GanttPending | null>(null);
  // null until the reader picks a scale, so the chart can open on the one that
  // suits the work it is actually showing
  const [zoom, setZoom] = useState<GanttZoom | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // read once per mount rather than on every render, so the today line and the
  // overdue rings stay put while the page is open
  const [today] = useState(() => dayStart(Date.now()));

  const { rows, undated } = useMemo(() => {
    const charted: GanttRow[] = [];
    let missing = 0;
    const keep = (status: string, done: boolean) =>
      matchesStatusFilter(statusFilter ?? "all", status, done);
    const plural = (count: number, noun: string) =>
      `${count} ${noun}${count === 1 ? "" : "s"}`;
    const jobOf = (fg: FgDoc) =>
      jobs.find((job) => job._id === fg.jobId) ??
      jobs.find((job) => (fg.jobIds ?? []).includes(job._id));
    const projectOf = (job: JobDoc | undefined, fg?: FgDoc) =>
      job !== undefined
        ? projects.find((project) => project._id === job.projectId)
        : projects.find((project) => project.name === fg?.projectName);

    /**
     * A product line. Its dates are its own, else its job's, else its project's
     * — the same order its due chips already resolve them in.
     */
    const productRow = (
      fg: FgDoc,
      depth: 0 | 1 | 2,
      job: JobDoc | undefined,
      project: Doc<"projects"> | undefined,
      opts?: { context?: string; parentKey?: string },
    ): GanttRow => {
      const { context, parentKey } = opts ?? {};
      const status = fgProjectStatus(fg, projectStatuses);
      const done = status === PROJECT_STATUS_FINISH;
      // how far along the product reads: the completion the status it sits in
      // counts, which is the number that moves as the product moves up the
      // workflow — and 100 the moment it is finished
      const statusIndex = projectStatuses.indexOf(status);
      const percent = done
        ? 100
        : statusIndex >= 0
          ? statusCompletion(
              statusDetails,
              status,
              statusIndex,
              projectStatuses.length,
            )
          : 0;
      const fallbackStart = fg._creationTime;
      const start =
        fg.startAt ?? job?.startAt ?? job?._creationTime ?? fallbackStart;
      const end = fg.dueAt ?? job?.dueAt ?? project?.dueAt;
      const batch =
        fg.qty !== undefined
          ? `${fg.qty}${fg.unit !== undefined ? ` ${fg.unit}` : ""}`
          : undefined;
      const meta = [context, batch]
        .filter((part) => part !== undefined)
        .join(" · ");
      return {
        key: `f:${fg._id}`,
        level: "product",
        fgId: fg._id,
        name: fg.name,
        code: fg.code,
        depth,
        parentKey,
        start,
        end: end ?? start,
        endKnown: end !== undefined,
        fallbackStart,
        ownStart: fg.startAt,
        ownEnd: fg.dueAt,
        status,
        done,
        meta: meta.length > 0 ? meta : undefined,
        percent,
        // a product is planned between its job's dates — the job's own, or the
        // project's where the job has none of its own
        bounds: windowOf(
          job?.startAt ?? project?.startAt,
          job?.dueAt ?? project?.dueAt,
        ),
      };
    };

    if (mode === "products") {
      for (const fg of sortFgs(fgs, sortMode)) {
        const job = jobOf(fg);
        const project = projectOf(job, fg);
        const row = productRow(fg, 0, job, project, {
          context: job?.name ?? project?.name,
        });
        if (!keep(row.status, row.done)) continue;
        if (!row.endKnown) missing += 1;
        charted.push(row);
      }
      return { rows: charted, undated: missing };
    }

    if (mode === "jobs") {
      for (const job of sortJobs(jobs, sortMode)) {
        const status = jobProjectStatus(job, projectStatuses);
        const done = isStageDone(status);
        if (!keep(status, done)) continue;
        const project = projectOf(job);
        const products = productsOfJob(fgs, job._id);
        const finished = products.filter((product) => product.isCompleted).length;
        const meta = [
          project?.name ?? "Project",
          products.length > 0 ? `${finished}/${products.length} products` : undefined,
        ]
          .filter((part) => part !== undefined)
          .join(" · ");
        const fallbackStart = job._creationTime;
        const end = job.dueAt ?? project?.dueAt;
        if (end === undefined) missing += 1;
        charted.push({
          key: `j:${job._id}`,
          level: "job",
          jobId: job._id,
          name: job.name,
          code: job.code,
          depth: 0,
          start: job.startAt ?? fallbackStart,
          end: end ?? job.startAt ?? fallbackStart,
          endKnown: end !== undefined,
          fallbackStart,
          ownStart: job.startAt,
          ownEnd: job.dueAt,
          status,
          done,
          meta,
          // exactly how much of the job is done: how many of its products
          // are finished, over how many there are — a number, not a stage.
          // displayed rounded only on the arrow badge; everywhere else a job
          // may render the true value (e.g. 1 of 3 = 33.333...%)
          percent:
            products.length > 0
              ? (finished * 100) / products.length
              : done
                ? 100
                : 0,
          // the progress ring is only how the job is styled while it is
          // still open — it is not the completion percentage, so it may be
          // empty even when the job already reads as partly done
          progress: undefined,
          bounds: windowOf(project?.startAt, project?.dueAt),
          limits: limitsFrom(ownDates(products)),
        });
        for (const product of sortFgs(products, sortMode)) {
          const row = productRow(product, 1, job, project, {
            parentKey: `j:${job._id}`,
          });
          if (!keep(row.status, row.done)) continue;
          if (!row.endKnown) missing += 1;
          charted.push(row);
        }
      }
      return { rows: charted, undated: missing };
    }

    for (const project of projects) {
      const status = projectDocStatus(project, projectStatuses);
      const done = isStageDone(status);
      if (!keep(status, done)) continue;
      const projectJobs = sortJobs(
        jobs.filter((job) => job.projectId === project._id),
        sortMode,
      );
      const jobIds = new Set(projectJobs.map((job) => String(job._id)));
      const products = fgs.filter((fg) =>
        productJobIds(fg).some((jobId) => jobIds.has(String(jobId))),
      );
      // exactly how much of the project is done: how many of its products
      // are finished, over how many it has — counting the product count in
      // the project, one by one, like a workshop reading how many are made.
      // If a project has no products yet, it is read through its jobs
      // the same way: how many jobs are finished, over how many there are.
      const jobsFinished = projectJobs.filter((job) =>
        isStageDone(jobProjectStatus(job, projectStatuses)),
      ).length;
      const finished = products.filter((product) => product.isCompleted).length;
      const percent =
        products.length > 0
          ? (finished * 100) / products.length
          : projectJobs.length > 0
            ? (jobsFinished * 100) / projectJobs.length
            : 0;
      const meta = `${plural(projectJobs.length, "job")} · ${plural(products.length, "product")}`;
      const fallbackStart = project._creationTime;
      if (project.dueAt === undefined) missing += 1;
      charted.push({
        key: `p:${project._id}`,
        level: "project",
        projectId: project._id,
        name: project.name,
        code: project.code,
        depth: 0,
        start: project.startAt ?? fallbackStart,
        end: project.dueAt ?? project.startAt ?? fallbackStart,
        endKnown: project.dueAt !== undefined,
        fallbackStart,
        ownStart: project.startAt,
        ownEnd: project.dueAt,
        status,
        done,
        meta,
        percent,
        progress: { done: finished, total: products.length },
        // the project cannot be pulled in past the jobs it carries
        limits: limitsFrom(ownDates(projectJobs)),
      });
      for (const job of projectJobs) {
        const jobStatus = jobProjectStatus(job, projectStatuses);
        const jobDone = isStageDone(jobStatus);
        if (!keep(jobStatus, jobDone)) continue;
        // a job with no dates of its own is planned against its project
        const jobFallback = job._creationTime;
        const jobEnd = job.dueAt ?? project.dueAt;
        const jobProducts = productsOfJob(fgs, job._id);
        const jobFinished = jobProducts.filter(
          (product) => product.isCompleted,
        ).length;
        if (jobEnd === undefined) missing += 1;
        charted.push({
          key: `j:${job._id}`,
          level: "job",
          jobId: job._id,
          name: job.name,
          code: job.code,
          depth: 1,
          parentKey: `p:${project._id}`,
          start: job.startAt ?? jobFallback,
          end: jobEnd ?? job.startAt ?? jobFallback,
          endKnown: jobEnd !== undefined,
          fallbackStart: jobFallback,
          ownStart: job.startAt,
          ownEnd: job.dueAt,
          status: jobStatus,
          done: jobDone,
          meta:
            jobProducts.length > 0
              ? `${jobFinished}/${jobProducts.length} products`
              : undefined,
          progress: { done: jobFinished, total: jobProducts.length },
          bounds: windowOf(project.startAt, project.dueAt),
          limits: limitsFrom(ownDates(jobProducts)),
        });
        for (const product of sortFgs(jobProducts, sortMode)) {
          const row = productRow(product, 2, job, project, {
            parentKey: `j:${job._id}`,
          });
          if (!keep(row.status, row.done)) continue;
          if (!row.endKnown) missing += 1;
          charted.push(row);
        }
      }
    }
    return { rows: charted, undated: missing };
  }, [
    mode,
    projects,
    jobs,
    fgs,
    projectStatuses,
    // a product's percentage is read off the status details it is built with
    statusDetails,
    statusFilter,
    sortMode,
  ]);

  /**
   * The tree the flat rows were drawn from: which group each line sits inside,
   * and how many lines each group holds. The hide control needs both — a click
   * puts away everything under a group, however deep it is nested.
   */
  const tree = useMemo(() => {
    const parentOf = new Map<string, string>();
    for (const row of rows) {
      if (row.parentKey !== undefined) parentOf.set(row.key, row.parentKey);
    }
    const held = new Map<string, number>();
    for (const row of rows) {
      let parent = row.parentKey;
      while (parent !== undefined) {
        held.set(parent, (held.get(parent) ?? 0) + 1);
        parent = parentOf.get(parent);
      }
    }
    return { parentOf, held };
  }, [rows]);

  /** The lines left on the chart: a hidden group takes its subtree with it. */
  const visibleRows = useMemo(() => {
    if (collapsed.size === 0) return rows;
    const insideHidden = (row: GanttRow) => {
      let parent = row.parentKey;
      while (parent !== undefined) {
        if (collapsed.has(parent)) return true;
        parent = tree.parentOf.get(parent);
      }
      return false;
    };
    return rows.filter((row) => !insideHidden(row));
  }, [rows, collapsed, tree]);
  const hiddenCount = rows.length - visibleRows.length;

  /** Put one group's lines away, or bring them back. */
  const toggleGroup = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Put away every group's lines at once, so only the top level is left. */
  const collapseAll = () => setCollapsed(new Set(tree.held.keys()));

  // the days the chart has to cover, before any scale is chosen: everything on
  // it, plus today so the reader always has a "now" to measure against
  const range = useMemo(() => {
    const stamps = rows.flatMap((row) => [row.start, row.end]);
    stamps.push(today);
    // a two-year horizon either side of today keeps a stray date in 2099 from
    // stretching the chart into thousands of unreadable columns
    const horizon = 400 * DAY_MS;
    const min = monthStart(Math.max(Math.min(...stamps), today - horizon));
    const max = monthEnd(Math.min(Math.max(...stamps), today + horizon));
    return { min, max, spanDays: (max - min) / DAY_MS };
  }, [rows, today]);

  const activeZoom = zoom ?? pickZoom(range.spanDays);

  const timeline = useMemo(() => {
    const { min, max } = range;
    const preset =
      GANTT_ZOOMS.find((entry) => entry.id === activeZoom) ?? GANTT_ZOOMS[2];
    // The chart is measured from the axis's own first boundary, so a week column
    // is a whole week rather than a stub at the left edge. A long span is capped
    // rather than drawn to its natural width, and the step is then coarsened
    // until its bands can hold a label — never made finer than the reader asked
    // for. Two passes are enough: coarsening only ever widens a band.
    let unitIndex = GANTT_UNITS.findIndex((entry) => entry.id === preset.unit);
    let bands: GanttBand[] = [];
    let from = min;
    let trackWidth = 0;
    let pxPerDay = 0;
    for (let pass = 0; pass < 2; pass += 1) {
      const step = GANTT_UNITS[unitIndex];
      bands = ganttBands(min, max, step.id);
      from = bands[0]?.from ?? min;
      const drawnDays = Math.max((max - from) / DAY_MS, 1);
      trackWidth = Math.min(
        Math.max(drawnDays * preset.pxPerDay, 420),
        GANTT_MAX_TRACK,
      );
      pxPerDay = trackWidth / drawnDays;
      if (
        step.days * pxPerDay >= GANTT_MIN_BAND ||
        unitIndex === GANTT_UNITS.length - 1
      )
        break;
      unitIndex += 1;
    }
    const step = GANTT_UNITS[unitIndex];
    const span = Math.max(max - from, DAY_MS);
    return {
      min: from,
      max,
      /** Where a timestamp sits across the track, as a percentage. */
      pct: (at: number) =>
        ((Math.min(Math.max(at, from), max) - from) / span) * 100,
      trackWidth,
      pxPerDay,
      unit: step.id,
      bands: bands.map((band) => ({
        ...band,
        label: bandLabel(band.from, step.id, step.days * pxPerDay),
      })),
      /** How many days the track spans, for turning a drag into whole days. */
      days: span / DAY_MS,
    };
  }, [range, activeZoom]);

  /**
   * Put today in the middle of the viewport, whatever the scale. The track is
   * everything between the frozen name column and the date columns.
   */
  const scrollToToday = () => {
    const el = scrollerRef.current;
    if (el === null) return;
    const track = el.scrollWidth - GANTT_LABEL_W - GANTT_DATE_W;
    const at = (timeline.pct(today) / 100) * track;
    // the browser clamps the far end for us
    el.scrollLeft = Math.max(at + GANTT_LABEL_W - el.clientWidth / 2, 0);
  };

  const late = rows.filter(
    (row) => !row.done && row.endKnown && row.end < today,
  ).length;
  // below ~2px a day a stripe is noise, so the shading is left off
  const weekend =
    timeline.pxPerDay >= 2
      ? weekendShading(timeline.min, timeline.pxPerDay)
      : null;

  /**
   * The dates a row is drawn with while a write is in flight.
   *
   * The override expires on its own: as soon as the stored row carries exactly
   * what was written it stops applying, so there is nothing to clean up and no
   * second render to schedule — and a bar can never be left sitting on dates
   * the server refused.
   */
  const overrideFor = (row: GanttRow): { start: number; end: number } | null => {
    if (pending === null || pending.key !== row.key) return null;
    const stored =
      (row.ownStart ?? null) === pending.startAt &&
      (row.ownEnd ?? null) === pending.dueAt;
    return stored ? null : pending.shown;
  };

  /** The dates a line is drawn with right now, whatever is in flight. */
  const datesOf = (row: GanttRow) =>
    overrideFor(row) ?? { start: dayStart(row.start), end: dayStart(row.end) };

  /**
   * Why a typed date cannot be taken, or null when the plan still nests.
   *
   * A drag is clamped rather than refused — the bar stops where the plan stops
   * and the reader sees it stop — but a date typed into a column is an exact
   * ask, so it is answered exactly, in the words the server would refuse it
   * with. Both come from the same rules module, so the two never disagree.
   */
  const dateRefusal = (row: GanttRow, next: DateWindow): string | null => {
    return (
      withinRefusal(
        next,
        row.bounds ?? {},
        PLAN_SUBJECT[row.level],
        PLAN_CONTAINER[row.level],
      ) ??
      shrinkRefusal(
        next,
        row.limits,
        PLAN_CONTAINER[row.level],
        PLAN_CONTENTS[row.level],
      )
    );
  };

  /**
   * Write a line's dates to whichever record owns them, holding the written
   * dates on screen until the stored row agrees. A date that is not named is
   * left alone; naming it as a clear removes it.
   */
  const apply = async (
    row: GanttRow,
    next: {
      startAt?: number;
      dueAt?: number;
      clearStart?: boolean;
      clearDue?: boolean;
    },
  ) => {
    const current = datesOf(row);
    setPending({
      key: row.key,
      startAt:
        next.clearStart === true ? null : (next.startAt ?? row.ownStart ?? null),
      dueAt: next.clearDue === true ? null : (next.dueAt ?? row.ownEnd ?? null),
      shown: {
        start:
          next.clearStart === true
            ? dayStart(row.fallbackStart)
            : dayStart(next.startAt ?? current.start),
        end:
          next.clearDue === true
            ? current.end
            : dayStart(next.dueAt ?? current.end),
      },
    });
    setBusyKey(row.key);
    try {
      if (row.fgId !== undefined) await updateFgM({ id: row.fgId, ...next });
      else if (row.jobId !== undefined)
        await updateJobM({ id: row.jobId, ...next });
      else if (row.projectId !== undefined)
        await updateProjectM({ id: row.projectId, ...next });
    } catch (error) {
      setPending(null);
      toast.error(
        error instanceof Error ? error.message : "Couldn't reschedule that line.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * Move a whole line as one bundle.
   *
   * What a project or a job is dragged by is handed to the server, which moves
   * the work underneath it along by the same whole days: only the two dates
   * change, nothing is resized, so every duration inside the bundle is kept and
   * the plan stays nested by construction. The products of a job never leave it,
   * and the job never leaves its project, however far the bundle is taken.
   */
  const moveBundle = async (
    row: GanttRow,
    start: number,
    end: number,
    days: number,
  ) => {
    setPending({ key: row.key, startAt: start, dueAt: end, shown: { start, end } });
    setBusyKey(row.key);
    try {
      if (row.jobId !== undefined)
        await moveJobM({ id: row.jobId, startAt: start, dueAt: end, days });
      else if (row.projectId !== undefined)
        await moveProjectM({ id: row.projectId, startAt: start, dueAt: end, days });
    } catch (error) {
      setPending(null);
      toast.error(
        error instanceof Error ? error.message : "Couldn't move that line.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * Move a line, or one end of it, by whole days. Each press of an arrow key
   * counts from the date already on screen rather than the stored one, so a
   * run of them adds up instead of each one landing on the same day.
   *
   * The pull is clamped to what the plan allows before anything is written, so
   * a bar dragged against the edge of its project stops there rather than being
   * refused on release.
   */
  const reschedule = async (row: GanttRow, days: number, grip: GanttGrip) => {
    const base = datesOf(row);
    const next = draggedDates(base, grip, days, row.bounds, row.limits);
    if (next.start === base.start && next.end === base.end) return;
    // a project or a job carries the work inside it; a product carries nothing
    if (grip === "move" && row.level !== "product") {
      await moveBundle(
        row,
        next.start,
        next.end,
        Math.round((next.start - base.start) / DAY_MS),
      );
      return;
    }
    await apply(row, { startAt: next.start, dueAt: next.end });
  };

  /**
   * Set one date exactly, from the columns on the right. Emptying an input
   * removes that date, so the line goes back to the one it inherited.
   */
  const setDate = async (
    row: GanttRow,
    which: "start" | "end",
    value: string,
  ) => {
    const at = dateInputTime(value);
    const { start, end } = datesOf(row);
    if (which === "start") {
      if (at === null) {
        // nothing of its own to remove — it already runs off its creation day
        if (row.ownStart === undefined) return;
        await apply(row, { clearStart: true });
        return;
      }
      // a start after the end pulls the end out with it, so what is checked is
      // the window the line would be left with
      const next = at > end ? { start: at, end: at } : { start: at, end };
      const refusal = dateRefusal(row, next);
      if (refusal !== null) {
        toast.error(refusal);
        return;
      }
      await apply(row, at > end ? { startAt: at, dueAt: at } : { startAt: at });
      return;
    }
    if (at === null) {
      if (row.ownEnd === undefined) return;
      await apply(row, { clearDue: true });
      return;
    }
    const next = at < start ? { start: at, end: at } : { start, end: at };
    const refusal = dateRefusal(row, next);
    if (refusal !== null) {
      toast.error(refusal);
      return;
    }
    await apply(row, at < start ? { startAt: at, dueAt: at } : { dueAt: at });
  };

  if (rows.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <ChartGantt className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">Nothing to schedule yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {mode === "products"
            ? "Add a product and it lands on this timeline."
            : mode === "jobs"
              ? "Flag a job in the Projects page and it lands on this timeline."
              : "Flag work under a project and the project lands on this timeline."}
        </p>
      </div>
    );
  }

  const todayPct = timeline.pct(today);

  return (
    <div>
      <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            {canEdit && (onNewProject !== undefined || onNewJob !== undefined) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Create a project or a job without leaving the timeline"
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-primary/40 px-2 py-0.5 font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    <Plus className="size-3" /> New
                    <ChevronDown className="size-3 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  <DropdownMenuLabel className="text-[11px] tracking-wide uppercase">
                    Add to the plan
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {onNewProject !== undefined && (
                    <DropdownMenuItem
                      onSelect={() => onNewProject()}
                      className="gap-2 text-sm"
                    >
                      <Folder className="size-3.5 shrink-0 text-sky-500/80" />
                      <span className="min-w-0 flex-1">New project…</span>
                    </DropdownMenuItem>
                  )}
                  {onNewJob !== undefined && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2 text-sm">
                        <Briefcase className="size-3.5 shrink-0 text-amber-500/80" />
                        <span className="min-w-0 flex-1">New job…</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="max-h-72 w-64 overflow-y-auto">
                        {(allProjectsQuery ?? projects).length === 0 ? (
                          <DropdownMenuItem
                            disabled
                            className="text-xs text-muted-foreground"
                          >
                            Create a project first, then jobs go under it.
                          </DropdownMenuItem>
                        ) : (
                          [...(allProjectsQuery ?? projects)]
                            .sort((a, b) => a.name.localeCompare(b.name))
                            .map((project) => (
                              <DropdownMenuItem
                                key={project._id}
                                onSelect={() => onNewJob(project._id, project.name)}
                                className="gap-2 text-sm"
                              >
                                <Folder className="size-3.5 shrink-0 text-sky-500/80" />
                                <span className="min-w-0 flex-1 truncate">
                                  {project.name}
                                </span>
                                {project.code && (
                                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                                    {project.code}
                                  </span>
                                )}
                              </DropdownMenuItem>
                            ))
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
              {GANTT_ZOOMS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-pressed={activeZoom === entry.id}
                  onClick={() => setZoom(entry.id)}
                  title={
                    zoom === entry.id
                      ? `${entry.label} — chosen by hand`
                      : `Show the timeline in ${entry.label.toLowerCase()}`
                  }
                  className={cn(
                    "rounded-md px-2 py-0.5 transition-colors",
                    activeZoom === entry.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "hover:bg-accent hover:text-foreground",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </span>
            <span className="inline-flex items-center gap-1.5 font-medium">
              <span className="h-3 w-px bg-primary/60" />
              {new Date(timeline.min).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
              })}
              {" – "}
              {new Date(timeline.max).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            {late > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">
                <TriangleAlert className="size-3" />
                {late} late
              </span>
            )}
            <span className="tabular-nums">
              {visibleRows.length} line{visibleRows.length === 1 ? "" : "s"}
              {hiddenCount > 0 && (
                <span className="text-muted-foreground/70">
                  {" "}· {hiddenCount} hidden
                </span>
              )}
            </span>
            <span className="ml-auto inline-flex items-center gap-2">
              <span className="tabular-nums">
                {timeline.bands.length} {timeline.unit}
                {timeline.bands.length === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={scrollToToday}
                title="Scroll the chart to today"
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-0.5 font-medium transition-colors hover:bg-accent hover:text-foreground"
              >
                <CalendarDays className="size-3" /> Today
              </button>
              <button
                type="button"
                onClick={hiddenCount > 0 ? () => setCollapsed(new Set()) : collapseAll}
                disabled={hiddenCount === 0 && tree.held.size === 0}
                title={
                  hiddenCount > 0
                    ? `Bring the ${hiddenCount} hidden line${hiddenCount === 1 ? "" : "s"} back`
                    : "Hide the lines under every project and job"
                }
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-0.5 font-medium transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
              >
                {hiddenCount > 0 ? (
                  <Eye className="size-3" />
                ) : (
                  <EyeOff className="size-3" />
                )}
                {hiddenCount > 0 ? "Show all" : "Hide all"}
              </button>
              <button
                type="button"
                onClick={toggleDensity}
                aria-pressed={dense}
                title={
                  dense
                    ? `Rows are squeezed to fit more lines — switch to ${GANTT_ROW_H.comfy}px rows`
                    : `Rows are ${GANTT_ROW_H.comfy}px — squeeze them to fit more lines`
                }
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-0.5 font-medium transition-colors hover:bg-accent hover:text-foreground"
              >
                <Rows3 className="size-3" />
                {dense ? "Compact" : "Comfortable"}
              </button>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
            {PLAN_LEVELS.map((level) => (
              <span key={level} className="inline-flex items-center gap-1">
                <span className={cn("h-2 w-4 rounded-full", LEVEL_FILL[level])} />
                {LEVEL_LABEL[level]}
              </span>
            ))}
            <span className="h-3 w-px bg-border" />
            <span className="font-medium">Status</span>
            {projectStatuses.map((status, index) => (
              <span key={status} className="inline-flex items-center gap-1">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    statusColor(
                      statusDetails,
                      status,
                      index,
                      projectStatuses.length,
                    ).fill,
                  )}
                />
                {status}
              </span>
            ))}
            {canEdit && (
              <span className="ml-auto inline-flex items-center gap-1">
                <MoveHorizontal className="size-3" />
                Hover a bar for the line behind it; drag it to move the whole bundle,
                or an edge to change one date
                <span className="text-muted-foreground/60">
                  · ← → move a day, ↑ ↓ resize, ⌥ for the start
                </span>
              </span>
            )}
          </div>

          <div className="overflow-x-auto" ref={scrollerRef}>
            <div
              style={{
                minWidth: timeline.trackWidth + GANTT_LABEL_W + GANTT_DATE_W,
              }}
            >
              {/* month header */}
              <div className="flex h-8 border-b border-border/60 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                <div
                  className="sticky left-0 z-20 flex shrink-0 items-center border-r border-border/60 bg-card px-3"
                  style={{ width: GANTT_LABEL_W }}
                >
                  {mode === "jobs" ? "Job" : mode === "products" ? "Product" : "Project"}
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
                  className="flex shrink-0 items-center border-l border-border/60 bg-card px-2"
                  style={{ width: GANTT_START_W }}
                >
                  Start
                </div>
                <div
                  className="flex shrink-0 items-center border-l border-border/60 bg-card px-2"
                  style={{ width: GANTT_END_W }}
                >
                  End
                </div>
              </div>

              <div className="relative">
                {/* weekends, as one repeating stripe behind the bars rather
                    than one element per day */}
                {weekend !== null && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0"
                    style={{
                      left: GANTT_LABEL_W,
                      right: GANTT_DATE_W,
                      backgroundImage: weekend,
                    }}
                  />
                )}
                {visibleRows.map((row) => {
                  const statusIndex = projectStatuses.indexOf(row.status);
                  // the lines this row hides, and whether it is hiding them
                  const held = tree.held.get(row.key) ?? 0;
                  const isCollapsed = collapsed.has(row.key);
                  // the bar wears the colour of its level; the milestone keeps
                  // the workflow ink, so status still reads off the chart. A
                  // stage the product workflow does not carry takes its own
                  // colour instead of falling back to the first one
                  const rowColor =
                    statusIndex >= 0
                      ? statusColor(
                          statusDetails,
                          row.status,
                          statusIndex,
                          projectStatuses.length,
                        )
                      : stageStatusColor(row.status);
                  const ink = rowColor.ink;
                  // how far along this line is, for the card below: worked
                  // out where the rows are built — a product from its status,
                  // a job and a project from the ratio of their products
                  const rowCompletion = row.percent ?? null;
                  const rowOwner = statusAssignee(statusDetails, row.status);
                  const dragging = drag !== null && drag.key === row.key;
                  const hovering = hoverKey === row.key && !dragging;
                  const planned = overrideFor(row);
                  // the dates the line is drawn with: the stored ones, or the
                  // ones being dragged or just written
                  const base = planned ?? {
                    start: dayStart(row.start),
                    end: dayStart(row.end),
                  };
                  // clamped through the very same rule the write obeys, so the
                  // preview cannot show a date the server would refuse
                  const dragged = dragging
                    ? draggedDates(
                        base,
                        drag.grip,
                        drag.days,
                        row.bounds,
                        row.limits,
                      )
                    : base;
                  const start = dragged.start;
                  const end = dragged.end;
                  /** False only while nothing at all dates this line. */
                  const hasEnd = row.endKnown || planned !== null;
                  const from = timeline.pct(start);
                  const to = timeline.pct(end);
                  const overdue = hasEnd && !row.done && end < today;
                  // how long the line has been given: its start to its end
                  const durationDays = Math.max(1, Math.round((end - start) / DAY_MS));
                  const startPlanned = row.ownStart !== undefined;
                  const endPlanned = row.ownEnd !== undefined;
                  // the exact completion behind any rounded label: for a job or
                  // a project it is the ratio of the things that are finished over
                  // the things there are, counted by the things that move them
                  const percentLabel =
                    row.percent !== undefined ? Math.round(row.percent) : undefined;
                  const doneLabel =
                    (row.progress !== undefined && row.progress.total > 0
                      ? `, ${row.progress.done}/${row.progress.total} products done`
                      : "") +
                    (percentLabel !== undefined
                      ? `, ${percentLabel}% complete — products finished over total`
                      : "");
                  const datesLabel = hasEnd
                    ? `${new Date(start).toLocaleDateString()} to ${new Date(end).toLocaleDateString()}`
                    : "no end date yet";
                  const selected =
                    row.fgId !== undefined
                      ? selection?.kind === "fg" && selection.id === row.fgId
                      : row.jobId !== undefined
                        ? selection?.kind === "job" && selection.id === row.jobId
                        : selection?.kind === "project" &&
                          selection.id === row.projectId;
                  const openPanel = () => {
                    if (row.fgId !== undefined)
                      onSelect?.({ kind: "fg", id: row.fgId });
                    else if (row.jobId !== undefined)
                      onSelect?.({ kind: "job", id: row.jobId });
                    else if (row.projectId !== undefined)
                      onSelect?.({ kind: "project", id: row.projectId });
                  };
                  return (
                    <div
                      key={row.key}
                      className={cn(
                        "flex border-b border-border/40 transition-colors last:border-b-0 hover:bg-accent/30",
                        row.depth === 1 && "bg-muted/20",
                        selected && "bg-primary/[0.04]",
                      )}
                      style={{ height: rowH }}
                    >
                      <div
                        className="sticky left-0 z-20 flex shrink-0 items-center gap-2 border-r border-border/60 bg-card px-3"
                        style={{ width: GANTT_LABEL_W }}
                      >
                        {/* the hide control: a group puts away everything under
                            it, a leaf line keeps the slot empty so every name
                            starts in the same column */}
                        {held > 0 ? (
                          <button
                            type="button"
                            onClick={() => toggleGroup(row.key)}
                            aria-expanded={!isCollapsed}
                            aria-label={
                              isCollapsed
                                ? `Show the ${held} line${held === 1 ? "" : "s"} under “${row.name}”`
                                : `Hide the ${held} line${held === 1 ? "" : "s"} under “${row.name}”`
                            }
                            title={
                              isCollapsed
                                ? `Show the ${held} line${held === 1 ? "" : "s"} under “${row.name}”`
                                : `Hide the ${held} line${held === 1 ? "" : "s"} under “${row.name}”`
                            }
                            className="-ml-1 grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <ChevronDown
                              className={cn(
                                "size-3 transition-transform",
                                isCollapsed && "-rotate-90",
                              )}
                            />
                          </button>
                        ) : (
                          <span aria-hidden className="w-4 shrink-0" />
                        )}
                        {row.fgId !== undefined ? (
                          <Package
                            className={cn(
                              "size-3 shrink-0",
                              LEVEL_INK[row.level],
                              row.depth === 1 && "ml-3",
                              row.depth === 2 && "ml-6",
                            )}
                          />
                        ) : row.depth === 0 ? (
                          <Folder
                            className={cn(
                              "size-3.5 shrink-0",
                              LEVEL_INK[row.level],
                              row.done && "opacity-60",
                            )}
                          />
                        ) : (
                          <Briefcase
                            className={cn("ml-3 size-3 shrink-0", LEVEL_INK[row.level])}
                          />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <button
                            type="button"
                            onClick={openPanel}
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
                          </button>                            <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                            <span
                              className="shrink-0 tabular-nums"
                              title={`${durationDays} day${durationDays === 1 ? "" : "s"} between its start and its end`}
                            >
                              {durationDays}d
                            </span>
                            {row.percent !== undefined && (
                              <span
                                className="shrink-0 font-semibold tabular-nums"
                                title={`${row.percent}% complete — products finished over total products in the job`}
                              >
                                {row.percent}%
                              </span>
                            )}
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
                        {hasEnd ? (
                          <span
                            role={canEdit ? "button" : undefined}
                            tabIndex={canEdit ? 0 : undefined}
                            aria-label={
                              canEdit
                                ? `${row.name} — ${row.status}, ${datesLabel}${doneLabel}. Drag the bar to move the line, or an edge to change one date; the arrow keys move it a day at a time.`
                                : `${row.name} — ${row.status}, ${datesLabel}${doneLabel}`
                            }
                            onPointerDown={(event) => {
                              if (!canEdit || busyKey !== null) return;
                              const track = event.currentTarget.parentElement;
                              const width = track?.getBoundingClientRect().width ?? 0;
                              if (width <= 0 || timeline.days <= 0) return;
                              // which part of the bar was grabbed: an edge changes
                              // one date, the body moves the whole line
                              const bar = event.currentTarget.getBoundingClientRect();
                              const edge = Math.min(10, bar.width / 3);
                              const offset = event.clientX - bar.left;
                              const grip: GanttGrip =
                                offset <= edge
                                  ? "start"
                                  : offset >= bar.width - edge
                                    ? "end"
                                    : "move";
                              // stops the drag from selecting the row's text
                              event.preventDefault();
                              event.currentTarget.setPointerCapture(event.pointerId);
                              setDrag({
                                key: row.key,
                                grip,
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
                              const { days, grip } = drag;
                              setDrag(null);
                              // a click that did not move the bar is left alone
                              if (days !== 0) void reschedule(row, days, grip);
                            }}
                            onPointerCancel={() => setDrag(null)}
                            // the card follows the pointer onto the bar and off
                            // it again, without ever getting in its way
                            onPointerEnter={() => setHoverKey(row.key)}
                            onPointerLeave={() =>
                              setHoverKey((key) => (key === row.key ? null : key))
                            }
                            onKeyDown={(event) => {
                              if (!canEdit) return;
                              const step =
                                (event.shiftKey ? 7 : 1) *
                                (event.key === "ArrowDown" ||
                                event.key === "ArrowLeft"
                                  ? -1
                                  : 1);
                              if (
                                event.key === "ArrowLeft" ||
                                event.key === "ArrowRight"
                              ) {
                                event.preventDefault();
                                void reschedule(row, step, "move");
                                return;
                              }
                              if (
                                event.key === "ArrowUp" ||
                                event.key === "ArrowDown"
                              ) {
                                event.preventDefault();
                                void reschedule(row, step, event.altKey ? "start" : "end");
                              }
                            }}
                            className={cn(
                              "group absolute top-1/2 h-2.5 -translate-y-1/2 rounded-full",
                              LEVEL_FILL[row.level],
                              row.done && "opacity-40",
                              overdue && "ring-1 ring-destructive/60",
                              canEdit &&
                                "cursor-grab touch-none active:cursor-grabbing",
                              dragging && "ring-2 ring-primary/70",
                              busyKey === row.key && "animate-pulse",
                            )}
                            style={{
                              left: `${from}%`,
                              // the bar's size is the span of the line's planned dates.
                              // It is not the job's completion percentage — that is shown
                              // on the bar itself wherever it fits, from the products that
                              // are finished over the ones that are not.
                              width: `${Math.max(to - from, 0.6)}%`,
                            }}
                            title={
                              canEdit
                                ? `${row.status} — ${datesLabel}, ${durationDays} day${durationDays === 1 ? "" : "s"}${doneLabel}. Drag it to move the line, or an edge to change one date.`
                                : `${row.status} — ${datesLabel}, ${durationDays} day${durationDays === 1 ? "" : "s"}${doneLabel}${overdue ? ", overdue" : ""}`
                            }
                          >
                            {/* the exact completion of the line, shown on the bar
                                wherever it fits. A job's percentage is finished products over
                                total products; a project's is the same ratio (or the jobs',
                                when the project holds none). It is printed rounded on the
                                bar pill and in the hover card only; the inlay's true width is
                                the exact value so a bar for 1 of 3 still reads as a third. */}
                            {row.percent !== undefined && (
                              <span
                                aria-hidden
                                className="absolute inset-y-0 left-0 rounded-full bg-black/25"
                                style={{ width: `${(row.percent / 100) * (to - from)}%` }}
                              />
                            )}
                            {row.percent !== undefined && to - from >= 6 && (
                              <span
                                aria-hidden
                                className="absolute inset-y-0 right-2.5 flex items-center text-[8px] font-bold tabular-nums text-white/95 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)]"
                              >
                                {Math.round(row.percent)}%
                              </span>
                            )}
                            {/* the two ends as handles: what the reader grabs to
                                change one date without moving the other */}
                            {canEdit && (
                              <>
                                <span
                                  aria-hidden
                                  className={cn(
                                    "absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-full bg-black/30 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
                                    dragging && drag.grip === "start" && "opacity-100",
                                  )}
                                />
                                <span
                                  aria-hidden
                                  className={cn(
                                    "absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-full bg-black/30 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
                                    dragging && drag.grip === "end" && "opacity-100",
                                  )}
                                />
                              </>
                            )}
                          </span>
                        ) : (
                          /* nothing dates this line: a stub where it starts, with
                             the End column waiting to be filled in */
                          <span
                            aria-hidden
                            className="absolute top-1/2 h-2.5 w-4 -translate-y-1/2 rounded-full border border-dashed border-muted-foreground/60"
                            style={{ left: `${from}%` }}
                            title="No end date yet — set one in the End column"
                            onPointerEnter={() => setHoverKey(row.key)}
                            onPointerLeave={() =>
                              setHoverKey((key) => (key === row.key ? null : key))
                            }
                          />
                        )}
                        {hasEnd && (
                          <Diamond
                            className={cn(
                              "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 fill-card",
                              ink,
                              // hollow while the end is still its parent's
                              !endPlanned && planned === null && "fill-transparent",
                            )}
                            style={{ left: `${to}%` }}
                          />
                        )}
                        {/* the date being dragged to, following the end it moves */}
                        {drag !== null && dragging && (
                          <span
                            className={cn(
                              "pointer-events-none absolute -top-1.5 z-20 -translate-x-1/2 rounded-md border bg-popover px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap tabular-nums shadow-sm",
                              drag.days === 0 && "text-muted-foreground",
                            )}
                            style={{
                              left: `${drag.grip === "start" ? from : to}%`,
                            }}
                          >
                            {drag.grip === "start" && "Start · "}
                            {drag.grip === "end" && "End · "}
                            {drag.days === 0
                              ? new Date(drag.grip === "start" ? start : end).toLocaleDateString()
                              : `${drag.days > 0 ? "+" : "−"}${Math.abs(drag.days)}d · ${new Date(drag.grip === "start" ? start : end).toLocaleDateString()}`}
                          </span>
                        )}
                        {/* what the line is, while the pointer rests on its bar:
                            the level the colour stands for, the workflow state,
                            the dates it is actually drawn with, and which of
                            them it owns rather than inherits */}
                        {hovering && (
                          <span
                            className={cn(
                              // three lines that fit inside a row, so the
                              // card never adds scrollable overflow to the chart
                              "pointer-events-none absolute top-1/2 z-30 flex -translate-y-1/2 flex-col rounded-lg border bg-popover/95 px-2 py-1 text-[10px] leading-[1.2] shadow-lg backdrop-blur-sm",
                              to > 55 && "-translate-x-full",
                            )}
                            style={{
                              left: `${to > 55 ? to : from}%`,
                              marginLeft: to > 55 ? -6 : 6,
                            }}
                          >
                            <span className="flex min-w-0 max-w-[260px] items-center gap-1.5">
                              <span
                                className={cn(
                                  "size-1.5 shrink-0 rounded-full",
                                  LEVEL_FILL[row.level],
                                )}
                              />
                              <span className="font-medium text-foreground">
                                {LEVEL_LABEL[row.level]}
                              </span>
                              <span className="min-w-0 truncate text-muted-foreground">
                                {row.status}
                                {rowCompletion !== null
                                  ? ` · ${rowCompletion}%`
                                  : ""}
                                {rowOwner !== null ? ` · ${rowOwner}` : ""}
                              </span>
                              {overdue && (
                                <span className="font-medium text-destructive">
                                  overdue
                                </span>
                              )}
                            </span>
                            <span className="max-w-[260px] truncate font-medium text-foreground">
                              {row.name}
                              {row.code ? ` · ${row.code}` : ""}
                            </span>                              <span
                                className="flex items-center gap-1 whitespace-nowrap text-muted-foreground tabular-nums"
                              >
                                <span>{windowDate(start)}</span>
                                <span>→</span>
                                <span>{hasEnd ? windowDate(end) : "no end yet"}</span>
                                <span>· {durationDays}d</span>
                                {row.progress !== undefined &&
                                  row.progress.total > 0 && (
                                    <span>
                                      · {row.progress.done}/{row.progress.total} products done
                                    </span>
                                  )}
                                <span>
                                · {row.percent}
                                  {percentLabel !== undefined
                                    ? `%
                                      {startPlanned ? "own start" : "start not planned"}{" "}
                                      / {endPlanned ? "own end" : "end not planned"}`
                                    : "start not planned / end not planned"}
                              </span>
                            </span>
                          </span>
                        )}
                      </div>

                      <div
                        className="flex shrink-0 items-center border-l border-border/60 bg-card px-1.5"
                        style={{ width: GANTT_START_W }}
                      >
                        <input
                          type="date"
                          value={dateInputValue(start)}
                          disabled={!canEdit || busyKey === row.key}
                          onChange={(event) =>
                            void setDate(row, "start", event.target.value)
                          }
                          aria-label={`${row.name} start date`}
                          title={
                            startPlanned
                              ? "The day this line is planned to start"
                              : "Running from the day it was created — set a start to plan it"
                          }
                          className={cn(
                            "w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] tabular-nums outline-none hover:border-border focus:border-primary/40 focus:ring-2 focus:ring-primary/20 disabled:opacity-60",
                            !startPlanned && "text-muted-foreground/80",
                          )}
                        />
                      </div>
                      <div
                        className="flex shrink-0 items-center border-l border-border/60 bg-card px-1.5"
                        style={{ width: GANTT_END_W }}
                      >
                        <input
                          type="date"
                          value={hasEnd ? dateInputValue(end) : ""}
                          disabled={!canEdit || busyKey === row.key}
                          onChange={(event) =>
                            void setDate(row, "end", event.target.value)
                          }
                          aria-label={`${row.name} end date`}
                          title={
                            !hasEnd
                              ? "No end date yet — set one to put this line on the timeline"
                              : endPlanned
                                ? "The day this line is due"
                                : "Due when its parent is — set a date to plan it on its own"
                          }
                          className={cn(
                            "w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[11px] tabular-nums outline-none hover:border-border focus:border-primary/40 focus:ring-2 focus:ring-primary/20 disabled:opacity-60",
                            !endPlanned && "text-muted-foreground/80",
                          )}
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
                  style={{ left: GANTT_LABEL_W, right: GANTT_DATE_W }}
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

      {undated > 0 && (
        <p className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          <CalendarRange className="size-3.5 shrink-0" />
          {undated} line{undated === 1 ? "" : "s"} still
          {undated === 1 ? " has" : " have"} no end date — set one in the End
          column and the bar appears on the timeline.
        </p>
      )}
    </div>
  );
}
