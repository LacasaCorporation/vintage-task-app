import type { Doc } from "@/convex/_generated/dataModel";
import {
  ChevronDown,
  Folder,
  Layers,
  Package,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ACCOUNTING_TABS,
  type AccountingTab,
} from "@/components/AccountingPanel";

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
  | { kind: "accounting"; tab: AccountingTab }
  | null;

/** What you stock and what you sell — the two halves of the inventory group. */
export type InventoryTab = "materials" | "products";

const INVENTORY_TABS: {
  id: InventoryTab;
  label: string;
  icon: typeof Layers;
  count: (fg: FgDoc[], materials: MaterialDoc[]) => number;
  unit: string;
}[] = [
  { id: "materials", label: "Raw materials", icon: Layers, count: (_f, m) => m.length, unit: "item" },
  { id: "products", label: "Products", icon: Package, count: (f) => f.length, unit: "product" },
];

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
  showAccounting = true,
  purchaseCount = 0,
  salesCount = 0,
  accountCount = 0,
}: {
  finishedGoods: FgDoc[];
  materials: MaterialDoc[];
  view: CostingView;
  onSelectView: (view: CostingView) => void;
  onMaterialsClick: () => void;
  showMaterials?: boolean;
  showPurchase?: boolean;
  showSales?: boolean;
  showAccounting?: boolean;
  purchaseCount?: number;
  salesCount?: number;
  accountCount?: number;
}) {
  const [accountingOpen, setAccountingOpen] = useState(true);
  const [inventoryOpen, setInventoryOpen] = useState(true);
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

      {/* inventory: what you stock and what you sell, as one collapsible group */}
      {showMaterials && (
        <>
          <button
            type="button"
            onClick={() => setInventoryOpen((v) => !v)}
            aria-expanded={inventoryOpen}
            className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 pb-1 text-left transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3 shrink-0 text-muted-foreground/60 transition-transform",
                !inventoryOpen && "-rotate-90",
              )}
            />
            <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Inventory
            </span>
            <span
              className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground"
              title={`${materials.length} raw materials · ${finishedGoods.length} products`}
            >
              {materials.length + finishedGoods.length}
            </span>
          </button>

          {inventoryOpen && (
            <div className="ml-3 border-l border-border/60 pl-1">
              {INVENTORY_TABS.map((t) => {
                const Icon = t.icon;
                const count = t.count(finishedGoods, materials);
                const active =
                  view?.kind === (t.id === "materials" ? "materials" : "products");
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => {
                      if (t.id === "materials") onMaterialsClick();
                      else onSelectView({ kind: "products" });
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 pl-2 text-left transition-colors",
                      active ? "bg-primary/10" : "hover:bg-accent",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-3.5 shrink-0",
                        active ? "text-primary" : "text-muted-foreground/70",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs",
                        active ? "font-medium text-primary" : "text-foreground/85",
                      )}
                    >
                      {t.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 text-[10px] font-medium tabular-nums",
                        active
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* accounting: a group of ledger sub-pages under one collapsible head */}
      {showAccounting && (
        <>
          <button
            type="button"
            onClick={() => setAccountingOpen((v) => !v)}
            aria-expanded={accountingOpen}
            className="mt-3 flex w-full items-center gap-2 rounded-lg px-2 pb-1 text-left transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3 shrink-0 text-muted-foreground/60 transition-transform",
                !accountingOpen && "-rotate-90",
              )}
            />
            <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Accounting
            </span>
            <span
              className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground"
              title={`${accountCount} ledger accounts`}
            >
              {accountCount}
            </span>
          </button>

          {accountingOpen && (
            <div className="ml-3 border-l border-border/60 pl-1">
              {ACCOUNTING_TABS.map((t) => {
                const Icon = t.icon;
                const active =
                  view?.kind === "accounting" && view.tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    title={t.hint}
                    aria-current={active ? "true" : undefined}
                    onClick={() => onSelectView({ kind: "accounting", tab: t.id })}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 pl-2 text-left transition-colors",
                      active ? "bg-primary/10" : "hover:bg-accent",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-3.5 shrink-0",
                        active ? "text-primary" : "text-muted-foreground/70",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs",
                        active
                          ? "font-medium text-primary"
                          : "text-foreground/85",
                      )}
                    >
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
