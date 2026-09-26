import type { Id } from "@/convex/_generated/dataModel";

/** One person in the firm, as api.tasks.people returns them. */
export type Person = {
  userId: Id<"users">;
  label: string;
  managerId: Id<"users"> | null;
  isFirmOwner: boolean;
};

export type PeopleData = {
  me: Id<"users"> | null;
  firmOwnerId: Id<"users"> | null;
  people: Person[];
};

/**
 * This person plus everyone below them in the chain — their down line. The
 * server allows assigning work to exactly this set, so it is also the group a
 * manager can hand a task to in one action.
 */
export function downLineOf(
  people: Person[],
  rootId: Id<"users"> | null,
): Id<"users">[] {
  if (rootId === null) return [];
  const out = new Set<Id<"users">>([rootId]);
  const queue: Id<"users">[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift() as Id<"users">;
    for (const person of people) {
      if (person.managerId === current && !out.has(person.userId)) {
        out.add(person.userId);
        queue.push(person.userId);
      }
    }
  }
  return [...out];
}

/**
 * The people a task currently sits with. A task written before ownership was
 * tracked carries the firm's own id in `assigneeId` and never recorded an
 * author, so it reads as shared rather than blaming the firm owner; its
 * assignees are then nobody's in particular.
 */
export function assigneesOfTask(
  task: {
    assigneeId?: Id<"users">;
    assigneeIds?: Id<"users">[];
    assignedAt?: number;
  },
  peopleById: Map<Id<"users">, Person>,
): Id<"users">[] {
  const stampedOwner =
    task.assigneeId === undefined ? null : (peopleById.get(task.assigneeId) ?? null);
  const isShared =
    stampedOwner === null ||
    (stampedOwner.isFirmOwner && task.assignedAt === undefined);
  if (isShared) return [];
  return task.assigneeIds ??
    (task.assigneeId === undefined ? [] : [task.assigneeId]);
}

/** Short label for who a task is with: "Ravi, sabood +1" or "Not assigned". */
export function assigneeLabel(
  assignees: Id<"users">[],
  peopleById: Map<Id<"users">, Person>,
): string {
  if (assignees.length === 0) return "Not assigned";
  const names = assignees.map((id) => peopleById.get(id)?.label ?? "Someone");
  const head = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${head} +${names.length - 2}` : head;
}

/** Everyone above this person, nearest first. Stops on an unset or cyclic link. */
export function upLineOf(
  people: Person[],
  id: Id<"users"> | null,
): Id<"users">[] {
  if (id === null) return [];
  const byId = new Map<Id<"users">, Person>(
    people.map((p) => [p.userId, p] as const),
  );
  const out: Id<"users">[] = [];
  const seen = new Set<Id<"users">>([id]);
  let current: Id<"users"> | null = id;
  while (current !== null) {
    const managerId: Id<"users"> | null =
      byId.get(current)?.managerId ?? null;
    if (managerId === null || seen.has(managerId)) break;
    out.push(managerId);
    seen.add(managerId);
    current = managerId;
  }
  return out;
}
