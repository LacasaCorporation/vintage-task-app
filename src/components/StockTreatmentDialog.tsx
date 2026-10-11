import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { toast } from "@/lib/toast";
import {
  Boxes,
  CheckCircle2,
  Loader2,
  Package,
  Scale,
  TrendingDown,
  Truck,
} from "lucide-react";

export default function StockTreatmentDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { format: money } = useWorkspaceCurrency();
  const summary = useQuery(api.accounting.stockSummary);
  const postStock = useMutation(api.accounting.postStockAdjustment);
  const syncGrv = useMutation(api.grv.syncGrvLedger);
  const [busy, setBusy] = useState(false);

  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
  const endOfToday = now.getTime();

  const handleApply = async () => {
    setBusy(true);
    try {
      // 1. Sync any unposted received GRVs into the ledger so 1300 and 2400 are up-to-date
      await syncGrv();

      // 2. Post stock treatment (opening stock and closing stock) to the ledger
      const res = await postStock({
        from: startOfYear,
        to: endOfToday,
        label: `FY ${now.getFullYear()}`,
      });

      toast.success(
        res.posted
          ? `Stock treatment posted: Opening stock ${money(res.opening)} and Closing stock ${money(res.closing)} treated in ledger.`
          : "Stock treatment completed. No stock on hand to adjust.",
      );
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to apply stock treatment.",
      );
    } finally {
      setBusy(false);
    }
  };

  const opening = summary?.opening ?? 0;
  const closing = summary?.closing ?? 0;
  const grvTotal = summary?.grvTotal ?? 0;
  const purchases = summary?.purchases ?? 0;
  const cogs = summary?.cogs ?? (opening + purchases - closing);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
              <Scale className="size-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Stock Treatment &amp; Valuation
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Treat Opening stock and Closing stock in the ledger, verify Goods Received (GRV), and calculate proper Trading &amp; P&amp;L COGS.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {summary === undefined ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Evaluating stock on shelves…
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* KPI grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-sky-500/20 bg-sky-500/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-sky-700 dark:text-sky-300">
                  <Package className="size-3.5" /> Opening stock
                </div>
                <p className="mt-1.5 text-base font-extrabold tabular-nums text-foreground">
                  {money(opening)}
                </p>
                <p className="text-[10px] text-muted-foreground">Stock brought forward</p>
              </div>

              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-300">
                  <Truck className="size-3.5" /> Goods received
                </div>
                <p className="mt-1.5 text-base font-extrabold tabular-nums text-foreground">
                  {money(grvTotal)}
                </p>
                <p className="text-[10px] text-muted-foreground">Verified GRV in ledger</p>
              </div>

              <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-violet-700 dark:text-violet-300">
                  <Boxes className="size-3.5" /> Closing stock
                </div>
                <p className="mt-1.5 text-base font-extrabold tabular-nums text-foreground">
                  {money(closing)}
                </p>
                <p className="text-[10px] text-muted-foreground">Stock on hand now</p>
              </div>

              <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-3">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-rose-700 dark:text-rose-300">
                  <TrendingDown className="size-3.5" /> Cost of Goods
                </div>
                <p className="mt-1.5 text-base font-extrabold tabular-nums text-foreground">
                  {money(cogs)}
                </p>
                <p className="text-[10px] text-muted-foreground">Opening + In − Closing</p>
              </div>
            </div>

            {/* Explanatory ledger accounting lines */}
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-xs">
              <h4 className="font-semibold text-foreground">
                How stock treatment is recorded in the ledger:
              </h4>
              <ul className="mt-2 space-y-1.5 text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    1
                  </span>
                  <span>
                    <strong className="text-foreground">1300 Raw material inventory</strong> debits material cost when a Goods Received Voucher (GRV) is received into stock.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    2
                  </span>
                  <span>
                    <strong className="text-foreground">1310 Opening stock &amp; 5150 (Trading)</strong> brings forward opening stock and treats it as a cost in the Trading account.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                    3
                  </span>
                  <span>
                    <strong className="text-foreground">1320 Closing stock &amp; 5155 (Trading)</strong> holds the physical stock on the balance sheet and deducts unsold stock from COGS in Profit &amp; Loss.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={busy || summary === undefined}
            className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {busy ? "Posting to ledger…" : "Apply stock treatment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
