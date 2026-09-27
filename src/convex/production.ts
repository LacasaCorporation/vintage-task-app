import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { getSettings } from "./settings";
import { stockIn, stockOut } from "./stock";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import {
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
  middleProjectStatus,
  projectStatusesOrDefaults,
} from "../lib/project-statuses";
import { batchQty } from "../lib/product-cost";

/**
 * Re-read a product's costing sheet and move the raw-material stock to match.
 * Used whenever a sheet line is added, edited or deleted while the product is
 * in production, so the running run always reflects the sheet. Stock is
 * allowed to go negative: a shortage is a real state the user needs to see.
 *
 * The sheet prices ONE product, so a batch of three needs three times the
 * material: the quantities are multiplied by the product's own quantity.
 */
export async function syncProductionConsumption(
  ctx: MutationCtx,
  fg: Doc<"finishedGoods">,
): Promise<void> {
  if (fg.productionStartedAt === undefined) return;
  const lines = await ctx.db
    .query("costingItems")
    .withIndex("by_fg", (q) => q.eq("fgId", fg._id))
    .collect();
  const make = batchQty(fg);
  const next = new Map<Id<"rawMaterials">, number>();
  for (const line of lines) {
    if (line.materialId === undefined) continue;
    next.set(
      line.materialId,
      (next.get(line.materialId) ?? 0) + (line.qty || 0) * make,
    );
  }

  // put back everything the previous run took out
  for (const used of fg.productionConsumed ?? []) {
    const material = await ctx.db.get(used.materialId);
    if (material === null) continue;
    await stockIn(ctx, {
      ownerId: fg.ownerId,
      material,
      qty: used.qty,
      source: "production-return",
      ref: fg.name,
    });
  }
  // then take the amounts the sheet calls for now
  for (const [materialId, qty] of next) {
    if (qty <= 0) continue;
    const material = await ctx.db.get(materialId);
    if (material === null) continue;
    await stockOut(ctx, {
      ownerId: fg.ownerId,
      material,
      qty,
      source: "production",
      ref: fg.name,
    });
  }

  await ctx.db.patch(fg._id, {
    productionConsumed: [...next.entries()].map(([materialId, qty]) => ({
      materialId,
      qty,
    })),
  });
}

/**
 * Start production on a product: it is flagged so it opens in the Projects
 * workspace, and the raw materials its costing sheet needs are taken out of
 * stock. A product leaves "Listed" for a middle status once work begins.
 */
export const start = mutation({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    if (fg.productionStartedAt !== undefined)
      throw new Error("Production is already running for this product.");
    const statuses = projectStatusesOrDefaults(
      (await getSettings(ctx, userId))?.projectStatuses,
    );

    const lines = await ctx.db
      .query("costingItems")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();

    const needed = new Map<Id<"rawMaterials">, number>();
    // the sheet covers one product, so the whole batch is produced from it
    const make = batchQty(fg);
    for (const line of lines) {
      if (line.materialId === undefined) continue;
      needed.set(
        line.materialId,
        (needed.get(line.materialId) ?? 0) + (line.qty || 0) * make,
      );
    }

    // a shortage is allowed: the stock simply goes negative so it is visible
    for (const [materialId, qty] of needed) {
      if (qty <= 0) continue;
      const material = await ctx.db.get(materialId);
      if (material === null || material.ownerId !== userId)
        throw new Error("A material this product needs no longer exists.");
      await stockOut(ctx, {
        ownerId: userId,
        material,
        qty,
        source: "production",
        ref: fg.name,
      });
    }

    await ctx.db.patch(fgId, {
      isFlagged: true,
      flaggedAt: fg.flaggedAt ?? Date.now(),
      // starting production leaves "Listed" for a middle status
      projectStatus: middleProjectStatus(statuses),
      isCompleted: undefined,
      completedAt: undefined,
      productionStartedAt: Date.now(),
      productionConsumed: [...needed.entries()].map(([materialId, qty]) => ({
        materialId,
        qty,
      })),
    });
    return fgId;
  },
});

/** Change how much of each material the running production consumes. */
export const editConsumption = mutation({
  args: {
    fgId: v.id("finishedGoods"),
    lines: v.array(
      v.object({ materialId: v.id("rawMaterials"), qty: v.number() }),
    ),
  },
  handler: async (ctx, { fgId, lines }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    if (fg.productionStartedAt === undefined)
      throw new Error("Start production before editing it.");

    const next = new Map<Id<"rawMaterials">, number>();
    for (const line of lines) next.set(line.materialId, Math.max(0, line.qty));

    // put back what was consumed, then take the new amounts (stock may go
    // negative so a shortage stays visible instead of being blocked)
    for (const used of fg.productionConsumed ?? []) {
      const material = await ctx.db.get(used.materialId);
      if (material === null || material.ownerId !== userId) continue;
      await stockIn(ctx, {
        ownerId: userId,
        material,
        qty: used.qty,
        source: "production-return",
        ref: fg.name,
      });
    }
    for (const materialId of next.keys()) {
      const material = await ctx.db.get(materialId);
      if (material === null || material.ownerId !== userId)
        throw new Error("A material this product needs no longer exists.");
    }
    for (const [materialId, qty] of next) {
      if (qty <= 0) continue;
      const material = await ctx.db.get(materialId);
      if (material === null) continue;
      await stockOut(ctx, {
        ownerId: userId,
        material,
        qty,
        source: "production",
        ref: fg.name,
      });
    }

    await ctx.db.patch(fgId, {
      productionConsumed: [...next.entries()].map(([materialId, qty]) => ({
        materialId,
        qty,
      })),
    });
  },
});

/** Stop a running production and return the consumed stock. */
export const stop = mutation({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    if (fg.productionStartedAt === undefined)
      throw new Error("Production isn't running for this product.");

    for (const used of fg.productionConsumed ?? []) {
      const material = await ctx.db.get(used.materialId);
      if (material === null || material.ownerId !== userId) continue;
      await stockIn(ctx, {
        ownerId: userId,
        material,
        qty: used.qty,
        source: "production-return",
        ref: fg.name,
      });
    }

    await ctx.db.patch(fgId, {
      productionStartedAt: undefined,
      productionConsumed: undefined,
      isCompleted: undefined,
      completedAt: undefined,
      // the work is no longer under way, so it goes back to "Listed"
      projectStatus: PROJECT_STATUS_START,
    });
  },
});

/** Finish a running production: stock stays consumed, product is completed. */
export const finish = mutation({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    if (fg.productionStartedAt === undefined)
      throw new Error("Start production before finishing it.");
    await ctx.db.patch(fgId, {
      projectStatus: PROJECT_STATUS_FINISH,
      isCompleted: true,
      completedAt: fg.completedAt ?? Date.now(),
      productionStartedAt: undefined,
      productionConsumed: undefined,
    });
  },
});

/** Every product with the raw materials its costing sheet consumes. */
export const listRequirements = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const fgs = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const lines = await ctx.db
      .query("costingItems")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const byFg = new Map<Id<"finishedGoods">, typeof lines>();
    for (const line of lines) {
      if (line.fgId === undefined) continue;
      const list = byFg.get(line.fgId) ?? [];
      list.push(line);
      byFg.set(line.fgId, list);
    }

    return fgs.map((fg) => ({
      fg,
      lines: (byFg.get(fg._id) ?? [])
        .filter((l) => l.materialId !== undefined)
        .map((l) => ({
          materialId: l.materialId as Id<"rawMaterials">,
          label: l.label,
          qty: l.qty,
          unit: l.unit,
          unitPrice: l.unitPrice,
        })),
    }));
  },
});
