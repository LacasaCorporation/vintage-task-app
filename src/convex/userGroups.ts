import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { activeFirmSettings, scopeUserId } from "./org";

/** One group as the settings list and the task picker need it. */
export type GroupRow = {
  _id: Id<"userGroups">;
  name: string;
  description: string | null;
  memberIds: Id<"users">[];
  createdBy: Id<"users">;
  createdAt: number;
};

const NAME_MAX = 60;

/**
 * Who may create and change groups. The firm owner and admins manage them, the
 * same people who manage users and roles — anyone else can read the list so
 * they know what a task assigned to "Site crew" actually means.
 */
async function assertCanManageGroups(
  ctx: Parameters<typeof activeFirmSettings>[0],
  userId: Id<"users">,
): Promise<Id<"users">> {
  const firm = await activeFirmSettings(ctx, userId);
  if (firm === null) throw new Error("Create your firm first.");
  if (firm.ownerId === userId) return firm.ownerId;
  const role = firm.members.find((m) => m.userId === userId)?.role;
  if (role !== "admin" && role !== "super") {
    throw new Error(
      "Only the firm owner and admins can change user groups.",
    );
  }
  return firm.ownerId;
}

function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0) throw new Error("Give the group a name.");
  if (name.length > NAME_MAX) {
    throw new Error(`Group names are up to ${NAME_MAX} characters.`);
  }
  return name;
}

/** Every group in the caller's active firm, oldest first. */
export const list = query({
  args: {},
  handler: async (ctx): Promise<GroupRow[]> => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const rows = await ctx.db
      .query("userGroups")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
      .collect();
    return rows
      .map((g): GroupRow => ({
        _id: g._id,
        name: g.name,
        description: g.description ?? null,
        memberIds: g.memberIds,
        createdBy: g.createdBy,
        createdAt: g.createdAt,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** Create a group of people. Members must be in the same firm. */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    memberIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (
    ctx,
    { name, description, memberIds },
  ): Promise<{ groupId: Id<"userGroups"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const orgId = await assertCanManageGroups(ctx, userId);
    const firm = await activeFirmSettings(ctx, userId);
    const members = await keepFirmMembers(ctx, firm, memberIds ?? []);
    const note = (description ?? "").trim();
    const groupId = await ctx.db.insert("userGroups", {
      ownerId: orgId,
      name: cleanName(name),
      ...(note.length > 0 ? { description: note.slice(0, 200) } : {}),
      memberIds: members,
      createdBy: userId,
      createdAt: Date.now(),
    });
    return { groupId };
  },
});

/** Rename a group, edit its note, or replace its members. */
export const update = mutation({
  args: {
    id: v.id("userGroups"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    memberIds: v.optional(v.array(v.id("users"))),
  },
  handler: async (
    ctx,
    { id, name, description, memberIds },
  ): Promise<{ groupId: Id<"userGroups"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await assertCanManageGroups(ctx, userId);
    const group = await ctx.db.get(id);
    if (group === null) throw new Error("That group no longer exists.");
    const orgId = await scopeUserId(ctx);
    if (group.ownerId !== orgId) throw new Error("Not your firm's group.");
    const firm = await activeFirmSettings(ctx, userId);
    const patch: Partial<Doc<"userGroups">> = {};
    if (name !== undefined) patch.name = cleanName(name);
    if (description !== undefined) {
      const note = description.trim();
      if (note.length === 0) patch.description = undefined;
      else patch.description = note.slice(0, 200);
    }
    if (memberIds !== undefined) {
      patch.memberIds = await keepFirmMembers(ctx, firm, memberIds);
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(id, patch);
    return { groupId: id };
  },
});

/** Delete a group. Tasks assigned to it keep their people and lose the group. */
export const remove = mutation({
  args: { id: v.id("userGroups") },
  handler: async (ctx, { id }): Promise<{ groupId: Id<"userGroups"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await assertCanManageGroups(ctx, userId);
    const group = await ctx.db.get(id);
    if (group === null) throw new Error("That group no longer exists.");
    const orgId = await scopeUserId(ctx);
    if (group.ownerId !== orgId) throw new Error("Not your firm's group.");
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
      .collect();
    for (const task of tasks) {
      const groups = task.groupIds ?? [];
      if (!groups.includes(id)) continue;
      await ctx.db.patch(task._id, {
        groupIds: groups.filter((g) => g !== id),
      });
    }
    await ctx.db.delete(id);
    return { groupId: id };
  },
});

/** Drop anyone no longer in the firm, so a group never points at a stranger. */
async function keepFirmMembers(
  ctx: Parameters<typeof activeFirmSettings>[0],
  firm: Awaited<ReturnType<typeof activeFirmSettings>>,
  memberIds: Id<"users">[],
): Promise<Id<"users">[]> {
  if (firm === null) return [];
  const allowed = new Set<Id<"users">>([
    firm.ownerId,
    ...firm.members.map((m) => m.userId),
  ]);
  return [...new Set(memberIds)].filter((id) => allowed.has(id));
}
