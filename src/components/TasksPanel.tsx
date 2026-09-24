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
  Briefcase,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  Columns3,
  FileText,
  Flag,
  GanttChartSquare,
  GripVertical,
  History,
  Inbox,
  Loader2,
  Package,
  Paperclip,
  Plus,
  Repeat,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type ListId = Id<"taskLists">;
type SortMode = "manual" | "due" | "priority" | "created";
type JobDoc = Doc<"projectJobs">;
type FgDoc = Doc<"finishedGoods">;

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/**
 * Flagged view filter: "all" = everything (jobs as parents + their products as
 * subtasks), "products" = only the flagged product cards (flat), "jobs" = only
 * flagged job rows. `status` narrows by completion state.
 */
type FlagFilter = "all" | "products" | "jobs";
type FlagStatusFilter = "open" | "done" | "all";

/** Wider chip shared by the flagged-view filter bar and cards. */
const tagChip =
  "shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground";

/** Flagged jobs & products (from the Projects section) with their labels. */
type FlaggedData = {
  jobs: JobDoc[];
  fgs: FgDoc[];
  projectNameOf: (job: JobDoc) => string;
};

/**
 * Flagged items rendered as real todo rows: products get a checkbox, and a job
 * can only be checked off once every flagged product under it is completed.
 * `showTags` adds explicit project & job name tag chips (used in the main list).
 */
function FlaggedItemsList({
  data,
  allJobs,
  allFgs,
  showTags = false,
  statusFilter = "all",
  productsOnly = false,
  onToggleFg,
  onToggleJob,
  busyKey,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  allFgs: FgDoc[];
  showTags?: boolean;
  statusFilter?: FlagStatusFilter;
  productsOnly?: boolean;
  onToggleFg: (fg: FgDoc) => void;
  onToggleJob: (job: JobDoc) => void;
  busyKey: string | null;
}) {
  const checkCls =
    "size-5 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-3";

  return (
    <ul className="divide-y divide-border/70">
      {/* flagged jobs: main task — their flagged products as completable subtasks */}
      {!productsOnly && data.jobs.filter((job) => matchesStatusFilter(statusFilter, job.status === "completed")).map((job) => {
        const jobProducts = allFgs
          .filter((f) => f.jobId === job._id || (f.jobIds ?? []).includes(job._id))
          .filter((f) => matchesStatusFilter(statusFilter, f.isCompleted ?? false));
        const done = job.status === "completed";
        const allFlaggedProducts = allFgs.filter(
          (f) => f.jobId === job._id || (f.jobIds ?? []).includes(job._id),
        );
        const allProductsDone =
          allFlaggedProducts.length > 0 &&
          allFlaggedProducts.every((f) => f.isCompleted);
        const disabled = busyKey !== null || (!done && !allProductsDone);
        return (
          <li key={job._id} className={cn("px-4 py-3", done && "opacity-60")}>
            <div className="flex flex-wrap items-center gap-2">
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
              <span className={tagChip}>{data.projectNameOf(job)}</span>
            </div>
            {jobProducts.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {jobProducts.map((fg) => (
                  <li
                    key={fg._id}
                    className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-2 py-1 pl-7 text-xs"
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
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        fg.isCompleted && "text-muted-foreground line-through",
                      )}
                    >
                      {fg.name}
                    </span>
                    {fg.code && (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                        {fg.code}
                      </span>
                    )}
                    {showTags && (
                      <>
                        <span className={tagChip}>{data.projectNameOf(job)}</span>
                        <span className={tagChip}>{job.name}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
      {/* flagged products whose job is not flagged: job shown as main, product as the completable subtask */}
      {data.fgs
        .filter((f) => matchesStatusFilter(statusFilter, f.isCompleted ?? false))
        .filter((f) => {
          const jobs = f.jobIds ?? (f.jobId ? [f.jobId] : []);
          return !jobs.some((jid) => data.jobs.some((j) => j._id === jid));
        })
        .map((fg) => {
          const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
          const parentJob = allJobs.find((j) => jobIds.includes(j._id));
          return (
            <li key={fg._id} className={cn("px-4 py-3", fg.isCompleted && "opacity-60")}>
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
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-medium",
                    fg.isCompleted && "text-muted-foreground line-through",
                  )}
                >
                  {fg.name}
                </span>
                {fg.code && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                    {fg.code}
                  </span>
                )}
                {showTags && parentJob && <span className={tagChip}>{parentJob.name}</span>}
              </div>
            </li>
          );
        })}
    </ul>
  );
}
/** Shared completion-status predicate for the flagged-view filters. */
function matchesStatusFilter(
  filter: FlagStatusFilter,
  isDone: boolean,
): boolean {
  if (filter === "open") return !isDone;
  if (filter === "done") return isDone;
  return true;
}

/**
 * Products-only flagged list: one flat card per flagged product (jobs are just
 * a small tag on the card), honoring the status filter. Same row layout as the
 * rest of the todo list so it reads as another list, not a different UI.
 */
function FlaggedProductsList({
  data,
  allJobs,
  statusFilter,
  showTags = false,
  onToggleFg,
  busyKey,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  statusFilter: FlagStatusFilter;
  showTags?: boolean;
  onToggleFg: (fg: FgDoc) => void;
  busyKey: string | null;
}) {
  const rows = data.fgs
    .filter((f) => matchesStatusFilter(statusFilter, f.isCompleted ?? false))
    .map((fg) => {
      const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
      const parentJob = allJobs.find((j) => jobIds.includes(j._id));
      return { fg, parentJob };
    });

  if (rows.length === 0) {
    return (
      <div className="px-6 py-10 text-center">
        <Package className="mx-auto size-7 text-muted-foreground/40" />
        <p className="mt-2 text-sm font-medium">
          {statusFilter === "done" ? "No completed products" : "No open products"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {statusFilter === "all"
            ? "Flag a product in the Projects page and it will show up here."
            : `Switch the status filter to “${statusFilter === "open" ? "Done" : "To do”}” to see the rest.`}
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
            "flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm",
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
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-medium",
              fg.isCompleted && "text-muted-foreground line-through",
            )}
          >
            {fg.name}
          </span>
          {fg.code && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
              {fg.code}
            </span>
          )}
          {parentJob && <span className={tagChip}>{parentJob.name}</span>}
          {showTags && parentJob && <span className={tagChip}>{data.projectNameOf(parentJob)}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Kanban columns for flagged work. */
type BoardColumn = "todo" | "in_progress" | "completed";
const BOARD_COLUMNS: { key: BoardColumn; label: string; icon: typeof Circle }[] = [
  { key: "todo", label: "To do", icon: Circle },
  { key: "in_progress", label: "In progress", icon: GanttChartSquare },
  { key: "completed", label: "Completed", icon: CheckCircle2 },
];
type BoardCard =
  | { kind: "job"; job: JobDoc; project: string }
  | { kind: "fg"; fg: FgDoc; jobName?: string; project: string };

const BOARD_CARD =
  "group/card relative flex cursor-grab flex-col gap-1.5 rounded-xl border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing";

function BoardCardView({
  card,
  busyKey,
  onToggleFg,
  onSetJobStatus,
}: {
  card: BoardCard;
  busyKey: string | null;
  onToggleFg: (fg: FgDoc) => void;
  onSetJobStatus: (job: JobDoc, status: BoardColumn) => void;
}) {
  const isJob = card.kind === "job";
  const done = isJob ? card.job.status === "completed" : (card.fg.isCompleted ?? false);
  const busy =
    busyKey === (isJob ? `j:${card.job._id}` : `f:${card.fg._id}`);
  return (
    <motion.div layout className={BOARD_CARD}>
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-0.5 rounded-t-xl",
          isJob ? "bg-sky-500/70" : "bg-violet-500/70",
        )}
      />
      <div className="flex items-start gap-1.5">
        <GripVertical className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/40 transition-colors group-hover/card:text-muted-foreground/70" />
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium leading-snug",
              done && "text-muted-foreground line-through",
            )}
          >
            {isJob ? card.job.name : card.fg.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
            {isJob ? (
              <>
                <Briefcase className="size-2.5 text-sky-500/80" /> Job
              </>
            ) : (
              <>
                <Package className="size-2.5 text-violet-500/80" />
                {card.jobName ?? "Product"}
              </>
            )}
            <span className="text-muted-foreground/50">·</span>
            <span className="truncate">{card.project}</span>
          </p>
        </div>
        {isJob ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Move job “${card.job.name}”`}
                disabled={busy}
                className="-mr-1 -mt-1 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover/card:opacity-100"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Columns3 className="size-3.5" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuLabel className="text-[11px] text-muted-foreground">
                Move job to
              </DropdownMenuLabel>
              {BOARD_COLUMNS.map((col) => (
                <DropdownMenuItem
                  key={col.key}
                  onClick={() => onSetJobStatus(card.job, col.key)}
                  className={cn(
                    "gap-2 text-xs",
                    col.key === "completed" && done && "opacity-50",
                  )}
                >
                  <col.icon
                    className={cn(
                      "size-3.5",
                      col.key === "completed" && "text-emerald-500",
                      col.key === "in_progress" && "text-sky-500",
                    )}
                  />
                  {col.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Checkbox
            checked={done}
            disabled={busy}
            onCheckedChange={() => onToggleFg(card.fg)}
            aria-label={
              done ? `Reopen product “${card.fg.name}”` : `Mark product “${card.fg.name}” as done`
            }
            className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-2.5"
          />
        )}
      </div>
      {isJob && (
        <div className="flex flex-wrap items-center gap-1">
          {done && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-2.5" /> Completed
            </span>
          )}
          {card.job.priority && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  card.job.priority === "high"
                    ? "bg-rose-500"
                    : card.job.priority === "medium"
                      ? "bg-amber-500"
                      : "bg-sky-500",
                )}
              />
              {card.job.priority}
            </span>
          )}
        </div>
      )}
    </motion.div>
  );
}

/**
 * Professional drag & drop kanban of the flagged work: jobs as Job cards,
 * products as Product cards. Dragging a product card between columns calls
 * setFgCompleted; dragging a job updates its status (jobs can only be marked
 * completed once every flagged product under them is done, same rule as the
 * list checkbox).
 */
function FlaggedBoard({
  data,
  allJobs,
  allFgs,
  statusFilter,
  onToggleFg,
  onToggleJob,
  onSetJobStatus,
  busyKey,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  allFgs: FgDoc[];
  statusFilter: FlagStatusFilter;
  onToggleFg: (fg: FgDoc) => void;
  onToggleJob: (job: JobDoc) => void;
  onSetJobStatus: (job: JobDoc, status: BoardColumn) => void;
  busyKey: string | null;
}) {
  const [dragging, setDragging] = useState<string | null>(null);

  const jobCards = data.jobs.map((job) => ({
    kind: "job" as const,
    job,
    project: data.projectNameOf(job),
  }));
  const productCards = data.fgs.map((fg) => {
    const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
    const parentJob = allJobs.find((j) => jobIds.includes(j._id));
    return {
      kind: "fg" as const,
      fg,
      jobName: parentJob?.name,
      project: parentJob
        ? data.projectNameOf(parentJob)
        : (fg.projectName ?? "Standalone"),
    };
  });

  const jobsTodo = jobCards.filter(
    (c) => c.job.status !== "completed" && c.job.status !== "in_progress",
  );
  const jobsInProgress = jobCards.filter((c) => c.job.status === "in_progress");
  const jobsCompleted = jobCards.filter((c) => c.job.status === "completed");
  const fgsByCol = (col: BoardColumn) =>
    productCards.filter((c) =>
      col === "completed" ? c.fg.isCompleted === true : col === "in_progress" ? false : true,
    );

  const colCards = (col: BoardColumn): BoardCard[] =>
    [...jobsByCol(col), ...fgsByCol(col)].filter((c) => {
      const done = c.kind === "job" ? c.job.status === "completed" : (c.fg.isCompleted ?? false);
      return matchesStatusFilter(statusFilter, done);
    });

  function jobsByCol(col: BoardColumn) {
    if (col === "todo") return jobsTodo;
    if (col === "in_progress") return jobsInProgress;
    return jobsCompleted;
  }

  const colCounts: Record<BoardColumn, number> = {
    todo: colCards("todo").length,
    in_progress: colCards("in_progress").length,
    completed: colCards("completed").length,
  };

  /** Board columns a card may legally be dropped into. */
  const dropTargets = (card: BoardCard): BoardColumn[] => {
    if (card.kind === "fg") return ["todo", "completed"];
    const products = allFgs.filter(
      (f) => f.jobId === card.job._id || (f.jobIds ?? []).includes(card.job._id),
    );
    const allProductsDone = products.length > 0 && products.every((f) => f.isCompleted);
    if (card.job.status === "completed") return ["todo", "in_progress"];
    return allProductsDone ? ["todo", "in_progress", "completed"] : ["todo", "in_progress"];
  };

  const handleDrop = (col: BoardColumn) => {
    if (!dragging) return;
    const jobCard = jobCards.find((c) => c.job._id === dragging);
    if (jobCard) {
      if (col === "completed") {
        // keep the same guard as the list: complete only when products are done
        onToggleJob(jobCard.job);
      } else if (col === "in_progress") {
        onSetJobStatus(jobCard.job, "in_progress");
      } else {
        onSetJobStatus(jobCard.job, "todo");
      }
    } else {
      const fgCard = productCards.find((c) => c.fg._id === dragging);
      if (fgCard && ((fgCard.fg.isCompleted ?? false) !== (col === "completed"))) {
        onToggleFg(fgCard.fg);
      }
    }
    setDragging(null);
  };

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {BOARD_COLUMNS.map((col) => {
        const cards = colCards(col.key);
        const droppable = dragging !== null && dropTargetsFor(col.key, dragging) && true;
        return (
          <section
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(col.key);
            }}
            className={cn(
              "flex min-h-56 flex-col rounded-2xl border bg-muted/30 shadow-sm transition-colors",
              droppable && "border-primary/50 bg-primary/[0.04] ring-2 ring-primary/20",
            )}
          >
            <header className="flex items-center gap-2 border-b border-border/60 px-3.5 py-2.5">
              <col.icon
                className={cn(
                  "size-4",
                  col.key === "completed"
                    ? "text-emerald-500"
                    : col.key === "in_progress"
                      ? "text-sky-500"
                      : "text-muted-foreground",
                )}
              />
              <h3 className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                {col.label}
              </h3>
              <span className="ml-auto rounded-full bg-background px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground shadow-sm">
                {colCounts[col.key]}
              </span>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              <AnimatePresence initial={false}>
                {cards.map((card) => {
                  const id = card.kind === "job" ? card.job._id : card.fg._id;
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
                        onSetJobStatus={onSetJobStatus}
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

  /** Guard: is this column a legal drop target for the dragged card? */
  function dropTargetsFor(col: BoardColumn, cardId: string): boolean {
    const jobCard = jobCards.find((c) => c.job._id === cardId);
    if (jobCard) return dropTargets(jobCard).includes(col);
    const fgCard = productCards.find((c) => c.fg._id === cardId);
    if (fgCard) {
      if (col === "in_progress") return false;
      return ((fgCard.fg.isCompleted ?? false) !== (col === "completed"));
    }
    return false;
  }
}

const PRIORITY_META: Record<Priority, { dot: string; chip: string }> = {
  high: { dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  medium: { dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  low: { dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
};

export default function TasksPanel({
  activeView,
  lists,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  canCreateSteps = true,
  canEditSteps = true,
  canDeleteSteps = true,
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
}) {
  const allTasks = useQuery(api.tasks.list);
  const allPages = useQuery(api.notebooks.listAllPages);
  const addTask = useMutation(api.tasks.add);
  const toggleTask = useMutation(api.tasks.toggle);
  const removeTask = useMutation(api.tasks.remove);
  const updateTask = useMutation(api.tasks.update);

  // flagged jobs & products (from the Projects section) for the Flagged view
  const flaggedJobs = useQuery(api.jobs.listJobs);
  const flaggedFgs = useQuery(api.costing.listFinishedGoods);
  const flaggedProjects = useQuery(api.costing.listProjects);
  const setFgCompletedM = useMutation(api.costing.setFgCompleted);
  const updateJobM = useMutation(api.jobs.updateJob);
  const [flaggedBusy, setFlaggedBusy] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<Id<"tasks"> | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("manual");

  // Flagged view: scope filter (all / products / jobs), completion filter and
  // list-vs-board presentation.
  const [flagFilter, setFlagFilter] = useState<FlagFilter>("all");
  const [flagStatus, setFlagStatus] = useState<FlagStatusFilter>("all");
  const [flagBoardMode, setFlagBoardMode] = useState(false);

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
          ? "Flagged"
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
    return { jobs, fgs, projectNameOf };
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
      if (job.status === "completed") {
        await updateJobM({ id: job._id, status: "in_progress" });
      } else {
        await updateJobM({ id: job._id, status: "completed" });
      }
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
  const handleBoardJobStatus = async (job: JobDoc, status: BoardColumn) => {
    const products = (flaggedFgs ?? []).filter(
      (f) => f.jobId === job._id || (f.jobIds ?? []).includes(job._id),
    );
    const allProductsDone =
      products.length > 0 && products.every((f) => f.isCompleted);
    setFlaggedBusy(`j:${job._id}`);
    try {
      if (status === "completed") {
        if (!allProductsDone) return;
        await updateJobM({ id: job._id, status: "completed" });
      } else if (status === "in_progress") {
        if (job.status !== "in_progress") {
          await updateJobM({ id: job._id, status: "in_progress" });
        }
      } else if (job.status === "completed") {
        await updateJobM({ id: job._id, status: "in_progress" });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't move the job.");
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
                ? (flaggedItems?.jobs.length ?? 0) + (flaggedItems?.fgs.length ?? 0)
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

      {/* ── Sort / filter controls ──────────────────────────────────── */}
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
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
        <section className="mt-3 overflow-hidden rounded-2xl border bg-card shadow-sm">
          {/* filter bar: scope, status, and list/board presentation */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <span className="mr-1">Show</span>
              {(
                [
                  ["all", "All"],
                  ["products", "Products"],
                  ["jobs", "Jobs"],
                ] as [FlagFilter, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFlagFilter(mode)}
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
              {(
                [
                  ["open", "To do"],
                  ["done", "Done"],
                  ["all", "Any status"],
                ] as [FlagStatusFilter, string][]
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFlagStatus(mode)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 transition-colors",
                    flagStatus === mode
                      ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                      : "border-border bg-card hover:bg-accent hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
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
                title="Board view"
              >
                <Columns3 className="size-3.5" />
              </button>
            </div>
          </div>
          {flaggedJobs === undefined || flaggedFgs === undefined ? (
            <div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading flagged items…
            </div>
          ) : flaggedItems === null ? (
            <div className="px-6 py-14 text-center">
              <Flag className="mx-auto size-8 text-amber-500/40" />
              <p className="mt-3 font-medium">Nothing flagged</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Flag a job or product in the Projects page and it will show up here.
              </p>
            </div>
          ) : flagBoardMode ? (
            <div className="p-3">
              <FlaggedBoard
                data={flaggedItems}
                allJobs={flaggedJobs ?? []}
                allFgs={flaggedFgs ?? []}
                statusFilter={flagStatus}
                onToggleFg={(fg) => void handleToggleFlaggedFg(fg)}
                onToggleJob={(job) => void handleToggleFlaggedJob(job)}
                onSetJobStatus={(job, status) => void handleBoardJobStatus(job, status)}
                busyKey={flaggedBusy}
              />
            </div>
          ) : flagFilter === "products" ? (
            <FlaggedProductsList
              data={flaggedItems}
              allJobs={flaggedJobs ?? []}
              statusFilter={flagStatus}
            onToggleFg={(fg) => void handleToggleFlaggedFg(fg)}
              busyKey={flaggedBusy}
            />
          ) : (
            <FlaggedItemsList
              data={flaggedItems}
              allJobs={flaggedJobs ?? []}
              allFgs={flaggedFgs ?? []}
              statusFilter={flagStatus}
              productsOnly={flagFilter === "jobs"}
              onToggleFg={(fg) => void handleToggleFlaggedFg(fg)}
              onToggleJob={(job) => void handleToggleFlaggedJob(job)}
              busyKey={flaggedBusy}
            />
          )}
        </section>
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
          {/* flagged jobs & products from the Projects section (main list only),
              with project & job name tags */}
          {activeView === null &&
            flaggedItems !== null &&
            flaggedJobs !== undefined &&
            flaggedFgs !== undefined && (
              <div className="border-b border-amber-500/20 bg-amber-500/[0.04]">
                <p className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[11px] font-semibold tracking-widest text-amber-700/80 uppercase dark:text-amber-400/80">
                  <Flag className="size-3 fill-current" />
                  Flagged from projects
                </p>
                <FlaggedItemsList
                  data={flaggedItems}
                  allJobs={flaggedJobs}
                  allFgs={flaggedFgs}
                  showTags
                  onToggleFg={(fg) => void handleToggleFlaggedFg(fg)}
                  onToggleJob={(job) => void handleToggleFlaggedJob(job)}
                  busyKey={flaggedBusy}
                />
              </div>
            )}
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
