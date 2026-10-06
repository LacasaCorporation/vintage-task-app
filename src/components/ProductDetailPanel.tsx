import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlarmClock,
  CalendarDays,
  Check,
  FileText,
  Flag,
  Hash,
  ListTodo,
  Loader2,
  Package,
  PackageMinus,
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
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAppDialogs } from "@/components/AppDialogs";
import AssignDialog, { targetOf } from "@/components/AssignDialog";
import NodeComments from "@/components/NodeComments";
import ProductionDetails from "@/components/ProductionDetails";
import NodeIssues from "@/components/NodeIssues";
import type { FgDoc, JobDoc } from "@/components/FlaggedLists";
import { PRIORITY_META, tagChip } from "@/components/FlaggedLists";

/** Pill base used by the priority row, matching the other project chips. */
const chipBase =
  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";
const prioChip: Record<string, string> = {
  high: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
};
import {
  RECURRENCE_LABEL,
  REMINDER_OFFSETS,
  formatDueLabel,
  parseAttachments,
  toLocalInput,
  type Recurrence,
} from "@/lib/task-utils";
import { assigneeLabel, assigneesOfTask } from "@/lib/task-people";
import {
  middleProjectStatuses,
  projectStatusesOrDefaults,
} from "@/lib/project-statuses";
import { messageFrom } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** One line per field: icon, small caps label, then the control — the same
 *  shape a normal task's detail panel uses. */
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

/**
 * A flagged product's whole side panel in one card: the costing fields it
 * always had (dates, priority, status, unit, note) plus the features a normal
 * task has — who it is assigned to, the permissions its owner hands out, a
 * star, a reminder, tags and steps. One line per field, like the task panel.
 */
export default function ProductDetailPanel({
  fg,
  jobs,
  projects,
  onClose,
  onDelete,
  canEdit = true,
}: {
  fg: FgDoc;
  jobs: JobDoc[];
  projects: Doc<"projects">[];
  onClose: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
}) {
  const updateFg = useMutation(api.costing.updateFinishedGood);
  const detachFromJobM = useMutation(api.costing.detachFromJob);
  const detachFromProjectM = useMutation(api.costing.detachFromProject);
  const { confirm } = useAppDialogs();
  const setStatus = useMutation(api.costing.setFgProjectStatus);
  const setCompleted = useMutation(api.costing.setFgCompleted);
  const addStep = useMutation(api.productTasks.addStep);
  const toggleStep = useMutation(api.productTasks.toggleStep);
  const removeStep = useMutation(api.productTasks.removeStep);
  const statusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(statusesQuery ?? undefined);
  const peopleData = useQuery(api.tasks.people);
  const groupsData = useQuery(api.userGroups.list);
  const rights = useQuery(api.productTasks.myRights, { id: fg._id });
  const steps = useQuery(api.productTasks.listSteps, { fgId: fg._id });

  const [assignOpen, setAssignOpen] = useState(false);
  const [stepDraft, setStepDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const peopleById = useMemo(
    () => new Map((peopleData?.people ?? []).map((p) => [p.userId, p] as const)),
    [peopleData],
  );
  const groupsById = useMemo(
    () => new Map((groupsData ?? []).map((g) => [g._id, g] as const)),
    [groupsData],
  );
  const assignees = useMemo(
    () => assigneesOfTask(fg, peopleById),
    [fg, peopleById],
  );
  const groupIds = fg.groupIds ?? [];
  const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
  const parentJob = jobs.find((j) => jobIds.includes(j._id));
  const project = parentJob
    ? projects.find((p) => p._id === parentJob.projectId)
    : undefined;
  const currentStatus = fg.projectStatus ?? (fg.isCompleted ? "Finish" : "Listed");
  // once production has started, Listed and Finish are off limits: they are
  // reached by starting production and by finishing the job
  const statusChoices =
    fg.productionStartedAt === undefined
      ? projectStatuses
      : middleProjectStatuses(projectStatuses, currentStatus);

  // the role gates the panel; the product's own grant narrows it
  const mayEdit = canEdit && (rights?.canEdit ?? true);
  const mayComplete = canEdit && (rights?.canComplete ?? true);
  const mayOptions = canEdit && (rights?.canChangeOptions ?? true);
  const mayDelete = canEdit && (rights?.canDelete ?? true);
  const attachments = useMemo(
    () => parseAttachments(fg.attachments),
    [fg.attachments],
  );

  const patch = async (values: Record<string, unknown>) => {
    setBusy(true);
    try {
      await updateFg({ id: fg._id, ...values } as never);
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't save that change."));
    } finally {
      setBusy(false);
    }
  };

  const submitStep = async () => {
    const text = stepDraft.trim();
    if (text.length === 0) return;
    setBusy(true);
    try {
      await addStep({ fgId: fg._id, text });
      setStepDraft("");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't add that step."));
    } finally {
      setBusy(false);
    }
  };

  const addTags = async () => {
    const parts = tagDraft
      .split(/[\s,]+/)
      .map((t) => t.replace(/^#/, "").trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    setBusy(true);
    try {
      await updateFg({
        id: fg._id,
        tags: [...new Set([...(fg.tags ?? []), ...parts])],
      } as never);
      setTagDraft("");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't add those tags."));
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
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
      await updateFg({
        id: fg._id,
        attachments: JSON.stringify([
          ...attachments,
          { id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, data },
        ]),
      } as never);
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't attach that file."));
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async (attachmentId: string) => {
    try {
      await updateFg({
        id: fg._id,
        attachments: JSON.stringify(attachments.filter((a) => a.id !== attachmentId)),
      } as never);
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't remove the file."));
    }
  };

  /**
   * Take the product out of its project — or out of the job it is shown under
   * — without deleting it. It drops back to a standalone item and stays in
   * Products with its recipe, cost and stock.
   */
  const removeFromProject = async () => {
    const from =
      parentJob !== undefined
        ? `job “${parentJob.name}”`
        : `“${project?.name ?? fg.projectName ?? "the project"}”`;
    const ok = await confirm({
      title: `Remove “${fg.name}” from ${from}?`,
      message:
        "The product is not deleted — it becomes a standalone item and stays in Products with its recipe, cost and stock. Only its link to this project is removed.",
      confirmLabel: "Remove from project",
      danger: true,
    });
    if (!ok) return;
    try {
      if (parentJob !== undefined) {
        await detachFromJobM({ fgId: fg._id, jobId: parentJob._id });
      } else {
        await detachFromProjectM({ fgId: fg._id });
      }
      toast.success(`“${fg.name}” removed — it is still in Products.`);
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't remove it from the project."));
    }
  };

  const doneSteps = (steps ?? []).filter((s) => s.isCompleted).length;

  return (
    <aside className="w-full shrink-0 border-border/60 lg:w-80 lg:border-l">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">Product details</p>
          <button
            type="button"
            aria-label="Close details"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {/* name + done, like a task */}
          <div className="flex items-start gap-2.5">
            <Checkbox
              checked={fg.isCompleted ?? false}
              disabled={!mayComplete || busy}
              onCheckedChange={() =>
                void setCompleted({ id: fg._id, completed: !fg.isCompleted })
                  .then(() => undefined)
                  .catch((error) =>
                    toast.error(messageFrom(error, "Couldn't update the product.")),
                  )
              }
              aria-label={fg.isCompleted ? "Reopen product" : "Mark product as done"}
              className="mt-1 size-5 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-3"
            />
            <input
              value={fg.name}
              readOnly={!mayEdit}
              onChange={(e) => void patch({ name: e.target.value })}
              className="w-full bg-transparent text-[15px] font-medium outline-none"
            />
            <button
              type="button"
              aria-pressed={fg.starred === true}
              title={fg.starred ? "Remove the star" : "Star this product"}
              disabled={!mayEdit || busy}
              onClick={() => void patch({ starred: !fg.starred })}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Star
                className={cn(
                  "size-4",
                  fg.starred && "fill-amber-400 text-amber-500",
                )}
              />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            <Package className="mr-1 inline size-3 text-violet-500/80" />
            {parentJob ? (
              <>
                {parentJob.name}
                {parentJob.code ? ` · ${parentJob.code}` : ""}
                {project ? ` — ${project.name}` : ""}
              </>
            ) : (
              "Standalone product"
            )}
            {fg.code ? ` · ${fg.code}` : ""}
          </p>

          {/* everything about the production itself: the run, the batch, what
              it costs and what it has moved on and off the shelf */}
          <ProductionDetails fg={fg} />

          <div className="mt-4">
            {/* assigned to */}
            <Row icon={Users} label="Assigned to">
              <button
                type="button"
                onClick={() => setAssignOpen(true)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
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
                <span className="min-w-0 flex-1 truncate">
                  {assigneeLabel(assignees, peopleById)}
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
              {rights !== undefined && !rights.isOwner && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {rights.canEdit || rights.canComplete
                    ? `You can ${[rights.canEdit && "edit", rights.canComplete && "complete", rights.canChangeOptions && "change options", rights.canDelete && "delete"].filter(Boolean).join(", ")} this product.`
                    : "You can see this product, but only whoever added it can act on it."}
                </p>
              )}
            </Row>

            {/* start date — when this product is planned to be made */}
            <Row
              icon={CalendarDays}
              label="Start date"
              locked={!mayOptions}
              onClear={
                fg.startAt !== undefined
                  ? () => void patch({ clearStart: true })
                  : undefined
              }
            >
              <input
                type="datetime-local"
                value={fg.startAt !== undefined ? toLocalInput(new Date(fg.startAt)) : ""}
                onChange={(e) =>
                  void patch({
                    startAt: e.target.value
                      ? new Date(e.target.value).getTime()
                      : undefined,
                    clearStart: e.target.value === "",
                  })
                }
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              {fg.startAt === undefined && parentJob?.startAt !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Starting with its job: {formatDueLabel(parentJob.startAt)}
                </p>
              )}
            </Row>

            {/* due date */}
            <Row
              icon={CalendarDays}
              label="Due date"
              locked={!mayOptions}
              onClear={
                fg.dueAt !== undefined
                  ? () => void patch({ clearDue: true })
                  : undefined
              }
            >
              <input
                type="datetime-local"
                value={fg.dueAt !== undefined ? toLocalInput(new Date(fg.dueAt)) : ""}
                onChange={(e) =>
                  void patch({
                    dueAt: e.target.value
                      ? new Date(e.target.value).getTime()
                      : undefined,
                    clearDue: e.target.value === "",
                  })
                }
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
              {parentJob?.dueAt !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Job due: {formatDueLabel(parentJob.dueAt)}
                </p>
              )}
            </Row>

            {/* reminder */}
            <Row icon={AlarmClock} label="Reminder" locked={!mayOptions}>
              <select
                value=""
                disabled={!mayOptions || busy || fg.dueAt === undefined}
                onChange={(e) => {
                  const offset = REMINDER_OFFSETS[Number(e.target.value)];
                  if (offset === undefined || offset.minutes === null) return;
                  if (fg.dueAt === undefined) return;
                  void patch({ remindAt: fg.dueAt - offset.minutes * 60_000 });
                }}
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              >
                <option value="">
                  {fg.remindAt !== undefined
                    ? "Reminder set — change"
                    : fg.dueAt === undefined
                      ? "Set a due date first"
                      : "Add a reminder…"}
                </option>
                {REMINDER_OFFSETS.map((offset, i) => (
                  <option key={offset.minutes} value={i}>
                    {offset.label}
                  </option>
                ))}
              </select>
              {fg.remindAt !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(fg.remindAt).toLocaleString()}
                </p>
              )}
            </Row>

            {/* priority */}
            <Row icon={Flag} label="Priority" locked={!mayOptions}>
              <div className="flex flex-wrap gap-1.5">
                {(["high", "medium", "low"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={busy}
                    className={cn(
                      chipBase,
                      fg.priority === p
                        ? `${prioChip[p]} border-transparent`
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() =>
                      void patch({ priority: fg.priority === p ? undefined : p })
                    }
                  >
                    <span
                      className={cn("mr-1 inline-block size-1.5 rounded-full", PRIORITY_META[p].dot)}
                    />
                    {p[0]!.toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </Row>

            {/* repeat */}
            <Row
              icon={Repeat}
              label="Repeat"
              locked={!mayOptions}
              onClear={
                fg.recurrence !== undefined
                  ? () => void patch({ clearRecurrence: true })
                  : undefined
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {(["daily", "weekly", "monthly"] as const).map((r) => {
                  const active: Recurrence | undefined = fg.recurrence;
                  return (
                    <button
                      key={r}
                      type="button"
                      disabled={busy}
                      className={cn(
                        chipBase,
                        active === r
                          ? "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                      onClick={() =>
                        void patch(
                          active === r ? { clearRecurrence: true } : { recurrence: r },
                        )
                      }
                    >
                      {RECURRENCE_LABEL[r]}
                    </button>
                  );
                })}
              </div>
              {fg.recurrence !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  When completed, the next occurrence is created automatically.
                </p>
              )}
            </Row>

            {/* status */}
            <Row icon={Check} label="Status" locked={!mayOptions}>
              <select
                value={currentStatus}
                onChange={(e) => void setStatus({ id: fg._id, status: e.target.value })}
                disabled={busy}
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              >
                {statusChoices.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Row>

            {/* qty, shown next to the name in every product row */}
            <Row icon={Hash} label="Qty" locked={!mayEdit}>
              <input
                type="number"
                min={0}
                step="any"
                value={fg.qty ?? ""}
                disabled={!mayEdit}
                onChange={(e) =>
                  patch({
                    qty:
                      e.target.value.trim() === "" ? undefined : Number(e.target.value),
                  })
                }
                placeholder="e.g. 12"
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Row>

            {/* unit */}
            <Row icon={Package} label="Unit" locked={!mayEdit}>
              <input
                value={fg.unit ?? ""}
                disabled={!mayEdit}
                onChange={(e) => void patch({ unit: e.target.value })}
                placeholder="e.g. pcs"
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Row>

            {/* tags */}
            <Row icon={Tag} label="Tags" locked={!mayOptions}>
              <div className="flex gap-1.5">
                <input
                  value={tagDraft}
                  disabled={!mayOptions || busy}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addTags();
                    }
                  }}
                  placeholder="Add tag and press Enter"
                  className="h-8 min-w-0 flex-1 rounded-lg border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={!mayOptions || busy || tagDraft.trim().length === 0}
                  onClick={() => void addTags()}
                  className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                  aria-label="Add tag"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              {(fg.tags ?? []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(fg.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        tagChip,
                        "gap-1",
                        mayOptions &&
                          "cursor-pointer hover:line-through",
                      )}
                      onClick={() =>
                        mayOptions &&
                        void patch({ tags: (fg.tags ?? []).filter((t) => t !== tag) })
                      }
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Row>

            {/* note */}
            <Row icon={FileText} label="Note" locked={!mayEdit}>
              <textarea
                value={fg.note ?? ""}
                disabled={!mayEdit}
                onChange={(e) => void patch({ note: e.target.value })}
                rows={3}
                placeholder="Add a note…"
                className="w-full resize-y rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Row>

            {/* steps */}
            <Row icon={ListTodo} label={`Steps${steps ? ` (${doneSteps}/${steps.length})` : ""}`}>
              {steps === undefined ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" />
                  Loading…
                </p>
              ) : (
                <>
                  <ul className="space-y-0.5">
                    {steps.map((step) => (
                      <li
                        key={step._id}
                        className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
                      >
                        <Checkbox
                          checked={step.isCompleted === true}
                          disabled={!mayComplete || busy}
                          onCheckedChange={() =>
                            void toggleStep({ stepId: step._id }).catch((error) =>
                              toast.error(
                                messageFrom(error, "Couldn't update that step."),
                              ),
                            )
                          }
                          aria-label={`Mark “${step.text}” as ${step.isCompleted ? "not done" : "done"}`}
                          className="size-3.5 rounded-[3px]"
                        />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm",
                            step.isCompleted &&
                              "text-muted-foreground line-through",
                          )}
                        >
                          {step.text}
                        </span>
                        {mayEdit && (
                          <button
                            type="button"
                            aria-label={`Remove step ${step.text}`}
                            onClick={() =>
                              void removeStep({ stepId: step._id }).catch((error) =>
                                toast.error(
                                  messageFrom(error, "Couldn't remove that step."),
                                ),
                              )
                            }
                            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </li>
                    ))}
                    {steps.length === 0 && (
                      <li className="py-1 text-xs text-muted-foreground">
                        Break the work down below.
                      </li>
                    )}
                  </ul>
                  <div className="mt-1.5 flex gap-1.5">
                    <input
                      value={stepDraft}
                      disabled={!mayEdit || busy}
                      onChange={(e) => setStepDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void submitStep();
                        }
                      }}
                      placeholder="Add a step and press Enter"
                      className="h-8 min-w-0 flex-1 rounded-lg border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                    />
                    <button
                      type="button"
                      disabled={!mayEdit || busy || stepDraft.trim().length === 0}
                      onClick={() => void submitStep()}
                      className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                      aria-label="Add step"
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                </>
              )}
            </Row>

            {/* files */}
            <Row
              icon={Paperclip}
              label={`Files${attachments.length > 0 ? ` (${attachments.length})` : ""}`}
            >
              {attachments.length > 0 && (
                <ul className="mb-1.5 space-y-1">
                  {attachments.map((a) => (
                    <li
                      key={a.id}
                      className="group/at flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5"
                    >
                      {a.type.startsWith("image/") ? (
                        <a
                          href={a.data}
                          target="_blank"
                          rel="noreferrer"
                          title={`Open ${a.name}`}
                          className="size-8 shrink-0 overflow-hidden rounded border bg-muted"
                        >
                          <img src={a.data} alt={a.name} className="size-full object-cover" />
                        </a>
                      ) : (
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <a
                        href={a.data}
                        download={a.name}
                        className="min-w-0 flex-1 truncate text-xs font-medium hover:text-primary hover:underline"
                        title={`Download ${a.name}`}
                      >
                        {a.name}
                      </a>
                      {mayEdit && (
                        <button
                          type="button"
                          aria-label={`Remove ${a.name}`}
                          className="hidden size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive group-hover/at:grid"
                          onClick={() => void removeFile(a.id)}
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
              {mayEdit && (
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

            {/* issues raised on the product */}
            <NodeIssues kind="product" id={String(fg._id)} canEdit={mayEdit || mayComplete} />

            {/* the conversation */}
            <div className="mt-4 border-t border-border/60 pt-4">
              <NodeComments kind="product" id={String(fg._id)} />
            </div>
          </div>
        </div>

        {/* footer */}
        {((mayEdit && (parentJob !== undefined || fg.projectName !== undefined)) ||
          (mayDelete && onDelete)) && (
          <div className="space-y-1 border-t border-border/60 p-3">
            {mayEdit && (parentJob !== undefined || fg.projectName !== undefined) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full rounded-lg text-xs"
                title="Take it out of the project — the product stays in Products"
                onClick={() => void removeFromProject()}
              >
                <PackageMinus className="size-3.5" />
                Remove from {parentJob !== undefined ? "this job" : "this project"}
              </Button>
            )}
            {mayDelete && onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full rounded-lg text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="size-3.5" />
                Delete product
              </Button>
            )}
          </div>
        )}
      </div>

      <AssignDialog
        target={targetOf(fg, "product")}
        title="Assign this product"
        open={assignOpen}
        onOpenChange={setAssignOpen}
        canEdit={canEdit}
      />
    </aside>
  );
}
