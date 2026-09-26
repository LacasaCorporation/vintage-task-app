export const DEFAULT_PROJECT_STATUSES = [
  "Listed",
  "In production",
  "In progress",
  "Finish",
] as const;

/** The first status: a freshly flagged product lands here. */
export const PROJECT_STATUS_START = "Listed";
export const PROJECT_STATUS_FINISH = "Finish";

/** What the first status used to be called, so older saved sets still work. */
const LEGACY_PROJECT_STATUS_START = "Start";

/**
 * Starting production moves a product past Listed into the first middle
 * status, which is where the work actually happens before Finish.
 */
export function middleProjectStatus(statuses: readonly string[]): string {
  return statuses[1] ?? PROJECT_STATUS_START;
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
