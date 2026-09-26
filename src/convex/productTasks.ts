import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { firmAncestors, firmTeam, scopeUserId } from "./org";

/**
 * The task features a flagged product was missing: being assigned to people or
 * whole groups, per-person permissions handed out by whoever created it, and
 * steps. It mirrors `tasks.ts` on purpose — same rules, same wording — so a
 * product behaves exactly like a task once it is on the board.
 */

const MAX_STEP_LENGTH = 200;

/** The four permissions, matching tasks.ts. */
export type ProductRights = {
  isOwner: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canComplete: boolean;
  canChangeOptions: boolean;
};

/** The person who owns a product, or null when its author is unknown. */
function ownerIdOf(
  fg: Doc<"finishedGoods">,
  orgId: Id<"users">,
): Id<"users"> | null {
  if (fg.assigneeId === undefined) return null;
  if (fg.assigneeId === orgId && fg.assignedAt === undefined) return null;
  return fg.assigneeId;
}

async function grantOf(
  ctx: QueryCtx | MutationCtx,
  fgId: Id<"finishedGoods">,
  userId: Id<"users">,
) {
  const rows = await ctx.db
    .query("fgGrants")
    .withIndex("by_fg", (q) => q.eq("fgId", fgId))
    .collect();
  return rows.find((g) => g.userId === userId);
}

async function rightsFor(
  ctx: QueryCtx | MutationCtx,
  fg: Doc<"finishedGoods">,
  orgId: Id<"users">,
  userId: Id<"users">,
): Promise<ProductRights> {
  const owner = ownerIdOf(fg, orgId);
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
    // nobody owns it, so it stays open to the firm as it was before grants
    return {
      isOwner: false,
      canEdit: true,
      canDelete: true,
      canComplete: true,
      canChangeOptions: true,
    };
  }
  const grant = await grantOf(ctx, fg._id, userId);
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

const NO_RIGHTS: ProductRights = {
  isOwner: false,
  canEdit: false,
  canDelete: false,
  canComplete: false,
  canChangeOptions: false,
};

/** The caller's permissions on one product. */
export const myRights = query({
  args: { id: v.id("finishedGoods") },
  handler: async (ctx, { id }): Promise<ProductRights> => {
    const userId = await getAuthUserId(ctx);
    const orgId = await scopeUserId(ctx);
    if (userId === null || orgId === null) return NO_RIGHTS;
    const fg = await ctx.db.get(id);
    if (fg === null || fg.ownerId !== orgId) return NO_RIGHTS;
    return await rightsFor(ctx, fg, orgId, userId);
  },
});

/** The caller's permissions on many products at once, for a list of rows. */
export const myRightsForList = query({
  args: { ids: v.array(v.id("finishedGoods")) },
  handler: async (
    ctx,
    { ids },
  ): Promise<{ rights: ({ id: Id<"finishedGoods"> } & ProductRights)[] }> => {
    const userId = await getAuthUserId(ctx);
    const orgId = await scopeUserId(ctx);
    if (userId === null || orgId === null) return { rights: [] };
    const out: ({ id: Id<"finishedGoods"> } & ProductRights)[] = [];
    for (const id of ids.slice(0, 200)) {
      const fg = await ctx.db.get(id);
      if (fg === null || fg.ownerId !== orgId) continue;
      out.push({ id, ...(await rightsFor(ctx, fg, orgId, userId)) });
    }
    return { rights: out };
  },
});

/** Every permission the product's owner has handed out. */
export const grants = query({
  args: { id: v.id("finishedGoods") },
  handler: async (
    ctx,
    { id },
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
    if (userId === null || orgId === null) return { isOwner: false, grants: [] };
    const fg = await ctx.db.get(id);
    if (fg === null || fg.ownerId !== orgId) return { isOwner: false, grants: [] };
    const rows = await ctx.db
      .query("fgGrants")
      .withIndex("by_fg", (q) => q.eq("fgId", id))
      .collect();
    const shape = (g: (typeof rows)[number]) => ({
      userId: g.userId,
      canEdit: g.canEdit,
      canDelete: g.canDelete,
      canComplete: g.canComplete,
      canChangeOptions: g.canChangeOptions,
    });
    const owner = ownerIdOf(fg, orgId);
    if (userId === orgId || owner === userId) {
      return { isOwner: true, grants: rows.map(shape) };
    }
    return { isOwner: false, grants: rows.filter((g) => g.userId === userId).map(shape) };
  },
});

/** Give or take back one person's permissions on a product. */
export const setGrant = mutation({
  args: {
    id: v.id("finishedGoods"),
    userId: v.id("users"),
    canEdit: v.boolean(),
    canDelete: v.boolean(),
    canComplete: v.boolean(),
    canChangeOptions: v.boolean(),
  },
  handler: async (
    ctx,
    { id, userId, canEdit, canDelete, canComplete, canChangeOptions },
  ): Promise<{ userId: Id<"users"> }> => {
    const caller = await getAuthUserId(ctx);
    if (caller === null) throw new Error("Sign in first.");
    const orgId = await scopeUserId(ctx);
    if (orgId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null || fg.ownerId !== orgId) {
      throw new Error("That product no longer exists.");
    }
    const owner = ownerIdOf(fg, orgId);
    if (owner !== caller && orgId !== caller) {
      throw new Error(
        "Only the person who added this product can change who may edit it.",
      );
    }
    const holders = [
      ...new Set([
        ...(fg.assigneeIds ?? []),
        ...(fg.assigneeId !== undefined ? [fg.assigneeId] : []),
      ]),
    ];
    if (!holders.includes(userId)) {
      throw new Error("Assign the product to that person first.");
    }
    const nothing = !canEdit && !canDelete && !canComplete && !canChangeOptions;
    const existing = await grantOf(ctx, id, userId);
    if (nothing) {
      if (existing !== undefined) await ctx.db.delete(existing._id);
      return { userId };
    }
    const values = { canEdit, canDelete, canComplete, canChangeOptions };
    if (existing === undefined) {
      await ctx.db.insert("fgGrants", {
        ownerId: orgId,
        fgId: id,
        userId,
        ...values,
        grantedBy: caller,
        grantedAt: Date.now(),
      });
      return { userId };
    }
    await ctx.db.patch(existing._id, {
      ...values,
      grantedBy: caller,
      grantedAt: Date.now(),
    });
    return { userId };
  },
});

/**
 * Hand a product to people or to whole user groups. Same rule as tasks: only
 * yourself or your own down line, unless you own the product or own the firm.
 */
export const assign = mutation({
  args: {
    id: v.id("finishedGoods"),
    userIds: v.array(v.id("users")),
    groupIds: v.optional(v.array(v.id("userGroups"))),
  },
  handler: async (
    ctx,
    { id, userIds, groupIds },
  ): Promise<{ assigneeIds: Id<"users">[]; groupIds: Id<"userGroups">[] }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const orgId = await scopeUserId(ctx);
    if (orgId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null || fg.ownerId !== orgId) {
      throw new Error("That product no longer exists.");
    }
    const current = [
      ...new Set([
        ...(fg.assigneeIds ?? []),
        ...(fg.assigneeId !== undefined ? [fg.assigneeId] : []),
      ]),
    ];
    const up = await firmAncestors(ctx, userId);
    const mayReassign =
      current.length === 0 ||
      userId === orgId ||
      current.some((who) => who === userId || up.includes(who));
    if (!mayReassign) {
      throw new Error(
        "Only the person who added this product, their manager, or the firm owner can assign it.",
      );
    }
    const down = new Set(await firmTeam(ctx, userId));
    const targets = [...new Set(userIds)];
    if (targets.some((who) => !down.has(who))) {
      throw new Error(
        "You can only assign a product to yourself or to someone who reports to you.",
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

/** Mark this product as the caller's, so it has an owner to hand out rights. */
export const claimOwnership = mutation({
  args: { id: v.id("finishedGoods") },
  handler: async (ctx, { id }): Promise<{ assigneeId: Id<"users"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const orgId = await scopeUserId(ctx);
    if (orgId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(id);
    if (fg === null || fg.ownerId !== orgId) {
      throw new Error("That product no longer exists.");
    }
    if (fg.assigneeId !== undefined && fg.assignedAt !== undefined) {
      throw new Error("This product already has an owner.");
    }
    await ctx.db.patch(id, { assigneeId: userId, assignedAt: Date.now() });
    return { assigneeId: userId };
  },
});

// ── Steps (subtasks) ─────────────────────────────────────────────────────

export const listSteps = query({
  args: { fgId: v.id("finishedGoods") },
  handler: async (ctx, { fgId }) => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const rows = await ctx.db
      .query("fgSteps")
      .withIndex("by_fg", (q) => q.eq("fgId", fgId))
      .collect();
    return rows.sort((a, b) => a._creationTime - b._creationTime);
  },
});

export const addStep = mutation({
  args: { fgId: v.id("finishedGoods"), text: v.string() },
  handler: async (ctx, { fgId, text }): Promise<{ stepId: Id<"fgSteps"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const orgId = await scopeUserId(ctx);
    if (orgId === null) throw new Error("Sign in first.");
    const fg = await ctx.db.get(fgId);
    if (fg === null || fg.ownerId !== orgId) {
      throw new Error("That product no longer exists.");
    }
    const rights = await rightsFor(ctx, fg, orgId, userId);
    if (!rights.canEdit) {
      throw new Error("You can see this product, but only its owner can edit it.");
    }
    const clean = text.trim();
    if (clean.length === 0) throw new Error("Give the step some text.");
    if (clean.length > MAX_STEP_LENGTH) throw new Error("That step is too long.");
    const stepId = await ctx.db.insert("fgSteps", {
      ownerId: orgId,
      fgId,
      text: clean,
    });
    return { stepId };
  },
});

export const toggleStep = mutation({
  args: { stepId: v.id("fgSteps") },
  handler: async (ctx, { stepId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const orgId = await scopeUserId(ctx);
    if (orgId === null) throw new Error("Sign in first.");
    const step = await ctx.db.get(stepId);
    if (step === null || step.ownerId !== orgId) {
      throw new Error("That step no longer exists.");
    }
    const fg = await ctx.db.get(step.fgId);
    if (fg === null) throw new Error("That product no longer exists.");
    const rights = await rightsFor(ctx, fg, orgId, userId);
    if (!rights.canComplete && !rights.canEdit) {
      throw new Error(
        "You can see this step, but only its owner can tick it off.",
      );
    }
    await ctx.db.patch(stepId, { isCompleted: !step.isCompleted });
  },
});

export const removeStep = mutation({
  args: { stepId: v.id("fgSteps") },
  handler: async (ctx, { stepId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const orgId = await scopeUserId(ctx);
    if (orgId === null) throw new Error("Sign in first.");
    const step = await ctx.db.get(stepId);
    if (step === null || step.ownerId !== orgId) {
      throw new Error("That step no longer exists.");
    }
    const fg = await ctx.db.get(step.fgId);
    if (fg === null) throw new Error("That product no longer exists.");
    const rights = await rightsFor(ctx, fg, orgId, userId);
    if (!rights.canEdit && !rights.canDelete) {
      throw new Error("You can see this step, but only its owner can remove it.");
    }
    await ctx.db.delete(stepId);
  },
});
