export const DEFAULT_PROJECT_STATUSES = ["Start", "In progress", "Finish"] as const;
export const PROJECT_STATUS_START = "Start";
export const PROJECT_STATUS_FINISH = "Finish";

export function projectStatusesOrDefaults(
  statuses: readonly string[] | undefined,
): string[] {
  return statuses &&
    statuses.length >= 2 &&
    statuses[0] === PROJECT_STATUS_START &&
    statuses[statuses.length - 1] === PROJECT_STATUS_FINISH
    ? [...statuses]
    : [...DEFAULT_PROJECT_STATUSES];
}

export function cleanProjectStatuses(statuses: readonly string[]): string[] {
  const cleaned = statuses
    .map((status) => status.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (cleaned.length < 2 || cleaned.length > 12) {
    throw new Error("Choose between 2 and 12 statuses.");
  }
  if (cleaned[0] !== PROJECT_STATUS_START || cleaned[cleaned.length - 1] !== PROJECT_STATUS_FINISH) {
    throw new Error("The first status must be Start and the last must be Finish.");
  }
  const seen = new Set<string>();
  for (const status of cleaned) {
    const key = status.toLowerCase();
    if (seen.has(key)) throw new Error("Status names must be unique.");
    seen.add(key);
  }
  return cleaned;
}
