import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ChevronDown, Loader2, UserRound, Users } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import PeopleGroupPicker from "@/components/PeopleGroupPicker";
import type { TaskDoc } from "@/lib/task-utils";
import { assigneeLabel, assigneesOfTask } from "@/lib/task-people";
import { cn } from "@/lib/utils";

/**
 * Sidebar group picker: choose a task, then hand it to one person or to a whole
 * group in the firm. The people tree and the shortcut groups live in
 * `PeopleGroupPicker`, shared with the task detail panel.
 */
export default function TaskAssignPanel({
  tasks,
  canEdit = true,
}: {
  tasks: TaskDoc[];
  canEdit?: boolean;
}) {
  const peopleData = useQuery(api.tasks.people);
  const [open, setOpen] = useState(true);
  const [taskId, setTaskId] = useState<Id<"tasks"> | null>(null);

  const peopleById = useMemo(
    () => new Map((peopleData?.people ?? []).map((p) => [p.userId, p] as const)),
    [peopleData],
  );
  const openTasks = useMemo(() => tasks.filter((t) => !t.isCompleted), [tasks]);
  const target = openTasks.find((t) => t._id === taskId) ?? null;
  const assignees = useMemo(
    () => (target === null ? [] : assigneesOfTask(target, peopleById)),
    [target, peopleById],
  );

  return (
    <div className="mb-3 rounded-xl border border-border/70 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <Users className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground/85">
          Assign task to a person or group
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
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
                  onChange={(e) =>
                    setTaskId(
                      e.target.value === ""
                        ? null
                        : (e.target.value as Id<"tasks">),
                    )
                  }
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
                  Pick a task above, then tick one person or a whole group.
                </p>
              ) : (
                <>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <UserRound className="size-3 shrink-0" />
                    Now with{" "}
                    <span className="truncate font-medium text-foreground/80">
                      {assigneeLabel(assignees, peopleById)}
                    </span>
                  </p>
                  <PeopleGroupPicker
                    key={target._id}
                    taskId={target._id}
                    assignees={assignees}
                    canEdit={canEdit}
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
