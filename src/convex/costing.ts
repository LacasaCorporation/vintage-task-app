import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { scopeUserId } from "./org";
import {
  assertNoOpenIssues,
  purgeNode,
  spawnNextOccurrence,
} from "./projectTasks";
import {
  clearAncestorsIfOrphaned,
  clearStaleProductFlag,
  flagAncestors,
  jobIdsOf,
  projectHasFlaggedWork,
} from "./flagCascade";
import { syncProductionConsumption, landRun, landableQty } from "./production";
import { getSettings } from "./settings";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
} from "../lib/project-statuses";
import { currencySymbol } from "../lib/currency";
import { isProductDone, productsOfJob } from "./jobs";
import { requireUnusedMaterial, requireUnusedProduct } from "./usage";

const MAX_NAME_LENGTH = 120;

/**
 * Generate the next sequential code for a prefix, e.g. "RM" → "RM0007".
 * Scans existing entities (owner-scoped) and returns max+1, so existing
 * codes never change; numbering continues after the highest used number.
 */
async function nextCode(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  prefix: "RM" | "FG" | "PR",
): Promise<string> {
  let max = 0;
  const scan = (code: unknown) => {
    if (typeof code !== "string" || !code.startsWith(prefix)) return;
    const n = Number.parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  };
  if (prefix === "RM") {
    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    for (const m of materials) scan(m.code);
  } else {
    const fgs = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    if (prefix === "FG") {
      for (const fg of fgs) scan(fg.code);
    } else {
      for (const fg of fgs) scan(fg.projectCode);
    }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// ── Units of measure (managed master data) ─────────────────────────────

/** All units for the user, A→Z. */
export const listUnits = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const units = await ctx.db
      .query("costUnits")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return units.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Create a unit. */
export const addUnit = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the unit a name.");
    if (clean.length > 20) throw new Error("Unit names are 20 characters max.");
    return await ctx.db.insert("costUnits", { ownerId: userId, name: clean });
  },
});

/** Rename a unit. */
export const renameUnit = mutation({
  args: { id: v.id("costUnits"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const unit = await ctx.db.get(id);
    if (unit === null) throw new Error("That unit no longer exists.");
    if (unit.ownerId !== userId) throw new Error("Not your unit.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the unit a name.");
    if (clean.length > 20) throw new Error("Unit names are 20 characters max.");
    await ctx.db.patch(id, { name: clean });
  },
});

/** Delete a unit (materials keep their copied value). */
export const removeUnit = mutation({
  args: { id: v.id("costUnits") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const unit = await ctx.db.get(id);
    if (unit === null) throw new Error("That unit no longer exists.");
    if (unit.ownerId !== userId) throw new Error("Not your unit.");
    await ctx.db.delete(id);
  },
});

// ── Categories & sub-categories (managed master data) ─────────────

/** All categories (and sub-categories) for the user, A→Z. */
export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const cats = await ctx.db
      .query("costCategories")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return cats.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Create a category, or a sub-category when parentId is given. */
export const addCategory = mutation({
  args: { name: v.string(), parentId: v.optional(v.id("costCategories")) },
  handler: async (ctx, { name, parentId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the category a name.");
    if (clean.length > MAX_NAME_LENGTH) throw new Error("That name is too long.");
    if (parentId !== undefined) {
      const parent = await ctx.db.get(parentId);
      if (parent === null || parent.ownerId !== userId)
        throw new Error("That parent category no longer exists.");
    }
    return await ctx.db.insert("costCategories", {
      ownerId: userId,
      name: clean,
      parentId,
    });
  },
});

/** Rename a category or sub-category. */
export const renameCategory = mutation({
  args: { id: v.id("costCategories"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const cat = await ctx.db.get(id);
    if (cat === null) throw new Error("That category no longer exists.");
    if (cat.ownerId !== userId) throw new Error("Not your category.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the category a name.");
    if (clean.length > MAX_NAME_LENGTH) throw new Error("That name is too long.");
    await ctx.db.patch(id, { name: clean });
  },
});

/** Delete a category or sub-category. Deleting a parent also deletes its sub-categories. */
export const removeCategory = mutation({
  args: { id: v.id("costCategories") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const cat = await ctx.db.get(id);
    if (cat === null) throw new Error("That category no longer exists.");
    if (cat.ownerId !== userId) throw new Error("Not your category.");
    const all = await ctx.db
      .query("costCategories")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    // delete the category and any children (one level of sub-categories)
    for (const c of all) {
      if (c._id === id || c.parentId === id) await ctx.db.delete(c._id);
    }
  },
});

// ── Raw materials (master list used only for costing) ───────────────────

/** All raw materials for the signed-in user, A→Z. */
export const listMaterials = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return materials.sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Add a raw material. */
export const addMaterial = mutation({
  args: {
    code: v.optional(v.string()),
    name: v.string(),
    category: v.optional(v.string()),
    subCategory: v.optional(v.string()),
    unit: v.string(),
    pricePerUnit: v.number(),
  },
  handler: async (ctx, { code, name, category, subCategory, unit, pricePerUnit }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the material a name.");
    if (clean.length > MAX_NAME_LENGTH) throw new Error("That name is too long.");
    const cleanUnit = unit.trim() || "pcs";
    if (pricePerUnit < 0) throw new Error("Price can't be negative.");
    // Auto-code: RM0001, RM0002, … unless the user typed their own code.
    const autoCode = await nextCode(ctx, userId, "RM");
    return await ctx.db.insert("rawMaterials", {
      ownerId: userId,
      code: code?.trim() || autoCode,
      name: clean,
      category: category?.trim() || undefined,
      subCategory: subCategory?.trim() || undefined,
      unit: cleanUnit,
      pricePerUnit,
    });
  },
});

/** Edit a raw material (code, name, category, sub-category, unit, or price). */
export const updateMaterial = mutation({
  args: {
    id: v.id("rawMaterials"),
    code: v.optional(v.string()),
    name: v.optional(v.string()),
    category: v.optional(v.string()),
    subCategory: v.optional(v.string()),
    unit: v.optional(v.string()),
    pricePerUnit: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const material = await ctx.db.get(id);
    if (material === null) throw new Error("That material no longer exists.");
    if (material.ownerId !== userId) throw new Error("Not your material.");
    if (patch.name !== undefined) {
      const clean = patch.name.trim();
      if (clean.length === 0) throw new Error("Give the material a name.");
      if (clean.length > MAX_NAME_LENGTH) throw new Error("That name is too long.");
      patch.name = clean;
    }
    if (patch.unit !== undefined) patch.unit = patch.unit.trim() || "pcs";
    if (patch.code !== undefined) patch.code = patch.code.trim() || undefined;
    if (patch.category !== undefined)
      patch.category = patch.category.trim() || undefined;
    if (patch.subCategory !== undefined)
      patch.subCategory = patch.subCategory.trim() || undefined;
    if (patch.pricePerUnit !== undefined && patch.pricePerUnit < 0)
      throw new Error("Price can't be negative.");
    await ctx.db.patch(id, patch);
  },
});

/**
 * Bulk-import raw materials (used by the Excel import). Re-validates every row
 * server-side so the review dialog can never write junk: duplicates either
 * update the saved price or get skipped, and unknown units/categories are
 * created once instead of once per row.
 */
export const bulkImportMaterials = mutation({
  args: {
    rows: v.array(
      v.object({
        code: v.optional(v.string()),
        name: v.string(),
        category: v.optional(v.string()),
        subCategory: v.optional(v.string()),
        unit: v.string(),
        pricePerUnit: v.number(),
      }),
    ),
    mode: v.union(v.literal("skip"), v.literal("update")),
    autoCreate: v.boolean(),
  },
  handler: async (ctx, { rows, mode, autoCreate }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    if (rows.length === 0) throw new Error("Nothing to import.");

    const materials = await ctx.db
      .query("rawMaterials")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const units = await ctx.db
      .query("costUnits")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const categories = await ctx.db
      .query("costCategories")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();

    const byCode = new Map<string, (typeof materials)[number]>();
    const byNameUnit = new Map<string, (typeof materials)[number]>();
    for (const m of materials) {
      if (m.code) byCode.set(m.code.toUpperCase(), m);
      byNameUnit.set(`${m.name.toLowerCase()}|${m.unit.toLowerCase()}`, m);
    }
    const unitByName = new Map(units.map((u) => [u.name.toLowerCase(), u] as const));
    const categoryByName = new Map(
      categories
        .filter((c) => c.parentId === undefined)
        .map((c) => [c.name.toLowerCase(), c] as const),
    );

    // sequential auto-codes, computed once and advanced as we insert
    let codeCounter = 0;
    for (const m of materials) {
      if (typeof m.code !== "string" || !m.code.startsWith("RM")) continue;
      const n = Number.parseInt(m.code.slice(2), 10);
      if (Number.isFinite(n) && n > codeCounter) codeCounter = n;
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let unitsCreated = 0;
    let categoriesCreated = 0;
    const errors: string[] = [];

    for (const [i, row] of rows.entries()) {
      const position = i + 1;
      try {
        const name = row.name.trim().slice(0, MAX_NAME_LENGTH);
        if (!name) throw new Error("missing name");
        if (!Number.isFinite(row.pricePerUnit) || row.pricePerUnit < 0)
          throw new Error("invalid price");
        const unit = row.unit.trim().slice(0, 20) || "pcs";

        // unit — create once if needed
        if (!unitByName.has(unit.toLowerCase())) {
          if (!autoCreate) throw new Error(`unknown unit “${unit}”`);
          const id = await ctx.db.insert("costUnits", { ownerId: userId, name: unit });
          unitByName.set(unit.toLowerCase(), { _id: id, name: unit, ownerId: userId } as never);
          unitsCreated++;
        }
        const unitName = unitByName.get(unit.toLowerCase())?.name ?? unit;

        // category + sub-category — create once if needed
        let categoryName: string | undefined;
        const rawCategory = row.category?.trim();
        if (rawCategory) {
          const known = categoryByName.get(rawCategory.toLowerCase());
          if (known) {
            categoryName = known.name;
          } else {
            if (!autoCreate) throw new Error(`unknown category “${rawCategory}”`);
            const id = await ctx.db.insert("costCategories", {
              ownerId: userId,
              name: rawCategory.slice(0, MAX_NAME_LENGTH),
            });
            const made = { _id: id, name: rawCategory, parentId: undefined, ownerId: userId };
            categoryByName.set(rawCategory.toLowerCase(), made as never);
            categoriesCreated++;
            categoryName = made.name;
          }
        }

        let subCategoryName: string | undefined;
        const rawSub = row.subCategory?.trim();
        if (rawSub && categoryName) {
          const parent = categoryByName.get(categoryName.toLowerCase());
          const knownSub = parent
            ? categories.find(
                (c) => c.parentId === parent._id && c.name.toLowerCase() === rawSub.toLowerCase(),
              )
            : undefined;
          if (knownSub) {
            subCategoryName = knownSub.name;
          } else if (autoCreate) {
            await ctx.db.insert("costCategories", {
              ownerId: userId,
              name: rawSub.slice(0, MAX_NAME_LENGTH),
              parentId: parent?._id,
            });
            categoriesCreated++;
            subCategoryName = rawSub;
          } else {
            throw new Error(`unknown sub-category “${rawSub}”`);
          }
        }

        // duplicate handling
        const code = row.code?.trim().toUpperCase();
        const existing =
          (code ? byCode.get(code) : undefined) ??
          byNameUnit.get(`${name.toLowerCase()}|${unitName.toLowerCase()}`);
        if (existing) {
          if (mode === "skip") {
            skipped++;
          } else {
            await ctx.db.patch(existing._id, {
              pricePerUnit: row.pricePerUnit,
              unit: unitName,
              category: categoryName,
              subCategory: subCategoryName,
            });
            updated++;
          }
          continue;
        }

        codeCounter++;
        const autoCode = `RM${String(codeCounter).padStart(4, "0")}`;
        const finalCode = code || autoCode;
        const id = await ctx.db.insert("rawMaterials", {
          ownerId: userId,
          code: finalCode,
          name,
          category: categoryName,
          subCategory: subCategoryName,
          unit: unitName,
          pricePerUnit: row.pricePerUnit,
        });
        const inserted = {
          _id: id,
          code: finalCode,
          name,
          unit: unitName,
          category: categoryName,
          subCategory: subCategoryName,
          pricePerUnit: row.pricePerUnit,
          ownerId: userId,
        };
        byCode.set(finalCode.toUpperCase(), inserted as never);
        byNameUnit.set(`${name.toLowerCase()}|${unitName.toLowerCase()}`, inserted as never);
        created++;
      } catch (error) {
        errors.push(`Row ${position}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }

    return { created, updated, skipped, unitsCreated, categoriesCreated, errors };
  },
});

/** Delete a raw material. Existing sheet lines keep their copied values. */
export const removeMaterial = mutation({
  args: { id: v.id("rawMaterials") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const material = await ctx.db.get(id);
    if (material === null) throw new Error("That material no longer exists.");
    if (material.ownerId !== userId) throw new Error("Not your material.");
    // a material sits on costing lines, arrives on purchase bills and moves
    // through the stock ledger — it can only go once nothing points at it
    await requireUnusedMaterial(ctx, userId, id, material.name);
    await ctx.db.delete(id);
  },
});

// ── Costing sheets ──────────────────────────────────────────────────────

/** All costing sheets for the signed-in user, newest first. */
export const listSheets = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const sheets = await ctx.db
      .query("costingSheets")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return sheets.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Create a costing sheet. */
export const addSheet = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the sheet a name.");
    if (clean.length > MAX_NAME_LENGTH) throw new Error("That name is too long.");
    return await ctx.db.insert("costingSheets", {
      ownerId: userId,
      name: clean,
      currency: currencySymbol((await getSettings(ctx, userId))?.currency),
      markupPct: 0,
    });
  },
});

/** Rename a costing sheet. */
export const renameSheet = mutation({
  args: { id: v.id("costingSheets"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const sheet = await ctx.db.get(id);
    if (sheet === null) throw new Error("That sheet no longer exists.");
    if (sheet.ownerId !== userId) throw new Error("Not your sheet.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the sheet a name.");
    await ctx.db.patch(id, { name: clean });
  },
});

/** Update sheet settings (currency symbol, markup %). */
export const updateSheet = mutation({
  args: {
    id: v.id("costingSheets"),
    currency: v.optional(v.string()),
    markupPct: v.optional(v.number()),
  },
  handler: async (ctx, { id, currency, markupPct }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const sheet = await ctx.db.get(id);
    if (sheet === null) throw new Error("That sheet no longer exists.");
    if (sheet.ownerId !== userId) throw new Error("Not your sheet.");
    const patch: { currency?: string; markupPct?: number } = {};
    if (currency !== undefined)
      patch.currency =
        currency.trim().slice(0, 4) ||
        currencySymbol((await getSettings(ctx, userId))?.currency);
    if (markupPct !== undefined) {
      if (markupPct < 0) throw new Error("Markup can't be negative.");
      patch.markupPct = markupPct;
    }
    await ctx.db.patch(id, patch);
  },
});

/** Delete a sheet and all its lines. */
export const removeSheet = mutation({
  args: { id: v.id("costingSheets") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const sheet = await ctx.db.get(id);
    if (sheet === null) throw new Error("That sheet no longer exists.");
    if (sheet.ownerId !== userId) throw new Error("Not your sheet.");
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_sheet", (q) => q.eq("sheetId", id))
      .collect();
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.delete(id);
  },
});

// ── Projects (full project information entity) ───────────────────────

const PROJECT_STATUSES = [
  "planning",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;
type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** All projects for the user, sorted by due date (soonest first) then name. */
export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return rows.sort((a, b) => {
      if (a.dueAt !== undefined && b.dueAt !== undefined && a.dueAt !== b.dueAt)
        return a.dueAt - b.dueAt;
      if (a.dueAt !== undefined) return -1;
      if (b.dueAt !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
  },
});

/** Create a project with full details; PR code auto-assigned. */
export const addProject = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    client: v.optional(v.string()),
    assignee: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    status: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    budget: v.optional(v.number()),
  },
  handler: async (ctx, opts) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const name = opts.name.trim();
    if (name.length === 0) throw new Error("Give the project a name.");
    const code = await nextCode(ctx, userId, "PR");
    const status = opts.status?.trim() as ProjectStatus | undefined;
    return await ctx.db.insert("projects", {
      ownerId: userId,
      name: name.slice(0, MAX_NAME_LENGTH),
      code,
      description: opts.description?.trim().slice(0, 2000) || undefined,
      client: opts.client?.trim().slice(0, 120) || undefined,
      assignee: opts.assignee?.trim().slice(0, 120) || undefined,
      dueAt: opts.dueAt,
      status:
        status && (PROJECT_STATUSES as readonly string[]).includes(status)
          ? status
          : "planning",
      priority: opts.priority,
      budget: opts.budget !== undefined && opts.budget >= 0 ? opts.budget : undefined,
    });
  },
});

/** Update any of a project's details. */
export const updateProject = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    client: v.optional(v.string()),
    assignee: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    status: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    budget: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const project = await ctx.db.get(id);
    if (project === null || project.ownerId !== userId)
      throw new Error("That project no longer exists.");
    const clean: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length === 0) throw new Error("Give the project a name.");
      clean.name = name.slice(0, MAX_NAME_LENGTH);
    }
    if (patch.description !== undefined)
      clean.description = patch.description.trim().slice(0, 2000) || undefined;
    if (patch.client !== undefined)
      clean.client = patch.client.trim().slice(0, 120) || undefined;
    if (patch.assignee !== undefined)
      clean.assignee = patch.assignee.trim().slice(0, 120) || undefined;
    if (patch.dueAt !== undefined) clean.dueAt = patch.dueAt;
    if (patch.status !== undefined) {
      const status = patch.status.trim() as ProjectStatus;
      clean.status =
        (PROJECT_STATUSES as readonly string[]).includes(status) ? status : undefined;
    }
    if (patch.priority !== undefined) clean.priority = patch.priority;
    if (patch.budget !== undefined)
      clean.budget = patch.budget >= 0 ? patch.budget : undefined;
    await ctx.db.patch(id, clean);
  },
});

/**
 * Move a project between the custom Projects statuses (the board/board-style
 * columns of the Projects workspace). The legacy `status` union is kept in
 * sync so the older surfaces keep working.
 */
export const setProjectProjectStatus = mutation({
  args: { id: v.id("projects"), status: v.string() },
  handler: async (ctx, { id, status }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const project = await ctx.db.get(id);
    if (project === null || project.ownerId !== userId)
      throw new Error("That project no longer exists.");
    const clean = status.trim().replace(/\s+/g, " ");
    if (!clean) throw new Error("Choose a status.");
    if (clean === PROJECT_STATUS_FINISH) {
      await assertNoOpenIssues(ctx, "project", id, "project");
      const jobs = await ctx.db
        .query("projectJobs")
        .withIndex("by_project", (q) => q.eq("projectId", id))
        .collect();
      const open = jobs.filter(
        (j) =>
          j.status !== "completed" &&
          j.status !== "cancelled" &&
          j.projectStatus !== PROJECT_STATUS_FINISH,
      );
      if (open.length > 0) {
        const names = open.map((j) => j.name);
        const listed =
          names.length <= 2
            ? names.join(" and ")
            : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
        throw new Error(
          `${open.length} job${open.length === 1 ? " is" : "s are"} still open on this project (${listed}). Finish the jobs, and their products, before finishing the project.`,
        );
      }
    }
    const wasFinished =
      project.projectStatus === PROJECT_STATUS_FINISH ||
      project.status === "completed";
    await ctx.db.patch(id, {
      projectStatus: clean,
      status: clean === PROJECT_STATUS_FINISH ? "completed" : clean === PROJECT_STATUS_START ? "planning" : "in_progress",
    });
    // a repeating project lays down its next occurrence once, on finishing
    if (clean === PROJECT_STATUS_FINISH && !wasFinished)
      await spawnNextOccurrence(ctx, "project", project);
  },
});

/** Delete a project (its FG products are detached, not deleted). */
export const removeProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const project = await ctx.db.get(id);
    if (project === null) return;
    if (project.ownerId !== userId) throw new Error("Not your project.");
    // a project is the last level to go: its jobs have to be deleted first
    const jobs = await ctx.db
      .query("projectJobs")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .collect();
    if (jobs.length > 0)
      throw new Error(
        `This project still has ${jobs.length} job${jobs.length === 1 ? "" : "s"}. Delete the products first, then the jobs, then the project.`,
      );
    // products that were only grouped under this project's name (no job) would
    // be left pointing at a project that no longer exists, so they are let go
    // with it — still products, still in the master list, no longer its work
    for (const fg of await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect()) {
      if ((fg.projectName ?? "") !== project.name) continue;
      const jobIds = jobIdsOf(fg);
      if (jobIds.length > 0) continue;
      await ctx.db.patch(fg._id, {
        projectName: undefined,
        projectCode: undefined,
        isFlagged: undefined,
        flaggedAt: undefined,
      });
    }
    await purgeNode(ctx, "project", id);
    await ctx.db.delete(id);
  },
});

// ── Finished goods (FG products grouped by project) ───────────────────

/** All FG products for the user, newest first. */
export const listFinishedGoods = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const fgs = await ctx.db
      .query("finishedGoods")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    // products saved before the workspace had a currency fall back to it here
    const fallback = currencySymbol((await getSettings(ctx, userId))?.currency);
    return fgs
      .map((fg) => (fg.currency === undefined ? { ...fg, currency: fallback } : fg))
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Create an FG product. projectName is optional — standalone products have
 *  no project; jobs can be attached later. */
export const addFinishedGood = mutation({
  args: {
    projectName: v.optional(v.string()),
    jobId: v.optional(v.id("projectJobs")), // single job (convenience)
    jobIds: v.optional(v.array(v.id("projectJobs"))), // several jobs at once
    name: v.string(),
    code: v.optional(v.string()),
    qty: v.optional(v.number()),
    unit: v.optional(v.string()),
    category: v.optional(v.string()),
    subCategory: v.optional(v.string()),
    note: v.optional(v.string()),
    currency: v.optional(v.string()),
    markupPct: v.optional(v.number()),
  },
  handler: async (ctx, opts) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    // the acting person, which is who the product belongs to (the id above is
    // the firm the row is scoped by, not the person)
    const creator = await getAuthUserId(ctx);
    const cleanProject = opts.projectName?.trim() ?? "";
    const cleanName = opts.name.trim();
    if (cleanName.length === 0) throw new Error("Give the product a name.");
    if (cleanName.length > MAX_NAME_LENGTH) throw new Error("That name is too long.");
    // Validate every job this product should be attached to.
    const jobSet = new Set<Id<"projectJobs">>();
    if (opts.jobId !== undefined) jobSet.add(opts.jobId);
    for (const jid of opts.jobIds ?? []) jobSet.add(jid);
    for (const jid of jobSet) {
      const job = await ctx.db.get(jid);
      if (job === null || job.ownerId !== userId)
        throw new Error("One of the chosen jobs no longer exists.");
    }
    const jobList = Array.from(jobSet);
    // Auto codes: FG0001 for the product; PR0001 shared per project name.
    const fgCode = await nextCode(ctx, userId, "FG");
    let projectCode: string | undefined;
    if (cleanProject) {
      const siblings = await ctx.db
        .query("finishedGoods")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      const existing = siblings.find((s) => s.projectName === cleanProject);
      projectCode =
        existing?.projectCode ?? (await nextCode(ctx, userId, "PR"));
    }
    // A job implies its project — fill projectName in from the first job.
    let projectName: string | undefined;
    if (cleanProject) {
      projectName = cleanProject.slice(0, MAX_NAME_LENGTH);
    } else if (jobList.length > 0) {
      const job = await ctx.db.get(jobList[0]!);
      const project = job ? await ctx.db.get(job.projectId) : null;
      if (project) projectName = project.name.slice(0, MAX_NAME_LENGTH);
    }
    return await ctx.db.insert("finishedGoods", {
      ownerId: userId,
      // the person who added the product owns it, and may hand out permissions
      ...(creator !== null
        ? { assigneeId: creator, assignedAt: Date.now(), assigneeIds: [creator] }
        : {}),
      projectName,
      projectCode,
      jobId: jobList[0],
      jobIds: jobList.length > 0 ? jobList : undefined,
      name: cleanName.slice(0, MAX_NAME_LENGTH),
      code: opts.code?.trim() || fgCode,
      qty: opts.qty !== undefined && opts.qty > 0 ? opts.qty : undefined,
      unit: opts.unit?.trim() || undefined,
      category: opts.category?.trim() || undefined,
      subCategory: opts.subCategory?.trim() || undefined,
      note: opts.note?.trim() || undefined,
      currency:
        opts.currency?.trim().slice(0, 4) ||
        currencySymbol((await getSettings(ctx, userId))?.currency),
      markupPct: opts.markupPct ?? 0,
    });
  },
});

/** Rename an FG product or change its project group. */
export const updateFinishedGood = mutation({
  args: {
    id: v.id("finishedGoods"),
    projectName: v.optional(v.string()),
    projectCode: v.optional(v.string()), // usually auto-assigned on project change
    jobId: v.optional(v.id("projectJobs")),
    jobIds: v.optional(v.array(v.id("projectJobs"))),
    name: v.optional(v.string()),
    code: v.optional(v.string()),
    qty: v.optional(v.number()),
    unit: v.optional(v.string()),
    category: v.optional(v.string()),
    subCategory: v.optional(v.string()),
    note: v.optional(v.string()),
    currency: v.optional(v.string()),
    markupPct: v.optional(v.number()),
    dueAt: v.optional(v.number()), // per-product due date (flagged board)
    priority: v.optional(
      v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    ),
    // the same extras a normal task carries
    tags: v.optional(v.array(v.string())),
    remindAt: v.optional(v.number()),
    starred: v.optional(v.boolean()),
    attachments: v.optional(v.string()), // JSON: [{id,name,type,size,data}]
    recurrence: v.optional(
      v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    ),
    clearRecurrence: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, clearRecurrence, ...patch }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null) throw new Error("That product no longer exists.");
    if (fg.ownerId !== userId) throw new Error("Not your product.");
    if (patch.projectName !== undefined) {
      const clean = patch.projectName.trim();
      if (clean.length === 0) throw new Error("Give the project a name.");
      patch.projectName = clean.slice(0, MAX_NAME_LENGTH);
      // Moving the product to another project: inherit that project's PR code,
      // or mint a fresh one if this is the first product under the new name.
      const target = patch.projectName;
      if (target !== fg.projectName) {
        const siblings = await ctx.db
          .query("finishedGoods")
          .withIndex("by_owner", (q) => q.eq("ownerId", userId))
          .collect();
        const existing = siblings.find((s) => s.projectName === target && s._id !== id);
        patch.projectCode = existing?.projectCode ?? (await nextCode(ctx, userId, "PR"));
      }
    }
    if (patch.name !== undefined) {
      const clean = patch.name.trim();
      if (clean.length === 0) throw new Error("Give the product a name.");
      patch.name = clean.slice(0, MAX_NAME_LENGTH);
    }
    if (patch.jobId !== undefined) {
      const job = await ctx.db.get(patch.jobId);
      if (job === null || job.ownerId !== userId)
        throw new Error("That job no longer exists.");
    }
    if (patch.jobIds !== undefined) {
      for (const jid of patch.jobIds) {
        const job = await ctx.db.get(jid);
        if (job === null || job.ownerId !== userId)
          throw new Error("One of the chosen jobs no longer exists.");
      }
      const unique = Array.from(new Set(patch.jobIds));
      patch.jobIds = unique.length > 0 ? unique : undefined;
      // keep the legacy single link in sync with the first job
      patch.jobId = unique[0];
    }
    if (patch.code !== undefined) patch.code = patch.code.trim() || undefined;
    if (patch.qty !== undefined) {
      if (patch.qty < 0) throw new Error("Quantity can't be negative.");
      patch.qty = patch.qty > 0 ? patch.qty : undefined;
    }
    if (patch.unit !== undefined) patch.unit = patch.unit.trim() || undefined;
    if (patch.category !== undefined)
      patch.category = patch.category.trim() || undefined;
    if (patch.subCategory !== undefined)
      patch.subCategory = patch.subCategory.trim() || undefined;
    if (patch.note !== undefined) patch.note = patch.note.trim() || undefined;
    if (patch.markupPct !== undefined && patch.markupPct < 0)
      throw new Error("Markup can't be negative.");
    if (patch.currency !== undefined)
      patch.currency =
        patch.currency.trim().slice(0, 4) ||
        currencySymbol((await getSettings(ctx, userId))?.currency);
    if (clearRecurrence === true) patch.recurrence = undefined;
    await ctx.db.patch(id, patch);
    await clearStaleProductFlag(ctx, userId, id, jobIdsOf(fg));
    // moving a product into a job that was already finished reopens it
    for (const jid of patch.jobIds ?? []) {
      await syncJobCompletion(ctx, userId, jid);
    }
  },
});

/**
 * Delete an FG product, its costing lines, its steps and its per-person grants.
 * Products are the first level of the delete order: a job can only go once its
 * products are gone, and a project only once its jobs are gone.
 */
/**
 * Why a product is off limits, or null when it can be changed. A product that
 * is on the line or already finished is part of the project's record: its
 * costs are in the totals and its units may have been invoiced, so it cannot
 * be edited, detached or deleted out from under them.
 */
function lockedReason(fg: Doc<"finishedGoods">): string | null {
  if (fg.productionStartedAt !== undefined || (fg.inProduction ?? 0) > 0) {
    return "This product is in production. Stop production before changing it.";
  }
  if (fg.isCompleted === true || fg.projectStatus === PROJECT_STATUS_FINISH) {
    return "This product is completed, so its costs and stock are already on the books.";
  }
  return null;
}

export const removeFinishedGood = mutation({
  args: { id: v.id("finishedGoods") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null) throw new Error("That product no longer exists.");
    if (fg.ownerId !== userId) throw new Error("Not your product.");
    // production is holding raw materials out of stock: stop it first, which
    // puts them back, so the ledger and the stock levels stay honest
    if (fg.productionStartedAt !== undefined)
      throw new Error(
        "Production is running on this product. Stop production first, then delete the product.",
      );
    if (fg.isCompleted === true || fg.projectStatus === PROJECT_STATUS_FINISH) {
      throw new Error(
        "This product is completed. Its cost and stock are already on the books, so it can't be deleted.",
      );
    }
    // a product still sitting under a project or job belongs to that
    // hierarchy's totals — take it out of the project first
    if (
      fg.projectName !== undefined ||
      (fg.jobIds ?? []).length > 0 ||
      fg.jobId !== undefined
    ) {
      throw new Error(
        "This product is under a project. Remove it from the project first, then delete it.",
      );
    }
    // and it cannot go while a document still points at it — an invoice, a
    // quotation, a delivery note, or its own stock and production history
    await requireUnusedProduct(ctx, userId, id, fg.name);
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_fg", (q) => q.eq("fgId", id))
      .collect();
    for (const item of items) await ctx.db.delete(item._id);
    const steps = await ctx.db
      .query("fgSteps")
      .withIndex("by_fg", (q) => q.eq("fgId", id))
      .collect();
    for (const step of steps) await ctx.db.delete(step._id);
    const grants = await ctx.db
      .query("fgGrants")
      .withIndex("by_fg", (q) => q.eq("fgId", id))
      .collect();
    for (const grant of grants) await ctx.db.delete(grant._id);
    // the stock ledger belongs to the product, so it goes with it
    const movements = await ctx.db
      .query("productMovements")
      .withIndex("by_product", (q) => q.eq("productId", id))
      .collect();
    for (const movement of movements) await ctx.db.delete(movement._id);
    // and the conversation and issues hanging off it
    await purgeNode(ctx, "product", id);
    await ctx.db.delete(id);
  },
});

/**
 * Attach (or detach) a product to/from a job. A product can be attached to
 * several jobs at the same time. projectName follows the first job's project.
 */
/**
 * Keep a job's own completion honest: a job reads as finished only while every
 * product under it is finished. Give a finished job a product and it reopens,
 * because it now has work to do — the list can never show "Completed" above
 * products that are still to be made. The project above follows it back.
 */
async function syncJobCompletion(
  ctx: MutationCtx,
  userId: Id<"users">,
  jobId: Id<"projectJobs">,
): Promise<void> {
  const job = await ctx.db.get(jobId);
  if (job === null || job.ownerId !== userId) return;
  const finished =
    job.status === "completed" || job.projectStatus === PROJECT_STATUS_FINISH;
  if (!finished) return;
  const open = (await productsOfJob(ctx, userId, jobId)).filter(
    (f) => !isProductDone(f),
  );
  if (open.length === 0) return;
  await ctx.db.patch(jobId, {
    status: "in_progress",
    projectStatus: undefined,
    completedAt: undefined,
  });
  // a project can't stay finished while one of its jobs is open again
  const project = await ctx.db.get(job.projectId);
  if (
    project !== null &&
    project.ownerId === userId &&
    (project.status === "completed" ||
      project.projectStatus === PROJECT_STATUS_FINISH)
  ) {
    await ctx.db.patch(project._id, {
      status: "in_progress",
      projectStatus: undefined,
    });
  }
}

export const setFgJobs = mutation({
  args: {
    id: v.id("finishedGoods"),
    jobIds: v.array(v.id("projectJobs")), // full new list (empty = detach all)
  },
  handler: async (ctx, { id, jobIds }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null) throw new Error("That product no longer exists.");
    if (fg.ownerId !== userId) throw new Error("Not your product.");
    const unique = Array.from(new Set(jobIds));
    for (const jid of unique) {
      const job = await ctx.db.get(jid);
      if (job === null || job.ownerId !== userId)
        throw new Error("One of the chosen jobs no longer exists.");
    }
    let projectName: string | undefined;
    if (unique.length > 0) {
      const job = await ctx.db.get(unique[0]!);
      const project = job ? await ctx.db.get(job.projectId) : null;
      if (project) projectName = project.name.slice(0, MAX_NAME_LENGTH);
    } else {
      // fully detached → back to standalone; clear the project group too
      projectName = undefined;
    }
    await ctx.db.patch(id, {
      jobIds: unique.length > 0 ? unique : undefined,
      jobId: unique[0],
      projectName,
      projectCode: unique.length > 0 ? fg.projectCode : undefined,
    });
    // newly attached work reopens a job that had already been finished
    for (const jid of unique) await syncJobCompletion(ctx, userId, jid);
    // a product taken out of every job (or out of a project) is not project
    // work any more, so a flag it was carrying does not stay on the board
    await clearStaleProductFlag(ctx, userId, id, jobIdsOf(fg));
  },
});

/**
 * Attach a product to a job. The batch is asked for at the moment the link is
 * made, so one product can carry a different quantity against each job.
 */
export const attachToJob = mutation({
  args: {
    fgId: v.id("finishedGoods"),
    jobId: v.id("projectJobs"),
    qty: v.number(),
  },
  handler: async (ctx, { fgId, jobId, qty }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    const job = await ctx.db.get(jobId);
    if (job === null || job.ownerId !== userId)
      throw new Error("That job no longer exists.");
    if (fg.productionStartedAt !== undefined)
      throw new Error("Stop production before re-linking this product.");
    if (!Number.isFinite(qty) || qty <= 0)
      throw new Error("Enter how many this job needs.");

    const existing = (await ctx.db
      .query("jobProducts")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect()
    ).find((r) => r.jobId === jobId);

    if (existing) {
      await ctx.db.patch(existing._id, { qty });
    } else {
      await ctx.db.insert("jobProducts", {
        ownerId: userId,
        jobId,
        fgId,
        qty,
        createdAt: Date.now(),
      });
    }

    const jobIds = Array.from(new Set([...(fg.jobIds ?? []), jobId]));
    const project = await ctx.db.get(job.projectId);
    await syncJobCompletion(ctx, userId, jobId);
    await ctx.db.patch(fgId, {
      jobIds,
      jobId: fg.jobId ?? jobId,
      projectName: project?.name.slice(0, MAX_NAME_LENGTH) ?? fg.projectName,
      projectCode: project?.code ?? fg.projectCode,
      // the product's own default follows the job it was first linked to
      qty: fg.qty ?? qty,
    });
  },
});

/** Detach a product from one job, keeping any other links. */
export const detachFromJob = mutation({
  args: { fgId: v.id("finishedGoods"), jobId: v.id("projectJobs") },
  handler: async (ctx, { fgId, jobId }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    const locked = lockedReason(fg);
    if (locked !== null) throw new Error(locked);

    const rows = await ctx.db
      .query("jobProducts")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();
    for (const row of rows) {
      if (row.jobId === jobId) await ctx.db.delete(row._id);
    }

    const jobIds = (fg.jobIds ?? []).filter((id) => id !== jobId);
    if (jobIds.length === 0) {
      // nothing left to link to, so it becomes standalone again — the product
      // itself is untouched, it just leaves the project
      await ctx.db.patch(fgId, {
        jobIds: undefined,
        jobId: undefined,
        projectName: undefined,
        projectCode: undefined,
      });
      await syncJobCompletion(ctx, userId, jobId);
      await clearStaleProductFlag(ctx, userId, fgId, [jobId]);
      return;
    }
    await ctx.db.patch(fgId, { jobIds, jobId: jobIds[0] });
    await syncJobCompletion(ctx, userId, jobId);
    await clearStaleProductFlag(ctx, userId, fgId, [jobId]);
  },
});

/**
 * Take a product out of a project it is only grouped under — it stays a
 * standalone product and keeps its stock, recipe and history.
 */
export const detachFromProject = mutation({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }): Promise<void> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    const locked = lockedReason(fg);
    if (locked !== null) throw new Error(locked);
    if (fg.projectName === undefined)
      throw new Error("That product isn't under a project.");
    await ctx.db.patch(fgId, {
      projectName: undefined,
      projectCode: undefined,
    });
    // it keeps its flag only while it still belongs to one of its jobs
    await clearStaleProductFlag(ctx, userId, fgId, jobIdsOf(fg));
  },
});

/** The batch each job needs, keyed `jobId|fgId`, for the project totals. */
export const listJobProducts = query({
  args: {},
  handler: async (ctx): Promise<{ jobId: string; fgId: string; qty: number }[]> => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("jobProducts")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return rows.map((r) => ({ jobId: r.jobId, fgId: r.fgId, qty: r.qty }));
  },
});

/**
 * Flag (or unflag) a product. A flagged product surfaces as a subtask under
 * its job; flagging a product also turns the flag on for its job and for that
 * job's project, so the whole chain shows in the Productions view. Unflagging
 * clears only the product — the job and project keep their flag until nothing
 * flagged is left under them.
 */
export const setFgFlag = mutation({
  args: { id: v.id("finishedGoods"), flagged: v.boolean() },
  handler: async (ctx, { id, flagged }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    const jobIds = jobIdsOf(fg);
    if (flagged && jobIds.length === 0)
      throw new Error("Attach the product to a job before flagging it.");
    const flaggedAt = flagged ? Date.now() : undefined;
    await ctx.db.patch(id, { isFlagged: flagged || undefined, flaggedAt });
    if (flagged) {
      // inherit due date & priority from the parent job at flag time
      const parent = jobIds.length > 0 ? await ctx.db.get(jobIds[0]!) : null;
      if (fg.dueAt === undefined && parent?.dueAt !== undefined)
        await ctx.db.patch(id, { dueAt: parent.dueAt });
      if (fg.priority === undefined && parent?.priority !== undefined)
        await ctx.db.patch(id, { priority: parent.priority });
      // a newly flagged product starts its life as "Listed"
      if (fg.projectStatus === undefined) {
        await ctx.db.patch(id, { projectStatus: PROJECT_STATUS_START });
      }
      // cascade up: a flagged product flags its job, and the job's project
      await flagAncestors(ctx, userId, jobIds, Date.now());
    } else {
      // the product was the last flagged thing under its job or project, so
      // they drop the flag it lent them
      await clearAncestorsIfOrphaned(ctx, userId, jobIds);
    }
  },
});

/**
 * Flag (or unflag) a project. Flagging turns the flag on for the project and
 * for every job and product under it. Unflagging is refused while anything
 * under the project is still flagged — clear the products first.
 */
export const setProjectFlag = mutation({
  args: { id: v.id("projects"), flagged: v.boolean() },
  handler: async (ctx, { id, flagged }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const project = await ctx.db.get(id);
    if (project === null || project.ownerId !== userId)
      throw new Error("That project no longer exists.");
    const jobs = await ctx.db
      .query("projectJobs")
      .withIndex("by_project", (q) => q.eq("projectId", id))
      .collect();
    const flaggedAt = flagged ? Date.now() : undefined;

    if (flagged) {
      await ctx.db.patch(id, { isFlagged: true, flaggedAt });
      const fgs = await ctx.db
        .query("finishedGoods")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      for (const job of jobs) {
        if (job.ownerId !== userId) continue;
        if (job.isFlagged !== true) {
          await ctx.db.patch(job._id, { isFlagged: true, flaggedAt });
        }
        for (const fg of fgs) {
          if (fg.isFlagged === true || !jobIdsOf(fg).includes(job._id)) continue;
          await ctx.db.patch(fg._id, {
            isFlagged: true,
            flaggedAt,
            dueAt: fg.dueAt ?? job.dueAt,
            priority: fg.priority ?? job.priority,
            ...(fg.projectStatus === undefined
              ? { projectStatus: PROJECT_STATUS_START }
              : {}),
          });
        }
      }
      return;
    }

    if (await projectHasFlaggedWork(ctx, userId, id))
      throw new Error(
        "This project still has flagged work under it — remove the flag from its products first.",
      );
    await ctx.db.patch(id, { isFlagged: undefined, flaggedAt: undefined });
  },
});

/** Move a product to an ordered custom Projects status. */
export const setFgProjectStatus = mutation({
  args: { id: v.id("finishedGoods"), status: v.string() },
  handler: async (ctx, { id, status }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    const clean = status.trim().replace(/\s+/g, " ");
    if (!clean) throw new Error("Choose a status.");
    const isFinish = clean === PROJECT_STATUS_FINISH;
    if (isFinish) {
      await assertNoOpenIssues(ctx, "product", id, "product");
      // finishing a product is what puts its units on the shelf, so the
      // project status and the stock ledger can never disagree
      await landRun(ctx, userId, fg, landableQty(fg));
    }
    const wasFinished =
      fg.projectStatus === PROJECT_STATUS_FINISH || fg.isCompleted === true;
    await ctx.db.patch(id, {
      projectStatus: clean,
      isCompleted: isFinish || undefined,
      completedAt: isFinish ? fg.completedAt ?? Date.now() : undefined,
    });
    // a repeating product lays down its next occurrence once, on finishing
    if (isFinish && !wasFinished) await spawnNextOccurrence(ctx, "product", fg);

    const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
    for (const jid of jobIds) {
      const job = await ctx.db.get(jid);
      if (job === null || job.ownerId !== userId || job.isFlagged !== true) continue;
      const products = (await productsOfJob(ctx, userId, jid)).filter((f) => f.isFlagged);
      if (products.length === 0) continue;
      const everyDone = products.every(isProductDone);
      await ctx.db.patch(jid, {
        projectStatus: everyDone ? PROJECT_STATUS_FINISH : job.projectStatus === PROJECT_STATUS_FINISH ? undefined : job.projectStatus,
        status: everyDone ? "completed" : job.status === "completed" ? "in_progress" : job.status,
        completedAt: everyDone ? job.completedAt ?? Date.now() : undefined,
      });
    }
    // and if any product under the job is still open, it cannot read as done
    for (const jid of jobIds) await syncJobCompletion(ctx, userId, jid);
  },
});

/**
 * Check off (or un-check) a flagged product in the todo list.
 * When every flagged product of a job is completed, the job itself is marked
 * completed (status → "completed"); un-checking reopens it (→ "in_progress").
 */
export const setFgCompleted = mutation({
  args: { id: v.id("finishedGoods"), completed: v.boolean() },
  handler: async (ctx, { id, completed }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    const wasDone = fg.isCompleted === true;
    if (completed) {
      await assertNoOpenIssues(ctx, "product", id, "product");
      // ticking a product off is finishing it: its units land in stock
      await landRun(ctx, userId, fg, landableQty(fg));
    }
    await ctx.db.patch(id, {
      isCompleted: completed || undefined,
      projectStatus: completed ? PROJECT_STATUS_FINISH : PROJECT_STATUS_START,
      completedAt: completed ? Date.now() : undefined,
    });
    // a repeating product lays down its next occurrence once, on finishing
    if (completed && !wasDone) await spawnNextOccurrence(ctx, "product", fg);

    // update each job the product belongs to: complete it when all of its
    // flagged products are done, reopen it otherwise
    const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
    for (const jid of jobIds) {
      const job = await ctx.db.get(jid);
      if (job === null || job.ownerId !== userId || job.isFlagged !== true)
        continue;
      const products = (await productsOfJob(ctx, userId, jid)).filter((f) => f.isFlagged);
      if (products.length === 0) continue;
      const everyDone = products.every((f) => f.isCompleted === true);
      if (everyDone && job.status !== "completed") {
        await ctx.db.patch(jid, {
          projectStatus: PROJECT_STATUS_FINISH,
          status: "completed",
          completedAt: Date.now(),
        });
      } else if (!everyDone && job.status === "completed") {
        await ctx.db.patch(jid, {
          projectStatus: PROJECT_STATUS_START,
          status: "in_progress",
          completedAt: undefined,
        });
      }
    }
    // and if any product under the job is still open, it cannot read as done
    for (const jid of jobIds) await syncJobCompletion(ctx, userId, jid);
  },
});

/**
 * Clone an FG product: copies name (with " (copy)"), code (new FG code),
 * unit, category, note, currency, markup, image, and all costing lines.
 * Job/project links are NOT copied — the clone starts standalone.
 */
export const cloneFinishedGood = mutation({
  args: { id: v.id("finishedGoods") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null) throw new Error("That product no longer exists.");
    if (fg.ownerId !== userId) throw new Error("Not your product.");
    const fgCode = await nextCode(ctx, userId, "FG");
    const cloneId = await ctx.db.insert("finishedGoods", {
      ownerId: userId,
      name: `${fg.name.slice(0, MAX_NAME_LENGTH - 7)} (copy)`.slice(
        0,
        MAX_NAME_LENGTH,
      ),
      code: fgCode,
      unit: fg.unit,
      category: fg.category,
      subCategory: fg.subCategory,
      note: fg.note,
      imageUrl: fg.imageUrl,
      imageAlt: fg.imageAlt,
      currency:
        fg.currency ?? currencySymbol((await getSettings(ctx, userId))?.currency),
      markupPct: fg.markupPct ?? 0,
    });
    // copy every costing line
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_fg", (q) => q.eq("fgId", id))
      .collect();
    for (const item of items) {
      await ctx.db.insert("costingItems", {
        ownerId: userId,
        fgId: cloneId,
        materialId: item.materialId,
        label: item.label,
        qty: item.qty,
        unitPrice: item.unitPrice,
        unit: item.unit,
      });
    }
    return cloneId;
  },
});

const MAX_IMAGE_BYTES = 900_000; // ~900 KB, matches task attachments

/** Set (or replace) the product photo — stored as a data URL. */
export const setFgImage = mutation({
  args: {
    id: v.id("finishedGoods"),
    data: v.string(), // data URL
    name: v.optional(v.string()), // original file name
    size: v.optional(v.number()),
  },
  handler: async (ctx, { id, data, name, size }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null) throw new Error("That product no longer exists.");
    if (fg.ownerId !== userId) throw new Error("Not your product.");
    if (size !== undefined && size > MAX_IMAGE_BYTES)
      throw new Error("That image is too large (max ~900 KB).");
    if (!data.startsWith("data:image/")) throw new Error("Only image files are supported.");
    await ctx.db.patch(id, { imageUrl: data, imageAlt: name?.trim() || undefined });
  },
});

/** Remove the product photo. */
export const clearFgImage = mutation({
  args: { id: v.id("finishedGoods") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null) throw new Error("That product no longer exists.");
    if (fg.ownerId !== userId) throw new Error("Not your product.");
    await ctx.db.patch(id, { imageUrl: undefined, imageAlt: undefined });
  },
});

// ── Sheet lines ─────────────────────────────────────────────────────────

/** Every costing line for the user (for per-product totals across FGs). */
export const listAllItems = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return items.sort((a, b) => a._creationTime - b._creationTime);
  },
});

/** Lines of one FG product, in creation order (rows of the grid). */
export const listFgItems = query({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId) return [];
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();
    return items.sort((a, b) => a._creationTime - b._creationTime);
  },
});

/** Lines of one legacy sheet, in creation order. */
export const listItems = query({
  args: { sheetId: v.id("costingSheets") },
  handler: async (ctx, { sheetId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const sheet = await ctx.db.get(sheetId);
    if (sheet === null || sheet.ownerId !== userId) return [];
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_sheet", (q) => q.eq("sheetId", sheetId))
      .collect();
    return items.sort((a, b) => a._creationTime - b._creationTime);
  },
});

/** Legacy: add a line to a sheet (pre-FG flow). Kept while the UI migrates. */
export const addItem = mutation({
  args: {
    sheetId: v.id("costingSheets"),
    materialId: v.optional(v.id("rawMaterials")),
    label: v.optional(v.string()),
    qty: v.number(),
  },
  handler: async (ctx, { sheetId, materialId, label, qty }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const sheet = await ctx.db.get(sheetId);
    if (sheet === null || sheet.ownerId !== userId)
      throw new Error("That sheet no longer exists.");
    if (qty <= 0) throw new Error("Quantity must be greater than zero.");

    if (materialId !== undefined) {
      const material = await ctx.db.get(materialId);
      if (material === null || material.ownerId !== userId)
        throw new Error("That material no longer exists.");
      return await ctx.db.insert("costingItems", {
        ownerId: userId,
        sheetId,
        materialId,
        label: material.name,
        qty,
        unitPrice: material.pricePerUnit,
        unit: material.unit,
      });
    }

    const clean = label?.trim();
    if (!clean) throw new Error("Give the line a description.");
    return await ctx.db.insert("costingItems", {
      ownerId: userId,
      sheetId,
      label: clean.slice(0, MAX_NAME_LENGTH),
      qty,
      unitPrice: 0,
    });
  },
});

/**
 * Add a line to an FG product. For a raw-material row, pass materialId and
 * qty — name/unit/price are copied from the master list (costing only).
 */
export const addFgItem = mutation({
  args: {
    fgId: v.id("finishedGoods"),
    materialId: v.optional(v.id("rawMaterials")),
    label: v.optional(v.string()),
    qty: v.number(),
    unitPrice: v.optional(v.number()),
  },
  handler: async (ctx, { fgId, materialId, label, qty, unitPrice }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    if (qty <= 0) throw new Error("Quantity must be greater than zero.");

    if (materialId !== undefined) {
      const material = await ctx.db.get(materialId);
      if (material === null || material.ownerId !== userId)
        throw new Error("That material no longer exists.");
      // Merge duplicates: if this material is already on the sheet with the
      // same unit price, just add to its quantity instead of a new row.
      const existing = await ctx.db
        .query("costingItems")
        .withIndex("by_fg", (q) => q.eq("fgId", fgId))
        .collect();
      const twin = existing.find(
        (it) =>
          it.materialId === materialId &&
          it.unitPrice === material.pricePerUnit &&
          it.label === material.name,
      );
      if (twin) {
        await ctx.db.patch(twin._id, { qty: twin.qty + qty });
        await syncProductionConsumption(ctx, fg);
        return twin._id;
      }
      const newId = await ctx.db.insert("costingItems", {
        ownerId: userId,
        fgId,
        materialId,
        label: material.name,
        qty,
        unitPrice: material.pricePerUnit,
        unit: material.unit,
      });
      await syncProductionConsumption(ctx, fg);
      return newId;
    }

    const clean = label?.trim();
    if (!clean) throw new Error("Give the line a description.");
    return await ctx.db.insert("costingItems", {
      ownerId: userId,
      fgId,
      label: clean.slice(0, MAX_NAME_LENGTH),
      qty,
      unitPrice: unitPrice ?? 0,
    });
  },
});

/** Edit a line (qty, unit price, or label). */
export const updateItem = mutation({
  args: {
    id: v.id("costingItems"),
    label: v.optional(v.string()),
    qty: v.optional(v.number()),
    unitPrice: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const item = await ctx.db.get(id);
    if (item === null) throw new Error("That line no longer exists.");
    if (item.ownerId !== userId) throw new Error("Not your line.");
    if (patch.qty !== undefined && patch.qty < 0) throw new Error("Qty can't be negative.");
    if (patch.unitPrice !== undefined && patch.unitPrice < 0)
      throw new Error("Price can't be negative.");
    if (patch.label !== undefined) {
      const clean = patch.label.trim();
      if (clean.length === 0) throw new Error("Give the line a description.");
      patch.label = clean.slice(0, MAX_NAME_LENGTH);
    }
    await ctx.db.patch(id, patch);
    // changing the qty of a line on a product that is in production moves the
    // stock by the difference, so stopping it returns the right amounts
    if (patch.qty !== undefined && item.fgId !== undefined) {
      const fg = await ctx.db.get(item.fgId);
      if (fg !== null && fg.ownerId === userId) {
        await syncProductionConsumption(ctx, fg);
      }
    }
  },
});

/** Delete a line. */
export const removeItem = mutation({
  args: { id: v.id("costingItems") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const item = await ctx.db.get(id);
    if (item === null) throw new Error("That line no longer exists.");
    if (item.ownerId !== userId) throw new Error("Not your line.");
    const fg = item.fgId !== undefined ? await ctx.db.get(item.fgId) : null;
    await ctx.db.delete(id);
    // the removed material goes back into stock while production is running
    if (fg !== null && fg.ownerId === userId) {
      await syncProductionConsumption(ctx, fg);
    }
  },
});

/**
 * Merge duplicate lines on a product sheet: rows with the same description,
 * unit price, and unit collapse into one row with the combined quantity.
 * Returns how many rows were removed. Safe to run repeatedly.
 */
export const mergeFgDuplicateItems = mutation({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();
    const groups = new Map<string, typeof items>();
    for (const it of items) {
      const key = `${it.label}::${it.unitPrice}::${it.unit ?? ""}`;
      const list = groups.get(key) ?? [];
      list.push(it);
      groups.set(key, list);
    }
    let removed = 0;
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // Keep a material-linked row when possible, else the oldest.
      const keep = list.find((it) => it.materialId !== undefined) ?? list[0]!;
      const totalQty = list.reduce((s, it) => s + it.qty, 0);
      await ctx.db.patch(keep._id, { qty: totalQty });
      for (const it of list) {
        if (it._id !== keep._id) {
          await ctx.db.delete(it._id);
          removed += 1;
        }
      }
    }
    return removed;
  },
});
