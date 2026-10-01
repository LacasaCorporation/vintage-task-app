import { ArrowDownLeft, ArrowUpRight, Scale } from "lucide-react";
import type { LedgerRow } from "@/lib/stock-types";
import { MATERIAL_SOURCE_LABEL } from "@/lib/stock-labels";
import { cn } from "@/lib/utils";

const qty = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");

// A zero amount is written as plain "0" — never "−0" — so an empty Out card
// doesn't read as though something was issued backwards.
const signed = (n: number, sign: "+" | "−") =>
  n === 0 ? qty(n) : `${sign}${qty(n)}`;

const when = (at: number) => {
  const days = Math.floor((Date.now() - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
};

/** One of the three headings that sit along the top of the ledger. */
function Heading({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Scale;
  label: string;
  value: string;
  sub: string;
  tone: "in" | "out" | "balance";
}) {
  return (
    <div
      className={cn(
        "min-w-0 flex-1 rounded-xl border px-3 py-2.5",
        tone === "balance" && "border-primary/30 bg-primary/[0.06]",
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        <Icon
          className={cn(
            "size-3",
            tone === "in" && "text-emerald-600 dark:text-emerald-400",
            tone === "out" && "text-rose-600 dark:text-rose-400",
            tone === "balance" && "text-primary",
          )}
        />
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-base leading-none font-bold tabular-nums",
          tone === "in" && "text-emerald-600 dark:text-emerald-400",
          tone === "out" && "text-rose-600 dark:text-rose-400",
          tone === "balance" && "text-primary",
        )}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/**
 * One row of a stock ledger, laid out the way a stock ledger is read: what
 * came **In**, what went **Out**, and what is left as the **Balance**.
 *
 * Raw materials and finished products share this panel; only the wording of
 * each source differs. The arithmetic is stated at the bottom, including the
 * opening figure, so the balance can be checked by hand.
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
  const into = row.movements.filter((m) => m.direction === "in");
  const outOf = row.movements.filter((m) => m.direction === "out");

  return (
    <div className="border-t border-border/60 bg-muted/20 px-4 py-3">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        Stock ledger
      </p>

      {/* ── the three headings ─────────────────────────────────────── */}
      <div className="mt-2 flex flex-wrap gap-2">
        <Heading
          icon={ArrowDownLeft}
          label="In"
          value={`${signed(row.income, "+")} ${row.unit}`}
          sub="received"
          tone="in"
        />
        <Heading
          icon={ArrowUpRight}
          label="Out"
          value={`${signed(row.outgoing, "−")} ${row.unit}`}
          sub="issued"
          tone="out"
        />
        <Heading
          icon={Scale}
          label="Balance"
          value={`${qty(row.balance)} ${row.unit}`}
          sub="on hand"
          tone="balance"
        />
      </div>

      {row.movements.length === 0 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {/* ── IN ─────────────────────────────────────────────── */}
          <section className="overflow-hidden rounded-xl border">
            <header className="flex items-center gap-1.5 border-b bg-emerald-500/[0.07] px-3 py-1.5">
              <ArrowDownLeft className="size-3 text-emerald-600 dark:text-emerald-400" />
              <h4 className="text-[10px] font-semibold tracking-wider uppercase">
                In
              </h4>
              <span className="text-[10px] text-muted-foreground">
                received · {into.length}
              </span>
              <span className="ml-auto text-[10px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {signed(row.income, "+")}
              </span>
            </header>
            {into.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-muted-foreground/80">
                Nothing has come in.
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {into.map((m) => (
                  <li
                    key={m._id}
                    className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <ArrowDownLeft className="size-2.5" />
                    </span>
                    <span className="w-20 shrink-0 text-muted-foreground">
                      {when(m.at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {labels[m.source] ?? m.source}
                      {m.ref ? ` · ${m.ref}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{qty(m.qty)} {m.unit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── OUT ────────────────────────────────────────────── */}
          <section className="overflow-hidden rounded-xl border">
            <header className="flex items-center gap-1.5 border-b bg-rose-500/[0.07] px-3 py-1.5">
              <ArrowUpRight className="size-3 text-rose-600 dark:text-rose-400" />
              <h4 className="text-[10px] font-semibold tracking-wider uppercase">
                Out
              </h4>
              <span className="text-[10px] text-muted-foreground">
                issued · {outOf.length}
              </span>
              <span className="ml-auto text-[10px] font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                {signed(row.outgoing, "−")}
              </span>
            </header>
            {outOf.length === 0 ? (
              <p className="px-3 py-3 text-[11px] text-muted-foreground/80">
                Nothing has gone out.
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {outOf.map((m) => (
                  <li
                    key={m._id}
                    className="flex items-center gap-2 px-3 py-1.5 text-[11px]"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      <ArrowUpRight className="size-2.5" />
                    </span>
                    <span className="w-20 shrink-0 text-muted-foreground">
                      {when(m.at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {labels[m.source] ?? m.source}
                      {m.ref ? ` · ${m.ref}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums text-rose-600 dark:text-rose-400">
                      −{qty(m.qty)} {m.unit}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* ── the balance, stated so it can be checked ──────────────── */}
      <div className="mt-2.5 rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="font-semibold tracking-wide text-muted-foreground uppercase">
            Balance
          </span>
          <span className="tabular-nums text-muted-foreground">
            {row.opening !== 0 && (
              <>
                {qty(row.opening)} opening{" "}
                {row.opening > 0 ? "+" : "−"}&nbsp;
              </>
            )}
            {qty(row.income)} in − {qty(row.outgoing)} out =
          </span>
          <span className="font-bold tabular-nums text-primary">
            {qty(row.balance)} {row.unit}
          </span>
        </div>
        {row.opening !== 0 && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            {row.opening > 0
              ? `Already had ${qty(row.opening)} ${row.unit} on hand before any of these movements — stock from bills recorded before movements were tracked, or a figure set by hand.`
              : `${qty(-row.opening)} ${row.unit} is unaccounted for: more has gone out than the bills and the movements add up to.`}
          </p>
        )}
      </div>

      <p className="sr-only">
        Ledger for this {noun}: {qty(row.income)} received, {qty(row.outgoing)}{" "}
        issued, {qty(row.balance)} {row.unit} on hand.
      </p>
    </div>
  );
}
