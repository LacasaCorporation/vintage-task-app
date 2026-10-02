import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  FileText,
  HandCoins,
  Loader2,
  PackageCheck,
  Receipt,
  ShoppingCart,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SALES_TABS, type SalesTab } from "@/lib/sales-tabs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });

const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
};

type FeedItem = {
  key: string;
  kind: string;
  number: string;
  party: string;
  at: number;
  amount: number;
  note?: string;
  tab: SalesTab;
};

const KIND_STYLE: Record<string, string> = {
  Quotation: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Order: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  Invoice: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  Delivery: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Receipt: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const KIND_ICON = {
  Quotation: FileText,
  Order: ShoppingCart,
  Invoice: Receipt,
  Delivery: PackageCheck,
  Receipt: HandCoins,
} as const;

/**
 * The sales module's front page: where selling stands today.
 *
 * It follows the documents in the order they happen — quoted, confirmed,
 * invoiced, delivered, collected — so each card answers one question about
 * that step, and anything unfinished is listed with a way to go and finish it.
 * Every figure comes from the same register queries the pages below use.
 */
export default function SalesDashboard({
  onTabChange,
}: {
  onTabChange: (tab: SalesTab) => void;
}) {
  const quotations = useQuery(api.sales.listQuotations);
  const orders = useQuery(api.salesOrders.list);
  const invoices = useQuery(api.sales.listSales);
  const notes = useQuery(api.sales.listDeliveryNotes);
  const receipts = useQuery(api.receipts.list);
  const customers = useQuery(api.contacts.listCustomers);
  const { format: money } = useWorkspaceCurrency();

  const monthStart = startOfMonth();

  const stats = useMemo(() => {
    const quotes = quotations ?? [];
    const live = quotes.filter((q) => q.status !== "rejected");
    const accepted = quotes.filter(
      (q) => q.status === "accepted" && q.invoicedAs === undefined,
    );

    const orderRows = orders ?? [];
    const open = orderRows.filter((o) => o.status !== "cancelled");
    const confirmed = open.filter((o) => o.status === "ordered");

    const bills = invoices ?? [];
    const unpaid = bills.filter((b) => b.isPaid !== true);

    const received = receipts ?? [];
    const owed = unpaid.reduce(
      (sum, b) =>
        sum - received.reduce(
          (paid, r) => (r.invoiceId === b._id ? paid + r.amount : paid),
          0,
        ),
      0,
    );

    return {
      liveQuotes: live,
      openQuotesValue: live
        .filter((q) => q.status !== "accepted" || q.invoicedAs === undefined)
        .reduce((sum, q) => sum + q.total, 0),
      accepted,
      open,
      confirmed,
      confirmedValue: confirmed.reduce((sum, o) => sum + o.total, 0),
      bills,
      unpaid,
      owed: Math.max(0, owed),
      received,
      receivedTotal: received.reduce((sum, r) => sum + r.amount, 0),
      receivedThisMonth: received.reduce(
        (sum, r) => (r.at >= monthStart ? sum + r.amount : sum),
        0,
      ),
      invoicedThisMonth: bills.reduce(
        (sum, b) => (b.soldAt >= monthStart ? sum + b.total : sum),
        0,
      ),
      customerCount: customers?.length ?? 0,
      /** Invoices with nothing delivered against them yet. */
      awaitingDelivery: bills.filter((b) => {
        const delivered = (notes ?? [])
          .filter((n) => n.saleId === b._id)
          .reduce((sum, n) => sum + n.lines.reduce((s, l) => s + l.qty, 0), 0);
        const invoiced = b.lines.reduce((s, l) => s + l.qty, 0);
        return delivered < invoiced;
      }),
    };
  }, [quotations, orders, invoices, notes, receipts, customers, monthStart]);

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...(quotations ?? []).map((q) => ({
        key: `q-${q._id}`,
        kind: "Quotation",
        number: q.number,
        party: q.customerName ?? "",
        at: q.quotedAt,
        amount: q.total,
        note: q.poRef,
        tab: "quotations" as SalesTab,
      })),
      ...(orders ?? []).map((o) => ({
        key: `o-${o._id}`,
        kind: "Order",
        number: o.number,
        party: o.customerName ?? "",
        at: o.orderedAt,
        amount: o.total,
        note: o.note,
        tab: "orders" as SalesTab,
      })),
      ...(invoices ?? []).map((b) => ({
        key: `b-${b._id}`,
        kind: "Invoice",
        number: b.number,
        party: b.customerName ?? "",
        at: b.soldAt,
        amount: b.total,
        note: b.poRef,
        tab: "invoices" as SalesTab,
      })),
      ...(notes ?? []).map((n) => ({
        key: `d-${n._id}`,
        kind: "Delivery",
        number: n.number,
        party: n.customerName ?? "",
        at: n.deliveredAt,
        amount: n.total,
        note: n.docketRef,
        tab: "deliveries" as SalesTab,
      })),
      ...(receipts ?? []).map((r) => ({
        key: `r-${r._id}`,
        kind: "Receipt",
        number: r.number,
        party: r.customerName ?? "",
        at: r.at,
        amount: r.amount,
        note: r.reference,
        tab: "receipts" as SalesTab,
      })),
    ];
    return items.sort((a, b) => b.at - a.at).slice(0, 8);
  }, [quotations, orders, invoices, notes, receipts]);

  const loading =
    quotations === undefined ||
    orders === undefined ||
    invoices === undefined ||
    notes === undefined ||
    receipts === undefined;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Opening sales…
      </div>
    );
  }

  const quoted = {
    icon: FileText,
    label: "Quoted",
    count: stats.liveQuotes.length,
    value: money(stats.openQuotesValue),
    hint:
      stats.accepted.length > 0
        ? `${stats.accepted.length} accepted, not yet an order`
        : "Nothing waiting on a yes",
    tab: "quotations" as SalesTab,
    tone: "text-sky-600 dark:text-sky-400",
  };
  const confirmed = {
    icon: ShoppingCart,
    label: "Confirmed",
    count: stats.confirmed.length,
    value: money(stats.confirmedValue),
    hint: "Orders the customer has taken",
    tab: "orders" as SalesTab,
    tone: "text-amber-600 dark:text-amber-400",
  };
  const invoiced = {
    icon: Receipt,
    label: "Invoiced",
    count: stats.bills.length,
    value: money(stats.invoicedThisMonth),
    hint: `${money(stats.owed)} still owed`,
    tab: "invoices" as SalesTab,
    tone: "text-emerald-600 dark:text-emerald-400",
  };
  const collected = {
    icon: HandCoins,
    label: "Collected",
    count: stats.received.length,
    value: money(stats.receivedTotal),
    hint: `${money(stats.receivedThisMonth)} in this month`,
    tab: "receipts" as SalesTab,
    tone: "text-rose-600 dark:text-rose-400",
  };

  const stages = [quoted, confirmed, invoiced, collected];

  /** Things that are started but not finished, with where to go finish them. */
  const attention: {
    key: string;
    text: string;
    amount?: number;
    tab: SalesTab;
  }[] = [];
  for (const q of stats.accepted)
    attention.push({
      key: `accepted-${q._id}`,
      text: `${q.number} was accepted but is not an order yet`,
      amount: q.total,
      tab: "orders",
    });
  for (const o of stats.open)
    attention.push({
      key: `order-${o._id}`,
      text: `${o.number} is confirmed and not invoiced`,
      amount: o.total,
      tab: "orders",
    });
  for (const b of stats.unpaid)
    attention.push({
      key: `unpaid-${b._id}`,
      text: `${b.number} from ${b.customerName || "a customer"} is unpaid`,
      amount: b.total,
      tab: "receipts",
    });
  for (const b of stats.awaitingDelivery.slice(0, 3))
    attention.push({
      key: `delivery-${b._id}`,
      text: `${b.number} has goods still to be delivered`,
      amount: b.total,
      tab: "deliveries",
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Sales</h1>
          <p className="text-sm text-muted-foreground">
            {money(stats.confirmedValue + stats.owed)} confirmed or owed across{" "}
            {stats.customerCount} customer{stats.customerCount === 1 ? "" : "s"} ·{" "}
            {money(stats.receivedTotal)} collected
          </p>
        </div>
      </div>

      {/* the flow: quote → order → invoice → receipt */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stages.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onTabChange(s.tab)}
            className="group rounded-2xl border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/30"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                {s.label}
              </span>
              <s.icon className={cn("size-4", s.tone)} />
            </div>
            <p className="mt-2 font-display text-2xl font-semibold tabular-nums">
              {s.value}
            </p>
            <p className="text-xs text-muted-foreground">
              {s.count} document{s.count === 1 ? "" : "s"} · {s.hint}
            </p>
          </button>
        ))}
      </div>

      {/* what is unfinished */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {attention.length > 0 ? (
              <TriangleAlert className="size-4 text-amber-500" />
            ) : (
              <TrendingUp className="size-4 text-emerald-500" />
            )}
            Waiting on you
          </h2>
          <span className="text-xs text-muted-foreground">
            {attention.length} item{attention.length === 1 ? "" : "s"}
          </span>
        </div>
        {attention.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing is half-finished. Every quote, order and invoice is where it
            should be.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {attention.slice(0, 8).map((a) => (
              <li key={a.key}>
                <button
                  type="button"
                  onClick={() => onTabChange(a.tab)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/40"
                >
                  <span className="min-w-0 flex-1">{a.text}</span>
                  {a.amount !== undefined && (
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {money(a.amount)}
                    </span>
                  )}
                  <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground/60" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* the documents themselves */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
          <h2 className="text-sm font-semibold">Latest documents</h2>
          <span className="text-xs text-muted-foreground">Newest first</span>
        </div>
        {feed.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing sold yet. Start with a quotation, an order or an invoice.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {feed.map((item) => {
              const Icon = KIND_ICON[item.kind as keyof typeof KIND_ICON];
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    onClick={() => onTabChange(item.tab)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/40"
                  >
                    <span
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-lg",
                        KIND_STYLE[item.kind],
                      )}
                    >
                      <Icon className="size-3.5" />
                    </span>
                    <span className="w-20 shrink-0 font-mono text-xs">
                      {item.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {item.party || item.note || item.kind}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {day(item.at)}
                    </span>
                    <span className="w-28 shrink-0 text-right text-xs tabular-nums">
                      {money(item.amount)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* one tile per page, so every register is a click away */}
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {SALES_TABS.filter((t) => t.id !== "dashboard").map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTabChange(t.id)}
              title={t.hint}
              className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-accent/30"
            >
              <Icon className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
