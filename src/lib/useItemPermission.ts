import { useCallback } from "react";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  canItem,
  type ActionKey,
  type GranularPerms,
  type ItemKey,
} from "@/lib/permissions";

/**
 * Item-level permission check for any component, so a rule like "only some
 * people may touch completed products" is enforced wherever the button is
 * rather than only where the permission is defined.
 */
export function useItemPermission(): (item: ItemKey, action: ActionKey) => boolean {
  const myAccess = useQuery(api.settings.getMyAccess);
  return useCallback(
    (item: ItemKey, action: ActionKey) => {
      if (myAccess?.role === "super") return true;
      return canItem(
        myAccess?.permissions as GranularPerms | undefined,
        item,
        action,
      );
    },
    [myAccess],
  );
}
