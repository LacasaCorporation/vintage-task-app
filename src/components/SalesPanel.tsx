import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  Eye,
  FileText,
  List,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Save,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { toLocalInput } from "@/lib/task-utils";

type FgDoc = Doc<"finishedGoods">;
type QuotationDoc = Doc<"quotations">;
type SaleDoc = Doc<"sales">;
type CustomerDoc = Doc<"customers">;

type Tab = "sales" | "quotes" | "bill" | "quote" | "customers";

/** One line being typed on the new document. */
type DraftLine = { productId: Id<"finishedGoods"> | ""; qty: string; price: string };

const emptyLine = (): DraftLine => ({ productId: "", qty: "1", price: "" });
const todayInput = () => toLocalInput(new Date());
const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const QUOTE_STATUS: Record<
  NonNullable<QuotationDoc["status"]>,
  { label: string; chip: string }
> = {
  draft: { label: "Draft", chip: "bg-muted text-muted-foreground" },
  sent: { label: "Sent", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  accepted: { label: "Accepted", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "Rejected", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
};

const chipBase =
  "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium";

/**
 * Sales module: quotations and sales bills, laid out like the purchase module
 * so the two halves of buying and selling sit side by side. A quotation is an
 * offer; turning it into a bill copies its lines across.
 */
export default function SalesPanel({
  products,
  canCreate,
  canEdit,
  canDelete,
}: {
  products: FgDoc[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const quotations = useQuery(api.sales.listQuotations);
  const sales = useQuery(api.sales.listSales);
  const customers = useQuery(api.contacts.listCustomers);
  const { format: money } = useWorkspaceCurrency();

  const createQuote = useMutation(api.sales.createQuotation);
  const setQuoteStatus = useMutation(api.sales.updateQuotation);
  const convertQuote = useMutation(api.sales.convertToSale);
  const dropQuote = useMutation(api.sales.removeQuotation);
  const createSale = useMutation(api.sales.createSale);
  const setSalePaid = useMutation(api.sales.setSalePaid);
  const dropSale = useMutation(api.sales.removeSale);

  const [tab, setTab] = useState<Tab>("sales");
  const [viewingSale, setViewingSale] = useState<Id<"sales"> | null>(null);
  const [viewingQuote, setViewingQuote] = useState<Id<"quotations"> | null>(null);
  const [draft, setDraft] = useState<DraftLine[]>([emptyLine()]);
  const [customerId, setCustomerId] = useState<Id<"customers"> | "">("");
  const [customerName, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [date, setDate] = useState(todayInput());
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const resetForm = () => {
    setDraft([emptyLine()]);
    setCustomerId("");
    setCustomerName("");
    setAddress("");
    setDate(todayInput());
    setNote("");
    setDiscount("0");
    setTax("0");
  };

  const customerOf = (id: Id<"customers"> | "") =>
    (customers ?? []).find((c) => c._id === id);

  /** Price the draft the same way the server will, so the total is honest. */
  const draftTotals = useMemo(() => {
    let total = 0;
    for (const line of draft) {
      if (line.productId === "") continue;
      total += num(line.qty) * num(line.price);
    }
    const d = Math.min(100, Math.max(0, num(discount)));
    const t = Math.max(0, num(tax));
    const grand = total - (total * d) / 100 + ((total * (100 - d)) / 100) * (t / 100);
    return { total, grand: Math.round(grand * 100) / 100 };
  }, [draft, discount, tax]);

  const openQuote = quotations?.find((q) => q._id === viewingQuote) ?? null;
  const openSale = sales?.find((s) => s._id === viewingSale) ?? null;

  const submit = async (kind: "quotation" | "sale") => {
    const lines = draft
      .filter((l) => l.productId !== "")
      .map((l) => ({
        productId: l.productId as Id<"finishedGoods">,
        qty: num(l.qty),
        unitPrice: num(l.price),
      }));
    if (lines.length === 0) {
      toast.error("Add at least one product.");
      return;
    }
    if (lines.some((l) => l.qty <= 0)) {
      toast.error("Every line needs a quantity above zero.");
      return;
    }
    const customer = customerId === "" ? undefined : (customerId as Id<"customers">);
    const name = customerOf(customerId)?.name ?? customerName.trim();
    if (!name) {
      toast.error("Choose a customer or type a name.");
      return;
    }
    const at = date.trim() === "" ? Date.now() : new Date(date).getTime();
    setSaving(true);
    try {
      const common = {
        customerId: customer,
        customerName: name,
        customerAddress: address.trim() || undefined,
        discountPct: num(discount),
        taxPct: num(tax),
        note: note.trim() || undefined,
        lines,
      };
      if (kind === "quotation") {
        await createQuote({ ...common, quotedAt: at });
        toast.success(`Quotation raised for ${name}.`);
        setTab("quotes");
      } else {
        await createSale({ ...common, soldAt: at });
        toast.success(`Sales bill raised for ${name}.`);
        setTab("sales");
      }
      resetForm();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the document.",
      );
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (
    id: Id<"quotations">,
    status: NonNullable<QuotationDoc["status"]>,
  ) => {
    setBusyId(id);
    try {
      await setQuoteStatus({ id, status });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't update the quote.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const convert = async (quote: QuotationDoc) => {
    setBusyId(quote._id);
    try {
      await convertQuote({ id: quote._id });
      toast.success(`${quote.number} turned into a sales bill.`);
      setViewingQuote(null);
      setTab("sales");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't convert the quote.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const tabBtn = (id: Tab, label: string, Icon: typeof List) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        setTab(id);
        if (id === "sales") setViewingSale(null);
        if (id === "quotes") setViewingQuote(null);
        if (id === "bill" || id === "quote") resetForm();
      }}
      aria-pressed={tab === id}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
        tab === id
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );

  /** The document preview, shared by a quotation and a sales bill. */
  const documentView = (
    doc: { number: string; customerName?: string; total: number; lines: { name: string; qty: number; unitPrice: number; unit?: string }[]; note?: string; [k: string]: unknown },
    extra?: React.ReactNode,
  ) => (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm">{doc.number}</span>
        <span className="text-sm text-muted-foreground">
          {doc.customerName ?? "Customer"}
        </span>
        <span className="ml-auto font-display text-base font-bold tabular-nums text-primary">
          {money(doc.total)}
        </span>
      </div>
      <ul className="divide-y divide-border/60 rounded-xl border">
        {doc.lines.map((line, i) => (
          <li key={`${doc.number}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{line.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {line.qty} {line.unit ?? ""} × {money(line.unitPrice)}
            </span>
            <span className="w-24 text-right text-sm font-medium tabular-nums">
              {money(line.qty * line.unitPrice)}
            </span>
          </li>
        ))}
      </ul>
      {doc.note && <p className="text-xs text-muted-foreground">{doc.note}</p>}
      {extra}
    </div>
  );

  return (
    <div className="mt-4 space-y-4">
      {/* ── Header: the two lists, then the two entry forms ─────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
          {tabBtn("sales", `Sales bills (${sales?.length ?? 0})`, Receipt)}
          {tabBtn("quotes", `Quotations (${quotations?.length ?? 0})`, FileText)}
          {tabBtn("bill", "Sales bill entry", List)}
          {tabBtn("quote", "Quotation entry", Send)}
          {tabBtn("customers", `Customers (${customers?.length ?? 0})`, Users)}
        </div>
        {canCreate && (tab === "bill" || tab === "quote") && (
          <Button
            type="button"
            size="sm"
            onClick={() => void submit(tab === "quote" ? "quotation" : "sale")}
            disabled={saving}
            className="h-9 rounded-xl px-3 text-sm"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : tab === "quote" ? (
              <Send className="size-4" />
            ) : (
              <Save className="size-4" />
            )}
            {tab === "quote" ? "Save quotation" : "Save sales bill"}
          </Button>
        )}
      </div>

      {/* ── Sales bill list ─────────────────────────────────────────── */}
      {tab === "sales" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Sales list</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {money((sales ?? []).reduce((sum, s) => sum + s.total, 0))} invoiced
            </span>
          </div>
          {sales === undefined ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading sales…
            </div>
          ) : sales.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Receipt className="mx-auto size-7 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium">No sales bills yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use “Sales bill entry” to invoice a customer.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="px-4 py-2 text-left font-medium">Bill</th>
                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Items</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-center font-medium">Paid</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sales.map((sale: SaleDoc) => (
                    <tr
                      key={sale._id}
                      onClick={() => setViewingSale(sale._id)}
                      className="cursor-pointer transition-colors hover:bg-accent/40"
                    >
                      <td className="px-4 py-2 font-mono text-xs">{sale.number}</td>
                      <td className="px-3 py-2">{sale.customerName ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(sale.soldAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">
                        {sale.lines.length}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {money(sale.total)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span
                          className={cn(
                            chipBase,
                            sale.isPaid
                              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "border-border bg-muted text-muted-foreground",
                          )}
                        >
                          {sale.isPaid ? "Paid" : "Unpaid"}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        {canDelete && (
                        <button
                          type="button"
                          title="Delete sales bill"
                          aria-label={`Delete ${sale.number}`}
                          className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            void dropSale({ id: sale._id }).catch((error) =>
                              toast.error(
                                error instanceof Error
                                  ? error.message
                                  : "Couldn't delete the bill.",
                              ),
                            );
                          }}
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
      )}

      {/* ── Quotation list ──────────────────────────────────────────── */}
      {tab === "quotes" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Quotation list</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {money((quotations ?? []).reduce((sum, q) => sum + q.total, 0))} quoted
            </span>
          </div>
          {quotations === undefined ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading quotations…
            </div>
          ) : quotations.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <FileText className="mx-auto size-7 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium">No quotations yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use “Quotation entry” to price an offer for a customer.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="px-4 py-2 text-left font-medium">Quote</th>
                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Items</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {quotations.map((quote: QuotationDoc) => {
                    const status = QUOTE_STATUS[quote.status ?? "draft"];
                    return (
                      <tr
                        key={quote._id}
                        onClick={() => setViewingQuote(quote._id)}
                        className="cursor-pointer transition-colors hover:bg-accent/40"
                      >
                        <td className="px-4 py-2 font-mono text-xs">{quote.number}</td>
                        <td className="px-3 py-2">{quote.customerName ?? "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {new Date(quote.quotedAt).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn(chipBase, "border-transparent", status.chip)}>
                            {quote.invoicedAs !== undefined && (
                              <CheckCircle2 className="size-3" />
                            )}
                            {status.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">
                          {quote.lines.length}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {money(quote.total)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <button
                            type="button"
                            title="Delete quotation"
                            aria-label={`Delete ${quote.number}`}
                            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              void dropQuote({ id: quote._id }).catch((error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Couldn't delete the quotation.",
                                ),
                              );
                            }}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Entry form, shared by a quotation and a sales bill ──────── */}
      {(tab === "bill" || tab === "quote") && (
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Customer</label>
              <select
                value={customerId}
                onChange={(e) => {
                  const id = e.target.value as Id<"customers"> | "";
                  setCustomerId(id);
                  const c = customerOf(id);
                  if (c) setCustomerName(c.name);
                }}
                className="h-9 w-full rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">Type a name…</option>
                {(customers ?? []).map((c: CustomerDoc) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Name</label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Customer name"
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                {tab === "quote" ? "Quoted on" : "Sold on"}
              </label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 rounded-lg text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Address</label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Optional"
                className="h-9 rounded-lg text-sm"
              />
            </div>
          </div>

          {/* lines */}
          <div className="mt-3 space-y-1.5">
            {draft.map((line, i) => {
              return (
                <div key={i} className="flex flex-wrap items-center gap-1.5">
                  <select
                    value={line.productId}
                    onChange={(e) => {
                      const id = e.target.value as Id<"finishedGoods"> | "";
                      const next = [...draft];
                      next[i] = { ...line, productId: id };
                      setDraft(next);
                    }}
                    aria-label="Product"
                    className="h-9 min-w-[150px] flex-1 rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    <option value="">Choose product…</option>
                    {products.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name}
                        {p.unit ? ` (${p.unit})` : ""}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={line.qty}
                    onChange={(e) => {
                      const next = [...draft];
                      next[i] = { ...line, qty: e.target.value };
                      setDraft(next);
                    }}
                    aria-label="Quantity"
                    className="h-9 w-20 rounded-lg text-sm"
                  />
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={line.price}
                    onChange={(e) => {
                      const next = [...draft];
                      next[i] = { ...line, price: e.target.value };
                      setDraft(next);
                    }}
                    aria-label="Unit price"
                    placeholder="Price"
                    className="h-9 w-28 rounded-lg text-sm"
                  />
                  <span className="w-24 text-right text-sm font-medium tabular-nums">
                    {money(num(line.qty) * num(line.price))}
                  </span>
                  <button
                    type="button"
                    aria-label="Remove line"
                    title="Remove line"
                    className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:text-destructive"
                    onClick={() =>
                      setDraft(draft.length > 1 ? draft.filter((_, j) => j !== i) : [emptyLine()])
                    }
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft([...draft, emptyLine()])}
              className="h-8 rounded-lg text-xs"
            >
              <Plus className="size-3.5" /> Add line
            </Button>
          </div>

          {/* totals */}
          <div className="mt-3 grid gap-3 border-t border-border/60 pt-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Note</label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Optional"
                className="rounded-lg text-sm"
              />
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Discount %</label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Tax %</label>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={tax}
                    onChange={(e) => setTax(e.target.value)}
                    className="h-9 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{money(draftTotals.total)}</span>
              </div>
              <div className="flex items-center justify-between px-3 text-sm font-semibold">
                <span>Total</span>
                <span className="font-display text-base tabular-nums text-primary">
                  {money(draftTotals.grand)}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Customers ──────────────────────────────────────────────── */}
      {tab === "customers" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="border-b border-border/60 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Customers</h2>
          </div>
          {customers === undefined ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading customers…
            </div>
          ) : customers.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Users className="mx-auto size-7 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium">No customers yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add them on the Projects → Customers tab, then quote to them here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {customers.map((c: CustomerDoc) => (
                <li key={c._id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <Users className="size-3.5 shrink-0 text-muted-foreground/60" />
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  {c.email && (
                    <span className="truncate text-xs text-muted-foreground">{c.email}</span>
                  )}
                  {c.phone && (
                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ── Open document ──────────────────────────────────────────── */}
      {(openSale || openQuote) && (
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Eye className="size-3.5" />
              {openSale ? "Sales bill" : "Quotation"}
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                setViewingSale(null);
                setViewingQuote(null);
              }}
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {openSale
            ? documentView(
                openSale,
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={openSale.isPaid ? "outline" : "default"}
                    className="h-8 rounded-lg text-xs"
                    onClick={() =>
                      void setSalePaid({ id: openSale._id, paid: !openSale.isPaid })
                    }
                  >
                    Mark {openSale.isPaid ? "unpaid" : "paid"}
                  </Button>
                  {canEdit && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Pencil className="size-3" /> Edit lines from the quotation it came from
                    </span>
                  )}
                </div>,
              )
            : openQuote &&
              documentView(
                openQuote,
                <div className="flex flex-wrap items-center gap-2">
                  {openQuote.invoicedAs === undefined ? (
                    <>
                      {(["draft", "sent", "accepted", "rejected"] as const).map(
                        (s) => (
                          <Button
                            key={s}
                            type="button"
                            size="sm"
                            variant={openQuote.status === s ? "default" : "outline"}
                            className="h-8 rounded-lg text-xs"
                            disabled={busyId === openQuote._id}
                            onClick={() => void setStatus(openQuote._id, s)}
                          >
                            {QUOTE_STATUS[s].label}
                          </Button>
                        ),
                      )}
                      {canCreate && (
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 rounded-lg text-xs"
                          disabled={busyId === openQuote._id}
                          onClick={() => void convert(openQuote)}
                        >
                          <Receipt className="size-3.5" /> Turn into sales bill
                        </Button>
                      )}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="size-3.5" />
                      Already on a sales bill
                    </span>
                  )}
                </div>,
              )}
        </section>
      )}
    </div>
  );
}
