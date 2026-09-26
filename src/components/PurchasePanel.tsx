import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  CheckCircle2,
  Loader2,
  Plus,
  Receipt,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDueLabel } from "@/lib/task-utils";

type MaterialDoc = Doc<"rawMaterials">;
type PurchaseDoc = Doc<"purchases">;

/** One line being typed on the new bill. */
type DraftLine = { materialId: Id<"rawMaterials"> | ""; qty: string; unitCost: string };

const emptyLine = (): DraftLine => ({ materialId: "", qty: "1", unitCost: "" });

const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Purchase module: raise a bill to buy raw materials. Saving it adds each
 * line's quantity to that material's stock, which the Raw materials list shows
 * on every row.
 */
export default function PurchasePanel({
  materials,
  canCreate,
  canEdit,
  canDelete,
}: {
  materials: MaterialDoc[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const bills = useQuery(api.purchases.list);
  const createBill = useMutation(api.purchases.create);
  const setPaid = useMutation(api.purchases.setPaid);
  const removeBill = useMutation(api.purchases.remove);

  const [supplier, setSupplier] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);

  const materialOf = (id: Id<"rawMaterials"> | "") =>
    materials.find((m) => m._id === id);

  const total = useMemo(
    () =>
      lines.reduce(
        (sum, line) =>
          sum + (Number(line.qty) || 0) * (Number(line.unitCost) || 0),
        0,
      ),
    [lines],
  );

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = lines.filter(
      (line) => line.materialId !== "" && (Number(line.qty) || 0) > 0,
    );
    if (valid.length === 0) {
      toast.error("Pick a material and a quantity first.");
      return;
    }
    setBusy(true);
    try {
      await createBill({
        supplier: supplier.trim() || undefined,
        note: note.trim() || undefined,
        lines: valid.map((line) => ({
          materialId: line.materialId as Id<"rawMaterials">,
          qty: Number(line.qty),
          unitCost: Number(line.unitCost) || materialOf(line.materialId)?.pricePerUnit || 0,
        })),
      });
      setSupplier("");
      setNote("");
      setLines([emptyLine()]);
      toast.success("Bill saved — stock updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the bill.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-4">
      {/* ── New purchase bill ────────────────────────────────────────── */}
      <section className="rounded-2xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Receipt className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">New purchase bill</h2>
        </div>

        {materials.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Add raw materials first — then you can buy stock for them here.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Supplier
                </span>
                <Input
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  placeholder="e.g. Timber Hardware Co."
                  className="mt-1 h-9 rounded-lg text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  Note
                </span>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 h-9 rounded-lg text-sm"
                />
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="w-8 py-1" />
                    <th className="py-1 text-left font-medium">Material</th>
                    <th className="w-28 py-1 text-right font-medium">Qty</th>
                    <th className="w-32 py-1 text-right font-medium">Unit cost</th>
                    <th className="w-28 py-1 text-right font-medium">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const material = materialOf(line.materialId);
                    return (
                      <tr key={index} className="border-t border-border/60">
                        <td className="py-1.5" />
                        <td className="py-1.5 pr-2">
                          <select
                            value={line.materialId}
                            aria-label="Material"
                            onChange={(e) => {
                              const id = e.target.value as Id<"rawMaterials"> | "";
                              updateLine(index, {
                                materialId: id,
                                unitCost:
                                  line.unitCost ||
                                  String(materialOf(id)?.pricePerUnit ?? ""),
                              });
                            }}
                            className="h-9 w-full rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                          >
                            <option value="">Choose a material…</option>
                            {materials.map((m) => (
                              <option key={m._id} value={m._id}>
                                {m.code ? `${m.code} · ` : ""}
                                {m.name} ({m.unit})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={line.qty}
                            onChange={(e) => updateLine(index, { qty: e.target.value })}
                            aria-label="Quantity"
                            className="h-9 rounded-lg text-right text-sm tabular-nums"
                          />
                        </td>
                        <td className="py-1.5 pr-2">
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={line.unitCost}
                            placeholder={String(material?.pricePerUnit ?? 0)}
                            onChange={(e) => updateLine(index, { unitCost: e.target.value })}
                            aria-label="Unit cost"
                            className="h-9 rounded-lg text-right text-sm tabular-nums"
                          />
                        </td>
                        <td className="py-1.5 text-right text-sm tabular-nums text-muted-foreground">
                          {money((Number(line.qty) || 0) * (Number(line.unitCost) || 0))}
                        </td>
                        <td className="w-8 py-1.5 text-right">
                          {lines.length > 1 && (
                            <button
                              type="button"
                              aria-label="Remove line"
                              onClick={() =>
                                setLines((current) => current.filter((_, i) => i !== index))
                              }
                              className="grid size-6 place-items-center rounded text-muted-foreground hover:text-destructive"
                            >
                              <X className="size-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border">
                    <td colSpan={4} className="py-2 text-right text-xs text-muted-foreground">
                      Bill total
                    </td>
                    <td className="py-2 text-right text-sm font-semibold tabular-nums">
                      {money(total)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {canCreate && (
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((current) => [...current, emptyLine()])}
                  className="h-8 rounded-lg text-xs"
                >
                  <Plus className="size-3" /> Add line
                </Button>
                <Button
                  type="submit"
                  disabled={busy}
                  className="h-9 rounded-lg px-4 text-sm"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" />}
                  Save bill &amp; add to stock
                </Button>
              </div>
            )}
          </form>
        )}
      </section>

      {/* ── Bill history ─────────────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
          <h2 className="text-sm font-semibold">Purchase history</h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {bills?.length ?? 0} bill{(bills?.length ?? 0) === 1 ? "" : "s"}
          </span>
        </div>
        {bills === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading bills…
          </div>
        ) : bills.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No purchases yet — save a bill above and the stock updates instantly.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {bills.map((bill: PurchaseDoc) => (
              <li key={bill._id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{bill.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {bill.supplier || "No supplier"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDueLabel(bill.purchasedAt)}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{money(bill.total)}</span>
                  {canEdit && (
                    <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Checkbox
                        checked={bill.isPaid ?? false}
                        onCheckedChange={(checked) =>
                          void setPaid({ id: bill._id, paid: checked === true })
                        }
                        aria-label={`Mark bill ${bill.number} as paid`}
                        className="size-3.5 rounded-full border-2 border-border data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:text-white"
                      />
                      paid
                    </label>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      aria-label={`Delete bill ${bill.number}`}
                      title="Delete bill (stock is taken back out)"
                      onClick={() =>
                        void removeBill({ id: bill._id }).catch((error) =>
                          toast.error(
                            error instanceof Error ? error.message : "Couldn't delete the bill.",
                          ),
                        )
                      }
                      className="grid size-6 place-items-center rounded text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {bill.lines.map((line) => (
                    <li
                      key={line.materialId + line.name}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <CheckCircle2 className="size-3 shrink-0 text-emerald-500/70" />
                      <span className="min-w-0 flex-1 truncate">{line.name}</span>
                      <span className="tabular-nums">
                        +{line.qty} {line.unit}
                      </span>
                      <span className="w-24 text-right tabular-nums">
                        {money(line.qty * line.unitCost)}
                      </span>
                    </li>
                  ))}
                </ul>
                {bill.note && (
                  <p className="mt-1.5 text-xs text-muted-foreground">{bill.note}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
