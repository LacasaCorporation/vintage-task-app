import { query } from "./_generated/server";
import { scopeUserId } from "./org";
import { moneyAccountIds } from "./accountingDefaults";
import { costByProduct } from "../lib/product-cost";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Everything the Reports section draws.
 *
 * These are read-only projections of data the rest of the app already owns —
 * nothing here writes, and nothing here is a second source of truth. The
 * statements are built from the journal rather than from the account
 * balances, because a balance is "everything ever posted" and a statement of
 * profit for a period is "what was posted between these two dates". Mixing
 * the two is the classic way a trial balance and a P&L end up disagreeing.
 */

const round = (n: number) => Math.round(n * 1e2) / 1e2;

type AccountType = Doc<"accounts">["type"];

const TYPE_ORDER: AccountType[] = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
];

const TYPE_LABELS: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

/** One ledger account with a period's debits and credits against it. */
export type LedgerAccount = {
  _id: Id<"accounts">;
  code: string;
  name: string;
  type: AccountType;
  isGroup: boolean;
  parentId?: Id<"accounts">;
  /** Debits posted to the account between the report's dates. */
  debit: number;
  /** Credits posted to the account between the report's dates. */
  credit: number;
};

/**
 * Accounts plus the debits and credits that landed on them in a window.
 *
 * `from`/`to` both undefined means all time, which is what the trial balance
 * wants: a trial balance is a statement about everything in the books today,
 * not about a period.
 */
async function ledgerIn(
  ctx: QueryCtx,
  userId: Id<"users">,
  window?: { from?: number; to?: number },
): Promise<LedgerAccount[]> {
  const accounts = await ctx.db
    .query("accounts")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  if (accounts.length === 0) return [];

  const entries = await ctx.db
    .query("journalEntries")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  const wanted = new Set(
    entries
      .filter(
        (e) =>
          (window?.from === undefined || e.at >= window.from) &&
          (window?.to === undefined || e.at <= window.to),
      )
      .map((e) => e._id),
  );
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();

  const totals = new Map<Id<"accounts">, { debit: number; credit: number }>();
  for (const line of lines) {
    if (!wanted.has(line.entryId)) continue;
    const t = totals.get(line.accountId) ?? { debit: 0, credit: 0 };
    t.debit += line.debit;
    t.credit += line.credit;
    totals.set(line.accountId, t);
  }

  return accounts
    .map((a) => {
      const t = totals.get(a._id) ?? { debit: 0, credit: 0 };
      return {
        _id: a._id,
        code: a.code,
        name: a.name,
        type: a.type,
        isGroup: a.isGroup === true,
        parentId: a.parentId,
        debit: round(t.debit),
        credit: round(t.credit),
      };
    })
    .sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
}

/**
 * The trial balance: every posting account with its balance in the heavier
 * column. Group headings hold no balance of their own, so they are listed
 * only to keep the code order readable — carrying a rolled-up figure as well
 * as its children's is how a trial balance stops balancing.
 */
export const trialBalance = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return { rows: [], totalDebit: 0, totalCredit: 0 };
    const accounts = await ledgerIn(ctx, userId);

    const rows = accounts
      .filter((a) => !a.isGroup)
      .map((a) => {
        const balance = round(a.debit - a.credit);
        return {
          _id: a._id,
          code: a.code,
          name: a.name,
          type: a.type,
          balance,
          debit: balance > 0 ? balance : 0,
          credit: balance < 0 ? -balance : 0,
          activity: round(a.debit + a.credit),
        };
      })
      .filter((r) => r.balance !== 0 || r.activity !== 0);

    const totalDebit = round(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round(rows.reduce((s, r) => s + r.credit, 0));
    return { rows, totalDebit, totalCredit };
  },
});

export type StatementLine = {
  _id: Id<"accounts">;
  code: string;
  name: string;
  /** Signed the way the statement reads: assets and expenses positive. */
  balance: number;
  debit: number;
  credit: number;
};

export type StatementSection = {
  type: AccountType;
  label: string;
  lines: StatementLine[];
  /** What this section adds up to. */
  total: number;
};

/**
 * The statement of financial position, as at a date.
 *
 * Profit for the period is not an account — it is the difference between
 * income and expense postings in the window — so it is added to the credit
 * side explicitly rather than smuggled in under equity. Whatever the opening
 * balances were, the two sides should meet; the difference is printed rather
 * than hidden, because a balance sheet that quietly disagrees is worse than
 * one that admits it.
 */
export const financialPosition = query({
  args: { from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, { from, to }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null)
      return {
        asAt: to ?? Date.now(),
        sections: [],
        assets: 0,
        liabilities: 0,
        equity: 0,
        profit: 0,
        credits: 0,
        difference: 0,
        empty: true,
      };

    // Two readings, because the two halves of the statement answer different
    // questions. What the firm owns and owes is cumulative: everything ever
    // posted up to the date, not just the period. What it earned and spent is
    // the window on its own. Reading assets out of the period alone would
    // quietly delete every balance built before the period started.
    const asAt = to ?? Date.now();
    const cumulative = await ledgerIn(
      ctx,
      userId,
      to === undefined ? {} : { to },
    );
    const period =
      from === undefined
        ? cumulative
        : await ledgerIn(ctx, userId, { from, to });
    const leaves = cumulative.filter((a) => !a.isGroup);
    const periodLeaves = period.filter((a) => !a.isGroup);

    const line = (a: LedgerAccount, positive: boolean): StatementLine => {
      const debit = round(a.debit);
      const credit = round(a.credit);
      return {
        _id: a._id,
        code: a.code,
        name: a.name,
        debit,
        credit,
        balance: round(positive ? debit - credit : credit - debit),
      };
    };
    const linesFor = (
      source: LedgerAccount[],
      type: AccountType,
    ): StatementLine[] =>
      source
        .filter((a) => a.type === type)
        // liabilities and equity read positive when they are owed / held
        .map((a) => line(a, type === "asset" || type === "expense"))
        .filter((l) => l.balance !== 0 || l.debit !== 0 || l.credit !== 0);

    const sections: StatementSection[] = TYPE_ORDER.map((type) => {
      const lines =
        type === "income" || type === "expense"
          ? linesFor(periodLeaves, type)
          : linesFor(leaves, type);
      return {
        type,
        label: TYPE_LABELS[type],
        lines,
        total: round(lines.reduce((s, l) => s + l.balance, 0)),
      };
    }).filter((s) => s.lines.length > 0);

    const assets = sections.find((s) => s.type === "asset")?.total ?? 0;
    const liabilities = sections.find((s) => s.type === "liability")?.total ?? 0;
    const equity = sections.find((s) => s.type === "equity")?.total ?? 0;
    const income = sections.find((s) => s.type === "income")?.total ?? 0;
    const expenses = sections.find((s) => s.type === "expense")?.total ?? 0;
    const profit = round(income - expenses);
    const credits = round(liabilities + equity + profit);
    return {
      asAt,
      sections,
      assets,
      liabilities,
      equity,
      profit,
      credits,
      difference: round(assets - credits),
      empty: leaves.length === 0,
    };
  },
});

/**
 * Profit and loss for a window. Income is a credit account and an expense a
 * debit one, so the two are read in their natural direction and the result is
 * the margin. A loss is shown as a negative, not as a flipped total.
 */
export const profitAndLoss = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null)
      return {
        from,
        to,
        income: [],
        expense: [],
        totalIncome: 0,
        totalExpense: 0,
        profit: 0,
        margin: 0,
        empty: true,
      };

    const accounts = await ledgerIn(ctx, userId, { from, to });
    const leaves = accounts.filter((a) => !a.isGroup);

    const build = (type: "income" | "expense") =>
      leaves
        .filter((a) => a.type === type)
        .map((a) => ({
          _id: a._id,
          code: a.code,
          name: a.name,
          debit: round(a.debit),
          credit: round(a.credit),
          amount: round(type === "income" ? a.credit - a.debit : a.debit - a.credit),
        }))
        .filter((l) => l.amount !== 0)
        .sort((x, y) => y.amount - x.amount);

    const income = build("income");
    const expense = build("expense");
    const totalIncome = round(income.reduce((s, l) => s + l.amount, 0));
    const totalExpense = round(expense.reduce((s, l) => s + l.amount, 0));
    const profit = round(totalIncome - totalExpense);
    return {
      from,
      to,
      income,
      expense,
      totalIncome,
      totalExpense,
      profit,
      margin: totalIncome === 0 ? 0 : round((profit / totalIncome) * 100),
      empty: income.length === 0 && expense.length === 0,
    };
  },
});

/**
 * The day book: one row per day with what came in, what went out and the net,
 * plus the cash and bank share of each so the day can be read against the
 * cash book without a second lookup.
 */
export const dayBook = query({
  args: {
    from: v.number(),
    to: v.number(),
    cashOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { from, to, cashOnly }) => {
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

    const days = new Map<
      number,
      {
        day: number;
        debit: number;
        credit: number;
        cashDebit: number;
        cashCredit: number;
        entries: number;
      }
    >();
    for (const entry of entries) {
      const entryLines = (byEntry.get(entry._id) ?? []).filter(
        (l) =>
          !cashOnly || cashIds.has(l.accountId) || cashCodes.has(l.accountCode),
      );
      if (entryLines.length === 0) continue;
      const day = new Date(entry.at).setHours(0, 0, 0, 0);
      const row = days.get(day) ?? {
        day,
        debit: 0,
        credit: 0,
        cashDebit: 0,
        cashCredit: 0,
        entries: 0,
      };
      for (const line of entryLines) {
        if (line.debit > 0) {
          row.debit += line.debit;
          if (cashIds.has(line.accountId) || cashCodes.has(line.accountCode))
            row.cashDebit += line.debit;
        }
        if (line.credit > 0) {
          row.credit += line.credit;
          if (cashIds.has(line.accountId) || cashCodes.has(line.accountCode))
            row.cashCredit += line.credit;
        }
      }
      row.entries += 1;
      row.debit = round(row.debit);
      row.credit = round(row.credit);
      row.cashDebit = round(row.cashDebit);
      row.cashCredit = round(row.cashCredit);
      days.set(day, row);
    }
    return Array.from(days.values()).sort((a, b) => a.day - b.day);
  },
});

/** One row of any of the sales groupings. */
export type SaleRow = {
  key: string;
  label: string;
  secondary: string;
  invoices: number;
  qty: number;
  /** At line value, before tax and before any discount. */
  value: number;
  /** What the invoices came to in total, tax and discount included. */
  total: number;
  paid: number;
  outstanding: number;
  share: number;
};

export type SalePeriodRow = {
  key: string;
  label: string;
  from: number;
  to: number;
  invoices: number;
  qty: number;
  total: number;
  paid: number;
  outstanding: number;
};

export type UnpaidInvoice = {
  _id: Id<"sales">;
  number: string;
  at: number;
  dueAt?: number;
  party: string;
  total: number;
  paid: number;
  outstanding: number;
  ageDays: number;
  overdue: boolean;
};

export type SalesAnalysis = {
  from: number;
  to: number;
  bucket: "day" | "week" | "month" | "quarter";
  byProduct: SaleRow[];
  byCustomer: SaleRow[];
  byPeriod: SalePeriodRow[];
  unpaid: UnpaidInvoice[];
  totalInvoiced: number;
  totalValue: number;
  totalOutstanding: number;
  empty: boolean;
};

/** How finely to cut the timeline: a week of days, a year of months. */
function bucketFor(days: number): SalesAnalysis["bucket"] {
  if (days <= 31) return "day";
  if (days <= 120) return "week";
  if (days <= 1100) return "month";
  return "quarter";
}

function periodKey(at: number, bucket: SalesAnalysis["bucket"]) {
  const d = new Date(at);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = Math.floor(d.getDate() / 7);
  const start = new Date(d);
  let label: string;
  if (bucket === "day") {
    label = start.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
    });
  } else if (bucket === "week") {
    label = `Week ${day + 1}, ${start.toLocaleDateString(undefined, {
      month: "short",
    })}`;
  } else if (bucket === "month") {
    label = start.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  } else {
    label = `${start.toLocaleDateString(undefined, { month: "short" })} ${
      Math.floor(m / 3) + 1
    } Q`;
  }
  const from = new Date(y, m, 1);
  if (bucket === "week") from.setDate(1 - d.getDay() + 1 + day * 7);
  if (bucket === "quarter") from.setMonth(Math.floor(m / 3) * 3, 1);
  const to = new Date(from);
  if (bucket === "day") to.setDate(to.getDate() + 1);
  if (bucket === "week") to.setDate(to.getDate() + 7);
  if (bucket === "month") to.setMonth(to.getMonth() + 1);
  if (bucket === "quarter") to.setMonth(to.getMonth() + 3);
  return {
    key: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-${
      bucket === "day" ? String(from.getDate()).padStart(2, "0") : bucket
    }`,
    label,
    from: from.getTime(),
    to: to.getTime() - 1,
  };
}

function partyName(
  id: Id<"customers"> | undefined,
  name: string | undefined,
): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : id ? "Customer" : "Walk-in";
}

/**
 * The sales side of the reports: the same invoices read four ways. Value is
 * the line value and total is what the customer was billed, so a product that
 * appears on a heavily discounted invoice still shows its true contribution.
 */
export const salesAnalysis = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }): Promise<SalesAnalysis> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) {
      return {
        from,
        to,
        bucket: "day",
        byProduct: [],
        byCustomer: [],
        byPeriod: [],
        unpaid: [],
        totalInvoiced: 0,
        totalValue: 0,
        totalOutstanding: 0,
        empty: true,
      };
    }

    const all = await ctx.db
      .query("sales")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const invoices = all
      .filter((s) => s.soldAt >= from && s.soldAt <= to)
      .sort((a, b) => a.soldAt - b.soldAt);
    const bucket = bucketFor(Math.round((to - from) / 86_400_000));
    const now = Date.now();

    type Acc = {
      key: string;
      label: string;
      secondary: string;
      invoices: number;
      qty: number;
      value: number;
      total: number;
      paid: number;
      unit: string;
    };
    const products = new Map<string, Acc>();
    const customers = new Map<string, Acc>();
    const periods = new Map<string, SalePeriodRow>();

    for (const inv of invoices) {
      const paid = inv.isPaid === true ? inv.total : 0;
      const p = periodKey(inv.soldAt, bucket);
      const prow = periods.get(p.key) ?? {
        key: p.key,
        label: p.label,
        from: p.from,
        to: p.to,
        invoices: 0,
        qty: 0,
        total: 0,
        paid: 0,
        outstanding: 0,
      };
      prow.invoices += 1;
      prow.total += inv.total;
      prow.paid += paid;
      prow.outstanding += inv.total - paid;
      for (const line of inv.lines) prow.qty += line.qty;
      periods.set(p.key, prow);

      const cname = partyName(inv.customerId, inv.customerName);
      const ckey = inv.customerId ?? `name:${cname}`;
      const c = customers.get(ckey) ?? {
        key: ckey,
        label: cname,
        secondary: "",
        invoices: 0,
        qty: 0,
        value: 0,
        total: 0,
        paid: 0,
        unit: "",
      };
      c.invoices += 1;
      c.total += inv.total;
      c.paid += paid;
      for (const line of inv.lines) {
        c.qty += line.qty;
        c.value += line.qty * line.unitPrice;
      }
      customers.set(ckey, c);

      for (const line of inv.lines) {
        const key = line.productId;
        const row = products.get(key) ?? {
          key,
          label: line.name,
          secondary: line.unit ?? "",
          invoices: 0,
          qty: 0,
          value: 0,
          total: 0,
          paid: 0,
          unit: line.unit ?? "",
        };
        row.invoices += 1;
        row.qty += line.qty;
        row.value += line.qty * line.unitPrice;
        row.total += line.qty * line.unitPrice;
        row.paid += (line.qty * line.unitPrice * (inv.total > 0 ? paid / inv.total : 0));
        products.set(key, row);
      }
    }

    const totalInvoiced = round(invoices.reduce((s, i) => s + i.total, 0));
    const toRows = (m: Map<string, Acc>): SaleRow[] =>
      Array.from(m.values())
        .map((r) => ({
          key: r.key,
          label: r.label,
          secondary: r.secondary,
          invoices: r.invoices,
          qty: round(r.qty),
          value: round(r.value),
          total: round(r.total),
          paid: round(r.paid),
          outstanding: round(r.total - r.paid),
          share:
            totalInvoiced === 0 ? 0 : round((r.total / totalInvoiced) * 100),
        }))
        .sort((a, b) => b.total - a.total);

    // unpaid is not a period: it is a state, and it lists the whole ledger
    const unpaid: UnpaidInvoice[] = all
      .filter((i) => i.isPaid !== true && i.total > 0)
      .map((i) => {
        const paid = 0;
        const ageDays = Math.max(
          0,
          Math.round((now - i.soldAt) / 86_400_000),
        );
        return {
          _id: i._id,
          number: i.number,
          at: i.soldAt,
          dueAt: i.dueAt,
          party: partyName(i.customerId, i.customerName),
          total: round(i.total),
          paid,
          outstanding: round(i.total - paid),
          ageDays,
          overdue: i.dueAt !== undefined && i.dueAt < now,
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding || b.ageDays - a.ageDays);

    return {
      from,
      to,
      bucket,
      byProduct: toRows(products),
      byCustomer: toRows(customers),
      byPeriod: Array.from(periods.values())
        .map((p) => ({
          ...p,
          qty: round(p.qty),
          total: round(p.total),
          paid: round(p.paid),
          outstanding: round(p.outstanding),
        }))
        .sort((a, b) => a.from - b.from),
      unpaid,
      totalInvoiced,
      totalValue: round(
        invoices.reduce(
          (s, i) => s + i.lines.reduce((t, l) => t + l.qty * l.unitPrice, 0),
          0,
        ),
      ),
      totalOutstanding: round(unpaid.reduce((s, u) => s + u.outstanding, 0)),
      empty: invoices.length === 0,
    };
  },
});

export type PurchaseRow = SaleRow & { key: string };
export type PurchasePeriodRow = SalePeriodRow;

export type UnpaidBill = {
  _id: Id<"purchases">;
  number: string;
  at: number;
  dueAt?: number;
  party: string;
  total: number;
  paid: number;
  outstanding: number;
  ageDays: number;
  overdue: boolean;
};

export type PurchaseAnalysis = {
  from: number;
  to: number;
  bucket: "day" | "week" | "month" | "quarter";
  bySupplier: PurchaseRow[];
  byMaterial: PurchaseRow[];
  byPeriod: PurchasePeriodRow[];
  unpaid: UnpaidBill[];
  totalBilled: number;
  totalValue: number;
  totalOutstanding: number;
  empty: boolean;
};

/** The purchase side, mirroring the sales reports line for line. */
export const purchaseAnalysis = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }): Promise<PurchaseAnalysis> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) {
      return {
        from,
        to,
        bucket: "day",
        bySupplier: [],
        byMaterial: [],
        byPeriod: [],
        unpaid: [],
        totalBilled: 0,
        totalValue: 0,
        totalOutstanding: 0,
        empty: true,
      };
    }

    const all = await ctx.db
      .query("purchases")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const bills = all
      .filter((b) => b.purchasedAt >= from && b.purchasedAt <= to)
      .sort((a, b) => a.purchasedAt - b.purchasedAt);
    const bucket = bucketFor(Math.round((to - from) / 86_400_000));
    const now = Date.now();

    type Acc = {
      key: string;
      label: string;
      secondary: string;
      bills: number;
      qty: number;
      value: number;
      total: number;
      paid: number;
      unit: string;
    };
    const suppliers = new Map<string, Acc>();
    const materials = new Map<string, Acc>();
    const periods = new Map<string, PurchasePeriodRow>();

    for (const bill of bills) {
      const paid = bill.isPaid === true ? bill.total : 0;
      const p = periodKey(bill.purchasedAt, bucket);
      const prow = periods.get(p.key) ?? {
        key: p.key,
        label: p.label,
        from: p.from,
        to: p.to,
        invoices: 0,
        qty: 0,
        total: 0,
        paid: 0,
        outstanding: 0,
      };
      prow.invoices += 1;
      prow.total += bill.total;
      prow.paid += paid;
      prow.outstanding += bill.total - paid;
      for (const line of bill.lines) prow.qty += line.qty;
      periods.set(p.key, prow);

      const sname = bill.supplier?.trim() || "Unnamed supplier";
      const skey = bill.supplierId ?? `name:${sname}`;
      const s = suppliers.get(skey) ?? {
        key: skey,
        label: sname,
        secondary: "",
        bills: 0,
        qty: 0,
        value: 0,
        total: 0,
        paid: 0,
        unit: "",
      };
      s.bills += 1;
      s.total += bill.total;
      s.paid += paid;
      for (const line of bill.lines) {
        s.qty += line.qty;
        s.value += line.qty * line.unitCost;
      }
      suppliers.set(skey, s);

      for (const line of bill.lines) {
        const key = line.materialId;
        const row = materials.get(key) ?? {
          key,
          label: line.name,
          secondary: line.unit,
          bills: 0,
          qty: 0,
          value: 0,
          total: 0,
          paid: 0,
          unit: line.unit,
        };
        row.bills += 1;
        row.qty += line.qty;
        row.value += line.qty * line.unitCost;
        row.total += line.qty * line.unitCost;
        row.paid += line.qty * line.unitCost * (bill.total > 0 ? paid / bill.total : 0);
        materials.set(key, row);
      }
    }

    const totalBilled = round(bills.reduce((s, b) => s + b.total, 0));
    const toRows = (m: Map<string, Acc>): PurchaseRow[] =>
      Array.from(m.values())
        .map((r) => ({
          key: r.key,
          label: r.label,
          secondary: r.secondary,
          invoices: r.bills,
          qty: round(r.qty),
          value: round(r.value),
          total: round(r.total),
          paid: round(r.paid),
          outstanding: round(r.total - r.paid),
          share:
            totalBilled === 0 ? 0 : round((r.total / totalBilled) * 100),
        }))
        .sort((a, b) => b.total - a.total);

    const unpaid: UnpaidBill[] = all
      .filter((b) => b.isPaid !== true && b.total > 0)
      .map((b) => {
        const paid = 0;
        const ageDays = Math.max(
          0,
          Math.round((now - b.purchasedAt) / 86_400_000),
        );
        return {
          _id: b._id,
          number: b.number,
          at: b.purchasedAt,
          dueAt: b.dueAt,
          party: b.supplier?.trim() || "Unnamed supplier",
          total: round(b.total),
          paid,
          outstanding: round(b.total - paid),
          ageDays,
          overdue: b.dueAt !== undefined && b.dueAt < now,
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding || b.ageDays - a.ageDays);

    return {
      from,
      to,
      bucket,
      bySupplier: toRows(suppliers),
      byMaterial: toRows(materials),
      byPeriod: Array.from(periods.values())
        .map((p) => ({
          ...p,
          qty: round(p.qty),
          total: round(p.total),
          paid: round(p.paid),
          outstanding: round(p.outstanding),
        }))
        .sort((a, b) => a.from - b.from),
      unpaid,
      totalBilled,
      totalValue: round(
        bills.reduce(
          (s, b) => s + b.lines.reduce((t, l) => t + l.qty * l.unitCost, 0),
          0,
        ),
      ),
      totalOutstanding: round(unpaid.reduce((s, u) => s + u.outstanding, 0)),
      empty: bills.length === 0,
    };
  },
});

export type ValuationRow = {
  key: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  /** What one unit costs — the material's price, or the sheet's build cost. */
  cost: number;
  /** What one unit sells for. A raw material has no sale price of its own. */
  price: number;
  value: number;
  /** Where the rate came from, so no figure here is ever a guess. */
  basis: "purchase" | "costing" | "invoice" | "none";
  /** The rate the value was struck at — the same figure as `price`. */
  rate: number;
  /** Nothing on record prices this line, so it is shown at zero. */
  unpriced: boolean;
};

export type MovementRow = {
  key: string;
  at: number;
  kind: "material" | "product";
  name: string;
  code: string;
  direction: "in" | "out";
  qty: number;
  unit: string;
  source: string;
  ref: string;
  /** Rate and value, where the movement has a trustworthy one. */
  rate: number;
  value: number;
};

export type StockAnalysis = {
  materials: ValuationRow[];
  products: ValuationRow[];
  materialTotal: number;
  productTotal: number;
  total: number;
  movement: MovementRow[];
  /**
   * Money in and money out over the window. Quantities are deliberately not
   * totalled: a shelf holds boards, metres and pieces, and adding those
   * together produces a number that means nothing.
   */
  movementInValue: number;
  movementOutValue: number;
  empty: boolean;
};

/**
 * What the stock is worth, and what moved.
 *
 * The rates come from the costing sheets, which is where the business already
 * records them: a product's cost is the sum of its sheet lines, and its sale
 * price is that cost marked up. Re-deriving a price here from invoice history
 * instead would value a perfectly well-costed product at nothing simply
 * because it has not been sold yet — and would quietly disagree with the
 * figure on the product's own sheet.
 *
 * Both rates are reported side by side, and the stock is valued on the sale
 * price, which is the rule the products list already uses. Valuing finished
 * goods at cost instead would need a costing method — weighted average or
 * FIFO — chosen once and applied to every issue; that is a decision about the
 * business, so the cost column is here for anyone who wants to read it that
 * way and the choice is not made silently.
 */
export const stockAnalysis = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }): Promise<StockAnalysis> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) {
      return {
        materials: [],
        products: [],
        materialTotal: 0,
        productTotal: 0,
        total: 0,
        movement: [],
        movementInValue: 0,
        movementOutValue: 0,
        empty: true,
      };
    }

    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const products = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    // the costing sheets are the source of truth for a product's rates, read
    // through the same helper the product list uses so the two cannot drift
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const sheetCost = costByProduct(items);

    // the last price a product went out for, for one that was sold but never
    // costed. Newest invoice wins.
    const invoices = await ctx.db
      .query("sales")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const lastPrice = new Map<Id<"finishedGoods">, number>();
    for (const inv of [...invoices].sort((a, b) => a.soldAt - b.soldAt)) {
      for (const line of inv.lines) {
        if (line.unitPrice > 0) lastPrice.set(line.productId, line.unitPrice);
      }
    }

    const materialRows: ValuationRow[] = materials
      .map((m) => {
        const qty = round(m.stock ?? 0);
        const cost = round(m.pricePerUnit);
        return {
          key: m._id,
          code: m.code ?? "",
          name: m.name,
          category: m.category ?? "",
          unit: m.unit,
          qty,
          cost,
          // a raw material is bought, not sold: its purchase price is both
          price: cost,
          value: round(qty * cost),
          basis: cost > 0 ? ("purchase" as const) : ("none" as const),
          rate: cost,
          unpriced: cost === 0,
        };
      })
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

    const productRows: ValuationRow[] = products
      .map((p) => {
        const qty = round(p.stock ?? 0);
        const built = round(sheetCost.get(p._id) ?? 0);
        const invoiced = round(lastPrice.get(p._id) ?? 0);
        // the sheet prices one piece, so its line total is already per unit
        const cost = built;
        const price =
          built > 0
            ? round(cost * (1 + (p.markupPct ?? 0) / 100))
            : invoiced;
        return {
          key: p._id,
          code: p.code ?? "",
          name: p.name,
          category: p.category ?? "",
          unit: p.unit ?? "pcs",
          qty,
          cost,
          price,
          value: round(qty * price),
          basis:
            built > 0
              ? ("costing" as const)
              : invoiced > 0
                ? ("invoice" as const)
                : ("none" as const),
          rate: price,
          unpriced: price === 0,
        };
      })
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

    const stockMovements = await ctx.db
      .query("stockMovements")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const productMovements = await ctx.db
      .query("productMovements")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const materialById = new Map(materials.map((m) => [m._id, m]));
    const productById = new Map(products.map((p) => [p._id, p]));
    // movements are valued on the same rates as the shelves, so a unit that
    // came in and a unit still on hand are worth the same figure here
    const materialRate = new Map(
      materialRows.map((r) => [r.key, r.price] as const),
    );
    const productRate = new Map(
      productRows.map((r) => [r.key, r.price] as const),
    );

    const movement: MovementRow[] = [
      ...stockMovements
        .filter((m) => m.at >= from && m.at <= to)
        .map((m) => {
          const material = materialById.get(m.materialId);
          const rate = materialRate.get(m.materialId) ?? 0;
          return {
            key: m._id,
            at: m.at,
            kind: "material" as const,
            name: m.name,
            code: material?.code ?? "",
            direction: m.direction,
            qty: round(m.qty),
            unit: m.unit,
            source: m.source,
            ref: m.ref ?? "",
            rate,
            value: round(m.qty * rate),
          };
        }),
      ...productMovements
        .filter((p) => p.at >= from && p.at <= to)
        .map((p) => {
          const product = productById.get(p.productId);
          const rate = productRate.get(p.productId) ?? 0;
          return {
            key: p._id,
            at: p.at,
            kind: "product" as const,
            name: p.name,
            code: product?.code ?? "",
            direction: p.direction,
            qty: round(p.qty),
            unit: p.unit,
            source: p.source,
            ref: p.ref ?? "",
            rate,
            value: round(p.qty * rate),
          };
        }),
    ].sort((a, b) => b.at - a.at);

    const materialTotal = round(
      materialRows.reduce((s, r) => s + r.value, 0),
    );
    const productTotal = round(productRows.reduce((s, r) => s + r.value, 0));
    return {
      materials: materialRows,
      products: productRows,
      materialTotal,
      productTotal,
      total: round(materialTotal + productTotal),
      movement,
      movementInValue: round(
        movement
          .filter((m) => m.direction === "in")
          .reduce((s, m) => s + m.value, 0),
      ),
      movementOutValue: round(
        movement
          .filter((m) => m.direction === "out")
          .reduce((s, m) => s + m.value, 0),
      ),
      empty: materialRows.length === 0 && productRows.length === 0,
    };
  },
});
