import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireItem } from "./authorize";
import { scopeUserId } from "./org";
import { postCustomerReceipt, reverseEntry } from "./ledger";
import { resolveDefaults } from "./accountingDefaults";

/**
 * Receipts: money received from customers.
 *
 * Supports partial payments — each receipt accumulates into `amountPaid` on
 * the invoice. The invoice is only marked `isPaid: true` when the running total
 * reaches (or exceeds) the invoice total. Deleting a receipt reverses the
 * contribution and the ledger entry.
 */

const MAX_NAME_LENGTH = 120;
const round = (n: number) => Math.round(n * 100) / 100;

/** Next receipt number: RCP0001, RCP0002, … */
async function nextNumber(ctx: MutationCtx, ownerId: Id<"users">): Promise<string> {
  const rows = await ctx.db
    .query("receipts")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  let max = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.number.slice(3), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `RCP${String(max + 1).padStart(4, "0")}`;
}

/** Every receipt, newest first, with the account it landed in named. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("receipts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const accountName = new Map(accounts.map((a) => [a._id, a.name]));
    const entries = await ctx.db
      .query("journalEntries")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const entryNumber = new Map(entries.map((e) => [e._id, e.number]));
    const settled = rows.filter((r) => r.invoiceId !== undefined);
    const saleNumbers = new Map<Id<"sales">, string>();
    for (const r of settled) {
      const sale = await ctx.db.get(r.invoiceId as Id<"sales">);
      if (sale !== null && sale.ownerId === userId) saleNumbers.set(sale._id, sale.number);
    }
    return rows
      .sort((a, b) => b.at - a.at || b._creationTime - a._creationTime)
      .map((r) => ({
        ...r,
        receivedIntoName:
          r.receivedInto !== undefined ? accountName.get(r.receivedInto) : undefined,
        invoiceNumber:
          r.invoiceId !== undefined ? saleNumbers.get(r.invoiceId) : undefined,
        entryNumber:
          r.entryId !== undefined ? entryNumber.get(r.entryId) : undefined,
      }));
  },
});

/**
 * What the receipt form needs: the accounts money can land in, and the invoices
 * still open, with their outstanding balance so a partial receipt can be entered.
 */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return { accounts: [], invoices: [] };
    let accounts: { id: Id<"accounts">; name: string; code: string }[] = [];
    try {
      const d = await resolveDefaults(ctx, userId);
      accounts = [d.cash, d.bank].map((a) => ({ id: a._id, name: a.name, code: a.code }));
    } catch {
      // a workspace whose chart of accounts was never seeded still gets the form
      accounts = [];
    }
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return {
      accounts,
      invoices: sales
        .filter((s) => s.isPaid !== true)
        .map((s) => {
          const paid = round(s.amountPaid ?? 0);
          const balance = round(s.total - paid);
          return {
            id: s._id,
            number: s.number,
            customer: s.customerName ?? undefined,
            total: s.total,
            amountPaid: paid,
            balance,
            soldAt: s.soldAt,
          };
        }),
    };
  },
});

/** Record a receipt and post it to the ledger in the same call. */
export const create = mutation({
  args: {
    customerId: v.optional(v.id("customers")),
    customerName: v.optional(v.string()),
    at: v.optional(v.number()),
    amount: v.number(),
    receivedInto: v.optional(v.id("accounts")),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    invoiceId: v.optional(v.id("sales")),
  },
  handler: async (ctx, args): Promise<Id<"receipts">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "create");
    const amount = round(args.amount);
    if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");

    let customerId = args.customerId;
    let customerName = args.customerName?.trim().slice(0, MAX_NAME_LENGTH) || undefined;
    const sale = args.invoiceId !== undefined ? await ctx.db.get(args.invoiceId) : null;
    if (args.invoiceId !== undefined) {
      if (sale === null || sale.ownerId !== userId)
        throw new Error("That invoice no longer exists.");
      // the invoice decides who was paid, so the form cannot misdirect it
      customerId = sale.customerId ?? customerId;
      customerName = sale.customerName ?? customerName;
      if (sale.isPaid === true) throw new Error(`${sale.number} is already fully paid.`);
      // Guard against over-payment
      const currentPaid = round(sale.amountPaid ?? 0);
      const balance = round(sale.total - currentPaid);
      if (amount > balance + 0.001) {
        throw new Error(
          `Receipt of ${amount} exceeds the outstanding balance of ${balance}. ` +
            `Record a receipt of ${balance} or less.`,
        );
      }
    }
    if (!customerName) throw new Error("Say who paid — pick an invoice or a customer.");

    const at = args.at ?? Date.now();
    const number = await nextNumber(ctx, userId);
    const entryId = await postCustomerReceipt(ctx, userId, {
      amount,
      at,
      customer: customerName,
      memo:
        sale !== null && sale !== undefined
          ? `Receipt for invoice ${sale.number}`
          : `Receipt${customerName ? ` from ${customerName}` : ""}`,
      intoAccountId: args.receivedInto,
      preferBank: true,
    });
    const id = await ctx.db.insert("receipts", {
      ownerId: userId,
      number,
      customerId,
      customerName,
      at,
      amount,
      receivedInto: args.receivedInto,
      reference: args.reference?.trim().slice(0, 60) || undefined,
      note: args.note?.trim().slice(0, 500) || undefined,
      invoiceId: args.invoiceId,
      entryId,
    });

    // Update the invoice's running received total
    if (sale !== null && sale !== undefined) {
      const newAmountPaid = round((sale.amountPaid ?? 0) + amount);
      const fullyPaid = newAmountPaid >= sale.total - 0.001;
      await ctx.db.patch(sale._id, {
        amountPaid: newAmountPaid,
        ...(fullyPaid
          ? { isPaid: true, paidAt: at, paymentEntryId: entryId }
          : { isPaid: undefined, paidAt: undefined, paymentEntryId: undefined }),
      });
    }
    return id;
  },
});

/** Delete a receipt and reverse the entry it posted. */
export const remove = mutation({
  args: { id: v.id("receipts") },
  handler: async (ctx, args) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "delete");
    const receipt = await ctx.db.get(args.id);
    if (receipt === null || receipt.ownerId !== userId) throw new Error("Not your receipt.");
    await reverseEntry(ctx, userId, receipt.entryId);
    if (receipt.invoiceId !== undefined) {
      const sale = await ctx.db.get(receipt.invoiceId);
      if (sale !== null && sale.ownerId === userId) {
        const newAmountPaid = round(Math.max(0, (sale.amountPaid ?? 0) - receipt.amount));
        await ctx.db.patch(receipt.invoiceId, {
          amountPaid: newAmountPaid > 0 ? newAmountPaid : undefined,
          isPaid: newAmountPaid >= sale.total - 0.001 ? true : undefined,
          paidAt: newAmountPaid >= sale.total - 0.001 ? sale.paidAt : undefined,
          paymentEntryId:
            newAmountPaid >= sale.total - 0.001 ? sale.paymentEntryId : undefined,
        });
      }
    }
    await ctx.db.delete(args.id);
  },
});
