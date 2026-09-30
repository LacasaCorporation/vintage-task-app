import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { messageFrom } from "@/lib/errors";
import { timeAgoLabel } from "@/lib/task-utils";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { NodeKind } from "@/components/NodeIssues";

/**
 * The conversation on a project, job or product — the same thread a task has,
 * so the office and the site talk in one place instead of over each other.
 * Anyone who can open it can post; your own messages can be taken back.
 */
export default function NodeComments({
  kind,
  id,
}: {
  kind: NodeKind;
  id: string;
}) {
  const comments = useQuery(api.projectTasks.listComments, { kind, id });
  const people = useQuery(api.tasks.people);
  const addComment = useMutation(api.projectTasks.addComment);
  const removeComment = useMutation(api.projectTasks.removeComment);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const me: Id<"users"> | null = people?.me ?? null;

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    try {
      await addComment({ kind, id, text });
      setDraft("");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't post that message."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex items-start gap-2.5 px-1 py-1.5">
      <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Conversation
          {comments !== undefined && comments.length > 0
            ? ` (${comments.length})`
            : ""}
        </p>

        {comments === undefined ? (
          <p className="mt-1 text-xs text-muted-foreground">Loading messages…</p>
        ) : comments.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            No messages yet. Ask a question or leave a note — everyone who can
            open this sees it.
          </p>
        ) : (
          <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
            {comments.map((c) => {
              const mine = me !== null && c.authorId === me;
              return (
                <li
                  key={c._id}
                  className={cn("group/cm flex items-end gap-2", mine && "flex-row-reverse")}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
                      mine
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {initialsOf(c.author)}
                  </span>
                  <div
                    className={cn(
                      "min-w-0 max-w-[85%] rounded-xl px-2.5 py-1.5",
                      mine ? "bg-primary/10 text-foreground" : "bg-muted/70 text-foreground",
                    )}
                  >
                    <p className="text-[10px] font-medium text-muted-foreground">
                      {mine ? "You" : c.author}
                      <span className="ml-1.5 font-normal">{timeAgoLabel(c.at)}</span>
                    </p>
                    <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">
                      {c.text}
                    </p>
                  </div>
                  {mine && (
                    <button
                      type="button"
                      aria-label="Delete message"
                      className="hidden size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive group-hover/cm:grid"
                      onClick={() =>
                        void removeComment({ kind, id, commentId: c._id }).catch(() =>
                          toast.error("Couldn't remove that message."),
                        )
                      }
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form onSubmit={send} className="mt-2 flex gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Write a message…"
            className="h-8 rounded-lg text-sm"
            aria-label="Write a message"
          />
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 rounded-lg"
            disabled={sending || draft.trim().length === 0}
            aria-label="Send message"
          >
            <Send className="size-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
}

/** One or two letters to stand in for a name. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0].slice(0, 2) || "?").toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
