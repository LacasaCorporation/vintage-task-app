import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { moneyAccountIds } from "./accountingDefaults";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

/** Money is user-typed, so trim float noise before it reaches a balance. */
const round = (n: number) => Math.round(n * 1e2) / 1e2;

export type AccountType = Doc<"accounts">["type"];

export type AccountRow = {
  _id: Id<"accounts">;
  code: string;
  name: string;
  type: AccountType;
  isGroup: boolean;
  note?: string;
  /** Debit-positive balance from posted lines, plus the opening balance. */
  balance: number;
  debit: number;
  credit: number;
  /** A signed balance, as the type reports it (income and liability read positive). */
  signed: number;
};

export type EntryRow = {
  _id: Id<"journalEntries">;
  number: string;
  at: number;
  kind: Doc<"journalEntries">["kind"];
  memo?: string;
  party?: string;
  lines: {
    _id: Id<"journalLines">;
    accountId: Id<"accounts">;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    memo?: string;
  }[];
  debit: number;
  credit: number;
};

function signFor(type: AccountType): number {
  return type === "income" || type === "liability" || type === "equity" ? 1 : -1;
}

/**
 * The standard chart every new firm starts from. Group rows (Assets, Liabilities…)
 * are headings only; the rest are the posting accounts.
 */
const DEFAULT_ACCOUNTS: {
  code: string;
  name: string;
  type: AccountType;
  isGroup?: boolean;
}[] = [
  { code: "1000", name: "Assets", type: "asset", isGroup: true },
  { code: "1100", name: "Cash in hand", type: "asset" },
  { code: "1110", name: "Bank account", type: "asset" },
  { code: "1200", name: "Accounts receivable", type: "asset" },
  { code: "1300", name: "Raw material inventory", type: "asset" },
  { code: "1400", name: "Finished goods inventory", type: "asset" },
  { code: "1500", name: "Plant & equipment", type: "asset" },

  { code: "2000", name: "Liabilities", type: "liability", isGroup: true },
  { code: "2100", name: "Accounts payable", type: "liability" },
  { code: "2200", name: "Loans payable", type: "liability" },
  { code: "2300", name: "GST / tax payable", type: "liability" },

  { code: "3000", name: "Equity", type: "equity", isGroup: true },
  { code: "3100", name: "Owner capital", type: "equity" },
  { code: "3200", name: "Retained earnings", type: "equity" },

  { code: "4000", name: "Income", type: "income", isGroup: true },
  { code: "4100", name: "Sales revenue", type: "income" },
  { code: "4200", name: "Other income", type: "income" },

  { code: "5000", name: "Expenses", type: "expense", isGroup: true },
  { code: "5100", name: "Cost of goods sold", type: "expense" },
  { code: "5200", name: "Raw material purchased", type: "expense" },
  { code: "5300", name: "Rent", type: "expense" },
  { code: "5400", name: "Salaries & wages", type: "expense" },
  { code: "5500", name: "Utilities", type: "expense" },
];

/** JE0001, JE0002, … */
async function nextEntryNumber(
  ctx: MutationCtx,
  ownerId: Id<"users">,
): Promise<string> {
  const rows = await ctx.db
    .query("journalEntries")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  let max = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.number.slice(2), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `JE${String(max + 1).padStart(4, "0")}`;
}

/** Posts the default chart for a firm that has none yet. */
export const ensureDefaults = mutation({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return false;
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();
    if (existing !== null) return false;
    for (const a of DEFAULT_ACCOUNTS) {
      await ctx.db.insert("accounts", {
        ownerId: userId,
        code: a.code,
        name: a.name,
        type: a.type,
        isGroup: a.isGroup,
      });
    }
    return true;
  },
});

/** The chart of accounts, each row carrying its running balance. */
export const listAccounts = query({
  args: {},
  handler: async (ctx): Promise<AccountRow[]> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const totals = new Map<
      Id<"accounts">,
      { debit: number; credit: number }
    >();
    for (const line of lines) {
      const t = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
      t.debit += line.debit;
      t.credit += line.credit;
      totals.set(line.accountId, t);
    }

    return accounts
      .map((a) => {
        const t = totals.get(a._id) ?? { debit: 0, credit: 0 };
        const debit = round(t.debit);
        const credit = round(t.credit);
        const balance = round(debit - credit);
        return {
          _id: a._id,
          code: a.code,
          name: a.name,
          type: a.type,
          isGroup: a.isGroup === true,
          note: a.note,
          balance,
          debit,
          credit,
          signed: round(balance * signFor(a.type)),
        };
      })
      .sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
  },
});

/**
 * One account's ledger: every posting that touched it, oldest first, with the
 * balance carried down each line.
 *
 * `from` / `to` narrow what is *shown*, not what is counted: the opening
 * balance is everything before `from`, so a narrowed view still reconciles —
 * opening + debits − credits is the closing balance, at any range.
 */
export const accountLedger = query({
  args: {
    accountId: v.id("accounts"),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { accountId, from, to, search }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return null;
    const account = await ctx.db.get(accountId);
    if (account === null || account.ownerId !== userId) return null;

    const [lines, entries] = await Promise.all([
      ctx.db
        .query("journalLines")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect(),
      ctx.db
        .query("journalEntries")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect(),
    ]);
    const entryOf = new Map(entries.map((e) => [e._id, e]));

    // every line of this account, oldest first
    const mine = lines
      .filter((l) => l.accountId === accountId)
      .map((l) => ({ line: l, entry: entryOf.get(l.entryId) }))
      .filter((r): r is { line: typeof r.line; entry: NonNullable<typeof r.entry> } =>
        r.entry !== undefined,
      )
      .sort((a, b) => a.entry.at - b.entry.at || a.entry.number.localeCompare(b.entry.number));

    // what the account already stood at when the window opens
    const opening = round(
      mine
        .filter((r) => from !== undefined && r.entry.at < from)
        .reduce((sum, r) => sum + r.line.debit - r.line.credit, 0),
    );

    const term = (search ?? "").trim().toLowerCase();
    let running = opening;
    const rows: {
      _id: Id<"journalLines">;
      entryId: Id<"journalEntries">;
      number: string;
      at: number;
      kind: Doc<"journalEntries">["kind"];
      memo?: string;
      party?: string;
      lineMemo?: string;
      debit: number;
      credit: number;
      balance: number;
    }[] = [];
    let debitTotal = 0;
    let creditTotal = 0;
    for (const { line, entry } of mine) {
      if (from !== undefined && entry.at < from) continue;
      if (to !== undefined && entry.at > to) continue;
      running = round(running + line.debit - line.credit);
      debitTotal = round(debitTotal + line.debit);
      creditTotal = round(creditTotal + line.credit);
      if (
        term !== "" &&
        !`${entry.number} ${entry.memo ?? ""} ${entry.party ?? ""} ${
          line.memo ?? ""
        } ${entry.kind}`
          .toLowerCase()
          .includes(term)
      ) {
        continue;
      }
      rows.push({
        _id: line._id,
        entryId: entry._id,
        number: entry.number,
        at: entry.at,
        kind: entry.kind,
        memo: entry.memo,
        party: entry.party,
        lineMemo: line.memo,
        debit: round(line.debit),
        credit: round(line.credit),
        balance: running,
      });
    }

    return {
      account: {
        _id: account._id,
        code: account.code,
        name: account.name,
        type: account.type,
        note: account.note,
      },
      opening,
      rows,
      totals: {
        debit: debitTotal,
        credit: creditTotal,
        closing: round(opening + debitTotal - creditTotal),
        // every line the account has ever had, so an empty window is not
        // mistaken for an account that has never been used
        lifetime: mine.length,
      },
    };
  },
});

/** Journal entries newest first, each with its lines attached. */
export const listEntries = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }): Promise<EntryRow[]> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const byEntry = new Map<Id<"journalEntries">, EntryRow["lines"]>();
    for (const line of lines) {
      const list = byEntry.get(line.entryId) ?? [];
      list.push({
        _id: line._id,
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        debit: round(line.debit),
        credit: round(line.credit),
        memo: line.memo,
      });
      byEntry.set(line.entryId, list);
    }

    return entries
      .map((e) => {
        const entryLines = byEntry.get(e._id) ?? [];
        return {
          _id: e._id,
          number: e.number,
          at: e.at,
          kind: e.kind,
          memo: e.memo,
          party: e.party,
          expenseId: e.expenseId,
          lines: entryLines,
          debit: round(entryLines.reduce((s, l) => s + l.debit, 0)),
          credit: round(entryLines.reduce((s, l) => s + l.credit, 0)),
        };
      })
      .sort((a, b) => b.at - a.at || b.number.localeCompare(a.number))
      .slice(0, limit ?? 100);
  },
});

export const createAccount = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    type: v.union(
      v.literal("asset"),
      v.literal("liability"),
      v.literal("equity"),
      v.literal("income"),
      v.literal("expense"),
    ),
    isGroup: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"accounts">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to manage accounts.");
    const code = args.code.trim();
    const name = args.name.trim();
    if (!code) throw new Error("Give the account a code.");
    if (!name) throw new Error("Give the account a name.");
    const clash = await ctx.db
      .query("accounts")
      .withIndex("by_code", (q) =>
        q.eq("ownerId", userId).eq("code", code),
      )
      .first();
    if (clash !== null) throw new Error(`Account ${code} already exists.`);
    return await ctx.db.insert("accounts", {
      ownerId: userId,
      code,
      name,
      type: args.type,
      isGroup: args.isGroup,
      note: args.note?.trim() || undefined,
    });
  },
});

export const updateAccount = mutation({
  args: {
    id: v.id("accounts"),
    name: v.string(),
    type: v.union(
      v.literal("asset"),
      v.literal("liability"),
      v.literal("equity"),
      v.literal("income"),
      v.literal("expense"),
    ),
    isGroup: v.optional(v.boolean()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to manage accounts.");
    const account = await ctx.db.get(args.id);
    if (account === null || account.ownerId !== userId) {
      throw new Error("That account no longer exists.");
    }
    const name = args.name.trim();
    if (!name) throw new Error("Give the account a name.");
    await ctx.db.patch(args.id, {
      name,
      type: args.type,
      isGroup: args.isGroup,
      note: args.note?.trim() || undefined,
    });
  },
});

export const removeAccount = mutation({
  args: { id: v.id("accounts") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to manage accounts.");
    const account = await ctx.db.get(id);
    if (account === null || account.ownerId !== userId) {
      throw new Error("That account no longer exists.");
    }
    const used = await ctx.db
      .query("journalLines")
      .withIndex("by_account", (q) =>
        q.eq("ownerId", userId).eq("accountId", id),
      )
      .first();
    if (used !== null) {
      throw new Error(
        `${account.code} ${account.name} has postings — remove them first.`,
      );
    }
    await ctx.db.delete(id);
  },
});

const lineValidator = v.array(
  v.object({
    accountId: v.id("accounts"),
    debit: v.number(),
    credit: v.number(),
    memo: v.optional(v.string()),
  }),
);

/**
 * Posts one balanced entry. Debits must equal credits — an unbalanced entry
 * would quietly corrupt every balance built on top of it, so it is refused
 * here rather than reconciled later. Exported so the expense register can
 * write straight to the ledger instead of keeping a second set of books.
 */
export async function postEntry(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    at: number;
    kind: Doc<"journalEntries">["kind"];
    memo?: string;
    party?: string;
    /** Set when the entry is raised by an expense, so the two link up. */
    expenseId?: Id<"expenses">;
    lines: {
      accountId: Id<"accounts">;
      debit: number;
      credit: number;
      memo?: string;
    }[];
  },
): Promise<Id<"journalEntries">> {
  const usable = args.lines
    .map((l) => ({
      accountId: l.accountId,
      debit: round(Math.max(0, l.debit)),
      credit: round(Math.max(0, l.credit)),
      memo: l.memo?.trim() || undefined,
    }))
    .filter((l) => l.debit > 0 || l.credit > 0);
  if (usable.length < 2) {
    throw new Error("An entry needs at least two lines.");
  }
  for (const line of usable) {
    if (line.debit > 0 && line.credit > 0) {
      throw new Error("A line is either a debit or a credit, not both.");
    }
    const account = await ctx.db.get(line.accountId);
    if (account === null || account.ownerId !== userId) {
      throw new Error("One of those accounts no longer exists.");
    }
    if (account.isGroup === true) {
      throw new Error(`${account.name} is a heading — pick a real account.`);
    }
  }

  const debit = round(usable.reduce((s, l) => s + l.debit, 0));
  const credit = round(usable.reduce((s, l) => s + l.credit, 0));
  if (debit !== credit) {
    throw new Error(
      `Debits (${debit.toFixed(2)}) and credits (${credit.toFixed(2)}) must match.`,
    );
  }

  const entryId = await ctx.db.insert("journalEntries", {
    ownerId: userId,
    number: await nextEntryNumber(ctx, userId),
    at: args.at,
    kind: args.kind,
    memo: args.memo?.trim() || undefined,
    party: args.party?.trim() || undefined,
    expenseId: args.expenseId,
    createdAt: Date.now(),
  });
  for (const line of usable) {
    const account = await ctx.db.get(line.accountId);
    if (account === null) continue;
    await ctx.db.insert("journalLines", {
      ownerId: userId,
      entryId,
      accountId: line.accountId,
      accountCode: account.code,
      accountName: account.name,
      debit: line.debit,
      credit: line.credit,
      memo: line.memo,
    });
  }
  return entryId;
}

export const createEntry = mutation({
  args: {
    at: v.number(),
    kind: v.union(
      v.literal("journal"),
      v.literal("opening"),
      v.literal("receipt"),
      v.literal("payment"),
    ),
    memo: v.optional(v.string()),
    party: v.optional(v.string()),
    lines: lineValidator,
  },
  handler: async (ctx, args): Promise<Id<"journalEntries">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to post to the ledger.");
    return postEntry(ctx, userId, args);
  },
});

export const removeEntry = mutation({
  args: { id: v.id("journalEntries") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to post to the ledger.");
    const entry = await ctx.db.get(id);
    if (entry === null || entry.ownerId !== userId) {
      throw new Error("That entry no longer exists.");
    }
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_entry", (q) => q.eq("entryId", id))
      .collect();
    for (const line of lines) await ctx.db.delete(line._id);
    await ctx.db.delete(id);
  },
});

/**
 * The day book: every posting in a date range, grouped by day with a running
 * total. `cashOnly` narrows it to the cash and bank accounts, which is what
 * the cash book is.
 */
export const dayBook = query({
  args: { from: v.number(), to: v.number(), cashOnly: v.optional(v.boolean()) },
  handler: async (
    ctx,
    { from, to, cashOnly },
  ): Promise<{ day: number; debit: number; credit: number }[]> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    // the cash book follows the accounts Settings names as cash and bank, so
    // recoding or renaming them does not quietly empty this report
    const cashIds = await moneyAccountIds(ctx, userId);
    const cashCodes = new Set(
      accounts.filter((a) => cashIds.has(a._id)).map((a) => a.code),
    );
    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_at", (q) =>
        q.eq("ownerId", userId).gte("at", from).lte("at", to),
      )
      .collect();
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const byEntry = new Map<Id<"journalEntries">, typeof lines>();
    for (const line of lines) {
      const list = byEntry.get(line.entryId) ?? [];
      list.push(line);
      byEntry.set(line.entryId, list);
    }

    const days = new Map<number, { day: number; debit: number; credit: number }>();
    for (const entry of entries) {
      const entryLines = (byEntry.get(entry._id) ?? []).filter(
        (l) => !cashOnly || cashIds.has(l.accountId) || cashCodes.has(l.accountCode),
      );
      if (entryLines.length === 0) continue;
      const day = new Date(entry.at).setHours(0, 0, 0, 0);
      const row = days.get(day) ?? { day, debit: 0, credit: 0 };
      for (const line of entryLines) {
        if (line.debit > 0) row.debit += line.debit;
        if (line.credit > 0) row.credit += line.credit;
      }
      row.debit = round(row.debit);
      row.credit = round(row.credit);
      days.set(day, row);
    }
    return Array.from(days.values()).sort((a, b) => a.day - b.day);
  },
});
