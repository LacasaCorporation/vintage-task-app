import { mutation, query } from "./_generated/server";
import { requireItem } from "./authorize";
import { scopeUserId } from "./org";
import { postBill, postBillPayment, reverseEntry } from "./ledger";
import { defaultTaxPct } from "./accountingDefaults";
import { setStockTo, stockIn, stockOut } from "./stock";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { blendedRate, cleanRate, priceTaxedLines } from "../lib/line-tax";

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
    /** The goods-received voucher this bill settles, if any. */
    grvId: v.optional(v.id("grvs")),
    lines: v.array(
      v.object({
        materialId: v.id("rawMaterials"),
        qty: v.number(),
        unitCost: v.number(),
        /** This line's own rate; absent falls back to the material's. */
        taxPct: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    // `taxPct` stays in the validator for older callers, but the tax on this
    // bill is now decided by the lines; the rate stored on the document is the
    // blend of what they add up to.
    const { supplier, supplierId, supplierAddress, purchasedAt, dueAt, note, currency, discountPct, lines } = args;
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

    // A received voucher has already put its goods into stock, so a bill
    // raised from one pays for them — it must not count them in a second time.
    let grv: Doc<"grvs"> | null = null;
    if (args.grvId !== undefined) {
      grv = await ctx.db.get(args.grvId);
      if (grv === null || grv.ownerId !== userId) {
        throw new Error("That receipt no longer exists.");
      }
      if (grv.billId !== undefined) {
        throw new Error(`${grv.number} has already been billed.`);
      }
    }
    const skipStock = grv !== null && grv.status === "received";

    const number = await nextPurchaseNumber(ctx, userId);
    const at = purchasedAt ?? Date.now();
    const resolved = [];
    for (const line of lines) {
      const material = await ctx.db.get(line.materialId);
      if (material === null) throw new Error("A material on this bill no longer exists.");
      if (material.ownerId !== userId) throw new Error("That material belongs to another workspace.");
      if (line.qty <= 0) throw new Error(`Quantity for “${material.name}” must be more than zero.`);
      if (line.unitCost < 0) throw new Error("Unit cost can't be negative.");
      // The rate is fixed onto the line here, so it never moves afterwards —
      // what the supplier charged is what the bill and the ledger record.
      // A material with no rate of its own is charged no tax: the workspace
      // default is not applied to a line that never asked for it.
      const rate = cleanRate(line.taxPct ?? material.purchaseTaxPct ?? 0);
      resolved.push({
        materialId: material._id,
        name: material.name,
        unit: material.unit,
        qty: line.qty,
        unitCost: line.unitCost,
        // 0 is stored as 0: this line is exempt, which is a different thing
        // from having no rate on file
        taxPct: rate,
      });
      // stock in, logged as income against this bill — unless a received
      // voucher already brought these very goods in, which it did
      if (!skipStock) {
        await stockIn(ctx, {
          ownerId: userId,
          material,
          qty: line.qty,
          source: "purchase",
          ref: number,
          at,
        });
      }
    }

    const cleanSupplier = (supplier ?? "").trim().slice(0, MAX_NAME_LENGTH);
    const discount = Math.min(100, Math.max(0, discountPct ?? 0));
    // priced from the lines, each at its own rate, by the same code the form runs
    const priced = priceTaxedLines(resolved, discount);
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
      taxPct: blendedRate(priced.net, priced.tax) || undefined,
      lines: resolved,
      total: priced.grand,
      taxAmount: priced.tax || undefined,
      isPaid: undefined,
      lpoId: args.lpoId,
      grvId: grv?._id,
      stockFromGrv: grv !== null ? skipStock : undefined,
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
    // a voucher is marked billed rather than received — the goods came in when
    // it was received, and all this bill does is pay for them
    if (grv !== null) {
      await ctx.db.patch(grv._id, { billId: purchaseId });
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
        /** This line's own rate; absent falls back to the material's. */
        taxPct: v.optional(v.number()),
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
    // A bill raised from a received voucher never moved stock, because the
    // voucher had already brought those goods in. Editing it must leave stock
    // alone too, or the same delivery would be counted in a second time.
    const skipStock = bill.stockFromGrv === true;
    for (const line of previous) {
      const material = await ctx.db.get(line.materialId);
      if (material === null || material.ownerId !== userId) continue;
      // an edited bill is a correction, not new income
      if (!skipStock) {
        await stockOut(ctx, {
          ownerId: userId,
          material,
          qty: line.qty,
          source: "adjustment",
          ref: `${bill.number} (edited)`,
          at: args.purchasedAt ?? bill.purchasedAt,
        });
      }
      await ctx.db.delete(line._id);
    }

    const resolved = [];
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
        // an edited line keeps the rate it was billed at unless the bill says
        // otherwise; the material's current rate is the fallback, and no rate
        // at all means no tax
        taxPct: cleanRate(line.taxPct ?? material.purchaseTaxPct ?? 0),
      };
      resolved.push(stored);
      await ctx.db.insert("purchaseLines", { ownerId: userId, purchaseId: id, ...stored });
      if (!skipStock) {
        await stockIn(ctx, {
          ownerId: userId,
          material,
          qty: line.qty,
          source: "purchase",
          ref: bill.number,
          at: args.purchasedAt ?? bill.purchasedAt,
        });
      }
    }

    const supplier = (args.supplier ?? "").trim().slice(0, MAX_NAME_LENGTH);
    const discount = Math.min(100, Math.max(0, args.discountPct ?? 0));
    const priced = priceTaxedLines(resolved, discount);
    await ctx.db.patch(id, {
      supplier: supplier || undefined,
      supplierId: args.supplierId,
      supplierAddress: (args.supplierAddress ?? "").trim().slice(0, 240) || undefined,
      purchasedAt: args.purchasedAt ?? bill.purchasedAt,
      dueAt: args.dueAt,
      note: (args.note ?? "").trim().slice(0, 500) || undefined,
      currency: (args.currency ?? "").trim().slice(0, 8) || undefined,
      discountPct: discount || undefined,
      taxPct: blendedRate(priced.net, priced.tax) || undefined,
      lines: resolved,
      total: priced.grand,
      taxAmount: priced.tax || undefined,
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
    // the voucher it paid for is open to be billed again — unlike an order, a
    // voucher is not reopened, because its goods stayed in stock
    if (bill.grvId !== undefined) {
      const grv = await ctx.db.get(bill.grvId);
      if (grv !== null && grv.ownerId === userId) {
        await ctx.db.patch(bill.grvId, { billId: undefined });
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
        // a bill raised from a received voucher never brought its goods in,
        // so deleting it must not take them back out
        if (material !== null && material.ownerId === userId && bill.stockFromGrv !== true) {
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
