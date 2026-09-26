import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { activeFirmSettings, firmTeam, ownedFirmSettings } from "./org";
import { permissionsValidator } from "./schema";
import type {
  ActionKey,
  GranularPerms,
  ItemKey,
  SectionKey,
} from "../lib/permissions";
import { ACTIONS, ITEMS, SECTIONS } from "../lib/permissions";
import {
  cleanProjectStatuses,
  projectStatusesOrDefaults,
} from "../lib/project-statuses";
import {
  DEFAULT_CURRENCY,
  cleanCurrency,
  currencyOrDefault,
} from "../lib/currency";

/**
 * Workspace roles:
 *  - "super"  → the workspace owner. Created automatically the first time
 *               anyone opens Settings. Can do everything.
 *  - "admin"  → can manage members (invite, change roles below super/admin).
 *  - "user"   → normal access; only restricted by explicit permission denials.
 *  - "member" → read-mostly; same, but typically granted fewer sections.
 */
export type WorkspaceRole = "super" | "admin" | "user" | "member";

const ROLE_RANK: Record<WorkspaceRole, number> = {
  super: 3,
  admin: 2,
  user: 1,
  member: 0,
};

// ── Team hierarchy ──────────────────────────────────────────────────────
// Members form a management chain: each member has an optional managerId
// pointing at another member of the same organisation. The super admin sits
// at the top with no manager.

/**
 * Would making `candidateManagerId` the manager of `memberUserId` create a
 * loop in the chain? Walks up from the candidate; if we reach the member
 * (or the member itself is the candidate), it's a loop.
 */
function wouldCycle(
  settingsDoc: Doc<"settings">,
  candidateManagerId: Id<"users">,
  memberUserId: Id<"users">,
): boolean {
  if (memberUserId === candidateManagerId) return true;
  let current = candidateManagerId;
  for (let depth = 0; depth < 64; depth += 1) {
    if (current === memberUserId) return true;
    if (current === settingsDoc.ownerId) return false;
    const entry = settingsDoc.members.find((m) => m.userId === current);
    if (entry === undefined) return false;
    const next = entry.managerId;
    if (next === undefined) return false;
    current = next as Id<"users">;
  }
  return true; // defensively bail on absurd chains
}

/**
 * Everyone strictly below `managerId` in the chain (their juniors, at any
 * depth). Returns member entries.
 */
function juniorsOf(
  settingsDoc: Doc<"settings">,
  managerId: Id<"users">,
): Array<{ userId: Id<"users">; role: WorkspaceRole; managerId?: Id<"users"> }> {
  const out: Array<{ userId: Id<"users">; role: WorkspaceRole; managerId?: Id<"users"> }> = [];
  const frontier = [managerId];
  const seen = new Set<Id<"users">>([managerId]);
  while (frontier.length > 0) {
    const current = frontier.shift() as Id<"users">;
    for (const m of settingsDoc.members) {
      if (m.managerId !== undefined && (m.managerId as Id<"users">) === current && !seen.has(m.userId)) {
        seen.add(m.userId);
        out.push({
          userId: m.userId,
          role: m.role as WorkspaceRole,
          managerId: m.managerId as Id<"users"> | undefined,
        });
        frontier.push(m.userId);
      }
    }
  }
  return out;
}

/**
 * Read the caller's settings row (queries only read; if none exists yet the
 * caller simply isn't a member of an initialized workspace).
 */
export async function getSettings(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"settings"> | null> {
  // The firm the user is working in right now — they may belong to several.
  return await activeFirmSettings(ctx, userId);
}

/** Users a given role may manage (strictly below itself; super can also manage admins). */
function canManage(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (actor === "super") return true;
  if (actor === "admin") return ROLE_RANK[target] < ROLE_RANK.admin;
  return false;
}

/**
 * Get (or lazily create) the settings row — MUTATIONS ONLY. The first user
 * to run this becomes the workspace's super user.
 */
async function getOrCreateSettings(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"settings">> {
  const existing = await getSettings(ctx, userId);
  if (existing) return existing;
  const id = await ctx.db.insert("settings", {
    ownerId: userId,
    members: [
      {
        userId,
        role: "super",
        joinedAt: Date.now(),
      },
    ],
  });
  const created = await ctx.db.get(id);
  return created as unknown as Doc<"settings">;
}

/** Find a user by email (case-insensitive). */
async function findUserByEmail(
  ctx: QueryCtx | MutationCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  const users = await ctx.db.query("users").collect();
  const needle = email.trim().toLowerCase();
  return (
    users.find(
      (u: Doc<"users">) => (u.email ?? "").toLowerCase() === needle,
    ) ?? null
  );
}

/** Resolve the caller's member entry + role (null role if not a member yet). */
async function actorRole(
  ctx: QueryCtx | MutationCtx,
  settingsDoc: Doc<"settings">,
  userId: Id<"users">,
): Promise<WorkspaceRole | null> {
  const me = settingsDoc.members.find((m) => m.userId === userId);
  return (me?.role as WorkspaceRole) ?? null;
}

/** Merge custom-role perms with per-user overrides on every section/action. */
function mergePerms(
  base: GranularPerms | undefined,
  override: GranularPerms | undefined,
): GranularPerms | undefined {
  if (base === undefined && override === undefined) return undefined;
  const out: GranularPerms = {};
  for (const s of SECTIONS) {
    const merged: Record<string, boolean> = {};
    for (const a of ACTIONS) {
      const v = override?.[s]?.[a as ActionKey] ?? base?.[s]?.[a as ActionKey];
      if (v !== undefined) merged[a] = v;
    }
    if (Object.keys(merged).length > 0) {
      out[s] = merged as GranularPerms[SectionKey];
    }
  }
  // Item-level permissions merge the same way.
  const items: NonNullable<GranularPerms["items"]> = {};
  for (const item of ITEMS) {
    const merged: Record<string, boolean> = {};
    for (const a of item.actions) {
      const v =
        override?.items?.[item.key]?.[a as ActionKey] ??
        base?.items?.[item.key]?.[a as ActionKey];
      if (v !== undefined) merged[a] = v;
    }
    if (Object.keys(merged).length > 0) {
      items[item.key as ItemKey] = merged;
    }
  }
  if (Object.keys(items).length > 0) out.items = items;
  return Object.keys(out).length > 0 ? out : undefined;
}// ── Queries ─────────────────────────────────────────────────────────────

/** Ordered statuses used by the Projects list and board. */
export const listProjectStatuses = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return projectStatusesOrDefaults(undefined);
    const settingsDoc = await getSettings(ctx, userId);
    return projectStatusesOrDefaults(settingsDoc?.projectStatuses);
  },
});

/** Save the ordered Projects status workflow. Start and Finish cannot change. */
export const setProjectStatuses = mutation({
  args: { statuses: v.array(v.string()) },
  handler: async (ctx, { statuses }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const cleaned = cleanProjectStatuses(statuses);
    await ctx.db.patch(settingsDoc._id, { projectStatuses: cleaned });
    return cleaned;
  },
});

/** Read the workspace currency, defaulting to US Dollar. */
export const getCurrency = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return DEFAULT_CURRENCY;
    const settingsDoc = await getSettings(ctx, userId);
    return currencyOrDefault(settingsDoc?.currency);
  },
});

/**
 * Change the workspace currency. Every amount in the app is displayed in it,
 * so existing figures are re-shown in the new currency; the stored numbers
 * themselves are untouched.
 */
export const setCurrency = mutation({
  args: { currency: v.string() },
  handler: async (ctx, { currency }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const all = await ctx.db.query("settings").collect();
    const row =
      all.find((s) => s.ownerId === userId) ??
      all.find((s) => s.members.some((m) => m.userId === userId));
    const role =
      row?.ownerId === userId
        ? "super"
        : row?.members.find((m) => m.userId === userId)?.role;
    if (role !== "super" && role !== "admin")
      throw new Error("Only an admin can change the workspace currency.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const clean = cleanCurrency(currency);
    await ctx.db.patch(settingsDoc._id, { currency: clean });
    return clean;
  },
});

/**
 * Claim any pending invite for the caller's email and register them as a
 * member. Called once per sign-in from the client; silently no-ops when
 * there's no invite.
 */
export const claimPendingInvite = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const user = await ctx.db.get(userId);
    if (user === null || !user.email) return;
    const email = user.email.trim().toLowerCase();

    // Find a pending invite addressed to this email.
    const invites = await ctx.db.query("pendingInvites").collect();
    const invite = invites.find((i) => i.email === email);
    if (invite === undefined) return;

    // The invite names the firm that sent it (by its owner id) — not whichever
    // firm the person signing in is currently working in.
    const settingsDoc = await ownedFirmSettings(ctx, invite.ownerId);
    if (settingsDoc === null) {
      await ctx.db.delete(invite._id);
      return;
    }
    // Already a member? Just drop the stale invite.
    if (settingsDoc.members.some((m) => m.userId === userId)) {
      await ctx.db.delete(invite._id);
      return;
    }
    await ctx.db.patch(settingsDoc._id, {
      members: [
        ...settingsDoc.members,
        {
          userId,
          role: invite.role,
          customRoleId: invite.customRoleId,
          managerId: invite.managerId,
          invitedBy: invite.ownerId,
          joinedAt: Date.now(),
        },
      ],
    });
    await ctx.db.delete(invite._id);
  },
});

/** My role + permissions within the workspace (null when signed out). */
export const getMyAccess = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const settingsDoc = await getSettings(ctx, userId);
    if (settingsDoc === null) {
      // Workspace not initialized yet — the mutation below will bootstrap it.
      return { role: "member" as WorkspaceRole, permissions: undefined, isSuper: false };
    }
    const me = settingsDoc.members.find((m) => m.userId === userId);
    // Custom role: merge its permissions with any direct overrides.
    let permissions = me?.permissions ?? undefined;
    if (me?.customRoleId !== undefined) {
      const customRole = await ctx.db.get(me.customRoleId);
      if (customRole !== null) {
        permissions = mergePerms(customRole.permissions as GranularPerms | undefined, permissions);
      }
    }
    return {
      role: (me?.role ?? "member") as WorkspaceRole,
      permissions,
      isSuper: settingsDoc.ownerId === userId,
    };
  },
});

/**
 * Initialize the caller's workspace if it doesn't exist yet. Idempotent —
 * safe to call on app load. The first caller becomes the super user.
 */
export const ensureWorkspace = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await getOrCreateSettings(ctx, userId);
  },
});

/** Full member directory (Settings tab). Allowed for super/admin only. */
export const listMembers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const settingsDoc = await getSettings(ctx, userId);
    if (settingsDoc === null) return [];
    const role = await actorRole(ctx, settingsDoc, userId);
    if (role !== "super" && role !== "admin") {
      throw new Error("Only the super user or an admin can view the member list.");
    }
    const rows = await Promise.all(
      settingsDoc.members.map(async (m) => {
        const user = await ctx.db.get(m.userId);
        // Effective permissions = custom role + per-user overrides.
        let effective = m.permissions as GranularPerms | undefined;
        if (m.customRoleId !== undefined) {
          const customRole = await ctx.db.get(m.customRoleId);
          if (customRole !== null) {
            effective = mergePerms(
              customRole.permissions as GranularPerms | undefined,
              effective,
            );
          }
        }
        return {
          userId: m.userId,
          role: m.role as WorkspaceRole,
          customRoleId: m.customRoleId,
          managerId: m.managerId,
          permissions: effective,
          joinedAt: m.joinedAt,
          name: user?.name ?? undefined,
          email: user?.email ?? undefined,
          isSuper: m.userId === settingsDoc.ownerId,
          // how many people report to this member, directly or indirectly
          teamSize: juniorsOf(settingsDoc, m.userId).length,
        };
      }),
    );
    return rows;
  },
});

// ── Mutations ───────────────────────────────────────────────────────────

/**
 * Invite a user by email into the workspace.
 * - If they already signed in, they're added immediately.
 * - Otherwise a pending invite is stored; they join automatically the first
 *   time they sign in (claimPendingInvite).
 */
export const inviteMember = mutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal("admin"),
      v.literal("user"),
      v.literal("member"),
    ),
    customRoleId: v.optional(v.id("customRoles")),
    managerId: v.optional(v.id("users")),
  },
  handler: async (ctx, { email, role, customRoleId, managerId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (!actor || !canManage(actor, role)) {
      throw new Error("You can't assign that role.");
    }
    if (customRoleId !== undefined) {
      const custom = await ctx.db.get(customRoleId);
      if (custom === null || custom.ownerId !== settingsDoc.ownerId) {
        throw new Error("That custom role no longer exists.");
      }
    }
    const cleanEmail = email.trim().toLowerCase();

    // the manager must already be a member of this organisation (the invited
    // user doesn't exist yet, so no cycle is possible here)
    if (managerId !== undefined) {
      if (!settingsDoc.members.some((m) => m.userId === managerId)) {
        throw new Error("The chosen manager isn't a member yet.");
      }
    }

    const user = await findUserByEmail(ctx, cleanEmail);
    if (user === null) {
      // Not signed in yet → store a pending invite.
      const invites = await ctx.db.query("pendingInvites").collect();
      const dup = invites.find(
        (i) => i.ownerId === settingsDoc.ownerId && i.email === cleanEmail,
      );
      if (dup !== undefined) {
        await ctx.db.patch(dup._id, { role, customRoleId, managerId });
      } else {
        await ctx.db.insert("pendingInvites", {
          ownerId: settingsDoc.ownerId,
          email: cleanEmail,
          role,
          customRoleId,
          managerId,
          createdAt: Date.now(),
        });
      }
      return { pending: true as const };
    }

    if (settingsDoc.members.some((m) => m.userId === user._id)) {
      throw new Error("That user is already a member of the workspace.");
    }
    await ctx.db.patch(settingsDoc._id, {
      members: [
        ...settingsDoc.members,
        {
          userId: user._id,
          role,
          customRoleId,
          managerId,
          invitedBy: userId,
          joinedAt: Date.now(),
        },
      ],
    });
    return { pending: false as const };
  },
});

// ── Pending invites ─────────────────────────────────────────────────────

/** Pending invites for the caller's workspace (Settings → Invites). */
export const listPendingInvites = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const settingsDoc = await getSettings(ctx, userId);
    if (settingsDoc === null) return [];
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (actor !== "super" && actor !== "admin") return [];
    const invites = await ctx.db.query("pendingInvites").collect();
    return invites
      .filter((i) => i.ownerId === settingsDoc.ownerId)
      .map((i) => ({
        _id: i._id,
        email: i.email,
        role: i.role,
        customRoleId: i.customRoleId,
        managerId: i.managerId,
        createdAt: i.createdAt,
      }));
  },
});

/** Cancel a pending invite. */
export const cancelPendingInvite = mutation({
  args: { id: v.id("pendingInvites") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getSettings(ctx, userId);
    if (settingsDoc === null) throw new Error("No workspace.");
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (actor !== "super" && actor !== "admin") {
      throw new Error("Only the super user or an admin can cancel invites.");
    }
    const invite = await ctx.db.get(id);
    if (invite === null) return;
    if (invite.ownerId !== settingsDoc.ownerId) {
      throw new Error("That invite belongs to another workspace.");
    }
    await ctx.db.delete(id);
  },
});

// ── Custom roles ────────────────────────────────────────────────────────

/** Manually created roles for the caller's workspace. */
export const listCustomRoles = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const settingsDoc = await getSettings(ctx, userId);
    if (settingsDoc === null) return [];
    const roles = await ctx.db.query("customRoles").collect();
    return roles
      .filter((r) => r.ownerId === settingsDoc.ownerId)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** Create a manually defined role. */
export const createCustomRole = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    permissions: permissionsValidator,
  },
  handler: async (ctx, { name, description, permissions }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (actor !== "super" && actor !== "admin") {
      throw new Error("Only the super user or an admin can create roles.");
    }
    const clean = name.trim().slice(0, 40);
    if (clean.length === 0) throw new Error("Give the role a name.");
    const existing = await ctx.db.query("customRoles").collect();
    if (
      existing.some(
        (r) =>
          r.ownerId === settingsDoc.ownerId &&
          r.name.toLowerCase() === clean.toLowerCase(),
      )
    ) {
      throw new Error("A role with that name already exists.");
    }
    return await ctx.db.insert("customRoles", {
      ownerId: settingsDoc.ownerId,
      name: clean,
      description: description?.trim().slice(0, 120) || undefined,
      permissions,
      createdAt: Date.now(),
    });
  },
});

/** Edit a manually defined role; members using it get the new access. */
export const updateCustomRole = mutation({
  args: {
    id: v.id("customRoles"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    permissions: v.optional(permissionsValidator),
  },
  handler: async (ctx, { id, name, description, permissions }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getSettings(ctx, userId);
    if (settingsDoc === null) throw new Error("No workspace.");
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (actor !== "super" && actor !== "admin") {
      throw new Error("Only the super user or an admin can edit roles.");
    }
    const role = await ctx.db.get(id);
    if (role === null || role.ownerId !== settingsDoc.ownerId) {
      throw new Error("That role no longer exists.");
    }
    const patch: Record<string, unknown> = {};
    if (name !== undefined) {
      const clean = name.trim().slice(0, 40);
      if (clean.length === 0) throw new Error("Give the role a name.");
      patch.name = clean;
    }
    if (description !== undefined) {
      patch.description = description.trim().slice(0, 120) || undefined;
    }
    if (permissions !== undefined) patch.permissions = permissions;
    await ctx.db.patch(id, patch);
  },
});

/** Delete a manually defined role; members fall back to their base role. */
export const deleteCustomRole = mutation({
  args: { id: v.id("customRoles") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getSettings(ctx, userId);
    if (settingsDoc === null) throw new Error("No workspace.");
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (actor !== "super" && actor !== "admin") {
      throw new Error("Only the super user or an admin can delete roles.");
    }
    const role = await ctx.db.get(id);
    if (role === null) return;
    if (role.ownerId !== settingsDoc.ownerId) {
      throw new Error("That role belongs to another workspace.");
    }
    // Detach members and pending invites from the deleted role.
    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members.map((m) =>
        m.customRoleId === id ? { ...m, customRoleId: undefined } : m,
      ),
    });
    const invites = await ctx.db.query("pendingInvites").collect();
    for (const i of invites) {
      if (i.customRoleId === id) {
        await ctx.db.patch(i._id, { customRoleId: undefined });
      }
    }
    await ctx.db.delete(id);
  },
});

/** Assign (or clear, with undefined) a custom role on a member. */
export const setMemberCustomRole = mutation({
  args: {
    userId: v.id("users"),
    customRoleId: v.optional(v.id("customRoles")),
  },
  handler: async (ctx, { userId: targetId, customRoleId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getSettings(ctx, userId);
    if (settingsDoc === null) throw new Error("No workspace.");
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (!actor || (actor !== "super" && actor !== "admin")) {
      throw new Error("Only the super user or an admin can assign roles.");
    }
    if (targetId === settingsDoc.ownerId) {
      throw new Error("The super user's access can't be changed.");
    }
    const target = settingsDoc.members.find((m) => m.userId === targetId);
    if (!target) throw new Error("That user is not a member.");
    if (customRoleId !== undefined) {
      const custom = await ctx.db.get(customRoleId);
      if (custom === null || custom.ownerId !== settingsDoc.ownerId) {
        throw new Error("That custom role no longer exists.");
      }
    }
    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members.map((m) =>
        m.userId === targetId ? { ...m, customRoleId } : m,
      ),
    });
  },
});

/** Change a member's role. */
export const setMemberRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(
      v.literal("admin"),
      v.literal("user"),
      v.literal("member"),
    ),
  },
  handler: async (ctx, { userId: targetId, role }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (!actor) throw new Error("You are not a member of this workspace.");
    if (targetId === settingsDoc.ownerId) {
      throw new Error("The super user's role can't be changed.");
    }
    const target = settingsDoc.members.find((m) => m.userId === targetId);
    if (!target) throw new Error("That user is not a member.");
    if (!canManage(actor, target.role as WorkspaceRole)) {
      throw new Error("You can't manage that member.");
    }
    if (!canManage(actor, role)) {
      throw new Error("You can't assign that role.");
    }
    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members.map((m) =>
        m.userId === targetId ? { ...m, role } : m,
      ),
    });
  },
});

/** Toggle a member's access to a section (restriction management). */
export const setMemberPermission = mutation({
  args: {
    userId: v.id("users"),
    section: v.union(
      v.literal("tasks"),
      v.literal("notes"),
      v.literal("costing"),
    ),
    action: v.union(
      v.literal("view"),
      v.literal("create"),
      v.literal("edit"),
      v.literal("delete"),
    ),
    allowed: v.boolean(),
  },
  handler: async (ctx, { userId: targetId, section, action, allowed }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (!actor || (actor !== "super" && actor !== "admin")) {
      throw new Error("Only the super user or an admin can change restrictions.");
    }
    if (targetId === settingsDoc.ownerId) {
      throw new Error("The super user always has full access.");
    }
    const target = settingsDoc.members.find((m) => m.userId === targetId);
    if (!target) throw new Error("That user is not a member.");
    const nextPermissions: GranularPerms = {
      ...(target.permissions ?? {}),
      [section]: {
        ...(target.permissions?.[section as SectionKey] ?? {}),
        [action]: allowed,
      },
    };
    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members.map((m) =>
        m.userId === targetId ? { ...m, permissions: nextPermissions } : m,
      ),
    });
  },
});

/** Set one item's permissions on a member (finer than a whole section). */
export const setMemberItemPermissions = mutation({
  args: {
    userId: v.id("users"),
    item: v.string(),
    permissions: permissionsValidator,
  },
  handler: async (ctx, { userId: targetId, item, permissions }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (!actor || (actor !== "super" && actor !== "admin")) {
      throw new Error("Only the super user or an admin can change restrictions.");
    }
    if (targetId === settingsDoc.ownerId) {
      throw new Error("The super user always has full access.");
    }
    const known = ITEMS.some((i) => i.key === item);
    if (!known) throw new Error("Unknown permission item.");
    const target = settingsDoc.members.find((m) => m.userId === targetId);
    if (!target) throw new Error("That user is not a member.");
    const incoming = permissions.items?.[item as ItemKey];
    const nextPermissions: GranularPerms = {
      ...(target.permissions ?? {}),
      items: {
        ...(target.permissions?.items ?? {}),
        [item as ItemKey]: incoming ?? {},
      },
    };
    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members.map((m) =>
        m.userId === targetId ? { ...m, permissions: nextPermissions } : m,
      ),
    });
    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members.map((m) =>
        m.userId === targetId ? { ...m, permissions: nextPermissions } : m,
      ),
    });
  },
});

/** Set a whole section block of permissions on a member at once. */
export const setMemberSectionPermissions = mutation({
  args: {
    userId: v.id("users"),
    section: v.union(
      v.literal("tasks"),
      v.literal("notes"),
      v.literal("costing"),
    ),
    permissions: permissionsValidator,
  },
  handler: async (ctx, { userId: targetId, section, permissions }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (!actor || (actor !== "super" && actor !== "admin")) {
      throw new Error("Only the super user or an admin can change restrictions.");
    }
    if (targetId === settingsDoc.ownerId) {
      throw new Error("The super user always has full access.");
    }
    const target = settingsDoc.members.find((m) => m.userId === targetId);
    if (!target) throw new Error("That user is not a member.");
    const sectionPerms = permissions[section as SectionKey];
    const nextPermissions: GranularPerms = {
      ...(target.permissions ?? {}),
      [section]: sectionPerms ?? {},
      items: target.permissions?.items,
    };
    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members.map((m) =>
        m.userId === targetId ? { ...m, permissions: nextPermissions } : m,
      ),
    });
  },
});

/** Remove a member from the workspace. */
export const removeMember = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId: targetId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (!actor) throw new Error("You are not a member of this workspace.");
    if (targetId === settingsDoc.ownerId) {
      throw new Error("The super user can't be removed.");
    }
    const target = settingsDoc.members.find((m) => m.userId === targetId);
    if (!target) throw new Error("That user is not a member.");
    if (targetId !== userId && !canManage(actor, target.role as WorkspaceRole)) {
      throw new Error("You can't manage that member.");
    }
    // their juniors move up under the removed member's own manager (or the
    // super admin when there isn't one) so nobody is orphaned
    const fallbackManager = target.managerId;
    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members
        .filter((m) => m.userId !== targetId)
        .map((m) =>
          m.managerId !== undefined && (m.managerId as Id<"users">) === targetId
            ? { ...m, managerId: fallbackManager }
            : m,
        ),
    });
  },
});

// ── Team hierarchy mutations ────────────────────────────────────────────

/**
 * Set (or clear) a member's manager. The manager must be a member of the
 * organisation, can't be the member themselves, and can't be one of their
 * juniors — otherwise the chain would loop.
 */
export const setMemberManager = mutation({
  args: {
    userId: v.id("users"),
    managerId: v.optional(v.id("users")),
  },
  handler: async (ctx, { userId: targetId, managerId }) => {
    const actorId = await getAuthUserId(ctx);
    if (actorId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, actorId);
    const actor = await actorRole(ctx, settingsDoc, actorId);
    if (!actor || (actor !== "super" && actor !== "admin")) {
      throw new Error("Only the super admin or an admin can assign managers.");
    }
    if (targetId === settingsDoc.ownerId) {
      throw new Error("The super admin has no manager — they own the organisation.");
    }
    const target = settingsDoc.members.find((m) => m.userId === targetId);
    if (!target) throw new Error("That user is not a member.");

    if (managerId === undefined) {
      // clearing — only the super admin may sit at the top
      if (actor !== "super") {
        throw new Error("Only the super admin can remove a manager.");
      }
    } else {
      const manager = settingsDoc.members.find((m) => m.userId === managerId);
      if (manager === undefined) {
        throw new Error("The chosen manager isn't a member of the organisation.");
      }
      if (managerId === targetId) {
        throw new Error("Someone can't be their own manager.");
      }
      if (actor !== "super" && !canManage(actor, manager.role as WorkspaceRole)) {
        throw new Error("You can't place someone under a manager above your level.");
      }
      if (wouldCycle(settingsDoc, managerId, targetId)) {
        throw new Error(
          "That would create a loop — this person already manages their manager.",
        );
      }
    }

    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members.map((m) =>
        m.userId === targetId ? { ...m, managerId } : m,
      ),
    });
  },
});

/**
 * The signed-in member's position in the hierarchy: their manager (name +
 * id) and everyone below them, one level deep. Any member can call this.
 */
export const getMyTeam = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const settingsDoc = await getSettings(ctx, userId);
    if (settingsDoc === null) return null;

    const nameOf = (id: Id<"users">) => {
      const m = settingsDoc.members.find((mm) => mm.userId === id);
      return m ? { userId: id, role: m.role as WorkspaceRole } : null;
    };

    const me = settingsDoc.members.find((m) => m.userId === userId);
    const managerEntry =
      me?.managerId !== undefined ? nameOf(me.managerId as Id<"users">) : null;
    const manager = managerEntry
      ? {
          ...managerEntry,
          name:
            managerEntry.role === "super"
              ? "Organisation owner"
              : undefined,
        }
      : null;

    const direct = settingsDoc.members
      .filter(
        (m) => m.managerId !== undefined && (m.managerId as Id<"users">) === userId,
      )
      .map((m) => ({
        userId: m.userId,
        role: m.role as WorkspaceRole,
        customRoleId: m.customRoleId,
      }));

    // hydrate names
    const hydrate = async (entries: typeof direct) =>
      Promise.all(
        entries.map(async (e) => {
          const user = await ctx.db.get(e.userId);
          return { ...e, name: user?.name ?? undefined, email: user?.email ?? undefined };
        }),
      );

    return {
      manager: manager && manager.role !== "super" ? manager : null,
      isSuper: settingsDoc.ownerId === userId,
      directReports: await hydrate(direct),
      // everyone under this person at any depth — the exact set the Mine / All
      // filter treats as "mine", so an empty All is explainable
      teamSize: (await firmTeam(ctx, userId)).length - 1,
    };
  },
});

/** Rename the workspace. */
export const setWorkspaceName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await getOrCreateSettings(ctx, userId);
    const actor = await actorRole(ctx, settingsDoc, userId);
    if (actor !== "super" && actor !== "admin") {
      throw new Error("Only the super user or an admin can rename the workspace.");
    }
    const clean = name.trim().slice(0, 60);
    await ctx.db.patch(settingsDoc._id, {
      workspaceName: clean || undefined,
    });
  },
});
