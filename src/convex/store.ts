/**
 * Store module backend.
 *
 * Issue vouchers  — move raw materials from the store to the factory against
 *                   a budgeted product, recording them as WIP.
 * Receipt vouchers — receive finished products from the factory into the
 *                    finished-goods store once production is complete.
 *
 * Both write movements through the existing `stock.ts` / `productStock.ts`
 * helpers, so the ledger and the on-hand figures are always consistent.
 */

import { mutation, query, type MutationCtx } from "./_generated/server";
import { scopeUserId } from "./org";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { stockOut, stockIn } from "./stock";
import { produceStock } from "./productStock";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Auto-increment: scan all vouchers, find the highest N, return N+1. */
async function nextNumber(
  ctx: MutationCtx,
  table: "storeIssues" | "storeReceipts",
  prefix: "SI" | "SR",
  ownerId: Id<"users">,
): Promise<string> {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_owner", (q: any) => q.eq("ownerId", ownerId))
    .collect();
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.number.replace(prefix, ""), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// ─── Issue vouchers ─────────────────────────────────────────────────────────

/** List all store issue vouchers, newest first. */
export const listIssues = query({
  args: {},
  handler: async (ctx): Promise<Doc<"storeIssues">[]> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) return [];
    const rows = await ctx.db
      .query("storeIssues")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return rows.sort((a, b) => b.issuedAt - a.issuedAt);
  },
});

/** List issue vouchers for a specific product. */
export const listIssuesByFg = query({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }): Promise<Doc<"storeIssues">[]> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) return [];
    const rows = await ctx.db
      .query("storeIssues")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();
    return rows
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => b.issuedAt - a.issuedAt);
  },
});

/** Create a draft store issue. */
export const createIssue = mutation({
  args: {
    issuedAt: v.number(),
    fgId: v.optional(v.id("finishedGoods")),
    fgName: v.optional(v.string()),
    jobId: v.optional(v.id("projectJobs")),
    jobName: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    projectName: v.optional(v.string()),
    note: v.optional(v.string()),
    issuedBy: v.optional(v.string()),
    lines: v.array(
      v.object({
        materialId: v.id("rawMaterials"),
        name: v.string(),
        unit: v.string(),
        budgetedQty: v.optional(v.number()),
        qty: v.number(),
        unitCost: v.number(),
      }),
    ),
    total: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"storeIssues">> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage store.");
    const number = await nextNumber(ctx, "storeIssues", "SI", ownerId);
    return await ctx.db.insert("storeIssues", {
      ownerId,
      number,
      status: "draft",
      ...args,
    });
  },
});

/** Update a draft issue (lines / dates). Cannot edit issued vouchers. */
export const updateIssue = mutation({
  args: {
    issueId: v.id("storeIssues"),
    issuedAt: v.optional(v.number()),
    fgId: v.optional(v.id("finishedGoods")),
    fgName: v.optional(v.string()),
    jobId: v.optional(v.id("projectJobs")),
    jobName: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    projectName: v.optional(v.string()),
    note: v.optional(v.string()),
    issuedBy: v.optional(v.string()),
    lines: v.optional(
      v.array(
        v.object({
          materialId: v.id("rawMaterials"),
          name: v.string(),
          unit: v.string(),
          budgetedQty: v.optional(v.number()),
          qty: v.number(),
          unitCost: v.number(),
        }),
      ),
    ),
    total: v.optional(v.number()),
  },
  handler: async (ctx, { issueId, ...patch }): Promise<void> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage store.");
    const doc = await ctx.db.get(issueId);
    if (doc === null || doc.ownerId !== ownerId)
      throw new Error("Issue not found.");
    if (doc.status !== "draft")
      throw new Error("Only draft vouchers can be edited.");
    await ctx.db.patch(issueId, patch as Partial<Doc<"storeIssues">>);
  },
});

/**
 * Dispatch a draft issue: move raw materials out of store into WIP.
 * Writes a `production` stock-out movement for every line, marking the
 * materials as consumed in production.
 */
export const dispatchIssue = mutation({
  args: { issueId: v.id("storeIssues") },
  handler: async (ctx, { issueId }): Promise<void> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage store.");
    const doc = await ctx.db.get(issueId);
    if (doc === null || doc.ownerId !== ownerId)
      throw new Error("Issue not found.");
    if (doc.status !== "draft") throw new Error("Voucher already dispatched.");

    const ref = [doc.fgName, doc.jobName].filter(Boolean).join(" / ") || doc.number;

    for (const line of doc.lines) {
      const material = await ctx.db.get(line.materialId);
      if (material === null || material.ownerId !== ownerId) continue;
      await stockOut(ctx, {
        ownerId,
        material,
        qty: line.qty,
        source: "production",
        ref,
        at: doc.issuedAt,
      });
    }

    await ctx.db.patch(issueId, { status: "issued" });
  },
});

/** Reverse a dispatched issue: put the materials back in store. */
export const reverseIssue = mutation({
  args: { issueId: v.id("storeIssues") },
  handler: async (ctx, { issueId }): Promise<void> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage store.");
    const doc = await ctx.db.get(issueId);
    if (doc === null || doc.ownerId !== ownerId)
      throw new Error("Issue not found.");
    if (doc.status !== "issued") throw new Error("Only issued vouchers can be reversed.");

    const ref = `Reversal of ${doc.number}`;

    for (const line of doc.lines) {
      const material = await ctx.db.get(line.materialId);
      if (material === null || material.ownerId !== ownerId) continue;
      await stockIn(ctx, {
        ownerId,
        material,
        qty: line.qty,
        source: "production-return",
        ref,
        at: Date.now(),
      });
    }

    await ctx.db.patch(issueId, { status: "cancelled" });
  },
});

/** Delete a draft issue (no stock movements to undo). */
export const deleteIssue = mutation({
  args: { issueId: v.id("storeIssues") },
  handler: async (ctx, { issueId }): Promise<void> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage store.");
    const doc = await ctx.db.get(issueId);
    if (doc === null || doc.ownerId !== ownerId)
      throw new Error("Issue not found.");
    if (doc.status === "issued")
      throw new Error("Reverse the voucher before deleting it.");
    await ctx.db.delete(issueId);
  },
});

// ─── Receipt vouchers ────────────────────────────────────────────────────────

/** List all store receipts, newest first. */
export const listReceipts = query({
  args: {},
  handler: async (ctx): Promise<Doc<"storeReceipts">[]> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) return [];
    const rows = await ctx.db
      .query("storeReceipts")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return rows.sort((a, b) => b.receivedAt - a.receivedAt);
  },
});

/** List receipts for a specific product. */
export const listReceiptsByFg = query({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }): Promise<Doc<"storeReceipts">[]> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) return [];
    const rows = await ctx.db
      .query("storeReceipts")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();
    return rows
      .filter((r) => r.ownerId === ownerId)
      .sort((a, b) => b.receivedAt - a.receivedAt);
  },
});

/** Create a draft store receipt (factory → finished goods store). */
export const createReceipt = mutation({
  args: {
    receivedAt: v.number(),
    fgId: v.id("finishedGoods"),
    fgName: v.string(),
    jobId: v.optional(v.id("projectJobs")),
    jobName: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    projectName: v.optional(v.string()),
    note: v.optional(v.string()),
    receivedBy: v.optional(v.string()),
    budgetedQty: v.optional(v.number()),
    qty: v.number(),
    unit: v.optional(v.string()),
    unitCost: v.optional(v.number()),
    total: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"storeReceipts">> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage store.");
    const number = await nextNumber(ctx, "storeReceipts", "SR", ownerId);
    return await ctx.db.insert("storeReceipts", {
      ownerId,
      number,
      status: "draft",
      ...args,
    });
  },
});

/** Update a draft receipt. */
export const updateReceipt = mutation({
  args: {
    receiptId: v.id("storeReceipts"),
    receivedAt: v.optional(v.number()),
    jobId: v.optional(v.id("projectJobs")),
    jobName: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    projectName: v.optional(v.string()),
    note: v.optional(v.string()),
    receivedBy: v.optional(v.string()),
    budgetedQty: v.optional(v.number()),
    qty: v.optional(v.number()),
    unit: v.optional(v.string()),
    unitCost: v.optional(v.number()),
    total: v.optional(v.number()),
  },
  handler: async (ctx, { receiptId, ...patch }): Promise<void> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage store.");
    const doc = await ctx.db.get(receiptId);
    if (doc === null || doc.ownerId !== ownerId)
      throw new Error("Receipt not found.");
    if (doc.status !== "draft")
      throw new Error("Only draft receipts can be edited.");
    await ctx.db.patch(receiptId, patch as Partial<Doc<"storeReceipts">>);
  },
});

/**
 * Confirm a store receipt: add the finished units to finished-goods stock.
 * Writes a `production` product-movement, exactly as a normal production run
 * finish does, so the product ledger stays consistent.
 */
export const confirmReceipt = mutation({
  args: { receiptId: v.id("storeReceipts") },
  handler: async (ctx, { receiptId }): Promise<void> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage store.");
    const doc = await ctx.db.get(receiptId);
    if (doc === null || doc.ownerId !== ownerId)
      throw new Error("Receipt not found.");
    if (doc.status !== "draft") throw new Error("Receipt already confirmed.");

    const product = await ctx.db.get(doc.fgId);
    if (product === null || product.ownerId !== ownerId)
      throw new Error("Product not found.");

    const ref = [doc.fgName, doc.jobName].filter(Boolean).join(" / ") || doc.number;
    await produceStock(ctx, {
      ownerId,
      product,
      qty: doc.qty,
      ref,
    });

    await ctx.db.patch(receiptId, {
      status: "received",
      movementRef: ref,
    });
  },
});

/** Delete a draft receipt. */
export const deleteReceipt = mutation({
  args: { receiptId: v.id("storeReceipts") },
  handler: async (ctx, { receiptId }): Promise<void> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) throw new Error("Sign in to manage store.");
    const doc = await ctx.db.get(receiptId);
    if (doc === null || doc.ownerId !== ownerId)
      throw new Error("Receipt not found.");
    if (doc.status === "received")
      throw new Error("Cannot delete a confirmed receipt.");
    await ctx.db.delete(receiptId);
  },
});

// ─── Summary queries ─────────────────────────────────────────────────────────

export type StoreIssueSummary = {
  totalIssued: number;
  draftCount: number;
  issuedCount: number;
};

export type StoreReceiptSummary = {
  totalReceived: number;
  draftCount: number;
  receivedCount: number;
};

/** Quick totals for the store dashboard. */
export const summary = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ issues: StoreIssueSummary; receipts: StoreReceiptSummary }> => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null)
      return {
        issues: { totalIssued: 0, draftCount: 0, issuedCount: 0 },
        receipts: { totalReceived: 0, draftCount: 0, receivedCount: 0 },
      };

    const issues = await ctx.db
      .query("storeIssues")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();

    const receipts = await ctx.db
      .query("storeReceipts")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();

    return {
      issues: {
        totalIssued: issues
          .filter((i) => i.status === "issued")
          .reduce((s, i) => s + i.total, 0),
        draftCount: issues.filter((i) => i.status === "draft").length,
        issuedCount: issues.filter((i) => i.status === "issued").length,
      },
      receipts: {
        totalReceived: receipts.filter((r) => r.status === "received").length,
        draftCount: receipts.filter((r) => r.status === "draft").length,
        receivedCount: receipts.filter((r) => r.status === "received").length,
      },
    };
  },
});

/** Options needed by the store issue & receipt modals. */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) {
      return { products: [], projects: [], jobs: [] };
    }
    const [products, projects, jobs] = await Promise.all([
      ctx.db
        .query("finishedGoods")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .collect(),
      ctx.db
        .query("projects")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .collect(),
      ctx.db
        .query("projectJobs")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .collect(),
    ]);

    return {
      products: products.map((p) => ({
        id: p._id,
        name: p.name,
        code: p.code,
        unit: p.unit,
        stock: p.stock ?? 0,
        inProduction: p.inProduction ?? 0,
        qty: p.qty ?? 1,
        projectName: p.projectName,
        jobIds: p.jobIds ?? (p.jobId ? [p.jobId] : []),
      })),
      projects: projects.map((pr) => ({
        id: pr._id,
        name: pr.name,
        code: pr.code,
      })),
      jobs: jobs.map((j) => ({
        id: j._id,
        projectId: j.projectId,
        name: j.name,
        code: j.code,
      })),
    };
  },
});

/** Return budgeted raw materials for an FG product based on its costing sheet. */
export const getBudgetedMaterials = query({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }) => {
    const ownerId = await scopeUserId(ctx);
    if (ownerId === null) return [];
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();

    const result = [];
    for (const item of items) {
      if (!item.materialId) continue;
      const mat = await ctx.db.get(item.materialId);
      result.push({
        materialId: item.materialId,
        name: mat?.name ?? item.label,
        unit: item.unit ?? mat?.unit ?? "pcs",
        budgetedQty: item.qty,
        qty: item.qty,
        unitCost: item.unitPrice ?? mat?.pricePerUnit ?? 0,
        currentStock: mat?.stock ?? 0,
      });
    }
    return result;
  },
});

