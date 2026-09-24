import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Briefcase,
  ChevronDown,
  CircleCheck,
  Download,
  Folder,
  Loader2,
  Package,
  Pause,
  Pencil,
  Play,
  Plus,
  Search as SearchIcon,
  Sigma,
  Trash2,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { useAppDialogs } from "@/components/AppDialogs";
import { cn } from "@/lib/utils";

type FgDoc = Doc<"finishedGoods">;
type ProjectDoc = Doc<"projects">;
type JobDoc = Doc<"projectJobs">;

const STATUS_META: Record<
  string,
  { label: string; chip: string }
> = {
  planning: {
    label: "Planning",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  in_progress: {
    label: "In progress",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  on_hold: {
    label: "On hold",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  cancelled: {
    label: "Cancelled",
    chip: "bg-muted text-muted-foreground",
  },
};

const PRIORITY_DOT: Record<string, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
};

const JOB_STATUS_META: Record<
  string,
  { label: string; chip: string }
> = {
  planning: {
    label: "Planning",
    chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  in_progress: {
    label: "In progress",
    chip: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
  paused: {
    label: "Paused",
    chip: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  cancelled: {
    label: "Cancelled",
    chip: "bg-muted text-muted-foreground",
  },
};

function dueLabel(dueAt: number): { text: string; overdue: boolean } {
  const due = new Date(dueAt);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const overdue = dueAt < startOfToday;
  const days = Math.ceil((dueAt - startOfToday) / 86_400_000);
  let text: string;
  if (days === 0) text = "Due today";
  else if (days === 1) text = "Due tomorrow";
  else if (days > 1) text = `Due in ${days}d`;
  else text = `${-days}d overdue`;
  return {
    text: `${text} · ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    overdue,
  };
}

type ProjectRow = {
  key: string;
  name: string;
  code?: string;
  project?: ProjectDoc;
  products: number;
  cost: number;
  total: number;
  currency: string;
  fgIds: Id<"finishedGoods">[];
  jobs: JobDoc[];
};

const inputCls =
  "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30";

/** Inline form for creating / editing a job under a project. */
function JobDialog({
  projectId,
  projectLabel,
  job,
  onClose,
}: {
  projectId: Id<"projects"> | null;
  projectLabel: string;
  job: JobDoc | null;
  onClose: () => void;
}) {
  const addJob = useMutation(api.jobs.addJob);
  const updateJob = useMutation(api.jobs.updateJob);
  const [name, setName] = useState(job?.name ?? "");
  const [description, setDescription] = useState(job?.description ?? "");
  const [assignee, setAssignee] = useState(job?.assignee ?? "");
  const [dueDate, setDueDate] = useState(
    job?.dueAt !== undefined ? new Date(job.dueAt).toISOString().slice(0, 10) : "",
  );
  const [priority, setPriority] = useState<"high" | "medium" | "low">(
    job?.priority ?? "medium",
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the job a name.");
      return;
    }
    if (projectId === null) return;
    setSaving(true);
    try {
      const dueAt = dueDate
        ? new Date(`${dueDate}T12:00:00`).getTime()
        : undefined;
      if (job) {
        await updateJob({
          id: job._id,
          name: name.trim(),
          description: description.trim() || undefined,
          assignee: assignee.trim() || undefined,
          dueAt,
          priority: priority as "high" | "medium" | "low",
        });
        toast.success("Job updated.");
      } else {
        await addJob({
          projectId,
          name: name.trim(),
          description: description.trim() || undefined,
          assignee: assignee.trim() || undefined,
          dueAt,
          priority: priority as "high" | "medium" | "low",
        });
        toast.success(`Job “${name.trim()}” created — add products to it next.`);
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the job.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Briefcase className="size-4" />
            </span>
            {job ? `Edit “${job.name}”` : `New job under “${projectLabel}”`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            A job is a task inside the project — products (FG) belong to a job.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Job name *</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cutting & assembly"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Assigned to</label>
              <Input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="e.g. Sarah"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Due date</label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Priority</label>
            <select
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as "high" | "medium" | "low")
              }
              aria-label="Priority"
              className={inputCls}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scope, instructions…"
              className={inputCls}
            />
          </div>
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" className="rounded-lg" disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {job ? "Save changes" : "Create job"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Projects listing sheet — one row per project with its jobs and details. */
export default function ProjectsSheet({
  finishedGoods,
  loading,
  onOpenProject,
  onNewProject,
  onNewProduct,
  onEditProject,
  onDeleteProject,
}: {
  finishedGoods: FgDoc[];
  loading: boolean;
  onOpenProject: (projectName: string) => void;
  onNewProject?: () => void;
  onNewProduct?: (projectName: string) => void;
  onEditProject?: (project: ProjectDoc) => void;
  onDeleteProject?: (project: ProjectDoc) => void;
}) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [jobDialog, setJobDialog] = useState<{
    projectId: Id<"projects">;
    projectLabel: string;
    job: JobDoc | null;
  } | null>(null);
  const projects = useQuery(api.costing.listProjects);
  const allItems = useQuery(api.costing.listAllItems);
  const allJobs = useQuery(api.jobs.listJobs);
  const pauseJob = useMutation(api.jobs.pauseJob);
  const resumeJob = useMutation(api.jobs.resumeJob);
  const completeJob = useMutation(api.jobs.completeJob);
  const removeJob = useMutation(api.jobs.removeJob);
  const updateJob = useMutation(api.jobs.updateJob);
  const { confirm } = useAppDialogs();

  const costByFg = useMemo(() => {
    const map = new Map<Id<"finishedGoods">, number>();
    for (const item of allItems ?? []) {
      if (item.fgId === undefined) continue;
      map.set(item.fgId, (map.get(item.fgId) ?? 0) + item.qty * item.unitPrice);
    }
    return map;
  }, [allItems]);

  /** Merge the project entity (details) with its FG aggregation (numbers). */
  const rows = useMemo<ProjectRow[]>(() => {
    // Aggregate FGs by project name. Standalone products (no project) are
    // ignored here — they live in the Products tab only.
    const agg = new Map<string, ProjectRow>();
    for (const fg of finishedGoods) {
      if (fg.projectName === undefined) continue;
      const row = agg.get(fg.projectName) ?? {
        key: `n:${fg.projectName}`,
        name: fg.projectName,
        code: fg.projectCode,
        products: 0,
        cost: 0,
        total: 0,
        currency: fg.currency ?? "$",
        fgIds: [],
        jobs: [],
      };
      row.products += 1;
      const c = costByFg.get(fg._id) ?? 0;
      row.cost += c;
      row.total += c * (1 + (fg.markupPct ?? 0) / 100);
      row.fgIds.push(fg._id);
      agg.set(fg.projectName, row);
    }
    // Overlay the project entity details + its jobs.
    const out = new Map<string, ProjectRow>();
    for (const project of projects ?? []) {
      const a = agg.get(project.name);
      out.set(project.name, {
        key: `p:${project._id}`,
        name: project.name,
        code: project.code ?? a?.code,
        project,
        products: a?.products ?? 0,
        cost: a?.cost ?? 0,
        total: a?.total ?? 0,
        currency: a?.currency ?? "$",
        fgIds: a?.fgIds ?? [],
        jobs: (allJobs ?? []).filter((j) => j.projectId === project._id),
      });
    }
    // Name-only projects (legacy, no entity) keep working.
    for (const [name, a] of agg) {
      if (!out.has(name)) out.set(name, { ...a, jobs: [] as JobDoc[] });
    }
    return Array.from(out.values()).sort((x, y) => y.total - x.total);
  }, [finishedGoods, projects, costByFg, allJobs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q) ||
        (p.project?.client ?? "").toLowerCase().includes(q) ||
        (p.project?.assignee ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totals = useMemo(
    () => ({
      products: filtered.reduce((s, p) => s + p.products, 0),
      cost: filtered.reduce((s, p) => s + p.cost, 0),
      total: filtered.reduce((s, p) => s + p.total, 0),
    }),
    [filtered],
  );

  const exportCsv = () => {
    const lines = [
      [
        "Code",
        "Project",
        "Client",
        "Assignee",
        "Status",
        "Priority",
        "Due date",
        "Budget",
        "Products",
        "Cost",
        "Sales Price",
      ].join(","),
      ...filtered.map((p) =>
        [
          `"${(p.code ?? "").replace(/"/g, '""')}"`,
          `"${p.name.replace(/"/g, '""')}"`,
          `"${(p.project?.client ?? "").replace(/"/g, '""')}"`,
          `"${(p.project?.assignee ?? "").replace(/"/g, '""')}"`,
          p.project?.status ? STATUS_META[p.project.status]?.label ?? p.project.status : "",
          p.project?.priority ?? "",
          p.project?.dueAt
            ? new Date(p.project.dueAt).toLocaleDateString()
            : "",
          p.project?.budget?.toFixed(2) ?? "",
          String(p.products),
          p.cost.toFixed(2),
          p.total.toFixed(2),
        ].join(","),
      ),
      `,,,TOTAL,,,"",,${totals.products},${totals.cost.toFixed(2)},${totals.total.toFixed(2)}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "projects.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* new project bar */}
      {onNewProject && (
        <button
          type="button"
          onClick={onNewProject}
          className="flex w-full items-center gap-1.5 rounded-xl border border-dashed bg-card/60 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
          New project — with due date, assignee, description &amp; more
        </button>
      )}

      {/* listing sheet */}
      <section className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <p className="text-sm font-semibold">
            Projects
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {filtered.length} project{filtered.length === 1 ? "" : "s"} ·{" "}
              {totals.products} product{totals.products === 1 ? "" : "s"}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects…"
                className="w-40 rounded-lg border bg-background py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
              />
            </div>
            {filtered.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-lg text-xs"
                onClick={exportCsv}
              >
                <Download className="size-3" />
                CSV
              </Button>
            )}
          </div>
        </div>

        {loading || projects === undefined || allItems === undefined || allJobs === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading projects…
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            {search
              ? `Nothing matches “${search}”.`
              : "No projects yet — create one above."}
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {filtered.map((p) => {
              const detail = p.project;
              const status = detail?.status
                ? STATUS_META[detail.status]
                : undefined;
              const due = detail?.dueAt !== undefined ? dueLabel(detail.dueAt) : null;
              return (
                <li
                  key={p.key}
                  className="group/row px-4 py-3 transition-colors hover:bg-accent/40"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <button
                      type="button"
                      onClick={() => setExpanded(expanded === p.key ? null : p.key)}
                      className="flex min-w-0 items-center gap-2 text-left"
                      title="Show / hide jobs & products"
                    >
                      <ChevronDown
                        className={cn(
                          "size-3.5 shrink-0 text-muted-foreground transition-transform",
                          expanded === p.key && "rotate-180",
                        )}
                      />
                      <Folder className="size-4 shrink-0 text-sky-500/80" />
                      <span className="truncate text-sm font-medium hover:text-primary">
                        {p.name}
                      </span>
                    </button>
                    {p.code && (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                        {p.code}
                      </span>
                    )}
                    {status && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                          status.chip,
                        )}
                      >
                        {status.label}
                      </span>
                    )}
                    {detail?.priority && (
                      <span
                        className="size-2 shrink-0 rounded-full"
                        title={`Priority: ${detail.priority}`}
                      >
                        <span
                          className={cn(
                            "block size-2 rounded-full",
                            PRIORITY_DOT[detail.priority] ?? "bg-muted-foreground",
                          )}
                        />
                      </span>
                    )}
                    {due && (
                      <span
                        className={cn(
                          "shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                          due.overdue
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {due.text}
                      </span>
                    )}

                    {/* actions */}
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      {detail && (
                        <button
                          type="button"
                          aria-label={`Jobs of “${p.name}”`}
                          title="Show / hide jobs"
                          className={cn(
                            "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                            expanded === p.key
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground hover:text-foreground",
                          )}
                          onClick={() => setExpanded(expanded === p.key ? null : p.key)}
                        >
                          <Briefcase className="size-3" />
                          {p.jobs.length} job{p.jobs.length === 1 ? "" : "s"}
                          <ChevronDown
                            className={cn(
                              "size-3 transition-transform",
                              expanded === p.key && "rotate-180",
                            )}
                          />
                        </button>
                      )}
                      <span className="hidden items-center gap-1 text-xs tabular-nums text-muted-foreground group-hover/row:inline-flex sm:inline-flex">
                        {detail?.budget !== undefined && (
                          <span
                            className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                            title="Budget"
                          >
                            Budget {p.currency}
                            {detail.budget.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        )}
                        <span
                          className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium"
                          title="Actual sales total"
                        >
                          {p.currency}
                          {p.total.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </span>
                      {onEditProject && detail && (
                        <button
                          type="button"
                          aria-label={`Edit “${p.name}”`}
                          title="Edit project details"
                          className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-primary group-hover/row:grid"
                          onClick={() => onEditProject(detail)}
                        >
                          <Pencil className="size-3" />
                        </button>
                      )}
                      {onDeleteProject && detail && (
                        <button
                          type="button"
                          aria-label={`Delete “${p.name}”`}
                          title="Delete project (products are kept)"
                          className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-destructive group-hover/row:grid"
                          onClick={() => onDeleteProject(detail)}
                        >
                          <Trash2 className="size-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        aria-label={`Open products of “${p.name}”`}
                        title="Open its products"
                        className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                        onClick={() => onOpenProject(p.name)}
                      >
                        <Package className="size-3.5" />
                      </button>
                      {onNewProduct && (
                        <button
                          type="button"
                          aria-label={`New product under “${p.name}”`}
                          title="New product under this project"
                          className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                          onClick={() => onNewProduct(p.name)}
                        >
                          <Sigma className="size-3.5" />
                        </button>
                      )}
                    </span>
                  </div>

                  {/* second line: description / client / assignee */}
                  {(detail?.description ||
                    detail?.client ||
                    detail?.assignee) && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 pl-6 text-[11px] text-muted-foreground">
                      {detail?.client && (
                        <span className="truncate">Client: {detail.client}</span>
                      )}
                      {detail?.assignee && (
                        <span className="inline-flex items-center gap-1 truncate">
                          <User className="size-3" />
                          {detail.assignee}
                        </span>
                      )}
                      {detail?.description && (
                        <span className="truncate opacity-80">
                          {detail.description}
                        </span>
                      )}
                    </p>
                  )}

                  {/* jobs of this project */}
                  {expanded === p.key && detail && (
                    <div className="mt-2 ml-6 space-y-1 rounded-xl border border-dashed bg-muted/20 p-2">
                      {p.jobs.length === 0 ? (
                        <p className="px-1 py-1.5 text-[11px] text-muted-foreground">
                          No jobs yet — a job is a task inside this project; its
                          products hang off the job.
                        </p>
                      ) : (
                        p.jobs.map((job) => {
                          const meta = job.status
                            ? JOB_STATUS_META[job.status]
                            : undefined;
                          const products = finishedGoods.filter(
                            (f) => f.jobId === job._id,
                          ).length;
                          return (
                            <div
                              key={job._id}
                              className="group/job flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-card px-2 py-1.5 text-xs"
                            >
                              <Briefcase className="size-3 shrink-0 text-sky-500/80" />
                              <span className="font-medium">{job.name}</span>
                              {job.code && (
                                <span className="font-mono text-[10px] text-muted-foreground/70">
                                  {job.code}
                                </span>
                              )}
                              {meta && (
                                <span
                                  className={cn(
                                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                                    meta.chip,
                                  )}
                                >
                                  {meta.label}
                                </span>
                              )}
                              {job.priority && (
                                <span
                                  className={cn(
                                    "size-1.5 shrink-0 rounded-full",
                                    PRIORITY_DOT[job.priority] ??
                                      "bg-muted-foreground",
                                  )}
                                  title={`Priority: ${job.priority}`}
                                />
                              )}
                              {job.dueAt !== undefined && (
                                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
                                  {new Date(job.dueAt).toLocaleDateString(
                                    undefined,
                                    { month: "short", day: "numeric" },
                                  )}
                                </span>
                              )}
                              {job.assignee && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <User className="size-2.5" />
                                  {job.assignee}
                                </span>
                              )}
                              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {products} product{products === 1 ? "" : "s"}
                              </span>

                              <span className="ml-auto flex shrink-0 items-center gap-0.5">
                                {(job.status === "planning" ||
                                  job.status === "paused") && (
                                  <button
                                    type="button"
                                    title="Start / resume work"
                                    aria-label="Resume job"
                                    className="hidden size-5 place-items-center rounded-md text-muted-foreground hover:text-emerald-600 group-hover/job:grid"
                                    onClick={async () => {
                                      try {
                                        if (job.status === "paused") {
                                          await resumeJob({ id: job._id });
                                          toast.success("Job resumed.");
                                        } else {
                                          await updateJob({
                                            id: job._id,
                                            status: "in_progress",
                                          });
                                          toast.success("Job started.");
                                        }
                                      } catch (e) {
                                        toast.error(
                                          e instanceof Error
                                            ? e.message
                                            : "Failed.",
                                        );
                                      }
                                    }}
                                  >
                                    <Play className="size-3" />
                                  </button>
                                )}
                                {job.status === "in_progress" && (
                                  <button
                                    type="button"
                                    title="Pause work"
                                    aria-label="Pause job"
                                    className="hidden size-5 place-items-center rounded-md text-muted-foreground hover:text-amber-600 group-hover/job:grid"
                                    onClick={async () => {
                                      try {
                                        await pauseJob({ id: job._id });
                                        toast.success("Job paused.");
                                      } catch (e) {
                                        toast.error(
                                          e instanceof Error
                                            ? e.message
                                            : "Failed.",
                                        );
                                      }
                                    }}
                                  >
                                    <Pause className="size-3" />
                                  </button>
                                )}
                                {job.status !== "completed" &&
                                  job.status !== "cancelled" && (
                                    <button
                                      type="button"
                                      title="Mark completed"
                                      aria-label="Complete job"
                                      className="hidden size-5 place-items-center rounded-md text-muted-foreground hover:text-emerald-600 group-hover/job:grid"
                                      onClick={async () => {
                                        try {
                                          await completeJob({ id: job._id });
                                          toast.success("Job completed.");
                                        } catch (e) {
                                          toast.error(
                                            e instanceof Error
                                              ? e.message
                                              : "Failed.",
                                          );
                                        }
                                      }}
                                    >
                                      <CircleCheck className="size-3" />
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  title="Edit job"
                                  aria-label="Edit job"
                                  className="hidden size-5 place-items-center rounded-md text-muted-foreground hover:text-primary group-hover/job:grid"
                                  onClick={() =>
                                    setJobDialog({
                                      projectId: detail._id,
                                      projectLabel: p.name,
                                      job,
                                    })
                                  }
                                >
                                  <Pencil className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  title="Delete job (products are kept)"
                                  aria-label="Delete job"
                                  className="hidden size-5 place-items-center rounded-md text-muted-foreground hover:text-destructive group-hover/job:grid"
                                  onClick={async () => {
                                    const ok = await confirm({
                                      title: `Delete job “${job.name}”?`,
                                      message:
                                        "Its products stay but lose the job link. This cannot be undone.",
                                      confirmLabel: "Delete job",
                                      danger: true,
                                    });
                                    if (!ok) return;
                                    try {
                                      await removeJob({ id: job._id });
                                      toast.success("Job deleted.");
                                    } catch (e) {
                                      toast.error(
                                        e instanceof Error
                                          ? e.message
                                          : "Failed.",
                                      );
                                    }
                                  }}
                                >
                                  <Trash2 className="size-3" />
                                </button>
                                <button
                                  type="button"
                                  title="New product under this job"
                                  aria-label="New product under this job"
                                  className="grid size-5 place-items-center rounded-md text-muted-foreground hover:text-primary"
                                  onClick={() => onOpenProject(p.name)}
                                >
                                  <Sigma className="size-3" />
                                </button>
                              </span>
                            </div>
                          );
                        })
                      )}
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        onClick={() =>
                          setJobDialog({
                            projectId: detail._id,
                            projectLabel: p.name,
                            job: null,
                          })
                        }
                      >
                        <Plus className="size-3" />
                        New job under “{p.name}”
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {filtered.length > 0 && (
          <div className="flex items-center justify-end gap-4 border-t border-border/70 bg-primary/5 px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              Products: {totals.products} · Cost {totals.cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span className="font-display text-sm font-bold tabular-nums text-primary">
              Sales {totals.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
      </section>

      <p className="mt-3 text-xs text-muted-foreground">
        A project groups jobs, and jobs group finished goods — its cost and
        total are the sum of all its products. Click a project name to expand
        its jobs, or the package icon to open its products.
      </p>

      {jobDialog && (
        <JobDialog
          projectId={jobDialog.projectId}
          projectLabel={jobDialog.projectLabel}
          job={jobDialog.job}
          onClose={() => setJobDialog(null)}
        />
      )}
    </div>
  );
}
