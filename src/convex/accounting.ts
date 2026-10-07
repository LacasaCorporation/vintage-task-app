import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { moneyAccountIds } from "./accountingDefaults";
import { requireItem } from "./authorize";
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
  /** The group this account sits under, if any. */
  parentId?: Id<"accounts">;
  isBank: boolean;
  bankName?: string;
  accountNumber?: string;
  bsb?: string;
  currency?: string;
  /** Debit-positive balance from posted lines, plus the opening balance. */
  balance: number;
  debit: number;
  credit: number;
  /** A signed balance, as the type reports it (income and liability read positive). */
  signed: number;
  /** Direct children, so the chart can subtotal a group without a second query. */
  childIds: Id<"accounts">[];
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

export function signFor(type: AccountType): number {
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
  /** The code of the group this sits under. Applied once the ids exist. */
  parent?: string;
  isBank?: boolean;
  bankName?: string;
}[] = [
  { code: "1000", name: "Assets", type: "asset", isGroup: true },
  { code: "1100", name: "Cash in hand", type: "asset", parent: "1000" },
  {
    code: "1110",
    name: "Bank account",
    type: "asset",
    parent: "1000",
    isBank: true,
    bankName: "Bank account",
  },
  {
    code: "1120",
    name: "Payroll account",
    type: "asset",
    parent: "1000",
    isBank: true,
    bankName: "Payroll account",
  },
  { code: "1200", name: "Accounts receivable", type: "asset", parent: "1000" },
  {
    code: "1210",
    name: "Customer advances",
    type: "asset",
    parent: "1200",
  },
  {
    code: "1300",
    name: "Raw material inventory",
    type: "asset",
    parent: "1000",
  },
  {
    code: "1400",
    name: "Finished goods inventory",
    type: "asset",
    parent: "1000",
  },
  { code: "1500", name: "Plant & equipment", type: "asset", parent: "1000" },

  { code: "2000", name: "Liabilities", type: "liability", isGroup: true },
  { code: "2100", name: "Accounts payable", type: "liability", parent: "2000" },
  {
    code: "2110",
    name: "Supplier advances",
    type: "liability",
    parent: "2100",
  },
  { code: "2200", name: "Loans payable", type: "liability", parent: "2000" },
  { code: "2300", name: "GST / tax payable", type: "liability", parent: "2000" },

  { code: "3000", name: "Equity", type: "equity", isGroup: true },
  { code: "3100", name: "Owner capital", type: "equity", parent: "3000" },
  { code: "3200", name: "Retained earnings", type: "equity", parent: "3000" },

  { code: "4000", name: "Income", type: "income", isGroup: true },
  { code: "4100", name: "Sales revenue", type: "income", parent: "4000" },
  { code: "4200", name: "Other income", type: "income", parent: "4000" },

  { code: "5000", name: "Expenses", type: "expense", isGroup: true },
  {
    code: "5100",
    name: "Cost of goods sold",
    type: "expense",
    parent: "5000",
  },
  {
    code: "5200",
    name: "Raw material purchased",
    type: "expense",
    parent: "5000",
  },
  { code: "5300", name: "Rent", type: "expense", parent: "5000" },
  { code: "5400", name: "Salaries & wages", type: "expense", parent: "5000" },
  { code: "5500", name: "Utilities", type: "expense", parent: "5000" },
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
    // Parents are written first and their ids remembered, so a child can be
    // filed under its heading in the same pass. Codes run in ascending order
    // and a group always carries a lower code than what sits under it.
    const idOf = new Map<string, Id<"accounts">>();
    for (const a of DEFAULT_ACCOUNTS) {
      const parentId =
        a.parent === undefined ? undefined : idOf.get(a.parent);
      if (a.parent !== undefined && parentId === undefined) continue;
      const id = await ctx.db.insert("accounts", {
        ownerId: userId,
        code: a.code,
        name: a.name,
        type: a.type,
        isGroup: a.isGroup === true ? true : undefined,
        parentId,
        isBank: a.isBank === true ? true : undefined,
        bankName: a.bankName,
      });
      idOf.set(a.code, id);
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

    const childrenOf = new Map<Id<"accounts">, Id<"accounts">[]>();
    for (const a of accounts) {
      if (a.parentId === undefined) continue;
      const list = childrenOf.get(a.parentId) ?? [];
      list.push(a._id);
      childrenOf.set(a.parentId, list);
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
          parentId: a.parentId,
          isBank: a.isBank === true,
          bankName: a.bankName,
          accountNumber: a.accountNumber,
          bsb: a.bsb,
          currency: a.currency,
          balance,
          debit,
          credit,
          signed: round(balance * signFor(a.type)),
          childIds: childrenOf.get(a._id) ?? [],
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

const accountTypeValidator = v.union(
  v.literal("asset"),
  v.literal("liability"),
  v.literal("equity"),
  v.literal("income"),
  v.literal("expense"),
);

/** The leading digit of a code, by the side of the balance it lands on. */
const TYPE_PREFIX: Record<AccountType, string> = {
  asset: "1",
  liability: "2",
  equity: "3",
  income: "4",
  expense: "5",
};

/**
 * A parent must be a group of the same type: an asset account cannot sit
 * under an expense heading. The walk up the chain also refuses to meet the
 * account being moved, which is what would make the chart loop forever.
 */
async function assertParent(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  parentId: Id<"accounts"> | undefined,
  type: AccountType,
  selfId?: Id<"accounts">,
): Promise<void> {
  if (parentId === undefined) return;
  if (selfId !== undefined && parentId === selfId) {
    throw new Error("An account cannot be its own parent.");
  }
  const parent = await ctx.db.get(parentId);
  if (parent === null || parent.ownerId !== ownerId) {
    throw new Error("That group no longer exists.");
  }
  if (parent.isGroup !== true) {
    throw new Error(`${parent.code} ${parent.name} is not a group.`);
  }
  if (parent.type !== type) {
    throw new Error(
      `${parent.code} ${parent.name} is an ${parent.type} group — this account is ${type}.`,
    );
  }
  let cursor: Doc<"accounts"> | null = parent;
  while (cursor !== null && cursor.parentId !== undefined) {
    if (selfId !== undefined && cursor.parentId === selfId) {
      throw new Error("That would nest the account inside itself.");
    }
    cursor = await ctx.db.get(cursor.parentId);
  }
}

/** Bank detail is stripped unless the account is actually flagged as a bank. */
function bankFields(args: {
  isBank?: boolean;
  bankName?: string;
  accountNumber?: string;
  bsb?: string;
  currency?: string;
}): {
  isBank: boolean;
  bankName?: string;
  accountNumber?: string;
  bsb?: string;
  currency?: string;
} {
  const currency = args.currency?.trim() || undefined;
  if (args.isBank !== true) {
    return {
      isBank: false,
      bankName: undefined,
      accountNumber: undefined,
      bsb: undefined,
      currency,
    };
  }
  return {
    isBank: true,
    bankName: args.bankName?.trim() || undefined,
    accountNumber: args.accountNumber?.trim() || undefined,
    bsb: args.bsb?.trim() || undefined,
    currency,
  };
}

/** The next free code in a block, so the form can offer one. */
export const suggestCode = query({
  args: { type: accountTypeValidator },
  handler: async (ctx, { type }): Promise<string> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return `${TYPE_PREFIX[type]}100`;
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const used = new Set(accounts.map((a) => a.code));
    const prefix = TYPE_PREFIX[type];
    for (let n = 1; n <= 99; n += 1) {
      const candidate = `${prefix}${n < 10 ? "0" : ""}${n}`;
      if (!used.has(candidate)) return candidate;
    }
    return `${prefix}99`;
  },
});

export const createAccount = mutation({
  args: {
    code: v.string(),
    name: v.string(),
    type: accountTypeValidator,
    isGroup: v.optional(v.boolean()),
    parentId: v.optional(v.id("accounts")),
    note: v.optional(v.string()),
    isBank: v.optional(v.boolean()),
    bankName: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    bsb: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"accounts">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to manage accounts.");
    await requireItem(ctx, userId, "accounting", "create");
    const code = args.code.trim();
    const name = args.name.trim();
    if (!code) throw new Error("Give the account a code.");
    if (!name) throw new Error("Give the account a name.");
    if (args.isBank === true && args.isGroup === true) {
      throw new Error("A group holds no balance, so it cannot be a bank account.");
    }
    const clash = await ctx.db
      .query("accounts")
      .withIndex("by_code", (q) =>
        q.eq("ownerId", userId).eq("code", code),
      )
      .first();
    if (clash !== null) throw new Error(`Account ${code} already exists.`);
    await assertParent(ctx, userId, args.parentId, args.type);
    return await ctx.db.insert("accounts", {
      ownerId: userId,
      code,
      name,
      type: args.type,
      isGroup: args.isGroup === true ? true : undefined,
      parentId: args.parentId,
      note: args.note?.trim() || undefined,
      ...bankFields(args),
    });
  },
});

export const updateAccount = mutation({
  args: {
    id: v.id("accounts"),
    code: v.optional(v.string()),
    name: v.string(),
    type: accountTypeValidator,
    isGroup: v.optional(v.boolean()),
    parentId: v.optional(v.id("accounts")),
    note: v.optional(v.string()),
    isBank: v.optional(v.boolean()),
    bankName: v.optional(v.string()),
    accountNumber: v.optional(v.string()),
    bsb: v.optional(v.string()),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to manage accounts.");
    await requireItem(ctx, userId, "accounting", "edit");
    const account = await ctx.db.get(args.id);
    if (account === null || account.ownerId !== userId) {
      throw new Error("That account no longer exists.");
    }
    const name = args.name.trim();
    if (!name) throw new Error("Give the account a name.");
    if (args.isBank === true && args.isGroup === true) {
      throw new Error("A group holds no balance, so it cannot be a bank account.");
    }

    const code = args.code?.trim() || account.code;
    if (code !== account.code) {
      const clash = await ctx.db
        .query("accounts")
        .withIndex("by_code", (q) =>
          q.eq("ownerId", userId).eq("code", code),
        )
        .first();
      if (clash !== null) throw new Error(`Account ${code} already exists.`);
    }

    // turning a leaf into a group is fine; turning a group into a leaf would
    // silently swallow everything filed under it
    const children = await ctx.db
      .query("accounts")
      .withIndex("by_parent", (q) =>
        q.eq("ownerId", userId).eq("parentId", args.id),
      )
      .collect();
    if (children.length > 0 && args.isGroup !== true) {
      throw new Error(
        `${code} ${name} still holds ${children.length} account${
          children.length === 1 ? "" : "s"
        } — move them out first.`,
      );
    }

    // the type decides which side of the balance reads positive, so it cannot
    // move once money has been posted through the account
    if (args.type !== account.type) {
      const used = await ctx.db
        .query("journalLines")
        .withIndex("by_account", (q) =>
          q.eq("ownerId", userId).eq("accountId", args.id),
        )
        .first();
      if (used !== null) {
        throw new Error(
          `${code} ${name} has postings, so its type can no longer be changed.`,
        );
      }
    }

    await assertParent(ctx, userId, args.parentId, args.type, args.id);
    await ctx.db.patch(args.id, {
      code,
      name,
      type: args.type,
      isGroup: args.isGroup === true ? true : undefined,
      parentId: args.parentId,
      note: args.note?.trim() || undefined,
      ...bankFields(args),
    });
  },
});

export const removeAccount = mutation({
  args: { id: v.id("accounts") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to manage accounts.");
    await requireItem(ctx, userId, "accounting", "delete");
    const account = await ctx.db.get(id);
    if (account === null || account.ownerId !== userId) {
      throw new Error("That account no longer exists.");
    }
    const children = await ctx.db
      .query("accounts")
      .withIndex("by_parent", (q) =>
        q.eq("ownerId", userId).eq("parentId", id),
      )
      .collect();
    if (children.length > 0) {
      throw new Error(
        `${account.code} ${account.name} still holds ${children.length} account${
          children.length === 1 ? "" : "s"
        } — move or remove them first.`,
      );
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
    await requireItem(ctx, userId, "accounting", "create");
    return postEntry(ctx, userId, args);
  },
});

export const removeEntry = mutation({
  args: { id: v.id("journalEntries") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to post to the ledger.");
    await requireItem(ctx, userId, "accounting", "delete");
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
