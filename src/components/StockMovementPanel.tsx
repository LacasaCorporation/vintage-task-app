import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Loader2,
  PackageOpen,
  Repeat,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** What each kind of movement is called in the list. */
const SOURCE_LABEL = {
  purchase: "Bought",
  production: "Used in production",
  "production-return": "Returned from production",
  adjustment: "Stock correction",
} as const;

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
 * Stock movement: for every material, what came in, what went out, and what is
 * left on hand. Each row expands into the movements behind those numbers, so a
 * balance can always be traced back to the bills and productions that made it.
 */
export default function StockMovementPanel() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const rows = useQuery(api.stock.report, { limit: showAll ? 100 : 8 });

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <h2 className="text-sm font-semibold">
          Stock movement
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            in, out and what is left
          </span>
        </h2>
        {rows !== undefined && rows.length > 8 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {showAll ? "Show less" : `Show all ${rows.length}`}
          </button>
        )}
      </div>

      {rows === undefined ? (
        <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Working out the balance…
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <PackageOpen className="mx-auto size-7 text-muted-foreground/40" />
          <p className="mt-2 text-sm font-medium">No stock movement yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Save a purchase bill and every line shows up here as income.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((row) => {
            const open = expanded === row.materialId;
            return (
              <li key={row.materialId}>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded(open ? null : row.materialId)
                  }
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="min-w-0 truncate">{row.name}</span>
                      {row.code && (
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                          {row.code}
                        </span>
                      )}
                    </p>
                    {row.movements.length > 0 && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        Last:{" "}
                        {row.movements[0]!.direction === "in" ? "+" : "−"}
                        {qty(row.movements[0]!.qty)} {row.movements[0]!.unit}
                        {row.movements[0]!.ref
                          ? ` · ${row.movements[0]!.ref}`
                          : ""}
                      </p>
                    )}
                  </div>

                  <span
                    className="w-20 shrink-0 text-right text-xs text-emerald-600 tabular-nums dark:text-emerald-400"
                    title="Income: everything bought"
                  >
                    +{qty(row.income)}
                  </span>
                  <span
                    className="w-20 shrink-0 text-right text-xs text-rose-600 tabular-nums dark:text-rose-400"
                    title="Outgoing: consumed by production"
                  >
                    −{qty(row.outgoing)}
                  </span>
                  <span
                    className={cn(
                      "w-20 shrink-0 text-right text-xs font-semibold tabular-nums",
                      row.balance < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-foreground",
                    )}
                    title="Balance: what is on hand right now"
                  >
                    {qty(row.balance)}{" "}
                    <span className="font-normal text-muted-foreground">
                      {row.unit}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-180",
                    )}
                  />
                </button>

                {open && (
                  <div className="border-t border-border/60 bg-muted/30 px-4 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 text-[11px] text-muted-foreground">
                      <span>Movements</span>
                      <span className="tabular-nums">
                        {row.opening !== 0 && (
                          <>
                            {qty(row.opening)} opening +{" "}
                          </>
                        )}
                        {qty(row.income)} in − {qty(row.outgoing)} out ={" "}
                        {qty(row.balance)} {row.unit}
                      </span>
                    </div>
                    {row.movements.length === 0 ? (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        No recorded movements for this material.
                      </p>
                    ) : (
                      <ul className="mt-1.5 space-y-1">
                        {row.movements.map((m) => (
                          <li
                            key={m._id}
                            className="flex items-center gap-2 text-[11px]"
                          >
                            {m.direction === "in" ? (
                              <ArrowDownLeft className="size-3 shrink-0 text-emerald-500" />
                            ) : (
                              <ArrowUpRight className="size-3 shrink-0 text-rose-500" />
                            )}
                            <span className="w-16 shrink-0 text-muted-foreground">
                              {when(m.at)}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {SOURCE_LABEL[m.source]}
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
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-4 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <ArrowDownLeft className="size-3 text-emerald-500" /> Income
        </span>
        <span className="flex items-center gap-1">
          <ArrowUpRight className="size-3 text-rose-500" /> Outgoing
        </span>
        <span className="flex items-center gap-1">
          <Repeat className="size-3" /> Tap a row for its movements
        </span>
      </div>
    </section>
  );
}
