import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
} from "../lib/project-statuses";

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
      currency: "$",
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
    if (currency !== undefined) patch.currency = currency.trim().slice(0, 4) || "$";
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

/** Delete a project (its FG products are detached, not deleted). */
export const removeProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const project = await ctx.db.get(id);
    if (project === null) return;
    if (project.ownerId !== userId) throw new Error("Not your project.");
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
    return fgs.sort((a, b) => b._creationTime - a._creationTime);
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
      projectName,
      projectCode,
      jobId: jobList[0],
      jobIds: jobList.length > 0 ? jobList : undefined,
      name: cleanName.slice(0, MAX_NAME_LENGTH),
      code: opts.code?.trim() || fgCode,
      unit: opts.unit?.trim() || undefined,
      category: opts.category?.trim() || undefined,
      subCategory: opts.subCategory?.trim() || undefined,
      note: opts.note?.trim() || undefined,
      currency: opts.currency?.trim().slice(0, 4) || "$",
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
  },
  handler: async (ctx, { id, ...patch }) => {
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
    if (patch.unit !== undefined) patch.unit = patch.unit.trim() || undefined;
    if (patch.category !== undefined)
      patch.category = patch.category.trim() || undefined;
    if (patch.subCategory !== undefined)
      patch.subCategory = patch.subCategory.trim() || undefined;
    if (patch.note !== undefined) patch.note = patch.note.trim() || undefined;
    if (patch.markupPct !== undefined && patch.markupPct < 0)
      throw new Error("Markup can't be negative.");
    if (patch.currency !== undefined) patch.currency = patch.currency.trim().slice(0, 4) || "$";
    await ctx.db.patch(id, patch);
  },
});

/** Delete an FG product and all its costing lines. */
export const removeFinishedGood = mutation({
  args: { id: v.id("finishedGoods") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null) throw new Error("That product no longer exists.");
    if (fg.ownerId !== userId) throw new Error("Not your product.");
    const items = await ctx.db
      .query("costingItems")
      .withIndex("by_fg", (q) => q.eq("fgId", id))
      .collect();
    for (const item of items) await ctx.db.delete(item._id);
    await ctx.db.delete(id);
  },
});

/**
 * Attach (or detach) a product to/from a job. A product can be attached to
 * several jobs at the same time. projectName follows the first job's project.
 */
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
  },
});

/**
 * Flag (or unflag) a product. A flagged product surfaces as a subtask under
 * its job; flagging a product also turns the job's flag on so the job shows
 * as the main task in the todo list. Unflagging only clears the product.
 */
export const setFgFlag = mutation({
  args: { id: v.id("finishedGoods"), flagged: v.boolean() },
  handler: async (ctx, { id, flagged }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null || fg.ownerId !== userId)
      throw new Error("That product no longer exists.");
    if (flagged && fg.jobId === undefined && (fg.jobIds ?? []).length === 0)
      throw new Error("Attach the product to a job before flagging it.");
    const flaggedAt = flagged ? Date.now() : undefined;
    await ctx.db.patch(id, { isFlagged: flagged || undefined, flaggedAt });
    if (flagged) {
      // inherit due date & priority from the parent job at flag time
      const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
      const parent = jobIds.length > 0 ? await ctx.db.get(jobIds[0]!) : null;
      if (fg.dueAt === undefined && parent?.dueAt !== undefined)
        await ctx.db.patch(id, { dueAt: parent.dueAt });
      if (fg.priority === undefined && parent?.priority !== undefined)
        await ctx.db.patch(id, { priority: parent.priority });
      // cascade up: the job of a flagged product is flagged as well
      for (const jid of jobIds) {
        const job = await ctx.db.get(jid);
        if (job !== null && job.ownerId === userId && job.isFlagged !== true) {
          await ctx.db.patch(jid, { isFlagged: true, flaggedAt });
        }
      }
    }
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
    await ctx.db.patch(id, {
      projectStatus: clean,
      isCompleted: isFinish || undefined,
      completedAt: isFinish ? fg.completedAt ?? Date.now() : undefined,
    });

    const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
    for (const jid of jobIds) {
      const job = await ctx.db.get(jid);
      if (job === null || job.ownerId !== userId || job.isFlagged !== true) continue;
      const all = await ctx.db
        .query("finishedGoods")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      const products = all.filter(
        (f) => f.isFlagged && (f.jobId === jid || (f.jobIds ?? []).includes(jid)),
      );
      if (products.length === 0) continue;
      const everyDone = products.every((f) => f.projectStatus === PROJECT_STATUS_FINISH || f.isCompleted === true);
      await ctx.db.patch(jid, {
        projectStatus: everyDone ? PROJECT_STATUS_FINISH : job.projectStatus === PROJECT_STATUS_FINISH ? undefined : job.projectStatus,
        status: everyDone ? "completed" : job.status === "completed" ? "in_progress" : job.status,
        completedAt: everyDone ? job.completedAt ?? Date.now() : undefined,
      });
    }
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
    await ctx.db.patch(id, {
      isCompleted: completed || undefined,
      projectStatus: completed ? PROJECT_STATUS_FINISH : PROJECT_STATUS_START,
      completedAt: completed ? Date.now() : undefined,
    });

    // update each job the product belongs to: complete it when all of its
    // flagged products are done, reopen it otherwise
    const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
    for (const jid of jobIds) {
      const job = await ctx.db.get(jid);
      if (job === null || job.ownerId !== userId || job.isFlagged !== true)
        continue;
      const all = await ctx.db
        .query("finishedGoods")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect();
      const products = all.filter(
        (f) => f.isFlagged && (f.jobId === jid || (f.jobIds ?? []).includes(jid)),
      );
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
      currency: fg.currency ?? "$",
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
        return twin._id;
      }
      return await ctx.db.insert("costingItems", {
        ownerId: userId,
        fgId,
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
    await ctx.db.delete(id);
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
