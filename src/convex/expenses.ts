import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { postEntry } from "./accounting";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const round = (n: number) => Math.round(n * 100) / 100;

/** Cash in hand, then the bank — what an expense is normally paid from. */
const CASH_CODES = ["1100", "1110", "1120"];

export type ExpenseDoc = Doc<"expenses">;

/** Every expense, newest first, with the account names resolved for display. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const nameOf = new Map(accounts.map((a) => [a._id, a.name]));
    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const numberOf = new Map(entries.map((e) => [e._id, e.number]));
    return rows
      .sort((a, b) => b.at - a.at)
      .map((e) => ({
        ...e,
        paidFromName: e.paidFrom !== undefined ? nameOf.get(e.paidFrom) : undefined,
        // undefined means the row never reached the ledger — the panel offers
        // a repair rather than showing it as posted
        entryNumber: e.entryId !== undefined ? numberOf.get(e.entryId) : undefined,
      }));
  },
});

/** Totals by category, for the summary strip above the list. */
export const byCategory = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const totals = new Map<string, number>();
    for (const e of rows) {
      totals.set(e.category, round((totals.get(e.category) ?? 0) + e.amount));
    }
    return Array.from(totals, ([category, amount]) => ({ category, amount })).sort(
      (a, b) => b.amount - a.amount,
    );
  },
});

/** The expense accounts that can be chosen, and the accounts to pay from. */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return { categories: [], payFrom: [] };
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return {
      categories: accounts
        .filter((a) => a.type === "expense" && a.isGroup !== true)
        .map((a) => ({ id: a._id, name: a.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      payFrom: accounts
        .filter((a) => a.isGroup !== true && CASH_CODES.includes(a.code))
        .map((a) => ({ id: a._id, name: a.name, code: a.code })),
    };
  },
});

/**
 * Finds an account by name so an expense can be filed without the caller
 * having to know which id the chart gave that heading.
 */
async function accountByName(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  name: string,
): Promise<Doc<"accounts"> | null> {
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  return (
    accounts.find(
      (a) => a.isGroup !== true && a.name.toLowerCase() === name.toLowerCase(),
    ) ??
    accounts.find(
      (a) => a.isGroup !== true && a.type === "expense" && a.name.toLowerCase() === name.toLowerCase(),
    ) ??
    null
  );
}

/**
 * Records money spent that is not stock. The expense is written to the ledger
 * in the same call — debit the expense account, credit the cash or bank
 * account it was paid from — so the register and the accounts can never drift.
 */
export const create = mutation({
  args: {
    at: v.number(),
    category: v.string(),
    description: v.optional(v.string()),
    amount: v.number(),
    paidFrom: v.optional(v.id("accounts")),
    vendorId: v.optional(v.id("vendors")),
    vendor: v.optional(v.string()),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"expenses">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const amount = round(args.amount);
    if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");

    const category = args.category.trim();
    if (!category) throw new Error("Choose what the money was spent on.");

    const expenseAccount = await accountByName(ctx, userId, category);
    if (expenseAccount === null) {
      throw new Error(`There's no expense account called “${category}”.`);
    }
    if (expenseAccount.type !== "expense") {
      throw new Error(`“${expenseAccount.name}” is not an expense account.`);
    }

    let paidFrom = args.paidFrom;
    if (paidFrom === undefined) {
      const accounts = await ctx.db
        .query("accounts")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      const cash = accounts.find(
        (a) => a.isGroup !== true && CASH_CODES.includes(a.code),
      );
      if (cash === undefined) {
        throw new Error("Set up a cash or bank account before recording expenses.");
      }
      paidFrom = cash._id;
    }
    const cashAccount = await ctx.db.get(paidFrom);
    if (cashAccount === null || cashAccount.ownerId !== userId) {
      throw new Error("That payment account no longer exists.");
    }
    if (cashAccount.isGroup === true) {
      throw new Error(`${cashAccount.name} is a heading — pick a real account.`);
    }

    const memo = args.description?.trim() || category;
    const expenseId = await ctx.db.insert("expenses", {
      ownerId: userId,
      at: args.at,
      category: expenseAccount.name,
      description: args.description?.trim().slice(0, 300) || undefined,
      amount,
      paidFrom,
      vendorId: args.vendorId,
      vendor: args.vendor?.trim().slice(0, 120) || undefined,
      reference: args.reference?.trim().slice(0, 60) || undefined,
      note: args.note?.trim().slice(0, 500) || undefined,
      createdAt: Date.now(),
    });

    // the register row and its ledger posting are written in the same call, so
    // an expense and the accounts can never drift apart
    const entryId = await postEntry(ctx, userId, {
      at: args.at,
      kind: "expense",
      memo,
      party: args.vendor?.trim() || undefined,
      expenseId,
      lines: [
        { accountId: expenseAccount._id, debit: amount, credit: 0 },
        { accountId: cashAccount._id, debit: 0, credit: amount },
      ],
    });
    await ctx.db.patch(expenseId, { entryId });
    return expenseId;
  },
});

/**
 * Posts the ledger entry for any expense that never got one — rows recorded
 * before the register wrote to the accounts, or entries lost to a failed call.
 * Refuses to guess instead of posting to the wrong account: anything it cannot
 * file comes back in `skipped` for the panel to show.
 */
export const postMissing = mutation({
  args: {},
  handler: async (ctx): Promise<{ posted: number; skipped: string[] }> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const rows = await ctx.db
      .query("expenses")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    let posted = 0;
    const skipped: string[] = [];
    for (const e of rows) {
      if (e.entryId !== undefined) continue;
      const expenseAccount = accounts.find(
        (a) => a.isGroup !== true && a.name.toLowerCase() === e.category.toLowerCase(),
      );
      if (expenseAccount === undefined) {
        skipped.push(`${e.category} — no account by that name`);
        continue;
      }
      const cashAccount =
        e.paidFrom !== undefined ? await ctx.db.get(e.paidFrom) : null;
      if (cashAccount === null || cashAccount.ownerId !== userId) {
        skipped.push(`${e.category} — the account it was paid from is gone`);
        continue;
      }
      const entryId = await postEntry(ctx, userId, {
        at: e.at,
        kind: "expense",
        memo: e.description?.trim() || e.category,
        party: e.vendor?.trim() || undefined,
        expenseId: e._id,
        lines: [
          { accountId: expenseAccount._id, debit: e.amount, credit: 0 },
          { accountId: cashAccount._id, debit: 0, credit: e.amount },
        ],
      });
      await ctx.db.patch(e._id, { entryId });
      posted++;
    }
    return { posted, skipped };
  },
});

/** Removes an expense together with the journal entry it posted. */
export const remove = mutation({
  args: { id: v.id("expenses") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const expense = await ctx.db.get(id);
    if (expense === null || expense.ownerId !== userId) return;
    const entryId = expense.entryId;
    if (entryId !== undefined) {
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entry", (q) => q.eq("entryId", entryId))
        .collect();
      for (const line of lines) await ctx.db.delete(line._id);
      const entry = await ctx.db.get(entryId);
      if (entry !== null && entry.ownerId === userId) await ctx.db.delete(entry._id);
    }
    await ctx.db.delete(id);
  },
});
