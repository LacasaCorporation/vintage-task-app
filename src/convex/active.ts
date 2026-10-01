import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { jobIdsOf } from "./flagCascade";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * The Active mark.
 *
 * A status says where a piece of work stands; the Active mark answers a
 * different question — what is being worked on right now. It is the same act
 * on a project, a job, a product and a raw material, so one union target and
 * one mutation serve all four: the button in every list is the same button,
 * and one query gathers the lot for the Active list.
 */

/** The four things that can be marked active. */
const activeTarget = v.union(
  v.object({ kind: v.literal("project"), id: v.id("projects") }),
  v.object({ kind: v.literal("job"), id: v.id("projectJobs") }),
  v.object({ kind: v.literal("product"), id: v.id("finishedGoods") }),
  v.object({ kind: v.literal("material"), id: v.id("rawMaterials") }),
);

/**
 * Mark one thing active, or take the mark off again.
 *
 * The mark is owned by the leaf, exactly as the flag is: a product is the
 * thing actually being worked on, and its job and project only carry the work.
 * So a job or project can never be kept back while products still sit inside
 * it (or, for a project, while its jobs do) — that would hide the work itself
 * from every list. Take the mark off the leaves, or delete them, first. In the
 * other direction marking a product active brings its job and project back,
 * so a marked product can never sit inside a hidden parent.
 */
export const setActive = mutation({
  args: { target: activeTarget, active: v.boolean() },
  handler: async (ctx, { target, active }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const mark = { isActive: true, activeAt: Date.now() };
    const clear = { isActive: undefined, activeAt: undefined };
    // each branch is written out so the id stays typed to its own table
    switch (target.kind) {
      case "project": {
        const doc = await ctx.db.get(target.id);
        if (doc === null || doc.ownerId !== userId)
          throw new Error("That project no longer exists.");
        if (!active) await requireNoWorkUnder(ctx, userId, doc._id);
        await ctx.db.patch(target.id, active ? mark : clear);
        return;
      }
      case "job": {
        const doc = await ctx.db.get(target.id);
        if (doc === null || doc.ownerId !== userId)
          throw new Error("That job no longer exists.");
        if (!active) await requireEmptyJob(ctx, userId, doc._id);
        await ctx.db.patch(target.id, active ? mark : clear);
        return;
      }
      case "product": {
        const doc = await ctx.db.get(target.id);
        if (doc === null || doc.ownerId !== userId)
          throw new Error("That product no longer exists.");
        await ctx.db.patch(target.id, active ? mark : clear);
        // a product being worked on cannot sit inside a job and project that
        // have been kept back, so its parents are marked with it
        if (active) await markAncestors(ctx, userId, jobIdsOf(doc), Date.now());
        return;
      }
      case "material": {
        const doc = await ctx.db.get(target.id);
        if (doc === null || doc.ownerId !== userId)
          throw new Error("That material no longer exists.");
        await ctx.db.patch(target.id, active ? mark : clear);
        return;
      }
    }
  },
});

/** Products sitting in this job, active or not. */
async function productsInJob(
  ctx: MutationCtx,
  userId: Id<"users">,
  jobId: Id<"projectJobs">,
): Promise<Doc<"finishedGoods">[]> {
  const products = await ctx.db
    .query("finishedGoods")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  return products.filter((fg) => jobIdsOf(fg).includes(jobId));
}

/** Refuse to keep a job back while products still live inside it. */
async function requireEmptyJob(
  ctx: MutationCtx,
  userId: Id<"users">,
  jobId: Id<"projectJobs">,
): Promise<void> {
  const products = await productsInJob(ctx, userId, jobId);
  if (products.length === 0) return;
  const job = await ctx.db.get(jobId);
  const where = job === null ? "This job" : `“${job.name}”`;
  const active = products.filter((p) => p.isActive === true).length;
  throw new Error(
    `${where} still has ${products.length} product${products.length === 1 ? "" : "s"}${active > 0 ? ` (${active} still active)` : ""}. A job cannot be kept back while products sit in it — delete the products, or take the Active mark off them first.`,
  );
}

/**
 * Refuse to keep a project back while anything still sits under it — its jobs,
 * and the products in them.
 */
async function requireNoWorkUnder(
  ctx: MutationCtx,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<void> {
  const jobs = await ctx.db
    .query("projectJobs")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const mine = jobs.filter((j) => j.ownerId === userId);
  const products: Doc<"finishedGoods">[] = [];
  for (const job of mine) {
    products.push(...(await productsInJob(ctx, userId, job._id)));
  }
  if (mine.length === 0 && products.length === 0) return;
  const project = await ctx.db.get(projectId);
  const where = project === null ? "This project" : `“${project.name}”`;
  const bits: string[] = [];
  if (mine.length > 0)
    bits.push(`${mine.length} job${mine.length === 1 ? "" : "s"}`);
  if (products.length > 0)
    bits.push(
      `${products.length} product${products.length === 1 ? "" : "s"}`,
    );
  throw new Error(
    `${where} still has ${bits.join(" and ")} under it. A project cannot be kept back while work sits in it — delete them, or take the Active mark off them first.`,
  );
}

/** Mark these jobs, and the projects they belong to, active too. */
async function markAncestors(
  ctx: MutationCtx,
  userId: Id<"users">,
  jobIds: Id<"projectJobs">[],
  activeAt: number,
): Promise<void> {
  const mark = { isActive: true, activeAt };
  for (const jid of jobIds) {
    const job = await ctx.db.get(jid);
    if (job === null || job.ownerId !== userId) continue;
    if (job.isActive !== true) await ctx.db.patch(jid, mark);
    const project = await ctx.db.get(job.projectId);
    if (project === null || project.ownerId !== userId) continue;
    if (project.isActive !== true) await ctx.db.patch(job.projectId, mark);
  }
}

/**
 * One-off: mark everything that has no mark yet as active. Active is the
 * default, so records written before that default existed must be brought in
 * line or they would all read as inactive and vanish from every list.
 */
export const backfillActiveDefaults = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    let patched = 0;
    const now = Date.now();
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const row of projects) {
      if (row.isActive === true) continue;
      await ctx.db.patch(row._id, {
        isActive: true,
        activeAt: row.activeAt ?? now,
      });
      patched++;
    }
    const jobs = await ctx.db
      .query("projectJobs")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const row of jobs) {
      if (row.isActive === true) continue;
      await ctx.db.patch(row._id, {
        isActive: true,
        activeAt: row.activeAt ?? now,
      });
      patched++;
    }
    const products = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const row of products) {
      if (row.isActive === true) continue;
      await ctx.db.patch(row._id, {
        isActive: true,
        activeAt: row.activeAt ?? now,
      });
      patched++;
    }
    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const row of materials) {
      if (row.isActive === true) continue;
      await ctx.db.patch(row._id, {
        isActive: true,
        activeAt: row.activeAt ?? now,
      });
      patched++;
    }
    return patched;
  },
});

/** What the Active list shows, one list per kind of thing. */
export type ActiveLists = {
  projects: {
    _id: Id<"projects">;
    name: string;
    code?: string;
    status?: string;
    markedAt: number;
  }[];
  jobs: {
    _id: Id<"projectJobs">;
    name: string;
    code?: string;
    projectName?: string;
    status?: string;
    markedAt: number;
  }[];
  products: {
    _id: Id<"finishedGoods">;
    name: string;
    code?: string;
    jobName?: string;
    projectName?: string;
    stock: number;
    markedAt: number;
  }[];
  materials: {
    _id: Id<"rawMaterials">;
    name: string;
    code?: string;
    unit: string;
    stock: number;
    markedAt: number;
  }[];
};

/** Everything marked active in the firm, newest mark first. */
export const activeWork = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return emptyLists();
    return await collect(ctx, userId, (row) => row.isActive === true);
  },
});

/**
 * Everything whose Active mark has been taken off — the other half of the
 * sidebar's switch. Same four lists, same shape, so the panel reads them the
 * same way; only the test is reversed.
 */
export const inactiveWork = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return emptyLists();
    return await collect(ctx, userId, (row) => row.isActive !== true);
  },
});

function emptyLists(): ActiveLists {
  return { projects: [], jobs: [], products: [], materials: [] };
}

/**
 * The four lists, gathered one way. `keep` says which rows belong in them, so
 * the Active list and the Inactive list cannot drift apart.
 */
async function collect(
  ctx: QueryCtx,
  userId: Id<"users">,
  keep: (row: { isActive?: boolean }) => boolean,
): Promise<ActiveLists> {
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  const jobs = await ctx.db
    .query("projectJobs")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  const products = await ctx.db
    .query("finishedGoods")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  const materials = await ctx.db
    .query("rawMaterials")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();

  // names to hang beside a marked job or product
  const projectName = new Map(projects.map((p) => [p._id, p.name] as const));
  const jobName = new Map(jobs.map((j) => [j._id, j.name] as const));
  const marked = <T extends { isActive?: boolean; activeAt?: number }>(
    rows: T[],
  ) =>
    rows.filter(keep).sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0));

  return {
    projects: marked(projects).map((p) => ({
      _id: p._id,
      name: p.name,
      code: p.code,
      status: p.projectStatus ?? p.status,
      markedAt: p.activeAt ?? 0,
    })),
    jobs: marked(jobs).map((j) => ({
      _id: j._id,
      name: j.name,
      code: j.code,
      projectName: projectName.get(j.projectId),
      status: j.projectStatus ?? j.status,
      markedAt: j.activeAt ?? 0,
    })),
    products: marked(products).map((fg) => {
      const ids = fg.jobIds ?? (fg.jobId !== undefined ? [fg.jobId] : []);
      return {
        _id: fg._id,
        name: fg.name,
        code: fg.code,
        jobName: ids.length > 0 ? jobName.get(ids[0]!) : undefined,
        projectName: fg.projectName,
        stock: fg.stock ?? 0,
        markedAt: fg.activeAt ?? 0,
      };
    }),
    materials: marked(materials).map((m) => ({
      _id: m._id,
      name: m.name,
      code: m.code,
      unit: m.unit,
      stock: m.stock ?? 0,
      markedAt: m.activeAt ?? 0,
    })),
  };
}
