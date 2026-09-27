import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type PageTab<T extends string> = {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** Shown after the label, muted — a list length, a total, whatever. */
  count?: number | string;
  hint?: string;
};

/**
 * The one sub-navigation bar every working area uses.
 *
 * Sales, Purchase, Projects and Accounts each drew their own copy of this
 * button, so the four drifted apart in padding, active colour and spacing
 * while doing the same job. One component keeps them identical, and keeps the
 * pages themselves free of markup that says nothing about their content.
 *
 * Deliberately a group of pressed buttons rather than an ARIA tablist: these
 * swap a whole page of content and carry their own headings, so `aria-pressed`
 * describes them honestly without promising a tabpanel that isn't there.
 */
export default function PageTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  label = "Sections",
  size = "sm",
}: {
  tabs: readonly PageTab<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  label?: string;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1 shadow-sm",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={active}
            title={tab.hint}
            onClick={() => onChange(tab.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors",
              "focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none",
              size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {Icon && <Icon className="size-3.5 shrink-0" />}
            <span className="whitespace-nowrap">{tab.label}</span>
            {tab.count !== undefined && (
              <span className="tabular-nums opacity-60">{tab.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
