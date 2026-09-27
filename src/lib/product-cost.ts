// a relative path so Convex can import this module too
import type { Doc, Id } from "../convex/_generated/dataModel";

/**
 * How many of a product a costing sheet covers. A product with no quantity
 * set counts as one, so nothing changes until a quantity is entered.
 */
export function batchQty(fg: { qty?: number }): number {
  return fg.qty !== undefined && fg.qty > 0 ? fg.qty : 1;
}

/**
 * A product's cost for the whole batch.
 *
 * The costing sheet prices one product — three oak boards cost three times the
 * board line — so every total built from these figures has to be multiplied by
 * the quantity, or a project reads a third of what it is worth. Returns the
 * unit cost when no quantity is set.
 */
export function batchCost(
  unitCost: number,
  fg: { qty?: number },
): number {
  return unitCost * batchQty(fg);
}

/** Unit cost of every product on every sheet, keyed by product id. */
export function costByProduct(
  items: readonly Pick<Doc<"costingItems">, "fgId" | "qty" | "unitPrice">[],
): Map<Id<"finishedGoods">, number> {
  const map = new Map<Id<"finishedGoods">, number>();
  for (const item of items) {
    if (item.fgId === undefined) continue;
    map.set(item.fgId, (map.get(item.fgId) ?? 0) + item.qty * item.unitPrice);
  }
  return map;
}

/** The sales price of a product's whole batch, after its margin. */
export function batchSales(
  unitCost: number,
  markupPct: number | undefined,
  fg: { qty?: number },
): number {
  return batchCost(unitCost, fg) * (1 + (markupPct ?? 0) / 100);
}
