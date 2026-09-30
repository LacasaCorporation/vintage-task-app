import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
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

/** Mark one thing active, or take the mark off again. */
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
        await ctx.db.patch(target.id, active ? mark : clear);
        return;
      }
      case "job": {
        const doc = await ctx.db.get(target.id);
        if (doc === null || doc.ownerId !== userId)
          throw new Error("That job no longer exists.");
        await ctx.db.patch(target.id, active ? mark : clear);
        return;
      }
      case "product": {
        const doc = await ctx.db.get(target.id);
        if (doc === null || doc.ownerId !== userId)
          throw new Error("That product no longer exists.");
        await ctx.db.patch(target.id, active ? mark : clear);
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
  handler: async (ctx): Promise<ActiveLists> => {
    const userId = await scopeUserId(ctx);
    if (userId === null)
      return { projects: [], jobs: [], products: [], materials: [] };

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
      rows
        .filter((row) => row.isActive === true)
        .sort((a, b) => (b.activeAt ?? 0) - (a.activeAt ?? 0));

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
  },
});
