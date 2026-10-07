export const DEFAULT_PROJECT_STATUSES = [
  "Listed",
  "In production",
  "In progress",
  "Finish",
] as const;

/** The first status: a freshly flagged product lands here. */
export const PROJECT_STATUS_START = "Listed";
export const PROJECT_STATUS_FINISH = "Finish";

/** The middle and last of the three statuses a job or project sits in. */
export const PROJECT_STATUS_IN_PROGRESS = "In progress";
export const PROJECT_STATUS_COMPLETED = "Completed";

/**
 * The only three statuses a job or a project can have: Listed, In progress,
 * Completed.
 *
 * They are stages, not percentages — nothing about how far along they are is
 * read off the stage itself. A job's completion comes from its products and a
 * project's from its jobs, so both are always the roll-up of the work inside
 * them. Products are the level that keeps the full workflow below, with its
 * colours and its per-status completion.
 */
export const STAGE_STATUSES: readonly string[] = [
  PROJECT_STATUS_START,
  PROJECT_STATUS_IN_PROGRESS,
  PROJECT_STATUS_COMPLETED,
];

/**
 * A status as the editor saves it: its name plus how that status is worn.
 *
 * The name is the only part the workflow logic reads — moves, guards and
 * filters all still work on plain names. The rest is presentation: which
 * colour its chips and columns take, how far along a product sitting in it
 * counts as done, and who owns that stage.
 */
export type ProjectStatusDetail = {
  name: string;
  /** A key from {@link STATUS_PALETTE}. Absent → the colour follows the
   *  status's place in the workflow, so nothing looks broken before it is set. */
  color?: string;
  /** Completion the status counts for, 0–100. Absent → spread by position. */
  completion?: number;
  /** Who owns the stage — a person's name or a team, kept as free text so a
   *  firm that has not set up members can still use it. */
  assignee?: string;
};

/** Settings rows written before the details existed hold plain names. */
export type ProjectStatusInput = string | ProjectStatusDetail;

/** One colour a status can wear. */
export type StatusColor = {
  key: string;
  label: string;
  /** Fills: board column tops, dots, bars. */
  fill: string;
  /** Ink: icons and text that wear the colour. */
  ink: string;
  /** A tinted chip, with text that still passes contrast on it. */
  soft: string;
  softInk: string;
  /** Hex, for the few places a class cannot reach — a native `<select>`. */
  hex: string;
};

/**
 * The palette offered in the status editor. The classes are written out in
 * full because a `bg-${key}-500` assembled at runtime would never be seen by
 * the CSS scanner and would render as no colour at all.
 */
export const STATUS_PALETTE: readonly StatusColor[] = [
  { key: "sky", label: "Sky", fill: "bg-sky-500", ink: "text-sky-500", soft: "bg-sky-500/10", softInk: "text-sky-700 dark:text-sky-400", hex: "#0ea5e9" },
  { key: "violet", label: "Violet", fill: "bg-violet-500", ink: "text-violet-500", soft: "bg-violet-500/10", softInk: "text-violet-700 dark:text-violet-400", hex: "#8b5cf6" },
  { key: "emerald", label: "Emerald", fill: "bg-emerald-500", ink: "text-emerald-500", soft: "bg-emerald-500/10", softInk: "text-emerald-700 dark:text-emerald-400", hex: "#10b981" },
  { key: "teal", label: "Teal", fill: "bg-teal-500", ink: "text-teal-500", soft: "bg-teal-500/10", softInk: "text-teal-700 dark:text-teal-400", hex: "#14b8a6" },
  { key: "amber", label: "Amber", fill: "bg-amber-500", ink: "text-amber-500", soft: "bg-amber-500/10", softInk: "text-amber-700 dark:text-amber-400", hex: "#f59e0b" },
  { key: "orange", label: "Orange", fill: "bg-orange-500", ink: "text-orange-500", soft: "bg-orange-500/10", softInk: "text-orange-700 dark:text-orange-400", hex: "#f97316" },
  { key: "rose", label: "Rose", fill: "bg-rose-500", ink: "text-rose-500", soft: "bg-rose-500/10", softInk: "text-rose-700 dark:text-rose-400", hex: "#f43f5e" },
  { key: "pink", label: "Pink", fill: "bg-pink-500", ink: "text-pink-500", soft: "bg-pink-500/10", softInk: "text-pink-700 dark:text-pink-400", hex: "#ec4899" },
  { key: "indigo", label: "Indigo", fill: "bg-indigo-500", ink: "text-indigo-500", soft: "bg-indigo-500/10", softInk: "text-indigo-700 dark:text-indigo-400", hex: "#6366f1" },
  { key: "cyan", label: "Cyan", fill: "bg-cyan-500", ink: "text-cyan-500", soft: "bg-cyan-500/10", softInk: "text-cyan-700 dark:text-cyan-400", hex: "#06b6d4" },
  { key: "lime", label: "Lime", fill: "bg-lime-500", ink: "text-lime-500", soft: "bg-lime-500/10", softInk: "text-lime-700 dark:text-lime-400", hex: "#84cc16" },
  { key: "slate", label: "Slate", fill: "bg-slate-500", ink: "text-slate-500", soft: "bg-slate-500/10", softInk: "text-slate-700 dark:text-slate-400", hex: "#64748b" },
];

const PALETTE_BY_KEY = new Map(STATUS_PALETTE.map((color) => [color.key, color]));
const colorOf = (key: string): StatusColor | undefined => PALETTE_BY_KEY.get(key);

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

/** A status name as it is known today, whatever an older row called it. */
function normalizeStatusName(status: string): string {
  return status === LEGACY_PROJECT_STATUS_START ? PROJECT_STATUS_START : status;
}

/** The name a settings entry stands for, details or plain name alike. */
function nameOf(input: ProjectStatusInput): string {
  return typeof input === "string" ? input : input.name;
}

/** The details a settings entry holds; a plain name carries no more than its name. */
function detailOf(input: ProjectStatusInput): ProjectStatusDetail {
  return typeof input === "string" ? { name: input } : { ...input, name: input.name };
}

/**
 * The colour of a status nobody has coloured yet: the two ends of the workflow
 * keep their two colours whatever the reader called them, with the middle of
 * the workflow in violet. Positions are how the board always read, so an
 * untouched workflow looks exactly as it did before colours existed.
 */
export function positionalColor(index: number, total: number): StatusColor {
  const key = index <= 0 ? "sky" : index >= total - 1 ? "emerald" : "violet";
  return colorOf(key) ?? STATUS_PALETTE[0];
}

/** The colour a status wears: its own if it has one, its position if not. */
export function statusColor(
  details: readonly ProjectStatusDetail[] | undefined,
  name: string,
  index: number,
  total: number,
): StatusColor {
  const own = details?.find((entry) => entry.name === name)?.color;
  return (own === undefined ? undefined : colorOf(own)) ?? positionalColor(index, total);
}

/**
 * How far along a product in this status counts as done. An unset status is
 * spread across the workflow by position — Listed reads 0 and Finish reads 100
 * however many statuses sit between them — so progress is legible before
 * anybody has typed a number, and a typed number always wins.
 */
export function statusCompletion(
  details: readonly ProjectStatusDetail[] | undefined,
  name: string,
  index: number,
  total: number,
): number {
  const own = details?.find((entry) => entry.name === name)?.completion;
  if (own !== undefined && Number.isFinite(own)) return clampCompletion(own);
  return positionalCompletion(index, total);
}

/** The completion a status reads when nobody has given it one. */
export function positionalCompletion(index: number, total: number): number {
  if (total <= 1) return 100;
  return Math.round((Math.max(0, index) / (total - 1)) * 100);
}

/** Clamp a typed completion into the 0–100 the rest of the app expects. */
export function clampCompletion(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Who owns the stage a status names, or null when nobody was given. */
export function statusAssignee(
  details: readonly ProjectStatusDetail[] | undefined,
  name: string,
): string | null {
  const own = details?.find((entry) => entry.name === name)?.assignee;
  return own === undefined || own.trim() === "" ? null : own.trim();
}

/** Whether a name is one of the three stages a job or project sits in. */
export function isStageStatus(status: string): boolean {
  return STAGE_STATUSES.includes(status);
}

/**
 * Whether a job or project status reads as completed: its own third stage, or
 * the end status rows written before jobs and projects had stages of their
 * own still carry.
 */
export function isStageDone(status: string | undefined): boolean {
  return status === PROJECT_STATUS_COMPLETED || status === PROJECT_STATUS_FINISH;
}

/**
 * Any status name collapsed onto the three stages, so a row written while
 * jobs and projects still shared the product workflow reads the same today:
 * the workflow's end status is Completed, its first is Listed, everything in
 * between is In progress.
 */
export function stageStatusOf(status: string): string {
  const clean = status.trim().replace(/\s+/g, " ");
  if (isStageStatus(clean)) return clean;
  if (clean === PROJECT_STATUS_FINISH) return PROJECT_STATUS_COMPLETED;
  if (clean === PROJECT_STATUS_START || clean === LEGACY_PROJECT_STATUS_START)
    return PROJECT_STATUS_START;
  return PROJECT_STATUS_IN_PROGRESS;
}

/**
 * The colour a stage wears: the same two-ends rule the workflow uses, worked
 * out over the three stages alone, so Listed is sky, In progress violet and
 * Completed emerald however the product workflow is configured.
 */
export function stageStatusColor(status: string): StatusColor {
  const index = STAGE_STATUSES.indexOf(status);
  return positionalColor(index < 0 ? STAGE_STATUSES.length - 1 : index, STAGE_STATUSES.length);
}

/**
 * How far along a job or project is, from the work inside it — a job from its
 * products, a project from its jobs. The stages themselves carry no number.
 */
export function rollupCompletion(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((Math.max(0, done) / total) * 100);
}

/**
 * Carry the status filter across the workspace levels. The three stages and
 * the product workflow name the same points differently (Completed is called
 * Finish on a product), so a filter picked on one level still means the same
 * thing after switching to the other.
 */
export function remapStatusFilter(
  filter: string,
  to: "stage" | "product",
  productStatuses: readonly string[],
): string {
  if (filter === "all" || filter === "open" || filter === "done") return filter;
  if (to === "stage") return stageStatusOf(filter);
  if (productStatuses.includes(filter)) return filter;
  if (filter === PROJECT_STATUS_COMPLETED || filter === PROJECT_STATUS_FINISH)
    return PROJECT_STATUS_FINISH;
  if (filter === PROJECT_STATUS_IN_PROGRESS)
    return productStatuses[1] ?? PROJECT_STATUS_IN_PROGRESS;
  return PROJECT_STATUS_START;
}

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
  return statuses.map(normalizeStatusName);
}

export function projectStatusesOrDefaults(
  statuses: readonly ProjectStatusInput[] | undefined,
): string[] {
  if (!statuses || statuses.length < 2) return [...DEFAULT_PROJECT_STATUSES];
  const normalized = normalizeProjectStatuses(statuses.map(nameOf));
  return normalized[0] === PROJECT_STATUS_START &&
    normalized[normalized.length - 1] === PROJECT_STATUS_FINISH
    ? normalized
    : [...DEFAULT_PROJECT_STATUSES];
}

/**
 * The same statuses with their details attached, in the order the workflow
 * runs. Details are matched by name, so a status that was renamed or removed
 * simply loses its old colour rather than dragging it onto another status —
 * and a settings row written before details existed comes back as bare names,
 * which the colour and completion fallbacks then dress by position.
 */
export function projectStatusDetailsOrDefaults(
  stored: readonly ProjectStatusInput[] | undefined,
): ProjectStatusDetail[] {
  const names = projectStatusesOrDefaults(stored);
  const byName = new Map<string, ProjectStatusDetail>();
  for (const input of stored ?? []) {
    const detail = detailOf(input);
    const key = normalizeStatusName(detail.name);
    if (key !== "" && !byName.has(key)) byName.set(key, { ...detail, name: key });
  }
  return names.map((name) => byName.get(name) ?? { name });
}

/** The rules every saved workflow has to satisfy, on names alone. */
function cleanStatusNames(names: readonly string[]): string[] {
  const cleaned = names
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

/**
 * The editor's rows, ready to store: names tidied by the rules the workflow
 * has always had — 2 to 12 of them, Listed first, Finish last, none twice —
 * and the details trimmed of anything the app could not use: a colour that is
 * not in the palette, a completion outside 0–100, a blank assignee. Fields
 * left out stay out of the stored object, so a status with nothing set is
 * still just its name plus nothing.
 */
export function cleanProjectStatusDetails(
  statuses: readonly ProjectStatusInput[],
): ProjectStatusDetail[] {
  const details = statuses.map(detailOf);
  // a blank row the editor just added is kept in step with its details, so it
  // is named rather than silently dropped — dropping would slide every colour
  // and percentage one row up
  const trimmed = details.map((detail) =>
    detail.name.trim().replace(/\s+/g, " "),
  );
  if (trimmed.some((name) => name === "")) {
    throw new Error("Every status needs a name.");
  }
  const names = cleanStatusNames(trimmed);
  return details.map((detail, index) => {
    const cleaned: ProjectStatusDetail = { name: names[index] };
    if (detail.color !== undefined && colorOf(detail.color) !== undefined) {
      cleaned.color = detail.color;
    }
    if (detail.completion !== undefined && Number.isFinite(detail.completion)) {
      cleaned.completion = clampCompletion(detail.completion);
    }
    const assignee = detail.assignee?.trim().replace(/\s+/g, " ") ?? "";
    if (assignee !== "") cleaned.assignee = assignee;
    return cleaned;
  });
}
