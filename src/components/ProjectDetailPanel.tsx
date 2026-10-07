import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlarmClock,
  Briefcase,
  CalendarDays,
  Check,
  FileText,
  Flag,
  Folder,
  Hash,
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
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import AssignDialog, { targetOf } from "@/components/AssignDialog";
import NodeComments from "@/components/NodeComments";
import NodeIssues from "@/components/NodeIssues";
import {
  jobProjectStatus,
  projectDocStatus,
  tagChip,
} from "@/components/FlaggedLists";
import { messageFrom } from "@/lib/errors";
import { toast } from "@/lib/toast";
import {
  PRIORITY_META,
  RECURRENCE_LABEL,
  REMINDER_OFFSETS,
  daysLeftLabel,
  formatDueLabel,
  parseAttachments,
  toLocalInput,
  type Recurrence,
} from "@/lib/task-utils";
import { assigneeLabel, assigneesOfTask } from "@/lib/task-people";
import {
  PROJECT_STATUS_COMPLETED,
  PROJECT_STATUS_START,
  isStageDone,
  projectStatusesOrDefaults,
  STAGE_STATUSES,
} from "@/lib/project-statuses";
import { cn } from "@/lib/utils";

export type ProjectNodeKind = "project" | "job";
type ProjectNodeDoc = Doc<"projects"> | Doc<"projectJobs">;

const chipBase =
  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors";
const ROUND_CHECK =
  "mt-1 size-5 shrink-0 rounded-full border-2 border-border data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground [&_svg]:size-3";

/** One line per field: icon, small caps label, then the control. */
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
 * Side panel for a project or a job. A project groups jobs and a job groups
 * products, and both now carry exactly what a task carries: who it is handed
 * to and what they may do, a due date, a reminder, a priority, a repeat, tags,
 * notes, steps, files, the issues raised on it and the conversation about it.
 * The same conditions apply — only the owner's permissions decide what can be
 * changed, and an open issue stops it being finished.
 */
export default function ProjectDetailPanel({
  kind,
  doc,
  parentLabel,
  onClose,
  onDelete,
  canEdit = true,
}: {
  kind: ProjectNodeKind;
  doc: ProjectNodeDoc;
  /** The project a job sits under, for the line below the title. */
  parentLabel?: string;
  onClose: () => void;
  onDelete?: () => void;
  canEdit?: boolean;
}) {
  const id = String(doc._id);
  const updateM = useMutation(api.projectTasks.update);
  const setStatusJobM = useMutation(api.jobs.setJobProjectStatus);
  const setStatusProjectM = useMutation(api.costing.setProjectProjectStatus);
  const addStepM = useMutation(api.projectTasks.addStep);
  const toggleStepM = useMutation(api.projectTasks.toggleStep);
  const renameStepM = useMutation(api.projectTasks.renameStep);
  const removeStepM = useMutation(api.projectTasks.removeStep);
  const addAttachmentM = useMutation(api.projectTasks.addAttachment);
  const removeAttachmentM = useMutation(api.projectTasks.removeAttachment);

  const rights = useQuery(api.projectTasks.rights, { kind, id });
  const steps = useQuery(api.projectTasks.listSteps, { kind, id });
  const peopleData = useQuery(api.tasks.people);
  const groupsData = useQuery(api.userGroups.list);
  const statusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(statusesQuery);
  const allProjects = useQuery(api.costing.listProjects);
  const allJobs = useQuery(api.jobs.listJobs);

  const [assignOpen, setAssignOpen] = useState(false);
  const [stepDraft, setStepDraft] = useState("");
  const [renamingStep, setRenamingStep] = useState<string | null>(null);
  const [stepRenameDraft, setStepRenameDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [nameDraft, setNameDraft] = useState(doc.name);
  const [notesDraft, setNotesDraft] = useState(
    ("description" in doc ? doc.description : undefined) ?? "",
  );
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const peopleById = useMemo(
    () =>
      new Map((peopleData?.people ?? []).map((p) => [p.userId, p] as const)),
    [peopleData],
  );
  const groupsById = useMemo(
    () => new Map((groupsData ?? []).map((g) => [g._id, g] as const)),
    [groupsData],
  );
  const assignees = useMemo(
    () => assigneesOfTask(doc, peopleById),
    [doc, peopleById],
  );
  const groupIds = doc.groupIds ?? [];
  const attachments = useMemo(
    () => parseAttachments(doc.attachments),
    [doc.attachments],
  );
  const doneSteps = (steps ?? []).filter((s) => s.isCompleted).length;

  const projectDoc = kind === "project" ? (doc as Doc<"projects">) : null;
  const jobDoc = kind === "job" ? (doc as Doc<"projectJobs">) : null;
  const parentProject =
    jobDoc !== null
      ? (allProjects ?? []).find((p) => p._id === jobDoc.projectId)
      : undefined;
  const containedJobs =
    projectDoc !== null
      ? (allJobs ?? []).filter((j) => j.projectId === projectDoc._id)
      : [];
  const earliestJobStart = containedJobs.reduce<number | undefined>(
    (acc, j) =>
      j.startAt !== undefined
        ? acc === undefined
          ? j.startAt
          : Math.min(acc, j.startAt)
        : acc,
    undefined,
  );
  const latestJobDue = containedJobs.reduce<number | undefined>(
    (acc, j) =>
      j.dueAt !== undefined
        ? acc === undefined
          ? j.dueAt
          : Math.max(acc, j.dueAt)
        : acc,
    undefined,
  );
  const currentStatus =
    projectDoc !== null
      ? projectDocStatus(projectDoc, projectStatuses)
      : jobProjectStatus(jobDoc as Doc<"projectJobs">, projectStatuses);
  const isFinished = isStageDone(currentStatus);

  // the role gates the panel; the item's own grant narrows it
  const mayEdit = canEdit && (rights?.canEdit ?? true);
  const mayComplete = canEdit && (rights?.canComplete ?? true);
  const mayOptions = canEdit && (rights?.canChangeOptions ?? true);
  const mayDelete = canEdit && (rights?.canDelete ?? true);

  const patch = async (values: Record<string, unknown>) => {
    setBusy(true);
    try {
      await updateM({ kind, id, ...values } as never);
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't save that change."));
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (status: string) => {
    try {
      if (kind === "job") {
        await setStatusJobM({
          id: doc._id as Doc<"projectJobs">["_id"],
          status,
        });
      } else {
        await setStatusProjectM({
          id: doc._id as Doc<"projects">["_id"],
          status,
        });
      }
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't change that status."));
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
      await updateM({
        kind,
        id,
        tags: [...new Set([...(doc.tags ?? []), ...parts])],
      });
      setTagDraft("");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't add those tags."));
    } finally {
      setBusy(false);
    }
  };

  const submitStep = async () => {
    const text = stepDraft.trim();
    if (text.length === 0) return;
    setBusy(true);
    try {
      await addStepM({ kind, id, text });
      setStepDraft("");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't add that step."));
    } finally {
      setBusy(false);
    }
  };

  const saveStepName = async (stepId: string) => {
    const next = stepRenameDraft.trim();
    setRenamingStep(null);
    if (next.length === 0) return;
    try {
      await renameStepM({ kind, stepId, text: next });
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't rename that step."));
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
      await addAttachmentM({
        kind,
        id,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        data,
      });
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't attach that file."));
    } finally {
      setUploading(false);
    }
  };

  return (
    <aside className="w-full shrink-0 border-border/60 lg:w-80 lg:border-l">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <p className="text-sm font-semibold">
            {kind === "project" ? "Project details" : "Job details"}
          </p>
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
              checked={isFinished}
              disabled={!mayComplete}
              onCheckedChange={() =>
                void changeStatus(
                  isFinished ? PROJECT_STATUS_START : PROJECT_STATUS_COMPLETED,
                )
              }
              aria-label={isFinished ? "Reopen" : "Mark as finished"}
              className={ROUND_CHECK}
            />
            <input
              value={nameDraft}
              readOnly={!mayEdit}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                if (!mayEdit || nameDraft.trim() === doc.name) return;
                if (nameDraft.trim().length === 0) {
                  setNameDraft(doc.name);
                  return;
                }
                void patch({ name: nameDraft });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setNameDraft(doc.name);
              }}
              className="w-full bg-transparent text-[15px] font-medium outline-none"
            />
            <button
              type="button"
              aria-pressed={doc.starred === true}
              title={doc.starred ? "Remove the star" : "Star this"}
              disabled={!mayEdit || busy}
              onClick={() => void patch({ starred: !doc.starred })}
              className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Star
                className={cn(
                  "size-4",
                  doc.starred && "fill-amber-400 text-amber-500",
                )}
              />
            </button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {kind === "project" ? (
              <Folder className="mr-1 inline size-3 text-sky-500/80" />
            ) : (
              <Briefcase className="mr-1 inline size-3 text-sky-500/80" />
            )}
            {kind === "project" ? "Project" : (parentLabel ?? "Job")}
            {doc.code ? ` · ${doc.code}` : ""}
          </p>

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
                    assignees.length > 0
                      ? "text-primary"
                      : "text-muted-foreground",
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
                  {groupIds.map((gid) => (
                    <span
                      key={gid}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                    >
                      <Users className="size-2.5" />
                      {groupsById.get(gid)?.name ?? "Group"}
                    </span>
                  ))}
                </div>
              )}
              {rights !== undefined && !rights.isOwner && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {rights.canEdit || rights.canComplete
                    ? `You can ${[
                        rights.canEdit && "edit",
                        rights.canComplete && "complete",
                        rights.canChangeOptions && "change options",
                        rights.canDelete && "delete",
                      ]
                        .filter(Boolean)
                        .join(", ")} this ${kind}.`
                    : `You can see this ${kind}, but only whoever added it can act on it.`}
                </p>
              )}
            </Row>

            {/* start date */}
            <Row
              icon={CalendarDays}
              label="Start date"
              locked={!mayOptions}
              onClear={
                doc.startAt !== undefined
                  ? () => void patch({ clearStart: true })
                  : undefined
              }
            >
              <input
                type="datetime-local"
                value={
                  doc.startAt !== undefined
                    ? toLocalInput(new Date(doc.startAt))
                    : ""
                }
                min={(() => {
                  const lower: number | undefined =
                    jobDoc !== null ? parentProject?.startAt : undefined;
                  const cross = doc.dueAt;
                  let bound = lower;
                  if (cross !== undefined) {
                    bound =
                      bound === undefined ? cross : Math.max(bound, cross);
                  }
                  return bound !== undefined
                    ? toLocalInput(new Date(bound))
                    : undefined;
                })()}
                max={(() => {
                  const upper: number | undefined =
                    projectDoc !== null
                      ? earliestJobStart
                      : jobDoc !== null
                        ? parentProject?.dueAt
                        : undefined;
                  const cross = doc.dueAt;
                  let bound = upper;
                  if (cross !== undefined) {
                    bound =
                      bound === undefined ? cross : Math.min(bound, cross);
                  }
                  return bound !== undefined
                    ? toLocalInput(new Date(bound))
                    : undefined;
                })()}
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
              {doc.startAt === undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Not set — the Gantt runs it from the day it was created
                </p>
              )}
              {jobDoc !== null && parentProject?.startAt !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Earliest allowed (project start):{" "}
                  {formatDueLabel(parentProject.startAt)}
                </p>
              )}
              {projectDoc !== null && earliestJobStart !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Cannot be after earliest job:{" "}
                  {formatDueLabel(earliestJobStart)}
                </p>
              )}
            </Row>

            {/* due date */}
            <Row
              icon={CalendarDays}
              label="Due date"
              locked={!mayOptions}
              onClear={
                doc.dueAt !== undefined
                  ? () => void patch({ clearDue: true })
                  : undefined
              }
            >
              <input
                type="datetime-local"
                value={
                  doc.dueAt !== undefined
                    ? toLocalInput(new Date(doc.dueAt))
                    : ""
                }
                min={(() => {
                  const lower: number | undefined =
                    projectDoc !== null
                      ? latestJobDue
                      : jobDoc !== null
                        ? parentProject?.startAt
                        : undefined;
                  const cross = doc.startAt;
                  let bound = lower;
                  if (cross !== undefined) {
                    bound =
                      bound === undefined ? cross : Math.max(bound, cross);
                  }
                  return bound !== undefined
                    ? toLocalInput(new Date(bound))
                    : undefined;
                })()}
                max={(() => {
                  const upper: number | undefined =
                    jobDoc !== null ? parentProject?.dueAt : undefined;
                  const cross = doc.startAt;
                  let bound = upper;
                  if (cross !== undefined) {
                    bound =
                      bound === undefined ? cross : Math.min(bound, cross);
                  }
                  return bound !== undefined
                    ? toLocalInput(new Date(bound))
                    : undefined;
                })()}
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
              {doc.dueAt !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatDueLabel(doc.dueAt)} ·{" "}
                  <span
                    className={cn(
                      daysLeftLabel(doc.dueAt).overdue
                        ? "font-medium text-destructive"
                        : "text-primary",
                    )}
                  >
                    {daysLeftLabel(doc.dueAt).text}
                  </span>
                </p>
              )}
              {jobDoc !== null && parentProject?.dueAt !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Latest allowed (project due):{" "}
                  {formatDueLabel(parentProject.dueAt)}
                </p>
              )}
              {projectDoc !== null && latestJobDue !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Cannot be before latest job: {formatDueLabel(latestJobDue)}
                </p>
              )}
            </Row>

            {/* reminder */}
            <Row icon={AlarmClock} label="Reminder" locked={!mayOptions}>
              <select
                value=""
                disabled={!mayOptions || busy || doc.dueAt === undefined}
                onChange={(e) => {
                  const offset = REMINDER_OFFSETS[Number(e.target.value)];
                  if (offset === undefined || offset.minutes === null) return;
                  if (doc.dueAt === undefined) return;
                  void patch({ remindAt: doc.dueAt - offset.minutes * 60_000 });
                }}
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              >
                <option value="">
                  {doc.remindAt !== undefined
                    ? "Reminder set — change"
                    : doc.dueAt === undefined
                      ? "Set a due date first"
                      : "Add a reminder…"}
                </option>
                {REMINDER_OFFSETS.map((offset, i) => (
                  <option key={offset.minutes} value={i}>
                    {offset.label}
                  </option>
                ))}
              </select>
              {doc.remindAt !== undefined &&
                (mayOptions ? (
                  <button
                    type="button"
                    onClick={() => void patch({ clearRemind: true })}
                    className="mt-1 text-[11px] text-muted-foreground hover:text-destructive"
                  >
                    {new Date(doc.remindAt).toLocaleString()} · clear
                  </button>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {new Date(doc.remindAt).toLocaleString()}
                  </p>
                ))}
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
                      doc.priority === p
                        ? `${PRIORITY_META[p].chip} border-transparent`
                        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() =>
                      doc.priority === p
                        ? void patch({ clearPriority: true })
                        : void patch({ priority: p })
                    }
                  >
                    <span
                      className={cn(
                        "mr-1 inline-block size-1.5 rounded-full",
                        PRIORITY_META[p].dot,
                      )}
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
                doc.recurrence !== undefined
                  ? () => void patch({ clearRecurrence: true })
                  : undefined
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {(["daily", "weekly", "monthly"] as const).map((r) => {
                  const active: Recurrence | undefined = doc.recurrence;
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
                          active === r
                            ? { clearRecurrence: true }
                            : { recurrence: r },
                        )
                      }
                    >
                      {RECURRENCE_LABEL[r]}
                    </button>
                  );
                })}
              </div>
              {doc.recurrence !== undefined && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  When {kind === "job" ? "the job" : "the project"} is
                  completed, the next one is created automatically.
                </p>
              )}
            </Row>

            {/* status */}
            <Row
              icon={Check}
              label="Status"
              locked={!mayOptions && !mayComplete}
            >
              <select
                value={currentStatus}
                onChange={(e) => void changeStatus(e.target.value)}
                disabled={busy}
                className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              >
                {STAGE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Row>

            {/* project-only fields */}
            {projectDoc !== null && (
              <>
                <Row icon={Briefcase} label="Client" locked={!mayOptions}>
                  <input
                    defaultValue={projectDoc.client ?? ""}
                    disabled={!mayOptions}
                    onBlur={(e) => {
                      if (e.target.value === (projectDoc.client ?? "")) return;
                      void patch({ client: e.target.value });
                    }}
                    placeholder="e.g. Acme Ltd"
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </Row>
                <Row icon={Hash} label="Budget" locked={!mayOptions}>
                  <input
                    type="number"
                    min={0}
                    defaultValue={projectDoc.budget ?? ""}
                    disabled={!mayOptions}
                    onBlur={(e) => {
                      const next =
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value);
                      if (next === projectDoc.budget) return;
                      void patch(
                        next === undefined
                          ? { clearBudget: true }
                          : { budget: next },
                      );
                    }}
                    placeholder="Planned budget"
                    className="w-full rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </Row>
              </>
            )}

            {/* tags */}
            <Row icon={Tag} label="Tags" locked={!mayEdit}>
              <div className="flex gap-1.5">
                <input
                  value={tagDraft}
                  disabled={!mayEdit || busy}
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
                  disabled={!mayEdit || busy || tagDraft.trim().length === 0}
                  onClick={() => void addTags()}
                  className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
                  aria-label="Add tag"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
              {(doc.tags ?? []).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(doc.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        tagChip,
                        "gap-1",
                        mayEdit && "cursor-pointer hover:line-through",
                      )}
                      onClick={() =>
                        mayEdit &&
                        void patch({
                          tags: (doc.tags ?? []).filter((t) => t !== tag),
                        })
                      }
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Row>

            {/* notes */}
            <Row icon={FileText} label="Notes" locked={!mayEdit}>
              <textarea
                value={notesDraft}
                disabled={!mayEdit}
                onChange={(e) => setNotesDraft(e.target.value)}
                onBlur={() => {
                  const current =
                    ("description" in doc ? doc.description : undefined) ?? "";
                  if (notesDraft === current) return;
                  void patch({ notes: notesDraft });
                }}
                rows={3}
                placeholder="Extra information, instructions, or a link…"
                className="w-full resize-y rounded-lg border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              />
            </Row>

            {/* steps */}
            <Row
              icon={ListTodo}
              label={`Steps${steps ? ` (${doneSteps}/${steps.length})` : ""}`}
            >
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
                          checked={step.isCompleted}
                          disabled={!mayComplete || busy}
                          onCheckedChange={() =>
                            void toggleStepM({ kind, stepId: step._id }).catch(
                              (error) =>
                                toast.error(
                                  messageFrom(
                                    error,
                                    "Couldn't update that step.",
                                  ),
                                ),
                            )
                          }
                          aria-label={`Mark “${step.text}” as ${step.isCompleted ? "not done" : "done"}`}
                          className="size-3.5 rounded-[3px]"
                        />
                        {renamingStep === step._id ? (
                          <input
                            autoFocus
                            value={stepRenameDraft}
                            onChange={(e) => setStepRenameDraft(e.target.value)}
                            onBlur={() => void saveStepName(step._id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              if (e.key === "Escape") setRenamingStep(null);
                            }}
                            className="min-w-0 flex-1 rounded border bg-card px-1 text-sm outline-none"
                          />
                        ) : (
                          <span
                            onDoubleClick={() => {
                              if (!mayEdit) return;
                              setStepRenameDraft(step.text);
                              setRenamingStep(step._id);
                            }}
                            title={
                              mayEdit ? "Double-click to rename" : undefined
                            }
                            className={cn(
                              "min-w-0 flex-1 truncate text-sm",
                              step.isCompleted &&
                                "text-muted-foreground line-through",
                            )}
                          >
                            {step.text}
                          </span>
                        )}
                        {mayEdit && (
                          <button
                            type="button"
                            aria-label={`Remove step ${step.text}`}
                            onClick={() =>
                              void removeStepM({
                                kind,
                                stepId: step._id,
                              }).catch((error) =>
                                toast.error(
                                  messageFrom(
                                    error,
                                    "Couldn't remove that step.",
                                  ),
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
                      placeholder="Break it into a step…"
                      className="h-8 min-w-0 flex-1 rounded-lg border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                    />
                    <button
                      type="button"
                      disabled={
                        !mayEdit || busy || stepDraft.trim().length === 0
                      }
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
                          <img
                            src={a.data}
                            alt={a.name}
                            className="size-full object-cover"
                          />
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
                          onClick={() =>
                            void removeAttachmentM({
                              kind,
                              id,
                              attachmentId: a.id,
                            }).catch(() =>
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

            {/* issues raised on it */}
            <NodeIssues kind={kind} id={id} canEdit={mayEdit || mayComplete} />

            {/* the conversation */}
            <div className="mt-4 border-t border-border/60 pt-4">
              <NodeComments kind={kind} id={id} />
            </div>
          </div>
        </div>

        {/* footer */}
        {mayDelete && onDelete && (
          <div className="border-t border-border/60 p-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full rounded-lg text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              Delete {kind}
            </Button>
          </div>
        )}
      </div>

      <AssignDialog
        target={targetOf(doc, kind)}
        title={kind === "project" ? "Assign this project" : "Assign this job"}
        open={assignOpen}
        onOpenChange={setAssignOpen}
        canEdit={canEdit}
      />
    </aside>
  );
}
