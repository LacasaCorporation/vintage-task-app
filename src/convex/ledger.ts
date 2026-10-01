import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { postEntry } from "./accounting";
import { resolveDefaults, round2, splitTax } from "./accountingDefaults";

/**
 * Turning documents into journal entries.
 *
 * Each function here answers one question: what does this document mean in the
 * accounts? The rules are the ordinary ones —
 *
 *   bill          debit purchases + tax, credit payable
 *   bill settled  debit payable, credit cash or bank
 *   invoice       debit receivable, credit sales + tax
 *   invoice paid  debit cash or bank, credit receivable
 *
 * A bill always lands in payable and an invoice always in receivable, even if
 * the form was saved as paid: the settlement is then its own entry. That keeps
 * the two events — what was bought, and what was paid — separately auditable
 * instead of collapsing into one line nobody can unwind.
 *
 * There is one entry per settled fact, never one per edit: changing a document
 * reverses its old entry and posts a fresh one, so the ledger always reads as
 * a record of what happened rather than of how many times a form was saved.
 *
 * Plain functions, not registered handlers, so `purchases` and `sales` can
 * both use them without importing each other.
 */

type Ctx = MutationCtx;

/** Remove an entry and its lines — the reversal half of every re-post. */
export async function reverseEntry(
  ctx: Ctx,
  ownerId: Id<"users">,
  entryId: Id<"journalEntries"> | undefined,
): Promise<void> {
  if (entryId === undefined) return;
  const lines = await ctx.db
    .query("journalLines")
    .withIndex("by_entry", (q) => q.eq("entryId", entryId))
    .collect();
  for (const line of lines) {
    if (line.ownerId === ownerId) await ctx.db.delete(line._id);
  }
  const entry = await ctx.db.get(entryId);
  if (entry !== null && entry.ownerId === ownerId) await ctx.db.delete(entry._id);
}

/** Which account a party is settled from — bank when set, else cash. */
async function settlementAccount(
  ctx: Ctx,
  ownerId: Id<"users">,
  preferBank: boolean,
) {
  const d = await resolveDefaults(ctx, ownerId);
  return preferBank ? d.bank : d.cash;
}

/**
 * A supplier bill. Unpaid bills sit in accounts payable; a bill already marked
 * paid went straight out of cash, so it never touches the payable account.
 */
export async function postBill(
  ctx: Ctx,
  ownerId: Id<"users">,
  bill: Doc<"purchases">,
): Promise<Id<"journalEntries">> {
  const d = await resolveDefaults(ctx, ownerId);
  const { net, tax } = splitTax(bill.total, bill.taxPct);
  const lines: {
    accountId: Id<"accounts">;
    debit: number;
    credit: number;
    memo?: string;
  }[] = [{ accountId: d.purchase._id, debit: net, credit: 0 }];
  if (tax > 0) lines.push({ accountId: d.tax._id, debit: tax, credit: 0 });

  // a bill always lands in payable; settling it is a separate event with its
  // own entry, so the purchase and the payment stay readable as two facts
  lines.push({
    accountId: d.payable._id,
    debit: 0,
    credit: round2(net + tax),
    memo: bill.supplier?.trim() || undefined,
  });

  return postEntry(ctx, ownerId, {
    at: bill.purchasedAt,
    kind: "journal",
    memo: `Bill ${bill.number}${bill.supplier ? ` · ${bill.supplier}` : ""}`,
    party: bill.supplier?.trim() || undefined,
    lines,
  });
}

/** Settling a bill: the payable is cleared by money leaving cash or bank. */
export async function postBillPayment(
  ctx: Ctx,
  ownerId: Id<"users">,
  bill: Doc<"purchases">,
  preferBank: boolean,
): Promise<Id<"journalEntries">> {
  const d = await resolveDefaults(ctx, ownerId);
  const from = await settlementAccount(ctx, ownerId, preferBank);
  return postEntry(ctx, ownerId, {
    at: Date.now(),
    kind: "payment",
    memo: `Paid bill ${bill.number}${bill.supplier ? ` · ${bill.supplier}` : ""}`,
    party: bill.supplier?.trim() || undefined,
    lines: [
      { accountId: d.payable._id, debit: round2(bill.total), credit: 0 },
      { accountId: from._id, debit: 0, credit: round2(bill.total) },
    ],
  });
}

/**
 * Money paid to a supplier against a payable: the payable is cleared by money
 * leaving cash or bank. Stands on its own rather than being bolted onto a bill
 * because a payment is its own event — it can clear a bill, part of one, or
 * several, and it has to be readable either way.
 */
export async function postSupplierPayment(
  ctx: Ctx,
  ownerId: Id<"users">,
  args: {
    amount: number;
    at: number;
    vendor?: string;
    memo: string;
    /** Whichever account the money left — defaults to the configured cash. */
    fromAccountId?: Id<"accounts">;
    /** Bank is preferred over cash when nothing was chosen. */
    preferBank?: boolean;
  },
): Promise<Id<"journalEntries">> {
  const d = await resolveDefaults(ctx, ownerId);
  const from =
    args.fromAccountId !== undefined
      ? (await ctx.db.get(args.fromAccountId)) ??
        (await settlementAccount(ctx, ownerId, args.preferBank ?? false))
      : await settlementAccount(ctx, ownerId, args.preferBank ?? false);
  return postEntry(ctx, ownerId, {
    at: args.at,
    kind: "payment",
    memo: args.memo,
    party: args.vendor?.trim() || undefined,
    lines: [
      { accountId: d.payable._id, debit: round2(args.amount), credit: 0 },
      { accountId: from._id, debit: 0, credit: round2(args.amount) },
    ],
  });
}

/**
 * A customer invoice. Unpaid invoices sit in accounts receivable; one marked
 * paid went straight into the till.
 */
export async function postSale(
  ctx: Ctx,
  ownerId: Id<"users">,
  sale: Doc<"sales">,
): Promise<Id<"journalEntries">> {
  const d = await resolveDefaults(ctx, ownerId);
  const { net, tax } = splitTax(sale.total, sale.taxPct);
  const lines: {
    accountId: Id<"accounts">;
    debit: number;
    credit: number;
    memo?: string;
  }[] = [
    {
      accountId: d.receivable._id,
      debit: round2(net + tax),
      credit: 0,
      memo: sale.customerName?.trim() || undefined,
    },
    { accountId: d.sales._id, debit: 0, credit: net },
  ];
  if (tax > 0) lines.push({ accountId: d.tax._id, debit: 0, credit: tax });

  return postEntry(ctx, ownerId, {
    at: sale.soldAt,
    kind: "journal",
    memo: `Invoice ${sale.number}${sale.customerName ? ` · ${sale.customerName}` : ""}`,
    party: sale.customerName?.trim() || undefined,
    lines,
  });
}

/** A customer settling an invoice: money in, receivable cleared. */
export async function postSaleReceipt(
  ctx: Ctx,
  ownerId: Id<"users">,
  sale: Doc<"sales">,
  preferBank: boolean,
): Promise<Id<"journalEntries">> {
  const d = await resolveDefaults(ctx, ownerId);
  const into = await settlementAccount(ctx, ownerId, preferBank);
  return postEntry(ctx, ownerId, {
    at: Date.now(),
    kind: "receipt",
    memo: `Receipt for invoice ${sale.number}${
      sale.customerName ? ` · ${sale.customerName}` : ""
    }`,
    party: sale.customerName?.trim() || undefined,
    lines: [
      { accountId: into._id, debit: round2(sale.total), credit: 0 },
      { accountId: d.receivable._id, debit: 0, credit: round2(sale.total) },
    ],
  });
}
