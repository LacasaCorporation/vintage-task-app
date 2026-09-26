import type { Id } from "@/convex/_generated/dataModel";
import { Crown, UserRound, Users } from "lucide-react";
import type { Person } from "@/lib/task-people";
import { cn } from "@/lib/utils";

/**
 * Who a task or product sits with, as one chip: the person's name (with a
 * crown when they own the firm), the first two names plus a count for several,
 * or "Not assigned" — the same chip on a normal task row and on a product card,
 * so the two read the same.
 */
export default function AssigneeChip({
  userIds,
  peopleById,
  className,
}: {
  userIds: Id<"users">[];
  peopleById: Map<Id<"users">, Person>;
  className?: string;
}) {
  const label = (id: Id<"users">) => peopleById.get(id)?.label ?? "Someone";

  if (userIds.length === 1) {
    const person = peopleById.get(userIds[0] as Id<"users">);
    return (
      <span
        className={cn(
          "inline-flex max-w-40 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
          person?.isFirmOwner
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
          className,
        )}
        title={
          person?.isFirmOwner === true
            ? `${person.label} — owns this firm`
            : `Assigned to ${label(userIds[0] as Id<"users">)}`
        }
      >
        {person?.isFirmOwner ? (
          <Crown className="size-2.5" />
        ) : (
          <UserRound className="size-2.5" />
        )}
        <span className="truncate">{label(userIds[0] as Id<"users">)}</span>
      </span>
    );
  }

  if (userIds.length > 1) {
    return (
      <span
        className={cn(
          "inline-flex max-w-56 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
          className,
        )}
        title={userIds.map(label).join(", ")}
      >
        <Users className="size-2.5" />
        <span className="truncate">
          {userIds.slice(0, 2).map(label).join(", ")}
          {userIds.length > 2 ? ` +${userIds.length - 2}` : ""}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
        className,
      )}
      title="Nobody is assigned yet — it is shared with everyone in the firm"
    >
      <Users className="size-2.5" />
      Not assigned
    </span>
  );
}
