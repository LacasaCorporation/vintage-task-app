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
  FilePlus2,
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
import { priceTaxedLines } from "@/lib/line-tax";

type MaterialDoc = Doc<"rawMaterials">;
type PurchaseDoc = Doc<"purchases">;
type LpoDoc = Doc<"lpos">;

/** One line being typed on the bill. */
type DraftLine = {
  materialId: Id<"rawMaterials"> | "";
  qty: string;
  rate: string;
  /** This line's own tax rate. Empty means "use the material's". */
  tax: string;
};

const emptyLine = (): DraftLine => ({
  materialId: "",
  qty: "1",
  rate: "",
  tax: "",
});
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
  /** Raised from a delivery, whose goods are already in stock. */
  | { mode: "fromGrv"; grv: Doc<"grvs"> }
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
  const grvs = useQuery(api.grv.list);
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
  const seedGrv = seed !== null && seed.mode === "fromGrv" ? seed.grv : null;
  /**
   * A voucher the bill is being raised from, when it came from one. A seed
   * that names a voucher opens with it already chosen, so the form starts
   * filled in rather than being filled in after the fact.
   */
  const [fromGrvId, setFromGrvId] = useState<Id<"grvs"> | null>(
    seedGrv !== null ? seedGrv._id : null,
  );

  const materialOf = (id: Id<"rawMaterials"> | "") => materials.find((m) => m._id === id);

  /**
   * A line's rate: its own if one was typed, else the material's stored rate,
   * else nothing at all.
   *
   * A material with no tax rate of its own is charged no tax — the workspace
   * default is not applied to it, because a rate the user never set on that
   * item is not a rate they agreed to. The default is only a starting point
   * for new documents, and it says so in the summary.
   */
  const lineRate = (line: DraftLine): number =>
    line.tax.trim() === ""
      ? (materialOf(line.materialId)?.purchaseTaxPct ?? 0)
      : Math.min(100, Math.max(0, num(line.tax)));

  /**
   * Orders and vouchers this bill could be raised from. An order already
   * received is left out, because its stock is in and billing it as well would
   * count the same delivery twice; a voucher already billed is left out for
   * the same reason.
   */
  const raisableSources = useMemo(() => {
    const orders = (lpos ?? [])
      .filter((l) => l.status !== "received" && l.status !== "cancelled" && l.billId === undefined)
      .map((l) => ({
        id: l._id as string,
        kind: "lpo" as const,
        number: l.number,
        vendor: l.vendor ?? "",
        lineCount: l.lines.length,
        at: l.orderedAt,
      }));
    const vouchers = (grvs ?? [])
      .filter((g) => g.billId === undefined)
      .map((g) => ({
        id: g._id as string,
        kind: "grv" as const,
        number: g.number,
        vendor: g.vendor ?? "",
        lineCount: g.lines.length,
        at: g.receivedAt,
      }));
    return [...orders, ...vouchers].sort((a, b) => b.at - a.at);
  }, [lpos, grvs]);

  /** Pull a chosen order or voucher's lines, vendor and rates into the form. */
  const pullFrom = (source: (typeof raisableSources)[number] | undefined) => {
    if (source === undefined) {
      setFromLpoId(null);
      setFromGrvId(null);
      return;
    }
    const doc =
      source.kind === "lpo"
        ? lpos?.find((l) => l._id === source.id)
        : grvs?.find((g) => g._id === source.id);
    if (doc === undefined) return;
    if (source.kind === "lpo") {
      const lpo = lpos?.find((l) => l._id === source.id);
      setFromLpoId(doc._id as Id<"lpos">);
      setFromGrvId(null);
      setSupplierId(lpo?.vendorId ?? supplierId);
      if (!supplier.trim()) setSupplier(lpo?.vendor ?? "");
    } else {
      const grv = grvs?.find((g) => g._id === source.id);
      setFromGrvId(doc._id as Id<"grvs">);
      // the voucher's order stays linked, so the order is closed out too
      setFromLpoId(grv?.lpoId ?? null);
      setSupplierId(grv?.vendorId ?? supplierId);
      if (!supplier.trim()) setSupplier(grv?.vendor ?? "");
    }
    setLines(
      doc.lines.length > 0
        ? doc.lines.map((line) => ({
            materialId: line.materialId,
            qty: String(line.qty),
            rate: String(line.unitCost),
            // the rate is whatever the material carries now; a voucher does
            // not carry one of its own
            tax:
              materialOf(line.materialId)?.purchaseTaxPct !== undefined
                ? String(materialOf(line.materialId)?.purchaseTaxPct ?? "")
                : "",
          }))
        : [emptyLine()],
    );
  };

  const [supplierId, setSupplierId] = useState<Id<"vendors"> | undefined>(
    seed !== null && seed.mode === "new"
      ? seed.supplierId
      : (seedLpo?.vendorId ?? seedGrv?.vendorId),
  );
  const [supplier, setSupplier] = useState(
    seed === null || seed.mode !== "new"
      ? (seedLpo?.vendor ?? seedGrv?.vendor ?? "")
      : (seed.supplier ?? ""),
  );
  const [supplierAddress, setSupplierAddress] = useState(
    seed !== null && seed.mode === "new"
      ? (seed.address ?? "")
      : (seedLpo?.supplierAddress ?? seedGrv?.supplierAddress ?? ""),
  );
  const [purchasedOn, setPurchasedOn] = useState(todayInput);
  const [note, setNote] = useState(seedLpo?.note ?? seedGrv?.note ?? "");
  const [discount, setDiscount] = useState(
    String(seedLpo?.discountPct ?? seedGrv?.discountPct ?? 0),
  );
  /**
   * The rate the bill being edited was raised at. Its lines that carry no
   * rate of their own fall back to this rather than to today's workspace
   * default — otherwise opening an old bill would silently re-tax it.
   */
  const [editFallbackRate, setEditFallbackRate] = useState<number | null>(null);
  const [lines, setLines] = useState<DraftLine[]>(() => {
    // an order and a voucher both carry a rate on each line, so whichever
    // seeded this arrives with the rates it was raised at
    const from = seedLpo?.lines ?? seedGrv?.lines ?? null;
    return from !== null && from.length > 0
      ? from.map((line) => ({
          materialId: line.materialId,
          qty: String(line.qty),
          rate: String(line.unitCost),
          tax: line.taxPct !== undefined ? String(line.taxPct) : "",
        }))
      : [emptyLine()];
  });
  const [busy, setBusy] = useState(false);
  const [repairingBills, setRepairingBills] = useState(false);


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
  /**
   * The workspace default, which is what a line with no rate of its own falls
   * back to. Reported in the summary for awareness; each line's own rate is
   * what is actually charged.
   */
  const fallbackRate =
    editFallbackRate ?? Math.max(0, taxDefault?.taxPct ?? 0);
  /**
   * The same arithmetic the server runs, so what this screen shows is what
   * gets saved — including tax summed across lines at their own rates.
   */
  const priced = priceTaxedLines(
    lines.map((l) => ({
      qty: num(l.qty),
      unitCost: num(l.rate),
      taxPct: lineRate(l),
    })),
    num(discount),
  );
  const taxAmount = priced.tax;
  const grandTotal = priced.grand;
  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const resetForm = () => {
    setEditingId(null);
    setFromLpoId(null);
    setFromGrvId(null);
    setSupplierId(undefined);
    setSupplier("");
    setSupplierAddress("");
    setPurchasedOn(todayInput());
    setNote("");
    setDiscount("0");
    setEditFallbackRate(null);
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
    setEditFallbackRate(bill.taxPct ?? null);
    setLines(
      bill.lines.length > 0
        ? bill.lines.map((line) => ({
            materialId: line.materialId,
            qty: String(line.qty),
            rate: String(line.unitCost),
            // a saved line keeps the rate it was billed at
            tax: line.taxPct !== undefined ? String(line.taxPct) : "",
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
        taxPct: fallbackRate || undefined,
        lpoId: fromLpoId ?? undefined,
        grvId: fromGrvId ?? undefined,
        lines: valid.map((l) => ({
          materialId: l.materialId as Id<"rawMaterials">,
          qty: num(l.qty),
          unitCost: num(l.rate) || materialOf(l.materialId)?.pricePerUnit || 0,
          // a line with no rate of its own takes the material's, which the
          // server also knows how to do
          taxPct:
            l.tax.trim() === ""
              ? undefined
              : Math.min(100, Math.max(0, num(l.tax))),
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

        {/* ── raise the bill from an order or a receipt ────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-5 py-2">
          <FilePlus2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Raise from</span>
          <select
            value={
              fromGrvId !== null
                ? `grv:${fromGrvId}`
                : fromLpoId !== null
                  ? `lpo:${fromLpoId}`
                  : ""
            }
            disabled={!canCreate}
            onChange={(e) => {
              const [kind, id] = e.target.value.split(":");
              pullFrom(
                raisableSources.find(
                  (o) => o.kind === kind && o.id === id,
                ),
              );
            }}
            aria-label="Raise this bill from a purchase order or goods received voucher"
            className="h-7 max-w-[22rem] min-w-0 flex-1 rounded-md border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          >
            <option value="">A blank bill</option>
            {raisableSources.length === 0 ? (
              <option value="" disabled>
                No open orders or receipts
              </option>
            ) : (
              raisableSources.map((o) => (
                <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>
                  {o.number} · {o.kind === "lpo" ? "order" : "receipt"} ·{" "}
                  {o.lineCount} {o.lineCount === 1 ? "line" : "lines"}
                  {o.vendor === "" ? "" : ` · ${o.vendor}`}
                </option>
              ))
            )}
          </select>
          {fromGrvId !== null ? (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
              <Link2 className="size-3" />
              saving pays for{" "}
              <span className="font-mono font-medium">
                {grvs?.find((g) => g._id === fromGrvId)?.number ?? "the receipt"}
              </span>
              {grvs?.find((g) => g._id === fromGrvId)?.status === "received"
                ? " — its goods are already in stock"
                : " — and brings its stock in"}
            </span>
          ) : fromLpoId !== null ? (
            <span className="flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
              <Link2 className="size-3" />
              saving closes{" "}
              <span className="font-mono font-medium">
                {lpos?.find((l) => l._id === fromLpoId)?.number ?? "the order"}
              </span>{" "}
              out and brings its stock in
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {raisableSources.length} open{" "}
              {raisableSources.length === 1 ? "document" : "documents"}
            </span>
          )}
        </div>

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
                <th className="w-24 py-1.5 text-left font-medium">Code</th>
                <th className="py-1.5 text-left font-medium">Name</th>
                <th className="w-20 py-1.5 text-right font-medium">Qty</th>
                <th className="w-14 py-1.5 text-right font-medium">Unit</th>
                <th className="w-24 py-1.5 text-right font-medium">Rate</th>
                <th className="w-24 py-1.5 text-right font-medium">Sub total</th>
                <th className="w-28 py-1.5 text-right font-medium">Tax</th>
                <th className="w-28 py-1.5 text-right font-medium">Total</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const material = materialOf(line.materialId);
                const sub = num(line.qty) * num(line.rate);
                // the discount comes off first, then this line's own rate is
                // charged on what is left — the same order the server uses
                const rate = lineRate(line);
                const net = sub * (1 - num(discount) / 100);
                const taxMoney = (net * rate) / 100;
                return (
                  <tr key={index} className="border-b border-border/50">
                    <td className="py-1 text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </td>
                    <td className="py-1 pr-1.5 font-mono text-xs text-muted-foreground">
                      {material?.code ?? "—"}
                    </td>
                    <td className="py-1 pr-1.5">
                      <ItemPicker
                        items={materialOptions}
                        value={line.materialId}
                        disabled={!canCreate}
                        onChange={(id) => {
                          const picked = materialOf(id as Id<"rawMaterials">);
                          // A different material means the rate and tax on
                          // screen belonged to the old one, so they are taken
                          // from the newly chosen material. Re-picking the same
                          // one changes nothing.
                          const changed = line.materialId !== id;
                          updateLine(index, {
                            materialId: id as Id<"rawMaterials"> | "",
                            rate: changed
                              ? String(picked?.pricePerUnit ?? "")
                              : line.rate,
                            // offered, not imposed — the field fills in and
                            // stays editable either way
                            tax: changed
                              ? picked?.purchaseTaxPct !== undefined
                                ? String(picked.purchaseTaxPct)
                                : ""
                              : line.tax,
                          });
                        }}
                        placeholder="Choose or search material…"
                        searchPlaceholder="Search name, code or category…"
                        emptyLabel="No material matches that."
                        aria-label="Material"
                      />
                    </td>
                    <td className="py-1 pr-1.5">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={line.qty}
                        disabled={!canCreate}
                        onChange={(e) => updateLine(index, { qty: e.target.value })}
                        aria-label="Quantity"
                        className="h-8 rounded-md text-right text-sm tabular-nums"
                      />
                    </td>
                    <td className="py-1 pr-1.5 text-right text-xs text-muted-foreground">
                      {material?.unit ?? "—"}
                    </td>
                    <td className="py-1 pr-1.5">
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={line.rate}
                        placeholder={String(material?.pricePerUnit ?? 0)}
                        disabled={!canCreate}
                        onChange={(e) => updateLine(index, { rate: e.target.value })}
                        aria-label="Rate"
                        className="h-8 rounded-md text-right text-sm tabular-nums"
                      />
                    </td>
                    <td className="py-1 pr-1.5 text-right text-sm tabular-nums text-muted-foreground">
                      {money(sub)}
                    </td>
                    <td className="py-1 pr-1.5">
                      <div className="flex flex-col items-end">
                        <span className="text-sm tabular-nums">{money(taxMoney)}</span>
                        {/* the rate sits under its own figure, small and quiet,
                            so the money is what the eye lands on */}
                        <label className="mt-0.5 flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            value={line.tax}
                            // shows the material's own rate, and nothing when
                            // it has none — the workspace default is not
                            // quietly applied to a line that never asked for it
                            placeholder={String(
                              material?.purchaseTaxPct ?? 0,
                            )}
                            disabled={!canCreate}
                            onChange={(e) =>
                              updateLine(index, { tax: e.target.value })
                            }
                            aria-label="Line tax percent"
                            className="w-8 border-b border-dashed border-border bg-transparent text-right tabular-nums outline-none focus:border-primary"
                          />
                          %
                        </label>
                      </div>
                    </td>
                    <td className="py-1 text-right text-sm font-medium tabular-nums">
                      {money(net + taxMoney)}
                    </td>
                    <td className="py-1 text-right">
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
              <span className="tabular-nums">− {money(priced.discount)}</span>
            </div>
            {/* The tax on this bill is whatever the lines add up to, so the
                summary reports that figure rather than offering a rate to
                edit here — a rate would imply one tax for the whole bill.
                The default is named underneath, for awareness only. */}
            <div className="text-muted-foreground">
              <div className="flex items-baseline justify-between gap-2">
                <span>Tax amount</span>
                <span className="tabular-nums">+ {money(taxAmount)}</span>
              </div>
              <p className="mt-0.5 text-right text-[11px] text-muted-foreground/80">
                Default tax {fallbackRate}%
                {lines.some((l) => num(l.tax) > 0) ? " · lines may differ" : ""}
                {editingId !== null ? " · from this bill" : ""}
              </p>
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
                  <td className="py-1 text-xs text-muted-foreground tabular-nums">
                    {index + 1}
                  </td>
                  <td className="py-2">{line.name}</td>
                  <td className="py-1 text-right tabular-nums">
                    {line.qty} {line.unit}
                  </td>
                  <td className="py-1 text-right tabular-nums">{money(line.unitCost)}</td>
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
