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
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Eye,
  FileText,
  HandCoins,
  ShoppingCart,
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
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import SalesDashboard from "@/components/SalesDashboard";
import SalesOrdersPanel, {
  type SalesOrderSeed,
} from "@/components/SalesOrdersPanel";
import ReceiptsPanel, { type ReceiptSeed } from "@/components/ReceiptsPanel";
import { type SalesTab } from "@/lib/sales-tabs";
import ContactDialog, { type Contact } from "@/components/ContactDialog";
import StatusSelect from "@/components/StatusSelect";
import CustomerLedgerDialog from "@/components/CustomerLedgerDialog";
import SalesDocumentForm, { type SalesDocTarget } from "@/components/SalesDocumentForm";

import {
  printDocument,
  printableInvoice,
  printableNote,
  printableQuotation,
  type FirmProfile,
  type SalesDocRecord,
} from "@/components/SalesDocumentPrint";

type QuotationDoc = Doc<"quotations">;
type SaleDoc = Doc<"sales">;
type CustomerDoc = Doc<"customers">;

/** The four lists that were tabs here before the sidebar took over. */
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
  canCreate,
  canEdit,
  canDelete,
  tab: tabProp,
  onTabChange,
}: {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Which sales page is open — the sidebar decides. */
  tab: SalesTab;
  onTabChange: (tab: SalesTab) => void;
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

  /**
   * A sales order or a receipt started from somewhere else in the module. The
   * keys force the panel to remount so it opens from the seed rather than
   * filling itself in afterwards.
   */
  const [orderSeed, setOrderSeed] = useState<SalesOrderSeed | null>(null);
  const [orderKey, setOrderKey] = useState(0);
  const [receiptSeed, setReceiptSeed] = useState<ReceiptSeed | null>(null);
  const [receiptKey, setReceiptKey] = useState(0);

  /**
   * The quotation, invoice or delivery note being written or read.
   *
   * These used to live on their own route, which took the whole app away —
   * the navigation, the firm, everything — for a document you spend minutes
   * on. A document is now a screen inside the sales page, so the sidebar stays
   * put and closing it puts you back on the list you came from. The route is
   * still there for a link to send someone.
   */
  const [doc, setDoc] = useState<SalesDocTarget | null>(null);

  /** An accepted quotation the customer has confirmed — make it an order. */
  const startOrderFromQuote = (quote: QuotationDoc) => {
    setOrderSeed({ mode: "fromQuotation", quotation: quote });
    setOrderKey((k) => k + 1);
    onTabChange("orders");
  };

  /** Money coming in against an invoice, from that invoice's own row. */
  const startReceiptForInvoice = (sale: SaleDoc) => {
    setReceiptSeed({ mode: "forInvoice", invoiceId: sale._id });
    setReceiptKey((k) => k + 1);
    onTabChange("receipts");
  };

  /**
   * The four older lists, as one of the pages the sidebar lists. The newer
   * pages are whole panels of their own, rendered below.
   */
  const tab: Tab =
    tabProp === "deliveries"
      ? "deliveries"
      : tabProp === "customers"
        ? "customers"
        : tabProp === "quotations"
          ? "quotes"
          : "sales";
  /**
   * The document being written, read or printed now has a page of its own, so
   * nothing is held open over the list any more.
   */
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
  const products = useQuery(api.costing.listFinishedGoods);
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
    // read it here, with the rest of the app around it
    setDoc({ mode: "view", doc: printable });
  };

  /** Open a document as its own screen — the sidebar and all. */
  const openDoc = (target: SalesDocTarget) => setDoc(target);


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
      onTabChange("invoices");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't convert the quote.",
      );
    } finally {
      setBusyId(null);
    }
  };

  /* ── a document, as a screen of its own with the app around it ─── */
  if (doc !== null) {
    return (
      <div className="mt-4 space-y-4">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 rounded-lg text-xs"
          onClick={() => setDoc(null)}
        >
          <ArrowLeft className="size-3.5" />
          {tab === "quotes"
            ? "Quotations"
            : tab === "deliveries"
              ? "Delivery notes"
              : "Invoices"}
        </Button>
        <SalesDocumentForm
          key={
            doc.mode === "view"
              ? `view-${doc.doc.number}`
              : doc.mode === "new" || doc.mode === "newDelivery"
                ? doc.mode
                : `${doc.mode}-${doc.id}`
          }
          layout="page"
          target={doc}
          products={products ?? []}
          onClose={() => setDoc(null)}
          onSaved={() => setDoc(null)}
        />
      </div>
    );
  }

  /* ── the pages that are whole panels of their own ─────────────── */
  if (tabProp === "dashboard") return <SalesDashboard onTabChange={onTabChange} />;

  if (tabProp === "orders") {
    return (
      <SalesOrdersPanel
        key={orderKey}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        seed={orderSeed}
        onInvoiced={() => onTabChange("invoices")}
      />
    );
  }

  if (tabProp === "receipts") {
    return (
      <ReceiptsPanel
        key={receiptKey}
        canCreate={canCreate}
        canDelete={canDelete}
        seed={receiptSeed}
      />
    );
  }

  return (
    <div className="mt-4 space-y-4">
      {/* ── Header: what this page is, then the way into a new one ── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold tracking-tight">
            {tab === "sales"
              ? "Invoices"
              : tab === "quotes"
                ? "Quotations"
                : tab === "deliveries"
                  ? "Delivery notes"
                  : "Customers"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {tab === "sales"
              ? `${sales?.length ?? 0} invoice(s) · ${money((sales ?? []).reduce((s, b) => s + b.total, 0))} invoiced`
              : tab === "quotes"
                ? "Offers sent to customers, waiting to be accepted"
                : tab === "deliveries"
                  ? "Goods handed over against an invoice"
                  : "Who you sell to, and what they owe"}
          </p>
        </div>
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
                onClick={() => openDoc({ mode: "new", kind: "quotation" })}
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
                          onSelect={() => openDoc({ mode: "newDelivery", saleId: s._id })}
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
                  openDoc({
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
                      onClick={() => openOrPrint(sale, false)}
                      title={`Open ${sale.number}`}
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
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            title="Edit this invoice"
                            aria-label={`Edit ${sale.number}`}
                            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                            disabled={sale.isPaid === true || !canEdit}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDoc({
                                mode: "edit",
                                kind: "invoice",
                                id: sale._id,
                              });
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Print this invoice"
                            aria-label={`Print ${sale.number}`}
                            className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              openOrPrint(sale, true);
                            }}
                          >
                            <Printer className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            title={sale.isPaid ? "Mark unpaid" : "Mark paid"}
                            aria-label={`Mark ${sale.number} ${sale.isPaid ? "unpaid" : "paid"}`}
                            className={cn(
                              "grid size-6 place-items-center rounded-md transition-colors",
                              sale.isPaid
                                ? "text-emerald-600 hover:bg-accent dark:text-emerald-400"
                                : "text-muted-foreground hover:bg-accent hover:text-foreground",
                            )}
                            disabled={busyId === sale._id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setBusyId(sale._id);
                              void setSalePaid({
                                id: sale._id,
                                paid: sale.isPaid !== true,
                              })
                                .then(() =>
                                  toast.success(
                                    sale.isPaid
                                      ? `${sale.number} is unpaid again.`
                                      : `${sale.number} marked paid.`,
                                  ),
                                )
                                .catch((error) =>
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Couldn't update the bill.",
                                  ),
                                )
                                .finally(() => setBusyId(null));
                            }}
                          >
                            <CheckCircle2 className="size-3.5" />
                          </button>
                          {canCreate && sale.isPaid !== true && (
                            <button
                              type="button"
                              title="Record money received against this invoice"
                              aria-label={`Receive payment for ${sale.number}`}
                              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                startReceiptForInvoice(sale);
                              }}
                            >
                              <HandCoins className="size-3.5" />
                            </button>
                          )}
                          {canCreate && (
                            <button
                              type="button"
                              title="Deliver against this invoice"
                              aria-label={`Deliver ${sale.number}`}
                              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDoc({ mode: "newDelivery", saleId: sale._id });
                              }}
                            >
                              <Truck className="size-3.5" />
                            </button>
                          )}
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
                        </div>
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
                        onClick={() => openOrPrint(quote, false)}
                        title={`Open ${quote.number}`}
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
                          <div className="flex items-center justify-end gap-0.5">
                            <span onClick={(e) => e.stopPropagation()}>
                              <StatusSelect
                                value={quote.status ?? "draft"}
                                statuses={["draft", "sent", "accepted", "rejected"]}
                                title="Where this quote has got to"
                                onChange={(next: string) =>
                                  void setStatus(
                                    quote._id,
                                    next as NonNullable<QuotationDoc["status"]>,
                                  )
                                }
                              />
                            </span>
                            <button
                              type="button"
                              title="Edit this quotation"
                              aria-label={`Edit ${quote.number}`}
                              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                              disabled={!canEdit}
                              onClick={(e) => {
                                e.stopPropagation();
                                openDoc({
                                  mode: "edit",
                                  kind: "quotation",
                                  id: quote._id,
                                });
                              }}
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Print this quotation"
                              aria-label={`Print ${quote.number}`}
                              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                openOrPrint(quote, true);
                              }}
                            >
                              <Printer className="size-3.5" />
                            </button>
                            {canCreate && quote.invoicedAs === undefined && (
                              <button
                                type="button"
                                title="Turn into a sales bill"
                                aria-label={`Convert ${quote.number} to an invoice`}
                                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                disabled={busyId === quote._id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void convert(quote);
                                }}
                              >
                                <Receipt className="size-3.5" />
                              </button>
                            )}
                            {canCreate && quote.invoicedAs === undefined && (
                              <button
                                type="button"
                                title="The customer confirmed — record it as a sales order"
                                aria-label={`Make ${quote.number} a sales order`}
                                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                                disabled={busyId === quote._id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startOrderFromQuote(quote);
                                }}
                              >
                                <ShoppingCart className="size-3.5" />
                              </button>
                            )}
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
                                    openDoc({
                                      mode: "new",
                                      kind: "quotation",
                                      customer: {
                                        id: saved._id,
                                        name: saved.name,
                                      },
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
            openDoc({
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
