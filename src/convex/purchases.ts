import { mutation, query } from "./_generated/server";
import { requireItem } from "./authorize";
import { scopeUserId } from "./org";
import { postBill, postBillPayment, reverseEntry } from "./ledger";
import { defaultTaxPct } from "./accountingDefaults";
import { setStockTo, stockIn, stockOut } from "./stock";
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
/**
 * The default tax rate and where bills post, for the bill form to prefill.
 */
export const postingDefaults = query({
  args: {},
  handler: async (ctx): Promise<{ taxPct: number }> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return { taxPct: 0 };
    return { taxPct: await defaultTaxPct(ctx, userId) };
  },
});

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
    /** The purchase order this bill is being raised from, if any. */
    lpoId: v.optional(v.id("lpos")),
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
    await requireItem(ctx, userId, "purchases", "create");
    if (lines.length === 0) throw new Error("Add at least one material to the bill.");
    // an order that was already received informally has its stock in; billing
    // it too would count the same delivery twice
    if (args.lpoId !== undefined) {
      const lpo = await ctx.db.get(args.lpoId);
      if (lpo === null || lpo.ownerId !== userId) {
        throw new Error("That order no longer exists.");
      }
      if (lpo.billId !== undefined) {
        throw new Error(`${lpo.number} has already been billed.`);
      }
      if (lpo.status === "received") {
        throw new Error(
          `${lpo.number} was already received, so its stock is in. Delete the order's receipt first if you want this bill to bring the goods in.`,
        );
      }
      if (lpo.status === "cancelled") {
        throw new Error(`${lpo.number} was cancelled — raise a new order instead.`);
      }
    }

    const number = await nextPurchaseNumber(ctx, userId);
    const at = purchasedAt ?? Date.now();
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
      // stock in, logged as income against this bill
      await stockIn(ctx, {
        ownerId: userId,
        material,
        qty: line.qty,
        source: "purchase",
        ref: number,
        at,
      });
    }

    const cleanSupplier = (supplier ?? "").trim().slice(0, MAX_NAME_LENGTH);
    const discount = Math.min(100, Math.max(0, discountPct ?? 0));
    const tax = Math.max(0, taxPct ?? 0);
    const grand = total - (total * discount) / 100 + ((total * (100 - discount)) / 100) * (tax / 100);
    const purchaseId = await ctx.db.insert("purchases", {
      ownerId: userId,
      number,
      supplier: cleanSupplier || undefined,
      supplierId,
      supplierAddress: (supplierAddress ?? "").trim().slice(0, 240) || undefined,
      purchasedAt: at,
      dueAt,
      note: (note ?? "").trim().slice(0, 500) || undefined,
      currency: (currency ?? "").trim().slice(0, 8) || undefined,
      discountPct: discount || undefined,
      taxPct: tax || undefined,
      lines: resolved,
      total: Math.round(grand * 100) / 100,
      isPaid: undefined,
      lpoId: args.lpoId,
    });
    // remember each line so this bill can be edited and reversed later
    for (const line of resolved) {
      await ctx.db.insert("purchaseLines", { ownerId: userId, purchaseId, ...line });
    }
    // the bill reaches the ledger in the same call, so the register and the
    // accounts can never drift apart
    const created = await ctx.db.get(purchaseId);
    if (created !== null) {
      const entryId = await postBill(ctx, userId, created);
      await ctx.db.patch(purchaseId, { entryId });
    }
    // a bill raised from an order *is* that order's delivery: the stock is
    // already in from the lines above, so the order is closed out here rather
    // than received a second time
    if (args.lpoId !== undefined) {
      const lpo = await ctx.db.get(args.lpoId);
      if (lpo === null || lpo.ownerId !== userId) {
        throw new Error("That order no longer exists.");
      }
      if (lpo.billId !== undefined) {
        throw new Error(`${lpo.number} has already been billed.`);
      }
      await ctx.db.patch(args.lpoId, {
        status: "received",
        receivedAt: lpo.receivedAt ?? at,
        billId: purchaseId,
      });
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
    await requireItem(ctx, userId, "purchases", "edit");
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
      // an edited bill is a correction, not new income
      await stockOut(ctx, {
        ownerId: userId,
        material,
        qty: line.qty,
        source: "adjustment",
        ref: `${bill.number} (edited)`,
        at: args.purchasedAt ?? bill.purchasedAt,
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
      await stockIn(ctx, {
        ownerId: userId,
        material,
        qty: line.qty,
        source: "purchase",
        ref: bill.number,
        at: args.purchasedAt ?? bill.purchasedAt,
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
    // the old entries described a bill that no longer exists, so they are
    // reversed and the corrected bill posted in their place
    const wasPaid = bill.isPaid === true;
    await reverseEntry(ctx, userId, bill.entryId);
    await reverseEntry(ctx, userId, bill.paymentEntryId);
    const updated = await ctx.db.get(id);
    if (updated !== null) {
      const entryId = await postBill(ctx, userId, updated);
      const paymentEntryId = wasPaid
        ? await postBillPayment(ctx, userId, updated, false)
        : undefined;
      await ctx.db.patch(id, { entryId, paymentEntryId });
    }
    return id;
  },
});

/**
 * Mark a bill paid / unpaid.
 *
 * Settling is its own event, so it gets its own entry: paying clears the
 * payable against the till, and un-paying reverses exactly that entry and
 * nothing else. The bill's own entry is never touched here, which is what
 * keeps the purchase and the payment readable as two separate facts.
 */
export const setPaid = mutation({
  args: { id: v.id("purchases"), paid: v.boolean() },
  handler: async (ctx, { id, paid }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await requireItem(ctx, userId, "purchases", "edit");
    const bill = await ctx.db.get(id);
    if (bill === null) throw new Error("That bill no longer exists.");
    if (bill.ownerId !== userId) throw new Error("Not your bill.");
    if ((bill.isPaid === true) === paid) return; // nothing changed

    if (paid) {
      const entryId = await postBillPayment(ctx, userId, bill, false);
      await ctx.db.patch(id, { isPaid: true, paymentEntryId: entryId });
      return;
    }
    await reverseEntry(ctx, userId, bill.paymentEntryId);
    await ctx.db.patch(id, { isPaid: undefined, paymentEntryId: undefined });
  },
});

/**
 * Post every bill that never reached the ledger — rows recorded before bills
 * wrote to the accounts, or entries lost to a failed call. It reports what it
 * fixed rather than failing the whole run on one bad row.
 */
export const postMissing = mutation({
  args: {},
  handler: async (ctx): Promise<{ posted: number; failed: string[] }> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const bills = await ctx.db
      .query("purchases")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    let posted = 0;
    const failed: string[] = [];
    for (const bill of bills) {
      if (bill.entryId === undefined) {
        try {
          const entryId = await postBill(ctx, userId, bill);
          await ctx.db.patch(bill._id, { entryId });
          posted++;
        } catch (error) {
          failed.push(
            `${bill.number}: ${error instanceof Error ? error.message : "could not post"}`,
          );
          continue;
        }
      }
      // a bill already marked paid needs its settlement entry too
      const fresh = await ctx.db.get(bill._id);
      if (fresh !== null && fresh.isPaid === true && fresh.paymentEntryId === undefined) {
        try {
          const paymentEntryId = await postBillPayment(ctx, userId, fresh, false);
          await ctx.db.patch(bill._id, { paymentEntryId });
          posted++;
        } catch (error) {
          failed.push(
            `${bill.number} (payment): ${
              error instanceof Error ? error.message : "could not post"
            }`,
          );
        }
      }
    }
    return { posted, failed };
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
    await requireItem(ctx, userId, "purchases", "delete");
    const bill = await ctx.db.get(id);
    if (bill === null) return;
    if (bill.ownerId !== userId) throw new Error("Not your bill.");
    // take the bill and its settlement back out of the ledger
    await reverseEntry(ctx, userId, bill.entryId);
    await reverseEntry(ctx, userId, bill.paymentEntryId);
    // the order it came from is open again — the goods are no longer booked in
    if (bill.lpoId !== undefined) {
      const lpo = await ctx.db.get(bill.lpoId);
      if (lpo !== null && lpo.ownerId === userId) {
        await ctx.db.patch(bill.lpoId, {
          status: lpo.status === "received" ? "ordered" : lpo.status,
          billId: undefined,
          receivedAt: undefined,
        });
      }
    }
    // prefer the stored lines so a bill edited since creation still reverses
    const stored = await ctx.db
      .query("purchaseLines")
      .withIndex("by_purchase", (q) => q.eq("purchaseId", id))
      .collect();
    if (stored.length > 0) {
      for (const line of stored) {
        const material = await ctx.db.get(line.materialId);
        if (material !== null && material.ownerId === userId) {
          await stockOut(ctx, {
            ownerId: userId,
            material,
            qty: Math.min(line.qty, material.stock ?? 0),
            source: "adjustment",
            ref: `${bill.number} (deleted)`,
            at: bill.purchasedAt,
          });
        }
        await ctx.db.delete(line._id);
      }
    } else {
      for (const line of bill.lines) {
        const material = await ctx.db.get(line.materialId);
        if (material !== null && material.ownerId === userId) {
          await stockOut(ctx, {
            ownerId: userId,
            material,
            qty: Math.min(line.qty, material.stock ?? 0),
            source: "adjustment",
            ref: `${bill.number} (deleted)`,
            at: bill.purchasedAt,
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
    // a hand-set figure is a correction: log the difference, not the total,
    // and let the opening absorb it so the ledger still balances
    await setStockTo(ctx, {
      ownerId: userId,
      material,
      stock,
      ref: "Stock correction",
    });
  },
});
