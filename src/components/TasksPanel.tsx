import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import TaskDetail from "@/components/TaskDetail";
import {
  FlaggedBoard,
  FlaggedItemsList,
  FlaggedProductsList,
  FlaggedProjectsList,
  PRIORITY_META,
  PRIORITY_RANK,
  daysLeftLabel,
  fgProjectStatus,
  jobProjectStatus,
  projectDocStatus,
  tagChip,
  type FgDoc,
  type FlagStatusFilter,
  type FlaggedData,
  type FlaggedSel,
  type JobDoc,
  type SortMode,
} from "@/components/FlaggedLists";
import type { ActiveTaskView } from "@/components/TasksSidebar";
import type { TaskDoc, Priority } from "@/lib/task-utils";
import {
  RECURRENCE_LABEL,
  ageDaysLabel,
  formatCreatedLabel,
  formatDueLabel,
  isDueToday,
  isOverdue,
  parseAttachments,
  parseQuickAdd,
  toLocalInput,
} from "@/lib/task-utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlarmClock,
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Clock,
  Columns3,
  FileText,
  Flag,
  Folder,
  History,
  Inbox,
  List,
  Loader2,
  Package,
  Paperclip,
  Plus,
  Repeat,
  Settings2,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PROJECT_STATUSES,
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
  projectStatusesOrDefaults,
} from "@/lib/project-statuses";

type ListId = Id<"taskLists">;

/**
 * Projects workspace filter — one button per level of the hierarchy:
 * "projects" = every project, "jobs" = flagged job rows, "products" = flagged
 * product rows. `status` narrows by completion state.
 */
type FlagFilter = "projects" | "jobs" | "products";

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
 * Right-side detail pane for a flagged job or product — mirrors TaskDetail's
 * layout (header + rows). Products show their parent job & project and an
 * editable due date/priority that default to the parent job's values.
 */
function FlaggedDetail({
  selection,
  jobs,
  fgs,
  projects,
  onSelect,
  onClose,
}: {
  selection: NonNullable<FlaggedSel>;
  jobs: JobDoc[];
  fgs: FgDoc[];
  projects: Doc<"projects">[];
  onSelect: (sel: FlaggedSel) => void;
  onClose: () => void;
}) {
  const updateJobM = useMutation(api.jobs.updateJob);
  const updateFgM = useMutation(api.costing.updateFinishedGood);
  const updateProjectM = useMutation(api.costing.updateProject);
  const setProjectProjectStatusM = useMutation(
    api.costing.setProjectProjectStatus,
  );
  const setJobProjectStatusM = useMutation(api.jobs.setJobProjectStatus);
  const setFgProjectStatusM = useMutation(api.costing.setFgProjectStatus);
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(configuredStatusesQuery);
  const [busy, setBusy] = useState(false);

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
    selection.kind === "project"
      ? (projects.find((pp) => pp._id === selection.id) ?? null)
      : job !== null
        ? (projects.find((pp) => pp._id === job.projectId) ?? null)
        : fg !== null
          ? (projects.find((pp) => pp.name === fg.projectName) ??
            (parentJob !== null
              ? projects.find((pp) => pp._id === parentJob.projectId) ?? null
              : null))
          : null;

  if (job === null && fg === null && project === null) {
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
    if (project === null) return;
    setBusy(true);
    try {
      await updateProjectM({ id: project._id, ...patch } as never);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  const projectJobs = project !== null ? jobs.filter((j) => j.projectId === project._id) : [];
  const projectFgs =
    project !== null
      ? fgs.filter(
          (f) =>
            f.projectName === project.name ||
            projectJobs.some(
              (j) => f.jobId === j._id || (f.jobIds ?? []).includes(j._id),
            ),
        )
      : [];

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
            {selection.kind === "project"
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
          {selection.kind === "project" && project !== null ? (
            <>
              <input
                value={project.name}
                onChange={(e) => void patchProject({ name: e.target.value })}
                className="w-full bg-transparent text-[15px] font-medium outline-none"
              />
              {project.code && (
                <p className="mt-1 text-xs text-muted-foreground">
                  <Folder className="mr-1 inline size-3 text-sky-500/80" />
                  {project.code}
                </p>
              )}

              <div className="mt-4">
                <DetailRow icon={CalendarDays} label="Start date">
                  <p className="rounded-lg border bg-card px-2.5 py-1.5 text-sm">
                    {formatDueLabel(project._creationTime)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Date this project was created
                  </p>
                </DetailRow>

                <DetailRow icon={CalendarDays} label="Due date">
                  <input
                    type="datetime-local"
                    value={project.dueAt !== undefined ? toLocalInput(new Date(project.dueAt)) : ""}
                    onChange={(e) =>
                      void patchProject({
                        dueAt: e.target.value ? new Date(e.target.value).getTime() : undefined,
                      })
                    }
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  {project.dueAt !== undefined && (
                    <p
                      className={cn(
                        "mt-1 text-[11px]",
                        daysLeftLabel(project.dueAt).overdue
                          ? "text-destructive"
                          : "text-muted-foreground",
                      )}
                    >
                      {daysLeftLabel(project.dueAt).text}
                    </p>
                  )}
                </DetailRow>

                <DetailRow icon={Briefcase} label="Status">
                  <select
                    value={projectDocStatus(project, projectStatuses)}
                    onChange={(e) =>
                      void setProjectProjectStatusM({
                        id: project._id,
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

                <DetailRow icon={Flag} label="Priority">
                  <div className="flex flex-wrap gap-1.5">
                    {(["high", "medium", "low"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        disabled={busy}
                        className={cn(
                          chipBase,
                          project.priority === p
                            ? `${prioChip[p]} border-transparent`
                            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                        onClick={() =>
                          void patchProject({
                            priority: project.priority === p ? undefined : p,
                          })
                        }
                      >
                        <span className={cn("mr-1 inline-block size-1.5 rounded-full", PRIORITY_META[p].dot)} />
                        {p[0]!.toUpperCase() + p.slice(1)}
                      </button>
                    ))}
                  </div>
                </DetailRow>

                <DetailRow icon={Briefcase} label="Client">
                  <input
                    value={project.client ?? ""}
                    onChange={(e) => void patchProject({ client: e.target.value })}
                    placeholder="Customer or stakeholder"
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>

                <DetailRow icon={Flag} label="Assignee">
                  <input
                    value={project.assignee ?? ""}
                    onChange={(e) => void patchProject({ assignee: e.target.value })}
                    placeholder="Person responsible"
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>

                <DetailRow icon={Tag} label="Budget">
                  <input
                    type="number"
                    value={project.budget ?? ""}
                    onChange={(e) =>
                      void patchProject({
                        budget: e.target.value ? Number(e.target.value) : undefined,
                      })
                    }
                    placeholder="0.00"
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>

                <DetailRow icon={FileText} label="Notes">
                  <textarea
                    value={project.description ?? ""}
                    onChange={(e) => void patchProject({ description: e.target.value })}
                    rows={3}
                    placeholder="Add notes…"
                    className="w-full resize-y rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </DetailRow>

                <DetailRow icon={Briefcase} label={`Jobs (${projectJobs.length})`}>
                  {projectJobs.length === 0 ? (
                    <p className="rounded-lg border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
                      No jobs in this project yet.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {projectJobs.map((j) => (
                        <li key={j._id}>
                          <button
                            type="button"
                            onClick={() => onSelect({ kind: "job", id: j._id })}
                            className="flex w-full flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                          >
                            <Briefcase className="size-3 shrink-0 text-sky-500/80" />
                            <span className="min-w-0 flex-1 truncate font-medium">
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

                <DetailRow icon={Package} label={`Products (${projectFgs.length})`}>
                  {projectFgs.length === 0 ? (
                    <p className="rounded-lg border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
                      No products in this project yet.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {projectFgs.map((f) => (
                        <li key={f._id}>
                          <button
                            type="button"
                            onClick={() => onSelect({ kind: "fg", id: f._id })}
                            className="flex w-full flex-wrap items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                          >
                            <Package className="size-3 shrink-0 text-violet-500/80" />
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate font-medium",
                                f.isCompleted && "text-muted-foreground line-through",
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
                  <Briefcase className="mr-1 inline size-3 text-sky-500/80" />
                  {project.name}
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDueLabel(job.dueAt)}
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

export default function TasksPanel({
  activeView,
  lists,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  canCreateSteps = true,
  canEditSteps = true,
  canDeleteSteps = true,
  taskScope,
  onScopeChange,
}: {
  activeView: ActiveTaskView;
  lists: { _id: ListId; name: string }[];
  onSelectView: (view: ActiveTaskView) => void;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Subtasks & attachments item permissions. */
  canCreateSteps?: boolean;
  canEditSteps?: boolean;
  canDeleteSteps?: boolean;
  /** Mine / ALL scope filter value shared with the sidebar. */
  taskScope: "mine" | "all";
  onScopeChange: (scope: "mine" | "all") => void;
}) {
  // Mine / ALL filter shown above the task list ("mine" is the default).
  const allTasks = useQuery(api.tasks.list, { scope: taskScope });
  const allPages = useQuery(api.notebooks.listAllPages, { scope: taskScope });
  const addTask = useMutation(api.tasks.add);
  const toggleTask = useMutation(api.tasks.toggle);
  const removeTask = useMutation(api.tasks.remove);
  const updateTask = useMutation(api.tasks.update);

  // flagged jobs & products (from the Projects section) for the Flagged view
  const flaggedJobs = useQuery(api.jobs.listJobs);
  const flaggedFgs = useQuery(api.costing.listFinishedGoods);
  const flaggedProjects = useQuery(api.costing.listProjects);
  const setFgCompletedM = useMutation(api.costing.setFgCompleted);
  const setFgProjectStatusM = useMutation(api.costing.setFgProjectStatus);
  const setJobProjectStatusM = useMutation(api.jobs.setJobProjectStatus);
  const updateJobM = useMutation(api.jobs.updateJob);
  const projectStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const setProjectStatusesM = useMutation(api.settings.setProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(projectStatusesQuery);
  const [flaggedBusy, setFlaggedBusy] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<Id<"tasks"> | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("manual");

  // Projects workspace: which level of the hierarchy is shown (projects /
  // jobs / products), the completion filter and list-vs-board presentation.
  const [flagFilter, setFlagFilter] = useState<FlagFilter>("projects");
  const [flagSelection, setFlagSelection] = useState<FlaggedSel>(null);
  const [flagStatus, setFlagStatus] = useState<FlagStatusFilter>("all");
  const [flagBoardMode, setFlagBoardMode] = useState(false);
  const [statusSettingsOpen, setStatusSettingsOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState<string[] | null>(null);

  // Projects should always open as a list when selected from the sidebar.
  useEffect(() => {
    if (activeView === "flagged") setFlagBoardMode(false);
  }, [activeView]);

  // ── reminder notifications (in-app while the app is open) ──────────
  useEffect(() => {
    if (!allTasks) return;
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const now = Date.now();
      for (const t of allTasks) {
        if (
          t.remindAt !== undefined &&
          !t.isCompleted &&
          now >= t.remindAt &&
          now - t.remindAt < 60_000 &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          new Notification("Task reminder", { body: t.text });
        }
      }
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [allTasks]);

  // ── filtering by the active sidebar view ───────────────────────────
  const viewLabel =
    activeView === "today"
      ? "Today"
      : activeView === "starred"
        ? "Starred"
        : activeView === "flagged"
          ? "Projects"
          : activeView
            ? (lists.find((l) => l._id === activeView)?.name ?? "List")
            : "All tasks";

  const tasks = useMemo(() => {
    let out: TaskDoc[] = allTasks ?? [];
    if (activeView === "today") {
      out = out.filter((t) => isDueToday(t) || isOverdue(t));
    } else if (activeView === "starred") {
      out = out.filter((t) => t.starred);
    } else if (activeView) {
      out = out.filter((t) => t.listId === activeView);
    }
    if (!showDone) out = out.filter((t) => !t.isCompleted);
    const sorted = [...out];
    if (sortMode === "due") {
      sorted.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    } else if (sortMode === "priority") {
      sorted.sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority ?? "low"] - PRIORITY_RANK[b.priority ?? "low"]) ||
          (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity),
      );
    } else if (sortMode === "created") {
      sorted.sort((a, b) => b._creationTime - a._creationTime);
    }
    return sorted;
  }, [allTasks, activeView, showDone, sortMode]);

  const doneCount = useMemo(
    () =>
      (allTasks ?? []).filter((t) => {
        if (!t.isCompleted) return false;
        if (activeView === "today") return isDueToday(t) || isOverdue(t);
        if (activeView === "starred") return t.starred;
        if (activeView) return t.listId === activeView;
        return true;
      }).length,
    [allTasks, activeView],
  );

  const activeList = lists.find((l) => l._id === activeView) ?? null;

  /** Flagged jobs (with their project) and flagged products. */
  const flaggedItems = useMemo<FlaggedData | null>(() => {
    const jobs = (flaggedJobs ?? []).filter((j) => j.isFlagged);
    const fgs = (flaggedFgs ?? []).filter((f) => f.isFlagged);
    if (jobs.length === 0 && fgs.length === 0) return null;
    const projectNameOf = (job: JobDoc): string => {
      const project = (flaggedProjects ?? []).find((p) => p._id === job.projectId);
      return project?.name ?? "Project";
    };
    return { jobs, fgs, projects: flaggedProjects ?? [], projectNameOf };
  }, [flaggedJobs, flaggedFgs, flaggedProjects]);

  /** Projects are never flagged, so their list works with nothing flagged yet. */
  const projectListData = useMemo<FlaggedData>(
    () =>
      flaggedItems ?? {
        jobs: [],
        fgs: [],
        projects: flaggedProjects ?? [],
        projectNameOf: (job: JobDoc) =>
          (flaggedProjects ?? []).find((p) => p._id === job.projectId)?.name ?? "Project",
      },
    [flaggedItems, flaggedProjects],
  );

  const handleAdd = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = draft.trim();
    if (!raw || isAdding) return;
    const { text, tags } = parseQuickAdd(raw);
    if (!text) return;
    setIsAdding(true);
    try {
      await addTask({
        text,
        tags: tags.length > 0 ? tags : undefined,
        listId:
          typeof activeView === "string" &&
          activeView !== "today" &&
          activeView !== "starred" &&
          activeView !== "flagged"
            ? (activeView as ListId)
            : undefined,
      });
      setDraft("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add that task.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleToggle = async (id: Id<"tasks">) => {
    try {
      await toggleTask({ id });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update that task.");
    }
  };

  const saveProjectStatuses = async () => {
    if (statusDraft === null) return;
    try {
      await setProjectStatusesM({ statuses: statusDraft });
      setStatusDraft(null);
      setStatusSettingsOpen(false);
      toast.success("Projects statuses updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update statuses.");
    }
  };

  const handleToggleFlaggedFg = async (fg: FgDoc) => {
    setFlaggedBusy(`f:${fg._id}`);
    try {
      await setFgCompletedM({ id: fg._id, completed: !fg.isCompleted });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the product.");
    } finally {
      setFlaggedBusy(null);
    }
  };

  /**
   * Mark a flagged job as done — only possible when every flagged product
   * under it is completed. Completing the job flips its status to completed
   * (its flag shows green in the project list); unchecking reopens it.
   */
  const handleToggleFlaggedJob = async (job: JobDoc) => {
    const products = (flaggedFgs ?? []).filter(
      (f) => f.jobId === job._id || (f.jobIds ?? []).includes(job._id),
    );
    const allDone = products.length > 0 && products.every((f) => f.isCompleted);
    if (!allDone) return;
    setFlaggedBusy(`j:${job._id}`);
    try {
      await setJobProjectStatusM({
        id: job._id,
        status: jobProjectStatus(job, projectStatuses) === PROJECT_STATUS_FINISH
          ? PROJECT_STATUS_START
          : PROJECT_STATUS_FINISH,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the job.");
    } finally {
      setFlaggedBusy(null);
    }
  };

  const handleDelete = async (id: Id<"tasks">) => {
    try {
      await removeTask({ id });
      if (openTaskId === id) setOpenTaskId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete that task.");
    }
  };

  const askNotificationPermission = () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  };

  const openTask = openTaskId ? (allTasks ?? []).find((t) => t._id === openTaskId) ?? null : null;

  /** Title of the note page a task was flagged from. */
  const sourcePageTitle = (pageId: Id<"notePages">): string => {
    const page = (allPages ?? []).find((p) => p._id === pageId);
    if (!page) return "From note";
    const title = page.title.trim();
    return title || "Untitled page";
  };

  return (
    <div>
      {/* ── Stats ───────────────────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-3">
        {[
          {
            label: viewLabel,
            value:
              activeView === "flagged"
                ? flagFilter === "projects"
                  ? (flaggedProjects?.length ?? 0)
                  : flagFilter === "jobs"
                    ? (flaggedItems?.jobs.length ?? 0)
                    : (flaggedItems?.fgs.length ?? 0)
                : tasks.length,
          },
          { label: "Completed", value: doneCount },
          { label: "Open", value: tasks.length },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border bg-card p-4 text-center shadow-sm">
            <p className="font-display text-2xl font-semibold tabular-nums">{stat.value}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </section>

      {/* ── Add a task ─────────────────────────────────────────── */}
      {canCreate ? (
        <form onSubmit={handleAdd} className="mt-4 flex gap-2" onFocus={askNotificationPermission}>
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={280}
            placeholder={
              activeList
                ? `Add to “${activeList.name}”… use #tag for labels`
                : "Add a task… #work for tags, “tomorrow 3pm” to schedule later"
            }
            aria-label="New task"
            className="h-11 flex-1 rounded-xl bg-card shadow-sm placeholder:text-muted-foreground/70"
          />
          <Button
            type="submit"
            disabled={!draft.trim() || isAdding}
            className="h-11 rounded-xl px-5 shadow-sm"
          >
            {isAdding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Add task
          </Button>
        </form>
      ) : (
        <p className="mt-4 rounded-xl border border-dashed bg-card px-4 py-3 text-center text-sm text-muted-foreground">
          You can view tasks, but creating new ones isn't allowed for your role.
        </p>
      )}

      {/* ── Scope / sort / filter controls ───────────────────────────── */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="mr-1">Show</span>
          {(
            [
              ["mine", "Mine"],
              ["all", "ALL"],
            ] as ["mine" | "all", string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onScopeChange(mode)}
              className={cn(
                "rounded-full border px-2.5 py-1 transition-colors",
                taskScope === mode
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-accent hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <span className="mr-1">Sort</span>
          {(
            [
              ["manual", "Custom"],
              ["due", "Due date"],
              ["priority", "Priority"],
              ["created", "Newest"],
            ] as [SortMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSortMode(mode)}
              className={cn(
                "rounded-full border px-2.5 py-1 transition-colors",
                sortMode === mode
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-card hover:bg-accent hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-colors",
            showDone
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {showDone ? "Hiding nothing" : "Show completed"}
        </button>
      </div>

      {/* ── Flagged jobs & products (from Projects) ─────────────────── */}
      {activeView === "flagged" && (
        <div className="grid items-start lg:grid-cols-[1fr_auto]">
        <section className="mt-3 overflow-hidden rounded-2xl border bg-card shadow-sm">
          {/* filter bar: scope, status, and list/board presentation */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span className="mr-1">Show</span>
              {(
                [
                  ["projects", "Projects"],
                  ["jobs", "Jobs"],
                  ["products", "Products"],
                ] as [FlagFilter, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={flagFilter === mode}
                  onClick={() => {
                    setFlagFilter(mode);
                    // the kanban only drives products, so leave it behind when
                    // the Projects or Jobs list is selected
                    if (mode !== "products") setFlagBoardMode(false);
                  }}
                  className={cn(
                    "rounded-full border px-2.5 py-1 transition-colors",
                    flagFilter === mode
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-accent hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-border" />
              <button
                type="button"
                onClick={() => setFlagStatus("all")}
                className={cn(
                  "rounded-full border px-2.5 py-1 transition-colors",
                  flagStatus === "all"
                    ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                    : "border-border bg-card hover:bg-accent hover:text-foreground",
                )}
              >
                Any status
              </button>
              {projectStatuses.map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setFlagStatus(status)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 transition-colors",
                    flagStatus === status
                      ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                      : "border-border bg-card hover:bg-accent hover:text-foreground",
                  )}
                >
                  {status}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setStatusDraft(projectStatuses);
                  setStatusSettingsOpen((open) => !open);
                }}
                className="ml-1 inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-1 text-primary transition-colors hover:bg-primary/10"
                title="Customize Projects statuses"
              >
                <Settings2 className="size-3" /> Custom status
              </button>
            </div>
            {statusSettingsOpen && statusDraft !== null && (
              <div className="mx-3 mb-2 rounded-xl border bg-card p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold">Custom Projects statuses</p>
                    <p className="text-[11px] text-muted-foreground">Start and Finish stay fixed.</p>
                  </div>
                  <button type="button" onClick={() => setStatusSettingsOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close status settings">
                    <X className="size-4" />
                  </button>
                </div>
                <div className="space-y-1.5">
                  {statusDraft.map((status, index) => {
                    const locked = index === 0 || index === statusDraft.length - 1;
                    return (
                      <div key={`${index}-${status}`} className="flex items-center gap-1.5">
                        <Input
                          value={status}
                          disabled={locked}
                          onChange={(e) => setStatusDraft((current) => current?.map((item, i) => i === index ? e.target.value : item) ?? null)}
                          className="h-8 text-xs"
                        />
                        {!locked && (
                          <button type="button" onClick={() => setStatusDraft((current) => current?.filter((_, i) => i !== index) ?? null)} className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Remove ${status}`}>
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex justify-between">
                  <button
                    type="button"
                    disabled={statusDraft.length >= 11}
                    onClick={() => setStatusDraft((current) => current ? [...current.slice(0, -1), "", "Finish"] : null)}
                    className="inline-flex items-center gap-1 text-xs text-primary disabled:opacity-40"
                  >
                    <Plus className="size-3" /> Add middle status
                  </button>
                  <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => void saveProjectStatuses()}>Save</Button>
                </div>
              </div>
            )}
            {flagFilter === "products" && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setFlagBoardMode(false)}
                  aria-pressed={!flagBoardMode}
                  className={cn(
                    "grid size-7 place-items-center rounded-md border transition-colors",
                    !flagBoardMode
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title="List view"
                >
                  <List className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setFlagBoardMode(true)}
                  aria-pressed={flagBoardMode}
                  className={cn(
                    "grid size-7 place-items-center rounded-md border transition-colors",
                    flagBoardMode
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title="Board view (products)"
                >
                  <Columns3 className="size-3.5" />
                </button>
              </div>
            )}
          </div>
          {flaggedJobs === undefined || flaggedFgs === undefined || flaggedProjects === undefined ? (
            <div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading projects…
            </div>
          ) : flagFilter === "projects" ? (
            <FlaggedProjectsList
              data={projectListData}
              allJobs={flaggedJobs ?? []}
              allFgs={flaggedFgs ?? []}
              statusFilter={flagStatus}
              sortMode={sortMode}
              selection={flagSelection}
              onSelect={setFlagSelection}
            />
          ) : flaggedItems === null ? (
            <div className="px-6 py-14 text-center">
              <Flag className="mx-auto size-8 text-amber-500/40" />
              <p className="mt-3 font-medium">Nothing flagged</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Flag a job or product in the Projects page and it will show up here.
              </p>
            </div>
          ) : flagFilter === "jobs" ? (
            <FlaggedItemsList
              data={flaggedItems}
              allJobs={flaggedJobs ?? []}
              allFgs={flaggedFgs ?? []}
              statusFilter={flagStatus}
              jobsOnly
              onToggleFg={(fg) => void handleToggleFlaggedFg(fg)}
              onToggleJob={(job) => void handleToggleFlaggedJob(job)}
              busyKey={flaggedBusy}
              sortMode={sortMode}
              selection={flagSelection}
              onSelect={setFlagSelection}
            />
          ) : flagBoardMode ? (
            <div className="p-3">
              <FlaggedBoard
                data={flaggedItems}
                allJobs={flaggedJobs ?? []}
                statusFilter={flagStatus}
                onToggleFg={(fg) => void handleToggleFlaggedFg(fg)}
                busyKey={flaggedBusy}
                projectNameOf={flaggedItems.projectNameOf}
                onOpenFg={(fg) => setFlagSelection({ kind: "fg", id: fg._id })}
              />
            </div>
          ) : (
            <FlaggedProductsList
              data={flaggedItems}
              allJobs={flaggedJobs ?? []}
              statusFilter={flagStatus}
              onToggleFg={(fg) => void handleToggleFlaggedFg(fg)}
              busyKey={flaggedBusy}
              sortMode={sortMode}
              selection={flagSelection}
              onSelect={setFlagSelection}
            />
          )}
        </section>
        {flagSelection && flaggedJobs !== undefined && flaggedFgs !== undefined && (
          <div className="mt-3">
            <FlaggedDetail
              selection={flagSelection}
              jobs={flaggedJobs}
              fgs={flaggedFgs}
              projects={flaggedProjects ?? []}
              onSelect={setFlagSelection}
              onClose={() => setFlagSelection(null)}
            />
          </div>
        )}
        </div>
      )}

      {/* ── Task list ───────────────────────────────────────────────── */}
      {activeView !== "flagged" && (
      <section className="mt-3 overflow-hidden rounded-2xl border bg-card shadow-sm">
        {allTasks === undefined ? (
          <div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading your tasks…
          </div>
        ) : (
          <>
          {tasks.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Inbox className="mx-auto size-8 text-muted-foreground/40" />
            <p className="mt-3 font-medium">Nothing here</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeView === "today"
                ? "Nothing due today — enjoy the calm."
                : activeView === "starred"
                  ? "Star a task to pin what matters most."
                  : activeList
                    ? `Add your first task to “${activeList.name}”.`
                    : "Add your first task above, or flag text from a note."}
            </p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_auto]">
            <div>
            <ul className="divide-y divide-border/70">
              <AnimatePresence initial={false}>
                {tasks.map((task) => {
                  const isOpen = openTaskId === task._id;
                  const overdue = isOverdue(task);
                  const hasExtras =
                    task.dueAt !== undefined ||
                    task.tags !== undefined ||
                    task.priority !== undefined ||
                    task.recurrence !== undefined ||
                    task.description !== undefined ||
                    task.sourcePageId !== undefined ||
                    parseAttachments(task.attachments).length > 0;
                  return (
                    <motion.li
                      key={task._id}
                      layout
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className={cn(
                        "group/task",
                        isOpen && "bg-primary/[0.04]",
                      )}
                    >
                      <div className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                        <Checkbox
                          checked={task.isCompleted}
                          disabled={!canEdit}
                          onCheckedChange={() => void handleToggle(task._id)}
                          aria-label={
                            task.isCompleted
                              ? `Mark “${task.text}” as not done`
                              : `Mark “${task.text}” as done`
                          }
                          className="size-5 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-3"
                        />
                        <button
                          type="button"
                          onClick={() => setOpenTaskId(isOpen ? null : task._id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span
                            className={cn(
                              "block text-[15px] leading-relaxed transition-colors",
                              task.isCompleted && "text-muted-foreground line-through",
                            )}
                          >
                            {task.text}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5">
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                              title={`Created ${new Date(task._creationTime).toLocaleString()}`}
                            >
                              <Clock className="size-2.5" />
                              {formatCreatedLabel(task._creationTime)}
                            </span>
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                task.isCompleted
                                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "bg-muted text-muted-foreground",
                              )}
                              title="Days since creation"
                            >
                              <History className="size-2.5" />
                              {ageDaysLabel(task._creationTime, task.completedAt)}
                            </span>
                          </span>
                          {(hasExtras || task.starred) && (
                            <span className="mt-1 flex flex-wrap items-center gap-1.5">
                              {task.priority && (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize",
                                    PRIORITY_META[task.priority].chip,
                                  )}
                                >
                                  <span className={cn("size-1.5 rounded-full", PRIORITY_META[task.priority].dot)} />
                                  {task.priority}
                                </span>
                              )}
                              {task.dueAt !== undefined && (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                    overdue
                                      ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                                      : isDueToday(task)
                                        ? "bg-primary/10 text-primary"
                                        : "bg-muted text-muted-foreground",
                                  )}
                                >
                                  <CalendarDays className="size-2.5" />
                                  {formatDueLabel(task.dueAt)}
                                </span>
                              )}
                              {task.remindAt !== undefined && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                  <AlarmClock className="size-2.5" />
                                  {formatDueLabel(task.remindAt)}
                                </span>
                              )}
                              {task.recurrence && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-400">
                                  <Repeat className="size-2.5" />
                                  {RECURRENCE_LABEL[task.recurrence]}
                                </span>
                              )}
                              {(task.tags ?? []).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                >
                                  #{tag}
                                </span>
                              ))}
                              {task.description !== undefined && (
                                <FileText className="size-3 text-muted-foreground/70" />
                              )}
                              {parseAttachments(task.attachments).length > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                  <Paperclip className="size-2.5" />
                                  {parseAttachments(task.attachments).length}
                                </span>
                              )}
                              {task.sourcePageId && (
                                <Badge
                                  variant="secondary"
                                  title={`From note: ${sourcePageTitle(task.sourcePageId)}`}
                                  className="inline-flex max-w-44 gap-1 rounded-full bg-amber-500/10 px-1.5 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                >
                                  <Flag className="size-2.5 shrink-0" />
                                  <span className="truncate">
                                    {sourcePageTitle(task.sourcePageId)}
                                  </span>
                                </Badge>
                              )}
                            </span>
                          )}
                        </button>
                        <span className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            aria-label={task.starred ? "Remove star" : "Star task"}
                            title={task.starred ? "Unstar" : "Star"}
                            className={cn(
                              "grid size-7 place-items-center rounded-md transition-colors hover:bg-accent",
                              task.starred ? "text-amber-500" : "text-muted-foreground opacity-0 group-hover/task:opacity-100",
                            )}
                            onClick={() =>
                              void updateTask({ id: task._id, starred: !task.starred }).catch(() =>
                                toast.error("Couldn't update the star."),
                              )
                            }
                          >
                            <Star className={cn("size-4", task.starred && "fill-amber-400")} />
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              aria-label="Delete task"
                              title="Delete"
                              className="hidden size-7 place-items-center rounded-md text-muted-foreground hover:text-destructive group-hover/task:grid"
                              onClick={() => void handleDelete(task._id)}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                          <ChevronDown
                            className={cn(
                              "size-4 text-muted-foreground/60 transition-transform",
                              isOpen && "rotate-180 text-primary",
                            )}
                          />
                        </span>
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            </div>

            {/* detail editor (slides in beside the list on wide screens) */}
            {openTask && (
              <TaskDetail
                task={openTask}
                lists={lists}
                canEdit={canEdit}
                canDelete={canDelete}
                canCreateSteps={canCreateSteps}
                canEditSteps={canEditSteps}
                canDeleteSteps={canDeleteSteps}
                onClose={() => setOpenTaskId(null)}
              />
            )}
          </div>
        )}
          </>
        )}
      </section>
      )}

      {doneCount > 0 && !showDone && activeView !== "flagged" && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          {doneCount} completed {doneCount === 1 ? "task" : "tasks"} hidden — “Show completed” to
          review them.
        </p>
      )}
    </div>
  );
}
