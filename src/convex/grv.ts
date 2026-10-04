import { mutation, query } from "./_generated/server";
import { requireItem } from "./authorize";
import { scopeUserId } from "./org";
import { stockIn, stockOut } from "./stock";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { blendedRate, cleanRate, priceTaxedLines } from "../lib/line-tax";

const MAX_NAME_LENGTH = 120;

/** A discount percentage, clamped the way the pricing helper clamps it. */
const cleanDiscount = (value: number | undefined): number =>
  Math.min(100, Math.max(0, value ?? 0));

/** Next sequential voucher number: GRV0001, GRV0002, … */
async function nextGrvNumber(
  ctx: MutationCtx,
  ownerId: Id<"users">,
): Promise<string> {
  const rows = await ctx.db
    .query("grvs")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  let max = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.number.slice(3), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `GRV${String(max + 1).padStart(4, "0")}`;
}

/**
 * Every goods received voucher, newest first, with the order it answers
 * resolved so the list can name it.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("grvs")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const lpos = await ctx.db
      .query("lpos")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const lpoNumber = new Map(lpos.map((l) => [l._id, l.number]));
    return rows
      .sort((a, b) => b.receivedAt - a.receivedAt || b._creationTime - a._creationTime)
      .map((g) => ({
        ...g,
        lpoNumber: g.lpoId !== undefined ? lpoNumber.get(g.lpoId) : undefined,
      }));
  },
});

/**
 * What the voucher form can be raised against: the orders that are still open,
 * so a delivery can be tied back to what was asked for.
 */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return { lpos: [] };
    const lpos = await ctx.db
      .query("lpos")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return {
      lpos: lpos
        .filter((l) => l.status === "draft" || l.status === "ordered")
        .sort((a, b) => b.orderedAt - a.orderedAt)
        .map((l) => ({
          id: l._id,
          number: l.number,
          vendorId: l.vendorId,
          vendor: l.vendor,
          lines: l.lines.map((line) => ({
            materialId: line.materialId,
            qty: line.qty,
            unitCost: line.unitCost,
            taxPct: line.taxPct,
          })),
        })),
    };
  },
});

/** Put a voucher's quantities into stock, once, and close any order behind it. */
async function countIn(
  ctx: MutationCtx,
  userId: Id<"users">,
  grv: { _id: Id<"grvs">; number: string; lines: { materialId: Id<"rawMaterials">; qty: number }[]; receivedAt: number; lpoId?: Id<"lpos"> },
): Promise<void> {
  for (const line of grv.lines) {
    const material = await ctx.db.get(line.materialId);
    if (material === null || material.ownerId !== userId) continue;
    await stockIn(ctx, {
      ownerId: userId,
      material,
      qty: line.qty,
      source: "grv",
      ref: grv.number,
      at: grv.receivedAt,
    });
  }
  await ctx.db.patch(grv._id, { status: "received", receivedInto: Date.now() });
  // a delivery against an order closes that order out, so it is never received
  // a second time through the order's own Receive action
  if (grv.lpoId !== undefined) {
    const lpo = await ctx.db.get(grv.lpoId);
    if (lpo !== null && lpo.ownerId === userId && lpo.status !== "cancelled") {
      await ctx.db.patch(grv.lpoId, {
        status: "received",
        receivedAt: lpo.receivedAt ?? grv.receivedAt,
      });
    }
  }
}

/** The typed lines of a voucher, shared by create and update. */
const lineValidator = v.array(
  v.object({
    materialId: v.id("rawMaterials"),
    qty: v.number(),
    unitCost: v.number(),
    taxPct: v.optional(v.number()),
  }),
);

/** Resolves the typed lines, naming each material the way it is stored. */
async function resolveLines(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  lines: readonly {
    materialId: Id<"rawMaterials">;
    qty: number;
    unitCost: number;
    taxPct?: number | undefined;
  }[],
) {
  if (lines.length === 0) {
    throw new Error("Add at least one material to the voucher.");
  }
  const resolved = [];
  for (const line of lines) {
    const material = await ctx.db.get(line.materialId);
    if (material === null) {
      throw new Error("A material on this voucher no longer exists.");
    }
    if (material.ownerId !== ownerId) {
      throw new Error("That material belongs to another workspace.");
    }
    if (line.qty <= 0) {
      throw new Error(`Quantity for “${material.name}” must be more than zero.`);
    }
    if (line.unitCost < 0) throw new Error("Unit cost can't be negative.");
    resolved.push({
      materialId: material._id,
      name: material.name,
      unit: material.unit,
      qty: line.qty,
      unitCost: line.unitCost,
      taxPct: line.taxPct === undefined ? undefined : cleanRate(line.taxPct),
    });
  }
  return resolved;
}

/**
 * Record goods that have arrived. Saved as a draft it changes nothing; marked
 * received — either here or later — its quantities go into raw-material stock.
 */
export const create = mutation({
  args: {
    vendorId: v.optional(v.id("vendors")),
    vendor: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    lpoId: v.optional(v.id("lpos")),
    reference: v.optional(v.string()),
    supplierAddress: v.optional(v.string()),
    note: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    status: v.optional(v.union(v.literal("draft"), v.literal("received"))),
    lines: lineValidator,
  },
  handler: async (ctx, args): Promise<Id<"grvs">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "purchases", "create");
    const at = args.receivedAt ?? Date.now();
    const resolved = await resolveLines(ctx, userId, args.lines);
    const priced = priceTaxedLines(resolved, args.discountPct);

    let vendor = (args.vendor ?? "").trim().slice(0, MAX_NAME_LENGTH);
    if (args.vendorId !== undefined) {
      const vendorDoc = await ctx.db.get(args.vendorId);
      if (vendorDoc === null || vendorDoc.ownerId !== userId) {
        throw new Error("That supplier no longer exists.");
      }
      if (vendor === "") vendor = vendorDoc.name;
    }
    if (args.lpoId !== undefined) {
      const lpo = await ctx.db.get(args.lpoId);
      if (lpo === null || lpo.ownerId !== userId) {
        throw new Error("That order no longer exists.");
      }
      if (vendor === "") vendor = (lpo.vendor ?? "").trim();
    }

    const status = args.status ?? "draft";
    const id = await ctx.db.insert("grvs", {
      ownerId: userId,
      number: await nextGrvNumber(ctx, userId),
      vendorId: args.vendorId,
      vendor: vendor || undefined,
      receivedAt: at,
      lpoId: args.lpoId,
      reference: args.reference?.trim().slice(0, 60) || undefined,
      supplierAddress: args.supplierAddress?.trim().slice(0, 240) || undefined,
      note: args.note?.trim().slice(0, 500) || undefined,
      discountPct: cleanDiscount(args.discountPct) || undefined,
      lines: resolved,
      taxPct: blendedRate(priced.net, priced.tax) || undefined,
      total: priced.grand,
      taxAmount: priced.tax,
      status,
    });
    if (status === "received") {
      const created = await ctx.db.get(id);
      if (created !== null) await countIn(ctx, userId, created);
    }
    return id;
  },
});

/**
 * Edit a draft voucher. A voucher whose goods are already counted in cannot be
 * changed, because the stock it wrote would no longer match the paperwork.
 */
export const update = mutation({
  args: {
    id: v.id("grvs"),
    vendorId: v.optional(v.id("vendors")),
    vendor: v.optional(v.string()),
    receivedAt: v.optional(v.number()),
    reference: v.optional(v.string()),
    supplierAddress: v.optional(v.string()),
    note: v.optional(v.string()),
    discountPct: v.optional(v.number()),
    lines: lineValidator,
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "purchases", "edit");
    const grv = await ctx.db.get(args.id);
    if (grv === null || grv.ownerId !== userId) {
      throw new Error("That voucher no longer exists.");
    }
    if (grv.status === "received") {
      throw new Error(
        `${grv.number} is already counted in — its stock cannot be edited.`,
      );
    }
    const resolved = await resolveLines(ctx, userId, args.lines);
    const priced = priceTaxedLines(resolved, args.discountPct);

    let vendor = (args.vendor ?? "").trim().slice(0, MAX_NAME_LENGTH);
    if (args.vendorId !== undefined) {
      const vendorDoc = await ctx.db.get(args.vendorId);
      if (vendorDoc === null || vendorDoc.ownerId !== userId) {
        throw new Error("That supplier no longer exists.");
      }
      if (vendor === "") vendor = vendorDoc.name;
    }
    await ctx.db.patch(args.id, {
      vendorId: args.vendorId ?? grv.vendorId,
      vendor: vendor || undefined,
      receivedAt: args.receivedAt ?? grv.receivedAt,
      reference: args.reference?.trim().slice(0, 60) || undefined,
      supplierAddress: args.supplierAddress?.trim().slice(0, 240) || undefined,
      note: args.note?.trim().slice(0, 500) || undefined,
      discountPct: cleanDiscount(args.discountPct) || undefined,
      lines: resolved,
      taxPct: blendedRate(priced.net, priced.tax) || undefined,
      total: priced.grand,
      taxAmount: priced.tax,
    });
  },
});

/** Count a draft voucher into stock. Refuses one that already went in. */
export const receive = mutation({
  args: { id: v.id("grvs") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "purchases", "edit");
    const grv = await ctx.db.get(id);
    if (grv === null) throw new Error("That voucher no longer exists.");
    if (grv.ownerId !== userId) throw new Error("Not your voucher.");
    if (grv.status === "received") {
      throw new Error(`${grv.number} has already been counted in.`);
    }
    await countIn(ctx, userId, grv);
  },
});

/** Delete a voucher, taking any stock it counted in back out again. */
export const remove = mutation({
  args: { id: v.id("grvs") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "purchases", "delete");
    const grv = await ctx.db.get(id);
    if (grv === null || grv.ownerId !== userId) return;
    if (grv.status === "received") {
      for (const line of grv.lines) {
        const material = await ctx.db.get(line.materialId);
        if (material === null || material.ownerId !== userId) continue;
        await stockOut(ctx, {
          ownerId: userId,
          material,
          qty: Math.min(line.qty, material.stock ?? 0),
          source: "adjustment",
          ref: `${grv.number} (deleted)`,
          at: grv.receivedAt,
        });
      }
    }
    await ctx.db.delete(id);
  },
});
