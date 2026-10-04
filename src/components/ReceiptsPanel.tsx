import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  HandCoins,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { toLocalInput } from "@/lib/task-utils";
import { useAppDialogs } from "@/components/AppDialogs";
import SalesPageHeading from "@/components/SalesPageHeading";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

type ReceiptDoc = Doc<"receipts">;

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const FIELD =
  "text-[11px] font-semibold tracking-widest text-muted-foreground uppercase";
const selectCls =
  "mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

/**
 * How the panel is asked to open: a blank receipt, or one settled against a
 * chosen invoice.
 */
export type ReceiptSeed =
  | { mode: "new" }
  | { mode: "forInvoice"; invoiceId: Id<"sales"> };

/**
 * Records one receipt, full screen. Money in is a document like any other: who
 * paid, how much, when, and which account it landed in. Naming the invoice it
 * settles clears that invoice, so what is still owed follows from the receipts
 * on file rather than a flag on the invoice.
 */
function ReceiptForm({
  seed,
  canCreate,
  onClose,
}: {
  seed: ReceiptSeed | null;
  canCreate: boolean;
  onClose: () => void;
}) {
  const options = useQuery(api.receipts.options);
  const customers = useQuery(api.contacts.listCustomers);
  const sales = useQuery(api.sales.listSales);
  const createReceipt = useMutation(api.receipts.create);
  const { format: money } = useWorkspaceCurrency();

  const seedInvoiceId =
    seed !== null && seed.mode === "forInvoice" ? seed.invoiceId : null;
  const seedInvoice = sales?.find((s) => s._id === seedInvoiceId);

  const [invoiceId, setInvoiceId] = useState<Id<"sales"> | "">(seedInvoiceId ?? "");
  const [customerId, setCustomerId] = useState<Id<"customers"> | "">(
    seedInvoice?.customerId ?? "",
  );
  const [customerName, setCustomerName] = useState(seedInvoice?.customerName ?? "");
  const [at, setAt] = useState(() => toLocalInput(new Date()));
  const [amount, setAmount] = useState(seedInvoice ? String(seedInvoice.total) : "");
  const [into, setInto] = useState<Id<"accounts"> | "">("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const invoices = options?.invoices ?? [];
  const chosen = invoices.find((i) => i.id === invoiceId);

  /** Pick the invoice being settled — it decides the customer and the outstanding balance. */
  const pickInvoice = (id: Id<"sales"> | "") => {
    setInvoiceId(id);
    const invoice = invoices.find((i) => i.id === id);
    if (!invoice) return;
    setCustomerName(invoice.customer ?? "");
    // Pre-fill with the outstanding balance, not the full total
    setAmount(String(invoice.balance));
    const sale = sales?.find((s) => s._id === id);
    if (sale?.customerId !== undefined) setCustomerId(sale.customerId);
  };

  const clear = () => {
    setInvoiceId("");
    setCustomerId("");
    setCustomerName("");
    setAt(toLocalInput(new Date()));
    setAmount("");
    setInto("");
    setReference("");
    setNote("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(num(amount) > 0)) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    setBusy(true);
    try {
      await createReceipt({
        invoiceId: invoiceId === "" ? undefined : invoiceId,
        customerId: customerId === "" ? undefined : customerId,
        customerName: customerName.trim() || undefined,
        at: new Date(`${at}T12:00:00`).getTime(),
        amount: num(amount),
        receivedInto: into === "" ? undefined : into,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      toast.success(
        chosen
          ? "Receipt recorded — the invoice is settled and the ledger updated."
          : "Receipt recorded and posted to the ledger.",
      );
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't record the receipt.",
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
            <ArrowLeft className="size-3.5" /> Receipts
          </Button>
          <h2 className="font-display text-lg font-semibold">Record a receipt</h2>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              onClick={clear}
            >
              Clear
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy}
              className="h-8 rounded-lg text-xs"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Record receipt
            </Button>
          </div>
        )}
      </div>

      <p className="border-b border-border/60 px-5 py-2.5 text-xs text-muted-foreground">
        Money received from a customer. Settling an invoice in full clears it;
        a part payment leaves the rest of the debt standing.
      </p>

      <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-2">
        <label className="block">
          <span className={FIELD}>Settling an invoice (optional)</span>
          <select
            value={invoiceId}
            onChange={(e) => pickInvoice(e.target.value as Id<"sales"> | "")}
            className={selectCls}
          >
            <option value="">Not against an invoice</option>
            {invoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.number} · {i.customer ?? "Walk-in"} ·{" "}
                {(i as { amountPaid?: number }).amountPaid
                  ? `${money((i as { balance: number }).balance)} due (${money((i as { amountPaid: number }).amountPaid)} paid of ${money(i.total)})`
                  : money(i.total)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={FIELD}>Received on</span>
          <Input
            type="date"
            value={at}
            onChange={(e) => setAt(e.target.value)}
            className="mt-1 h-9 rounded-lg text-sm"
          />
        </label>
        <label className="block">
          <span className={FIELD}>
            Amount{chosen ? ` (max ${money((chosen as { balance?: number }).balance ?? chosen.total)})` : ""}
          </span>
          <Input
            type="number"
            min="0"
            step="any"
            max={chosen ? (chosen as { balance?: number }).balance ?? chosen.total : undefined}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="mt-1 h-9 rounded-lg text-right text-sm"
          />
        </label>
        <label className="block">
          <span className={FIELD}>Received into</span>
          <select
            value={into}
            onChange={(e) => setInto(e.target.value as Id<"accounts"> | "")}
            className={selectCls}
          >
            <option value="">Cash in hand (default)</option>
            {(options?.accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={FIELD}>Paid by</span>
          <select
            value={customerId}
            onChange={(e) => {
              const id = e.target.value as Id<"customers"> | "";
              setCustomerId(id);
              const found = (customers ?? []).find((c) => c._id === id);
              if (found) setCustomerName(found.name);
            }}
            className={selectCls}
          >
            <option value="">Not listed</option>
            {(customers ?? []).map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={FIELD}>Reference</span>
          <Input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Cheque or transfer no."
            className="mt-1 h-9 rounded-lg text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 px-5 py-4">
        <label className="block min-w-[240px] flex-1">
          <span className={FIELD}>Note</span>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Anything worth remembering later…"
            className="mt-1"
          />
        </label>
        <div className="space-y-1.5 text-sm">
          {/* Balance summary for chosen invoice */}
          {chosen && (chosen as { amountPaid?: number }).amountPaid !== undefined && (chosen as { amountPaid: number }).amountPaid > 0 && (
            <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10 px-3 py-2 text-xs">
              <div className="flex flex-wrap gap-3 tabular-nums">
                <span><span className="font-medium">Total:</span> {money(chosen.total)}</span>
                <span><span className="font-medium">Paid:</span> <span className="text-emerald-600 dark:text-emerald-400">{money((chosen as { amountPaid: number }).amountPaid)}</span></span>
                <span><span className="font-medium text-amber-700 dark:text-amber-400">Due:</span> <span className="font-semibold text-amber-700 dark:text-amber-400">{money((chosen as { balance: number }).balance)}</span></span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-6 text-muted-foreground">
            <span>Received from</span>
            <span>{customerName.trim() || "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-6 text-muted-foreground">
            <span>Invoice</span>
            <span className="font-mono text-xs">
              {chosen?.number ?? "Not against one"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-6 border-t border-border pt-2 text-base font-semibold">
            <span>Amount</span>
            <span className="tabular-nums">{money(num(amount))}</span>
          </div>
        </div>
      </div>
    </form>
  );
}

/**
 * The receipt register: money in from customers. Every row is a balanced
 * journal entry, so deleting one takes its entry with it and the accounts stay
 * true.
 */
export default function ReceiptsPanel({
  canCreate,
  canDelete,
  seed = null,
}: {
  canCreate: boolean;
  canDelete: boolean;
  /** Opens the form against a chosen invoice. */
  seed?: ReceiptSeed | null;
}) {
  const receipts = useQuery(api.receipts.list);
  const removeReceipt = useMutation(api.receipts.remove);
  const { confirm } = useAppDialogs();
  const { format: money } = useWorkspaceCurrency();
  const [formOpen, setFormOpen] = useState(canCreate && seed !== null);
  const [busy, setBusy] = useState<Id<"receipts"> | null>(null);

  const rows = receipts ?? [];
  const received = rows.reduce((sum, r) => sum + r.amount, 0);
  const monthStart = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }, []);
  const thisMonth = rows
    .filter((r) => r.at >= monthStart)
    .reduce((sum, r) => sum + r.amount, 0);

  const drop = async (receipt: ReceiptDoc) => {
    const ok = await confirm({
      title: `Delete ${receipt.number}?`,
      message: `The ${money(receipt.amount)} receipt is removed and its ledger entry is reversed. Any invoice it settled is open again.`,
      confirmLabel: "Delete receipt",
      danger: true,
    });
    if (!ok) return;
    setBusy(receipt._id);
    try {
      await removeReceipt({ id: receipt._id });
      toast.success("Receipt removed and its ledger entry reversed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't remove the receipt.",
      );
    } finally {
      setBusy(null);
    }
  };

  if (formOpen && canCreate) {
    return (
      <div className="space-y-4">
        <SalesPageHeading
          title="Receipts"
          hint="Money received from customers, and what is still owed."
        />
        <ReceiptForm
          key={seed !== null && seed.mode === "forInvoice" ? seed.invoiceId : "new"}
          seed={seed}
          canCreate={canCreate}
          onClose={() => setFormOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SalesPageHeading
        title="Receipts"
        hint={`${rows.length} receipt${rows.length === 1 ? "" : "s"} · ${money(received)} received · ${money(thisMonth)} this month`}
      >
        {canCreate && (
          <Button
            type="button"
            size="sm"
            onClick={() => setFormOpen(true)}
            className="h-9 rounded-xl px-3 text-sm"
          >
            <Plus className="size-4" /> Add receipt
          </Button>
        )}
      </SalesPageHeading>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {receipts === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading receipts…
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <HandCoins className="mx-auto size-7 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">Nothing received yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Record money as it comes in — settling an invoice here clears it
              and posts the entry.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  <th className="w-28 px-3 py-2">Receipt</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="w-28 px-3 py-2">Settles</th>
                  <th className="w-24 px-3 py-2">Received</th>
                  <th className="w-32 px-3 py-2">Into</th>
                  <th className="w-28 px-3 py-2 text-right">Amount</th>
                  <th className="w-24 px-3 py-2">Journal</th>
                  <th className="w-12 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((r) => (
                  <tr key={r._id} className="transition-colors hover:bg-accent/40">
                    <td className="px-3 py-2 font-mono text-xs">{r.number}</td>
                    <td className="px-3 py-2 font-medium">
                      {r.customerName || "—"}
                      {r.reference && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {r.reference}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {r.invoiceNumber ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {day(r.at)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.receivedIntoName ?? "Cash in hand"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.amount)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.entryNumber ? (
                        <span
                          className="font-mono text-muted-foreground"
                          title="Posted to the chart of accounts"
                        >
                          {r.entryNumber}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">
                          not posted
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {canDelete && (
                        <button
                          type="button"
                          aria-label="Delete receipt"
                          disabled={busy === r._id}
                          onClick={() => void drop(r)}
                          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          {busy === r._id ? (
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
    </div>
  );
}
