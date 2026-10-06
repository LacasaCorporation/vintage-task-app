/**
 * The rules that keep a plan nested, and the arithmetic a drag obeys.
 *
 * Work is planned inside the work it belongs to: a job runs between the dates
 * its project was given, and a product between the dates of the job that makes
 * it. Every date in the app is optional — a line with none of its own follows
 * its parent's — so each rule has to hold when either end of either window is
 * missing.
 *
 * Convex functions and the chart both import this module, so a drag is clamped
 * to exactly what the server would refuse.
 */

export const DAY_MS = 86_400_000;

/** A planned window: either end may be missing, both may be. */
export type DateWindow = { start?: number; end?: number };

/** Which part of a bar a pull has hold of. */
export type ScheduleGrip = "move" | "start" | "end";

/** The record fields every rule here reads. */
export type PlannedDates = { startAt?: number; dueAt?: number };

/** The dates a record owns, as the rules read them. */
export function ownedWindow(record: PlannedDates): DateWindow {
  return { start: record.startAt, end: record.dueAt };
}

/**
 * The days a window covers, taking whichever end it has: a line with only one
 * date is a single day, so it can still be checked against its parent.
 */
export function windowSpan(window: DateWindow): { from: number; to: number } | null {
  const { start, end } = window;
  if (start === undefined && end === undefined) return null;
  const from = start ?? (end as number);
  const to = end ?? (start as number);
  return { from, to: to < from ? from : to };
}

/** A planned date, in the short form the rest of the app shows dates. */
export function windowDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The same dates pulled along by whole days — what a bundle move does to the
 * work underneath the line that was dragged. A date the record does not have
 * is left off, so an inherited end stays inherited rather than being pinned.
 * Returns null when there is nothing to move.
 */
export function shiftDates(
  record: PlannedDates,
  days: number,
): PlannedDates | null {
  const shift = days * DAY_MS;
  const next: PlannedDates = {};
  if (record.startAt !== undefined) next.startAt = record.startAt + shift;
  if (record.dueAt !== undefined) next.dueAt = record.dueAt + shift;
  return next.startAt === undefined && next.dueAt === undefined ? null : next;
}

/**
 * Why a window cannot sit inside its parent's, or null when it fits.
 *
 * `subject` names what is being moved ("this job") and `container` names the
 * window it has to stay inside ("project"), so the refusal reads as a sentence
 * wherever it is raised. A line with no dates of its own is never refused: it
 * is following its parent, not crossing it.
 */
export function withinRefusal(
  child: DateWindow,
  parent: DateWindow,
  subject: string,
  container: string,
): string | null {
  const span = windowSpan(child);
  if (span === null) return null;
  if (parent.start !== undefined && span.from < parent.start) {
    return `That would start ${subject} before the ${container} starts (${windowDate(
      parent.start,
    )}). It has to stay inside the ${container}'s dates.`;
  }
  if (parent.end !== undefined && span.to > parent.end) {
    return `That would run ${subject} past the day the ${container} ends (${windowDate(
      parent.end,
    )}). It has to stay inside the ${container}'s dates.`;
  }
  return null;
}

/**
 * What a container's own edges cannot cross, taken from the work planned
 * inside it: a project cannot be shrunk past the job that ends last, nor past
 * the job that starts first, and the same holds for a job and its products.
 */
export type DateLimits = { startCeil?: number; endFloor?: number };

/** The edges of a container, from the dates its children own. */
export function limitsFrom(
  children: readonly PlannedDates[],
): DateLimits | undefined {
  const starts = children
    .map((child) => child.startAt)
    .filter((at): at is number => at !== undefined);
  const ends = children
    .map((child) => child.dueAt)
    .filter((at): at is number => at !== undefined);
  if (starts.length === 0 && ends.length === 0) return undefined;
  return {
    startCeil: starts.length > 0 ? Math.min(...starts) : undefined,
    endFloor: ends.length > 0 ? Math.max(...ends) : undefined,
  };
}

/**
 * Why a container cannot be shrunk to this window, or null when the work inside
 * it still fits. The other half of the same rule `withinRefusal` states from
 * the child's side: a project cannot be pulled in past the job that starts
 * first, nor closed before the job that ends last, and a job cannot be pulled
 * in past its own products.
 *
 * Only the container's own edges are judged, and only when it has one: a
 * window with no end yet cannot be closed too early.
 */
export function shrinkRefusal(
  container: DateWindow,
  limits: DateLimits | undefined,
  subject: string,
  contents: string,
): string | null {
  if (limits === undefined) return null;
  if (
    limits.startCeil !== undefined &&
    container.start !== undefined &&
    container.start > limits.startCeil
  ) {
    return `That would start the ${subject} after the ${contents} inside it begin (${windowDate(
      limits.startCeil,
    )}). Move or shorten that work first.`;
  }
  if (
    limits.endFloor !== undefined &&
    container.end !== undefined &&
    container.end < limits.endFloor
  ) {
    return `That would end the ${subject} before the ${contents} inside it finish (${windowDate(
      limits.endFloor,
    )}). Move or shorten that work first.`;
  }
  return null;
}

/**
 * Whole days between two planned dates. Rounding rather than truncating, because
 * a day is 23 or 25 hours across a daylight-saving change and the dates are
 * always whole days apart.
 */
function wholeDays(from: number, to: number): number {
  return Math.round((to - from) / DAY_MS);
}

/**
 * How many whole days a pull can actually move, once the window the line has to
 * stay in is respected — the chart clamps with this, so a drag stops at the
 * edge of what the plan allows instead of being refused on release.
 *
 * Two windows can hold a pull in. `bounds` is the parent's: the line stays
 * inside its project, or the product inside its job. `limits` are the
 * container's own children: a project's start cannot be pulled past the job
 * that starts first, nor its end past the job that ends last, so shrinking a
 * project can never leave its work outside it.
 *
 * A line that is already outside (planned before these rules existed) is left
 * where it is: a pull is never forced back, it just cannot go further out.
 */
export function pullWithin(
  base: { start: number; end: number },
  grip: ScheduleGrip,
  days: number,
  bounds?: DateWindow,
  limits?: DateLimits,
): number {
  const length = Math.max(wholeDays(base.start, base.end), 0);

  if (grip === "move") {
    // the whole line slides, so both of its edges have to stay inside the
    // parent's window: the pull is capped by whichever edge runs out first
    let latest = days > 0 ? days : 0;
    let earliest = days < 0 ? days : 0;
    if (bounds?.start !== undefined)
      earliest = Math.min(Math.max(days, wholeDays(base.start, bounds.start)), 0);
    if (bounds?.end !== undefined)
      latest = Math.max(Math.min(days, wholeDays(base.end, bounds.end)), 0);
    return Math.min(Math.max(days, earliest), latest);
  }

  if (grip === "start") {
    let earliest = days < 0 ? days : 0;
    if (bounds?.start !== undefined)
      earliest = Math.min(Math.max(days, wholeDays(base.start, bounds.start)), 0);
    let latest = Math.min(days, length);
    if (limits?.startCeil !== undefined)
      latest = Math.min(latest, Math.max(wholeDays(base.start, limits.startCeil), 0));
    return Math.min(Math.max(days, earliest), latest);
  }

  let latest = days > 0 ? days : 0;
  if (bounds?.end !== undefined)
    latest = Math.max(Math.min(days, wholeDays(base.end, bounds.end)), 0);
  let earliest = Math.max(days, -length);
  if (limits?.endFloor !== undefined)
    earliest = Math.max(earliest, Math.min(wholeDays(base.end, limits.endFloor), 0));
  return Math.min(Math.max(days, earliest), latest);
}

/**
 * The dates a drag lands on: the body of a bar carries both dates along, an
 * edge carries only its own, and neither can be dragged past the other or
 * outside the window the line has to stay in.
 */
export function draggedDates(
  base: { start: number; end: number },
  grip: ScheduleGrip,
  days: number,
  bounds?: DateWindow,
  limits?: DateLimits,
): { start: number; end: number } {
  const pulled = pullWithin(base, grip, days, bounds, limits);
  const shift = pulled * DAY_MS;
  if (grip === "move") {
    return { start: base.start + shift, end: base.end + shift };
  }
  if (grip === "start") {
    return { start: Math.min(base.start + shift, base.end), end: base.end };
  }
  return { start: base.start, end: Math.max(base.end + shift, base.start) };
}
