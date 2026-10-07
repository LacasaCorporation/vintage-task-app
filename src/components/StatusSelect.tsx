import { ChevronDown } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  isStageStatus,
  projectStatusDetailsOrDefaults,
  stageStatusColor,
  statusColor,
} from "@/lib/project-statuses";
import { cn } from "@/lib/utils";

/**
 * The status chip in a list row, turned into a dropdown: it looks like the
 * other chips but opens the workflow's own statuses, so a product or job can
 * be moved along without opening its details. A native select is used on
 * purpose — it works with keyboard, mobile pickers and screen readers, and
 * needs no popover to sit inside a dense row.
 *
 * `projectColors` wears the dot of the Projects workflow: the status's own
 * colour if it has one, its place in the run if it does not. Other selects
 * (the sales pipeline, say) pass nothing and stay as they were, since a
 * coloured dot borrowed from another list's statuses would only mislead.
 */
export default function StatusSelect({
  value,
  statuses,
  onChange,
  disabled = false,
  title,
  allLabel,
  size = "sm",
  projectColors = false,
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
  /** Dress the selected status in the Projects workflow's colour. */
  projectColors?: boolean;
}) {
  const details = projectStatusDetailsOrDefaults(
    useQuery(api.settings.listProjectStatusDetails),
  );
  // the colour is read against the whole workflow rather than the statuses on
  // offer here: a row's dropdown only lists the middle statuses, and a colour
  // worked out from that shorter list would disagree with the board column the
  // very same status wears
  const workflow = details.map((detail) => detail.name);
  const index = workflow.indexOf(value);
  const color = !projectColors
    ? null
    : index >= 0
      ? statusColor(details, value, index, workflow.length)
      : // a job or project stage the product workflow does not carry takes
        // the colour of the stage itself
        isStageStatus(value)
        ? stageStatusColor(value)
        : null;
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
          "cursor-pointer appearance-none truncate rounded-full border bg-card pr-6 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
          size === "sm"
            ? "h-5 max-w-40 border-border/70 bg-muted py-0 pl-1.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
            : "h-8 border-border py-1 pl-2.5 text-xs font-medium",
          // room for the colour dot, which paints over the chip's background
          color !== null && (size === "sm" ? "pl-[17px]" : "pl-[19px]"),
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
      {color !== null && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute rounded-full",
            color.fill,
            size === "sm" ? "left-1.5 size-1.5" : "left-2 size-2",
          )}
        />
      )}
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
