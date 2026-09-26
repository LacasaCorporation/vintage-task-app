import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  AlarmClock,
  Crown,
  ListTodo,
  Loader2,
  Plus,
  Star,
  Tag,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import AssignDialog, { targetOf } from "@/components/AssignDialog";
import { REMINDER_OFFSETS } from "@/lib/task-utils";
import { assigneeLabel, assigneesOfTask } from "@/lib/task-people";
import { messageFrom } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * The working parts of a task, on a flagged product: who it is assigned to, the
 * permissions its owner hands out, a star, a reminder, tags, and steps.
 *
 * It lives in its own card under the product's details rather than inside the
 * details panel, which is a fixed-height slide-in; everything here behaves
 * exactly as it does on a task, including the owner-first permission rule.
 */
export default function ProductTaskFeatures({
  fg,
  canEdit = true,
}: {
  fg: Doc<"finishedGoods">;
  canEdit?: boolean;
}) {
  const updateFg = useMutation(api.costing.updateFinishedGood);
  const addStep = useMutation(api.productTasks.addStep);
  const toggleStep = useMutation(api.productTasks.toggleStep);
  const removeStep = useMutation(api.productTasks.removeStep);
  const peopleData = useQuery(api.tasks.people);
  const groupsData = useQuery(api.userGroups.list);
  const rights = useQuery(api.productTasks.myRights, { id: fg._id });
  const steps = useQuery(api.productTasks.listSteps, { fgId: fg._id });

  const [assignOpen, setAssignOpen] = useState(false);
  const [stepDraft, setStepDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [busy, setBusy] = useState(false);

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
    () => assigneesOfTask(fg, peopleById),
    [fg, peopleById],
  );
  const groupIds = fg.groupIds ?? [];

  // the role gates the card; the product's own grant narrows it further
  const mayEdit = canEdit && (rights?.canEdit ?? true);
  const mayComplete = canEdit && (rights?.canComplete ?? true);
  const mayOptions = canEdit && (rights?.canChangeOptions ?? true);
  const isOwner = rights?.isOwner ?? false;

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

  const doneSteps = (steps ?? []).filter((s) => s.isCompleted).length;

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3.5">
        <ListTodo className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Working on this product</h2>
        {steps !== undefined && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {doneSteps}/{steps.length} steps
          </span>
        )}
        {!isOwner && rights !== undefined && (
          <span className="text-[11px] text-muted-foreground">
            {rights.canEdit || rights.canComplete
              ? `You can ${[rights.canEdit && "edit", rights.canComplete && "complete", rights.canChangeOptions && "change options", rights.canDelete && "delete"].filter(Boolean).join(", ")}`
              : "view only"}
          </span>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => void patch({ starred: !fg.starred })}
          disabled={!mayEdit || busy}
          aria-pressed={fg.starred === true}
          title={fg.starred ? "Remove the star" : "Star this product"}
        >
          <Star
            className={cn("size-4", fg.starred && "fill-amber-400 text-amber-500")}
          />
        </Button>
      </header>

      <div className="space-y-4 px-5 py-4">
        {/* assigned to */}
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Assigned to
          </p>
          <button
            type="button"
            onClick={() => setAssignOpen(true)}
            className={cn(
              "mt-1 flex w-full items-center gap-2 rounded-lg border border-border/70 px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent",
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
          {peopleData?.people.some((p) => p.isFirmOwner) && assignees.length > 0 && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Crown className="size-3 text-primary" />
              {assignees
                .map((id) => peopleById.get(id)?.label ?? "someone")
                .join(", ")}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* reminder */}
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <AlarmClock className="size-3" />
              Reminder
            </p>
            <select
              value=""
              disabled={!mayOptions || busy || fg.dueAt === undefined}
              onChange={(e) => {
                const offset = REMINDER_OFFSETS[Number(e.target.value)];
                if (offset === undefined || offset.minutes === null) return;
                if (fg.dueAt === undefined) return;
                void patch({ remindAt: fg.dueAt - offset.minutes * 60_000 });
              }}
              className="mt-1 h-8 w-full rounded-lg border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
            >
              <option value="">
                {fg.remindAt !== undefined
                  ? `Reminder set — change`
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
          </div>

          {/* tags */}
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <Tag className="size-3" />
              Tags
            </p>
            <div className="mt-1 flex gap-1.5">
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
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                disabled={!mayOptions || busy || tagDraft.trim().length === 0}
                onClick={() => void addTags()}
              >
                <Plus className="size-3.5" />
                Add
              </Button>
            </div>
            {(fg.tags ?? []).length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(fg.tags ?? []).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {tag}
                    {mayOptions && (
                      <button
                        type="button"
                        aria-label={`Remove tag ${tag}`}
                        onClick={() =>
                          void patch({
                            tags: (fg.tags ?? []).filter((t) => t !== tag),
                          })
                        }
                        className="hover:text-foreground"
                      >
                        <X className="size-2.5" />
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* steps */}
        <div>
          <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Steps
          </p>
          {steps === undefined ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Loading steps…
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
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
                        toast.error(messageFrom(error, "Couldn't update that step.")),
                      )
                    }
                    aria-label={`Mark “${step.text}” as ${step.isCompleted ? "not done" : "done"}`}
                    className="size-3.5 rounded-[3px]"
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      step.isCompleted && "text-muted-foreground line-through",
                    )}
                  >
                    {step.text}
                  </span>
                  {(mayEdit || isOwner) && (
                    <button
                      type="button"
                      aria-label={`Remove step ${step.text}`}
                      onClick={() =>
                        void removeStep({ stepId: step._id }).catch((error) =>
                          toast.error(messageFrom(error, "Couldn't remove that step.")),
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
                  No steps yet — break the work down below.
                </li>
              )}
            </ul>
          )}
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
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              disabled={!mayEdit || busy || stepDraft.trim().length === 0}
              onClick={() => void submitStep()}
            >
              <Plus className="size-3.5" />
              Step
            </Button>
          </div>
        </div>
      </div>

      <AssignDialog
        target={targetOf(fg, "product")}
        title="Assign this product"
        open={assignOpen}
        onOpenChange={setAssignOpen}
        canEdit={canEdit}
      />
    </section>
  );
}
