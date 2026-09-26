import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { NoteColor } from "@/convex/schema";
import { Button } from "@/components/ui/button";
import EditorRibbon from "@/components/EditorRibbon";
import {
  collapseCaretOutOfFlagMark,
  currentBlockTag,
  type FormatCmd,
  type FormatState,
  formatBlock,
  formatSelection,
  RichTextEditor,
  toEditorHtml,
} from "@/components/RichTextEditor";
import {
  DrawingCanvas,
  type PenTool,
  parseStrokes,
} from "@/components/DrawingCanvas";
import {
  ImageLayer,
  parseImages,
} from "@/components/ImageLayer";
import ColorPalette, {
  PEN_PALETTE,
} from "@/components/ColorPalette";
import {
  Image as ImageIcon,
  Loader2,
  MoveUpRight,
  Pencil,
  PencilLine,
  Plus,
  StickyNote,
  Eraser,
  ListOrdered,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Decorate every flagged `<mark class="flag-mark">` in the editor body:
 * append a red flag glyph after it, and (when the matching task is completed)
 * tint the whole mark green. Matching is done on the flagged text — the same
 * string that was stored on the task when it was created.
 */
function decorateFlagMarks(root: HTMLElement | null, tasks: Doc<"tasks">[]) {
  if (!root) return;
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const completed = new Set(
    tasks.filter((t) => t.isCompleted).map((t) => normalize(t.text)),
  );
  const flagged = new Set(tasks.map((t) => normalize(t.text)));
  root.querySelectorAll("mark.flag-mark").forEach((mark) => {
    const el = mark as HTMLElement;
    // Match on the flagged text only — exclude the ⚑ indicator glyph.
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".flag-indicator").forEach((n) => n.remove());
    const text = normalize(clone.textContent ?? "");
    if (!text) return;
    // (re)append the red flag indicator — always LAST inside the mark so it
    // survives caret moves, and skipped while the user is selecting inside.
    let flag = el.querySelector<HTMLElement>(":scope > span.flag-indicator");
    if (!flag) {
      flag = document.createElement("span");
      flag.className = "flag-indicator";
      flag.contentEditable = "false";
      flag.textContent = "⚑";
      el.appendChild(flag);
    } else if (el.lastChild !== flag) {
      el.appendChild(flag);
    }
    el.classList.toggle("flag-done", completed.has(text));
    el.classList.toggle("flag-pending", flagged.has(text) && !completed.has(text));
  });
}

type PageId = Id<"notePages">;

const ACCENT_CLASS: Record<NoteColor, string> = {
  default: "note-default",
  indigo: "note-indigo",
  violet: "note-violet",
  sky: "note-sky",
  teal: "note-teal",
  emerald: "note-emerald",
  amber: "note-amber",
  orange: "note-orange",
  rose: "note-rose",
  pink: "note-pink",
};

/* ──────────────────────────────────────────────────────────────────────── */
/* Page canvas: ribbon, paper, drawing + images                             */
/* ──────────────────────────────────────────────────────────────────────── */

function PageCanvas({
  page,
  onFlagTask,
  tasks,
  canEdit = true,
  canFlag = true,
}: {
  page: Doc<"notePages">;
  onFlagTask: (text: string, pageId: PageId) => Promise<void>;
  tasks: Doc<"tasks">[];
  canEdit?: boolean;
  canFlag?: boolean;
}) {
  const updatePage = useMutation(api.notebooks.updatePage);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [title, setTitle] = useState(page.title);
  const [body, setBody] = useState(() => toEditorHtml(page.body));
  const [numbered, setNumbered] = useState(page.numbered ?? false);
  const [accent, setAccent] = useState<NoteColor>(page.color ?? "default");
  const [formatState, setFormatState] = useState<FormatState>({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    ul: false,
    ol: false,
    sub: false,
    sup: false,
  });
  const [blockTag, setBlockTag] = useState("p");
  const [savedTick, setSavedTick] = useState(0);

  const [drawMode, setDrawMode] = useState(false);
  const [penColor, setPenColor] = useState("#1e1e2e");
  const [penWidth, setPenWidth] = useState(3);
  const [penTool, setPenTool] = useState<PenTool>("pen");
  const [inkOpen, setInkOpen] = useState(false);
  const [strokes, setStrokes] = useState(() => parseStrokes(page.drawing));

  const [imageMode, setImageMode] = useState(false);
  const [images, setImages] = useState(() => parseImages(page.images));

  const scheduleSave = (patch: {
    title?: string;
    body?: string;
    drawing?: string;
    images?: string;
    numbered?: boolean;
    color?: NoteColor;
  }) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      updatePage({ id: page._id, ...patch })
        .then(() => setSavedTick((t) => t + 1))
        .catch((error: unknown) =>
          toast.error(
            error instanceof Error ? error.message : "Couldn't save changes.",
          ),
        );
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const handleBodyChange = (html: string) => {
    setBody(html);
    scheduleSave({ body: html });
  };

  // Keep flag decorations (⚑ indicator + completed green tint) in sync with
  // the note body and the live task list.
  useEffect(() => {
    decorateFlagMarks(editorRef.current, tasks);
  }, [body, tasks]);

  const applyFormat = (cmd: FormatCmd, arg?: string) => {
    formatSelection(cmd, arg);
    setTimeout(() => {
      if (editorRef.current) {
        handleBodyChange(editorRef.current.innerHTML);
      }
    }, 0);
  };

  const handleBlock = (tag: string) => {
    formatBlock(tag);
    setTimeout(() => {
      if (editorRef.current) {
        handleBodyChange(editorRef.current.innerHTML);
      }
      setBlockTag(currentBlockTag());
    }, 0);
  };

  const handleFlagSelection = async () => {
    if (!canFlag) {
      toast.error("Creating tasks isn't allowed for your role.");
      return;
    }
    const text = window.getSelection()?.toString().trim() ?? "";
    if (!text) {
      toast.error("Select some letters first, then press Flag.");
      return;
    }
    try {
      await onFlagTask(text.slice(0, 280), page._id);
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        try {
          // Extract the selected nodes and wrap them in a flag mark.
          // Unlike surroundContents this survives partial-element and
          // multi-paragraph selections, and unlike execCommand("hiliteColor")
          // it never leaves a paint style active on the caret.
          const mark = document.createElement("mark");
          mark.className = "flag-mark";
          mark.appendChild(range.extractContents());
          range.insertNode(mark);
          // Park the caret in a fresh PLAIN text node after the mark —
          // placing it merely "after the mark" makes Chrome insert new
          // letters inside the mark, so the highlight would keep spreading
          // over unflagged text.
          editorRef.current?.focus();
          collapseCaretOutOfFlagMark();
        } catch {
          // couldn't apply the visual mark — the task was still created
        }
        if (editorRef.current) {
          decorateFlagMarks(editorRef.current, tasks);
          handleBodyChange(editorRef.current.innerHTML);
        }
      }
      toast.success("Flagged! Added to your task list.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't flag that text.",
      );
    }
  };

  const handleDrawingChange = (next: typeof strokes) => {
    setStrokes(next);
    scheduleSave({ drawing: JSON.stringify(next) });
  };

  const handleImagesChange = (next: typeof images) => {
    setImages(next);
    scheduleSave({ images: JSON.stringify(next) });
  };

  /** Leaving image mode returns focus to the paper so typing resumes.
   *  Deferred to the next tick so it runs after the browser's default
   *  mousedown focus handling (which would otherwise blur the editor). */
  const exitImageModeAndFocus = useCallback((active: boolean) => {
    setImageMode(active);
    if (!active) {
      setTimeout(() => {
        const el = editorRef.current;
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false); // caret at the end of the note
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }, 0);
    }
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-3">
      {/* Word-style ribbon — OUTSIDE and ABOVE the paper, sticky */}
      <EditorRibbon
        state={formatState}
        blockTag={blockTag}
        onBlock={handleBlock}
        onFormat={applyFormat}
        onPersist={() => {
          if (editorRef.current) handleBodyChange(editorRef.current.innerHTML);
        }}
        savedLabel={savedTick > 0 ? "Saved ✓" : "Autosaves as you type"}
        onFlag={handleFlagSelection}
        accent={accent}
        onAccent={(c) => {
          setAccent(c);
          scheduleSave({ color: c });
        }}
        drawMode={drawMode}
        onToggleDraw={() => {
          setDrawMode(!drawMode);
          if (!drawMode) setImageMode(false);
        }}
        imageMode={imageMode}
        onToggleImage={() => {
          setImageMode(!imageMode);
          if (!imageMode) setDrawMode(false);
        }}
      />

      {/* paper */}
      <div
        className={`${ACCENT_CLASS[accent]} note-card relative min-h-[32rem] flex-1 rounded-2xl border bg-card shadow-sm`}
      >
        {/* draw toolbar */}
        {drawMode && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <PencilLine className="size-3.5" />
              Drawing
            </span>

            {/* tools */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                aria-label="Pen tool"
                title="Pen"
                aria-pressed={penTool === "pen"}
                className={cn(
                  "grid size-7 place-items-center rounded-lg transition-colors",
                  penTool === "pen"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                onClick={() => setPenTool("pen")}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Arrow tool"
                title="Arrow — drag from tail to head"
                aria-pressed={penTool === "arrow"}
                className={cn(
                  "grid size-7 place-items-center rounded-lg transition-colors",
                  penTool === "arrow"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                onClick={() => setPenTool("arrow")}
              >
                <MoveUpRight className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Eraser tool"
                title="Eraser — drag over strokes to remove them"
                aria-pressed={penTool === "eraser"}
                className={cn(
                  "grid size-7 place-items-center rounded-lg transition-colors",
                  penTool === "eraser"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                onClick={() => setPenTool("eraser")}
              >
                <Eraser className="size-4" />
              </button>
            </div>

            <span className="h-5 w-px bg-border" />

            {/* color: current swatch opens full palette */}
            <div className="relative">
              <button
                type="button"
                aria-label="Drawing color"
                title="Drawing color"
                className="size-6 rounded-full border-2 border-white shadow ring-2 ring-transparent ring-offset-2 ring-offset-card transition-transform hover:scale-110"
                style={{ backgroundColor: penColor }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setInkOpen((o) => !o)}
              />
              <ColorPalette
                open={inkOpen}
                onOpenChange={setInkOpen}
                colors={PEN_PALETTE}
                value={penColor}
                onPick={setPenColor}
              />
            </div>

            <span className="h-5 w-px bg-border" />

            {/* thickness slider */}
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1}
                max={24}
                value={penWidth}
                aria-label="Line thickness"
                title="Line thickness"
                onChange={(e) => setPenWidth(Number(e.target.value))}
                className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-accent accent-primary"
              />
              <span className="w-6 text-center text-xs tabular-nums text-muted-foreground">
                {penWidth}
                </span>
            </div>

            <span className="h-5 w-px bg-border" />

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-lg"
              onClick={() => handleDrawingChange(strokes.slice(0, -1))}
            >
              Undo stroke
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-lg text-destructive hover:text-destructive"
              onClick={() => handleDrawingChange([])}
            >
              Clear
            </Button>

            {/* close drawing mode */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label="Close drawing mode"
              title="Close drawing mode"
              className="ml-auto h-7 rounded-lg"
              onClick={() => setDrawMode(false)}
            >
              <X className="size-3.5" />
              Close
            </Button>
          </div>
        )}

        {/* image-mode hint */}
        {imageMode && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-semibold uppercase">
              <ImageIcon className="size-3.5" />
              Images
            </span>
            <span>Click a picture to edit · click the page to keep typing</span>
          </div>
        )}

        <div className="relative flex min-h-0 flex-col px-4 py-4 sm:px-10">
          <ImageLayer
            images={images}
            onChange={handleImagesChange}
            active={imageMode}
            onActiveChange={exitImageModeAndFocus}
          />
          <DrawingCanvas
            strokes={strokes}
            onChange={handleDrawingChange}
            active={drawMode}
            penColor={penColor}
            penWidth={penWidth}
            tool={penTool}
          />
          <div className={drawMode || imageMode ? "pointer-events-none opacity-60" : ""}>
            <input
              value={title}
              readOnly={!canEdit}
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave({ title: e.target.value });
              }}
              maxLength={160}
              placeholder="Page title"
              aria-label="Page title"
              className="w-full bg-transparent font-display text-3xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/40"
            />
            <div className="mt-2 mb-4 h-px w-12 bg-primary/50" />
            <RichTextEditor
              value={body}
              onChange={canEdit ? handleBodyChange : () => {}}
              editorRef={editorRef}
              readOnly={!canEdit}
              numbered={numbered}
              placeholder="Start writing… select letters to format, press Flag for tasks, or insert pictures."
              fontClass="text-[15px]"
              onFormatStateChange={(state) => {
                setFormatState(state);
                setBlockTag(currentBlockTag());
              }}
            />
          </div>
        </div>

        {/* minimal footer */}
        <div className="flex items-center gap-2 border-t border-border/60 px-4 py-2 sm:px-10">
          <button
            type="button"
            disabled={!canEdit}
            aria-pressed={numbered}
            title="Number every line of this note"
            onClick={() => {
              const next = !numbered;
              setNumbered(next);
              scheduleSave({ numbered: next });
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50",
              numbered
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <ListOrdered className="size-3.5" />
            Number lines
          </button>
          <span className="ml-auto text-[11px] text-muted-foreground">
            {savedTick > 0 ? "Saved ✓" : "Autosaves as you type"}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* NotesPanel                                                               */
/* ──────────────────────────────────────────────────────────────────────── */

export default function NotesPanel({
  activePage,
  pagesLoading,
  onNewPage,
  onFlagTask,
  tasks,
  canCreate = true,
  canEdit = true,
  canFlag = true,
}: {
  activePage: Doc<"notePages"> | null;
  pagesLoading: boolean;
  onNewPage: () => void;
  onFlagTask: (text: string, pageId: PageId) => Promise<void>;
  tasks: Doc<"tasks">[];
  canCreate?: boolean;
  canEdit?: boolean;
  canFlag?: boolean;
}) {
  if (pagesLoading && !activePage) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border bg-card px-5 py-14 text-sm text-muted-foreground shadow-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (!activePage) {
    return (
      <div className="rounded-2xl border bg-card px-6 py-14 text-center shadow-sm">
        <StickyNote className="mx-auto size-8 text-muted-foreground/40" />
        <p className="mt-3 font-medium">No page selected</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick a notebook and page from the explorer in the side menu.
        </p>
        {canCreate && (
          <Button onClick={onNewPage} className="mt-5 rounded-xl">
            <Plus className="size-4" />
            New page
          </Button>
        )}
      </div>
    );
  }

  return (
    <PageCanvas
      key={activePage._id}
      page={activePage}
      onFlagTask={onFlagTask}
      tasks={tasks}
      canEdit={canEdit}
      canFlag={canFlag}
    />
  );
}
