import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatDueLabel } from "@/lib/task-utils";
import { projectStatusesOrDefaults } from "@/lib/project-statuses";
import {
  daysLeftLabel,
  fgProjectStatus,
  matchesStatusFilter,
  type FgDoc,
  type FlaggedData,
  type FlagStatusFilter,
  type JobDoc,
} from "@/components/FlaggedLists";

/** One printed line: a product plus the labels it inherits from its job. */
type PrintRow = {
  fg: FgDoc;
  jobName: string;
  projectName: string;
  status: string;
  dueAt?: number;
  finished: boolean;
};

const cell = "border border-black/20 px-2 py-1 align-top text-[11px] leading-tight";

/**
 * A4-friendly print sheet of the products list. Ongoing and finished products
 * are printed as two separate sections, each split into per-project tables, so
 * work still running is never mixed with work that is done. Rendered into a
 * portal and hidden on screen — the print stylesheet reveals only this sheet.
 */
export default function ProductPrintSheet({
  data,
  allJobs,
  projectStatuses: configuredProjectStatuses,
  statusFilter,
}: {
  data: FlaggedData;
  allJobs: JobDoc[];
  projectStatuses?: string[];
  statusFilter?: FlagStatusFilter;
}) {
  const configuredStatusesQuery = useQuery(api.settings.listProjectStatuses);
  const projectStatuses = projectStatusesOrDefaults(
    configuredProjectStatuses ?? configuredStatusesQuery,
  );

  const rows: PrintRow[] = useMemo(
    () =>
      data.fgs
        .filter((fg) =>
          matchesStatusFilter(
            statusFilter ?? "all",
            fgProjectStatus(fg, projectStatuses),
            fg.isCompleted ?? false,
          ),
        )
        .map((fg) => {
          const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
          const job = allJobs.find((j) => jobIds.includes(j._id));
          return {
            fg,
            jobName: job?.name ?? "—",
            projectName: job ? data.projectNameOf(job) : (fg.projectName ?? "Standalone"),
            status: fgProjectStatus(fg, projectStatuses),
            dueAt: fg.dueAt ?? job?.dueAt,
            finished: fg.isCompleted === true,
          };
        }),
    [data, allJobs, projectStatuses, statusFilter],
  );

  const ongoing = rows.filter((r) => !r.finished);
  const finished = rows.filter((r) => r.finished);

  /** Group rows per project, A–Z, each group sorted within its section. */
  const groupByProject = (list: PrintRow[], isFinished: boolean) => {
    const map = new Map<string, PrintRow[]>();
    for (const row of list) {
      const group = map.get(row.projectName) ?? [];
      group.push(row);
      map.set(row.projectName, group);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([name, group]): [string, PrintRow[]] => [
          name,
          [...group].sort((a, b) =>
            isFinished
              ? (b.fg.completedAt ?? 0) - (a.fg.completedAt ?? 0) || a.fg.name.localeCompare(b.fg.name)
              : (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.fg.name.localeCompare(b.fg.name),
          ),
        ],
      );
  };

  const ongoingGroups = useMemo(() => groupByProject(ongoing, false), [ongoing]);
  const finishedGroups = useMemo(() => groupByProject(finished, true), [finished]);

  const ongoingWithDue = ongoing.filter((r) => r.dueAt !== undefined);
  const late = ongoingWithDue.filter((r) => daysLeftLabel(r.dueAt as number).overdue);
  const printedOn = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const summary = (label: string, value: number) => (
    <span>
      <strong>{value}</strong> {label}
    </span>
  );

  /** Days a finished product took, from being flagged to completion. */
  const tookDays = (row: PrintRow) => {
    if (row.fg.completedAt === undefined) return null;
    const start = row.fg.flaggedAt ?? row.fg._creationTime;
    return Math.max(0, Math.round((row.fg.completedAt - start) / 86_400_000));
  };

  const table = (list: PrintRow[], finished: boolean) => (
    <table className="w-full border-collapse">
      <thead>
        <tr className="bg-black/[0.06]">
          <th className={cell}>Product</th>
          <th className={`${cell} w-[70px]`}>Code</th>
          <th className={`${cell} w-[110px]`}>Job</th>
          <th className={`${cell} w-[90px]`}>Status</th>
          <th className={`${cell} w-[95px]`}>{finished ? "Finished on" : "Due"}</th>
          <th className={`${cell} w-[80px] text-right`}>
            {finished ? "Took" : "Days left"}
          </th>
        </tr>
      </thead>
      <tbody>
        {list.map((row) => {
          const left = row.dueAt !== undefined ? daysLeftLabel(row.dueAt) : null;
          const took = finished ? tookDays(row) : null;
          return (
            <tr key={row.fg._id}>
              <td className={cell}>
                {row.fg.name}
                {row.fg.category && (
                  <span className="ml-1 text-[10px] opacity-70">{row.fg.category}</span>
                )}
              </td>
              <td className={cell}>{row.fg.code ?? "—"}</td>
              <td className={cell}>{row.jobName}</td>
              <td className={cell}>{row.status}</td>
              <td className={cell}>
                {finished
                  ? row.fg.completedAt !== undefined
                    ? formatDueLabel(row.fg.completedAt)
                    : "—"
                  : row.dueAt !== undefined
                    ? formatDueLabel(row.dueAt)
                    : "—"}
              </td>
              <td className={`${cell} text-right`}>
                {finished ? (took !== null ? `${took}d` : "—") : left ? left.text : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const section = (
    title: string,
    count: number,
    groups: [string, PrintRow[]][],
    isFinished: boolean,
    note: string,
  ) => (
    <section className="mb-5">
      <h2 className="mb-2 border-b border-black/30 pb-1 text-[13px] font-bold">
        {title} ({count})
      </h2>
      <p className="mb-2 text-[10px] opacity-70">{note}</p>
      {count === 0 ? (
        <p className="text-[11px]">Nothing in this section.</p>
      ) : (
        groups.map(([projectName, list]) => (
          <div key={projectName} className="mb-3 break-inside-avoid">
            <h3 className="mb-1 text-[11px] font-semibold">
              {projectName}
              <span className="ml-2 font-normal text-[10px]">
                {isFinished
                  ? `${list.length} product${list.length === 1 ? "" : "s"}`
                  : `${list.filter((r) => r.finished).length}/${list.length} finished`}
              </span>
            </h3>
            {table(list, isFinished)}
          </div>
        ))
      )}
    </section>
  );

  return createPortal(
    <div className="print-sheet hidden bg-white p-6 text-black">
      <header className="mb-4 border-b-2 border-black/30 pb-2">
        <h1 className="text-lg font-bold">Products report</h1>
        <p className="text-[11px]">
          Printed {printedOn}
          {statusFilter && statusFilter !== "all" ? ` · Status: ${statusFilter}` : ""}
        </p>
      </header>

      <section className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
        {summary("products", rows.length)}
        {summary("ongoing", ongoing.length)}
        {summary("finished", finished.length)}
        {summary("overdue", late.length)}
        {summary("without a due date", ongoing.length - ongoingWithDue.length)}
      </section>

      {section(
        "Ongoing products",
        ongoing.length,
        ongoingGroups,
        false,
        "Work still in production, earliest due date first.",
      )}
      {section(
        "Finished products",
        finished.length,
        finishedGroups,
        true,
        "Completed work, most recently finished first. “Took” is the days from being flagged to finished.",
      )}

      <footer className="mt-4 border-t border-black/20 pt-1 text-[10px] opacity-70">
        Due dates and days left are calculated at the time of printing.
      </footer>
    </div>,
    document.body,
  );
}
