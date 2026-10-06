import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import ProjectsWorkspace from "@/components/ProjectsWorkspace";
import { DEFAULT_VIEW_BY_FILTER, type WorkspaceView } from "@/components/FlaggedViews";
import {
  jobProjectStatus,
  type FlagFilter,
  type FlagStatusFilter,
  type FlaggedData,
  type FlaggedSel,
  type FgDoc,
  type JobDoc,
  type SortMode,
} from "@/components/FlaggedLists";
import {
  finishBlockedReason,
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
  projectStatusDetailsOrDefaults,
  type ProjectStatusDetail,
} from "@/lib/project-statuses";
import { isFlaggedProjectWork } from "@/lib/project-work";
import { useAppDialogs } from "@/components/AppDialogs";
import { toast } from "@/lib/toast";

/**
 * Productions: the flagged work, worked start → complete.
 *
 * This lives on the Projects page as its own tab. It used to be a task view
 * reached from the side menu, but everything in it is a project, a job or a
 * product — there are no tasks to triage, so it sits with the things it is
 * about.
 *
 * It is driven entirely by the flags: a job or product whose flag is taken off
 * drops out of here too, and comes back only when the flag goes on again. The
 * queries return the full lists, so the filtering happens here.
 */
export default function ProductionsBoard({
  canEdit = true,
  sortMode = "manual",
}: {
  canEdit?: boolean;
  /** Shared with the Projects page so the two lists order the same way. */
  sortMode?: SortMode;
}) {
  const jobs = useQuery(api.jobs.listJobs);
  const fgs = useQuery(api.costing.listFinishedGoods);
  const projects = useQuery(api.costing.listProjects);
  const setFgCompletedM = useMutation(api.costing.setFgCompleted);
  const setJobProjectStatusM = useMutation(api.jobs.setJobProjectStatus);
  const { confirm } = useAppDialogs();
  const statusDetailsQuery = useQuery(api.settings.listProjectStatusDetails);
  const setProjectStatusesM = useMutation(api.settings.setProjectStatuses);
  // one query holds the statuses and the details the editor keeps — colour,
  // completion and who owns the stage — so the board and the editor read the
  // same workflow and can never disagree about what a status is called
  const statusDetails = projectStatusDetailsOrDefaults(statusDetailsQuery);
  const projectStatuses = statusDetails.map((detail) => detail.name);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  // level filter (projects / jobs / products), status filter, and the
  // list-vs-hierarchy-vs-board presentation of the current level
  const [filter, setFilter] = useState<FlagFilter>("projects");
  const [status, setStatus] = useState<FlagStatusFilter>("all");
  // the tree is the level's default presentation: it is the only one that
  // draws the chevron on a project, so starting on the flat list left the
  // board with no way to expand a project's jobs without reaching for the
  // view toggles
  const [view, setView] = useState<WorkspaceView>(
    DEFAULT_VIEW_BY_FILTER.projects ?? "hierarchy",
  );
  const [selection, setSelection] = useState<FlaggedSel>(null);
  // the print sheet is mounted on demand, then the browser print dialog opens
  const [printing, setPrinting] = useState(false);
  const [statusSettingsOpen, setStatusSettingsOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState<ProjectStatusDetail[] | null>(null);

  const onlyFlaggedJobs = useMemo(
    () => (jobs ?? []).filter((j) => j.isFlagged),
    [jobs],
  );
  // a product is on this board as project work: one left with no job — its
  // job deleted, or it was detached from the project — has nothing to
  // produce for, so a stale flag on it is ignored rather than stranded here
  const onlyFlaggedFgs = useMemo(
    () => (fgs ?? []).filter(isFlaggedProjectWork),
    [fgs],
  );

  /**
   * Only the projects that have something to produce.
   *
   * Jobs and products arrive here already filtered to the flagged ones, but
   * the project list did not — so a project with nothing flagged in it was
   * still drawn, empty, on a board whose own tab reads 0. A project earns its
   * place by holding a flagged job, or a flagged product in one of its jobs.
   */
  const productionProjects = useMemo(() => {
    const withNames = new Set<string>();
    for (const fg of onlyFlaggedFgs) {
      const name = fg.projectName?.trim().toLowerCase();
      if (name !== undefined && name !== "") withNames.add(name);
    }
    return (projects ?? []).filter(
      (p) =>
        onlyFlaggedJobs.some((j) => j.projectId === p._id) ||
        withNames.has(p.name.trim().toLowerCase()),
    );
  }, [projects, onlyFlaggedJobs, onlyFlaggedFgs]);

  /** Flagged jobs (with their project) and flagged products. */
  const items = useMemo<FlaggedData | null>(() => {
    if (onlyFlaggedJobs.length === 0 && onlyFlaggedFgs.length === 0) return null;
    const byId = new Map((projects ?? []).map((p) => [p._id, p.name] as const));
    const projectNameOf = (job: JobDoc): string =>
      byId.get(job.projectId) ?? "Project";
    return {
      jobs: onlyFlaggedJobs,
      fgs: onlyFlaggedFgs,
      projects: productionProjects,
      projectNameOf,
    };
  }, [onlyFlaggedJobs, onlyFlaggedFgs, productionProjects, projects]);

  const saveProjectStatuses = async () => {
    if (statusDraft === null) return;
    try {
      await setProjectStatusesM({ statuses: statusDraft });
      setStatusDraft(null);
      setStatusSettingsOpen(false);
      toast.success("Projects statuses updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update statuses.");
    }
  };

  /**
   * Mount the hidden print sheet, let it paint, then open the browser print
   * dialog and unmount it again so it never lingers in the app.
   */
  const handlePrint = () => {
    setPrinting(true);
    window.setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 120);
  };

  /**
   * Tick a product off, or reopen it.
   *
   * Ticking is finishing, which only a run under way can do — the tick is
   * frozen while that is not the case, so it never reaches the server from
   * here. Reopening a finished product is the one that has to be asked about:
   * its units are on the shelf and its cost is in the job's totals, and
   * reopening leaves both exactly as they are.
   */
  const handleToggleFg = async (fg: FgDoc) => {
    const reopening = fg.isCompleted === true;
    if (reopening) {
      const goAhead = await confirm({
        title: `Reopen “${fg.name}”?`,
        message:
          "It is finished, so its units are already on the shelf and its cost is counted in the job's totals. Reopening puts it back on the list — the stock, the cost and those totals are not changed.",
        confirmLabel: "Reopen",
        danger: true,
      });
      if (!goAhead) return;
    } else {
      const blocked = finishBlockedReason(fg);
      if (blocked !== null) {
        toast.error(blocked);
        return;
      }
    }
    setBusyKey(`f:${fg._id}`);
    try {
      await setFgCompletedM({
        id: fg._id,
        completed: !fg.isCompleted,
        confirmReverse: reopening,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the product.");
    } finally {
      setBusyKey(null);
    }
  };

  /**
   * Mark a flagged job as done — only possible when every flagged product
   * under it is completed. Completing the job flips its status to completed;
   * unchecking reopens it.
   */
  const handleToggleJob = async (job: JobDoc) => {
    // only the products that are actually on this page count towards it
    const products = onlyFlaggedFgs.filter(
      (f) => f.jobId === job._id || (f.jobIds ?? []).includes(job._id),
    );
    const allDone = products.length > 0 && products.every((f) => f.isCompleted);
    if (!allDone) return;
    setBusyKey(`j:${job._id}`);
    try {
      await setJobProjectStatusM({
        id: job._id,
        status:
          jobProjectStatus(job, projectStatuses) === PROJECT_STATUS_FINISH
            ? PROJECT_STATUS_START
            : PROJECT_STATUS_FINISH,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the job.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <ProjectsWorkspace
      canEdit={canEdit}
      projects={productionProjects}
      jobs={onlyFlaggedJobs}
      fgs={onlyFlaggedFgs}
      items={items}
      filter={filter}
      onFilterChange={(next) => {
        setFilter(next);
        setView(DEFAULT_VIEW_BY_FILTER[next] ?? "list");
      }}
      status={status}
      onStatusChange={setStatus}
      projectStatuses={projectStatuses}
      statusDraft={statusDraft}
      onStatusDraft={setStatusDraft}
      statusSettingsOpen={statusSettingsOpen}
      onToggleStatusSettings={() => {
        setStatusDraft(statusDetails);
        setStatusSettingsOpen((open) => !open);
      }}
      onSaveStatuses={() => void saveProjectStatuses()}
      view={view}
      onViewChange={setView}
      onPrint={handlePrint}
      printing={printing}
      sortMode={sortMode}
      selection={selection}
      onSelect={setSelection}
      busyKey={busyKey}
      onToggleFg={(fg) => void handleToggleFg(fg)}
      onToggleJob={(job) => void handleToggleJob(job)}
    />
  );
}
