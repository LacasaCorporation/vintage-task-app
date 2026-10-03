import { useMemo } from "react";
import { useQuery } from "convex/react";
import { Factory, PackageCheck, PackageOpen } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { FgDoc } from "@/components/FlaggedLists";
import { PRODUCT_SOURCE_LABEL } from "@/lib/stock-labels";
import { batchQty } from "@/lib/product-cost";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";

/** A quantity with float noise trimmed: 2.5 stays 2.5, 3 stays 3. */
const qtyText = (n: number) =>
  Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, { maximumFractionDigits: 3 });

/** A moment, written the way a person reads it. */
const whenText = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "live" | "warn";
}) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-2.5 py-2">
      <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate text-sm font-bold tabular-nums",
          tone === "ok" && "text-emerald-600 dark:text-emerald-400",
          tone === "live" && "text-primary",
          tone === "warn" && "text-destructive",
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

/**
 * Everything the app knows about a product's production: whether a run is
 * open or the product is finished, the batch it makes, what that batch costs,
 * the recipe it is costed from, and what production has actually moved on or
 * off the shelf.
 *
 * It reads from what already exists — the product document, its costing sheet
 * (`listFgItems`) and the product stock ledger (`productStock.report`) — so it
 * can never disagree with the numbers the rest of the app shows.
 */
export default function ProductionDetails({ fg }: { fg: FgDoc }) {
  const items = useQuery(api.costing.listFgItems, { fgId: fg._id });
  const stockRows = useQuery(api.productStock.report);
  const { format: money } = useWorkspaceCurrency();

  const unit = fg.unit ?? "pcs";
  const running = fg.productionStartedAt !== undefined;
  const finished = fg.isCompleted === true || fg.projectStatus === "Finish";

  /** The sheet as one line per material, priced for a single unit. */
  const recipe = useMemo(
    () =>
      (items ?? []).map((line) => ({
        _id: line._id,
        label: line.label,
        unit: line.unit,
        qty: line.qty,
        unitPrice: line.unitPrice,
        cost: line.qty * line.unitPrice,
      })),
    [items],
  );

  const perUnit = useMemo(
    () => recipe.reduce((sum, line) => sum + line.cost, 0),
    [recipe],
  );
  const batch = batchQty(fg);
  const perBatch = perUnit * batch;

  /** The latest production movements, so the run's effect on stock is visible. */
  const movements = useMemo(() => {
    const row = stockRows?.find((r) => r.productId === fg._id);
    return (row?.movements ?? []).slice(0, 6);
  }, [stockRows, fg._id]);

  const inProduction = fg.inProduction ?? 0;
  const stock = fg.stock ?? 0;

  return (
    <section className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
      <header className="flex items-center gap-2">
        <Factory className="size-4 shrink-0 text-primary" />
        <h3 className="min-w-0 flex-1 text-sm font-semibold">Production</h3>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
            running
              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              : finished
                ? "bg-muted text-muted-foreground"
                : "bg-sky-500/10 text-sky-700 dark:text-sky-400",
          )}
        >
          {running ? "In production" : finished ? "Finished" : "Not started"}
        </span>
      </header>

      {/* ── the numbers ──────────────────────────────────────────── */}
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <Figure
          label="Batch"
          value={`${qtyText(batch)} ${unit}`}
          hint="made by one run"
        />
        <Figure
          label="On hand"
          value={`${qtyText(stock)} ${unit}`}
          hint="ready to sell"
          tone={stock < 0 ? "warn" : undefined}
        />
        <Figure
          label="In production"
          value={`${qtyText(inProduction)} ${unit}`}
          hint="part-made right now"
          tone={inProduction > 0 ? "live" : undefined}
        />
        <Figure
          label="Cost per batch"
          value={money(perBatch)}
          hint={`${money(perUnit)} each`}
        />
      </div>

      {/* ── when ─────────────────────────────────────────────────── */}
      <dl className="mt-2.5 space-y-1 text-[11px]">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Started</dt>
          <dd className="min-w-0 flex-1">
            {fg.productionStartedAt !== undefined
              ? whenText(fg.productionStartedAt)
              : "—"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted-foreground">Finished</dt>
          <dd className="min-w-0 flex-1">
            {fg.completedAt !== undefined ? whenText(fg.completedAt) : "—"}
          </dd>
        </div>
      </dl>

      {/* ── the recipe this batch is built from ──────────────────── */}
      <div className="mt-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          <PackageOpen className="size-3" />
          Recipe
          <span className="font-normal normal-case">· per {unit}</span>
        </p>
        {items === undefined ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">Loading…</p>
        ) : recipe.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            No materials on the costing sheet yet — add them on the product's
            sheet to cost this batch.
          </p>
        ) : (
          <ul className="mt-1.5 divide-y divide-border/50 overflow-hidden rounded-lg border bg-card">
            {recipe.map((line) => (
              <li key={line._id} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {line.label}
                </span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {qtyText(line.qty)} {line.unit ?? ""} × {money(line.unitPrice)}
                </span>
                <span className="w-16 shrink-0 text-right text-[11px] tabular-nums">
                  {money(line.cost)}
                </span>
              </li>
            ))}
            <li className="flex items-center gap-2 bg-muted/40 px-2.5 py-1.5 text-[11px] font-semibold">
              <span className="min-w-0 flex-1">Production cost</span>
              <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                {qtyText(batch)} × {money(perUnit)}
              </span>
              <span className="w-16 shrink-0 text-right tabular-nums">
                {money(perBatch)}
              </span>
            </li>
          </ul>
        )}
      </div>

      {/* ── what production actually moved ───────────────────────── */}
      <div className="mt-3">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          <PackageCheck className="size-3" />
          Stock movements
        </p>
        {stockRows === undefined ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">Loading…</p>
        ) : movements.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Nothing has been produced or invoiced for this product yet.
          </p>
        ) : (
          <ul className="mt-1.5 divide-y divide-border/50 overflow-hidden rounded-lg border bg-card">
            {movements.map((m) => (
              <li key={m._id} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                  {PRODUCT_SOURCE_LABEL[m.source] ?? m.source}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {whenText(m.at)}
                </span>
                <span
                  className={cn(
                    "w-16 shrink-0 text-right text-[11px] font-medium tabular-nums",
                    m.direction === "in"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400",
                  )}
                >
                  {m.direction === "in" ? "+" : "−"}
                  {qtyText(m.qty)} {m.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
