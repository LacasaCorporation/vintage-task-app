import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  projectStatusesOrDefaults,
  PROJECT_STATUS_FINISH,
} from "@/lib/project-statuses";
import { formatDueLabel } from "@/lib/task-utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { batchCost } from "@/lib/product-cost";

type FgDoc = Doc<"finishedGoods">;
type JobDoc = Doc<"projectJobs">;
type ProjectDoc = Doc<"projects">;

export type PrintTab = "projects" | "jobs" | "products" | "vendors" | "customers";

/** One printed line, already resolved to the column the sheet needs. */
export type PrintRow = {
  id: string;
  name: string;
  code?: string;
  /** Project for a job, client for a project, project for a product. */
  secondary: string;
  /** Unit for a product, otherwise the number of items it covers. */
  tertiary: string;
  cost: number;
  total: number;
  status: string;
};

/** Status labels for records that only carry the legacy `status` union. */
const LEGACY_STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  in_progress: "In progress",
  on_hold: "On hold",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Turns the projects / jobs / products on screen into printable rows, using
 * the same cost and markup maths the tables use, and resolves each row's
 * status so the sheet can group by it.
 */
export function buildPrintRows(
  tab: Exclude<PrintTab, "vendors" | "customers">,
  projects: ProjectRowInput[],
  allJobs: JobDoc[],
  finishedGoods: FgDoc[],
  costByFg: Map<Id<"finishedGoods">, number>,
  projectStatuses: string[],
): PrintRow[] {
  const projectNameOf = (job: JobDoc) =>
    projects.find((p) => p._id === job.projectId)?.name ?? "Unassigned";
  const costTotal = (products: FgDoc[]) => {
    let cost = 0;
    let total = 0;
    for (const fg of products) {
      const c = batchCost(costByFg.get(fg._id) ?? 0, fg);
      cost += c;
      total += c * (1 + (fg.markupPct ?? 0) / 100);
    }
    return { cost, total };
  };
  const statusOf = (
    status: string | undefined,
    legacy: string | undefined,
    completed: boolean,
    inProduction: boolean,
  ) => {
    if (completed) return PROJECT_STATUS_FINISH;
    if (inProduction) return "In production";
    if (status && projectStatuses.includes(status)) return status;
    return LEGACY_STATUS_LABEL[legacy ?? "planning"] ?? legacy ?? "Planning";
  };

  if (tab === "products") {
    return finishedGoods.map((fg) => {
      const { cost, total } = costTotal([fg]);
      return {
        id: fg._id,
        name: fg.name,
        code: fg.code,
        secondary: fg.projectName ?? "Standalone",
        tertiary: fg.unit ?? "—",
        cost,
        total,
        status: statusOf(
          fg.projectStatus,
          undefined,
          fg.isCompleted === true,
          fg.productionStartedAt !== undefined,
        ),
      };
    });
  }

  if (tab === "jobs") {
    return allJobs.map((job) => {
      const products = finishedGoods.filter(
        (f) => f.jobId === job._id || (f.jobIds ?? []).includes(job._id),
      );
      const { cost, total } = costTotal(products);
      return {
        id: job._id,
        name: job.name,
        code: job.code,
        secondary: projectNameOf(job),
        tertiary: String(products.length),
        cost,
        total,
        status: statusOf(
          job.projectStatus,
          job.status,
          job.status === "completed",
          false,
        ),
      };
    });
  }

  return projects.map((project) => {
    const products = finishedGoods.filter(
      (f) =>
        (f.projectName ?? "").trim().toLowerCase() ===
        project.name.trim().toLowerCase(),
    );
    const { cost, total } = costTotal(products);
    return {
      id: project._id,
      name: project.name,
      code: project.code,
      secondary: project.client ?? "—",
      tertiary: String(products.length),
      cost,
      total,
      status: statusOf(
        project.projectStatus,
        project.status,
        project.status === "completed" || project.status === "cancelled",
        false,
      ),
    };
  });
}

/** The project fields the print rows need. */
export type ProjectRowInput = Pick<
  ProjectDoc,
  "_id" | "name" | "code" | "client" | "projectStatus" | "status"
>;

/**
 * Printable version of whichever list is on screen. It renders exactly the rows
 * the page is showing, so the search box and the flagged-only filter are
 * already applied, and groups them into status sections so a printed page
 * reads the same way the on-screen status split does.
 */
export default function ProjectsPrintSheet({
  tab,
  rows,
  search,
  filterLabel,
  onPrinted,
}: {
  tab: PrintTab;
  rows: PrintRow[];
  search: string;
  /** The active filter, or null when everything is shown. */
  filterLabel: string | null;
  onPrinted: () => void;
}) {
  const configuredStatuses = useQuery(api.settings.listProjectStatuses);
  const { format: money, code: currencyCode } = useWorkspaceCurrency();
  const projectStatuses = projectStatusesOrDefaults(configuredStatuses);
  // captured once so the printed timestamp stays stable across re-renders
  const [printedAt] = useState(() => Date.now());

  // the browser dialog needs the sheet mounted for a tick before it opens
  useEffect(() => {
    const id = window.setTimeout(() => {
      window.print();
      onPrinted();
    }, 60);
    return () => window.clearTimeout(id);
  }, [onPrinted]);

  // workflow order first, anything custom after, then alphabetical
  const order = [...projectStatuses, "In production"];
  const rank = (status: string) => {
    const index = order.indexOf(status);
    return index === -1 ? order.length : index;
  };
  const sections = [...rows.reduce((map, row) => {
    const list = map.get(row.status) ?? [];
    list.push(row);
    map.set(row.status, list);
    return map;
  }, new Map<string, PrintRow[]>())]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
    .map(([status, list]) => ({
      status,
      list,
      cost: list.reduce((sum, row) => sum + row.cost, 0),
      total: list.reduce((sum, row) => sum + row.total, 0),
    }));

  const title =
    tab === "projects"
      ? "Project list"
      : tab === "jobs"
        ? "Job list"
        : tab === "products"
          ? "Product list"
          : tab === "vendors"
            ? "Vendor list"
            : "Customer list";
  const nameHead =
    tab === "projects" ? "Project" : tab === "jobs" ? "Job" : tab === "products" ? "Product" : tab === "vendors" ? "Vendor" : "Customer";
  const secondHead =
    tab === "jobs" ? "Project" : tab === "projects" ? "Client" : tab === "products" ? "Project" : "Contact";
  const thirdHead = tab === "products" ? "Unit" : "Items";

  return createPortal(
    <div className="print-sheet hidden bg-white p-6 text-black">
      <header className="mb-4 flex items-end justify-between border-b-2 border-slate-900 pb-2">
        <div>
          <h1 className="font-display text-xl font-bold text-slate-900">
            Slate · {title}
          </h1>
          <p className="text-[11px] text-slate-600">
            {rows.length} row{rows.length === 1 ? "" : "s"}
            {filterLabel ? ` · ${filterLabel}` : ""}
            {search.trim() ? ` · matching “${search.trim()}”` : ""}
          </p>
        </div>
        <p className="text-right text-[11px] text-slate-600">
          Printed {formatDueLabel(printedAt)}
          <br />
          Grouped by status
          <br />
          All amounts in {currencyCode}
        </p>
      </header>

      {sections.length === 0 ? (
        <p className="text-sm text-slate-600">Nothing to print for this filter.</p>
      ) : (
        sections.map(({ status, list, cost, total }) => (
          <section key={status} className="mb-4 break-inside-avoid">
            <h2 className="mb-1.5 border-b border-slate-300 pb-1 text-[12px] font-bold tracking-widest text-slate-700 uppercase">
              {status}
              <span className="ml-2 font-normal text-slate-500">({list.length})</span>
            </h2>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-300 text-slate-600">
                  <th className="py-1 text-left font-semibold">{nameHead}</th>
                  <th className="py-1 text-left font-semibold">Code</th>
                  <th className="py-1 text-left font-semibold">{secondHead}</th>
                  <th className="py-1 text-right font-semibold">{thirdHead}</th>
                  <th className="py-1 text-right font-semibold">Cost</th>
                  <th className="py-1 text-right font-semibold">Sales price</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.id} className="border-b border-slate-200">
                    <td className="py-1 font-medium text-slate-900">{row.name}</td>
                    <td className="py-1 font-mono text-slate-600">{row.code ?? "—"}</td>
                    <td className="py-1 text-slate-700">{row.secondary || "—"}</td>
                    <td className="py-1 text-right tabular-nums text-slate-700">
                      {row.tertiary}
                    </td>
                    <td className="py-1 text-right tabular-nums text-slate-700">
                      {money(row.cost)}
                    </td>
                    <td className="py-1 text-right font-medium tabular-nums text-slate-900">
                      {money(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-400 font-semibold">
                  <td colSpan={4} className="py-1 text-right text-slate-700">
                    {status} subtotal
                  </td>
                  <td className="py-1 text-right tabular-nums text-slate-700">
                    {money(cost)}
                  </td>
                  <td className="py-1 text-right tabular-nums text-slate-900">
                    {money(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        ))
      )}

      <footer className="mt-6 flex justify-between border-t border-slate-300 pt-2 text-[11px] text-slate-600">
        <span>Slate — Projects</span>
        <span>
          Total cost {money(sections.reduce((s, x) => s + x.cost, 0))} · Sales{" "}
          {money(sections.reduce((s, x) => s + x.total, 0))}
        </span>
      </footer>
    </div>,
    document.body,
  );
}
