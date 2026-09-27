import { Button } from "@/components/ui/button";
import { Loader2, Plus } from "lucide-react";

/** The compact “+ New task” trigger; falls back to a note when the role can't create tasks. */
export function TaskQuickAdd({
  canCreate,
  isAdding,
  listName,
  onClick,
}: {
  canCreate: boolean;
  isAdding: boolean;
  listName?: string;
  onClick: () => void;
}) {
  if (!canCreate) {
    return (
      <p className="rounded-lg border border-dashed bg-card px-3 py-1.5 text-xs text-muted-foreground">
        You can view tasks, but creating new ones isn't allowed for your role.
      </p>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={isAdding}
      onClick={onClick}
      title={
        listName
          ? `New task in “${listName}” — due date, priority & notes`
          : "New task — due date, priority & notes"
      }
      className="h-7 shrink-0 gap-1.5 rounded-lg border-primary/30 bg-primary/[0.06] px-2 text-xs font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
    >
      {isAdding ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Plus className="size-3.5" />
      )}
      New task
    </Button>
  );
}

/** A slim one-line readout of the view: total, completed, open. */
export default function TaskStats({
  tiles,
}: {
  tiles: { label: string; value: number }[];
}) {
  return (
    <dl className="flex min-w-0 flex-wrap items-baseline gap-x-3.5 gap-y-0.5">
      {tiles.map((stat) => (
        <div key={stat.label} className="flex min-w-0 items-baseline gap-1">
          <dd className="text-sm font-semibold tabular-nums text-foreground">
            {stat.value}
          </dd>
          <dt className="truncate text-[11px] text-muted-foreground">{stat.label}</dt>
        </div>
      ))}
    </dl>
  );
}
