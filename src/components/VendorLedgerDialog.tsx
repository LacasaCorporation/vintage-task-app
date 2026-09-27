import { useMemo } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  FileText,
  Receipt,
  Store,
  Wallet,
} from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type VendorDoc = Doc<"vendors">;
type BillDoc = Doc<"purchases">;

const round2 = (n: number) => Math.round(n * 100) / 100;

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/** One tile in the summary strip. */
function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub: string;
  tone?: "in" | "out" | "strong";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        tone === "strong" && "border-primary/30 bg-primary/[0.06]",
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        <Icon
          className={cn(
            "size-3",
            tone === "in" && "text-emerald-600 dark:text-emerald-400",
            tone === "out" && "text-amber-600 dark:text-amber-400",
            tone === "strong" && "text-primary",
          )}
        />
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-sm font-bold tabular-nums",
          tone === "in" && "text-emerald-600 dark:text-emerald-400",
          tone === "out" && "text-amber-600 dark:text-amber-400",
          tone === "strong" && "text-primary",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/**
 * What one supplier owes you, bill by bill: everything billed, everything
 * settled, and the running balance in between. Opened by clicking a vendor in
 * the Purchase → Vendors table.
 */
export default function VendorLedgerDialog({
  vendor,
  bills,
  money,
  onClose,
  onOpenBill,
  onNewBill,
  canCreate = true,
}: {
  vendor: VendorDoc;
  bills: BillDoc[];
  money: (n: number) => string;
  onClose: () => void;
  /** Open an existing bill for reading. */
  onOpenBill: (id: Id<"purchases">) => void;
  /** Start a new bill with this vendor. */
  onNewBill: () => void;
  canCreate?: boolean;
}) {
  /** Oldest first, so the running balance reads like a statement. */
  const rows = useMemo(
    () =>
      [...bills]
        .sort((a, b) => a.purchasedAt - b.purchasedAt || a.number.localeCompare(b.number))
        .map((bill) => {
          const paid = bill.isPaid === true;
          return {
            bill,
            // billing adds to what you owe; paying takes it away
            billed: paid ? 0 : bill.total,
            paid: paid ? bill.total : 0,
          };
        }),
    [bills],
  );

  /**
   * Billed, paid and the running balance, folded in date order. Written as a
   * pure fold rather than a loop with a running total, so a re-render can
   * never read a half-built figure.
   */
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          const balance = round2(acc.balance + r.billed - r.paid);
          return {
            lines: [...acc.lines, { ...r, balance }],
            billed: round2(acc.billed + r.billed),
            paid: round2(acc.paid + r.paid),
            balance,
          };
        },
        {
          lines: [] as Array<(typeof rows)[number] & { balance: number }>,
          billed: 0,
          paid: 0,
          balance: 0,
        },
      ),
    [rows],
  );
  const unpaidCount = rows.filter((r) => r.bill.isPaid !== true).length;

  const oldest = rows[0]?.bill.purchasedAt;
  const newest = rows[rows.length - 1]?.bill.purchasedAt;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-[min(100%,860px)]">
        {/* ── header ─────────────────────────────────────────────────── */}
        <div className="relative border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-6 pt-6 pb-5">
          <DialogHeader className="pr-8">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Supplier ledger
            </p>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Store className="size-5 text-primary" />
              {vendor.name}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {vendor.contactName && <span>{vendor.contactName}</span>}
              {vendor.phone && <span className="tabular-nums">{vendor.phone}</span>}
              {vendor.email && <span>{vendor.email}</span>}
              {rows.length > 0 && oldest !== undefined && newest !== undefined && (
                <span className="text-muted-foreground">
                  {rows.length === 1
                    ? `1 bill, ${day(oldest)}`
                    : `${rows.length} bills, ${day(oldest)} – ${day(newest)}`}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* ── summary tiles ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2.5 border-b border-border/60 px-6 py-4 sm:grid-cols-4">
          <Stat
            icon={Receipt}
            label="Billed"
            value={money(totals.billed)}
            sub="across every bill"
          />
          <Stat
            icon={CheckCircle2}
            label="Paid"
            value={money(totals.paid)}
            tone="in"
            sub="settled"
          />
          <Stat
            icon={FileText}
            label="Bills"
            value={String(rows.length)}
            sub={`${unpaidCount} still open`}
          />
          <Stat
            icon={Wallet}
            label="Balance"
            value={money(totals.balance)}
            tone={totals.balance > 0 ? "out" : "in"}
            sub={totals.balance > 0 ? "you still owe" : "nothing outstanding"}
          />
        </div>

        {/* ── the ledger itself ──────────────────────────────────────── */}
        <div className="max-h-[46vh] overflow-y-auto px-6 py-4">
          {rows.length === 0 ? (
            <div className="py-12 text-center">
              <Receipt className="mx-auto size-7 text-muted-foreground/30" />
              <p className="mt-2 text-sm font-medium">No bills for this vendor yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Raise one and it will be listed here, with what is paid and what is
                still owed.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border/70 text-left text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <th className="w-24 py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Bill</th>
                  <th className="w-24 py-2 pr-3 text-right">Billed</th>
                  <th className="w-24 py-2 pr-3 text-right">Paid</th>
                  <th className="w-28 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {totals.lines.map(({ bill, billed, paid, balance }) => {
                  const settled = bill.isPaid === true;
                  return (
                    <tr
                      key={bill._id}
                      className="group cursor-pointer transition-colors hover:bg-accent/40"
                      onClick={() => onOpenBill(bill._id)}
                    >
                      <td className="py-2 pr-3 text-xs whitespace-nowrap text-muted-foreground">
                        {day(bill.purchasedAt)}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "grid size-6 shrink-0 place-items-center rounded-md",
                              settled
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {settled ? (
                              <ArrowDownLeft className="size-3" />
                            ) : (
                              <ArrowUpRight className="size-3" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-medium">
                              {bill.number}
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground">
                              {settled ? "Paid" : "Awaiting payment"}
                              {bill.dueAt !== undefined
                                ? ` · due ${day(bill.dueAt)}`
                                : ""}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right text-xs font-medium tabular-nums">
                        {billed > 0 ? money(billed) : ""}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                        {paid > 0 ? money(paid) : ""}
                      </td>
                      <td
                        className={cn(
                          "py-2 text-right text-xs font-semibold tabular-nums",
                          balance > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-foreground",
                        )}
                      >
                        {money(balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border/70">
                  <td className="py-2.5 pr-3 text-xs font-semibold" colSpan={2}>
                    Closing balance
                  </td>
                  <td className="py-2.5 pr-3 text-right text-xs font-semibold tabular-nums">
                    {money(totals.billed)}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {money(totals.paid)}
                  </td>
                  <td
                    className={cn(
                      "py-2.5 text-right text-sm font-semibold tabular-nums",
                      totals.balance > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {money(totals.balance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* the arithmetic, stated plainly so it can be checked */}
          <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] tabular-nums text-muted-foreground">
            {money(totals.billed)} billed − {money(totals.paid)} paid ={" "}
            <span
              className={cn(
                "font-semibold",
                totals.balance > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {money(totals.balance)}
            </span>{" "}
            outstanding
          </p>
        </div>

        <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-3">
          {canCreate && (
            <Button
              type="button"
              variant="outline"
              onClick={onNewBill}
              className="h-8 rounded-lg px-3 text-xs"
            >
              <Receipt className="size-3.5" /> New bill
            </Button>
          )}
          <Button type="button" onClick={onClose} className="h-8 rounded-lg px-3 text-xs">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
