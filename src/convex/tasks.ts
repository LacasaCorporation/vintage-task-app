import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const MAX_TASK_LENGTH = 280;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_ATTACHMENT_BYTES = 900_000; // ~900 KB per file (stored inline)

// ── Lists ───────────────────────────────────────────────────────────────

/** Task lists for the signed-in user, oldest first (stable order). */
export const listLists = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const lists = await ctx.db
      .query("taskLists")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return lists.sort((a, b) => a._creationTime - b._creationTime);
  },
});

/** Folders that group task lists. */
export const listFolders = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const folders = await ctx.db
      .query("taskFolders")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return folders.sort((a, b) => a._creationTime - b._creationTime);
  },
});

/** Create a folder to group lists. */
export const addFolder = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the folder a name.");
    if (clean.length > 80) throw new Error("That folder name is too long.");
    return await ctx.db.insert("taskFolders", { ownerId: userId, name: clean });
  },
});

/** Rename a folder. */
export const renameFolder = mutation({
  args: { id: v.id("taskFolders"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const folder = await ctx.db.get(id);
    if (folder === null) throw new Error("That folder no longer exists.");
    if (folder.ownerId !== userId) throw new Error("Not your folder.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the folder a name.");
    await ctx.db.patch(id, { name: clean });
  },
});

/** Delete a folder; its lists stay but become ungrouped. */
export const removeFolder = mutation({
  args: { id: v.id("taskFolders") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const folder = await ctx.db.get(id);
    if (folder === null) throw new Error("That folder no longer exists.");
    if (folder.ownerId !== userId) throw new Error("Not your folder.");
    const lists = await ctx.db
      .query("taskLists")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const l of lists) {
      if (l.folderId === id) await ctx.db.patch(l._id, { folderId: undefined });
    }
    await ctx.db.delete(id);
  },
});

/** Move a list into a folder (or out with folderId undefined). */
export const setListFolder = mutation({
  args: {
    id: v.id("taskLists"),
    folderId: v.optional(v.id("taskFolders")),
  },
  handler: async (ctx, { id, folderId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const list = await ctx.db.get(id);
    if (list === null) throw new Error("That list no longer exists.");
    if (list.ownerId !== userId) throw new Error("Not your list.");
    if (folderId !== undefined) {
      const folder = await ctx.db.get(folderId);
      if (folder === null || folder.ownerId !== userId)
        throw new Error("That folder no longer exists.");
    }
    await ctx.db.patch(id, { folderId });
  },
});

/** Create a named task list. */
export const addList = mutation({
  args: { name: v.string(), folderId: v.optional(v.id("taskFolders")) },
  handler: async (ctx, { name, folderId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the list a name.");
    if (clean.length > 80) throw new Error("That list name is too long.");
    if (folderId !== undefined) {
      const folder = await ctx.db.get(folderId);
      if (folder === null || folder.ownerId !== userId)
        throw new Error("That folder no longer exists.");
    }
    return await ctx.db.insert("taskLists", { ownerId: userId, name: clean, folderId });
  },
});

/** Rename a task list. */
export const renameList = mutation({
  args: { id: v.id("taskLists"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const list = await ctx.db.get(id);
    if (list === null) throw new Error("That list no longer exists.");
    if (list.ownerId !== userId) throw new Error("That list belongs to another account.");
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the list a name.");
    await ctx.db.patch(id, { name: clean });
  },
});

/** Delete a task list; its tasks fall back to the default list. */
export const removeList = mutation({
  args: { id: v.id("taskLists") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const list = await ctx.db.get(id);
    if (list === null) throw new Error("That list no longer exists.");
    if (list.ownerId !== userId) throw new Error("That list belongs to another account.");
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    for (const t of tasks) {
      if (t.listId === id) {
        await ctx.db.patch(t._id, { listId: undefined });
      }
    }
    await ctx.db.delete(id);
  },
});

// ── Tasks ───────────────────────────────────────────────────────────────

/**
 * All tasks for the signed-in user, newest first (filtered client-side).
 * scope "mine" (default) → only the caller's own tasks; "all" → the whole
 * workspace's tasks (org-scoped rows). Used by the Mine / ALL filter.
 */
export const list = query({
  args: { scope: v.optional(v.union(v.literal("mine"), v.literal("all"))) },
  handler: async (ctx, { scope }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    if (scope === "all") {
      const all = await ctx.db
        .query("tasks")
        .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
        .collect();
      return all.sort((a, b) => b._creationTime - a._creationTime);
    }
    const mine = await ctx.db
      .query("tasks")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
      .collect();
    // legacy rows created before assignment existed belong to their creator
    return mine
      .filter((t) => (t.assigneeId ?? t.ownerId) === userId)
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Steps (subtasks) belonging to one task. */
export const listSteps = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const task = await ctx.db.get(taskId);
    if (task === null || task.ownerId !== userId) return [];
    const steps = await ctx.db
      .query("taskSteps")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    return steps.sort((a, b) => a._creationTime - b._creationTime);
  },
});

/** Write a new entry into the ledger. */
export const add = mutation({
  args: {
    text: v.string(),
    listId: v.optional(v.id("taskLists")),
    sourcePageId: v.optional(v.id("notePages")),
    description: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    remindAt: v.optional(v.number()),
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    starred: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
    recurrence: v.optional(v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"))),
  },
  handler: async (ctx, { text, listId, sourcePageId, ...extra }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) {
      throw new Error("Sign in to write in your ledger.");
    }
    if (listId !== undefined) {
      const list = await ctx.db.get(listId);
      if (list === null || list.ownerId !== userId) {
        throw new Error("That list no longer exists.");
      }
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      throw new Error("A task needs at least a few words.");
    }
    if (trimmed.length > MAX_TASK_LENGTH) {
      throw new Error("That entry is too long for one line of the ledger.");
    }
    const tags = extra.tags?.map((t) => t.trim().replace(/^#/, "")).filter(Boolean) ?? [];
    return await ctx.db.insert("tasks", {
      ownerId: userId,
      assigneeId: userId,
      text: trimmed,
      isCompleted: false,
      listId,
      sourcePageId,
      description: extra.description?.slice(0, MAX_DESCRIPTION_LENGTH),
      dueAt: extra.dueAt,
      remindAt: extra.remindAt,
      priority: extra.priority,
      starred: extra.starred ?? false,
      tags: tags.length > 0 ? tags : undefined,
      recurrence: extra.recurrence,
    });
  },
});

/** Edit any task detail. All fields optional. */
export const update = mutation({
  args: {
    id: v.id("tasks"),
    text: v.optional(v.string()),
    description: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    remindAt: v.optional(v.number()),
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    starred: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
    listId: v.optional(v.id("taskLists")),
    recurrence: v.optional(v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"))),
    clearDue: v.optional(v.boolean()),
    clearReminder: v.optional(v.boolean()),
    clearRecurrence: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, clearDue, clearReminder, clearRecurrence, ...patch }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const task = await ctx.db.get(id);
    if (task === null) throw new Error("That entry is no longer in the ledger.");
    if (task.ownerId !== userId) throw new Error("That entry belongs to another ledger.");

    const clean: Record<string, unknown> = {};
    if (patch.text !== undefined) {
      const trimmed = patch.text.trim();
      if (trimmed.length === 0) throw new Error("A task needs at least a few words.");
      if (trimmed.length > MAX_TASK_LENGTH) throw new Error("That entry is too long.");
      clean.text = trimmed;
    }
    if (patch.description !== undefined)
      clean.description = patch.description.slice(0, MAX_DESCRIPTION_LENGTH);
    if (patch.dueAt !== undefined) clean.dueAt = patch.dueAt;
    if (patch.remindAt !== undefined) clean.remindAt = patch.remindAt;
    if (patch.priority !== undefined) clean.priority = patch.priority;
    if (patch.starred !== undefined) clean.starred = patch.starred;
    if (patch.listId !== undefined) {
      const list = await ctx.db.get(patch.listId);
      if (list === null || list.ownerId !== userId)
        throw new Error("That list no longer exists.");
      clean.listId = patch.listId;
    }
    if (patch.recurrence !== undefined) clean.recurrence = patch.recurrence;
    if (clearDue) clean.dueAt = undefined;
    if (clearReminder) clean.remindAt = undefined;
    if (clearRecurrence) clean.recurrence = undefined;
    if (patch.tags !== undefined) {
      const tags = patch.tags.map((t) => t.trim().replace(/^#/, "")).filter(Boolean);
      clean.tags = tags.length > 0 ? tags : undefined;
    }
    await ctx.db.patch(id, clean as Partial<typeof task>);
  },
});

/** Attach a file (inline data URL) to a task. */
export const addAttachment = mutation({
  args: {
    id: v.id("tasks"),
    name: v.string(),
    type: v.string(),
    size: v.number(),
    data: v.string(), // data URL
  },
  handler: async (ctx, { id, name, type, size, data }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const task = await ctx.db.get(id);
    if (task === null) throw new Error("That entry is no longer in the ledger.");
    if (task.ownerId !== userId) throw new Error("That entry belongs to another ledger.");
    if (size > MAX_ATTACHMENT_BYTES) throw new Error("That file is too large (max ~900 KB).");
    const item = { id: crypto.randomUUID(), name, type, size, data };
    const current = task.attachments ? (JSON.parse(task.attachments) as typeof item[]) : [];
    await ctx.db.patch(id, { attachments: JSON.stringify([...current, item]) });
  },
});

/** Remove an attachment from a task. */
export const removeAttachment = mutation({
  args: { id: v.id("tasks"), attachmentId: v.string() },
  handler: async (ctx, { id, attachmentId }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const task = await ctx.db.get(id);
    if (task === null) throw new Error("That entry is no longer in the ledger.");
    if (task.ownerId !== userId) throw new Error("That entry belongs to another ledger.");
    if (!task.attachments) return;
    const current = JSON.parse(task.attachments) as { id: string }[];
    await ctx.db.patch(id, {
      attachments: JSON.stringify(current.filter((a) => a.id !== attachmentId)),
    });
  },
});

// ── Subtasks (steps) ────────────────────────────────────────────────────

/** Add a step under a task. */
export const addStep = mutation({
  args: { taskId: v.id("tasks"), text: v.string() },
  handler: async (ctx, { taskId, text }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const task = await ctx.db.get(taskId);
    if (task === null) throw new Error("That entry is no longer in the ledger.");
    if (task.ownerId !== userId) throw new Error("That entry belongs to another ledger.");
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error("A step needs some words.");
    if (trimmed.length > MAX_TASK_LENGTH) throw new Error("That step is too long.");
    return await ctx.db.insert("taskSteps", {
      ownerId: userId,
      taskId,
      text: trimmed,
      isCompleted: false,
    });
  },
});

/** Rename a step. */
export const renameStep = mutation({
  args: { id: v.id("taskSteps"), text: v.string() },
  handler: async (ctx, { id, text }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const step = await ctx.db.get(id);
    if (step === null) throw new Error("That step no longer exists.");
    if (step.ownerId !== userId) throw new Error("Not your step.");
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error("A step needs some words.");
    await ctx.db.patch(id, { text: trimmed });
  },
});

/** Toggle a step's checkbox. */
export const toggleStep = mutation({
  args: { id: v.id("taskSteps") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const step = await ctx.db.get(id);
    if (step === null) throw new Error("That step no longer exists.");
    if (step.ownerId !== userId) throw new Error("Not your step.");
    await ctx.db.patch(id, { isCompleted: !step.isCompleted });
  },
});

/** Delete a step. */
export const removeStep = mutation({
  args: { id: v.id("taskSteps") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const step = await ctx.db.get(id);
    if (step === null) throw new Error("That step no longer exists.");
    if (step.ownerId !== userId) throw new Error("Not your step.");
    await ctx.db.delete(id);
  },
});

// ── Completion + recurrence ─────────────────────────────────────────────

/** Next due timestamp for a recurring task, from a base date. */
function nextDue(base: number, recurrence: "daily" | "weekly" | "monthly"): number {
  const d = new Date(base);
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

/**
 * Check off — or un-check — a ledger entry.
 * Completing a recurring task spawns the next occurrence (same text/details,
 * next due date, unchecked) so it repeats automatically.
 */
export const toggle = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) {
      throw new Error("Sign in first.");
    }
    const task = await ctx.db.get(id);
    if (task === null) {
      throw new Error("That entry is no longer in the ledger.");
    }
    if (task.ownerId !== userId) {
      throw new Error("That entry belongs to another ledger.");
    }
    const nowCompleted = !task.isCompleted;
    await ctx.db.patch(id, {
      isCompleted: nowCompleted,
      completedAt: nowCompleted ? Date.now() : undefined,
    });

    // Recurring + completing → spawn next occurrence.
    if (nowCompleted && task.recurrence) {
      const base = task.dueAt ?? Date.now();
      await ctx.db.insert("tasks", {
        ownerId: userId,
        text: task.text,
        isCompleted: false,
        listId: task.listId,
        sourcePageId: task.sourcePageId,
        description: task.description,
        dueAt: nextDue(base, task.recurrence),
        remindAt: task.remindAt
          ? nextDue(task.remindAt, task.recurrence)
          : undefined,
        priority: task.priority,
        starred: task.starred,
        tags: task.tags,
        recurrence: task.recurrence,
      });
    }
  },
});

/** Delete a task (and its steps). */
export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const task = await ctx.db.get(id);
    if (task === null) throw new Error("That entry is no longer in the ledger.");
    if (task.ownerId !== userId) throw new Error("That entry belongs to another ledger.");
    const steps = await ctx.db
      .query("taskSteps")
      .withIndex("by_task", (q) => q.eq("taskId", id))
      .collect();
    for (const s of steps) await ctx.db.delete(s._id);
    await ctx.db.delete(id);
  },
});

/** Count of a user's tasks (for admin usage stats). */
export const countByOwner = query({
  args: { ownerId: v.id("users") },
  handler: async (ctx, { ownerId }) => {
    const items = await ctx.db
      .query("tasks")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return items.length;
  },
});
