import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { NoteColor } from "@/convex/schema";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Notebook,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";

type NotebookId = Id<"notebooks">;
type PageId = Id<"notePages">;

const ACCENT_DOT_CLASS: Record<NoteColor, string> = {
  default: "bg-muted-foreground/60",
  indigo: "bg-indigo-500",
  violet: "bg-violet-500",
  sky: "bg-sky-500",
  teal: "bg-teal-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  orange: "bg-orange-500",
  rose: "bg-rose-500",
  pink: "bg-pink-500",
};

/**
 * VS Code explorer-style tree in the side menu:
 *   ▾ 📓 Notebook
 *     ▾ 📄 Page
 *         📄 sub-page
 * Chevrons expand/collapse independently of selection.
 */
export default function NotesSidebar({
  notebooks,
  allPages,
  loading,
  activeNotebookId,
  activePageId,
  onSelectNotebook,
  onSelectPage,
  onNewNotebook,
  onNewPage,
  onNewSubPage,
  onRenameNotebook,
  onRenamePage,
  onDeleteNotebook,
  onDeletePage,
  taskScope,
  onScopeChange,
}: {
  notebooks: Doc<"notebooks">[];
  allPages: Doc<"notePages">[] | undefined;
  loading: boolean;
  /** Mine / ALL scope filter value (shared with the tasks view). */
  taskScope: "mine" | "all";
  onScopeChange: (scope: "mine" | "all") => void;
  activeNotebookId: NotebookId | null;
  activePageId: PageId | null;
  onSelectNotebook: (id: NotebookId) => void;
  onSelectPage: (notebookId: NotebookId, pageId: PageId) => void;
  onNewNotebook?: () => void;
  onNewPage?: (notebookId: NotebookId) => void;
  onNewSubPage?: (notebookId: NotebookId, parentId: PageId) => void;
  onRenameNotebook?: (nb: Doc<"notebooks">) => void;
  onRenamePage?: (page: Doc<"notePages">) => void;
  onDeleteNotebook?: (nb: Doc<"notebooks">) => void;
  onDeletePage?: (page: Doc<"notePages">) => void;
}) {
  // Rows are open by default; this set tracks explicitly collapsed ones.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // how many people report to the signed-in user — the All filter's reach, so
  // an empty All is explainable instead of mysterious
  const myTeam = useQuery(api.settings.getMyTeam);
  const teamSize = myTeam?.teamSize ?? 0;
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const pages = allPages ?? [];
  const byNotebook = new Map<NotebookId, Doc<"notePages">[]>();
  for (const p of pages) {
    const list = byNotebook.get(p.notebookId) ?? [];
    list.push(p);
    byNotebook.set(p.notebookId, list);
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Notebooks
        </span>
        {onNewNotebook && (
          <button
            type="button"
            aria-label="New notebook"
            title="New notebook"
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onNewNotebook}
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      {/* Mine / ALL scope filter ("mine" is the default) */}
      <div className="flex items-center gap-1 px-2 pb-1.5 text-xs text-muted-foreground">
        <span className="mr-0.5">Show</span>
        {(
          [
            ["mine", "Mine"],
            ["all", "ALL"],
          ] as ["mine" | "all", string][]
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => onScopeChange(mode)}
            className={cn(
              "rounded-full border px-2 py-0.5 transition-colors",
              taskScope === mode
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border bg-card hover:bg-accent hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {taskScope === "all" && (
        <p className="px-2 pb-1.5 text-[10px] leading-tight text-muted-foreground">
          {teamSize > 0
            ? `Also showing notes from ${teamSize} ${
                teamSize === 1 ? "person" : "people"
              } who report${teamSize === 1 ? "s" : ""} to you.`
            : "Nobody reports to you yet — set a manager in Settings → Team hierarchy to see their notes here."}
        </p>
      )}

      {loading && (
        <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading…
        </div>
      )}

      {notebooks.map((nb) => {
        const nbPages = byNotebook.get(nb._id) ?? [];
        const topLevel = nbPages.filter((p) => !p.parentId);
        const isOpen = activeNotebookId === nb._id;
        const nbKey = `nb:${nb._id}`;
        const nbOpen = isOpen && !collapsed.has(nbKey);
        return (
          <div key={nb._id}>
            {/* notebook row (folder) */}
            <div
              className={cn(
                "group/nb flex items-center gap-1 rounded-lg pr-1 transition-colors",
                isOpen ? "bg-primary/10" : "hover:bg-accent",
              )}
            >
              <button
                type="button"
                aria-label={`Toggle “${nb.title}”`}
                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
                onClick={() => toggle(nbKey)}
              >
                {nbOpen ? (
                  <ChevronDown className="size-3.5" />
                ) : (
                  <ChevronRight className="size-3.5" />
                )}
              </button>
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 text-left"
                onClick={() => onSelectNotebook(nb._id)}
              >
                <Notebook
                  className={cn(
                    "size-4 shrink-0",
                    isOpen ? "text-primary" : "text-amber-500/80",
                  )}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    isOpen ? "font-medium text-primary" : "text-foreground/85",
                  )}
                >
                  {nb.title}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground/60">
                  {nbPages.length}
                </span>
              </button>
              <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within/nb:opacity-100 group-hover/nb:opacity-100">
                {onNewPage && (
                  <button
                    type="button"
                    aria-label={`New page in “${nb.title}”`}
                    title="New page"
                    className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground group-hover/nb:grid"
                    onClick={() => onNewPage(nb._id)}
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
                {onRenameNotebook && (
                  <button
                    type="button"
                    aria-label={`Rename notebook “${nb.title}”`}
                    title="Rename notebook"
                    className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground group-hover/nb:grid"
                    onClick={() => onRenameNotebook(nb)}
                  >
                    <Pencil className="size-3" />
                  </button>
                )}
                {onDeleteNotebook && (
                  <button
                    type="button"
                    aria-label={`Delete notebook “${nb.title}”`}
                    title="Delete notebook"
                    className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-destructive group-hover/nb:grid"
                    onClick={() => onDeleteNotebook(nb)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </span>
            </div>

            {/* pages (children) — shown when the notebook is expanded */}
            {nbOpen && (
              <div className="ml-4 border-l border-border/50 pl-1">
                {topLevel.map((page) => {
                  const subPages = nbPages.filter((p) => p.parentId === page._id);
                  const pageActive = activePageId === page._id;
                  const pgKey = `pg:${page._id}`;
                  // open when active (so drilling in reveals the tree),
                  // unless the user explicitly collapsed it
                  const pgOpen =
                    !collapsed.has(pgKey) &&
                    (pageActive || subPages.some((p) => p._id === activePageId));
                  return (
                    <div key={page._id}>
                      {/* page row */}
                      <div
                        className={cn(
                          "group/pg flex items-center gap-1 rounded-lg pr-1 transition-colors",
                          pageActive ? "bg-primary/10" : "hover:bg-accent",
                        )}
                      >
                        {subPages.length > 0 ? (
                          <button
                            type="button"
                            aria-label={`Toggle “${page.title}” sub-pages`}
                            className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/70 hover:text-foreground"
                            onClick={() => toggle(pgKey)}
                          >
                            {pgOpen ? (
                              <ChevronDown className="size-3" />
                            ) : (
                              <ChevronRight className="size-3" />
                            )}
                          </button>
                        ) : (
                          <span className="w-5 shrink-0" />
                        )}
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 text-left"
                          onClick={() => onSelectPage(nb._id, page._id)}
                        >
                          <span
                            className={cn(
                              "size-2 shrink-0 rounded-full",
                              ACCENT_DOT_CLASS[page.color ?? "default"],
                            )}
                            aria-hidden
                          />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate text-[13px]",
                              pageActive
                                ? "font-medium text-primary"
                                : "text-muted-foreground",
                            )}
                          >
                            {page.title}
                          </span>
                        </button>
                        <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within/pg:opacity-100 group-hover/pg:opacity-100">
                          {onNewSubPage && (
                            <button
                              type="button"
                              aria-label={`New sub-page under “${page.title}”`}
                              title="New sub-page"
                              className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground group-hover/pg:grid"
                              onClick={() => onNewSubPage(nb._id, page._id)}
                            >
                              <Plus className="size-3" />
                            </button>
                          )}
                          {onRenamePage && (
                            <button
                              type="button"
                              aria-label={`Rename page “${page.title}”`}
                              title="Rename page"
                              className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground group-hover/pg:grid"
                              onClick={() => onRenamePage(page)}
                            >
                              <Pencil className="size-3" />
                            </button>
                          )}
                          {onDeletePage && (
                            <button
                              type="button"
                              aria-label={`Delete page “${page.title}”`}
                              title="Delete page"
                              className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-destructive group-hover/pg:grid"
                              onClick={() => onDeletePage(page)}
                            >
                              <Trash2 className="size-3" />
                            </button>
                          )}
                        </span>
                      </div>

                      {/* sub-pages (grandchildren, doubly indented) */}
                      {pgOpen &&
                        subPages.map((sp) => {
                          const spActive = activePageId === sp._id;
                          return (
                            <div
                              key={sp._id}
                              className={cn(
                                "group/sp flex items-center gap-1 rounded-lg pr-1 transition-colors",
                                spActive ? "bg-primary/10" : "hover:bg-accent",
                              )}
                            >
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-7 pr-2 text-left"
                                onClick={() => onSelectPage(nb._id, sp._id)}
                              >
                                <FileText
                                  className={cn(
                                    "size-3 shrink-0",
                                    spActive ? "text-primary" : "text-muted-foreground/60",
                                  )}
                                />
                                <span
                                  className={cn(
                                    "min-w-0 flex-1 truncate text-xs",
                                    spActive
                                      ? "font-medium text-primary"
                                      : "text-muted-foreground/80",
                                  )}
                                >
                                  {sp.title}
                                </span>
                              </button>
                              <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within/sp:opacity-100 group-hover/sp:opacity-100">
                                {onRenamePage && (
                                  <button
                                    type="button"
                                    aria-label={`Rename sub-page “${sp.title}”`}
                                    title="Rename sub-page"
                                    className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground group-hover/sp:grid"
                                    onClick={() => onRenamePage(sp)}
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                )}
                                {onDeletePage && (
                                  <button
                                    type="button"
                                    aria-label={`Delete sub-page “${sp.title}”`}
                                    title="Delete sub-page"
                                    className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-destructive group-hover/sp:grid"
                                    onClick={() => onDeletePage(sp)}
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                )}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
                {/* add page inline */}
                {onNewPage && (
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-lg py-1.5 pl-6 pr-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => onNewPage(nb._id)}
                  >
                    <Plus className="size-3.5" />
                    Add page
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {notebooks.length === 0 && !loading && (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No notebooks yet — create one to begin.
        </p>
      )}
    </div>
  );
}
