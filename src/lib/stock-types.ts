import type { Id } from "../convex/_generated/dataModel";

/** Which way the quantity moved. */
export type MovementDirection = "in" | "out";

/** What caused the movement, so the list can explain itself. */
export type MovementSource =
  | "purchase" // a bill brought it in
  | "production" // a product consumed it
  | "production-return" // production stopped, so it went back
  | "adjustment"; // a manual stock correction

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
