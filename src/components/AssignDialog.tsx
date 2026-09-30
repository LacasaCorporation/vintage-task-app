import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Crown,
  Loader2,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { assigneesOfTask, downLineOf, type Person } from "@/lib/task-people";
import { messageFrom } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** The four things a person can be allowed to do with someone else's task. */
const RIGHTS = [
  { key: "canEdit", label: "Edit", hint: "title, notes, steps, files" },
  { key: "canComplete", label: "Complete", hint: "tick it off" },
  {
    key: "canChangeOptions",
    label: "Change options",
    hint: "date, priority, repeat, tags, hand it on",
  },
  { key: "canDelete", label: "Delete", hint: "remove the task" },
] as const;

type Grant = {
  canEdit: boolean;
  canDelete: boolean;
  canComplete: boolean;
  canChangeOptions: boolean;
};

const NO_GRANT: Grant = {
  canEdit: false,
  canDelete: false,
  canComplete: false,
  canChangeOptions: false,
};

/**
 * What the popup acts on. A task, a subtask, a flagged product and a project or
 * job all behave the same way, so they share this one popup — only the
 * functions behind it differ. A subtask has no permissions tab: what someone
 * may do to a step is what they may do to the task it belongs to.
 */
export type AssignTarget = {
  kind: "task" | "product" | "step" | "project" | "job";
  id:
    | Id<"tasks">
    | Id<"finishedGoods">
    | Id<"taskSteps">
    | Id<"projects">
    | Id<"projectJobs">;
  /** Who created it — the owner who may reassign and hand out permissions. */
  assigneeId?: Id<"users">;
  assignedAt?: number;
  assigneeIds?: Id<"users">[];
  groupIds?: Id<"userGroups">[];
};

/** Build a target from either kind of document. The kind is given by the
 *  caller, because a Convex id does not say which table it came from. */
export function targetOf(
  doc: {
    _id:
      | Id<"tasks">
      | Id<"finishedGoods">
      | Id<"taskSteps">
      | Id<"projects">
      | Id<"projectJobs">;
    assigneeId?: Id<"users">;
    assignedAt?: number;
    assigneeIds?: Id<"users">[];
    groupIds?: Id<"userGroups">[];
  },
  kind: AssignTarget["kind"],
): AssignTarget {
  return {
    kind,
    id: doc._id,
    assigneeId: doc.assigneeId,
    assignedAt: doc.assignedAt,
    assigneeIds: doc.assigneeIds,
    groupIds: doc.groupIds,
  };
}

/**
 * The "Assign to…" popup for one task or product.
 *
 * Two ways to share the work — tick people from your own down line, or tick a
 * whole group made in Settings — and, for everyone it is with, the four
 * permissions its owner may hand out. The owner keeps all four until they give
 * some away, so assigning work never quietly passes on the power to delete or
 * re-date it.
 */
export default function AssignDialog({
  target,
  open,
  onOpenChange,
  canEdit = true,
  title = "Assign this task",
}: {
  target: AssignTarget;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  canEdit?: boolean;
  title?: string;
}) {
  // The body keeps the ticked people, groups and permissions while the popup
  // is open, and forgets them the moment it closes. It lives inside
  // DialogContent (which Radix unmounts on close) and is keyed by the item, so
  // a half-finished pick on one task can never show up already ticked on the
  // next one.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <AssignBody
          key={`${target.kind}:${target.id}`}
          target={target}
          canEdit={canEdit}
          title={title}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function AssignBody({
  target,
  canEdit,
  title,
  onClose,
}: {
  target: AssignTarget;
  canEdit: boolean;
  title: string;
  onClose: () => void;
}) {
  const isProduct = target.kind === "product";
  const isStep = target.kind === "step";
  const isNode = target.kind === "project" || target.kind === "job";
  const nodeKind: "project" | "job" | null = isNode
    ? (target.kind as "project" | "job")
    : null;
  const nodeId = isNode ? String(target.id) : null;
  /** What this target is called, for the wording on the popup. */
  const noun: "task" | "subtask" | "product" | "project" | "job" =
    target.kind === "step" ? "subtask" : target.kind;
  const taskId = target.kind === "task" ? (target.id as Id<"tasks">) : null;
  const productId = isProduct ? (target.id as Id<"finishedGoods">) : null;
  const stepId = isStep ? (target.id as Id<"taskSteps">) : null;
  const peopleData = useQuery(api.tasks.people);
  const groupsData = useQuery(api.userGroups.list);
  // both kinds are queried, but the one that does not apply is skipped
  const taskGrants = useQuery(
    api.tasks.grants,
    taskId === null ? "skip" : { taskId },
  );
  const productGrants = useQuery(
    api.productTasks.grants,
    productId === null ? "skip" : { id: productId },
  );
  const nodeGrants = useQuery(
    api.projectTasks.grants,
    nodeKind === null || nodeId === null
      ? "skip"
      : { kind: nodeKind, id: nodeId },
  );
  const grantsData = isStep
    ? undefined
    : isNode
      ? nodeGrants
      : isProduct
        ? productGrants
        : taskGrants;
  const assignTask = useMutation(api.tasks.assign);
  const assignProduct = useMutation(api.productTasks.assign);
  const assignStepM = useMutation(api.tasks.assignStep);
  const assignNode = useMutation(api.projectTasks.assign);
  const setTaskGrant = useMutation(api.tasks.setGrant);
  const setProductGrant = useMutation(api.productTasks.setGrant);
  const setNodeGrant = useMutation(api.projectTasks.setGrant);
  const [tab, setTab] = useState<"people" | "groups" | "rights">("people");
  const [busy, setBusy] = useState(false);

  const people = useMemo(() => peopleData?.people ?? [], [peopleData]);
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.userId, p] as const)),
    [people],
  );
  const groups = useMemo(() => groupsData ?? [], [groupsData]);
  const groupsById = useMemo(
    () => new Map(groups.map((g) => [g._id, g] as const)),
    [groups],
  );

  const assignees = useMemo(
    () => assigneesOfTask(target, peopleById),
    [target, peopleById],
  );
  const holderIds = useMemo(
    () => [
      ...new Set(
        assignees.concat(
          (target.groupIds ?? []).flatMap(
            (id) => groupsById.get(id)?.memberIds ?? [],
          ),
        ),
      ),
    ],
    [assignees, target.groupIds, groupsById],
  );

  const myTeam = useMemo(
    () => downLineOf(people, peopleData?.me ?? null),
    [people, peopleData],
  );
  const teamSet = useMemo(() => new Set(myTeam), [myTeam]);
  const rows = useMemo(
    () => myTeam.map((id) => peopleById.get(id)).filter((p) => p !== undefined),
    [myTeam, peopleById],
  );
  // Anyone else in the firm who is not under the caller — a peer on another
  // branch of the tree. They are listed too: a lead can hand work sideways, and
  // hiding them made it look as though the firm had nobody else in it.
  const others = useMemo(
    () => people.filter((p) => !teamSet.has(p.userId)),
    [people, teamSet],
  );

  const [picked, setPicked] = useState<Id<"users">[] | null>(null);
  const [pickedGroups, setPickedGroups] = useState<Id<"userGroups">[] | null>(
    null,
  );
  const selection = picked ?? assignees;
  const groupSelection = pickedGroups ?? target.groupIds ?? [];
  const selectionSet = useMemo(() => new Set(selection), [selection]);
  const groupSet = useMemo(() => new Set(groupSelection), [groupSelection]);

  const grantByUser = useMemo(() => {
    const map = new Map<Id<"users">, Grant>();
    for (const g of grantsData?.grants ?? []) {
      map.set(g.userId, {
        canEdit: g.canEdit,
        canDelete: g.canDelete,
        canComplete: g.canComplete,
        canChangeOptions: g.canChangeOptions,
      });
    }
    return map;
  }, [grantsData]);
  const isOwner = grantsData?.isOwner ?? false;

  const toggle = (id: Id<"users">) =>
    setPicked(
      selectionSet.has(id)
        ? selection.filter((x) => x !== id)
        : [...selection, id],
    );

  const toggleWhole = (group: Id<"users">[]) => {
    const everyone = group.every((id) => selectionSet.has(id));
    setPicked(
      everyone
        ? selection.filter((id) => !group.includes(id))
        : [...new Set([...selection, ...group])],
    );
  };

  const toggleGroup = (id: Id<"userGroups">) =>
    setPickedGroups(
      groupSet.has(id)
        ? groupSelection.filter((g) => g !== id)
        : [...groupSelection, id],
    );

  const save = async (nextUsers: Id<"users">[], nextGroups: Id<"userGroups">[]) => {
    setBusy(true);
    try {
      if (isNode) {
        await assignNode({
          kind: nodeKind as "project" | "job",
          id: nodeId as string,
          userIds: nextUsers,
          groupIds: nextGroups,
        });
      } else if (isProduct) {
        await assignProduct({
          id: productId as Id<"finishedGoods">,
          userIds: nextUsers,
          groupIds: nextGroups,
        });
      } else if (isStep) {
        await assignStepM({
          id: stepId as Id<"taskSteps">,
          userIds: nextUsers,
          groupIds: nextGroups,
        });
      } else {
        await assignTask({
          id: taskId as Id<"tasks">,
          userIds: nextUsers,
          groupIds: nextGroups,
        });
      }
      setPicked(null);
      setPickedGroups(null);
      const who = [
        ...nextUsers.map((id) => peopleById.get(id)?.label ?? "someone"),
        ...nextGroups.map((id) => groupsById.get(id)?.name ?? "a group"),
      ];
      toast.success(
        who.length === 0
          ? `This ${noun} is no longer assigned to anyone.`
          : `Assigned to ${who.join(", ")}.`,
      );
      onClose();
    } catch (error) {
      toast.error(
        messageFrom(error, `Couldn't assign that ${noun}.`),
      );
    } finally {
      setBusy(false);
    }
  };

  const saveGrant = async (userId: Id<"users">, next: Grant) => {
    setBusy(true);
    try {
      if (isNode) {
        await setNodeGrant({
          kind: nodeKind as "project" | "job",
          id: nodeId as string,
          userId,
          ...next,
        });
      } else if (isProduct) {
        await setProductGrant({
          id: productId as Id<"finishedGoods">,
          userId,
          ...next,
        });
      } else {
        await setTaskGrant({ taskId: taskId as Id<"tasks">, userId, ...next });
      }
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't change their permission."));
    } finally {
      setBusy(false);
    }
  };

  const personRow = (person: Person) => (
    <li
      key={person.userId}
      className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
    >
      <Checkbox
        checked={selectionSet.has(person.userId)}
        disabled={!canEdit}
        onCheckedChange={() => toggle(person.userId)}
        aria-label={`Assign to ${person.label}`}
        className="size-3.5 rounded-[3px]"
      />
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => toggle(person.userId)}
        className="min-w-0 flex-1 truncate text-left text-sm"
      >
        {person.label}
      </button>
      {person.isFirmOwner && <Crown className="size-3 shrink-0 text-primary" />}
      {downLineOf(people, person.userId).length > 1 && (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => toggleWhole(downLineOf(people, person.userId))}
          title={`${person.label} and everyone below`}
          className="shrink-0 rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          +{downLineOf(people, person.userId).length - 1}
        </button>
      )}
    </li>
  );

  const dirty =
    (picked !== null &&
      (picked.length !== assignees.length ||
        picked.some((id, i) => id !== assignees[i]))) ||
    (pickedGroups !== null &&
      (pickedGroups.length !== groupSelection.length ||
        pickedGroups.some((id, i) => id !== groupSelection[i])));

  return (
    <>
      <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isStep
              ? "Hand this subtask to people or to a group. What they may do to it is what they may do to the task."
              : isOwner
                ? `You created this ${noun}, so you can edit, complete, change and delete it. Tick who else may — and what they may do.`
                : `Hand this ${noun} to people or to a group. Only the person who created it can change what they may do.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
          {(
            [
              ["people", "People", UserRound],
              ["groups", "Groups", Users],
              // a subtask borrows the task's permissions, so it offers none
              ...(isStep
                ? []
                : [["rights", "Permissions", ShieldCheck] as const]),
            ] as [typeof tab, string, typeof UserRound][]
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        {peopleData === undefined ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading your team…
          </p>
        ) : tab === "people" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              <Chip
                active={
                  peopleData.me !== null && selectionSet.has(peopleData.me)
                }
                onClick={() =>
                  peopleData.me !== null && toggleWhole([peopleData.me])
                }
                label="Just me"
              />
              <Chip
                active={myTeam.every((id) => selectionSet.has(id))}
                onClick={() => toggleWhole(myTeam)}
                label={`My whole team (${myTeam.length})`}
              />
              {others.length > 0 && (
                <Chip
                  active={people.every((p) => selectionSet.has(p.userId))}
                  onClick={() =>
                    toggleWhole(people.map((p) => p.userId))
                  }
                  label={`Everyone here (${people.length})`}
                />
              )}
              {rows
                .filter((p) => teamSet.has(p.userId) && p.managerId === peopleData.me)
                .map((p) => {
                  const group = downLineOf(people, p.userId);
                  return group.length > 1 ? (
                    <Chip
                      key={p.userId}
                      active={group.every((id) => selectionSet.has(id))}
                      onClick={() => toggleWhole(group)}
                      label={`${p.label} +${group.length - 1}`}
                    />
                  ) : null;
                })}
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  My team
                </p>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                  {rows.map(personRow)}
                </ul>
              </div>
              {others.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Others in the firm
                  </p>
                  <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                    {others.map(personRow)}
                  </ul>
                </div>
              )}
              {people.length <= 1 && (
                <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  You are the only person in this firm so far. Add the others in
                  Settings → Members (by email) — they join this list, and you
                  can hand work straight to them.
                </p>
              )}
            </div>
          </div>
        ) : tab === "groups" ? (
          <div className="space-y-2">
            {groups.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                No groups yet. Make one in Settings → User groups — for example
                “Site crew” — and it shows up here.
              </p>
            ) : (
              <ul className="space-y-1">
                {groups.map((group) => {
                  const on = groupSet.has(group._id);
                  return (
                    <li
                      key={group._id}
                      className="flex items-start gap-2 rounded-lg border border-border/70 px-2.5 py-2"
                    >
                      <Checkbox
                        checked={on}
                        disabled={!canEdit}
                        onCheckedChange={() => toggleGroup(group._id)}
                        aria-label={`Assign to the ${group.name} group`}
                        className="mt-0.5 size-3.5 rounded-[3px]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {group.name}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {group.memberIds.length} member
                          {group.memberIds.length === 1 ? "" : "s"}
                          {group.memberIds.length > 0 &&
                            ` · ${group.memberIds
                              .map((id) => peopleById.get(id)?.label ?? "someone")
                              .slice(0, 3)
                              .join(", ")}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {!isOwner ? (
              <p className="py-6 text-sm text-muted-foreground">
                Only the person who created this {noun} can hand out
                permissions.
              </p>
            ) : holderIds.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                Assign it to someone first, then choose what they may do.
              </p>
            ) : (
              <ul className="space-y-2">
                {holderIds.map((id) => {
                  const person = peopleById.get(id);
                  const grant = grantByUser.get(id) ?? NO_GRANT;
                  const none = RIGHTS.every((r) => grant[r.key] === false);
                  return (
                    <li
                      key={id}
                      className="rounded-lg border border-border/70 px-2.5 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {person?.label ?? "Someone"}
                        </span>
                        {none ? (
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            can view only
                          </span>
                        ) : (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                            {RIGHTS.filter((r) => grant[r.key]).length} of{" "}
                            {RIGHTS.length}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        {RIGHTS.map((right) => (
                          <button
                            key={right.key}
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void saveGrant(id, {
                                ...grant,
                                [right.key]: !grant[right.key],
                              })
                            }
                            title={right.hint}
                            className={cn(
                              "rounded-md border px-2 py-1 text-left text-[11px] transition-colors disabled:opacity-50",
                              grant[right.key]
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                          >
                            {right.label}
                          </button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {tab === "rights" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void save([], [])}
                disabled={busy || (selection.length === 0 && groupSelection.length === 0)}
              >
                Clear
              </Button>
              <Button
                size="sm"
                onClick={() => void save(selection, groupSelection)}
                disabled={busy || !canEdit || !dirty}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <UserRound className="size-3.5" />
                )}
                Save
              </Button>
            </>
          )}
        </DialogFooter>
    </>
  );
}

function Chip({
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
