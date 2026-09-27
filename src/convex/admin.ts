import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Transaction housekeeping for the workspace owner.
 *
 * "Transactions" means the documents that record what happened: bills, sales,
 * orders, expenses, journal entries and the stock movement ledgers. It never
 * means master data — materials, products, projects, jobs, recipes, accounts,
 * vendors, customers, tasks and notes are all left exactly as they are. The
 * point is to zero the books and start the running figures again without
 * rebuilding the price lists and the product catalogue by hand.
 */

/** Only the workspace owner may run any of this. */
async function requireSuper(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in first.");
  const workspaces = await ctx.db.query("settings").collect();
  const mine = workspaces.find((s) => s.ownerId === userId);
  if (mine === undefined) {
    throw new Error(
      "Only the workspace owner (super user) can do this. Ask them to run it.",
    );
  }
  return userId;
}

/**
 * The transaction tables, in the order they must be emptied: lines before the
 * document they belong to, so nothing is ever left pointing at a deleted row.
 */
const TRANSACTION_TABLES = [
  "purchaseLines",
  "purchases",
  "stockMovements",
  "productMovements",
  "lpos",
  "expenses",
  "journalLines",
  "journalEntries",
  "quotations",
  "sales",
] as const;

type TransactionTable = (typeof TRANSACTION_TABLES)[number];

/** Human labels for the confirmation, so nothing is deleted by surprise. */
export const TABLE_LABELS: Record<TransactionTable, string> = {
  purchaseLines: "Purchase bill lines",
  purchases: "Purchase bills",
  stockMovements: "Raw-material stock movements",
  productMovements: "Product stock movements",
  lpos: "Purchase orders (LPOs)",
  expenses: "Expenses",
  journalLines: "Journal entry lines",
  journalEntries: "Journal entries",
  quotations: "Quotations",
  sales: "Sales invoices",
};

/** How many rows of each kind of transaction exist right now. */
export const transactionCounts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireSuper(ctx);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const table of TRANSACTION_TABLES) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      counts[table] = rows.length;
      total += rows.length;
    }
    // what the books would be left holding
    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const products = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return {
      counts,
      total,
      kept: {
        materials: materials.length,
        products: products.length,
        projects: (
          await ctx.db
            .query("projects")
            .withIndex("by_owner", (q) => q.eq("ownerId", userId))
            .collect()
        ).length,
        accounts: (
          await ctx.db
            .query("accounts")
            .withIndex("by_owner", (q) => q.eq("ownerId", userId))
            .collect()
        ).length,
      },
    };
  },
});

/**
 * Empties every transaction table for the workspace owner and puts the running
 * figures back where the opening balances say they should be.
 *
 * `confirm` must be the exact word below. It is not a formality: this deletes
 * the financial record, and a stray click should not be able to do it.
 */
export const clearTransactions = mutation({
  args: { confirm: v.string() },
  handler: async (ctx, { confirm }): Promise<{ removed: number }> => {
    const userId = await requireSuper(ctx);
    if (confirm !== "CLEAR TRANSACTIONS") {
      throw new Error(
        "Type CLEAR TRANSACTIONS exactly to confirm. Nothing was deleted.",
      );
    }

    let removed = 0;
    for (const table of TRANSACTION_TABLES) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      for (const row of rows) {
        await ctx.db.delete(row._id);
        removed += 1;
      }
    }

    // With the movements gone, the stored stock no longer has anything behind
    // it. The opening figure is the one deliberate number the user entered, so
    // that is where stock returns to; anything else goes to zero.
    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const material of materials) {
      await ctx.db.patch(material._id, {
        stock: material.opening ?? 0,
      });
    }

    // Products keep their recipe and their project links, but no run is in
    // progress any more and the shelf is back to what was on hand at the start.
    const products = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const product of products) {
      await ctx.db.patch(product._id, {
        stock: product.opening ?? 0,
        inProduction: 0,
        productionQty: undefined,
        productionStartedAt: undefined,
        productionConsumed: undefined,
      });
    }

    return { removed };
  },
});
