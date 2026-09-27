import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Coins,
  Landmark,
  Loader2,
  Percent,
  Save,
  Scale,
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
  },
  {
    key: "bankAccountId",
    label: "Bank",
    icon: Landmark,
    hint: "Used for round-ups and for anything paid by transfer",
  },
  {
    key: "receivableAccountId",
    label: "Accounts receivable",
    icon: TrendingUp,
    hint: "Debited when a customer is invoiced",
  },
  {
    key: "payableAccountId",
    label: "Accounts payable",
    icon: TrendingDown,
    hint: "Credited when a supplier bill is recorded",
  },
  {
    key: "salesAccountId",
    label: "Sales revenue",
    icon: Coins,
    hint: "Credited with the net value of every invoice",
  },
  {
    key: "purchaseAccountId",
    label: "Purchases / cost of goods",
    icon: Store,
    hint: "Debited with the net value of every supplier bill",
  },
  {
    key: "taxAccountId",
    label: "GST / tax payable",
    icon: Scale,
    hint: "Holds the tax on invoices and bills",
  },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

/**
 * Where the automatic postings point.
 *
 * Every document — a bill, an invoice, a receipt, a payment, an expense —
 * resolves the account it touches through these. Leaving one on "Standard"
 * uses the usual code for that job, so a firm that never opens this screen
 * still posts correctly.
 */
export default function AccountingDefaultsCard({ canEdit }: { canEdit: boolean }) {
  const data = useQuery(api.settings.getAccountingDefaults);
  const save = useMutation(api.settings.setAccountingDefaults);

  const [draft, setDraft] = useState<Partial<Record<FieldKey, AccountId | null>>>({});
  const [taxPct, setTaxPct] = useState("0");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncedFor, setSyncedFor] = useState<unknown>(null);

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
      toast.error(error instanceof Error ? error.message : "Couldn't save the defaults.");
    } finally {
      setSaving(false);
    }
  };

  if (data === undefined) {
    return (
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading the chart…
        </div>
      </section>
    );
  }
  if (data === null) return null;

  const accounts = data.accounts;
  const staleCount = FIELDS.filter((f) => isStale(f.key)).length;

  return (
    <section
      id="settings-accounting"
      className="scroll-mt-6 overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
      <header className="flex flex-wrap items-center gap-2 border-b px-5 py-3.5">
        <Scale className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Accounting defaults</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          Where every bill, invoice, receipt and payment posts
        </span>
      </header>

      <div className="space-y-4 px-5 py-4">
        {accounts.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
            Your chart of accounts is empty. Open Accounts once to create the standard
            chart, then come back to point these at the accounts you want.
          </p>
        ) : (
          <>
            {staleCount > 0 && (
              <p className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="size-3.5 shrink-0" />
                {staleCount} saved {staleCount === 1 ? "account no" : "accounts no"} longer
                exist. Until they are re-picked, those postings fall back to the standard
                code for the job.
              </p>
            )}

            <div className="grid gap-2.5 sm:grid-cols-2">
              {FIELDS.map(({ key, label, icon: Icon, hint }) => {
                const stale = isStale(key);
                return (
                  <label key={key} className="block space-y-1">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                      <Icon className="size-3" />
                      {label}
                      {stale && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                          missing
                        </span>
                      )}
                    </span>
                    <select
                      value={draft[key] ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => {
                        setDraft((d) => ({
                          ...d,
                          [key]: e.target.value === "" ? null : (e.target.value as AccountId),
                        }));
                        setDirty(true);
                      }}
                      aria-label={label}
                      className={cn(
                        "h-8 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60",
                        stale && "border-amber-500/50",
                      )}
                    >
                      <option value="">Standard (by code)</option>
                      {accounts.map((a) => (
                        <option key={a._id} value={a._id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </select>
                    <span className="block text-[10px] leading-tight text-muted-foreground/80">
                      {hint}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {/* ── default tax rate ───────────────────────────────────────── */}
        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <Percent className="size-3" />
              Default tax rate
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/80">
              Offered on every new bill and invoice. Each document can still be set
              differently, and the rate it was saved with is the one that posts.
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

        {canEdit && (
          <div className="flex items-center justify-end gap-2 border-t pt-4">
            {dirty && (
              <span className="mr-auto text-[11px] text-amber-600 dark:text-amber-400">
                Unsaved changes
              </span>
            )}
            <Button
              type="button"
              size="sm"
              disabled={saving || !dirty}
              onClick={() => void handleSave()}
              className="h-8 rounded-lg px-3 text-xs"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save defaults
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
