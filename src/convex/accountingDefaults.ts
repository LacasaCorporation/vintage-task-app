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
  tax: ["2300"],
} as const;

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
