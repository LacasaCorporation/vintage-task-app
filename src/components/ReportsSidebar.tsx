import type { ReportsArea } from "@/components/CostingSidebar";
import type { LucideIcon } from "lucide-react";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import {
  BookOpen,
  Package,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: readonly PageTab<ReportsArea>[] = [
  {
    id: "financial",
    label: "Financial",
    icon: BookOpen,
    hint: "Trial balance, balance sheet, profit and loss, day book",
  },
  {
    id: "sales",
    label: "Sales",
    icon: ShoppingCart,
    hint: "By product, by customer, over time, and what is still unpaid",
  },
  {
    id: "purchase",
    label: "Purchase",
    icon: Receipt,
    hint: "By supplier, by material, over time, and what is still unpaid",
  },
  {
    id: "stock",
    label: "Stock",
    icon: Package,
    hint: "What the shelves are worth, and what moved",
  },
];

export default function ReportsSidebar({
  area,
  onChange,
}: {
  area: ReportsArea;
  onChange: (area: ReportsArea) => void;
}) {
  return (
    <div className="ml-5 border-l border-border/60 pl-1">
      {TABS.map((tab) => {
        const active = tab.id === area;
        const Icon = tab.icon as LucideIcon | undefined;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
              active ? "bg-primary/10" : "hover:bg-accent",
            )}
          >
            {Icon && (
              <Icon
                className={cn(
                  "size-4 shrink-0",
                  active ? "text-primary" : "text-muted-foreground/70",
                )}
              />
            )}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                active ? "font-medium text-primary" : "text-foreground/85",
              )}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
