import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Loader2,
  Search,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAppDialogs } from "@/components/AppDialogs";
import { messageFrom } from "@/lib/errors";
import { productLockedReason } from "@/lib/project-statuses";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type FgDoc = Doc<"finishedGoods">;
type MaterialDoc = Doc<"rawMaterials">;

type Kind = "materials" | "products";

/** Why a row cannot go: a short chip and the sentence behind it. */
type Block = { label: string; note: string };

type Row = {
  id: string;
  name: string;
  meta: string;
  /** Documents still pointing at the record. Empty means it can be deleted. */
  blocked: Block[];
  /** Removed along with the record — a warning, not a block. */
  notes: string[];
};

/** What happened to one record when the list was run. */
type Outcome = { name: string; ok: boolean; message?: string };

/** Join the parts of a row's second line, skipping the blanks. */
function line(...parts: (string | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

/**
 * The production rules that make a product undeletable, named.
 *
 * The condition comes from the shared `productLockedReason` — the same rule
 * `removeFinishedGood` in convex/costing.ts enforces, so the card can never
 * offer a delete the server would refuse. This only gives the reason it found
 * a short label for the chip.
 */
function productBlock(fg: FgDoc): Block | null {
  const locked = productLockedReason(fg);
  if (locked === null) return null;
  const inProduction =
    fg.productionStartedAt !== undefined || (fg.inProduction ?? 0) > 0;
  return inProduction
    ? {
        label: "in production",
        note: "Production is running on this product, so the raw materials it is using are out of stock. Stop production — that puts them back — then delete the product.",
      }
    : {
        label: "finished",
        note: "It is finished, so its cost and landed stock are already on the books. It cannot be deleted.",
      };
}

/**
 * Delete master records, one at a time, from the settings danger zone.
 *
 * Clearing the books removes every transaction but keeps the master lists, so
 * the names left behind still have to be pruned by hand — one row at a time,
 * from the page that lists them. This card is the same job done in one place:
 * tick the records that should go and delete them individually.
 *
 * Nothing here decides what may be deleted. Each ticked record goes through
 * `costing.removeMaterial` / `costing.removeFinishedGood`, which re-check the
 * firm, the record and every document pointing at it, so a stale list, a
 * second window or a hand-crafted call cannot get past a rule. What this adds
 * is the report: the rows a document holds back are shown as blocked with the
 * reason, before anything is pressed, and a record refused mid-run is named
 * while the rest of the list still goes.
 */
export default function DeleteMasterRecordsCard() {
  const access = useQuery(api.settings.getMyAccess);
  // only the workspace owner ever sees this, and only they can run it, so the
  // lists are not even fetched for anyone else
  const isSuper = access?.isSuper === true;

  const materials = useQuery(api.costing.listMaterials, isSuper ? {} : "skip");
  const products = useQuery(
    api.costing.listFinishedGoods,
    isSuper ? {} : "skip",
  );
  const usage = useQuery(api.usage.masterUsage, isSuper ? {} : "skip");

  const removeMaterial = useMutation(api.costing.removeMaterial);
  const removeProduct = useMutation(api.costing.removeFinishedGood);
  const { confirm } = useAppDialogs();

  const [kind, setKind] = useState<Kind>("materials");
  const [search, setSearch] = useState("");
  /** Hide the records a document still holds back, leaving what can go. */
  const [canGoOnly, setCanGoOnly] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);

  const materialRows = useMemo<Row[]>(() => {
    const byId = new Map((usage?.materials ?? []).map((u) => [u.id, u]));
    return (materials ?? []).map((m: MaterialDoc) => {
      const used = byId.get(m._id);
      return {
        id: m._id,
        name: m.name,
        meta: line(m.code, m.category, m.subCategory, m.unit),
        blocked: (used?.reasons ?? []).map((reason) => ({
          label: reason,
          note: `It is ${reason}. Remove it from those documents first, then delete the material.`,
        })),
        notes: used?.notes ?? [],
      };
    });
  }, [materials, usage]);

  const productRows = useMemo<Row[]>(() => {
    const byId = new Map((usage?.products ?? []).map((u) => [u.id, u]));
    return (products ?? []).map((fg: FgDoc) => {
      const used = byId.get(fg._id);
      const lock = productBlock(fg);
      return {
        id: fg._id,
        name: fg.name,
        meta: line(fg.code, fg.category, fg.unit),
        blocked: [
          ...(lock === null ? [] : [lock]),
          ...(used?.reasons ?? []).map((reason) => ({
            label: reason,
            note: `It is ${reason}. Remove it from those documents first, then delete the product.`,
          })),
        ],
        notes: used?.notes ?? [],
      };
    });
  }, [products, usage]);

  const all = kind === "materials" ? materialRows : productRows;
  const loading = kind === "materials" ? materials === undefined : products === undefined;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((row) => {
      if (canGoOnly && row.blocked.length > 0) return false;
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.meta.toLowerCase().includes(q)
      );
    });
  }, [all, canGoOnly, search]);

  const ready = rows.filter((row) => row.blocked.length === 0);
  const chosen = rows.filter(
    (row) => selected.has(row.id) && row.blocked.length === 0,
  );
  // the count in the header is the whole master data, both lists together —
  // the footer's is the list on screen, so each one says what it is counting
  const readyTotal =
    materialRows.filter((row) => row.blocked.length === 0).length +
    productRows.filter((row) => row.blocked.length === 0).length;
  const allTotal = materialRows.length + productRows.length;

  if (!isSuper) return null;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const switchKind = (next: Kind) => {
    // a tick means "delete this", so it does not travel between the two lists
    setKind(next);
    setSelected(new Set());
    setResults(null);
  };

  const noun = kind === "materials" ? "material" : "product";
  const plural = kind === "materials" ? "raw materials" : "products";

  const run = async () => {
    if (chosen.length === 0) return;
    const names = chosen.map((row) => row.name);
    const head = names.slice(0, 6).join(", ");
    const rest =
      names.length > 6 ? ` and ${names.length - 6} more` : "";
    const one = chosen.length === 1;
    const ok = await confirm({
      title: `Delete ${chosen.length} ${one ? noun : plural}?`,
      message: `${head}${rest} will be permanently removed, together with anything that belongs to ${one ? "it" : "them"} — costing lines, stock on hand and the movement ledger. A record a document still points at is refused and left alone. This cannot be undone.`,
      confirmLabel: one ? `Delete ${noun}` : `Delete ${chosen.length}`,
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    setResults(null);
    const outcomes: Outcome[] = [];
    // one call per record, so a record that has been used since this list was
    // drawn is refused on its own and the rest of the ticked rows still go
    for (const row of chosen) {
      try {
        if (kind === "materials") {
          await removeMaterial({ id: row.id as Id<"rawMaterials"> });
        } else {
          await removeProduct({ id: row.id as Id<"finishedGoods"> });
        }
        outcomes.push({ name: row.name, ok: true });
      } catch (error) {
        outcomes.push({
          name: row.name,
          ok: false,
          // the sentence the server refused with, not the request id and stack
          // Convex wraps around it
          message: messageFrom(error, `Couldn't delete the ${noun}.`),
        });
      }
    }
    setResults(outcomes);
    setSelected(new Set());
    setBusy(false);

    const gone = outcomes.filter((o) => o.ok).length;
    const refused = outcomes.length - gone;
    if (gone > 0) {
      toast.success(
        `${gone} ${gone === 1 ? noun : plural} deleted${refused > 0 ? `, ${refused} refused — see the list below` : ""}.`,
      );
    }
    if (gone === 0 && refused > 0) {
      toast.error(
        `Nothing was deleted — all ${refused} ${refused === 1 ? "is" : "are"} still in use.`,
      );
    }
  };

  const gone = results?.filter((o) => o.ok).length ?? 0;
  const refused = results === null ? 0 : results.length - gone;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-destructive/30 bg-destructive/[0.03]">
      <header className="flex flex-wrap items-center gap-2 border-b border-destructive/20 px-5 py-3.5">
        <ShieldAlert className="size-4 text-destructive" />
        <h3 className="text-sm font-semibold">Delete master records</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          Super user only · {readyTotal} of {allTotal} can go
        </span>
      </header>

      <div className="space-y-3 px-5 py-4">
        <p className="max-w-prose text-xs text-muted-foreground">
          Tick the raw materials and products you want gone and delete them one
          by one. Every rule that protects the books still applies: a material
          held by a recipe or a purchase bill, and a product under a project, in
          production or finished, is refused and shows why. Whatever belongs to a
          record — its stock on hand and its movement ledger — is removed with
          it.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {/* one list at a time: a tick is "delete this", so switching lists
              starts from an empty selection */}
          <div className="inline-flex overflow-hidden rounded-lg border">
            {(
              [
                ["materials", `Raw materials (${materialRows.length})`],
                ["products", `Products (${productRows.length})`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => switchKind(value)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium transition-colors",
                  kind === value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${plural}…`}
              className="h-8 w-56 pl-8 text-xs"
              spellCheck={false}
            />
          </label>

          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
            <Checkbox
              checked={canGoOnly}
              onCheckedChange={(value) => setCanGoOnly(value === true)}
            />
            Only the ones that can go
          </label>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> Reading the master lists…
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            {all.length === 0
              ? `There are no ${plural} to delete.`
              : `Nothing matches “${search}”${canGoOnly ? " that can go" : ""}.`}
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {rows.map((row) => {
              const blocked = row.blocked.length > 0;
              return (
                <li
                  key={row.id}
                  className={cn(
                    "flex items-start gap-2.5 rounded-lg border px-2.5 py-2",
                    blocked
                      ? "border-border/60 bg-muted/30"
                      : "border-border/40 bg-card/70",
                  )}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(row.id)}
                    disabled={blocked || busy}
                    onCheckedChange={() => toggle(row.id)}
                    aria-label={`Select ${row.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-xs font-medium",
                        blocked && "text-muted-foreground",
                      )}
                    >
                      {row.name}
                    </p>
                    {row.meta.length > 0 && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {row.meta}
                      </p>
                    )}
                    {blocked && (
                      <p className="mt-0.5 flex flex-wrap items-start gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                        <Ban className="mt-0.5 size-3 shrink-0" />
                        <span>{row.blocked.map((b) => b.label).join(" · ")}</span>
                      </p>
                    )}
                    {row.notes.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {/* on a blocked row nothing is going anywhere yet, so
                            its ledger is named rather than promised */}
                        {blocked
                          ? `Also tied to it: ${row.notes.join(", ")}`
                          : `Deleted with it: ${row.notes.join(", ")}`}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">
            {selected.size} selected · {ready.length} of {rows.length} shown can
            go
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || ready.length === 0}
              onClick={() =>
                setSelected(new Set(ready.map((row) => row.id)))
              }
            >
              Select all that can go
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || selected.size === 0}
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || chosen.length === 0}
              onClick={() => void run()}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              {busy
                ? "Deleting…"
                : chosen.length === 0
                  ? "Delete selected"
                  : `Delete ${chosen.length}`}
            </Button>
          </div>
        </div>

        {results !== null && (
          <div className="rounded-xl border bg-card/60 px-3.5 py-3">
            <p className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              Last run — {gone} deleted
              {refused > 0 ? `, ${refused} refused` : ""}
            </p>
            <ul className="mt-1.5 space-y-1">
              {results.map((outcome) => (
                <li
                  key={outcome.name}
                  className="flex items-start gap-1.5 text-xs"
                >
                  {outcome.ok ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                  )}
                  <span
                    className={cn("min-w-0", !outcome.ok && "text-muted-foreground")}
                  >
                    <span className="font-medium">{outcome.name}</span>
                    {outcome.ok ? " — deleted" : ` — ${outcome.message}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
