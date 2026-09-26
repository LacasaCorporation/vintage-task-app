import {
  BLOCK_FORMATS,
  type FormatCmd,
  type FormatState,
  applyFontFamily,
  applyFontSize,
} from "@/components/RichTextEditor";
import ColorPalette, {
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
} from "@/components/ColorPalette";
import type { NoteColor } from "@/convex/schema";
import { cn } from "@/lib/utils";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  CaseSensitive,
  Eraser,
  Highlighter,
  Italic,
  List,
  ListOrdered,
  Palette,
  Redo2,
  Strikethrough,
  Subscript,
  Superscript,
  Underline,
  Undo2,
  Flag,
  Image as ImageIcon,
  PencilLine,
} from "lucide-react";
import { useState } from "react";

const FONT_FAMILIES: { label: string; stack: string; css: string }[] = [
  { label: "Inter (body)", stack: '"Inter", sans-serif', css: "font-sans" },
  { label: "Space Grotesk", stack: '"Space Grotesk", sans-serif', css: "" },
  { label: "Lora (serif)", stack: '"Lora", serif', css: "font-serif" },
  { label: "JetBrains Mono", stack: '"JetBrains Mono", monospace', css: "font-mono" },
  { label: "Caveat (hand)", stack: '"Caveat", cursive', css: "font-hand" },
];

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 30, 36];

const ACCENT_SWATCHES: { value: NoteColor; label: string; hex: string }[] = [
  { value: "default", label: "Plain", hex: "#94a3b8" },
  { value: "indigo", label: "Indigo", hex: "#6366f1" },
  { value: "violet", label: "Violet", hex: "#8b5cf6" },
  { value: "sky", label: "Sky", hex: "#0ea5e9" },
  { value: "teal", label: "Teal", hex: "#14b8a6" },
  { value: "emerald", label: "Emerald", hex: "#10b981" },
  { value: "amber", label: "Amber", hex: "#f59e0b" },
  { value: "orange", label: "Orange", hex: "#f97316" },
  { value: "rose", label: "Rose", hex: "#f43f5e" },
  { value: "pink", label: "Pink", hex: "#ec4899" },
];

/** Same swatches as a palette the popover can render. */
const ACCENT_COLORS = ACCENT_SWATCHES.map((s) => ({
  value: s.hex,
  label: s.label,
}));

const accentHex = (c: NoteColor) =>
  ACCENT_SWATCHES.find((s) => s.value === c)?.hex ?? ACCENT_SWATCHES[0].hex;

function RibbonButton({
  label,
  active,
  children,
  onClick,
}: {
  label: string;
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-md transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-foreground/70 hover:bg-accent hover:text-foreground",
      )}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function RibbonDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

/**
 * Word-style ribbon fixed above the page (outside the paper) so it never
 * scrolls or reflows while typing. All formatting applies to the selection.
 */
export default function EditorRibbon({
  state,
  blockTag,
  onBlock,
  onFormat,
  onPersist,
  savedLabel,
  onFlag,
  accent,
  onAccent,
  drawMode,
  onToggleDraw,
  imageMode,
  onToggleImage,
}: {
  state: FormatState;
  blockTag: string;
  onBlock: (tag: string) => void;
  onFormat: (cmd: FormatCmd, arg?: string) => void;
  onPersist: () => void;
  savedLabel: string;
  onFlag: () => void;
  accent: NoteColor;
  onAccent: (c: NoteColor) => void;
  drawMode: boolean;
  onToggleDraw: () => void;
  imageMode: boolean;
  onToggleImage: () => void;
}) {
  const [family, setFamily] = useState(FONT_FAMILIES[0].label);
  const [size, setSize] = useState(16);
  const [inkOpen, setInkOpen] = useState(false);
  const [hlOpen, setHlOpen] = useState(false);
  const [accentOpen, setAccentOpen] = useState(false);

  const grow = () => {
    const next = Math.min(72, Math.round(size * 1.2) + 1);
    setSize(next);
    applyFontSize(next);
    onPersist();
  };
  const shrink = () => {
    const next = Math.max(8, Math.round(size / 1.2));
    setSize(next);
    applyFontSize(next);
    onPersist();
  };

  return (
    <div className="sticky top-16 z-30 rounded-2xl border bg-card/95 shadow-sm backdrop-blur-sm">
      {/* row 1: font family, size, grow/shrink, clear, cases, ink & highlight */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/60 px-2 py-2">
        {/* font family */}
        <select
          aria-label="Font family"
          value={family}
          onChange={(e) => {
            const f = FONT_FAMILIES.find((x) => x.label === e.target.value);
            if (!f) return;
            setFamily(f.label);
            applyFontFamily(f.stack);
            onPersist();
          }}
          className="h-7 max-w-36 shrink-0 rounded-md border bg-background px-1.5 text-xs font-medium outline-none"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.label} value={f.label}>
              {f.label}
            </option>
          ))}
        </select>

        {/* font size */}
        <select
          aria-label="Font size"
          value={size}
          onChange={(e) => {
            const px = Number(e.target.value);
            setSize(px);
            applyFontSize(px);
            onPersist();
          }}
          className="h-7 w-14 shrink-0 rounded-md border bg-background px-1 text-xs font-medium outline-none"
        >
          {FONT_SIZES.map((px) => (
            <option key={px} value={px}>
              {px}
            </option>
          ))}
        </select>

        {/* grow / shrink */}
        <RibbonButton label="Increase font size" onClick={grow}>
          <span className="text-xs leading-none font-semibold">A⁺</span>
        </RibbonButton>
        <RibbonButton label="Decrease font size" onClick={shrink}>
          <span className="text-xs leading-none font-semibold">A⁻</span>
        </RibbonButton>

        <RibbonDivider />

        {/* clear formatting */}
        <RibbonButton label="Clear formatting" onClick={() => onFormat("removeFormat")}>
          <Eraser className="size-4" />
        </RibbonButton>

        {/* change case (best-effort: re-types the selection) */}
        <RibbonButton
          label="Change case"
          onClick={() => {
            const sel = window.getSelection();
            const text = sel?.toString() ?? "";
            if (!text) return;
            const cased =
              text === text.toUpperCase()
                ? text.toLowerCase()
                : text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
            document.execCommand("insertText", false, cased);
            onPersist();
          }}
        >
          <CaseSensitive className="size-4" />
        </RibbonButton>

        <RibbonDivider />

        {/* ink color with full palette */}
        <div className="relative flex shrink-0 items-center">
          <RibbonButton label="Font color" active={inkOpen} onClick={() => setInkOpen((o) => !o)}>
            <span className="relative">
              <Baseline className="size-4" />
              <span className="absolute inset-x-0.5 bottom-0 h-1 rounded-sm bg-indigo-500" />
            </span>
          </RibbonButton>
          <ColorPalette
            open={inkOpen}
            onOpenChange={setInkOpen}
            colors={TEXT_COLORS}
            onPick={(hex) => onFormat("foreColor", hex)}
          />
        </div>

        {/* highlight with full palette */}
        <div className="relative flex shrink-0 items-center">
          <RibbonButton label="Highlight color" active={hlOpen} onClick={() => setHlOpen((o) => !o)}>
            <span className="relative">
              <Highlighter className="size-4" />
              <span className="absolute inset-x-0.5 bottom-0 h-1 rounded-sm bg-yellow-300" />
            </span>
          </RibbonButton>
          <ColorPalette
            open={hlOpen}
            onOpenChange={setHlOpen}
            colors={HIGHLIGHT_COLORS}
            onPick={(hex) => onFormat("hiliteColor", hex)}
          />
        </div>

        {/* notebook accent (page theme) with palette */}
        <div className="relative flex shrink-0 items-center">
          <RibbonButton
            label="Notebook accent"
            active={accentOpen}
            onClick={() => setAccentOpen((o) => !o)}
          >
            <span className="relative">
              <Palette className="size-4" />
              <span
                className="absolute inset-x-0.5 bottom-0 h-1 rounded-sm"
                style={{ backgroundColor: accentHex(accent) }}
              />
            </span>
          </RibbonButton>
          <ColorPalette
            open={accentOpen}
            onOpenChange={setAccentOpen}
            colors={ACCENT_COLORS}
            value={accentHex(accent)}
            allowCustom={false}
            onPick={(hex) => {
              const found = ACCENT_SWATCHES.find(
                (s) => s.hex.toLowerCase() === hex.toLowerCase(),
              );
              onAccent(found?.value ?? "default");
            }}
          />
        </div>

        {/* lists */}
        <RibbonDivider />
        <RibbonButton label="Bullet list" active={state.ul} onClick={() => onFormat("insertUnorderedList")}>
          <List className="size-4" />
        </RibbonButton>
        <RibbonButton label="Numbered list" active={state.ol} onClick={() => onFormat("insertOrderedList")}>
          <ListOrdered className="size-4" />
        </RibbonButton>

        <span className="ml-auto hidden pl-2 text-[11px] text-muted-foreground sm:block">
          {savedLabel}
        </span>
      </div>

      {/* row 2: block format, B I U S, sub/sup, alignment, undo/redo */}
      <div className="flex flex-wrap items-center gap-1 px-2 py-2">
        {/* block format */}
        <select
          aria-label="Paragraph style"
          value={blockTag}
          onChange={(e) => onBlock(e.target.value)}
          className="h-7 shrink-0 rounded-md border bg-background px-1.5 text-xs font-medium outline-none"
        >
          {BLOCK_FORMATS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>

        <RibbonDivider />

        {/* B I U S */}
        <RibbonButton label="Bold" active={state.bold} onClick={() => onFormat("bold")}>
          <Bold className="size-4" />
        </RibbonButton>
        <RibbonButton label="Italic" active={state.italic} onClick={() => onFormat("italic")}>
          <Italic className="size-4" />
        </RibbonButton>
        <RibbonButton label="Underline" active={state.underline} onClick={() => onFormat("underline")}>
          <Underline className="size-4" />
        </RibbonButton>
        <RibbonButton label="Strikethrough" active={state.strikeThrough} onClick={() => onFormat("strikeThrough")}>
          <Strikethrough className="size-4" />
        </RibbonButton>

        <RibbonDivider />

        {/* sub / superscript */}
        <RibbonButton label="Subscript" active={state.sub} onClick={() => onFormat("subscript")}>
          <Subscript className="size-4" />
        </RibbonButton>
        <RibbonButton label="Superscript" active={state.sup} onClick={() => onFormat("superscript")}>
          <Superscript className="size-4" />
        </RibbonButton>

        <RibbonDivider />

        {/* alignment */}
        <RibbonButton label="Align left" onClick={() => onFormat("justifyLeft")}>
          <AlignLeft className="size-4" />
        </RibbonButton>
        <RibbonButton label="Align center" onClick={() => onFormat("justifyCenter")}>
          <AlignCenter className="size-4" />
        </RibbonButton>
        <RibbonButton label="Align right" onClick={() => onFormat("justifyRight")}>
          <AlignRight className="size-4" />
        </RibbonButton>
        <RibbonButton label="Justify" onClick={() => onFormat("justifyFull")}>
          <AlignJustify className="size-4" />
        </RibbonButton>

        <RibbonDivider />

        {/* undo / redo */}
        <RibbonButton label="Undo" onClick={() => onFormat("undo")}>
          <Undo2 className="size-4" />
        </RibbonButton>
        <RibbonButton label="Redo" onClick={() => onFormat("redo")}>
          <Redo2 className="size-4" />
        </RibbonButton>

        <RibbonDivider />

        {/* flag selection → task */}
        <button
          type="button"
          aria-label="Flag selection as task"
          title="Flag selection: creates a task from the selected letters"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-amber-500/10 px-2.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onFlag}
        >
          <Flag className="size-3.5" />
          Flag
        </button>

        {/* draw mode toggle */}
        <button
          type="button"
          aria-pressed={drawMode}
          title="Toggle draw mode"
          className={cn(
            "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors",
            drawMode
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          onClick={onToggleDraw}
        >
          <PencilLine className="size-3.5" />
          Draw
        </button>

        {/* image mode toggle */}
        <button
          type="button"
          aria-pressed={imageMode}
          title="Insert and edit images"
          className={cn(
            "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors",
            imageMode
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          onClick={onToggleImage}
        >
          <ImageIcon className="size-3.5" />
          Picture
        </button>
      </div>
    </div>
  );
}
