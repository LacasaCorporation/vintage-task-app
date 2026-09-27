import { api } from "@/convex/_generated/api";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  CalendarDays,
  Check,
  Download,
  FileBarChart,
  Package,
  Receipt,
  ShoppingCart,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";

/**
 * Reports.
 *
 * Everything on this page is a reading of data the rest of the app already
 * owns — no report writes, and no report keeps its own totals. The
 * statements are struck from the journal rather than from the account
 * balances, because a balance is "everything ever posted" and a profit for a
 * period is "what was posted between these two dates". The trial balance and
 * the balance sheet print what they find when the two sides do not meet,
 * because a statement that quietly disagrees is worse than one that admits it.
 *
 * One period control serves every report: the statements that are about a
 * period (P&L, sales, purchase, stock movement) follow it, and the two that
 * are a statement about today (trial balance, balance sheet) name the date
 * they were struck at instead.
 */

type ReportArea = "financial" | "sales" | "purchase" | "stock";

type RangeKey = "month" | "prev" | "quarter" | "year" | "all" | "custom";

const AREA_TABS: readonly PageTab<ReportArea>[] = [
  {
    id: "financial",
    label: "Financial",
    icon: BookOpen,
    hint: "Trial balance, balance sheet, profit and loss, day book",
  },
  {
    id: "sales",
    label: "Sales",
    icon: ShoppingCart,
    hint: "By product, by customer, over time, and what is still unpaid",
  },
  {
    id: "purchase",
    label: "Purchase",
    icon: Receipt,
    hint: "By supplier, by material, over time, and what is still unpaid",
  },
  {
    id: "stock",
    label: "Stock",
    icon: Package,
    hint: "What the shelves are worth, and what moved",
  },
];

const RANGE_PRESETS: readonly PageTab<RangeKey>[] = [
  { id: "month", label: "This month" },
  { id: "prev", label: "Last month" },
  { id: "quarter", label: "3 months" },
  { id: "year", label: "12 months" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

const pad = (n: number) => String(n).padStart(2, "0");

/** `1758000000000` → `"2026-09-16"`, in the reader's own timezone. */
function toInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function endOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
    .getTime();
}

type Range = { from: number; to: number; label: string };

function computeRange(
  key: RangeKey,
  customFrom: string,
  customTo: string,
): Range {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case "prev": {
      const first = new Date(y, m - 1, 1);
      return {
        from: startOfDay(first),
        to: endOfDay(new Date(y, m, 0)),
        label: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      };
    }
    case "quarter": {
      const first = new Date(y, m - 2, 1);
      return {
        from: startOfDay(first),
        to: endOfDay(now),
        label: "Last 3 months",
      };
    }
    case "year": {
      const first = new Date(y, m - 11, 1);
      return {
        from: startOfDay(first),
        to: endOfDay(now),
        label: "Last 12 months",
      };
    }
    case "all":
      return { from: 0, to: AS_AT, label: "All time" };
    case "custom": {
      const from = Date.parse(`${customFrom}T00:00:00`);
      const to = Date.parse(`${customTo}T23:59:59`);
      const ok =
        !Number.isNaN(from) && !Number.isNaN(to) && from <= to;
      return ok
        ? { from, to, label: `${toInput(from)} → ${toInput(to)}` }
        : { from: 0, to: AS_AT, label: "All time" };
    }
    case "month":
    default:
      return {
        from: startOfDay(new Date(y, m, 1)),
        to: endOfDay(now),
        label: now.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      };
  }
}

/** Today, once, as `yyyy-mm-dd` — the default "to" of a custom range. */
const TODAY = toInput(Date.now());

/**
 * The moment the page was opened, fixed once.
 *
 * A report is struck at a point in time. Reading the clock during render
 * would let the same page print one date in the heading and another a second
 * later, and every "as at" on the page should be the same instant anyway.
 */
const AS_AT = Date.now();
const AS_AT_LABEL = dayLabel(AS_AT);

/* ── shared furniture ─────────────────────────────────────────────── */

function downloadCsv(filename: string, rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], {
    type: "text/csv",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CsvButton({
  onClick,
  what,
}: {
  onClick: () => void;
  what: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Download ${what} as CSV`}
      aria-label={`Download ${what} as CSV`}
      className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
    >
      <Download className="size-3.5" />
    </button>
  );
}

function Panel({
  title,
  count,
  actions,
  children,
  className,
}: {
  title: string;
  count?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <p className="text-sm font-semibold">
          {title}
          {count && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </p>
        {actions && (
          <div className="flex items-center gap-1.5">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  tone = "text-foreground",
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone)}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** The arithmetic line under a statement, shown whether it agrees or not. */
function Proof({
  ok,
  children,
}: {
  ok: boolean;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs",
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
      )}
    >
      {ok ? (
        <Check className="size-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="size-3.5 shrink-0" />
      )}
      {children}
    </p>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-12 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function Bar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full", tone)}
        style={{ width: `${Math.max(1, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

const HEAD =
  "border-b border-border/60 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase";
const CELL = "px-3 py-2 text-right text-xs tabular-nums";
const CELL_LEFT = "px-3 py-2 text-xs";
const ROW = "transition-colors hover:bg-accent/40";
const TOTAL = "border-t border-border/60 text-sm font-semibold";

function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

const num = (n: number) => n.toFixed(2);

/* ── the page ──────────────────────────────────────────────────────── */

export default function ReportsPanel() {
  const [area, setArea] = useState<ReportArea>("financial");
  const [rangeKey, setRangeKey] = useState<RangeKey>("month");
  const [customFrom, setCustomFrom] = useState(() => {
    const now = new Date();
    return toInput(new Date(now.getFullYear(), now.getMonth(), 1).getTime());
  });
  const [customTo, setCustomTo] = useState(TODAY);

  const range = useMemo(
    () => computeRange(rangeKey, customFrom, customTo),
    [rangeKey, customFrom, customTo],
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageTabs
          tabs={AREA_TABS}
          value={area}
          onChange={setArea}
          label="Report areas"
          size="md"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <PageTabs
            tabs={RANGE_PRESETS}
            value={rangeKey}
            onChange={setRangeKey}
            label="Period"
          />
          {rangeKey === "custom" && (
            <>
              <Input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="Period from"
                className="h-7 w-32 rounded-lg text-xs"
              />
              <span className="text-[11px] text-muted-foreground">to</span>
              <Input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="Period to"
                className="h-7 w-32 rounded-lg text-xs"
              />
            </>
          )}
        </div>
      </div>

      {area === "financial" && <FinancialReports range={range} />}
      {area === "sales" && <SalesReports range={range} />}
      {area === "purchase" && <PurchaseReports range={range} />}
      {area === "stock" && <StockReports range={range} />}
    </div>
  );
}

function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly PageTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <PageTabs
      tabs={tabs}
      value={value}
      onChange={onChange}
      label={label}
      className="bg-card"
    />
  );
}

/* ── financial ────────────────────────────────────────────────────── */

type FinTab = "trial" | "position" | "pl" | "day";

const FIN_TABS: readonly PageTab<FinTab>[] = [
  { id: "trial", label: "Trial balance", icon: BookOpen },
  { id: "position", label: "Balance sheet", icon: FileBarChart },
  { id: "pl", label: "Profit & loss", icon: TrendingUp },
  { id: "day", label: "Day book", icon: CalendarDays },
];

function FinancialReports({ range }: { range: Range }) {
  const [tab, setTab] = useState<FinTab>("trial");
  return (
    <div className="space-y-4">
      <SubTabs tabs={FIN_TABS} value={tab} onChange={setTab} label="Financial reports" />
      {tab === "trial" && <TrialBalance range={range} />}
      {tab === "position" && <BalanceSheet range={range} />}
      {tab === "pl" && <ProfitAndLoss range={range} />}
      {tab === "day" && <DayBook range={range} />}
    </div>
  );
}

function TrialBalance({ range }: { range: Range }) {
  const { format: money } = useWorkspaceCurrency();
  const data = useQuery(api.reports.trialBalance);
  const rows = data?.rows ?? [];
  const totalDebit = data?.totalDebit ?? 0;
  const totalCredit = data?.totalCredit ?? 0;
  const difference = totalDebit - totalCredit;
  const balanced = Math.abs(difference) < 0.005;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Total debits" value={money(totalDebit)} tone="text-sky-600 dark:text-sky-400" />
        <Tile label="Total credits" value={money(totalCredit)} tone="text-amber-600 dark:text-amber-400" />
        <Tile
          label="Accounts with a balance"
          value={String(rows.length)}
          hint="Group headings are not counted"
        />
        <Tile
          label="Difference"
          value={money(difference)}
          tone={balanced ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
          hint={balanced ? "Debits equal credits" : "Out of balance"}
        />
      </div>

      <Proof ok={balanced}>
        {balanced ? (
          <>
            Every posting is on a double entry — {money(totalDebit)} of debits
            against {money(totalCredit)} of credits, as at {AS_AT_LABEL}.
          </>
        ) : (
          <>
            Debits and credits differ by {money(Math.abs(difference))}. Either a
            posting was saved with only one side, or an account was deleted after
            it had been used.
          </>
        )}
      </Proof>

      <Panel
        title="Trial balance"
        count={`${rows.length} accounts · as at ${AS_AT_LABEL}`}
        actions={
          <CsvButton
            what="trial balance"
            onClick={() =>
              downloadCsv("trial-balance.csv", [
                ["Code", "Account", "Type", "Debit", "Credit"],
                ...rows.map((r) => [r.code, r.name, r.type, num(r.debit), num(r.credit)]),
                ["", "Totals", "", num(totalDebit), num(totalCredit)],
              ])
            }
          />
        }
      >
        {rows.length === 0 ? (
          <Empty>No account carries a balance yet. Post a journal entry to start the books.</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr className={HEAD}>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2 text-left">Account</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className={CELL}>Debit</th>
                <th className={CELL}>Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r._id} className={ROW}>
                  <td className={`${CELL_LEFT} font-mono text-muted-foreground`}>
                    {r.code}
                  </td>
                  <td className={`${CELL_LEFT} font-medium`}>{r.name}</td>
                  <td className={`${CELL_LEFT} text-muted-foreground capitalize`}>
                    {r.type}
                  </td>
                  <td className={CELL}>{r.debit === 0 ? "—" : money(r.debit)}</td>
                  <td className={CELL}>{r.credit === 0 ? "—" : money(r.credit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={TOTAL}>
                <td className={CELL_LEFT} colSpan={3}>
                  Totals
                </td>
                <td className={CELL}>{money(totalDebit)}</td>
                <td className={CELL}>{money(totalCredit)}</td>
              </tr>
            </tfoot>
          </TableWrap>
        )}
      </Panel>
      <p className="text-[11px] text-muted-foreground">
        A trial balance is a statement about the whole of today, so the period
        control ({range.label}) does not change it.
      </p>
    </div>
  );
}

function BalanceSheet({ range }: { range: Range }) {
  const { format: money } = useWorkspaceCurrency();
  const data = useQuery(api.reports.financialPosition, {
    from: range.from === 0 ? undefined : range.from,
    to: range.to,
  });

  const section = (type: string) =>
    data?.sections.find((s) => s.type === type) ?? null;
  const assets = section("asset");
  const liabilities = section("liability");
  const equity = section("equity");
  const balanced = data !== undefined && Math.abs(data.difference) < 0.005;

  const block = (
    title: string,
    s: typeof assets,
    tone: string,
  ) => (
    <Panel title={title} count={s ? `${s.lines.length} accounts` : undefined}>
      {s === null || s.lines.length === 0 ? (
        <Empty>Nothing posted to this section.</Empty>
      ) : (
        <TableWrap>
          <tbody className="divide-y divide-border/60">
            {s.lines.map((l) => (
              <tr key={l._id} className={ROW}>
                <td className={`${CELL_LEFT} font-mono text-muted-foreground`}>
                  {l.code}
                </td>
                <td className={`${CELL_LEFT} font-medium`}>{l.name}</td>
                <td className={CELL}>{money(Math.abs(l.balance))}</td>
              </tr>
            ))}
            <tr className={TOTAL}>
              <td className={CELL_LEFT} colSpan={2}>
                Total {title.toLowerCase()}
              </td>
              <td className={cn(CELL, tone)}>{money(Math.abs(s.total))}</td>
            </tr>
          </tbody>
        </TableWrap>
      )}
    </Panel>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Total assets"
          value={money(Math.abs(data?.assets ?? 0))}
          tone="text-sky-600 dark:text-sky-400"
        />
        <Tile
          label="Liabilities"
          value={money(Math.abs(data?.liabilities ?? 0))}
          tone="text-amber-600 dark:text-amber-400"
        />
        <Tile
          label="Equity"
          value={money(Math.abs(data?.equity ?? 0))}
          tone="text-violet-600 dark:text-violet-400"
        />
        <Tile
          label="Profit for the period"
          value={money(data?.profit ?? 0)}
          hint={range.label}
          tone={
            (data?.profit ?? 0) < 0
              ? "text-rose-600 dark:text-rose-400"
              : "text-emerald-600 dark:text-emerald-400"
          }
        />
      </div>

      <Proof ok={balanced}>
        {data === undefined ? (
          "Reading the ledger…"
        ) : balanced ? (
          <>
            Assets of {money(data.assets)} are matched by {money(data.liabilities)} of
            liabilities, {money(data.equity)} of equity and {money(data.profit)} of
            profit for the period.
          </>
        ) : (
          <>
            The two sides differ by {money(Math.abs(data.difference))}. The usual
            cause is a document posted one-sided, or an opening balance entered
            without its matching side.
          </>
        )}
      </Proof>

      <div className="grid gap-4 xl:grid-cols-2">
        {block("Assets", assets, "text-sky-600 dark:text-sky-400")}
        <div className="space-y-4">
          {block("Liabilities", liabilities, "text-amber-600 dark:text-amber-400")}
          {block("Equity", equity, "text-violet-600 dark:text-violet-400")}
          <Panel title="Profit for the period" count={range.label}>
            <TableWrap>
              <tbody className="divide-y divide-border/60">
                <tr className={ROW}>
                  <td className={CELL_LEFT}>Income posted in the period</td>
                  <td className={CELL}>
                    {money(
                      (section("income")?.lines ?? []).reduce(
                        (s, l) => s + l.balance,
                        0,
                      ),
                    )}
                  </td>
                </tr>
                <tr className={ROW}>
                  <td className={CELL_LEFT}>Expenses posted in the period</td>
                  <td className={CELL}>
                    {money(
                      (section("expense")?.lines ?? []).reduce(
                        (s, l) => s + l.balance,
                        0,
                      ),
                    )}
                  </td>
                </tr>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT}>Profit carried to the credit side</td>
                  <td
                    className={cn(
                      CELL,
                      (data?.profit ?? 0) < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {money(data?.profit ?? 0)}
                  </td>
                </tr>
                <tr className="border-t border-border/60">
                  <td className={CELL_LEFT} colSpan={2}>
                    Liabilities + equity + profit
                  </td>
                </tr>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT}>Credit side total</td>
                  <td className={CELL}>{money(data?.credits ?? 0)}</td>
                </tr>
              </tbody>
            </TableWrap>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function ProfitAndLoss({ range }: { range: Range }) {
  const { format: money } = useWorkspaceCurrency();
  const data = useQuery(api.reports.profitAndLoss, {
    from: range.from,
    to: range.to,
  });
  const income = data?.income ?? [];
  const expense = data?.expense ?? [];
  const totalIncome = data?.totalIncome ?? 0;
  const totalExpense = data?.totalExpense ?? 0;
  const profit = data?.profit ?? 0;

  const column = (
    title: string,
    rows: { _id: string; code: string; name: string; amount: number }[],
    total: number,
    tone: string,
  ) => (
    <Panel title={title} count={`${rows.length} accounts`}>
      {rows.length === 0 ? (
        <Empty>Nothing posted in this period.</Empty>
      ) : (
        <TableWrap>
          <tbody className="divide-y divide-border/60">
            {rows.map((l) => (
              <tr key={l._id} className={ROW}>
                <td className={`${CELL_LEFT} font-mono text-muted-foreground`}>
                  {l.code}
                </td>
                <td className={`${CELL_LEFT} font-medium`}>{l.name}</td>
                <td className={CELL}>{money(l.amount)}</td>
              </tr>
            ))}
            <tr className={TOTAL}>
              <td className={CELL_LEFT} colSpan={2}>
                Total {title.toLowerCase()}
              </td>
              <td className={cn(CELL, tone)}>{money(total)}</td>
            </tr>
          </tbody>
        </TableWrap>
      )}
    </Panel>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Income"
          value={money(totalIncome)}
          tone="text-emerald-600 dark:text-emerald-400"
          hint={range.label}
        />
        <Tile
          label="Expenses"
          value={money(totalExpense)}
          tone="text-rose-600 dark:text-rose-400"
          hint={range.label}
        />
        <Tile
          label="Profit"
          value={money(profit)}
          tone={
            profit < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"
          }
        />
        <Tile
          label="Margin"
          value={`${(data?.margin ?? 0).toFixed(1)}%`}
          hint={totalIncome === 0 ? "No income in the period" : "Profit as a share of income"}
        />
      </div>

      {data?.empty && (
        <Proof ok={false}>
          Nothing was posted between {dayLabel(range.from)} and{" "}
          {dayLabel(range.to)}. Widen the period, or post a journal entry against
          the income and expense accounts.
        </Proof>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {column("Income", income, totalIncome, "text-emerald-600 dark:text-emerald-400")}
        {column("Expenses", expense, totalExpense, "text-rose-600 dark:text-rose-400")}
      </div>

      <Panel title="Result">
        <div className="space-y-2 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Income</span>
            <span className="tabular-nums">{money(totalIncome)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Less expenses</span>
            <span className="tabular-nums text-rose-600 dark:text-rose-400">
              −{money(totalExpense)}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
            <span>{profit < 0 ? "Loss for the period" : "Profit for the period"}</span>
            <span
              className={cn(
                "tabular-nums",
                profit < 0
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {money(profit)}
            </span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function DayBook({ range }: { range: Range }) {
  const { format: money } = useWorkspaceCurrency();
  const rows =
    useQuery(api.reports.dayBook, { from: range.from, to: range.to }) ?? [];
  const inTotal = rows.reduce((s, r) => s + r.debit, 0);
  const outTotal = rows.reduce((s, r) => s + r.credit, 0);
  const entryCount = rows.reduce((s, r) => s + r.entries, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Receipts"
          value={money(inTotal)}
          tone="text-emerald-600 dark:text-emerald-400"
          hint={range.label}
        />
        <Tile
          label="Payments"
          value={money(outTotal)}
          tone="text-rose-600 dark:text-rose-400"
          hint={range.label}
        />
        <Tile
          label="Net movement"
          value={money(inTotal - outTotal)}
          tone={inTotal - outTotal < 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}
        />
        <Tile label="Journal entries" value={String(entryCount)} />
      </div>

      <Panel
        title="Day book"
        count={`${rows.length} days with movement`}
        actions={
          <CsvButton
            what="day book"
            onClick={() =>
              downloadCsv("day-book.csv", [
                ["Date", "Entries", "Debits", "Credits", "Net", "Cash in", "Cash out"],
                ...rows.map((r) => [
                  toInput(r.day),
                  r.entries,
                  num(r.debit),
                  num(r.credit),
                  num(r.debit - r.credit),
                  num(r.cashDebit),
                  num(r.cashCredit),
                ]),
                ["Totals", entryCount, num(inTotal), num(outTotal), num(inTotal - outTotal), "", ""],
              ])
            }
          />
        }
      >
        {rows.length === 0 ? (
          <Empty>
            No posting between {dayLabel(range.from)} and {dayLabel(range.to)}.
          </Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr className={HEAD}>
                <th className={CELL_LEFT}>Date</th>
                <th className={CELL}>Entries</th>
                <th className={CELL}>Receipts</th>
                <th className={CELL}>Payments</th>
                <th className={CELL}>Cash &amp; bank in</th>
                <th className={CELL}>Cash &amp; bank out</th>
                <th className={CELL}>Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.day} className={ROW}>
                  <td className={`${CELL_LEFT} font-medium`}>{dayLabel(r.day)}</td>
                  <td className={CELL}>{r.entries}</td>
                  <td className={cn(CELL, "text-emerald-600 dark:text-emerald-400")}>
                    {r.debit === 0 ? "—" : money(r.debit)}
                  </td>
                  <td className={cn(CELL, "text-rose-600 dark:text-rose-400")}>
                    {r.credit === 0 ? "—" : money(r.credit)}
                  </td>
                  <td className={cn(CELL, "text-muted-foreground")}>
                    {r.cashDebit === 0 ? "—" : money(r.cashDebit)}
                  </td>
                  <td className={cn(CELL, "text-muted-foreground")}>
                    {r.cashCredit === 0 ? "—" : money(r.cashCredit)}
                  </td>
                  <td className={cn(CELL, "font-medium")}>
                    {money(r.debit - r.credit)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={TOTAL}>
                <td className={CELL_LEFT}>Total</td>
                <td className={CELL}>{entryCount}</td>
                <td className={CELL}>{money(inTotal)}</td>
                <td className={CELL}>{money(outTotal)}</td>
                <td className={CELL}>
                  {money(rows.reduce((s, r) => s + r.cashDebit, 0))}
                </td>
                <td className={CELL}>
                  {money(rows.reduce((s, r) => s + r.cashCredit, 0))}
                </td>
                <td className={CELL}>{money(inTotal - outTotal)}</td>
              </tr>
            </tfoot>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}

/* ── sales ────────────────────────────────────────────────────────── */

type SalesTab = "product" | "customer" | "time" | "unpaid";

const SALES_TABS: readonly PageTab<SalesTab>[] = [
  { id: "product", label: "By product", icon: Boxes },
  { id: "customer", label: "By customer", icon: ShoppingCart },
  { id: "time", label: "Over time", icon: TrendingUp },
  { id: "unpaid", label: "Unpaid", icon: AlertTriangle },
];

function SalesReports({ range }: { range: Range }) {
  const [tab, setTab] = useState<SalesTab>("product");
  const { format: money } = useWorkspaceCurrency();
  const data = useQuery(api.reports.salesAnalysis, { from: range.from, to: range.to });
  if (data === undefined) {
    return (
      <div className="space-y-4">
        <SubTabs
          tabs={SALES_TABS}
          value={tab}
          onChange={setTab}
          label="Sales reports"
        />
        <Empty>Reading the sales register…</Empty>
      </div>
    );
  }

  const invoices = data.byProduct.reduce((s, r) => s + r.invoices, 0);
  const maxPeriod = Math.max(1, ...data.byPeriod.map((p) => Math.abs(p.total)));

  return (
    <div className="space-y-4">
      <SubTabs
        tabs={SALES_TABS}
        value={tab}
        onChange={setTab}
        label="Sales reports"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Invoiced"
          value={money(data.totalInvoiced)}
          tone="text-emerald-600 dark:text-emerald-400"
          hint={range.label}
        />
        <Tile label="Invoices" value={String(invoices)} hint={range.label} />
        <Tile label="Line value" value={money(data.totalValue)} hint="Before tax and discount" />
        <Tile
          label="Outstanding"
          value={money(data.totalOutstanding)}
          tone={
            data.totalOutstanding > 0
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground"
          }
          hint="Across the whole ledger"
        />
      </div>

      {data.empty && (
        <Proof ok={false}>
          No invoice was raised between {dayLabel(range.from)} and{" "}
          {dayLabel(range.to)}.
        </Proof>
      )}

      {tab === "product" && (
        <Panel
          title="Sales by product"
          count={`${data.byProduct.length} products · ${range.label}`}
          actions={
            <CsvButton
              what="sales by product"
              onClick={() =>
                downloadCsv("sales-by-product.csv", [
                  ["Product", "Invoices", "Qty", "Value", "Paid", "Outstanding", "Share %"],
                  ...data.byProduct.map((r) => [
                    r.label,
                    r.invoices,
                    num(r.qty),
                    num(r.value),
                    num(r.paid),
                    num(r.outstanding),
                    r.share,
                  ]),
                ])
              }
            />
          }
        >
          {data.byProduct.length === 0 ? (
            <Empty>Nothing sold in this period.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Product</th>
                  <th className={CELL}>Invoices</th>
                  <th className={CELL}>Qty</th>
                  <th className={CELL}>Value</th>
                  <th className={CELL}>Paid</th>
                  <th className={CELL}>Outstanding</th>
                  <th className="w-32 px-3 py-2">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.byProduct.map((r) => (
                  <tr key={r.key} className={ROW}>
                    <td className={CELL_LEFT}>
                      <span className="font-medium">{r.label}</span>
                      {r.secondary && (
                        <span className="ml-2 text-muted-foreground">
                          per {r.secondary}
                        </span>
                      )}
                    </td>
                    <td className={CELL}>{r.invoices}</td>
                    <td className={CELL}>{r.qty}</td>
                    <td className={cn(CELL, "font-medium")}>{money(r.value)}</td>
                    <td className={cn(CELL, "text-emerald-600 dark:text-emerald-400")}>
                      {r.paid === 0 ? "—" : money(r.paid)}
                    </td>
                    <td className={CELL}>
                      {r.outstanding === 0 ? "—" : money(r.outstanding)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Bar pct={r.share} tone="bg-emerald-500" />
                        <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
                          {r.share}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT}>Total</td>
                  <td className={CELL}>{invoices}</td>
                  <td className={CELL}>
                    {num(data.byProduct.reduce((s, r) => s + r.qty, 0))}
                  </td>
                  <td className={CELL}>{money(data.totalValue)}</td>
                  <td className={CELL}>
                    {money(data.byProduct.reduce((s, r) => s + r.paid, 0))}
                  </td>
                  <td className={CELL}>
                    {money(data.byProduct.reduce((s, r) => s + r.outstanding, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>
      )}

      {tab === "customer" && (
        <Panel
          title="Sales by customer"
          count={`${data.byCustomer.length} customers · ${range.label}`}
          actions={
            <CsvButton
              what="sales by customer"
              onClick={() =>
                downloadCsv("sales-by-customer.csv", [
                  ["Customer", "Invoices", "Qty", "Billed", "Paid", "Outstanding", "Share %"],
                  ...data.byCustomer.map((r) => [
                    r.label,
                    r.invoices,
                    num(r.qty),
                    num(r.total),
                    num(r.paid),
                    num(r.outstanding),
                    r.share,
                  ]),
                ])
              }
            />
          }
        >
          {data.byCustomer.length === 0 ? (
            <Empty>Nothing sold in this period.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Customer</th>
                  <th className={CELL}>Invoices</th>
                  <th className={CELL}>Qty</th>
                  <th className={CELL}>Billed</th>
                  <th className={CELL}>Paid</th>
                  <th className={CELL}>Outstanding</th>
                  <th className="w-32 px-3 py-2">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.byCustomer.map((r) => (
                  <tr key={r.key} className={ROW}>
                    <td className={`${CELL_LEFT} font-medium`}>{r.label}</td>
                    <td className={CELL}>{r.invoices}</td>
                    <td className={CELL}>{r.qty}</td>
                    <td className={cn(CELL, "font-medium")}>{money(r.total)}</td>
                    <td className={cn(CELL, "text-emerald-600 dark:text-emerald-400")}>
                      {r.paid === 0 ? "—" : money(r.paid)}
                    </td>
                    <td className={CELL}>
                      {r.outstanding === 0 ? "—" : money(r.outstanding)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Bar pct={r.share} tone="bg-emerald-500" />
                        <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
                          {r.share}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT}>Total</td>
                  <td className={CELL}>{invoices}</td>
                  <td className={CELL}>
                    {num(data.byCustomer.reduce((s, r) => s + r.qty, 0))}
                  </td>
                  <td className={CELL}>{money(data.totalInvoiced)}</td>
                  <td className={CELL}>
                    {money(data.byCustomer.reduce((s, r) => s + r.paid, 0))}
                  </td>
                  <td className={CELL}>
                    {money(data.byCustomer.reduce((s, r) => s + r.outstanding, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>
      )}

      {tab === "time" && (
        <Panel
          title="Sales over time"
          count={`by ${data.bucket} · ${range.label}`}
          actions={
            <CsvButton
              what="sales over time"
              onClick={() =>
                downloadCsv("sales-over-time.csv", [
                  ["Period", "From", "To", "Invoices", "Qty", "Billed", "Paid", "Outstanding"],
                  ...data.byPeriod.map((p) => [
                    p.label,
                    toInput(p.from),
                    toInput(p.to),
                    p.invoices,
                    num(p.qty),
                    num(p.total),
                    num(p.paid),
                    num(p.outstanding),
                  ]),
                ])
              }
            />
          }
        >
          {data.byPeriod.length === 0 ? (
            <Empty>Nothing sold in this period.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Period</th>
                  <th className={CELL}>Invoices</th>
                  <th className={CELL}>Qty</th>
                  <th className={CELL}>Billed</th>
                  <th className={CELL}>Paid</th>
                  <th className={CELL}>Outstanding</th>
                  <th className="w-40 px-3 py-2">Billed against the best period</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.byPeriod.map((p) => (
                  <tr key={p.key} className={ROW}>
                    <td className={`${CELL_LEFT} font-medium`}>
                      {p.label}
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        {toInput(p.from)}
                      </span>
                    </td>
                    <td className={CELL}>{p.invoices}</td>
                    <td className={CELL}>{p.qty}</td>
                    <td className={cn(CELL, "font-medium")}>{money(p.total)}</td>
                    <td className={cn(CELL, "text-emerald-600 dark:text-emerald-400")}>
                      {p.paid === 0 ? "—" : money(p.paid)}
                    </td>
                    <td className={CELL}>
                      {p.outstanding === 0 ? "—" : money(p.outstanding)}
                    </td>
                    <td className="px-3 py-2">
                      <Bar pct={(Math.abs(p.total) / maxPeriod) * 100} tone="bg-primary" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT}>Total</td>
                  <td className={CELL}>{invoices}</td>
                  <td className={CELL}>
                    {num(data.byPeriod.reduce((s, p) => s + p.qty, 0))}
                  </td>
                  <td className={CELL}>{money(data.totalInvoiced)}</td>
                  <td className={CELL}>
                    {money(data.byPeriod.reduce((s, p) => s + p.paid, 0))}
                  </td>
                  <td className={CELL}>
                    {money(data.byPeriod.reduce((s, p) => s + p.outstanding, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>
      )}

      {tab === "unpaid" && (
        <Panel
          title="Unpaid invoices"
          count={`${data.unpaid.length} open · the whole ledger, not ${range.label}`}
          actions={
            <CsvButton
              what="unpaid invoices"
              onClick={() =>
                downloadCsv("unpaid-invoices.csv", [
                  ["Invoice", "Customer", "Date", "Due", "Total", "Age (days)", "Outstanding", "Overdue"],
                  ...data.unpaid.map((u) => [
                    u.number,
                    u.party,
                    toInput(u.at),
                    u.dueAt === undefined ? "" : toInput(u.dueAt),
                    num(u.total),
                    u.ageDays,
                    num(u.outstanding),
                    u.overdue ? "yes" : "no",
                  ]),
                  ["Total", "", "", "", "", "", num(data.totalOutstanding), ""],
                ])
              }
            />
          }
        >
          {data.unpaid.length === 0 ? (
            <Empty>Every invoice has been settled.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Invoice</th>
                  <th className={CELL_LEFT}>Customer</th>
                  <th className={CELL_LEFT}>Date</th>
                  <th className={CELL_LEFT}>Due</th>
                  <th className={CELL}>Total</th>
                  <th className={CELL}>Age</th>
                  <th className={CELL}>Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.unpaid.map((u) => (
                  <tr key={u._id} className={ROW}>
                    <td className={`${CELL_LEFT} font-mono`}>{u.number}</td>
                    <td className={`${CELL_LEFT} font-medium`}>{u.party}</td>
                    <td className={CELL_LEFT}>{dayLabel(u.at)}</td>
                    <td className={CELL_LEFT}>
                      {u.dueAt === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={cn(
                            u.overdue &&
                              "font-medium text-rose-600 dark:text-rose-400",
                          )}
                        >
                          {dayLabel(u.dueAt)}
                        </span>
                      )}
                    </td>
                    <td className={CELL}>{money(u.total)}</td>
                    <td className={CELL}>{u.ageDays}d</td>
                    <td
                      className={cn(
                        CELL,
                        "font-medium",
                        u.overdue
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {money(u.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT} colSpan={6}>
                    Total outstanding
                  </td>
                  <td className={cn(CELL, "text-amber-600 dark:text-amber-400")}>
                    {money(data.totalOutstanding)}
                  </td>
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>
      )}
    </div>
  );
}

/* ── purchase ─────────────────────────────────────────────────────── */

type PurchaseTab = "supplier" | "material" | "time" | "unpaid";

const PURCHASE_TABS: readonly PageTab<PurchaseTab>[] = [
  { id: "supplier", label: "By supplier", icon: Receipt },
  { id: "material", label: "By material", icon: Package },
  { id: "time", label: "Over time", icon: TrendingUp },
  { id: "unpaid", label: "Unpaid", icon: AlertTriangle },
];

function PurchaseReports({ range }: { range: Range }) {
  const [tab, setTab] = useState<PurchaseTab>("supplier");
  const data = useQuery(api.reports.purchaseAnalysis, {
    from: range.from,
    to: range.to,
  });
  const { format: money } = useWorkspaceCurrency();
  if (data === undefined) {
    return (
      <div className="space-y-4">
        <SubTabs
          tabs={PURCHASE_TABS}
          value={tab}
          onChange={setTab}
          label="Purchase reports"
        />
        <Empty>Reading the purchase register…</Empty>
      </div>
    );
  }

  const bills = data.bySupplier.reduce((s, r) => s + r.invoices, 0);
  const maxPeriod = Math.max(1, ...data.byPeriod.map((p) => Math.abs(p.total)));

  return (
    <div className="space-y-4">
      <SubTabs
        tabs={PURCHASE_TABS}
        value={tab}
        onChange={setTab}
        label="Purchase reports"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Billed"
          value={money(data.totalBilled)}
          tone="text-amber-600 dark:text-amber-400"
          hint={range.label}
        />
        <Tile label="Bills" value={String(bills)} hint={range.label} />
        <Tile label="Line value" value={money(data.totalValue)} hint="Before tax and discount" />
        <Tile
          label="Outstanding"
          value={money(data.totalOutstanding)}
          tone={
            data.totalOutstanding > 0
              ? "text-rose-600 dark:text-rose-400"
              : "text-muted-foreground"
          }
          hint="Across the whole ledger"
        />
      </div>

      {data.empty && (
        <Proof ok={false}>
          No bill was raised between {dayLabel(range.from)} and{" "}
          {dayLabel(range.to)}.
        </Proof>
      )}

      {tab === "supplier" && (
        <Panel
          title="Purchase by supplier"
          count={`${data.bySupplier.length} suppliers · ${range.label}`}
          actions={
            <CsvButton
              what="purchase by supplier"
              onClick={() =>
                downloadCsv("purchase-by-supplier.csv", [
                  ["Supplier", "Bills", "Qty", "Value", "Paid", "Outstanding", "Share %"],
                  ...data.bySupplier.map((r) => [
                    r.label,
                    r.invoices,
                    num(r.qty),
                    num(r.value),
                    num(r.paid),
                    num(r.outstanding),
                    r.share,
                  ]),
                ])
              }
            />
          }
        >
          {data.bySupplier.length === 0 ? (
            <Empty>Nothing bought in this period.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Supplier</th>
                  <th className={CELL}>Bills</th>
                  <th className={CELL}>Qty</th>
                  <th className={CELL}>Value</th>
                  <th className={CELL}>Paid</th>
                  <th className={CELL}>Outstanding</th>
                  <th className="w-32 px-3 py-2">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.bySupplier.map((r) => (
                  <tr key={r.key} className={ROW}>
                    <td className={`${CELL_LEFT} font-medium`}>{r.label}</td>
                    <td className={CELL}>{r.invoices}</td>
                    <td className={CELL}>{r.qty}</td>
                    <td className={cn(CELL, "font-medium")}>{money(r.value)}</td>
                    <td className={cn(CELL, "text-emerald-600 dark:text-emerald-400")}>
                      {r.paid === 0 ? "—" : money(r.paid)}
                    </td>
                    <td className={CELL}>
                      {r.outstanding === 0 ? "—" : money(r.outstanding)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Bar pct={r.share} tone="bg-amber-500" />
                        <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
                          {r.share}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT}>Total</td>
                  <td className={CELL}>{bills}</td>
                  <td className={CELL}>
                    {num(data.bySupplier.reduce((s, r) => s + r.qty, 0))}
                  </td>
                  <td className={CELL}>{money(data.totalValue)}</td>
                  <td className={CELL}>
                    {money(data.bySupplier.reduce((s, r) => s + r.paid, 0))}
                  </td>
                  <td className={CELL}>
                    {money(data.bySupplier.reduce((s, r) => s + r.outstanding, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>
      )}

      {tab === "material" && (
        <Panel
          title="Purchase by material"
          count={`${data.byMaterial.length} materials · ${range.label}`}
          actions={
            <CsvButton
              what="purchase by material"
              onClick={() =>
                downloadCsv("purchase-by-material.csv", [
                  ["Material", "Bills", "Qty", "Value", "Paid", "Outstanding", "Share %"],
                  ...data.byMaterial.map((r) => [
                    r.label,
                    r.invoices,
                    num(r.qty),
                    num(r.value),
                    num(r.paid),
                    num(r.outstanding),
                    r.share,
                  ]),
                ])
              }
            />
          }
        >
          {data.byMaterial.length === 0 ? (
            <Empty>Nothing bought in this period.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Material</th>
                  <th className={CELL}>Bills</th>
                  <th className={CELL}>Qty</th>
                  <th className={CELL}>Value</th>
                  <th className={CELL}>Paid</th>
                  <th className={CELL}>Outstanding</th>
                  <th className="w-32 px-3 py-2">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.byMaterial.map((r) => (
                  <tr key={r.key} className={ROW}>
                    <td className={CELL_LEFT}>
                      <span className="font-medium">{r.label}</span>
                      {r.secondary && (
                        <span className="ml-2 text-muted-foreground">
                          per {r.secondary}
                        </span>
                      )}
                    </td>
                    <td className={CELL}>{r.invoices}</td>
                    <td className={CELL}>{r.qty}</td>
                    <td className={cn(CELL, "font-medium")}>{money(r.value)}</td>
                    <td className={cn(CELL, "text-emerald-600 dark:text-emerald-400")}>
                      {r.paid === 0 ? "—" : money(r.paid)}
                    </td>
                    <td className={CELL}>
                      {r.outstanding === 0 ? "—" : money(r.outstanding)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Bar pct={r.share} tone="bg-amber-500" />
                        <span className="w-10 text-right text-[11px] tabular-nums text-muted-foreground">
                          {r.share}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT}>Total</td>
                  <td className={CELL}>{bills}</td>
                  <td className={CELL}>
                    {num(data.byMaterial.reduce((s, r) => s + r.qty, 0))}
                  </td>
                  <td className={CELL}>{money(data.totalValue)}</td>
                  <td className={CELL}>
                    {money(data.byMaterial.reduce((s, r) => s + r.paid, 0))}
                  </td>
                  <td className={CELL}>
                    {money(data.byMaterial.reduce((s, r) => s + r.outstanding, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>
      )}

      {tab === "time" && (
        <Panel
          title="Purchase over time"
          count={`by ${data.bucket} · ${range.label}`}
          actions={
            <CsvButton
              what="purchase over time"
              onClick={() =>
                downloadCsv("purchase-over-time.csv", [
                  ["Period", "From", "To", "Bills", "Qty", "Billed", "Paid", "Outstanding"],
                  ...data.byPeriod.map((p) => [
                    p.label,
                    toInput(p.from),
                    toInput(p.to),
                    p.invoices,
                    num(p.qty),
                    num(p.total),
                    num(p.paid),
                    num(p.outstanding),
                  ]),
                ])
              }
            />
          }
        >
          {data.byPeriod.length === 0 ? (
            <Empty>Nothing bought in this period.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Period</th>
                  <th className={CELL}>Bills</th>
                  <th className={CELL}>Qty</th>
                  <th className={CELL}>Billed</th>
                  <th className={CELL}>Paid</th>
                  <th className={CELL}>Outstanding</th>
                  <th className="w-40 px-3 py-2">Billed against the heaviest period</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.byPeriod.map((p) => (
                  <tr key={p.key} className={ROW}>
                    <td className={`${CELL_LEFT} font-medium`}>
                      {p.label}
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        {toInput(p.from)}
                      </span>
                    </td>
                    <td className={CELL}>{p.invoices}</td>
                    <td className={CELL}>{p.qty}</td>
                    <td className={cn(CELL, "font-medium")}>{money(p.total)}</td>
                    <td className={cn(CELL, "text-emerald-600 dark:text-emerald-400")}>
                      {p.paid === 0 ? "—" : money(p.paid)}
                    </td>
                    <td className={CELL}>
                      {p.outstanding === 0 ? "—" : money(p.outstanding)}
                    </td>
                    <td className="px-3 py-2">
                      <Bar pct={(Math.abs(p.total) / maxPeriod) * 100} tone="bg-primary" />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT}>Total</td>
                  <td className={CELL}>{bills}</td>
                  <td className={CELL}>
                    {num(data.byPeriod.reduce((s, p) => s + p.qty, 0))}
                  </td>
                  <td className={CELL}>{money(data.totalBilled)}</td>
                  <td className={CELL}>
                    {money(data.byPeriod.reduce((s, p) => s + p.paid, 0))}
                  </td>
                  <td className={CELL}>
                    {money(data.byPeriod.reduce((s, p) => s + p.outstanding, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>
      )}

      {tab === "unpaid" && (
        <Panel
          title="Unpaid bills"
          count={`${data.unpaid.length} open · the whole ledger, not ${range.label}`}
          actions={
            <CsvButton
              what="unpaid bills"
              onClick={() =>
                downloadCsv("unpaid-bills.csv", [
                  ["Bill", "Supplier", "Date", "Due", "Total", "Age (days)", "Outstanding", "Overdue"],
                  ...data.unpaid.map((u) => [
                    u.number,
                    u.party,
                    toInput(u.at),
                    u.dueAt === undefined ? "" : toInput(u.dueAt),
                    num(u.total),
                    u.ageDays,
                    num(u.outstanding),
                    u.overdue ? "yes" : "no",
                  ]),
                  ["Total", "", "", "", "", "", num(data.totalOutstanding), ""],
                ])
              }
            />
          }
        >
          {data.unpaid.length === 0 ? (
            <Empty>Every bill has been settled.</Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Bill</th>
                  <th className={CELL_LEFT}>Supplier</th>
                  <th className={CELL_LEFT}>Date</th>
                  <th className={CELL_LEFT}>Due</th>
                  <th className={CELL}>Total</th>
                  <th className={CELL}>Age</th>
                  <th className={CELL}>Outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.unpaid.map((u) => (
                  <tr key={u._id} className={ROW}>
                    <td className={`${CELL_LEFT} font-mono`}>{u.number}</td>
                    <td className={`${CELL_LEFT} font-medium`}>{u.party}</td>
                    <td className={CELL_LEFT}>{dayLabel(u.at)}</td>
                    <td className={CELL_LEFT}>
                      {u.dueAt === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span
                          className={cn(
                            u.overdue &&
                              "font-medium text-rose-600 dark:text-rose-400",
                          )}
                        >
                          {dayLabel(u.dueAt)}
                        </span>
                      )}
                    </td>
                    <td className={CELL}>{money(u.total)}</td>
                    <td className={CELL}>{u.ageDays}d</td>
                    <td
                      className={cn(
                        CELL,
                        "font-medium",
                        u.overdue
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {money(u.outstanding)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT} colSpan={6}>
                    Total outstanding
                  </td>
                  <td className={cn(CELL, "text-rose-600 dark:text-rose-400")}>
                    {money(data.totalOutstanding)}
                  </td>
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>
      )}
    </div>
  );
}

/* ── stock ────────────────────────────────────────────────────────── */

type StockTab = "valuation" | "movement";

const STOCK_TABS: readonly PageTab<StockTab>[] = [
  { id: "valuation", label: "Valuation", icon: Package },
  { id: "movement", label: "Movement", icon: Boxes },
];

function StockReports({ range }: { range: Range }) {
  const [tab, setTab] = useState<StockTab>("valuation");
  const data = useQuery(api.reports.stockAnalysis, {
    from: range.from,
    to: range.to,
  });
  const { format: money } = useWorkspaceCurrency();
  if (data === undefined) {
    return (
      <div className="space-y-4">
        <SubTabs
          tabs={STOCK_TABS}
          value={tab}
          onChange={setTab}
          label="Stock reports"
        />
        <Empty>Reading the stock ledger…</Empty>
      </div>
    );
  }

  const unpriced =
    data.materials.filter((r) => r.unpriced).length +
    data.products.filter((r) => r.unpriced).length;

  const table = (
    title: string,
    rows: typeof data.materials,
    total: number,
    tone: string,
  ) => (
    <Panel
      title={title}
      count={`${rows.length} stocked · as at ${AS_AT_LABEL}`}
      actions={
        <CsvButton
          what={title.toLowerCase()}
          onClick={() =>
            downloadCsv(`stock-${title.toLowerCase().replace(/\s+/g, "-")}.csv`, [
              ["Code", "Name", "Category", "Qty", "Unit", "Rate", "Value"],
              ...rows.map((r) => [
                r.code,
                r.name,
                r.category,
                num(r.qty),
                r.unit,
                num(r.rate),
                num(r.value),
              ]),
              ["Total", "", "", "", "", "", num(total)],
            ])
          }
        />
      }
    >
      {rows.length === 0 ? (
        <Empty>Nothing is stocked here yet.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr className={HEAD}>
              <th className={CELL_LEFT}>Code</th>
              <th className={CELL_LEFT}>Name</th>
              <th className={CELL}>Qty</th>
              <th className={CELL}>Rate</th>
              <th className={CELL}>Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.key} className={ROW}>
                <td className={`${CELL_LEFT} font-mono text-muted-foreground`}>
                  {r.code || "—"}
                </td>
                <td className={CELL_LEFT}>
                  <span className="font-medium">{r.name}</span>
                  {r.category && (
                    <span className="ml-2 text-muted-foreground">{r.category}</span>
                  )}
                  {r.unpriced && (
                    <span className="ml-2 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      no rate on record
                    </span>
                  )}
                </td>
                <td className={CELL}>
                  {r.qty} {r.unit}
                </td>
                <td className={CELL}>{r.unpriced ? "—" : money(r.rate)}</td>
                <td className={cn(CELL, "font-medium")}>
                  {r.unpriced ? "—" : money(r.value)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={TOTAL}>
              <td className={CELL_LEFT} colSpan={4}>
                Total {title.toLowerCase()}
              </td>
              <td className={cn(CELL, tone)}>{money(total)}</td>
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </Panel>
  );

  return (
    <div className="space-y-4">
      <SubTabs
        tabs={STOCK_TABS}
        value={tab}
        onChange={setTab}
        label="Stock reports"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Raw materials"
          value={money(data.materialTotal)}
          tone="text-amber-600 dark:text-amber-400"
          hint="At purchase price per unit"
        />
        <Tile
          label="Finished goods"
          value={money(data.productTotal)}
          tone="text-sky-600 dark:text-sky-400"
          hint="At the last invoiced price"
        />
        <Tile label="Stock on hand" value={money(data.total)} hint="Both shelves together" />
        <Tile
          label="Unpriced lines"
          value={String(unpriced)}
          tone={unpriced > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}
          hint="Carried at zero until a rate exists"
        />
      </div>

      {unpriced > 0 && (
        <Proof ok={false}>
          {unpriced} stocked {unpriced === 1 ? "line has" : "lines have"} no rate on
          record, so {unpriced === 1 ? "it is" : "they are"} shown at zero rather
          than at a guess. Give a material a price per unit, or invoice a product
          once, and it will be valued next time this page opens.
        </Proof>
      )}

      {tab === "valuation" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {table("Raw materials", data.materials, data.materialTotal, "text-amber-600 dark:text-amber-400")}
          {table("Finished goods", data.products, data.productTotal, "text-sky-600 dark:text-sky-400")}
        </div>
      ) : (
        <Panel
          title="Stock movement"
          count={`${data.movement.length} movements · ${range.label}`}
          actions={
            <CsvButton
              what="stock movement"
              onClick={() =>
                downloadCsv("stock-movement.csv", [
                  ["Date", "Shelf", "Name", "Code", "In", "Out", "Unit", "Rate", "Value", "Source", "Reference"],
                  ...data.movement.map((m) => [
                    toInput(m.at),
                    m.kind,
                    m.name,
                    m.code,
                    m.direction === "in" ? num(m.qty) : "",
                    m.direction === "out" ? num(m.qty) : "",
                    m.unit,
                    num(m.rate),
                    num(m.value),
                    m.source,
                    m.ref,
                  ]),
                ])
              }
            />
          }
        >
          {data.movement.length === 0 ? (
            <Empty>
              Nothing moved between {dayLabel(range.from)} and{" "}
              {dayLabel(range.to)}.
            </Empty>
          ) : (
            <TableWrap>
              <thead>
                <tr className={HEAD}>
                  <th className={CELL_LEFT}>Date</th>
                  <th className={CELL_LEFT}>Item</th>
                  <th className={CELL}>In</th>
                  <th className={CELL}>Out</th>
                  <th className={CELL}>Value</th>
                  <th className={CELL_LEFT}>Source</th>
                  <th className={CELL_LEFT}>Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.movement.map((m) => (
                  <tr key={m.key} className={ROW}>
                    <td className={CELL_LEFT}>{dayLabel(m.at)}</td>
                    <td className={CELL_LEFT}>
                      <span className="font-medium">{m.name}</span>
                      <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {m.kind === "material" ? "Material" : "Product"}
                      </span>
                    </td>
                    <td
                      className={cn(
                        CELL,
                        m.direction === "in" &&
                          "font-medium text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      {m.direction === "in" ? `${m.qty} ${m.unit}` : "—"}
                    </td>
                    <td
                      className={cn(
                        CELL,
                        m.direction === "out" &&
                          "font-medium text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {m.direction === "out" ? `${m.qty} ${m.unit}` : "—"}
                    </td>
                    <td className={CELL}>
                      {m.rate === 0 ? "—" : money(m.value)}
                    </td>
                    <td className={`${CELL_LEFT} capitalize text-muted-foreground`}>
                      {m.source.replace(/-/g, " ")}
                    </td>
                    <td className={CELL_LEFT}>
                      {m.ref || <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT} colSpan={2}>
                    Value moved in the period
                  </td>
                  <td
                    className={cn(
                      CELL,
                      "text-emerald-600 dark:text-emerald-400",
                    )}
                    colSpan={2}
                  >
                    {money(data.movementInValue)} in
                  </td>
                  <td className={cn(CELL, "text-rose-600 dark:text-rose-400")}>
                    {money(data.movementOutValue)} out
                  </td>
                  <td className={CELL} colSpan={2}>
                    {data.movement.length} movements
                  </td>
                </tr>
              </tfoot>
            </TableWrap>
          )}
        </Panel>
      )}

      <p className="text-[11px] text-muted-foreground">
        Materials are valued at the price the business buys them for. Products are
        valued at the price they last went out for, because a product carries no
        price of its own. Valuing finished goods at cost instead would need a
        costing method — weighted average or FIFO — chosen once and applied to
        every issue; that is a decision about the business, so it is not made
        silently here.
      </p>
    </div>
  );
}
