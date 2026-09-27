import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { toLocalInput } from "@/lib/task-utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const selectCls =
  "h-9 rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

/** Records one expense, which posts straight to the ledger. */
function ExpenseForm({ onClose }: { onClose: () => void }) {
  const options = useQuery(api.expenses.options);
  const vendors = useQuery(api.contacts.listVendors);
  const createExpense = useMutation(api.expenses.create);
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
  const chosen = categories.find((c) => c.id === category) ?? categories[0];
  const vendor = vendors?.find((v) => v._id === vendorId);

  const submit = async () => {
    if (!chosen) {
      toast.error("Set up an expense account first — add one in Accounting.");
      return;
    }
    if (!(num(amount) > 0)) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    try {
      await createExpense({
        at: new Date(`${at}T12:00:00`).getTime(),
        category: chosen.name,
        description: description.trim() || undefined,
        amount: num(amount),
        paidFrom: paidFrom === "" ? undefined : paidFrom,
        vendorId: vendorId === "" ? undefined : vendorId,
        vendor: vendor?.name,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.success("Expense recorded and posted to the ledger.");
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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(100%,560px)]">
        <DialogHeader>
          <DialogTitle>Record an expense</DialogTitle>
          <DialogDescription>
            Money spent that is not stock — transport, rent, wages, utilities. It
            is written to the ledger as you save, so the accounts always add up.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Date</span>
            <Input
              type="date"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className="h-9"
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Amount</span>
            <Input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-9 text-right"
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Spent on</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={selectCls}
            >
              <option value="">Choose an expense account…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Paid from</span>
            <select
              value={paidFrom}
              onChange={(e) => setPaidFrom(e.target.value as Id<"accounts"> | "")}
              className={selectCls}
            >
              <option value="">Cash in hand (default)</option>
              {(options?.payFrom ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="space-y-1 text-xs font-medium">
          <span className="text-muted-foreground">Description</span>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Delivery charges for the March order"
            className="h-9"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Paid to</span>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value as Id<"vendors"> | "")}
              className={selectCls}
            >
              <option value="">Nobody in particular</option>
              {(vendors ?? []).map((v) => (
                <option key={v._id} value={v._id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Receipt no.</span>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional"
              className="h-9"
            />
          </label>
        </div>

        <label className="space-y-1 text-xs font-medium">
          <span className="text-muted-foreground">Note</span>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Anything worth remembering later…"
          />
        </label>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} className="rounded-lg">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Record expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The expense register: money out that never touched stock. Every row is a
 * balanced journal entry, so deleting one takes its entry with it and the
 * accounts stay true.
 */
export default function ExpensesPanel({
  canCreate,
  canDelete,
  formOpen,
  onFormOpenChange,
}: {
  canCreate: boolean;
  canDelete: boolean;
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
}) {
  const expenses = useQuery(api.expenses.list);
  const totals = useQuery(api.expenses.byCategory);
  const removeExpense = useMutation(api.expenses.remove);
  const postMissing = useMutation(api.expenses.postMissing);
  const { format: money } = useWorkspaceCurrency();
  const [busy, setBusy] = useState<Id<"expenses"> | null>(null);

  const rows = expenses ?? [];
  const spent = rows.reduce((sum, e) => sum + e.amount, 0);
  /** Rows recorded before the register wrote to the ledger, or lost to a fault. */
  const unposted = rows.filter((e) => e.entryId === undefined);
  const [repairing, setRepairing] = useState(false);

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
        error instanceof Error ? error.message : "Couldn't post the missing entries.",
      );
    } finally {
      setRepairing(false);
    }
  };

  const drop = async (id: Id<"expenses">) => {
    setBusy(id);
    try {
      await removeExpense({ id });
      toast.success("Expense removed and its ledger entry reversed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't remove the expense.",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {unposted.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>
              {unposted.length} expense{unposted.length === 1 ? "" : "s"}
            </strong>{" "}
            {unposted.length === 1 ? "has" : "have"} not reached the chart of
            accounts.
          </span>
          <button
            type="button"
            onClick={() => void repair()}
            disabled={repairing}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
          >
            {repairing ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-3" />
            )}
            Post to accounts
          </button>
        </div>
      )}

      {(totals?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {totals?.map((t) => (
            <span
              key={t.category}
              className="rounded-full border bg-card px-2.5 py-1 text-[11px]"
            >
              <span className="text-muted-foreground">{t.category} </span>
              <span className="font-medium tabular-nums">{money(t.amount)}</span>
            </span>
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <h2 className="text-sm font-semibold">
            Expenses
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {rows.length} entr{rows.length === 1 ? "y" : "ies"} · {money(spent)} spent
            </span>
          </h2>
          {canCreate && (
            <button
              type="button"
              onClick={() => onFormOpenChange(true)}
              aria-label="Record expense"
              title="Record expense"
              className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>

        {expenses === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading expenses…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Wallet className="mx-auto size-7 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">Nothing recorded yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Log what you spend outside stock — each one lands in the ledger as a
              debit against the matching expense account.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  <th className="w-28 px-3 py-2">Date</th>
                  <th className="w-40 px-3 py-2">Category</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="w-40 px-3 py-2">Paid to</th>
                  <th className="w-32 px-3 py-2">From</th>
                  <th className="w-28 px-3 py-2 text-right">Amount</th>
                  <th className="w-24 px-3 py-2">Journal</th>
                  <th className="w-12 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((e) => (
                  <tr key={e._id} className="transition-colors hover:bg-accent/40">
                    <td className="px-3 py-2 text-xs text-muted-foreground">{day(e.at)}</td>
                    <td className="px-3 py-2 font-medium">{e.category}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.description || e.note || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.vendor || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.paidFromName ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(e.amount)}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.entryNumber ? (
                        <span
                          className="font-mono text-muted-foreground"
                          title="Posted to the chart of accounts — open Accounts → Journal entry to see it"
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
                      {canDelete && (
                        <button
                          type="button"
                          aria-label="Remove expense"
                          disabled={busy === e._id}
                          onClick={() => void drop(e._id)}
                          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          {busy === e._id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formOpen && canCreate && <ExpenseForm onClose={() => onFormOpenChange(false)} />}
    </div>
  );
}
