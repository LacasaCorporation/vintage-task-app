import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, Plus, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { messageFrom } from "@/lib/errors";
import { timeAgoLabel } from "@/lib/task-utils";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Severity = "high" | "medium" | "low";

const SEVERITIES: { value: Severity; label: string; dot: string }[] = [
  { value: "high", label: "High", dot: "bg-rose-500" },
  { value: "medium", label: "Medium", dot: "bg-amber-500" },
  { value: "low", label: "Low", dot: "bg-emerald-500" },
];

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-500",
  low: "bg-emerald-500",
};

/**
 * Problems raised against a task, and how each was put right.
 *
 * An issue is anything that went wrong — wrong part, wrong measurement, site
 * access, a promise that could not be kept. Reporting one is separate from
 * ticking the task off: the task can only be completed once its issues are
 * solved, so a snag can't quietly disappear.
 */
export default function TaskIssues({
  taskId,
  canEdit,
}: {
  taskId: Id<"tasks">;
  canEdit: boolean;
}) {
  const issues = useQuery(api.tasks.listIssues, { taskId });
  const addIssue = useMutation(api.tasks.addIssue);
  const setIssueSolved = useMutation(api.tasks.setIssueSolved);
  const removeIssue = useMutation(api.tasks.removeIssue);
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [solving, setSolving] = useState<Id<"taskIssues"> | null>(null);
  const [solution, setSolution] = useState("");

  const open = (issues ?? []).filter((i) => !i.isSolved);
  const solved = (issues ?? []).filter((i) => i.isSolved);

  const report = async (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim().length === 0) return;
    try {
      await addIssue({ taskId, title, detail, severity });
      setTitle("");
      setDetail("");
      setSeverity("medium");
      setComposing(false);
      toast.success("Issue reported.");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't report that issue."));
    }
  };

  const solve = async (id: Id<"taskIssues">) => {
    if (solution.trim().length === 0) {
      toast.error("Say how you fixed it, so the next person knows.");
      return;
    }
    try {
      await setIssueSolved({ id, solved: true, solution });
      setSolving(null);
      setSolution("");
      toast.success("Issue solved.");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't close that issue."));
    }
  };

  return (
    <div className="flex items-start gap-2.5 px-1 py-1.5">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Issues
          {issues !== undefined && issues.length > 0
            ? ` (${open.length} open)`
            : ""}
        </p>

        {issues === undefined ? (
          <p className="mt-1 text-xs text-muted-foreground">Loading issues…</p>
        ) : issues.length === 0 && !composing ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Nothing reported. If something on this job is wrong, log it here so
            it gets fixed rather than forgotten.
          </p>
        ) : (
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
            {[...open, ...solved].map((issue) => (
              <li
                key={issue._id}
                className={cn(
                  "rounded-xl border px-2.5 py-2",
                  issue.isSolved
                    ? "border-border/60 bg-muted/30"
                    : "border-rose-500/40 bg-rose-500/5",
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      issue.isSolved
                        ? "bg-emerald-500"
                        : (SEVERITY_DOT[issue.severity ?? "medium"] ??
                          "bg-amber-500"),
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-sm font-medium break-words",
                        issue.isSolved && "text-muted-foreground",
                      )}
                    >
                      {issue.title}
                    </p>
                    {issue.detail !== undefined && issue.detail !== "" && (
                      <p className="mt-0.5 text-xs break-words whitespace-pre-wrap text-muted-foreground">
                        {issue.detail}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {issue.raisedByLabel} · {timeAgoLabel(issue.at)}
                      {issue.severity !== undefined &&
                        ` · ${issue.severity} severity`}
                    </p>
                    {issue.isSolved && (
                      <p className="mt-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 dark:text-emerald-400">
                        {issue.solution ?? "Solved."}
                        {issue.solvedByLabel !== undefined && (
                          <span className="ml-1 opacity-80">
                            — {issue.solvedByLabel}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      {issue.isSolved ? (
                        <button
                          type="button"
                          aria-label="Reopen issue"
                          title="Reopen"
                          className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          onClick={() =>
                            void setIssueSolved({ id: issue._id, solved: false })
                              .then(() => toast.success("Issue reopened."))
                              .catch((error: unknown) =>
                                toast.error(
                                  messageFrom(error, "Couldn't reopen that issue."),
                                ),
                              )
                          }
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      ) : solving === issue._id ? null : (
                        <button
                          type="button"
                          aria-label="Mark solved"
                          title="Mark solved"
                          className="grid size-6 place-items-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
                          onClick={() => {
                            setSolving(issue._id);
                            setSolution("");
                          }}
                        >
                          <CheckCircle2 className="size-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label="Delete issue"
                        className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        onClick={() =>
                          void removeIssue({ id: issue._id })
                            .then(() => toast.success("Issue removed."))
                            .catch((error: unknown) =>
                              toast.error(
                                messageFrom(error, "Couldn't remove that issue."),
                              ),
                            )
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {solving === issue._id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void solve(issue._id);
                    }}
                    className="mt-2 space-y-1.5"
                  >
                    <Textarea
                      value={solution}
                      onChange={(e) => setSolution(e.target.value)}
                      placeholder="How did you fix it?"
                      rows={2}
                      className="text-xs"
                      aria-label="How the issue was fixed"
                    />
                    <div className="flex gap-1.5">
                      <Button
                        type="submit"
                        size="sm"
                        className="h-7 rounded-lg text-xs"
                      >
                        Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 rounded-lg text-xs"
                        onClick={() => setSolving(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {composing ? (
          <form onSubmit={report} className="mt-2 space-y-1.5">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's wrong?"
              className="h-8 rounded-lg text-sm"
              aria-label="Issue summary"
            />
            <Textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="Any detail that helps — where, since when, who to call."
              rows={2}
              className="text-xs"
              aria-label="Issue detail"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {SEVERITIES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSeverity(s.value)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                    severity === s.value
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent",
                  )}
                >
                  <span className={cn("mr-1 inline-block size-1.5 rounded-full", s.dot)} />
                  {s.label}
                </button>
              ))}
              <Button
                type="submit"
                size="sm"
                className="ml-auto h-7 rounded-lg text-xs"
                disabled={title.trim().length === 0}
              >
                Report
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 rounded-lg text-xs"
                onClick={() => setComposing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-8 rounded-lg text-xs"
              onClick={() => setComposing(true)}
            >
              <Plus className="size-3.5" />
              Report an issue
            </Button>
          )
        )}
      </div>
    </div>
  );
}
