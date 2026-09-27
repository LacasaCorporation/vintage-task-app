import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Layers,
  Loader2,
  Package,
  Sigma,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { PRODUCT_SOURCE_LABEL } from "@/lib/stock-labels";
import { cn } from "@/lib/utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

/** Format a quantity without trailing noise, e.g. 2.5 stays 2.5, 3 stays 3. */
const qty = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 3 });

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/** One figure on the summary strip. */
function Stat({
  label,
  value,
  sub,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "in" | "out" | "strong";
  icon: typeof Package;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-3.5 py-3",
        tone === "strong" && "border-primary/30 bg-primary/[0.05]",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          className={cn(
            "size-3",
            tone === "in"
              ? "text-emerald-500"
              : tone === "out"
                ? "text-rose-500"
                : "text-muted-foreground/60",
          )}
        />
        <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
          {label}
        </p>
      </div>
      <p
        className={cn(
          "mt-1.5 text-lg leading-none font-semibold tabular-nums",
          tone === "in" && "text-emerald-600 dark:text-emerald-400",
          tone === "out" && "text-rose-600 dark:text-rose-400",
          tone === "strong" && "text-primary",
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * A product's full stock ledger, opened by clicking its name in the products
 * list. Every movement is listed oldest first carrying the balance it left,
 * so the numbers can be checked by eye rather than taken on trust.
 */
export default function ProductLedgerDialog({
  productId,
  productName,
  unitPrice,
  onClose,
  onOpenCosting,
}: {
  productId: Id<"finishedGoods">;
  productName: string;
  /** Sales price per unit, so the closing stock can be valued. */
  unitPrice: number;
  onClose: () => void;
  /** Jumps straight to the costing sheet from the ledger footer. */
  onOpenCosting?: (id: Id<"finishedGoods">) => void;
}) {
  const data = useQuery(api.productStock.ledger, { productId });
  const { format: money } = useWorkspaceCurrency();

  const unit = data?.product.unit ?? "pcs";

  const totals = useMemo(() => {
    if (!data) return null;
    return {
      opening: data.opening,
      produced: data.income,
      invoiced: data.outgoing,
      onHand: data.balance,
    };
  }, [data]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-[min(100%,860px)]">
        {/* ── header ─────────────────────────────────────────────────── */}
        <div className="relative border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-6 pt-6 pb-5">
          <DialogHeader className="pr-8">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Stock ledger
            </p>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Package className="size-5 text-primary" />
              {productName}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {data?.product.code && (
                <span className="font-mono text-muted-foreground">{data.product.code}</span>
              )}
              {data?.product.category && (
                <span className="text-muted-foreground">{data.product.category}</span>
              )}
              <span className="text-muted-foreground">sold per {unit}</span>
            </DialogDescription>
          </DialogHeader>
        </div>

        {data === undefined ? (
          <div className="flex items-center justify-center gap-2 px-6 py-20 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading the ledger…
          </div>
        ) : data === null ? (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            That product is no longer available.
          </p>
        ) : (
          <>
            {/* ── summary tiles ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2.5 border-b border-border/60 px-6 py-4 sm:grid-cols-4">
              <Stat
                icon={Wallet}
                label="Opening"
                value={qty(totals?.opening ?? 0)}
                sub={`${unit} on hand at the start`}
              />
              <Stat
                icon={ArrowDownLeft}
                label="Produced"
                value={qty(totals?.produced ?? 0)}
                tone="in"
                sub="came off the line"
              />
              <Stat
                icon={ArrowUpRight}
                label="Invoiced"
                value={qty(totals?.invoiced ?? 0)}
                tone="out"
                sub="taken by sales"
              />
              <Stat
                icon={Layers}
                label="On hand"
                value={qty(totals?.onHand ?? 0)}
                tone="strong"
                sub={`${unit} ready to sell`}
              />
            </div>

            {/* ── the ledger itself ──────────────────────────────────── */}
            <div className="max-h-[46vh] overflow-y-auto px-6 py-4">
              {data.lines.length === 0 ? (
                <div className="py-12 text-center">
                  <TrendingUp className="mx-auto size-7 text-muted-foreground/30" />
                  <p className="mt-2 text-sm font-medium">Nothing has moved yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Finish a production run or raise an invoice and every movement will
                    be listed here.
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border/70 text-left text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                      <th className="w-24 py-2 pr-3">Date</th>
                      <th className="py-2 pr-3">Movement</th>
                      <th className="w-24 py-2 pr-3 text-right">In</th>
                      <th className="w-24 py-2 pr-3 text-right">Out</th>
                      <th className="w-28 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {data.lines.map((line) => (
                      <tr
                        key={line._id}
                        className="group transition-colors hover:bg-accent/40"
                      >
                        <td className="py-2 pr-3 text-xs whitespace-nowrap text-muted-foreground">
                          {day(line.at)}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "grid size-6 shrink-0 place-items-center rounded-md",
                                line.direction === "in"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                              )}
                            >
                              {line.direction === "in" ? (
                                <ArrowDownLeft className="size-3" />
                              ) : (
                                <ArrowUpRight className="size-3" />
                              )}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium">
                                {PRODUCT_SOURCE_LABEL[line.source] ?? line.source}
                              </p>
                              {line.ref && (
                                <p className="truncate text-[10px] text-muted-foreground">
                                  {line.ref}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                          {line.direction === "in" ? qty(line.qty) : ""}
                        </td>
                        <td className="py-2 pr-3 text-right text-xs tabular-nums text-rose-600 dark:text-rose-400">
                          {line.direction === "out" ? qty(line.qty) : ""}
                        </td>
                        <td className="py-2 text-right text-xs font-medium tabular-nums">
                          {qty(line.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border/70">
                      <td className="py-2.5 pr-3 text-xs font-semibold" colSpan={2}>
                        Closing balance
                      </td>
                      <td className="py-2.5 pr-3 text-right text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {qty(totals?.produced ?? 0)}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                        {qty(totals?.invoiced ?? 0)}
                      </td>
                      <td className="py-2.5 text-right text-sm font-semibold tabular-nums text-primary">
                        {qty(totals?.onHand ?? 0)} {unit}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* the arithmetic, stated plainly so it can be checked */}
              <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] tabular-nums text-muted-foreground">
                {qty(totals?.opening ?? 0)} opening + {qty(totals?.produced ?? 0)} produced
                − {qty(totals?.invoiced ?? 0)} invoiced ={" "}
                <span className="font-semibold text-foreground">
                  {qty(totals?.onHand ?? 0)} {unit}
                </span>{" "}
                on hand
                {unitPrice > 0 && (
                  <>
                    {" "}
                    · worth{" "}
                    <span className="font-semibold text-foreground">
                      {money((totals?.onHand ?? 0) * unitPrice)}
                    </span>
                  </>
                )}
              </p>
            </div>

            <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-3">
              {onOpenCosting && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onOpenCosting(productId);
                    onClose();
                  }}
                  className="h-8 rounded-lg px-3 text-xs"
                >
                  <Sigma className="size-3.5" /> Open costing sheet
                </Button>
              )}
              <Button
                type="button"
                onClick={onClose}
                className="h-8 rounded-lg px-3 text-xs"
              >
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
