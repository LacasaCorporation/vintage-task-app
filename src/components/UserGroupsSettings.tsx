import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { messageFrom } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Settings → User groups: named groups of people ("Site crew", "Accounts") that
 * a task can be assigned to in one action. Anyone in the firm can read the
 * list, because seeing "assigned to Site crew" has to mean something; the firm
 * owner and admins create and edit the groups.
 */
export default function UserGroupsSettings({ canManage }: { canManage: boolean }) {
  const groups = useQuery(api.userGroups.list);
  const peopleData = useQuery(api.tasks.people);
  const createGroup = useMutation(api.userGroups.create);
  const updateGroup = useMutation(api.userGroups.update);
  const removeGroup = useMutation(api.userGroups.remove);
  const [editing, setEditing] = useState<Id<"userGroups"> | "new" | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [members, setMembers] = useState<Id<"users">[]>([]);
  const [busy, setBusy] = useState(false);

  const people = useMemo(() => peopleData?.people ?? [], [peopleData]);
  const peopleById = useMemo(
    () => new Map(people.map((p) => [p.userId, p] as const)),
    [people],
  );

  const startNew = () => {
    setEditing("new");
    setName("");
    setNote("");
    setMembers([]);
  };

  const startEdit = (group: NonNullable<typeof groups>[number]) => {
    setEditing(group._id);
    setName(group.name);
    setNote(group.description ?? "");
    setMembers(group.memberIds);
  };

  const save = async () => {
    if (name.trim().length === 0) {
      toast.error("Give the group a name.");
      return;
    }
    setBusy(true);
    try {
      if (editing === "new") {
        await createGroup({ name: name.trim(), description: note.trim(), memberIds: members });
        toast.success("Group created.");
      } else if (editing !== null) {
        await updateGroup({ id: editing, name: name.trim(), description: note.trim(), memberIds: members });
        toast.success("Group updated.");
      }
      setEditing(null);
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't save the group."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: Id<"userGroups">) => {
    setBusy(true);
    try {
      await removeGroup({ id });
      if (editing === id) setEditing(null);
      toast.success("Group deleted. Tasks assigned to it keep their people.");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't delete the group."));
    } finally {
      setBusy(false);
    }
  };

  const toggleMember = (id: Id<"users">) =>
    setMembers((current) =>
      current.includes(id)
        ? current.filter((m) => m !== id)
        : [...current, id],
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-dashed bg-muted/30 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Groups of users</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Make a group once — a site crew, the accounts team, whoever you hand
            work to together — then assign a task to the whole group in one go
            from a task&apos;s <span className="font-medium">Assign…</span> popup.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={startNew} className="shrink-0">
            <Plus className="size-3.5" />
            New group
          </Button>
        )}
      </div>

      {/* the create / edit form */}
      {editing !== null && (
        <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-muted-foreground" />
            <p className="text-sm font-semibold">
              {editing === "new" ? "New group" : "Edit group"}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setEditing(null)}
            >
              <X className="size-3.5" />
              Cancel
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                Group name
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Site crew"
                maxLength={60}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                What they do (optional)
              </span>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Everyone on the Thursday rotation"
                rows={1}
                className="min-h-9 resize-none"
              />
            </label>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Members ({members.length})
            </p>
            {people.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Loading your people…
              </p>
            ) : (
              <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
                {people.map((person) => (
                  <li key={person.userId}>
                    <button
                      type="button"
                      onClick={() => toggleMember(person.userId)}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent"
                    >
                      <Checkbox
                        checked={members.includes(person.userId)}
                        className="size-3.5 rounded-[3px]"
                        tabIndex={-1}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {person.label}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {editing === "new" ? "Create group" : "Save changes"}
          </Button>
        </div>
      )}

      {/* the groups themselves */}
      {groups === undefined ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading groups…
        </div>
      ) : groups.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No groups yet{canManage ? " — create one above." : "."}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((group) => (
            <li
              key={group._id}
              className="rounded-xl border bg-card p-3.5 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Users className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{group.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {group.memberIds.length} member
                    {group.memberIds.length === 1 ? "" : "s"}
                  </p>
                </div>
                {canManage && (
                  <span className="flex shrink-0 gap-0.5">
                    <button
                      type="button"
                      aria-label={`Edit ${group.name}`}
                      title="Edit group"
                      onClick={() => startEdit(group)}
                      className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="size-3" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${group.name}`}
                      title="Delete group"
                      onClick={() => void remove(group._id)}
                      className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </span>
                )}
              </div>
              {group.description && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {group.description}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {group.memberIds.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">
                    No members yet
                  </span>
                ) : (
                  group.memberIds.map((id) => (
                    <span
                      key={id}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
                      )}
                    >
                      <UserRound className="size-2.5" />
                      {peopleById.get(id)?.label ?? "Someone"}
                    </span>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
