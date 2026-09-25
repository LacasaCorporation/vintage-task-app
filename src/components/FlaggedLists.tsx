import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/checkbox";
import type { Priority } from "@/lib/task-utils";
import { formatDueLabel } from "@/lib/task-utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Circle,
  Flag,
  Folder,
  GanttChartSquare,
  GripVertical,
  Package,
} from "lucide-react";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
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

export type FlagStatusFilter = "all" | string;
export type ProjectStatus = string;

/** Which item's detail pane is open (project, job or product). */
export type FlaggedSel =
  | { kind: "project"; id: Id<"projects"> }
  | { kind: "job"; id: Id<"projectJobs"> }
  | { kind: "fg"; id: Id<"finishedGoods"> }
  | null;

/** Flagged jobs & products (from the Projects section) with their labels. */
export type FlaggedData = {
  jobs: JobDoc[];
  fgs: FgDoc[];
  projects: Doc<"projects">[];
  projectNameOf: (job: JobDoc) => string;
};

/** Wider chip shared by the flagged-view filter bar and cards. */
export const tagChip =
  "shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground";

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

export function projectDocStatus(project: Doc<"projects">, statuses: string[]): ProjectStatus {
  if (project.projectStatus && statuses.includes(project.projectStatus))
    return project.projectStatus;
  if (project.status === "completed" || project.status === "cancelled")
    return PROJECT_STATUS_FINISH;
  if (project.status === "in_progress" || project.status === "on_hold")
    return statuses[1] ?? PROJECT_STATUS_START;
  return PROJECT_STATUS_START;
}

/** Shared completion-status predicate for the flagged-view filters. */
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

/** Days left until a due date: "Due in 3d" / "Due today" / "2d overdue". */
export function daysLeftLabel(ts: number): { text: string; overdue: boolean } {
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const d = new Date(ts);
  const startOfDue = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDue - startOfToday) / 86_400_000);
  if (days === 0) return { text: "Due today", overdue: false };
  if (days === 1) return { text: "Due tomorrow", overdue: false };
  if (days > 1) return { text: `Due in ${days}d`, overdue: false };
  return { text: `${Math.abs(days)}d overdue`, overdue: true };
}
/**
 * Job rows of the Projects workspace. With `jobsOnly` the jobs are listed flat
 * (one row per job — no project grouping, no product subtasks): the Jobs
 * button. Without it the jobs keep their project hierarchy with their products
 * as subtasks, and flagged products without a flagged job are listed too.
 */
export function FlaggedItemsList({
  data,
  allJobs,
  allFgs,
  showTags = false,
  statusFilter = "all",
  projectStatuses: configuredProjectStatuses,
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
  const visibleJobs = sortJobs(data.jobs, sortMode).filter((job) =>
    matchesStatusFilter(
      statusFilter ?? "all",
      jobProjectStatus(job, projectStatuses),
      job.status === "completed",
    ),
  );

  if (jobsOnly && visibleJobs.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <Briefcase className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">
          {statusFilter === "all" ? "No jobs yet" : "No jobs in this status"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {statusFilter === "all"
            ? "Create a job under a project and flag it to see it here."
            : "Choose another status filter to see more jobs."}
        </p>
      </div>
    );
  }

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
              !jobsOnly && !isFirstJobForProject && projectCollapsed && "hidden",
              selection?.kind === "job" && selection.id === job._id && "bg-primary/[0.04]",
            )}
          >
            {!jobsOnly && isFirstJobForProject && (
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
                "flex flex-wrap items-center gap-2",
                !jobsOnly && "ml-4 border-l border-border/60 pl-3",
                !jobsOnly && projectCollapsed && "hidden",
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
              {job.dueAt !== undefined && (
                <>
                  <span
                    className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
                    title={`Due ${formatDueLabel(job.dueAt)}`}
                  >
                    {formatDueLabel(job.dueAt)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                      daysLeftLabel(job.dueAt).overdue
                        ? "bg-destructive/10 text-destructive"
                        : "bg-primary/10 text-primary",
                    )}
                    title="Time left to complete this job"
                  >
                    {daysLeftLabel(job.dueAt).text}
                  </span>
                </>
              )}
              <span className={tagChip}>{data.projectNameOf(job)}</span>
              <span className={tagChip}>{jobProjectStatus(job, projectStatuses)}</span>
            </div>
            {!jobsOnly && jobProducts.length > 0 && (
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
                    {fg.dueAt !== undefined && (
                      <>
                        <span
                          className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
                          title={`Due ${formatDueLabel(fg.dueAt)}`}
                        >
                          {formatDueLabel(fg.dueAt)}
                        </span>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                            daysLeftLabel(fg.dueAt).overdue
                              ? "bg-destructive/10 text-destructive"
                              : "bg-primary/10 text-primary",
                          )}
                          title="Time left to complete this product"
                        >
                          {daysLeftLabel(fg.dueAt).text}
                        </span>
                      </>
                    )}
                    {showTags && (
                      <>
                        <span className={tagChip}>{data.projectNameOf(job)}</span>
                        <span className={tagChip}>{job.name}</span>
                      </>
                    )}
                    <span className={tagChip}>{fgProjectStatus(fg, projectStatuses ?? [...DEFAULT_PROJECT_STATUSES])}</span>
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
                {fg.dueAt !== undefined && (
                  <>
                    <span
                      className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
                      title={`Due ${formatDueLabel(fg.dueAt)}`}
                    >
                      {formatDueLabel(fg.dueAt)}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                        daysLeftLabel(fg.dueAt).overdue
                          ? "bg-destructive/10 text-destructive"
                          : "bg-primary/10 text-primary",
                      )}
                      title="Time left to complete this product"
                    >
                      {daysLeftLabel(fg.dueAt).text}
                    </span>
                  </>
                )}
              </div>
            </li>
          );
        })}
    </ul>
  );
}
/**
 * Projects list (the Projects button) — one row per project with its status,
 * priority, due date and days left, plus how many jobs it holds and how many
 * of its products are done. Clicking a row opens the project details.
 */
export function FlaggedProjectsList({
  data,
  allJobs,
  allFgs,
  statusFilter = "all",
  projectStatuses: configuredProjectStatuses,
  sortMode = "manual",
  selection,
  onSelect,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  allFgs: FgDoc[];
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
  const statuses = projectStatuses ?? [...DEFAULT_PROJECT_STATUSES];
  const rows = data.projects
    .filter((project) =>
      matchesStatusFilter(
        statusFilter,
        projectDocStatus(project, statuses),
        project.status === "completed",
      ),
    )
    .map((project) => {
      const jobs = allJobs.filter((j) => j.projectId === project._id);
      const products = allFgs.filter(
        (f) =>
          f.projectName === project.name ||
          jobs.some(
            (j) => f.jobId === j._id || (f.jobIds ?? []).includes(j._id),
          ),
      );
      return { project, jobs, products };
    });
  const sorted =
    sortMode === "due"
      ? [...rows].sort(
          (a, b) => (a.project.dueAt ?? Infinity) - (b.project.dueAt ?? Infinity),
        )
      : sortMode === "priority"
        ? [...rows].sort(
            (a, b) =>
              PRIORITY_RANK[a.project.priority ?? "low"] -
              PRIORITY_RANK[b.project.priority ?? "low"],
          )
        : sortMode === "created"
          ? [...rows].sort(
              (a, b) => b.project._creationTime - a.project._creationTime,
            )
          : rows;

  if (sorted.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <Folder className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">
          {statusFilter === "all" ? "No projects yet" : "No projects in this status"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {statusFilter === "all"
            ? "Create a project first, then add jobs and products under it."
            : "Choose another status filter to see more projects."}
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border/70">
      {sorted.map(({ project, jobs, products }) => {
        const status = projectDocStatus(project, statuses);
        const done = status === PROJECT_STATUS_FINISH;
        const doneProducts = products.filter((f) => f.isCompleted).length;
        return (
          <li
            key={project._id}
            className={cn(
              "transition-colors hover:bg-accent/40",
              done && "opacity-60",
              selection?.kind === "project" &&
                selection.id === project._id &&
                "bg-primary/[0.04]",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect?.({ kind: "project", id: project._id })}
              className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left text-sm"
              title="Open project details"
            >
              <Folder className="size-3.5 shrink-0 text-sky-500/80" />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-medium",
                  done && "text-muted-foreground line-through",
                )}
              >
                {project.name}
              </span>
              {project.code && (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {project.code}
                </span>
              )}
              <span className={tagChip}>{status}</span>
              {project.priority && (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                    PRIORITY_META[project.priority].chip,
                  )}
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      PRIORITY_META[project.priority].dot,
                    )}
                  />
                  {project.priority}
                </span>
              )}
              {project.dueAt !== undefined && (
                <>
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {formatDueLabel(project.dueAt)}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                      daysLeftLabel(project.dueAt).overdue
                        ? "bg-destructive/10 text-destructive"
                        : "bg-primary/10 text-primary",
                    )}
                    title="Time left to complete this project"
                  >
                    {daysLeftLabel(project.dueAt).text}
                  </span>
                </>
              )}
              <span
                className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
                title="Jobs in this project"
              >
                {jobs.length} job{jobs.length === 1 ? "" : "s"}
              </span>
              {products.length > 0 && (
                <span
                  className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary"
                  title="Products completed in this project"
                >
                  {doneProducts}/{products.length} products
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
/**
 * Products list (the Products button) — one flat row per flagged product; its
 * job and project are tags on the row, and the kanban board is its other
 * presentation.
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
          {showTags && parentJob && <span className={tagChip}>{data.projectNameOf(parentJob)}</span>}
          {fg.dueAt !== undefined && (
            <>
              <span
                className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground"
                title={`Due ${formatDueLabel(fg.dueAt)}`}
              >
                {formatDueLabel(fg.dueAt)}
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                  daysLeftLabel(fg.dueAt).overdue
                    ? "bg-destructive/10 text-destructive"
                    : "bg-primary/10 text-primary",
                )}
                title="Time left to complete this product"
              >
                {daysLeftLabel(fg.dueAt).text}
              </span>
            </>
          )}
          <span className={tagChip}>{fgProjectStatus(fg, projectStatuses ?? [...DEFAULT_PROJECT_STATUSES])}</span>
        </li>
      ))}
    </ul>
  );
}
/** Kanban columns for flagged products. The first and last statuses are fixed. */
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
              (card.fg.dueAt ?? 0) < Date.now() && !done
                ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            <CalendarDays className="size-2.5" />
            {formatDueLabel(card.fg.dueAt)}
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
      </div>
    </motion.div>
  );
}

/**
 * Drag & drop kanban of the flagged products: one column per custom Projects
 * status, from Start to Finish. Dropping a card on a column sets the product
 * status. Only the Products button shows this board.
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






