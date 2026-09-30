import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { isFlaggedProjectWork } from "../lib/project-work";

/**
 * The flag hierarchy, in one place.
 *
 * A flag is owned by the leaf. Flagging a product turns the flag on for its
 * job and for that job's project, and a parent keeps the flag for as long as
 * anything under it is still flagged — so a job or project can never be
 * unflagged out from under a flagged product. When the last flagged product
 * goes, the parents that were only flagged because of it drop with it.
 *
 * These are plain functions, not registered handlers, so both `costing` and
 * `jobs` can use them without importing each other.
 */

type Ctx = MutationCtx;

/** Every job a product belongs to — products moved to a single or multi link. */
export function jobIdsOf(
  fg: Pick<Doc<"finishedGoods">, "jobId" | "jobIds">,
): Id<"projectJobs">[] {
  if (fg.jobIds !== undefined && fg.jobIds.length > 0) return [...fg.jobIds];
  return fg.jobId !== undefined ? [fg.jobId] : [];
}

/** The project records the given jobs belong to, skipping any that are gone. */
export async function projectIdsOfJobs(
  ctx: Ctx,
  userId: Id<"users">,
  jobIds: Id<"projectJobs">[],
): Promise<Id<"projects">[]> {
  const out: Id<"projects">[] = [];
  for (const jid of jobIds) {
    const job = await ctx.db.get(jid);
    if (job === null || job.ownerId !== userId) continue;
    if (!out.includes(job.projectId)) out.push(job.projectId);
  }
  return out;
}

/** Products belonging to the caller that are currently flagged. */
async function flaggedProducts(ctx: Ctx, userId: Id<"users">) {
  const all = await ctx.db
    .query("finishedGoods")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  return all.filter((f) => f.isFlagged === true);
}

/** True when at least one flagged product belongs to this job. */
export async function jobHasFlaggedProduct(
  ctx: Ctx,
  userId: Id<"users">,
  jobId: Id<"projectJobs">,
): Promise<boolean> {
  const flagged = await flaggedProducts(ctx, userId);
  return flagged.some((f) => jobIdsOf(f).includes(jobId));
}

/** True when anything flagged sits under this project (a product or a job). */
export async function projectHasFlaggedWork(
  ctx: Ctx,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<boolean> {
  const jobs = await ctx.db
    .query("projectJobs")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  const underProject = jobs.filter((j) => j.projectId === projectId);
  if (underProject.some((j) => j.isFlagged === true)) return true;
  const jobIds = new Set(underProject.map((j) => j._id));
  const flagged = await flaggedProducts(ctx, userId);
  return flagged.some((f) => jobIdsOf(f).some((id) => jobIds.has(id)));
}

/** Turn the flag on for these jobs and for the projects they belong to. */
export async function flagAncestors(
  ctx: Ctx,
  userId: Id<"users">,
  jobIds: Id<"projectJobs">[],
  flaggedAt: number,
): Promise<void> {
  for (const jid of jobIds) {
    const job = await ctx.db.get(jid);
    if (job === null || job.ownerId !== userId) continue;
    if (job.isFlagged !== true) {
      await ctx.db.patch(jid, { isFlagged: true, flaggedAt });
    }
    const project = await ctx.db.get(job.projectId);
    if (project !== null && project.ownerId === userId && project.isFlagged !== true) {
      await ctx.db.patch(job.projectId, { isFlagged: true, flaggedAt });
    }
  }
}

/**
 * Forget a flag a product can no longer keep.
 *
 * A product earns its flag as project work, so once it is detached from the
 * job it hung from — or from its project — the flag has nothing left to mean.
 * It is dropped here, and the jobs it was taken out of drop their own flag if
 * it was only there because of this product, so a deleted or emptied project
 * cannot leave rows stranded on the Productions board.
 */
export async function clearStaleProductFlag(
  ctx: Ctx,
  userId: Id<"users">,
  fgId: Id<"finishedGoods">,
  affectedJobIds: Id<"projectJobs">[],
): Promise<void> {
  const fg = await ctx.db.get(fgId);
  if (fg === null || fg.ownerId !== userId) return;
  if (fg.isFlagged === true && !isFlaggedProjectWork(fg)) {
    await ctx.db.patch(fgId, { isFlagged: undefined, flaggedAt: undefined });
  }
  await clearAncestorsIfOrphaned(ctx, userId, affectedJobIds);
}

/**
 * Drop the flag from a job and its project once nothing flagged is left under
 * them. Called after a leaf unflags itself, so the parents follow it down.
 */
export async function clearAncestorsIfOrphaned(
  ctx: Ctx,
  userId: Id<"users">,
  jobIds: Id<"projectJobs">[],
): Promise<void> {
  if (jobIds.length === 0) return;
  const projectIds = await projectIdsOfJobs(ctx, userId, jobIds);
  const flagged = await flaggedProducts(ctx, userId);

  for (const jid of jobIds) {
    const job = await ctx.db.get(jid);
    if (job === null || job.ownerId !== userId || job.isFlagged !== true) continue;
    const stillFlagged = flagged.some((f) => jobIdsOf(f).includes(jid));
    if (stillFlagged) continue;
    await ctx.db.patch(jid, { isFlagged: undefined, flaggedAt: undefined });
  }

  for (const pid of projectIds) {
    const project = await ctx.db.get(pid);
    if (project === null || project.ownerId !== userId || project.isFlagged !== true) {
      continue;
    }
    const underProject = await ctx.db
      .query("projectJobs")
      .withIndex("by_project", (q) => q.eq("projectId", pid))
      .collect();
    // the project keeps its flag while any job under it is flagged…
    if (underProject.some((j) => j.isFlagged === true)) continue;
    // …and while any product under one of those jobs is flagged
    const underIds = new Set(underProject.map((j) => j._id));
    const hasFlaggedProduct = flagged.some((f) =>
      jobIdsOf(f).some((id) => underIds.has(id)),
    );
    if (hasFlaggedProduct) continue;
    await ctx.db.patch(pid, { isFlagged: undefined, flaggedAt: undefined });
  }
}
