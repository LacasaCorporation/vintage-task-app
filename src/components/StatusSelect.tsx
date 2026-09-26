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
}: {
  value: string;
  statuses: string[];
  onChange: (next: string) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <select
        value={statuses.includes(value) ? value : statuses[0] ?? value}
        disabled={disabled || statuses.length === 0}
        onChange={(e) => onChange(e.target.value)}
        title={title ?? "Change the status"}
        aria-label="Status"
        className={cn(
          "h-5 max-w-40 cursor-pointer appearance-none truncate rounded-full border border-border/70 bg-muted py-0 pr-4 pl-1.5 text-[10px] font-medium text-muted-foreground outline-none transition-colors hover:border-border hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {statuses.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-1 size-2.5 text-muted-foreground"
      />
    </span>
  );
}
