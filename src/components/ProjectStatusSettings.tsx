import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Percent, Plus, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  clampCompletion,
  positionalColor,
  positionalCompletion,
  PROJECT_STATUS_FINISH,
  PROJECT_STATUS_START,
  STATUS_PALETTE,
  type ProjectStatusDetail,
} from "@/lib/project-statuses";

/**
 * Editor for the custom Projects statuses. The first (Listed) and last
 * (Finish) names stay fixed so every other surface can rely on them, and
 * starting production always lands on the first status between them.
 *
 * Each status carries how it is worn as well as its name: a colour for its
 * chips and board columns, the completion a product in it counts as, and who
 * owns the stage. All three are optional — a workflow nobody has dressed still
 * reads exactly as it did before, by position.
 */
export default function ProjectStatusSettings({
  value,
  onChange,
  onClose,
  onSave,
}: {
  value: ProjectStatusDetail[];
  onChange: (next: ProjectStatusDetail[]) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  /** Which row's palette is open, by position — rows have no id of their own. */
  const [openSwatch, setOpenSwatch] = useState<number | null>(null);
  /**
   * Completion text still being typed, kept per row so a half-typed number is
   * not overwritten by the clamped value it is saving as the user goes.
   */
  const [typed, setTyped] = useState<Record<number, string>>({});

  const update = (index: number, patch: Partial<ProjectStatusDetail>) =>
    onChange(
      value.map((status, i) => {
        if (i !== index) return status;
        const merged: ProjectStatusDetail = { ...status, ...patch };
        // a field set back to nothing leaves the object entirely rather than
        // riding along as `undefined`, so what is saved is what is shown
        const next: ProjectStatusDetail = { name: merged.name };
        if (merged.color !== undefined) next.color = merged.color;
        if (merged.completion !== undefined) next.completion = merged.completion;
        if (merged.assignee !== undefined) next.assignee = merged.assignee;
        return next;
      }),
    );

  const assignees = value
    .map((status) => status.assignee?.trim())
    .filter((name): name is string => Boolean(name));

  return (
    <div className="mx-3 mb-2 min-w-[19rem] rounded-xl border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">Custom Projects statuses</p>
          <p className="text-[11px] text-muted-foreground">
            {PROJECT_STATUS_START} and {PROJECT_STATUS_FINISH} stay fixed. Starting
            production moves a product to the first status between them.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close status settings"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        {value.map((status, index) => {
          const locked = index === 0 || index === value.length - 1;
          const own =
            status.color === undefined
              ? undefined
              : STATUS_PALETTE.find((entry) => entry.key === status.color);
          const color = own ?? positionalColor(index, value.length);
          const completion =
            status.completion ?? positionalCompletion(index, value.length);
          const label = status.name.trim() || "this status";
          return (
            <div key={index} className="rounded-lg border border-border/60 bg-muted/20 p-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSwatch((open) => (open === index ? null : index))
                  }
                  className="grid size-7 shrink-0 place-items-center rounded-md border border-border/70 transition-transform hover:scale-105"
                  style={{ backgroundColor: color.hex }}
                  title={
                    own === undefined
                      ? `Wears the workflow's colour — pick another`
                      : `${own.label} — pick another colour`
                  }
                  aria-label={`Colour for ${label}`}
                  aria-expanded={openSwatch === index}
                >
                  <span className="size-2 rounded-full bg-white/90 shadow-sm" />
                </button>
                <Input
                  value={status.name}
                  disabled={locked}
                  placeholder="Status name"
                  onChange={(e) => update(index, { name: e.target.value })}
                  className="h-8 text-xs"
                />
                {!locked && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpenSwatch(null);
                      onChange(value.filter((_, i) => i !== index));
                    }}
                    className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Remove ${label}`}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>

              {openSwatch === index && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 rounded-md border border-border/60 bg-card px-1.5 py-1.5">
                  <button
                    type="button"
                    onClick={() => update(index, { color: undefined })}
                    className={cn(
                      "h-5 rounded-full border border-dashed px-2 text-[10px] transition-colors",
                      own === undefined
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                    title="Follow the workflow: first status sky, middle violet, Finish emerald"
                  >
                    Auto
                  </button>
                  {STATUS_PALETTE.map((entry) => (
                    <button
                      key={entry.key}
                      type="button"
                      title={entry.label}
                      aria-label={entry.label}
                      onClick={() => update(index, { color: entry.key })}
                      className={cn(
                        "size-5 rounded-full ring-offset-2 ring-offset-card transition-transform hover:scale-110",
                        entry.fill,
                        own?.key === entry.key && "ring-2 ring-foreground",
                      )}
                    />
                  ))}
                </div>
              )}

              <div className="mt-1.5 flex items-center gap-1.5">
                <span
                  className="inline-flex h-7 shrink-0 items-center gap-0.5 rounded-md border border-border/70 bg-card px-1.5"
                  title={`How complete a product counts while it sits in ${label}`}
                >
                  <Percent className="size-3 text-muted-foreground" />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={typed[index] ?? String(completion)}
                    onChange={(event) => {
                      const text = event.target.value;
                      setTyped((current) => ({ ...current, [index]: text }));
                      const parsed = Number(text);
                      if (text.trim() !== "" && Number.isFinite(parsed)) {
                        update(index, { completion: clampCompletion(parsed) });
                      }
                    }}
                    onBlur={() =>
                      setTyped((current) => {
                        const next = { ...current };
                        delete next[index];
                        return next;
                      })
                    }
                    aria-label={`Completion percentage for ${label}`}
                    className="h-full w-8 bg-transparent text-[11px] font-medium tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[11px] text-muted-foreground">%</span>
                </span>
                <div className="relative min-w-0 flex-1">
                  <UserRound className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground/70" />
                  <Input
                    value={status.assignee ?? ""}
                    placeholder="Assign to (optional)"
                    list="project-status-assignees"
                    onChange={(e) => update(index, { assignee: e.target.value })}
                    className="h-7 pr-2 pl-6 text-[11px]"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* the names already given, so the same person can be picked again */}
      <datalist id="project-status-assignees">
        {[...new Set(assignees)].map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <div className="mt-2 flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={value.length >= 11}
          onClick={() => {
            // a sensible starting completion between its neighbours, so the new
            // stage already reads as part of the run instead of a flat 0
            const at = value.length - 1;
            const before = value[at - 1]?.completion ?? positionalCompletion(at - 1, value.length);
            const after = value[at]?.completion ?? positionalCompletion(at, value.length);
            onChange([
              ...value.slice(0, -1),
              { name: "", completion: clampCompletion((before + after) / 2) },
              value[value.length - 1],
            ]);
          }}
          className="inline-flex items-center gap-1 text-xs text-primary disabled:opacity-40"
        >
          <Plus className="size-3" /> Add middle status
        </button>
        <Button size="sm" className="h-7 px-2.5 text-xs" onClick={onSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
