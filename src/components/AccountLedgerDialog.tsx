import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Download,
  FileText,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Printer,
  Search,
  Scale,
} from "lucide-react";

const TYPE_TONE: Record<string, string> = {
  asset: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  liability: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  equity: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  income: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  expense: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const fromInput = (v: string) => {
  const ms = new Date(`${v}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : undefined;
};
/** Inclusive to the end of the chosen day, so "to 30 Sep" includes 30 Sep. */
const endOfDay = (v: string) => {
  const ms = new Date(`${v}T23:59:59.999`).getTime();
  return Number.isFinite(ms) ? ms : undefined;
};

/** One tile in the summary strip. */
function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Scale;
  label: string;
  value: string;
  sub: string;
  tone?: "in" | "out" | "strong";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        tone === "strong" && "border-primary/30 bg-primary/[0.06]",
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        <Icon
          className={cn(
            "size-3",
            tone === "in" && "text-emerald-600 dark:text-emerald-400",
            tone === "out" && "text-rose-600 dark:text-rose-400",
            tone === "strong" && "text-primary",
          )}
        />
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-sm font-bold tabular-nums",
          tone === "in" && "text-emerald-600 dark:text-emerald-400",
          tone === "out" && "text-rose-600 dark:text-rose-400",
          tone === "strong" && "text-primary",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/** A quick date range, so the common windows are one click. */
const RANGES = [
  { id: "all", label: "All time" },
  { id: "month", label: "This month" },
  { id: "quarter", label: "This quarter" },
  { id: "year", label: "This year" },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

function rangeBounds(id: RangeId): { from?: number; to?: number } {
  if (id === "all") return {};
  const now = new Date();
  if (id === "month") {
    return {
      from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      to: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime(),
    };
  }
  if (id === "quarter") {
    const q = Math.floor(now.getMonth() / 3) * 3;
    return {
      from: new Date(now.getFullYear(), q, 1).getTime(),
      to: new Date(now.getFullYear(), q + 3, 0, 23, 59, 59).getTime(),
    };
  }
  return {
    from: new Date(now.getFullYear(), 0, 1).getTime(),
    to: new Date(now.getFullYear(), 11, 31, 23, 59, 59).getTime(),
  };
}

/**
 * One account's ledger.
 *
 * Opened by clicking an account in the chart. It answers the question the
 * chart cannot: not what the balance is, but how it got there — every posting
 * in date order with the balance carried down, and the arithmetic stated
 * plainly enough to check by hand.
 */
export default function AccountLedgerDialog({
  accountId,
  money,
  onClose,
  onOpenEntry,
  onNewEntry,
  canCreate = true,
}: {
  accountId: Id<"accounts">;
  money: (n: number) => string;
  onClose: () => void;
  /** Jump to the journal tab, optionally focused on one entry. */
  onOpenEntry?: (entryId: Id<"journalEntries">) => void;
  /** Raise a new entry against this account. */
  onNewEntry?: () => void;
  canCreate?: boolean;
}) {
  const [range, setRange] = useState<RangeId>("all");
  const [fromText, setFromText] = useState("");
  const [toText, setToText] = useState("");
  const [search, setSearch] = useState("");
  const [wide, setWide] = useState(false);

  // typing a date takes precedence over the quick ranges
  const custom = fromText !== "" || toText !== "";
  const bounds = custom
    ? { from: fromInput(fromText), to: toText === "" ? undefined : endOfDay(toText) }
    : rangeBounds(range);

  const data = useQuery(api.accounting.accountLedger, {
    accountId,
    from: bounds.from,
    to: bounds.to,
    search: search.trim() === "" ? undefined : search.trim(),
  });

  const rows = data?.rows ?? [];

  /** A browsable CSV of exactly what is on screen. */
  const exportCsv = () => {
    if (data === undefined || data === null) return;
    const header = ["Date", "Entry", "Kind", "Description", "Party", "Debit", "Credit", "Balance"];
    const body = rows.map((r) =>
      [
        day(r.at),
        r.number,
        r.kind,
        `"${(r.memo ?? "").replace(/"/g, '""')}"`,
        `"${(r.party ?? "").replace(/"/g, '""')}"`,
        r.debit.toFixed(2),
        r.credit.toFixed(2),
        r.balance.toFixed(2),
      ].join(","),
    );
    const lines = [
      header.join(","),
      ...body,
      `"Opening",,,,,,,"${data.opening.toFixed(2)}"`,
      `"Totals",,,,,${data.totals.debit.toFixed(2)},${data.totals.credit.toFixed(2)},"${data.totals.closing.toFixed(2)}"`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.account.code}-${data.account.name.replace(/[^\w-]+/g, "_")}-ledger.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** A print-ready statement, in the same shape as the other printed sheets. */
  const print = () => {
    if (data === undefined || data === null) return;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const esc = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const body = rows
      .map(
        (r, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${day(r.at)}</td>
        <td class="mono">${esc(r.number)}</td>
        <td>${esc(r.memo ?? r.party ?? "—")}</td>
        <td class="num">${r.debit > 0 ? money(r.debit) : ""}</td>
        <td class="num">${r.credit > 0 ? money(r.credit) : ""}</td>
        <td class="num strong">${money(r.balance)}</td>
      </tr>`,
      )
      .join("");
    win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(data.account.code)} ${esc(data.account.name)} — ledger</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #18181b; margin: 40px; }
  .brand { font-size: 11px; letter-spacing: 3px; color: #4f46e5; font-weight: 700; }
  h1 { font-size: 22px; margin: 4px 0 2px; }
  .meta { font-size: 12px; color: #52525b; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #71717a; border-bottom: 1.5px solid #d4d4d8; padding: 8px 10px; }
  td { border-bottom: 1px solid #e4e4e7; padding: 8px 10px; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #52525b; }
  td.strong { font-weight: 600; }
  tfoot td { border: none; border-top: 1.5px solid #4f46e5; font-weight: 700; padding-top: 10px; }
  .sum { margin-top: 14px; font-size: 12px; color: #52525b; }
  @page { margin: 14mm; }
</style></head><body>
  <div class="brand">ACCOUNT LEDGER</div>
  <h1>${esc(data.account.code)} · ${esc(data.account.name)}</h1>
  <div class="meta">${TYPE_LABEL[data.account.type] ?? data.account.type}${
    data.account.note ? ` &nbsp;·&nbsp; ${esc(data.account.note)}` : ""
  } &nbsp;·&nbsp; printed ${new Date().toLocaleDateString()}</div>
  <table>
    <thead><tr><th class="num">#</th><th>Date</th><th>Entry</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td colspan="4">Closing balance</td>
      <td class="num">${money(data.totals.debit)}</td>
      <td class="num">${money(data.totals.credit)}</td>
      <td class="num">${money(data.totals.closing)}</td>
    </tr></tfoot>
  </table>
  <p class="sum">${money(data.opening)} opening + ${money(data.totals.debit)} debits − ${money(
      data.totals.credit,
    )} credits = <strong>${money(data.totals.closing)}</strong> closing</p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
    win.document.close();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[92vh] gap-0 overflow-hidden p-0",
          wide ? "sm:max-w-[min(100%,1240px)]" : "sm:max-w-[min(100%,920px)]",
        )}
      >
        {/* ── header ─────────────────────────────────────────────────── */}
        <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-6 pt-6 pb-5">
          <DialogHeader className="pr-8">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Account ledger
            </p>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
              <Scale className="size-5 shrink-0 text-primary" />
              {data === undefined || data === null ? (
                "Loading…"
              ) : (
                <>
                  <span className="font-mono text-sm text-muted-foreground">
                    {data.account.code}
                  </span>
                  {data.account.name}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      TYPE_TONE[data.account.type],
                    )}
                  >
                    {TYPE_LABEL[data.account.type] ?? data.account.type}
                  </span>
                </>
              )}
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {data?.account.note && <span>{data.account.note}</span>}
              {data !== undefined && data !== null && (
                <span className="text-muted-foreground">
                  {data.totals.lifetime === 0
                    ? "Nothing has been posted here yet"
                    : `${data.totals.lifetime} posting${
                        data.totals.lifetime === 1 ? "" : "s"
                      } in total`}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        {data === undefined ? (
          <div className="flex items-center justify-center gap-2 px-6 py-20 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading the ledger…
          </div>
        ) : data === null ? (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">
            That account is no longer available.
          </p>
        ) : (
          <>
            {/* ── summary tiles ──────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2.5 border-b border-border/60 px-6 py-4 sm:grid-cols-4">
              <Stat
                icon={FileText}
                label="Opening"
                value={money(data.opening)}
                sub={custom || range !== "all" ? "brought forward" : "from nothing"}
              />
              <Stat
                icon={ArrowDownLeft}
                label="Debits"
                value={money(data.totals.debit)}
                tone="in"
                sub="in this window"
              />
              <Stat
                icon={ArrowUpRight}
                label="Credits"
                value={money(data.totals.credit)}
                tone="out"
                sub="in this window"
              />
              <Stat
                icon={Scale}
                label="Closing"
                value={money(data.totals.closing)}
                tone="strong"
                sub="carried down"
              />
            </div>

            {/* ── controls ───────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-6 py-2.5">
              <CalendarDays className="size-3.5 shrink-0 text-muted-foreground/60" />
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  aria-pressed={!custom && range === r.id}
                  onClick={() => {
                    setRange(r.id);
                    setFromText("");
                    setToText("");
                  }}
                  className={cn(
                    "h-7 rounded-lg border px-2 text-[11px] font-medium transition-colors",
                    !custom && range === r.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {r.label}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-border" />
              <Input
                type="date"
                value={fromText}
                onChange={(e) => setFromText(e.target.value)}
                aria-label="From date"
                className="h-7 w-32 rounded-lg text-xs"
              />
              <span className="text-[11px] text-muted-foreground">to</span>
              <Input
                type="date"
                value={toText}
                onChange={(e) => setToText(e.target.value)}
                aria-label="To date"
                className="h-7 w-32 rounded-lg text-xs"
              />
              {(custom || range !== "all" || search !== "") && (
                <button
                  type="button"
                  onClick={() => {
                    setRange("all");
                    setFromText("");
                    setToText("");
                    setSearch("");
                  }}
                  className="h-7 rounded-lg px-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}

              <div className="relative ml-auto">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search description…"
                  aria-label="Search this ledger"
                  className="h-7 w-44 rounded-lg border bg-card pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <button
                type="button"
                onClick={() => setWide((v) => !v)}
                title={wide ? "Narrow" : "Widen"}
                aria-label={wide ? "Narrow the ledger" : "Widen the ledger"}
                className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                {wide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </button>
              <button
                type="button"
                onClick={exportCsv}
                title="Export these rows as CSV"
                aria-label="Export ledger as CSV"
                className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Download className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={print}
                title="Print this ledger"
                aria-label="Print ledger"
                className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Printer className="size-3.5" />
              </button>
            </div>

            {/* ── the ledger itself ──────────────────────────────────── */}
            <div className="max-h-[44vh] overflow-y-auto px-6 py-4">
              {rows.length === 0 ? (
                <div className="py-12 text-center">
                  <Scale className="mx-auto size-7 text-muted-foreground/30" />
                  <p className="mt-2 text-sm font-medium">
                    {data.totals.lifetime === 0
                      ? "Nothing posted to this account"
                      : "Nothing in this window"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {data.totals.lifetime === 0
                      ? "Raise a journal entry, or record a bill or invoice and it will appear here."
                      : "Widen the dates or clear the search to see the rest."}
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="border-b border-border/70 text-left text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                      <th className="w-24 py-2 pr-3">Date</th>
                      <th className="w-20 py-2 pr-3">Entry</th>
                      <th className="py-2 pr-3">Description</th>
                      <th className="w-24 py-2 pr-3 text-right">Debit</th>
                      <th className="w-24 py-2 pr-3 text-right">Credit</th>
                      <th className="w-28 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.map((r) => (
                      <tr
                        key={r._id}
                        onClick={() => onOpenEntry?.(r.entryId)}
                        className={cn(
                          "transition-colors hover:bg-accent/40",
                          onOpenEntry && "cursor-pointer",
                        )}
                        title={onOpenEntry ? "Open this entry in the journal" : undefined}
                      >
                        <td className="py-2 pr-3 text-xs whitespace-nowrap text-muted-foreground">
                          {day(r.at)}
                        </td>
                        <td className="py-2 pr-3">
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {r.number}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className={cn(
                                "grid size-5 shrink-0 place-items-center rounded-md",
                                r.debit > 0
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                              )}
                            >
                              {r.debit > 0 ? (
                                <ArrowDownLeft className="size-2.5" />
                              ) : (
                                <ArrowUpRight className="size-2.5" />
                              )}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-xs">
                                {r.memo ?? r.lineMemo ?? "—"}
                              </span>
                              {(r.party || r.kind !== "journal") && (
                                <span className="block truncate text-[10px] text-muted-foreground">
                                  {[r.party, r.kind !== "journal" ? r.kind : null]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                          {r.debit > 0 ? money(r.debit) : ""}
                        </td>
                        <td className="py-2 pr-3 text-right text-xs tabular-nums text-rose-600 dark:text-rose-400">
                          {r.credit > 0 ? money(r.credit) : ""}
                        </td>
                        <td className="py-2 text-right text-xs font-semibold tabular-nums">
                          {money(r.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border/70">
                      <td className="py-2.5 pr-3 text-xs font-semibold" colSpan={3}>
                        Closing balance
                      </td>
                      <td className="py-2.5 pr-3 text-right text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {money(data.totals.debit)}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-xs font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                        {money(data.totals.credit)}
                      </td>
                      <td className="py-2.5 text-right text-sm font-semibold tabular-nums text-primary">
                        {money(data.totals.closing)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* the arithmetic, stated plainly so it can be checked */}
              <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] tabular-nums text-muted-foreground">
                {money(data.opening)} opening + {money(data.totals.debit)} debits −{" "}
                {money(data.totals.credit)} credits ={" "}
                <span className="font-semibold text-foreground">
                  {money(data.totals.closing)}
                </span>{" "}
                closing
                {rows.length < data.totals.lifetime && (
                  <>
                    {" "}
                    · showing {rows.length} of {data.totals.lifetime} postings
                  </>
                )}
              </p>
            </div>

            <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-3">
              {onNewEntry && canCreate && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onNewEntry}
                  className="h-8 rounded-lg px-3 text-xs"
                >
                  <Plus className="size-3.5" /> New entry
                </Button>
              )}
              <Button type="button" onClick={onClose} className="h-8 rounded-lg px-3 text-xs">
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
