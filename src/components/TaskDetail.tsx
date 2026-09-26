import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { TaskDoc } from "@/lib/task-utils";
import {
  PRIORITIES,
  RECURRENCE_LABEL,
  REMINDER_OFFSETS,
  daysLeftLabel,
  defaultDueLocal,
  formatDueLabel,
  isOverdue,
  parseAttachments,
  toLocalInput,
} from "@/lib/task-utils";
import { cn } from "@/lib/utils";
import {
  AlarmClock,
  CalendarDays,
  FileText,
  Flag,
  Link2,
  ListTodo,
  Loader2,
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
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import AssignDialog from "@/components/AssignDialog";
import { assigneeLabel, assigneesOfTask } from "@/lib/task-people";

type Priority = "high" | "medium" | "low";
type Recurrence = "daily" | "weekly" | "monthly";

function Row({
  icon: Icon,
  label,
  children,
  onClear,
  locked = false,
}: {
  icon: typeof CalendarDays;
  label: string;
  children: React.ReactNode;
  onClear?: () => void;
  /** Shown read-only: the person may look but not change this field. */
  locked?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 px-1 py-1.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        <div className={cn("mt-1", locked && "pointer-events-none opacity-60")}>
          {children}
        </div>
      </div>
      {onClear && !locked && (
        <button
          type="button"
          onClick={onClear}
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={`Clear ${label.toLowerCase()}`}
          title="Remove"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

const chipBase =
  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";

/** Slide-in editor showing every detail of one task. */
export default function TaskDetail({
  task,
  canEdit = true,
  canDelete = true,
  canCreateSteps = true,
  canEditSteps = true,
  canDeleteSteps = true,
  onClose,
}: {
  task: TaskDoc;
  canEdit?: boolean;
  canDelete?: boolean;
  /** Subtasks & attachments item permissions (finer than canEdit/canDelete). */
  canCreateSteps?: boolean;
  canEditSteps?: boolean;
  canDeleteSteps?: boolean;
  onClose: () => void;
}) {
  const toggleTask = useMutation(api.tasks.toggle);
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);
  const addStep = useMutation(api.tasks.addStep);
  const toggleStepM = useMutation(api.tasks.toggleStep);
  const removeStepM = useMutation(api.tasks.removeStep);
  const addAttachment = useMutation(api.tasks.addAttachment);
  const removeAttachment = useMutation(api.tasks.removeAttachment);

  const steps = useQuery(api.tasks.listSteps, { taskId: task._id });
  const peopleData = useQuery(api.tasks.people);
  const peopleById = useMemo(
    () => new Map((peopleData?.people ?? []).map((p) => [p.userId, p] as const)),
    [peopleData],
  );
  const assignees = useMemo(
    () => assigneesOfTask(task, peopleById),
    [task, peopleById],
  );
  const [assignOpen, setAssignOpen] = useState(false);
  const rights = useQuery(api.tasks.myRights, { taskId: task._id });
  // The role says what this person may do in the app; the task's own grant says
  // what the person who created it allowed here. While the grant loads, fall
  // back to the role so nothing flickers.
  const mayEdit = canEdit && (rights?.canEdit ?? true);
  const mayComplete = canEdit && (rights?.canComplete ?? true);
  const mayChangeOptions = canEdit && (rights?.canChangeOptions ?? true);
  const mayDelete = canDelete && (rights?.canDelete ?? true);
  const mayEditSteps = canEditSteps && mayEdit;
  const mayCreateSteps = canCreateSteps && mayEdit;
  const mayDeleteSteps = canDeleteSteps && mayDelete;
  const groupIds = task.groupIds ?? [];
  const groupsData = useQuery(api.userGroups.list);
  const groupsById = useMemo(
    () => new Map((groupsData ?? []).map((g) => [g._id, g] as const)),
    [groupsData],
  );
  const withLabel = useMemo(() => {
    const people = assigneeLabel(assignees, peopleById);
    const groupNames = groupIds
      .map((id) => groupsById.get(id)?.name)
      .filter((n): n is string => n !== undefined);
    if (people === "Not assigned" && groupNames.length === 0) {
      return "Not assigned";
    }
    return [people === "Not assigned" ? null : people, ...groupNames]
      .filter((part): part is string => part !== null)
      .join(" · ");
  }, [assignees, groupIds, groupsById]);
  const [description, setDescription] = useState(task.description ?? "");
  const [tagDraft, setTagDraft] = useState("");
  const [stepDraft, setStepDraft] = useState("");
  const [dueDraft, setDueDraft] = useState(
    task.dueAt !== undefined ? toLocalInput(new Date(task.dueAt)) : defaultDueLocal(),
  );
  const [reminderOffset, setReminderOffset] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const attachments = useMemo(
    () => parseAttachments(task.attachments),
    [task.attachments],
  );
  const doneSteps = (steps ?? []).filter((s) => s.isCompleted).length;

  const saveDescription = async () => {
    if ((task.description ?? "") === description) return;
    try {
      await updateTask({ id: task._id, description });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save notes.");
    }
  };

  const handleSetDue = async (value: string) => {
    setDueDraft(value);
    if (!value) return;
    const ts = new Date(value).getTime();
    if (Number.isNaN(ts)) return;
    try {
      await updateTask({ id: task._id, dueAt: ts });
      if (reminderOffset !== null) {
        await updateTask({
          id: task._id,
          remindAt: ts - reminderOffset * 60_000,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't set the date.");
    }
  };

  const handleReminder = async (minutes: number | null) => {
    if (task.dueAt === undefined) {
      toast.error("Set a due date first, then add a reminder.");
      return;
    }
    setReminderOffset(minutes);
    try {
      await updateTask({
        id: task._id,
        remindAt: task.dueAt - (minutes ?? 0) * 60_000,
      });
      toast.success(
        minutes === null
          ? "Reminder set for the due time."
          : `Reminder set ${minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`} before.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't set the reminder.");
    }
  };

  const handleAddTags = async () => {
    const parts = tagDraft
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, "").trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = Array.from(new Set([...(task.tags ?? []), ...parts]));
    setTagDraft("");
    try {
      await updateTask({ id: task._id, tags: next });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add tags.");
    }
  };

  const removeTag = async (tag: string) => {
    try {
      await updateTask({
        id: task._id,
        tags: (task.tags ?? []).filter((t) => t !== tag),
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove tag.");
    }
  };

  const handleAddStep = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mayCreateSteps) {
      toast.error("Adding steps is restricted for your role.");
      return;
    }
    const text = stepDraft.trim();
    if (!text) return;
    setStepDraft("");
    try {
      await addStep({ taskId: task._id, text });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the step.");
    }
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!mayCreateSteps) {
      toast.error("Attaching files is restricted for your role.");
      return;
    }
    if (file.size > 900_000) {
      toast.error("Files up to ~900 KB can be attached.");
      return;
    }
    setUploading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await addAttachment({
        id: task._id,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        data,
      });
      toast.success(`Attached “${file.name}”.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't attach the file.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await removeTask({ id: task._id });
      toast.success("Task deleted.");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the task.");
    }
  };

  return (
    <aside className="w-full shrink-0 border-border/60 lg:w-80 lg:border-l">
      <div className="flex h-full flex-col">
        {/* header */}
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">Task details</p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={task.starred ? "Remove star" : "Star task"}
              title={task.starred ? "Unstar" : "Star"}
              className={cn(
                "grid size-7 place-items-center rounded-md transition-colors hover:bg-accent",
                task.starred ? "text-amber-500" : "text-muted-foreground",
              )}
              onClick={() =>
                canEdit &&
                void updateTask({ id: task._id, starred: !task.starred }).catch(() =>
                  toast.error("Couldn't update the star."),
                )
              }
            >
              <Star className={cn("size-4", task.starred && "fill-amber-400")} />
            </button>
            <button
              type="button"
              aria-label="Close details"
              title="Close"
              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={onClose}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* title + done */}
          <div className="flex items-start gap-2.5">
            <Checkbox
              checked={task.isCompleted}
              disabled={!mayComplete}
              onCheckedChange={() => void toggleTask({ id: task._id })}
              className="mt-1 size-5 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-3"
            />
            <input
              value={task.text}
              readOnly={!mayEdit}
              onChange={(e) =>
                mayEdit &&
                void updateTask({ id: task._id, text: e.target.value }).catch(() => {})
              }
              className={cn(
                "w-full bg-transparent text-[15px] font-medium outline-none",
                task.isCompleted && "text-muted-foreground line-through",
              )}
            />
          </div>

          {/* assigned to — one person or a whole group in the firm */}
          <div className="mt-4">
            <Row icon={Users} label="Assigned to">
              <button
                type="button"
                onClick={() => setAssignOpen(true)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
                  (assignees.length > 0 || (task.groupIds ?? []).length > 0) &&
                    "border-primary/40 bg-primary/5",
                )}
              >
                <UserRound
                  className={cn(
                    "size-3.5 shrink-0",
                    assignees.length > 0
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">
                  {withLabel}
                </span>
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
              {!rights?.isOwner && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {rights?.canEdit || rights?.canComplete
                    ? `You can ${[rights?.canEdit && "edit", rights?.canComplete && "complete", rights?.canChangeOptions && "change options", rights?.canDelete && "delete"].filter(Boolean).join(", ")} this task.`
                    : "You can see this task, but only its owner can act on it."}
                </p>
              )}
            </Row>
          </div>

          <AssignDialog
            task={task}
            open={assignOpen}
            onOpenChange={setAssignOpen}
            canEdit={canEdit}
          />

          {/* due date */}
          <div className="mt-4">
            <Row
              icon={CalendarDays}
              label="Due date"
              locked={!mayChangeOptions}
              onClear={
                task.dueAt !== undefined
                  ? () => void updateTask({ id: task._id, clearDue: true }).catch(() => {})
                  : undefined
              }
            >
              <input
                type="datetime-local"
                value={dueDraft}
                onChange={(e) => void handleSetDue(e.target.value)}
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              {task.dueAt !== undefined && (
                <p
                  className={cn(
                    "mt-1 text-xs",
                    isOverdue(task) ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground",
                  )}
                >
                  {isOverdue(task) ? "Overdue · " : ""}
                  {formatDueLabel(task.dueAt)}
                  {!task.isCompleted && (
                    <>
                      {" · "}
                      <span className="font-medium">
                        {daysLeftLabel(task.dueAt).text}
                      </span>
                    </>
                  )}
                </p>
              )}
            </Row>

            {/* reminder */}
            <Row
              icon={AlarmClock}
              label="Reminder"
              locked={!mayChangeOptions}
              onClear={
                task.remindAt !== undefined
                  ? () => void updateTask({ id: task._id, clearReminder: true }).catch(() => {})
                  : undefined
              }
            >
              <select
                value=""
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  void handleReminder(REMINDER_OFFSETS[idx]?.minutes ?? null);
                }}
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">
                  {task.remindAt !== undefined
                    ? `Reminds ${formatDueLabel(task.remindAt)}`
                    : "Add a reminder…"}
                </option>
                {REMINDER_OFFSETS.map((r, i) => (
                  <option key={r.label} value={i}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Row>

            {/* priority */}
            <Row icon={Flag} label="Priority" locked={!mayChangeOptions}>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITIES.map((p) => {
                  const active = task.priority === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      className={cn(
                        chipBase,
                        active
                          ? `${p.chip} border-transparent`
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                      onClick={() =>
                        void updateTask({
                          id: task._id,
                          priority: active ? undefined : (p.value as Priority),
                        }).catch(() => toast.error("Couldn't set priority."))
                      }
                    >
                      <span className={cn("mr-1.5 inline-block size-1.5 rounded-full align-middle", p.dot)} />
                      {p.label}
                    </button>
                  );
                })}
              </div>
            </Row>

            {/* repeat */}
            <Row
              icon={Repeat}
              label="Repeat"
              locked={!mayChangeOptions}
              onClear={
                task.recurrence
                  ? () => void updateTask({ id: task._id, clearRecurrence: true }).catch(() => {})
                  : undefined
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {(["daily", "weekly", "monthly"] as Recurrence[]).map((r) => {
                  const active = task.recurrence === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      className={cn(
                        chipBase,
                        active
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                      onClick={() =>
                        void updateTask({ id: task._id, recurrence: active ? undefined : r }).catch(
                          () => toast.error("Couldn't set repeat."),
                        )
                      }
                    >
                      {RECURRENCE_LABEL[r]}
                    </button>
                  );
                })}
              </div>
              {task.recurrence && (
                <p className="mt-1 text-xs text-muted-foreground">
                  When completed, the next occurrence is created automatically.
                </p>
              )}
            </Row>

            {/* tags */}
            <Row icon={Tag} label="Tags" locked={!mayChangeOptions}>
              <div className="flex flex-wrap items-center gap-1.5">
                {(task.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  >
                    #{tag}
                    <button
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      className="text-primary/60 hover:text-primary"
                      onClick={() => void removeTag(tag)}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <form onSubmit={handleAddTags} className="mt-1.5 flex gap-1.5">
                <Input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="Add tag and press Enter…"
                  className="h-8 rounded-lg text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!tagDraft.trim()}
                  className="h-8 shrink-0 rounded-lg px-2.5"
                >
                  <Plus className="size-3.5" /> Add
                </Button>
              </form>
            </Row>

            {/* description / notes */}
            <Row icon={FileText} label="Notes" locked={!mayEdit}>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => void saveDescription()}
                rows={3}
                placeholder="Extra information, instructions, or a link…"
                className="w-full resize-y rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
              />
              {task.description && /^https?:\/\//i.test(task.description.trim()) && (
                <a
                  href={task.description.trim()}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Link2 className="size-3" />
                  Open link
                </a>
              )}
            </Row>

            {/* steps */}
            <Row icon={ListTodo} label={`Steps${steps ? ` (${doneSteps}/${steps.length})` : ""}`}>
              {steps !== undefined && steps.length > 0 && (
                <ul className="mb-1.5 space-y-1">
                  {steps.map((s) => (
                    <li key={s._id} className="group/st flex items-center gap-2">
                      <Checkbox
                        checked={s.isCompleted}
                        disabled={!mayEditSteps}
                        onCheckedChange={() =>
                          mayEditSteps
                            ? void toggleStepM({ id: s._id })
                            : toast.error("Editing steps is restricted for your role.")
                        }
                        className="size-4 rounded border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-2.5"
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm",
                          s.isCompleted && "text-muted-foreground line-through",
                        )}
                      >
                        {s.text}
                      </span>
                      {mayDeleteSteps && (
                        <button
                          type="button"
                          aria-label="Delete step"
                          className="hidden size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive group-hover/st:grid"
                          onClick={() => void removeStepM({ id: s._id })}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {mayCreateSteps ? (
                <form onSubmit={handleAddStep} className="flex gap-1.5">
                  <Input
                    value={stepDraft}
                    onChange={(e) => setStepDraft(e.target.value)}
                    placeholder="Break it into a step…"
                    className="h-8 rounded-lg text-sm"
                  />
                  <Button type="submit" size="icon" variant="ghost" className="size-8 rounded-lg">
                    <Plus className="size-3.5" />
                  </Button>
                </form>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Adding steps is restricted for your role.
                </p>
              )}
            </Row>

            {/* attachments */}
            <Row icon={Paperclip} label={`Files${attachments.length > 0 ? ` (${attachments.length})` : ""}`}>
              {attachments.length > 0 && (
                <ul className="mb-1.5 space-y-1">
                  {attachments.map((a) => (
                    <li
                      key={a.id}
                      className="group/at flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5"
                    >
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <a
                        href={a.data}
                        download={a.name}
                        className="min-w-0 flex-1 truncate text-xs font-medium hover:text-primary hover:underline"
                        title={`Download ${a.name}`}
                      >
                        {a.name}
                      </a>
                      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                        {a.size < 1024 ? `${a.size} B` : `${Math.round(a.size / 1024)} KB`}
                      </span>
                      {mayDeleteSteps && (
                        <button
                          type="button"
                          aria-label={`Remove ${a.name}`}
                          className="hidden size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive group-hover/at:grid"
                          onClick={() =>
                            void removeAttachment({ id: task._id, attachmentId: a.id }).catch(() =>
                              toast.error("Couldn't remove the file."),
                            )
                          }
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={(e) => void handleFile(e)}
              />
              {canCreateSteps && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg text-xs"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Paperclip className="size-3.5" />
                  )}
                  Attach photo, PDF, or file
                </Button>
              )}
            </Row>
          </div>
        </div>

        {/* footer */}
        <div className="border-t border-border/60 p-3">
          {mayDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start rounded-lg text-destructive hover:text-destructive"
              onClick={() => void handleDelete()}
            >
              <Trash2 className="size-3.5" />
              Delete task
            </Button>
          ) : (
            <p className="px-2 text-xs text-muted-foreground">
              You have view access to this task; editing and deleting are
              restricted for your role.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

