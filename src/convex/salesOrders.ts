import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { requireItem } from "./authorize";
import { scopeUserId } from "./org";
import { postSale } from "./ledger";
import { getSettings } from "./settings";
import { currencySymbol } from "../lib/currency";
import { nextNumber, priceLines, sellStock, salesLineValidator } from "./sales";

/**
 * Sales orders: what the customer has confirmed they will take.
 *
 * The order is the commitment between a quotation and an invoice. It moves no
 * money and touches no stock — turning it into an invoice does both, and
 * closes the order at the same time, so one order can never raise two
 * invoices.
 */

const MAX_NAME_LENGTH = 120;

/** Every sales order, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("salesOrders")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return rows.sort((a, b) => b.orderedAt - a.orderedAt || b._creationTime - a._creationTime);
  },
});

/**
 * What the order form needs: the customers, and the orders still open, so a
 * quotation that has been accepted can be turned into an order.
 */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return { customers: [], quotations: [] };
    const customers = await ctx.db
      .query("customers")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const quotations = await ctx.db
      .query("quotations")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return {
      customers: customers
        .map((c) => ({ id: c._id, name: c.name, address: c.address }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      quotations: quotations
        .filter((q) => q.status === "accepted" && q.invoicedAs === undefined)
        .map((q) => ({
          id: q._id,
          number: q.number,
          customer: q.customerName ?? undefined,
          total: q.total,
        })),
    };
  },
});

/** Raise a new sales order. */
export const create = mutation({
  args: {
    customerId: v.optional(v.id("customers")),
    customerName: v.optional(v.string()),
    customerAddress: v.optional(v.string()),
    orderedAt: v.optional(v.number()),
    expectedAt: v.optional(v.number()),
    note: v.optional(v.string()),
    poRef: v.optional(v.string()),
    terms: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    taxPct: v.optional(v.number()),
    status: v.optional(v.union(v.literal("draft"), v.literal("ordered"))),
    quotationId: v.optional(v.id("quotations")),
    lines: salesLineValidator,
  },
  handler: async (ctx, args): Promise<Id<"salesOrders">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "create");
    if (args.lines.length === 0) throw new Error("Add at least one product to the order.");

    const lines = [];
    for (const line of args.lines) {
      const product = await ctx.db.get(line.productId);
      if (product === null) throw new Error("A product on this order no longer exists.");
      if (product.ownerId !== userId)
        throw new Error("That product belongs to another workspace.");
      if (line.qty <= 0)
        throw new Error(`Quantity for “${product.name}” must be more than zero.`);
      if (line.unitPrice < 0) throw new Error("Unit price can't be negative.");
      lines.push({
        productId: product._id,
        name: product.name,
        unit: product.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
      });
    }
    const { grand } = priceLines(lines, args.discountPct, args.taxPct);
    const discount = Math.min(100, Math.max(0, args.discountPct ?? 0));
    const tax = Math.max(0, args.taxPct ?? 0);

    // the order remembers where it came from, so the quotation is not
    // confirmed twice
    const quotationId = args.quotationId;
    if (quotationId !== undefined) {
      const quote = await ctx.db.get(quotationId);
      if (quote === null || quote.ownerId !== userId)
        throw new Error("That quotation no longer exists.");
      if (quote.invoicedAs !== undefined)
        throw new Error(`${quote.number} has already been turned into an invoice.`);
    }

    const id = await ctx.db.insert("salesOrders", {
      ownerId: userId,
      number: await nextNumber(ctx, "salesOrders", userId, "SO"),
      customerId: args.customerId,
      customerName: args.customerName?.trim().slice(0, MAX_NAME_LENGTH) || undefined,
      customerAddress: args.customerAddress?.trim().slice(0, MAX_NAME_LENGTH) || undefined,
      orderedAt: args.orderedAt ?? Date.now(),
      expectedAt: args.expectedAt,
      note: args.note?.trim().slice(0, 500) || undefined,
      poRef: args.poRef?.trim().slice(0, 60) || undefined,
      terms: args.terms?.trim().slice(0, 500) || undefined,
      currency:
        (await getSettings(ctx, userId))?.currency?.trim().slice(0, 8) ||
        currencySymbol((await getSettings(ctx, userId))?.currency),
      discountPct: discount || undefined,
      taxPct: tax || undefined,
      lines,
      total: grand,
      status: args.status ?? "draft",
      quotationId,
    });
    return id;
  },
});

/** Edit an order that has not been invoiced yet. */
export const update = mutation({
  args: {
    id: v.id("salesOrders"),
    customerId: v.optional(v.id("customers")),
    customerName: v.optional(v.string()),
    customerAddress: v.optional(v.string()),
    orderedAt: v.optional(v.number()),
    expectedAt: v.optional(v.number()),
    note: v.optional(v.string()),
    poRef: v.optional(v.string()),
    terms: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    taxPct: v.optional(v.number()),
    lines: salesLineValidator,
  },
  handler: async (ctx, args) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "edit");
    const order = await ctx.db.get(args.id);
    if (order === null || order.ownerId !== userId) throw new Error("Not your order.");
    if (order.status === "invoiced")
      throw new Error(
        `${order.number} has already been invoiced, so it can no longer be edited.`,
      );
    if (order.status === "cancelled") throw new Error(`${order.number} was cancelled.`);
    if (args.lines.length === 0) throw new Error("Add at least one product to the order.");

    const lines = [];
    for (const line of args.lines) {
      const product = await ctx.db.get(line.productId);
      if (product === null) throw new Error("A product on this order no longer exists.");
      if (product.ownerId !== userId)
        throw new Error("That product belongs to another workspace.");
      if (line.qty <= 0)
        throw new Error(`Quantity for “${product.name}” must be more than zero.`);
      if (line.unitPrice < 0) throw new Error("Unit price can't be negative.");
      lines.push({
        productId: product._id,
        name: product.name,
        unit: product.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
      });
    }
    const discount = Math.min(100, Math.max(0, args.discountPct ?? 0));
    const tax = Math.max(0, args.taxPct ?? 0);
    const { grand } = priceLines(lines, discount, tax);

    await ctx.db.patch(args.id, {
      customerId: args.customerId,
      customerName: args.customerName?.trim().slice(0, MAX_NAME_LENGTH) || undefined,
      customerAddress: args.customerAddress?.trim().slice(0, MAX_NAME_LENGTH) || undefined,
      orderedAt: args.orderedAt ?? order.orderedAt,
      expectedAt: args.expectedAt,
      note: args.note?.trim().slice(0, 500) || undefined,
      poRef: args.poRef?.trim().slice(0, 60) || undefined,
      terms: args.terms?.trim().slice(0, 500) || undefined,
      discountPct: discount || undefined,
      taxPct: tax || undefined,
      lines,
      total: grand,
    });
    return args.id;
  },
});

/** Move an order between draft, ordered and cancelled. */
export const setStatus = mutation({
  args: {
    id: v.id("salesOrders"),
    status: v.union(v.literal("draft"), v.literal("ordered"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "edit");
    const order = await ctx.db.get(args.id);
    if (order === null || order.ownerId !== userId) throw new Error("Not your order.");
    if (order.status === "invoiced")
      throw new Error(`${order.number} has already been invoiced.`);
    await ctx.db.patch(args.id, { status: args.status });
  },
});

/**
 * Turn an order into an invoice.
 *
 * The invoice is a real sale: it takes the goods out of stock and posts to the
 * ledger in the same call, so the money side and the stock side can never
 * drift apart. The order is closed as it goes.
 */
export const convertToInvoice = mutation({
  args: { id: v.id("salesOrders") },
  handler: async (ctx, args): Promise<Id<"sales">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "create");
    const order = await ctx.db.get(args.id);
    if (order === null || order.ownerId !== userId) throw new Error("Not your order.");
    if (order.invoiceId !== undefined)
      throw new Error(`${order.number} has already been invoiced.`);
    if (order.status === "cancelled")
      throw new Error(`${order.number} was cancelled — raise a new order instead.`);

    const saleId = await ctx.db.insert("sales", {
      ownerId: userId,
      number: await nextNumber(ctx, "sales", userId, "SAL"),
      customerId: order.customerId,
      customerName: order.customerName,
      customerAddress: order.customerAddress,
      soldAt: Date.now(),
      note: order.note,
      poRef: order.poRef,
      terms: order.terms,
      currency: order.currency,
      discountPct: order.discountPct,
      taxPct: order.taxPct,
      lines: order.lines,
      total: order.total,
    });
    await sellStock(ctx, userId, order.lines, order.number);

    const created = await ctx.db.get(saleId);
    let entryId: Id<"journalEntries"> | undefined;
    if (created !== null) {
      entryId = await postSale(ctx, userId, created);
      await ctx.db.patch(saleId, { entryId });
    }
    await ctx.db.patch(args.id, {
      status: "invoiced",
      invoiceId: saleId,
      invoicedAt: Date.now(),
    });
    return saleId;
  },
});

/** Delete an order. An order that has been invoiced stays on file. */
export const remove = mutation({
  args: { id: v.id("salesOrders") },
  handler: async (ctx, args) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "sales", "delete");
    const order = await ctx.db.get(args.id);
    if (order === null || order.ownerId !== userId) throw new Error("Not your order.");
    if (order.invoiceId !== undefined)
      throw new Error(
        `${order.number} has already been invoiced as ${(await ctx.db.get(order.invoiceId))?.number ?? "an invoice"} — delete the invoice instead.`,
      );
    await ctx.db.delete(args.id);
  },
});
