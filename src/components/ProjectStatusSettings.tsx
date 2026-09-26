import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, X } from "lucide-react";

/**
 * Editor for the custom Projects statuses. The first (Start) and last
 * (Finish) entries stay fixed so every other surface can rely on them.
 */
export default function ProjectStatusSettings({
  value,
  onChange,
  onClose,
  onSave,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mx-3 mb-2 rounded-xl border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold">Custom Projects statuses</p>
          <p className="text-[11px] text-muted-foreground">Start and Finish stay fixed.</p>
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
          return (
            <div key={`${index}-${status}`} className="flex items-center gap-1.5">
              <Input
                value={status}
                disabled={locked}
                onChange={(e) =>
                  onChange(value.map((item, i) => (i === index ? e.target.value : item)))
                }
                className="h-8 text-xs"
              />
              {!locked && (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, i) => i !== index))}
                  className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${status}`}
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between">
        <button
          type="button"
          disabled={value.length >= 11}
          onClick={() => onChange([...value.slice(0, -1), "", "Finish"])}
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
