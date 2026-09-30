import { useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import type { Doc } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import AssignDialog, { targetOf } from "@/components/AssignDialog";
import TaskComments from "@/components/TaskComments";
import TaskIssues from "@/components/TaskIssues";
import { assigneeLabel, assigneesOfTask } from "@/lib/task-people";
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
  Plus,
  Repeat,
  Star,
  Tag,
  Trash2,
  UserRound,
  Users,
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
 * task detail — title, who it is with, notes, due date, reminder, priority,
 * repeat, tags, star, attachments, the issues raised against it and its own
 * conversation — plus a one-click "copy everything from the task".
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
  const [assignOpen, setAssignOpen] = useState(false);
  // the same people list the task panel uses, so a subtask can be handed to
  // someone in its own right
  const peopleData = useQuery(api.tasks.people);
  const groupsData = useQuery(api.userGroups.list);

  const peopleById = useMemo(
    () => new Map((peopleData?.people ?? []).map((p) => [p.userId, p] as const)),
    [peopleData],
  );
  const groupsById = useMemo(
    () => new Map((groupsData ?? []).map((g) => [g._id, g] as const)),
    [groupsData],
  );
  const assignees = useMemo(
    () => assigneesOfTask(step, peopleById),
    [step, peopleById],
  );
  const groupIds = useMemo(() => step.groupIds ?? [], [step.groupIds]);
  const withLabel = useMemo(() => {
    const who = assigneeLabel(assignees, peopleById);
    const groupNames = groupIds
      .map((id) => groupsById.get(id)?.name)
      .filter((n): n is string => n !== undefined);
    if (who === "Not assigned" && groupNames.length === 0) return "Not assigned";
    return [who === "Not assigned" ? null : who, ...groupNames]
      .filter((part): part is string => part !== null)
      .join(" · ");
  }, [assignees, peopleById, groupIds, groupsById]);
  // Text fields are edited locally and saved on blur / Enter. Writing every
  // keystroke straight to the server would re-render the field with the old
  // value and drop characters, so the drafts hold the text until they settle.
  const [title, setTitle] = useState(step.text);
  const [notes, setNotes] = useState(step.description ?? "");
  const [tagsText, setTagsText] = useState(
    (step.tags ?? []).map((t) => `#${t}`).join(" "),
  );
  const [tagFocused, setTagFocused] = useState(false);

  // a different subtask is open: reload every draft from it
  const [draftStepId, setDraftStepId] = useState(step._id);
  if (draftStepId !== step._id) {
    setDraftStepId(step._id);
    setTitle(step.text);
    setNotes(step.description ?? "");
    setTagsText((step.tags ?? []).map((t) => `#${t}`).join(" "));
  }

  const parsedTags = tagsText
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").trim().toLowerCase())
    .filter(Boolean);

  const commitTitle = () => {
    const clean = title.trim();
    if (clean === step.text) return;
    // never let the field go blank — fall back to the saved text
    setTitle(clean === "" ? step.text : clean);
    if (clean !== "") onPatch({ text: clean });
  };

  const commitNotes = () => {
    if (notes === (step.description ?? "")) return;
    onPatch({ description: notes });
  };

  const commitTags = () => {
    const current = (step.tags ?? []).join(",");
    if (parsedTags.join(",") === current) return;
    onPatch({ tags: parsedTags });
  };

  /** The + button: merge whatever is typed into the saved tags, then clear. */
  const addTags = () => {
    if (parsedTags.length === 0) return;
    const merged = [...new Set([...(step.tags ?? []), ...parsedTags])];
    setTagsText("");
    if (merged.join(",") === (step.tags ?? []).join(",")) return;
    onPatch({ tags: merged });
  };
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
          {title}
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
          onClick={() => {
            onPatch({ copyFromTask: true });
            if (task) {
              setNotes(task.description ?? "");
              setTagsText((task.tags ?? []).map((t) => `#${t}`).join(" "));
            }
          }}
          className="mb-2 h-8 w-full rounded-lg border-amber-500/30 bg-card text-xs text-amber-800 hover:bg-amber-500/10 hover:text-amber-900 dark:text-amber-300"
        >
          <Copy className="size-3" /> Copy all details from the task
        </Button>
      )}

      <Row icon={ListTodo} label="Title">
        <Input
          value={title}
          disabled={disabled}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            }
          }}
          className="h-9 rounded-lg text-sm"
        />
      </Row>

      {/* who this subtask is with — people or a group, like the task panel */}
      <Row icon={Users} label="Assigned to">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setAssignOpen(true)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50",
            (assignees.length > 0 || groupIds.length > 0) &&
              "border-primary/40 bg-primary/5",
          )}
        >
          <UserRound
            className={cn(
              "size-3.5 shrink-0",
              assignees.length > 0 ? "text-primary" : "text-muted-foreground",
            )}
          />
          <span className="min-w-0 flex-1 truncate">{withLabel}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            Assign…
          </span>
        </button>
        {groupIds.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {groupIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
              >
                <Users className="size-2.5" />
                {groupsById.get(id)?.name ?? "Group"}
              </span>
            ))}
          </div>
        )}
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

      <Row
        icon={Tag}
        label="Tags"
        onClear={step.tags !== undefined ? () => onPatch({ tags: undefined }) : undefined}
      >
        {(step.tags ?? []).length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {(step.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                #{tag}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove tag ${tag}`}
                  className="text-primary/60 hover:text-primary"
                  onClick={() =>
                    onPatch({
                      tags: (step.tags ?? []).filter((t) => t !== tag),
                    })
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addTags();
          }}
          className="flex gap-1.5"
        >
          <Input
            value={tagsText}
            disabled={disabled}
            placeholder="Add a tag…"
            onChange={(e) => setTagsText(e.target.value)}
            onFocus={() => setTagFocused(true)}
            onBlur={() => {
              setTagFocused(false);
              commitTags();
            }}
            className="h-9 rounded-lg text-sm"
          />
          <Button
            type="submit"
            size="sm"
            disabled={disabled || parsedTags.length === 0}
            className="h-9 shrink-0 rounded-lg px-2.5"
          >
            <Plus className="size-3.5" /> Add
          </Button>
        </form>
        {tagFocused && parsedTags.length > 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Will save as {parsedTags.map((t) => `#${t}`).join(" ")}
          </p>
        )}
      </Row>

      <Row icon={FileText} label="Notes">
        <Textarea
          value={notes}
          disabled={disabled}
          placeholder="Add more detail…"
          rows={4}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={commitNotes}
          className="rounded-lg text-sm"
        />
      </Row>

      {/* problems raised against this subtask, and how each was put right — the
          same panel the task uses, narrowed to this step */}
      {task !== null && (
        <div className="mt-3">
          <TaskIssues
            taskId={task._id}
            stepId={step._id}
            canEdit={canEdit}
            compact
          />
        </div>
      )}

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

      {/* the subtask's own thread, kept apart from the task's conversation */}
      {task !== null && (
        <div className="mt-3">
          <TaskComments taskId={task._id} stepId={step._id} />
        </div>
      )}

      <AssignDialog
        target={targetOf(step, "step")}
        title="Assign this subtask"
        open={assignOpen}
        onOpenChange={setAssignOpen}
        canEdit={canEdit}
      />

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
