import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/checkbox";
import StatusSelect from "@/components/StatusSelect";
import {
  Briefcase,
  ChevronDown,
  Flag,
  Folder,
  Package,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  middleProjectStatuses,
  PROJECT_STATUS_FINISH,
  projectStatusesOrDefaults,
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

/** Which entity the workspace is currently zoomed in on. */
export type WorkspaceView = "list" | "hierarchy" | "board" | "report";

/** The view buttons offered for each level filter. */
export const VIEWS_BY_FILTER: Record<string, { view: WorkspaceView; label: string; icon: string }[]> = {
  projects: [
    { view: "list", label: "Project list", icon: "list" },
    { view: "hierarchy", label: "Project hierarchy", icon: "tree" },
  ],
  jobs: [
    { view: "list", label: "Job list", icon: "list" },
    { view: "hierarchy", label: "Job hierarchy", icon: "tree" },
  ],
  products: [
    { view: "list", label: "Product list", icon: "list" },
    { view: "board", label: "Board view", icon: "board" },
    { view: "report", label: "Production report", icon: "report" },
  ],
};

/** Which view a level filter falls back to when the current one isn't offered. */
export const DEFAULT_VIEW_BY_FILTER: Record<string, WorkspaceView> = {
  projects: "list",
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
                  "min-w-0 flex-1 cursor-pointer truncate text-left",
                  fg.isCompleted && "text-muted-foreground line-through",
                )}
              >
                {fg.name}
              </button>
              <Package className="size-3 shrink-0 text-sky-500/70" />
              {fg.code && (
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                  {fg.code}
                </span>
              )}
              <DueChips
                dueAt={fg.dueAt ?? job.dueAt}
                inherited={fg.dueAt === undefined && job.dueAt !== undefined}
              />
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
              <ProductionButton fg={fg} hideStatusPill />
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

  const rows = sortJobs(allJobs, sortMode).filter((job) =>
    matchesStatusFilter(
      statusFilter ?? "all",
      jobProjectStatus(job, projectStatuses),
      job.status === "completed",
    ),
  );

  if (rows.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <Briefcase className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">
          {statusFilter === "all" ? "No jobs yet" : "No jobs in this status"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {statusFilter === "all"
            ? "Flag a job in the Projects page and it will show up here."
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
