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

/**
 * Every job a product belongs to — products moved to a single or multi link.
 *
 * The rule itself lives in `lib/project-work`, where the browser can use it
 * too; this is the typed server-side view of it.
 */
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

/** What came off a row: flags cleared, and how many of them were products. */
export type RemovedFlags = { removed: number; products: number };

/**
 * The first product under these jobs whose run is still going.
 *
 * Work on the line cannot simply be taken off the board: its materials are
 * already out of stock, and `production.stop` is what puts them back. Every
 * removal checks for it first, so a run is never left half-visible.
 */
async function runningUnder(
  ctx: Ctx,
  userId: Id<"users">,
  jobIds: readonly Id<"projectJobs">[],
): Promise<Doc<"finishedGoods"> | undefined> {
  const wanted = new Set(jobIds.map(String));
  if (wanted.size === 0) return undefined;
  const all = await ctx.db
    .query("finishedGoods")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .collect();
  return all.find(
    (f) =>
      f.productionStartedAt !== undefined &&
      jobIdsOf(f).some((id) => wanted.has(String(id))),
  );
}

/**
 * Take a product off the production board: its own flag, then its parents if
 * nothing flagged is left under them.
 */
export async function unflagProductTree(
  ctx: Ctx,
  userId: Id<"users">,
  fgId: Id<"finishedGoods">,
): Promise<RemovedFlags> {
  const fg = await ctx.db.get(fgId);
  if (fg === null || fg.ownerId !== userId)
    throw new Error("That product no longer exists.");
  if (fg.productionStartedAt !== undefined)
    throw new Error(`“${fg.name}” is in production — stop the run first.`);
  if (fg.isFlagged !== true) return { removed: 0, products: 0 };
  const jobIds = jobIdsOf(fg);
  await ctx.db.patch(fgId, { isFlagged: undefined, flaggedAt: undefined });
  await clearAncestorsIfOrphaned(ctx, userId, jobIds);
  return { removed: 1, products: 1 };
}

/**
 * Take a job off the production board, with everything under it.
 *
 * A job sits on that board because a flagged product inside it put it there,
 * so clearing the job alone would leave it standing — flagged straight back by
 * the products it still holds. The products go first, then the job, then its
 * project if nothing else is keeping that.
 */
export async function unflagJobTree(
  ctx: Ctx,
  userId: Id<"users">,
  jobId: Id<"projectJobs">,
): Promise<RemovedFlags> {
  const job = await ctx.db.get(jobId);
  if (job === null || job.ownerId !== userId)
    throw new Error("That job no longer exists.");
  const busy = await runningUnder(ctx, userId, [jobId]);
  if (busy !== undefined)
    throw new Error(`“${busy.name}” is in production — stop the run first.`);

  const flagged = await flaggedProducts(ctx, userId);
  let removed = 0;
  let products = 0;
  for (const fg of flagged) {
    if (!jobIdsOf(fg).includes(jobId)) continue;
    await ctx.db.patch(fg._id, { isFlagged: undefined, flaggedAt: undefined });
    removed += 1;
    products += 1;
  }
  if (job.isFlagged === true) {
    await ctx.db.patch(jobId, { isFlagged: undefined, flaggedAt: undefined });
    removed += 1;
  }
  await clearAncestorsIfOrphaned(ctx, userId, [jobId]);
  return { removed, products };
}

/**
 * Take a project off the production board, with every job and product under
 * it — the same rule as a job, one level further up. Walked through the jobs
 * so the flags come off in the order the hierarchy is built.
 */
export async function unflagProjectTree(
  ctx: Ctx,
  userId: Id<"users">,
  projectId: Id<"projects">,
): Promise<RemovedFlags> {
  const project = await ctx.db.get(projectId);
  if (project === null || project.ownerId !== userId)
    throw new Error("That project no longer exists.");
  const jobs = (
    await ctx.db
      .query("projectJobs")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
  ).filter((job) => job.ownerId === userId);

  const busy = await runningUnder(
    ctx,
    userId,
    jobs.map((job) => job._id),
  );
  if (busy !== undefined)
    throw new Error(`“${busy.name}” is in production — stop the run first.`);

  let removed = 0;
  let products = 0;
  for (const job of jobs) {
    const gone = await unflagJobTree(ctx, userId, job._id);
    removed += gone.removed;
    products += gone.products;
  }
  if (project.isFlagged === true) {
    await ctx.db.patch(projectId, { isFlagged: undefined, flaggedAt: undefined });
    removed += 1;
  }
  return { removed, products };
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
