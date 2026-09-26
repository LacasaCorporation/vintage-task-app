import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Plain-text version of stored rich HTML (for previews / empty checks). */
export function stripHtml(html: string): string {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el.textContent ?? "";
}

/** Convert legacy plain-text bodies (with \n) into paragraph HTML. */
export function toEditorHtml(body: string): string {
  if (body.includes("<")) return body; // already rich HTML
  if (body.trim() === "") return "";
  return body
    .split("\n")
    .map((line) => `<p>${line === "" ? "<br>" : escapeHtml(line)}</p>`)
    .join("");
}

function escapeHtml(text: string): string {
  const el = document.createElement("div");
  el.textContent = text;
  return el.innerHTML;
}

/** Cached selection so toolbar buttons (which steal focus) keep working. */
let savedRange: Range | null = null;

export type FormatCmd =
  | "bold"
  | "italic"
  | "underline"
  | "strikeThrough"
  | "subscript"
  | "superscript"
  | "foreColor"
  | "hiliteColor"
  | "justifyLeft"
  | "justifyCenter"
  | "justifyRight"
  | "justifyFull"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "removeFormat"
  | "undo"
  | "redo";

/**
 * Apply a formatting command to the selected letters only.
 *
 * `collapseAfter` (used for colors and highlights): after painting the
 * selection, the caret is placed right AFTER the styled span and the style is
 * NOT left active — so typing continues in plain ink instead of inheriting
 * the painted color. Word does the same: a color applies only to the
 * selection, then the insertion point continues with the previous format.
 */
export function formatSelection(cmd: FormatCmd, arg?: string): void {
  const collapseAfter = cmd === "foreColor" || cmd === "hiliteColor";
  const sel = window.getSelection();
  if (!sel) return;
  if (sel.rangeCount === 0 && savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  if (sel.rangeCount === 0 && cmd !== "undo" && cmd !== "redo") return;
  document.execCommand("styleWithCSS", false, "true");
  if (arg !== undefined) {
    document.execCommand(cmd, false, arg);
  } else {
    document.execCommand(cmd);
  }
  if (collapseAfter) collapseToCaretAfterSelection();
}

/**
 * Place the caret just after the styled selection (a sibling text node after
 * the colored span) so what the user types next inherits nothing from it.
 */
function collapseToCaretAfterSelection(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);

  // Find the styled span the command just painted. The caret may sit inside
  // the span, or (collapsed) as an offset in the PARENT element right after
  // it — so check the node before the caret position too.
  let span: HTMLElement | null = null;
  const direct =
    range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement;
  span = direct?.closest<HTMLElement>("span[style], font") ?? null;
  if (!span && range.startContainer.parentNode instanceof HTMLElement) {
    const prev = range.startContainer.childNodes[range.startOffset - 1];
    const prevEl =
      prev instanceof HTMLElement
        ? prev
        : (prev?.parentElement ?? null);
    span = prevEl?.closest<HTMLElement>("span[style], font") ?? null;
  }
  if (!span) return;

  // The caret now sits at the edge of the styled span — park it in a fresh
  // PLAIN text node so new letters can't inherit the color/highlight.
  // (Chrome inserts typed characters INSIDE an inline element when the
  // caret is merely "at its end".)
  parkCaretAfterInline(span);
}

/**
 * Park the caret in a fresh zero-width text node right after an inline
 * element (`span`, `font`, `mark`…), so typing continues plain instead of
 * inheriting that element's styles. Shared by color/highlight painting and
 * the flag-mark guard.
 */
function parkCaretAfterInline(el: HTMLElement): void {
  if (!el.parentNode) return;
  const anchor = document.createTextNode("\u200B");
  if (el.nextSibling) {
    el.parentNode.insertBefore(anchor, el.nextSibling);
  } else {
    el.parentNode.appendChild(anchor);
  }
  const caret = document.createRange();
  caret.setStart(anchor, 1);
  caret.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(caret);
  savedRange = caret.cloneRange();
}

/**
 * Move the caret OUT of an inline styled element (a flagged
 * <mark class="flag-mark"> or a color/highlight <span style>) when it sits
 * at that element's end, into a fresh plain text node right after it.
 *
 * Chrome treats a caret "at the end of an inline element" ambiguously — typed
 * letters land INSIDE the element, so the highlight keeps spreading over text
 * that was never selected. Parking the caret in a real text node after the
 * element guarantees new typing stays plain. Clicking inside the middle is
 * left untouched so styled text stays editable.
 */
export function collapseCaretOutOfFlagMark(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const startEl =
    range.startContainer instanceof HTMLElement
      ? range.startContainer
      : range.startContainer.parentElement;
  const mark =
    startEl?.closest<HTMLElement>("mark.flag-mark, span[style]") ?? null;
  if (!mark || !mark.parentNode) return;
  // Never hijack the caret when the user has an active selection
  // (e.g. re-selecting styled text to restyle it).
  if (!range.collapsed) return;

  // Only act when the caret is at the very END of the element (just styled,
  // or typing right at its trailing edge).
  const atEnd =
    range.endContainer === mark
      ? range.endOffset === mark.childNodes.length
      : mark.contains(range.endContainer) &&
        range.endOffset ===
          (range.endContainer as Text | HTMLElement).textContent?.length;
  if (!atEnd) return;

  parkCaretAfterInline(mark);
}

/** Restore the cached selection inside the editor (best effort). */
function restoreSavedSelection(): Selection | null {
  const sel = window.getSelection();
  if (!sel) return null;
  if (sel.rangeCount === 0 && savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  return sel.rangeCount > 0 ? sel : null;
}

/** Word-style font size for the selected letters (replaces the size-7 hack). */
export function applyFontSize(px: number): void {
  const sel = restoreSavedSelection();
  if (!sel) return;
  document.execCommand("styleWithCSS", false, "false");
  document.execCommand("fontSize", false, "7");
  // find the editor that owns the selection and swap font[size=7] → styled span
  const anchor =
    sel.anchorNode instanceof HTMLElement
      ? sel.anchorNode
      : sel.anchorNode?.parentElement;
  const editor = anchor?.closest(".rich-editor");
  if (editor) {
    editor.querySelectorAll('font[size="7"]').forEach((f) => {
      const span = document.createElement("span");
      span.style.fontSize = `${px}px`;
      span.innerHTML = (f as HTMLElement).innerHTML;
      f.replaceWith(span);
    });
  }
}

/** Word-style font family for the selected letters. */
export function applyFontFamily(stack: string): void {
  const sel = restoreSavedSelection();
  if (!sel) return;
  document.execCommand("styleWithCSS", false, "true");
  document.execCommand("fontName", false, stack);
}

/** Word-style block formats. */
export const BLOCK_FORMATS = [
  { value: "<p>", label: "Paragraph" },
  { value: "<h1>", label: "Heading 1" },
  { value: "<h2>", label: "Heading 2" },
  { value: "<h3>", label: "Heading 3" },
  { value: "<blockquote>", label: "Quote" },
] as const;

export function formatBlock(tag: string): void {
  const sel = window.getSelection();
  if (!sel) return;
  if (sel.rangeCount === 0 && savedRange) {
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  if (sel.rangeCount === 0) return;
  document.execCommand("formatBlock", false, tag);
}

/** Read the current tag name around the caret, e.g. "h1" | "p" | "blockquote". */
export function currentBlockTag(): string {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return "p";
  let node: Node | null = sel.getRangeAt(0).startContainer;
  while (node && node !== document.body) {
    if (node instanceof HTMLElement) {
      const tag = node.tagName.toLowerCase();
      if (["h1", "h2", "h3", "p", "blockquote", "li"].includes(tag)) {
        return tag === "li" ? "p" : tag;
      }
    }
    node = node.parentNode;
  }
  return "p";
}

/** Snapshot of toggled formats at the caret/selection. */
export type FormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  ul: boolean;
  ol: boolean;
  sub: boolean;
  sup: boolean;
};

export function queryFormatState(): FormatState {
  const q = (cmd: string) => {
    try {
      return document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };
  return {
    bold: q("bold"),
    italic: q("italic"),
    underline: q("underline"),
    strikeThrough: q("strikeThrough"),
    ul: q("insertUnorderedList"),
    ol: q("insertOrderedList"),
    sub: q("subscript"),
    sup: q("superscript"),
  };
}

export type InkOption = { value: string; label: string; dot: string };

export const INK_COMMAND_COLORS: Record<string, string> = {
  default: "currentColor",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  sky: "#0ea5e9",
};

/**
 * ContentEditable rich-text editor.
 * Bold (Ctrl/Cmd+B or toolbar) and ink colors apply to the selected letters only.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  numbered,
  fontClass,
  inkClass,
  onFormatStateChange,
  editorRef,
  readOnly = false,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  numbered?: boolean;
  fontClass?: string;
  inkClass?: string;
  onFormatStateChange?: (state: FormatState) => void;
  editorRef?: React.RefObject<HTMLDivElement | null>;
  readOnly?: boolean;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const ref = editorRef ?? innerRef;
  // kept in a ref so DOM events always see the latest handler; writing it in an
  // effect (not during render) keeps render pure
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Sync external value into the DOM when it changes externally.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== value) {
      el.innerHTML = value;
    }
  }, [value, ref]);

  // Enter creates paragraphs so line numbering stays consistent.
  useEffect(() => {
    document.execCommand("defaultParagraphSeparator", false, "p");
  }, []);

  const captureSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
      onFormatStateChange?.(queryFormatState());
    }
  };

  const emit = () => {
    const el = ref.current;
    if (el) onChangeRef.current(el.innerHTML);
  };

  const isEmpty = stripHtml(value).trim() === "";

  return (
    <div
      ref={ref}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={placeholder ?? "Note body"}
      data-placeholder={placeholder ?? ""}
      data-empty={isEmpty ? "true" : "false"}
      className={cn(
        "rich-editor",
        numbered && "note-numbered",
        fontClass,
        inkClass,
        className,
      )}
      onInput={emit}
      onKeyUp={captureSelection}
      onMouseUp={captureSelection}
      onFocus={captureSelection}
      // keep the caret out of flagged <mark> spans while typing, so the flag
      // highlight never spreads over text the user didn't select
      onBeforeInput={() => collapseCaretOutOfFlagMark()}
      onPaste={(e) => {
        e.preventDefault();
        const lines = e.clipboardData
          .getData("text/plain")
          .split("\n");
        lines.forEach((line, i) => {
          if (i > 0) document.execCommand("insertParagraph");
          if (line !== "") document.execCommand("insertText", false, line);
        });
        emit();
      }}
      onKeyDown={(e) => {
        const mod = e.ctrlKey || e.metaKey;
        if (!mod) return;
        const key = e.key.toLowerCase();
        const handled: Record<string, FormatCmd> = {
          b: "bold",
          i: "italic",
          u: "underline",
        };
        if (handled[key]) {
          e.preventDefault();
          formatSelection(handled[key]);
          emit();
          onFormatStateChange?.(queryFormatState());
        }
      }}
    />
  );
}
