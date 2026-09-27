import { cn } from "@/lib/utils";

/**
 * A money total, set in brackets so it reads as a figure rather than as body
 * text: "[ $750.00 ]". Green for a value the firm would earn, amber for a raw
 * cost, slate for a plain count-free figure.
 */
export default function MoneyBracket({
  amount,
  tone = "primary",
  title,
  className,
}: {
  amount: string;
  tone?: "primary" | "cost" | "neutral";
  title?: string;
  className?: string;
}) {
  const tones = {
    primary:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    cost: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
    neutral:
      "border-border bg-muted/60 text-foreground/80 dark:text-foreground/80",
  } as const;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap tabular-nums",
        tones[tone],
        className,
      )}
      title={title}
    >
      <span aria-hidden className="opacity-50">
        [
      </span>
      {amount}
      <span aria-hidden className="opacity-50">
        ]
      </span>
    </span>
  );
}
