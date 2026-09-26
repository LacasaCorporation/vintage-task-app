import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { PROJECT_STATUS_FINISH, PROJECT_STATUS_START } from "../lib/project-statuses";

/**
 * Start production on a product: it is flagged so it opens in the Projects
 * workspace, and the raw materials its costing sheet needs are taken out of
 * stock.
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

    const lines = await ctx.db
      .query("costingItems")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();

    const needed = new Map<Id<"rawMaterials">, number>();
    for (const line of lines) {
      if (line.materialId === undefined) continue;
      needed.set(
        line.materialId,
        (needed.get(line.materialId) ?? 0) + (line.qty || 0),
      );
    }

    // check every line up front so a shortage never half-consumes the stock
    for (const [materialId, qty] of needed) {
      const material = await ctx.db.get(materialId);
      if (material === null || material.ownerId !== userId)
        throw new Error("A material this product needs no longer exists.");
      if ((material.stock ?? 0) < qty) {
        throw new Error(
          `Not enough stock of ${material.name} — need ${qty} ${material.unit}, have ${material.stock ?? 0}.`,
        );
      }
    }

    for (const [materialId, qty] of needed) {
      if (qty <= 0) continue;
      const material = await ctx.db.get(materialId);
      if (material === null) continue;
      await ctx.db.patch(materialId, {
        stock: (material.stock ?? 0) - qty,
      });
    }

    await ctx.db.patch(fgId, {
      isFlagged: true,
      flaggedAt: fg.flaggedAt ?? Date.now(),
      // starting production puts the product in the first status
      projectStatus:
        fg.projectStatus === PROJECT_STATUS_FINISH ? PROJECT_STATUS_START : fg.projectStatus,
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

    // put back what was consumed, then take the new amounts
    for (const used of fg.productionConsumed ?? []) {
      const material = await ctx.db.get(used.materialId);
      if (material === null || material.ownerId !== userId) continue;
      await ctx.db.patch(used.materialId, {
        stock: (material.stock ?? 0) + used.qty,
      });
    }
    for (const [materialId, qty] of next) {
      const material = await ctx.db.get(materialId);
      if (material === null || material.ownerId !== userId)
        throw new Error("A material this product needs no longer exists.");
      if ((material.stock ?? 0) < qty) {
        throw new Error(
          `Not enough stock of ${material.name} — need ${qty} ${material.unit}, have ${material.stock ?? 0}.`,
        );
      }
    }
    for (const [materialId, qty] of next) {
      if (qty <= 0) continue;
      const material = await ctx.db.get(materialId);
      if (material === null) continue;
      await ctx.db.patch(materialId, { stock: (material.stock ?? 0) - qty });
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
      await ctx.db.patch(used.materialId, {
        stock: (material.stock ?? 0) + used.qty,
      });
    }

    await ctx.db.patch(fgId, {
      productionStartedAt: undefined,
      productionConsumed: undefined,
      isCompleted: undefined,
      completedAt: undefined,
      projectStatus:
        fg.projectStatus === PROJECT_STATUS_FINISH ? PROJECT_STATUS_START : fg.projectStatus,
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
