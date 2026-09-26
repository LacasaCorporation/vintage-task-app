import { useMemo } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { formatDueLabel } from "@/lib/task-utils";
import { PROJECT_STATUS_FINISH, projectStatusesOrDefaults } from "@/lib/project-statuses";
import {
  daysLeftLabel,
  fgProjectStatus,
  type FgDoc,
  type FlaggedData,
  type FlagStatusFilter,
  type JobDoc,
} from "@/components/FlaggedLists";
import { matchesStatusFilter } from "@/components/FlaggedLists";

/** One printed line: a product plus the labels it inherits from its job. */
type PrintRow = {
  fg: FgDoc;
  jobName: string;
  projectName: string;
  status: string;
  dueAt?: number;
};

const cell = "border border-black/20 px-2 py-1 align-top text-[11px] leading-tight";

/**
 * A4-friendly print sheet of the products list, grouped by project with the
 * due date and the days left on every line. Rendered into a portal and hidden
 * on screen — the print stylesheet in `index.css` reveals only this sheet.
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
          };
        }),
    [data, allJobs, projectStatuses, statusFilter],
  );

  const groups = useMemo(() => {
    const map = new Map<string, PrintRow[]>();
    for (const row of rows) {
      const list = map.get(row.projectName) ?? [];
      list.push(row);
      map.set(row.projectName, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  const done = rows.filter((r) => r.status === PROJECT_STATUS_FINISH).length;
  const withDue = rows.filter((r) => r.dueAt !== undefined);
  const late = withDue.filter((r) => daysLeftLabel(r.dueAt as number).overdue).length;
  const printedOn = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

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
        <span>
          <strong>{rows.length}</strong> products
        </span>
        <span>
          <strong>{rows.length - done}</strong> in production
        </span>
        <span>
          <strong>{done}</strong> finished
        </span>
        <span>
          <strong>{late}</strong> overdue
        </span>
        <span>
          <strong>{rows.length - withDue.length}</strong> without a due date
        </span>
      </section>

      {groups.length === 0 ? (
        <p className="text-[11px]">No products match this filter.</p>
      ) : (
        groups.map(([projectName, list]) => (
          <section key={projectName} className="mb-4 break-inside-avoid">
            <h2 className="mb-1 text-[12px] font-semibold">
              {projectName}
              <span className="ml-2 font-normal text-[10px]">
                {list.filter((r) => r.status === PROJECT_STATUS_FINISH).length}/{list.length} finished
              </span>
            </h2>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-black/[0.06]">
                  <th className={`${cell} w-[70px]`}>Code</th>
                  <th className={cell}>Product</th>
                  <th className={`${cell} w-[110px]`}>Job</th>
                  <th className={`${cell} w-[90px]`}>Status</th>
                  <th className={`${cell} w-[95px]`}>Due</th>
                  <th className={`${cell} w-[80px] text-right`}>Days left</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => {
                  const left =
                    row.dueAt !== undefined ? daysLeftLabel(row.dueAt) : null;
                  return (
                    <tr key={row.fg._id}>
                      <td className={cell}>{row.fg.code ?? "—"}</td>
                      <td className={cell}>
                        {row.fg.name}
                        {row.fg.category && (
                          <span className="ml-1 text-[10px] opacity-70">{row.fg.category}</span>
                        )}
                      </td>
                      <td className={cell}>{row.jobName}</td>
                      <td className={cell}>{row.status}</td>
                      <td className={cell}>
                        {row.dueAt !== undefined ? formatDueLabel(row.dueAt) : "—"}
                      </td>
                      <td className={`${cell} text-right`}>
                        {left ? left.text : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))
      )}

      <footer className="mt-4 border-t border-black/20 pt-1 text-[10px] opacity-70">
        Due dates and days left are calculated at the time of printing.
      </footer>
    </div>,
    document.body,
  );
}
