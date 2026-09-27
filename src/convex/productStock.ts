import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { ProductStockRow } from "../lib/stock-types";

export type { ProductStockRow };

/** Quantities are user-entered, so trim float noise off the ledger. */
const round = (n: number) => Math.round(n * 1e6) / 1e6;

type MoveArgs = {
  ownerId: Id<"users">;
  product: Doc<"finishedGoods">;
  /** Signed by intent; `move` takes the direction from the sign. */
  qty: number;
  source: Doc<"productMovements">["source"];
  ref?: string;
  at?: number;
};

/**
 * Every finished-goods stock change goes through here, so the movement ledger
 * and the product's `stock` can never drift apart.
 */
async function move(
  ctx: MutationCtx,
  { ownerId, product, qty, source, ref, at }: MoveArgs,
): Promise<void> {
  const amount = round(Math.abs(qty));
  if (amount === 0) return;
  const direction = qty < 0 ? "out" : "in";
  await ctx.db.patch(product._id, {
    stock: round((product.stock ?? 0) + (direction === "in" ? amount : -amount)),
  });
  await ctx.db.insert("productMovements", {
    ownerId,
    productId: product._id,
    name: product.name,
    unit: product.unit ?? "pcs",
    qty: amount,
    direction,
    source,
    ref: ref?.slice(0, 120) || undefined,
    at: at ?? Date.now(),
  });
}

/** Units came off the line and onto the shelf. */
export async function produceStock(
  ctx: MutationCtx,
  args: { ownerId: Id<"users">; product: Doc<"finishedGoods">; qty: number; ref?: string },
): Promise<void> {
  await move(ctx, { ...args, qty: Math.abs(args.qty), source: "production" });
}

/** An invoice took units off the shelf. */
export async function sellStock(
  ctx: MutationCtx,
  args: { ownerId: Id<"users">; product: Doc<"finishedGoods">; qty: number; ref?: string },
): Promise<void> {
  await move(ctx, { ...args, qty: -Math.abs(args.qty), source: "sale" });
}

/** The invoice was deleted, so the units go back on the shelf. */
export async function returnStock(
  ctx: MutationCtx,
  args: { ownerId: Id<"users">; product: Doc<"finishedGoods">; qty: number; ref?: string },
): Promise<void> {
  await move(ctx, { ...args, qty: Math.abs(args.qty), source: "sale-return" });
}

/** What the ledger already explains for one product, ignoring corrections. */
function explained(movements: Doc<"productMovements">[]): {
  income: number;
  outgoing: number;
} {
  let income = 0;
  let outgoing = 0;
  for (const m of movements) {
    // only production fills the shelf and only invoicing empties it; a
    // correction adjusts the opening, so it belongs in neither column
    if (m.source === "production" && m.direction === "in") income += m.qty;
    if (m.source === "sale" && m.direction === "out") outgoing += m.qty;
    if (m.source === "sale-return" && m.direction === "in") outgoing -= m.qty;
  }
  return { income: round(income), outgoing: round(outgoing) };
}

/**
 * The finished-goods ledger, one row per product: what production put on the
 * shelf, what invoicing took off it, and what is left. Corrections are kept
 * out of both columns so a hand-set opening can never bounce back to its old
 * figure the way a raw-material correction used to.
 */
export const report = query({
  args: {},
  handler: async (ctx): Promise<ProductStockRow[]> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];

    const products = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const movements = await ctx.db
      .query("productMovements")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const byProduct = new Map<
      Id<"finishedGoods">,
      { movements: Doc<"productMovements">[] }
    >();
    for (const m of movements) {
      const entry = byProduct.get(m.productId) ?? { movements: [] };
      entry.movements.push(m);
      byProduct.set(m.productId, entry);
    }

    return products.map((product) => {
      const all = byProduct.get(product._id)?.movements ?? [];
      const { income, outgoing } = explained(all);
      const balance = round(product.stock ?? 0);
      return {
        productId: product._id,
        name: product.name,
        code: product.code,
        unit: product.unit ?? "pcs",
        category: product.category,
        income,
        outgoing,
        balance,
        // a stored opening is what the user typed and always wins; products
        // that never had one fall back to the residual the ledger explains
        opening: round(product.opening ?? balance - income + outgoing),
        movements: all
          .slice()
          .sort((a, b) => b.at - a.at)
          .slice(0, 6)
          .map((m) => ({
            _id: m._id,
            qty: m.qty,
            unit: m.unit,
            direction: m.direction,
            source: m.source,
            ref: m.ref,
            at: m.at,
          })),
      };
    });
  },
});

/** One line of a product's ledger, with the balance it left behind. */
export type ProductLedgerLine = {
  /** A movement id, or `opening:<id>` for the synthetic opening line. */
  _id: string;
  at: number;
  qty: number;
  unit: string;
  direction: "in" | "out";
  source: Doc<"productMovements">["source"];
  ref: string | undefined;
  /** Stock on hand once this movement is applied. */
  balance: number;
};

/**
 * The whole story for one product: every movement, oldest first, each carrying
 * the balance it left, so the column adds up the way a real ledger does. The
 * opening figure is the first line so the arithmetic starts from nothing.
 */
export const ledger = query({
  args: { productId: v.id("finishedGoods") },
  handler: async (
    ctx,
    { productId },
  ): Promise<{
    product: {
      _id: Id<"finishedGoods">;
      name: string;
      code: string | undefined;
      unit: string;
      category: string | undefined;
      note: string | undefined;
    };
    opening: number;
    income: number;
    outgoing: number;
    balance: number;
    lines: ProductLedgerLine[];
  } | null> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return null;
    const product = await ctx.db.get(productId);
    if (product === null || product.ownerId !== userId) return null;

    const all = await ctx.db
      .query("productMovements")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    const { income, outgoing } = explained(all);
    const balance = round(product.stock ?? 0);
    const opening = round(product.opening ?? balance - income + outgoing);

    // walk the movements forward from the opening so each line can show the
    // balance it produced — this is what makes the column verifiable
    const ordered = all.slice().sort((a, b) => a.at - b.at || a._id.localeCompare(b._id));
    let running = opening;
    const lines: ProductLedgerLine[] = ordered.map((m) => {
      running = round(running + (m.direction === "in" ? m.qty : -m.qty));
      return {
        _id: m._id,
        at: m.at,
        qty: m.qty,
        unit: m.unit,
        direction: m.direction,
        source: m.source,
        ref: m.ref,
        balance: running,
      };
    });
    // the opening is its own line: it is where the balance came from
    if (opening !== 0) {
      lines.unshift({
        _id: `opening:${productId}`,
        at: ordered[0]?.at ?? Date.now(),
        qty: Math.abs(opening),
        unit: product.unit ?? "pcs",
        direction: opening > 0 ? "in" : "out",
        source: "adjustment",
        ref: "Opening balance",
        balance: round(opening),
      });
    }

    return {
      product: {
        _id: product._id,
        name: product.name,
        code: product.code,
        unit: product.unit ?? "pcs",
        category: product.category,
        note: product.note,
      },
      opening,
      income,
      outgoing,
      balance,
      lines,
    };
  },
});

/**
 * Sets the opening figure for a product: the units already on hand before any
 * run or invoice was recorded. The difference against the live balance is
 * posted as a correction, so the ledger still explains every unit.
 */
export const setOpening = mutation({
  args: { productId: v.id("finishedGoods"), qty: v.number() },
  handler: async (ctx, { productId, qty }): Promise<void> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage stock.");
    const product = await ctx.db.get(productId);
    if (product === null || product.ownerId !== ownerId) {
      throw new Error("That product no longer exists.");
    }
    const target = round(Math.max(0, qty));
    const movements = await ctx.db
      .query("productMovements")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    const { income, outgoing } = explained(movements);
    // opening + income - outgoing = balance, so this is the stock on hand the
    // requested opening implies
    const delta = round(
      target + income - outgoing - round(product.stock ?? 0),
    );
    if (delta !== 0) {
      // `move` reads the sign, so a lower opening is recorded as going out
      await move(ctx, {
        ownerId,
        product,
        qty: delta,
        source: "adjustment",
        ref: "Opening balance",
      });
    }
    // stored, not derived: the figure the user typed is the figure shown
    await ctx.db.patch(productId, { opening: target });
  },
});

/**
 * Force a product to a hand-counted stock figure (a stock take). The opening
 * absorbs the difference, so the arithmetic keeps holding.
 */
export const setStockTo = mutation({
  args: { productId: v.id("finishedGoods"), stock: v.number() },
  handler: async (ctx, { productId, stock }): Promise<void> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in first.");
    const product = await ctx.db.get(productId);
    if (product === null || product.ownerId !== ownerId) {
      throw new Error("That product no longer exists.");
    }
    const movements = await ctx.db
      .query("productMovements")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
    const { income, outgoing } = explained(movements);
    const current = round(product.stock ?? 0);
    const previousOpening = round(
      product.opening ?? current - income + outgoing,
    );
    const target = round(stock);
    const delta = round(target - current);
    if (delta !== 0) {
      await move(ctx, {
        ownerId,
        product,
        qty: delta,
        source: "adjustment",
        ref: "Stock correction",
      });
    }
    const nextOpening = round(previousOpening + delta);
    if (nextOpening !== previousOpening) {
      await ctx.db.patch(productId, { opening: nextOpening });
    }
  },
});
