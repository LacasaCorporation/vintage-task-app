export const DEFAULT_PROJECT_STATUSES = [
  "Listed",
  "In production",
  "In progress",
  "Finish",
] as const;

/** The first status: a freshly flagged product lands here. */
export const PROJECT_STATUS_START = "Listed";
export const PROJECT_STATUS_FINISH = "Finish";

/**
 * Why a product's figures are frozen, or null while it can still be changed.
 *
 * This mirrors the server's own `lockedReason` in costing.ts: once a product
 * is on the line or finished, its cost and stock are already on the books, so
 * it cannot be moved or deleted. Rows read this so a frozen control explains
 * itself instead of offering something the server will refuse.
 */
export function productLockedReason(
  fg: {
    productionStartedAt?: number;
    inProduction?: number;
    isCompleted?: boolean;
    projectStatus?: string;
  },
): string | null {
  if (fg.productionStartedAt !== undefined || (fg.inProduction ?? 0) > 0) {
    return "This product is in production. Stop production before changing it.";
  }
  if (fg.isCompleted === true || fg.projectStatus === PROJECT_STATUS_FINISH) {
    return "This product is finished, so its cost and stock are already on the books.";
  }
  return null;
}

/**
 * Units a run has part-made and would land on the shelf if it were finished
 * now. Mirrors `landableQty` in convex/production.ts, which is the figure the
 * server lands, so the two can never disagree about what is finishable.
 */
export function landableQtyOf(fg: {
  inProduction?: number;
  productionQty?: number;
}): number {
  return fg.inProduction ?? fg.productionQty ?? 0;
}

/**
 * Why a product cannot be finished yet, or null when it can.
 *
 * Finishing is what puts a product's units on the shelf, so a batch has to be
 * under way first: a product is finished by being produced, never by being
 * ticked off. That is also what makes it go through the statuses — starting
 * production is what moves it out of the first status.
 *
 * Mirrors the server's own `finishBlockedReason` in convex/production.ts, so a
 * frozen control explains itself instead of offering what the server refuses.
 */
export function finishBlockedReason(fg: {
  productionStartedAt?: number;
  inProduction?: number;
  productionQty?: number;
}): string | null {
  if (landableQtyOf(fg) > 0) return null;
  return fg.productionStartedAt === undefined
    ? "Start production before finishing this product — its units only reach the shelf when a batch is made."
    : "This run has already landed all of its units. Start another batch to finish more of it.";
}

/** What the first status used to be called, so older saved sets still work. */
const LEGACY_PROJECT_STATUS_START = "Start";

/**
 * Starting production moves a product past Listed into the first middle
 * status, which is where the work actually happens before Finish.
 */
export function middleProjectStatus(statuses: readonly string[]): string {
  return statuses[1] ?? PROJECT_STATUS_START;
}

/**
 * Once production has started a product may only sit in one of the middle
 * statuses: Listed and Finish belong to the edges of the workflow and are
 * reached by starting production and by finishing the job, not by picking a
 * status by hand. The current status is kept in the list so the dropdown never
 * renders blank if the product somehow sits on an edge status.
 */
export function middleProjectStatuses(
  statuses: readonly string[],
  current?: string,
): string[] {
  const middle = statuses.slice(1, -1);
  if (middle.length === 0) return [...statuses];
  if (current !== undefined && !middle.includes(current)) {
    return [...middle, current];
  }
  return middle;
}

/** Map a pre-rename saved status list onto the current names. */
export function normalizeProjectStatuses(
  statuses: readonly string[],
): string[] {
  return statuses.map((status) =>
    status === LEGACY_PROJECT_STATUS_START ? PROJECT_STATUS_START : status,
  );
}

export function projectStatusesOrDefaults(
  statuses: readonly string[] | undefined,
): string[] {
  if (!statuses || statuses.length < 2) return [...DEFAULT_PROJECT_STATUSES];
  const normalized = normalizeProjectStatuses(statuses);
  return normalized[0] === PROJECT_STATUS_START &&
    normalized[normalized.length - 1] === PROJECT_STATUS_FINISH
    ? normalized
    : [...DEFAULT_PROJECT_STATUSES];
}

export function cleanProjectStatuses(statuses: readonly string[]): string[] {
  const cleaned = statuses
    .map((status) => status.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (cleaned.length < 2 || cleaned.length > 12) {
    throw new Error("Choose between 2 and 12 statuses.");
  }
  if (
    cleaned[0] !== PROJECT_STATUS_START ||
    cleaned[cleaned.length - 1] !== PROJECT_STATUS_FINISH
  ) {
    throw new Error(
      `The first status must be ${PROJECT_STATUS_START} and the last must be ${PROJECT_STATUS_FINISH}.`,
    );
  }
  const seen = new Set<string>();
  for (const status of cleaned) {
    const key = status.toLowerCase();
    if (seen.has(key)) throw new Error("Status names must be unique.");
    seen.add(key);
  }
  return cleaned;
}
