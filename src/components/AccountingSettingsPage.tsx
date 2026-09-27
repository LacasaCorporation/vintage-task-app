import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AccountRow } from "@/convex/accounting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import AccountFormDialog from "@/components/AccountFormDialog";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Coins,
  Eye,
  Landmark,
  Layers,
  Loader2,
  Lock,
  Percent,
  Plus,
  RotateCcw,
  Save,
  Scale,
  Search,
  Store,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

type AccountId = Id<"accounts">;

/** The seven jobs a posting asks the chart to fill. */
const FIELDS = [
  {
    key: "cashAccountId",
    label: "Cash in hand",
    icon: Wallet,
    hint: "What a cash expense or receipt comes out of and goes into",
    type: "asset",
  },
  {
    key: "bankAccountId",
    label: "Bank",
    icon: Landmark,
    hint: "Used for round-ups and for anything paid by transfer",
    type: "asset",
  },
  {
    key: "receivableAccountId",
    label: "Accounts receivable",
    icon: TrendingUp,
    hint: "Debited when a customer is invoiced",
    type: "asset",
  },
  {
    key: "payableAccountId",
    label: "Accounts payable",
    icon: TrendingDown,
    hint: "Credited when a supplier bill is recorded",
    type: "liability",
  },
  {
    key: "salesAccountId",
    label: "Sales revenue",
    icon: Coins,
    hint: "Credited with the net value of every invoice",
    type: "income",
  },
  {
    key: "purchaseAccountId",
    label: "Purchases / cost of goods",
    icon: Store,
    hint: "Debited with the net value of every supplier bill",
    type: "expense",
  },
  {
    key: "taxAccountId",
    label: "GST / tax payable",
    icon: Scale,
    hint: "Holds the tax on invoices and bills",
    type: "liability",
  },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

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

/** One tile in the summary strip. */
function Stat({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub: string;
  tone?: "warn" | "good";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5",
        tone === "warn" && "border-amber-500/40 bg-amber-500/[0.07]",
        tone === "good" && "border-emerald-500/30 bg-emerald-500/[0.06]",
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
        <Icon
          className={cn(
            "size-3",
            tone === "warn" && "text-amber-600 dark:text-amber-400",
            tone === "good" && "text-emerald-600 dark:text-emerald-400",
          )}
        />
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-lg leading-none font-bold tabular-nums",
          tone === "warn" && "text-amber-700 dark:text-amber-300",
          tone === "good" && "text-emerald-700 dark:text-emerald-300",
        )}
      >
        {value}
      </p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

/** How deep an account sits, so the chart browser nests like the real chart. */
function depthOf(
  account: { parentId?: Id<"accounts"> },
  byId: Map<string, AccountRow>,
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

/**
 * Everything about where the books post.
 *
 * Two halves that feed each other. The posting defaults say which account each
 * automated document touches; the chart below is the whole ledger, so a new
 * account can be created here and immediately made the default for a job
 * without a round trip to the Accounts page.
 */
export default function AccountingSettingsPage({ canEdit }: { canEdit: boolean }) {
  const { format: money } = useWorkspaceCurrency();
  const data = useQuery(api.settings.getAccountingDefaults);
  const save = useMutation(api.settings.setAccountingDefaults);
  const chart = useQuery(api.accounting.listAccounts);

  const [draft, setDraft] = useState<Partial<Record<FieldKey, AccountId | null>>>({});
  const [taxPct, setTaxPct] = useState("0");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncedFor, setSyncedFor] = useState<unknown>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  // adopt whatever is saved until the user starts editing, then re-sync when
  // the server value genuinely changes
  if (data !== undefined && data !== null && data !== syncedFor) {
    setSyncedFor(data);
    setDraft({
      cashAccountId: data.ids.cashAccountId ?? null,
      bankAccountId: data.ids.bankAccountId ?? null,
      receivableAccountId: data.ids.receivableAccountId ?? null,
      payableAccountId: data.ids.payableAccountId ?? null,
      salesAccountId: data.ids.salesAccountId ?? null,
      purchaseAccountId: data.ids.purchaseAccountId ?? null,
      taxAccountId: data.ids.taxAccountId ?? null,
    });
    setTaxPct(String(data.taxPct));
    setDirty(false);
  }

  const isStale = (key: FieldKey) => data?.stale[key] === true;

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        ...draft,
        taxPct: Number.isFinite(Number(taxPct)) ? Math.max(0, Number(taxPct)) : 0,
      });
      setDirty(false);
      toast.success("Accounting defaults saved.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the defaults.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (data === undefined) {
    return (
      <section
        id="settings-accounting"
        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading the chart…
        </div>
      </section>
    );
  }
  if (data === null) return null;

  const accounts = data.accounts;
  const posting = (chart ?? []).filter((a) => !a.isGroup);
  const groups = (chart ?? []).filter((a) => a.isGroup);
  const bankCount = (chart ?? []).filter((a) => a.isBank).length;
  const staleCount = FIELDS.filter((f) => isStale(f.key)).length;
  const byId = new Map((chart ?? []).map((a) => [a._id as string, a]));

  /** Which posting job an account is currently the default for. */
  const roleOf = (id: Id<"accounts">): FieldKey | null =>
    (FIELDS.find((f) => (draft[f.key] ?? null) === id)?.key ?? null);

  const term = search.trim().toLowerCase();
  const visible = (chart ?? []).filter(
    (a) =>
      term === "" ||
      `${a.code} ${a.name}`.toLowerCase().includes(term),
  );

  return (
    <section
      id="settings-accounting"
      className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      {/* ── header ─────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-3 border-b bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Scale className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Accounting defaults</h2>
          <p className="text-xs text-muted-foreground">
            Where every bill, invoice, receipt and payment posts
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {canEdit ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setCreating(true)}
                className="h-7 gap-1.5 rounded-lg px-2 text-xs"
              >
                <Plus className="size-3.5" /> New account
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave()}
                disabled={!dirty || saving}
                className="h-7 gap-1.5 rounded-lg px-2.5 text-xs"
              >
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save
              </Button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <Eye className="size-3" /> View only
            </span>
          )}
        </div>
      </header>

      <div className="space-y-5 px-5 py-4">
        {!canEdit && (
          <p className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="size-3.5 shrink-0" />
            You can read this page, but changing the defaults needs an admin.
            Everything here stays as it was left until then.
          </p>
        )}
        {accounts.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            Your chart of accounts is empty. Create the standard chart from
            Accounts, or add your first account here with{" "}
            <span className="font-medium text-foreground">New account</span>.
          </p>
        ) : (
          <>
            {/* ── summary ───────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Stat
                icon={BookOpen}
                label="Posting accounts"
                value={String(posting.length)}
                sub="can hold a balance"
              />
              <Stat
                icon={Layers}
                label="Groups"
                value={String(groups.length)}
                sub="headings in the chart"
              />
              <Stat
                icon={Landmark}
                label="Bank accounts"
                value={String(bankCount)}
                sub={bankCount === 0 ? "none set up yet" : "carry bank details"}
              />
              <Stat
                icon={AlertTriangle}
                label="Needs attention"
                value={String(staleCount)}
                sub={staleCount === 0 ? "every default resolves" : "defaults point at missing accounts"}
                tone={staleCount === 0 ? "good" : "warn"}
              />
            </div>

            {staleCount > 0 && (
              <p className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="size-3.5 shrink-0" />
                {staleCount} saved{" "}
                {staleCount === 1 ? "account no" : "accounts no"} longer exist.
                Until they are re-picked, those postings fall back to the standard
                code for the job.
              </p>
            )}

            {/* ── posting defaults ──────────────────────────────────── */}
            <div>
              <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
                <ArrowRight className="size-3.5 text-primary" />
                Posting defaults
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Each automated document resolves the account it touches through
                these. Leave one on Standard to use the usual code for that job.
              </p>

              <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border">
                {FIELDS.map(({ key, label, icon: Icon, hint, type }) => {
                  const stale = isStale(key);
                  const chosen = draft[key] ?? null;
                  const chosenAccount =
                    chosen === null ? undefined : byId.get(chosen);
                  const options = posting.filter((a) => a.type === type);
                  return (
                    <li
                      key={key}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-card px-3 py-2.5"
                    >
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-sm font-medium">
                            {label}
                            {stale && (
                              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                missing
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-[10px] text-muted-foreground/85">
                            {hint}
                          </span>
                        </span>
                      </span>

                      <select
                        value={chosen ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => {
                          setDraft((d) => ({
                            ...d,
                            [key]:
                              e.target.value === ""
                                ? null
                                : (e.target.value as AccountId),
                          }));
                          setDirty(true);
                        }}
                        aria-label={`Default account for ${label}`}
                        className={cn(
                          "h-8 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60 sm:w-56",
                          stale && "border-amber-500/50",
                        )}
                      >
                        <option value="">Standard (by code)</option>
                        {options.map((a) => (
                          <option key={a._id} value={a._id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </select>

                      {chosen !== null && (
                        <button
                          type="button"
                          disabled={!canEdit}
                          onClick={() => {
                            setDraft((d) => ({ ...d, [key]: null }));
                            setDirty(true);
                          }}
                          title="Go back to the standard code for this job"
                          aria-label={`Reset ${label} to standard`}
                          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      )}
                      {chosenAccount !== undefined && chosenAccount._id !== chosen ? (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400">
                          saved account is gone
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* ── the chart ─────────────────────────────────────────── */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase">
                  <BookOpen className="size-3.5 text-primary" />
                  Chart of accounts
                </h3>
                <span className="text-[11px] text-muted-foreground">
                  Create an account here, or make an existing one the default
                  for a job.
                </span>
                <div className="relative ml-auto w-full sm:w-56">
                  <Search className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground/60" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search the chart…"
                    aria-label="Search the chart of accounts"
                    className="h-8 w-full pl-7 text-xs"
                  />
                </div>
              </div>

              {visible.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                  Nothing matches “{search}”.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-xl border">
                  {visible.map((a) => {
                    const role = roleOf(a._id);
                    return (
                      <li
                        key={a._id}
                        className={cn(
                          "flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2",
                          a.isGroup && "bg-muted/25",
                        )}
                      >
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {a.code}
                        </span>
                        <span
                          className="min-w-0 flex-1 text-sm"
                          style={{
                            paddingLeft: depthOf(a, byId) * 14,
                          }}
                        >
                          <span
                            className={cn(
                              "inline-flex flex-wrap items-center gap-1.5",
                              a.isGroup ? "font-semibold" : "font-medium",
                            )}
                          >
                            {a.name}
                            {a.isBank && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                <Landmark className="size-2.5" /> Bank
                              </span>
                            )}
                            {role !== null && (
                              <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                                default ·{" "}
                                {FIELDS.find((f) => f.key === role)?.label}
                              </span>
                            )}
                          </span>
                          {a.bankName !== undefined && (
                            <span className="block truncate text-[10px] text-muted-foreground">
                              {[a.bankName, a.accountNumber, a.bsb]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </span>

                        {!a.isGroup && (
                          <>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                TYPE_CHIP[a.type],
                              )}
                            >
                              {TYPE_LABEL[a.type]}
                            </span>
                            <span className="w-24 shrink-0 text-right text-xs tabular-nums">
                              {a.debit === 0 && a.credit === 0
                                ? "—"
                                : money(
                                    a.type === "income" ||
                                      a.type === "liability" ||
                                      a.type === "equity"
                                      ? a.signed
                                      : -a.signed,
                                  )}
                            </span>
                            <select
                              value=""
                              disabled={!canEdit}
                              onChange={(e) => {
                                const field = e.target
                                  .value as FieldKey;
                                if (!FIELDS.some((f) => f.key === field)) return;
                                setDraft((d) => ({ ...d, [field]: a._id }));
                                setDirty(true);
                                e.target.value = "";
                              }}
                              aria-label={`Make ${a.name} the default for a job`}
                              className="h-7 w-40 shrink-0 rounded-lg border bg-background px-1.5 text-[11px] outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                            >
                              <option value="">Put as default…</option>
                              {FIELDS.filter((f) => f.type === a.type).map(
                                (f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label}
                                  </option>
                                ),
                              )}
                            </select>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {/* ── default tax rate ─────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Percent className="size-3" />
              Default tax rate
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">
              Offered on every new bill and invoice. Each document can still be
              set differently, and the rate it was saved with is the one that
              posts.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min="0"
              step="any"
              value={taxPct}
              disabled={!canEdit}
              onChange={(e) => {
                setTaxPct(e.target.value);
                setDirty(true);
              }}
              aria-label="Default tax rate"
              className="h-8 w-20 rounded-lg text-right text-xs tabular-nums"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
      </div>

      {/* ── create an account without leaving settings ──────────────── */}
      {creating && (
        <AccountFormDialog
          mode="create"
          accounts={chart ?? []}
          money={money}
          onClose={() => setCreating(false)}
          onSaved={() => setCreating(false)}
        />
      )}
    </section>
  );
}
