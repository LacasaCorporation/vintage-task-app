import { cn } from "@/lib/utils";

const qtyText = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");

/**
 * How many of a product, sitting right after its name in a list row — "12 pcs"
 * reads as part of the name rather than as another chip competing with the
 * status and due date. Nothing renders when the product has no quantity or no
 * unit, so rows without one stay as they were.
 */
export default function ProductQtyInline({
  qty,
  unit,
  className,
}: {
  qty: number | undefined;
  unit: string | undefined;
  className?: string;
}) {
  if (qty === undefined || qty <= 0 || !unit) return null;
  return (
    <span
      className={cn(
        "shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums",
        className,
      )}
    >
      {qtyText(qty)} {unit}
    </span>
  );
}
