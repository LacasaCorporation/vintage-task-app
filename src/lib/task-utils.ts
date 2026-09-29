import type { Doc, Id } from "@/convex/_generated/dataModel";

export type TaskDoc = Doc<"tasks">;
export type StepDoc = Doc<"taskSteps">;
export type Priority = "high" | "medium" | "low";

/**
 * Ranking and colours for a priority.
 *
 * These sat in the flagged-lists screen, which is a large file of boards and
 * lists; the task list only wanted the two lookup tables, and importing them
 * from there dragged the whole screen into the first download.
 */
export const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export const PRIORITY_META: Record<Priority, { dot: string; chip: string }> = {
  high: { dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  medium: { dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  low: { dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
};

/** Which list a task belongs to; how a list of tasks is ordered. */
export type ListId = Id<"taskLists">;
export type SortMode = "manual" | "due" | "priority" | "created";
export type Recurrence = "daily" | "weekly" | "monthly";

export const PRIORITIES: { value: Priority; label: string; dot: string; chip: string }[] = [
  { value: "high", label: "High", dot: "bg-rose-500", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
  { value: "medium", label: "Medium", dot: "bg-amber-500", chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  { value: "low", label: "Low", dot: "bg-sky-500", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
];

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
};

/** Parse "#tag @list" tokens out of the quick-add text. */
export function parseQuickAdd(raw: string): {
  text: string;
  tags: string[];
} {
  const tags: string[] = [];
  const text = raw
    .replace(/#([\w-]+)/g, (_m, tag: string) => {
      tags.push(tag.toLowerCase());
      return "";
    })
    .replace(/\s{2,}/g, " ")
    .trim();
  return { text, tags };
}

/** Attachment shape stored as JSON in the task row. */
export type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string; // data URL
};

export function parseAttachments(json: string | undefined): Attachment[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function isToday(ts: number) {
  const d = new Date(ts);
  const today = startOfDay(new Date()).getTime();
  return d.getTime() >= today && d.getTime() < today + 86_400_000;
}

export function isOverdue(task: TaskDoc) {
  return (
    !task.isCompleted &&
    task.dueAt !== undefined &&
    task.dueAt < startOfDay(new Date()).getTime()
  );
}

export function isDueToday(task: TaskDoc) {
  return task.dueAt !== undefined && isToday(task.dueAt);
}

/** "just now" / "12m ago" / "3h ago" / "2d ago" / "12 Sep" — for chat and history. */
export function timeAgoLabel(ts: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
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

/** Human label like "Today 3:00 PM", "Tomorrow", "Mon, Sep 24 · 9:00 AM". */
/**
 * A due date reads as a day, not a moment: "Wed, Sep 30" rather than
 * "Wed, Sep 30 · 11:32 AM". The time is still picked in the date field, it
 * just isn't shouted on every row.
 */
export function formatDueLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today0 = startOfDay(now).getTime();
  const diffDays = Math.round((startOfDay(d).getTime() - today0) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Default datetime-local value (next hour) for a new due date. */
export function defaultDueLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d);
}

/** Compact creation label: "Today 2:14 PM", "Yesterday", "Sep 18". */
export function formatCreatedLabel(ts: number): string {
  const d = new Date(ts);
  if (isToday(ts)) {
    return `Today ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  const diffDays = Math.round(
    (startOfDay(new Date()).getTime() - startOfDay(d).getTime()) / 86_400_000,
  );
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Days since creation, e.g. "0d", "3d", "12d" — counted in whole calendar
 * days, so something created yesterday reads "1d" even when only a few hours
 * have passed. Stops at the completion moment when the task is done.
 */
export function ageDaysLabel(createdAt: number, completedAt?: number): string {
  const end = completedAt ?? Date.now();
  const days = Math.max(
    0,
    Math.round(
      (startOfDay(new Date(end)).getTime() -
        startOfDay(new Date(createdAt)).getTime()) /
        86_400_000,
    ),
  );
  return `${days}d`;
}

export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "5 minutes before" offsets offered in the reminder picker. */
export const REMINDER_OFFSETS: { minutes: number | null; label: string }[] = [
  { minutes: null, label: "At due time" },
  { minutes: 5, label: "5 min before" },
  { minutes: 15, label: "15 min before" },
  { minutes: 30, label: "30 min before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
];
