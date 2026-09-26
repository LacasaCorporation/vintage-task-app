import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The status chip in a list row, turned into a dropdown: it looks like the
 * other chips but opens the workflow's own statuses, so a product or job can
 * be moved along without opening its details. A native select is used on
 * purpose — it works with keyboard, mobile pickers and screen readers, and
 * needs no popover to sit inside a dense row.
 */
export default function StatusSelect({
  value,
  statuses,
  onChange,
  disabled = false,
  title,
  allLabel,
  size = "sm",
}: {
  value: string;
  statuses: string[];
  onChange: (next: string) => void;
  disabled?: boolean;
  title?: string;
  /** Adds an "any of these" first option, e.g. a status filter. */
  allLabel?: string;
  /** "sm" is the row chip; "md" is the toolbar dropdown. */
  size?: "sm" | "md";
}) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center"
      // a disabled <select> swallows its own events, so the reason it is
      // locked has to be on the wrapper to be hoverable
      title={title ?? "Change the status"}
    >
      <select
        value={value}
        disabled={disabled || statuses.length === 0}
        onChange={(e) => onChange(e.target.value)}
        aria-label={allLabel ?? "Status"}
        className={cn(
          "cursor-pointer appearance-none truncate rounded-full border bg-card pr-6 pl-2.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          size === "sm"
            ? "h-5 max-w-40 border-border/70 bg-muted py-0 pl-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
            : "h-8 border-border py-1 text-xs font-medium",
          value === "all" && size === "md" && "text-sky-700 dark:text-sky-400",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {allLabel !== undefined && <option value="all">{allLabel}</option>}
        {statuses.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-2 text-muted-foreground",
          size === "sm" ? "size-2.5 right-1" : "size-3.5",
        )}
      />
    </span>
  );
}
