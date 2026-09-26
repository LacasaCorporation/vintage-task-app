import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, Crown, Loader2, UserRound, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { TaskDoc } from "@/lib/task-utils";
import { assigneesOfTask, downLineOf, type Person } from "@/lib/task-people";
import { messageFrom } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** One person in the picker, with the depth they sit at and everyone below. */
type TreeRow = {
  person: Person;
  depth: number;
  group: Id<"users">[];
};

/**
 * Sidebar group picker: hand a task to one person or to a whole group.
 *
 * The server lets you assign only to yourself or to your own down line, so the
 * tree shown here is exactly that set — check people one by one, or take a
 * shortcut group ("my whole team", or a manager and everyone under them) and
 * assign the lot in one action.
 */
export default function TaskAssignPanel({
  tasks,
  canEdit = true,
}: {
  tasks: TaskDoc[];
  canEdit?: boolean;
}) {
  const peopleData = useQuery(api.tasks.people);
  const assignTask = useMutation(api.tasks.assign);
  const [open, setOpen] = useState(false);
  const [taskId, setTaskId] = useState<Id<"tasks"> | null>(null);
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
  // the caller's down line, tree order, with everyone below each person
  const rows = useMemo(() => {
    const build = (rootId: Id<"users"> | null, depth: number): TreeRow[] => {
      if (rootId === null) return [];
      return people
        .filter(
          (p) => p.managerId === rootId && teamSet.has(p.userId),
        )
        .flatMap((p) => [
          { person: p, depth, group: downLineOf(people, p.userId) },
          ...build(p.userId, depth + 1),
        ]);
    };
    return me === null
      ? []
      : [
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

  const openTasks = useMemo(() => tasks.filter((t) => !t.isCompleted), [tasks]);
  const target = openTasks.find((t) => t._id === taskId) ?? null;
  const current = useMemo(
    () => (target === null ? [] : assigneesOfTask(target, peopleById)),
    [target, peopleById],
  );
  const selection = picked ?? current;
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const disabled = !canEdit || busy;

  const toggleOne = (id: Id<"users">) =>
    setPicked(
      selectionSet.has(id)
        ? selection.filter((x) => x !== id)
        : [...selection, id],
    );

  /** Tick a whole group, or untick it when it is already all ticked. */
  const toggleGroup = (group: Id<"users">[]) => {
    const everyone = group.every((id) => selectionSet.has(id));
    const removing = new Set(everyone ? group : []);
    setPicked(
      everyone
        ? selection.filter((id) => !removing.has(id))
        : [...new Set([...selection, ...group])],
    );
  };

  const chooseTask = (value: string) => {
    setTaskId(value === "" ? null : (value as Id<"tasks">));
    setPicked(null);
  };

  const apply = async (userIds: Id<"users">[]) => {
    if (target === null) return;
    setBusy(true);
    try {
      await assignTask({ id: target._id, userIds });
      setPicked(null);
      const names = userIds.map(
        (id) => peopleById.get(id)?.label ?? "someone",
      );
      toast.success(
        userIds.length === 0
          ? "Task is no longer assigned to anyone."
          : `Assigned to ${names.join(", ")}.`,
      );
    } catch (error) {
      toast.error(messageFrom(error, "Could not assign that task."));
    } finally {
      setBusy(false);
    }
  };

  const reportCount = myTeam.length - 1;

  return (
    <div className="mb-3 rounded-xl border border-border/70 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Users className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/85">
          Assign to a group
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {reportCount > 0 ? `+${reportCount}` : "just me"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border/60 px-3 py-3">
          {peopleData === undefined ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading your team…
            </p>
          ) : openTasks.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No open tasks to assign yet.
            </p>
          ) : (
            <>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                  Task
                </span>
                <select
                  value={target?._id ?? ""}
                  onChange={(e) => chooseTask(e.target.value)}
                  className="h-8 w-full truncate rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">Choose a task…</option>
                  {openTasks.map((t) => (
                    <option key={t._id} value={t._id}>
                      {t.text}
                    </option>
                  ))}
                </select>
              </label>

              {target === null ? (
                <p className="text-[11px] text-muted-foreground">
                  Pick a task, then tick one person or a whole group below.
                </p>
              ) : (
                <>
                  {/* shortcut groups */}
                  <div className="flex flex-wrap gap-1.5">
                    <GroupChip
                      active={me !== null && selectionSet.has(me)}
                      onClick={() => me !== null && toggleGroup([me])}
                      label="Just me"
                    />
                    <GroupChip
                      active={
                        myTeam.length > 0 &&
                        myTeam.every((id) => selectionSet.has(id))
                      }
                      onClick={() => toggleGroup(myTeam)}
                      label={
                        reportCount > 0
                          ? `My whole team (${myTeam.length})`
                          : "My whole team"
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
                  <ul className="space-y-0.5">
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
                            <span
                              className="min-w-0 flex-1 truncate text-xs"
                              onClick={() => toggleOne(person.userId)}
                            >
                              {person.label}
                            </span>
                            {person.isFirmOwner && (
                              <Crown
                                className="size-3 shrink-0 text-primary"
                                aria-label="Firm owner"
                              />
                            )}
                            {row.group.length > 1 && (
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => toggleGroup(row.group)}
                                title={`${person.label} and the ${row.group.length - 1} below`}
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
                      Nobody reports to you yet, so this task can only be
                      assigned to you.
                    </p>
                  )}

                  <div className="flex items-center gap-2 pt-0.5">
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
                      Assign to {selection.length || "nobody"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={disabled || current.length === 0}
                      onClick={() => void apply([])}
                    >
                      Clear
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
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
        "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
