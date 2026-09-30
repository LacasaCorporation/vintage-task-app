import { FileText } from "lucide-react";
import type { Attachment } from "@/lib/task-utils";
import { cn } from "@/lib/utils";

/**
 * The pictures and files hanging off a task or a subtask, drawn small.
 *
 * Images get a real thumbnail that opens full size on click; anything else
 * gets a plain download row. Nothing here mutates — removing a file stays in
 * the task's detail panel, where there is room for a proper button.
 */
export default function AttachmentStrip({
  attachments,
  className,
}: {
  attachments: Attachment[];
  className?: string;
}) {
  if (attachments.length === 0) return null;
  const pictures = attachments.filter((a) => a.type.startsWith("image/"));
  const files = attachments.filter((a) => !a.type.startsWith("image/"));
  return (
    <div className={cn("space-y-1.5", className)}>
      {pictures.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {pictures.map((a) => (
            <li key={a.id}>
              <a
                href={a.data}
                target="_blank"
                rel="noreferrer"
                title={`Open ${a.name}`}
                className="group/pic block size-11 overflow-hidden rounded-md border bg-muted transition-colors hover:border-primary/50"
              >
                <img
                  src={a.data}
                  alt={a.name}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </a>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((a) => (
            <li key={a.id}>
              <a
                href={a.data}
                download={a.name}
                title={`Download ${a.name}`}
                className="inline-flex max-w-52 items-center gap-1.5 rounded-md border bg-card px-1.5 py-1 text-[11px] font-medium hover:border-primary/50 hover:text-primary"
              >
                <FileText className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{a.name}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
