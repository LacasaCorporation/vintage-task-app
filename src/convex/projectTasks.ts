import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { assignableIds, firmAncestors, scopeUserId } from "./org";
import { PROJECT_STATUS_START } from "../lib/project-statuses";

/**
 * The task features a project, a job or a product was missing.
 *
 * A task carries a lot: someone you can hand it to with their own permissions,
 * steps, a conversation, problems reported against it, files and a repeat. This
 * module gives all of that to the other three things on the Projects page, on
 * purpose mirroring `tasks.ts` — same rules, same wording — so a project, a job
 * and a product behave exactly like a task once you open their side panel.
 *
 * One set of tables serves every kind, told apart by `kind`, so the behaviour
 * can never drift between them. Products keep using the tables they already
 * had for steps and permissions, and this module reads and writes those when
 * the kind is `product`, so nothing already on the board changes underneath it.
 */

const kindValidator = v.union(
  v.literal("project"),
  v.literal("job"),
  v.literal("product"),
);
type NodeKind = "project" | "job" | "product";

const NO_LONGER: Record<NodeKind, string> = {
  project: "That project is no longer in your firm.",
  job: "That job is no longer in your firm.",
  product: "That product is no longer in your firm.",
};

const MAX_STEP_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4000;
const MAX_ATTACHMENT_BYTES = 900_000; // ~900 KB per file (stored inline)

type NodeDoc = Doc<"projects"> | Doc<"projectJobs"> | Doc<"finishedGoods">;

/** The four permissions, matching tasks.ts. */
export type NodeRights = {
  isOwner: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canComplete: boolean;
  canChangeOptions: boolean;
};

const NO_RIGHTS: NodeRights = {
  isOwner: false,
  canEdit: false,
  canDelete: false,
  canComplete: false,
  canChangeOptions: false,
};

// ── Reading one node ────────────────────────────────────────────────────

async function getNode(
  ctx: QueryCtx | MutationCtx,
  kind: NodeKind,
  id: string,
): Promise<NodeDoc | null> {
  if (kind === "project") {
    const pid = ctx.db.normalizeId("projects", id);
    return pid === null ? null : await ctx.db.get(pid);
  }
  if (kind === "job") {
    const jid = ctx.db.normalizeId("projectJobs", id);
    return jid === null ? null : await ctx.db.get(jid);
  }
  const fid = ctx.db.normalizeId("finishedGoods", id);
  return fid === null ? null : await ctx.db.get(fid);
}

async function patchNode(
  ctx: MutationCtx,
  kind: NodeKind,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (kind === "project") {
    const pid = ctx.db.normalizeId("projects", id);
    if (pid === null) throw new Error(NO_LONGER.project);
    await ctx.db.patch(pid, patch as Partial<Doc<"projects">>);
    return;
  }
  if (kind === "job") {
    const jid = ctx.db.normalizeId("projectJobs", id);
    if (jid === null) throw new Error(NO_LONGER.job);
    await ctx.db.patch(jid, patch as Partial<Doc<"projectJobs">>);
    return;
  }
  const fid = ctx.db.normalizeId("finishedGoods", id);
  if (fid === null) throw new Error(NO_LONGER.product);
  await ctx.db.patch(fid, patch as Partial<Doc<"finishedGoods">>);
}

async function requireNode(
  ctx: QueryCtx | MutationCtx,
  kind: NodeKind,
  id: string,
): Promise<{
  orgId: Id<"users">;
  userId: Id<"users">;
  node: NodeDoc;
}> {
  const orgId = await scopeUserId(ctx);
  if (orgId === null) throw new Error("Sign in first.");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in first.");
  const node = await getNode(ctx, kind, id);
  if (node === null || node.ownerId !== orgId) throw new Error(NO_LONGER[kind]);
  return { orgId, userId, node };
}

/** The person who owns a node, or null when its author is unknown. */
function ownerOf(node: NodeDoc, orgId: Id<"users">): Id<"users"> | null {
  if (node.assigneeId === undefined) return null;
  if (node.assigneeId === orgId && node.assignedAt === undefined) return null;
  return node.assigneeId;
}

async function grantOf(
  ctx: QueryCtx | MutationCtx,
  kind: NodeKind,
  node: NodeDoc,
  orgId: Id<"users">,
  userId: Id<"users">,
) {
  // a product's permissions live in the table it already had, so a grant made
  // on the flagged board still shows here (and the other way round)
  if (kind === "product") {
    const rows = await ctx.db
      .query("fgGrants")
      .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
      .collect();
    return rows.find((g) => g.fgId === node._id && g.userId === userId);
  }
  const rows = await ctx.db
    .query("nodeGrants")
    .withIndex("by_node", (q) =>
      q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", node._id),
    )
    .collect();
  return rows.find((g) => g.userId === userId);
}

async function rightsFor(
  ctx: QueryCtx | MutationCtx,
  kind: NodeKind,
  node: NodeDoc,
  orgId: Id<"users">,
  userId: Id<"users">,
): Promise<NodeRights> {
  const owner = ownerOf(node, orgId);
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
  const grant = await grantOf(ctx, kind, node, orgId, userId);
  if (grant === undefined) return NO_RIGHTS;
  return {
    isOwner: false,
    canEdit: grant.canEdit,
    canDelete: grant.canDelete,
    canComplete: grant.canComplete,
    canChangeOptions: grant.canChangeOptions,
  };
}

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

/** The caller's permissions on one project, job or product. */
export const rights = query({
  args: { kind: kindValidator, id: v.string() },
  handler: async (ctx, { kind, id }): Promise<NodeRights> => {
    const userId = await getAuthUserId(ctx);
    const orgId = await scopeUserId(ctx);
    if (userId === null || orgId === null) return NO_RIGHTS;
    const node = await getNode(ctx, kind, id);
    if (node === null || node.ownerId !== orgId) return NO_RIGHTS;
    return await rightsFor(ctx, kind, node, orgId, userId);
  },
});

/** Every permission the item's owner has handed out. */
export const grants = query({
  args: { kind: kindValidator, id: v.string() },
  handler: async (
    ctx,
    { kind, id },
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
    const node = await getNode(ctx, kind, id);
    if (node === null || node.ownerId !== orgId) {
      return { isOwner: false, grants: [] };
    }
    const shape = (g: {
      userId: Id<"users">;
      canEdit: boolean;
      canDelete: boolean;
      canComplete: boolean;
      canChangeOptions: boolean;
    }) => ({
      userId: g.userId,
      canEdit: g.canEdit,
      canDelete: g.canDelete,
      canComplete: g.canComplete,
      canChangeOptions: g.canChangeOptions,
    });
    if (kind === "product") {
      const rows = await ctx.db
        .query("fgGrants")
        .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
        .collect();
      const mine = rows.filter((g) => g.fgId === node._id);
      const owner = ownerOf(node, orgId);
      if (userId === orgId || owner === userId) {
        return { isOwner: true, grants: mine.map(shape) };
      }
      return {
        isOwner: false,
        grants: mine.filter((g) => g.userId === userId).map(shape),
      };
    }
    const rows = await ctx.db
      .query("nodeGrants")
      .withIndex("by_node", (q) =>
        q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", node._id),
      )
      .collect();
    const owner = ownerOf(node, orgId);
    if (userId === orgId || owner === userId) {
      return { isOwner: true, grants: rows.map(shape) };
    }
    return {
      isOwner: false,
      grants: rows.filter((g) => g.userId === userId).map(shape),
    };
  },
});

/** Give or take back one person's permissions on a project, job or product. */
export const setGrant = mutation({
  args: {
    kind: kindValidator,
    id: v.string(),
    userId: v.id("users"),
    canEdit: v.boolean(),
    canDelete: v.boolean(),
    canComplete: v.boolean(),
    canChangeOptions: v.boolean(),
  },
  handler: async (
    ctx,
    { kind, id, userId, canEdit, canDelete, canComplete, canChangeOptions },
  ) => {
    const caller = await getAuthUserId(ctx);
    if (caller === null) throw new Error("Sign in first.");
    const { orgId, node } = await requireNode(ctx, kind, id);
    const owner = ownerOf(node, orgId);
    if (owner !== caller && orgId !== caller) {
      throw new Error(
        "Only the person who added this can change who may edit it.",
      );
    }
    const holders = [
      ...new Set([
        ...(node.assigneeIds ?? []),
        ...(node.assigneeId !== undefined ? [node.assigneeId] : []),
      ]),
    ];
    if (!holders.includes(userId)) {
      throw new Error("Assign this to that person first.");
    }
    const nothing = !canEdit && !canDelete && !canComplete && !canChangeOptions;

    if (kind === "product") {
      const rows = await ctx.db
        .query("fgGrants")
        .withIndex("by_owner", (q) => q.eq("ownerId", orgId))
        .collect();
      const existing = rows.find(
        (g) => g.fgId === node._id && g.userId === userId,
      );
      const values = { canEdit, canDelete, canComplete, canChangeOptions };
      if (nothing) {
        if (existing !== undefined) await ctx.db.delete(existing._id);
        return { userId };
      }
      if (existing === undefined) {
        await ctx.db.insert("fgGrants", {
          ownerId: orgId,
          fgId: node._id as Id<"finishedGoods">,
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
    }

    const existing = await grantOf(ctx, kind, node, orgId, userId);
    const values = { canEdit, canDelete, canComplete, canChangeOptions };
    if (nothing) {
      if (existing !== undefined) await ctx.db.delete(existing._id);
      return { userId };
    }
    if (existing === undefined) {
      await ctx.db.insert("nodeGrants", {
        ownerId: orgId,
        kind,
        nodeId: String(node._id),
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
 * Hand a project, job or product to people or to whole user groups. Same rule
 * as tasks: only yourself or your own down line, unless you own it or the firm.
 */
export const assign = mutation({
  args: {
    kind: kindValidator,
    id: v.string(),
    userIds: v.array(v.id("users")),
    groupIds: v.optional(v.array(v.id("userGroups"))),
  },
  handler: async (ctx, { kind, id, userIds, groupIds }) => {
    const { orgId, userId, node } = await requireNode(ctx, kind, id);
    const current = [
      ...new Set([
        ...(node.assigneeIds ?? []),
        ...(node.assigneeId !== undefined ? [node.assigneeId] : []),
      ]),
    ];
    const up = await firmAncestors(ctx, userId);
    const mayReassign =
      current.length === 0 ||
      userId === orgId ||
      current.some((who) => who === userId || up.includes(who));
    if (!mayReassign) {
      throw new Error(
        "Only the person who added it, their manager, or the firm owner can assign it.",
      );
    }
    const allowed = await assignableIds(ctx, userId);
    const targets = [...new Set(userIds)];
    if (targets.some((who) => !allowed.has(who))) {
      throw new Error(
        "You can only assign to yourself or to someone who reports to you.",
      );
    }
    const groups = [...new Set(groupIds ?? [])];
    for (const groupId of groups) {
      const group = await ctx.db.get(groupId);
      if (group === null || group.ownerId !== orgId) {
        throw new Error("One of those groups no longer exists.");
      }
    }
    await patchNode(ctx, kind, id, {
      assigneeIds: targets.length > 0 ? targets : undefined,
      groupIds: groups.length > 0 ? groups : undefined,
    });
    return { assigneeIds: targets, groupIds: groups };
  },
});

/** Mark this project, job or product as the caller's, so it has an owner. */
export const claimOwnership = mutation({
  args: { kind: kindValidator, id: v.string() },
  handler: async (ctx, { kind, id }) => {
    const { userId } = await requireNode(ctx, kind, id);
    await patchNode(ctx, kind, id, {
      assigneeId: userId,
      assignedAt: Date.now(),
    });
    return { assigneeId: userId };
  },
});

// ── The item's own fields ───────────────────────────────────────────────

/**
 * Change the task-style fields on a project, job or product. Notes are
 * "edit", while the date, priority, repeat, tags and star are the owner's
 * "change options" — the same split a task has.
 */
export const update = mutation({
  args: {
    kind: kindValidator,
    id: v.string(),
    name: v.optional(v.string()),
    notes: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    clearDue: v.optional(v.boolean()),
    priority: v.optional(
      v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    ),
    clearPriority: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
    remindAt: v.optional(v.number()),
    clearRemind: v.optional(v.boolean()),
    starred: v.optional(v.boolean()),
    recurrence: v.optional(
      v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    ),
    clearRecurrence: v.optional(v.boolean()),
    client: v.optional(v.string()),
    budget: v.optional(v.number()),
    clearBudget: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { orgId, userId, node } = await requireNode(ctx, args.kind, args.id);
    const rights = await rightsFor(ctx, args.kind, node, orgId, userId);
    const touchesOptions =
      args.dueAt !== undefined ||
      args.clearDue === true ||
      args.priority !== undefined ||
      args.clearPriority === true ||
      args.remindAt !== undefined ||
      args.clearRemind === true ||
      args.recurrence !== undefined ||
      args.clearRecurrence === true ||
      args.client !== undefined ||
      args.budget !== undefined ||
      args.clearBudget === true;
    if (touchesOptions && !rights.canChangeOptions) {
      throw new Error(
        "You can see this, but only its owner can change its date, priority or repeat.",
      );
    }
    if (
      (args.name !== undefined ||
        args.notes !== undefined ||
        args.tags !== undefined ||
        args.starred !== undefined) &&
      !rights.canEdit
    ) {
      throw new Error("You can see this, but only its owner can edit it.");
    }

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length === 0) throw new Error("Give it a name.");
      patch.name = name.slice(0, 200);
    }
    if (args.notes !== undefined) {
      const notes = args.notes.trim().slice(0, MAX_DESCRIPTION_LENGTH);
      if (args.kind === "product") patch.note = notes || undefined;
      else patch.description = notes || undefined;
    }
    if (args.clearDue === true) patch.dueAt = undefined;
    else if (args.dueAt !== undefined) patch.dueAt = args.dueAt;
    if (args.clearPriority === true) patch.priority = undefined;
    else if (args.priority !== undefined) patch.priority = args.priority;
    if (args.tags !== undefined) {
      patch.tags = [...new Set(args.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
    }
    if (args.clearRemind === true) patch.remindAt = undefined;
    else if (args.remindAt !== undefined) patch.remindAt = args.remindAt;
    if (args.starred !== undefined) patch.starred = args.starred || undefined;
    if (args.clearRecurrence === true) patch.recurrence = undefined;
    else if (args.recurrence !== undefined) patch.recurrence = args.recurrence;
    if (args.kind === "project") {
      if (args.client !== undefined) {
        patch.client = args.client.trim().slice(0, 120) || undefined;
      }
      if (args.clearBudget === true) patch.budget = undefined;
      else if (args.budget !== undefined) {
        patch.budget = args.budget >= 0 ? args.budget : undefined;
      }
    }
    await patchNode(ctx, args.kind, args.id, patch);
  },
});

// ── Files ───────────────────────────────────────────────────────────────

type Attachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  data: string;
};

function attachmentsOf(node: NodeDoc): Attachment[] {
  if (node.attachments === undefined) return [];
  try {
    const parsed = JSON.parse(node.attachments) as unknown;
    return Array.isArray(parsed) ? (parsed as Attachment[]) : [];
  } catch {
    return [];
  }
}

export const addAttachment = mutation({
  args: {
    kind: kindValidator,
    id: v.string(),
    name: v.string(),
    type: v.string(),
    size: v.number(),
    data: v.string(), // data URL
  },
  handler: async (ctx, { kind, id, name, type, size, data }) => {
    const { orgId, userId, node } = await requireNode(ctx, kind, id);
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (!rights.canEdit) {
      throw new Error("You can see this, but only its owner can edit it.");
    }
    if (size > MAX_ATTACHMENT_BYTES) {
      throw new Error("That file is too large (max ~900 KB).");
    }
    const item: Attachment = { id: crypto.randomUUID(), name, type, size, data };
    await patchNode(ctx, kind, id, {
      attachments: JSON.stringify([...attachmentsOf(node), item]),
    });
  },
});

export const removeAttachment = mutation({
  args: { kind: kindValidator, id: v.string(), attachmentId: v.string() },
  handler: async (ctx, { kind, id, attachmentId }) => {
    const { orgId, userId, node } = await requireNode(ctx, kind, id);
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (!rights.canEdit) {
      throw new Error("You can see this, but only its owner can edit it.");
    }
    await patchNode(ctx, kind, id, {
      attachments: JSON.stringify(
        attachmentsOf(node).filter((a) => a.id !== attachmentId),
      ),
    });
  },
});

// ── Steps (subtasks) ────────────────────────────────────────────────────

type StepRow = { _id: string; text: string; isCompleted: boolean };

export const listSteps = query({
  args: { kind: kindValidator, id: v.string() },
  handler: async (ctx, { kind, id }): Promise<StepRow[]> => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    if (kind === "product") {
      const fid = ctx.db.normalizeId("finishedGoods", id);
      if (fid === null) return [];
      const rows = await ctx.db
        .query("fgSteps")
        .withIndex("by_fg", (q) => q.eq("fgId", fid))
        .collect();
      return rows
        .sort((a, b) => a._creationTime - b._creationTime)
        .map((s) => ({
          _id: String(s._id),
          text: s.text,
          isCompleted: s.isCompleted === true,
        }));
    }
    const rows = await ctx.db
      .query("nodeSteps")
      .withIndex("by_node", (q) =>
        q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", id),
      )
      .collect();
    return rows
      .sort((a, b) => a._creationTime - b._creationTime)
      .map((s) => ({
        _id: String(s._id),
        text: s.text,
        isCompleted: s.isCompleted === true,
      }));
  },
});

export const addStep = mutation({
  args: { kind: kindValidator, id: v.string(), text: v.string() },
  handler: async (ctx, { kind, id, text }) => {
    const { orgId, userId, node } = await requireNode(ctx, kind, id);
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (!rights.canEdit) {
      throw new Error("You can see this, but only its owner can edit it.");
    }
    const clean = text.trim();
    if (clean.length === 0) throw new Error("Give the step some text.");
    if (clean.length > MAX_STEP_LENGTH) throw new Error("That step is too long.");
    if (kind === "product") {
      const fid = ctx.db.normalizeId("finishedGoods", id);
      if (fid === null) throw new Error(NO_LONGER.product);
      const stepId = await ctx.db.insert("fgSteps", {
        ownerId: orgId,
        fgId: fid,
        text: clean,
      });
      return { stepId: String(stepId) };
    }
    const stepId = await ctx.db.insert("nodeSteps", {
      ownerId: orgId,
      kind,
      nodeId: String(node._id),
      text: clean,
    });
    return { stepId: String(stepId) };
  },
});

/** Load one step and the node it belongs to, whatever kind it is. */
async function stepNode(
  ctx: MutationCtx,
  kind: NodeKind,
  stepId: string,
): Promise<{ stepText: string; isCompleted: boolean; node: NodeDoc }> {
  if (kind === "product") {
    const sid = ctx.db.normalizeId("fgSteps", stepId);
    if (sid === null) throw new Error("That step no longer exists.");
    const step = await ctx.db.get(sid);
    if (step === null) throw new Error("That step no longer exists.");
    const fid = ctx.db.normalizeId("finishedGoods", step.fgId);
    const fg = fid === null ? null : await ctx.db.get(fid);
    if (fg === null) throw new Error(NO_LONGER.product);
    return { stepText: step.text, isCompleted: step.isCompleted === true, node: fg };
  }
  const sid = ctx.db.normalizeId("nodeSteps", stepId);
  if (sid === null) throw new Error("That step no longer exists.");
  const step = await ctx.db.get(sid);
  if (step === null || step.kind !== kind) {
    throw new Error("That step no longer exists.");
  }
  const node = await getNode(ctx, kind, step.nodeId);
  if (node === null) throw new Error(NO_LONGER[kind]);
  return { stepText: step.text, isCompleted: step.isCompleted === true, node };
}

export const toggleStep = mutation({
  args: { kind: kindValidator, stepId: v.string() },
  handler: async (ctx, { kind, stepId }) => {
    const { orgId, userId } = await requireNodeStep(ctx, stepId, kind);
    const { isCompleted, node } = await stepNode(ctx, kind, stepId);
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (!rights.canComplete && !rights.canEdit) {
      throw new Error("You can see this step, but only its owner can tick it off.");
    }
    if (kind === "product") {
      const sid = ctx.db.normalizeId("fgSteps", stepId)!;
      await ctx.db.patch(sid, { isCompleted: !isCompleted });
      return;
    }
    const sid = ctx.db.normalizeId("nodeSteps", stepId)!;
    await ctx.db.patch(sid, { isCompleted: !isCompleted });
  },
});

export const renameStep = mutation({
  args: { kind: kindValidator, stepId: v.string(), text: v.string() },
  handler: async (ctx, { kind, stepId, text }) => {
    const { orgId, userId } = await requireNodeStep(ctx, stepId, kind);
    const { node } = await stepNode(ctx, kind, stepId);
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (!rights.canEdit) {
      throw new Error("You can see this step, but only its owner can rename it.");
    }
    const clean = text.trim();
    if (clean.length === 0) throw new Error("Give the step some text.");
    if (clean.length > MAX_STEP_LENGTH) throw new Error("That step is too long.");
    if (kind === "product") {
      const sid = ctx.db.normalizeId("fgSteps", stepId)!;
      await ctx.db.patch(sid, { text: clean });
      return;
    }
    const sid = ctx.db.normalizeId("nodeSteps", stepId)!;
    await ctx.db.patch(sid, { text: clean });
  },
});

export const removeStep = mutation({
  args: { kind: kindValidator, stepId: v.string() },
  handler: async (ctx, { kind, stepId }) => {
    const { orgId, userId } = await requireNodeStep(ctx, stepId, kind);
    const { node } = await stepNode(ctx, kind, stepId);
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (!rights.canEdit && !rights.canDelete) {
      throw new Error("You can see this step, but only its owner can remove it.");
    }
    if (kind === "product") {
      const sid = ctx.db.normalizeId("fgSteps", stepId)!;
      await ctx.db.delete(sid);
      return;
    }
    const sid = ctx.db.normalizeId("nodeSteps", stepId)!;
    await ctx.db.delete(sid);
  },
});

/** Guard a step id: it must exist and belong to the caller's firm. */
async function requireNodeStep(
  ctx: MutationCtx,
  stepId: string,
  kind: NodeKind,
): Promise<{ orgId: Id<"users">; userId: Id<"users"> }> {
  const orgId = await scopeUserId(ctx);
  if (orgId === null) throw new Error("Sign in first.");
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in first.");
  if (kind === "product") {
    const sid = ctx.db.normalizeId("fgSteps", stepId);
    if (sid === null) throw new Error("That step no longer exists.");
    const step = await ctx.db.get(sid);
    if (step === null || step.ownerId !== orgId) {
      throw new Error("That step no longer exists.");
    }
    return { orgId, userId };
  }
  const sid = ctx.db.normalizeId("nodeSteps", stepId);
  if (sid === null) throw new Error("That step no longer exists.");
  const step = await ctx.db.get(sid);
  if (step === null || step.ownerId !== orgId || step.kind !== kind) {
    throw new Error("That step no longer exists.");
  }
  return { orgId, userId };
}

// ── Conversation ────────────────────────────────────────────────────────

export const listComments = query({
  args: { kind: kindValidator, id: v.string() },
  handler: async (ctx, { kind, id }) => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const rows = await ctx.db
      .query("nodeComments")
      .withIndex("by_node", (q) =>
        q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", id),
      )
      .collect();
    return await Promise.all(
      rows
        .sort((a, b) => a._creationTime - b._creationTime)
        .map(async (c) => ({
          _id: String(c._id),
          authorId: c.authorId,
          author: await personLabel(ctx, c.authorId),
          text: c.text,
          at: c._creationTime,
        })),
    );
  },
});

export const addComment = mutation({
  args: { kind: kindValidator, id: v.string(), text: v.string() },
  handler: async (ctx, { kind, id, text }) => {
    const { orgId, userId } = await requireNode(ctx, kind, id);
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error("Write something first.");
    if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error("That message is too long.");
    }
    await ctx.db.insert("nodeComments", {
      ownerId: orgId,
      kind,
      nodeId: id,
      authorId: userId,
      text: trimmed,
    });
  },
});

/** Take back your own message (or any of them, if you own the item). */
export const removeComment = mutation({
  args: { kind: kindValidator, id: v.string(), commentId: v.string() },
  handler: async (ctx, { kind, id, commentId }) => {
    const { orgId, userId, node } = await requireNode(ctx, kind, id);
    const cid = ctx.db.normalizeId("nodeComments", commentId);
    if (cid === null) return;
    const comment = await ctx.db.get(cid);
    if (comment === null) return;
    if (comment.nodeId !== id || comment.kind !== kind) {
      throw new Error("That message belongs to something else.");
    }
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (comment.authorId !== userId && !rights.isOwner) {
      throw new Error("You can only remove your own messages.");
    }
    await ctx.db.delete(cid);
  },
});

// ── Issues ──────────────────────────────────────────────────────────────

/** Every problem reported against a project, job or product, open ones first. */
export const listIssues = query({
  args: { kind: kindValidator, id: v.string() },
  handler: async (ctx, { kind, id }) => {
    const orgId = await scopeUserId(ctx);
    if (orgId === null) return [];
    const rows = await ctx.db
      .query("nodeIssues")
      .withIndex("by_node", (q) =>
        q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", id),
      )
      .collect();
    return await Promise.all(
      rows
        .sort(
          (a, b) =>
            Number(a.isSolved ?? false) - Number(b.isSolved ?? false) ||
            b._creationTime - a._creationTime,
        )
        .map(async (i) => ({
          _id: String(i._id),
          title: i.title,
          detail: i.detail,
          severity: i.severity,
          solution: i.solution,
          isSolved: i.isSolved ?? false,
          raisedByLabel: await personLabel(ctx, i.raisedBy),
          at: i._creationTime,
          solvedByLabel:
            i.solvedBy !== undefined ? await personLabel(ctx, i.solvedBy) : undefined,
        })),
    );
  },
});

/**
 * Everything hanging off an item goes when the item does: its steps, its
 * conversation, the issues on it and the permissions handed out on it.
 */
export async function purgeNode(
  ctx: MutationCtx,
  kind: NodeKind,
  nodeId: string,
): Promise<void> {
  const orgId = await scopeUserId(ctx);
  if (orgId === null) return;
  for (const step of await ctx.db
    .query("nodeSteps")
    .withIndex("by_node", (q) =>
      q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", nodeId),
    )
    .collect()) {
    await ctx.db.delete(step._id);
  }
  for (const row of await ctx.db
    .query("nodeComments")
    .withIndex("by_node", (q) =>
      q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", nodeId),
    )
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("nodeIssues")
    .withIndex("by_node", (q) =>
      q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", nodeId),
    )
    .collect()) {
    await ctx.db.delete(row._id);
  }
  for (const row of await ctx.db
    .query("nodeGrants")
    .withIndex("by_node", (q) =>
      q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", nodeId),
    )
    .collect()) {
    await ctx.db.delete(row._id);
  }
}

export const addIssue = mutation({
  args: {
    kind: kindValidator,
    id: v.string(),
    title: v.string(),
    detail: v.optional(v.string()),
    severity: v.optional(
      v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    ),
  },
  handler: async (ctx, { kind, id, title, detail, severity }) => {
    const { orgId, userId, node } = await requireNode(ctx, kind, id);
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (!rights.canEdit && !rights.canComplete) {
      throw new Error("You can see this, but only its owner can report on it.");
    }
    const clean = title.trim();
    if (clean.length === 0) throw new Error("Say what went wrong.");
    await ctx.db.insert("nodeIssues", {
      ownerId: orgId,
      kind,
      nodeId: id,
      title: clean.slice(0, 200),
      detail: detail?.trim().slice(0, MAX_DESCRIPTION_LENGTH) || undefined,
      severity: severity ?? "medium",
      isSolved: false,
      raisedBy: userId,
    });
  },
});

export const setIssueSolved = mutation({
  args: {
    kind: kindValidator,
    id: v.string(),
    issueId: v.string(),
    solved: v.boolean(),
    solution: v.optional(v.string()),
  },
  handler: async (ctx, { kind, id, issueId, solved, solution }) => {
    const { orgId, userId, node } = await requireNode(ctx, kind, id);
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (!rights.canEdit && !rights.canComplete) {
      throw new Error("You can see this, but only its owner can act on it.");
    }
    const iid = ctx.db.normalizeId("nodeIssues", issueId);
    if (iid === null) throw new Error("That issue is already gone.");
    const issue = await ctx.db.get(iid);
    if (issue === null || issue.nodeId !== id || issue.kind !== kind) {
      throw new Error("That issue belongs to something else.");
    }
    if (solved) {
      const clean = solution?.trim() ?? "";
      if (clean.length === 0) {
        throw new Error("Say how you fixed it, so the next person knows.");
      }
      await ctx.db.patch(iid, {
        isSolved: true,
        solution: clean.slice(0, MAX_DESCRIPTION_LENGTH),
        solvedBy: userId,
        solvedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(iid, {
      isSolved: false,
      solution: undefined,
      solvedBy: undefined,
      solvedAt: undefined,
    });
  },
});

export const removeIssue = mutation({
  args: { kind: kindValidator, id: v.string(), issueId: v.string() },
  handler: async (ctx, { kind, id, issueId }) => {
    const { orgId, userId, node } = await requireNode(ctx, kind, id);
    const rights = await rightsFor(ctx, kind, node, orgId, userId);
    if (!rights.canEdit && !rights.canDelete) {
      throw new Error("You can see this, but only its owner can remove it.");
    }
    const iid = ctx.db.normalizeId("nodeIssues", issueId);
    if (iid === null) return;
    const issue = await ctx.db.get(iid);
    if (issue === null) return;
    if (issue.nodeId !== id || issue.kind !== kind) {
      throw new Error("That issue belongs to something else.");
    }
    await ctx.db.delete(iid);
  },
});

// ── Repeating projects, jobs and products ───────────────────────────────

/** Next due timestamp for a repeating item, from a base date. */
function nextDueAt(
  base: number,
  recurrence: "daily" | "weekly" | "monthly",
): number {
  const d = new Date(base);
  if (recurrence === "daily") d.setDate(d.getDate() + 1);
  if (recurrence === "weekly") d.setDate(d.getDate() + 7);
  if (recurrence === "monthly") d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

/** The next free code of a prefix, e.g. "FG0007". */
async function nextNodeCode(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  prefix: "FG" | "PR" | "JB",
): Promise<string> {
  let max = 0;
  const scan = (code: unknown) => {
    if (typeof code !== "string" || !code.startsWith(prefix)) return;
    const n = Number.parseInt(code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  };
  const fgs = await ctx.db
    .query("finishedGoods")
    .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
    .collect();
  if (prefix === "FG") for (const fg of fgs) scan(fg.code);
  if (prefix === "PR") {
    for (const fg of fgs) scan(fg.projectCode);
    for (const p of await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect())
      scan(p.code);
  }
  if (prefix === "JB") {
    for (const j of await ctx.db
      .query("projectJobs")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect())
      scan(j.code);
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/**
 * When a repeating project, job or product is finished, the next occurrence is
 * laid down — the same item, next due date, none of its children — exactly as
 * a repeating task spawns the next one. A product takes its cost lines and
 * steps with it, because that is what makes it the same product; a job and a
 * project start empty, so the next round is planned rather than assumed.
 */
export async function spawnNextOccurrence(
  ctx: MutationCtx,
  kind: NodeKind,
  node: NodeDoc,
): Promise<void> {
  const recurrence = node.recurrence;
  if (recurrence === undefined) return;
  const base = node.dueAt ?? Date.now();
  const dueAt = nextDueAt(base, recurrence);
  const remindAt =
    node.remindAt !== undefined
      ? nextDueAt(node.remindAt, recurrence)
      : undefined;

  if (kind === "project") {
    const project = node as Doc<"projects">;
    await ctx.db.insert("projects", {
      ownerId: project.ownerId,
      name: project.name,
      code: await nextNodeCode(ctx, project.ownerId, "PR"),
      isActive: true,
      activeAt: Date.now(),
      description: project.description,
      client: project.client,
      assignee: project.assignee,
      dueAt,
      priority: project.priority,
      budget: project.budget,
      projectStatus: undefined,
      assigneeId: project.assigneeId,
      assignedAt: project.assignedAt,
      assigneeIds: project.assigneeIds,
      groupIds: project.groupIds,
      tags: project.tags,
      remindAt,
      starred: project.starred,
      attachments: project.attachments,
      recurrence,
    });
    return;
  }

  if (kind === "job") {
    const job = node as Doc<"projectJobs">;
    await ctx.db.insert("projectJobs", {
      ownerId: job.ownerId,
      projectId: job.projectId,
      name: job.name,
      code: await nextNodeCode(ctx, job.ownerId, "JB"),
      isActive: true,
      activeAt: Date.now(),
      description: job.description,
      assignee: job.assignee,
      dueAt,
      status: "planning",
      priority: job.priority,
      projectStatus: undefined,
      assigneeId: job.assigneeId,
      assignedAt: job.assignedAt,
      assigneeIds: job.assigneeIds,
      groupIds: job.groupIds,
      tags: job.tags,
      remindAt,
      starred: job.starred,
      attachments: job.attachments,
      recurrence,
    });
    return;
  }

  const fg = node as Doc<"finishedGoods">;
  const nextId = await ctx.db.insert("finishedGoods", {
    ownerId: fg.ownerId,
    projectName: fg.projectName,
    projectCode: fg.projectCode,
    jobId: fg.jobId,
    jobIds: fg.jobIds,
    name: fg.name,
    code: await nextNodeCode(ctx, fg.ownerId, "FG"),
    isActive: true,
    activeAt: Date.now(),
    qty: fg.qty,
    unit: fg.unit,
    category: fg.category,
    subCategory: fg.subCategory,
    note: fg.note,
    currency: fg.currency,
    markupPct: fg.markupPct,
    imageUrl: fg.imageUrl,
    imageAlt: fg.imageAlt,
    dueAt,
    remindAt,
    priority: fg.priority,
    tags: fg.tags,
    starred: fg.starred,
    recurrence,
    assigneeId: fg.assigneeId,
    assignedAt: fg.assignedAt,
    assigneeIds: fg.assigneeIds,
    groupIds: fg.groupIds,
    projectStatus:
      fg.projectStatus !== undefined ? PROJECT_STATUS_START : undefined,
  });
  // the same cost lines, so the repeat is priced like the one before it
  for (const item of await ctx.db
    .query("costingItems")
    .withIndex("by_fg", (q) => q.eq("fgId", fg._id))
    .collect()) {
    await ctx.db.insert("costingItems", {
      ownerId: item.ownerId,
      fgId: nextId,
      materialId: item.materialId,
      label: item.label,
      qty: item.qty,
      unitPrice: item.unitPrice,
      unit: item.unit,
    });
  }
  // and its steps, so the same work is broken down the same way
  for (const step of await ctx.db
    .query("fgSteps")
    .withIndex("by_fg", (q) => q.eq("fgId", fg._id))
    .collect()) {
    await ctx.db.insert("fgSteps", {
      ownerId: step.ownerId,
      fgId: nextId,
      text: step.text,
    });
  }
}

/**
 * Refuse to finish an item while a problem on it is still open — the same rule
 * that keeps a task (or a subtask) from being ticked off with a snag on it.
 */
export async function assertNoOpenIssues(
  ctx: MutationCtx,
  kind: NodeKind,
  nodeId: string,
  what: string,
): Promise<void> {
  const orgId = await scopeUserId(ctx);
  if (orgId === null) return;
  const rows = await ctx.db
    .query("nodeIssues")
    .withIndex("by_node", (q) =>
      q.eq("ownerId", orgId).eq("kind", kind).eq("nodeId", nodeId),
    )
    .collect();
  const open = rows.filter((i) => i.isSolved !== true);
  if (open.length === 0) return;
  throw new Error(
    `Clear the open issue${open.length === 1 ? "" : "s"} before completing this ${what}.`,
  );
}
