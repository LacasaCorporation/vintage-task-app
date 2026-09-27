import { cn } from "@/lib/utils";

/**
 * The product's code, sitting right after the name on the same line — "NEW
 * PRODUCTS FG0002" reads as one thing rather than a code floating further down
 * the row. Renders nothing when the product has no code.
 */
export default function ProductCodeInline({
  code,
  className,
}: {
  code: string | undefined;
  className?: string;
}) {
  if (!code) return null;
  return (
    <span
      className={cn(
        "shrink-0 font-mono text-[10px] whitespace-nowrap text-muted-foreground/70",
        className,
      )}
    >
      {code}
    </span>
  );
}
