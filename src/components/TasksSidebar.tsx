import type { Doc, Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  CheckSquare,
  ChevronRight,
  Folder,
  FolderInput,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

type ListId = Id<"taskLists">;

/** null = All tasks; "mine" / "starred" / "flagged" are smart views; otherwise a list id. */
export type ActiveTaskView = ListId | "mine" | "starred" | "flagged" | null;

/**
 * Sidebar: folders and task lists — shown while Tasks is active.
 *
 * The smart views (All tasks / Today / Starred / Productions) used to live
 * here. They are filters over the whole list rather than somewhere to file
 * something, so they now sit on the Tasks page itself, next to Show and Sort.
 */
export default function TasksSidebar({
  lists,
  folders,
  loading,
  activeView,
  onSelectView,
  onNewList,
  onRenameList,
  onDeleteList,
  onMoveListToFolder,
  onNewFolder,
  onDeleteFolder,
}: {
  lists: Doc<"taskLists">[];
  folders: Doc<"taskFolders">[];
  loading: boolean;
  activeView: ActiveTaskView;
  onSelectView: (view: ActiveTaskView) => void;
  onNewList?: () => void;
  onRenameList?: (list: Doc<"taskLists">) => void;
  onDeleteList?: (list: Doc<"taskLists">) => void;
  onMoveListToFolder: (list: Doc<"taskLists">) => void;
  onNewFolder?: () => void;
  onDeleteFolder?: (folder: Doc<"taskFolders">) => void;
}) {
  const unfoldered = lists.filter((l) => !l.folderId);

  const renderListRow = (list: Doc<"taskLists">) => {
    const active = activeView === list._id;
    return (
      <div
        key={list._id}
        className={cn(
          "group/tl flex items-center gap-1 rounded-lg pr-1 transition-colors",
          active ? "bg-primary/10" : "hover:bg-accent",
        )}
      >
        <button
          type="button"
          onClick={() => onSelectView(list._id)}
          aria-current={active ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 pr-2 text-left"
        >
          <CheckSquare
            className={cn(
              "size-4 shrink-0",
              active ? "text-primary" : "text-muted-foreground/70",
            )}
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              active ? "font-medium text-primary" : "text-foreground/85",
            )}
          >
            {list.name}
          </span>
        </button>
        <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-focus-within/tl:opacity-100 group-hover/tl:opacity-100">
          <button
            type="button"
            aria-label={`Move list “${list.name}” to a folder`}
            title="Move to folder"
            className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground group-hover/tl:grid"
            onClick={() => onMoveListToFolder(list)}
          >
            <FolderInput className="size-3.5" />
          </button>
          {onRenameList && (
            <button
              type="button"
              aria-label={`Rename list “${list.name}”`}
              title="Rename list"
              className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-foreground group-hover/tl:grid"
              onClick={() => onRenameList(list)}
            >
              <Pencil className="size-3" />
            </button>
          )}
          {onDeleteList && (
            <button
              type="button"
              aria-label={`Delete list “${list.name}”`}
              title="Delete list"
              className="hidden size-6 place-items-center rounded-md text-muted-foreground hover:text-destructive group-hover/tl:grid"
              onClick={() => onDeleteList(list)}
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Lists
        </span>
        {onNewList && (
          <button
            type="button"
            aria-label="New list"
            title="New list"
            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={onNewList}
          >
            <Plus className="size-3.5" />
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Loading…
        </div>
      )}

      {/* folders + their lists */}
      {folders.length > 0 && (
        <div className="mt-2">
          {folders.map((folder) => {
            const folderLists = lists.filter((l) => l.folderId === folder._id);
            return (
              <div key={folder._id} className="mb-1">
                <div className="group/fd flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-accent">
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />
                  <Folder className="size-3.5 shrink-0 text-amber-500/80" />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {folder.name}
                  </span>
                  {onDeleteFolder && (
                    <button
                      type="button"
                      aria-label={`Delete folder “${folder.name}”`}
                      title="Delete folder (lists are kept)"
                      className="hidden size-5 place-items-center rounded-md text-muted-foreground hover:text-destructive group-hover/fd:grid"
                      onClick={() => onDeleteFolder(folder)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
                <div className="ml-3 border-l border-border/60 pl-1">
                  {folderLists.map(renderListRow)}
                  {folderLists.length === 0 && (
                    <p className="px-2 py-1 text-[11px] text-muted-foreground/70">
                      Empty — hover a list and use ⮂ to move it here.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* new folder */}
      {onNewFolder && (
        <button
          type="button"
          onClick={onNewFolder}
          className="mt-1 flex items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3" />
          New folder
        </button>
      )}

      {/* lists not in a folder */}
      {folders.length > 0 && unfoldered.length > 0 && (
        <p className="mt-2 px-2 text-[11px] font-semibold tracking-widest text-muted-foreground/70 uppercase">
          Other lists
        </p>
      )}
      {unfoldered.map(renderListRow)}

      {!loading && lists.length === 0 && folders.length === 0 && (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No lists yet — create one to organize tasks, or use the filters above
          to work across all of them.
        </p>
      )}
    </div>
  );
}
