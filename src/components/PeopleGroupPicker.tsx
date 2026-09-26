import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Crown, Loader2, UserRound } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { downLineOf, type Person } from "@/lib/task-people";
import { messageFrom } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** One person in the picker, the depth they sit at, and everyone below them. */
type TreeRow = {
  person: Person;
  depth: number;
  group: Id<"users">[];
};

/**
 * Hand one task to one person or to a whole group.
 *
 * The server only allows assigning to yourself or your own down line, so the
 * tree shown here is exactly that set. Tick people one by one, or take a
 * shortcut group — yourself, your whole team, or a manager and everyone under
 * them — then apply. Used in the sidebar and in the task detail panel.
 */
export default function PeopleGroupPicker({
  taskId,
  assignees,
  canEdit = true,
  className,
}: {
  taskId: Id<"tasks">;
  /** Who the task sits with right now, as the task row stores it. */
  assignees: Id<"users">[];
  canEdit?: boolean;
  className?: string;
}) {
  const peopleData = useQuery(api.tasks.people);
  const assignTask = useMutation(api.tasks.assign);
  // null = "whatever the task already has"; set once the user starts choosing
  const [picked, setPicked] = useState<Id<"users">[] | null>(null);
  const [busy, setBusy] = useState(false);

  const me = peopleData?.me ?? null;
  const people = useMemo(() => peopleData?.people ?? [], [peopleData]);
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.userId, p] as const)),
    [people],
  );
  const myTeam = useMemo(() => downLineOf(people, me), [people, me]);
  const teamSet = useMemo(() => new Set(myTeam), [myTeam]);

  // the caller's down line in tree order, each with their own subtree
  const rows = useMemo(() => {
    const build = (rootId: Id<"users"> | null, depth: number): TreeRow[] => {
      if (rootId === null) return [];
      return people
        .filter((p) => p.managerId === rootId && teamSet.has(p.userId))
        .flatMap((p) => [
          { person: p, depth, group: downLineOf(people, p.userId) },
          ...build(p.userId, depth + 1),
        ]);
    };
    if (me === null) return [];
    return [
      {
        person: peopleById.get(me) ?? {
          userId: me,
          label: "Me",
          managerId: null,
          isFirmOwner: false,
        },
        depth: 0,
        group: myTeam,
      },
      ...build(me, 1),
    ];
  }, [people, peopleById, me, teamSet, myTeam]);

  const selection = picked ?? assignees;
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const disabled = !canEdit || busy;
  const reportCount = myTeam.length - 1;
  const loading = peopleData === undefined;

  const toggleOne = (id: Id<"users">) =>
    setPicked(
      selectionSet.has(id)
        ? selection.filter((x) => x !== id)
        : [...selection, id],
    );

  /** Tick a whole group, or untick it when it is already all ticked. */
  const toggleGroup = (group: Id<"users">[]) => {
    const everyone = group.every((id) => selectionSet.has(id));
    setPicked(
      everyone
        ? selection.filter((id) => !group.includes(id))
        : [...new Set([...selection, ...group])],
    );
  };

  const apply = async (userIds: Id<"users">[]) => {
    setBusy(true);
    try {
      await assignTask({ id: taskId, userIds });
      setPicked(null);
      const names = userIds.map((id) => peopleById.get(id)?.label ?? "someone");
      toast.success(
        userIds.length === 0
          ? "Task is no longer assigned to anyone."
          : `Assigned to ${names.join(", ")}.`,
      );
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't assign that task."));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Loading your team…
      </p>
    );
  }

  return (
    <div className={cn("space-y-2.5", className)}>
      {/* shortcut groups */}
      <div className="flex flex-wrap gap-1.5">
        <GroupChip
          active={me !== null && selectionSet.has(me)}
          onClick={() => me !== null && toggleGroup([me])}
          label="Just me"
        />
        <GroupChip
          active={
            myTeam.length > 0 && myTeam.every((id) => selectionSet.has(id))
          }
          onClick={() => toggleGroup(myTeam)}
          label={
            reportCount > 0 ? `My whole team (${myTeam.length})` : "My whole team"
          }
        />
        {rows
          .filter((r) => r.depth === 1 && r.group.length > 1)
          .map((r) => (
            <GroupChip
              key={r.person.userId}
              active={r.group.every((id) => selectionSet.has(id))}
              onClick={() => toggleGroup(r.group)}
              label={`${r.person.label} +${r.group.length - 1}`}
            />
          ))}
      </div>

      {/* the down line, one row per person */}
      <ul className="max-h-56 space-y-0.5 overflow-y-auto pr-0.5">
        {rows.map((row) => {
          const person = row.person;
          const on = selectionSet.has(person.userId);
          return (
            <li key={person.userId}>
              <div
                className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
                style={{ paddingLeft: `${4 + row.depth * 10}px` }}
              >
                <Checkbox
                  checked={on}
                  disabled={disabled}
                  onCheckedChange={() => toggleOne(person.userId)}
                  aria-label={`Assign to ${person.label}`}
                  className="size-3.5 rounded-[3px]"
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleOne(person.userId)}
                  className="min-w-0 flex-1 truncate text-left text-xs"
                >
                  {person.label}
                </button>
                {person.isFirmOwner && (
                  <Crown
                    className="size-3 shrink-0 text-primary"
                    aria-label="Owns this firm"
                  />
                )}
                {row.group.length > 1 && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => toggleGroup(row.group)}
                    title={`${person.label} and the ${row.group.length - 1} below them`}
                    className="shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    +{row.group.length - 1}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {rows.length <= 1 && (
        <p className="text-[11px] text-muted-foreground">
          Nobody reports to you yet, so this task can only be assigned to you.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-8 flex-1 text-xs"
          disabled={disabled || selection.length === 0}
          onClick={() => void apply(selection)}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <UserRound className="size-3.5" />
          )}
          Assign to {selection.length}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={disabled || assignees.length === 0}
          onClick={() => void apply([])}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}

function GroupChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
