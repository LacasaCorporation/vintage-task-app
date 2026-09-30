import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { scopeUserId } from "./org";

/**
 * What still depends on a material or a product.
 *
 * A master list is a list of names, but the name is already wired into the
 * rest of the books: a material sits on costing lines, arrives on purchase
 * bills and moves through the stock ledger; a product belongs to a project or
 * a job, is invoiced, delivered and moved off the shelf. Deleting one of them
 * out from under those documents is how records stop adding up, so the list
 * asks this module first — it shows a green tick badge on anything in use, and
 * the delete is refused with the reason rather than quietly breaking the books.
 */
export type UsageInfo = { count: number; reasons: string[] };

export type MasterUsage = {
  materials: ({ id: string } & UsageInfo)[];
  products: ({ id: string } & UsageInfo)[];
};

/** Bump a running count in a plain map. */
function bump(map: Map<string, number>, key: string, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function quantity(qty: number, unit: string | undefined) {
  const clean = Number.isInteger(qty) ? qty.toLocaleString() : qty.toFixed(2);
  return unit === undefined || unit === "" ? clean : `${clean} ${unit}`;
}

/**
 * Every reason a material or product cannot simply be deleted, in one pass
 * over the firm's rows.
 */
async function computeUsage(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"users">,
): Promise<{
  materials: Map<string, UsageInfo>;
  products: Map<string, UsageInfo>;
}> {
  const materialReasons = new Map<string, string[]>();
  const productReasons = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, reason: string) => {
    const list = map.get(key) ?? [];
    list.push(reason);
    map.set(key, list);
  };

  // ── materials ─────────────────────────────────────────────────────────

  // recipes: one line per material on a costing sheet
  const materialLines = new Map<string, number>();
  for (const item of await ctx.db
    .query("costingItems")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    if (item.materialId === undefined) continue;
    bump(materialLines, item.materialId);
  }
  for (const [id, n] of materialLines) {
    add(materialReasons, id, `used in ${plural(n, "costing line")}`);
  }

  // purchase bills that bought it
  const purchaseBills = new Map<string, number>();
  for (const purchase of await ctx.db
    .query("purchases")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    for (const line of purchase.lines) bump(purchaseBills, line.materialId);
  }
  for (const [id, n] of purchaseBills) {
    add(materialReasons, id, `bought on ${plural(n, "purchase bill")}`);
  }

  // and anything that has moved through its stock ledger
  const materialMoves = new Map<string, number>();
  for (const row of await ctx.db
    .query("stockMovements")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    bump(materialMoves, row.materialId);
  }
  for (const [id, n] of materialMoves) {
    add(materialReasons, id, `moved in stock ${plural(n, "time")}`);
  }

  for (const material of await ctx.db
    .query("rawMaterials")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    if ((material.stock ?? 0) !== 0) {
      add(
        materialReasons,
        material._id,
        `holding ${quantity(material.stock ?? 0, material.unit)} in stock`,
      );
    }
    if ((material.opening ?? 0) !== 0) {
      add(
        materialReasons,
        material._id,
        `an opening balance of ${quantity(material.opening ?? 0, material.unit)}`,
      );
    }
  }

  // ── products ──────────────────────────────────────────────────────────

  // which project or job each product is attached to, for a readable reason
  const jobLabel = new Map<string, string>();
  for (const job of await ctx.db
    .query("projectJobs")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    jobLabel.set(job._id, job.code ?? job.name);
  }

  const salesLines = new Map<string, number>();
  for (const sale of await ctx.db
    .query("sales")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    for (const line of sale.lines) bump(salesLines, line.productId);
  }
  for (const [id, n] of salesLines) {
    add(productReasons, id, `invoiced on ${plural(n, "sales bill")}`);
  }

  const quoteLines = new Map<string, number>();
  for (const quote of await ctx.db
    .query("quotations")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    for (const line of quote.lines) bump(quoteLines, line.productId);
  }
  for (const [id, n] of quoteLines) {
    add(productReasons, id, `quoted on ${plural(n, "quotation")}`);
  }

  const noteLines = new Map<string, number>();
  for (const note of await ctx.db
    .query("deliveryNotes")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    for (const line of note.lines) bump(noteLines, line.productId);
  }
  for (const [id, n] of noteLines) {
    add(productReasons, id, `delivered on ${plural(n, "delivery note")}`);
  }

  const productMoves = new Map<string, number>();
  for (const row of await ctx.db
    .query("productMovements")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    bump(productMoves, row.productId);
  }
  for (const [id, n] of productMoves) {
    add(productReasons, id, `moved in stock ${plural(n, "time")}`);
  }

  for (const fg of await ctx.db
    .query("finishedGoods")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect()) {
    const jobIds = fg.jobIds ?? (fg.jobId !== undefined ? [fg.jobId] : []);
    if (jobIds.length > 0) {
      const label = jobLabel.get(jobIds[0]!) ?? "a job";
      add(productReasons, fg._id, `attached to job “${label}”`);
    } else if (fg.projectName !== undefined && fg.projectName !== "") {
      add(productReasons, fg._id, `grouped under project “${fg.projectName}”`);
    }
    if ((fg.stock ?? 0) !== 0) {
      add(
        productReasons,
        fg._id,
        `holding ${quantity(fg.stock ?? 0, fg.unit)} in stock`,
      );
    }
    if ((fg.inProduction ?? 0) !== 0) {
      add(
        productReasons,
        fg._id,
        `${quantity(fg.inProduction ?? 0, fg.unit)} in production`,
      );
    }
    if (fg.productionStartedAt !== undefined) {
      add(productReasons, fg._id, "in production right now");
    }
  }

  const wrap = (reasons: Map<string, string[]>) => {
    const out = new Map<string, UsageInfo>();
    for (const [id, list] of reasons) {
      out.set(id, { count: list.length, reasons: list });
    }
    return out;
  };
  return { materials: wrap(materialReasons), products: wrap(productReasons) };
}

/** Every material and product that is still depended on, for the master lists. */
export const masterUsage = query({
  args: {},
  handler: async (ctx): Promise<MasterUsage> => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return { materials: [], products: [] };
    const { materials, products } = await computeUsage(ctx, orgId);
    return {
      materials: [...materials].map(([id, info]) => ({ id, ...info })),
      products: [...products].map(([id, info]) => ({ id, ...info })),
    };
  },
});

/** The one message every refused delete uses. */
function refusal(what: string, name: string, reasons: string[]): Error {
  return new Error(
    `“${name}” can't be deleted — it is ${reasons.join(", ")}. Remove it from those documents first, then delete this ${what}.`,
  );
}

/** Refuse to delete a material that documents still depend on. */
export async function requireUnusedMaterial(
  ctx: MutationCtx,
  orgId: Id<"users">,
  materialId: string,
  name: string,
): Promise<void> {
  const { materials } = await computeUsage(ctx, orgId);
  const usage = materials.get(materialId);
  if (usage === undefined) return;
  throw refusal("material", name, usage.reasons);
}

/** Refuse to delete a product that documents, a project or stock still need. */
export async function requireUnusedProduct(
  ctx: MutationCtx,
  orgId: Id<"users">,
  productId: string,
  name: string,
): Promise<void> {
  const { products } = await computeUsage(ctx, orgId);
  const usage = products.get(productId);
  if (usage === undefined) return;
  throw refusal("product", name, usage.reasons);
}
