import type { Doc } from "@/convex/_generated/dataModel";
import {
  Folder,
  Layers,
  Package,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";

type FgDoc = Doc<"finishedGoods">;
type MaterialDoc = Doc<"rawMaterials">;

/** What's open in the main area: raw-materials, purchase, sales, products, projects, or one FG product. */
export type CostingView =
  | { kind: "materials" }
  | { kind: "purchase" }
  | { kind: "sales" }
  | { kind: "products" }
  | { kind: "projects" }
  | { kind: "fg"; fgId: FgDoc["_id"] }
  | null;

/** Sidebar: top-level navigation into the costing areas of the workspace. */
export default function CostingSidebar({
  finishedGoods,
  materials,
  view,
  onSelectView,
  onMaterialsClick,
  showMaterials = true,
  showPurchase = true,
  showSales = true,
  purchaseCount = 0,
  salesCount = 0,
}: {
  finishedGoods: FgDoc[];
  materials: MaterialDoc[];
  view: CostingView;
  onSelectView: (view: CostingView) => void;
  onMaterialsClick: () => void;
  showMaterials?: boolean;
  showPurchase?: boolean;
  showSales?: boolean;
  purchaseCount?: number;
  salesCount?: number;
}) {
  /** How many distinct projects the finished goods are grouped under. */
  const projectCount = useMemo(
    () => new Set(finishedGoods.map((fg) => fg.projectName ?? "Standalone")).size,
    [finishedGoods],
  );

  /** Top-level navigation: projects · products · raw materials · purchase · sales. */
  const navItems = [
    {
      id: "projects" as const,
      label: "Projects",
      icon: Folder,
      count: projectCount,
      unit: "project",
      active: view?.kind === "projects" || view === null,
      onClick: () => onSelectView({ kind: "projects" }),
    },
    {
      id: "products" as const,
      label: "Products",
      icon: Package,
      count: finishedGoods.length,
      unit: "product",
      active: view?.kind === "products",
      onClick: () => onSelectView({ kind: "products" }),
    },
    ...(showMaterials
      ? [
          {
            id: "materials" as const,
            label: "Raw materials",
            icon: Layers,
            count: materials.length,
            unit: "item",
            active: view?.kind === "materials",
            onClick: onMaterialsClick,
          },
        ]
      : []),
    ...(showPurchase
      ? [
          {
            id: "purchase" as const,
            label: "Purchase",
            icon: Receipt,
            count: purchaseCount,
            unit: "bill",
            active: view?.kind === "purchase",
            onClick: () => onSelectView({ kind: "purchase" }),
          },
        ]
      : []),
    ...(showSales
      ? [
          {
            id: "sales" as const,
            label: "Sales",
            icon: ShoppingCart,
            count: salesCount,
            unit: "bill",
            active: view?.kind === "sales",
            onClick: () => onSelectView({ kind: "sales" }),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Costing
        </span>
      </div>

      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            aria-current={item.active ? "true" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
              item.active ? "bg-primary/10" : "hover:bg-accent",
            )}
          >
            <Icon
              className={cn(
                "size-4 shrink-0",
                item.active ? "text-primary" : "text-muted-foreground/70",
              )}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-sm",
                item.active ? "font-medium text-primary" : "text-foreground/85",
              )}
            >
              {item.label}
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums",
                item.active
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
              title={`${item.count} ${item.unit}${item.count === 1 ? "" : "s"}`}
            >
              {item.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
