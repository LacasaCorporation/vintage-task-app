import { useState } from "react";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type PickerItem = {
  id: string;
  /** Primary text — the name. */
  label: string;
  /** Secondary text (code, category…). Also matched by the search box. */
  sub?: string;
  /** Right-aligned meta (price, unit, stock…). Also matched by the search box. */
  hint?: string;
  /** Never offered to the user, but still matched by the search box. */
  keywords?: string;
};

type ItemPickerProps = {
  items: PickerItem[];
  /** "" means nothing selected. */
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Adds a "create" row; receives whatever was typed so a dialog can prefill. */
  onCreateNew?: (query: string) => void;
  createNewLabel?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  /** Extra classes for the dropdown itself — widen it for a specific screen. */
  contentClassName?: string;
  "aria-label"?: string;
};

/** Word-boundary-ish contains, so "bms" finds "BMS Panel" but not "abmso". */
function matches(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Searchable combobox used for every material / product / item dropdown.
 * Replaces the old native <select>, which had no find option and got
 * unusable once a firm had more than a few dozen materials.
 */
export default function ItemPicker({
  items,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search by name or code…",
  emptyLabel = "No matches found.",
  onCreateNew,
  createNewLabel,
  disabled,
  size = "md",
  className,
  contentClassName,
  "aria-label": ariaLabel,
}: ItemPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = items.find((i) => i.id === value);

  // cmdk's own filter would only see the rendered children, so we do it here
  // and keep every searchable field in the item's `value`.
  const term = query.trim();
  const shown = term
    ? items.filter((i) =>
        [i.label, i.sub, i.hint, i.keywords]
          .filter((v): v is string => typeof v === "string" && v !== "")
          .some((v) => matches(v, term)),
      )
    : items;

  const createLabel = createNewLabel ?? (term ? `Create “${term}”` : "Create new…");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery("");
      }}
    >
      <div className={cn("relative min-w-0", className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={ariaLabel ?? placeholder}
            className={cn(
              "flex w-full min-w-0 items-center gap-1 rounded-lg border bg-card text-left",
              "outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              "disabled:cursor-not-allowed disabled:opacity-50",
              size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-2.5 text-sm",
              selected ? "pr-14" : "pr-7",
            )}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                selected ? "" : "text-muted-foreground",
              )}
            >
              {selected ? selected.label : placeholder}
            </span>
            <ChevronDown
              className="pointer-events-none size-3.5 shrink-0 opacity-50"
              aria-hidden
            />
          </button>
        </PopoverTrigger>
        {selected && !disabled && (
          <button
            type="button"
            aria-label={`Clear ${selected.label}`}
            title="Clear"
            onClick={() => onChange("")}
            className="absolute top-1/2 right-6 grid size-4 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      <PopoverContent
        align="start"
        collisionPadding={8}
        className={cn(
          // A trigger can be a narrow table cell, so the menu is allowed to be
          // wider than it. A row carries a name, a code, a category, the stock
          // on hand and a price, and none of that reads in 280px: the menu
          // takes a comfortable width, never narrower than its own trigger,
          // and never wider than the room the viewport actually has.
          "w-96 min-w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-content-available-width)] p-0",
          contentClassName,
        )}
      >
        <Command
          shouldFilter={false}
          loop
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-1"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={searchPlaceholder}
            className="h-9 py-0 text-sm"
          />
          <CommandList className="max-h-64 p-1">
            {shown.length === 0 && onCreateNew === undefined ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                {emptyLabel}
              </p>
            ) : (
              <CommandEmpty>{emptyLabel}</CommandEmpty>
            )}
            <CommandGroup heading={term ? "Matches" : undefined}>
              {shown.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.sub ?? ""} ${item.hint ?? ""} ${item.keywords ?? ""}`}
                  onSelect={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-3.5 shrink-0",
                      item.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.label}</span>
                    {item.sub && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.sub}
                      </span>
                    )}
                  </span>
                  {item.hint && (
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {item.hint}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
            {onCreateNew && (
              <CommandGroup heading="New">
                <CommandItem
                  value={`create new add ${term}`}
                  onSelect={() => {
                    setOpen(false);
                    onCreateNew(term);
                  }}
                >
                  <Plus className="size-3.5 shrink-0" />
                  <span className="truncate">{createLabel}</span>
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
