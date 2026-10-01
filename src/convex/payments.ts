import { mutation, query } from "./_generated/server";
import { requireItem } from "./authorize";
import { scopeUserId } from "./org";
import { postSupplierPayment, reverseEntry } from "./ledger";
import { resolveDefaults } from "./accountingDefaults";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const round = (n: number) => Math.round(n * 100) / 100;
const MAX_NAME_LENGTH = 120;

/** Next sequential payment number: PAY0001, PAY0002, … */
async function nextPaymentNumber(
  ctx: MutationCtx,
  ownerId: Id<"users">,
): Promise<string> {
  const rows = await ctx.db
    .query("payments")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  let max = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.number.slice(3), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `PAY${String(max + 1).padStart(4, "0")}`;
}

/**
 * Every payment made to a supplier, newest first, with the account it left and
 * the bill it settled resolved for display.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("payments")
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
    return rows
      .sort((a, b) => b.at - a.at || b._creationTime - a._creationTime)
      .map((p) => ({
        ...p,
        paidFromName:
          p.paidFrom !== undefined ? accountName.get(p.paidFrom) : undefined,
        entryNumber:
          p.entryId !== undefined ? entryNumber.get(p.entryId) : undefined,
      }));
  },
});

/**
 * What the payment form needs to offer: the accounts money can leave, and the
 * bills that are still open, so a payment can settle one at a time.
 */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return { accounts: [], bills: [] };
    let accounts: { id: Id<"accounts">; name: string; code: string }[] = [];
    try {
      const d = await resolveDefaults(ctx, userId);
      accounts = [d.cash, d.bank].map((a) => ({
        id: a._id,
        name: a.name,
        code: a.code,
      }));
    } catch {
      // no chart yet — the form simply offers nothing to pay from
      accounts = [];
    }
    const bills = await ctx.db
      .query("purchases")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return {
      accounts,
      bills: bills
        .filter((b) => b.isPaid !== true)
        .sort((a, b) => b.purchasedAt - a.purchasedAt)
        .map((b) => ({
          id: b._id,
          number: b.number,
          supplier: b.supplier,
          total: b.total,
        })),
    };
  },
});

/**
 * Record money paid to a supplier.
 *
 * The out-flow is written to the ledger in the same call — debit payable,
 * credit the account it left — so the register and the accounts can never
 * drift. When the payment is settling a bill, that bill is marked paid with
 * this same entry, so one outflow is one entry rather than two.
 */
export const create = mutation({
  args: {
    vendorId: v.optional(v.id("vendors")),
    vendor: v.optional(v.string()),
    amount: v.number(),
    at: v.optional(v.number()),
    paidFrom: v.optional(v.id("accounts")),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    billId: v.optional(v.id("purchases")),
  },
  handler: async (ctx, args): Promise<Id<"payments">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "purchases", "create");

    const amount = round(args.amount);
    if (!(amount > 0)) throw new Error("Enter an amount greater than zero.");

    const at = args.at ?? Date.now();
    let vendor = (args.vendor ?? "").trim().slice(0, MAX_NAME_LENGTH);
    let billNumber: string | undefined;

    if (args.billId !== undefined) {
      const bill = await ctx.db.get(args.billId);
      if (bill === null || bill.ownerId !== userId) {
        throw new Error("That bill no longer exists.");
      }
      if (bill.isPaid === true) {
        throw new Error(`${bill.number} is already paid.`);
      }
      billNumber = bill.number;
      if (vendor === "") vendor = (bill.supplier ?? "").trim();
    }

    if (vendor === "" && args.vendorId === undefined) {
      throw new Error("Choose the supplier this money went to.");
    }
    if (args.vendorId !== undefined) {
      const vendorDoc = await ctx.db.get(args.vendorId);
      if (vendorDoc === null || vendorDoc.ownerId !== userId) {
        throw new Error("That supplier no longer exists.");
      }
      if (vendor === "") vendor = vendorDoc.name;
    }

    let paidFrom = args.paidFrom;
    if (paidFrom !== undefined) {
      const account = await ctx.db.get(paidFrom);
      if (account === null || account.ownerId !== userId) {
        throw new Error("That account no longer exists.");
      }
    } else {
      paidFrom = (await resolveDefaults(ctx, userId)).cash._id;
    }

    const paymentId = await ctx.db.insert("payments", {
      ownerId: userId,
      number: await nextPaymentNumber(ctx, userId),
      vendorId: args.vendorId,
      vendor: vendor || undefined,
      at,
      amount,
      paidFrom,
      reference: args.reference?.trim().slice(0, 60) || undefined,
      note: args.note?.trim().slice(0, 500) || undefined,
      billId: args.billId,
    });

    const entryId = await postSupplierPayment(ctx, userId, {
      amount,
      at,
      vendor,
      memo: billNumber !== undefined ? `Paid bill ${billNumber}` : "Supplier payment",
      fromAccountId: paidFrom,
    });
    await ctx.db.patch(paymentId, { entryId });

    // settling a bill with this payment: one outflow, one entry
    if (args.billId !== undefined) {
      await ctx.db.patch(args.billId, { isPaid: true, paymentEntryId: entryId });
    }
    return paymentId;
  },
});

/** Remove a payment, its ledger entry, and the paid mark it put on a bill. */
export const remove = mutation({
  args: { id: v.id("payments") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "purchases", "delete");
    const payment = await ctx.db.get(id);
    if (payment === null || payment.ownerId !== userId) return;
    if (payment.billId !== undefined) {
      const bill = await ctx.db.get(payment.billId);
      if (
        bill !== null &&
        bill.ownerId === userId &&
        bill.paymentEntryId === payment.entryId
      ) {
        await ctx.db.patch(payment.billId, {
          isPaid: undefined,
          paymentEntryId: undefined,
        });
      }
    }
    await reverseEntry(ctx, userId, payment.entryId);
    await ctx.db.delete(id);
  },
});
