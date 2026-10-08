import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Eye,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Scale,
  ScrollText,
  Trash2,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Package2,
  ShoppingCart,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useAppDialogs } from "@/components/AppDialogs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";
import PageTabs from "@/components/PageTabs";
import AccountLedgerDialog from "@/components/AccountLedgerDialog";
import AccountFormDialog from "@/components/AccountFormDialog";
import JournalEntryForm, {
  type EntryFormKind,
} from "@/components/JournalEntryForm";
import type { AccountType } from "@/convex/accounting";

/** Mirrors the server's signFor rule: income / liability / equity read positive. */
function signFor(type: AccountType): 1 | -1 {
  return type === "income" || type === "liability" || type === "equity"
    ? 1
    : -1;
}

export { ACCOUNTING_TABS, type AccountingTab } from "@/lib/accounting-tabs";
import { ACCOUNTING_TABS, type AccountingTab } from "@/lib/accounting-tabs";

/** The kinds an entry can be filed under. */
type EntryKind = "journal" | "opening" | "receipt" | "payment" | "expense";

const TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

const TYPE_CHIP: Record<string, string> = {
  asset: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  liability: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  equity: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  income: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  expense: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

/** Today, as `yyyy-mm-dd`. Fixed once at load so a render stays pure. */
const TODAY = (() => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

/** `yyyy-mm-dd` for <input type="date">, in the browser's own timezone. */
function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * How deep in the chart an account sits, so the row can be indented under the
 * heading it belongs to. Capped at three so a deep chart never pushes the
 * figures off the right-hand edge.
 */
function depthOf(
  account: { parentId?: Id<"accounts"> },
  byId: Map<Id<"accounts">, { parentId?: Id<"accounts"> }>,
): number {
  let depth = 0;
  let cursor = account.parentId;
  while (cursor !== undefined && depth < 3) {
    const parent = byId.get(cursor);
    if (parent === undefined) break;
    depth += 1;
    cursor = parent.parentId;
  }
  return depth;
}

function Panel({
  title,
  count,
  children,
  actions,
}: {
  title: string;
  count?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
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

export default function AccountingPanel({
  tab,
  onTabChange,
}: {
  tab: AccountingTab;
  onTabChange: (next: AccountingTab) => void;
}) {
  const { format: money } = useWorkspaceCurrency();
  const { confirm } = useAppDialogs();

  const accounts = useQuery(api.accounting.listAccounts);
  const entries = useQuery(api.accounting.listEntries, { limit: 200 });
  /**
   * Which kinds belong to which tab. Expenses post as their own kind so they
   * show up in the journal — the one place a posting is meant to be seen —
   * rather than being filed with supplier payments where nobody looks.
   */
  const journalKinds: EntryKind[] = ["journal", "expense"];
  const receiptKinds: EntryKind[] = ["receipt", "payment"];
  const shownKinds: EntryKind[] =
    tab === "journal" ? journalKinds : tab === "receipt" ? receiptKinds : [];
  const entryCount = `${
    (entries ?? []).filter((e) =>
      (shownKinds as readonly string[]).includes(e.kind),
    ).length
  } entries`;
  const ensureDefaults = useMutation(api.accounting.ensureDefaults);
  // create and edit live in AccountFormDialog, which owns its own mutations
  const removeAccount = useMutation(api.accounting.removeAccount);
  const postEntry = useMutation(api.accounting.createEntry);
  const dropEntry = useMutation(api.accounting.removeEntry);

  /** The kind of entry being composed, if the form is open. */
  const [entryForm, setEntryForm] = useState<EntryFormKind | null>(null);
  /** The account whose ledger is open, if any. */
  const [ledgerAccountId, setLedgerAccountId] = useState<Id<"accounts"> | null>(
    null,
  );
  /** The entry to highlight after jumping out of a ledger row. */
  const [focusEntry, setFocusEntry] = useState<Id<"journalEntries"> | null>(
    null,
  );
  /** The account the create/edit/view form is open on, if any. */
  const [accountForm, setAccountForm] = useState<{
    mode: "create" | "edit" | "view";
    id?: Id<"accounts">;
  } | null>(null);
  const formAccount =
    accountForm?.id === undefined
      ? undefined
      : (accounts ?? []).find((a) => a._id === accountForm.id);

  // a brand-new firm has no chart, so seed the standard one on first open
  useEffect(() => {
    if (accounts !== undefined && accounts.length === 0) {
      void ensureDefaults().catch(() => undefined);
    }
  }, [accounts, ensureDefaults]);

  const posting = useMemo(
    () => (accounts ?? []).filter((a) => !a.isGroup),
    [accounts],
  );
  const byId = useMemo(
    () => new Map((accounts ?? []).map((a) => [a._id, a])),
    [accounts],
  );

  const deleteOne = async (id: Id<"accounts">) => {
    const a = byId.get(id);
    if (!a) return;
    const ok = await confirm({
      title: `Delete “${a.code} ${a.name}”?`,
      message: "An account with postings cannot be deleted.",
      confirmLabel: "Delete account",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeAccount({ id });
      toast.success("Account deleted.");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't delete that account."));
    }
  };

  const deleteEntry = async (id: Id<"journalEntries">) => {
    const ok = await confirm({
      title: "Delete this entry?",
      message: "Its lines go with it and every balance is recalculated.",
      confirmLabel: "Delete entry",
      danger: true,
    });
    if (!ok) return;
    try {
      await dropEntry({ id });
      toast.success("Entry deleted.");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't delete that entry."));
    }
  };

  /** Opens the debit/credit editor used by journal, receipt, payment and opening. */
  const totalDebit = (accounts ?? [])
    .filter((a) => !a.isGroup)
    .reduce((s, a) => s + a.debit, 0);

  return (
    <div className="mt-4 space-y-4">
      <PageTabs
        label="Accounts sections"
        tabs={ACCOUNTING_TABS.map((t) => ({
          id: t.id,
          label: t.label,
          icon: t.icon,
          hint: t.hint,
        }))}
        value={tab}
        onChange={onTabChange}
      />

      {accounts === undefined || entries === undefined ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading the ledger…
        </div>
      ) : tab === "accounts" ? (
        <Panel
          title="Chart of accounts"
          count={`${(accounts ?? []).filter((a) => !a.isGroup).length} accounts`}
          actions={
            <>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                Click a row to open its ledger
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setAccountForm({ mode: "create" })}
                className="h-7 gap-1.5 rounded-lg border-primary/30 bg-primary/[0.06] px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
              >
                <Plus className="size-3.5" /> Account
              </Button>
            </>
          }
        >
          {accounts.length === 0 ? (
            <p className="px-4 py-12 text-center text-sm text-muted-foreground">
              No accounts yet — the standard chart is being prepared.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                    <th className="w-20 px-3 py-2">Code</th>
                    <th className="px-3 py-2">Account</th>
                    <th className="w-28 px-3 py-2">Type</th>
                    <th className="w-28 px-3 py-2 text-right">Debit</th>
                    <th className="w-28 px-3 py-2 text-right">Credit</th>
                    <th className="w-32 px-3 py-2 text-right">Balance</th>
                    <th className="w-24 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {accounts.map((a) => (
                    <tr
                      key={a._id}
                      onClick={() => !a.isGroup && setLedgerAccountId(a._id)}
                      title={
                        a.isGroup ? undefined : `Open the ${a.name} ledger`
                      }
                      className={cn(
                        "group/account transition-colors",
                        a.isGroup
                          ? "bg-muted/20"
                          : "cursor-pointer hover:bg-accent/40",
                      )}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {a.code}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2",
                          a.isGroup ? "font-semibold" : "font-medium",
                        )}
                      >
                        {/* indentation shows where the account sits in the chart */}
                        <span
                          className="inline-block shrink-0 align-middle"
                          style={{ width: depthOf(a, byId) * 14 }}
                        />
                        {a.isGroup ? (
                          <span>
                            {a.name}
                            {a.childIds.length > 0 && (
                              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                                {a.childIds.length}
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="underline decoration-transparent underline-offset-2 transition-colors group-hover/account:decoration-current">
                            {a.name}
                          </span>
                        )}
                        {a.isBank && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 align-middle text-[10px] font-medium text-primary"
                            title={
                              [a.bankName, a.accountNumber]
                                .filter(Boolean)
                                .join(" · ") || "Bank account"
                            }
                          >
                            <Landmark className="size-2.5" /> Bank
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {!a.isGroup && (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                              TYPE_CHIP[a.type],
                            )}
                          >
                            {TYPE_LABEL[a.type]}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                        {a.isGroup || a.debit === 0 ? "—" : money(a.debit)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                        {a.isGroup || a.credit === 0 ? "—" : money(a.credit)}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right text-sm font-medium tabular-nums",
                          a.isGroup && "text-muted-foreground",
                        )}
                      >
                        {a.isGroup
                          ? "—"
                          : money(
                              a.type === "income" ||
                                a.type === "liability" ||
                                a.type === "equity"
                                ? a.signed
                                : -a.signed,
                            )}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {!a.isGroup && (
                          <span className="flex justify-end gap-0.5">
                            <button
                              type="button"
                              aria-label={`Open the ${a.name} ledger`}
                              title="Open the ledger"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLedgerAccountId(a._id);
                              }}
                              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                            >
                              <ScrollText className="size-3" />
                            </button>
                          </span>
                        )}
                        <span className="flex justify-end gap-0.5">
                          <button
                            type="button"
                            aria-label={`View ${a.name}`}
                            title="View account"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAccountForm({ mode: "view", id: a._id });
                            }}
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                          >
                            <Eye className="size-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Edit ${a.name}`}
                            title="Edit account"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAccountForm({ mode: "edit", id: a._id });
                            }}
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                          >
                            <Pencil className="size-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Delete ${a.name}`}
                            title="Delete account"
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteOne(a._id);
                            }}
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border/60 text-sm font-semibold">
                    <td className="px-3 py-2" colSpan={3}>
                      Total debits posted
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(totalDebit)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(
                        (accounts ?? [])
                          .filter((a) => !a.isGroup)
                          .reduce((s, a) => s + a.credit, 0),
                      )}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </Panel>
      ) : tab === "balance" ? (
        <BalanceSheet
          accounts={accounts ?? []}
          entries={(entries ?? []).filter((e) => e.kind === "opening")}
          money={money}
          onPosted={() => onTabChange("journal")}
          postEntry={postEntry}
        />
      ) : tab === "journal" || tab === "receipt" ? (
        <Panel
          title={tab === "journal" ? "Journal entries" : "Receipts & payments"}
          count={entryCount}
          actions={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                setEntryForm(tab === "journal" ? "journal" : "receipt")
              }
              className="h-7 gap-1.5 rounded-lg border-primary/30 bg-primary/[0.06] px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
            >
              <Plus className="size-3.5" />
              New entry
            </Button>
          }
        >
          <EntryTable
            entries={entries ?? []}
            money={money}
            kinds={tab === "journal" ? journalKinds : receiptKinds}
            onDelete={deleteEntry}
            focusId={tab === "journal" ? focusEntry : null}
          />
        </Panel>
      ) : tab === "pandl" ? (
        <ProfitAndLossPanel
          money={money}
          accounts={accounts ?? []}
          entries={entries ?? []}
        />
      ) : (
        <BookPanel cashOnly={tab === "cashbook"} money={money} />
      )}

      {entryForm !== null && (
        <JournalEntryForm
          kind={entryForm}
          accounts={posting}
          money={money}
          onClose={() => setEntryForm(null)}
        />
      )}

      {accountForm !== null && formAccount !== undefined && (
        <AccountFormDialog
          mode={accountForm.mode}
          account={formAccount}
          accounts={accounts ?? []}
          money={money}
          onClose={() => setAccountForm(null)}
          onSaved={() => setAccountForm(null)}
          onDeleted={() => setAccountForm(null)}
          onOpenLedger={(id) => {
            setAccountForm(null);
            setLedgerAccountId(id);
          }}
        />
      )}

      {ledgerAccountId !== null && (
        <AccountLedgerDialog
          accountId={ledgerAccountId}
          money={money}
          onClose={() => setLedgerAccountId(null)}
          onOpenEntry={(entryId) => {
            setLedgerAccountId(null);
            setFocusEntry(entryId);
            onTabChange("journal");
          }}
          onNewEntry={() => {
            setLedgerAccountId(null);
            window.setTimeout(() => setEntryForm("journal"), 0);
          }}
        />
      )}
    </div>
  );
}

/**
 * The balance sheet: every balance-sheet account with an inline opening
 * figure, and a live proof that the two sides agree. Nothing is posted until
 * they do — the button stays disabled while the difference is not zero.
 */
function BalanceSheet({
  accounts,
  entries,
  money,
  postEntry,
  onPosted,
}: {
  accounts: {
    _id: Id<"accounts">;
    code: string;
    name: string;
    type: AccountType;
    isGroup: boolean;
  }[];
  entries: {
    _id: Id<"journalEntries">;
    at: number;
    debit: number;
  }[];
  money: (n: number) => string;
  postEntry: (args: {
    at: number;
    kind: "opening";
    memo?: string;
    lines: { accountId: Id<"accounts">; debit: number; credit: number }[];
  }) => Promise<unknown>;
  onPosted: () => void;
}) {
  const sheet = accounts.filter(
    (a) =>
      !a.isGroup &&
      (a.type === "asset" || a.type === "liability" || a.type === "equity"),
  );
  const [at, setAt] = useState(TODAY);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const read = (id: Id<"accounts">): number => {
    const raw = Number((amounts[id] ?? "").trim());
    return Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 0;
  };

  const assets = sheet
    .filter((a) => a.type === "asset")
    .reduce((s, a) => s + read(a._id), 0);
  const liabilities = sheet
    .filter((a) => a.type === "liability")
    .reduce((s, a) => s + read(a._id), 0);
  const equity = sheet
    .filter((a) => a.type === "equity")
    .reduce((s, a) => s + read(a._id), 0);
  const difference = Math.round((assets - (liabilities + equity)) * 100) / 100;
  const balanced = difference === 0;
  const entered = sheet.some((a) => read(a._id) > 0);

  const post = async () => {
    if (!balanced || busy) return;
    setBusy(true);
    try {
      // Assets are debits; liabilities and equity are credits. Because the two
      // sides were made to agree above, the entry balances as written.
      const lines = sheet
        .map((a) => ({ accountId: a._id, amount: read(a._id) }))
        .filter((l) => l.amount > 0)
        .map((l) => ({
          accountId: l.accountId,
          debit:
            accounts.find((a) => a._id === l.accountId)?.type === "asset"
              ? l.amount
              : 0,
          credit:
            accounts.find((a) => a._id === l.accountId)?.type === "asset"
              ? 0
              : l.amount,
        }));
      await postEntry({
        at: new Date(`${at}T12:00:00`).getTime(),
        kind: "opening",
        memo: "Opening balances",
        lines,
      });
      setAmounts({});
      toast.success("Opening balances posted.");
      onPosted();
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't post those opening balances."));
    } finally {
      setBusy(false);
    }
  };

  const groups: { type: AccountType; label: string }[] = [
    { type: "asset", label: "Assets" },
    { type: "liability", label: "Liabilities" },
    { type: "equity", label: "Equity" },
  ];

  return (
    <div className="space-y-3">
      <Panel
        title="Opening balance"
        count="opening balances"
        actions={
          <>
            <span className="text-[11px] text-muted-foreground">As at</span>
            <Input
              type="date"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              aria-label="Opening balance date"
              className="h-7 w-32 rounded-lg text-xs"
            />
          </>
        }
      >
        {sheet.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Add some accounts to the chart first.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                <th className="w-20 px-4 py-2">Code</th>
                <th className="px-3 py-2">Account</th>
                <th className="w-44 px-4 py-2 text-right">Opening balance</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const rows = sheet.filter((a) => a.type === g.type);
                if (rows.length === 0) return null;
                const subtotal = rows.reduce((s, a) => s + read(a._id), 0);
                return (
                  <Fragment key={g.type}>
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td
                        colSpan={2}
                        className="px-4 py-1.5 text-xs font-semibold"
                      >
                        {g.label}
                      </td>
                      <td className="px-4 py-1.5 text-right text-xs font-semibold tabular-nums">
                        {money(subtotal)}
                      </td>
                    </tr>
                    {rows.map((a) => (
                      <tr
                        key={a._id}
                        className="border-b border-border/40 transition-colors hover:bg-accent/40"
                      >
                        <td className="px-4 py-1.5 font-mono text-xs text-muted-foreground">
                          {a.code}
                        </td>
                        <td className="px-3 py-1.5">{a.name}</td>
                        <td className="px-4 py-1">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            inputMode="decimal"
                            value={amounts[a._id] ?? ""}
                            onChange={(e) =>
                              setAmounts((d) => ({
                                ...d,
                                [a._id]: e.target.value,
                              }))
                            }
                            placeholder="0.00"
                            aria-label={`Opening balance for ${a.code} ${a.name}`}
                            className="h-7 w-full rounded-lg border bg-card px-2 text-right text-xs tabular-nums outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/30"
                          />
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        {/* the live proof, and the only way to post */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">
              Assets{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {money(assets)}
              </span>
            </span>
            <span className="text-muted-foreground">
              Liabilities + equity{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {money(liabilities + equity)}
              </span>
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                balanced
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
              )}
            >
              {balanced ? "Balanced" : `Out by ${money(Math.abs(difference))}`}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={!balanced || !entered || busy}
            onClick={() => void post()}
            title={
              balanced
                ? "Post these opening balances"
                : "Assets must equal liabilities plus equity before posting"
            }
            className="h-7 gap-1.5 rounded-lg px-2.5 text-xs"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Scale className="size-3.5" />
            )}
            Post opening balances
          </Button>
        </div>
      </Panel>

      <Panel
        title="Posted opening balances"
        count={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
      >
        {entries.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing posted yet — fill in the two sides above and they will
            balance.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {entries.map((e) => (
              <li
                key={e._id}
                className="flex items-center gap-3 px-4 py-2 text-xs"
              >
                <span className="tabular-nums text-muted-foreground">
                  {toDateInput(e.at)}
                </span>
                <span className="ml-auto font-medium tabular-nums">
                  {money(e.debit)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/**
 * The debit / credit grid: one field pair per posting account. Returns null
 * when the user cancels; the server refuses anything that does not balance.
 */
function EntryTable({
  entries,
  money,
  kinds,
  onDelete,
  focusId,
}: {
  entries: {
    _id: Id<"journalEntries">;
    number: string;
    at: number;
    kind: EntryKind;
    memo?: string;
    party?: string;
    debit: number;
    credit: number;
    lines: {
      _id: Id<"journalLines">;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }[];
  }[];
  money: (n: number) => string;
  kinds: EntryKind[];
  onDelete: (id: Id<"journalEntries">) => Promise<void>;
  /** An entry to call out — where a ledger row just sent us. */
  focusId?: Id<"journalEntries"> | null;
}) {
  const shown = entries.filter((e) => kinds.includes(e.kind));
  if (shown.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-sm text-muted-foreground">
        Nothing posted yet — use <span className="font-medium">New entry</span>{" "}
        to raise the first one.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border/60">
      {shown.map((e) => (
        <li
          key={e._id}
          className={cn(
            "group/entry px-4 py-2.5 transition-colors hover:bg-accent/40",
            e._id === focusId &&
              "bg-amber-500/10 ring-1 ring-amber-500/30 ring-inset",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">
              {e.number}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {toDateInput(e.at)}
            </span>
            {e.kind !== "journal" && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary capitalize">
                {e.kind === "expense" ? "expense" : e.kind}
              </span>
            )}
            {e.party && (
              <span className="truncate text-xs text-foreground/85">
                {e.party}
              </span>
            )}
            {e.memo && (
              <span className="truncate text-xs text-muted-foreground">
                {e.memo}
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <span className="text-xs font-medium tabular-nums">
                {money(e.debit)}
              </span>
              <button
                type="button"
                aria-label={`Delete entry ${e.number}`}
                onClick={() => void onDelete(e._id)}
                className="grid size-6 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/entry:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </button>
            </span>
          </div>
          <ul className="mt-1 space-y-0.5 pl-1">
            {e.lines.map((l) => (
              <li key={l._id} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono text-muted-foreground/70">
                  {l.accountCode}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {l.accountName}
                </span>
                {l.debit > 0 && (
                  <span className="w-24 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    Dr {money(l.debit)}
                  </span>
                )}
                {l.credit > 0 && (
                  <span className="w-24 text-right tabular-nums text-rose-600 dark:text-rose-400">
                    Cr {money(l.credit)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/** Cash book / day book: one row per day, with the running net. */
function BookPanel({
  cashOnly,
  money,
}: {
  cashOnly: boolean;
  money: (n: number) => string;
}) {
  const today = new Date();
  const [from, setFrom] = useState(
    toDateInput(new Date(today.getFullYear(), today.getMonth(), 1).getTime()),
  );
  const [to, setTo] = useState(TODAY);

  const book = useQuery(api.accounting.dayBook, {
    from: new Date(`${from}T00:00:00`).getTime(),
    to: new Date(`${to}T23:59:59`).getTime(),
    cashOnly,
  });

  const rows = book ?? [];
  const totalIn = rows.reduce((s, r) => s + r.debit, 0);
  const totalOut = rows.reduce((s, r) => s + r.credit, 0);

  return (
    <Panel
      title={cashOnly ? "Cash book" : "Day book"}
      count={cashOnly ? "cash & bank only" : "every account"}
      actions={
        <>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From"
            className="h-7 w-32 rounded-lg text-xs"
          />
          <span className="text-[11px] text-muted-foreground">to</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To"
            className="h-7 w-32 rounded-lg text-xs"
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          No movement between {from} and {to}.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              <th className="px-4 py-2">Date</th>
              <th className="px-3 py-2 text-right">Receipts</th>
              <th className="px-3 py-2 text-right">Payments</th>
              <th className="px-4 py-2 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.day} className="transition-colors hover:bg-accent/40">
                <td className="px-4 py-2 text-xs tabular-nums">
                  {toDateInput(r.day)}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                  {r.debit === 0 ? "—" : money(r.debit)}
                </td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-rose-600 dark:text-rose-400">
                  {r.credit === 0 ? "—" : money(r.credit)}
                </td>
                <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
                  {money(r.debit - r.credit)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border/60 text-sm font-semibold">
              <td className="px-4 py-2">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(totalIn)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {money(totalOut)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {money(totalIn - totalOut)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </Panel>
  );
}

/**
 * ── Profit & Loss (Income Statement) with Trading Account ─────────────
 *
 *  Proper two-section layout:
 *   1. TRADING ACCOUNT   — Opening stock + Purchases − Closing stock = Cost of Goods Sold
 *                          then Sales − COGS = Gross Profit (with GP%)
 *   2. P&L / EXPENSES    — Gross Profit + Other Income − Operating Expenses
 *                          = Operating Profit − Other Expenses = NET PROFIT
 *
 *  Figures come from the posted chart (income/expense accounts) and the
 *  inventory account running balances. The date range is user-editable so
 *  this doubles as month-end, quarter-end and year-end reporting.
 */
function ProfitAndLossPanel({
  money,
  accounts,
  entries,
}: {
  money: (n: number) => string;
  accounts: {
    _id: Id<"accounts">;
    code: string;
    name: string;
    type: AccountType;
    isGroup: boolean;
    debit: number;
    credit: number;
    signed: number;
    parentId?: Id<"accounts">;
  }[];
  entries: {
    _id: Id<"journalEntries">;
    at: number;
    kind: string;
    lines: {
      accountId: Id<"accounts">;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }[];
  }[];
}) {
  // Default range: current calendar month, starting on the 1st
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(toDateInput(firstOfMonth.getTime()));
  const [to, setTo] = useState(TODAY);

  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T23:59:59`).getTime();
  const rangeDays = Math.max(1, Math.round((toMs - fromMs) / 86_400_000) + 1);

  // ── helpers ───────────────────────────────────────────────────
  const byId = useMemo(
    () => new Map(accounts.map((a) => [a._id, a])),
    [accounts],
  );
  const findByCode = (code: string) =>
    accounts.find((a) => a.code === code && !a.isGroup);
  const findByName = (name: string) =>
    accounts.find((a) => a.name === name && !a.isGroup);

  // Movement in a date range: for income/liability/equity = credits − debits
  // for asset/expense = debits − credits. Mirrors the server's signFor rule.
  const rangeMovement = (accountId: Id<"accounts">): number => {
    let debit = 0;
    let credit = 0;
    for (const e of entries) {
      if (e.at < fromMs || e.at > toMs) continue;
      for (const l of e.lines) {
        if (l.accountId !== accountId) continue;
        debit += l.debit;
        credit += l.credit;
      }
    }
    const acc = byId.get(accountId);
    if (acc === undefined) return round(debit - credit);
    const sign = signFor(acc.type);
    return round(sign === 1 ? credit - debit : debit - credit);
  };

  // Balance AT a point in time (sum of everything before + including that
  // instant). Used for opening/closing stock. Mirrors the server's
  // listAccounts running balance, re-scoped to a date.
  const balanceAt = (accountId: Id<"accounts">, atMs: number): number => {
    const acc = byId.get(accountId);
    if (acc === undefined) return 0;
    let debit = 0;
    let credit = 0;
    for (const e of entries) {
      if (e.at > atMs) continue;
      for (const l of e.lines) {
        if (l.accountId !== accountId) continue;
        debit += l.debit;
        credit += l.credit;
      }
    }
    const sign = signFor(acc.type);
    return round(sign === 1 ? credit - debit : debit - credit);
  };

  // ── account resolution ────────────────────────────────────────
  const salesAcc = findByCode("4100") ?? findByName("Sales revenue");
  const otherIncomeAcc = findByCode("4200") ?? findByName("Other income");
  const purchasesAcc =
    findByCode("5200") ?? findByName("Raw material purchased");
  const cogsAcc = findByCode("5100") ?? findByName("Cost of goods sold");
  const rawStockAcc =
    findByCode("1300") ?? findByName("Raw material inventory");
  const fgStockAcc =
    findByCode("1400") ?? findByName("Finished goods inventory");
  // The two stock posting accounts: opening stock sits in the trading account
  // account and closing stock in the one credited to it. The plain inventory
  // accounts above are the fallback for a chart that predates them.
  const openingTradingAcc =
    findByCode("5150") ?? findByName("Opening stock (trading)");
  const closingTradingAcc =
    findByCode("5155") ?? findByName("Closing stock (trading)");

  // All expense accounts (type === "expense") that are NOT purchases/COGS
  // — split into operating and "other" buckets by code.
  const expenseRows = useMemo(() => {
    const list = accounts.filter(
      (a) =>
        !a.isGroup &&
        a.type === "expense" &&
        a._id !== purchasesAcc?._id &&
        a._id !== cogsAcc?._id &&
        // opening and closing stock are the trading account, not expenses that
        // happen to be negative — they are shown as their own two lines below
        a._id !== openingTradingAcc?._id &&
        a._id !== closingTradingAcc?._id,
    );
    const operating: typeof list = [];
    const other: typeof list = [];
    for (const a of list) {
      const c = Number.parseInt(a.code, 10);
      if (Number.isFinite(c) && c < 5700) operating.push(a);
      else other.push(a);
    }
    return { operating, other };
  }, [accounts, purchasesAcc, cogsAcc, openingTradingAcc, closingTradingAcc]);

  // ── raw movement values ───────────────────────────────────────
  const sales = salesAcc ? rangeMovement(salesAcc._id) : 0;
  const otherIncome = otherIncomeAcc ? rangeMovement(otherIncomeAcc._id) : 0;
  const purchases = purchasesAcc ? rangeMovement(purchasesAcc._id) : 0;
  const directCogs = cogsAcc ? rangeMovement(cogsAcc._id) : 0;

  // Opening stock = inventory balances on the day BEFORE the range start.
  // Closing stock = inventory balances as at the end of the range.
  const openingRaw = rawStockAcc ? balanceAt(rawStockAcc._id, fromMs - 1) : 0;
  const openingFg = fgStockAcc ? balanceAt(fgStockAcc._id, fromMs - 1) : 0;
  const closingRaw = rawStockAcc ? balanceAt(rawStockAcc._id, toMs) : 0;
  const closingFg = fgStockAcc ? balanceAt(fgStockAcc._id, toMs) : 0;
  // What the stock posting put in the ledger wins; a chart without one falls
  // back to reading the inventory accounts at the two dates.
  const postedOpening = openingTradingAcc
    ? rangeMovement(openingTradingAcc._id)
    : 0;
  const postedClosing = closingTradingAcc
    ? -rangeMovement(closingTradingAcc._id)
    : 0;
  const openingStock = round(
    postedOpening !== 0
      ? postedOpening
      : Math.max(0, openingRaw) + Math.max(0, openingFg),
  );
  const closingStock = round(
    postedClosing !== 0
      ? postedClosing
      : Math.max(0, closingRaw) + Math.max(0, closingFg),
  );

  // Operating expenses + other expenses from the chart (range movement)
  const operatingExpLines = expenseRows.operating
    .map((a) => ({ account: a, amount: rangeMovement(a._id) }))
    .filter((l) => l.amount > 0.0001);
  const otherExpLines = expenseRows.other
    .map((a) => ({ account: a, amount: rangeMovement(a._id) }))
    .filter((l) => l.amount > 0.0001);
  const operatingExpTotal = round(
    operatingExpLines.reduce((s, l) => s + l.amount, 0),
  );
  const otherExpTotal = round(otherExpLines.reduce((s, l) => s + l.amount, 0));

  // ── Trading math ──────────────────────────────────────────────
  const goodsAvailable = round(openingStock + purchases);
  const cogsByStock = round(goodsAvailable - closingStock);
  // If a direct COGS account was used (manual COGS JEs), add it. Otherwise
  // the derived figure from opening+purchases−closing is authoritative.
  const cogs = directCogs > 0 ? round(directCogs + cogsByStock) : cogsByStock;
  const grossProfit = round(sales - cogs);
  const gpPct = sales > 0 ? (grossProfit / sales) * 100 : 0;

  // ── P&L math ──────────────────────────────────────────────────
  const totalIncome = round(sales + otherIncome);
  const operatingProfit = round(grossProfit + otherIncome - operatingExpTotal);
  const netProfit = round(operatingProfit - otherExpTotal);
  const netPct = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;

  const hasAnyData =
    Math.abs(sales) +
      Math.abs(otherIncome) +
      Math.abs(purchases) +
      openingStock +
      closingStock +
      operatingExpTotal +
      otherExpTotal >
    0.001;

  const periodLabel = (() => {
    const fd = new Date(fromMs);
    const td = new Date(toMs);
    const f = `${fd.toLocaleString(undefined, { month: "short", year: "numeric" })}`;
    const t = `${td.toLocaleString(undefined, { month: "short", year: "numeric" })}`;
    return f === t ? f : `${f} → ${t}`;
  })();

  // ── RENDER ────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* ── KPI strip ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={<DollarSign className="size-4" />}
          label="Total Income"
          sub={periodLabel}
          value={money(totalIncome)}
          accent="emerald"
          trend={totalIncome > 0 ? "up" : "flat"}
        />
        <KpiCard
          icon={<Package2 className="size-4" />}
          label="Cost of Goods Sold"
          sub={`COGS · ${periodLabel}`}
          value={money(cogs)}
          accent="rose"
          trend={cogs > 0 ? "up" : "flat"}
        />
        <KpiCard
          icon={<TrendingUp className="size-4" />}
          label="Gross Profit"
          sub={`GP% · ${gpPct.toFixed(1)}%`}
          value={money(grossProfit)}
          accent={grossProfit >= 0 ? "emerald" : "rose"}
          trend={grossProfit >= 0 ? "up" : "down"}
        />
        <KpiCard
          icon={<BarChart3 className="size-4" />}
          label="Net Profit"
          sub={`Net% · ${netPct.toFixed(1)}%`}
          value={money(netProfit)}
          accent={netProfit >= 0 ? "violet" : "rose"}
          trend={netProfit >= 0 ? "up" : "down"}
          highlight
        />
      </div>

      {!hasAnyData && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <span className="mr-2 font-semibold">⚠</span>
          Nothing was posted between {from} and {to}. Widen the period, or post
          a journal entry against the income and expense accounts.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ═══════════════ TRADING ACCOUNT ═══════════════ */}
        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-r from-emerald-500/[0.08] via-transparent to-sky-500/[0.08] px-4 py-3">
            <div className="grid size-8 place-items-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <ShoppingCart className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Trading Account
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Opening stock + Purchases − Closing stock = COGS
              </p>
            </div>
            <span className="ml-auto rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {rangeDays} day{rangeDays === 1 ? "" : "s"}
            </span>
          </header>

          <div className="px-4 py-3">
            <Row
              label="Opening stock"
              value={money(openingStock)}
              muted
              sub="Raw materials + finished goods"
            />
            <Row
              label="Add: Purchases"
              value={money(purchases)}
              sub={
                purchasesAcc
                  ? `${purchasesAcc.code} ${purchasesAcc.name}`
                  : undefined
              }
            />
            <SubtotalRow
              label="Goods available for sale"
              value={money(goodsAvailable)}
            />
            <Row
              label="Less: Closing stock"
              value={money(closingStock)}
              muted
              sub="Inventory on hand at period end"
              negative
            />
            <SubtotalRow
              label="Cost of Goods Sold"
              value={money(cogs)}
              tone="rose"
            />
          </div>

          <div className="border-t border-border/60 bg-gradient-to-r from-emerald-500/[0.06] via-white to-transparent dark:via-transparent px-4 py-3">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Sales revenue
                </p>
                <p className="text-[11px] text-muted-foreground/70">
                  {salesAcc ? `${salesAcc.code} ${salesAcc.name}` : periodLabel}
                </p>
              </div>
              <p className="text-right font-semibold tabular-nums">
                {money(sales)}
              </p>
            </div>
            <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                  Gross Profit
                </p>
                <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                  Sales − Cost of Goods Sold
                </p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                  {money(grossProfit)}
                </p>
                <p className="text-[11px] font-medium tabular-nums text-emerald-700/80 dark:text-emerald-300/80">
                  {sales > 0 ? `${gpPct.toFixed(1)}% margin` : "— margin"}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════ PROFIT & LOSS ═══════════════ */}
        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
          <header className="flex items-center gap-2 border-b border-border/60 bg-gradient-to-r from-violet-500/[0.08] via-transparent to-indigo-500/[0.08] px-4 py-3">
            <div className="grid size-8 place-items-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <BarChart3 className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Profit &amp; Loss
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Gross profit + other income − expenses
              </p>
            </div>
          </header>

          <div className="px-4 py-3">
            <Row
              label="Gross Profit brought down"
              value={money(grossProfit)}
              sub="From the trading account above"
            />
            {otherIncome > 0 && (
              <Row
                label="Add: Other income"
                value={money(otherIncome)}
                sub={
                  otherIncomeAcc
                    ? `${otherIncomeAcc.code} ${otherIncomeAcc.name}`
                    : undefined
                }
              />
            )}
            <SubtotalRow
              label={otherIncome > 0 ? "Total income" : "Income to allocate"}
              value={money(otherIncome > 0 ? totalIncome : grossProfit)}
            />

            <div className="mt-3 mb-1.5 flex items-center gap-1.5 px-0.5">
              <span className="h-px flex-1 bg-border/60" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Operating expenses
              </span>
              <span className="h-px flex-1 bg-border/60" />
            </div>

            {operatingExpLines.length === 0 ? (
              <EmptyRow label="No operating expenses posted yet" />
            ) : (
              operatingExpLines.map((l) => (
                <Row
                  key={l.account._id}
                  label={`${l.account.code} ${l.account.name}`}
                  value={money(l.amount)}
                />
              ))
            )}
            <SubtotalRow
              label="Total operating expenses"
              value={money(operatingExpTotal)}
              tone="rose"
            />
            <SubtotalRow
              label="Operating Profit"
              value={money(operatingProfit)}
              tone={operatingProfit >= 0 ? "emerald" : "rose"}
              strong
            />

            {otherExpLines.length > 0 && (
              <>
                <div className="mt-3 mb-1.5 flex items-center gap-1.5 px-0.5">
                  <span className="h-px flex-1 bg-border/60" />
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Other expenses
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>
                {otherExpLines.map((l) => (
                  <Row
                    key={l.account._id}
                    label={`${l.account.code} ${l.account.name}`}
                    value={money(l.amount)}
                  />
                ))}
                <SubtotalRow
                  label="Total other expenses"
                  value={money(otherExpTotal)}
                  tone="rose"
                />
              </>
            )}
          </div>

          {/* — NET PROFIT banner — */}
          <div
            className={cn(
              "border-t px-4 py-4",
              netProfit >= 0
                ? "border-violet-500/30 bg-gradient-to-r from-violet-500/[0.12] via-indigo-500/[0.08] to-emerald-500/[0.08]"
                : "border-rose-500/30 bg-gradient-to-r from-rose-500/[0.12] via-amber-500/[0.06] to-rose-500/[0.08]",
            )}
          >
            <div className="flex items-end justify-between gap-4">
              <div>
                <p
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-[0.16em]",
                    netProfit >= 0
                      ? "text-violet-800 dark:text-violet-300"
                      : "text-rose-800 dark:text-rose-300",
                  )}
                >
                  Net {netProfit >= 0 ? "Profit" : "Loss"} for the period
                </p>
                <p
                  className={cn(
                    "text-[11px]",
                    netProfit >= 0
                      ? "text-violet-700/80 dark:text-violet-300/80"
                      : "text-rose-700/80 dark:text-rose-300/80",
                  )}
                >
                  {from} → {to} · {rangeDays} day
                  {rangeDays === 1 ? "" : "s"}
                </p>
              </div>
              <div className="text-right">
                <p
                  className={cn(
                    "text-2xl font-extrabold tabular-nums tracking-tight",
                    netProfit >= 0
                      ? "text-violet-800 dark:text-violet-200"
                      : "text-rose-700 dark:text-rose-200",
                  )}
                >
                  {money(netProfit)}
                </p>
                <p
                  className={cn(
                    "text-xs font-semibold tabular-nums",
                    netProfit >= 0
                      ? "text-violet-700/80 dark:text-violet-300/80"
                      : "text-rose-700/80 dark:text-rose-300/80",
                  )}
                >
                  {totalIncome > 0
                    ? `${Math.abs(netPct).toFixed(1)}% of revenue · ${
                        netProfit >= 0 ? "profitable" : "loss-making"
                      }`
                    : "—"}
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── Closing detail: Stock positions ─────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <Package2 className="size-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                Inventory movements
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Raw materials &amp; finished goods — opening vs. closing
                positions
              </p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                From
              </span>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="Period from"
                className="mt-0.5 h-7 w-36 rounded-lg text-xs"
              />
            </div>
            <div>
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                To
              </span>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="Period to"
                className="mt-0.5 h-7 w-36 rounded-lg text-xs"
              />
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <StockBlock
            title="Opening Stock"
            subtitle={`As at ${from} (day before range start)`}
            raw={openingRaw}
            fg={openingFg}
            total={openingStock}
            money={money}
            tone="sky"
          />
          <StockBlock
            title="Closing Stock"
            subtitle={`As at ${to} (period end)`}
            raw={closingRaw}
            fg={closingFg}
            total={closingStock}
            money={money}
            tone="indigo"
          />
        </div>

        <div className="border-t border-border/60 px-4 py-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Legend label="Purchases in period" value={money(purchases)} />
            <Legend label="Goods available" value={money(goodsAvailable)} />
            <Legend
              label="Cost of goods sold"
              value={money(cogs)}
              tone="rose"
            />
            <Legend
              label={
                closingStock >= openingStock
                  ? "Stock increase"
                  : "Stock decrease"
              }
              value={money(Math.abs(closingStock - openingStock))}
              tone={closingStock >= openingStock ? "emerald" : "amber"}
            />
          </div>
        </div>
      </section>

      {/* ── Memoranda: Result roll-up ──────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm">
        <header className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <p className="text-sm font-semibold">Result</p>
        </header>
        <div className="px-4 py-1">
          <ResultRow label="Sales revenue" value={sales} money={money} strong />
          <ResultRow
            label="Cost of goods sold"
            value={cogs}
            money={money}
            negative
          />
          <ResultDivider />
          <ResultRow
            label="Gross Profit"
            value={grossProfit}
            money={money}
            strong
            bold
          />
          {otherIncome > 0 && (
            <ResultRow label="Other income" value={otherIncome} money={money} />
          )}
          <ResultRow
            label="Less: Operating expenses"
            value={operatingExpTotal}
            money={money}
            negative
          />
          <ResultDivider />
          <ResultRow
            label="Operating Profit"
            value={operatingProfit}
            money={money}
            bold
          />
          {otherExpTotal > 0 && (
            <ResultRow
              label="Less: Other expenses"
              value={otherExpTotal}
              money={money}
              negative
            />
          )}
          <ResultDivider thick />
          <ResultRow
            label={
              <span className="text-base font-extrabold">
                Net {netProfit >= 0 ? "Profit" : "Loss"} for the period
              </span>
            }
            value={netProfit}
            money={money}
            bold
            accent
          />
        </div>
      </section>
    </div>
  );
}

/* ── Small P&L primitives ───────────────────────────────────────── */

function KpiCard({
  icon,
  label,
  sub,
  value,
  accent,
  trend,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  value: string;
  accent: "emerald" | "rose" | "violet" | "sky";
  trend: "up" | "down" | "flat";
  highlight?: boolean;
}) {
  const accentCls: Record<typeof accent, string> = {
    emerald:
      "from-emerald-500/15 to-emerald-500/0 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20",
    rose: "from-rose-500/15 to-rose-500/0 text-rose-700 dark:text-rose-300 ring-rose-500/20",
    violet:
      "from-violet-500/15 to-violet-500/0 text-violet-700 dark:text-violet-300 ring-violet-500/30",
    sky: "from-sky-500/15 to-sky-500/0 text-sky-700 dark:text-sky-300 ring-sky-500/20",
  };
  const trendIcon =
    trend === "up" ? (
      <ArrowUpRight className="size-3" />
    ) : trend === "down" ? (
      <ArrowDownRight className="size-3" />
    ) : (
      <Minus className="size-3" />
    );
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/70 bg-card p-4 shadow-sm",
        highlight && "ring-2",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br",
          accentCls[accent],
        )}
      />
      <div className="relative flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-background/80 ring-1 ring-border/60 backdrop-blur">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="truncate">{label}</span>
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]",
                trend === "up" &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                trend === "down" &&
                  "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                trend === "flat" && "bg-muted text-muted-foreground",
              )}
            >
              {trendIcon}
              {trend === "up" ? "Up" : trend === "down" ? "Down" : "Flat"}
            </span>
          </div>
          <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
            {value}
          </p>
          {sub && (
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">{sub}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  sub,
  muted,
  negative,
}: {
  label: React.ReactNode;
  value: string;
  sub?: string;
  muted?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <div className="min-w-0">
        <p
          className={cn(
            "text-sm leading-tight",
            muted ? "text-muted-foreground/90" : "text-foreground/90",
            negative && "pl-3",
          )}
        >
          {negative && <span className="mr-1 text-muted-foreground/60">−</span>}
          {label}
        </p>
        {sub && (
          <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground/70">
            {sub}
          </p>
        )}
      </div>
      <p
        className={cn(
          "shrink-0 text-sm tabular-nums",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyRow({ label }: { label: string }) {
  return (
    <p className="py-3 text-center text-xs text-muted-foreground/70">{label}</p>
  );
}

function SubtotalRow({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "rose";
  strong?: boolean;
}) {
  return (
    <div className="my-1 flex items-center justify-between gap-4 rounded-xl bg-muted/40 px-2.5 py-2 ring-1 ring-border/50">
      <p
        className={cn(
          "text-xs leading-tight",
          tone === "emerald" &&
            "font-semibold text-emerald-700 dark:text-emerald-300",
          tone === "rose" && "font-semibold text-rose-700 dark:text-rose-300",
          strong && "font-semibold text-foreground",
          tone === undefined && "font-medium text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "emerald" && "text-emerald-700 dark:text-emerald-300",
          tone === "rose" && "text-rose-700 dark:text-rose-300",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function StockBlock({
  title,
  subtitle,
  raw,
  fg,
  total,
  money,
  tone,
}: {
  title: string;
  subtitle: string;
  raw: number;
  fg: number;
  total: number;
  money: (n: number) => string;
  tone: "sky" | "indigo";
}) {
  const toneCls =
    tone === "sky"
      ? "bg-sky-500/10 text-sky-700 dark:text-sky-300"
      : "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest",
            toneCls,
          )}
        >
          {title}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{subtitle}</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Legend label="Raw materials" value={money(Math.max(0, raw))} />
        <Legend label="Finished goods" value={money(Math.max(0, fg))} />
        <Legend label="Total" value={money(total)} tone={tone} bold />
      </div>
    </div>
  );
}

function Legend({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: string;
  tone?: "rose" | "emerald" | "amber" | "sky" | "indigo";
  bold?: boolean;
}) {
  const toneCls: Record<string, string> = {
    rose: "text-rose-700 dark:text-rose-300",
    emerald: "text-emerald-700 dark:text-emerald-300",
    amber: "text-amber-700 dark:text-amber-300",
    sky: "text-sky-700 dark:text-sky-300",
    indigo: "text-indigo-700 dark:text-indigo-300",
  };
  return (
    <div>
      <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}
      </p>
      <p
        className={cn(
          "text-sm tabular-nums",
          bold ? "font-bold" : "font-medium",
          tone ? toneCls[tone] : "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ResultRow({
  label,
  value,
  money,
  strong,
  bold,
  negative,
  accent,
}: {
  label: React.ReactNode;
  value: number;
  money: (n: number) => string;
  strong?: boolean;
  bold?: boolean;
  negative?: boolean;
  accent?: boolean;
}) {
  const isNeg = negative || value < -0.0001;
  const displayValue = negative ? -Math.abs(value) : value;
  return (
    <div
      className={cn(
        "flex items-center justify-between py-1.5",
        !accent && "border-b border-dashed border-border/40 last:border-none",
      )}
    >
      <p
        className={cn(
          strong && "font-semibold text-foreground",
          !strong && !bold && "text-sm text-muted-foreground",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "tabular-nums",
          bold && !accent && "text-base font-bold",
          accent && "text-lg font-extrabold",
          !bold && !accent && "text-sm",
          accent
            ? value >= 0
              ? "text-violet-800 dark:text-violet-200"
              : "text-rose-700 dark:text-rose-200"
            : isNeg
              ? "text-rose-700 dark:text-rose-300"
              : "text-foreground",
        )}
      >
        {isNeg && !accent
          ? `−${money(Math.abs(displayValue))}`
          : money(Math.abs(displayValue))}
      </p>
    </div>
  );
}

function ResultDivider({ thick }: { thick?: boolean }) {
  return (
    <div
      className={cn(
        "-mx-1 my-0.5",
        thick ? "border-t-2 border-foreground/10" : "border-t border-border/50",
      )}
    />
  );
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function messageFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
