import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  FileText,
  List,
  Loader2,
  Plus,
  Receipt,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDueLabel, toLocalInput } from "@/lib/task-utils";

type MaterialDoc = Doc<"rawMaterials">;
type PurchaseDoc = Doc<"purchases">;

/** One line being typed on the new bill. */
type DraftLine = { materialId: Id<"rawMaterials"> | ""; qty: string; rate: string };

const emptyLine = (): DraftLine => ({ materialId: "", qty: "1", rate: "" });
const todayInput = () => toLocalInput(new Date());

const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Purchase module. The list of purchase bills is the default screen, with an
 * "Add bill" button that opens the bill entry form; saving a bill adds every
 * line's quantity to that material's stock.
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

  const [tab, setTab] = useState<"list" | "bill">("list");
  const [supplier, setSupplier] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(todayInput);
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);

  const materialOf = (id: Id<"rawMaterials"> | "") => materials.find((m) => m._id === id);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + num(l.qty) * num(l.rate), 0),
    [lines],
  );
  const discountAmount = (subtotal * num(discount)) / 100;
  const taxable = subtotal - discountAmount;
  const taxAmount = (taxable * num(tax)) / 100;
  const grandTotal = taxable + taxAmount;

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const resetForm = () => {
    setSupplier("");
    setSupplierAddress("");
    setPurchasedOn(todayInput());
    setNote("");
    setDiscount("0");
    setTax("0");
    setLines([emptyLine()]);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = lines.filter((l) => l.materialId !== "" && num(l.qty) > 0);
    if (valid.length === 0) {
      toast.error("Pick a material and a quantity first.");
      return;
    }
    setBusy(true);
    try {
      await createBill({
        supplier: supplier.trim() || undefined,
        supplierAddress: supplierAddress.trim() || undefined,
        purchasedAt: purchasedOn ? new Date(purchasedOn).getTime() : undefined,
        note: note.trim() || undefined,
        discountPct: num(discount) || undefined,
        taxPct: num(tax) || undefined,
        lines: valid.map((l) => ({
          materialId: l.materialId as Id<"rawMaterials">,
          qty: num(l.qty),
          unitCost: num(l.rate) || materialOf(l.materialId)?.pricePerUnit || 0,
        })),
      });
      resetForm();
      setTab("list");
      toast.success("Bill saved — stock updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the bill.");
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (id: "list" | "bill", label: string, Icon: typeof List) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
        tab === id
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" /> {label}
    </button>
  );

  return (
    <div className="mt-4 space-y-4">
      {/* ── Header: list first, then the billing option ─────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
          {tabBtn("list", `Purchase list (${bills?.length ?? 0})`, List)}
          {tabBtn("bill", "Bill entry", FileText)}
        </div>
        {canCreate && (
          <Button
            type="button"
            size="sm"
            onClick={() => setTab("bill")}
            className="h-9 rounded-xl px-3 text-sm"
          >
            <Plus className="size-4" /> Add bill
          </Button>
        )}
      </div>

      {materials.length === 0 && (
        <p className="rounded-xl border border-dashed bg-card px-4 py-3 text-center text-sm text-muted-foreground">
          Add raw materials first — then you can buy stock for them here.
        </p>
      )}

      {/* ── Purchase list ───────────────────────────────────────────── */}
      {tab === "list" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5">
            <h2 className="text-sm font-semibold">Purchase list</h2>
            <span className="text-xs text-muted-foreground tabular-nums">
              {money((bills ?? []).reduce((sum, b) => sum + b.total, 0))} total
            </span>
          </div>
          {bills === undefined ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading purchases…
            </div>
          ) : bills.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Receipt className="mx-auto size-7 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium">No purchases yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use “Add bill” to record your first purchase — stock updates instantly.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="px-4 py-2 text-left font-medium">Bill</th>
                    <th className="px-3 py-2 text-left font-medium">Supplier</th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-right font-medium">Items</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                    <th className="px-3 py-2 text-center font-medium">Paid</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {bills.map((bill: PurchaseDoc) => (
                    <tr key={bill._id} className="transition-colors hover:bg-accent/40">
                      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {bill.number}
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="truncate font-medium">{bill.supplier || "No supplier"}</p>
                        {bill.supplierAddress && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {bill.supplierAddress}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                        {formatDueLabel(bill.purchasedAt)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                        {bill.lines.length} line{bill.lines.length === 1 ? "" : "s"}
                        <p className="text-[11px] text-muted-foreground">
                          {bill.lines.map((l) => l.name).slice(0, 2).join(", ")}
                          {bill.lines.length > 2 ? "…" : ""}
                        </p>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                        {money(bill.total)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Checkbox
                          checked={bill.isPaid ?? false}
                          disabled={!canEdit}
                          onCheckedChange={(checked) =>
                            void setPaid({ id: bill._id, paid: checked === true })
                          }
                          aria-label={`Mark bill ${bill.number} as paid`}
                          className="mx-auto size-4 rounded-full border-2 border-border data-[state=checked]:border-emerald-500 data-[state=checked]:bg-emerald-500 data-[state=checked]:text-white"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        {canDelete && (
                          <button
                            type="button"
                            aria-label={`Delete bill ${bill.number}`}
                            title="Delete bill (stock is taken back out)"
                            onClick={() =>
                              void removeBill({ id: bill._id }).catch((error) =>
                                toast.error(
                                  error instanceof Error
                                    ? error.message
                                    : "Couldn't delete the bill.",
                                ),
                              )
                            }
                            className="grid size-6 place-items-center rounded text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ── Professional bill entry form ────────────────────────────── */}
      {tab === "bill" && (
        <form
          onSubmit={submit}
          className="overflow-hidden rounded-2xl border bg-card shadow-sm"
        >
          {/* letterhead */}
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-semibold">Purchase Bill</h2>
              <p className="text-xs text-muted-foreground">
                Buying raw materials · stock updates on save
              </p>
            </div>
            <div className="text-right text-xs">
              <p className="font-mono text-sm font-semibold">Auto PUR0001…</p>
              <p className="text-muted-foreground">Date {formatDueLabel(Date.now())}</p>
            </div>
          </div>

          {/* supplier + dates */}
          <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Supplier
              </p>
              <Input
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                placeholder="Supplier / vendor name"
                className="h-9 rounded-lg text-sm"
              />
              <Textarea
                value={supplierAddress}
                onChange={(e) => setSupplierAddress(e.target.value)}
                placeholder="Address, contact, phone…"
                rows={2}
                className="rounded-lg text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  Bill date
                </span>
                <Input
                  type="date"
                  value={purchasedOn}
                  onChange={(e) => setPurchasedOn(e.target.value)}
                  className="mt-1 h-9 rounded-lg text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  Reference
                </span>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Their invoice no."
                  className="mt-1 h-9 rounded-lg text-sm"
                />
              </label>
            </div>
          </div>

          {/* line items */}
          <div className="overflow-x-auto px-5 py-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] tracking-wide text-muted-foreground uppercase">
                  <th className="w-8 py-1.5 text-left font-medium">#</th>
                  <th className="py-1.5 text-left font-medium">Material</th>
                  <th className="w-24 py-1.5 text-right font-medium">Qty</th>
                  <th className="w-20 py-1.5 text-right font-medium">Unit</th>
                  <th className="w-32 py-1.5 text-right font-medium">Rate</th>
                  <th className="w-32 py-1.5 text-right font-medium">Amount</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => {
                  const material = materialOf(line.materialId);
                  return (
                    <tr key={index} className="border-b border-border/50">
                      <td className="py-2 text-xs text-muted-foreground tabular-nums">
                        {index + 1}
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={line.materialId}
                          aria-label="Material"
                          disabled={!canCreate}
                          onChange={(e) => {
                            const id = e.target.value as Id<"rawMaterials"> | "";
                            updateLine(index, {
                              materialId: id,
                              rate: line.rate || String(materialOf(id)?.pricePerUnit ?? ""),
                            });
                          }}
                          className="h-9 w-full rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
                        >
                          <option value="">Choose a material…</option>
                          {materials.map((m) => (
                            <option key={m._id} value={m._id}>
                              {m.code ? `${m.code} · ` : ""}
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={line.qty}
                          disabled={!canCreate}
                          onChange={(e) => updateLine(index, { qty: e.target.value })}
                          aria-label="Quantity"
                          className="h-9 rounded-lg text-right text-sm tabular-nums"
                        />
                      </td>
                      <td className="py-2 pr-2 text-right text-xs text-muted-foreground">
                        {material?.unit ?? "—"}
                      </td>
                      <td className="py-2 pr-2">
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={line.rate}
                          placeholder={String(material?.pricePerUnit ?? 0)}
                          disabled={!canCreate}
                          onChange={(e) => updateLine(index, { rate: e.target.value })}
                          aria-label="Rate"
                          className="h-9 rounded-lg text-right text-sm tabular-nums"
                        />
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {money(num(line.qty) * num(line.rate))}
                      </td>
                      <td className="py-2 text-right">
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
            </table>
            {canCreate && (
              <button
                type="button"
                onClick={() => setLines((current) => [...current, emptyLine()])}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Plus className="size-3" /> Add line item
              </button>
            )}
          </div>

          {/* totals + signature */}
          <div className="grid gap-6 border-t border-border/60 px-5 py-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  Notes
                </span>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Payment terms, delivery details…"
                  rows={3}
                  className="mt-1 rounded-lg text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-6 pt-8 text-xs">
                <div className="border-t border-border/70 pt-1 text-muted-foreground">
                  Authorised signature
                </div>
                <div className="border-t border-border/70 pt-1 text-muted-foreground">
                  Supplier signature
                </div>
              </div>
            </div>

            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="tabular-nums">{money(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="flex items-center gap-2">
                  Discount
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    value={discount}
                    disabled={!canCreate}
                    onChange={(e) => setDiscount(e.target.value)}
                    aria-label="Discount percent"
                    className="h-7 w-16 rounded-md text-right text-xs tabular-nums"
                  />
                  %
                </span>
                <span className="tabular-nums">− {money(discountAmount)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-muted-foreground">
                <span className="flex items-center gap-2">
                  Tax
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={tax}
                    disabled={!canCreate}
                    onChange={(e) => setTax(e.target.value)}
                    aria-label="Tax percent"
                    className="h-7 w-16 rounded-md text-right text-xs tabular-nums"
                  />
                  %
                </span>
                <span className="tabular-nums">+ {money(taxAmount)}</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{money(grandTotal)}</span>
              </div>
              {canCreate && (
                <div className="flex justify-end gap-2 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetForm}
                    className="h-9 rounded-lg text-xs"
                  >
                    Clear
                  </Button>
                  <Button type="submit" disabled={busy} className="h-9 rounded-lg text-xs">
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    Save bill &amp; add to stock
                  </Button>
                </div>
              )}
            </div>
          </div>
        </form>
      )}

      {/* recent activity, only on the list tab */}
      {tab === "list" && (bills?.length ?? 0) > 0 && (
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">What each bill added to stock</h3>
          <ul className="space-y-1">
            {(bills ?? []).slice(0, 5).flatMap((bill) =>
              bill.lines.map((line) => (
                <li
                  key={`${bill._id}-${line.materialId}`}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <CheckCircle2 className="size-3 shrink-0 text-emerald-500/70" />
                  <span className="font-mono text-[10px]">{bill.number}</span>
                  <span className="min-w-0 flex-1 truncate">{line.name}</span>
                  <span className="tabular-nums">
                    +{line.qty} {line.unit}
                  </span>
                </li>
              )),
            )}
          </ul>
        </section>
      )}
    </div>
  );
}
