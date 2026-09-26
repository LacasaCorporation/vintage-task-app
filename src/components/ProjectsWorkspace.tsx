import { Loader2 } from "lucide-react";
import { BarChart3, Columns3, Flag, List, Printer, Settings2 } from "lucide-react";
import ProductPrintSheet from "@/components/ProductPrintSheet";
import ProjectStatusSettings from "@/components/ProjectStatusSettings";
import {
  FlaggedBoard,
  FlaggedDetail,
  FlaggedItemsList,
  FlaggedProductsList,
  FlaggedProjectsList,
  ProductionReport,
  type FlagFilter,
  type FlagStatusFilter,
  type FlaggedData,
  type FlaggedSel,
  type FgDoc,
  type JobDoc,
  type SortMode,
} from "@/components/FlaggedLists";
import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

/**
 * The Projects workspace: the Projects / Jobs / Products filter, the status
 * chips and custom-status editor, the list / board / report / print toggles,
 * and the detail pane for the selected project, job or product.
 */
export default function ProjectsWorkspace({
  projects,
  jobs,
  fgs,
  items,
  filter,
  onFilterChange,
  status,
  onStatusChange,
  projectStatuses,
  statusDraft,
  onStatusDraft,
  statusSettingsOpen,
  onToggleStatusSettings,
  onSaveStatuses,
  boardMode,
  onBoardModeChange,
  reportMode,
  onReportModeChange,
  onPrint,
  printing,
  sortMode,
  selection,
  onSelect,
  busyKey,
  onToggleFg,
  onToggleJob,
}: {
  projects: Doc<"projects">[] | undefined;
  jobs: JobDoc[] | undefined;
  fgs: FgDoc[] | undefined;
  items: FlaggedData | null;
  filter: FlagFilter;
  onFilterChange: (next: FlagFilter) => void;
  status: FlagStatusFilter;
  onStatusChange: (next: FlagStatusFilter) => void;
  projectStatuses: string[];
  statusDraft: string[] | null;
  onStatusDraft: (next: string[]) => void;
  statusSettingsOpen: boolean;
  onToggleStatusSettings: () => void;
  onSaveStatuses: () => void;
  boardMode: boolean;
  onBoardModeChange: (next: boolean) => void;
  reportMode: boolean;
  onReportModeChange: (next: boolean) => void;
  onPrint: () => void;
  printing: boolean;
  sortMode: SortMode;
  selection: FlaggedSel;
  onSelect: (sel: FlaggedSel) => void;
  busyKey: string | null;
  onToggleFg: (fg: FgDoc) => void;
  onToggleJob: (job: JobDoc) => void;
}) {
  return (
    <div className="grid items-start lg:grid-cols-[1fr_auto]">
      <section className="mt-3 overflow-hidden rounded-2xl border bg-card shadow-sm">
        {/* filter bar: scope, status, and list/board presentation */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span className="mr-1">Show</span>
            {(
              [
                ["projects", "Projects"],
                ["jobs", "Jobs"],
                ["products", "Products"],
              ] as [FlagFilter, string][]
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                aria-pressed={filter === mode}
                onClick={() => onFilterChange(mode)}
                className={cn(
                  "rounded-full border px-2.5 py-1 whitespace-nowrap transition-colors",
                  filter === mode
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-border" />
            <button
              type="button"
              onClick={() => onStatusChange("all")}
              className={cn(
                "rounded-full border px-2.5 py-1 transition-colors",
                status === "all"
                  ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                  : "border-border bg-card hover:bg-accent hover:text-foreground",
              )}
            >
              Any status
            </button>
            {projectStatuses.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => onStatusChange(entry)}
                className={cn(
                  "rounded-full border px-2.5 py-1 transition-colors",
                  status === entry
                    ? "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400"
                    : "border-border bg-card hover:bg-accent hover:text-foreground",
                )}
              >
                {entry}
              </button>
            ))}
            <button
              type="button"
              onClick={onToggleStatusSettings}
              className="ml-1 inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2.5 py-1 text-primary transition-colors hover:bg-primary/10"
              title="Customize Projects statuses"
            >
              <Settings2 className="size-3" /> Custom status
            </button>
          </div>
          {statusSettingsOpen && statusDraft !== null && (
            <ProjectStatusSettings
              value={statusDraft}
              onChange={onStatusDraft}
              onClose={onToggleStatusSettings}
              onSave={onSaveStatuses}
            />
          )}
          <div className="flex items-center gap-1">
            {filter === "products" && (
              <>
                <button
                  type="button"
                  onClick={() => onBoardModeChange(false)}
                  aria-pressed={!boardMode && !reportMode}
                  className={cn(
                    "grid size-7 place-items-center rounded-md border transition-colors",
                    !boardMode && !reportMode
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title="List view"
                >
                  <List className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onBoardModeChange(true)}
                  aria-pressed={boardMode}
                  className={cn(
                    "grid size-7 place-items-center rounded-md border transition-colors",
                    boardMode
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title="Board view"
                >
                  <Columns3 className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onReportModeChange(!reportMode)}
                  aria-pressed={reportMode}
                  className={cn(
                    "grid size-7 place-items-center rounded-md border transition-colors",
                    reportMode
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title="Production report"
                >
                  <BarChart3 className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onPrint}
                  className="grid size-7 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Print products"
                >
                  <Printer className="size-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
        {projects === undefined ? (
          <div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading projects…
          </div>
        ) : filter === "projects" ? (
          <FlaggedProjectsList
            projects={projects}
            jobs={jobs ?? []}
            fgs={fgs ?? []}
            statusFilter={status}
            projectStatuses={projectStatuses}
            sortMode={sortMode}
            selection={selection}
            onSelect={onSelect}
          />
        ) : items === null ? (
          <div className="px-6 py-14 text-center">
            <Flag className="mx-auto size-8 text-amber-500/40" />
            <p className="mt-3 font-medium">Nothing flagged</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Flag a job or product in the Projects page and it will show up here.
            </p>
          </div>
        ) : filter === "products" ? (
          reportMode ? (
            <ProductionReport
              data={items}
              allJobs={jobs ?? []}
              projectStatuses={projectStatuses}
            />
          ) : boardMode ? (
            <div className="p-3">
              <FlaggedBoard
                data={items}
                allJobs={jobs ?? []}
                statusFilter={status}
                onToggleFg={onToggleFg}
                busyKey={busyKey}
                projectNameOf={items.projectNameOf}
                onOpenFg={(fg) => onSelect({ kind: "fg", id: fg._id })}
              />
            </div>
          ) : (
            <FlaggedProductsList
              data={items}
              allJobs={jobs ?? []}
              statusFilter={status}
              onToggleFg={onToggleFg}
              busyKey={busyKey}
              sortMode={sortMode}
              selection={selection}
              onSelect={onSelect}
            />
          )
        ) : (
          <FlaggedItemsList
            data={items}
            allJobs={jobs ?? []}
            allFgs={fgs ?? []}
            statusFilter={status}
            jobsOnly
            onToggleFg={onToggleFg}
            onToggleJob={onToggleJob}
            busyKey={busyKey}
            sortMode={sortMode}
            selection={selection}
            onSelect={onSelect}
          />
        )}
        {printing && items !== null && (
          <ProductPrintSheet
            data={items}
            allJobs={jobs ?? []}
            projectStatuses={projectStatuses}
            statusFilter={status}
          />
        )}
      </section>
      {selection && jobs !== undefined && fgs !== undefined && (
        <div className="mt-3">
          <FlaggedDetail
            selection={selection}
            jobs={jobs}
            fgs={fgs}
            projects={projects ?? []}
            onClose={() => onSelect(null)}
            onSelect={onSelect}
          />
        </div>
      )}
    </div>
  );
}
