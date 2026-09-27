import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { AccountRow } from "@/convex/accounting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Plus,
  Scale,
  ScrollText,
  Trash2,
} from "lucide-react";

export type EntryFormKind = "journal" | "receipt" | "payment" | "opening";

/** One editable side of the posting. */
type DraftLine = {
  key: number;
  accountId: Id<"accounts"> | "";
  debit: string;
  credit: string;
  memo: string;
};

const TITLE: Record<EntryFormKind, string> = {
  journal: "New journal entry",
  receipt: "Receipt — money received",
  payment: "Payment — money paid",
  opening: "Opening balances",
};

const BLURB: Record<EntryFormKind, string> = {
  journal: "A balanced posting. Every line is a debit or a credit, never both.",
  receipt: "Money in from a customer, against the account they owe on.",
  payment: "Money out to a supplier, against what you owe them.",
  opening: "What the books start from, dated to the day they start.",
};

const round2 = (n: number) => Math.round(n * 100) / 100;

const today = (() => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();

const readAmount = (raw: string): number => {
  const v = Number(raw.trim());
  return Number.isFinite(v) && v > 0 ? round2(v) : 0;
};

const blankLine = (key: number): DraftLine => ({
  key,
  accountId: "",
  debit: "",
  credit: "",
  memo: "",
});

const TYPE_CHIP: Record<string, string> = {
  asset: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  liability: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  equity: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  income: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  expense: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

/**
 * Raise one journal entry.
 *
 * The whole posting is on screen at once — date, memo, party and every debit
 * and credit line — so it can be read as a statement before it is saved. The
 * totals and the difference are always on screen, and the difference being
 * non-zero is stated plainly rather than being a failed save.
 */
export default function JournalEntryForm({
  kind,
  accounts,
  money,
  onClose,
  onPosted,
}: {
  kind: EntryFormKind;
  /** Posting accounts only — groups cannot be debited or credited. */
  accounts: AccountRow[];
  money: (n: number) => string;
  onClose: () => void;
  onPosted?: () => void;
}) {
  const post = useMutation(api.accounting.createEntry);
  const [at, setAt] = useState(today);
  const [memo, setMemo] = useState("");
  const [party, setParty] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine(1), blankLine(2)]);
  const [busy, setBusy] = useState(false);
  const [nextKey, setNextKey] = useState(3);

  const totals = lines.reduce(
    (acc, l) => ({
      debit: round2(acc.debit + readAmount(l.debit)),
      credit: round2(acc.credit + readAmount(l.credit)),
    }),
    { debit: 0, credit: 0 },
  );
  const difference = round2(totals.debit - totals.credit);
  const balanced = difference === 0;

  /** A line only counts once it names an account. */
  const usable = lines.filter(
    (l) => l.accountId !== "" && (readAmount(l.debit) > 0 || readAmount(l.credit) > 0),
  );
  const both = lines.filter(
    (l) => readAmount(l.debit) > 0 && readAmount(l.credit) > 0,
  );
  const canSave = balanced && usable.length >= 2 && both.length === 0 && !busy;

  const patch = (key: number, change: Partial<DraftLine>) =>
    setLines((rows) =>
      rows.map((l) => (l.key === key ? { ...l, ...change } : l)),
    );

  const addLine = () => {
    setLines((rows) => [...rows, blankLine(nextKey)]);
    setNextKey((k) => k + 1);
  };

  const removeLine = (key: number) =>
    setLines((rows) => (rows.length <= 2 ? rows : rows.filter((l) => l.key !== key)));

  const debitOf = (key: number) => lines.find((l) => l.key === key)?.debit ?? "";
  const creditOf = (key: number) => lines.find((l) => l.key === key)?.credit ?? "";

  /** Typing a debit clears the credit and vice versa — a line is one side. */
  const setDebit = (key: number, value: string) =>
    patch(key, { debit: value, credit: value.trim() === "" ? creditOf(key) : "" });
  const setCredit = (key: number, value: string) =>
    patch(key, { credit: value, debit: value.trim() === "" ? debitOf(key) : "" });

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      await post({
        at: new Date(`${at}T12:00:00`).getTime(),
        kind,
        memo: memo.trim() || undefined,
        party: party.trim() || undefined,
        lines: usable.map((l) => ({
          accountId: l.accountId as Id<"accounts">,
          debit: readAmount(l.debit),
          credit: readAmount(l.credit),
          memo: l.memo.trim() || undefined,
        })),
      });
      toast.success(`${TITLE[kind]} posted.`);
      onPosted?.();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.trim()
          ? error.message
          : "Couldn't post that entry.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-[min(100%,880px)]">
        {/* ── header ─────────────────────────────────────────────────── */}
        <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.08] via-transparent to-transparent px-6 pt-6 pb-5">
          <DialogHeader className="pr-8">
            <p className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
              Double-entry posting
            </p>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <ScrollText className="size-5 shrink-0 text-primary" />
              {TITLE[kind]}
            </DialogTitle>
            <DialogDescription className="text-xs">{BLURB[kind]}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="max-h-[62vh] overflow-y-auto px-6 py-4">
          {/* ── header fields ─────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-[180px_1fr_1fr]">
            <div>
              <Label className="mb-1.5 block text-[11px] font-semibold tracking-wide uppercase" htmlFor="je-date">
                Date
              </Label>
              <Input
                id="je-date"
                type="date"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                className="h-9 w-full rounded-lg text-sm"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-[11px] font-semibold tracking-wide uppercase" htmlFor="je-party">
                Party
              </Label>
              <Input
                id="je-party"
                value={party}
                onChange={(e) => setParty(e.target.value)}
                placeholder="Who is this with?"
                className="h-9 w-full rounded-lg text-sm"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-[11px] font-semibold tracking-wide uppercase" htmlFor="je-memo">
                Memo
              </Label>
              <Input
                id="je-memo"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="What is this for?"
                className="h-9 w-full rounded-lg text-sm"
              />
            </div>
          </div>

          {/* ── the lines ─────────────────────────────────────────────── */}
          <div className="mt-4">
            <div className="flex items-center gap-1.5">
              <BookOpen className="size-3.5 text-primary" />
              <h3 className="text-[11px] font-semibold tracking-wide uppercase">
                Debits and credits
              </h3>
            </div>

            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    <th className="py-2 pr-2">Account</th>
                    <th className="w-28 py-2 pr-2 text-right">Debit</th>
                    <th className="w-28 py-2 pr-2 text-right">Credit</th>
                    <th className="w-8 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {lines.map((l) => {
                    return (
                      <tr key={l.key} className="align-middle">
                        <td className="py-1.5 pr-2">
                          <select
                            value={l.accountId}
                            onChange={(e) =>
                              patch(l.key, {
                                accountId: e.target.value as Id<"accounts"> | "",
                              })
                            }
                            aria-label="Account for this line"
                            className="h-8 w-full rounded-lg border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            <option value="">— choose an account —</option>
                            {accounts.map((a) => (
                              <option key={a._id} value={a._id}>
                                {a.code} · {a.name}
                              </option>
                            ))}
                          </select>
                          {l.accountId !== "" && (
                            <span
                              className={cn(
                                "mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                TYPE_CHIP[
                                  accounts.find((a) => a._id === l.accountId)?.type ??
                                    "asset"
                                ],
                              )}
                            >
                              {
                                accounts.find((a) => a._id === l.accountId)
                                  ?.type ?? ""
                              }
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            value={l.debit}
                            onChange={(e) => setDebit(l.key, e.target.value)}
                            inputMode="decimal"
                            placeholder="0.00"
                            aria-label="Debit amount"
                            className={cn(
                              "h-8 w-full rounded-lg text-right text-xs tabular-nums",
                              readAmount(l.debit) > 0 &&
                                "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
                            )}
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            value={l.credit}
                            onChange={(e) => setCredit(l.key, e.target.value)}
                            inputMode="decimal"
                            placeholder="0.00"
                            aria-label="Credit amount"
                            className={cn(
                              "h-8 w-full rounded-lg text-right text-xs tabular-nums",
                              readAmount(l.credit) > 0 &&
                                "border-rose-500/40 text-rose-700 dark:text-rose-400",
                            )}
                          />
                        </td>
                        <td className="py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => removeLine(l.key)}
                            disabled={lines.length <= 2}
                            aria-label="Remove this line"
                            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:text-destructive disabled:opacity-30"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border/70 text-xs font-semibold">
                    <td className="py-2.5 pr-2 text-[10px] tracking-wider text-muted-foreground uppercase">
                      {lines.length} line{lines.length === 1 ? "" : "s"}
                    </td>
                    <td className="py-2.5 pr-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {money(totals.debit)}
                    </td>
                    <td className="py-2.5 pr-2 text-right tabular-nums text-rose-600 dark:text-rose-400">
                      {money(totals.credit)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={addLine}
              className="mt-2 h-8 gap-1.5 rounded-lg px-2.5 text-xs"
            >
              <Plus className="size-3.5" /> Add line
            </Button>
          </div>

          {/* ── the proof ────────────────────────────────────────────── */}
          <div
            className={cn(
              "mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3",
              balanced
                ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                : "border-amber-500/40 bg-amber-500/[0.07]",
            )}
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
              <Scale
                className={cn(
                  "size-3.5",
                  balanced
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400",
                )}
              />
              {balanced ? "Balanced" : "Out of balance"}
            </span>
            <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
              <ArrowDownLeft className="size-3 text-emerald-600 dark:text-emerald-400" />
              {money(totals.debit)} debits
            </span>
            <span className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
              <ArrowUpRight className="size-3 text-rose-600 dark:text-rose-400" />
              {money(totals.credit)} credits
            </span>
            <span
              className={cn(
                "ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                balanced
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300",
              )}
            >
              {balanced
                ? "ready to post"
                : `out by ${money(Math.abs(difference))}`}
            </span>
          </div>

          {both.length > 0 && (
            <p className="mt-2 text-[11px] text-destructive">
              A line carries a debit or a credit, never both — clear one side.
            </p>
          )}
        </div>

        <DialogFooter className="gap-1.5 border-t border-border/60 bg-muted/20 px-6 py-3">
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
            title={
              balanced
                ? usable.length < 2
                  ? "A posting needs at least two lines"
                  : "Post this entry"
                : "Debits and credits must come to the same total"
            }
            className="h-8 rounded-lg px-3 text-xs"
          >
            Post entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
