import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  ClipboardList,
  Clock,
  HandCoins,
  Loader2,
  PackageCheck,
  Receipt,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PURCHASE_TABS, type PurchaseTab } from "@/lib/purchase-tabs";
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

/** A document from any of the purchase registers, flattened for one list. */
type FeedItem = {
  key: string;
  kind: string;
  number: string;
  party: string;
  at: number;
  amount: number;
  note?: string;
  tab: PurchaseTab;
};

const KIND_STYLE: Record<string, string> = {
  Order: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  Delivery: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  Bill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  Payment: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Expense: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
};

const KIND_ICON = {
  Order: ClipboardList,
  Delivery: PackageCheck,
  Bill: Receipt,
  Payment: HandCoins,
  Expense: Wallet,
} as const;

/**
 * The purchase module's front page: where buying stands today.
 *
 * It follows the way buying actually runs — order, delivery, bill, payment —
 * so each card answers one question about that step, and anything unfinished is
 * listed with a way to go and finish it. Every figure is derived from the same
 * register queries the pages below use, so the numbers here always match the
 * documents they came from.
 */
export default function PurchaseDashboard({
  onTabChange,
}: {
  /** Jumps to one of the purchase pages. */
  onTabChange: (tab: PurchaseTab) => void;
}) {
  const lpos = useQuery(api.lpo.list);
  const grvs = useQuery(api.grv.list);
  const bills = useQuery(api.purchases.list);
  const payments = useQuery(api.payments.list);
  const expenses = useQuery(api.expenses.list);
  const { format: money } = useWorkspaceCurrency();

  const monthStart = startOfMonth();

  const stats = useMemo(() => {
    const orders = lpos ?? [];
    const open = orders.filter(
      (l) => l.status !== "received" && l.status !== "cancelled",
    );
    const onOrder = open.filter((l) => l.status === "ordered");
    const unsent = open.filter((l) => l.status === "draft");

    const deliveries = grvs ?? [];
    const countedIn = deliveries.filter((g) => g.status === "received");
    const vouchersWaiting = deliveries.filter((g) => g.status === "draft");

    const supplierBills = bills ?? [];
    const unpaid = supplierBills.filter((b) => !b.isPaid);
    // stock came in against these orders, but no bill has arrived for them yet
    const awaitingBill = orders.filter(
      (l) => l.status === "received" && l.billId === undefined,
    );

    const paidRows = payments ?? [];
    const spentRows = expenses ?? [];
    const thisMonth =
      paidRows.reduce(
        (sum, p) => (p.at >= monthStart ? sum + p.amount : sum),
        0,
      ) +
      spentRows.reduce(
        (sum, e) => (e.at >= monthStart ? sum + e.amount : sum),
        0,
      );

    const byCategory = new Map<string, number>();
    for (const e of spentRows) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
    }
    const categoryTotals = [...byCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
    const biggest = categoryTotals[0]?.amount ?? 0;

    return {
      open,
      onOrder,
      unsent,
      committed: onOrder.reduce((sum, l) => sum + l.total, 0),
      countedIn,
      vouchersWaiting,
      countedInValue: countedIn.reduce((sum, g) => sum + g.total, 0),
      unpaid,
      unpaidValue: unpaid.reduce((sum, b) => sum + b.total, 0),
      awaitingBill,
      awaitingBillValue: awaitingBill.reduce((sum, l) => sum + l.total, 0),
      paidTotal: paidRows.reduce((sum, p) => sum + p.amount, 0),
      spentTotal: spentRows.reduce((sum, e) => sum + e.amount, 0),
      thisMonth,
      categoryTotals,
      biggest,
      vendorCount: new Set([
        ...orders.map((l) => l.vendor).filter((v): v is string => !!v),
        ...supplierBills.map((b) => b.supplier).filter((v): v is string => !!v),
      ]).size,
    };
  }, [lpos, grvs, bills, payments, expenses, monthStart]);

  /** Everything from every register, newest first. */
  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...(lpos ?? []).map((l) => ({
        key: `lpo-${l._id}`,
        kind: "Order",
        number: l.number,
        party: l.vendor ?? "",
        at: l.orderedAt,
        amount: l.total,
        note: l.note,
        tab: "lpo" as PurchaseTab,
      })),
      ...(grvs ?? []).map((g) => ({
        key: `grv-${g._id}`,
        kind: "Delivery",
        number: g.number,
        party: g.vendor ?? "",
        at: g.receivedAt,
        amount: g.total,
        note: g.reference,
        tab: "grv" as PurchaseTab,
      })),
      ...(bills ?? []).map((b) => ({
        key: `bill-${b._id}`,
        kind: "Bill",
        number: b.number,
        party: b.supplier ?? "",
        at: b.purchasedAt,
        amount: b.total,
        note: b.note,
        tab: "bills" as PurchaseTab,
      })),
      ...(payments ?? []).map((p) => ({
        key: `pay-${p._id}`,
        kind: "Payment",
        number: p.number,
        party: p.vendor ?? "",
        at: p.at,
        amount: p.amount,
        note: p.reference,
        tab: "payments" as PurchaseTab,
      })),
      ...(expenses ?? []).map((e) => ({
        key: `exp-${e._id}`,
        kind: "Expense",
        number: e.category,
        party: e.vendor ?? "",
        at: e.at,
        amount: e.amount,
        note: e.description ?? e.note,
        tab: "expenses" as PurchaseTab,
      })),
    ];
    return items.sort((a, b) => b.at - a.at).slice(0, 8);
  }, [lpos, grvs, bills, payments, expenses]);

  const loading =
    lpos === undefined ||
    grvs === undefined ||
    bills === undefined ||
    payments === undefined ||
    expenses === undefined;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Opening purchase…
      </div>
    );
  }

  /** One step of the buying flow. */
  const onOrderStage = {
    icon: Clock,
    label: "On order",
    count: stats.open.length,
    value: money(stats.committed),
    hint:
      stats.unsent.length > 0
        ? `${stats.unsent.length} still a draft`
        : "Every order is with a vendor",
    tab: "lpo" as PurchaseTab,
    tone: "text-sky-600 dark:text-sky-400",
  };
  const received = {
    icon: PackageCheck,
    label: "Received",
    count: stats.countedIn.length,
    value: money(stats.countedInValue),
    hint:
      stats.vouchersWaiting.length > 0
        ? `${stats.vouchersWaiting.length} not yet counted in`
        : "Stock is up to date",
    tab: "grv" as PurchaseTab,
    tone: "text-violet-600 dark:text-violet-400",
  };
  const billedStage = {
    icon: Receipt,
    label: "Billed",
    count: (bills ?? []).length,
    value: money((bills ?? []).reduce((sum, b) => sum + b.total, 0)),
    hint:
      stats.unpaid.length > 0
        ? `${stats.unpaid.length} still unpaid`
        : "Everything is settled",
    tab: "bills" as PurchaseTab,
    tone: "text-emerald-600 dark:text-emerald-400",
  };
  const paidStage = {
    icon: HandCoins,
    label: "Paid",
    count: (payments ?? []).length,
    value: money(stats.paidTotal),
    hint: `${money(stats.thisMonth)} out this month`,
    tab: "payments" as PurchaseTab,
    tone: "text-amber-600 dark:text-amber-400",
  };

  const stages = [onOrderStage, received, billedStage, paidStage];

  /** Things that are started but not finished, with where to go finish them. */
  const attention: {
    key: string;
    text: string;
    amount?: number;
    tab: PurchaseTab;
  }[] = [];
  for (const l of stats.unsent)
    attention.push({
      key: `unsent-${l._id}`,
      text: `${l.number} is still a draft — ${l.vendor || "no vendor"} has not been asked yet`,
      amount: l.total,
      tab: "lpo",
    });
  for (const g of stats.vouchersWaiting)
    attention.push({
      key: `grv-${g._id}`,
      text: `${g.number} is saved but not counted into stock`,
      amount: g.total,
      tab: "grv",
    });
  for (const l of stats.awaitingBill)
    attention.push({
      key: `unbilled-${l._id}`,
      text: `${l.number} arrived and is in stock, but no bill covers it`,
      amount: l.total,
      tab: "bills",
    });
  for (const b of stats.unpaid)
    attention.push({
      key: `unpaid-${b._id}`,
      text: `${b.number} from ${b.supplier || "a supplier"} is unpaid`,
      amount: b.total,
      tab: "payments",
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold">Purchase</h1>
          <p className="text-sm text-muted-foreground">
            {money(stats.committed + stats.unpaidValue)} committed or owed across{" "}
            {stats.vendorCount} supplier{stats.vendorCount === 1 ? "" : "s"} ·{" "}
            {money(stats.spentTotal)} of expenses on record
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => onTabChange("bills")}
          className="h-9 rounded-xl px-3 text-sm"
        >
          <Receipt className="size-4" /> Record a bill
        </Button>
      </div>

      {/* the flow: order → delivery → bill → payment */}
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

      <div className="grid gap-4 lg:grid-cols-3">
        {/* what is unfinished */}
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm lg:col-span-2">
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
              Nothing is half-finished. Every order, delivery and bill is where it
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

        {/* expenses by account */}
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
            <h2 className="text-sm font-semibold">Expenses by account</h2>
            <button
              type="button"
              onClick={() => onTabChange("expenses")}
              className="text-xs text-muted-foreground hover:text-primary"
            >
              Open
            </button>
          </div>
          {stats.categoryTotals.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No expenses recorded yet.
            </p>
          ) : (
            <ul className="space-y-2.5 px-4 py-4">
              {stats.categoryTotals.slice(0, 6).map((c) => (
                <li key={c.category}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate">{c.category}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {money(c.amount)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{
                        width: `${stats.biggest > 0 ? Math.max(4, (c.amount / stats.biggest) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* the documents themselves */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
          <h2 className="text-sm font-semibold">Latest documents</h2>
          <span className="text-xs text-muted-foreground">Newest first</span>
        </div>
        {feed.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing bought yet. Start with an order or a bill — either brings
            stock in.
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
        {PURCHASE_TABS.filter((t) => t.id !== "dashboard").map((t) => {
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