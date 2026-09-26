import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus } from "lucide-react";

/** The quick-add row; falls back to a note when the role can't create tasks. */
export function TaskQuickAdd({
  canCreate,
  draft,
  isAdding,
  listName,
  onDraftChange,
  onSubmit,
  onFocus,
}: {
  canCreate: boolean;
  draft: string;
  isAdding: boolean;
  listName?: string;
  onDraftChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onFocus: () => void;
}) {
  if (!canCreate) {
    return (
      <p className="mt-4 rounded-xl border border-dashed bg-card px-4 py-3 text-center text-sm text-muted-foreground">
        You can view tasks, but creating new ones isn't allowed for your role.
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-4 flex gap-2" onFocus={onFocus}>
      <Input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        maxLength={280}
        placeholder={
          listName
            ? `Add to “${listName}”… use #tag for labels`
            : "Add a task… #work for tags, “tomorrow 3pm” to schedule later"
        }
        aria-label="New task"
        className="h-11 flex-1 rounded-xl bg-card shadow-sm placeholder:text-muted-foreground/70"
      />
      <Button
        type="submit"
        disabled={!draft.trim() || isAdding}
        className="h-11 rounded-xl px-5 shadow-sm"
      >
        {isAdding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
        Add task
      </Button>
    </form>
  );
}

/** The three headline tiles above the workspace: current view, done, open. */
export default function TaskStats({
  tiles,
}: {
  tiles: { label: string; value: number }[];
}) {
  return (
    <section className="grid grid-cols-3 gap-3">
      {tiles.map((stat) => (
        <div key={stat.label} className="rounded-xl border bg-card p-4 text-center shadow-sm">
          <p className="font-display text-2xl font-semibold tabular-nums">{stat.value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{stat.label}</p>
        </div>
      ))}
    </section>
  );
}
