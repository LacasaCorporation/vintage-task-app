import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Priority, TaskDoc } from "@/lib/task-utils";
import {
  PRIORITIES,
  daysLeftLabel,
  formatDueLabel,
  toLocalInput,
} from "@/lib/task-utils";
import { cn } from "@/lib/utils";
import { CalendarDays, Copy, ListTodo, Star, Trash2, X } from "lucide-react";

export type StepDoc = Doc<"taskSteps">;

const chipBase =
  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors";

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarDays;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 px-1 py-1.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * Side detail pane for one subtask. It mirrors the main task's details —
 * title, description, due date, priority and tags — plus a "copy from task"
 * action that pulls the parent task's values in one click.
 */
export default function StepDetail({
  step,
  task,
  canEdit,
  canDelete,
  busy,
  onPatch,
  onToggle,
  onDelete,
  onClose,
}: {
  step: StepDoc;
  task: TaskDoc | null;
  canEdit: boolean;
  canDelete: boolean;
  busy?: boolean;
  onPatch: (patch: {
    text?: string;
    description?: string;
    dueAt?: number;
    priority?: Priority;
    tags?: string[];
    copyFromTask?: boolean;
  }) => void;
  onToggle: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const left = step.dueAt !== undefined ? daysLeftLabel(step.dueAt) : null;
  const hasTaskDetails =
    task?.dueAt !== undefined ||
    task?.priority !== undefined ||
    task?.description !== undefined ||
    (task?.tags ?? []).length > 0;

  return (
    <aside className="w-full rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListTodo className="size-4 shrink-0 text-primary" />
          <p className="text-sm font-semibold">Subtask details</p>
          {step.isCompleted && (
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              Done
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close subtask details"
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-2.5 py-2">
        <Checkbox
          checked={step.isCompleted}
          disabled={!canEdit || busy}
          onCheckedChange={onToggle}
          aria-label={step.isCompleted ? "Reopen subtask" : "Mark subtask as done"}
          className="size-4 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-2.5"
        />
        <span
          className={cn(
            "min-w-0 flex-1 text-sm",
            step.isCompleted && "text-muted-foreground line-through",
          )}
        >
          {step.text}
        </span>
      </label>

      {task && (
        <p className="mb-2 px-1 text-[11px] text-muted-foreground">
          Subtask of{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            title={task.text}
          >
            {task.text}
          </button>
        </p>
      )}

      {canEdit && hasTaskDetails && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onPatch({ copyFromTask: true })}
          className="mb-2 h-8 w-full rounded-lg text-xs"
        >
          <Copy className="size-3" /> Copy due date, priority, description &amp; tags from the task
        </Button>
      )}

      <Row icon={Star} label="Title">
        <Input
          value={step.text}
          disabled={!canEdit || busy}
          onChange={(e) => onPatch({ text: e.target.value })}
          className="h-9 rounded-lg text-sm"
        />
      </Row>

      <Row icon={CalendarDays} label="Due date">
        <Input
          type="datetime-local"
          value={step.dueAt !== undefined ? toLocalInput(new Date(step.dueAt)) : ""}
          disabled={!canEdit || busy}
          max={task?.dueAt !== undefined ? toLocalInput(new Date(task.dueAt)) : undefined}
          onChange={(e) =>
            onPatch({ dueAt: e.target.value ? new Date(e.target.value).getTime() : undefined })
          }
          className="h-9 rounded-lg text-sm"
        />
        {step.dueAt !== undefined && left && (
          <p
            className={cn(
              "mt-1 text-xs",
              left.overdue ? "font-medium text-destructive" : "text-muted-foreground",
            )}
          >
            {formatDueLabel(step.dueAt)} · <span className="font-medium">{left.text}</span>
          </p>
        )}
        {task?.dueAt !== undefined && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Can’t be later than the task’s due date ({formatDueLabel(task.dueAt)}).
          </p>
        )}
      </Row>

      <Row icon={Star} label="Priority">
        <div className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              disabled={!canEdit || busy}
              onClick={() =>
                onPatch({ priority: step.priority === p.value ? undefined : p.value })
              }
              className={cn(
                chipBase,
                step.priority === p.value
                  ? `${p.chip} border-transparent`
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <span className={cn("size-1.5 rounded-full", p.dot)} />
              {p.label}
            </button>
          ))}
        </div>
      </Row>

      <Row icon={ListTodo} label="Tags">
        <Input
          value={(step.tags ?? []).map((t) => `#${t}`).join(" ")}
          disabled={!canEdit || busy}
          placeholder="#work #urgent"
          onChange={(e) =>
            onPatch({
              tags: e.target.value
                .split(/[\s,]+/)
                .map((t) => t.replace(/^#/, "").trim().toLowerCase())
                .filter(Boolean),
            })
          }
          className="h-9 rounded-lg text-sm"
        />
      </Row>

      <Row icon={ListTodo} label="Description">
        <Textarea
          value={step.description ?? ""}
          disabled={!canEdit || busy}
          placeholder="Add more detail…"
          rows={4}
          onChange={(e) => onPatch({ description: e.target.value })}
          className="rounded-lg text-sm"
        />
      </Row>

      <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2">
        <p className="text-[11px] text-muted-foreground">
          Created {formatDueLabel(step._creationTime)}
        </p>
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onDelete}
            className="h-8 rounded-lg text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        )}
      </div>
    </aside>
  );
}
