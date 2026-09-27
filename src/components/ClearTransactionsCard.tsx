import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Eraser, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** The phrase that has to be typed before anything is removed. */
const PHRASE = "CLEAR TRANSACTIONS";

/** Mirrors the server's table list, so the preview matches what is deleted. */
const LABELS: Record<string, string> = {
  purchaseLines: "Purchase bill lines",
  purchases: "Purchase bills",
  stockMovements: "Raw-material stock movements",
  productMovements: "Product stock movements",
  lpos: "Purchase orders (LPOs)",
  expenses: "Expenses",
  journalLines: "Journal entry lines",
  journalEntries: "Journal entries",
  quotations: "Quotations",
  sales: "Sales invoices",
};

/**
 * Danger zone for the workspace owner: empties the books while leaving every
 * master record alone. The counts come from the server before anything is
 * touched, and the phrase has to be typed out — a stray click cannot do this.
 * The server re-checks the owner and the phrase regardless of what the UI
 * allowed, so the button is a convenience, not the guard.
 */
export default function ClearTransactionsCard() {
  const access = useQuery(api.settings.getMyAccess);
  // the counts query is owner-only, so it must not even run for anyone else
  const isSuper = access?.isSuper === true;
  const summary = useQuery(
    api.admin.transactionCounts,
    isSuper ? {} : "skip",
  );
  const clear = useMutation(api.admin.clearTransactions);
  const [typed, setTyped] = useState("");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  // only the workspace owner ever sees this, and only they can run it
  if (!isSuper) return null;

  const rows = Object.entries(summary?.counts ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const run = async () => {
    setBusy(true);
    try {
      const result = await clear({ confirm: typed });
      toast.success(
        `${result.removed.toLocaleString()} transaction records removed. Master data untouched.`,
      );
      setTyped("");
      setArmed(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't clear the transactions.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/[0.03]">
      <header className="flex flex-wrap items-center gap-2 border-b border-destructive/20 px-5 py-3.5">
        <ShieldAlert className="size-4 text-destructive" />
        <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          Super user only
        </span>
      </header>

      <div className="space-y-4 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Clear all transactions</p>
            <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
              Empties the books — bills, sales, orders, expenses, journal entries
              and both stock ledgers — so you can start the running figures again.
              Every material, product, project, job, recipe, account, vendor,
              customer, task and note is <strong>kept</strong>. Stock returns to the
              opening balance you set. This cannot be undone.
            </p>
          </div>
          {!armed ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setArmed(true)}
              className="h-9 rounded-xl border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Eraser className="size-3.5" /> Clear transactions
            </Button>
          ) : null}
        </div>

        {summary === undefined ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Counting what would be
            removed…
          </p>
        ) : summary.total === 0 ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            There are no transactions to clear.
          </p>
        ) : (
          <div className="rounded-xl border bg-card/60 px-3.5 py-3">
            <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              This would remove {summary.total.toLocaleString()} records
            </p>
            <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {rows.map(([table, n]) => (
                <li
                  key={table}
                  className="flex items-baseline justify-between gap-3 text-xs"
                >
                  <span className="text-muted-foreground">{LABELS[table] ?? table}</span>
                  <span className="font-medium tabular-nums">{n.toLocaleString()}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 border-t pt-2 text-[11px] text-muted-foreground">
              Kept: {summary.kept.materials} materials, {summary.kept.products}{" "}
              products, {summary.kept.projects} projects, {summary.kept.accounts}{" "}
              accounts.
            </p>
          </div>
        )}

        {armed && summary !== undefined && summary.total > 0 && (
          <div className="rounded-xl border border-destructive/30 bg-background px-3.5 py-3">
            <p className="flex items-start gap-2 text-xs font-medium text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              This deletes the financial record permanently.
            </p>
            <label className="mt-2.5 block space-y-1 text-xs">
              <span className="text-muted-foreground">
                Type <span className="font-mono font-semibold text-foreground">{PHRASE}</span>{" "}
                to confirm
              </span>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={PHRASE}
                autoComplete="off"
                spellCheck={false}
                className={cn(
                  "h-9 font-mono text-xs",
                  typed.length > 0 && typed !== PHRASE && "border-destructive/50",
                )}
              />
            </label>
            <div className="mt-3 flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || typed !== PHRASE}
                onClick={() => void run()}
                className="h-9 rounded-lg bg-destructive px-3 text-sm text-white hover:bg-destructive/90"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Eraser className="size-3.5" />
                )}
                {busy ? "Clearing…" : `Delete ${summary.total.toLocaleString()} records`}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setArmed(false);
                  setTyped("");
                }}
                className="h-9 rounded-lg text-sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
