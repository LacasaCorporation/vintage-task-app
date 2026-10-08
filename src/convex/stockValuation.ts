import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * What the shelves are worth at two moments.
 *
 * Stock is counted, not posted, so a statement cannot read its opening and
 * closing figures out of the journal — they have to be recomputed from the
 * same shelves and rates the stock report uses, evaluated at the start of the
 * window and at its end.
 *
 * Opening stock = what was on the shelves the instant before the window began.
 * Closing stock = what was on the shelves at the end of the window.
 *
 * A plain module rather than a query, so the reports and the stock-adjustment
 * posting share one calculation: the statement and the ledger can then never
 * disagree about how much stock was on hand.
 *
 * A correction (`adjustment`) is deliberately not dated stock: it re-states the
 * figure the books were holding rather than describing goods arriving or
 * leaving. Counting it as a movement would turn "I fixed my opening count" into
 * a cost of goods sold with no bill behind it, so it stays in the baseline —
 * the same way the stock report reads its opening figure.
 */
export async function stockValuation(
  ctx: QueryCtx | MutationCtx,
  ownerId: Id<"users">,
  from: number,
  to: number,
): Promise<{ opening: number; closing: number }> {
  const round = (n: number) => Math.round(n * 1e2) / 1e2;

  const materials = await ctx.db
    .query("rawMaterials")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  const products = await ctx.db
    .query("finishedGoods")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();

  const billLines = await ctx.db
    .query("purchaseLines")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  const averages = new Map<
    Id<"rawMaterials">,
    { value: number; qty: number; last: number }
  >();
  for (const line of billLines) {
    const a = averages.get(line.materialId) ?? {
      value: 0,
      qty: 0,
      last: 0,
    };
    a.value += line.qty * line.unitCost;
    a.qty += line.qty;
    a.last = line.unitCost;
    averages.set(line.materialId, a);
  }
  const weighted = (id: Id<"rawMaterials">, fallback: number) => {
    const a = averages.get(id);
    return a !== undefined && a.qty > 0 ? round(a.value / a.qty) : fallback;
  };

  const items = await ctx.db
    .query("costingItems")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  const materialById0 = new Map(materials.map((m) => [m._id, m]));
  const sheetCost = new Map<Id<"finishedGoods">, number>();
  for (const item of items) {
    if (item.fgId === undefined) continue;
    const unit =
      item.materialId !== undefined
        ? weighted(
            item.materialId,
            materialById0.get(item.materialId)?.pricePerUnit ?? 0,
          )
        : item.unitPrice;
    sheetCost.set(item.fgId, (sheetCost.get(item.fgId) ?? 0) + item.qty * unit);
  }

  const materialRate = new Map<Id<"rawMaterials">, number>();
  for (const m of materials) {
    materialRate.set(m._id, weighted(m._id, round(m.pricePerUnit)));
  }
  const productRate = new Map<Id<"finishedGoods">, number>();
  for (const p of products) {
    productRate.set(p._id, round(sheetCost.get(p._id) ?? 0));
  }

  const stockMovements = await ctx.db
    .query("stockMovements")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  const productMovements = await ctx.db
    .query("productMovements")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();

  /**
   * Stock on hand at a moment, valued at current rates.
   *
   * `material.stock` is the balance as it stands now and every movement has
   * already been applied to it, so what was on hand at a moment is today's
   * balance with the changes made since that moment backed out — not with the
   * changes made before it added on. Corrections are skipped, so a hand-count
   * moves the baseline and nothing else.
   */
  const valueAt = (at: number) => {
    const mm = new Map<Id<"rawMaterials">, number>();
    for (const m of materials) {
      let qty = m.stock ?? 0;
      for (const mv of stockMovements) {
        if (mv.materialId !== m._id) continue;
        if (mv.source === "adjustment") continue;
        if (mv.at < at) continue;
        qty -= mv.direction === "in" ? mv.qty : -mv.qty;
      }
      mm.set(m._id, round((qty ?? 0) * (materialRate.get(m._id) ?? 0)));
    }
    const pp = new Map<Id<"finishedGoods">, number>();
    for (const p of products) {
      let qty = p.stock ?? 0;
      for (const mv of productMovements) {
        if (mv.productId !== p._id) continue;
        if (mv.source === "adjustment") continue;
        if (mv.at < at) continue;
        qty -= mv.direction === "in" ? mv.qty : -mv.qty;
      }
      pp.set(p._id, round((qty ?? 0) * (productRate.get(p._id) ?? 0)));
    }
    let total = 0;
    for (const v of mm.values()) total += v;
    for (const v of pp.values()) total += v;
    return round(total);
  };

  return { opening: valueAt(from), closing: valueAt(to + 1) };
}
