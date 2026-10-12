import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * The wiring between a document and the ledger.
 *
 * Everything automatic — a bill, an invoice, a receipt, a payment, an expense
 * — resolves the account it should hit through here rather than hard-coding a
 * code like "1100". A firm that recodes its chart, or renames "Cash in hand"
 * to "Petty cash", keeps posting correctly; and when something genuinely
 * cannot be resolved we say which account is missing instead of posting to the
 * wrong one.
 *
 * This is a plain module, not registered handlers, so every feature module can
 * import it without importing each other.
 */

type Ctx = MutationCtx | QueryCtx;

/** What each posting needs, named for the job rather than the account code. */
export type AccountingDefaults = {
  cash: Doc<"accounts">;
  bank: Doc<"accounts">;
  receivable: Doc<"accounts">;
  payable: Doc<"accounts">;
  sales: Doc<"accounts">;
  /** Where purchased stock and materials land. */
  purchase: Doc<"accounts">;
  /**
   * Raw materials and finished goods sitting in inventory. Where a goods
   * received voucher lands its goods.
   */
  inventory: Doc<"accounts">;
  /**
   * Goods received but not yet billed. A voucher credits it and the bill that
   * follows clears it, so the material is in stock from the moment it arrives
   * rather than waiting for the paperwork.
   */
  grir: Doc<"accounts">;
  /** GST / VAT / sales tax collected and paid. */
  tax: Doc<"accounts">;
  /** Rate offered on new documents, 0 when unset. */
  taxPct: number;
};

/** The standard code for each job, used when settings leave it unset. */
const FALLBACK_CODE = {
  cash: ["1100"],
  bank: ["1110", "1120"],
  receivable: ["1200"],
  payable: ["2100"],
  sales: ["4100"],
  purchase: ["5200", "5100"],
  inventory: ["1300", "1400"],
  grir: ["2400"],
  tax: ["2300"],
} as const;

/**
 * Goods received but not yet billed — the account that lets a receipt put
 * stock on the books before the paperwork arrives.
 */
export const GRIR_CODE = "2400";

/**
 * The two pairs of stock accounts.
 *
 * Each figure is posted twice: once as stock on hand (an asset) and once in
 * the trading account (opening stock as a cost, closing stock as a deduction),
 * so opening and closing stock are four accounts rather than two. The codes
 * live here so the seeder, the posting that fills them and the statements that
 * read them can never resolve a different account.
 */
export const STOCK_CODE = {
  /** Stock brought forward, held as an asset. */
  openingAsset: "1310",
  /** Stock on hand at the period end, held as an asset. */
  closingAsset: "1320",
  /** Opening stock carried into the trading account — a cost. */
  openingTrading: "5150",
  /** Closing stock credited to the trading account — a deduction from cost. */
  closingTrading: "5155",
} as const;

/** The two sides of an expense: what makes the product, and what runs the shop. */
export type ExpenseKind = "direct" | "indirect";

/**
 * The expenses a firm meets most often, each on the side the register enters
 * it.
 *
 * A direct expense goes into what a product costs to make, so it lands in the
 * cost of goods sold the trading account strikes; an indirect one is spent
 * running the business and is charged below the gross profit. Both are
 * ordinary expense accounts under the same heading — the split is a reading of
 * the chart, not a second set of books — and every account says which side it
 * belongs to, so the register can offer the right half of the list.
 *
 * The seeder gives a new firm all of them, and `ensureDefaults` adds to an
 * existing chart whichever of them it is missing, so a firm that started
 * before the split still gets the common ones without its chart being rebuilt.
 */
export const COMMON_EXPENSE_ACCOUNTS: {
  code: string;
  name: string;
  /** Every one of these is an expense account. */
  type: "expense";
  /** The heading they sit under — code 5000, Expenses. */
  parent: string;
  expenseKind: ExpenseKind;
}[] = [
  // ── direct: what the product costs to make ───────────────────────────
  { code: "5100", name: "Cost of goods sold", type: "expense", parent: "5000", expenseKind: "direct" },
  { code: "5200", name: "Raw material purchased", type: "expense", parent: "5000", expenseKind: "direct" },
  { code: "5210", name: "Production wages", type: "expense", parent: "5000", expenseKind: "direct" },
  { code: "5220", name: "Direct expenses", type: "expense", parent: "5000", expenseKind: "direct" },
  { code: "5230", name: "Production fuel & power", type: "expense", parent: "5000", expenseKind: "direct" },
  { code: "5240", name: "Freight & carriage inward", type: "expense", parent: "5000", expenseKind: "direct" },
  { code: "5250", name: "Subcontract work", type: "expense", parent: "5000", expenseKind: "direct" },
  { code: "5260", name: "Packing materials", type: "expense", parent: "5000", expenseKind: "direct" },
  { code: "5270", name: "Factory rent", type: "expense", parent: "5000", expenseKind: "direct" },
  { code: "5280", name: "Plant repairs & maintenance", type: "expense", parent: "5000", expenseKind: "direct" },

  // ── indirect: what it costs to run the business ──────────────────────
  { code: "5300", name: "Rent", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5310", name: "Insurance", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5320", name: "Office supplies & stationery", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5330", name: "Telephone & internet", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5340", name: "Marketing & advertising", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5350", name: "Professional fees", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5360", name: "Bank charges", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5370", name: "Repairs & maintenance", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5380", name: "Travel & motor vehicle", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5390", name: "Depreciation", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5400", name: "Salaries & wages", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5410", name: "Employee benefits", type: "expense", parent: "5000", expenseKind: "indirect" },
  { code: "5500", name: "Utilities", type: "expense", parent: "5000", expenseKind: "indirect" },
];

/** The standard account carrying this code, if it is a common expense. */
export function standardExpenseKind(code: string): ExpenseKind | undefined {
  return COMMON_EXPENSE_ACCOUNTS.find((a) => a.code === code)?.expenseKind;
}

/**
 * Which side of the split an account belongs to.
 *
 * What the account says, when it says anything; otherwise the code it carries,
 * so a chart seeded before the side was recorded reads the same way. Anything
 * unrecognised is spent running the business, which is where an expense of
 * unclear purpose does the least damage to the cost of goods sold.
 */
export function expenseClassOf(account: {
  code: string;
  expenseKind?: ExpenseKind;
}): ExpenseKind {
  if (account.expenseKind === "direct" || account.expenseKind === "indirect") {
    return account.expenseKind;
  }
  if (
    account.code === STOCK_CODE.openingTrading ||
    account.code === STOCK_CODE.closingTrading
  ) {
    return "direct";
  }
  return standardExpenseKind(account.code) ?? "indirect";
}

/** The accounts a posting treats as money in or out of the till / bank. */
export async function moneyAccountIds(ctx: Ctx, ownerId: Id<"users">) {
  const { cash, bank } = await resolveDefaults(ctx, ownerId);
  return new Set<string>([cash._id, bank._id]);
}

async function accountsOf(ctx: Ctx, ownerId: Id<"users">) {
  return ctx.db
    .query("accounts")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
}

/** A real, postable account — headings hold no balance and cannot be posted. */
function postable(accounts: Doc<"accounts">[], ids: readonly string[]) {
  return accounts.find((a) => ids.includes(a._id) && a.isGroup !== true);
}

function byCode(accounts: Doc<"accounts">[], codes: readonly string[]) {
  for (const code of codes) {
    const hit = accounts.find((a) => a.code === code && a.isGroup !== true);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * Resolve the account for one job: the chosen account if it still exists and
 * is postable, otherwise the standard code, otherwise a clear error naming
 * what is missing.
 */
function pick(
  accounts: Doc<"accounts">[],
  chosen: Id<"accounts"> | undefined,
  codes: readonly string[],
  what: string,
): Doc<"accounts"> {
  if (chosen !== undefined) {
    const hit = postable(accounts, [chosen]);
    if (hit !== undefined) return hit;
  }
  const fallback = byCode(accounts, codes);
  if (fallback !== undefined) return fallback;
  throw new Error(
    `${what} is not set up. Choose it in Settings → Accounting, or add an account to the chart.`,
  );
}

/**
 * The accounts every posting reads. Resolved in one pass so a document posts
 * all its lines against a single, consistent view of the chart.
 */
export async function resolveDefaults(
  ctx: Ctx,
  ownerId: Id<"users">,
): Promise<AccountingDefaults> {
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .first();
  const configured = settings?.accounting;
  const accounts = await accountsOf(ctx, ownerId);

  return {
    cash: pick(accounts, configured?.cashAccountId, FALLBACK_CODE.cash, "A cash account"),
    bank: pick(accounts, configured?.bankAccountId, FALLBACK_CODE.bank, "A bank account"),
    receivable: pick(
      accounts,
      configured?.receivableAccountId,
      FALLBACK_CODE.receivable,
      "The accounts receivable account",
    ),
    payable: pick(
      accounts,
      configured?.payableAccountId,
      FALLBACK_CODE.payable,
      "The accounts payable account",
    ),
    sales: pick(accounts, configured?.salesAccountId, FALLBACK_CODE.sales, "A sales account"),
    purchase: pick(
      accounts,
      configured?.purchaseAccountId,
      FALLBACK_CODE.purchase,
      "A purchases account",
    ),
    inventory: pick(
      accounts,
      configured?.inventoryAccountId,
      FALLBACK_CODE.inventory,
      "An inventory account",
    ),
    grir: pick(
      accounts,
      configured?.grirAccountId,
      FALLBACK_CODE.grir,
      "A goods-received-not-billed account",
    ),
    tax: pick(accounts, configured?.taxAccountId, FALLBACK_CODE.tax, "The tax account"),
    taxPct: Math.max(0, configured?.taxPct ?? 0),
  };
}

/** The default tax rate on its own — what the bill and invoice forms prefill. */
export async function defaultTaxPct(ctx: Ctx, ownerId: Id<"users">): Promise<number> {
  const settings = await ctx.db
    .query("settings")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .first();
  return Math.max(0, settings?.accounting?.taxPct ?? 0);
}

/** What each posting uses to say where a figure came from on the entry. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Split a total into its net and tax parts. The stored `taxPct` on a document
 * is authoritative: the tax is whatever it says, rounded to cents, and the net
 * is the remainder — so net + tax always equals the total exactly, with no
 * rounding drift between the document and its entry.
 */
export function splitTax(
  total: number,
  taxPct: number | undefined,
): { net: number; tax: number } {
  const pct = Math.max(0, taxPct ?? 0);
  if (pct <= 0) return { net: round2(total), tax: 0 };
  const gross = round2(total);
  const net = round2(gross / (1 + pct / 100));
  return { net, tax: round2(gross - net) };
}

/**
 * The tax a document actually carries, for posting.
 *
 * A document whose lines each had their own rate has already calculated its
 * tax — `taxAmount` is that figure, and it is what posts. Anything without it
 * is an older document with a single rate, and the tax is derived from that.
 */
export function settledTax(
  total: number,
  taxPct: number | undefined,
  taxAmount: number | undefined,
): { net: number; tax: number } {
  if (taxAmount !== undefined && taxAmount > 0) {
    return { net: round2(total - taxAmount), tax: round2(taxAmount) };
  }
  return splitTax(total, taxPct);
}
