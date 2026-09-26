import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Data backup & restore.
 *
 * Export gathers every user-owned row (tasks, lists, folders, notes,
 * costing/projects, master data) into one JSON document keyed by table name.
 * Restore rebuilds that document into the signed-in user's workspace,
 * remapping all cross-table id references. Runs in one mutation, so it is
 * atomic: if validation fails mid-way nothing is wiped.
 *
 * Only user content is exported — auth tables (users, authSessions, accounts),
 * org settings, sign-ins, roles and invites are workspace plumbing, not
 * content, and are intentionally left out.
 */

// ── export ────────────────────────────────────────────────────────────────

const CONTENT_TABLES = [
  "taskFolders",
  "taskLists",
  "tasks",
  "taskSteps",
  "rawMaterials",
  "costingSheets",
  "projects",
  "projectJobs",
  "finishedGoods",
  "costingItems",
  "costUnits",
  "costCategories",
  "notebooks",
  "notePages",
] as const;

type ContentTable = (typeof CONTENT_TABLES)[number];

/** Fields on each table that reference another (or the same) content table. */
const ID_FIELDS: Record<
  ContentTable,
  Record<string, ContentTable | null> // null = same table (self-reference)
> = {
  taskFolders: {},
  taskLists: { folderId: "taskFolders" },
  tasks: { listId: "taskLists", sourcePageId: "notePages" },
  taskSteps: { taskId: "tasks" },
  rawMaterials: {},
  costingSheets: {},
  projects: {},
  projectJobs: { projectId: "projects" },
  finishedGoods: {
    jobId: "projectJobs",
    jobIds: "projectJobs", // array of job ids — handled specially
  },
  costingItems: {
    sheetId: "costingSheets",
    fgId: "finishedGoods",
    materialId: "rawMaterials",
  },
  costUnits: {},
  costCategories: { parentId: "costCategories" },
  notebooks: {},
  notePages: { notebookId: "notebooks", parentId: "notePages" },
};

/** Insertion order: tables referenced by others come first. */
const INSERT_ORDER: ContentTable[] = [
  "notebooks",
  "taskFolders",
  "costUnits",
  "rawMaterials",
  "costingSheets",
  "costCategories",
  "taskLists",
  "notePages", // self-ref parentId resolved in a second pass
  "tasks",
  "projects",
  "projectJobs",
  "taskSteps",
  "finishedGoods",
  "costingItems",
];

/**
 * All rows of a content table owned by `userId`. Convex's generic-table
 * typing collapses over the table-name union, so this is a scoped cast —
 * every table here has a `by_owner` index and an `ownerId` field.
 */
async function rowsForUser(
  ctx: QueryCtx,
  userId: Id<"users">,
  table: ContentTable,
): Promise<Doc<ContentTable>[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = ctx.db.query(table) as any;
  return q
    .withIndex("by_owner", (qq: { eq: (f: string, v: Id<"users">) => unknown }) =>
      qq.eq("ownerId", userId),
    )
    .collect() as Promise<Doc<ContentTable>[]>;
}

export const exportBackup = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const data: Record<string, Record<string, unknown>[]> = {};
    let totalRows = 0;
    for (const table of CONTENT_TABLES) {
      const rows = await rowsForUser(ctx, userId, table);
      // tag each row with a stable temp key so cross-references can be
      // remapped on restore regardless of insertion order
      data[table] = rows.map((row, index) => {
        const rest = { ...(row as Record<string, unknown>) };
        delete rest._id;
        delete rest._creationTime;
        return { ...rest, _key: `${table}:${index}` };
      });
      totalRows += rows.length;
    }

    return {
      version: 1 as const,
      exportedAt: Date.now(),
      totalRows,
      data,
    };
  },
});

// ── restore ───────────────────────────────────────────────────────────────

/**
 * Wipes the signed-in user's content tables, then re-inserts every row from
 * the backup, remapping `ownerId` and every cross-table id field via the
 * row `_key`s written by exportBackup. Dangling references are dropped.
 */
export const restoreBackup = mutation({
  args: { backup: v.any() },
  handler: async (ctx, { backup }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    if (!backup || typeof backup !== "object") {
      throw new Error("That file doesn't look like a Slate backup.");
    }
    if (backup.version !== 1) {
      throw new Error(
        "This backup was made with a different version of Slate and can't be imported.",
      );
    }
    if (!backup.data || typeof backup.data !== "object") {
      throw new Error("That backup file is missing its data section.");
    }
    const data = backup.data as Record<string, Record<string, unknown>[]>;

    // 1) wipe current content
    for (const table of CONTENT_TABLES) {
      const rows = await rowsForUser(ctx, userId, table);
      for (const row of rows) await ctx.db.delete(row._id);
    }

    // 2) re-insert, remapping references
    const idMap = new Map<string, string>();
    const deferred: { newId: string; field: string; backupRef: string }[] = [];

    const remapOne = (val: unknown): unknown =>
      typeof val === "string" && idMap.has(val) ? idMap.get(val) : undefined;

    for (const table of INSERT_ORDER) {
      const rows = data[table];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const key = typeof row._key === "string" ? row._key : "";
        const remapped: Record<string, unknown> = { ...row, ownerId: userId };
        delete remapped._key;

        let deferIndex = -1;

        for (const [field, refTable] of Object.entries(ID_FIELDS[table])) {
          const val = remapped[field];
          if (val === undefined || val === null) {
            delete remapped[field];
            continue;
          }
          if (field === "jobIds" && Array.isArray(val)) {
            remapped[field] = val
              .map((v) => remapOne(v))
              .filter((v): v is string => typeof v === "string");
            continue;
          }
          if (refTable === table) {
            // self-reference — the target may not be inserted yet
            if (idMap.has(String(val))) {
              remapped[field] = idMap.get(String(val));
            } else if (typeof val === "string") {
              remapped[field] = undefined;
              deferIndex = deferred.length;
              deferred.push({ newId: "", field, backupRef: val });
            }
            continue;
          }
          remapped[field] = remapOne(val);
        }

        const newId = (await ctx.db.insert(table as never, remapped as never)) as string;
        if (key) idMap.set(key, newId);
        if (deferIndex >= 0) deferred[deferIndex]!.newId = newId;
      }
    }

    // 3) patch deferred self-references now that all rows exist
    for (const d of deferred) {
      const resolved = idMap.get(d.backupRef);
      if (resolved !== undefined) {
        await ctx.db.patch(d.newId as Id<never>, {
          [d.field]: resolved,
        } as never);
      }
    }

    return { restored: true as const, exportedAt: backup.exportedAt };
  },
});
