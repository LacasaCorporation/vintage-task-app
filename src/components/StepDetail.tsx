import { useRef } from "react";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Priority, Recurrence, TaskDoc } from "@/lib/task-utils";
import {
  PRIORITIES,
  RECURRENCE_LABEL,
  REMINDER_OFFSETS,
  daysLeftLabel,
  formatDueLabel,
  parseAttachments,
  toLocalInput,
} from "@/lib/task-utils";
import { cn } from "@/lib/utils";
import {
  AlarmClock,
  CalendarDays,
  Copy,
  FileText,
  Flag,
  ListTodo,
  Paperclip,
  Repeat,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";

export type StepDoc = Doc<"taskSteps">;

/** Everything a subtask can carry — the same fields a main task has. */
export type StepPatch = {
  text?: string;
  description?: string;
  dueAt?: number;
  remindAt?: number;
  priority?: Priority;
  tags?: string[];
  starred?: boolean;
  recurrence?: Recurrence;
  attachments?: string;
  copyFromTask?: boolean;
};

const chipBase =
  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors";

function Row({
  icon: Icon,
  label,
  onClear,
  children,
}: {
  icon: typeof CalendarDays;
  label: string;
  onClear?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 px-1 py-1.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        <div className="mt-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * Side detail pane for one subtask. It carries the same features as the main
 * task detail — title, notes, due date, reminder, priority, repeat, tags,
 * star and attachments — plus a one-click "copy everything from the task".
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
  onPatch: (patch: StepPatch) => void;
  onToggle: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const left = step.dueAt !== undefined ? daysLeftLabel(step.dueAt) : null;
  const attachments = parseAttachments(step.attachments);
  const disabled = !canEdit || busy;

  /** Add picked files to the step, keeping the ones already there. */
  const onFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    void Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<{ id: string; name: string; type: string; size: number; data: string }>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  id: `${Date.now()}-${file.name}`,
                  name: file.name,
                  type: file.type,
                  size: file.size,
                  data: String(reader.result),
                });
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            },
          ),
      ),
    )
      .then((added) => onPatch({ attachments: JSON.stringify([...attachments, ...added]) }))
      .catch(() => undefined);
  };

  return (
    <aside className="w-full rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListTodo className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm font-semibold">Subtask details</p>
          {step.isCompleted && (
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              Done
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onPatch({ starred: !step.starred })}
            disabled={disabled}
            aria-label={step.starred ? "Remove star" : "Star subtask"}
            className={cn(
              "grid size-7 place-items-center rounded-md transition-colors disabled:opacity-40",
              step.starred ? "text-amber-500" : "text-muted-foreground hover:bg-accent",
            )}
          >
            <Star className={cn("size-4", step.starred && "fill-amber-400")} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close subtask details"
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-lg border border-amber-500/25 bg-card px-2.5 py-2">
        <Checkbox
          checked={step.isCompleted}
          disabled={disabled}
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
          Subtask of <span className="font-medium text-foreground">{task.text}</span>
        </p>
      )}

      {canEdit && task && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => onPatch({ copyFromTask: true })}
          className="mb-2 h-8 w-full rounded-lg border-amber-500/30 bg-card text-xs text-amber-800 hover:bg-amber-500/10 hover:text-amber-900 dark:text-amber-300"
        >
          <Copy className="size-3" /> Copy all details from the task
        </Button>
      )}

      <Row icon={ListTodo} label="Title">
        <Input
          value={step.text}
          disabled={disabled}
          onChange={(e) => onPatch({ text: e.target.value })}
          className="h-9 rounded-lg text-sm"
        />
      </Row>

      <Row
        icon={CalendarDays}
        label="Due date"
        onClear={step.dueAt !== undefined ? () => onPatch({ dueAt: undefined }) : undefined}
      >
        <Input
          type="datetime-local"
          value={step.dueAt !== undefined ? toLocalInput(new Date(step.dueAt)) : ""}
          disabled={disabled}
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

      <Row
        icon={AlarmClock}
        label="Reminder"
        onClear={step.remindAt !== undefined ? () => onPatch({ remindAt: undefined }) : undefined}
      >
        <select
          value=""
          disabled={disabled}
          onChange={(e) => {
            const idx = Number(e.target.value);
            const minutes = REMINDER_OFFSETS[idx]?.minutes ?? null;
            const base = step.dueAt ?? step.remindAt ?? Date.now();
            onPatch({
              remindAt: minutes === null ? undefined : base - minutes * 60_000,
            });
          }}
          className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        >
          <option value="">
            {step.remindAt !== undefined
              ? `Reminds ${formatDueLabel(step.remindAt)}`
              : "Add a reminder…"}
          </option>
          {REMINDER_OFFSETS.map((r, i) => (
            <option key={r.label} value={i}>
              {r.label}
            </option>
          ))}
        </select>
      </Row>

      <Row icon={Flag} label="Priority">
        <div className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              disabled={disabled}
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

      <Row
        icon={Repeat}
        label="Repeat"
        onClear={step.recurrence ? () => onPatch({ recurrence: undefined }) : undefined}
      >
        <div className="flex flex-wrap gap-1.5">
          {(["daily", "weekly", "monthly"] as Recurrence[]).map((r) => (
            <button
              key={r}
              type="button"
              disabled={disabled}
              onClick={() =>
                onPatch({ recurrence: step.recurrence === r ? undefined : r })
              }
              className={cn(
                chipBase,
                step.recurrence === r
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {RECURRENCE_LABEL[r]}
            </button>
          ))}
        </div>
      </Row>

      <Row icon={Tag} label="Tags">
        <Input
          value={(step.tags ?? []).map((t) => `#${t}`).join(" ")}
          disabled={disabled}
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

      <Row icon={FileText} label="Notes">
        <Textarea
          value={step.description ?? ""}
          disabled={disabled}
          placeholder="Add more detail…"
          rows={4}
          onChange={(e) => onPatch({ description: e.target.value })}
          className="rounded-lg text-sm"
        />
      </Row>

      <Row
        icon={Paperclip}
        label="Attachments"
        onClear={
          attachments.length > 0 ? () => onPatch({ attachments: undefined }) : undefined
        }
      >
        {attachments.length > 0 ? (
          <ul className="mb-1.5 space-y-1">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-xs">
                <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                <a
                  href={a.data}
                  download={a.name}
                  className="min-w-0 flex-1 truncate text-primary hover:underline"
                >
                  {a.name}
                </a>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove attachment ${a.name}`}
                  onClick={() =>
                    onPatch({
                      attachments: JSON.stringify(
                        parseAttachments(step.attachments).filter((x) => x.id !== a.id),
                      ),
                    })
                  }
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => fileInput.current?.click()}
          className="h-8 w-full rounded-lg text-xs"
        >
          <Paperclip className="size-3" /> Attach files
        </Button>
      </Row>

      <div className="mt-2 flex items-center justify-between border-t border-amber-500/25 pt-2">
        <p className="text-[11px] text-muted-foreground">
          Added {formatDueLabel(step._creationTime)}
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
