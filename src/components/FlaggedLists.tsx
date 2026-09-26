import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/checkbox";
import type { Priority } from "@/lib/task-utils";
import { daysLeftLabel, formatDueLabel, toLocalInput } from "@/lib/task-utils";
import {
  AlertTriangle,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  Flag,
  Folder,
  GanttChartSquare,
  GripVertical,
  History,
  Loader2,
  Package,
  Play,
  Star,
  Tag,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PROJECT_STATUSES,
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
  projectStatusesOrDefaults,
} from "@/lib/project-statuses";

export type ListId = Id<"taskLists">;
export type SortMode = "manual" | "due" | "priority" | "created";
export type JobDoc = Doc<"projectJobs">;
export type FgDoc = Doc<"finishedGoods">;

export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export const PRIORITY_META: Record<Priority, { dot: string; chip: string }> = {
  high: { dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  medium: { dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  low: { dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
};

/** Sort flagged jobs like the main todo list (custom/due/priority/newest). */
export function sortJobs(jobs: JobDoc[], mode: SortMode): JobDoc[] {
  const out = [...jobs];
  if (mode === "due") out.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  else if (mode === "priority")
    out.sort(
      (a, b) => PRIORITY_RANK[a.priority ?? "low"] - PRIORITY_RANK[b.priority ?? "low"],
    );
  else if (mode === "created") out.sort((a, b) => b._creationTime - a._creationTime);
  return out;
}

/** Products have no due date/priority, so those modes fall back to name order. */
export function sortFgs(fgs: FgDoc[], mode: SortMode): FgDoc[] {
  const out = [...fgs];
  if (mode === "created") out.sort((a, b) => b._creationTime - a._creationTime);
  else if (mode !== "manual") out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/**
 * Projects workspace filter — one button per level of the hierarchy:
 * "projects" (the project list), "jobs" (flagged job rows) and "products"
 * (flagged product cards, flat, with the optional board view).
 */
export type FlagFilter = "projects" | "jobs" | "products";
export type FlagStatusFilter = "all" | string;

type ProjectStatus = string;

export function jobProjectStatus(job: JobDoc, statuses: string[]): ProjectStatus {
  if (job.projectStatus && statuses.includes(job.projectStatus)) return job.projectStatus;
  if (job.status === "completed" || job.status === "cancelled") return PROJECT_STATUS_FINISH;
  if (job.status === "in_progress" || job.status === "paused") return statuses[1] ?? PROJECT_STATUS_START;
  return PROJECT_STATUS_START;
}

export function fgProjectStatus(fg: FgDoc, statuses: string[]): ProjectStatus {
  if (fg.projectStatus && statuses.includes(fg.projectStatus)) return fg.projectStatus;
  return fg.isCompleted ? PROJECT_STATUS_FINISH : PROJECT_STATUS_START;
}

export function projectDocStatus(
  project: Doc<"projects">,
  statuses: string[],
): ProjectStatus {
  if (project.projectStatus && statuses.includes(project.projectStatus))
    return project.projectStatus;
  if (project.status === "completed" || project.status === "cancelled")
    return PROJECT_STATUS_FINISH;
  if (project.status === "in_progress" || project.status === "on_hold")
    return statuses[1] ?? PROJECT_STATUS_START;
  return PROJECT_STATUS_START;
}

export { daysLeftLabel };

/**
 * Due date + how many days are left to finish, shown as two chips on every
 * row. `inherited` marks a date that came from the parent job, and `empty`
 * renders a muted placeholder so a missing date is visible instead of silent.
 */
export function DueChips({
  dueAt,
  inherited = false,
  empty = false,
}: {
  dueAt?: number;
  inherited?: boolean;
  empty?: boolean;
}) {
  if (dueAt === undefined) {
    if (!empty) return null;
    return (
      <span
        className={cn(tagChip, "border border-dashed border-border/80 text-muted-foreground/70")}
        title="No due date yet — set one from the details pane"
      >
        No due date
      </span>
    );
  }
  const left = daysLeftLabel(dueAt);
  return (
    <>
      <span
        className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
        title={`Due ${formatDueLabel(dueAt)}${inherited ? " (inherited from the job)" : ""}`}
      >
        {formatDueLabel(dueAt)}
      </span>
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
          left.overdue ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary",
        )}
        title={`${left.text} — time left to finish`}
      >
        {left.text}
      </span>
    </>
  );
}

/** Which item's detail pane is open — one per hierarchy level. */
export type FlaggedSel =
  | { kind: "project"; id: Id<"projects"> }
  | { kind: "job"; id: Id<"projectJobs"> }
  | { kind: "fg"; id: Id<"finishedGoods"> }
  | null;

/** Wider chip shared by the Projects workspace filter bar and cards. */
export const tagChip =
  "shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground";

/** Flagged jobs & products (from the Projects section) with their labels. */
export type FlaggedData = {
  jobs: JobDoc[];
  fgs: FgDoc[];
  projects: Doc<"projects">[];
  projectNameOf: (job: JobDoc) => string;
};

/** Shared completion-status predicate for the workspace filters. */
export function matchesStatusFilter(
  filter: FlagStatusFilter,
  status: string,
  isDone: boolean,
): boolean {
  if (filter === "all") return true;
  if (filter === "open") return !isDone;
  if (filter === "done") return isDone;
  return status === filter;
}

/**
 * Flagged items rendered as real todo rows: products get a checkbox, and a job
 * can only be checked off once every flagged product under it is completed.
 * `showTags` adds explicit project & job name tag chips (used in the main list).
 */
export function FlaggedItemsList({
  data,
  allJobs,
  allFgs,
  showTags = false,
  statusFilter = "all",
  projectStatuses: configuredProjectStatuses,
  productsOnly = false,
  jobsOnly = false,
  onToggleFg,
  onToggleJob,
  busyKey,
  sortMode = "manual",
  selection,
  onSelect,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  allFgs: FgDoc[];
  showTags?: boolean;
  statusFilter?: FlagStatusFilter;
  projectStatuses?: string[];
  productsOnly?: boolean;
  /** Jobs filter: only the job rows, without the trailing standalone products. */
  jobsOnly?: boolean;
  onToggleFg: (fg: FgDoc) => void;
  onToggleJob: (job: JobDoc) => void;
  busyKey: string | null;
  sortMode?: SortMode;
  selection?: FlaggedSel;
  onSelect?: (sel: FlaggedSel) => void;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );
  const checkCls =
    "size-5 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-3";
  /** Projects whose job list is folded away; a project header opens/closes it. */
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleProject = (key: string) =>
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const visibleJobs = productsOnly
    ? []
    : sortJobs(data.jobs, sortMode).filter((job) =>
        matchesStatusFilter(
          statusFilter ?? "all",
          jobProjectStatus(job, projectStatuses),
          job.status === "completed",
        ),
      );

  return (
    <ul className="divide-y divide-border/70">
      {/* flagged jobs: main task — their flagged products as completable subtasks */}
      {visibleJobs.map((job, jobIndex) => {
        const project = data.projects.find((item) => item._id === job.projectId);
        const isFirstJobForProject =
          visibleJobs.findIndex((item) => item.projectId === job.projectId) === jobIndex;
        const jobProducts = allFgs
          .filter((f) => f.jobId === job._id || (f.jobIds ?? []).includes(job._id))
          .filter((f) => matchesStatusFilter(statusFilter ?? "all", fgProjectStatus(f, projectStatuses ?? [...DEFAULT_PROJECT_STATUSES]), f.isCompleted ?? false));
        const done = jobProjectStatus(job, projectStatuses) === PROJECT_STATUS_FINISH;
        const allFlaggedProducts = allFgs.filter(
          (f) => f.jobId === job._id || (f.jobIds ?? []).includes(job._id),
        );
        const allProductsDone =
          allFlaggedProducts.length > 0 &&
          allFlaggedProducts.every((f) => f.isCompleted);
        const disabled = busyKey !== null || (!done && !allProductsDone);
        const projectCollapsed = collapsedProjects.has(job.projectId);
        const projectJobs = visibleJobs.filter(
          (item) => item.projectId === job.projectId,
        );
        return (
          <li
            key={job._id}
            className={cn(
              "px-4 py-3 transition-colors",
              done && "opacity-60",
              !isFirstJobForProject && projectCollapsed && "hidden",
              selection?.kind === "job" && selection.id === job._id && "bg-primary/[0.04]",
            )}
          >
            {isFirstJobForProject && (
              <button
                type="button"
                onClick={() => toggleProject(job.projectId)}
                aria-expanded={!projectCollapsed}
                className="mb-2 flex w-full flex-wrap items-center gap-2 rounded-lg bg-primary/[0.06] px-2 py-1.5 text-left text-sm"
              >
                <ChevronDown
                  className={cn(
                    "size-3.5 shrink-0 text-primary transition-transform",
                    !projectCollapsed && "rotate-180",
                  )}
                />
                <Folder className="size-4 shrink-0 text-sky-500/80" />
                <span className="font-semibold">{data.projectNameOf(job)}</span>
                {project?.code && <span className="font-mono text-[10px] text-muted-foreground/70">{project.code}</span>}
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {projectJobs.length} job{projectJobs.length === 1 ? "" : "s"}
                </span>
              </button>
            )}
            <div
              className={cn(
                "ml-4 flex flex-wrap items-center gap-2 border-l border-border/60 pl-3",
                projectCollapsed && "hidden",
              )}
            >
              <Checkbox
                checked={done}
                disabled={disabled}
                onCheckedChange={() => onToggleJob(job)}
                aria-label={
                  done
                    ? `Reopen job “${job.name}”`
                    : `Mark job “${job.name}” as done`
                }
                title={
                  !done && !allProductsDone
                    ? jobProducts.length === 0
                      ? "No flagged products to complete yet"
                      : "Complete all products first"
                    : undefined
                }
                className={checkCls}
              />
              <button
                type="button"
                onClick={() => onSelect?.({ kind: "job", id: job._id })}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                title="Open details"
              >
                <Flag
                  className={cn(
                    "size-3.5 shrink-0",
                    done ? "fill-emerald-400 text-emerald-500" : "fill-amber-400 text-amber-500",
                  )}
                />
                <Briefcase className="size-3.5 shrink-0 text-sky-500/80" />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm font-medium",
                    done && "text-muted-foreground line-through",
                  )}
                >
                  {job.name}
                </span>
              </button>
              {jobProducts.length > 0 && (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                    done
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground",
                  )}
                  title="Flagged products completed"
                >
                  {jobProducts.filter((f) => f.isCompleted).length}/{jobProducts.length}
                </span>
              )}
              <DueChips dueAt={job.dueAt} empty />
              <span className={tagChip}>{data.projectNameOf(job)}</span>
              <span className={tagChip}>{jobProjectStatus(job, projectStatuses)}</span>
            </div>
            {jobProducts.length > 0 && (
              <ul
                className={cn(
                  "ml-4 mt-1.5 space-y-1 border-l border-border/60 pl-3",
                  projectCollapsed && "hidden",
                )}
              >
                {jobProducts.map((fg) => (
                  <li
                    key={fg._id}
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-2 py-1 pl-7 text-xs transition-colors",
                      selection?.kind === "fg" && selection.id === fg._id && "bg-primary/10",
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
                      className="size-4 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-2.5"
                    />
                    <Package className="size-3 shrink-0 text-sky-500/70" />
                    <button
                      type="button"
                      onClick={() => onSelect?.({ kind: "fg", id: fg._id })}
                      className={cn(
                        "min-w-0 flex-1 cursor-pointer truncate text-left",
                        fg.isCompleted && "text-muted-foreground line-through",
                      )}
                    >
                      {fg.name}
                    </button>
                    {fg.code && (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                        {fg.code}
                      </span>
                    )}
                    <DueChips
                      dueAt={fg.dueAt ?? job.dueAt}
                      inherited={fg.dueAt === undefined && job.dueAt !== undefined}
                    />
                    {showTags && (
                      <>
                        <span className={tagChip}>{data.projectNameOf(job)}</span>
                        <span className={tagChip}>{job.name}</span>
                      </>
                    )}
                    <span className={tagChip}>{fgProjectStatus(fg, projectStatuses ?? [...DEFAULT_PROJECT_STATUSES])}</span>
                    <ProductionButton fg={fg} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      {/* flagged products whose job is not flagged: job shown as main, product as the completable subtask */}
      {!jobsOnly && sortFgs(
        data.fgs
          .filter((f) => matchesStatusFilter(statusFilter ?? "all", fgProjectStatus(f, projectStatuses ?? [...DEFAULT_PROJECT_STATUSES]), f.isCompleted ?? false))
          .filter((f) => {
            const jobs = f.jobIds ?? (f.jobId ? [f.jobId] : []);
            return !jobs.some((jid) => data.jobs.some((j) => j._id === jid));
          }),
        sortMode,
      ).map((fg) => {
          const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
          const parentJob = allJobs.find((j) => jobIds.includes(j._id));
          return (
            <li
              key={fg._id}
              className={cn(
                "px-4 py-3 transition-colors",
                fg.isCompleted && "opacity-60",
                selection?.kind === "fg" && selection.id === fg._id && "bg-primary/[0.04]",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                {parentJob ? (
                  <>
                    <Briefcase className="size-3.5 shrink-0 text-sky-500/70" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
                      {parentJob.name}
                    </span>
                    <span className={tagChip}>{data.projectNameOf(parentJob)}</span>
                  </>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    Unassigned job
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-2 py-1 pl-7 text-xs">
                <Checkbox
                  checked={fg.isCompleted ?? false}
                  disabled={busyKey !== null}
                  onCheckedChange={() => onToggleFg(fg)}
                  aria-label={
                    fg.isCompleted
                      ? `Reopen product “${fg.name}”`
                      : `Mark product “${fg.name}” as done`
                  }
                  className="size-4 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-2.5"
                />
                <Package className="size-3 shrink-0 text-sky-500/70" />
                <button
                  type="button"
                  onClick={() => onSelect?.({ kind: "fg", id: fg._id })}
                  className={cn(
                    "min-w-0 flex-1 cursor-pointer truncate text-left font-medium",
                    fg.isCompleted && "text-muted-foreground line-through",
                  )}
                >
                  {fg.name}
                </button>
                {fg.code && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                    {fg.code}
                  </span>
                )}
                {showTags && parentJob && <span className={tagChip}>{parentJob.name}</span>}
                <DueChips
                  dueAt={fg.dueAt ?? parentJob?.dueAt}
                  inherited={fg.dueAt === undefined && parentJob?.dueAt !== undefined}
                />
                <ProductionButton fg={fg} />
              </div>
            </li>
          );
        })}
    </ul>
  );
}

/**
 * Top level of the Projects workspace: one row per project with its jobs and
 * products rolled up, so the whole hierarchy is browsable before drilling in.
 */
export function FlaggedProjectsList({
  projects,
  jobs,
  fgs,
  statusFilter = "all",
  projectStatuses: configuredProjectStatuses,
  sortMode = "manual",
  selection,
  onSelect,
}: {
  projects: Doc<"projects">[];
  jobs: JobDoc[];
  fgs: FgDoc[];
  statusFilter?: FlagStatusFilter;
  projectStatuses?: string[];
  sortMode?: SortMode;
  selection?: FlaggedSel;
  onSelect?: (sel: FlaggedSel) => void;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );
  const rows = [...projects];
  if (sortMode === "created") rows.sort((a, b) => b._creationTime - a._creationTime);
  else if (sortMode === "due")
    rows.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  else if (sortMode === "priority")
    rows.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority ?? "low"] - PRIORITY_RANK[b.priority ?? "low"] ||
        a.name.localeCompare(b.name),
    );
  else rows.sort((a, b) => a.name.localeCompare(b.name));

  const visible = rows.filter((project) =>
    matchesStatusFilter(
      statusFilter ?? "all",
      projectDocStatus(project, projectStatuses),
      project.status === "completed" || project.status === "cancelled",
    ),
  );

  const jobsOf = (projectId: Id<"projects">) =>
    jobs.filter((j) => j.projectId === projectId);
  const productsOf = (project: Doc<"projects">) =>
    fgs.filter((f) => {
      const jobIds = f.jobIds ?? (f.jobId ? [f.jobId] : []);
      return (
        f.projectName === project.name ||
        jobIds.some((jid) => jobs.some((j) => j._id === jid && j.projectId === project._id))
      );
    });

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
        const done = status === PROJECT_STATUS_FINISH;
        const projectJobs = jobsOf(project._id);
        const projectFgs = productsOf(project);
        return (
          <li
            key={project._id}
            className={cn(
              "flex flex-wrap items-center gap-2 px-4 py-3 transition-colors",
              done && "opacity-60",
              selection?.kind === "project" &&
                selection.id === project._id &&
                "bg-primary/[0.04]",
            )}
          >
            <Folder
              className={cn(
                "size-4 shrink-0",
                done ? "text-emerald-500" : "text-sky-500/80",
              )}
            />
            <button
              type="button"
              onClick={() => onSelect?.({ kind: "project", id: project._id })}
              className={cn(
                "min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium",
                done && "text-muted-foreground line-through",
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
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                projectJobs.length === 0
                  ? "bg-muted text-muted-foreground"
                  : "bg-sky-500/10 text-sky-700 dark:text-sky-400",
              )}
              title="Jobs in this project"
            >
              {projectJobs.length} job{projectJobs.length === 1 ? "" : "s"}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                projectFgs.length === 0
                  ? "bg-muted text-muted-foreground"
                  : "bg-violet-500/10 text-violet-700 dark:text-violet-400",
              )}
              title="Products in this project"
            >
              {projectFgs.length} product{projectFgs.length === 1 ? "" : "s"}
            </span>
            <DueChips dueAt={project.dueAt} />
            <span className={tagChip}>{status}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Products-only list: one flat row per flagged product (the job is just a
 * small tag on the row), honoring the status filter.
 */
export function FlaggedProductsList({
  data,
  allJobs,
  statusFilter,
  projectStatuses: configuredProjectStatuses,
  showTags = false,
  onToggleFg,
  busyKey,
  sortMode = "manual",
  selection,
  onSelect,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  statusFilter?: FlagStatusFilter;
  projectStatuses?: string[];
  showTags?: boolean;
  onToggleFg: (fg: FgDoc) => void;
  busyKey: string | null;
  sortMode?: SortMode;
  selection?: FlaggedSel;
  onSelect?: (sel: FlaggedSel) => void;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );
  const rows = sortFgs(
    data.fgs.filter((f) => matchesStatusFilter(statusFilter ?? "all", fgProjectStatus(f, projectStatuses ?? [...DEFAULT_PROJECT_STATUSES]), f.isCompleted ?? false)),
    sortMode,
  ).map((fg) => {
    const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
    const parentJob = allJobs.find((j) => jobIds.includes(j._id));
    return { fg, parentJob };
  });

  if (rows.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <Package className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">
          {statusFilter === PROJECT_STATUS_FINISH ? "No finished products" : "No products in this status"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {statusFilter === "all"
            ? "Flag a product in the Projects page and it will show up here."
            : "Choose another status filter to see more products."}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/70">
      {rows.map(({ fg, parentJob }) => (
        <li
          key={fg._id}
          className={cn(
            "flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm transition-colors",
            fg.isCompleted && "opacity-60",
            selection?.kind === "fg" && selection.id === fg._id && "bg-primary/[0.04]",
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
            className="size-5 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-3"
          />
          <Flag
            className={cn(
              "size-3.5 shrink-0",
              fg.isCompleted
                ? "fill-emerald-400 text-emerald-500"
                : "fill-amber-400 text-amber-500",
            )}
          />
          <Package className="size-3.5 shrink-0 text-sky-500/80" />
          <button
            type="button"
            onClick={() => onSelect?.({ kind: "fg", id: fg._id })}
            className={cn(
              "min-w-0 flex-1 cursor-pointer truncate text-left font-medium",
              fg.isCompleted && "text-muted-foreground line-through",
            )}
          >
            {fg.name}
          </button>
          {fg.code && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
              {fg.code}
            </span>
          )}
          {parentJob && <span className={tagChip}>{parentJob.name}</span>}
          <DueChips
            dueAt={fg.dueAt ?? parentJob?.dueAt}
            inherited={fg.dueAt === undefined && parentJob?.dueAt !== undefined}
            empty
          />
          {showTags && parentJob && <span className={tagChip}>{data.projectNameOf(parentJob)}</span>}
          <span className={tagChip}>{fgProjectStatus(fg, projectStatuses ?? [...DEFAULT_PROJECT_STATUSES])}</span>
          <ProductionButton fg={fg} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Start production on a product: it gets flagged so it opens in the
 * workspace, and the raw materials its costing sheet needs leave the stock.
 * Stopping or editing a running production always asks for confirmation
 * first, because it puts consumed stock back or changes what was used.
 */
export function ProductionButton({ fg }: { fg: FgDoc }) {
  const startProduction = useMutation(api.production.start);
  const stopProduction = useMutation(api.production.stop);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const running = fg.productionStartedAt !== undefined;

  const run = async (
    action: () => Promise<unknown>,
    message: string,
    done: string,
  ) => {
    setBusy(true);
    try {
      await action();
      toast.success(done);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (!running) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(() => startProduction({ fgId: fg._id }), "Couldn't start production.", "Production started — materials taken out of stock.")}
        title="Flag this product and take its materials out of stock"
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400"
      >
        {busy ? <Loader2 className="size-2.5 animate-spin" /> : <Play className="size-2.5" />}
        Start production
      </button>
    );
  }

  if (!confirming) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <span
          className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
          title={`Production running since ${new Date(fg.productionStartedAt as number).toLocaleString()}`}
        >
          In production
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(true)}
          title="Stop production"
          className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          Stop
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
      <AlertTriangle className="size-2.5" />
      Stop and return the used stock?
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(
            () => stopProduction({ fgId: fg._id }),
            "Couldn't stop production.",
            "Production stopped — stock returned.",
          )
        }
        className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-destructive-foreground disabled:opacity-50"
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
      >
        No
      </button>
    </span>
  );
}

/** Kanban columns for flagged work. The first and last statuses are fixed. */
type BoardColumn = string;
type BoardCard = { kind: "fg"; fg: FgDoc; jobName?: string; project: string; status: string };

const BOARD_CARD =
  "group/card relative flex cursor-grab flex-col gap-1.5 rounded-xl border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing";

function BoardCardView({
  card,
  busyKey,
  onToggleFg,
  onOpen,
}: {
  card: BoardCard;
  busyKey: string | null;
  onToggleFg: (fg: FgDoc) => void;
  onOpen: (fg: FgDoc) => void;
}) {
  const done = card.status === PROJECT_STATUS_FINISH;
  const busy = busyKey === `f:${card.fg._id}`;
  return (
    <motion.div layout className={BOARD_CARD}>
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl bg-violet-500/70"
      />
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover/card:text-muted-foreground/70" />
        <button
          type="button"
          onClick={() => onOpen(card.fg)}
          className="min-w-0 flex-1 cursor-pointer text-left"
          title="Open details"
        >
          <p
            className={cn(
              "truncate text-sm font-medium leading-snug",
              done && "text-muted-foreground line-through",
            )}
          >
            {card.fg.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
            <Package className="size-2.5 text-violet-500/80" />
            {card.jobName ?? "Product"}
            <span className="text-muted-foreground/50">·</span>
            <span className="truncate">{card.project}</span>
          </p>
        </button>
        <Checkbox
          checked={done}
          disabled={busy}
          onCheckedChange={() => onToggleFg(card.fg)}
          aria-label={
            done ? `Reopen product “${card.fg.name}”` : `Mark product “${card.fg.name}” as done`
          }
          className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-2.5"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {card.fg.dueAt !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
              card.fg.dueAt !== undefined &&
                daysLeftLabel(card.fg.dueAt).overdue &&
                !done
                ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            <CalendarDays className="size-2.5" />
            {formatDueLabel(card.fg.dueAt)}
          </span>
        )}
        {card.fg.dueAt !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              daysLeftLabel(card.fg.dueAt).overdue && !done
                ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                : "bg-primary/10 text-primary",
            )}
            title="Time left to finish this product"
          >
            {daysLeftLabel(card.fg.dueAt).text}
          </span>
        )}
        {card.fg.priority && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                card.fg.priority === "high"
                  ? "bg-rose-500"
                  : card.fg.priority === "medium"
                    ? "bg-amber-500"
                    : "bg-sky-500",
              )}
            />
            {card.fg.priority}
          </span>
        )}
        {done ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="size-2.5" /> Finish
          </span>
        ) : (
          <span className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400">
            {card.status}
          </span>
        )}
        <ProductionButton fg={card.fg} />
      </div>
    </motion.div>
  );
}

/**
 * Professional drag & drop kanban of the flagged products: one column per
 * custom Projects status. Dragging a card between columns saves the new status.
 */
export function FlaggedBoard({
  data,
  allJobs,
  statusFilter,
  projectStatuses: configuredProjectStatuses,
  onToggleFg,
  onSetStatus,
  busyKey,
  onOpenFg,
  projectNameOf,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  statusFilter?: FlagStatusFilter;
  projectStatuses?: string[];
  onToggleFg: (fg: FgDoc) => void;
  onSetStatus?: (fg: FgDoc, status: string) => void;
  busyKey: string | null;
  onOpenFg: (fg: FgDoc) => void;
  projectNameOf: (job: JobDoc) => string;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );
  const [dragging, setDragging] = useState<Id<"finishedGoods"> | null>(null);
  const setFgProjectStatusM = useMutation(api.costing.setFgProjectStatus);

  const productCards: BoardCard[] = data.fgs.map((fg) => {
    const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
    const parentJob = allJobs.find((j) => jobIds.includes(j._id));
    return {
      kind: "fg" as const,
      fg,
      jobName: parentJob?.name,
      project: parentJob ? projectNameOf(parentJob) : (fg.projectName ?? "Standalone"),
      status: fgProjectStatus(fg, projectStatuses ?? [...DEFAULT_PROJECT_STATUSES]),
    };
  });

  const fgsByCol = (col: BoardColumn) =>
    productCards.filter((c) => c.status === col);

  const colCards = (col: BoardColumn): BoardCard[] =>
    fgsByCol(col).filter((c) =>
      matchesStatusFilter(statusFilter ?? "all", c.status, c.fg.isCompleted ?? false),
    );

  const handleDrop = (col: BoardColumn) => {
    if (!dragging) return;
    const card = productCards.find((c) => c.fg._id === dragging);
    if (card && card.status !== col) {
      if (onSetStatus) {
        onSetStatus(card.fg, col);
      } else {
        void setFgProjectStatusM({ id: card.fg._id, status: col }).catch((error) =>
          toast.error(error instanceof Error ? error.message : "Couldn't update the product status."),
        );
      }
    }
    setDragging(null);
  };

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {(projectStatuses ?? [...DEFAULT_PROJECT_STATUSES]).map((col) => {
        const cards = colCards(col);
        const droppable =
          dragging !== null &&
          productCards.find((c) => c.fg._id === dragging)?.status !== col;
        return (
          <section
            key={col}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}              onDrop={(e) => {
                e.preventDefault();
                handleDrop(col);
              }}
            className={cn(
              "flex min-h-56 flex-col rounded-2xl border bg-muted/30 shadow-sm transition-colors",
              droppable && "border-primary/50 bg-primary/[0.04] ring-2 ring-primary/20",
            )}
          >
            <header className="flex items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
              {col === PROJECT_STATUS_FINISH ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : col === PROJECT_STATUS_START ? (
                <Circle className="size-4 text-muted-foreground" />
              ) : (
                <GanttChartSquare className="size-4 text-sky-500" />
              )}
              <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                {col}
              </h3>
              <span className="ml-auto rounded-full bg-background px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground shadow-sm">
                {cards.length}
              </span>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              <AnimatePresence initial={false}>
                {cards.map((card) => {
                  const id = card.fg._id;
                  return (
                    <motion.div
                      key={id}
                      layout
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.18 }}
                      draggable
                      onDragStart={() => setDragging(id)}
                      onDragEnd={() => setDragging(null)}
                      className={cn(dragging === id && "opacity-40")}
                    >
                      <BoardCardView
                        card={card}
                        busyKey={busyKey}
                        onToggleFg={onToggleFg}
                        onOpen={onOpenFg}
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {cards.length === 0 && (
                <p className="rounded-xl border border-dashed px-3 py-6 text-center text-xs text-muted-foreground/70">
                  Drop cards here
                </p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

type ReportRow = {
  fg: FgDoc;
  jobName: string;
  projectName: string;
  status: string;
  dueAt?: number;
  finished: boolean;
  completedAt?: number;
  priority?: Priority;
};


/** The job a product belongs to, resolved from either jobId shape. */
function productJob(fg: FgDoc, allJobs: JobDoc[]): JobDoc | undefined {
  const ids = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
  return allJobs.find((j) => ids.includes(j._id));
}

/**
 * Production report: every flagged product counted as in production or
 * finished, rolled up per project, with the days left on each open item and
 * the days each finished item actually took.
 */
export function ProductionReport({
  data,
  allJobs,
  projectStatuses: configuredProjectStatuses,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  projectStatuses?: string[];
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = useMemo(
    () =>
      projectStatusesOrDefaults(
        configuredProjectStatuses ?? configuredStatusesQuery,
      ),
    [configuredProjectStatuses, configuredStatusesQuery],
  );

  const rows: ReportRow[] = useMemo(
    () =>
      data.fgs.map((fg) => {
        const job = productJob(fg, allJobs);
        const dueAt = fg.dueAt ?? job?.dueAt;
        const finished = fg.isCompleted === true;
        return {
          fg,
          jobName: job?.name ?? "Unassigned job",
          projectName: job ? data.projectNameOf(job) : (fg.projectName ?? "Standalone"),
          status: fgProjectStatus(fg, projectStatuses),
          dueAt,
          finished,
          completedAt: fg.completedAt,
          priority: fg.priority,
        };
      }),
    [data, allJobs, projectStatuses],
  );

  const inProduction = rows.filter((r) => !r.finished);
  const finished = rows.filter((r) => r.finished);
  const open = inProduction.filter((r) => r.dueAt !== undefined);
  const overdue = open.filter(
    (r) => daysLeftLabel(r.dueAt as number).overdue,
  );
  const dueSoon = open.filter((r) => {
    const days = daysLeftLabel(r.dueAt as number);
    return !days.overdue && (days.text === "Due today" || days.text === "Due tomorrow" || days.text.startsWith("Due in"));
  });
  const noDueDate = inProduction.filter((r) => r.dueAt === undefined);
  const pct = rows.length === 0 ? 0 : Math.round((finished.length / rows.length) * 100);

  /** Days a finished item took, from when it was flagged to completion. */
  const tookDays = (row: ReportRow) => {
    const start = row.fg.flaggedAt ?? row.fg._creationTime;
    if (row.completedAt === undefined) return null;
    return Math.max(0, Math.round((row.completedAt - start) / 86_400_000));
  };

  const byProject = useMemo(() => {
    const groups = new Map<string, ReportRow[]>();
    for (const row of rows) {
      const list = groups.get(row.projectName) ?? [];
      list.push(row);
      groups.set(row.projectName, list);
    }
    return [...groups.entries()]
      .map(([name, list]) => {
        const done = list.filter((r) => r.finished).length;
        const next = list
          .filter((r) => !r.finished && r.dueAt !== undefined)
          .sort((a, b) => (a.dueAt as number) - (b.dueAt as number))[0];
        return {
          name,
          total: list.length,
          open: list.length - done,
          done,
          late: list.filter((r) => !r.finished && r.dueAt !== undefined && daysLeftLabel(r.dueAt as number).overdue).length,
          nextDue: next?.dueAt,
          pct: list.length === 0 ? 0 : Math.round((done / list.length) * 100),
        };
      })
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [rows]);

  const byStatus = useMemo(() => {
    const out: { status: string; total: number; done: number }[] = [];
    for (const status of projectStatuses) {
      let total = 0;
      let done = 0;
      for (const row of rows) {
        if (row.status !== status) continue;
        total += 1;
        if (row.finished) done += 1;
      }
      if (total > 0) out.push({ status, total, done });
    }
    return out;
  }, [rows, projectStatuses]);

  const stat = (label: string, value: number, hint: string, tone: string) => (
    <div className="rounded-xl border bg-card p-3 shadow-sm">
      <p className="font-display text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs font-medium">{label}</p>
      <p className={cn("text-[11px]", tone)}>{hint}</p>
    </div>
  );

  const tableHead =
    "grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto]";

  return (
    <div className="space-y-4 p-4">
      {/* headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat("In production", inProduction.length, `${pct}% finished overall`, "text-muted-foreground")}
        {stat("Finished", finished.length, rows.length === 0 ? "Nothing yet" : `of ${rows.length} products`, "text-emerald-600 dark:text-emerald-400")}
        {stat(
          "Overdue",
          overdue.length,
          dueSoon.length > 0 ? `${dueSoon.length} due within a week` : "Nothing due this week",
          overdue.length > 0 ? "text-destructive" : "text-muted-foreground",
        )}
        {stat("No due date", noDueDate.length, "Set one to track it", "text-muted-foreground")}
      </div>

      {/* completion bar */}
      <section className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium">Production completion</span>
          <span className="tabular-nums text-muted-foreground">
            {finished.length} finished · {inProduction.length} in production · {pct}%
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-500/80 transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>
        {byStatus.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {byStatus.map((entry) => (
              <span
                key={entry.status}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
                  entry.status === PROJECT_STATUS_FINISH
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-sky-500/10 text-sky-700 dark:text-sky-400",
                )}
              >
                {entry.status} {entry.done}/{entry.total}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* per project rollup */}
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <p className="border-b border-border/60 px-4 py-2.5 text-sm font-semibold">By project</p>
        {byProject.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Flag a product to start tracking production.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {byProject.map((project) => (
              <li key={project.name} className="px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Folder className="size-3.5 shrink-0 text-sky-500/80" />
                  <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                  {project.late > 0 && (
                    <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                      {project.late} overdue
                    </span>
                  )}
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {project.done}/{project.total} finished
                  </span>
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {project.pct}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500/80"
                    style={{ width: `${project.pct}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {project.open} in production
                  {project.nextDue !== undefined &&
                    ` · next due ${formatDueLabel(project.nextDue)} (${daysLeftLabel(project.nextDue).text})`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* in production */}
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <p className="border-b border-border/60 px-4 py-2.5 text-sm font-semibold">
          In production ({inProduction.length})
        </p>
        {inProduction.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Everything flagged is finished.
          </p>
        ) : (
          <>
            <div className={tableHead}>
              <span>Product</span>
              <span className="hidden sm:block">Job</span>
              <span className="hidden sm:block">Project</span>
              <span className="text-right">Due</span>
              <span className="text-right">Days left</span>
            </div>
            <ul className="divide-y divide-border/70">
              {[...inProduction]
                .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
                .map((row) => (
                  <li
                    key={row.fg._id}
                    className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {row.fg.code && (
                        <span className="mr-1.5 font-mono text-[10px] text-muted-foreground/70">
                          {row.fg.code}
                        </span>
                      )}
                      {row.fg.name}
                    </span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:block">
                      {row.jobName}
                    </span>
                    <span className="hidden truncate text-xs text-muted-foreground sm:block">
                      {row.projectName}
                    </span>
                    <span className="text-right text-xs tabular-nums text-muted-foreground">
                      {row.dueAt !== undefined ? formatDueLabel(row.dueAt) : "—"}
                    </span>
                    <span className="text-right">
                      {row.dueAt === undefined ? (
                        <span className="text-[10px] text-muted-foreground/60">No due date</span>
                      ) : (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                            daysLeftLabel(row.dueAt).overdue
                              ? "bg-destructive/10 text-destructive"
                              : "bg-primary/10 text-primary",
                          )}
                        >
                          {daysLeftLabel(row.dueAt).text}
                        </span>
                      )}
                    </span>
                    <span className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-1 sm:hidden">
                      <span className={tagChip}>{row.status}</span>
                    </span>
                  </li>
                ))}
            </ul>
          </>
        )}
      </section>

      {/* finished */}
      <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <p className="border-b border-border/60 px-4 py-2.5 text-sm font-semibold">
          Finished ({finished.length})
        </p>
        {finished.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No products have reached the Finish status yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {[...finished]
              .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
              .map((row) => {
                const took = tookDays(row);
                return (
                  <li
                    key={row.fg._id}
                    className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm"
                  >
                    <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500/80" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {row.fg.code && (
                        <span className="mr-1.5 font-mono text-[10px] text-muted-foreground/70">
                          {row.fg.code}
                        </span>
                      )}
                      {row.fg.name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{row.jobName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{row.projectName}</span>
                    {row.completedAt !== undefined && (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatDueLabel(row.completedAt)}
                      </span>
                    )}
                    {took !== null && (
                      <span
                        className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-emerald-700 dark:text-emerald-400"
                        title="Days from being flagged to finished"
                      >
                        {took}d
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Detail-pane row: icon + label + content, like TaskDetail's rows. */
function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarDays;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 px-1 py-1.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

const chipBase =
  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";

/**
 * Right-side detail pane for a project, job or product — mirrors TaskDetail's
 * layout (header + rows). Projects list their jobs and products as links so the
 * whole Project → Job → Product hierarchy can be walked from here.
 */
export function FlaggedDetail({
  selection,
  jobs,
  fgs,
  projects,
  onClose,
  onSelect,
}: {
  selection: NonNullable<FlaggedSel>;
  jobs: JobDoc[];
  fgs: FgDoc[];
  projects: Doc<"projects">[];
  onClose: () => void;
  onSelect?: (sel: FlaggedSel) => void;
}) {
  const updateJobM = useMutation(api.jobs.updateJob);
  const updateFgM = useMutation(api.costing.updateFinishedGood);
  const updateProjectM = useMutation(api.costing.updateProject);
  const setJobProjectStatusM = useMutation(api.jobs.setJobProjectStatus);
  const setFgProjectStatusM = useMutation(api.costing.setFgProjectStatus);
  const setProjectProjectStatusM = useMutation(
    api.costing.setProjectProjectStatus,
  );
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(configuredStatusesQuery);
  const [busy, setBusy] = useState(false);

  // ── product task features (same as a normal task) ──────────────────
  const [fgAssignOpen, setFgAssignOpen] = useState(false);
  const peopleById = useMemo(
    () =>
      new Map((peopleQuery?.people ?? []).map((p) => [p.userId, p] as const)),
    [peopleQuery],
  );
  const groupsQuery = useQuery(api.userGroups.list);
  const groupsById = useMemo(
    () => new Map((groupsQuery ?? []).map((g) => [g._id, g] as const)),
    [groupsQuery],
  );
  const fgRightsQuery = useQuery(
    api.productTasks.myRights,
    fg === null ? "skip" : { id: fg._id },
  );
  const fgStepsQuery = useQuery(
    api.productTasks.listSteps,
    fg === null ? "skip" : { fgId: fg._id },
  );
  const addFgStepM = useMutation(api.productTasks.addStep);
  const toggleFgStepM = useMutation(api.productTasks.toggleStep);
  const removeFgStepM = useMutation(api.productTasks.removeStep);
  // the role still gates the panel; the product's own grant narrows it
  const fgRights = fgRightsQuery;
  const mayEditFg = fgRights?.canEdit ?? true;
  const mayCompleteFg = fgRights?.canComplete ?? true;
  const mayOptionsFg = fgRights?.canChangeOptions ?? true;
  const fgAssignees = useMemo(
    () => (fg === null ? [] : assigneesOfTask(fg, peopleById)),
    [fg, peopleById],
  );

  const selProject =
    selection.kind === "project"
      ? (projects.find((pp) => pp._id === selection.id) ?? null)
      : null;
  const job = selection.kind === "job" ? jobs.find((j) => j._id === selection.id) ?? null : null;
  const fg = selection.kind === "fg" ? fgs.find((f) => f._id === selection.id) ?? null : null;
  const parentJob =
    fg !== null
      ? (jobs.find(
          (j) =>
            (fg.jobIds ?? (fg.jobId ? [fg.jobId] : [])).includes(j._id),
        ) ?? null)
      : null;
  const project =
    job !== null
      ? (projects.find((pp) => pp._id === job.projectId) ?? null)
      : fg !== null
        ? (projects.find((pp) => pp.name === fg.projectName) ??
          (parentJob !== null
            ? projects.find((pp) => pp._id === parentJob.projectId) ?? null
            : null))
        : null;

  const childJobs = selProject !== null ? jobs.filter((j) => j.projectId === selProject._id) : [];
  const childFgs =
    selProject !== null
      ? fgs.filter((f) => {
          const jobIds = f.jobIds ?? (f.jobId ? [f.jobId] : []);
          return (
            f.projectName === selProject.name ||
            jobIds.some((jid) => childJobs.some((j) => j._id === jid))
          );
        })
      : [];

  if (job === null && fg === null && selProject === null) {
    return (
      <aside className="w-full shrink-0 border-border/60 lg:w-80 lg:border-l">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">Details</p>
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="px-4 py-6 text-sm text-muted-foreground">This item no longer exists.</p>
      </aside>
    );
  }

  const patchJob = async (patch: Record<string, unknown>) => {
    if (job === null) return;
    setBusy(true);
    try {
      await updateJobM({ id: job._id, ...patch } as never);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const patchFg = async (patch: Record<string, unknown>) => {
    if (fg === null) return;
    setBusy(true);
    try {
      await updateFgM({ id: fg._id, ...patch } as never);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const patchProject = async (patch: Record<string, unknown>) => {
    if (selProject === null) return;
    setBusy(true);
    try {
      await updateProjectM({ id: selProject._id, ...patch } as never);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const prioChip: Record<string, string> = {
    high: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
    medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    low: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  };

  return (
    <aside className="w-full shrink-0 border-border/60 lg:w-80 lg:border-l">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">
            {selProject !== null
              ? "Project details"
              : job !== null
                ? "Job details"
                : "Product details"}
          </p>
          <button
            type="button"
            aria-label="Close details"
            title="Close"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {selProject !== null ? (
            <>
              <input
                value={selProject.name}
                onChange={(e) => void patchProject({ name: e.target.value })}
                className="w-full bg-transparent text-[15px] font-medium outline-none"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                <Folder className="mr-1 inline size-3 text-sky-500/80" />
                Project
                {selProject.code ? ` · ${selProject.code}` : ""}
              </p>

              <div className="mt-4">
                <DetailRow icon={CalendarDays} label="Due date">
                  <input
                    type="datetime-local"
                    value={
                      selProject.dueAt !== undefined
                        ? toLocalInput(new Date(selProject.dueAt))
                        : ""
                    }
                    onChange={(e) =>
                      void patchProject({
                        dueAt: e.target.value
                          ? new Date(e.target.value).getTime()
                          : undefined,
                      })
                    }
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {selProject.dueAt !== undefined && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDueLabel(selProject.dueAt)} ·{" "}
                      <span
                        className={cn(
                          daysLeftLabel(selProject.dueAt).overdue
                            ? "text-destructive"
                            : "text-primary",
                        )}
                      >
                        {daysLeftLabel(selProject.dueAt).text}
                      </span>
                    </p>
                  )}
                </DetailRow>

                <DetailRow icon={Flag} label="Priority">
                  <div className="flex flex-wrap gap-1.5">
                    {(["high", "medium", "low"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        disabled={busy}
                        className={cn(
                          chipBase,
                          selProject.priority === p
                            ? `${prioChip[p]} border-transparent`
                            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        onClick={() =>
                          void patchProject({
                            priority:
                              selProject.priority === p ? undefined : p,
                          })
                        }
                      >
                        <span
                          className={cn(
                            "mr-1 inline-block size-1.5 rounded-full",
                            PRIORITY_META[p].dot,
                          )}
                        />
                        {p[0]!.toUpperCase() + p.slice(1)}
                      </button>
                    ))}
                  </div>
                </DetailRow>

                <DetailRow icon={Folder} label="Status">
                  <select
                    value={projectDocStatus(selProject, projectStatuses)}
                    onChange={(e) =>
                      void setProjectProjectStatusM({
                        id: selProject._id,
                        status: e.target.value,
                      })
                    }
                    disabled={busy}
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {projectStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </DetailRow>

                <DetailRow icon={Briefcase} label="Client">
                  <input
                    value={selProject.client ?? ""}
                    onChange={(e) => void patchProject({ client: e.target.value })}
                    placeholder="e.g. Acme Ltd"
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>

                <DetailRow icon={Star} label="Assignee">
                  <input
                    value={selProject.assignee ?? ""}
                    onChange={(e) =>
                      void patchProject({ assignee: e.target.value })
                    }
                    placeholder="Who is responsible?"
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>

                <DetailRow icon={History} label="Budget">
                  <input
                    type="number"
                    min={0}
                    value={selProject.budget ?? ""}
                    onChange={(e) =>
                      void patchProject({
                        budget:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                    placeholder="Planned budget"
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>

                <DetailRow icon={Briefcase} label={`Jobs (${childJobs.length})`}>
                  {childJobs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No jobs in this project yet.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {childJobs.map((j) => (
                        <li key={j._id}>
                          <button
                            type="button"
                            onClick={() =>
                              onSelect?.({ kind: "job", id: j._id })
                            }
                            className="flex w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                          >
                            <Briefcase className="size-3 shrink-0 text-sky-500/80" />
                            <span className="min-w-0 flex-1 truncate">
                              {j.name}
                            </span>
                            <span className={tagChip}>
                              {jobProjectStatus(j, projectStatuses)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </DetailRow>

                <DetailRow icon={Package} label={`Products (${childFgs.length})`}>
                  {childFgs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No products in this project yet.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {childFgs.map((f) => (
                        <li key={f._id}>
                          <button
                            type="button"
                            onClick={() => onSelect?.({ kind: "fg", id: f._id })}
                            className="flex w-full items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent"
                          >
                            <Package className="size-3 shrink-0 text-violet-500/80" />
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate",
                                f.isCompleted &&
                                  "text-muted-foreground line-through",
                              )}
                            >
                              {f.name}
                            </span>
                            <span className={tagChip}>
                              {fgProjectStatus(f, projectStatuses)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </DetailRow>

                <DetailRow icon={FileText} label="Notes">
                  <textarea
                    value={selProject.description ?? ""}
                    onChange={(e) =>
                      void patchProject({ description: e.target.value })
                    }
                    rows={3}
                    placeholder="Scope, deliverables, notes…"
                    className="w-full resize-y rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>
              </div>
            </>
          ) : job !== null ? (
            <>
              <input
                value={job.name}
                onChange={(e) => void patchJob({ name: e.target.value })}
                className="w-full bg-transparent text-[15px] font-medium outline-none"
              />
              {project && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => onSelect?.({ kind: "project", id: project._id })}
                    className="underline-offset-2 hover:text-foreground hover:underline"
                  >
                    <Folder className="mr-1 inline size-3 text-sky-500/80" />
                    {project.name}
                  </button>
                  {job.code ? ` · ${job.code}` : ""}
                </p>
              )}

              <div className="mt-4">
                <DetailRow icon={CalendarDays} label="Start date">
                  <p className="rounded-lg border bg-card px-2.5 py-1.5 text-sm">
                    {formatDueLabel(job.flaggedAt ?? job.startedAt ?? job._creationTime)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Date this job was added to Projects
                  </p>
                </DetailRow>

                <DetailRow icon={CalendarDays} label="Due date">
                  <input
                    type="datetime-local"
                    value={job.dueAt !== undefined ? toLocalInput(new Date(job.dueAt)) : ""}
                    onChange={(e) =>
                      void patchJob({
                        dueAt: e.target.value ? new Date(e.target.value).getTime() : undefined,
                      })
                    }
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {job.dueAt !== undefined && (
                    <p
                      className={cn(
                        "mt-1 text-xs",
                        daysLeftLabel(job.dueAt).overdue
                          ? "font-medium text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {formatDueLabel(job.dueAt)} ·{" "}
                      <span className="font-medium">{daysLeftLabel(job.dueAt).text}</span>
                    </p>
                  )}
                </DetailRow>

                <DetailRow icon={Flag} label="Priority">
                  <div className="flex flex-wrap gap-1.5">
                    {(["high", "medium", "low"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        disabled={busy}
                        className={cn(
                          chipBase,
                          job.priority === p
                            ? `${prioChip[p]} border-transparent`
                            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        onClick={() => void patchJob({ priority: job.priority === p ? undefined : p })}
                      >
                        <span className={cn("mr-1 inline-block size-1.5 rounded-full", PRIORITY_META[p].dot)} />
                        {p[0]!.toUpperCase() + p.slice(1)}
                      </button>
                    ))}
                  </div>
                </DetailRow>

                <DetailRow icon={Briefcase} label="Status">
                  <select
                    value={jobProjectStatus(job, projectStatuses)}
                    onChange={(e) => void setJobProjectStatusM({ id: job._id, status: e.target.value })}
                    disabled={busy}
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {projectStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </DetailRow>

                <DetailRow icon={FileText} label="Notes">
                  <textarea
                    value={job.description ?? ""}
                    onChange={(e) => void patchJob({ description: e.target.value })}
                    rows={3}
                    placeholder="Add notes…"
                    className="w-full resize-y rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>
              </div>
            </>
          ) : fg !== null ? (
            <>
              <input
                value={fg.name}
                onChange={(e) => void patchFg({ name: e.target.value })}
                className="w-full bg-transparent text-[15px] font-medium outline-none"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                <Package className="mr-1 inline size-3 text-violet-500/80" />
                {parentJob ? (
                  <>
                    {parentJob.name}
                    {parentJob.code ? ` · ${parentJob.code}` : ""}
                    {project ? ` — ${project.name}` : ""}
                  </>
                ) : (
                  "Standalone product"
                )}
                {fg.code ? ` · ${fg.code}` : ""}
              </p>

              <div className="mt-4">
                <DetailRow icon={CalendarDays} label="Start date">
                  <p className="rounded-lg border bg-card px-2.5 py-1.5 text-sm">
                    {formatDueLabel(fg.flaggedAt ?? fg._creationTime)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Date this product was added to Projects
                  </p>
                </DetailRow>

                <DetailRow icon={CalendarDays} label="Due date">
                  <input
                    type="datetime-local"
                    value={fg.dueAt !== undefined ? toLocalInput(new Date(fg.dueAt)) : ""}
                    onChange={(e) =>
                      void patchFg({
                        dueAt: e.target.value ? new Date(e.target.value).getTime() : undefined,
                      })
                    }
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {parentJob?.dueAt !== undefined && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Job due: {formatDueLabel(parentJob.dueAt)}
                    </p>
                  )}
                </DetailRow>

                <DetailRow icon={Flag} label="Priority">
                  <div className="flex flex-wrap gap-1.5">
                    {(["high", "medium", "low"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        disabled={busy}
                        className={cn(
                          chipBase,
                          fg.priority === p
                            ? `${prioChip[p]} border-transparent`
                            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        onClick={() => void patchFg({ priority: fg.priority === p ? undefined : p })}
                      >
                        <span className={cn("mr-1 inline-block size-1.5 rounded-full", PRIORITY_META[p].dot)} />
                        {p[0]!.toUpperCase() + p.slice(1)}
                      </button>
                    ))}
                  </div>
                </DetailRow>

                <DetailRow icon={Flag} label="Status">
                  <select
                    value={fgProjectStatus(fg, projectStatuses)}
                    onChange={(e) => void setFgProjectStatusM({ id: fg._id, status: e.target.value })}
                    disabled={busy}
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {projectStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </DetailRow>

                <DetailRow icon={Tag} label="Unit">
                  <input
                    value={fg.unit ?? ""}
                    onChange={(e) => void patchFg({ unit: e.target.value })}
                    placeholder="e.g. pcs"
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>

                <DetailRow icon={FileText} label="Note">
                  <textarea
                    value={fg.note ?? ""}
                    onChange={(e) => void patchFg({ note: e.target.value })}
                    rows={3}
                    placeholder="Add a note…"
                    className="w-full resize-y rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
