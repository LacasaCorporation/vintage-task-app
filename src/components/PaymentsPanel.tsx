import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  HandCoins,
  Link2,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { formatDueLabel, toLocalInput } from "@/lib/task-utils";
import { useAppDialogs } from "@/components/AppDialogs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const FIELD =
  "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30";

/** A payment to a supplier, opened with the vendor already chosen. */
export type PaymentSeed = { vendorId?: Id<"vendors">; vendor?: string } | null;

/**
 * Payments: money paid out to suppliers. Supports partial payments — a single
 * bill can be settled across multiple payments. Each payment accumulates into
 * the bill's `amountPaid`; the bill is only marked paid when fully covered.
 */
export default function PaymentsPanel({
  canCreate,
  canDelete,
  seed = null,
}: {
  canCreate: boolean;
  canDelete: boolean;
  seed?: PaymentSeed;
}) {
  const payments = useQuery(api.payments.list);
  const options = useQuery(api.payments.options);
  const vendors = useQuery(api.contacts.listVendors);
  const { format: money } = useWorkspaceCurrency();
  const { confirm } = useAppDialogs();
  const createPayment = useMutation(api.payments.create);
  const removePayment = useMutation(api.payments.remove);

  const [formOpen, setFormOpen] = useState(seed !== null && canCreate);
  const [vendorId, setVendorId] = useState<Id<"vendors"> | "">(seed?.vendorId ?? "");
  const [amount, setAmount] = useState("");
  const [at, setAt] = useState(todayInput());
  const [paidFrom, setPaidFrom] = useState<Id<"accounts"> | "">("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [billId, setBillId] = useState<Id<"purchases"> | "">("");
  const [busy, setBusy] = useState(false);

  const unpaidBills = options?.bills ?? [];
  const accounts = options?.accounts ?? [];

  const total = useMemo(
    () => (payments ?? []).reduce((sum, p) => sum + p.amount, 0),
    [payments],
  );

  const resetForm = () => {
    setVendorId("");
    setAmount("");
    setAt(todayInput());
    setPaidFrom("");
    setReference("");
    setNote("");
    setBillId("");
  };

  /** Choosing a bill fills in the vendor and the outstanding balance. */
  const pickBill = (id: string) => {
    setBillId(id as Id<"purchases"> | "");
    if (id === "") return;
    const bill = unpaidBills.find((b) => b.id === id);
    if (bill === undefined) return;
    // Pre-fill with the outstanding balance, not the full total
    setAmount(String(bill.balance));
    const match = (vendors ?? []).find((v) => v.name === (bill.supplier ?? ""));
    setVendorId(match?._id ?? "");
  };

  const submit = async () => {
    if (!(num(amount) > 0)) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    if (vendorId === "" && billId === "") {
      toast.error("Choose the supplier, or the bill this payment settles.");
      return;
    }
    setBusy(true);
    try {
      await createPayment({
        vendorId: vendorId === "" ? undefined : vendorId,
        vendor: (vendors ?? []).find((v) => v._id === vendorId)?.name,
        amount: num(amount),
        at: new Date(`${at}T12:00:00`).getTime(),
        paidFrom: paidFrom === "" ? undefined : paidFrom,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        billId: billId === "" ? undefined : billId,
      });

      // Check if bill is now fully settled
      const bill = billId !== "" ? unpaidBills.find((b) => b.id === billId) : undefined;
      const remaining = bill ? Math.max(0, bill.balance - num(amount)) : 0;
      if (bill && remaining < 0.01) {
        toast.success("Payment recorded — bill is now fully settled.");
      } else if (bill) {
        toast.success(`Partial payment recorded. ${money(remaining)} still outstanding.`);
      } else {
        toast.success("Payment recorded and posted to the ledger.");
      }
      resetForm();
      setFormOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't record the payment.",
      );
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = async (payment: { _id: Id<"payments">; number: string; billId?: Id<"purchases"> }) => {
    const ok = await confirm({
      title: `Delete ${payment.number}?`,
      message:
        "The payment's ledger entry is reversed and the bill's paid amount is reduced.",
      confirmLabel: "Delete payment",
      danger: true,
    });
    if (!ok) return;
    try {
      await removePayment({ id: payment._id });
      toast.success(`${payment.number} deleted.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the payment.",
      );
    }
  };

  const billInfoOf = (id: Id<"purchases">) => {
    const b = unpaidBills.find((b) => b.id === id);
    return b ? `${b.number}` : undefined;
  };

  /* ── the payment form, full-screen ────────────────────────────── */
  if (formOpen) {
    const chosenBill = billId !== "" ? unpaidBills.find((b) => b.id === billId) : undefined;

    return (
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              onClick={() => {
                resetForm();
                setFormOpen(false);
              }}
            >
              <ArrowLeft className="size-3.5" /> Payments
            </Button>
            <h2 className="font-display text-lg font-semibold">New payment</h2>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => void submit()}
            className="h-8 rounded-lg text-xs"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Record payment
          </Button>
        </div>

        <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Supplier</span>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value as Id<"vendors"> | "")}
              className={FIELD}
            >
              <option value="">Choose a supplier…</option>
              {(vendors ?? []).map((v) => (
                <option key={v._id} value={v._id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Settling a bill (optional)</span>
            <select
              value={billId}
              onChange={(e) => pickBill(e.target.value)}
              className={FIELD}
            >
              <option value="">Not against a bill</option>
              {unpaidBills.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.number} · {b.supplier || "No supplier"} ·{" "}
                  {b.amountPaid > 0
                    ? `${money(b.balance)} due (${money(b.amountPaid)} paid of ${money(b.total)})`
                    : money(b.total)}
                </option>
              ))}
            </select>
          </label>

          {/* Balance indicator for chosen bill */}
          {chosenBill && (
            <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10 px-3 py-2 text-xs">
              <div className="flex flex-wrap gap-4 tabular-nums">
                <span>
                  <span className="font-medium">Bill total:</span>{" "}
                  <span>{money(chosenBill.total)}</span>
                </span>
                <span>
                  <span className="font-medium">Already paid:</span>{" "}
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {money(chosenBill.amountPaid)}
                  </span>
                </span>
                <span>
                  <span className="font-medium text-amber-700 dark:text-amber-400">
                    Outstanding balance:
                  </span>{" "}
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {money(chosenBill.balance)}
                  </span>
                </span>
              </div>
            </div>
          )}

          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">
              Amount{chosenBill ? ` (max ${money(chosenBill.balance)})` : ""}
            </span>
            <Input
              type="number"
              min="0"
              step="any"
              max={chosenBill ? chosenBill.balance : undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-9 text-right"
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Paid on</span>
            <Input
              type="date"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className="h-9"
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Paid from</span>
            <select
              value={paidFrom}
              onChange={(e) => setPaidFrom(e.target.value as Id<"accounts"> | "")}
              className={FIELD}
            >
              <option value="">Cash in hand (default)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Reference</span>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Cheque / transfer no."
              className="h-9"
            />
          </label>
          <label className="space-y-1 text-xs font-medium sm:col-span-2">
            <span className="text-muted-foreground">Note</span>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Anything worth remembering later…"
            />
          </label>
        </div>

        <p className="border-t border-border/60 px-5 py-3 text-xs text-muted-foreground">
          Partial payments are supported — the bill stays open until it is fully
          covered. Each payment posts to the ledger immediately.
        </p>
      </div>
    );
  }

  /* ── the register ─────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Supplier payments
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {payments?.length ?? 0} payment{(payments?.length ?? 0) === 1 ? "" : "s"} ·{" "}
            {money(total)} paid out
          </span>
        </h2>
        {canCreate && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              resetForm();
              setFormOpen(true);
            }}
            className="h-9 rounded-xl px-3 text-sm"
          >
            <Plus className="size-4" /> Record payment
          </Button>
        )}
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {payments === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading payments…
          </div>
        ) : payments.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <HandCoins className="mx-auto size-7 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">No payments yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Record what leaves the till to a supplier — partial and full
              payments are both supported.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                  <th className="px-4 py-2 text-left font-medium">Payment</th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Supplier</th>
                  <th className="px-3 py-2 text-left font-medium">Settles</th>
                  <th className="px-3 py-2 text-left font-medium">From</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Journal</th>
                  <th className="w-12 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {payments.map((p) => (
                  <tr key={p._id} className="transition-colors hover:bg-accent/40">
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {p.number}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                      {formatDueLabel(p.at)}
                    </td>
                    <td className="px-3 py-2.5 font-medium">{p.vendor || "—"}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {p.billId !== undefined ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Link2 className="size-2.5" />
                          {billInfoOf(p.billId) ?? "a bill"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {p.paidFromName ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                      {money(p.amount)}
                    </td>
                    <td className="px-3 py-2.5 text-xs">
                      {p.entryNumber ? (
                        <span
                          className="font-mono text-muted-foreground"
                          title="Posted to the chart of accounts"
                        >
                          {p.entryNumber}
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
                          aria-label={`Delete ${p.number}`}
                          title="Delete payment"
                          onClick={() => void confirmRemove(p)}
                          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
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

function todayInput() {
  return toLocalInput(new Date());
}
