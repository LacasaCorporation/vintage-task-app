import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { stockIn } from "./stock";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const round = (n: number) => Math.round(n * 100) / 100;

/** LPO0001, LPO0002, … */
async function nextNumber(
  ctx: MutationCtx,
  ownerId: Id<"users">,
): Promise<string> {
  const rows = await ctx.db
    .query("lpos")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  let max = 0;
  for (const row of rows) {
    const n = Number.parseInt(row.number.slice(3), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `LPO${String(max + 1).padStart(4, "0")}`;
}

const lineValidator = v.array(
  v.object({
    materialId: v.id("rawMaterials"),
    qty: v.number(),
    unitCost: v.number(),
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
  }[],
): Promise<
  {
    materialId: Id<"rawMaterials">;
    name: string;
    unit: string;
    qty: number;
    unitCost: number;
  }[]
> {
  if (lines.length === 0) {
    throw new Error("Add at least one material to the order.");
  }
  const resolved = [];
  for (const line of lines) {
    const material = await ctx.db.get(line.materialId);
    if (material === null || material.ownerId !== ownerId) {
      throw new Error("One of those materials no longer exists.");
    }
    if (!(line.qty > 0)) {
      throw new Error(`Quantity for “${material.name}” must be more than zero.`);
    }
    if (line.unitCost < 0) throw new Error("Unit cost can't be negative.");
    resolved.push({
      materialId: material._id,
      name: material.name,
      unit: material.unit,
      qty: line.qty,
      unitCost: line.unitCost,
    });
  }
  return resolved;
}

/** Every purchase order, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("lpos")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return rows.sort((a, b) => b.orderedAt - a.orderedAt);
  },
});

/** Raise a new purchase order. */
export const create = mutation({
  args: {
    vendorId: v.optional(v.id("vendors")),
    vendor: v.optional(v.string()),
    orderedAt: v.optional(v.number()),
    expectedAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("draft"), v.literal("ordered"))),
    note: v.optional(v.string()),
    lines: lineValidator,
  },
  handler: async (ctx, args): Promise<Id<"lpos">> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const lines = await resolveLines(ctx, userId, args.lines);
    const total = round(lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0));
    return ctx.db.insert("lpos", {
      ownerId: userId,
      number: await nextNumber(ctx, userId),
      vendorId: args.vendorId,
      vendor: args.vendor?.trim().slice(0, 120) || undefined,
      orderedAt: args.orderedAt ?? Date.now(),
      expectedAt: args.expectedAt,
      status: args.status ?? "draft",
      note: args.note?.trim().slice(0, 500) || undefined,
      lines,
      total,
    });
  },
});

/** Edit an order that has not been received yet. */
export const update = mutation({
  args: {
    id: v.id("lpos"),
    vendorId: v.optional(v.id("vendors")),
    vendor: v.optional(v.string()),
    orderedAt: v.optional(v.number()),
    expectedAt: v.optional(v.number()),
    note: v.optional(v.string()),
    lines: lineValidator,
  },
  handler: async (ctx, args): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const lpo = await ctx.db.get(args.id);
    if (lpo === null || lpo.ownerId !== userId) {
      throw new Error("That order no longer exists.");
    }
    if (lpo.status === "received") {
      throw new Error("This order is already received — the stock is in.");
    }
    const lines = await resolveLines(ctx, userId, args.lines);
    await ctx.db.patch(args.id, {
      vendorId: args.vendorId,
      vendor: args.vendor?.trim().slice(0, 120) || undefined,
      orderedAt: args.orderedAt ?? lpo.orderedAt,
      expectedAt: args.expectedAt,
      note: args.note?.trim().slice(0, 500) || undefined,
      lines,
      total: round(lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0)),
    });
  },
});

/**
 * Move an order along without touching stock: draft → ordered, or cancel one
 * that will not be placed. Receiving is a separate step because it posts the
 * quantities into the material ledger.
 */
export const setStatus = mutation({
  args: {
    id: v.id("lpos"),
    status: v.union(
      v.literal("draft"),
      v.literal("ordered"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, { id, status }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const lpo = await ctx.db.get(id);
    if (lpo === null || lpo.ownerId !== userId) {
      throw new Error("That order no longer exists.");
    }
    if (lpo.status === "received") {
      throw new Error("This order is already received — the stock is in.");
    }
    await ctx.db.patch(id, { status });
  },
});

/**
 * The goods arrived: every line goes into stock as a purchase movement, so
 * the raw-material ledger shows the delivery and the balance follows. The
 * order cannot be received twice.
 */
export const receive = mutation({
  args: { id: v.id("lpos") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const lpo = await ctx.db.get(id);
    if (lpo === null || lpo.ownerId !== userId) {
      throw new Error("That order no longer exists.");
    }
    if (lpo.status === "received") {
      throw new Error("This order has already been received.");
    }
    if (lpo.status === "cancelled") {
      throw new Error("This order was cancelled — raise a new one instead.");
    }
    const at = Date.now();
    for (const line of lpo.lines) {
      const material = await ctx.db.get(line.materialId);
      if (material === null || material.ownerId !== userId) continue;
      await stockIn(ctx, {
        ownerId: userId,
        material,
        qty: line.qty,
        source: "lpo",
        ref: lpo.number,
        at,
      });
    }
    await ctx.db.patch(id, { status: "received", receivedAt: at });
  },
});

/** Remove an order that was never received. */
export const remove = mutation({
  args: { id: v.id("lpos") },
  handler: async (ctx, { id }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const lpo = await ctx.db.get(id);
    if (lpo === null || lpo.ownerId !== userId) return;
    if (lpo.status === "received") {
      throw new Error(
        "This order is already received — delete the purchase bill instead.",
      );
    }
    await ctx.db.delete(id);
  },
});
