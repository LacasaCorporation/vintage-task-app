import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

// page formatting: body font family
export const noteFontValidator = v.union(
  v.literal("sans"),
  v.literal("serif"),
  v.literal("mono"),
  v.literal("hand"),
);

// page formatting: notebook color label
export const noteColorValidator = v.union(
  v.literal("default"),
  v.literal("indigo"),
  v.literal("violet"),
  v.literal("sky"),
  v.literal("teal"),
  v.literal("emerald"),
  v.literal("amber"),
  v.literal("orange"),
  v.literal("rose"),
  v.literal("pink"),
);

// page formatting: ink (text) color
export const noteInkValidator = v.union(
  v.literal("default"),
  v.literal("indigo"),
  v.literal("emerald"),
  v.literal("amber"),
  v.literal("rose"),
  v.literal("sky"),
);

const MAX_TITLE_LENGTH = 120;
const MAX_PAGE_TITLE_LENGTH = 160;
const MAX_BODY_LENGTH = 20000;

/**
 * All notebooks the caller can see, newest first.
 * scope "mine" (default) → notebooks created by the caller; "all" → the
 * whole workspace's notebooks. Used by the Mine / ALL filter in Notes.
 */
export const listNotebooks = query({
  args: { scope: v.optional(v.union(v.literal("mine"), v.literal("all"))) },
  handler: async (ctx, { scope }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const notebooks = await ctx.db
      .query("notebooks")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
      .collect();
    const visible =
      scope === "all"
        ? notebooks
        : notebooks.filter((nb) => (nb.createdBy ?? nb.ownerId) === userId);
    return visible.sort((a, b) => b._creationTime - a._creationTime);
  },
});

/**
 * First-run seeding: when the user opens Notes and has no notebooks yet,
 * create "My Workbook" with one "Untitled page". Idempotent — returns the
 * new notebook id (or null if notebooks already exist).
 */
export const ensureDefaultWorkbook = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const existing = await ctx.db
      .query("notebooks")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    if (existing.length > 0) return null;
    const notebookId = await ctx.db.insert("notebooks", {
      ownerId: userId,
      title: "My Workbook",
      color: "default",
    });
    await ctx.db.insert("notePages", {
      ownerId: userId,
      notebookId,
      title: "Untitled page",
      body: "",
      numbered: false,
      font: "sans",
      color: "default",
      inkColor: "default",
      order: 1,
    });
    return notebookId;
  },
});

/** Create a notebook. */
export const addNotebook = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to create a notebook.");
    const cleanTitle = title.trim();
    if (cleanTitle.length === 0) throw new Error("Give the notebook a title.");
    if (cleanTitle.length > MAX_TITLE_LENGTH)
      throw new Error("That title is too long.");
    return await ctx.db.insert("notebooks", { ownerId: userId, title: cleanTitle });
  },
});

/** Rename a notebook. */
export const renameNotebook = mutation({
  args: { id: v.id("notebooks"), title: v.string() },
  handler: async (ctx, { id, title }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const nb = await ctx.db.get(id);
    if (nb === null) throw new Error("That notebook no longer exists.");
    if (nb.ownerId !== userId) throw new Error("That notebook belongs to another account.");
    const cleanTitle = title.trim();
    if (cleanTitle.length === 0) throw new Error("Give the notebook a title.");
    if (cleanTitle.length > MAX_TITLE_LENGTH) throw new Error("That title is too long.");
    await ctx.db.patch(id, { title: cleanTitle });
  },
});

/** Delete a notebook and all pages inside it. */
export const removeNotebook = mutation({
  args: { id: v.id("notebooks") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const nb = await ctx.db.get(id);
    if (nb === null) throw new Error("That notebook no longer exists.");
    if (nb.ownerId !== userId) throw new Error("That notebook belongs to another account.");
    const pages = await ctx.db
      .query("notePages")
      .withIndex("by_notebook", (q) => q.eq("notebookId", id))
      .collect();
    for (const page of pages) await ctx.db.delete(page._id);
    await ctx.db.delete(id);
  },
});

/** Pages of a notebook, ordered by the user's chosen order (fallback: creation). */
export const listPages = query({
  args: { notebookId: v.id("notebooks") },
  handler: async (ctx, { notebookId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const nb = await ctx.db.get(notebookId);
    if (nb === null || nb.ownerId !== userId) return [];
    const pages = await ctx.db
      .query("notePages")
      .withIndex("by_notebook", (q) => q.eq("notebookId", notebookId))
      .collect();
    return pages.sort(
      (a, b) =>
        (a.order ?? a._creationTime) - (b.order ?? b._creationTime),
    );
  },
});

/**
 * All pages the caller can see (for the sidebar tree), ordered.
 * scope "mine" (default) → pages the caller created; "all" → workspace-wide.
 */
export const listAllPages = query({
  args: { scope: v.optional(v.union(v.literal("mine"), v.literal("all"))) },
  handler: async (ctx, { scope }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const pages = await ctx.db
      .query("notePages")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
      .collect();
    const visible =
      scope === "all"
        ? pages
        : pages.filter((p) => (p.createdBy ?? p.ownerId) === userId);
    return visible.sort(
      (a, b) =>
        (a.order ?? a._creationTime) - (b.order ?? b._creationTime),
    );
  },
});

/** Count of a user's notebooks (for admin usage stats). */
export const countNotebooksByOwner = query({
  args: { ownerId: v.id("users") },
  handler: async (ctx, { ownerId }) => {
    const items = await ctx.db
      .query("notebooks")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return items.length;
  },
});

/** Count of a user's note pages (for admin usage stats). */
export const countPagesByOwner = query({
  args: { ownerId: v.id("users") },
  handler: async (ctx, { ownerId }) => {
    const items = await ctx.db
      .query("notePages")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return items.length;
  },
});

/** One page by id (ownership-checked), for tab lookups. */
export const getPage = query({
  args: { id: v.id("notePages") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return null;
    const page = await ctx.db.get(id);
    if (page === null || page.ownerId !== userId) return null;
    return page;
  },
});

/** Create a page (or sub-page with parentId) at the end of its level. Returns the new page id. */
export const addPage = mutation({
  args: {
    notebookId: v.id("notebooks"),
    title: v.optional(v.string()),
    parentId: v.optional(v.id("notePages")),
  },
  handler: async (ctx, { notebookId, title, parentId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in to create a page.");
    const nb = await ctx.db.get(notebookId);
    if (nb === null) throw new Error("That notebook no longer exists.");
    if (nb.ownerId !== userId) throw new Error("That notebook belongs to another account.");
    const existing = await ctx.db
      .query("notePages")
      .withIndex("by_notebook", (q) => q.eq("notebookId", notebookId))
      .collect();
    const siblings = parentId
      ? existing.filter((p) => p.parentId === parentId)
      : existing.filter((p) => !p.parentId);
    const maxOrder = siblings.reduce((m, p) => Math.max(m, p.order ?? 0), 0);
    return await ctx.db.insert("notePages", {
      ownerId: userId,
      notebookId,
      title: title?.trim() || "Untitled page",
      body: "",
      parentId,
      numbered: false,
      font: "sans",
      color: "default",
      inkColor: "default",
      order: maxOrder + 1,
    });
  },
});

/** Delete a page, its sub-pages, and detach tasks flagged from it. */
export const removePage = mutation({
  args: { id: v.id("notePages") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const page = await ctx.db.get(id);
    if (page === null) throw new Error("That page no longer exists.");
    if (page.ownerId !== userId) throw new Error("That page belongs to another account.");
    const all = await ctx.db
      .query("notePages")
      .withIndex("by_notebook", (q) => q.eq("notebookId", page.notebookId))
      .collect();
    // collect descendant ids (sub-pages) breadth-first
    const toDelete: Id<"notePages">[] = [id];
    let frontier: Id<"notePages">[] = [id];
    while (frontier.length > 0) {
      const next: Id<"notePages">[] = [];
      for (const pid of frontier) {
        for (const p of all) {
          if (p.parentId === pid) {
            next.push(p._id);
          }
        }
      }
      toDelete.push(...next);
      frontier = next;
    }
    // detach tasks flagged from any deleted page
    const allTasks = await ctx.db
      .query("tasks")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const t of allTasks) {
      if (t.sourcePageId && toDelete.includes(t.sourcePageId)) {
        await ctx.db.patch(t._id, { sourcePageId: undefined });
      }
    }
    for (const pid of toDelete) {
      const doc = await ctx.db.get(pid);
      if (doc !== null) await ctx.db.delete(doc._id);
    }
  },
});

/** Update a page: title, body, drawing, or formatting. All fields optional. */
export const updatePage = mutation({
  args: {
    id: v.id("notePages"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    drawing: v.optional(v.string()),
    images: v.optional(v.string()),
    numbered: v.optional(v.boolean()),
    font: v.optional(noteFontValidator),
    color: v.optional(noteColorValidator),
    inkColor: v.optional(noteInkValidator),
  },
  handler: async (ctx, { id, ...patch }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const page = await ctx.db.get(id);
    if (page === null) throw new Error("That page no longer exists.");
    if (page.ownerId !== userId) throw new Error("That page belongs to another account.");
    if (patch.title !== undefined) {
      const cleanTitle = patch.title.trim();
      if (cleanTitle.length === 0) throw new Error("Page title can't be empty.");
      if (cleanTitle.length > MAX_PAGE_TITLE_LENGTH)
        throw new Error("That page title is too long.");
      patch.title = cleanTitle;
    }
    if (patch.body !== undefined && patch.body.length > MAX_BODY_LENGTH)
      throw new Error("That page is too long.");
    await ctx.db.patch(id, patch);
  },
});
