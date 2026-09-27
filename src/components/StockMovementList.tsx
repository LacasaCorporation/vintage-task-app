import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { LedgerRow } from "@/lib/stock-types";
import { MATERIAL_SOURCE_LABEL } from "@/lib/stock-labels";
import { cn } from "@/lib/utils";

const qty = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");

const when = (at: number) => {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
};

/**
 * Every transaction for one row of a stock ledger, newest first, with the
 * arithmetic that ties them to the balance. Raw materials and finished
 * products share this panel; only the wording of each source differs.
 */
export default function StockMovementList({
  row,
  labels = MATERIAL_SOURCE_LABEL,
  emptyLabel = "No movements recorded for this material yet.",
  noun = "material",
}: {
  row: LedgerRow;
  labels?: Record<string, string>;
  emptyLabel?: string;
  noun?: string;
}) {
  return (
    <div className="border-t border-border/60 bg-muted/25 px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-[11px] text-muted-foreground">
        <span className="font-medium">Transactions</span>
        <span className="tabular-nums">
          {row.opening !== 0 && (
            <>
              {qty(row.opening)} opening +{" "}
            </>
          )}
          {qty(row.income)} in − {qty(row.outgoing)} out = {qty(row.balance)}{" "}
          {row.unit}
        </span>
      </div>

      {row.movements.length === 0 ? (
        <p className="mt-1.5 text-[11px] text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {row.movements.map((m) => (
            <li key={m._id} className="flex items-center gap-2 text-[11px]">
              {m.direction === "in" ? (
                <ArrowDownLeft className="size-3 shrink-0 text-emerald-500" />
              ) : (
                <ArrowUpRight className="size-3 shrink-0 text-rose-500" />
              )}
              <span className="w-20 shrink-0 text-muted-foreground">
                {when(m.at)}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {labels[m.source] ?? m.source}
                {m.ref ? ` · ${m.ref}` : ""}
              </span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  m.direction === "in"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                )}
              >
                {m.direction === "in" ? "+" : "−"}
                {qty(m.qty)} {m.unit}
              </span>
            </li>
          ))}
        </ul>
      )}

      {row.opening !== 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {row.opening > 0
            ? `Already had ${qty(row.opening)} ${row.unit} on hand before any of these movements — stock from bills recorded before movements were tracked, or a figure set by hand.`
            : `${qty(-row.opening)} ${row.unit} is unaccounted for: more has gone out than the bills and the movements add up to.`}
        </p>
      )}

      <p className="sr-only">
        Ledger for this {noun}: {qty(row.income)} received, {qty(row.outgoing)}{" "}
        issued, {qty(row.balance)} {row.unit} on hand.
      </p>
    </div>
  );
}
