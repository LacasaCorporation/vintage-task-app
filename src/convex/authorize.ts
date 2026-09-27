import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { activeFirmSettings } from "./org";
import {
  canItem,
  type ActionKey,
  type GranularPerms,
  type ItemKey,
} from "../lib/permissions";

/**
 * Server-side permission gate.
 *
 * The UI hides what a person may not do, but the UI is not the boundary — the
 * mutation is. Every create, edit and delete calls this before it touches
 * anything, so calling one directly is refused in exactly the same words a
 * hidden button would have been.
 *
 * The rules mirror the client (`getMyAccess` / `canItem`) so the two never
 * disagree: the workspace owner may do anything, everyone else resolves their
 * custom role with their own per-user overrides layered on top, and anything
 * unconfigured stays allowed.
 */

/** One item's perms, custom role first and the member's overrides on top. */
function effectiveItemPerms(
  role: GranularPerms | undefined,
  member: GranularPerms | undefined,
  item: ItemKey,
): GranularPerms | undefined {
  if (role === undefined) return member;
  if (member === undefined) return role;
  const merged: Record<string, boolean> = {};
  const keys = new Set([
    ...Object.keys(role.items?.[item] ?? {}),
    ...Object.keys(member.items?.[item] ?? {}),
  ]);
  for (const action of keys) {
    const v =
      member.items?.[item]?.[action as ActionKey] ??
      role.items?.[item]?.[action as ActionKey];
    if (v !== undefined) merged[action] = v;
  }
  return {
    ...role,
    ...member,
    items: {
      ...role.items,
      ...member.items,
      [item]: merged,
    } as NonNullable<GranularPerms["items"]>,
  } as GranularPerms;
}

/**
 * Throws unless the caller may perform `action` on `item`.
 *
 * A caller who is not a member of the active firm has no rights in it at all,
 * which is a different failure from "permission not granted" and is reported
 * as such.
 */
export async function requireItem(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  item: ItemKey,
  action: ActionKey,
): Promise<void> {
  const firm = await activeFirmSettings(ctx, userId);
  // No firm yet means the workspace is still being created — there is nothing
  // to enforce, and the caller is the one creating it.
  if (firm === null) return;
  if (firm.ownerId === userId) return; // the super user grants themselves all

  const me = firm.members.find((m) => m.userId === userId);
  if (me === undefined) {
    throw new Error("You are not a member of this workspace.");
  }

  const memberPerms = me.permissions as GranularPerms | undefined;
  let perms: GranularPerms | undefined = memberPerms;
  if (me.customRoleId !== undefined) {
    const role = await ctx.db.get(me.customRoleId);
    if (role !== null) {
      perms = effectiveItemPerms(
        role.permissions as GranularPerms | undefined,
        memberPerms,
        item,
      );
    }
  }

  if (canItem(perms, item, action)) return;
  throw new Error(
    `You do not have permission to ${action} here. Ask an admin to grant it.`,
  );
}
