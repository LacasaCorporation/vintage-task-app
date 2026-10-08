import { query } from "./_generated/server";
import { scopeUserId } from "./org";
import { moneyAccountIds } from "./accountingDefaults";
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
  /**
   * What one unit costs, on a moving weighted average. Stock is valued on
   * this and never on what it sells for: what a thing costs the business is
   * what it is worth, and what it happens to fetch today is a different
   * number entirely.
   */
  cost: number;
  /** What one unit sells for. Shown for reference; never the value. */
  price: number;
  value: number;
  /**
   * How the cost was arrived at, so no figure here is ever a guess.
   * `average` — weighted across everything bought.
   * `price` — nothing has been bought, so the catalogue price stands in.
   * `costing` — a recipe, priced at its materials' weighted averages.
   * `invoice` — never costed, so the last price it went out for.
   */
  basis: "average" | "price" | "costing" | "invoice" | "none";
  /** How much was ever bought, which is what the average is over. */
  bought: number;
  /** The most recent purchase price, against the average it produced. */
  lastCost: number;
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
 * Stock is valued on a **moving weighted average cost**, for both shelves.
 * A material bought at two prices is neither of them, so its cost is the
 * average of everything ever bought; issuing stock does not change what the
 * rest of it cost, which is exactly what "moving average" means. A finished
 * product is costed from its recipe, but priced at its materials' weighted
 * averages rather than at whatever price each line was copied at when the
 * recipe was typed — otherwise the finished-goods shelf would quietly
 * disagree with the raw-material shelf it was made from.
 *
 * Sale price is reported beside the cost for reference and is never the
 * value. What a thing fetches is somebody else's number; what it cost is
 * this business's stock.
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

    /**
     * The moving weighted average cost of every raw material.
     *
     * A material bought at two prices is neither of them. The average is
     * taken over everything ever bought — the same figure a moving-average
     * ledger would arrive at, because issuing stock does not change what the
     * remaining stock cost. Where nothing has been bought the catalogue
     * price stands in, and says so.
     */
    const billLines = await ctx.db
      .query("purchaseLines")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
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

    /**
     * A product is costed from its recipe, but priced at its materials'
     * weighted averages rather than at whatever each line happened to be
     * copied at when the recipe was typed. Otherwise a product built from
     * materials that have since been repriced would keep reporting the old
     * cost forever, and the finished-goods shelf would disagree with the
     * raw-material shelf it was made from. A line with no material behind it
     * — labour, a fee — is the business's own number and is left alone.
     */
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const materialById0 = new Map(materials.map((m) => [m._id, m]));
    const sheetCost = new Map<Id<"finishedGoods">, number>();
    const sheetHas = new Set<Id<"finishedGoods">>();
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
      sheetHas.add(item.fgId);
    }

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
        const a = averages.get(m._id);
        const fromBills = a !== undefined && a.qty > 0;
        const cost = weighted(m._id, round(m.pricePerUnit));
        return {
          key: m._id,
          code: m.code ?? "",
          name: m.name,
          category: m.category ?? "",
          unit: m.unit,
          qty,
          cost,
          // a raw material is bought, not sold, so it has no price of its own
          price: cost,
          // the value is the cost. What it would fetch is somebody else's
          // number, not this business's stock.
          value: round(qty * cost),
          basis:
            cost === 0
              ? ("none" as const)
              : fromBills
                ? ("average" as const)
                : ("price" as const),
          bought: round(a?.qty ?? 0),
          lastCost: round(a?.last ?? 0),
        };
      })
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

    const productRows: ValuationRow[] = products
      .map((p) => {
        const qty = round(p.stock ?? 0);
        // the sheet prices one piece, so its line total is already per unit
        const built = round(sheetCost.get(p._id) ?? 0);
        const invoiced = round(lastPrice.get(p._id) ?? 0);
        const cost = built > 0 ? built : invoiced;
        const price =
          built > 0 ? round(cost * (1 + (p.markupPct ?? 0) / 100)) : invoiced;
        return {
          key: p._id,
          code: p.code ?? "",
          name: p.name,
          category: p.category ?? "",
          unit: p.unit ?? "pcs",
          qty,
          cost,
          price,
          // valued on the weighted average cost, not on the sale price
          value: round(qty * cost),
          basis: built > 0
            ? ("costing" as const)
            : invoiced > 0
              ? ("invoice" as const)
              : ("none" as const),
          bought: 0,
          lastCost: 0,
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
    // movements carry the same cost the shelves do, so a unit that came in
    // and a unit still on hand are valued alike
    const materialRate = new Map(
      materialRows.map((r) => [r.key, r.cost] as const),
    );
    const productRate = new Map(
      productRows.map((r) => [r.key, r.cost] as const),
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

/* ── cash flow ─────────────────────────────────────────────────────── */

export type CashFlowRow = {
  key: string;
  label: string;
  from: number;
  to: number;
  /** Money that reached the cash and bank accounts. */
  inflow: number;
  /** Money that left them. */
  outflow: number;
  net: number;
  /** Balance at the end of this period, carried forward. */
  running: number;
};

/**
 * Cash flow: what actually reached the cash and bank accounts in the window.
 *
 * A debit to a money account is money in and a credit is money out, and the
 * two are kept apart rather than netted — a period that took a lot and paid a
 * lot is not a quiet one, and a single net figure would say it was. Which
 * accounts count as money is the same setting the cash book follows, so
 * renaming or recoding them cannot quietly empty this report.
 *
 * The opening figure is everything posted to those accounts before the window,
 * which is what makes the running balance a real balance rather than a total.
 */
export const cashFlow = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null)
      return {
        from,
        to,
        bucket: "day" as const,
        rows: [] as CashFlowRow[],
        totalIn: 0,
        totalOut: 0,
        net: 0,
        opening: 0,
        closing: 0,
        empty: true,
      };

    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const cashIds = await moneyAccountIds(ctx, userId);
    const cashCodes = new Set(
      accounts.filter((a) => cashIds.has(a._id)).map((a) => a.code),
    );

    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const lines = await ctx.db
      .query("journalLines")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const whenOf = new Map(entries.map((e) => [e._id, e.at] as const));
    const bucket = bucketFor(Math.round((to - from) / 86_400_000));
    const periods = new Map<string, CashFlowRow>();
    let opening = 0;

    for (const line of lines) {
      if (!cashIds.has(line.accountId) && !cashCodes.has(line.accountCode)) continue;
      const when = whenOf.get(line.entryId);
      if (when === undefined) continue;
      const move = line.debit - line.credit;
      if (when < from) {
        opening += move;
        continue;
      }
      if (when > to) continue;
      const p = periodKey(when, bucket);
      const row = periods.get(p.key) ?? {
        key: p.key,
        label: p.label,
        from: p.from,
        to: p.to,
        inflow: 0,
        outflow: 0,
        net: 0,
        running: 0,
      };
      if (move > 0) row.inflow += move;
      if (move < 0) row.outflow -= move;
      row.net += move;
      periods.set(p.key, row);
    }

    const rows = Array.from(periods.values()).sort((a, b) => a.from - b.from);
    let running = round(opening);
    for (const row of rows) {
      row.inflow = round(row.inflow);
      row.outflow = round(row.outflow);
      row.net = round(row.net);
      running = round(running + row.net);
      row.running = running;
    }

    const totalIn = round(rows.reduce((s, r) => s + r.inflow, 0));
    const totalOut = round(rows.reduce((s, r) => s + r.outflow, 0));
    return {
      from,
      to,
      bucket,
      rows,
      totalIn,
      totalOut,
      net: round(totalIn - totalOut),
      opening: round(opening),
      closing: running,
      empty: rows.length === 0,
    };
  },
});

/* ── ageing ────────────────────────────────────────────────────────── */

export type AgeingRow = {
  key: string;
  label: string;
  /** Not yet due. */
  current: number;
  d30: number;
  d60: number;
  d90: number;
  older: number;
  total: number;
  oldestDays: number;
  items: number;
};

export type AgedBalances = {
  side: "receivable" | "payable";
  asAt: number;
  rows: AgeingRow[];
  totals: {
    current: number;
    d30: number;
    d60: number;
    d90: number;
    older: number;
    total: number;
  };
  empty: boolean;
};

/** Where a debt lands: not yet due, then by how many days past due it is. */
function ageBucket(days: number): "current" | "d30" | "d60" | "d90" | "older" {
  if (days <= 0) return "current";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "older";
}

/**
 * Who owes the firm, or who the firm owes, split by how late the money is.
 *
 * This is a state rather than a period — an unpaid invoice from last year is
 * still unpaid today — so it deliberately ignores the period control and ages
 * every open document against today's date. The same shape serves both sides
 * because a receivable and a payable are the same fact read in opposite
 * directions; only the party and the document type differ.
 */
export const agedBalances = query({
  args: { side: v.union(v.literal("receivable"), v.literal("payable")) },
  handler: async (ctx, { side }): Promise<AgedBalances> => {
    const asAt = Date.now();
    const totals = { current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0 };
    const userId = await scopeUserId(ctx);
    if (userId === null) return { side, asAt, rows: [], totals, empty: true };

    const people =
      side === "receivable"
        ? await ctx.db
            .query("customers")
            .withIndex("by_owner", (q) => q.eq("ownerId", userId))
            .collect()
        : await ctx.db
            .query("vendors")
            .withIndex("by_owner", (q) => q.eq("ownerId", userId))
            .collect();
    const names = new Map(people.map((p) => [p._id, p.name] as const));

    const byParty = new Map<string, AgeingRow>();
    const add = (
      party: Id<"customers"> | Id<"vendors"> | undefined,
      whose: string,
      due: number,
      dueAt: number | undefined,
      at: number,
    ) => {
      const label = (party ? names.get(party) : undefined) ?? whose;
      const key = party ?? `name:${label}`;
      const row = byParty.get(key) ?? {
        key,
        label,
        current: 0,
        d30: 0,
        d60: 0,
        d90: 0,
        older: 0,
        total: 0,
        oldestDays: 0,
        items: 0,
      };
      const daysPast = Math.floor((asAt - (dueAt ?? at)) / 86_400_000);
      const bucket = ageBucket(daysPast);
      row[bucket] += due;
      row.total += due;
      row.items += 1;
      row.oldestDays = Math.max(row.oldestDays, daysPast);
      byParty.set(key, row);
    };

    if (side === "receivable") {
      const all = await ctx.db
        .query("sales")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      for (const s of all) {
        const paid = s.amountPaid ?? (s.isPaid === true ? s.total : 0);
        const due = round(s.total - paid);
        if (due <= 0) continue;
        add(s.customerId, partyName(s.customerId, s.customerName), due, s.dueAt, s.soldAt);
      }
    } else {
      const all = await ctx.db
        .query("purchases")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      for (const p of all) {
        const paid = p.amountPaid ?? (p.isPaid === true ? p.total : 0);
        const due = round(p.total - paid);
        if (due <= 0) continue;
        const supplier = p.supplierId ? names.get(p.supplierId) : undefined;
        add(
          p.supplierId,
          supplier ?? p.supplier?.trim() ?? "Supplier",
          due,
          p.dueAt,
          p.purchasedAt,
        );
      }
    }

    const rows = Array.from(byParty.values())
      .map((r) => ({
        ...r,
        current: round(r.current),
        d30: round(r.d30),
        d60: round(r.d60),
        d90: round(r.d90),
        older: round(r.older),
        total: round(r.total),
      }))
      .sort((a, b) => b.total - a.total);

    for (const r of rows) {
      totals.current += r.current;
      totals.d30 += r.d30;
      totals.d60 += r.d60;
      totals.d90 += r.d90;
      totals.older += r.older;
      totals.total += r.total;
    }
    for (const k of ["current", "d30", "d60", "d90", "older", "total"] as const) {
      totals[k] = round(totals[k]);
    }
    return { side, asAt, rows, totals, empty: rows.length === 0 };
  },
});

/**
 * Opening and closing stock valuation for a date window.
 *
 * The trading account needs what stock was worth at the start of the period
 * and what it was worth at the end. Those two figures are not in the journal —
 * stock is counted, not posted — so they have to be recomputed from the same
 * shelves and rates the stock report uses, evaluated at two moments instead of
 * one.
 *
 * Opening stock = what was on the shelves the instant before the period began.
 * Closing stock = what was on the shelves at the end of the period.
 */
export const accountingValuation = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }): Promise<{
    opening: number;
    closing: number;
  }> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return { opening: 0, closing: 0 };

    const round = (n: number) => Math.round(n * 1e2) / 1e2;

    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const products = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const billLines = await ctx.db
      .query("purchaseLines")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
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
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
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
      sheetCost.set(
        item.fgId,
        (sheetCost.get(item.fgId) ?? 0) + item.qty * unit,
      );
    }

    const materialRate = new Map<
      Id<"rawMaterials">,
      number
    >();
    for (const m of materials) {
      materialRate.set(m._id, weighted(m._id, round(m.pricePerUnit)));
    }
    const productRate = new Map<Id<"finishedGoods">, number>();
    for (const p of products) {
      productRate.set(p._id, round(sheetCost.get(p._id) ?? 0));
    }

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

    /** Stock on hand at a moment, valued at current rates. */
    const valueAt = (at: number) => {
      const mm = new Map<Id<"rawMaterials">, number>();
      for (const m of materials) {
        let qty = m.stock ?? 0;
        for (const mv of stockMovements) {
          if (mv.materialId !== m._id) continue;
          if (mv.at >= at) continue;
          qty += mv.direction === "in" ? mv.qty : -mv.qty;
        }
        mm.set(m._id, round((qty ?? 0) * (materialRate.get(m._id) ?? 0)));
      }
      const pp = new Map<Id<"finishedGoods">, number>();
      for (const p of products) {
        let qty = p.stock ?? 0;
        for (const mv of productMovements) {
          if (mv.productId !== p._id) continue;
          if (mv.at >= at) continue;
          qty += mv.direction === "in" ? mv.qty : -mv.qty;
        }
        pp.set(p._id, round((qty ?? 0) * (productRate.get(p._id) ?? 0)));
      }
      let total = 0;
      for (const v of mm.values()) total += v;
      for (const v of pp.values()) total += v;
      return round(total);
    };

    const opening = valueAt(from);
    const closing = valueAt(to + 1);
    return { opening, closing };
  },
});

/* ── tax ───────────────────────────────────────────────────────────── */

export type TaxPeriodRow = {
  key: string;
  label: string;
  from: number;
  to: number;
  output: number;
  input: number;
  net: number;
};

export type TaxSummary = {
  from: number;
  to: number;
  outputTax: number;
  inputTax: number;
  net: number;
  salesCount: number;
  purchaseCount: number;
  rows: TaxPeriodRow[];
  empty: boolean;
};

/**
 * Tax charged on what the firm sold against tax paid on what it bought, by
 * period. The figures come from the documents' own summed `taxAmount` rather
 * than a re-derived blended rate, so this agrees with the printed invoices.
 *
 * The net is shown as a positive when it is owed and as a negative when it is
 * recoverable, because "a credit coming back" and "a bill to pay" are not the
 * same number with a sign flipped.
 */
export const taxSummary = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }): Promise<TaxSummary> => {
    const userId = await scopeUserId(ctx);
    if (userId === null)
      return {
        from,
        to,
        outputTax: 0,
        inputTax: 0,
        net: 0,
        salesCount: 0,
        purchaseCount: 0,
        rows: [],
        empty: true,
      };

    const sales = await ctx.db
      .query("sales")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const purchases = await ctx.db
      .query("purchases")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const inWindow = sales.filter((s) => s.soldAt >= from && s.soldAt <= to);
    const bought = purchases.filter(
      (p) => p.purchasedAt >= from && p.purchasedAt <= to,
    );
    const bucket = bucketFor(Math.round((to - from) / 86_400_000));
    const periods = new Map<string, TaxPeriodRow>();
    const rowFor = (at: number) => {
      const p = periodKey(at, bucket);
      const row = periods.get(p.key) ?? {
        key: p.key,
        label: p.label,
        from: p.from,
        to: p.to,
        output: 0,
        input: 0,
        net: 0,
      };
      periods.set(p.key, row);
      return row;
    };

    let outputTax = 0;
    for (const s of inWindow) {
      const t = s.taxAmount ?? 0;
      outputTax += t;
      rowFor(s.soldAt).output += t;
    }
    let inputTax = 0;
    for (const p of bought) {
      const t = p.taxAmount ?? 0;
      inputTax += t;
      rowFor(p.purchasedAt).input += t;
    }

    const rows = Array.from(periods.values())
      .sort((a, b) => a.from - b.from)
      .map((r) => ({
        ...r,
        output: round(r.output),
        input: round(r.input),
        net: round(r.output - r.input),
      }));

    const out = round(outputTax);
    const inp = round(inputTax);
    return {
      from,
      to,
      outputTax: out,
      inputTax: inp,
      net: round(out - inp),
      salesCount: inWindow.length,
      purchaseCount: bought.length,
      rows,
      empty: rows.length === 0,
    };
  },
});

/* ── sales by project ──────────────────────────────────────────────── */

export type ProjectSalesRow = {
  key: string;
  label: string;
  code: string;
  invoices: number;
  qty: number;
  value: number;
  total: number;
  paid: number;
  outstanding: number;
  share: number;
};

/**
 * Sales gathered under the project their product belongs to.
 *
 * A product carries its project, not the invoice, so this is the only reading
 * that answers "what did this project earn" — grouping invoices would credit a
 * project with everything on a mixed bill. Standalone products are collected
 * under "No project" rather than dropped.
 */
export const salesByProject = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null)
      return { from, to, rows: [] as ProjectSalesRow[], total: 0, empty: true };

    const goods = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const projectOf = new Map(goods.map((g) => [g._id, g] as const));

    const invoices = (
      await ctx.db
        .query("sales")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect()
    ).filter((s) => s.soldAt >= from && s.soldAt <= to);

    const rows = new Map<string, ProjectSalesRow>();
    for (const inv of invoices) {
      const paid = inv.amountPaid ?? (inv.isPaid === true ? inv.total : 0);
      for (const line of inv.lines) {
        const g = projectOf.get(line.productId);
        const name = g?.projectName?.trim() || "No project";
        const key = g?.projectName?.trim() || "—";
        const row = rows.get(key) ?? {
          key,
          label: name,
          code: g?.projectCode ?? "",
          invoices: 0,
          qty: 0,
          value: 0,
          total: 0,
          paid: 0,
          outstanding: 0,
          share: 0,
        };
        const amount = line.qty * line.unitPrice;
        row.invoices += 1;
        row.qty += line.qty;
        row.value += amount;
        row.total += amount;
        row.paid += amount * (inv.total > 0 ? paid / inv.total : 0);
        if (!row.code && g?.projectCode) row.code = g.projectCode;
        rows.set(key, row);
      }
    }

    const list = Array.from(rows.values());
    const total = round(list.reduce((s, r) => s + r.total, 0));
    const out = list
      .map((r) => ({
        ...r,
        qty: round(r.qty),
        value: round(r.value),
        total: round(r.total),
        paid: round(r.paid),
        outstanding: round(r.total - r.paid),
        share: total === 0 ? 0 : round((r.total / total) * 100),
      }))
      .sort((a, b) => b.total - a.total);
    return { from, to, rows: out, total, empty: out.length === 0 };
  },
});

/* ── quotation conversion ──────────────────────────────────────────── */

export type QuoteRow = {
  _id: Id<"quotations">;
  number: string;
  at: number;
  party: string;
  total: number;
  status: string;
  validUntil?: number;
  expired: boolean;
  converted: boolean;
  convertedAs?: Id<"sales">;
  convertedAt?: number;
};

/**
 * What was quoted against what was actually won.
 *
 * A quote counts as converted when the sales bill it became is on the record,
 * which is a fact the quote carries rather than something this report infers
 * from matching names and totals. Expiry is read at the moment of asking, so a
 * quote that lapsed after the period still shows as lapsed today.
 */
export const quotationConversion = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null)
      return {
        from,
        to,
        rows: [] as QuoteRow[],
        quoted: 0,
        won: 0,
        wonValue: 0,
        rate: 0,
        lostValue: 0,
        expired: 0,
        empty: true,
      };

    const all = (
      await ctx.db
        .query("quotations")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect()
    ).filter((q) => q.quotedAt >= from && q.quotedAt <= to);
    const asAt = Date.now();

    const rows: QuoteRow[] = all
      .map((q) => ({
        _id: q._id,
        number: q.number,
        at: q.quotedAt,
        party: partyName(q.customerId, q.customerName),
        total: round(q.total),
        status: q.status ?? "draft",
        validUntil: q.validUntil,
        expired: q.validUntil !== undefined && q.validUntil < asAt,
        converted: q.invoicedAs !== undefined,
        convertedAs: q.invoicedAs,
        convertedAt: q.invoicedAt,
      }))
      .sort((a, b) => b.at - a.at);

    const quoted = round(rows.reduce((s, r) => s + r.total, 0));
    const wonRows = rows.filter((r) => r.converted);
    const wonValue = round(wonRows.reduce((s, r) => s + r.total, 0));
    return {
      from,
      to,
      rows,
      quoted,
      won: wonRows.length,
      wonValue,
      rate: rows.length === 0 ? 0 : round((wonRows.length / rows.length) * 100),
      lostValue: round(quoted - wonValue),
      expired: rows.filter((r) => r.expired && !r.converted).length,
      empty: rows.length === 0,
    };
  },
});

/* ── purchases by category ─────────────────────────────────────────── */

export type CategorySpendRow = {
  key: string;
  label: string;
  sub: string;
  bills: number;
  qty: number;
  value: number;
  tax: number;
  share: number;
};

/**
 * What was bought, gathered by the material's category rather than by the
 * material itself. Spend that is not on any one item still matters — this is
 * the view that shows which part of the business the money went to.
 */
export const purchasesByCategory = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null)
      return { from, to, rows: [] as CategorySpendRow[], total: 0, tax: 0, empty: true };

    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const of = new Map(materials.map((m) => [m._id, m] as const));

    const bills = (
      await ctx.db
        .query("purchases")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect()
    ).filter((p) => p.purchasedAt >= from && p.purchasedAt <= to);

    const rows = new Map<string, CategorySpendRow>();
    for (const bill of bills) {
      for (const line of bill.lines) {
        const m = of.get(line.materialId);
        const category = m?.category?.trim() || "Uncategorised";
        const row = rows.get(category) ?? {
          key: category,
          label: category,
          sub: m?.subCategory?.trim() ?? "",
          bills: 0,
          qty: 0,
          value: 0,
          tax: 0,
          share: 0,
        };
        const amount = line.qty * line.unitCost;
        const rate = line.taxPct ?? bill.taxPct ?? 0;
        row.bills += 1;
        row.qty += line.qty;
        row.value += amount;
        row.tax += amount * (rate / 100);
        if (!row.sub && m?.subCategory) row.sub = m.subCategory;
        rows.set(category, row);
      }
    }

    const list = Array.from(rows.values());
    const total = round(list.reduce((s, r) => s + r.value, 0));
    const out = list
      .map((r) => ({
        ...r,
        qty: round(r.qty),
        value: round(r.value),
        tax: round(r.tax),
        share: total === 0 ? 0 : round((r.value / total) * 100),
      }))
      .sort((a, b) => b.value - a.value);
    return {
      from,
      to,
      rows: out,
      total,
      tax: round(out.reduce((s, r) => s + r.tax, 0)),
      empty: out.length === 0,
    };
  },
});

/* ── low stock ─────────────────────────────────────────────────────── */

export type LowStockRow = {
  key: string;
  name: string;
  code: string;
  kind: "material" | "product";
  unit: string;
  stock: number;
  minStock: number;
  reorderLevel: number;
  /** The level the item is measured against — reorder if set, else min. */
  threshold: number;
  /** How much is needed to get back to the threshold. */
  shortfall: number;
  /** 0–100: how far below the threshold the item has fallen. */
  severity: number;
  rate: number;
  /** What it would cost to buy or make the shortfall back. */
  value: number;
};

/**
 * What is at or below its reorder level, materials and products together.
 *
 * This is a state, not a period — stock on a shelf has a level today whatever
 * the period control says — so it takes no dates and reads the same figures the
 * materials and products lists show. An item with neither level set is left
 * out rather than guessed at, because a report that invents a threshold would
 * nag about things nobody asked to track.
 */
export const lowStock = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null)
      return { rows: [] as LowStockRow[], out: 0, value: 0, empty: true };

    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const goods = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const build = (
      kind: "material" | "product",
      doc: {
        _id: string;
        name: string;
        code?: string;
        unit?: string;
        stock?: number;
        minStock?: number;
        reorderLevel?: number;
      },
      rate: number,
    ): LowStockRow | null => {
      const stock = doc.stock ?? 0;
      const minStock = doc.minStock ?? 0;
      const reorderLevel = doc.reorderLevel ?? 0;
      const threshold = reorderLevel > 0 ? reorderLevel : minStock;
      if (threshold <= 0) return null;
      if (stock > threshold) return null;
      const shortfall = round(threshold - stock);
      return {
        key: doc._id,
        name: doc.name,
        code: doc.code ?? "",
        kind,
        unit: doc.unit ?? "",
        stock: round(stock),
        minStock,
        reorderLevel,
        threshold,
        shortfall,
        severity:
          threshold === 0
            ? 100
            : Math.round(Math.min(100, ((threshold - stock) / threshold) * 100)),
        rate,
        value: round(shortfall * rate),
      };
    };

    const rows: LowStockRow[] = [];
    for (const m of materials) {
      const row = build("material", m, m.pricePerUnit ?? 0);
      if (row) rows.push(row);
    }
    for (const g of goods) {
      const row = build("product", g, 0);
      if (row) rows.push(row);
    }
    rows.sort(
      (a, b) => b.severity - a.severity || a.name.localeCompare(b.name),
    );
    return {
      rows,
      out: rows.filter((r) => r.stock <= 0).length,
      value: round(rows.reduce((s, r) => s + r.value, 0)),
      empty: rows.length === 0,
    };
  },
});
