import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { getSettings } from "./settings";
import { flagAncestors, jobIdsOf } from "./flagCascade";
import { stockIn, stockOut } from "./stock";
import { produceStock, reverseProduction } from "./productStock";
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
 * How many units the running production has already landed into `stock`.
 *
 * Read straight from the product's own stock ledger: every unit a run puts on
 * the shelf is a `production` movement stamped at or after the moment the run
 * started. Deriving it this way means a reverse can take back even units
 * landed by a run that began before a stored counter existed, and it can never
 * drift from the ledger the way a separate figure could.
 */
async function landedThisRun(
  ctx: MutationCtx,
  fg: Doc<"finishedGoods">,
): Promise<number> {
  if (fg.productionStartedAt === undefined) return 0;
  const movements = await ctx.db
    .query("productMovements")
    .withIndex("by_product", (q) => q.eq("productId", fg._id))
    .collect();
  let landed = 0;
  for (const m of movements) {
    if (m.source !== "production" || m.direction !== "in") continue;
    if (m.at < fg.productionStartedAt) continue;
    landed += m.qty;
  }
  return Math.round(landed * 1e6) / 1e6;
}

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
  // a run in progress has its own committed quantity; editing the sheet
  // mid-run must re-price against that, not the product's default batch.
  // It is what is still part-made plus what has already landed, so a sheet
  // edit after a partial finish still prices the whole batch.
  const make =
    (fg.productionQty ?? 0) + (await landedThisRun(ctx, fg)) || batchQty(fg);
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
  args: {
    fgId: v.id("finishedGoods"),
    qty: v.optional(v.number()),
    jobId: v.optional(v.id("projectJobs")),
  },
  handler: async (ctx, { fgId, qty, jobId }) => {
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

    // how many this run makes: the caller's answer, else the batch this
    // product is linked to on a job, else its own default
    let make = qty;
    if (make === undefined) {
      // the batch is per job: prefer the job the row was started from, so a
      // product sitting on two jobs produces that job's quantity rather than
      // whichever link happens to come back first
      const link =
        jobId === undefined
          ? null
          : ((await ctx.db
              .query("jobProducts")
              .withIndex("by_fg", (q) => q.eq("fgId", fgId))
              .collect()
            ).find((r) => r.jobId === jobId) ?? null);
      make = link?.qty ?? batchQty(fg);
    }
    if (!Number.isFinite(make) || make <= 0)
      throw new Error("Enter how many to produce.");
    make = Math.round(make * 1e6) / 1e6;

    const lines = await ctx.db
      .query("costingItems")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();

    const needed = new Map<Id<"rawMaterials">, number>();
    // the sheet covers one product, so the whole batch is produced from it
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

    const flaggedAt = fg.flaggedAt ?? Date.now();
    await ctx.db.patch(fgId, {
      isFlagged: true,
      flaggedAt,
      // starting production leaves "Listed" for a middle status
      projectStatus: middleProjectStatus(statuses),
      isCompleted: undefined,
      completedAt: undefined,
      productionStartedAt: Date.now(),
      // the units are part-made now; they only reach `stock` when it finishes
      productionQty: make,
      inProduction: (fg.inProduction ?? 0) + make,
      productionConsumed: [...needed.entries()].map(([materialId, qty]) => ({
        materialId,
        qty,
      })),
    });
    // a run in progress is project work like any other flagged product, so the
    // job it belongs to and that job's project carry the flag too: the batch
    // shows up under its job in the hierarchy and on the Productions tab at the
    // same time, rather than only in the flat product list. A product with no
    // job has no ancestor to flag, and that is left alone.
    await flagAncestors(ctx, userId, jobIdsOf(fg), flaggedAt);
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

/**
 * Reverse a running production: the raw materials it consumed go back into
 * stock and any units it had already landed come back off the product shelf,
 * so the product is left exactly as it was before the run.
 */
export const stop = mutation({
  args: {
    fgId: v.id("finishedGoods"),
    /**
     * Required when the product is finished. Reversing the run reopens a
     * product whose units are already on the shelf, so the reader is asked
     * first and says so here — it is never done in passing.
     */
    confirmReverse: v.optional(v.boolean()),
  },
  handler: async (ctx, { fgId, confirmReverse }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    if (fg.productionStartedAt === undefined)
      throw new Error("Production isn't running for this product.");
    // A finished product is on the books: reversing the run takes its units
    // back off the shelf and reopens it. That is a real change, so it takes an
    // explicit acknowledgement rather than happening behind a Yes button.
    const finished =
      fg.isCompleted === true || fg.projectStatus === PROJECT_STATUS_FINISH;
    if (finished && confirmReverse !== true)
      throw new Error(
        `“${fg.name}” is finished — its units are on the shelf and its cost is in the job totals. Reversing the run reopens the product and takes those units back; confirm the reversal to go ahead.`,
      );

    // a reverse has to undo the whole run: the units this run already landed
    // into stock come back off the shelf as well as the raw materials coming
    // back in, so production can never leave behind stock it did not really
    // make. The ledger says how much that is.
    const landed = await landedThisRun(ctx, fg);
    // The books are kept exactly as they are, so a reverse must never invent a
    // negative balance: if any of the units this run produced have already
    // left the shelf — invoiced, delivered, or written off by a stock take —
    // there is nothing left to take back. Refuse and let the run be settled by
    // hand rather than booking stock the firm does not have.
    const onHand = Math.round((fg.stock ?? 0) * 1e6) / 1e6;
    if (landed > 0 && landed > onHand) {
      const gone = Math.round((landed - onHand) * 1e6) / 1e6;
      throw new Error(
        `${gone} of the ${landed} units this run produced are no longer in stock, so the run can't be reversed without taking stock below zero. Undo the sales, deliveries, or stock corrections that used them first.`,
      );
    }
    if (landed > 0) {
      await reverseProduction(ctx, {
        ownerId: userId,
        product: fg,
        qty: landed,
        ref: fg.name,
      });
    }

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
      productionQty: undefined,
      // the abandoned units go back off the books
      inProduction: (fg.inProduction ?? 0) - (fg.productionQty ?? 0),
      isCompleted: undefined,
      completedAt: undefined,
      // the work is no longer under way, so it goes back to "Listed"
      projectStatus: PROJECT_STATUS_START,
    });
  },
});

/**
 * Lands a run's units on the shelf. Whatever is part-made becomes finished
 * stock and is written to the product ledger, so a product that reads
 * "finished" always has the units to show for it. Shared by every way of
 * finishing a product, so the two can never disagree.
 */
export async function landRun(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  fg: Doc<"finishedGoods">,
  made: number,
): Promise<number> {
  const qty = Math.round(made * 1e6) / 1e6;
  if (!(qty > 0)) return 0;
  const open = Math.round((fg.inProduction ?? 0) * 1e6) / 1e6;
  if (qty > open) {
    throw new Error("You can only finish what is in production.");
  }
  await ctx.db.patch(fg._id, {
    stock: Math.round(((fg.stock ?? 0) + qty) * 1e6) / 1e6,
    inProduction: Math.round((open - qty) * 1e6) / 1e6 || undefined,
    // the run ends, so whatever is still part-made starts a new one
    productionQty:
      Math.round(((fg.productionQty ?? 0) - qty) * 1e6) / 1e6 || undefined,
  });
  // the finished-goods ledger records what actually came off the line
  await produceStock(ctx, { ownerId: ownerId, product: fg, qty });
  return qty;
}

/** How many units finishing a product right now would put into stock. */
export function landableQty(fg: Doc<"finishedGoods">): number {
  return fg.inProduction ?? fg.productionQty ?? 0;
}

/**
 * Why a product cannot be finished yet, or null when it can.
 *
 * Finishing is what puts a product's units on the shelf, so a batch has to be
 * under way first: a product is finished by being produced, never by being
 * ticked off, and starting production is what moves it off the first status
 * and through the workflow. Every way of finishing checks this, so the status,
 * the tick and the stock ledger can never disagree.
 *
 * The client mirrors this in lib/project-statuses.ts, so a control that would
 * be refused explains itself instead of being offered.
 */
export function finishBlockedReason(fg: Doc<"finishedGoods">): string | null {
  if (landableQty(fg) > 0) return null;
  return fg.productionStartedAt === undefined
    ? "Start production before finishing this product — its units only reach the shelf when a batch is made."
    : "This run has already landed all of its units. Start another batch to finish more of it.";
}

/**
 * Finish a running production: the raw materials stay consumed, the part-made
 * units become finished stock, and the product is completed.
 */
export const finish = mutation({
  args: { fgId: v.id("finishedGoods"), qty: v.optional(v.number()) },
  handler: async (ctx, { fgId, qty }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    if (fg.productionStartedAt === undefined)
      throw new Error("Start production before finishing it.");
    // by default the whole run lands in stock; a partial finish is allowed
    const made = qty ?? fg.productionQty ?? 0;
    if (!Number.isFinite(made) || made <= 0)
      throw new Error("Enter how many came off the line.");
    await landRun(ctx, userId, fg, made);
    await ctx.db.patch(fgId, {
      projectStatus: PROJECT_STATUS_FINISH,
      isCompleted: true,
      completedAt: fg.completedAt ?? Date.now(),
      productionStartedAt: undefined,
      productionConsumed: undefined,
    });
  },
});

/**
 * Puts units that are still part-made into stock for a product that was
 * already marked finished. A product finished without its run being closed
 * out promised units it never booked, and this is what settles that: the
 * "in production" figure becomes real stock.
 */
export const landPending = mutation({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }): Promise<number> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    const made = landableQty(fg);
    if (!(made > 0))
      throw new Error("Nothing is waiting to go into stock for this product.");
    const moved = await landRun(ctx, userId, fg, made);
    await ctx.db.patch(fgId, {
      projectStatus: fg.projectStatus ?? PROJECT_STATUS_FINISH,
      isCompleted: true,
      completedAt: fg.completedAt ?? Date.now(),
      // the run is settled now, so it is closed out like any other finish
      productionStartedAt: undefined,
      productionConsumed: undefined,
      productionQty: undefined,
    });
    return moved;
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
