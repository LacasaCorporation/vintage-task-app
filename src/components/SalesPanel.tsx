import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Printer,
  Receipt,
  Send,
  Trash2,
  Truck,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import PageTabs from "@/components/PageTabs";
import ContactDialog, { type Contact } from "@/components/ContactDialog";
import CustomerLedgerDialog from "@/components/CustomerLedgerDialog";
import SalesDocumentForm, {
  type SalesDocTarget,
} from "@/components/SalesDocumentForm";
import {
  printDocument,
  printableInvoice,
  printableNote,
  printableQuotation,
  type FirmProfile,
  type SalesDocRecord,
} from "@/components/SalesDocumentPrint";

type FgDoc = Doc<"finishedGoods">;
type QuotationDoc = Doc<"quotations">;
type SaleDoc = Doc<"sales">;
type CustomerDoc = Doc<"customers">;

type Tab = "sales" | "quotes" | "deliveries" | "customers";


const QUOTE_STATUS: Record<
  NonNullable<QuotationDoc["status"]>,
  { label: string; chip: string }
> = {
  draft: { label: "Draft", chip: "bg-muted text-muted-foreground" },
  sent: { label: "Sent", chip: "bg-sky-500/10 text-sky-700 dark:text-sky-400" },
  accepted: { label: "Accepted", chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  rejected: { label: "Rejected", chip: "bg-rose-500/10 text-rose-700 dark:text-rose-400" },
};

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const { format: money, symbol } = useWorkspaceCurrency();

  /** Searchable options for the per-line product pickers. */

  const setQuoteStatus = useMutation(api.sales.updateQuotation);
  const convertQuote = useMutation(api.sales.convertToSale);
  const dropQuote = useMutation(api.sales.removeQuotation);
  const setSalePaid = useMutation(api.sales.setSalePaid);
  const dropSale = useMutation(api.sales.removeSale);

  const addCustomer = useMutation(api.contacts.createCustomer);
  const editCustomer = useMutation(api.contacts.updateCustomer);
  const dropCustomer = useMutation(api.contacts.removeCustomer);

  const [tab, setTab] = useState<Tab>("sales");
  const [viewingSale, setViewingSale] = useState<Id<"sales"> | null>(null);
  const [viewingQuote, setViewingQuote] = useState<Id<"quotations"> | null>(null);
  /**
   * The document being written, read or printed. One dialog serves all of
   * it, so a quotation, an invoice and a delivery note are always built the
   * same way and always print from the same sheet.
   */
  const [doc, setDoc] = useState<SalesDocTarget | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [ledgerCustomer, setLedgerCustomer] = useState<CustomerDoc | null>(null);
  /** Fixed for the life of the panel, so a re-render can't reclassify a due date. */
  const [now] = useState(() => Date.now());

  /**
   * Who owes what, one row per customer.
   *
   * An invoice can be raised against a saved customer or against a name typed
   * on the spot, so the book is keyed by customer id where there is one and by
   * the name itself otherwise — otherwise the one-off invoices would vanish
   * from the statement and the balance would be quietly wrong.
   */
  const customerLedger = useMemo(() => {
    const rows = new Map<
      string,
      {
        key: string;
        customer: CustomerDoc | null;
        name: string;
        invoices: SaleDoc[];
        invoiced: number;
        received: number;
        owing: number;
        oldestDue: number | null;
      }
    >();

    const rowFor = (key: string, customer: CustomerDoc | null, name: string) => {
      const existing = rows.get(key);
      if (existing) return existing;
      const fresh = {
        key,
        customer,
        name,
        invoices: [] as SaleDoc[],
        invoiced: 0,
        received: 0,
        owing: 0,
        oldestDue: null as number | null,
      };
      rows.set(key, fresh);
      return fresh;
    };

    // saved customers first, so a customer who has never been invoiced still
    // shows up in the list rather than only appearing once they buy something
    for (const c of customers ?? []) rowFor(c._id as string, c, c.name);

    for (const s of sales ?? []) {
      const name = s.customerName ?? "Walk-in / not listed";
      const key =
        s.customerId !== undefined
          ? (s.customerId as string)
          : `name:${name.toLowerCase()}`;
      const known = (customers ?? []).find((c) => c._id === s.customerId);
      const row = rowFor(key, known ?? null, name);
      row.invoices.push(s);
      row.invoiced = round2(row.invoiced + s.total);
      if (s.isPaid === true) row.received = round2(row.received + s.total);
      if (
        s.isPaid !== true &&
        s.dueAt !== undefined &&
        s.dueAt < now &&
        (row.oldestDue === null || s.dueAt < row.oldestDue)
      ) {
        row.oldestDue = s.dueAt;
      }
    }

    return [...rows.values()]
      .map((row) => ({
        ...row,
        invoiced: round2(row.invoiced),
        received: round2(row.received),
        owing: round2(row.invoiced - row.received),
      }))
      .sort((a, b) =>
        a.owing !== b.owing
          ? b.owing - a.owing
          : a.name.localeCompare(b.name),
      );
  }, [customers, sales, now]);

  const bookTotal = useMemo(
    () => ({
      invoiced: round2(customerLedger.reduce((s, r) => s + r.invoiced, 0)),
      received: round2(customerLedger.reduce((s, r) => s + r.received, 0)),
      owing: round2(customerLedger.reduce((s, r) => s + r.owing, 0)),
    }),
    [customerLedger],
  );

  const notes = useQuery(api.sales.listDeliveryNotes);
  const dropNote = useMutation(api.sales.removeDeliveryNote);
  const firm = useQuery(api.settings.firmProfile) as FirmProfile | null;

  /** Open a saved document to read it, or put it on the printer. */
  const openOrPrint = (record: SalesDocRecord, print: boolean) => {
    const printable =
      "deliveredAt" in record
        ? printableNote(record)
        : "soldAt" in record
          ? printableInvoice(record)
          : printableQuotation(record);
    if (print) {
      const opened = printDocument(printable, firm, symbol);
      if (!opened) toast.error("Allow pop-ups to print this document.");
      return;
    }
    setDoc({ mode: "view", doc: printable });
  };

  const openQuote = quotations?.find((q) => q._id === viewingQuote) ?? null;
  const openSale = sales?.find((s) => s._id === viewingSale) ?? null;

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
        <PageTabs
          label="Sales sections"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: "sales", label: "Invoices", icon: Receipt, count: sales?.length ?? 0 },
            { id: "quotes", label: "Quotations", icon: FileText, count: quotations?.length ?? 0 },
            { id: "deliveries", label: "Delivery notes", icon: Truck, count: notes?.length ?? 0 },
            { id: "customers", label: "Customers", icon: Users, count: customers?.length ?? 0 },
          ]}
        />
        {canCreate && (
          <div className="flex items-center gap-2">
            {/* One create action per tab, so whatever is on screen is what you
                can add to it. The second button is the other way into sales:
                an invoice is often raised from an accepted quote. */}
            {tab === "sales" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 rounded-xl px-3 text-sm"
                onClick={() => setDoc({ mode: "new", kind: "quotation" })}
              >
                <Send className="size-4" /> New quotation
              </Button>
            )}
            {tab === "deliveries" ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    className="h-9 rounded-xl px-3 text-sm"
                  >
                    <Truck className="size-4" /> New delivery note
                    <ChevronDown className="size-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Deliver against which invoice?
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(sales ?? []).length === 0 ? (
                    <p className="px-2 py-3 text-xs text-muted-foreground">
                      Raise an invoice first — a delivery note takes its items
                      from one.
                    </p>
                  ) : (
                    [...(sales ?? [])]
                      .sort((a, b) => b.soldAt - a.soldAt)
                      .map((s) => (
                        <DropdownMenuItem
                          key={s._id}
                          onSelect={() =>
                            setDoc({ mode: "newDelivery", saleId: s._id })
                          }
                          className="flex items-center gap-2"
                        >
                          <span className="font-mono text-xs">{s.number}</span>
                          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                            {s.customerName ?? "Walk-in / not listed"}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {money(s.total)}
                          </span>
                        </DropdownMenuItem>
                      ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : tab === "customers" ? (
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-xl px-3 text-sm"
                onClick={() => {
                  setEditingContact(null);
                  setContactOpen(true);
                }}
              >
                <UserPlus className="size-4" /> New customer
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-9 rounded-xl px-3 text-sm"
                onClick={() =>
                  setDoc({
                    mode: "new",
                    kind: tab === "quotes" ? "quotation" : "invoice",
                  })
                }
              >
                <Plus className="size-4" />
                {tab === "quotes" ? "New quotation" : "New invoice"}
              </Button>
            )}
          </div>
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

      {/* ── Customers, with what each of them owes ─────────────────── */}
      {tab === "customers" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              Customers
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {customerLedger.length} on the book · {money(bookTotal.invoiced)}{" "}
                invoiced · {money(bookTotal.received)} received ·{" "}
                <span
                  className={cn(
                    "font-medium",
                    bookTotal.owing > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-emerald-600 dark:text-emerald-400",
                  )}
                >
                  {money(bookTotal.owing)} outstanding
                </span>
              </span>
            </h2>
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              Click a row for its statement
            </span>
          </div>
          {customers === undefined || sales === undefined ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading the sales book…
            </div>
          ) : customerLedger.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Users className="mx-auto size-7 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium">No customers yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add one here and it becomes available on every quote, invoice
                and delivery note.
              </p>
              {canCreate && (
                <Button
                  type="button"
                  size="sm"
                  className="mt-3 h-8 rounded-lg text-xs"
                  onClick={() => {
                    setEditingContact(null);
                    setContactOpen(true);
                  }}
                >
                  <UserPlus className="size-3.5" /> New customer
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                    <th className="px-4 py-2">Customer</th>
                    <th className="px-3 py-2">Contact</th>
                    <th className="px-3 py-2 text-right">Invoices</th>
                    <th className="px-3 py-2 text-right">Invoiced</th>
                    <th className="px-3 py-2 text-right">Received</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="w-24 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {customerLedger.map((row) => {
                    const saved = row.customer;
                    return (
                      <tr
                        key={row.key}
                        onClick={() =>
                          saved
                            ? setLedgerCustomer(saved)
                            : toast.error(
                                "That name was typed on the invoice rather than saved — add a customer to keep a statement.",
                              )
                        }
                        title={
                          saved
                            ? `Open the ${row.name} statement`
                            : "Raised under a one-off name"
                        }
                        className={cn(
                          "group/customer transition-colors",
                          saved ? "cursor-pointer hover:bg-accent/40" : "",
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <p className="font-medium">
                            <span className="underline decoration-transparent underline-offset-2 transition-colors group-hover/customer:decoration-current">
                              {row.name}
                            </span>
                            {saved === null && (
                              <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                not saved
                              </span>
                            )}
                          </p>
                          {row.oldestDue !== null && (
                            <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                              overdue since{" "}
                              {new Date(row.oldestDue).toLocaleDateString()}
                            </p>
                          )}
                          {!saved && row.owing > 0 && (
                            <p className="text-[11px] text-muted-foreground">
                              link this name to a customer to get a statement
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                          {row.invoices.length > 0 ? (
                            <span className="space-y-0.5 block">
                              {saved?.contactName ? (
                                <span className="block">{saved.contactName}</span>
                              ) : null}
                              {saved?.phone && (
                                <span className="flex items-center gap-1">
                                  <Phone className="size-2.5" />
                                  {saved.phone}
                                </span>
                              )}
                              {saved?.email && (
                                <span className="flex items-center gap-1">
                                  <Mail className="size-2.5" />
                                  <span className="block max-w-36 truncate">
                                    {saved.email}
                                  </span>
                                </span>
                              )}
                              {!saved?.contactName && !saved?.phone && !saved?.email && (
                                <span>—</span>
                              )}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                          {row.invoices.length}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                          {row.invoices.length > 0 ? money(row.invoiced) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                          {row.received > 0
                            ? money(row.received)
                            : row.invoices.length > 0
                              ? "—"
                              : ""}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-2.5 text-right font-semibold tabular-nums",
                            row.owing > 0
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground",
                          )}
                        >
                          {row.invoices.length > 0 ? money(row.owing) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {saved && (
                              <>
                                <button
                                  type="button"
                                  title={`Quote for ${row.name}`}
                                  aria-label={`New quotation for ${row.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDoc({
                                      mode: "new",
                                      kind: "quotation",
                                      customer: { id: saved._id, name: saved.name },
                                    });
                                  }}
                                  className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                  <Send className="size-3.5" />
                                </button>
                                <button
                                  type="button"
                                  title={`Edit ${row.name}`}
                                  aria-label={`Edit ${row.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingContact(saved);
                                    setContactOpen(true);
                                  }}
                                  className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                                >
                                  <Pencil className="size-3.5" />
                                </button>
                                {canDelete && (
                                  <button
                                    type="button"
                                    title={`Delete ${row.name}`}
                                    aria-label={`Delete ${row.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      void dropCustomer({
                                        id: saved._id,
                                      }).catch((err) =>
                                        toast.error(
                                          err instanceof Error
                                            ? err.message
                                            : "Couldn't delete the customer.",
                                        ),
                                      );
                                    }}
                                    className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-600"
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border/60 bg-muted/30 text-sm font-semibold">
                    <td className="px-4 py-2.5" colSpan={2}>
                      Total
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                      {customerLedger.reduce((s, r) => s + r.invoices.length, 0)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {money(bookTotal.invoiced)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {money(bookTotal.received)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right tabular-nums",
                        bookTotal.owing > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {money(bookTotal.owing)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Delivery notes ─────────────────────────────────────────── */}
      {tab === "deliveries" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              Delivery notes
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                goods handed over — no money moves on these
              </span>
            </h2>
          </div>
          {notes === undefined ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              Reading the delivery book…
            </div>
          ) : notes.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No delivery note has been raised. Open an invoice and choose
              <strong> Deliver</strong> to record the goods leaving.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                    <th className="px-4 py-2">Note</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Delivered</th>
                    <th className="px-3 py-2">From invoice</th>
                    <th className="px-3 py-2 text-right">Items</th>
                    <th className="px-3 py-2 text-right">Value</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {notes.map((n) => {
                    const invoice = (sales ?? []).find((x) => x._id === n.saleId);
                    return (
                      <tr key={n._id} className="transition-colors hover:bg-accent/40">
                        <td className="px-4 py-2 font-mono text-xs">{n.number}</td>
                        <td className="px-3 py-2 text-xs font-medium">
                          {n.customerName ?? "Customer"}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {new Date(n.deliveredAt).toLocaleDateString()}
                          {n.deliveredBy && (
                            <span className="ml-1 text-muted-foreground">
                              · {n.deliveredBy}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                          {invoice?.number ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {n.lines.length}
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">
                          {money(n.total)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              n.status === "delivered"
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                            )}
                          >
                            {n.status === "delivered" ? "Delivered" : "Pending"}
                          </span>
                          {n.receivedBy && (
                            <span className="ml-1 text-[11px] text-muted-foreground">
                              · {n.receivedBy}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              title="Read this delivery note"
                              aria-label="Read delivery note"
                              onClick={() => openOrPrint(n, false)}
                              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Eye className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Print for the driver to sign"
                              aria-label="Print delivery note"
                              onClick={() => openOrPrint(n, true)}
                              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Printer className="size-3.5" />
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                title="Withdraw this note and put the goods back"
                                aria-label="Delete delivery note"
                                onClick={() =>
                                  void dropNote({ id: n._id }).catch((e) =>
                                    toast.error(
                                      e instanceof Error
                                        ? e.message
                                        : "Couldn't delete the note.",
                                    ),
                                  )
                                }
                                className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-600"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </div>
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

      {/* ── Open document ──────────────────────────────────────────── */}
      {(openSale || openQuote) && (
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <Eye className="size-3.5" />
              {openSale ? "Invoice" : "Quotation"}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {(openSale ?? openQuote)?.number}
              </span>
            </h2>
            <div className="flex items-center gap-1.5">
              {/* print, correct and ship — the three things you do with one */}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-lg text-xs"
                onClick={() => {
                  if (!openSale && !openQuote) return;
                  openOrPrint((openSale ?? openQuote) as SalesDocRecord, true);
                }}
              >
                <Printer className="size-3.5" /> Print
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-lg text-xs"
                  disabled={openSale?.isPaid === true}
                  title={
                    openSale?.isPaid === true
                      ? "A settled invoice is not editable — delete it and raise a new one"
                      : "Edit this document"
                  }
                  onClick={() => {
                    const record = openSale ?? openQuote;
                    if (!record) return;
                    setViewingSale(null);
                    setViewingQuote(null);
                    setDoc({
                      mode: "edit",
                      kind: "soldAt" in record ? "invoice" : "quotation",
                      id: record._id as
                        | Id<"sales">
                        | Id<"quotations">,
                    });
                  }}
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
              )}
              {canCreate && openSale && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 rounded-lg text-xs"
                  onClick={() => {
                    setViewingSale(null);
                    setDoc({ mode: "newDelivery", saleId: openSale._id });
                  }}
                >
                  <Truck className="size-3.5" /> Deliver
                </Button>
              )}
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

      {/* ── the document dialog ───────────────────────────────────── */}
      {doc !== null && (
        <SalesDocumentForm
          target={doc}
          products={products ?? []}
          onClose={() => setDoc(null)}
        />
      )}

      {/* ── customer master + the statement behind a balance ──────── */}
      <ContactDialog
        kind="customer"
        open={contactOpen}
        onOpenChange={(next) => {
          setContactOpen(next);
          if (!next) setEditingContact(null);
        }}
        contacts={customers as Contact[] | undefined}
        editTarget={editingContact}
        onCreate={async (args) => addCustomer(args)}
        onUpdate={async (id, args) => {
          await editCustomer({ id: id as Id<"customers">, ...args });
        }}
        onRemove={async (id) => {
          await dropCustomer({ id: id as Id<"customers"> });
        }}
      />
      {ledgerCustomer !== null && (
        <CustomerLedgerDialog
          customer={ledgerCustomer}
          sales={(sales ?? []).filter(
            (s) => s.customerId === ledgerCustomer._id,
          )}
          money={money}
          canCreate={canCreate}
          onClose={() => setLedgerCustomer(null)}
          onOpenInvoice={(id) => {
            const sale = (sales ?? []).find((s) => s._id === id);
            if (sale) openOrPrint(sale, false);
            else toast.error("That invoice is no longer on file.");
          }}
          onNewInvoice={() =>
            setDoc({
              mode: "new",
              kind: "invoice",
              customer: {
                id: ledgerCustomer._id,
                name: ledgerCustomer.name,
                address: ledgerCustomer.address,
              },
            })
          }
        />
      )}
    </div>
  );
}
