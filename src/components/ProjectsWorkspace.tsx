import { Loader2 } from "lucide-react";
import {
  BarChart3,
  Columns3,
  Flag,
  List,
  ListTree,
  Printer,
  Settings2,
} from "lucide-react";
import ProductPrintSheet from "@/components/ProductPrintSheet";
import ProductDetailPanel from "@/components/ProductDetailPanel";
import ProjectStatusSettings from "@/components/ProjectStatusSettings";
import {
  JobFlatList,
  ProjectHierarchy,
  VIEWS_BY_FILTER,
  resolveView,
  type WorkspaceView,
} from "@/components/FlaggedViews";
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
  view,
  onViewChange,
  onPrint,
  printing,
  sortMode,
  selection,
  onSelect,
  busyKey,
  onToggleFg,
  onToggleJob,
  canEdit = true,
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
  view: WorkspaceView;
  onViewChange: (next: WorkspaceView) => void;
  onPrint: () => void;
  printing: boolean;
  sortMode: SortMode;
  selection: FlaggedSel;
  onSelect: (sel: FlaggedSel) => void;
  busyKey: string | null;
  onToggleFg: (fg: FgDoc) => void;
  onToggleJob: (job: JobDoc) => void;
  /** False for viewers — the product's task features then read-only. */
  canEdit?: boolean;
}) {
  // The chosen view is only meaningful for the level it belongs to, so a view
  // carried over from another filter falls back to that filter's default.
  const activeView = resolveView(filter, view);
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
            {VIEWS_BY_FILTER[filter]?.map((entry) => {
              const Icon =
                entry.icon === "tree"
                  ? ListTree
                  : entry.icon === "board"
                    ? Columns3
                    : entry.icon === "report"
                      ? BarChart3
                      : List;
              return (
                <button
                  key={entry.view}
                  type="button"
                  aria-pressed={activeView === entry.view}
                  onClick={() => onViewChange(entry.view)}
                  className={cn(
                    "grid size-7 place-items-center rounded-md border transition-colors",
                    activeView === entry.view
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title={entry.label}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
            {filter === "products" && (
              <button
                type="button"
                onClick={onPrint}
                className="grid size-7 place-items-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Print products"
              >
                <Printer className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        {projects === undefined ? (
          <div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading projects…
          </div>
        ) : filter === "projects" ? (
          activeView === "hierarchy" ? (
            <ProjectHierarchy
              projects={projects}
              jobs={jobs ?? []}
              fgs={fgs ?? []}
              projectStatuses={projectStatuses}
              statusFilter={status}
              sortMode={sortMode}
              selection={selection}
              onSelect={onSelect}
              busyKey={busyKey}
              onToggleJob={onToggleJob}
              onToggleFg={onToggleFg}
            />
          ) : (
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
          )
        ) : items === null ? (
          <div className="px-6 py-14 text-center">
            <Flag className="mx-auto size-8 text-amber-500/40" />
            <p className="mt-3 font-medium">Nothing flagged</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Flag a job or product in the Projects page and it will show up here.
            </p>
          </div>
        ) : filter === "products" ? (
          activeView === "report" ? (
            <ProductionReport
              data={items}
              allJobs={jobs ?? []}
              projectStatuses={projectStatuses}
            />
          ) : activeView === "board" ? (
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
        ) : activeView === "hierarchy" ? (
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
        ) : (
          <JobFlatList
            data={items}
            allJobs={jobs ?? []}
            allFgs={fgs ?? []}
            projectStatuses={projectStatuses}
            statusFilter={status}
            sortMode={sortMode}
            selection={selection}
            onSelect={onSelect}
            busyKey={busyKey}
            onToggleJob={onToggleJob}
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
          {/* a product gets one card with every field on its own line, the
              same shape as the task detail panel */}
          {selection.kind === "fg" ? (
            (() => {
              const selected = fgs.find((f) => f._id === selection.id);
              return selected !== undefined ? (
                <ProductDetailPanel
                  fg={selected}
                  jobs={jobs}
                  projects={projects ?? []}
                  onClose={() => onSelect(null)}
                  canEdit={canEdit}
                />
              ) : (
                <FlaggedDetail
                  selection={selection}
                  jobs={jobs}
                  fgs={fgs}
                  projects={projects ?? []}
                  onClose={() => onSelect(null)}
                  onSelect={onSelect}
                />
              );
            })()
          ) : (
            <FlaggedDetail
              selection={selection}
              jobs={jobs}
              fgs={fgs}
              projects={projects ?? []}
              onClose={() => onSelect(null)}
              onSelect={onSelect}
            />
          )}
        </div>
      )}
    </div>
  );
}
