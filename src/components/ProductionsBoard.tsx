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
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
  projectStatusesOrDefaults,
} from "@/lib/project-statuses";
import { isFlaggedProjectWork } from "@/lib/project-work";
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
  const projectStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const setProjectStatusesM = useMutation(api.settings.setProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(projectStatusesQuery);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  // level filter (projects / jobs / products), status filter, and the
  // list-vs-hierarchy-vs-board presentation of the current level
  const [filter, setFilter] = useState<FlagFilter>("projects");
  const [status, setStatus] = useState<FlagStatusFilter>("all");
  const [view, setView] = useState<WorkspaceView>("list");
  const [selection, setSelection] = useState<FlaggedSel>(null);
  // the print sheet is mounted on demand, then the browser print dialog opens
  const [printing, setPrinting] = useState(false);
  const [statusSettingsOpen, setStatusSettingsOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState<string[] | null>(null);

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

  /** Flagged jobs (with their project) and flagged products. */
  const items = useMemo<FlaggedData | null>(() => {
    if (onlyFlaggedJobs.length === 0 && onlyFlaggedFgs.length === 0) return null;
    const projectNameOf = (job: JobDoc): string => {
      const project = (projects ?? []).find((p) => p._id === job.projectId);
      return project?.name ?? "Project";
    };
    return {
      jobs: onlyFlaggedJobs,
      fgs: onlyFlaggedFgs,
      projects: projects ?? [],
      projectNameOf,
    };
  }, [onlyFlaggedJobs, onlyFlaggedFgs, projects]);

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

  const handleToggleFg = async (fg: FgDoc) => {
    setBusyKey(`f:${fg._id}`);
    try {
      await setFgCompletedM({ id: fg._id, completed: !fg.isCompleted });
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
      projects={projects}
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
        setStatusDraft(projectStatuses);
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
