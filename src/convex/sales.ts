import { mutation, query } from "./_generated/server";
import { requireItem } from "./authorize";
import { scopeUserId } from "./org";
import { postSale, postSaleReceipt, reverseEntry } from "./ledger";
import { defaultTaxPct } from "./accountingDefaults";
import { getSettings } from "./settings";
import { currencySymbol } from "../lib/currency";
import { returnStock as unsellStock, sellStock as logSale } from "./productStock";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

/**
 * Invoicing a product is what takes it out of stock. Called for every posted
 * bill so a sale and a converted quotation move the same ledger. Going short
 * is allowed — the stock simply goes negative, which is what makes the
 * shortfall visible instead of silently refusing the sale.
 */
async function sellStock(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  lines: readonly { productId: Id<"finishedGoods">; qty: number }[],
  ref: string,
): Promise<void> {
  for (const line of lines) {
    if (!(line.qty > 0)) continue;
    const product = await ctx.db.get(line.productId);
    if (product === null || product.ownerId !== ownerId) continue;
    await logSale(ctx, { ownerId, product, qty: line.qty, ref });
  }
}

/** Next sequential number in a series: QT0001, SAL0002, … */
async function nextNumber(
  ctx: MutationCtx,
  table: "quotations" | "sales",
  ownerId: Id<"users">,
  prefix: string,
): Promise<string> {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  let max = 0;
  for (const row of rows) {
    const n = Number.parseInt((row as { number: string }).number.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

const lineValidator = v.array(
  v.object({
    productId: v.id("finishedGoods"),
    qty: v.number(),
    unitPrice: v.number(),
  }),
);

/**
 * Price a document the same way a purchase bill is priced: line totals, less a
 * percentage discount, plus tax on what is left.
 */
function priceLines(
  lines: { qty: number; unitPrice: number }[],
  discountPct: number | undefined,
  taxPct: number | undefined,
): { total: number; grand: number } {
  let total = 0;
  for (const line of lines) total += line.qty * line.unitPrice;
  const discount = Math.min(100, Math.max(0, discountPct ?? 0));
  const tax = Math.max(0, taxPct ?? 0);
  const grand =
    total - (total * discount) / 100 + ((total * (100 - discount)) / 100) * (tax / 100);
  return { total, grand: Math.round(grand * 100) / 100 };
}

/** Every quotation, newest first. */
/** The workspace default tax rate, for the invoice form to prefill. */
export const postingDefaults = query({
  args: {},
  handler: async (ctx): Promise<{ taxPct: number }> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return { taxPct: 0 };
    return { taxPct: await defaultTaxPct(ctx, userId) };
  },
});

export const listQuotations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("quotations")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return rows.sort((a, b) => b.quotedAt - a.quotedAt || b._creationTime - a._creationTime);
  },
});

/** Every sales bill, newest first. */
export const listSales = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("sales")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return rows.sort((a, b) => b.soldAt - a.soldAt || b._creationTime - a._creationTime);
  },
});

/** Raise a quotation. Nothing is reserved or charged — it is an offer. */
export const createQuotation = mutation({
  args: {
    customerId: v.optional(v.id("customers")),
    customerName: v.optional(v.string()),
    customerAddress: v.optional(v.string()),
    quotedAt: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    note: v.optional(v.string()),
    currency: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    taxPct: v.optional(v.number()),
    lines: lineValidator,
  },
  handler: async (ctx, args) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "create");
    if (args.lines.length === 0) throw new Error("Add at least one product to the quote.");

    const resolved = [];
    for (const line of args.lines) {
      const product = await ctx.db.get(line.productId);
      if (product === null) throw new Error("A product on this quote no longer exists.");
      if (product.ownerId !== userId)
        throw new Error("That product belongs to another workspace.");
      if (line.qty <= 0)
        throw new Error(`Quantity for “${product.name}” must be more than zero.`);
      if (line.unitPrice < 0) throw new Error("Unit price can't be negative.");
      resolved.push({
        productId: product._id,
        name: product.name,
        unit: product.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
      });
    }
    const { grand } = priceLines(resolved, args.discountPct, args.taxPct);
    return await ctx.db.insert("quotations", {
      ownerId: userId,
      number: await nextNumber(ctx, "quotations", userId, "QT"),
      customerId: args.customerId,
      customerName: args.customerName?.trim() || undefined,
      customerAddress: args.customerAddress?.trim() || undefined,
      quotedAt: args.quotedAt ?? Date.now(),
      validUntil: args.validUntil,
      note: args.note?.trim().slice(0, 500) || undefined,
      currency:
        args.currency?.trim().slice(0, 8) ||
        currencySymbol((await getSettings(ctx, userId))?.currency),
      discountPct: Math.min(100, Math.max(0, args.discountPct ?? 0)) || undefined,
      taxPct: Math.max(0, args.taxPct ?? 0) || undefined,
      lines: resolved,
      total: grand,
      status: "draft",
    });
  },
});

/** Edit a quotation, or move it between draft / sent / accepted / rejected. */
export const updateQuotation = mutation({
  args: {
    id: v.id("quotations"),
    customerId: v.optional(v.id("customers")),
    customerName: v.optional(v.string()),
    customerAddress: v.optional(v.string()),
    quotedAt: v.optional(v.number()),
    validUntil: v.optional(v.number()),
    note: v.optional(v.string()),
    currency: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    taxPct: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("sent"),
        v.literal("accepted"),
        v.literal("rejected"),
      ),
    ),
    lines: v.optional(lineValidator),
  },
  handler: async (ctx, args) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "edit");
    const quote = await ctx.db.get(args.id);
    if (quote === null) throw new Error("That quotation no longer exists.");
    if (quote.ownerId !== userId) throw new Error("Not your quotation.");
    if (quote.invoicedAs !== undefined)
      throw new Error("This quotation is already on a sales bill — edit that bill instead.");

    const { id, lines, ...rest } = args;
    const patch: Record<string, unknown> = { ...rest };
    if (rest.quotedAt === undefined) delete patch.quotedAt;

    if (lines !== undefined) {
      if (lines.length === 0) throw new Error("Add at least one product to the quote.");
      const resolved = [];
      for (const line of lines) {
        const product = await ctx.db.get(line.productId);
        if (product === null) throw new Error("A product on this quote no longer exists.");
        if (product.ownerId !== userId)
          throw new Error("That product belongs to another workspace.");
        if (line.qty <= 0)
          throw new Error(`Quantity for “${product.name}” must be more than zero.`);
        if (line.unitPrice < 0) throw new Error("Unit price can't be negative.");
        resolved.push({
          productId: product._id,
          name: product.name,
          unit: product.unit,
          qty: line.qty,
          unitPrice: line.unitPrice,
        });
      }
      const { grand } = priceLines(
        resolved,
        patch.discountPct as number | undefined,
        patch.taxPct as number | undefined,
      );
      patch.lines = resolved;
      patch.total = grand;
    }
    await ctx.db.patch(id, patch);
    return id;
  },
});

/** Turn a quotation into a sales bill, carrying its lines across. */
export const convertToSale = mutation({
  args: { id: v.id("quotations"), soldAt: v.optional(v.number()) },
  handler: async (ctx, { id, soldAt }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const quote = await ctx.db.get(id);
    if (quote === null) throw new Error("That quotation no longer exists.");
    if (quote.ownerId !== userId) throw new Error("Not your quotation.");
    if (quote.invoicedAs !== undefined)
      throw new Error("This quotation has already been turned into a sales bill.");

    const { total } = priceLines(quote.lines, quote.discountPct, quote.taxPct);
    const saleId = await ctx.db.insert("sales", {
      ownerId: userId,
      number: await nextNumber(ctx, "sales", userId, "SAL"),
      customerId: quote.customerId,
      customerName: quote.customerName,
      customerAddress: quote.customerAddress,
      soldAt: soldAt ?? Date.now(),
      note: quote.note,
      currency: quote.currency,
      discountPct: quote.discountPct,
      taxPct: quote.taxPct,
      lines: quote.lines,
      total,
      quotationId: quote._id,
    });
    await sellStock(ctx, userId, quote.lines, String(saleId));
    const createdSale = await ctx.db.get(saleId);
    if (createdSale !== null) {
      const entryId = await postSale(ctx, userId, createdSale);
      await ctx.db.patch(saleId, { entryId });
    }
    await ctx.db.patch(quote._id, {
      status: "accepted",
      invoicedAs: saleId,
      invoicedAt: Date.now(),    });
    return saleId;
  },
});

/** Delete a quotation. A quotation that became a bill is kept. */
export const removeQuotation = mutation({
  args: { id: v.id("quotations") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "delete");
    const quote = await ctx.db.get(id);
    if (quote === null) return;
    if (quote.ownerId !== userId) throw new Error("Not your quotation.");
    if (quote.invoicedAs !== undefined)
      throw new Error("This quotation is on a sales bill — delete the bill first.");
    await ctx.db.delete(id);
  },
});

/** Raise a sales bill directly. */
export const createSale = mutation({
  args: {
    customerId: v.optional(v.id("customers")),
    customerName: v.optional(v.string()),
    customerAddress: v.optional(v.string()),
    soldAt: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    note: v.optional(v.string()),
    currency: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    taxPct: v.optional(v.number()),
    lines: lineValidator,
  },
  handler: async (ctx, args) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "create");
    if (args.lines.length === 0) throw new Error("Add at least one product to the bill.");

    const resolved = [];
    for (const line of args.lines) {
      const product = await ctx.db.get(line.productId);
      if (product === null) throw new Error("A product on this bill no longer exists.");
      if (product.ownerId !== userId)
        throw new Error("That product belongs to another workspace.");
      if (line.qty <= 0)
        throw new Error(`Quantity for “${product.name}” must be more than zero.`);
      if (line.unitPrice < 0) throw new Error("Unit price can't be negative.");
      resolved.push({
        productId: product._id,
        name: product.name,
        unit: product.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
      });
    }
    const { grand } = priceLines(resolved, args.discountPct, args.taxPct);
    const saleId = await ctx.db.insert("sales", {
      ownerId: userId,
      number: await nextNumber(ctx, "sales", userId, "SAL"),
      customerId: args.customerId,
      customerName: args.customerName?.trim() || undefined,
      customerAddress: args.customerAddress?.trim() || undefined,
      soldAt: args.soldAt ?? Date.now(),
      dueAt: args.dueAt,
      note: args.note?.trim().slice(0, 500) || undefined,
      currency:
        args.currency?.trim().slice(0, 8) ||
        currencySymbol((await getSettings(ctx, userId))?.currency),
      discountPct: Math.min(100, Math.max(0, args.discountPct ?? 0)) || undefined,
      taxPct: Math.max(0, args.taxPct ?? 0) || undefined,
      lines: resolved,
      total: grand,
    });
    await sellStock(ctx, userId, resolved, String(saleId));
    // the invoice reaches the ledger in the same call, so the sales list and
    // the accounts can never drift apart
    const created = await ctx.db.get(saleId);
    if (created !== null) {
      const entryId = await postSale(ctx, userId, created);
      await ctx.db.patch(saleId, { entryId });
    }
    return saleId;
  },
});

/**
 * Mark a sales bill paid or unpaid.
 *
 * The customer settling is its own event, so it gets its own entry: the money
 * comes in and clears the receivable. Un-paying reverses exactly that entry.
 * The invoice's own entry is never touched here.
 */
export const setSalePaid = mutation({
  args: { id: v.id("sales"), paid: v.boolean() },
  handler: async (ctx, { id, paid }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const sale = await ctx.db.get(id);
    if (sale === null) return;
    if (sale.ownerId !== userId) throw new Error("Not your bill.");
    if ((sale.isPaid === true) === paid) return; // nothing changed

    if (paid) {
      const entryId = await postSaleReceipt(ctx, userId, sale, false);
      await ctx.db.patch(id, {
        isPaid: true,
        paidAt: Date.now(),
        paymentEntryId: entryId,
      });
      return;
    }
    await reverseEntry(ctx, userId, sale.paymentEntryId);
    await ctx.db.patch(id, {
      isPaid: undefined,
      paidAt: undefined,
      paymentEntryId: undefined,
    });
  },
});

/**
 * Post every sales bill that never reached the ledger — invoices raised before
 * sales wrote to the accounts. Reports what it fixed and what it could not.
 */
export const postMissing = mutation({
  args: {},
  handler: async (ctx): Promise<{ posted: number; failed: string[] }> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    let posted = 0;
    const failed: string[] = [];
    for (const sale of sales) {
      if (sale.entryId === undefined) {
        try {
          const entryId = await postSale(ctx, userId, sale);
          await ctx.db.patch(sale._id, { entryId });
          posted++;
        } catch (error) {
          failed.push(
            `${sale.number}: ${error instanceof Error ? error.message : "could not post"}`,
          );
          continue;
        }
      }
      // an invoice already marked paid needs its receipt entry too
      const fresh = await ctx.db.get(sale._id);
      if (fresh !== null && fresh.isPaid === true && fresh.paymentEntryId === undefined) {
        try {
          const paymentEntryId = await postSaleReceipt(ctx, userId, fresh, false);
          await ctx.db.patch(sale._id, { paymentEntryId });
          posted++;
        } catch (error) {
          failed.push(
            `${sale.number} (receipt): ${
              error instanceof Error ? error.message : "could not post"
            }`,
          );
        }
      }
    }
    return { posted, failed };
  },
});

/** Delete a sales bill, and unhook the quotation it came from. */
export const removeSale = mutation({
  args: { id: v.id("sales") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "delete");
    const sale = await ctx.db.get(id);
    if (sale === null) return;
    if (sale.ownerId !== userId) throw new Error("Not your bill.");
    if (sale.quotationId !== undefined) {
      await ctx.db.patch(sale.quotationId, {
        invoicedAs: undefined,
        invoicedAt: undefined,
        status: "accepted",
      });
    }
    // take the invoice and its settlement back out of the ledger
    await reverseEntry(ctx, userId, sale.entryId);
    await reverseEntry(ctx, userId, sale.paymentEntryId);
    // the bill never happened, so the goods it took go back on the shelf
    for (const line of sale.lines) {
      if (!(line.qty > 0)) continue;
      const product = await ctx.db.get(line.productId);
      if (product === null || product.ownerId !== userId) continue;
      await unsellStock(ctx, {
        ownerId: userId,
        product,
        qty: line.qty,
        ref: sale.number,
      });
    }
    await ctx.db.delete(id);
  },
});
