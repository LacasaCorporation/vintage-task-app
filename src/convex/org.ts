import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;

/**
 * A firm is a `settings` row. It is identified everywhere by its owner's user
 * id, which is also the id every organisation-owned row is scoped by — so
 * supporting several firms per person needs no change to the data tables,
 * only a way to choose which firm is active.
 */
export type Firm = Doc<"settings">;

/** "ORG-4F7K" style code an admin can read out to their team. */
export function makeOrgCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `ORG-${out}`;
}

/** Every firm this user owns or is listed in, as settings rows. */
export async function firmsForUser(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Firm[]> {
  const all = await ctx.db.query("settings").collect();
  return all.filter(
    (s) => s.ownerId === userId || s.members.some((m) => m.userId === userId),
  );
}

/** The firm this user owns, if they own one. At most one, always. */
export async function ownedFirmSettings(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Firm | null> {
  return await ctx.db
    .query("settings")
    .withIndex("by_owner", (q) => q.eq("ownerId", userId))
    .unique();
}

/**
 * A firm this user belongs to, ignoring which one is active. Use this when
 * resolving *somebody else's* firm (their manager's, a login's org) — the
 * active-firm lookup would answer for the wrong person.
 */
export async function firmOfMembership(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Firm | null> {
  const rows = await ctx.db.query("settings").collect();
  const owned = rows.find((s) => s.ownerId === userId);
  if (owned !== undefined) return owned;
  return rows.find((s) => s.members.some((m) => m.userId === userId)) ?? null;
}

/**
 * The firm the user is working in right now: their last choice, falling back to
 * the firm they own and then to any firm they belong to. A stored choice that
 * is no longer valid (left the firm, or it was deleted) is ignored.
 */
export async function activeFirmId(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Id<"users"> | null> {
  const me = await ctx.db.get(userId);
  const chosen = me?.activeFirmId ?? null;
  const firms = await firmsForUser(ctx, userId);
  if (chosen !== null && firms.some((s) => s.ownerId === chosen)) {
    return chosen;
  }
  const owned = firms.find((s) => s.ownerId === userId);
  if (owned !== undefined) return owned.ownerId;
  return firms[0]?.ownerId ?? null;
}

/** The active firm as a settings row, or null when the user has none yet. */
export async function activeFirmSettings(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Firm | null> {
  const firmId = await activeFirmId(ctx, userId);
  if (firmId === null) return null;
  return await ctx.db
    .query("settings")
    .withIndex("by_owner", (q) => q.eq("ownerId", firmId))
    .unique();
}

/**
 * Who the caller counts as "theirs" in the active firm: themselves plus
 * everyone under them in the management chain, at any depth.
 *
 * The Mine / All filter uses this. "Mine" is just the caller's own rows; "All"
 * is this list — so a manager sees their reports' work, while a sibling
 * manager's work stays hidden. A member with nobody under them gets exactly
 * the same rows in both, which is the honest answer rather than leaking the
 * whole firm.
 */
export async function firmTeam(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Id<"users">[]> {
  const firm = await activeFirmSettings(ctx, userId);
  if (firm === null) return [userId];
  const team = new Set<Id<"users">>([userId]);
  const frontier: Id<"users">[] = [userId];
  while (frontier.length > 0) {
    const current = frontier.shift() as Id<"users">;
    for (const m of firm.members) {
      if (m.managerId === undefined) continue;
      if ((m.managerId as Id<"users">) === current && !team.has(m.userId)) {
        team.add(m.userId);
        frontier.push(m.userId);
      }
    }
  }
  return [...team];
}

/**
 * Who the caller may hand work to: their own down line, and — for the firm
 * owner and admins — anybody else in the firm. A lead can therefore give a job
 * to a peer instead of being stuck inside their own tree, while an ordinary
 * member still can't pass work sideways.
 */
export async function assignableIds(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Set<Id<"users">>> {
  const out = new Set<Id<"users">>(await firmTeam(ctx, userId));
  const firm = await activeFirmSettings(ctx, userId);
  if (firm === null) return out;
  const me = firm.members.find((m) => m.userId === userId);
  const role = me?.role;
  if (firm.ownerId === userId || role === "super" || role === "admin") {
    for (const m of firm.members) out.add(m.userId);
  }
  return out;
}

/**
 * Everyone above this person in the firm's management chain, nearest first.
 * The counterpart to firmTeam (which walks down): together they decide who can
 * see a task and who may be given one.
 */
export async function firmAncestors(
  ctx: Ctx,
  userId: Id<"users">,
): Promise<Id<"users">[]> {
  const firm = await activeFirmSettings(ctx, userId);
  if (firm === null) return [];
  const out: Id<"users">[] = [];
  const seen = new Set<Id<"users">>([userId]);
  let current = userId;
  for (;;) {
    const entry = firm.members.find((m) => m.userId === current);
    const managerId = entry?.managerId as Id<"users"> | undefined;
    // an unset or cyclic manager ends the chain
    if (managerId === undefined || seen.has(managerId)) break;
    out.push(managerId);
    seen.add(managerId);
    current = managerId;
  }
  return out;
}

/** Remember which firm this user is working in. */
export async function rememberActiveFirm(
  ctx: MutationCtx,
  userId: Id<"users">,
  firmId: Id<"users">,
): Promise<void> {
  await ctx.db.patch(userId, { activeFirmId: firmId });
}

/**
 * The id every organisation-owned row is scoped by — the *active firm's*
 * owner id, so members share their super admin's id and each firm keeps its
 * own tasks, notes, materials, products and projects. Users with no firm yet
 * fall back to their own id.
 *
 * Every data module resolves its scope through this, so nothing else has to
 * know about firms.
 */
export async function scopeUserId(ctx: Ctx): Promise<Id<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return (await activeFirmId(ctx, userId)) ?? userId;
}

/** Signed-in user + their active firm, for the account-management functions. */
export async function orgContext(ctx: Ctx): Promise<{
  userId: Id<"users">;
  settings: Firm | null;
  orgId: Id<"users">;
  isSuper: boolean;
}> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("Sign in first.");
  const settings = await activeFirmSettings(ctx, userId);
  return {
    userId,
    settings,
    orgId: settings?.ownerId ?? userId,
    isSuper: settings === null || settings.ownerId === userId,
  };
}
