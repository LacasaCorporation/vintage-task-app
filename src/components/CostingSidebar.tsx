import type { Doc } from "@/convex/_generated/dataModel";
import type { AccountingTab } from "@/components/AccountingPanel";
import type { PurchaseTab } from "@/lib/purchase-tabs";

type FgDoc = Doc<"finishedGoods">;

/**
 * What's open in the main area: raw materials, purchase, sales, products,
 * projects, one product's costing sheet, a page of the ledger, or the
 * reports.
 *
 * The navigation itself lives in `PrimaryNav`; this type is shared between
 * the sidebar, the costing panel and the page that owns the state.
 */
export type CostingView =
  | { kind: "materials" }
  /** Everything carrying the Active mark, gathered in one list. */
  | { kind: "active" }
  /** Everything whose Active mark has been taken off. */
  | { kind: "inactive" }
  /** Buying: one sub-page per kind of purchase document. */
  | { kind: "purchase"; tab: PurchaseTab }
  | { kind: "sales" }
  | { kind: "products" }
  | { kind: "projects" }
  | { kind: "fg"; fgId: FgDoc["_id"] }
  | { kind: "accounting"; tab: AccountingTab }
  | { kind: "reports" }
  | null;
