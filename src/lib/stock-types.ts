// relative, not the `@/` alias: this file is type-checked by the Convex CLI
// as well as by Vite, and the alias is not mapped in its compiler pass
import type { Id } from "../convex/_generated/dataModel";

/** Which way the quantity moved. */
export type MovementDirection = "in" | "out";

/** What caused the movement, so the list can explain itself. */
export type MovementSource =
  | "purchase" // a bill brought it in
  | "lpo" // a purchase order was received
  | "grv" // a goods received voucher counted it in
  | "production" // a product consumed it
  | "production-return" // production stopped, so it went back
  | "adjustment"; // a manual stock correction

/** What moved a finished product on or off the shelf. */
export type ProductMovementSource =
  | "production" // a run came off the line
  | "production-reverse" // the run was reversed, so its units came back off
  | "sale" // an invoice took it
  | "sale-return" // the invoice was removed
  | "adjustment"; // an opening figure or a hand count

/** One line in a material's transaction list. */
export type StockMovement = {
  _id: Id<"stockMovements">;
  qty: number;
  unit: string;
  direction: MovementDirection;
  source: MovementSource;
  ref: string | undefined;
  at: number;
};

/** One material's row in the stock report. */
export type StockRow = {
  materialId: Id<"rawMaterials">;
  name: string;
  code: string | undefined;
  unit: string;
  category: string | undefined;
  /** Everything bought, from the bill lines. */
  income: number;
  /** Everything production has taken and not given back. */
  outgoing: number;
  /** What is on hand right now, straight from the material. */
  balance: number;
  /**
   * Stock that was already on hand before the movement ledger existed, or
   * that was set without a movement. Without it the arithmetic looks broken:
   * opening + income - outgoing = balance.
   */
  opening: number;
  /** The most recent movements, newest first. */
  movements: StockMovement[];
};

/** One line in a product's transaction list. */
export type ProductMovement = {
  _id: Id<"productMovements">;
  qty: number;
  unit: string;
  direction: MovementDirection;
  source: ProductMovementSource;
  ref: string | undefined;
  at: number;
};

/** One product's row in the finished-goods ledger, shaped like a material. */
export type ProductStockRow = {
  productId: Id<"finishedGoods">;
  name: string;
  code: string | undefined;
  unit: string;
  category: string | undefined;
  /** Everything production put on the shelf. */
  income: number;
  /** Everything invoicing has taken and not given back. */
  outgoing: number;
  /** What is on hand right now, straight from the product. */
  balance: number;
  /** Stock already on hand before the ledger existed, or set by hand. */
  opening: number;
  /** The most recent movements, newest first. */
  movements: ProductMovement[];
};

/**
 * Either ledger flattened to what the shared transaction panel draws, so the
 * raw-material and product lists can open the same breakdown.
 */
export type LedgerRow = {
  unit: string;
  opening: number;
  income: number;
  outgoing: number;
  balance: number;
  movements: {
    _id: string;
    qty: number;
    unit: string;
    direction: MovementDirection;
    source: string;
    ref: string | undefined;
    at: number;
  }[];
};
