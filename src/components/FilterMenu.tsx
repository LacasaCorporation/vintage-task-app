import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type FilterOption<T extends string> = {
  value: T;
  label: string;
  /** Shown under the label in the dropdown, e.g. what the option means. */
  hint?: string;
};

/**
 * A filter button that shows the active choice in the trigger and marks it
 * with a tick in the menu, so the current filter is never a guess.
 */
export default function FilterMenu<T extends string>({
  value,
  options,
  onChange,
  label = "Filter",
  icon: Icon = SlidersHorizontal,
  activeClassName,
  className,
}: {
  value: T;
  options: readonly FilterOption<T>[];
  onChange: (next: T) => void;
  label?: string;
  icon?: typeof Check;
  /** Style for the trigger while a non-default filter is on. */
  activeClassName?: string;
  className?: string;
}) {
  const active = options.find((option) => option.value === value) ?? options[0];
  const isDefault = active !== undefined && active.value === options[0]?.value;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-7 shrink-0 gap-1.5 rounded-lg px-2 text-xs",
            !isDefault &&
              (activeClassName ??
                "border-primary/40 bg-primary/10 text-primary hover:bg-primary/10"),
            className,
          )}
          title={`${label}: ${active?.label ?? ""}`}
        >
          <Icon className="size-3" />
          <span className="max-w-32 truncate">{active?.label ?? label}</span>
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-[11px] tracking-wide uppercase">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className="flex items-start gap-2"
          >
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center">
              {option.value === value && <Check className="size-3.5 text-primary" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{option.label}</span>
              {option.hint && (
                <span className="block text-[11px] text-muted-foreground">
                  {option.hint}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
