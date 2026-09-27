import { query } from "./_generated/server";
import { scopeUserId } from "./org";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type {
  MovementDirection,
  MovementSource,
  StockRow,
} from "../lib/stock-types";

export type { StockRow };

/** Quantities are user-entered, so trim float noise off the ledger. */
const round = (n: number) => Math.round(n * 1e6) / 1e6;

type MoveArgs = {
  ownerId: Id<"users">;
  material: Doc<"rawMaterials">;
  /**
   * Signed by intent, not by sign: `stockIn` with a negative qty still lowers
   * the stock, because a correction can go either way.
   */
  qty: number;
  source: MovementSource;
  /** Bill number or product name, shown next to the movement. */
  ref?: string;
  at?: number;
};

/**
 * Every stock change goes through here, so the movement ledger and the
 * material's `stock` can never drift apart. Adding and taking are separate
 * calls because the two sides carry different labels and a different ref.
 */
async function move(
  ctx: MutationCtx,
  { ownerId, material, qty, source, ref, at, direction: wanted }: MoveArgs & {
    /** The caller's intent, before the sign is taken into account. */
    direction: MovementDirection;
  },
): Promise<void> {
  // a correction can go either way, so trust the sign over the intent
  const direction =
    qty < 0 ? (wanted === "in" ? "out" : "in") : wanted;
  const amount = round(Math.abs(qty));
  if (amount === 0) return;
  await ctx.db.patch(material._id, {
    stock: round((material.stock ?? 0) + (direction === "in" ? amount : -amount)),
  });
  await ctx.db.insert("stockMovements", {
    ownerId,
    materialId: material._id,
    name: material.name,
    unit: material.unit,
    qty: amount,
    direction,
    source,
    ref: ref?.slice(0, 120) || undefined,
    at: at ?? Date.now(),
  });
}

/** Stock came in: a purchase bill, or a correction that raised it. */
export async function stockIn(
  ctx: MutationCtx,
  args: MoveArgs,
): Promise<void> {
  await move(ctx, { ...args, direction: "in" });
}

/** Stock went out: consumed by production, or a correction that lowered it. */
export async function stockOut(
  ctx: MutationCtx,
  args: MoveArgs,
): Promise<void> {
  await move(ctx, { ...args, direction: "out" });
}

/**
 * The stock report: for every material, what came in, what went out, and what
 * is left. Income comes from the bill lines so it is complete even for bills
 * saved before the ledger existed; outgoing comes from the movements, so
 * stock a product consumed and a stop returned nets out.
 */
export const report = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<StockRow[]> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];

    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const billLines = await ctx.db
      .query("purchaseLines")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const income = new Map<Id<"rawMaterials">, number>();
    for (const line of billLines) {
      income.set(line.materialId, (income.get(line.materialId) ?? 0) + line.qty);
    }

    const allMovements = await ctx.db
      .query("stockMovements")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const byMaterial = new Map<
      Id<"rawMaterials">,
      {
        outgoing: number;
        movements: StockRow["movements"];
      }
    >();
    for (const m of allMovements) {
      const entry = byMaterial.get(m.materialId) ?? {
        outgoing: 0,
        movements: [],
      };
      if (m.direction === "out") entry.outgoing += m.qty;
      entry.movements.push({
        _id: m._id,
        qty: m.qty,
        unit: m.unit,
        direction: m.direction,
        source: m.source,
        ref: m.ref,
        at: m.at,
      });
      byMaterial.set(m.materialId, entry);
    }

    const take = limit ?? 12;
    const rows: StockRow[] = materials.map((material) => {
      const entry = byMaterial.get(material._id);
      const incomeQty = round(income.get(material._id) ?? 0);
      const outgoing = round(entry?.outgoing ?? 0);
      const balance = round(material.stock ?? 0);
      return {
        materialId: material._id,
        name: material.name,
        code: material.code,
        unit: material.unit,
        category: material.category,
        income: incomeQty,
        outgoing,
        balance,
        opening: round(balance - incomeQty + outgoing),
        movements: (entry?.movements ?? [])
          .sort((a, b) => b.at - a.at)
          .slice(0, 4),
      };
    });

    // busiest first: a material with no movement in either direction is noise
    return rows
      .filter((r) => r.income !== 0 || r.outgoing !== 0 || r.balance !== 0)
      .sort(
        (a, b) =>
          b.income + b.outgoing - (a.income + a.outgoing) ||
          a.name.localeCompare(b.name),
      )
      .slice(0, Math.max(1, take));
  },
});
