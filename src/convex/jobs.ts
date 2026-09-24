import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const MAX_NAME_LENGTH = 120;

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

/** Mark a job completed. */
export const completeJob = mutation({
  args: { id: v.id("projectJobs") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null || job.ownerId !== userId)
      throw new Error("That job no longer exists.");
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

/** Delete a job. Its products stay (they just lose the job link). */
export const removeJob = mutation({
  args: { id: v.id("projectJobs") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const job = await ctx.db.get(id);
    if (job === null) return;
    if (job.ownerId !== userId) throw new Error("Not your job.");
    // detach any products that point at this job (single or multi-link)
    const fgs = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const fg of fgs) {
      if (fg.jobId === id) {
        const rest = (fg.jobIds ?? []).filter((j) => j !== id);
        await ctx.db.patch(fg._id, {
          jobId: rest[0],
          jobIds: rest.length > 0 ? rest : undefined,
        });
      } else if (fg.jobIds?.includes(id)) {
        const rest = fg.jobIds.filter((j) => j !== id);
        await ctx.db.patch(fg._id, {
          jobIds: rest.length > 0 ? rest : undefined,
          jobId: rest[0],
        });
      }
    }
    await ctx.db.delete(id);
  },
});

/** Delete a project together with all of its jobs (products are detached). */
export const removeJobsOfProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const project = await ctx.db.get(projectId);
    if (project === null) return;
    if (project.ownerId !== userId) throw new Error("Not your project.");
    const jobs = await ctx.db
      .query("projectJobs")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const jobIds = new Set(jobs.map((j) => j._id));
    const fgs = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const fg of fgs) {
      const linked =
        (fg.jobId !== undefined && jobIds.has(fg.jobId)) ||
        fg.jobIds?.some((j) => jobIds.has(j));
      if (linked) {
        const rest = (fg.jobIds ?? []).filter((j) => !jobIds.has(j));
        await ctx.db.patch(fg._id, {
          jobId: rest[0],
          jobIds: rest.length > 0 ? rest : undefined,
        });
      }
    }
    for (const j of jobs) await ctx.db.delete(j._id);
  },
});
