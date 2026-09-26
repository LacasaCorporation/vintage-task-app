import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import TaskDetail from "@/components/TaskDetail";
import StepDetail from "@/components/StepDetail";
import TaskStats, { TaskQuickAdd } from "@/components/TaskQuickAdd";
import ProjectsWorkspace from "@/components/ProjectsWorkspace";
import {
  DEFAULT_VIEW_BY_FILTER,
  type WorkspaceView,
} from "@/components/FlaggedViews";
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
} from "@/lib/task-utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlarmClock,
  CalendarDays,
  ChevronDown,
  Clock,
  Crown,
  FileText,
  Flag,
  History,
  Inbox,
  ListTodo,
  Loader2,
  Paperclip,
  Plus,
  Repeat,
  Star,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
  projectStatusesOrDefaults,
} from "@/lib/project-statuses";
import {
  PRIORITY_META,
  PRIORITY_RANK,
  daysLeftLabel,
  type FlagFilter,
  type FlagStatusFilter,
  type FlaggedData,
  type FlaggedSel,
  type FgDoc,
  type JobDoc,
  type ListId,
  type SortMode,
  jobProjectStatus,
} from "@/components/FlaggedLists";

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
  // everyone in the firm with their manager — one query, so every row can name
  // its assignees without a query per row
  const peopleData = useQuery(api.tasks.people);
  const peopleById = useMemo(
    () => new Map((peopleData?.people ?? []).map((p) => [p.userId, p])),
    [peopleData],
  );
  // subtasks (steps) for the whole scope in one query, so each row can show
  // its own subtask dropdown without a query per row
  const allSteps = useQuery(api.tasks.listAllSteps);
  const toggleStepM = useMutation(api.tasks.toggleStep);
  const addStepM = useMutation(api.tasks.addStep);
  const removeStepM = useMutation(api.tasks.removeStep);
  const updateStepM = useMutation(api.tasks.updateStep);
  const [openStepRows, setOpenStepRows] = useState<Set<string>>(() => new Set());
  const [openStepId, setOpenStepId] = useState<Id<"taskSteps"> | null>(null);
  const [stepBusy, setStepBusy] = useState(false);
  const [stepDrafts, setStepDrafts] = useState<Record<string, string>>({});

  const stepsByTask = useMemo(() => {
    const map = new Map<string, Doc<"taskSteps">[]>();
    for (const step of allSteps ?? []) {
      const list = map.get(step.taskId) ?? [];
      list.push(step);
      map.set(step.taskId, list);
    }
    return map;
  }, [allSteps]);

  const toggleStepRow = (taskId: string) =>
    setOpenStepRows((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  // flagged jobs & products (from the Projects section) for the Flagged view
  const flaggedJobs = useQuery(api.jobs.listJobs);
  const flaggedFgs = useQuery(api.costing.listFinishedGoods);
  const flaggedProjects = useQuery(api.costing.listProjects);
  const setFgCompletedM = useMutation(api.costing.setFgCompleted);
  const setJobProjectStatusM = useMutation(api.jobs.setJobProjectStatus);
  const projectStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const setProjectStatusesM = useMutation(api.settings.setProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(projectStatusesQuery);
  const [flaggedBusy, setFlaggedBusy] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<Id<"tasks"> | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("manual");

  // Projects view: level filter (projects / jobs / products), status filter
  // and the products-only list-vs-board presentation.
  const [flagFilter, setFlagFilter] = useState<FlagFilter>("projects");
  const [flagSelection, setFlagSelection] = useState<FlaggedSel>(null);
  const [flagStatus, setFlagStatus] = useState<FlagStatusFilter>("all");
  // Which presentation the current level filter is showing (list / hierarchy /
  // board / report). Each filter offers its own set of these.
  const [flagView, setFlagView] = useState<WorkspaceView>("list");
  // the print sheet is mounted on demand, then the browser print dialog opens
  const [printProducts, setPrintProducts] = useState(false);
  const [statusSettingsOpen, setStatusSettingsOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState<string[] | null>(null);

  // Projects should always open as a list when selected from the sidebar.
  const [lastActiveView, setLastActiveView] = useState(activeView);
  if (lastActiveView !== activeView) {
    setLastActiveView(activeView);
    if (activeView === "flagged") setFlagView("list");
  }

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

  /**
   * Mount the hidden print sheet, let it paint, then open the browser print
   * dialog and unmount it again so it never lingers in the app.
   */
  const openStep = useMemo(
    () => (openStepId !== null ? (allSteps ?? []).find((s) => s._id === openStepId) ?? null : null),
    [allSteps, openStepId],
  );
  const openStepTask = useMemo(
    () => (openStep ? (allTasks ?? []).find((t) => t._id === openStep.taskId) ?? null : null),
    [allTasks, openStep],
  );

  /** Save one field of the open subtask, keeping the panel in sync. */
  const patchOpenStep = async (patch: {
    text?: string;
    description?: string;
    dueAt?: number;
    priority?: Priority;
    tags?: string[];
    copyFromTask?: boolean;
  }) => {
    if (openStep === null) return;
    setStepBusy(true);
    try {
      await updateStepM({ id: openStep._id, ...patch });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the subtask.");
    } finally {
      setStepBusy(false);
    }
  };

  /**
   * Check a task off — blocked server-side while any subtask is open, so the
   * client shows a hint tooltip instead of letting the click fail silently.
   */
  const handleToggleTask = async (taskId: Id<"tasks">) => {
    const open = (stepsByTask.get(taskId) ?? []).filter((s) => !s.isCompleted).length;
    if (open > 0) {
      toast.error(
        open === 1
          ? "Finish the last subtask first."
          : `Finish the ${open} open subtasks first.`,
      );
      setOpenStepRows((current) => new Set(current).add(taskId));
      return;
    }
    try {
      await toggleTask({ id: taskId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the task.");
    }
  };

  const handlePrintProducts = () => {
    setPrintProducts(true);
    window.setTimeout(() => {
      window.print();
      setPrintProducts(false);
    }, 120);
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

  /**
   * Move a flagged job on the kanban board. "todo" re-opens a completed job,
   * "in_progress" flips it into the working state, "completed" keeps the same
   * guard as the list: only when every flagged product under it is done (the
   * unguarded path is onToggleFlaggedJob, which also flips flag colors).
   */
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
      <TaskStats
        tiles={[
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
        ]}
      />

      {/* ── Add a task ─────────────────────────────────────────── */}
      <TaskQuickAdd
        canCreate={canCreate}
        draft={draft}
        isAdding={isAdding}
        listName={activeList?.name}
        onDraftChange={setDraft}
        onSubmit={handleAdd}
        onFocus={askNotificationPermission}
      />

      {/* ── Scope / sort / filter controls ───────────────────────────── */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="mr-1">Show</span>
          {(
            [
              ["mine", "Mine", "Only the tasks you own"],
              [
                "all",
                "ALL",
                "Your tasks plus those of everyone who reports to you",
              ],
            ] as ["mine" | "all", string, string][]
          ).map(([mode, label, hint]) => (
            <button
              key={mode}
              type="button"
              title={hint}
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
        <ProjectsWorkspace
          projects={flaggedProjects}
          jobs={flaggedJobs}
          fgs={flaggedFgs}
          items={flaggedItems}
          filter={flagFilter}
          onFilterChange={(next) => {
            setFlagFilter(next);
            setFlagView(DEFAULT_VIEW_BY_FILTER[next] ?? "list");
          }}
          status={flagStatus}
          onStatusChange={setFlagStatus}
          projectStatuses={projectStatuses}
          statusDraft={statusDraft}
          onStatusDraft={setStatusDraft}
          statusSettingsOpen={statusSettingsOpen}
          onToggleStatusSettings={() => {
            setStatusDraft(projectStatuses);
            setStatusSettingsOpen((open) => !open);
          }}
          onSaveStatuses={() => void saveProjectStatuses()}
          view={flagView}
          onViewChange={setFlagView}
          onPrint={handlePrintProducts}
          printing={printProducts}
          sortMode={sortMode}
          selection={flagSelection}
          onSelect={setFlagSelection}
          busyKey={flaggedBusy}
          onToggleFg={(fg) => void handleToggleFlaggedFg(fg)}
          onToggleJob={(job) => void handleToggleFlaggedJob(job)}
        />
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
                  // A task written before ownership was tracked carries the
                  // firm's own id in assigneeId, and its real author was never
                  // stored — show it as shared rather than blame the owner.
                  const stampedOwner =
                    task.assigneeId === undefined
                      ? null
                      : (peopleById.get(task.assigneeId) ?? null);
                  const taskIsShared =
                    stampedOwner === null ||
                    (stampedOwner.isFirmOwner && task.assignedAt === undefined);
                  const taskAssignees = taskIsShared
                    ? []
                    : (task.assigneeIds ??
                      (task.assigneeId === undefined
                        ? []
                        : [task.assigneeId]));
                  const taskSteps = stepsByTask.get(task._id) ?? [];
                  const stepsDone = taskSteps.filter((s) => s.isCompleted).length;
                  const stepsOpen = openStepRows.has(task._id);
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
                      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
                        <Checkbox
                          checked={task.isCompleted}
                          disabled={!canEdit}
                          onCheckedChange={() => void handleToggleTask(task._id)}
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
                          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left"
                        >
                          <span
                            className={cn(
                              "text-[15px] leading-relaxed transition-colors",
                              task.isCompleted && "text-muted-foreground line-through",
                            )}
                          >
                            {task.text}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            {taskAssignees.length === 1 ? (
                              <span
                                className={cn(
                                  "inline-flex max-w-40 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                  peopleById.get(taskAssignees[0])?.isFirmOwner
                                    ? "bg-primary/10 text-primary"
                                    : "bg-muted text-muted-foreground",
                                )}
                                title={
                                  peopleById.get(taskAssignees[0])?.isFirmOwner === true
                                    ? `${peopleById.get(taskAssignees[0])?.label} — owns this firm`
                                    : `Assigned to ${peopleById.get(taskAssignees[0])?.label ?? "someone"}`
                                }
                              >
                                {peopleById.get(taskAssignees[0])?.isFirmOwner ? (
                                  <Crown className="size-2.5" />
                                ) : (
                                  <UserRound className="size-2.5" />
                                )}
                                <span className="truncate">
                                  {peopleById.get(taskAssignees[0])?.label ??
                                    "Someone"}
                                </span>
                              </span>
                            ) : taskAssignees.length > 1 ? (
                              <span
                                className="inline-flex max-w-56 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                                title={taskAssignees
                                  .map(
                                    (id) =>
                                      peopleById.get(id)?.label ?? "Someone",
                                  )
                                  .join(", ")}
                              >
                                <Users className="size-2.5" />
                                <span className="truncate">
                                  {taskAssignees
                                    .slice(0, 2)
                                    .map(
                                      (id) =>
                                        peopleById.get(id)?.label ?? "Someone",
                                    )
                                    .join(", ")}
                                  {taskAssignees.length > 2
                                    ? ` +${taskAssignees.length - 2}`
                                    : ""}
                                </span>
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                                title="Nobody is assigned to this task yet — it is shared with everyone in the firm"
                              >
                                <Users className="size-2.5" />
                                Not assigned
                              </span>
                            )}
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
                            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                              {/* once a task is done the tags lead the row */}
                              {task.isCompleted &&
                                (task.tags ?? []).map((tag) => (
                                  <span
                                    key={`done-${tag}`}
                                    className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                  >
                                    #{tag}
                                  </span>
                                ))}
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
                              {task.dueAt !== undefined && !task.isCompleted && (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                                    daysLeftLabel(task.dueAt).overdue
                                      ? "bg-destructive/10 text-destructive"
                                      : "bg-primary/10 text-primary",
                                  )}
                                  title="Time left to complete this task"
                                >
                                  <History className="size-2.5" />
                                  {daysLeftLabel(task.dueAt).text}
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
                              {!task.isCompleted &&
                                (task.tags ?? []).map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              {parseAttachments(task.attachments).length > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                  <Paperclip className="size-2.5" />
                                  {parseAttachments(task.attachments).length}
                                </span>
                              )}
                              <span
                                role="button"
                                tabIndex={0}
                                aria-expanded={stepsOpen}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleStepRow(task._id);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleStepRow(task._id);
                                  }
                                }}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors",
                                  stepsOpen
                                    ? "bg-primary/10 text-primary"
                                    : stepsDone === taskSteps.length && taskSteps.length > 0
                                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                      : "bg-muted text-muted-foreground",
                                )}
                                title={
                                  taskSteps.length === 0
                                    ? "Add a subtask"
                                    : taskSteps
                                        .map(
                                          (s) => `${s.isCompleted ? "✓" : "•"} ${s.text}`,
                                        )
                                        .join("\n")
                                }
                              >
                                <ListTodo className="size-2.5" />
                                Subtasks
                                {taskSteps.length > 0 && (
                                  <span className="tabular-nums">
                                    {stepsDone}/{taskSteps.length}
                                  </span>
                                )}
                                <ChevronDown
                                  className={cn(
                                    "size-2.5 transition-transform",
                                    stepsOpen && "rotate-180",
                                  )}
                                />
                              </span>
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
                        {/* notes get their own line under the task */}
                        {(task.description ?? "").trim() !== "" && (
                          <p className="flex w-full basis-full items-start gap-1.5 pl-8 text-xs leading-relaxed text-muted-foreground">
                            <FileText className="mt-0.5 size-3 shrink-0 text-muted-foreground/60" />
                            <span className="min-w-0 break-words">
                              {(task.description ?? "").trim()}
                            </span>
                          </p>
                        )}
                      </div>
                      {/* subtasks: a dropdown under the row */}
                      <AnimatePresence initial={false}>
                        {stepsOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-1 border-t border-border/60 bg-muted/30 py-2.5 pr-4 pl-1 sm:pr-5 sm:pl-2">
                              {taskSteps.length === 0 ? (
                                <p className="pl-1 text-xs text-muted-foreground">
                                  No subtasks yet — add the first one below.
                                </p>
                              ) : (
                                <ul className="space-y-1">
                                  {taskSteps.map((step) => (                                        <li
                                          key={step._id}
                                          className={cn(
                                            "group/step flex items-center gap-2 rounded-md px-1.5",
                                            openStepId === step._id && "bg-amber-500/10",
                                          )}
                                        >
                                      <Checkbox
                                        checked={step.isCompleted}
                                        disabled={!canEdit}
                                        onCheckedChange={() => void toggleStepM({ id: step._id })}
                                        aria-label={
                                          step.isCompleted
                                            ? `Reopen subtask “${step.text}”`
                                            : `Mark subtask “${step.text}” as done`
                                        }
                                        className="size-4 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-2.5"
                                      />
                                      {/* which task features this subtask uses, on the left */}
                                      {(step.remindAt !== undefined ||
                                        step.priority !== undefined ||
                                        step.recurrence !== undefined ||
                                        (step.tags ?? []).length > 0 ||
                                        (step.description ?? "").trim() !== "" ||
                                        parseAttachments(step.attachments).length > 0) && (
                                        <span className="order-2 ml-1.5 flex shrink-0 flex-wrap items-center gap-1">
                                          {step.remindAt !== undefined && (
                                            <span
                                              title={`Reminds ${formatDueLabel(step.remindAt)}`}
                                              className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                                            >
                                              <AlarmClock className="size-3" />
                                            </span>
                                          )}
                                          {step.priority !== undefined && (
                                            <span
                                              className={cn(
                                                "inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[10px] font-medium capitalize",
                                                PRIORITY_META[step.priority].chip,
                                              )}
                                              title={`Priority: ${step.priority}`}
                                            >
                                              <span
                                                className={cn(
                                                  "size-1.5 rounded-full",
                                                  PRIORITY_META[step.priority].dot,
                                                )}
                                              />
                                              {step.priority[0]}
                                            </span>
                                          )}
                                          {step.recurrence !== undefined && (
                                            <span
                                              title={`Repeats ${RECURRENCE_LABEL[step.recurrence]}`}
                                              className="inline-flex items-center gap-0.5 rounded-full bg-violet-500/10 px-1 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-400"
                                            >
                                              <Repeat className="size-3" />
                                              {RECURRENCE_LABEL[step.recurrence].replace("Every ", "")}
                                            </span>
                                          )}
                                          {/* full tag text, never just a count */}
                                          {(step.tags ?? []).slice(0, 3).map((tag) => (
                                            <span
                                              key={tag}
                                              title={`Tag: #${tag}`}
                                              className="max-w-24 truncate rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                            >
                                              #{tag}
                                            </span>
                                          ))}
                                          {(step.tags ?? []).length > 3 && (
                                            <span
                                              className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary"
                                              title={(step.tags ?? []).map((t) => `#${t}`).join(" ")}
                                            >
                                              +{(step.tags ?? []).length - 3}
                                            </span>
                                          )}
                                          {(step.description ?? "").trim() !== "" && (
                                            <span
                                              title="Has notes"
                                              className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1 py-0.5 text-[10px] font-medium text-muted-foreground"
                                            >
                                              <FileText className="size-3" />
                                            </span>
                                          )}
                                          {parseAttachments(step.attachments).length > 0 && (
                                            <span
                                              title={`${parseAttachments(step.attachments).length} attachment(s)`}
                                              className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/10 px-1 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400"
                                            >
                                              <Paperclip className="size-3" />
                                              {parseAttachments(step.attachments).length}
                                            </span>
                                          )}
                                          {step.starred === true && (
                                            <span
                                              title="Starred"
                                              className="inline-flex items-center rounded-full bg-amber-400/15 px-1 py-0.5 text-amber-600 dark:text-amber-400"
                                            >
                                              <Star className="size-3 fill-amber-400" />
                                            </span>
                                          )}
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setOpenStepId((current) =>
                                            current === step._id ? null : step._id,
                                          )
                                        }
                                        title="Open subtask details"
                                        className={cn(
                                          "order-1 min-w-0 max-w-[55%] cursor-pointer truncate text-left text-xs hover:underline",
                                          step.isCompleted
                                            ? "text-muted-foreground line-through"
                                            : "text-foreground",
                                          openStepId === step._id && "text-amber-700 dark:text-amber-400",
                                        )}
                                      >
                                        {step.text}
                                      </button>
                                      {step.dueAt !== undefined && (
                                        <span
                                          className={cn(
                                            "order-3 ml-auto inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                                            !step.isCompleted &&
                                              daysLeftLabel(step.dueAt).overdue
                                              ? "bg-destructive/10 text-destructive"
                                              : "bg-primary/10 text-primary",
                                          )}
                                          title={`Subtask due ${formatDueLabel(step.dueAt)}`}
                                        >
                                          <CalendarDays className="size-2.5" />
                                          {formatDueLabel(step.dueAt)}
                                        </span>
                                      )}
                                      {!step.isCompleted && step.dueAt !== undefined && (
                                        <span
                                          className={cn(
                                            "order-4 hidden shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums sm:inline-flex",
                                            daysLeftLabel(step.dueAt).overdue
                                              ? "bg-destructive/10 text-destructive"
                                              : "bg-muted text-muted-foreground",
                                          )}
                                        >
                                          {daysLeftLabel(step.dueAt).text}
                                        </span>
                                      )}
                                      {canEdit && (
                                        <span
                                          title={
                                            task.dueAt !== undefined
                                              ? `Subtask due date — can't be later than the task (${formatDueLabel(task.dueAt)})`
                                              : "Subtask due date"
                                          }
                                          className="hidden shrink-0 items-center text-[10px] text-muted-foreground/70 group-hover/step:hidden"
                                        >
                                          <CalendarDays className="size-3" />
                                        </span>
                                      )}
                                      {canDelete && (
                                        <button
                                          type="button"
                                          aria-label={`Delete subtask “${step.text}”`}
                                          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-colors hover:text-destructive group-hover/step:opacity-100"
                                          onClick={() => void removeStepM({ id: step._id })}
                                        >
                                          <Trash2 className="size-3" />
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        aria-label={`Open details for subtask “${step.text}”`}
                                        title="Subtask details"
                                        className={cn(
                                          "grid size-6 shrink-0 place-items-center rounded transition-colors",
                                          openStepId === step._id
                                            ? "bg-primary/10 text-primary"
                                            : "text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover/step:opacity-100",
                                        )}
                                        onClick={() =>
                                          setOpenStepId((current) =>
                                            current === step._id ? null : step._id,
                                          )
                                        }
                                      >
                                        <ListTodo className="size-3" />
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              {canCreateSteps && (
                                <form
                                  className="flex items-center gap-1.5 pt-1"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const text = (stepDrafts[task._id] ?? "").trim();
                                    if (!text) return;
                                    setStepDrafts((current) => ({ ...current, [task._id]: "" }));
                                    void addStepM({ taskId: task._id, text }).catch(() =>
                                      toast.error("Couldn't add the subtask."),
                                    );
                                  }}
                                >
                                  <Input
                                    value={stepDrafts[task._id] ?? ""}
                                    onChange={(e) =>
                                      setStepDrafts((current) => ({
                                        ...current,
                                        [task._id]: e.target.value,
                                      }))
                                    }
                                    onFocus={() => {
                                      // only open — focusing must never close the panel
                                      if (!openStepRows.has(task._id)) toggleStepRow(task._id);
                                    }}
                                    placeholder="Add a subtask… (date is capped by the task)"
                                    aria-label="New subtask"
                                    maxLength={280}
                                    className="h-8 rounded-lg text-xs"
                                  />
                                  <Button
                                    type="submit"
                                    size="sm"
                                    disabled={!(stepDrafts[task._id] ?? "").trim()}
                                    className="h-8 shrink-0 rounded-lg px-2.5 text-xs"
                                  >
                                    <Plus className="size-3" /> Add
                                  </Button>
                                </form>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
            </div>

            {/* detail editor (slides in beside the list on wide screens) */}
            {openStep !== null ? (
              <StepDetail
                step={openStep}
                task={openStepTask}
                canEdit={canEdit && canEditSteps}
                canDelete={canDeleteSteps}
                busy={stepBusy}
                onPatch={(patch) => void patchOpenStep(patch)}
                onToggle={() => void toggleStepM({ id: openStep._id })}
                onDelete={() => {
                  setOpenStepId(null);
                  void removeStepM({ id: openStep._id });
                }}
                onClose={() => setOpenStepId(null)}
              />
            ) : openTask && (
              <TaskDetail
                task={openTask}
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
