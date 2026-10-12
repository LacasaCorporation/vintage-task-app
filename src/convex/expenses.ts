import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { postEntry } from "./accounting";
import { expenseClassOf, resolveDefaults } from "./accountingDefaults";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const round = (n: number) => Math.round(n * 100) / 100;

/** The two classes an expense is filed under. */
export const EXPENSE_KINDS = ["direct", "indirect"] as const;

export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

/**
 * Which class an expense belongs to, never left unanswered.
 *
 * A row that carries its kind is taken at its word. An older one is read off
 * the account it was charged to, so the register can be split in two without
 * ending up with a third bucket for history nobody can file.
 */
function classOf(
  expense: ExpenseDoc,
  accountOf: Map<string, { code: string; expenseKind?: ExpenseKind }>,
): ExpenseKind {
  if (expense.kind === "direct" || expense.kind === "indirect") {
    return expense.kind;
  }
  const account = accountOf.get(expense.category.toLowerCase());
  return account === undefined ? "indirect" : expenseClassOf(account);
}


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
    /** Account name (lowercased) → code, for printing beside the name. */
    const codeOf = new Map(
      accounts.map((a) => [a.name.toLowerCase(), a.code] as const),
    );
    /** Account name (lowercased) → the account, for reading a row's class. */
    const accountOf = new Map(
      accounts.map((a) => [a.name.toLowerCase(), a] as const),
    );
    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const numberOf = new Map(entries.map((e) => [e._id, e.number]));
    return rows
      .sort((a, b) => b.at - a.at)
      .map((e) => ({
        ...e,
        kind: classOf(e, accountOf),
        categoryCode: codeOf.get(e.category.toLowerCase()),
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
    // cash first, then the bank — the accounts Settings names as money
    let payFrom: { id: Id<"accounts">; name: string; code: string }[] = [];
    try {
      const d = await resolveDefaults(ctx, userId);
      payFrom = [d.cash, d.bank].map((a) => ({
        id: a._id,
        name: a.name,
        code: a.code,
      }));
    } catch {
      // no chart yet — the form simply offers nothing to pay from
      payFrom = [];
    }
    return {
      /**
       * Every expense account, each carrying the side of the split it is on,
       * so the form can show the accounts that belong to the class being
       * entered instead of the whole chart.
       */
      categories: accounts
        .filter((a) => a.type === "expense" && a.isGroup !== true)
        .map((a) => ({
          id: a._id,
          name: a.name,
          code: a.code,
          kind: expenseClassOf(a),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      payFrom,
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
    /**
     * Which class this expense is. Required here so a row entered now says
     * which it is, rather than leaving it to be read off the account later.
     * Optional so the register panel — which predates the split — can keep
     * posting without a change; those rows fall back to indirect, which is
     * where running-the-business spend belongs.
     */
    kind: v.optional(v.union(v.literal("direct"), v.literal("indirect"))),
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
      // falls back to the configured cash account, then the standard code
      paidFrom = (await resolveDefaults(ctx, userId)).cash._id;
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
      // the account decides the side of the split when it says which it is;
      // the caller's kind fills in for a hand-made account that carries none,
      // and the code does as a last resort — so a row never lands in both
      // halves of the register or in neither
      kind:
        expenseAccount.expenseKind ??
        args.kind ??
        expenseClassOf(expenseAccount),
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
