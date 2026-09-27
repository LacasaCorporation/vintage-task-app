import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AccountRow, AccountType } from "@/convex/accounting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import {
  Landmark,
  Layers,
  Pencil,
  ScrollText,
  Trash2,
  Wallet,
} from "lucide-react";

/** One draft, whatever the form is doing with it. */
type Draft = {
  code: string;
  name: string;
  type: AccountType;
  isGroup: boolean;
  /** "" means the account sits at the top level. */
  parentId: string;
  isBank: boolean;
  bankName: string;
  accountNumber: string;
  bsb: string;
  currency: string;
  note: string;
};

const TYPES: { id: AccountType; label: string; hint: string }[] = [
  { id: "asset", label: "Asset", hint: "What the business owns" },
  { id: "liability", label: "Liability", hint: "What the business owes" },
  { id: "equity", label: "Equity", hint: "The owners' stake" },
  { id: "income", label: "Income", hint: "Money coming in" },
  { id: "expense", label: "Expense", hint: "Money going out" },
];

const TYPE_CHIP: Record<string, string> = {
  asset: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  liability: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  equity: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  income: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  expense: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

const TYPE_LABEL: Record<string, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

const emptyDraft = (type: AccountType = "asset"): Draft => ({
  code: "",
  name: "",
  type,
  isGroup: false,
  parentId: "",
  isBank: false,
  bankName: "",
  accountNumber: "",
  bsb: "",
  currency: "",
  note: "",
});

const draftOf = (a: AccountRow): Draft => ({
  code: a.code,
  name: a.name,
  type: a.type,
  isGroup: a.isGroup,
  parentId: a.parentId ?? "",
  isBank: a.isBank,
  bankName: a.bankName ?? "",
  accountNumber: a.accountNumber ?? "",
  bsb: a.bsb ?? "",
  currency: a.currency ?? "",
  note: a.note ?? "",
});

/** A titled block of fields, so the form reads in sections rather than a wall. */
function Section({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: typeof Wallet;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border/60 px-6 py-4 last:border-b-0">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-primary" />
        <div>
          <h3 className="text-xs font-semibold tracking-wide uppercase">
            {title}
          </h3>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const labelCls = "mb-1.5 block text-[11px] font-semibold tracking-wide uppercase";
const fieldCls = "h-9 w-full rounded-lg text-sm";
const errCls = "mt-1 text-[11px] text-destructive";

/**
 * Create, edit or read one chart-of-accounts entry.
 *
 * Groups nest (a group can sit under another group), and an account that
 * actually holds money at a bank collects its bank details here rather than in
 * a note. Everything is checked before it is offered for saving, so the
 * mistakes that would corrupt the chart — a duplicate code, an account filed
 * under the wrong type of heading — cannot be committed from here.
 */
export default function AccountFormDialog({
  mode,
  account,
  accounts,
  money,
  onClose,
  onSaved,
  onDeleted,
  onOpenLedger,
}: {
  mode: "create" | "edit" | "view";
  account?: AccountRow;
  accounts: AccountRow[];
  money: (n: number) => string;
  onClose: () => void;
  onSaved: (id: Id<"accounts">) => void;
  onDeleted?: (id: Id<"accounts">) => void;
  /** From view/edit, jump to the account's own ledger. */
  onOpenLedger?: (id: Id<"accounts">) => void;
}) {
  const [draft, setDraft] = useState<Draft>(
    account === undefined ? emptyDraft() : draftOf(account),
  );
  const [busy, setBusy] = useState(false);

  const addAccount = useMutation(api.accounting.createAccount);
  const editAccount = useMutation(api.accounting.updateAccount);
  const dropAccount = useMutation(api.accounting.removeAccount);
  const suggestion = useQuery(api.accounting.suggestCode, { type: draft.type });

  const byId = useMemo(
    () => new Map(accounts.map((a) => [a._id as string, a])),
    [accounts],
  );

  /** Groups are the only thing an account can be filed under. */
  const groups = useMemo(
    () =>
      accounts
        .filter((a) => a.isGroup && a._id !== account?._id)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    [accounts, account?._id],
  );
  /** Shown for the chosen type only — the server refuses a mismatch anyway. */
  const parentOptions = useMemo(
    () => groups.filter((g) => g.type === draft.type),
    [groups, draft.type],
  );

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!code) e.code = "Give the account a code.";
    else if (
      accounts.some(
        (a) =>
          a.code.toLowerCase() === code.toLowerCase() && a._id !== account?._id,
      )
    ) {
      e.code = `${code} is already in the chart.`;
    }
    if (!name) e.name = "Give the account a name.";
    if (draft.isGroup && draft.isBank) {
      e.isBank = "A group holds no balance, so it cannot be a bank account.";
    }
    const parent = draft.parentId === "" ? undefined : byId.get(draft.parentId);
    if (parent === undefined) return e;
    if (!parent.isGroup) e.parentId = "Pick a group, not a posting account.";
    else if (parent.type !== draft.type) {
      e.parentId = `${parent.code} ${parent.name} is an ${parent.type} group.`;
    }
    return e;
  }, [draft, accounts, byId, account?._id]);

  const canSave = Object.keys(errors).length === 0 && !busy;

  /** The headings this account would end up under, outermost first. */
  const path = useMemo(() => {
    const chain: string[] = [];
    let cursor = draft.parentId === "" ? undefined : byId.get(draft.parentId);
    while (cursor !== undefined) {
      chain.unshift(`${cursor.code} ${cursor.name}`);
      cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
    }
    return chain;
  }, [draft.parentId, byId]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const parentId = draft.parentId === "" ? undefined : (draft.parentId as Id<"accounts">);
    try {
      if (mode === "create") {
        const id = await addAccount({
          code: draft.code,
          name: draft.name,
          type: draft.type,
          isGroup: draft.isGroup,
          parentId,
          note: draft.note,
          isBank: draft.isBank,
          bankName: draft.bankName,
          accountNumber: draft.accountNumber,
          bsb: draft.bsb,
          currency: draft.currency,
        });
        toast.success(`${draft.code} ${draft.name} added.`);
        onSaved(id);
      } else if (account !== undefined) {
        await editAccount({
          id: account._id,
          code: draft.code,
          name: draft.name,
          type: draft.type,
          isGroup: draft.isGroup,
          parentId,
          note: draft.note,
          isBank: draft.isBank,
          bankName: draft.bankName,
          accountNumber: draft.accountNumber,
          bsb: draft.bsb,
          currency: draft.currency,
        });
        toast.success("Account updated.");
        onSaved(account._id);
      }
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Couldn't save that account.",
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (account === undefined || busy) return;
    setBusy(true);
    try {
      await dropAccount({ id: account._id });
      toast.success("Account deleted.");
      onDeleted?.(account._id);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Couldn't delete that account.",
      );
    } finally {
      setBusy(false);
    }
  };

  // ── read-only view ────────────────────────────────────────────────────
  if (mode === "view" && account !== undefined) {
    const rows: [string, string][] = [
      ["Code", account.code],
      ["Name", account.name],
      ["Type", TYPE_LABEL[account.type] ?? account.type],
      ["Sits under", pathFor(account, byId) || "Top level"],
      ["Role", account.isGroup ? "Group / heading" : "Posting account"],
    ];
    if (account.isBank) {
      rows.push(
        ["Held at", account.bankName ?? "—"],
        ["Account number", account.accountNumber ?? "—"],
        ["BSB / routing", account.bsb ?? "—"],
        ["Currency", account.currency ?? "Firm default"],
      );
    }
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[min(100%,640px)]">
          <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-6 pt-6 pb-5">
            <DialogHeader className="pr-8">
              <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                Account details
              </p>
              <DialogTitle className="flex flex-wrap items-center gap-2 text-xl">
                <Layers className="size-5 shrink-0 text-primary" />
                <span className="font-mono text-sm text-muted-foreground">
                  {account.code}
                </span>
                {account.name}
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                    TYPE_CHIP[account.type],
                  )}
                >
                  {TYPE_LABEL[account.type] ?? account.type}
                </span>
                {account.isBank && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Bank
                  </span>
                )}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {account.isGroup
                  ? "A heading — it holds no balance of its own."
                  : "A posting account — debits and credits land here."}
              </DialogDescription>
            </DialogHeader>
          </div>

          <dl className="divide-y divide-border/50">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-start gap-4 px-6 py-2.5">
                <dt className="w-36 shrink-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {k}
                </dt>
                <dd className="min-w-0 flex-1 text-sm break-words">{v}</dd>
              </div>
            ))}
            {account.note !== undefined && account.note !== "" && (
              <div className="px-6 py-2.5">
                <dt className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Note
                </dt>
                <dd className="text-sm whitespace-pre-wrap">{account.note}</dd>
              </div>
            )}
            {!account.isGroup && (
              <div className="flex items-start gap-4 px-6 py-2.5">
                <dt className="w-36 shrink-0 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Balance
                </dt>
                <dd className="flex-1">
                  <p className="text-sm font-semibold tabular-nums">
                    {money(account.signed)}
                  </p>
                  <p className="text-[11px] tabular-nums text-muted-foreground">
                    {money(account.debit)} debits · {money(account.credit)}{" "}
                    credits
                  </p>
                </dd>
              </div>
            )}
          </dl>

          <DialogFooter className="gap-1.5 border-t border-border/60 bg-muted/20 px-6 py-3">
            {onOpenLedger && !account.isGroup && (
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenLedger(account._id)}
                className="h-8 rounded-lg px-3 text-xs"
              >
                <ScrollText className="size-3.5" /> Open ledger
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-8 rounded-lg px-3 text-xs"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ── create / edit form ────────────────────────────────────────────────
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[min(100%,720px)]">
        <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-6 pt-6 pb-5">
          <DialogHeader className="pr-8">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              {mode === "create" ? "New ledger account" : "Edit ledger account"}
            </p>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Layers className="size-5 shrink-0 text-primary" />
              {mode === "create"
                ? "Add to the chart"
                : `${account?.code ?? ""} ${account?.name ?? ""}`}
            </DialogTitle>
            <DialogDescription className="text-xs">
              A group is a heading and holds no balance. A posting account is
              what debits and credits are recorded against.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[58vh] overflow-y-auto">
          {/* ── identity ─────────────────────────────────────────────── */}
          <Section
            title="Identity"
            description="The code orders the chart; the name is what you will see on every statement."
            icon={Layers}
          >
            <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
              <div>
                <Label className={labelCls} htmlFor="acc-code">
                  Code
                </Label>
                <Input
                  id="acc-code"
                  value={draft.code}
                  onChange={(e) => set("code", e.target.value)}
                  placeholder="1150"
                  className={cn(fieldCls, "font-mono")}
                  aria-invalid={errors.code !== undefined}
                />
                {errors.code !== undefined ? (
                  <p className={errCls}>{errors.code}</p>
                ) : suggestion !== undefined && draft.code.trim() === "" ? (
                  <button
                    type="button"
                    onClick={() => set("code", suggestion)}
                    className="mt-1 text-[11px] text-primary hover:underline"
                  >
                    Use next free code · {suggestion}
                  </button>
                ) : null}
              </div>
              <div>
                <Label className={labelCls} htmlFor="acc-name">
                  Name
                </Label>
                <Input
                  id="acc-name"
                  value={draft.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Savings account"
                  className={fieldCls}
                  aria-invalid={errors.name !== undefined}
                />
                {errors.name !== undefined && (
                  <p className={errCls}>{errors.name}</p>
                )}
              </div>
            </div>
          </Section>

          {/* ── classification ──────────────────────────────────────── */}
          <Section
            title="Classification"
            description="Which side of the balance this lands on, and whether it posts or just heads a section."
            icon={Wallet}
          >
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={draft.type === t.id}
                  onClick={() => {
                    setDraft((d) => ({
                      ...d,
                      type: t.id,
                      // a heading and a bank are mutually exclusive, and a
                      // parent from the old type no longer applies
                      isBank: t.id === "income" || t.id === "expense" ? false : d.isBank,
                      parentId: "",
                    }));
                  }}
                  title={t.hint}
                  className={cn(
                    "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                    draft.type === t.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2.5">
              <input
                type="checkbox"
                checked={draft.isGroup}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    isGroup: e.target.checked,
                    isBank: e.target.checked ? false : d.isBank,
                    parentId: e.target.checked ? d.parentId : d.parentId,
                  }))
                }
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  This is a group / heading
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  Groups organise the chart. They hold no balance and cannot be
                  posted to, but other accounts sit under them.
                </span>
              </span>
            </label>
          </Section>

          {/* ── grouping ─────────────────────────────────────────────── */}
          <Section
            title="Grouping"
            description="File this account under a heading. Groups can sit under other groups, so the chart nests as deep as you need."
            icon={Layers}
          >
            <Label className={labelCls} htmlFor="acc-parent">
              Sits under
            </Label>
            <select
              id="acc-parent"
              value={draft.parentId}
              onChange={(e) => set("parentId", e.target.value)}
              className="h-9 w-full rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
              aria-invalid={errors.parentId !== undefined}
            >
              <option value="">— Top level —</option>
              {parentOptions.map((g) => (
                <option key={g._id} value={g._id}>
                  {g.code} · {g.name}
                </option>
              ))}
            </select>
            {errors.parentId !== undefined ? (
              <p className={errCls}>{errors.parentId}</p>
            ) : parentOptions.length === 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No {TYPE_LABEL[draft.type]?.toLowerCase()} groups yet — this
                account will sit at the top level.
              </p>
            ) : path.length > 0 ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Path: {path.join("  ›  ")}
              </p>
            ) : null}
          </Section>

          {/* ── bank details ─────────────────────────────────────────── */}
          <Section
            title="Bank details"
            description="For an account that holds money at a bank. This is what makes it usable as a cash or bank account on a receipt."
            icon={Landmark}
          >
            <label
              className={cn(
                "flex items-start gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2.5",
                (draft.isGroup || draft.type === "income" || draft.type === "expense") &&
                  "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="checkbox"
                checked={draft.isBank}
                disabled={draft.isGroup || draft.type === "income" || draft.type === "expense"}
                onChange={(e) => set("isBank", e.target.checked)}
                className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">
                  This is a bank account
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {draft.isGroup
                    ? "A group holds no balance, so it cannot be a bank."
                    : draft.type === "income" || draft.type === "expense"
                      ? "Only asset and liability accounts can be banks."
                      : "Money received or paid is booked against this."}
                </span>
              </span>
            </label>
            {errors.isBank !== undefined && <p className={errCls}>{errors.isBank}</p>}

            {draft.isBank && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className={labelCls} htmlFor="acc-bank">
                    Bank / account name
                  </Label>
                  <Input
                    id="acc-bank"
                    value={draft.bankName}
                    onChange={(e) => set("bankName", e.target.value)}
                    placeholder="Commonwealth Bank"
                    className={fieldCls}
                  />
                </div>
                <div>
                  <Label className={labelCls} htmlFor="acc-acct">
                    Account number
                  </Label>
                  <Input
                    id="acc-acct"
                    value={draft.accountNumber}
                    onChange={(e) => set("accountNumber", e.target.value)}
                    placeholder="0000 0000"
                    className={cn(fieldCls, "font-mono")}
                  />
                </div>
                <div>
                  <Label className={labelCls} htmlFor="acc-bsb">
                    BSB / routing
                  </Label>
                  <Input
                    id="acc-bsb"
                    value={draft.bsb}
                    onChange={(e) => set("bsb", e.target.value)}
                    placeholder="062-000"
                    className={cn(fieldCls, "font-mono")}
                  />
                </div>
                <div>
                  <Label className={labelCls} htmlFor="acc-ccy">
                    Currency
                  </Label>
                  <Input
                    id="acc-ccy"
                    value={draft.currency}
                    onChange={(e) => set("currency", e.target.value)}
                    placeholder="Firm default"
                    className={cn(fieldCls, "font-mono uppercase")}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Leave blank to use the firm currency.
                  </p>
                </div>
              </div>
            )}
          </Section>

          {/* ── notes ───────────────────────────────────────────────── */}
          <Section
            title="Notes"
            description="Anything worth remembering about this account."
            icon={Pencil}
          >
            <Label className={labelCls} htmlFor="acc-note">
              Note
            </Label>
            <Textarea
              id="acc-note"
              value={draft.note}
              onChange={(e) => set("note", e.target.value)}
              rows={3}
              placeholder="Purpose of this account, who reconciles it, anything unusual…"
              className="w-full rounded-lg text-sm"
            />
          </Section>
        </div>

        <DialogFooter className="gap-1.5 border-t border-border/60 bg-muted/20 px-6 py-3">
          {mode === "edit" && onDeleted && onOpenLedger && account && (
            <>
              {!account.isGroup && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenLedger(account._id)}
                  className="h-8 rounded-lg px-3 text-xs"
                >
                  <ScrollText className="size-3.5" /> Ledger
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => void remove()}
                disabled={busy}
                className="h-8 rounded-lg px-3 text-xs text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            </>
          )}
          <span className="flex-1" />
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="h-8 rounded-lg px-3 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void save()}
            disabled={!canSave}
            className="h-8 rounded-lg px-3 text-xs"
          >
            {mode === "create" ? "Create account" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The chain of headings above an account, outermost first. */
function pathFor(
  account: AccountRow,
  byId: Map<string, AccountRow>,
): string {
  const chain: string[] = [];
  let cursor =
    account.parentId === undefined ? undefined : byId.get(account.parentId);
  while (cursor !== undefined) {
    chain.unshift(`${cursor.code} ${cursor.name}`);
    cursor =
      cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
  }
  return chain.join("  ›  ");
}
