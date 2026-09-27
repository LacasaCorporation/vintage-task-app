import { cn } from "@/lib/utils";

/**
 * A product's tags, inline after its name. Renders nothing when the product
 * has none, so plain rows are untouched. Priority is not shown here — it gets
 * a labelled chip after the due date instead.
 */
export default function ProductTagsInline({
  tags,
  className,
}: {
  tags: string[] | undefined;
  className?: string;
}) {
  const list = (tags ?? []).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <span className={cn("flex min-w-0 shrink items-center gap-1", className)}>
      {list.map((tag) => (
        <span
          key={tag}
          className="max-w-24 shrink-0 truncate rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground"
          title={`Tag: ${tag}`}
        >
          {tag}
        </span>
      ))}
    </span>
  );
}
