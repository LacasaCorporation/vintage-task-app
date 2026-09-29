import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import {
  clearAncestorsIfOrphaned,
  flagAncestors,
  jobHasFlaggedProduct,
  jobIdsOf,
} from "./flagCascade";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
} from "../lib/project-statuses";

const MAX_NAME_LENGTH = 120;

/** A product counts as finished once it is ticked off or moved to Finish. */
export function isProductDone(f: Doc<"finishedGoods">): boolean {
  return f.isCompleted === true || f.projectStatus === PROJECT_STATUS_FINISH;
}

/** Every product attached to a job, by either the link table or the old field. */
export async function productsOfJob(
  ctx: MutationCtx | QueryCtx,
  orgId: Id<"users">,
  jobId: Id<"projectJobs">,
): Promise<Doc<"finishedGoods">[]> {
  const links = await ctx.db
    .query("jobProducts")
    .withIndex("by_job", (q) => q.eq("jobId", jobId))
    .collect();
  const linked = new Set(links.map((l) => l.fgId));
  const all = await ctx.db
    .query("finishedGoods")
    .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
    .collect();
  return all.filter(
    (f) =>
      linked.has(f._id) ||
      f.jobId === jobId ||
      (f.jobIds ?? []).includes(jobId),
  );
}

/** The products of a job that are not finished yet — a job cannot be. */
export async function openProductsOfJob(
  ctx: MutationCtx | QueryCtx,
  orgId: Id<"users">,
  jobId: Id<"projectJobs">,
): Promise<Doc<"finishedGoods">[]> {
  return (await productsOfJob(ctx, orgId, jobId)).filter((f) => !isProductDone(f));
}

/** "WARDBROBE, BED and 2 more" — short enough to read inside an error toast. */
function nameSome(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/** The one message both routes to finishing a job with work still open. */
async function assertJobProductsDone(
  ctx: MutationCtx,
  orgId: Id<"users">,
  jobId: Id<"projectJobs">,
): Promise<void> {
  const open = await openProductsOfJob(ctx, orgId, jobId);
  if (open.length === 0) return;
  throw new Error(
    `${open.length} product${open.length === 1 ? " is" : "s are"} still not finished (${nameSome(
      open.map((f) => f.name),
    )}). Finish the products first, then the job.`,
  );
}

const JOB_STATUSES = [
  "planning",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
] as const;
type JobStatus = (typeof JOB_STATUSES)[number];

function normalizeStatus(status: string | undefined): JobStatus | undefined {
  if (status === undefined) return undefined;
  const clean = status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (JOB_STATUSES as readonly string[]).includes(clean)
    ? (clean as JobStatus)
    : undefined;
}

/** Next sequential job code for the owner, e.g. "JB0007". */
async function nextJobCode(
  ctx: MutationCtx,
  ownerId: Id<"users">,
): Promise<string> {
  let max = 0;
  const jobs = await ctx.db
    .query("projectJobs")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  for (const j of jobs) {
    if (typeof j.code !== "string" || !j.code.startsWith("JB")) continue;
    const n = Number.parseInt(j.code.slice(2), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `JB${String(max + 1).padStart(4, "0")}`;
}

async function assertOwnedProject(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  projectId: Id<"projects">,
) {
  const project = await ctx.db.get(projectId);
  if (project === null || project.ownerId !== ownerId)
    throw new Error("That project no longer exists.");
  return project;
}

/** All jobs for the user, grouped client-side by projectId by the caller. */
export const listJobs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const jobs = await ctx.db
      .query("projectJobs")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return jobs.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Jobs of one project, due date first. */
export const listProjectJobs = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const jobs = await ctx.db
      .query("projectJobs")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    return jobs
      .filter((j) => j.ownerId === userId)
      .sort((a, b) => {
        if (a.dueAt !== undefined && b.dueAt !== undefined && a.dueAt !== b.dueAt)
          return a.dueAt - b.dueAt;
        if (a.dueAt !== undefined) return -1;
        if (b.dueAt !== undefined) return 1;
        return a.name.localeCompare(b.name);
      });
  },
});

/** Create a job under a project; JB code auto-assigned. */
export const addJob = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    description: v.optional(v.string()),
    assignee: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    status: v.optional(v.string()),
    priority: v.optional(
      v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    ),
  },
  handler: async (ctx, opts) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await assertOwnedProject(ctx, userId, opts.projectId);
    const name = opts.name.trim();
    if (name.length === 0) throw new Error("Give the job a name.");
    const code = await nextJobCode(ctx, userId);
    return await ctx.db.insert("projectJobs", {
      ownerId: userId,
      projectId: opts.projectId,
      name: name.slice(0, MAX_NAME_LENGTH),
      code,
      description: opts.description?.trim().slice(0, 2000) || undefined,
      assignee: opts.assignee?.trim().slice(0, 120) || undefined,
      dueAt: opts.dueAt,
      status: normalizeStatus(opts.status) ?? "planning",
      priority: opts.priority,
    });
  },
});

/** Update any of a job's details. */
export const updateJob = mutation({
  args: {
    id: v.id("projectJobs"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    assignee: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    status: v.optional(v.string()),
    priority: v.optional(
      v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    ),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId)
      throw new Error("That job no longer exists.");
    const clean: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length === 0) throw new Error("Give the job a name.");
      clean.name = name.slice(0, MAX_NAME_LENGTH);
    }
    if (patch.description !== undefined)
      clean.description = patch.description.trim().slice(0, 2000) || undefined;
    if (patch.assignee !== undefined)
      clean.assignee = patch.assignee.trim().slice(0, 120) || undefined;
    if (patch.dueAt !== undefined) clean.dueAt = patch.dueAt;
    if (patch.status !== undefined) clean.status = normalizeStatus(patch.status);
    if (patch.priority !== undefined) clean.priority = patch.priority;
    await ctx.db.patch(id, clean);
  },
});

/** Move a job to an ordered custom Projects status. */
export const setJobProjectStatus = mutation({
  args: { id: v.id("projectJobs"), status: v.string() },
  handler: async (ctx, { id, status }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId)
      throw new Error("That job no longer exists.");
    const clean = status.trim().replace(/\s+/g, " ");
    if (!clean) throw new Error("Choose a status.");
    const isFinish = clean === PROJECT_STATUS_FINISH;
    const isStart = clean === PROJECT_STATUS_START;
    if (isFinish) await assertJobProductsDone(ctx, userId, id);
    await ctx.db.patch(id, {
      projectStatus: clean,
      status: isFinish ? "completed" : isStart ? "planning" : "in_progress",
      completedAt: isFinish ? job.completedAt ?? Date.now() : undefined,
      pausedAt: undefined,
    });
  },
});

/** Pause a job (work on it stops, but it isn't finished). */
export const pauseJob = mutation({
  args: { id: v.id("projectJobs") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId)
      throw new Error("That job no longer exists.");
    if (job.status === "completed" || job.status === "cancelled")
      throw new Error("This job is already closed.");
    await ctx.db.patch(id, { status: "paused", pausedAt: Date.now() });
  },
});

/** Resume a paused job. */
export const resumeJob = mutation({
  args: { id: v.id("projectJobs") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId)
      throw new Error("That job no longer exists.");
    if (job.status !== "paused")
      throw new Error("Only a paused job can be resumed.");
    await ctx.db.patch(id, {
      status: "in_progress",
      pausedAt: undefined,
      startedAt: job.startedAt ?? Date.now(),
    });
  },
});

/** Mark a job completed — refused while any of its products is still open. */
export const completeJob = mutation({
  args: { id: v.id("projectJobs") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId)
      throw new Error("That job no longer exists.");
    await assertJobProductsDone(ctx, userId, id);
    await ctx.db.patch(id, {
      status: "completed",
      completedAt: Date.now(),
      pausedAt: undefined,
    });
  },
});

/** Reopen a completed or cancelled job. */
export const reopenJob = mutation({
  args: { id: v.id("projectJobs") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId)
      throw new Error("That job no longer exists.");
    await ctx.db.patch(id, {
      status: "in_progress",
      completedAt: undefined,
      pausedAt: undefined,
      startedAt: job.startedAt ?? Date.now(),
    });
  },
});

/**
 * Flag (or unflag) a job. Flagging cascades down to every product attached to
 * the job and up to the job's project, so the whole branch shows in the
 * Productions view. Unflagging is refused while any of those products is still
 * flagged — the leaf owns the flag, and its job and project keep theirs until
 * the product clears it.
 */
export const setJobFlag = mutation({
  args: { id: v.id("projectJobs"), flagged: v.boolean() },
  handler: async (ctx, { id, flagged }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId)
      throw new Error("That job no longer exists.");

    if (!flagged && (await jobHasFlaggedProduct(ctx, userId, id)))
      throw new Error(
        "This job still has a flagged product — remove the flag from the product first.",
      );

    const flaggedAt = flagged ? Date.now() : undefined;
    await ctx.db.patch(id, {
      isFlagged: flagged || undefined,
      flaggedAt,
      // snapshot for products to inherit when flagged
      fgDueAt: job.dueAt,
      fgPriority: job.priority,
    });

    if (flagged) {
      // cascade down to every product attached to this job (single or multi-link)
      const fgs = await ctx.db
        .query("finishedGoods")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      for (const fg of fgs) {
        if (!jobIdsOf(fg).includes(id)) continue;
        await ctx.db.patch(fg._id, {
          isFlagged: true,
          flaggedAt,
          // products inherit the job's due date & priority so board cards and
          // details start in sync (they can be edited per product afterwards)
          dueAt: job.fgDueAt ?? job.dueAt,
          priority: job.fgPriority ?? job.priority,
          // a newly flagged product starts its life as "Listed"
          ...(fg.projectStatus === undefined
            ? { projectStatus: PROJECT_STATUS_START }
            : {}),
        });
      }
      // cascade up to the project this job belongs to
      await flagAncestors(ctx, userId, [id], Date.now());
    } else {
      // nothing flagged is left under this job, so the project may drop too
      await clearAncestorsIfOrphaned(ctx, userId, [id]);
    }
  },
});

/**
 * Delete a job. Products are the first level of the delete order, so a job
 * only goes once every product inside it has been deleted.
 */
export const removeJob = mutation({
  args: { id: v.id("projectJobs") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null) return;
    if (job.ownerId !== userId) throw new Error("Not your job.");
    const fgs = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const linked = fgs.filter(
      (fg) => fg.jobId === id || (fg.jobIds ?? []).includes(id),
    );
    if (linked.length > 0)
      throw new Error(
        `This job still has ${linked.length} product${linked.length === 1 ? "" : "s"}. Delete the products first, then the job.`,
      );
    await ctx.db.delete(id);
  },
});

