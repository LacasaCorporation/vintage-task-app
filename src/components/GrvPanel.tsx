import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  ClipboardList,
  FilePlus2,
  Loader2,
  PackageCheck,
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
import ItemPicker, { type PickerItem } from "@/components/ItemPicker";
import { useAppDialogs } from "@/components/AppDialogs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { priceTaxedLines } from "@/lib/line-tax";
import VendorField from "@/components/VendorField";

type MaterialDoc = Doc<"rawMaterials">;
type GrvRow = Doc<"grvs"> & { lpoNumber?: string };

/**
 * How the panel is asked to open: a blank voucher, one saved voucher in the
 * form, or one saved voucher on its own screen. The panel is remounted on this
 * so the form starts from the seed rather than being filled in by an effect —
 * the arrangement the order and the bill already use.
 */
export type GrvSeed =
  | { mode: "new"; lpoId?: Id<"lpos"> }
  | { mode: "edit"; grvId: Id<"grvs"> }
  | { mode: "view"; grvId: Id<"grvs"> };

type DraftLine = {
  materialId: Id<"rawMaterials"> | "";
  qty: string;
  rate: string;
  /** This line's own tax rate. Empty means "use the material's". */
  tax: string;
};
const emptyLine = (): DraftLine => ({ materialId: "", qty: "1", rate: "", tax: "" });
const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const FIELD =
  "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30";

/**
 * Goods received vouchers: what has physically arrived. Saved as a draft the
 * voucher changes nothing; counting it in puts the quantities into raw-material
 * stock, so a delivery is recorded the day it lands rather than waiting for the
 * supplier's bill.
 */
export default function GrvPanel({
  materials,
  canCreate,
  canEdit,
  canDelete,
  seed = null,
  onCreateBill,
}: {
  materials: MaterialDoc[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  seed?: GrvSeed | null;
  /** Opens the bill form pre-filled from this voucher's lines. */
  onCreateBill?: (grv: Doc<"grvs">) => void;
}) {
  const grvs = useQuery(api.grv.list);
  const options = useQuery(api.grv.options);
  const { format: money } = useWorkspaceCurrency();
  const { confirm } = useAppDialogs();
  const createGrv = useMutation(api.grv.create);
  const updateGrv = useMutation(api.grv.update);
  const receiveGrv = useMutation(api.grv.receive);
  const removeGrv = useMutation(api.grv.remove);
  const taxDefault = useQuery(api.purchases.postingDefaults);
  const lpos = useQuery(api.lpo.list);

  const seedGrv =
    seed !== null && seed.mode !== "new"
      ? (grvs ?? []).find((g) => g._id === seed.grvId) ?? null
      : null;
  const seedLpo =
    seed !== null && seed.mode === "new" && seed.lpoId !== undefined
      ? (lpos ?? []).find((l) => l._id === seed.lpoId) ?? null
      : null;

  // the two screens this panel can show besides the register
  const [formOpen, setFormOpen] = useState(
    canCreate && seed !== null && seed.mode !== "view",
  );
  const [editingId, setEditingId] = useState<Id<"grvs"> | null>(
    seed !== null && seed.mode === "edit" ? seed.grvId : null,
  );
  const [viewingId, setViewingId] = useState<Id<"grvs"> | null>(
    seed !== null && seed.mode === "view" ? seed.grvId : null,
  );
  const [vendorId, setVendorId] = useState<Id<"vendors"> | undefined>(
    seedGrv?.vendorId,
  );
  const [vendor, setVendor] = useState(seedGrv?.vendor ?? seedLpo?.vendor ?? "");
  const [address, setAddress] = useState(seedGrv?.supplierAddress ?? "");
  const [receivedOn, setReceivedOn] = useState(() =>
    toLocalInput(new Date(seedGrv?.receivedAt ?? Date.now())),
  );
  const [reference, setReference] = useState(seedGrv?.reference ?? "");
  const [note, setNote] = useState(seedGrv?.note ?? "");
  const [discount, setDiscount] = useState(String(seedGrv?.discountPct ?? 0));
  const [lpoId, setLpoId] = useState<Id<"lpos"> | undefined>(
    seedGrv?.lpoId ?? (seed !== null && seed.mode === "new" ? seed.lpoId : undefined),
  );
  const [lines, setLines] = useState<DraftLine[]>(() => {
    // a saved voucher keeps the rates it was received at; an order already
    // carries a rate on each line, so its rates arrive here too
    const from = seedGrv?.lines ?? seedLpo?.lines ?? null;
    return from !== null && from.length > 0
      ? from.map((l) => ({
          materialId: l.materialId,
          qty: String(l.qty),
          rate: String(l.unitCost),
          tax: l.taxPct !== undefined ? String(l.taxPct) : "",
        }))
      : [emptyLine()];
  });
  const [busy, setBusy] = useState(false);
  const [busyRow, setBusyRow] = useState<Id<"grvs"> | null>(null);
  const viewed = (grvs ?? []).find((g) => g._id === viewingId) ?? null;

  const materialOf = (id: Id<"rawMaterials"> | "") =>
    materials.find((m) => m._id === id);

  /**
   * A line's rate: its own if one was typed, else the material's stored rate,
   * else nothing at all — the same rule the purchase bill uses, so a voucher
   * and the bill raised from it tax alike.
   */
  const lineRate = (line: DraftLine): number =>
    line.tax.trim() === ""
      ? (materialOf(line.materialId)?.purchaseTaxPct ?? 0)
      : Math.min(100, Math.max(0, num(line.tax)));

  /**
   * The same arithmetic the server runs, so the screen and the save agree —
   * computed each render, exactly as the purchase bill form does it, so a
   * material whose rate changed under the form is picked up straight away.
   */
  const priced = priceTaxedLines(
    lines.map((l) => ({
      qty: num(l.qty),
      unitCost: num(l.rate),
      taxPct: lineRate(l),
    })),
    num(discount),
  );

  const openLpos = options?.lpos ?? [];

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

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const resetForm = () => {
    setEditingId(null);
    setVendorId(undefined);
    setVendor("");
    setAddress("");
    setReceivedOn(toLocalInput(new Date()));
    setReference("");
    setNote("");
    setDiscount("0");
    setLpoId(undefined);
    setLines([emptyLine()]);
  };

  /** Choosing an order fills the supplier and copies its lines in. */
  const pickLpo = (id: string) => {
    setLpoId(id === "" ? undefined : (id as Id<"lpos">));
    if (id === "") return;
    const lpo = openLpos.find((l) => l.id === id);
    if (lpo === undefined) return;
    if (lpo.vendorId !== undefined) setVendorId(lpo.vendorId);
    if (lpo.vendor !== undefined) setVendor(lpo.vendor);
    if (lpo.lines.length > 0) {
      setLines(
        lpo.lines.map((line) => ({
          materialId: line.materialId,
          qty: String(line.qty),
          rate: String(line.unitCost),
          tax: line.taxPct !== undefined ? String(line.taxPct) : "",
        })),
      );
    }
  };

  /** Open a saved voucher in the form, pre-filled, for editing. */
  const startEdit = (row: GrvRow) => {
    setEditingId(row._id);
    setVendorId(row.vendorId);
    setVendor(row.vendor ?? "");
    setAddress(row.supplierAddress ?? "");
    setReceivedOn(toLocalInput(new Date(row.receivedAt)));
    setReference(row.reference ?? "");
    setNote(row.note ?? "");
    setDiscount(String(row.discountPct ?? 0));
    setLpoId(row.lpoId);
    setLines(
      row.lines.map((l) => ({
        materialId: l.materialId,
        qty: String(l.qty),
        rate: String(l.unitCost),
        tax: l.taxPct !== undefined ? String(l.taxPct) : "",
      })),
    );
    setViewingId(null);
    setFormOpen(true);
  };

  const submit = async (status: "draft" | "received") => {
    const valid = lines.filter((l) => l.materialId !== "" && num(l.qty) > 0);
    if (valid.length === 0) {
      toast.error("Add at least one material and a quantity.");
      return;
    }
    setBusy(true);
    try {
      const args = {
        vendorId,
        vendor: vendor.trim() || undefined,
        supplierAddress: address.trim() || undefined,
        receivedAt: new Date(`${receivedOn}T12:00:00`).getTime(),
        lpoId,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        discountPct: num(discount) || undefined,
        lines: valid.map((l) => ({
          materialId: l.materialId as Id<"rawMaterials">,
          qty: num(l.qty),
          unitCost: num(l.rate),
          // a line with no rate of its own takes the material's, which the
          // server also knows how to do
          taxPct:
            l.tax.trim() === ""
              ? undefined
              : Math.min(100, Math.max(0, num(l.tax))),
        })),
      };
      if (editingId !== null) {
        await updateGrv({ id: editingId, ...args });
        toast.success("Voucher updated.");
      } else {
        await createGrv({ ...args, status });
        toast.success(
          status === "received"
            ? "Voucher saved — the goods are in stock."
            : "Voucher saved as a draft.",
        );
      }
      const wasEditing = editingId;
      resetForm();
      setFormOpen(false);
      if (wasEditing !== null) setViewingId(wasEditing);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the voucher.",
      );
    } finally {
      setBusy(false);
    }
  };

  const receive = async (grv: GrvRow) => {
    setBusyRow(grv._id);
    try {
      await receiveGrv({ id: grv._id });
      toast.success(`${grv.number} counted in — stock updated.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't count the voucher in.",
      );
    } finally {
      setBusyRow(null);
    }
  };

  const confirmRemove = async (grv: GrvRow) => {
    const ok = await confirm({
      title: `Delete ${grv.number}?`,
      message:
        grv.status === "received"
          ? "Its quantities are taken back out of stock."
          : "The draft voucher is deleted.",
      confirmLabel: "Delete voucher",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeGrv({ id: grv._id });
      toast.success(`${grv.number} deleted.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the voucher.",
      );
    }
  };

  /**
   * An edit seed names a saved voucher, and the voucher is resolved from the
   * list — which arrives a render or two after the panel mounts. The form
   * reads it once, into its initial state, so opening it before the list has
   * landed would start it blank and never fill it in. Hold the form back
   * until the lookup it depends on has actually resolved.
   */
  if (formOpen && seed !== null && seed.mode === "edit" && grvs === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Opening the voucher…
      </div>
    );
  }

  /* ── the voucher form, full-screen ────────────────────────────── */
  if (formOpen) {
    return (
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              onClick={() => {
                resetForm();
                setFormOpen(false);
              }}
            >
              <ArrowLeft className="size-3.5" /> Goods received
            </Button>
            <h2 className="font-display text-lg font-semibold">
              {editingId !== null ? "Edit goods received" : "New goods received"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || editingId !== null}
              onClick={() => void submit("draft")}
              className="h-8 rounded-lg text-xs"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save draft
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || editingId !== null}
              onClick={() => void submit("received")}
              className="h-8 rounded-lg text-xs"
            >
              <PackageCheck className="size-3.5" /> Save &amp; count in
            </Button>
          </div>
        </div>

        <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <VendorField
            supplier={vendor}
            supplierId={vendorId}
            address={address}
            onChange={(patch) => {
              if (patch.supplier !== undefined) setVendor(patch.supplier);
              if (patch.supplierId !== undefined) setVendorId(patch.supplierId);
              if (patch.supplierAddress !== undefined)
                setAddress(patch.supplierAddress);
            }}
          />
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Against an order (optional)</span>
            <select
              value={lpoId ?? ""}
              onChange={(e) => pickLpo(e.target.value)}
              className={FIELD}
            >
              <option value="">Not against an order</option>
              {openLpos.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.number} · {l.vendor || "No vendor"}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Received on</span>
            <Input
              type="date"
              value={receivedOn}
              onChange={(e) => setReceivedOn(e.target.value)}
              className="h-9"
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Delivery note no.</span>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Optional"
              className="h-9"
            />
          </label>
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
                const net = sub * (1 - num(discount) / 100);
                const taxMoney = (net * lineRate(line)) / 100;
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
                        onChange={(id) => {
                          const materialId = id as Id<"rawMaterials"> | "";
                          const material = materialOf(materialId);
                          // A different material means the rate and tax on
                          // screen belonged to the old one, so they are taken
                          // from the newly chosen material.
                          const changed = line.materialId !== materialId;
                          updateLine(index, {
                            materialId,
                            rate: changed
                              ? String(material?.pricePerUnit ?? "")
                              : line.rate,
                            // offered, not imposed — the field fills in and
                            // stays editable either way
                            tax: changed
                              ? material?.purchaseTaxPct !== undefined
                                ? String(material.purchaseTaxPct)
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
                        {/* the rate sits under its own figure, small and
                            quiet, so the money is what the eye lands on */}
                        <label className="mt-0.5 flex items-center gap-0.5 text-[10px] text-muted-foreground">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="any"
                            value={line.tax}
                            placeholder={String(material?.purchaseTaxPct ?? 0)}
                            onChange={(e) => updateLine(index, { tax: e.target.value })}
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
          <button
            type="button"
            onClick={() => setLines((current) => [...current, emptyLine()])}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Plus className="size-3" /> Add line item
          </button>
        </div>

        <div className="grid gap-4 border-t border-border/60 px-5 py-4 sm:grid-cols-2">
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Note</span>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Condition on arrival, shortages…"
            />
          </label>
          {/* the same summary a purchase bill closes with */}
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-6 text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular-nums">{money(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-6 text-muted-foreground">
              <span className="flex items-center gap-2">
                Discount
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  aria-label="Discount percent"
                  className="h-7 w-16 rounded-md border bg-card px-1.5 text-right text-xs tabular-nums"
                />
                %
              </span>
              <span className="tabular-nums">− {money(priced.discount)}</span>
            </div>
            {/* the tax on this voucher is whatever the lines add up to, so the
                summary reports that figure rather than a rate to edit here */}
            <div className="text-muted-foreground">
              <div className="flex items-baseline justify-between gap-2">
                <span>Tax amount</span>
                <span className="tabular-nums">+ {money(priced.tax)}</span>
              </div>
              <p className="mt-0.5 text-right text-[11px] text-muted-foreground/80">
                Default tax {Math.max(0, taxDefault?.taxPct ?? 0)}%
                {lines.some((l) => num(l.tax) > 0) ? " · lines may differ" : ""}
                {editingId !== null ? " · from this voucher" : ""}
              </p>
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-border pt-2 text-base font-semibold">
              <span>Value</span>
              <span className="tabular-nums">{money(priced.grand)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── one voucher's detail screen ──────────────────────────────── */
  if (viewed !== null) {
    return (
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Goods received
            </p>
            <h2 className="font-display font-mono text-lg font-semibold">
              {viewed.number}
            </h2>
            <p className="text-xs text-muted-foreground">
              {viewed.vendor || "No supplier"} · {formatDueLabel(viewed.receivedAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                viewed.status === "received"
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {viewed.status === "received" ? "Counted in" : "Draft"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setViewingId(null)}
              className="h-8 rounded-lg text-xs"
            >
              <ArrowLeft className="size-3.5" /> Goods received
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
            {canDelete && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void confirmRemove(viewed)}
                className="h-8 rounded-lg text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" /> Delete
              </Button>
            )}
            {canCreate && viewed.billId === undefined && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onCreateBill?.(viewed)}
                className="h-8 rounded-lg text-xs"
              >
                <FilePlus2 className="size-3.5" /> Raise bill
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-4">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Supplier
            </p>
            <p className="text-sm">{viewed.vendor || "—"}</p>
            {viewed.supplierAddress && (
              <p className="text-xs text-muted-foreground">{viewed.supplierAddress}</p>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Received on
            </p>
            <p className="text-sm">{formatDueLabel(viewed.receivedAt)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Against order
            </p>
            <p className="text-sm font-mono">{viewed.lpoNumber ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Delivery note
            </p>
            <p className="text-sm">{viewed.reference || "—"}</p>
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
                <th className="w-28 py-1.5 text-right font-medium">Tax</th>
                <th className="w-32 py-1.5 text-right font-medium">Total</th>
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
                  <td className="py-1 text-right tabular-nums">
                    <div>{money(line.qty * line.unitCost * ((line.taxPct ?? 0) / 100))}</div>
                    <div className="text-[10px] text-muted-foreground">{line.taxPct ?? 0}%</div>
                  </td>
                  <td className="py-1 text-right font-medium tabular-nums">
                    {money(line.qty * line.unitCost * (1 + (line.taxPct ?? 0) / 100))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-5 py-4">
          <p className="max-w-md text-xs text-muted-foreground">
            {viewed.note || "No notes on this voucher."}
          </p>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-8 text-muted-foreground">
              <span>Items</span>
              <span className="tabular-nums">{viewed.lines.length}</span>
            </div>
            <div className="flex items-center justify-between gap-8 text-muted-foreground">
              <span>Tax amount</span>
              <span className="tabular-nums">+ {money(viewed.taxAmount ?? 0)}</span>
            </div>
            <div className="flex items-center justify-between gap-8 border-t border-border pt-2 text-base font-semibold">
              <span>Value</span>
              <span className="tabular-nums">{money(viewed.total)}</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  /* ── the register ─────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Goods received
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {grvs?.length ?? 0} voucher{(grvs?.length ?? 0) === 1 ? "" : "s"}
          </span>
        </h2>
        {canCreate && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              resetForm();
              setFormOpen(true);
            }}
            className="h-9 rounded-xl px-3 text-sm"
          >
            <Plus className="size-4" /> New voucher
          </Button>
        )}
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {grvs === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading vouchers…
          </div>
        ) : grvs.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <PackageCheck className="mx-auto size-7 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">Nothing received yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Record a delivery here and count it into stock — the bill can follow
              later.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                  <th className="px-4 py-2 text-left font-medium">Voucher</th>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">Supplier</th>
                  <th className="px-3 py-2 text-left font-medium">Order</th>
                  <th className="px-3 py-2 text-right font-medium">Items</th>
                  <th className="px-3 py-2 text-right font-medium">Tax</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="w-32 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {grvs.map((g) => {
                  const row = g as GrvRow;
                  return (
                    <tr
                      key={row._id}
                      onClick={() => setViewingId(row._id)}
                      title={`Open ${row.number}`}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-accent/40",
                        viewingId === row._id && "bg-primary/[0.05]",
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {/* the number opens the voucher, exactly as it does on
                            the order and the bill registers — the number is
                            the one thing on every row that is always there */}
                        <button
                          type="button"
                          onClick={() => setViewingId(row._id)}
                          className="font-mono text-xs font-medium hover:text-primary hover:underline"
                        >
                          {row.number}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                        {formatDueLabel(row.receivedAt)}
                      </td>
                      <td className="px-3 py-2.5 font-medium">{row.vendor || "—"}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {row.lpoNumber ? (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <ClipboardList className="size-2.5" />
                            {row.lpoNumber}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                        {row.lines.length}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                        {money(row.taxAmount ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                        {money(row.total)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            row.status === "received"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {row.status === "received" ? "Counted in" : "Draft"}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <span className="flex items-center justify-end gap-1">
                          {canCreate && row.billId === undefined && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCreateBill?.(row);
                              }}
                              title="Raise a purchase bill that pays for this delivery — its goods are already in stock"
                              className="h-7 rounded-lg px-2 text-xs"
                            >
                              <FilePlus2 className="size-3" />
                              Bill
                            </Button>
                          )}
                          {canEdit && (
                            <button
                              type="button"
                              aria-label={`Edit ${row.number}`}
                              title="Edit voucher"
                              onClick={(e) => {
                                e.stopPropagation();
                                startEdit(row);
                              }}
                              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            aria-label={`Open ${row.number}`}
                            title="Open voucher"
                            onClick={() => setViewingId(row._id)}
                            className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            <Receipt className="size-3.5" />
                          </button>
                          {row.status === "draft" && canEdit && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyRow === row._id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void receive(row);
                              }}
                              className="h-7 rounded-lg px-2 text-xs"
                            >
                              {busyRow === row._id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <PackageCheck className="size-3" />
                              )}
                              Count in
                            </Button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              aria-label={`Delete ${row.number}`}
                              title="Delete voucher"
                              onClick={(e) => {
                                e.stopPropagation();
                                void confirmRemove(row);
                              }}
                              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
