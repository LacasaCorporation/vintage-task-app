import { useMemo } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { AccountType } from "@/convex/accounting";
import type { AccountingTab } from "@/lib/accounting-tabs";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BookOpen,
  CalendarDays,
  CircleDollarSign,
  Landmark,
  Receipt,
  Scale,
  ScrollText,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

/** The account row the chart of accounts already computes for every account. */
type Account = {
  _id: Id<"accounts">;
  code: string;
  name: string;
  type: AccountType;
  isGroup: boolean;
  balance: number;
  debit: number;
  credit: number;
  signed: number;
  isBank: boolean;
  parentId?: Id<"accounts">;
};

/** One posting, with the lines that carry the accounts it moved. */
type Entry = {
  _id: Id<"journalEntries">;
  number: string;
  at: number;
  kind: string;
  memo?: string;
  party?: string;
  debit: number;
  credit: number;
  lines: {
    _id: Id<"journalLines">;
    accountId: Id<"accounts">;
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
  }[];
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * An account's balance in its natural direction — assets and expenses read
 * positive when debited, income, liabilities and equity when credited. The
 * chart's own `signed` field multiplies by a sign that cancels in the account
 * table's display, so the statements read from debit and credit directly.
 */
function natural(a: { type: AccountType; debit: number; credit: number }): number {
  return a.type === "income" ||
    a.type === "liability" ||
    a.type === "equity"
    ? round(a.credit - a.debit)
    : round(a.debit - a.credit);
}

/** A short axis label — 1.2k, 3.4M — so a big ledger still reads. */
function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

const TYPE_LABEL: Record<AccountType, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

/**
 * The accounting landing page: what the books say at a glance.
 *
 * Every figure is derived from the same chart and postings the rest of the
 * ledger uses, so a dashboard number and the account it came from can never
 * disagree. Read-only — each panel offers a way into the page that owns the
 * detail rather than duplicating it here.
 */
export default function AccountingDashboard({
  accounts,
  entries,
  money,
  onOpen,
}: {
  accounts: Account[];
  entries: Entry[];
  money: (n: number) => string;
  onOpen: (tab: AccountingTab) => void;
}) {
  const postable = useMemo(
    () => accounts.filter((a) => !a.isGroup),
    [accounts],
  );

  const byCode = useMemo(
    () => new Map(postable.map((a) => [a.code, a])),
    [postable],
  );
  const byName = (pattern: RegExp) =>
    postable.find((a) => pattern.test(a.name));

  /** Cash or bank: flagged as a bank, named like one, or the standard codes. */
  const moneyAccounts = useMemo(
    () =>
      postable.filter(
        (a) =>
          a.type === "asset" &&
          (a.isBank ||
            /cash|bank/i.test(a.name) ||
            a.code === "1000" ||
            a.code === "1100"),
      ),
    [postable],
  );
  const moneyIds = useMemo(
    () => new Set(moneyAccounts.map((a) => a._id)),
    [moneyAccounts],
  );

  const sum = (rows: Account[]) => round(rows.reduce((s, a) => s + natural(a), 0));

  const cashAndBank = sum(moneyAccounts);
  const recvAccount = byCode.get("1200") ?? byName(/receivable|debtor/i);
  const receivable = recvAccount ? natural(recvAccount) : 0;
  const payAccount = byCode.get("2100") ?? byName(/payable|creditor/i);
  const payable = payAccount ? natural(payAccount) : 0;
  const inventory = sum(
    postable.filter(
      (a) =>
        a.type === "asset" &&
        (/inventory|stock/i.test(a.name) ||
          a.code === "1300" ||
          a.code === "1400"),
    ),
  );

  const assets = sum(postable.filter((a) => a.type === "asset"));
  const liabilities = sum(postable.filter((a) => a.type === "liability"));
  const equity = sum(postable.filter((a) => a.type === "equity"));
  const income = sum(postable.filter((a) => a.type === "income"));
  const expense = sum(postable.filter((a) => a.type === "expense"));
  const netProfit = round(income - expense);
  const balanced = round(assets - (liabilities + equity)) === 0;

  // ── six-month cash-flow trend, receipts against payments ──────────────
  const trend = useMemo(() => {
    const MONTHS = 6;
    const now = new Date();
    const months = Array.from({ length: MONTHS }, (_, i) => {
      const d = new Date(
        now.getFullYear(),
        now.getMonth() - (MONTHS - 1 - i),
        1,
      );
      return {
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleString(undefined, { month: "short" }),
        In: 0,
        Out: 0,
      };
    });
    const index = new Map(months.map((m) => [m.key, m]));
    for (const e of entries) {
      const d = new Date(e.at);
      const bucket = index.get(`${d.getFullYear()}-${d.getMonth()}`);
      if (bucket === undefined) continue;
      for (const l of e.lines) {
        if (!moneyIds.has(l.accountId)) continue;
        if (l.debit > 0) bucket.In = round(bucket.In + l.debit);
        if (l.credit > 0) bucket.Out = round(bucket.Out + l.credit);
      }
    }
    return months;
  }, [entries, moneyIds]);

  const trendHasData = trend.some((m) => m.In !== 0 || m.Out !== 0);

  // ── where the money goes: the expense accounts carrying a balance ─────
  const expenseRows = useMemo(
    () =>
      postable
        .map((a) => ({ account: a, amount: natural(a) }))
        .filter((r) => r.account.type === "expense" && r.amount > 0.0001)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 6),
    [postable],
  );
  const expenseTop = expenseRows[0]?.amount ?? 1;

  const recent = useMemo(
    () => [...entries].sort((a, b) => b.at - a.at).slice(0, 6),
    [entries],
  );

  const hasBooks = postable.length > 0;

  return (
    <div className="space-y-4">
      {/* ── the four numbers a firm checks first ─────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<Landmark className="size-4" />}
          label="Cash & bank"
          value={money(cashAndBank)}
          sub={`${moneyAccounts.length} account${moneyAccounts.length === 1 ? "" : "s"}`}
          tone="sky"
          onClick={() => onOpen("cashbook")}
        />
        <StatCard
          icon={<ArrowDownRight className="size-4" />}
          label="Receivable"
          value={money(receivable)}
          sub="Owed to you"
          tone="emerald"
          onClick={() => onOpen("accounts")}
        />
        <StatCard
          icon={<ArrowUpRight className="size-4" />}
          label="Payable"
          value={money(payable)}
          sub="Owed by you"
          tone="rose"
          onClick={() => onOpen("accounts")}
        />
        <StatCard
          icon={netProfit >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />}
          label={netProfit >= 0 ? "Net profit" : "Net loss"}
          value={money(Math.abs(netProfit))}
          sub={`Income ${money(income)} · expenses ${money(expense)}`}
          tone={netProfit >= 0 ? "violet" : "rose"}
          onClick={() => onOpen("pandl")}
        />
      </div>

      {!hasBooks && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <span className="mr-2 font-semibold">✦</span>
          No chart of accounts yet — it is being prepared. Postings will appear
          here as soon as there are accounts to post to.
        </div>
      )}

      {/* ── cash flow + balance sheet snapshot ───────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm lg:col-span-2">
          <header className="flex flex-wrap items-center gap-2 border-b border-border/60 bg-gradient-to-r from-sky-500/[0.07] via-transparent to-emerald-500/[0.07] px-4 py-3">
            <div className="grid size-8 place-items-center rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <Banknote className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Cash flow
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Money in and out of cash &amp; bank, the last six months
              </p>
            </div>
            <span className="ml-auto flex items-center gap-3 text-[10.5px] font-medium">
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300">
                <span className="size-2 rounded-full bg-emerald-500" />
                Receipts
              </span>
              <span className="flex items-center gap-1.5 text-rose-700 dark:text-rose-300">
                <span className="size-2 rounded-full bg-rose-500" />
                Payments
              </span>
            </span>
          </header>

          <div className="px-3 py-3">
            {trendHasData ? (
              <ResponsiveContainer width="100%" height={232}>
                <AreaChart
                  data={trend}
                  margin={{ top: 8, right: 10, left: 4, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="acctIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.38} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="acctOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="var(--border)"
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    width={52}
                    stroke="var(--muted-foreground)"
                    tickFormatter={compact}
                  />
                  <Tooltip
                    formatter={(value) => money(Number(value))}
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "var(--muted-foreground)" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="In"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#acctIn)"
                  />
                  <Area
                    type="monotone"
                    dataKey="Out"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    fill="url(#acctOut)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-[232px] flex-col items-center justify-center gap-2 text-center">
                <Banknote className="size-6 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  Nothing has moved through cash or bank yet.
                </p>
                <button
                  type="button"
                  onClick={() => onOpen("receipt")}
                  className="rounded-lg border border-primary/30 bg-primary/[0.06] px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  Record a receipt
                </button>
              </div>
            )}
          </div>
        </section>

        {/* ── balance sheet snapshot ─────────────────────────────── */}
        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-r from-violet-500/[0.07] via-transparent to-indigo-500/[0.07] px-4 py-3">
            <div className="grid size-8 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <Scale className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Balance</h2>
              <p className="text-[11px] text-muted-foreground">
                Assets, liabilities &amp; equity
              </p>
            </div>
          </header>
          <div className="space-y-3.5 px-4 py-4">
            <BalanceBar
              label="Assets"
              value={assets}
              total={Math.max(assets, liabilities + equity, 1)}
              tone="sky"
              money={money}
            />
            <BalanceBar
              label="Liabilities"
              value={liabilities}
              total={Math.max(assets, liabilities + equity, 1)}
              tone="amber"
              money={money}
            />
            <BalanceBar
              label="Equity"
              value={equity}
              total={Math.max(assets, liabilities + equity, 1)}
              tone="violet"
              money={money}
            />
            <div className="flex items-center justify-between border-t border-border/60 pt-3">
              <span className="text-xs text-muted-foreground">
                Inventory on hand
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {money(inventory)}
              </span>
            </div>
            <div
              className={cn(
                "flex items-center gap-2 rounded-xl px-2.5 py-2 text-[11px] font-medium",
                balanced
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
              )}
            >
              {balanced ? (
                <Scale className="size-3.5 shrink-0" />
              ) : (
                <CircleDollarSign className="size-3.5 shrink-0" />
              )}
              {balanced
                ? "Books balance — assets equal liabilities plus equity."
                : "Not yet balanced — post opening balances or review the chart."}
            </div>
          </div>
        </section>
      </div>

      {/* ── where the money goes + recent postings ───────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <div className="grid size-8 place-items-center rounded-xl bg-rose-500/10 text-rose-700 dark:text-rose-300">
              <Wallet className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Where the money goes
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Largest expense accounts by balance
              </p>
            </div>
          </header>
          <div className="px-4 py-4">
            {expenseRows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No expenses posted yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {expenseRows.map((r) => (
                  <li key={r.account._id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-xs text-foreground/85">
                        <span className="mr-1.5 font-mono text-[10px] text-muted-foreground/70">
                          {r.account.code}
                        </span>
                        {r.account.name}
                      </span>
                      <span className="shrink-0 text-xs font-medium tabular-nums">
                        {money(r.amount)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/60">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-rose-500 to-rose-400"
                        style={{
                          width: `${Math.max(4, (r.amount / expenseTop) * 100)}%`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <div className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary">
              <ScrollText className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Recent postings
              </h2>
              <p className="text-[11px] text-muted-foreground">
                The last few entries in the ledger
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpen("journal")}
              className="ml-auto rounded-lg border border-border/60 px-2 py-1 text-[10.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              Open journal
            </button>
          </header>
          <div className="px-4 py-2">
            {recent.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing posted yet.
              </p>
            ) : (
              <ul className="divide-y divide-border/50">
                {recent.map((e) => (
                  <li
                    key={e._id}
                    className="flex items-center gap-2.5 py-2 text-xs"
                  >
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted/60 text-muted-foreground">
                      <BookOpen className="size-3" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground/85">
                        {e.party || e.memo || e.number}
                      </span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        <span className="font-mono">{e.number}</span>
                        {" · "}
                        {new Date(e.at).toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                        })}
                        {e.kind !== "journal" ? ` · ${e.kind}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-medium tabular-nums">
                        {money(e.debit)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* ── quick ways in ────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <div className="grid grid-cols-2 divide-x divide-y divide-border/60 sm:grid-cols-4 sm:divide-y-0">
          <Shortcut
            icon={<ScrollText className="size-4" />}
            label="Journal entry"
            hint="Post a balanced debit & credit"
            onClick={() => onOpen("journal")}
          />
          <Shortcut
            icon={<Receipt className="size-4" />}
            label="Receipt / payment"
            hint="Money in or out"
            onClick={() => onOpen("receipt")}
          />
          <Shortcut
            icon={<CalendarDays className="size-4" />}
            label="Day book"
            hint="Every posting, by day"
            onClick={() => onOpen("daybook")}
          />
          <Shortcut
            icon={<BookOpen className="size-4" />}
            label="Chart of accounts"
            hint="Every account & balance"
            onClick={() => onOpen("accounts")}
          />
        </div>
      </section>
    </div>
  );
}

/** One headline figure, clickable through to the page behind it. */
function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone: "sky" | "emerald" | "rose" | "violet";
  onClick: () => void;
}) {
  const chip: Record<typeof tone, string> = {
    sky: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
    emerald: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    rose: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
    violet: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  };
  const glow: Record<typeof tone, string> = {
    sky: "bg-sky-500/20",
    emerald: "bg-emerald-500/20",
    rose: "bg-rose-500/20",
    violet: "bg-violet-500/20",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <div
        className={cn(
          "pointer-events-none absolute -right-8 -top-10 size-28 rounded-full opacity-50 blur-2xl transition-opacity group-hover:opacity-80",
          glow[tone],
        )}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p className="mt-1.5 text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
            {value}
          </p>
          {sub && (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
              {sub}
            </p>
          )}
        </div>
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl",
            chip[tone],
          )}
        >
          {icon}
        </span>
      </div>
    </button>
  );
}

/** A labelled proportion bar for the balance snapshot. */
function BalanceBar({
  label,
  value,
  total,
  tone,
  money,
}: {
  label: string;
  value: number;
  total: number;
  tone: "sky" | "amber" | "violet";
  money: (n: number) => string;
}) {
  const bar: Record<typeof tone, string> = {
    sky: "from-sky-500 to-sky-400",
    amber: "from-amber-500 to-amber-400",
    violet: "from-violet-500 to-violet-400",
  };
  const pct = Math.max(2, Math.min(100, (Math.abs(value) / total) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold tabular-nums">
          {money(value)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/60">
        <div
          className={cn(
            "h-full rounded-full bg-gradient-to-r",
            bar[tone],
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** A tile in the quick-ways-in strip. */
function Shortcut({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent/40"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted/60 text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{label}</span>
        <span className="block truncate text-[10.5px] text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  );
}
