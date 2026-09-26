import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const MAX_NAME_LENGTH = 120;

/** Next sequential purchase number: PUR0001, PUR0002, … */
async function nextPurchaseNumber(
  ctx: MutationCtx,
  ownerId: Id<"users">,
): Promise<string> {
  const bills = await ctx.db
    .query("purchases")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  let max = 0;
  for (const bill of bills) {
    const n = Number.parseInt(bill.number.slice(3), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `PUR${String(max + 1).padStart(4, "0")}`;
}

/** Every purchase bill, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const bills = await ctx.db
      .query("purchases")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return bills.sort((a, b) => b.purchasedAt - a.purchasedAt || b._creationTime - a._creationTime);
  },
});

/**
 * Save a purchase bill. Every line adds its quantity to the material's stock,
 * so the raw-materials list always shows what is on hand.
 */
export const create = mutation({    args: {
      supplier: v.optional(v.string()),
      supplierId: v.optional(v.id("vendors")),
      supplierAddress: v.optional(v.string()),
    purchasedAt: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    note: v.optional(v.string()),
    currency: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    taxPct: v.optional(v.number()),
    lines: v.array(
      v.object({
        materialId: v.id("rawMaterials"),
        qty: v.number(),
        unitCost: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { supplier, supplierId, supplierAddress, purchasedAt, dueAt, note, currency, discountPct, taxPct, lines } = args;
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    if (lines.length === 0) throw new Error("Add at least one material to the bill.");

    const resolved = [];
    let total = 0;
    for (const line of lines) {
      const material = await ctx.db.get(line.materialId);
      if (material === null) throw new Error("A material on this bill no longer exists.");
      if (material.ownerId !== userId) throw new Error("That material belongs to another workspace.");
      if (line.qty <= 0) throw new Error(`Quantity for “${material.name}” must be more than zero.`);
      if (line.unitCost < 0) throw new Error("Unit cost can't be negative.");
      resolved.push({
        materialId: material._id,
        name: material.name,
        unit: material.unit,
        qty: line.qty,
        unitCost: line.unitCost,
      });
      total += line.qty * line.unitCost;
      // stock in
      await ctx.db.patch(material._id, {
        stock: (material.stock ?? 0) + line.qty,
      });
    }

    const cleanSupplier = (supplier ?? "").trim().slice(0, MAX_NAME_LENGTH);
    const discount = Math.min(100, Math.max(0, discountPct ?? 0));
    const tax = Math.max(0, taxPct ?? 0);
    const grand = total - (total * discount) / 100 + ((total * (100 - discount)) / 100) * (tax / 100);
    const purchaseId = await ctx.db.insert("purchases", {
      ownerId: userId,
      number: await nextPurchaseNumber(ctx, userId),
      supplier: cleanSupplier || undefined,
      supplierId,
      supplierAddress: (supplierAddress ?? "").trim().slice(0, 240) || undefined,
      purchasedAt: purchasedAt ?? Date.now(),
      dueAt,
      note: (note ?? "").trim().slice(0, 500) || undefined,
      currency: (currency ?? "").trim().slice(0, 8) || undefined,
      discountPct: discount || undefined,
      taxPct: tax || undefined,
      lines: resolved,
      total: Math.round(grand * 100) / 100,
      isPaid: undefined,
    });
    // remember each line so this bill can be edited and reversed later
    for (const line of resolved) {
      await ctx.db.insert("purchaseLines", { ownerId: userId, purchaseId, ...line });
    }
    return purchaseId;
  },
});

/**
 * Edit an existing bill. The old lines are taken back out of stock and the
 * new ones put in, so the raw-materials list always matches what was bought.
 * `purchaseLines` holds the previous quantities for exactly this reason.
 */
export const update = mutation({
  args: {
    id: v.id("purchases"),
    supplier: v.optional(v.string()),
    supplierId: v.optional(v.id("vendors")),
    supplierAddress: v.optional(v.string()),
    purchasedAt: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    note: v.optional(v.string()),
    currency: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    taxPct: v.optional(v.number()),
    lines: v.array(
      v.object({
        materialId: v.id("rawMaterials"),
        qty: v.number(),
        unitCost: v.number(),
      }),
    ),
  },
  handler: async (ctx, { id, ...args }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const bill = await ctx.db.get(id);
    if (bill === null) throw new Error("That bill no longer exists.");
    if (bill.ownerId !== userId) throw new Error("Not your bill.");
    if (args.lines.length === 0) throw new Error("Add at least one material to the bill.");

    // roll the previous lines back out of stock
    const previous = await ctx.db
      .query("purchaseLines")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", id))
      .collect();
    for (const line of previous) {
      const material = await ctx.db.get(line.materialId);
      if (material === null || material.ownerId !== userId) continue;
      await ctx.db.patch(material._id, {
        stock: (material.stock ?? 0) - line.qty,
      });
      await ctx.db.delete(line._id);
    }

    const resolved = [];
    let total = 0;
    for (const line of args.lines) {
      const material = await ctx.db.get(line.materialId);
      if (material === null) throw new Error("A material on this bill no longer exists.");
      if (material.ownerId !== userId)
        throw new Error("That material belongs to another workspace.");
      if (line.qty <= 0)
        throw new Error(`Quantity for “${material.name}” must be more than zero.`);
      if (line.unitCost < 0) throw new Error("Unit cost can't be negative.");
      const stored = {
        materialId: material._id,
        name: material.name,
        unit: material.unit,
        qty: line.qty,
        unitCost: line.unitCost,
      };
      resolved.push(stored);
      total += line.qty * line.unitCost;
      await ctx.db.insert("purchaseLines", { ownerId: userId, purchaseId: id, ...stored });
      await ctx.db.patch(material._id, {
        stock: (material.stock ?? 0) + line.qty,
      });
    }

    const supplier = (args.supplier ?? "").trim().slice(0, MAX_NAME_LENGTH);
    const discount = Math.min(100, Math.max(0, args.discountPct ?? 0));
    const tax = Math.max(0, args.taxPct ?? 0);
    const grand = total - (total * discount) / 100 + ((total * (100 - discount)) / 100) * (tax / 100);
    await ctx.db.patch(id, {
      supplier: supplier || undefined,
      supplierId: args.supplierId,
      supplierAddress: (args.supplierAddress ?? "").trim().slice(0, 240) || undefined,
      purchasedAt: args.purchasedAt ?? bill.purchasedAt,
      dueAt: args.dueAt,
      note: (args.note ?? "").trim().slice(0, 500) || undefined,
      currency: (args.currency ?? "").trim().slice(0, 8) || undefined,
      discountPct: discount || undefined,
      taxPct: tax || undefined,
      lines: resolved,
      total: Math.round(grand * 100) / 100,
    });
    return id;
  },
});

/** Mark a bill paid / unpaid. */
export const setPaid = mutation({
  args: { id: v.id("purchases"), paid: v.boolean() },
  handler: async (ctx, { id, paid }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const bill = await ctx.db.get(id);
    if (bill === null) throw new Error("That bill no longer exists.");
    if (bill.ownerId !== userId) throw new Error("Not your bill.");
    await ctx.db.patch(id, { isPaid: paid || undefined });
  },
});

/**
 * Delete a bill and take its quantities back out of stock, so the material
 * list never keeps stock from a bill that no longer exists.
 */
export const remove = mutation({
  args: { id: v.id("purchases") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const bill = await ctx.db.get(id);
    if (bill === null) return;
    if (bill.ownerId !== userId) throw new Error("Not your bill.");
    // prefer the stored lines so a bill edited since creation still reverses
    const stored = await ctx.db
      .query("purchaseLines")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", id))
      .collect();
    if (stored.length > 0) {
      for (const line of stored) {
        const material = await ctx.db.get(line.materialId);
        if (material !== null && material.ownerId === userId) {
          await ctx.db.patch(material._id, {
            stock: Math.max(0, (material.stock ?? 0) - line.qty),
          });
        }
        await ctx.db.delete(line._id);
      }
    } else {
      for (const line of bill.lines) {
        const material = await ctx.db.get(line.materialId);
        if (material !== null && material.ownerId === userId) {
          await ctx.db.patch(material._id, {
            stock: Math.max(0, (material.stock ?? 0) - line.qty),
          });
        }
      }
    }
    await ctx.db.delete(id);
  },
});

/** Manually correct a material's stock (counts, damage, shrinkage…). */
export const adjustStock = mutation({
  args: { id: v.id("rawMaterials"), stock: v.number() },
  handler: async (ctx, { id, stock }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const material = await ctx.db.get(id);
    if (material === null) throw new Error("That material no longer exists.");
    if (material.ownerId !== userId) throw new Error("Not your material.");
    // negative stock is a real state (a shortage) and is shown, not blocked
    await ctx.db.patch(id, { stock });
  },
});
