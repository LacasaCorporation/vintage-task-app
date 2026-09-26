import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  activeFirmId,
  firmsForUser,
  makeOrgCode,
  ownedFirmSettings,
  rememberActiveFirm,
  type Firm,
} from "./org";
import { cleanCurrency, currencyOrDefault } from "../lib/currency";
import type { WorkspaceRole } from "./settings";

/** One firm as the switcher needs it. */
type FirmSummary = {
  firmId: Id<"users">;
  name: string;
  code: string | null;
  currency: string;
  role: WorkspaceRole;
  isSuper: boolean;
  memberCount: number;
  createdAt: number | null;
};

function summarise(firm: Firm, userId: Id<"users">): FirmSummary {
  const isSuper = firm.ownerId === userId;
  const member = firm.members.find((m) => m.userId === userId);
  return {
    firmId: firm.ownerId,
    name: firm.workspaceName ?? "Unnamed firm",
    code: firm.orgCode ?? null,
    currency: currencyOrDefault(firm.currency),
    role: isSuper ? "super" : (member?.role ?? "member"),
    isSuper,
    memberCount: firm.members.length,
    createdAt: firm.orgCreatedAt ?? null,
  };
}

/**
 * Every firm the signed-in user belongs to, and which one they are working in.
 * A firm keeps its own people, roles, currency and data.
 */
export const listMyFirms = query({
  args: {},
  handler: async (ctx): Promise<{
    firms: FirmSummary[];
    activeFirmId: Id<"users"> | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { firms: [], activeFirmId: null };
    const [mine, active] = await Promise.all([
      firmsForUser(ctx, userId),
      activeFirmId(ctx, userId),
    ]);
    return {
      activeFirmId: active,
      firms: mine
        .map((f) => summarise(f, userId))
        .sort((a, b) => {
          if (a.firmId === active) return -1;
          if (b.firmId === active) return 1;
          return (a.createdAt ?? 0) - (b.createdAt ?? 0);
        }),
    };
  },
});

/** Move to another firm the user belongs to. Everything reloads into it. */
export const switchFirm = mutation({
  args: { firmId: v.id("users") },
  handler: async (ctx, { firmId }): Promise<{ firmId: Id<"users"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const mine = await firmsForUser(ctx, userId);
    if (!mine.some((f) => f.ownerId === firmId)) {
      throw new Error("You are not a member of that firm.");
    }
    await rememberActiveFirm(ctx, userId, firmId);
    return { firmId };
  },
});

/**
 * Create a firm: its own name, currency, people and — because every row is
 * scoped by the owner's id — its own completely separate data.
 *
 * An account may own only one firm, ever. So the first firm you make is owned
 * by you; after that you name the username of the person who should own this
 * one, and you join it as an admin.
 */
export const createFirm = mutation({
  args: {
    name: v.string(),
    currency: v.optional(v.string()),
    /** Username of the person who should own the new firm. */
    ownerUsername: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { name, currency, ownerUsername },
  ): Promise<{ firmId: Id<"users">; ownedByYou: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const clean = name.trim().slice(0, 120);
    if (clean.length === 0) throw new Error("Give the firm a name.");

    // Naming yourself is the same as leaving the field blank, so resolve the
    // owner's username first and then decide who actually owns the firm.
    const myUsername = await usernameOfSelf(ctx, userId);
    const wanted =
      ownerUsername === undefined ? "" : ownerUsername.trim().toLowerCase();
    const owner = wanted === "" || wanted === myUsername ? "" : wanted;
    let ownerId = userId;
    if (owner !== "") {
      const login = await ctx.db
        .query("credentials")
        .withIndex("by_username", (q) => q.eq("username", owner))
        .unique();
      if (login === null) {
        throw new Error(
          `Nobody signs in as “${owner}” yet. Create that person's login first, then make the firm.`,
        );
      }
      if (login.disabled) {
        throw new Error(`The “${owner}” login is switched off.`);
      }
      ownerId = login.userId;
    }

    const alreadyOwns = await ownedFirmSettings(ctx, ownerId);
    if (alreadyOwns !== null) {
      throw new Error(
        owner !== ""
          ? `“${owner}” already owns a firm, and each account can own only one. Leave the field blank to own “${clean}” yourself, or name someone who doesn't own a firm yet.`
          : "You already own a firm. Name the username of the person who should own this one.",
      );
    }

    const now = Date.now();
    const members = [
      { userId: ownerId, role: "super" as const, joinedAt: now },
      ...(ownerId === userId
        ? []
        : [{ userId, role: "admin" as const, joinedAt: now, invitedBy: ownerId }]),
    ];
    await ctx.db.insert("settings", {
      ownerId,
      members,
      workspaceName: clean,
      orgCode: makeOrgCode(),
      orgCreatedAt: now,
      ...(currency !== undefined ? { currency: cleanCurrency(currency) } : {}),
    });
    await rememberActiveFirm(ctx, userId, ownerId);
    return { firmId: ownerId, ownedByYou: ownerId === userId };
  },
});

/** The caller's own provisioned username, if they have one. */
async function usernameOfSelf(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const row = await ctx.db
    .query("credentials")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  return row?.username ?? "";
}
