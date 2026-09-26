// ── Detailed permission model ────────────────────────────────────────────
// Every section grants four actions. `undefined` inherits the workspace
// default (everything allowed) — only explicit `false` denies.

export const SECTIONS = ["tasks", "notes", "costing"] as const;
export type SectionKey = (typeof SECTIONS)[number];

export const ACTIONS = ["view", "create", "edit", "delete"] as const;
export type ActionKey = (typeof ACTIONS)[number];

export type GranularPerms = {
  tasks?: Partial<Record<ActionKey, boolean>>;
  notes?: Partial<Record<ActionKey, boolean>>;
  costing?: Partial<Record<ActionKey, boolean>>;
  /** Item-level permissions: finer control inside each section. */
  items?: Partial<Record<ItemKey, Partial<Record<ActionKey, boolean>>>>;
};

// ── Item-level permissions ───────────────────────────────────────────────
// Each section is made of items (lists, notebooks, materials, products…).
// Every item lists the actions that make sense for it, so the UI only shows
// relevant toggles and enforcement stays predictable.

export const ITEMS = [
  { key: "taskLists", section: "tasks", label: "Task lists", actions: ["create", "edit", "delete"] },
  { key: "taskFolders", section: "tasks", label: "List folders", actions: ["create", "delete"] },
  { key: "taskSteps", section: "tasks", label: "Subtasks & attachments", actions: ["create", "edit", "delete"] },
  { key: "notebooks", section: "notes", label: "Notebooks", actions: ["create", "edit", "delete"] },
  { key: "notePages", section: "notes", label: "Pages & sub-pages", actions: ["create", "edit", "delete"] },
  { key: "flagToTask", section: "notes", label: "Flag text → task", actions: ["create"] },
  { key: "materials", section: "costing", label: "Raw materials", actions: ["create", "edit", "delete"] },
  { key: "purchases", section: "costing", label: "Purchase bills", actions: ["create", "edit", "delete", "view"] },
  { key: "dataImport", section: "costing", label: "Excel import / export", actions: ["create", "view"] },
  { key: "products", section: "costing", label: "Products (FG)", actions: ["create", "edit", "delete"] },
  { key: "projects", section: "costing", label: "Projects", actions: ["create", "edit", "delete"] },
  { key: "printing", section: "costing", label: "Printing costing sheets", actions: ["view"] },
] as const;

export type ItemKey = (typeof ITEMS)[number]["key"];

/** Item catalog grouped by the section it belongs to. */
export function itemsForSection(section: SectionKey) {
  return ITEMS.filter((i) => i.section === section);
}

/** Can the user do `action` on a specific item? Falls back to the section. */
export function canItem(
  perms: GranularPerms | undefined,
  item: ItemKey,
  action: ActionKey,
): boolean {
  const explicit = perms?.items?.[item]?.[action];
  if (explicit !== undefined) return explicit;
  const section = ITEMS.find((i) => i.key === item)?.section;
  if (section) return can(perms, section, action);
  return true;
}

/** Resolve a permission: explicit value > default allowed. */
export function can(
  perms: GranularPerms | undefined,
  section: SectionKey,
  action: ActionKey,
): boolean {
  const v = perms?.[section]?.[action];
  if (v !== undefined) return v;
  // delete defaults to true only when nothing is configured at all; but for
  // least surprise, absence = allowed (matches previous behavior).
  return true;
}

/** Section is visible when view is allowed. */
export function canView(
  perms: GranularPerms | undefined,
  section: SectionKey,
): boolean {
  return can(perms, section, "view");
}

export const ACTION_LABELS: Record<ActionKey, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
};

export const ACTION_DESCRIPTIONS: Record<ActionKey, string> = {
  view: "See the section and its content",
  create: "Add new items",
  edit: "Change existing items",
  delete: "Remove items",
};

export const SECTION_LABELS: Record<SectionKey, string> = {
  tasks: "Tasks",
  notes: "Notes",
  costing: "Costing",
};
