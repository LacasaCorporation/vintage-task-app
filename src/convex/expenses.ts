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
    return rows
      .sort((a, b) => b.at - a.at)
      .map((e) => ({
        ...e,
        paidFromName: e.paidFrom !== undefined ? nameOf.get(e.paidFrom) : undefined,
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
    const entryId = await postEntry(ctx, userId, {
      at: args.at,
      kind: "payment",
      memo,
      party: args.vendor?.trim() || undefined,
      lines: [
        { accountId: expenseAccount._id, debit: amount, credit: 0 },
        { accountId: cashAccount._id, debit: 0, credit: amount },
      ],
    });

    return ctx.db.insert("expenses", {
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
      entryId,
      createdAt: Date.now(),
    });
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
