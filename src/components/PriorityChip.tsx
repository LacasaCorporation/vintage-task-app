import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/task-utils";

/** Same colours the task rows use, so a priority means the same thing. */
const PRIORITY_META: Record<Priority, { dot: string; chip: string }> = {
  high: {
    dot: "bg-rose-500",
    chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  },
  medium: {
    dot: "bg-amber-500",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  low: {
    dot: "bg-sky-500",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
};

/**
 * A priority spelled out — "High", "Medium", "Low" — rather than a bare dot,
 * so it can be read at a glance without hovering. Sits after the due date on
 * list rows, and renders nothing when no priority is set.
 */
export default function PriorityChip({
  priority,
  className,
}: {
  priority: Priority | undefined;
  className?: string;
}) {
  if (priority === undefined) return null;
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        meta.chip,
        className,
      )}
      title={`Priority: ${priority}`}
    >
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {priority[0]!.toUpperCase() + priority.slice(1)}
    </span>
  );
}
