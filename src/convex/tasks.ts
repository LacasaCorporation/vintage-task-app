import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  activeFirmSettings,
  assignableIds,
  firmAncestors,
  firmTeam,
  scopeUserId,
} from "./org";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  canItem,
  type ActionKey,
  type GranularPerms,
} from "../lib/permissions";

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
 * Who a task really belongs to, or undefined when nobody was ever recorded.
 *
 * Rows written before ownership was tracked carry the *firm's* owner id in
 * assigneeId — the author was never stored, so it cannot be recovered. Those
 * are reported as unowned (shared) rather than pinned to the wrong person,
 * which is what made "Mine" empty and every row look like it was the owner's.
 */
function ownerOf(
  task: Doc<"tasks">,
  firmOwnerId: Id<"users">,
): Id<"users"> | undefined {
  if (task.assigneeId === undefined) return undefined;
  if (task.assigneeId === firmOwnerId && task.assignedAt === undefined) {
    return undefined;
  }
  return task.assigneeId;
}

/** Everyone a task is assigned to. Falls back to its single owner. */
function assigneesOf(
  task: Doc<"tasks">,
  firmOwnerId: Id<"users">,
): Id<"users">[] {
  if (task.assigneeIds !== undefined && task.assigneeIds.length > 0) {
    return task.assigneeIds;
  }
  const owner = ownerOf(task, firmOwnerId);
  return owner === undefined ? [] : [owner];
}

/** The distinct people attached to a task: its owner plus its assignees. */
function peopleOf(
  task: Doc<"tasks">,
  firmOwnerId: Id<"users">,
): Id<"users">[] {
  return [...new Set([...assigneesOf(task, firmOwnerId), ownerOf(task, firmOwnerId)].filter(
    (id): id is Id<"users"> => id !== undefined,
  ))];
}

/**
 * All tasks the caller may see, newest first (filtered client-side).
 *
 * scope "mine" (default) → tasks the caller owns or is assigned. "all" →
 * everything they are allowed to know about: their own, their reports' (the
 * down line) and their managers' (the up line). The firm's top user sees the
 * whole firm, and a sibling manager's tasks stay hidden from each other.
 *
 * A task with no known owner is shared: it appears in both, because we cannot
 * know who wrote it and hiding it would make a task disappear.
 */
/**
 * May the caller see and work with tasks that belong to somebody else?
 *
 * Without the grant, a task assigned to one of your managers is not yours to
 * read: the team chain is still followed downwards, so you keep seeing your
 * own reports' work, but a manager's own task stays with them.
 */
async function canTouchOthersTasks(
  ctx: QueryCtx,
  userId: Id<"users">,
  action: ActionKey,
): Promise<boolean> {
  const firm = await activeFirmSettings(ctx, userId);
  if (firm === null) return true; // no workspace yet — nothing to enforce
  if (firm.ownerId === userId) return true; // the top user sees the firm
  const me = firm.members.find((m) => m.userId === userId);
  if (me === undefined) return false;

  const member = me.permissions as GranularPerms | undefined;
  let perms: GranularPerms | undefined = member;
  if (me.customRoleId !== undefined) {
    const role = await ctx.db.get(me.customRoleId);
    if (role !== null) {
      const base = role.permissions as GranularPerms | undefined;
      perms = {
        ...base,
        ...member,
        items: {
          ...base?.items,
          ...member?.items,
          othersTasks: {
            ...base?.items?.othersTasks,
            ...member?.items?.othersTasks,
          },
        },
      };
    }
  }
  return canItem(perms, "othersTasks", action);
}

export const list = query({
  args: { scope: v.optional(v.union(v.literal("mine"), v.literal("all"))) },
  handler: async (ctx, { scope }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const all = await ctx.db
      .query("tasks")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
      .collect();
    // a task assigned to a group belongs to everyone in it, so their members
    // see it in "mine" and in "all" just like an individual assignee
    const groups = await ctx.db
      .query("userGroups")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
      .collect();
    const groupMembers = new Map(groups.map((g) => [g._id, g.memberIds]));
    const people = all.map((t) => [
      ...new Set([
        ...peopleOf(t, orgId),
        ...(t.groupIds ?? []).flatMap((id) => groupMembers.get(id) ?? []),
      ]),
    ]);
    if (scope === "all") {
      const [down, up] = await Promise.all([
        firmTeam(ctx, userId),
        firmAncestors(ctx, userId),
      ]);
      // Reaching up is what would expose a manager's own tasks, so it is only
      // done for someone allowed to see other people's work.
      const maySeeOthers = await canTouchOthersTasks(ctx, userId, "view");
      const reachable = new Set(maySeeOthers ? [...down, ...up] : down);
      // the top user has the whole firm in view
      const isTopUser = userId === orgId;
      return all
        .filter((_, i) => {
          const who = people[i];
          if (who.length === 0) return true;
          return isTopUser || who.some((id) => reachable.has(id));
        })
        .sort((a, b) => b._creationTime - a._creationTime);
    }
    return all
      .filter((_, i) => {
        const who = people[i];
        return who.length === 0 || who.includes(userId);
      })
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

/**
 * Everyone in the active firm with a display label and their manager, plus the
 * caller's own place in the chain. That is enough for the client to render the
 * team tree, work out who may be handed a task, and name a task's assignees.
 * Any member may read it: it only describes people in their own firm.
 */
export const people = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { me: null, firmOwnerId: null, people: [] };
    const firm = await activeFirmSettings(ctx, userId);
    const ids =
      firm === null
        ? [userId]
        : [firm.ownerId, ...firm.members.map((m) => m.userId)];
    const rows = await Promise.all(
      [...new Set(ids)].map(async (id) => {
        const user = await ctx.db.get(id);
        const login = await ctx.db
          .query("credentials")
          .withIndex("by_user", (q) => q.eq("userId", id))
          .first();
        const member = firm?.members.find((m) => m.userId === id);
        return {
          userId: id,
          // name → sign-in username → email, the same order the sidebar uses
          label: user?.name ?? login?.username ?? user?.email ?? "Someone",
          managerId: (member?.managerId as Id<"users"> | undefined) ?? null,
          isFirmOwner: firm !== null && id === firm.ownerId,
        };
      }),
    );
    return { me: userId, firmOwnerId: firm?.ownerId ?? null, people: rows };
  },
});

/**
 * Hand a task to one or more people, or take it off everyone.
 *
 * The task's owner, anyone above them in the chain, and the firm's top user may
 * reassign — and only to themselves or their own down line, which is what makes
 * "give this to my whole team" one safe action rather than a way to hand work
 * sideways to a peer. A task nobody owns can be claimed by any member.
 */
export const assign = mutation({
  args: {
    id: v.id("tasks"),
    userIds: v.array(v.id("users")),
    /** Whole groups of people (Settings → User groups) to assign it to. */
    groupIds: v.optional(v.array(v.id("userGroups"))),
  },
  handler: async (ctx, { id, userIds, groupIds }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const orgId = await scopeUserId(ctx);
    if (orgId === null) throw new Error("Sign in first.");
    const task = await ctx.db.get(id);
    if (task === null || task.ownerId !== orgId) {
      throw new Error("That entry no longer exists.");
    }
    const current = peopleOf(task, orgId);
    const up = await firmAncestors(ctx, userId);
    const mayReassign =
      current.length === 0 ||
      userId === orgId ||
      current.some((id) => id === userId || up.includes(id));
    if (!mayReassign) {
      throw new Error(
        "Only the task owner, their manager, or the firm owner can assign this task.",
      );
    }
    const allowed = await assignableIds(ctx, userId);
    const targets = [...new Set(userIds)];
    if (targets.some((id) => !allowed.has(id))) {
      throw new Error(
        "You can only assign a task to yourself or to someone who reports to you.",
      );
    }
    // Groups are curated in Settings by the firm owner and admins, so any of
    // the firm's groups may be used — unlike picking people one by one.
    const groups = [...new Set(groupIds ?? [])];
    for (const groupId of groups) {
      const group = await ctx.db.get(groupId);
      if (group === null || group.ownerId !== orgId) {
        throw new Error("One of those groups no longer exists.");
      }
    }
    await ctx.db.patch(id, {
      assigneeIds: targets.length > 0 ? targets : undefined,
      groupIds: groups.length > 0 ? groups : undefined,
    });
    return { assigneeIds: targets, groupIds: groups };
  },
});

/**
 * Hand a subtask to people or a group in its own right — the same rule as a
 * task, so a step can sit with the carpenter even when the job sits with the
 * foreman. Who may do it is judged on the step's own holders, falling back to
 * the task's when the step has none yet.
 */
export const assignStep = mutation({
  args: {
    id: v.id("taskSteps"),
    userIds: v.array(v.id("users")),
    groupIds: v.optional(v.array(v.id("userGroups"))),
  },
  handler: async (ctx, { id, userIds, groupIds }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const orgId = await scopeUserId(ctx);
    if (orgId === null) throw new Error("Sign in first.");
    const step = await ctx.db.get(id);
    if (step === null || step.ownerId !== orgId) {
      throw new Error("That subtask no longer exists.");
    }
    const current = [...new Set(step.assigneeIds ?? [])];
    const up = await firmAncestors(ctx, userId);
    const mayReassign =
      current.length === 0 ||
      userId === orgId ||
      current.some((who) => who === userId || up.includes(who));
    if (!mayReassign) {
      throw new Error(
        "Only the subtask holder, their manager, or the firm owner can assign this subtask.",
      );
    }
    const allowed = await assignableIds(ctx, userId);
    const targets = [...new Set(userIds)];
    if (targets.some((who) => !allowed.has(who))) {
      throw new Error(
        "You can only assign a subtask to yourself or to someone who reports to you.",
      );
    }
    const groups = [...new Set(groupIds ?? [])];
    for (const groupId of groups) {
      const group = await ctx.db.get(groupId);
      if (group === null || group.ownerId !== orgId) {
        throw new Error("One of those groups no longer exists.");
      }
    }
    await ctx.db.patch(id, {
      assigneeIds: targets.length > 0 ? targets : undefined,
      groupIds: groups.length > 0 ? groups : undefined,
    });
    return { assigneeIds: targets, groupIds: groups };
  },
});

/**
 * Who may do what with one task.
 *
 * The task's owner — the person who created it, or the firm's top user — has
 * every permission and hands the rest out explicitly, so handing a task on
 * never silently gives someone the power to delete or re-date it. A task with
 * no known owner (written before ownership was tracked) stays open to the firm,
 * as it was before grants existed.
 */
export type TaskRights = {
  isOwner: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canComplete: boolean;
  canChangeOptions: boolean;
};

/** The person who owns a task, or null when its author was never recorded. */
function ownerIdOf(
  task: Doc<"tasks">,
  orgId: Id<"users">,
): Id<"users"> | null {
  if (task.assigneeId === undefined) return null;
  // a legacy row stamped with the firm's own id has no known author
  if (task.assigneeId === orgId && task.assignedAt === undefined) return null;
  return task.assigneeId;
}

async function grantOf(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
  userId: Id<"users">,
) {
  const rows = await ctx.db
    .query("taskGrants")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  return rows.find((g) => g.userId === userId);
}

/** The caller's rights on one task, resolved from ownership then grants. */
export const myRights = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }): Promise<TaskRights> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return {
        isOwner: false,
        canEdit: false,
        canDelete: false,
        canComplete: false,
        canChangeOptions: false,
      };
    }
    const orgId = await scopeUserId(ctx);
    if (orgId === null) {
      return {
        isOwner: false,
        canEdit: false,
        canDelete: false,
        canComplete: false,
        canChangeOptions: false,
      };
    }
    const task = await ctx.db.get(taskId);
    if (task === null || task.ownerId !== orgId) {
      return {
        isOwner: false,
        canEdit: false,
        canDelete: false,
        canComplete: false,
        canChangeOptions: false,
      };
    }
    return await rightsFor(ctx, task, orgId, userId);
  },
});

async function rightsFor(
  ctx: QueryCtx | MutationCtx,
  task: Doc<"tasks">,
  orgId: Id<"users">,
  userId: Id<"users">,
): Promise<TaskRights> {
  const owner = ownerIdOf(task, orgId);
  const isOwner =
    owner === null ? userId === orgId : owner === userId || userId === orgId;
  if (isOwner) {
    return {
      isOwner: true,
      canEdit: true,
      canDelete: true,
      canComplete: true,
      canChangeOptions: true,
    };
  }
  if (owner === null) {
    // nobody owns it, so it behaves as it did before grants existed
    return {
      isOwner: false,
      canEdit: true,
      canDelete: true,
      canComplete: true,
      canChangeOptions: true,
    };
  }
  const grant = await grantOf(ctx, task._id, userId);
  if (grant === undefined) {
    return {
      isOwner: false,
      canEdit: false,
      canDelete: false,
      canComplete: false,
      canChangeOptions: false,
    };
  }
  return {
    isOwner: false,
    canEdit: grant.canEdit,
    canDelete: grant.canDelete,
    canComplete: grant.canComplete,
    canChangeOptions: grant.canChangeOptions,
  };
}

/**
 * The caller's rights on many tasks at once, so a list of rows can show each
 * one's tick box and buttons without a query per row. One round trip, one entry
 * per task that exists and is in the caller's firm.
 */
export const myRightsForList = query({
  args: { ids: v.array(v.id("tasks")) },
  handler: async (
    ctx,
    { ids },
  ): Promise<{ rights: ({ taskId: Id<"tasks"> } & TaskRights)[] }> => {
    const userId = await getAuthUserId(ctx);
    const orgId = await scopeUserId(ctx);
    if (userId === null || orgId === null) return { rights: [] };
    const out: ({ taskId: Id<"tasks"> } & TaskRights)[] = [];
    for (const id of ids.slice(0, 200)) {
      const task = await ctx.db.get(id);
      if (task === null || task.ownerId !== orgId) continue;
      const rights = await rightsFor(ctx, task, orgId, userId);
      out.push({ taskId: id, ...rights });
    }
    return { rights: out };
  },
});

/**
 * Every permission this task's owner has handed out. Only the owner and the
 * firm's top user can read the whole list; anyone else sees just their own.
 */
export const grants = query({
  args: { taskId: v.id("tasks") },
  handler: async (
    ctx,
    { taskId },
  ): Promise<{
    isOwner: boolean;
    grants: {
      userId: Id<"users">;
      canEdit: boolean;
      canDelete: boolean;
      canComplete: boolean;
      canChangeOptions: boolean;
    }[];
  }> => {
    const userId = await getAuthUserId(ctx);
    const orgId = await scopeUserId(ctx);
    if (userId === null || orgId === null) {
      return { isOwner: false, grants: [] };
    }
    const task = await ctx.db.get(taskId);
    if (task === null || task.ownerId !== orgId) {
      return { isOwner: false, grants: [] };
    }
    const rows = await ctx.db
      .query("taskGrants")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    const shape = (g: (typeof rows)[number]) => ({
      userId: g.userId,
      canEdit: g.canEdit,
      canDelete: g.canDelete,
      canComplete: g.canComplete,
      canChangeOptions: g.canChangeOptions,
    });
    const owner = ownerIdOf(task, orgId);
    if (userId === orgId || owner === userId) {
      return { isOwner: true, grants: rows.map(shape) };
    }
    const mine = rows.filter((g) => g.userId === userId);
    return { isOwner: false, grants: mine.map(shape) };
  },
});

/**
 * Give or take back one person's permissions on a task. The owner starts with
 * everything and hands out the rest here; clearing all four removes the row, so
 * "no permission" is the same as no grant at all.
 */
export const setGrant = mutation({
  args: {
    taskId: v.id("tasks"),
    userId: v.id("users"),
    canEdit: v.boolean(),
    canDelete: v.boolean(),
    canComplete: v.boolean(),
    canChangeOptions: v.boolean(),
  },
  handler: async (
    ctx,
    { taskId, userId, canEdit, canDelete, canComplete, canChangeOptions },
  ): Promise<{ userId: Id<"users"> }> => {
    const caller = await getAuthUserId(ctx);
    if (caller === null) throw new Error("Sign in first.");
    const orgId = await scopeUserId(ctx);
    if (orgId === null) throw new Error("Sign in first.");
    const task = await ctx.db.get(taskId);
    if (task === null || task.ownerId !== orgId) {
      throw new Error("That entry no longer exists.");
    }
    const owner = ownerIdOf(task, orgId);
    if (owner !== caller && orgId !== caller) {
      throw new Error(
        "Only the person who created this task can change who may edit it.",
      );
    }
    // permissions only make sense for someone the task is actually with
    const holders = peopleOf(task, orgId);
    if (!holders.includes(userId)) {
      throw new Error("Assign the task to that person first.");
    }
    const nothing =
      !canEdit && !canDelete && !canComplete && !canChangeOptions;
    const existing = await grantOf(ctx, taskId, userId);
    if (nothing) {
      if (existing !== undefined) await ctx.db.delete(existing._id);
      return { userId };
    }
    if (existing === undefined) {
      await ctx.db.insert("taskGrants", {
        ownerId: orgId,
        taskId,
        userId,
        canEdit,
        canDelete,
        canComplete,
        canChangeOptions,
        grantedBy: caller,
        grantedAt: Date.now(),
      });
      return { userId };
    }
    await ctx.db.patch(existing._id, {
      canEdit,
      canDelete,
      canComplete,
      canChangeOptions,
      grantedBy: caller,
      grantedAt: Date.now(),
    });
    return { userId };
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

/**
 * Every subtask in the current scope in one round trip, so the task list can
 * show a subtask count and dropdown on each row without a query per row.
 */
export const listAllSteps = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const steps = await ctx.db
      .query("taskSteps")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
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
    // ownerId scopes the row to the firm; assigneeId must be the *person*
    // writing it, or "Mine" could never match anyone but the firm owner.
    const creator = await getAuthUserId(ctx);
    if (creator === null) {
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
      assigneeId: creator,
      assignedAt: Date.now(),
      // the creator owns it and starts out assigned to it
      assigneeIds: [creator],
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

    // Two different permissions live on this one mutation: the wording and
    // notes are "edit", while the date, priority, repeat, tags and star are
    // "change options" — the task owner hands them out separately.
    const actor = await getAuthUserId(ctx);
    if (actor !== null) {
      const rights = await rightsFor(ctx, task, userId, actor);
      const touchingOptions =
        clearDue === true ||
        clearReminder === true ||
        clearRecurrence === true ||
        patch.dueAt !== undefined ||
        patch.remindAt !== undefined ||
        patch.priority !== undefined ||
        patch.recurrence !== undefined ||
        patch.tags !== undefined ||
        patch.starred !== undefined ||
        patch.listId !== undefined;
      if (touchingOptions) {
        if (!rights.canChangeOptions) {
          throw new Error(
            "You can see this task, but only its owner can change its date, priority or repeat.",
          );
        }
      } else if (!rights.canEdit) {
        throw new Error(
          "You can see this task, but only its owner can edit it.",
        );
      }
    }

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

/** Add a step under a task. Its due date can never pass the task's own. */
export const addStep = mutation({
  args: {
    taskId: v.id("tasks"),
    text: v.string(),
    description: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    remindAt: v.optional(v.number()),
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    tags: v.optional(v.array(v.string())),
    starred: v.optional(v.boolean()),
    recurrence: v.optional(v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"))),
    attachments: v.optional(v.string()),
    /** Copy every detail field from the parent task. */
    copyFromTask: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { taskId, text, copyFromTask } = args;
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const task = await ctx.db.get(taskId);
    if (task === null) throw new Error("That entry is no longer in the ledger.");
    if (task.ownerId !== userId) throw new Error("That entry belongs to another ledger.");
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error("A step needs some words.");
    if (trimmed.length > MAX_TASK_LENGTH) throw new Error("That step is too long.");
    const pick = <T,>(fromTask: T | undefined, own: T | undefined) =>
      copyFromTask ? fromTask : own;
    // a subtask is never due later than the task it belongs to
    const rawDue = pick(task.dueAt, args.dueAt);
    const cappedDue =
      rawDue !== undefined && task.dueAt !== undefined && rawDue > task.dueAt
        ? task.dueAt
        : rawDue;
    return await ctx.db.insert("taskSteps", {
      ownerId: userId,
      taskId,
      text: trimmed,
      isCompleted: false,
      description: pick(task.description, args.description),
      dueAt: cappedDue,
      remindAt: pick(task.remindAt, args.remindAt),
      priority: pick(task.priority, args.priority),
      tags: pick(task.tags, args.tags),
      starred: pick(task.starred, args.starred),
      recurrence: pick(task.recurrence, args.recurrence),
      attachments: pick(task.attachments, args.attachments),
    });
  },
});

/**
 * Update a step's details — the same fields a task has. The due date is always
 * capped by the parent task's due date.
 */
export const updateStep = mutation({
  args: {
    id: v.id("taskSteps"),
    text: v.optional(v.string()),
    description: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    remindAt: v.optional(v.number()),
    priority: v.optional(v.union(v.literal("high"), v.literal("medium"), v.literal("low"))),
    tags: v.optional(v.array(v.string())),
    starred: v.optional(v.boolean()),
    recurrence: v.optional(v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"))),
    attachments: v.optional(v.string()),
    /** Copy every detail field from the parent task. */
    copyFromTask: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { id, text, copyFromTask } = args;
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const step = await ctx.db.get(id);
    if (step === null) throw new Error("That step no longer exists.");
    if (step.ownerId !== userId) throw new Error("Not your step.");
    const task = await ctx.db.get(step.taskId);
    const patch: Partial<typeof step> = {};
    if (text !== undefined) {
      const trimmed = text.trim();
      if (trimmed.length === 0) throw new Error("A step needs some words.");
      patch.text = trimmed;
    }
    if (args.description !== undefined) patch.description = args.description;
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.tags !== undefined) patch.tags = args.tags;
    if (args.starred !== undefined) patch.starred = args.starred;
    if (args.recurrence !== undefined) patch.recurrence = args.recurrence;
    if (args.remindAt !== undefined) patch.remindAt = args.remindAt;
    if (args.attachments !== undefined) patch.attachments = args.attachments;
    if (copyFromTask === true && task !== null) {
      patch.description = task.description;
      patch.dueAt = task.dueAt;
      patch.remindAt = task.remindAt;
      patch.priority = task.priority;
      patch.tags = task.tags;
      patch.starred = task.starred;
      patch.recurrence = task.recurrence;
      patch.attachments = task.attachments;
    } else {
      const rawDue = args.dueAt;
      if (rawDue !== undefined) {
        patch.dueAt =
          task !== null && task.dueAt !== undefined && rawDue > task.dueAt
            ? task.dueAt
            : rawDue;
      }
    }
    await ctx.db.patch(id, patch);
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

/**
 * Toggle a step's checkbox. A task can only be checked off once every one of
 * its subtasks is done, so reopening a subtask reopens the task as well.
 */
export const toggleStep = mutation({
  args: { id: v.id("taskSteps") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const step = await ctx.db.get(id);
    if (step === null) throw new Error("That step no longer exists.");
    if (step.ownerId !== userId) throw new Error("Not your step.");
    const nowCompleted = !step.isCompleted;
    if (nowCompleted) {
      // the same rule as a task: a subtask is not finished while something
      // reported against it is still open
      const issues = await ctx.db
        .query("taskIssues")
        .withIndex("by_step", (q) => q.eq("stepId", id))
        .collect();
      const open = issues.filter((i) => !(i.isSolved ?? false));
      if (open.length > 0) {
        throw new Error(
          open.length === 1
            ? "Clear the open issue on this subtask first."
            : `Clear the ${open.length} open issues on this subtask first.`,
        );
      }
    }
    await ctx.db.patch(id, {
      isCompleted: nowCompleted,
      completedAt: nowCompleted ? Date.now() : undefined,
    });

    // finishing the last subtask doesn't auto-complete the task — the user
    // checks the task off themselves — but reopening a subtask always
    // reopens the task, so a task is never done with open subtasks
    if (!nowCompleted) {
      const task = await ctx.db.get(step.taskId);
      if (task !== null && task.ownerId === userId && task.isCompleted) {
        await ctx.db.patch(task._id, { isCompleted: false, completedAt: undefined });
      }
    }
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
    // issues raised against it, and its own thread, would be left pointing at
    // nothing
    const issues = await ctx.db
      .query("taskIssues")
      .withIndex("by_step", (q) => q.eq("stepId", id))
      .collect();
    for (const issue of issues) await ctx.db.delete(issue._id);
    const comments = await ctx.db
      .query("taskComments")
      .withIndex("by_step", (q) => q.eq("stepId", id))
      .collect();
    for (const comment of comments) await ctx.db.delete(comment._id);
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
    // ticking a task off needs the "complete" permission its owner handed out
    const actor = await getAuthUserId(ctx);
    if (actor !== null) {
      const rights = await rightsFor(ctx, task, userId, actor);
      if (!rights.canComplete) {
        throw new Error(
          "You can see this task, but only its owner can complete it.",
        );
      }
    }
    const nowCompleted = !task.isCompleted;
    if (nowCompleted) {
      // a task can only be finished once every subtask is finished
      const open = await ctx.db
        .query("taskSteps")
        .withIndex("by_task", (q) => q.eq("taskId", id))
        .collect();
      if (open.some((s) => !s.isCompleted)) {
        throw new Error("Finish all subtasks before completing this task.");
      }
      // and once everything that went wrong on it — on the task or on any of
      // its subtasks — has been put right
      const issues = await ctx.db
        .query("taskIssues")
        .withIndex("by_task", (q) => q.eq("taskId", id))
        .collect();
      const openIssues = issues.filter((i) => !(i.isSolved ?? false));
      if (openIssues.length > 0) {
        throw new Error(
          openIssues.length === 1
            ? "Clear the open issue before completing this task."
            : `Clear the ${openIssues.length} open issues before completing this task.`,
        );
      }
    }
    await ctx.db.patch(id, {
      isCompleted: nowCompleted,
      completedAt: nowCompleted ? Date.now() : undefined,
    });

    // Recurring + completing → spawn next occurrence.
    if (nowCompleted && task.recurrence) {
      const base = task.dueAt ?? Date.now();
      await ctx.db.insert("tasks", {
        ownerId: userId,
        // the follow-up belongs to whoever owns the original, and inherits
        // whether that owner was ever actually recorded
        assigneeId: task.assigneeId,
        assignedAt: task.assignedAt,
        assigneeIds: task.assigneeIds,
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
    const actor = await getAuthUserId(ctx);
    if (actor !== null) {
      const rights = await rightsFor(ctx, task, userId, actor);
      if (!rights.canDelete) {
        throw new Error(
          "You can see this task, but only its owner can delete it.",
        );
      }
    }
    const steps = await ctx.db
      .query("taskSteps")
      .withIndex("by_task", (q) => q.eq("taskId", id))
      .collect();
    for (const s of steps) await ctx.db.delete(s._id);
    // the conversation and the reported problems go with the task
    const comments = await ctx.db
      .query("taskComments")
      .withIndex("by_task", (q) => q.eq("taskId", id))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);
    const issues = await ctx.db
      .query("taskIssues")
      .withIndex("by_task", (q) => q.eq("taskId", id))
      .collect();
    for (const i of issues) await ctx.db.delete(i._id);
    await ctx.db.delete(id);
  },
});

// ── Conversation ────────────────────────────────────────────────────────

/**
 * How one person is named in a comment or issue: their name, else the
 * username they sign in with, else their email. Same order as the sidebar.
 */
async function personLabel(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const user = await ctx.db.get(userId);
  if (user?.name !== undefined && user.name !== "") return user.name;
  const login = await ctx.db
    .query("credentials")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return login?.username ?? user?.email ?? "Someone";
}

/** Reject work on a task that isn't the caller's firm (or has gone). */
async function requireTask(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"tasks">,
): Promise<{ orgId: Id<"users">; task: Doc<"tasks">; userId: Id<"users"> }> {
  const orgId = await scopeUserId(ctx);
  if (orgId === null) throw new Error("Sign in first.");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in first.");
  const task = await ctx.db.get(taskId);
  if (task === null || task.ownerId !== orgId) {
    throw new Error("That task is no longer in your firm.");
  }
  return { orgId, task, userId };
}

/**
 * A task's chat history, oldest first. Everyone in the firm who can open the
 * task can read and write on it, so a site conversation lives with the job
 * rather than in a separate inbox. Given a `stepId`, it is that subtask's own
 * thread instead.
 */
export const listComments = query({
  args: { taskId: v.id("tasks"), stepId: v.optional(v.id("taskSteps")) },
  handler: async (ctx, { taskId, stepId }) => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const task = await ctx.db.get(taskId);
    if (task === null || task.ownerId !== orgId) return [];
    const all = await ctx.db
      .query("taskComments")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    // a step thread is its own conversation; the task's is the messages that
    // are not tied to a subtask, so the two never talk over each other
    const rows =
      stepId === undefined
        ? all.filter((c) => c.stepId === undefined)
        : all.filter((c) => c.stepId === stepId);
    return await Promise.all(
      rows
        .sort((a, b) => a._creationTime - b._creationTime)
        .map(async (c) => ({
          _id: c._id,
          text: c.text,
          authorId: c.authorId,
          author: await personLabel(ctx, c.authorId),
          at: c._creationTime,
        })),
    );
  },
});

/** Post a message on a task, or on one of its subtasks. */
export const addComment = mutation({
  args: {
    taskId: v.id("tasks"),
    stepId: v.optional(v.id("taskSteps")),
    text: v.string(),
  },
  handler: async (ctx, { taskId, stepId, text }) => {
    const { orgId, userId } = await requireTask(ctx, taskId);
    if (stepId !== undefined) {
      const step = await ctx.db.get(stepId);
      if (step === null || step.taskId !== taskId) {
        throw new Error("That subtask is no longer on this task.");
      }
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error("Write something first.");
    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error("That message is too long.");
    }
    return await ctx.db.insert("taskComments", {
      ownerId: orgId,
      taskId,
      stepId,
      authorId: userId,
      text: trimmed,
    });
  },
});

/** Take back your own message (or any of them, if you own the task). */
export const removeComment = mutation({
  args: { id: v.id("taskComments") },
  handler: async (ctx, { id }) => {
    const { task, userId } = await requireTask(ctx, await commentTaskOf(ctx, id));
    const comment = await ctx.db.get(id);
    if (comment === null) return;
    const rights = await rightsFor(
      ctx,
      task,
      task.ownerId,
      userId,
    );
    if (comment.authorId !== userId && !rights.isOwner) {
      throw new Error("You can only remove your own messages.");
    }
    await ctx.db.delete(id);
  },
});

/** Which task a comment belongs to, guarding against a stray id. */
async function commentTaskOf(
  ctx: QueryCtx | MutationCtx,
  id: Id<"taskComments">,
): Promise<Id<"tasks">> {
  const comment = await ctx.db.get(id);
  if (comment === null) throw new Error("That message is already gone.");
  return comment.taskId;
}

// ── Issues ──────────────────────────────────────────────────────────────

/** The problems reported against a task, open ones first. Given a `stepId`,
 *  it is that subtask's own issues instead.
 */
export const listIssues = query({
  args: { taskId: v.id("tasks"), stepId: v.optional(v.id("taskSteps")) },
  handler: async (ctx, { taskId, stepId }) => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const task = await ctx.db.get(taskId);
    if (task === null || task.ownerId !== orgId) return [];
    const every = await ctx.db
      .query("taskIssues")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    // the task's view is everything reported on it, its subtasks included —
    // a problem with a step is a problem with the job; given a `stepId` it is
    // that subtask's own list instead
    const rows = stepId === undefined ? every : every.filter((i) => i.stepId === stepId);
    // an issue can sit against the task itself or against one of its subtasks,
    // so the name of the subtask is looked up to label it
    const stepText = new Map(
      (
        await ctx.db
          .query("taskSteps")
          .withIndex("by_task", (q) => q.eq("taskId", taskId))
          .collect()
      ).map((s) => [s._id, s.text] as const),
    );
    return await Promise.all(
      rows
        .sort(
          (a, b) =>
            Number(a.isSolved ?? false) - Number(b.isSolved ?? false) ||
            b._creationTime - a._creationTime,
        )
        .map(async (i) => ({
          _id: i._id,
          title: i.title,
          stepId: i.stepId,
          stepText:
            i.stepId !== undefined ? stepText.get(i.stepId) : undefined,
          detail: i.detail,
          severity: i.severity,
          solution: i.solution,
          isSolved: i.isSolved ?? false,
          raisedBy: i.raisedBy,
          raisedByLabel: await personLabel(ctx, i.raisedBy),
          at: i._creationTime,
          solvedAt: i.solvedAt,
          solvedBy: i.solvedBy,
          solvedByLabel:
            i.solvedBy !== undefined
              ? await personLabel(ctx, i.solvedBy)
              : undefined,
        })),
    );
  },
});

/**
 * Every issue in the firm, so a task row can count what is still open on it
 * and the list can be filtered down to the jobs that need attention.
 */
export const listAllIssues = query({
  args: {},
  handler: async (ctx) => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const rows = await ctx.db
      .query("taskIssues")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
      .collect();
    return await Promise.all(
      rows
        .sort(
          (a, b) =>
            Number(a.isSolved ?? false) - Number(b.isSolved ?? false) ||
            b._creationTime - a._creationTime,
        )
        .map(async (i) => ({
          _id: i._id,
          taskId: i.taskId,
          stepId: i.stepId,
          title: i.title,
          severity: i.severity,
          isSolved: i.isSolved ?? false,
          at: i._creationTime,
          raisedByLabel: await personLabel(ctx, i.raisedBy),
        })),
    );
  },
});

/** Report a problem against a task, or against one of its subtasks. */
export const addIssue = mutation({
  args: {
    taskId: v.id("tasks"),
    stepId: v.optional(v.id("taskSteps")),
    title: v.string(),
    detail: v.optional(v.string()),
    severity: v.optional(
      v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    ),
  },
  handler: async (ctx, { taskId, stepId, title, detail, severity }) => {
    const { orgId, userId } = await requireTask(ctx, taskId);
    const trimmed = title.trim();
    if (trimmed.length === 0) throw new Error("Say what is wrong.");
    if (trimmed.length > MAX_TASK_LENGTH) {
      throw new Error("That summary is too long.");
    }
    if (stepId !== undefined) {
      const step = await ctx.db.get(stepId);
      if (step === null || step.taskId !== taskId) {
        throw new Error("That subtask is no longer on this task.");
      }
    }
    return await ctx.db.insert("taskIssues", {
      ownerId: orgId,
      taskId,
      stepId,
      raisedBy: userId,
      title: trimmed,
      detail: detail?.trim() || undefined,
      severity,
      isSolved: false,
    });
  },
});

/**
 * Mark an issue solved — or reopen it. Solving records who did it and when,
 * plus what was done, so the task keeps the story of what went wrong.
 */
export const setIssueSolved = mutation({
  args: {
    id: v.id("taskIssues"),
    solved: v.boolean(),
    solution: v.optional(v.string()),
  },
  handler: async (ctx, { id, solved, solution }) => {
    const issue = await ctx.db.get(id);
    if (issue === null) throw new Error("That issue is already gone.");
    const { task, userId } = await requireTask(ctx, issue.taskId);
    // putting a problem right is the owner's call, or anyone they let edit
    const rights = await rightsFor(ctx, task, task.ownerId, userId);
    if (!rights.canEdit) {
      throw new Error("Only someone who can edit this task can close an issue.");
    }
    if (!solved) {
      await ctx.db.patch(id, {
        isSolved: false,
        solvedBy: undefined,
        solvedAt: undefined,
      });
      // reopening a problem reopens what it was holding up, exactly as
      // reopening a subtask reopens its task
      if (task.isCompleted) {
        await ctx.db.patch(task._id, {
          isCompleted: false,
          completedAt: undefined,
        });
      }
      const step = issue.stepId !== undefined ? await ctx.db.get(issue.stepId) : null;
      if (step !== null && step.isCompleted && step.ownerId === issue.ownerId) {
        await ctx.db.patch(step._id, {
          isCompleted: false,
          completedAt: undefined,
        });
      }
      return;
    }
    const text = solution?.trim() ?? "";
    if (text.length === 0) {
      throw new Error("Say how you fixed it, so the next person knows.");
    }
    if (text.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error("That note is too long.");
    }
    await ctx.db.patch(id, {
      isSolved: true,
      solution: text,
      solvedBy: userId,
      solvedAt: Date.now(),
    });
  },
});

/** Drop an issue entirely — the person who raised it, or the task's owner. */
export const removeIssue = mutation({
  args: { id: v.id("taskIssues") },
  handler: async (ctx, { id }) => {
    const issue = await ctx.db.get(id);
    if (issue === null) return;
    const { task, userId } = await requireTask(ctx, issue.taskId);
    const rights = await rightsFor(ctx, task, task.ownerId, userId);
    if (issue.raisedBy !== userId && !rights.isOwner) {
      throw new Error("You can only remove issues you raised.");
    }
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
