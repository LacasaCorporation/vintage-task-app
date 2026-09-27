import type { Doc } from "@/convex/_generated/dataModel";
import {
  BookOpen,
  Boxes,
  CheckSquare,
  ChevronDown,
  Folder,
  Layers,
  NotebookPen,
  Package,
  Receipt,
  ShoppingCart,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { CostingView } from "@/components/CostingSidebar";
import { ACCOUNTING_TABS } from "@/components/AccountingPanel";
import { cn } from "@/lib/utils";

type FgDoc = Doc<"finishedGoods">;
type MaterialDoc = Doc<"rawMaterials">;

export type PrimarySection = "tasks" | "notes" | "costing" | "settings";

const rowCls = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors";
const subRowCls = "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors";
const countCls =
  "shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground";

/** One line in the navigation list. */
function NavRow({
  label,
  Icon,
  active,
  n,
  onClick,
  sub = false,
}: {
  label: string;
  Icon: typeof Folder;
  active: boolean;
  n?: number;
  onClick: () => void;
  /** The smaller rows nested under a group heading. */
  sub?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(sub ? subRowCls : rowCls, active ? "bg-primary/10" : "hover:bg-accent")}
    >
      <Icon
        className={cn(
          sub ? "size-3.5 shrink-0" : "size-4 shrink-0",
          active ? "text-primary" : "text-muted-foreground/70",
        )}
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          sub ? "text-xs" : "text-sm",
          active && "font-medium text-primary",
        )}
      >
        {label}
      </span>
      {n !== undefined && <span className={countCls}>{n}</span>}
    </button>
  );
}

/**
 * The workspace's one navigation list. It replaces the row of pills that used
 * to sit across the top of the page, so the whole app is reachable from the
 * side and the header can give its height back to the content.
 *
 * Order is deliberate: what you plan (tasks, notes) first, then what you buy,
 * build, sell and account for. Settings lives with the account footer rather
 * than in this list, so it is never confused with a working area.
 */
export default function PrimaryNav({
  section,
  view,
  finishedGoods,
  materials,
  purchaseCount,
  salesCount,
  accountCount,
  onSelectSection,
  onSelectView,
  canViewMaterials,
  canViewPurchase,
  canViewSales,
  canViewAccounting,
}: {
  section: PrimarySection;
  view: CostingView;
  finishedGoods: FgDoc[];
  materials: MaterialDoc[];
  purchaseCount: number;
  salesCount: number;
  accountCount: number;
  onSelectSection: (section: PrimarySection) => void;
  onSelectView: (view: CostingView) => void;
  canViewMaterials: boolean;
  canViewPurchase: boolean;
  canViewSales: boolean;
  canViewAccounting: boolean;
}) {
  // collapsed by default: the two stock lists are a second step, not the
  // place the sidebar starts
  const [inventoryOpen, setInventoryOpen] = useState(false);
  // the Accounts drill-down opens on its own whenever you are inside it
  const [accountsExpanded, setAccountsExpanded] = useState(false);
  const inCosting = section === "costing";
  const projectCount = useMemo(
    () => new Set(finishedGoods.map((fg) => fg.projectName ?? "Standalone")).size,
    [finishedGoods],
  );
  const onMaterials = view?.kind === "materials";
  const onProducts = view?.kind === "products";
  const inAccounting = inCosting && view?.kind === "accounting";
  /**
   * The header row IS "Chart of accounts", so it is left out of the
   * drill-down. That way exactly one row is ever highlighted: the header when
   * the chart is open, one child when any other page is.
   */
  const accountsActive = inAccounting && view?.tab === "accounts";
  // Entering Accounts opens the list once. After that the row is an ordinary
  // disclosure again, so a second click can close it — folding "you are
  // inside it" into the same expression would pin it open for good.
  const [wasInAccounting, setWasInAccounting] = useState(inAccounting);
  if (wasInAccounting !== inAccounting) {
    setWasInAccounting(inAccounting);
    if (inAccounting) setAccountsExpanded(true);
  }

  return (
    <div className="flex flex-col gap-0.5">
      <NavRow
        label="Tasks"
        Icon={CheckSquare}
        active={section === "tasks"}
        onClick={() => onSelectSection("tasks")}
      />
      <NavRow
        label="Notes"
        Icon={NotebookPen}
        active={section === "notes"}
        onClick={() => onSelectSection("notes")}
      />

      <div className="my-2 h-px bg-border/60" />

      {canViewPurchase && (
        <NavRow
          label="Purchase"
          Icon={Receipt}
          active={inCosting && view?.kind === "purchase"}
          n={purchaseCount}
          onClick={() => onSelectView({ kind: "purchase" })}
        />
      )}
      <NavRow
        label="Projects"
        Icon={Folder}
        active={inCosting && (view?.kind === "projects" || view === null)}
        n={projectCount}
        onClick={() => onSelectView({ kind: "projects" })}
      />
      {canViewSales && (
        <NavRow
          label="Sales"
          Icon={ShoppingCart}
          active={inCosting && view?.kind === "sales"}
          n={salesCount}
          onClick={() => onSelectView({ kind: "sales" })}
        />
      )}
      {/* accounts: a group whose header is the chart of accounts itself */}
      {canViewAccounting && (
        <div className="mt-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1 transition-colors",
              accountsActive ? "bg-primary/10" : "hover:bg-accent",
            )}
          >
            <button
              type="button"
              onClick={() => setAccountsExpanded((v) => !v)}
              aria-expanded={accountsExpanded}
              title={accountsExpanded ? "Hide the Accounts pages" : "Show the Accounts pages"}
              aria-label={
                accountsExpanded ? "Hide the Accounts pages" : "Show the Accounts pages"
              }
              className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
            >
              <ChevronDown
                className={cn(
                  "size-3 transition-transform",
                  !accountsExpanded && "-rotate-90",
                )}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                // already showing the chart with the list open: this click
                // closes it, the same as the chevron
                if (accountsActive && accountsExpanded) {
                  setAccountsExpanded(false);
                  return;
                }
                setAccountsExpanded(true);
                onSelectView({ kind: "accounting", tab: "accounts" });
              }}
              title={
                accountsActive && accountsExpanded
                  ? "Hide the Accounts pages"
                  : "Open the chart of accounts"
              }
              aria-expanded={accountsExpanded}
              aria-current={accountsActive ? "page" : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
            >
              <BookOpen
                className={cn(
                  "size-4 shrink-0",
                  accountsActive ? "text-primary" : "text-muted-foreground/70",
                )}
              />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  accountsActive ? "font-medium text-primary" : "text-foreground/85",
                )}
              >
                Accounts
              </span>
              <span className={countCls}>{accountCount}</span>
            </button>
          </div>

          {accountsExpanded && (
            <div className="ml-3 border-l border-border/60 pl-1">
              {ACCOUNTING_TABS.filter((t) => t.id !== "accounts").map((t) => (
                <NavRow
                  key={t.id}
                  label={t.label}
                  Icon={t.icon}
                  active={inAccounting && view?.tab === t.id}
                  sub
                  onClick={() => onSelectView({ kind: "accounting", tab: t.id })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* inventory: what you stock and what you sell, as one collapsible group */}
      {canViewMaterials && (
        <>
          <button
            type="button"
            onClick={() => setInventoryOpen((v) => !v)}
            aria-expanded={inventoryOpen}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-accent"
          >
            <ChevronDown
              className={cn(
                "size-3 shrink-0 text-muted-foreground/60 transition-transform",
                !inventoryOpen && "-rotate-90",
              )}
            />
            <Layers className="size-3.5 shrink-0 text-muted-foreground/70" />
            <span className="text-sm text-foreground/85">Inventory</span>
            <span className={cn(countCls, "ml-auto")}>
              {materials.length + finishedGoods.length}
            </span>
          </button>

          {inventoryOpen && (
            <div className="ml-3 border-l border-border/60 pl-1">
              <NavRow
                label="Raw materials"
                Icon={Package}
                active={inCosting && onMaterials}
                n={materials.length}
                sub
                onClick={() => onSelectView({ kind: "materials" })}
              />
              <NavRow
                label="Products"
                Icon={Boxes}
                active={inCosting && onProducts}
                n={finishedGoods.length}
                sub
                onClick={() => onSelectView({ kind: "products" })}
              />
            </div>
          )}
        </>
      )}

    </div>
  );
}
