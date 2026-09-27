import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Download,
  Maximize2,
  Minimize2,
  Plus,
  Printer,
  Receipt,
  Search,
  Store,
  Users,
  Wallet,
} from "lucide-react";
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

/** Whoever a statement is about — a supplier or a customer, same fields. */
export type Party = {
  name: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  note?: string;
};

/** One document on the statement — a bill to a supplier, an invoice to a customer. */
export type PartyDocument<TId extends string = string> = {
  id: TId;
  number: string;
  at: number;
  dueAt?: number;
  total: number;
  isPaid: boolean;
  note?: string;
};

/**
 * Which side of the ledger this party sits on. The arithmetic is identical
 * either way — only the wording differs, so it is data rather than branches.
 */
export type PartyRole = {
  /** Above the title: "Supplier ledger". */
  ledgerLabel: string;
  /** One document: "Bill" / "Invoice". */
  docNoun: string;
  /** More than one: "bills" / "invoices". */
  docNouns: string;
  /** The column that adds to the balance. */
  chargedLabel: string;
  /** The column that settles it. */
  settledLabel: string;
  /** The button that raises a new one. */
  newLabel: string;
  /** What a positive balance means to us. */
  owesLabel: string;
  /** Shown when a document has not been settled. */
  openLabel: string;
  /** Shown when a document has been settled. */
  doneLabel: string;
  icon: LucideIcon;
  /** The document icon in the table and the footer button. */
  docIcon: LucideIcon;
  /** Headline when they have no documents at all. */
  emptyTitle: string;
  emptyBody: string;
};

export const SUPPLIER_ROLE: PartyRole = {
  ledgerLabel: "Supplier ledger",
  docNoun: "Bill",
  docNouns: "bills",
  chargedLabel: "Billed",
  settledLabel: "Paid",
  newLabel: "New bill",
  owesLabel: "you still owe",
  openLabel: "Awaiting payment",
  doneLabel: "Paid",
  icon: Store,
  docIcon: Receipt,
  emptyTitle: "No bills for this vendor yet",
  emptyBody:
    "Raise one and it will be listed here, with what is paid and what is still owed.",
};

/** The same statement, read from the other side of the balance. */
export const CUSTOMER_ROLE: PartyRole = {
  ledgerLabel: "Customer ledger",
  docNoun: "Invoice",
  docNouns: "invoices",
  chargedLabel: "Invoiced",
  settledLabel: "Received",
  newLabel: "New invoice",
  owesLabel: "they owe you",
  openLabel: "Awaiting payment",
  doneLabel: "Paid",
  icon: Users,
  docIcon: Receipt,
  emptyTitle: "No invoices for this customer yet",
  emptyBody:
    "Raise one and it will be listed here, with what has been received and what is still outstanding.",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

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
  icon: LucideIcon;
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
            tone === "out" && "text-amber-600 dark:text-amber-400",
            tone === "strong" && "text-primary",
          )}
        />
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-sm font-bold tabular-nums",
          tone === "in" && "text-emerald-600 dark:text-emerald-400",
          tone === "out" && "text-amber-600 dark:text-amber-400",
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
 * One party's statement: every document between you and them in date order,
 * with the balance carried down each line.
 *
 * `from` / `to` narrow what is *shown*, not what is counted: the opening
 * balance is everything outstanding before `from`, so a narrowed view still
 * reconciles — opening + charged − settled is the closing balance, at any
 * range. That is the same rule the account ledger follows, so the two agree.
 */
export default function PartyLedgerDialog<TId extends string>({
  party,
  documents,
  role,
  money,
  onClose,
  onOpenDocument,
  onNewDocument,
  canCreate = true,
}: {
  party: Party;
  documents: PartyDocument<TId>[];
  role: PartyRole;
  money: (n: number) => string;
  onClose: () => void;
  /** Open an existing document for reading. Omit if there is nowhere to go. */
  onOpenDocument?: (id: TId) => void;
  /** Start a new document with this party. */
  onNewDocument?: () => void;
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

  /** Every document, oldest first, with the outstanding side of it settled. */
  const all = documents
    .map((doc) => ({
      doc,
      // charging adds to what is outstanding; settling takes it away
      charged: doc.isPaid ? 0 : doc.total,
      settled: doc.isPaid ? doc.total : 0,
    }))
    .sort((a, b) => a.doc.at - b.doc.at || a.doc.number.localeCompare(b.doc.number));

  const lifetime = all.length;

  /** What the party already stood at when the window opens. */
  const opening = round2(
    all
      .filter((r) => bounds.from !== undefined && r.doc.at < bounds.from)
      .reduce((sum, r) => sum + r.charged - r.settled, 0),
  );

  const term = search.trim().toLowerCase();
  const inWindow = all.filter((r) => {
    if (bounds.from !== undefined && r.doc.at < bounds.from) return false;
    if (bounds.to !== undefined && r.doc.at > bounds.to) return false;
    if (
      term !== "" &&
      !`${r.doc.number} ${r.doc.note ?? ""} ${r.doc.isPaid ? role.doneLabel : role.openLabel}`
        .toLowerCase()
        .includes(term)
    ) {
      return false;
    }
    return true;
  });

  /**
   * The fold is a pure reduce rather than a loop with a running total, so a
   * re-render can never read a half-built balance.
   */
  const totals = inWindow.reduce(
    (acc, r) => {
      const balance = round2(acc.balance + r.charged - r.settled);
      return {
        lines: [...acc.lines, { ...r, balance }],
        charged: round2(acc.charged + r.charged),
        settled: round2(acc.settled + r.settled),
        balance,
      };
    },
    {
      lines: [] as Array<(typeof inWindow)[number] & { balance: number }>,
      charged: 0,
      settled: 0,
      balance: 0,
    },
  );
  const closing = round2(opening + totals.charged - totals.settled);
  const openCount = all.filter((r) => !r.doc.isPaid).length;

  const first = all[0]?.doc.at;
  const last = all[all.length - 1]?.doc.at;

  const TitleIcon = role.icon;
  const DocIcon = role.docIcon;

  const resetFilters = () => {
    setRange("all");
    setFromText("");
    setToText("");
    setSearch("");
  };

  /** A browsable CSV of exactly what is on screen. */
  const exportCsv = () => {
    const header = [
      "Date",
      role.docNoun,
      "Status",
      "Note",
      "Due",
      role.chargedLabel,
      role.settledLabel,
      "Balance",
    ];
    const body = totals.lines.map((r) =>
      [
        day(r.doc.at),
        r.doc.number,
        r.doc.isPaid ? role.doneLabel : role.openLabel,
        `"${(r.doc.note ?? "").replace(/"/g, '""')}"`,
        r.doc.dueAt === undefined ? "" : day(r.doc.dueAt),
        r.charged.toFixed(2),
        r.settled.toFixed(2),
        r.balance.toFixed(2),
      ].join(","),
    );
    const lines = [
      header.join(","),
      ...body,
      `"Opening",,,,,,,"${opening.toFixed(2)}"`,
      `"Totals",,,,,${totals.charged.toFixed(2)},${totals.settled.toFixed(2)},"${closing.toFixed(2)}"`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${party.name.replace(/[^\w-]+/g, "_")}-${role.docNoun.toLowerCase()}s.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** A print-ready statement, in the same shape as the other printed sheets. */
  const print = () => {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const esc = (v: string) =>
      v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const contact = [party.contactName, party.phone, party.email, party.address]
      .filter(Boolean)
      .join(" · ");
    const body = totals.lines
      .map(
        (r, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${day(r.doc.at)}</td>
        <td class="mono">${esc(r.doc.number)}</td>
        <td>${esc(r.doc.note ?? (r.doc.isPaid ? role.doneLabel : role.openLabel))}</td>
        <td class="num">${r.charged > 0 ? money(r.charged) : ""}</td>
        <td class="num">${r.settled > 0 ? money(r.settled) : ""}</td>
        <td class="num strong">${money(r.balance)}</td>
      </tr>`,
      )
      .join("");
    win.document.write(`<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(party.name)} — ${esc(role.ledgerLabel.toLowerCase())}</title>
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
  <div class="brand">${esc(role.ledgerLabel.toUpperCase())}</div>
  <h1>${esc(party.name)}</h1>
  <div class="meta">${esc(contact || "—")}${contact ? " &nbsp;·&nbsp; " : ""}printed ${new Date().toLocaleDateString()}</div>
  <table>
    <thead><tr><th class="num">#</th><th>Date</th><th>${esc(role.docNoun)}</th><th>Description</th><th class="num">${esc(role.chargedLabel)}</th><th class="num">${esc(role.settledLabel)}</th><th class="num">Balance</th></tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td colspan="4">Closing balance</td>
      <td class="num">${money(totals.charged)}</td>
      <td class="num">${money(totals.settled)}</td>
      <td class="num">${money(closing)}</td>
    </tr></tfoot>
  </table>
  <p class="sum">${money(opening)} opening + ${money(totals.charged)} ${esc(role.chargedLabel.toLowerCase())} − ${money(totals.settled)} ${esc(role.settledLabel.toLowerCase())} = <strong>${money(closing)}</strong> outstanding</p>
  <script>window.onload = function () { window.print(); };</script>
</body></html>`);
    win.document.close();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={cn(
          "max-h-[92vh] gap-0 overflow-hidden p-0",
          wide ? "sm:max-w-[min(100%,1180px)]" : "sm:max-w-[min(100%,900px)]",
        )}
      >
        {/* ── header ─────────────────────────────────────────────────── */}
        <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-6 pt-6 pb-5">
          <DialogHeader className="pr-8">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {role.ledgerLabel}
            </p>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <TitleIcon className="size-5 shrink-0 text-primary" />
              <span className="min-w-0 truncate">{party.name}</span>
            </DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {party.contactName && <span>{party.contactName}</span>}
              {party.phone && <span className="tabular-nums">{party.phone}</span>}
              {party.email && <span className="truncate">{party.email}</span>}
              {first !== undefined && last !== undefined && (
                <span className="text-muted-foreground">
                  {lifetime === 1
                    ? `1 ${role.docNoun.toLowerCase()}, ${day(first)}`
                    : `${lifetime} ${role.docNouns}, ${day(first)} – ${day(last)}`}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* ── summary tiles ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2.5 border-b border-border/60 px-6 py-4 sm:grid-cols-4">
          <Stat
            icon={Wallet}
            label="Opening"
            value={money(opening)}
            sub={custom || range !== "all" ? "brought forward" : "from nothing"}
          />
          <Stat
            icon={DocIcon}
            label={role.chargedLabel}
            value={money(totals.charged)}
            sub={`${inWindow.length} ${inWindow.length === 1 ? role.docNoun.toLowerCase() : role.docNouns}`}
          />
          <Stat
            icon={CheckCircle2}
            label={role.settledLabel}
            value={money(totals.settled)}
            tone="in"
            sub={`${openCount} still open`}
          />
          <Stat
            icon={Wallet}
            label="Balance"
            value={money(closing)}
            tone={closing > 0 ? "out" : "strong"}
            sub={closing > 0 ? role.owesLabel : "nothing outstanding"}
          />
        </div>

        {/* ── controls ───────────────────────────────────────────────── */}
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
              onClick={resetFilters}
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
              placeholder="Search documents…"
              aria-label={`Search this ${role.ledgerLabel.toLowerCase()}`}
              className="h-7 w-44 rounded-lg border bg-card pr-2 pl-7 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            type="button"
            onClick={() => setWide((v) => !v)}
            title={wide ? "Narrow" : "Widen"}
            aria-label={`${wide ? "Narrow" : "Widen"} the statement`}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {wide ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={exportCsv}
            title="Export these rows as CSV"
            aria-label="Export statement as CSV"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Download className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={print}
            title="Print this statement"
            aria-label="Print statement"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Printer className="size-3.5" />
          </button>
        </div>

        {/* ── the statement itself ───────────────────────────────────── */}
        <div className="max-h-[44vh] overflow-y-auto px-6 py-4">
          {inWindow.length === 0 ? (
            <div className="py-12 text-center">
              <DocIcon className="mx-auto size-7 text-muted-foreground/30" />
              <p className="mt-2 text-sm font-medium">
                {lifetime === 0
                  ? role.emptyTitle
                  : "Nothing in this window"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {lifetime === 0
                  ? role.emptyBody
                  : "Widen the dates or clear the search to see the rest."}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-border/70 text-left text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <th className="w-24 py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">{role.docNoun}</th>
                  <th className="w-24 py-2 pr-3 text-right">{role.chargedLabel}</th>
                  <th className="w-24 py-2 pr-3 text-right">{role.settledLabel}</th>
                  <th className="w-28 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {totals.lines.map(({ doc, charged, settled, balance }) => (
                  <tr
                    key={doc.id}
                    onClick={() => onOpenDocument?.(doc.id)}
                    title={onOpenDocument ? `Open ${doc.number}` : undefined}
                    className={cn(
                      "transition-colors hover:bg-accent/40",
                      onOpenDocument && "cursor-pointer",
                    )}
                  >
                    <td className="py-2 pr-3 text-xs whitespace-nowrap text-muted-foreground">
                      {day(doc.at)}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "grid size-5 shrink-0 place-items-center rounded-md",
                            doc.isPaid
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {doc.isPaid ? (
                            <ArrowDownLeft className="size-2.5" />
                          ) : (
                            <ArrowUpRight className="size-2.5" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-xs font-medium">
                            {doc.number}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground">
                            {doc.note ? `${doc.note} · ` : ""}
                            {doc.isPaid
                              ? role.doneLabel
                              : doc.dueAt !== undefined
                                ? `${role.openLabel} · due ${day(doc.dueAt)}`
                                : role.openLabel}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right text-xs font-medium tabular-nums">
                      {charged > 0 ? money(charged) : ""}
                    </td>
                    <td className="py-2 pr-3 text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                      {settled > 0 ? money(settled) : ""}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right text-xs font-semibold tabular-nums",
                        balance > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-foreground",
                      )}
                    >
                      {money(balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border/70">
                  <td className="py-2.5 pr-3 text-xs font-semibold" colSpan={2}>
                    Closing balance
                  </td>
                  <td className="py-2.5 pr-3 text-right text-xs font-semibold tabular-nums">
                    {money(totals.charged)}
                  </td>
                  <td className="py-2.5 pr-3 text-right text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {money(totals.settled)}
                  </td>
                  <td
                    className={cn(
                      "py-2.5 text-right text-sm font-semibold tabular-nums",
                      closing > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {money(closing)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* the arithmetic, stated plainly so it can be checked */}
          <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2 text-[11px] tabular-nums text-muted-foreground">
            {money(opening)} opening + {money(totals.charged)}{" "}
            {role.chargedLabel.toLowerCase()} − {money(totals.settled)}{" "}
            {role.settledLabel.toLowerCase()} ={" "}
            <span
              className={cn(
                "font-semibold",
                closing > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {money(closing)}
            </span>{" "}
            outstanding
            {inWindow.length < lifetime && (
              <> · showing {inWindow.length} of {lifetime} documents</>
            )}
          </p>
        </div>

        <DialogFooter className="border-t border-border/60 bg-muted/20 px-6 py-3">
          {onNewDocument && canCreate && (
            <Button
              type="button"
              variant="outline"
              onClick={onNewDocument}
              className="h-8 rounded-lg px-3 text-xs"
            >
              <Plus className="size-3.5" /> {role.newLabel}
            </Button>
          )}
          <Button type="button" onClick={onClose} className="h-8 rounded-lg px-3 text-xs">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
