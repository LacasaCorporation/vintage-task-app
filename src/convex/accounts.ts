import { createAccount, getAuthUserId, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  activeFirmSettings,
  firmOfMembership,
  ownedFirmSettings,
} from "./org";

type WorkspaceRole = "super" | "admin" | "user" | "member";

/** Shape returned by `loadManageableLogin` (annotated to keep inference acyclic). */
type ManageableLogin = {
  credentialsId: Id<"credentials">;
  userId: Id<"users">;
  username: string;
};

/** Shape returned by `authoriseActor`. */
type ActorInfo = {
  userId: Id<"users">;
  orgId: Id<"users">;
  isSuper: boolean;
  role: WorkspaceRole;
};

const USERNAME_MIN = 3;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 8;

/** Normalise + validate a username. Stored lower-cased, used as the account id. */
function cleanUsername(raw: string): string {
  const username = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    throw new Error(`Usernames must be ${USERNAME_MIN}–${USERNAME_MAX} characters.`);
  }
  if (!/^[a-z0-9._@-]+$/.test(username)) {
    throw new Error(
      "Usernames can use letters, numbers, and . _ - @ only.",
    );
  }
  return username;
}

function assertPassword(password: string) {
  if (password.length < PASSWORD_MIN) {
    throw new Error(`Passwords need at least ${PASSWORD_MIN} characters.`);
  }
}

/** "ORG-4F7K" style code an admin can read out to their team. */
function makeOrgCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `ORG-${out}`;
}

/** Internal: who is calling, and are they allowed to manage this org's users? */
export const authoriseActor = internalQuery({
  args: { needsOrg: v.optional(v.boolean()) },
  handler: async (ctx, { needsOrg }): Promise<ActorInfo> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await activeFirmSettings(ctx, userId);
    if (settingsDoc === null) {
      if (needsOrg) throw new Error("Create your organisation first.");
      return { userId, orgId: userId, isSuper: true, role: "super" as WorkspaceRole };
    }
    const me = settingsDoc.members.find((m) => m.userId === userId);
    const role = (settingsDoc.ownerId === userId
      ? "super"
      : (me?.role ?? "member")) as WorkspaceRole;
    if (role !== "super" && role !== "admin") {
      throw new Error("Only the super admin or an admin can manage users.");
    }
    return {
      userId,
      orgId: settingsDoc.ownerId,
      isSuper: role === "super",
      role,
    };
  },
});

/** Internal: move everyone managed by `oldManagerId` under `newManagerId`. */
export const reassignTeamInternal = internalMutation({
  args: { oldManagerId: v.id("users"), newManagerId: v.id("users") },
  handler: async (ctx, { oldManagerId, newManagerId }) => {
    const settingsDoc = await firmOfMembership(ctx, oldManagerId);
    if (settingsDoc === null) return;
    await ctx.db.patch(settingsDoc._id, {
      members: settingsDoc.members.map((m) =>
        m.managerId !== undefined && m.managerId === oldManagerId
          ? { ...m, managerId: newManagerId }
          : m,
      ),
    });
  },
});

/**
 * Internal: gate every password sign-in. Runs before the password is checked,
 * so a removed or switched-off login can never sign in — and self sign-up is
 * impossible because the login has to exist first.
 */
export const assertLoginAllowed = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<{ userId: Id<"users"> }> => {
    const row = await ctx.db
      .query("credentials")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    if (row === null) {
      throw new Error("That username and password don't match.");
    }
    if (row.disabled) {
      throw new Error("This login has been switched off by your admin.");
    }
    return { userId: row.userId };
  },
});

/** Internal: is this username free? */
export const usernameAvailable = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, { username }): Promise<boolean> => {
    const existing = await ctx.db
      .query("credentials")
      .withIndex("by_username", (q) => q.eq("username", username))
      .unique();
    return existing === null;
  },
});

/** Internal: create the credentials row and register the member. */
export const registerLogin = internalMutation({
  args: {
    orgId: v.id("users"),
    userId: v.id("users"),
    username: v.string(),
    displayName: v.optional(v.string()),
    createdBy: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user"), v.literal("member")),
    customRoleId: v.optional(v.id("customRoles")),
    managerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("credentials", {
      orgId: args.orgId,
      userId: args.userId,
      username: args.username,
      displayName: args.displayName,
      managerId: args.managerId,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
    const settingsDoc = await ownedFirmSettings(ctx, args.orgId);
    if (settingsDoc === null) return;
    if (settingsDoc.members.some((m) => m.userId === args.userId)) return;
    await ctx.db.patch(settingsDoc._id, {
      members: [
        ...settingsDoc.members,
        {
          userId: args.userId,
          role: args.role,
          customRoleId: args.customRoleId,
          managerId: args.managerId,
          invitedBy: args.createdBy,
          joinedAt: Date.now(),
        },
      ],
    });
  },
});

// ── Organisation ────────────────────────────────────────────────────────

/** Rename the organisation (super admin only). */
export const setOrganisationName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const settingsDoc = await activeFirmSettings(ctx, userId);
    if (settingsDoc === null || settingsDoc.ownerId !== userId) {
      throw new Error("Only the super admin can rename the organisation.");
    }
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the organisation a name.");
    await ctx.db.patch(settingsDoc._id, { workspaceName: clean.slice(0, 120) });
  },
});

/**
 * Create (or finish setting up) the organisation. Only the super admin can do
 * this, and the code is generated exactly once.
 */
export const createOrganisation = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    let settingsDoc = await activeFirmSettings(ctx, userId);
    if (settingsDoc === null) {
      const id = await ctx.db.insert("settings", {
        ownerId: userId,
        members: [{ userId, role: "super", joinedAt: Date.now() }],
      });
      settingsDoc = (await ctx.db.get(id)) as Doc<"settings">;
    }
    if (settingsDoc.ownerId !== userId) {
      throw new Error("Only the super admin can create the organisation.");
    }
    const clean = name.trim();
    if (clean.length === 0) throw new Error("Give the organisation a name.");
    await ctx.db.patch(settingsDoc._id, {
      workspaceName: clean.slice(0, 120),
      orgCode: settingsDoc.orgCode ?? makeOrgCode(),
      orgCreatedAt: settingsDoc.orgCreatedAt ?? Date.now(),
    });
  },
});

/** The organisation this user belongs to (name + code + my own login name). */
export const getOrganisation = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const settingsDoc = await activeFirmSettings(ctx, userId);
    const mine = await ctx.db
      .query("credentials")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      firmId: settingsDoc?.ownerId ?? null,
      name: settingsDoc?.workspaceName ?? null,
      code: settingsDoc?.orgCode ?? null,
      createdAt: settingsDoc?.orgCreatedAt ?? null,
      memberCount: settingsDoc?.members.length ?? 0,
      isSuper: settingsDoc === null || settingsDoc.ownerId === userId,
      myUsername: mine?.username ?? null,
      myLastLoginAt: mine?.lastLoginAt ?? null,
    };
  },
});

/** Stamp "last signed in" for the caller's login. Safe to call on every load. */
export const touchLogin = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;
    const mine = await ctx.db
      .query("credentials")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (mine === null) return;
    await ctx.db.patch(mine._id, { lastLoginAt: Date.now() });
  },
});

// ── Logins ──────────────────────────────────────────────────────────────

/** Every login provisioned in this organisation (super admin / admin only). */
export const listLogins = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const settingsDoc = await activeFirmSettings(ctx, userId);
    if (settingsDoc === null) return [];
    const me = settingsDoc.members.find((m) => m.userId === userId);
    const role = settingsDoc.ownerId === userId ? "super" : me?.role;
    if (role !== "super" && role !== "admin") return null;

    const rows = await ctx.db
      .query("credentials")
      .withIndex("by_org", (q) => q.eq("orgId", settingsDoc.ownerId))
      .collect();
    return rows
      .map((c) => {
        const member = settingsDoc.members.find((m) => m.userId === c.userId);
        return {
          _id: c._id,
          userId: c.userId,
          username: c.username,
          displayName: c.displayName ?? null,
          managerId: member?.managerId ?? c.managerId ?? null,
          createdAt: c.createdAt,
          lastLoginAt: c.lastLoginAt ?? null,
          disabled: c.disabled ?? false,
          role: (c.userId === settingsDoc.ownerId
            ? "super"
            : (member?.role ?? "member")) as WorkspaceRole,
          customRoleId: member?.customRoleId ?? null,
        };
      })
      .sort((a, b) => a.username.localeCompare(b.username));
  },
});

/**
 * Create a sign-in for a teammate: the super admin (or an admin) sets the
 * username and password and hands them over. Uses Convex Auth's own password
 * hashing, so the plain password is never stored.
 */
export const createUserLogin = action({
  args: {
    username: v.string(),
    password: v.string(),
    name: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("user"), v.literal("member")),
    customRoleId: v.optional(v.id("customRoles")),
    managerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<{ username: string }> => {
    const actor: ActorInfo = await ctx.runQuery(
      internal.accounts.authoriseActor,
      {},
    );
    const username = cleanUsername(args.username);
    assertPassword(args.password);

    const free = await ctx.runQuery(internal.accounts.usernameAvailable, {
      username,
    });
    if (!free) throw new Error(`The username “${username}” is already taken.`);

    const displayName = args.name?.trim().slice(0, 120) || undefined;
    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: username, secret: args.password },
      profile: { email: username, name: displayName ?? username },
    });

    await ctx.runMutation(internal.accounts.registerLogin, {
      orgId: actor.orgId,
      userId: user._id as Id<"users">,
      username,
      displayName,
      createdBy: actor.userId,
      role: args.role,
      customRoleId: args.customRoleId,
      managerId: args.managerId,
    });

    return { username };
  },
});

/** Internal: load a login row, checking the actor may manage it. */
export const loadManageableLogin = internalQuery({
  args: { credentialsId: v.id("credentials") },
  handler: async (ctx, { credentialsId }): Promise<ManageableLogin> => {
    const actor: ActorInfo = await ctx.runQuery(
      internal.accounts.authoriseActor,
      {},
    );
    const row = await ctx.db.get(credentialsId);
    if (row === null) throw new Error("That login no longer exists.");
    if (row.orgId !== actor.orgId) throw new Error("That login isn't yours.");
    if (!actor.isSuper && row.userId === actor.orgId) {
      throw new Error("The super admin's login can't be changed.");
    }
    return {
      credentialsId: row._id,
      userId: row.userId,
      username: row.username,
    };
  },
});

/**
 * Set a new password for a teammate. The admin reads the new password out to
 * them; the old one stops working immediately.
 */
export const setLoginPassword = action({
  args: { credentialsId: v.id("credentials"), password: v.string() },
  handler: async (ctx, args): Promise<{ username: string }> => {
    assertPassword(args.password);
    const login: ManageableLogin = await ctx.runQuery(
      internal.accounts.loadManageableLogin,
      { credentialsId: args.credentialsId },
    );
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: login.username, secret: args.password },
    });
    return { username: login.username };
  },
});

/** Internal: flip the disabled flag. */
export const setLoginDisabledInternal = internalMutation({
  args: { credentialsId: v.id("credentials"), disabled: v.boolean() },
  handler: async (ctx, { credentialsId, disabled }) => {
    await ctx.db.patch(credentialsId, { disabled });
    return { userId: (await ctx.db.get(credentialsId))?.userId };
  },
});

/** Stop (or restore) someone's ability to sign in. */
export const setLoginDisabled = action({
  args: { credentialsId: v.id("credentials"), disabled: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    const login: ManageableLogin = await ctx.runQuery(
      internal.accounts.loadManageableLogin,
      { credentialsId: args.credentialsId },
    );
    await ctx.runMutation(internal.accounts.setLoginDisabledInternal, args);
    if (args.disabled) {
      await invalidateSessions(ctx, { userId: login.userId });
    }
  },
});

/** Internal: tear a login down (credentials, membership, auth account, user). */
export const deleteLoginInternal = internalMutation({
  args: { credentialsId: v.id("credentials") },
  handler: async (ctx, { credentialsId }) => {
    const row = await ctx.db.get(credentialsId);
    if (row === null) return null;
    await ctx.db.delete(credentialsId);

    // remove from the organisation's member list; their juniors move up under
    // the removed person's own manager so nobody is orphaned
    const settingsDoc = await ownedFirmSettings(ctx, row.orgId);
    if (settingsDoc !== null) {
      const target = settingsDoc.members.find((m) => m.userId === row.userId);
      await ctx.db.patch(settingsDoc._id, {
        members: settingsDoc.members
          .filter((m) => m.userId !== row.userId)
          .map((m) =>
            m.managerId !== undefined && m.managerId === row.userId
              ? { ...m, managerId: target?.managerId }
              : m,
          ),
      });
    }

    // remove their auth account(s) and the user row itself
    const accounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("userId"), row.userId))
      .collect();
    for (const a of accounts) await ctx.db.delete(a._id);
    const sessions = await ctx.db
      .query("authSessions")
      .filter((q) => q.eq(q.field("userId"), row.userId))
      .collect();
    for (const s of sessions) await ctx.db.delete(s._id);
    await ctx.db.delete(row.userId);
    return null;
  },
});

/** Delete a teammate's login entirely. */
export const deleteLogin = action({
  args: { credentialsId: v.id("credentials") },
  handler: async (ctx, args): Promise<void> => {
    const login: ManageableLogin = await ctx.runQuery(
      internal.accounts.loadManageableLogin,
      { credentialsId: args.credentialsId },
    );
    await invalidateSessions(ctx, { userId: login.userId });
    await ctx.runMutation(internal.accounts.deleteLoginInternal, args);
  },
});
