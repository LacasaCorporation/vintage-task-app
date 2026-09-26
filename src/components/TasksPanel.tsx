import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import TaskDetail from "@/components/TaskDetail";
import ProductPrintSheet from "@/components/ProductPrintSheet";
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
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clock,
  Columns3,
  FileText,
  Flag,
  History,
  Inbox,
  List,
  Loader2,
  Paperclip,
  Plus,
  Printer,
  Repeat,
  Settings2,
  Star,
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
import {
  PRIORITY_META,
  PRIORITY_RANK,
  FlaggedBoard,
  FlaggedDetail,
  FlaggedItemsList,
  FlaggedProductsList,
  FlaggedProjectsList,
  ProductionReport,
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

  // Projects view: level filter (projects / jobs / products), status filter
  // and the products-only list-vs-board presentation.
  const [flagFilter, setFlagFilter] = useState<FlagFilter>("projects");
  const [flagSelection, setFlagSelection] = useState<FlaggedSel>(null);
  const [flagStatus, setFlagStatus] = useState<FlagStatusFilter>("all");
  const [flagBoardMode, setFlagBoardMode] = useState(false);
  const [flagReportMode, setFlagReportMode] = useState(false);
  // the print sheet is mounted on demand, then the browser print dialog opens
  const [printProducts, setPrintProducts] = useState(false);
  const [statusSettingsOpen, setStatusSettingsOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState<string[] | null>(null);

  // Projects should always open as a list when selected from the sidebar.
  useEffect(() => {
    if (activeView === "flagged") {
      setFlagBoardMode(false);
      setFlagReportMode(false);
    }
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

  /** Check off (or reopen) a flagged product in the todo list. */
  const handleSetFlaggedFgStatus = async (fg: FgDoc, status: string) => {
    setFlaggedBusy(`f:${fg._id}`);
    try {
      await setFgProjectStatusM({ id: fg._id, status });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the product status.");
    } finally {
      setFlaggedBusy(null);
    }
  };

  const handleSetFlaggedJobStatus = async (job: JobDoc, status: string) => {
    setFlaggedBusy(`j:${job._id}`);
    try {
      await setJobProjectStatusM({ id: job._id, status });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the job status.");
    } finally {
      setFlaggedBusy(null);
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
                    if (mode !== "products") {
                      setFlagBoardMode(false);
                      setFlagReportMode(false);
                    }
                  }}
                  className={cn(
                    "rounded-full border px-2.5 py-1 whitespace-nowrap transition-colors",
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
            <div className="flex items-center gap-1">
              {flagFilter === "products" ? (
                <>
              <button
                type="button"
                onClick={() => {
                  setFlagBoardMode(false);
                  setFlagReportMode(false);
                }}
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
                onClick={() => {
                  setFlagBoardMode(true);
                  setFlagReportMode(false);
                }}
                aria-pressed={flagBoardMode}
                className={cn(
                  "grid size-7 place-items-center rounded-md border transition-colors",
                  flagBoardMode
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                title="Board view"
              >
                <Columns3 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setFlagReportMode((on) => !on)}
                aria-pressed={flagReportMode}
                className={cn(
                  "grid size-7 place-items-center rounded-md border transition-colors",
                  flagReportMode
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                title="Production report"
              >
                <BarChart3 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={handlePrintProducts}
                className="grid size-7 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Print products"
              >
                <Printer className="size-3.5" />
              </button>
                </>
              ) : null}
            </div>
          </div>
          {flaggedProjects === undefined ? (
            <div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading projects…
            </div>
          ) : flagFilter === "projects" ? (
            <FlaggedProjectsList
              projects={flaggedProjects}
              jobs={flaggedJobs ?? []}
              fgs={flaggedFgs ?? []}
              statusFilter={flagStatus}
              projectStatuses={projectStatuses}
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
          ) : flagFilter === "products" ? (
            flagReportMode ? (
              <ProductionReport
                data={flaggedItems}
                allJobs={flaggedJobs ?? []}
                projectStatuses={projectStatuses}
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
            )
          ) : (
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
          )}
          {printProducts && flaggedItems !== null && (
            <ProductPrintSheet
              data={flaggedItems}
              allJobs={flaggedJobs ?? []}
              projectStatuses={projectStatuses}
              statusFilter={flagStatus}
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
              onClose={() => setFlagSelection(null)}
              onSelect={setFlagSelection}
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
