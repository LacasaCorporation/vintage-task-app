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
  Warehouse,
} from "lucide-react";
import type { ReportsArea } from "@/components/CostingSidebar";
import TradingAccount from "./TradingAccount";
import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";

/**
 * Reports.
 *
 * Everything on this page is a reading of data the rest of the app already
 * owns — no report writes, and no report keeps its own totals. Rates come
 * from the same places the working screens read them, through the same
 * helpers, so a figure here cannot quietly disagree with the figure on a
 * product's costing sheet or in the materials list.
 *
 * The statements are struck from the journal rather than from the account
 * balances, because a balance is "everything ever posted" and a profit for a
 * period is "what was posted between these two dates". The trial balance and
 * the balance sheet print what they find when the two sides do not meet,
 * because a statement that quietly disagrees is worse than one that admits it.
 *
 * The Sales and Purchase areas are the same four reports twice — a line item,
 * a party, a timeline, an unpaid list — so they are one set of tables fed by
 * two queries. The only difference between them is which way the money moves,
 * and that belongs in the column headings rather than in four hundred copied
 * lines that can drift apart.
 */

type ReportArea = ReportsArea;

type RangeKey = "month" | "prev" | "quarter" | "year" | "all" | "custom";

/**
 * Which area is on screen is chosen by the reports sidebar in the navigation
 * bar, so the panel itself draws only the period controls and the area's own
 * tables.
 */

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

export function dayLabel(ms: number): string {
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

export type Range = { from: number; to: number; label: string };

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
        label: first.toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        }),
      };
    }
    case "quarter":
      return {
        from: startOfDay(new Date(y, m - 2, 1)),
        to: endOfDay(now),
        label: "Last 3 months",
      };
    case "year":
      return {
        from: startOfDay(new Date(y, m - 11, 1)),
        to: endOfDay(now),
        label: "Last 12 months",
      };
    case "all":
      return { from: 0, to: AS_AT, label: "All time" };
    case "custom": {
      const from = Date.parse(`${customFrom}T00:00:00`);
      const to = Date.parse(`${customTo}T23:59:59`);
      if (Number.isNaN(from) || Number.isNaN(to) || from > to) {
        return { from: 0, to: AS_AT, label: "All time" };
      }
      return { from, to, label: `${toInput(from)} → ${toInput(to)}` };
    }
    case "month":
    default:
      return {
        from: startOfDay(new Date(y, m, 1)),
        to: endOfDay(now),
        label: now.toLocaleDateString(undefined, {
          month: "long",
          year: "numeric",
        }),
      };
  }
}

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

function CsvButton({ onClick, what }: { onClick: () => void; what: string }) {
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

export function Panel({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <p className="text-sm font-semibold">
          {title}
          {count && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </p>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Tile({
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
export function Proof({ ok, children }: { ok: boolean; children: React.ReactNode }) {
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

export function Empty({ children }: { children: React.ReactNode }) {
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

export const HEAD =
  "border-b border-border/60 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase";
export const CELL = "px-3 py-2 text-right text-xs tabular-nums";
export const CELL_LEFT = "px-3 py-2 text-xs";
export const ROW = "transition-colors hover:bg-accent/40";
export const TOTAL = "border-t border-border/60 text-sm font-semibold";
export const TH_R = cn(HEAD, "px-3 py-2 text-right");

export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export const num = (n: number) => n.toFixed(2);

export function SubTabs<T extends string>({
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

/* ── the page ──────────────────────────────────────────────────────── */

export default function ReportsPanel({ area }: { area: ReportArea }) {
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
      <div className="flex flex-wrap items-center justify-end gap-2">
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

/* ── financial ────────────────────────────────────────────────────── */

type FinTab = "trading" | "trial" | "position" | "pl" | "day";

const FIN_TABS: readonly PageTab<FinTab>[] = [
  { id: "trading", label: "Trading account", icon: Warehouse },
  { id: "trial", label: "Trial balance", icon: BookOpen },
  { id: "position", label: "Balance sheet", icon: FileBarChart },
  { id: "pl", label: "Profit & loss", icon: TrendingUp },
  { id: "day", label: "Day book", icon: CalendarDays },
];

export const GAIN = "text-emerald-600 dark:text-emerald-400";
export const LOSS = "text-rose-600 dark:text-rose-400";

function FinancialReports({ range }: { range: Range }) {
  const [tab, setTab] = useState<FinTab>("trading");
  return (
    <div className="space-y-4">
      <SubTabs
        tabs={FIN_TABS}
        value={tab}
        onChange={setTab}
        label="Financial reports"
      />
      {tab === "trading" && <TradingAccount range={range} />}
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
        <Tile
          label="Total debits"
          value={money(totalDebit)}
          tone="text-sky-600 dark:text-sky-400"
        />
        <Tile
          label="Total credits"
          value={money(totalCredit)}
          tone="text-amber-600 dark:text-amber-400"
        />
        <Tile
          label="Accounts with a balance"
          value={String(rows.length)}
          hint="Group headings are not counted"
        />
        <Tile
          label="Difference"
          value={money(difference)}
          tone={balanced ? GAIN : LOSS}
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
                ...rows.map((r) => [
                  r.code,
                  r.name,
                  r.type,
                  num(r.debit),
                  num(r.credit),
                ]),
                ["", "Totals", "", num(totalDebit), num(totalCredit)],
              ])
            }
          />
        }
      >
        {rows.length === 0 ? (
          <Empty>
            No account carries a balance yet. Post a journal entry to start the
            books.
          </Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr className={HEAD}>
                <th className={CELL_LEFT}>Code</th>
                <th className={CELL_LEFT}>Account</th>
                <th className={CELL_LEFT}>Type</th>
                <th className={TH_R}>Debit</th>
                <th className={TH_R}>Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r._id} className={ROW}>
                  <td className={`${CELL_LEFT} font-mono text-muted-foreground`}>
                    {r.code}
                  </td>
                  <td className={`${CELL_LEFT} font-medium`}>{r.name}</td>
                  <td
                    className={`${CELL_LEFT} text-muted-foreground capitalize`}
                  >
                    {r.type}
                  </td>
                  <td className={CELL}>
                    {r.debit === 0 ? "—" : money(r.debit)}
                  </td>
                  <td className={CELL}>
                    {r.credit === 0 ? "—" : money(r.credit)}
                  </td>
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

type Section = {
  type: string;
  label: string;
  lines: { _id: string; code: string; name: string; balance: number }[];
  total: number;
};

function BalanceSheet({ range }: { range: Range }) {
  const { format: money } = useWorkspaceCurrency();
  const data = useQuery(api.reports.financialPosition, {
    from: range.from === 0 ? undefined : range.from,
    to: range.to,
  });

  const section = (type: string): Section | null =>
    data?.sections.find((s) => s.type === type) ?? null;
  const assets = section("asset");
  const liabilities = section("liability");
  const equity = section("equity");
  const balanced = data !== undefined && Math.abs(data.difference) < 0.005;
  const sum = (s: Section | null) =>
    money(Math.abs(s?.lines.reduce((t, l) => t + l.balance, 0) ?? 0));

  const block = (title: string, s: Section | null, tone: string) => (
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
              <td className={cn(CELL, tone)}>{sum(s)}</td>
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
          tone={(data?.profit ?? 0) < 0 ? LOSS : GAIN}
        />
      </div>

      <Proof ok={balanced}>
        {data === undefined ? (
          "Reading the ledger…"
        ) : balanced ? (
          <>
            Assets of {money(data.assets)} are matched by {money(data.liabilities)}{" "}
            of liabilities, {money(data.equity)} of equity and {money(data.profit)} of
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
                  <td className={CELL}>{sum(section("income"))}</td>
                </tr>
                <tr className={ROW}>
                  <td className={CELL_LEFT}>Expenses posted in the period</td>
                  <td className={CELL}>{sum(section("expense"))}</td>
                </tr>
                <tr className={TOTAL}>
                  <td className={CELL_LEFT}>
                    Profit carried to the credit side
                  </td>
                  <td className={cn(CELL, (data?.profit ?? 0) < 0 ? LOSS : GAIN)}>
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

export type PlLine = { _id: string; code: string; name: string; amount: number };

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
    rows: PlLine[],
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
          tone={GAIN}
          hint={range.label}
        />
        <Tile
          label="Expenses"
          value={money(totalExpense)}
          tone={LOSS}
          hint={range.label}
        />
        <Tile
          label="Profit"
          value={money(profit)}
          tone={profit < 0 ? LOSS : GAIN}
        />
        <Tile
          label="Margin"
          value={`${(data?.margin ?? 0).toFixed(1)}%`}
          hint={
            totalIncome === 0
              ? "No income in the period"
              : "Profit as a share of income"
          }
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
        {column("Income", income, totalIncome, GAIN)}
        {column("Expenses", expense, totalExpense, LOSS)}
      </div>

      <Panel title="Result">
        <div className="space-y-2 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Income</span>
            <span className="tabular-nums">{money(totalIncome)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Less expenses</span>
            <span className={cn("tabular-nums", LOSS)}>−{money(totalExpense)}</span>
          </div>
          <div className="flex items-center justify-between border-t border-border/60 pt-2 text-base font-semibold">
            <span>
              {profit < 0 ? "Loss for the period" : "Profit for the period"}
            </span>
            <span className={cn("tabular-nums", profit < 0 ? LOSS : GAIN)}>
              {money(profit)}
            </span>
          </div>
        </div>
      </Panel>
    </div>
  );
}

type DayRow = {
  day: number;
  debit: number;
  credit: number;
  cashDebit: number;
  cashCredit: number;
  entries: number;
};

function DayBook({ range }: { range: Range }) {
  const { format: money } = useWorkspaceCurrency();
  const data = useQuery(api.reports.dayBook, {
    from: range.from,
    to: range.to,
  });
  const rows: DayRow[] = data ?? [];
  const sum = (pick: (r: DayRow) => number) =>
    rows.reduce((s, r) => s + pick(r), 0);
  const inTotal = sum((r) => r.debit);
  const outTotal = sum((r) => r.credit);
  const entryCount = sum((r) => r.entries);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Receipts"
          value={money(inTotal)}
          tone={GAIN}
          hint={range.label}
        />
        <Tile
          label="Payments"
          value={money(outTotal)}
          tone={LOSS}
          hint={range.label}
        />
        <Tile
          label="Net movement"
          value={money(inTotal - outTotal)}
          tone={inTotal - outTotal < 0 ? LOSS : GAIN}
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
                [
                  "Date",
                  "Entries",
                  "Debits",
                  "Credits",
                  "Net",
                  "Cash in",
                  "Cash out",
                ],
                ...rows.map((r) => [
                  toInput(r.day),
                  r.entries,
                  num(r.debit),
                  num(r.credit),
                  num(r.debit - r.credit),
                  num(r.cashDebit),
                  num(r.cashCredit),
                ]),
                [
                  "Totals",
                  entryCount,
                  num(inTotal),
                  num(outTotal),
                  num(inTotal - outTotal),
                  num(sum((r) => r.cashDebit)),
                  num(sum((r) => r.cashCredit)),
                ],
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
                <th className={TH_R}>Entries</th>
                <th className={TH_R}>Receipts</th>
                <th className={TH_R}>Payments</th>
                <th className={TH_R}>Cash &amp; bank in</th>
                <th className={TH_R}>Cash &amp; bank out</th>
                <th className={TH_R}>Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.day} className={ROW}>
                  <td className={`${CELL_LEFT} font-medium`}>
                    {dayLabel(r.day)}
                  </td>
                  <td className={CELL}>{r.entries}</td>
                  <td className={cn(CELL, GAIN)}>
                    {r.debit === 0 ? "—" : money(r.debit)}
                  </td>
                  <td className={cn(CELL, LOSS)}>
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
                <td className={CELL}>{money(sum((r) => r.cashDebit))}</td>
                <td className={CELL}>{money(sum((r) => r.cashCredit))}</td>
                <td className={CELL}>{money(inTotal - outTotal)}</td>
              </tr>
            </tfoot>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}

/* ── sales and purchase: the same four reports, twice ──────────────── */

type DocTab = "item" | "party" | "time" | "unpaid";

const SALES_TABS: readonly PageTab<DocTab>[] = [
  { id: "item", label: "By product", icon: Boxes },
  { id: "party", label: "By customer", icon: ShoppingCart },
  { id: "time", label: "Over time", icon: TrendingUp },
  { id: "unpaid", label: "Unpaid", icon: AlertTriangle },
];

const PURCHASE_TABS: readonly PageTab<DocTab>[] = [
  { id: "item", label: "By material", icon: Package },
  { id: "party", label: "By supplier", icon: Receipt },
  { id: "time", label: "Over time", icon: TrendingUp },
  { id: "unpaid", label: "Unpaid", icon: AlertTriangle },
];

type GroupRow = {
  key: string;
  label: string;
  secondary: string;
  invoices: number;
  qty: number;
  value: number;
  total: number;
  paid: number;
  outstanding: number;
  share: number;
};

type PeriodRow = {
  key: string;
  label: string;
  from: number;
  to: number;
  invoices: number;
  qty: number;
  total: number;
  paid: number;
  outstanding: number;
};

type UnpaidRow = {
  _id: string;
  number: string;
  at: number;
  dueAt?: number;
  party: string;
  total: number;
  outstanding: number;
  ageDays: number;
  overdue: boolean;
};

/**
 * Everything the four document reports need, whichever side of the ledger
 * they read. `value` is the line value before tax and discount; `total` is
 * what the document actually came to. Both are shown, because a document
 * discounted or taxed heavily still moves the same goods.
 */
type DocAnalysis = {
  bucket: string;
  item: GroupRow[];
  party: GroupRow[];
  byPeriod: PeriodRow[];
  unpaid: UnpaidRow[];
  total: number;
  totalValue: number;
  totalOutstanding: number;
  empty: boolean;
};

/** The words that turn one set of tables into the sales side or the purchase. */
type DocWords = {
  doc: string;
  party: string;
  tone: "emerald" | "amber";
  itemTitle: string;
  partyTitle: string;
  timeTitle: string;
  unpaidTitle: string;
  csvBase: string;
  emptyNoun: string;
};

const SALES_WORDS: DocWords = {
  doc: "Invoices",
  party: "Customer",
  tone: "emerald",
  itemTitle: "Sales by product",
  partyTitle: "Sales by customer",
  timeTitle: "Sales over time",
  unpaidTitle: "Unpaid invoices",
  csvBase: "sales",
  emptyNoun: "invoice",
};

const PURCHASE_WORDS: DocWords = {
  doc: "Bills",
  party: "Supplier",
  tone: "amber",
  itemTitle: "Purchase by material",
  partyTitle: "Purchase by supplier",
  timeTitle: "Purchase over time",
  unpaidTitle: "Unpaid bills",
  csvBase: "purchase",
  emptyNoun: "bill",
};

function toneClass(tone: DocWords["tone"]) {
  return tone === "emerald"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-amber-600 dark:text-amber-400";
}

function toneFill(tone: DocWords["tone"]) {
  return tone === "emerald" ? "bg-emerald-500" : "bg-amber-500";
}

function GroupTable({
  title,
  rows,
  words,
  money,
  noun,
}: {
  title: string;
  rows: GroupRow[];
  words: DocWords;
  money: (n: number) => string;
  noun: string;
}) {
  const sum = (pick: (r: GroupRow) => number) =>
    rows.reduce((s, r) => s + pick(r), 0);
  return (
    <Panel
      title={title}
      count={`${rows.length} ${noun} · the period above`}
      actions={
        <CsvButton
          what={title.toLowerCase()}
          onClick={() =>
            downloadCsv(`${words.csvBase}-${noun.replace(/\s+/g, "-")}.csv`, [
              [
                words.party,
                words.doc,
                "Qty",
                "Line value",
                "Billed",
                "Paid",
                "Outstanding",
                "Share %",
              ],
              ...rows.map((r) => [
                r.label,
                r.invoices,
                num(r.qty),
                num(r.value),
                num(r.total),
                num(r.paid),
                num(r.outstanding),
                r.share,
              ]),
              [
                "Total",
                sum((r) => r.invoices),
                num(sum((r) => r.qty)),
                num(sum((r) => r.value)),
                num(sum((r) => r.total)),
                num(sum((r) => r.paid)),
                num(sum((r) => r.outstanding)),
                "",
              ],
            ])
          }
        />
      }
    >
      {rows.length === 0 ? (
        <Empty>Nothing recorded in this period.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr className={HEAD}>
              <th className={CELL_LEFT}>{words.party}</th>
              <th className={TH_R}>{words.doc}</th>
              <th className={TH_R}>Qty</th>
              <th className={TH_R}>Line value</th>
              <th className={TH_R}>Billed</th>
              <th className={TH_R}>Paid</th>
              <th className={TH_R}>Outstanding</th>
              <th className="w-32 px-3 py-2">Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
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
                <td className={CELL}>{money(r.value)}</td>
                <td className={cn(CELL, "font-medium")}>{money(r.total)}</td>
                <td className={cn(CELL, GAIN)}>
                  {r.paid === 0 ? "—" : money(r.paid)}
                </td>
                <td className={CELL}>
                  {r.outstanding === 0 ? "—" : money(r.outstanding)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Bar pct={r.share} tone={toneFill(words.tone)} />
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
              <td className={CELL}>{sum((r) => r.invoices)}</td>
              <td className={CELL}>{num(sum((r) => r.qty))}</td>
              <td className={CELL}>{money(sum((r) => r.value))}</td>
              <td className={CELL}>{money(sum((r) => r.total))}</td>
              <td className={CELL}>{money(sum((r) => r.paid))}</td>
              <td className={CELL}>{money(sum((r) => r.outstanding))}</td>
              <td />
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </Panel>
  );
}

function PeriodTable({
  title,
  rows,
  bucket,
  words,
  money,
}: {
  title: string;
  rows: PeriodRow[];
  bucket: string;
  words: DocWords;
  money: (n: number) => string;
}) {
  const sum = (pick: (r: PeriodRow) => number) =>
    rows.reduce((s, r) => s + pick(r), 0);
  // every bar is drawn against the biggest period, so the shape of the
  // timeline can be read at a glance rather than compared cell by cell
  const peak = Math.max(1, ...rows.map((r) => Math.abs(r.total)));
  return (
    <Panel
      title={title}
      count={`by ${bucket} · ${rows.length} periods`}
      actions={
        <CsvButton
          what={title.toLowerCase()}
          onClick={() =>
            downloadCsv(`${words.csvBase}-over-time.csv`, [
              ["Period", "From", "To", words.doc, "Qty", "Billed", "Paid", "Outstanding"],
              ...rows.map((r) => [
                r.label,
                toInput(r.from),
                toInput(r.to),
                r.invoices,
                num(r.qty),
                num(r.total),
                num(r.paid),
                num(r.outstanding),
              ]),
              [
                "Total",
                "",
                "",
                sum((r) => r.invoices),
                num(sum((r) => r.qty)),
                num(sum((r) => r.total)),
                num(sum((r) => r.paid)),
                num(sum((r) => r.outstanding)),
              ],
            ])
          }
        />
      }
    >
      {rows.length === 0 ? (
        <Empty>Nothing recorded in this period.</Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr className={HEAD}>
              <th className={CELL_LEFT}>Period</th>
              <th className={TH_R}>{words.doc}</th>
              <th className={TH_R}>Qty</th>
              <th className={TH_R}>Billed</th>
              <th className={TH_R}>Paid</th>
              <th className={TH_R}>Outstanding</th>
              <th className="w-40 px-3 py-2">Against the biggest period</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.key} className={ROW}>
                <td className={`${CELL_LEFT} font-medium`}>
                  {r.label}
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    {toInput(r.from)}
                  </span>
                </td>
                <td className={CELL}>{r.invoices}</td>
                <td className={CELL}>{r.qty}</td>
                <td className={cn(CELL, "font-medium")}>{money(r.total)}</td>
                <td className={cn(CELL, GAIN)}>
                  {r.paid === 0 ? "—" : money(r.paid)}
                </td>
                <td className={CELL}>
                  {r.outstanding === 0 ? "—" : money(r.outstanding)}
                </td>
                <td className="px-3 py-2">
                  <Bar
                    pct={(Math.abs(r.total) / peak) * 100}
                    tone={toneFill(words.tone)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={TOTAL}>
              <td className={CELL_LEFT}>Total</td>
              <td className={CELL}>{sum((r) => r.invoices)}</td>
              <td className={CELL}>{num(sum((r) => r.qty))}</td>
              <td className={CELL}>{money(sum((r) => r.total))}</td>
              <td className={CELL}>{money(sum((r) => r.paid))}</td>
              <td className={CELL}>{money(sum((r) => r.outstanding))}</td>
              <td />
            </tr>
          </tfoot>
        </TableWrap>
      )}
    </Panel>
  );
}

/**
 * What is still owed.
 *
 * This one is not a period report. An invoice stays unpaid until it is
 * settled, however far back it was raised, so the list is always the whole
 * ledger and the heading says so — a total that quietly followed the date
 * filter above it would be a lie.
 */
function UnpaidTable({
  title,
  rows,
  total,
  words,
  money,
}: {
  title: string;
  rows: UnpaidRow[];
  total: number;
  words: DocWords;
  money: (n: number) => string;
}) {
  const overdue = rows.filter((r) => r.overdue);
  const docWord = words.doc === "Invoices" ? "Invoice" : "Bill";
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Outstanding"
          value={money(total)}
          tone={toneClass(words.tone)}
          hint={`${rows.length} open ${docWord.toLowerCase()}s`}
        />
        <Tile
          label="Past its due date"
          value={money(overdue.reduce((s, r) => s + r.outstanding, 0))}
          tone={LOSS}
          hint={`${overdue.length} overdue`}
        />
        <Tile
          label="Oldest"
          value={`${Math.max(0, ...rows.map((r) => r.ageDays))} days`}
          hint="Since the document was raised"
        />
      </div>
      <Panel
        title={title}
        count={`${rows.length} open · the whole ledger, whatever the period above`}
        actions={
          <CsvButton
            what={title.toLowerCase()}
            onClick={() =>
              downloadCsv(`${words.csvBase}-unpaid.csv`, [
                [
                  docWord,
                  words.party,
                  "Date",
                  "Due",
                  "Total",
                  "Age (days)",
                  "Outstanding",
                  "Overdue",
                ],
                ...rows.map((r) => [
                  r.number,
                  r.party,
                  toInput(r.at),
                  r.dueAt === undefined ? "" : toInput(r.dueAt),
                  num(r.total),
                  r.ageDays,
                  num(r.outstanding),
                  r.overdue ? "yes" : "no",
                ]),
                ["Total", "", "", "", "", "", num(total), ""],
              ])
            }
          />
        }
      >
        {rows.length === 0 ? (
          <Empty>Everything is settled.</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr className={HEAD}>
                <th className={CELL_LEFT}>{docWord}</th>
                <th className={CELL_LEFT}>{words.party}</th>
                <th className={CELL_LEFT}>Date</th>
                <th className={CELL_LEFT}>Due</th>
                <th className={TH_R}>Total</th>
                <th className={TH_R}>Age</th>
                <th className={TH_R}>Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r._id} className={ROW}>
                  <td className={`${CELL_LEFT} font-mono`}>{r.number}</td>
                  <td className={`${CELL_LEFT} font-medium`}>{r.party}</td>
                  <td className={CELL_LEFT}>{dayLabel(r.at)}</td>
                  <td className={CELL_LEFT}>
                    {r.dueAt === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          r.overdue && "font-medium text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {dayLabel(r.dueAt)}
                      </span>
                    )}
                  </td>
                  <td className={CELL}>{money(r.total)}</td>
                  <td className={CELL}>{r.ageDays}d</td>
                  <td
                    className={cn(
                      CELL,
                      "font-medium",
                      r.overdue ? LOSS : toneClass(words.tone),
                    )}
                  >
                    {money(r.outstanding)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={TOTAL}>
                <td className={CELL_LEFT} colSpan={6}>
                  Total outstanding
                </td>
                <td className={cn(CELL, toneClass(words.tone))}>
                  {money(total)}
                </td>
              </tr>
            </tfoot>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}

/** The area shell: four sub-tabs, four tiles, one shared set of tables. */
function DocumentReports({
  tabs,
  words,
  analysis,
  range,
}: {
  tabs: readonly PageTab<DocTab>[];
  words: DocWords;
  analysis: DocAnalysis | undefined;
  range: Range;
}) {
  const [tab, setTab] = useState<DocTab>("item");
  const { format: money } = useWorkspaceCurrency();

  if (analysis === undefined) {
    return (
      <div className="space-y-4">
        <SubTabs tabs={tabs} value={tab} onChange={setTab} label="Reports" />
        <Empty>Reading the register…</Empty>
      </div>
    );
  }

  const docs = analysis.item.reduce((s, r) => s + r.invoices, 0);

  return (
    <div className="space-y-4">
      <SubTabs tabs={tabs} value={tab} onChange={setTab} label="Reports" />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Billed"
          value={money(analysis.total)}
          tone={toneClass(words.tone)}
          hint={range.label}
        />
        <Tile label={words.doc} value={String(docs)} hint={range.label} />
        <Tile
          label="Line value"
          value={money(analysis.totalValue)}
          hint="Before tax and discount"
        />
        <Tile
          label="Outstanding"
          value={money(analysis.totalOutstanding)}
          tone={
            analysis.totalOutstanding > 0
              ? toneClass(words.tone)
              : "text-muted-foreground"
          }
          hint="Across the whole ledger"
        />
      </div>

      {analysis.empty && (
        <Proof ok={false}>
          No {words.emptyNoun} was raised between {dayLabel(range.from)} and{" "}
          {dayLabel(range.to)}.
        </Proof>
      )}

      {tab === "item" && (
        <GroupTable
          title={words.itemTitle}
          rows={analysis.item}
          words={words}
          money={money}
          noun={words.tone === "emerald" ? "products" : "materials"}
        />
      )}
      {tab === "party" && (
        <GroupTable
          title={words.partyTitle}
          rows={analysis.party}
          words={words}
          money={money}
          noun={
            words.tone === "emerald" ? "customers" : "suppliers"
          }
        />
      )}
      {tab === "time" && (
        <PeriodTable
          title={words.timeTitle}
          rows={analysis.byPeriod}
          bucket={analysis.bucket}
          words={words}
          money={money}
        />
      )}
      {tab === "unpaid" && (
        <UnpaidTable
          title={words.unpaidTitle}
          rows={analysis.unpaid}
          total={analysis.totalOutstanding}
          words={words}
          money={money}
        />
      )}
    </div>
  );
}

function SalesReports({ range }: { range: Range }) {
  const data = useQuery(api.reports.salesAnalysis, {
    from: range.from,
    to: range.to,
  });
  // the query names its groupings after what it read (products, customers);
  // the two sides share one set of tables, so the names are bridged here
  const analysis: DocAnalysis | undefined =
    data === undefined
      ? undefined
      : {
          bucket: data.bucket,
          item: data.byProduct,
          party: data.byCustomer,
          byPeriod: data.byPeriod,
          unpaid: data.unpaid,
          total: data.totalInvoiced,
          totalValue: data.totalValue,
          totalOutstanding: data.totalOutstanding,
          empty: data.empty,
        };
  return (
    <DocumentReports
      tabs={SALES_TABS}
      words={SALES_WORDS}
      analysis={analysis}
      range={range}
    />
  );
}

function PurchaseReports({ range }: { range: Range }) {
  const data = useQuery(api.reports.purchaseAnalysis, {
    from: range.from,
    to: range.to,
  });
  const analysis: DocAnalysis | undefined =
    data === undefined
      ? undefined
      : {
          bucket: data.bucket,
          item: data.byMaterial,
          party: data.bySupplier,
          byPeriod: data.byPeriod,
          unpaid: data.unpaid,
          total: data.totalBilled,
          totalValue: data.totalValue,
          totalOutstanding: data.totalOutstanding,
          empty: data.empty,
        };
  return (
    <DocumentReports
      tabs={PURCHASE_TABS}
      words={PURCHASE_WORDS}
      analysis={analysis}
      range={range}
    />
  );
}

/* ── stock ────────────────────────────────────────────────────────── */

type StockTab = "valuation" | "movement";

const STOCK_TABS: readonly PageTab<StockTab>[] = [
  { id: "valuation", label: "Valuation", icon: Package },
  { id: "movement", label: "Movement", icon: Boxes },
];

type ValuationRow = {
  key: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  /**
   * What one unit costs on a moving weighted average. The value is struck on
   * this, never on the sale price.
   */
  cost: number;
  /** What one unit sells for — reference only. */
  price: number;
  value: number;
  basis: "average" | "price" | "costing" | "invoice" | "none";
  /** How much was ever bought, which is what the average is taken over. */
  bought: number;
  /** The most recent purchase price, beside the average it produced. */
  lastCost: number;
};

/** Where a rate came from, said out loud rather than left to be guessed. */
function BasisChip({ row }: { row: ValuationRow }) {
  if (row.basis === "none") {
    return (
      <span className="ml-2 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
        no cost on record
      </span>
    );
  }
  if (row.basis === "invoice") {
    return (
      <span
        title="This product has no costing sheet, so it is valued at the price it last went out for."
        className="ml-2 rounded-md bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-400"
      >
        from last invoice
      </span>
    );
  }
  if (row.basis === "price") {
    return (
      <span
        title="Nothing has been bought against this material yet, so the catalogue price stands in for the average."
        className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
      >
        catalogue price
      </span>
    );
  }
  return null;
}

/**
 * The average, shown as what it is: an average over what was bought.
 *
 * The latest purchase price sits beside it, because that is the number a
 * manager will remember, and when it has drifted from the average the
 * difference is worth seeing rather than smoothing away.
 */
function AverageNote({
  row,
  money,
}: {
  row: ValuationRow;
  money: (n: number) => string;
}) {
  if (row.basis !== "average" || row.bought <= 0) return null;
  const drift =
    row.cost > 0 ? Math.abs(row.lastCost - row.cost) / row.cost : 0;
  return (
    <span
      className="ml-2 text-[11px] text-muted-foreground"
      title={`Weighted average of everything ever bought, against the most recent purchase price.`}
    >
      avg over {row.bought}
      {drift >= 0.01 && (
        <span
          className={cn(
            "ml-1 font-medium",
            row.lastCost > row.cost ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          · last {money(row.lastCost)}
        </span>
      )}
    </span>
  );
}

function ValuationTable({
  title,
  rows,
  money,
  csv,
  showSalePrice,
}: {
  title: string;
  rows: ValuationRow[];
  money: (n: number) => string;
  csv: string;
  /** A raw material is bought, not sold, so it has no sale price of its own. */
  showSalePrice: boolean;
}) {
  const atCost = rows.reduce((s, r) => s + r.value, 0);
  const unpriced = rows.filter((r) => r.basis === "none").length;

  return (
    <Panel
      title={title}
      count={`${rows.length} stocked · as at ${AS_AT_LABEL}`}
      actions={
        <CsvButton
          what={title.toLowerCase()}
          onClick={() =>
            downloadCsv(`${csv}.csv`, [
              [
                "Code",
                "Name",
                "Category",
                "Qty",
                "Unit",
                "Cost",
                "Sales price",
                "Value",
              ],
              ...rows.map((r) => [
                r.code,
                r.name,
                r.category,
                num(r.qty),
                r.unit,
                num(r.cost),
                showSalePrice ? num(r.price) : "",
                num(r.value),
              ]),
              ["Total", "", "", "", "", num(atCost), "", num(atCost)],
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
              <th className={TH_R}>Qty on hand</th>
              <th
                className={TH_R}
                title="Moving weighted average of what one unit costs"
              >
                Avg cost
              </th>
              {showSalePrice && (
                <th
                  className={TH_R}
                  title="What it sells for — reference only, never the value"
                >
                  Sales price
                </th>
              )}
              <th className={TH_R} title="Quantity on hand × average cost">
                Value at cost
              </th>
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
                    <span className="ml-2 text-muted-foreground">
                      {r.category}
                    </span>
                  )}
                  <BasisChip row={r} />
                  <AverageNote row={r} money={money} />
                </td>
                <td className={CELL}>
                  {r.qty} {r.unit}
                </td>
                <td className={CELL}>
                  {r.basis === "none" ? "—" : money(r.cost)}
                </td>
                {showSalePrice && (
                  <td className={cn(CELL, "font-medium")}>
                    {r.basis === "none" ? "—" : money(r.price)}
                  </td>
                )}
                <td className={cn(CELL, "font-medium")}>
                  {r.basis === "none" ? "—" : money(r.value)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={TOTAL}>
              <td className={CELL_LEFT} colSpan={3}>
                Total {title.toLowerCase()} at average cost
              </td>
              <td className={CELL}>{money(atCost)}</td>
              {showSalePrice && <td />}
              <td className={CELL}>{money(atCost)}</td>
            </tr>
          </tfoot>
        </TableWrap>
      )}
      {unpriced > 0 && (
        <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
          {unpriced} {unpriced === 1 ? "line has" : "lines have"} no cost on
          record and {unpriced === 1 ? "is" : "are"} carried at zero rather than
          at a guess.
        </p>
      )}
    </Panel>
  );
}

type MovementRow = {
  key: string;
  at: number;
  kind: "material" | "product";
  name: string;
  code: string;
  direction: "in" | "out";
  qty: number;
  unit: string;
  source: string;
  ref: string;
  rate: number;
  value: number;
};

function MovementTable({
  movement,
  inValue,
  outValue,
  money,
  range,
}: {
  movement: MovementRow[];
  inValue: number;
  outValue: number;
  money: (n: number) => string;
  range: Range;
}) {
  return (
    <Panel
      title="Stock movement"
      count={`${movement.length} movements · ${range.label}`}
      actions={
        <CsvButton
          what="stock movement"
          onClick={() =>
            downloadCsv("stock-movement.csv", [
              [
                "Date",
                "Shelf",
                "Name",
                "Code",
                "In",
                "Out",
                "Unit",
                "Rate",
                "Value",
                "Source",
                "Reference",
              ],
              ...movement.map((m) => [
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
      {movement.length === 0 ? (
        <Empty>
          Nothing moved between {dayLabel(range.from)} and {dayLabel(range.to)}.
        </Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr className={HEAD}>
              <th className={CELL_LEFT}>Date</th>
              <th className={CELL_LEFT}>Item</th>
              <th className={TH_R}>In</th>
              <th className={TH_R}>Out</th>
              <th className={TH_R} title="Weighted average cost at the time">Cost rate</th>
              <th className={TH_R}>Value</th>
              <th className={CELL_LEFT}>Source</th>
              <th className={CELL_LEFT}>Reference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {movement.map((m) => (
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
                    m.direction === "in" && "font-medium",
                    m.direction === "in" && GAIN,
                  )}
                >
                  {m.direction === "in" ? `${m.qty} ${m.unit}` : "—"}
                </td>
                <td
                  className={cn(
                    CELL,
                    m.direction === "out" && "font-medium",
                    m.direction === "out" && LOSS,
                  )}
                >
                  {m.direction === "out" ? `${m.qty} ${m.unit}` : "—"}
                </td>
                <td className={CELL}>
                  {m.rate === 0 ? "—" : money(m.rate)}
                </td>
                <td className={CELL}>
                  {m.rate === 0 ? "—" : money(m.value)}
                </td>
                <td
                  className={`${CELL_LEFT} text-muted-foreground capitalize`}
                >
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
              <td className={cn(CELL, GAIN)} colSpan={2}>
                {money(inValue)} in
              </td>
              <td />
              <td className={cn(CELL, LOSS)}>{money(outValue)} out</td>
              <td className={CELL} colSpan={2}>
                {movement.length} movements
              </td>
            </tr>
          </tfoot>
        </TableWrap>
      )}
      <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
        Movements are valued at the same weighted average cost as the shelves,
        so a unit that came in and a unit still on hand carry the same figure
        here. Quantities are not totalled: a shelf holds boards, metres and
        pieces, and adding those together means nothing.
      </p>
    </Panel>
  );
}

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
    data.materials.filter((r) => r.basis === "none").length +
    data.products.filter((r) => r.basis === "none").length;
  /** What the same stock would fetch, for comparison against what it cost. */
  const atPrice =
    data.materials.reduce((s, r) => s + r.cost * r.qty, 0) +
    data.products.reduce((s, r) => s + r.price * r.qty, 0);

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
          hint="At weighted average cost"
        />
        <Tile
          label="Finished goods"
          value={money(data.productTotal)}
          tone="text-sky-600 dark:text-sky-400"
          hint="At weighted average cost"
        />
        <Tile
          label="Stock on hand"
          value={money(data.total)}
          hint="Both shelves, at cost"
        />
        <Tile
          label="If it all sold at list"
          value={money(atPrice)}
          tone="text-muted-foreground"
          hint={`Stock at cost is ${money(data.total)}`}
        />
      </div>

      {unpriced > 0 && (
        <Proof ok={false}>
          {unpriced} stocked {unpriced === 1 ? "line has" : "lines have"} no rate
          on record. Open the costing sheet and its cost and sales price will
          appear here on the next visit.
        </Proof>
      )}

      {tab === "valuation" ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <ValuationTable
              title="Raw materials"
              rows={data.materials}
              money={money}
              csv="stock-raw-materials"
              showSalePrice={false}
            />
            <ValuationTable
              title="Finished goods"
              rows={data.products}
              money={money}
              csv="stock-finished-goods"
              showSalePrice
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stock is valued on a <strong>moving weighted average cost</strong>.
            A material bought at two prices is neither of them, so its cost is
            the average of everything ever bought, and issuing stock does not
            change what the rest of it cost. A finished product is costed from
            its recipe, but priced at its materials' weighted averages rather
            than at whatever each line was copied at when the recipe was typed
            — so the finished-goods shelf cannot drift away from the
            raw-material shelf it was made from. Sale price is shown beside the
            cost for reference and is never the value: what a thing fetches is
            somebody else's number, while what it cost is this business's
            stock. A material never bought against falls back to its catalogue
            price and says so, and a product never costed falls back to the
            price it last went out for.
          </p>
        </>
      ) : (
        <MovementTable
          movement={data.movement}
          inValue={data.movementInValue}
          outValue={data.movementOutValue}
          money={money}
          range={range}
        />
      )}
    </div>
  );
}
