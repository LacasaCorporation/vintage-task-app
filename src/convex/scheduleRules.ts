import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  limitsFrom,
  ownedWindow,
  shrinkRefusal,
  withinRefusal,
  type DateWindow,
  type PlannedDates,
} from "../lib/schedule-window";

/**
 * The one rule that keeps a plan nested, enforced wherever a date is written.
 *
 * Work is planned inside the work it belongs to: a job runs between its
 * project's dates, a product between its job's, and neither a project nor a job
 * can be pulled in past the work inside it. Every surface that writes a date —
 * the timeline, the side panels, the boards, the seeds — goes through here, so
 * the rule holds whichever one the reader used, and a refusal says the same
 * thing the chart's own clamp already enforces.
 *
 * A line with no dates of its own is never refused: it is following its parent,
 * not crossing it, and reading a window means reading the dates a level
 * actually owns.
 */

export type PlanKind = "project" | "job" | "product";

export type NodeDoc =
  | Doc<"projects">
  | Doc<"projectJobs">
  | Doc<"finishedGoods">;

/** The days a job is planned for: its own, else its project's. */
async function jobWindow(
  ctx: MutationCtx,
  job: Doc<"projectJobs">,
): Promise<DateWindow> {
  const project = await ctx.db.get(job.projectId);
  return {
    start: job.startAt ?? project?.startAt,
    end: job.dueAt ?? project?.dueAt,
  };
}

/** The dates every product under a job owns, by either link. */
async function productDates(
  ctx: MutationCtx,
  job: Doc<"projectJobs">,
): Promise<PlannedDates[]> {
  const links = await ctx.db
    .query("jobProducts")
    .withIndex("by_job", (q) => q.eq("jobId", job._id))
    .collect();
  const linked = new Set(links.map((link) => link.fgId));
  const products = await ctx.db
    .query("finishedGoods")
    .withIndex("by_owner", (q) => q.eq("ownerId", job.ownerId))
    .collect();
  return products
    .filter(
      (fg) =>
        linked.has(fg._id) ||
        fg.jobId === job._id ||
        (fg.jobIds ?? []).includes(job._id),
    )
    .map((fg) => ({ startAt: fg.startAt, dueAt: fg.dueAt }));
}

/** The dates every job under a project owns. */
async function jobDates(
  ctx: MutationCtx,
  project: Doc<"projects">,
): Promise<PlannedDates[]> {
  const jobs = await ctx.db
    .query("projectJobs")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  return jobs
    .filter((job) => job.ownerId === project.ownerId)
    .map((job) => ({ startAt: job.startAt, dueAt: job.dueAt }));
}

/**
 * Refuse a write that would leave the plan unnested.
 *
 * `next` is the dates the node would end up with, not the patch, so a cleared
 * date reads as absent and a line that is inheriting is never refused. Callers
 * are expected to skip this when the write changes nothing, so re-saving a date
 * on work that was already outside its parent is left alone rather than
 * blocked.
 */
export async function assertPlanNests(
  ctx: MutationCtx,
  kind: PlanKind,
  node: NodeDoc,
  next: PlannedDates,
  /** The job a product is being moved to, when that is part of the write. */
  jobId?: Id<"projectJobs">,
): Promise<void> {
  if (kind === "project") {
    const refusal = shrinkRefusal(
      ownedWindow(next),
      limitsFrom(await jobDates(ctx, node as Doc<"projects">)),
      "project",
      "jobs",
    );
    if (refusal !== null) throw new Error(refusal);
    return;
  }

  if (kind === "job") {
    const job = node as Doc<"projectJobs">;
    const outside = withinRefusal(
      ownedWindow(next),
      await jobWindow(ctx, job),
      "this job",
      "project",
    );
    if (outside !== null) throw new Error(outside);
    const shrunk = shrinkRefusal(
      ownedWindow(next),
      limitsFrom(await productDates(ctx, job)),
      "job",
      "products",
    );
    if (shrunk !== null) throw new Error(shrunk);
    return;
  }

  const fg = node as Doc<"finishedGoods">;
  const owner = jobId ?? fg.jobId ?? (fg.jobIds ?? [])[0];
  if (owner === undefined) return;
  const job = await ctx.db.get(owner);
  if (job === null) return;
  const outside = withinRefusal(
    ownedWindow(next),
    await jobWindow(ctx, job),
    "this product",
    "job",
  );
  if (outside !== null) throw new Error(outside);
}
