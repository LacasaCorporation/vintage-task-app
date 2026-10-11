import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  FileSpreadsheet,
  Loader2,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { toLocalInput } from "@/lib/task-utils";
import { useAppDialogs } from "@/components/AppDialogs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";
import { Panel, Tile, Empty, HEAD, CELL, CELL_LEFT, ROW, TOTAL } from "./ReportsPanel";
import type { ExpenseKind } from "@/convex/expenses";

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const num = (value: string) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;

const LOSS = "text-rose-700 dark:text-rose-300";

const selectCls =
  "mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

const fieldLabel =
  "text-[11px] font-semibold tracking-widest text-muted-foreground uppercase";

/** How each class is described wherever it is named. */
const KIND_LABEL: Record<ExpenseKind, string> = {
  direct: "Direct expenses",
  indirect: "Indirect expenses",
};

/**
 * The two classes of expense, and what the difference is.
 *
 * A direct expense goes into what a product costs to make, so it lands in the
 * cost of goods sold the trading account strikes. An indirect expense is spent
 * running the business — rent, wages, utilities — and is charged below the
 * gross profit instead. Both are written to the same chart of accounts; the
 * split is a reading of it, not a second set of books.
 */
const KIND_ORDER: readonly ExpenseKind[] = ["direct", "indirect"];

const KIND_HINT: Record<ExpenseKind, string> = {
  direct: "Spend that makes the product — materials, production wages, fuel on the shop floor",
  indirect: "Spend that runs the business — rent, office wages, utilities, insurance",
};

/**
 * Records one expense in the class the panel is showing.
 *
 * The class is not a field to fill in: the panel is showing one half of the
 * ledger at a time, and the posting belongs to whichever half is on screen.
 */
function ExpenseForm({
  kind,
  onClose,
}: {
  kind: ExpenseKind;
  onClose: () => void;
}) {
  const options = useQuery(api.expenses.options);
  const vendors = useQuery(api.contacts.listVendors);
  const createExpense = useMutation(api.expenses.create);
  const { format: money } = useWorkspaceCurrency();
  const [at, setAt] = useState(() => toLocalInput(new Date()));
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidFrom, setPaidFrom] = useState<Id<"accounts"> | "">("");
  const [vendorId, setVendorId] = useState<Id<"vendors"> | "">("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const categories = options?.categories ?? [];
  const payFrom = options?.payFrom ?? [];
  const vendor = vendors?.find((v) => v._id === vendorId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (categories.length === 0) {
      toast.error("Set up an expense account first — add one in Accounting.");
      return;
    }
    if (!(num(amount) > 0)) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (category === "") {
      toast.error("Choose what the money was spent on.");
      return;
    }
    setBusy(true);
    try {
      await createExpense({
        at: new Date(`${at}T12:00:00`).getTime(),
        category,
        description: description.trim() || undefined,
        amount: num(amount),
        paidFrom: paidFrom === "" ? undefined : paidFrom,
        vendorId: vendorId === "" ? undefined : vendorId,
        vendor: vendor?.name,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        kind,
      });
      toast.success(
        `Expense recorded as ${kind === "direct" ? "direct" : "indirect"} and posted to the ledger.`,
      );
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't record the expense.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs"
            onClick={onClose}
          >
            Cancel
          </Button>
          <h2 className="font-display text-lg font-semibold">
            Record a {kind === "direct" ? "direct" : "indirect"} expense
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {KIND_HINT[kind]}
        </p>
      </div>

      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <label className={fieldLabel} htmlFor="exp-at">
            Date
          </label>
          <Input
            id="exp-at"
            type="datetime-local"
            className="mt-1 h-9"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            required
          />
        </div>

        <div>
          <label className={fieldLabel} htmlFor="exp-category">
            Expense account
          </label>
          <select
            id="exp-category"
            className={selectCls}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          >
            <option value="">Choose an account…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={fieldLabel} htmlFor="exp-amount">
            Amount
          </label>
          <Input
            id="exp-amount"
            type="number"
            min="0"
            step="0.01"
            className="mt-1 h-9"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>

        <div>
          <label className={fieldLabel} htmlFor="exp-paidfrom">
            Paid from
          </label>
          <select
            id="exp-paidfrom"
            className={selectCls}
            value={paidFrom}
            onChange={(e) => setPaidFrom(e.target.value as Id<"accounts"> | "")}
          >
            <option value="">Cash (default)</option>
            {payFrom.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={fieldLabel} htmlFor="exp-vendor">
            Paid to (optional)
          </label>
          <select
            id="exp-vendor"
            className={selectCls}
            value={vendorId}
            onChange={(e) =>
              setVendorId(e.target.value as Id<"vendors"> | "")
            }
          >
            <option value="">Nobody in particular</option>
            {(vendors ?? []).map((v) => (
              <option key={v._id} value={v._id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={fieldLabel} htmlFor="exp-ref">
            Reference (optional)
          </label>
          <Input
            id="exp-ref"
            className="mt-1 h-9"
            placeholder="Receipt or voucher number"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        <div className="sm:col-span-2 xl:col-span-1">
          <label className={fieldLabel} htmlFor="exp-desc">
            Description
          </label>
          <Textarea
            id="exp-desc"
            className="mt-1 min-h-9 resize-none"
            rows={1}
            placeholder="What the money was spent on"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="sm:col-span-2 xl:col-span-1">
          <label className={fieldLabel} htmlFor="exp-note">
            Note (optional)
          </label>
          <Input
            id="exp-note"
            className="mt-1 h-9"
            placeholder="Anything worth remembering"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex items-end">
          <Button
            type="submit"
            disabled={busy}
            className="h-9 w-full rounded-lg"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Record expense
          </Button>
        </div>
      </div>

      <p className="border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
        {money(num(amount))} will be debited to{" "}
        <span className="font-medium text-foreground">
          {category || "the expense account"}
        </span>{" "}
        and credited to{" "}
        <span className="font-medium text-foreground">
          {payFrom.find((a) => a.id === paidFrom)?.name ?? "Cash"}
        </span>
        .
      </p>
    </form>
  );
}

/**
 * Expenses, split in two.
 *
 * A business asks its expenses two different questions: what did it cost to
 * make the product, and what did it cost to run the business. The chart of
 * accounts answers both from one set of postings, so the register here lets
 * the reader answer either — the separating button switches which half is on
 * screen, and the two tiles above always show both so neither side is hidden.
 */
export default function ExpenseEnteringPanel() {
  const expenses = useQuery(api.expenses.list);
  const removeExpense = useMutation(api.expenses.remove);
  const postMissing = useMutation(api.expenses.postMissing);
  const { confirm } = useAppDialogs();
  const { format: money } = useWorkspaceCurrency();

  /** Which half of the register is on screen. */
  const [kind, setKind] = useState<ExpenseKind>("indirect");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState<Id<"expenses"> | null>(null);
  const [repairing, setRepairing] = useState(false);

  const rows = expenses ?? [];
  const direct = rows.filter((e) => e.kind === "direct");
  const indirect = rows.filter((e) => e.kind === "indirect");
  const directTotal = direct.reduce((s, e) => s + e.amount, 0);
  const indirectTotal = indirect.reduce((s, e) => s + e.amount, 0);
  const shown = kind === "direct" ? direct : indirect;

  const repair = async () => {
    setRepairing(true);
    try {
      const { posted, skipped } = await postMissing({});
      if (posted > 0) {
        toast.success(
          `Posted ${posted} missing ${posted === 1 ? "entry" : "entries"} to the chart of accounts.`,
        );
      }
      if (skipped.length > 0) {
        toast.error(`Couldn't post: ${skipped.join("; ")}.`);
      }
      if (posted === 0 && skipped.length === 0) {
        toast.success("Every expense is already in the accounts.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Couldn't post the missing entries.",
      );
    } finally {
      setRepairing(false);
    }
  };

  const drop = async (expense: Doc<"expenses">) => {
    const ok = await confirm({
      title: "Remove this expense?",
      message: `The ${money(expense.amount)} ${expense.category.toLowerCase()} entry is deleted and its ledger entry is reversed.`,
      confirmLabel: "Remove expense",
      danger: true,
    });
    if (!ok) return;
    setBusy(expense._id);
    try {
      await removeExpense({ id: expense._id });
      toast.success("Expense removed and its ledger entry reversed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't remove the expense.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (formOpen) {
    return <ExpenseForm kind={kind} onClose={() => setFormOpen(false)} />;
  }

  return (
    <div className="space-y-4">
      {/* Both halves always shown, whichever one is open. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Tile
          label="Direct expenses"
          value={money(directTotal)}
          tone={LOSS}
          hint={`${direct.length} ${direct.length === 1 ? "entry" : "entries"}`}
        />
        <Tile
          label="Indirect expenses"
          value={money(indirectTotal)}
          tone={LOSS}
          hint={`${indirect.length} ${indirect.length === 1 ? "entry" : "entries"}`}
        />
        <Tile
          label="Total spent"
          value={money(directTotal + indirectTotal)}
          hint={`${rows.length} entries recorded`}
        />
      </div>

      {/* The separating button: which half is on screen. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {KIND_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              title={KIND_HINT[k]}
              className={cn(
                "flex h-9 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors",
                kind === k
                  ? "border-primary/30 bg-primary/[0.06] text-primary"
                  : "bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {k === "direct" ? (
                <Wallet className="size-4" />
              ) : (
                <FileSpreadsheet className="size-4" />
              )}
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            className="h-9 rounded-xl px-3 text-sm"
            onClick={() => setFormOpen(true)}
          >
            <Plus className="size-4" /> New expense
          </Button>
        </div>
      </div>

      {shown.some((e) => e.entryId === undefined) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>
              {shown.filter((e) => e.entryId === undefined).length}
            </strong>{" "}
            expense
            {shown.filter((e) => e.entryId === undefined).length === 1
              ? " has"
              : "s have"}{" "}
            not reached the chart of accounts.
          </span>
          <button
            type="button"
            onClick={() => void repair()}
            disabled={repairing}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
          >
            {repairing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-3.5" />
            )}
            Post to accounts
          </button>
        </div>
      )}

      <Panel
        title={KIND_LABEL[kind]}
        count={`${shown.length} ${shown.length === 1 ? "entry" : "entries"} · ${money(kind === "direct" ? directTotal : indirectTotal)} recorded`}
      >
        {expenses === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading expenses…
          </div>
        ) : shown.length === 0 ? (
          <Empty>
            No {kind} expenses recorded yet. Use{" "}
            <button
              type="button"
              className="font-medium text-primary underline"
              onClick={() => setFormOpen(true)}
            >
              New expense
            </button>{" "}
            to record one — {KIND_HINT[kind].toLowerCase()}.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Date</th>
                  <th className={CELL_LEFT}>Account</th>
                  <th className={CELL_LEFT}>Description</th>
                  <th className={CELL_LEFT}>Paid to</th>
                  <th className={CELL_LEFT}>From</th>
                  <th className={CELL}>Amount</th>
                  <th className={CELL_LEFT}>Journal</th>
                  <th className="w-12 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {shown.map((e) => (
                  <tr key={e._id} className={ROW}>
                    <td className={`${CELL_LEFT} text-muted-foreground`}>
                      {day(e.at)}
                    </td>
                    <td className={`${CELL_LEFT} font-medium`}>
                      {e.category}
                      {e.categoryCode && (
                        <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                          {e.categoryCode}
                        </span>
                      )}
                    </td>
                    <td className={`${CELL_LEFT} text-muted-foreground`}>
                      {e.description || e.note || "—"}
                    </td>
                    <td className={`${CELL_LEFT} text-muted-foreground`}>
                      {e.vendor || "—"}
                    </td>
                    <td className={`${CELL_LEFT} text-muted-foreground`}>
                      {e.paidFromName ?? "—"}
                    </td>
                    <td className={CELL}>{money(e.amount)}</td>
                    <td className={CELL_LEFT}>
                      {e.entryNumber ? (
                        <span
                          className="font-mono text-muted-foreground"
                          title="Posted to the chart of accounts"
                        >
                          {e.entryNumber}
                        </span>
                      ) : (
                        <span
                          className="text-amber-600 dark:text-amber-400"
                          title="Not in the chart of accounts yet — use “Post to accounts” above"
                        >
                          not posted
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        type="button"
                        aria-label="Remove expense"
                        disabled={busy === e._id}
                        onClick={() => void drop(e)}
                        className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                      >
                        {busy === e._id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT} colSpan={5}>
                    Total {kind} expenses
                  </td>
                  <td className={CELL}>
                    {money(kind === "direct" ? directTotal : indirectTotal)}
                  </td>
                  <td className={CELL_LEFT} colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
