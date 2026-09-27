import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ListTodo, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export type SubtaskValues = {
  text: string;
  due?: number;
  priority?: "high" | "medium" | "low";
  tags?: string[];
};

const selectCls =
  "h-8 rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30";

/**
 * The “+ Subtask” popup. The date is optional and deliberately free-form: a
 * subtask may fall after its parent, and the server leaves that to the caller.
 */
export default function AddSubtaskDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: SubtaskValues) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("medium");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) {
      toast.error("Give the subtask some text.");
      return;
    }
    setBusy(true);
    try {
      const wanted = priority.trim().toLowerCase();
      const parsed = (tags.match(/#?[\w-]+/g) ?? []).map((t) =>
        t.replace(/^#/, "").toLowerCase(),
      );
      await onSubmit({
        text: clean,
        due: due ? new Date(`${due}T12:00:00`).getTime() : undefined,
        priority: (["high", "medium", "low"] as const).find((p) => p === wanted),
        tags: parsed.length > 0 ? parsed : undefined,
      });
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't add that subtask.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <ListTodo className="size-4" />
            </span>
            New subtask
          </DialogTitle>
          <DialogDescription className="text-xs">
            A step inside the task. Everything here is optional but the text.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label
              htmlFor="subtask-text"
              className="mb-1 block text-[11px] font-medium text-muted-foreground"
            >
              Subtask
            </label>
            <Input
              id="subtask-text"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What is the next step?"
              aria-label="Subtask"
              maxLength={280}
              className="h-8 rounded-lg text-xs"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="subtask-due"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                Due date
              </label>
              <Input
                id="subtask-due"
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                aria-label="Subtask due date"
                className="h-8 rounded-lg text-xs"
              />
            </div>
            <div>
              <label
                htmlFor="subtask-priority"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                Priority
              </label>
              <select
                id="subtask-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                aria-label="Subtask priority"
                className={cn(selectCls, "w-full")}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="subtask-tags"
              className="mb-1 block text-[11px] font-medium text-muted-foreground"
            >
              Tags
            </label>
            <Input
              id="subtask-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="#work #is #good"
              aria-label="Subtask tags"
              className="h-8 rounded-lg text-xs"
            />
          </div>

          <DialogFooter className="gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onClose}
              className="h-7 rounded-lg text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy || !text.trim()}
              className="h-7 gap-1.5 rounded-lg text-xs"
            >
              {busy ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <ListTodo className="size-3" />
              )}
              Add subtask
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
