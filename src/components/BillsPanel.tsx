import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  FileSpreadsheet,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { formatDueLabel, toLocalInput } from "@/lib/task-utils";
import VendorField from "@/components/VendorField";
import ItemPicker, { type PickerItem } from "@/components/ItemPicker";
import { useAppDialogs } from "@/components/AppDialogs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

type MaterialDoc = Doc<"rawMaterials">;
type PurchaseDoc = Doc<"purchases">;
type LpoDoc = Doc<"lpos">;

/** One line being typed on the bill. */
type DraftLine = { materialId: Id<"rawMaterials"> | ""; qty: string; rate: string };

const emptyLine = (): DraftLine => ({ materialId: "", qty: "1", rate: "" });
const todayInput = () => toLocalInput(new Date());
const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * How a new bill opens: blank, or already carrying the vendor or the order it
 * is being raised from. The panel is remounted on this, so the form starts
 * from the seed rather than being filled in by an effect.
 */
export type BillSeed =
  | {
      mode: "new";
      supplierId?: Id<"vendors">;
      supplier?: string;
      address?: string;
    }
  | { mode: "fromLpo"; lpo: LpoDoc }
  | { mode: "view"; billId: Id<"purchases"> };

/**
 * Purchase bills: the register, the full-screen bill form and the bill's own
 * detail screen. One panel rather than a tab because a bill is a page of lines
 * that is worked on for a while, and saving it moves stock.
 */
export default function BillsPanel({
  materials,
  canCreate,
  canEdit,
  canDelete,
  seed = null,
}: {
  materials: MaterialDoc[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  seed?: BillSeed | null;
}) {
  const bills = useQuery(api.purchases.list);
  const lpos = useQuery(api.lpo.list);
  const taxDefault = useQuery(api.purchases.postingDefaults);
  const { confirm } = useAppDialogs();
  const { format: money } = useWorkspaceCurrency();
  const createBill = useMutation(api.purchases.create);
  const updateBill = useMutation(api.purchases.update);
  const setPaid = useMutation(api.purchases.setPaid);
  const removeBill = useMutation(api.purchases.remove);
  const postMissingBills = useMutation(api.purchases.postMissing);

  // the two screens this panel can show besides the register
  const [formOpen, setFormOpen] = useState(
    canCreate && seed !== null && seed.mode !== "view",
  );
  const [viewingId, setViewingId] = useState<Id<"purchases"> | null>(
    seed !== null && seed.mode === "view" ? seed.billId : null,
  );
  const [editingId, setEditingId] = useState<Id<"purchases"> | null>(null);
  const [fromLpoId, setFromLpoId] = useState<Id<"lpos"> | null>(
    seed !== null && seed.mode === "fromLpo" ? seed.lpo._id : null,
  );
  const seedLpo = seed !== null && seed.mode === "fromLpo" ? seed.lpo : null;

  const [supplierId, setSupplierId] = useState<Id<"vendors"> | undefined>(
    seed !== null && seed.mode === "new" ? seed.supplierId : undefined,
  );
  const [supplier, setSupplier] = useState(
    seed === null || seed.mode !== "new" ? (seedLpo?.vendor ?? "") : (seed.supplier ?? ""),
  );
  const [supplierAddress, setSupplierAddress] = useState(
    seed !== null && seed.mode === "new" ? (seed.address ?? "") : "",
  );
  const [purchasedOn, setPurchasedOn] = useState(todayInput);
  const [note, setNote] = useState(seedLpo?.note ?? "");
  const [discount, setDiscount] = useState("0");
  // empty means "whatever the workspace charges", so a new bill inherits it
  const [tax, setTax] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() =>
    seedLpo !== null && seedLpo.lines.length > 0
      ? seedLpo.lines.map((line) => ({
          materialId: line.materialId,
          qty: String(line.qty),
          rate: String(line.unitCost),
        }))
      : [emptyLine()],
  );
  const [busy, setBusy] = useState(false);
  const [repairingBills, setRepairingBills] = useState(false);

  const materialOf = (id: Id<"rawMaterials"> | "") => materials.find((m) => m._id === id);

  const unpostedBills = (bills ?? []).filter((b) => b.entryId === undefined);
  const viewed = bills?.find((b) => b._id === viewingId) ?? null;

  const materialOptions = useMemo<PickerItem[]>(
    () =>
      materials.map((m) => ({
        id: m._id,
        label: m.name,
        sub: [m.code, m.category].filter((v) => !!v && v !== "").join(" · ") || undefined,
        hint: `${money(m.pricePerUnit)}/${m.unit}`,
        keywords: `${(m.stock ?? 0).toLocaleString()} ${m.unit} in stock`,
      })),
    [materials, money],
  );

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + num(l.qty) * num(l.rate), 0),
    [lines],
  );
  const discountAmount = (subtotal * num(discount)) / 100;
  const taxable = subtotal - discountAmount;
  const taxValue = tax === "" ? String(taxDefault?.taxPct ?? 0) : tax;
  const taxAmount = (taxable * num(taxValue)) / 100;
  const grandTotal = taxable + taxAmount;

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const resetForm = () => {
    setEditingId(null);
    setFromLpoId(null);
    setSupplierId(undefined);
    setSupplier("");
    setSupplierAddress("");
    setPurchasedOn(todayInput());
    setNote("");
    setDiscount("0");
    setTax("");
    setLines([emptyLine()]);
  };

  const closeForm = () => {
    resetForm();
    setFormOpen(false);
  };

  /** Open a saved bill in the same form, pre-filled, for editing. */
  const startEdit = (bill: PurchaseDoc) => {
    setEditingId(bill._id);
    setSupplierId(bill.supplierId);
    setSupplier(bill.supplier ?? "");
    setSupplierAddress(bill.supplierAddress ?? "");
    setPurchasedOn(toLocalInput(new Date(bill.purchasedAt)));
    setNote(bill.note ?? "");
    setDiscount(String(bill.discountPct ?? 0));
    // a bill saved before the default existed inherits it rather than 0
    setTax(bill.taxPct !== undefined ? String(bill.taxPct) : "");
    setLines(
      bill.lines.length > 0
        ? bill.lines.map((line) => ({
            materialId: line.materialId,
            qty: String(line.qty),
            rate: String(line.unitCost),
          }))
        : [emptyLine()],
    );
    setViewingId(null);
    setFormOpen(true);
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
      const args = {
        supplier: supplier.trim() || undefined,
        supplierId,
        supplierAddress: supplierAddress.trim() || undefined,
        purchasedAt: purchasedOn ? new Date(purchasedOn).getTime() : undefined,
        note: note.trim() || undefined,
        discountPct: num(discount) || undefined,
        taxPct: num(taxValue) || undefined,
        lpoId: fromLpoId ?? undefined,
        lines: valid.map((l) => ({
          materialId: l.materialId as Id<"rawMaterials">,
          qty: num(l.qty),
          unitCost: num(l.rate) || materialOf(l.materialId)?.pricePerUnit || 0,
        })),
      };
      if (editingId !== null) {
        await updateBill({ id: editingId, ...args });
        toast.success("Bill updated — stock adjusted.");
      } else {
        await createBill(args);
        toast.success(
          fromLpoId === null
            ? "Bill saved — stock updated."
            : "Bill saved — the order is closed and its stock is in.",
        );
      }
      const wasEditing = editingId;
      resetForm();
      setFormOpen(false);
      if (wasEditing !== null) setViewingId(wasEditing);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the bill.");
    } finally {
      setBusy(false);
    }
  };

  const repairBills = async () => {
    setRepairingBills(true);
    try {
      const { posted, failed } = await postMissingBills({});
      if (posted > 0) {
        toast.success(
          `Posted ${posted} journal ${posted === 1 ? "entry" : "entries"} for bills.`,
        );
      }
      if (failed.length > 0) toast.error(`Couldn't post: ${failed.join("; ")}.`);
      if (posted === 0 && failed.length === 0) {
        toast.success("Every bill is already in the accounts.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't post the missing entries.",
      );
    } finally {
      setRepairingBills(false);
    }
  };

  const confirmDelete = async (bill: PurchaseDoc) => {
    const ok = await confirm({
      title: `Delete ${bill.number}?`,
      message: `Its quantities are taken back out of stock and its ledger entries are reversed.${bill.isPaid === true ? " A paid bill is un-paid with it." : ""}`,
      confirmLabel: "Delete bill",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeBill({ id: bill._id });
      if (viewingId === bill._id) setViewingId(null);
      toast.success(`${bill.number} deleted — stock adjusted.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the bill.",
      );
    }
  };

  /* ── the bill form, full-screen ───────────────────────────────── */
  if (formOpen) {
    return (
      <form onSubmit={submit} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              onClick={closeForm}
            >
              <ArrowLeft className="size-3.5" /> Bills
            </Button>
            <h2 className="font-display text-lg font-semibold">
              {editingId !== null ? "Edit purchase bill" : "New purchase bill"}
            </h2>
          </div>
          {canCreate && (
            <div className="flex items-center gap-2">
              <p className="hidden font-mono text-xs text-muted-foreground sm:block">
                {editingId !== null
                  ? (bills?.find((b) => b._id === editingId)?.number ?? "bill")
                  : "Auto PUR0001…"}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg text-xs"
                onClick={resetForm}
              >
                Clear
              </Button>
              <Button type="submit" size="sm" disabled={busy} className="h-8 rounded-lg text-xs">
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {editingId !== null ? "Save changes" : "Save bill"}
              </Button>
            </div>
          )}
        </div>

        {fromLpoId !== null && (
          <p className="flex items-center gap-2 border-b border-border/60 bg-emerald-500/[0.07] px-5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
            <Link2 className="size-3.5 shrink-0" />
            Raised from{" "}
            <span className="font-mono font-medium">
              {lpos?.find((l) => l._id === fromLpoId)?.number ?? "an order"}
            </span>
            — saving closes the order out and brings its stock in.
          </p>
        )}

        <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-2">
          <VendorField
            supplier={supplier}
            supplierId={supplierId}
            address={supplierAddress}
            onChange={(patch) => {
              if (patch.supplier !== undefined) setSupplier(patch.supplier);
              if (patch.supplierId !== undefined) setSupplierId(patch.supplierId);
              if (patch.supplierAddress !== undefined)
                setSupplierAddress(patch.supplierAddress);
            }}
          />
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
                      <ItemPicker
                        items={materialOptions}
                        value={line.materialId}
                        disabled={!canCreate}
                        onChange={(id) => {
                          updateLine(index, {
                            materialId: id as Id<"rawMaterials"> | "",
                            rate:
                              line.rate ||
                              String(
                                materialOf(id as Id<"rawMaterials">)?.pricePerUnit ?? "",
                              ),
                          });
                        }}
                        placeholder="Choose or search material…"
                        searchPlaceholder="Search name, code or category…"
                        emptyLabel="No material matches that."
                        aria-label="Material"
                      />
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
                  value={taxValue}
                  placeholder="0"
                  disabled={!canCreate}
                  onChange={(e) => setTax(e.target.value)}
                  aria-label="Tax percent"
                  className="h-7 w-16 rounded-md text-right text-xs tabular-nums"
                />
                %
                {tax === "" && num(taxValue) > 0 && (
                  <span
                    title="From Settings → Accounting"
                    className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                  >
                    default
                  </span>
                )}
              </span>
              <span className="tabular-nums">+ {money(taxAmount)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{money(grandTotal)}</span>
            </div>
          </div>
        </div>
      </form>
    );
  }

  /* ── one bill's detail screen ─────────────────────────────────── */
  if (viewed !== null) {
    return (
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Purchase bill
            </p>
            <h2 className="font-display font-mono text-lg font-semibold">
              {viewed.number}
            </h2>
            <p className="text-xs text-muted-foreground">
              {viewed.supplier || "No supplier"} ·{" "}
              {formatDueLabel(viewed.purchasedAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                viewed.isPaid
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
              )}
            >
              {viewed.isPaid ? "Paid" : "Unpaid"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setViewingId(null)}
              className="h-8 rounded-lg text-xs"
            >
              <ArrowLeft className="size-3.5" /> Bills
            </Button>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                onClick={() => startEdit(viewed)}
                className="h-8 rounded-lg text-xs"
              >
                <Pencil className="size-3.5" /> Edit
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Supplier
            </p>
            <p className="text-sm">{viewed.supplier || "—"}</p>
            {viewed.supplierId !== undefined && (
              <p className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <Link2 className="size-2.5" /> Linked to saved vendor
              </p>
            )}
            {viewed.supplierAddress && (
              <p className="text-xs text-muted-foreground">{viewed.supplierAddress}</p>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Bill date
            </p>
            <p className="text-sm">{formatDueLabel(viewed.purchasedAt)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Reference
            </p>
            <p className="text-sm">{viewed.note || "—"}</p>
          </div>
        </div>

        <div className="overflow-x-auto px-5 py-4">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="w-8 py-1.5 text-left font-medium">#</th>
                <th className="py-1.5 text-left font-medium">Material</th>
                <th className="w-24 py-1.5 text-right font-medium">Qty</th>
                <th className="w-32 py-1.5 text-right font-medium">Rate</th>
                <th className="w-32 py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {viewed.lines.map((line, index) => (
                <tr key={`${line.materialId}-${index}`} className="border-b border-border/50">
                  <td className="py-2 text-xs text-muted-foreground tabular-nums">
                    {index + 1}
                  </td>
                  <td className="py-2">{line.name}</td>
                  <td className="py-2 text-right tabular-nums">
                    {line.qty} {line.unit}
                  </td>
                  <td className="py-2 text-right tabular-nums">{money(line.unitCost)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {money(line.qty * line.unitCost)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
          <p className="max-w-md text-xs text-muted-foreground">
            {viewed.note || "No notes on this bill."}
          </p>
          <dl className="ml-auto space-y-1 text-sm">
            <div className="flex items-center justify-between gap-8 text-muted-foreground">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">
                {money(viewed.lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0))}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-8 text-muted-foreground">
              <dt>Discount / Tax</dt>
              <dd className="tabular-nums">
                {viewed.discountPct ?? 0}% / {viewed.taxPct ?? 0}%
              </dd>
            </div>
            <div className="flex items-center justify-between gap-8 border-t border-border pt-1 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(viewed.total)}</dd>
            </div>
          </dl>
        </div>

        {canEdit && (
          <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void setPaid({ id: viewed._id, paid: !viewed.isPaid }).catch((error) =>
                  toast.error(
                    error instanceof Error ? error.message : "Couldn't update the bill.",
                  ),
                )
              }
              className="h-9 rounded-lg text-xs"
            >
              <CheckCircle2 className="size-3.5" /> Mark{" "}
              {viewed.isPaid ? "unpaid" : "paid"}
            </Button>
            {canDelete && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void confirmDelete(viewed)}
                className="h-9 rounded-lg text-xs text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
          </div>
        )}
      </section>
    );
  }

  /* ── the register ─────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Purchase bills
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {bills?.length ?? 0} bill{(bills?.length ?? 0) === 1 ? "" : "s"} ·{" "}
            {money((bills ?? []).reduce((sum, b) => sum + b.total, 0))} total
          </span>
        </h2>
        {canCreate && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              resetForm();
              setViewingId(null);
              setFormOpen(true);
            }}
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

      {unpostedBills.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>
              {unpostedBills.length} bill{unpostedBills.length === 1 ? "" : "s"}
            </strong>{" "}
            {unpostedBills.length === 1 ? "is" : "are"} not in the chart of accounts.
          </span>
          <button
            type="button"
            onClick={() => void repairBills()}
            disabled={repairingBills}
            className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 text-xs font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
          >
            {repairingBills ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-3" />
            )}
            Post to accounts
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
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
                  <th className="px-3 py-2 text-left font-medium">Journal</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {bills.map((bill: PurchaseDoc) => (
                  <tr
                    key={bill._id}
                    onClick={() => setViewingId(bill._id)}
                    className={cn(
                      "cursor-pointer transition-colors hover:bg-accent/40",
                      viewingId === bill._id && "bg-primary/[0.05]",
                    )}
                  >
                    <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {bill.number}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="truncate font-medium">
                        {bill.supplier || "No supplier"}
                      </p>
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
                    <td className="px-3 py-2.5 text-xs">
                      {bill.entryId !== undefined ? (
                        <span
                          className="text-muted-foreground"
                          title="Posted to the chart of accounts"
                        >
                          {bill.isPaid === true ? "posted + paid" : "posted"}
                        </span>
                      ) : (
                        <span
                          className="text-amber-600 dark:text-amber-400"
                          title="Not in the chart of accounts yet — use “Post to accounts” above"
                        >
                          not posted
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        <button
                          type="button"
                          aria-label={`View bill ${bill.number}`}
                          title="View bill"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingId(bill._id);
                          }}
                          className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                        >
                          <Eye className="size-3.5" />
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            aria-label={`Edit bill ${bill.number}`}
                            title="Edit bill (stock is adjusted by the difference)"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(bill);
                            }}
                            className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            aria-label={`Delete bill ${bill.number}`}
                            title="Delete bill (stock is taken back out)"
                            onClick={(e) => {
                              e.stopPropagation();
                              void confirmDelete(bill);
                            }}
                            className="grid size-6 place-items-center rounded text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
