import { cn } from "@/lib/utils";
import type { Priority } from "@/lib/task-utils";

/** Same colours the task rows use, so a priority means the same thing. */
const PRIORITY_DOT: Record<Priority, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
};

/**
 * A product's priority and tags, inline after its name: a coloured dot for
 * the priority and a small chip per tag. Renders nothing when the product has
 * neither, so plain rows are untouched.
 */
export default function ProductMetaInline({
  priority,
  tags,
  className,
}: {
  priority: Priority | undefined;
  tags: string[] | undefined;
  className?: string;
}) {
  const list = (tags ?? []).filter(Boolean);
  if (priority === undefined && list.length === 0) return null;
  return (
    <span className={cn("flex min-w-0 shrink items-center gap-1", className)}>
      {priority !== undefined && (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", PRIORITY_DOT[priority])}
          title={`Priority: ${priority}`}
        />
      )}
      {list.map((tag) => (
        <span
          key={tag}
          className="max-w-24 shrink-0 truncate rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground"
          title={`Tag: ${tag}`}
        >
          {tag}
        </span>
      ))}
    </span>
  );
}
