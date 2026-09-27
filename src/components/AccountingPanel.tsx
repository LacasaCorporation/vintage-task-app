import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BookOpen,
  CalendarDays,
  Eye,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  Scale,
  ScrollText,
  Trash2,
  Wallet,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useAppDialogs } from "@/components/AppDialogs";
import type { DialogsApi } from "@/components/AppDialogs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";
import PageTabs from "@/components/PageTabs";
import AccountLedgerDialog from "@/components/AccountLedgerDialog";
import AccountFormDialog from "@/components/AccountFormDialog";
import type { AccountType } from "@/convex/accounting";

/** The sub-pages of the accounting module, in the order the sidebar lists them. */
export type AccountingTab =
  | "accounts"
  | "journal"
  | "receipt"
  | "cashbook"
  | "daybook"
  | "balance";

export const ACCOUNTING_TABS: {
  id: AccountingTab;
  label: string;
  icon: typeof BookOpen;
  hint: string;
}[] = [
  { id: "accounts", label: "Chart of accounts", icon: BookOpen, hint: "Every ledger account and its running balance" },
  { id: "balance", label: "Opening balance", icon: Scale, hint: "Opening balances — assets against liabilities and equity" },
  { id: "journal", label: "Journal entry", icon: ScrollText, hint: "A balanced debit and credit posting" },
  { id: "receipt", label: "Receipt / payment", icon: Wallet, hint: "Money received from a customer, or paid to a supplier" },
  { id: "cashbook", label: "Cash book", icon: Landmark, hint: "Cash and bank movement only" },
  { id: "daybook", label: "Day book", icon: CalendarDays, hint: "Every posting, by day" },
];

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
  const { confirm, promptMulti } = useAppDialogs();

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
  const entryCount = `${(entries ?? []).filter((e) =>
    (shownKinds as readonly string[]).includes(e.kind),
  ).length} entries`;
  const ensureDefaults = useMutation(api.accounting.ensureDefaults);
  // create and edit live in AccountFormDialog, which owns its own mutations
  const removeAccount = useMutation(api.accounting.removeAccount);
  const postEntry = useMutation(api.accounting.createEntry);
  const dropEntry = useMutation(api.accounting.removeEntry);

  const [busy, setBusy] = useState(false);
  /** The account whose ledger is open, if any. */
  const [ledgerAccountId, setLedgerAccountId] = useState<Id<"accounts"> | null>(
    null,
  );
  /** The entry to highlight after jumping out of a ledger row. */
  const [focusEntry, setFocusEntry] = useState<Id<"journalEntries"> | null>(null);
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
  const compose = async (kind: "journal" | "receipt" | "payment" | "opening") => {
    if (posting.length < 2) {
      toast.error("Add at least two posting accounts first.");
      return;
    }
    const titles = {
      journal: "New journal entry",
      receipt: "Receipt — money received",
      payment: "Payment — money paid",
      opening: "Opening balances",
    } as const;
    const cash = posting.find((a) => a.code === "1100") ?? posting[0];

    setBusy(true);
    try {
      const amount = await promptMulti({
        title: titles[kind],
        message:
          kind === "receipt" || kind === "payment"
            ? "Who is this with?"
            : "Debits and credits must come to the same total.",
        confirmLabel: "Next",
        columns: 2,
        fields: [
          ...(kind === "receipt" || kind === "payment"
            ? [
                {
                  key: "amount",
                  label: kind === "payment" ? "Amount paid" : "Amount received",
                  type: "number" as const,
                  required: true,
                },
              ]
            : []),
          {
            key: "at",
            label: "Date",
            type: "date" as const,
            initial: TODAY,
          },
          kind === "receipt" || kind === "payment"
            ? { key: "party", label: "Party", full: true as const }
            : { key: "memo", label: "Memo (optional)", full: true as const },
        ],
      });
      if (!amount) return;
      const at = amount.at ? new Date(`${amount.at}T12:00:00`).getTime() : Date.now();

      let lines: { accountId: Id<"accounts">; debit: number; credit: number }[];
      if (kind === "receipt" || kind === "payment") {
        // A receipt or payment is always a two-line posting: money against a
        // control account, so the pair cannot be left unbalanced.
        const value = Number(amount.amount);
        if (!Number.isFinite(value) || value <= 0) {
          toast.error("Enter an amount above zero.");
          return;
        }
        const control = posting.find((a) =>
          (kind === "receipt"
            ? ["1200", "4100", "4200"]
            : ["2100", "5200", "5300", "5400"]
          ).includes(a.code),
        );
        if (!control) {
          toast.error("Add a control account to record this against.");
          return;
        }
        const received = kind === "receipt";
        lines = [
          {
            accountId: cash._id,
            debit: received ? value : 0,
            credit: received ? 0 : value,
          },
          {
            accountId: control._id,
            debit: received ? 0 : value,
            credit: received ? value : 0,
          },
        ];
      } else {
        const picked = await editLines(promptMulti, posting, titles[kind]);
        if (!picked) return;
        lines = picked;
      }

      await postEntry({ at, kind, memo: amount.memo, party: amount.party, lines });
      toast.success(`${titles[kind]} posted.`);
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't post that entry."));
    } finally {
      setBusy(false);
    }
  };

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
                      title={a.isGroup ? undefined : `Open the ${a.name} ledger`}
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
                              [a.bankName, a.accountNumber].filter(Boolean).join(" · ") ||
                              "Bank account"
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
                              a.type === "income" || a.type === "liability" || a.type === "equity"
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
          title={
            tab === "journal" ? "Journal entries" : "Receipts & payments"
          }
          count={entryCount}
          actions={
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void compose(tab === "journal" ? "journal" : "receipt")}
              className="h-7 gap-1.5 rounded-lg border-primary/30 bg-primary/[0.06] px-2 text-xs text-primary hover:bg-primary/10 hover:text-primary"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
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
      ) : (
        <BookPanel cashOnly={tab === "cashbook"} money={money} />
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
            // the entry editor is a portal-based prompt; let the dialog fully
            // unmount first so its pointer-events lock is released
            window.setTimeout(() => void compose("journal"), 0);
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
    (a) => !a.isGroup && (a.type === "asset" || a.type === "liability" || a.type === "equity"),
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
          debit: accounts.find((a) => a._id === l.accountId)?.type === "asset" ? l.amount : 0,
          credit: accounts.find((a) => a._id === l.accountId)?.type === "asset" ? 0 : l.amount,
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
                      <td colSpan={2} className="px-4 py-1.5 text-xs font-semibold">
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
                              setAmounts((d) => ({ ...d, [a._id]: e.target.value }))
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
              {balanced
                ? "Balanced"
                : `Out by ${money(Math.abs(difference))}`}
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
            Nothing posted yet — fill in the two sides above and they will balance.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {entries.map((e) => (
              <li key={e._id} className="flex items-center gap-3 px-4 py-2 text-xs">
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
async function editLines(
  promptMulti: DialogsApi["promptMulti"],
  accounts: { _id: Id<"accounts">; code: string; name: string }[],
  title: string,
): Promise<{ accountId: Id<"accounts">; debit: number; credit: number }[] | null> {
  const fields = accounts.flatMap((a) => [
    { key: `d_${a._id}`, label: `${a.code} Dr`, placeholder: "0" },
    { key: `c_${a._id}`, label: `${a.code} Cr`, placeholder: "0" },
  ]);
  const values = await promptMulti({
    title,
    message: "Enter a debit or a credit for each account — leave the rest blank.",
    confirmLabel: "Next",
    cancelLabel: "Cancel",
    columns: 2,
    fields,
  });
  if (!values) return null;
  const lines: { accountId: Id<"accounts">; debit: number; credit: number }[] = [];
  for (const a of accounts) {
    const debit = Number(values[`d_${a._id}`] ?? 0);
    const credit = Number(values[`c_${a._id}`] ?? 0);
    if (Number.isFinite(debit) && debit > 0) {
      lines.push({ accountId: a._id, debit, credit: 0 });
    }
    if (Number.isFinite(credit) && credit > 0) {
      lines.push({ accountId: a._id, debit: 0, credit });
    }
  }
  if (lines.length === 0) {
    toast.error("Enter at least one amount.");
    return null;
  }
  return lines;
}

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
        Nothing posted yet — use <span className="font-medium">New entry</span> to
        raise the first one.
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
              <span className="truncate text-xs text-foreground/85">{e.party}</span>
            )}
            {e.memo && (
              <span className="truncate text-xs text-muted-foreground">{e.memo}</span>
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
              <td className="px-3 py-2 text-right tabular-nums">{money(totalIn)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{money(totalOut)}</td>
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

function messageFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
