/**
 * Every job a product belongs to — products moved to a single or multi link.
 *
 * Lives here rather than in the Convex module so the browser and the server
 * answer "which job is this product in?" the same way.
 */
export function jobIdsOf(fg: {
  jobId?: unknown;
  jobIds?: readonly unknown[] | undefined;
}): string[] {
  const many = fg.jobIds ?? [];
  if (many.length > 0) return many.map(String);
  return fg.jobId !== undefined ? [String(fg.jobId)] : [];
}

/**
 * Whether a flagged product still counts as project work.
 *
 * The Productions board is the work inside projects: the flag cascades through
 * the job a product belongs to, and `setFgFlag` refuses to flag a product that
 * has no job, because there would be nothing for the flag to hang from. So a
 * product left with no job — detached from it, or its job deleted — has
 * nothing to produce for, and a flag still sitting on it is stale. The board
 * ignores it, and the flag is cleared the next time the product is touched,
 * rather than being shown as a job-less row that nothing can finish.
 */
export function isFlaggedProjectWork(fg: {
  isFlagged?: boolean;
  jobId?: unknown;
  jobIds?: readonly unknown[];
}): boolean {
  if (fg.isFlagged !== true) return false;
  return (fg.jobIds ?? []).length > 0 || fg.jobId !== undefined;
}
