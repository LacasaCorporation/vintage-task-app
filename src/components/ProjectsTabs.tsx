import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  Briefcase,
  Package,
  Pencil,
  Sigma,
  Trash2,
} from "lucide-react";
import { useMemo } from "react";
import { ProductionButton } from "@/components/FlaggedLists";
import type { FilterOption } from "@/components/FilterMenu";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";
import { batchCost } from "@/lib/product-cost";

/** What the product list is narrowed down to. */
export type ProductFilter =
  | "all"
  | "flagged"
  | "in-production"
  | "finished"
  | "unflagged";

/** Filter choices offered on the product list. */
export const PRODUCT_FILTERS: readonly FilterOption<ProductFilter>[] = [
  { value: "all", label: "All items", hint: "Every product" },
  { value: "flagged", label: "Flagged", hint: "On the Projects board" },
  { value: "in-production", label: "In production", hint: "Materials out of stock" },
  { value: "finished", label: "Finished", hint: "Completed products" },
  { value: "unflagged", label: "Not flagged", hint: "Everything still to plan" },
];

/** What the job list is narrowed down to. */
export type JobFilter = "all" | "flagged" | "active" | "completed";

/** Filter choices offered on the job list. */
export const JOB_FILTERS: readonly FilterOption<JobFilter>[] = [
  { value: "all", label: "All items", hint: "Every job" },
  { value: "flagged", label: "Flagged", hint: "On the Projects board" },
  { value: "active", label: "Active", hint: "Not finished yet" },
  { value: "completed", label: "Completed", hint: "Already done" },
];

/** Does this filter keep the given product? */
export function keepsProduct(fg: FgDoc, filter: ProductFilter): boolean {
  switch (filter) {
    case "flagged":
      return fg.isFlagged === true;
    case "unflagged":
      return fg.isFlagged !== true;
    case "in-production":
      return fg.productionStartedAt !== undefined;
    case "finished":
      return fg.isCompleted === true;
    default:
      return true;
  }
}

/** Does this filter keep the given job? */
export function keepsJob(job: JobDoc, filter: JobFilter): boolean {
  switch (filter) {
    case "flagged":
      return job.isFlagged === true;
    case "active":
      return job.status !== "completed" && job.status !== "cancelled";
    case "completed":
      return job.status === "completed";
    default:
      return true;
  }
}

type FgDoc = Doc<"finishedGoods">;
type JobDoc = Doc<"projectJobs">;
type ProjectDoc = Doc<"projects">;

/** Shared list header. Search and filtering live in the tab bar above. */
function ListHeader({
  title,
  count,
  countLabel,
  right,
}: {
  title: string;
  count: number;
  countLabel: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
      <p className="text-sm font-semibold">
        {title}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          {count} {countLabel}
        </span>
      </p>
      {right}
    </div>
  );
}

/**
 * Jobs tab: one flat row per job with the project it belongs to and the cost
 * and sales value of the products under it, so jobs can be compared without
 * expanding every project first.
 */
export function JobsList({
  jobs,
  projects,
  finishedGoods,
  costByFg,
  search,
  filter,
  onOpenProject,
  onEditJob,
  onDeleteJob,
}: {
  jobs: JobDoc[];
  projects: ProjectDoc[] | undefined;
  finishedGoods: FgDoc[];
  costByFg: Map<Id<"finishedGoods">, number>;
  search: string;
  filter: JobFilter;
  onOpenProject?: (projectName: string) => void;
  onEditJob?: (job: JobDoc, projectName: string) => void;
  /** The parent refuses the delete while products are still linked. */
  onDeleteJob?: (job: JobDoc, productCount: number) => void;
}) {
  const { format: money } = useWorkspaceCurrency();
  const rows = useMemo(() => {
    const projectNameOf = (job: JobDoc) =>
      projects?.find((p) => p._id === job.projectId)?.name ?? "Unassigned";
    return jobs.map((job) => {
      const products = finishedGoods.filter(
        (f) => f.jobId === job._id || (f.jobIds ?? []).includes(job._id),
      );
      let cost = 0;
      let total = 0;
      for (const fg of products) {
        const c = batchCost(costByFg.get(fg._id) ?? 0, fg);
        cost += c;
        // a job's value is what its products cost to make; margin is not added
        total += c;
      }
      return { job, projectName: projectNameOf(job), products, cost, total };
    });
  }, [jobs, projects, finishedGoods, costByFg]);

  const filtered = useMemo(() => {
    const list = rows.filter((row) => keepsJob(row.job, filter));
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (row) =>
        row.job.name.toLowerCase().includes(q) ||
        row.projectName.toLowerCase().includes(q) ||
        (row.job.code ?? "").toLowerCase().includes(q),
    );
  }, [rows, search, filter]);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <ListHeader
        title="Job list"
        count={filtered.length}
        countLabel={filtered.length === 1 ? "job" : "jobs"}
        right={
          <span className="text-xs tabular-nums text-muted-foreground">
            {money(filtered.reduce((s, r) => s + r.total, 0))} production cost
          </span>
        }
      />
      {filtered.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          {search
            ? `Nothing matches “${search}”.`
            : "No jobs yet — add one from a project above."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-2 text-left font-medium">Job</th>
                <th className="px-3 py-2 text-left font-medium">Project</th>
                <th className="px-3 py-2 text-right font-medium">Products</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Sales price</th>
                {(onEditJob || onDeleteJob) && <th className="w-16 px-2 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map(({ job, projectName, products, cost, total }) => (
                <tr key={job._id} className="group/job transition-colors hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <Briefcase className="size-3.5 shrink-0 text-sky-500/80" />
                      <span className="font-medium">{job.name}</span>
                      {job.code && (
                        <span className="font-mono text-[10px] text-muted-foreground/70">
                          {job.code}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {onOpenProject ? (
                      <button
                        type="button"
                        onClick={() => onOpenProject(projectName)}
                        className="truncate text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {projectName}
                      </button>
                    ) : (
                      <span className="truncate text-muted-foreground">{projectName}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                    {products.length}
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                    {money(cost)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                    {money(total)}
                  </td>
                  {(onEditJob || onDeleteJob) && (
                    <td className="px-2 py-1 text-right">
                      <span className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/job:opacity-100">
                        {onEditJob && (
                          <button
                            type="button"
                            aria-label={`Edit job “${job.name}”`}
                            title="Edit job"
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-primary"
                            onClick={() => onEditJob(job, projectName)}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        {onDeleteJob && (
                          <button
                            type="button"
                            aria-label={`Delete job “${job.name}”`}
                            title={
                              products.length > 0
                                ? `Has ${products.length} product${products.length === 1 ? "" : "s"} — delete those first`
                                : "Delete job"
                            }
                            className={cn(
                              "grid size-6 place-items-center rounded-md hover:bg-accent",
                              products.length > 0
                                ? "cursor-not-allowed text-muted-foreground/40"
                                : "text-muted-foreground hover:text-destructive",
                            )}
                            onClick={() => onDeleteJob(job, products.length)}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Products tab: every product across every project and job, with its cost,
 * sales price and production state, so the whole catalogue can be sorted
 * through in one place.
 */
export function ProductsList({
  finishedGoods,
  costByFg,
  search,
  filter,
  onOpenProduct,
}: {
  finishedGoods: FgDoc[];
  costByFg: Map<Id<"finishedGoods">, number>;
  search: string;
  filter: ProductFilter;
  onOpenProduct?: (fgId: Id<"finishedGoods">) => void;
}) {
  const { format: money } = useWorkspaceCurrency();
  const rows = useMemo(
    () =>
      finishedGoods.map((fg) => {
        const cost = batchCost(costByFg.get(fg._id) ?? 0, fg);
        return {
          fg,
          cost,
          total: cost * (1 + (fg.markupPct ?? 0) / 100),
        };
      }),
    [finishedGoods, costByFg],
  );

  const filtered = useMemo(() => {
    const list = rows.filter((row) => keepsProduct(row.fg, filter));
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (row) =>
        row.fg.name.toLowerCase().includes(q) ||
        (row.fg.code ?? "").toLowerCase().includes(q) ||
        (row.fg.projectName ?? "").toLowerCase().includes(q) ||
        (row.fg.category ?? "").toLowerCase().includes(q),
    );
  }, [rows, search, filter]);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <ListHeader
        title="Product list"
        count={filtered.length}
        countLabel={filtered.length === 1 ? "product" : "products"}
        right={
          <span className="text-xs tabular-nums text-muted-foreground">
            {money(filtered.reduce((s, r) => s + r.total, 0))} total
          </span>
        }
      />
      {filtered.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          {search
            ? `Nothing matches “${search}”.`
            : "No products yet — add one from a project above."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-2 text-left font-medium">Product</th>
                <th className="px-3 py-2 text-left font-medium">Project</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Sales price</th>
                <th className="w-8 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map(({ fg, cost, total }) => (
                <tr key={fg._id} className="transition-colors hover:bg-accent/40">
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <Package className="size-3.5 shrink-0 text-sky-500/80" />
                      {onOpenProduct ? (
                        <button
                          type="button"
                          onClick={() => onOpenProduct(fg._id)}
                          className="min-w-0 cursor-pointer truncate text-left font-medium hover:underline"
                        >
                          {fg.name}
                        </button>
                      ) : (
                        <span className="min-w-0 truncate font-medium">{fg.name}</span>
                      )}
                      {fg.code && (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                          {fg.code}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <span className="truncate text-muted-foreground">
                      {fg.projectName || "Standalone"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                    {money(cost)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                    {money(total)}
                  </td>
                  <td className="px-2 py-2 text-right align-middle">
                    <span className="flex justify-end">
                      <ProductionButton fg={fg} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/60 text-sm font-semibold">
                <td className="px-4 py-2" colSpan={2}>
                  <span className="flex items-center gap-1.5">
                    <Sigma className="size-3.5 text-muted-foreground/50" />
                    Total
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                  {money(filtered.reduce((s, r) => s + r.cost, 0))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(filtered.reduce((s, r) => s + r.total, 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
