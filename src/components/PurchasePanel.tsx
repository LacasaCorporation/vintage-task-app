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
  Eye,
  FileText,
  Link2,
  List,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Save,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { formatDueLabel, toLocalInput } from "@/lib/task-utils";
import ContactDialog from "@/components/ContactDialog";
import VendorField from "@/components/VendorField";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

type MaterialDoc = Doc<"rawMaterials">;
type PurchaseDoc = Doc<"purchases">;

/** One line being typed on the new bill. */
type DraftLine = { materialId: Id<"rawMaterials"> | ""; qty: string; rate: string };

const emptyLine = (): DraftLine => ({ materialId: "", qty: "1", rate: "" });
const todayInput = () => toLocalInput(new Date());

const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);
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
  const { format: money } = useWorkspaceCurrency();
  const createBill = useMutation(api.purchases.create);
  const updateBill = useMutation(api.purchases.update);
  const setPaid = useMutation(api.purchases.setPaid);
  const removeBill = useMutation(api.purchases.remove);
  const vendors = useQuery(api.contacts.listVendors);
  const addVendor = useMutation(api.contacts.createVendor);
  const editVendor = useMutation(api.contacts.updateVendor);
  const dropVendor = useMutation(api.contacts.removeVendor);

  const [tab, setTab] = useState<"list" | "bill" | "vendors">("list");
  const [editingId, setEditingId] = useState<Id<"purchases"> | null>(null);
  const [viewingId, setViewingId] = useState<Id<"purchases"> | null>(null);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [vendorEditing, setVendorEditing] = useState<Doc<"vendors"> | null>(null);
  const [supplierId, setSupplierId] = useState<Id<"vendors"> | undefined>(undefined);
  const [supplier, setSupplier] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [purchasedOn, setPurchasedOn] = useState(todayInput);
  // captured once so the header label stays stable across re-renders
  const [openedAt] = useState(() => Date.now());
  const [note, setNote] = useState("");
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);

  const materialOf = (id: Id<"rawMaterials"> | "") => materials.find((m) => m._id === id);

  /** The bill the view tab is showing. */
  const viewed = bills?.find((b) => b._id === viewingId) ?? null;

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
    setEditingId(null);
    setSupplierId(undefined);
    setSupplier("");
    setSupplierAddress("");
    setPurchasedOn(todayInput());
    setNote("");
    setDiscount("0");
    setTax("0");
    setLines([emptyLine()]);
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
    setTax(String(bill.taxPct ?? 0));
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
    setTab("bill");
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
        taxPct: num(tax) || undefined,
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
        toast.success("Bill saved — stock updated.");
      }
      const wasEditing = editingId;
      resetForm();
      setTab("list");
      if (wasEditing !== null) setViewingId(wasEditing);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the bill.");
    } finally {
      setBusy(false);
    }
  };

  const tabBtn = (id: "list" | "bill" | "vendors", label: string, Icon: typeof List) => (
    <button
      key={id}
      type="button"
      onClick={() => {
        setTab(id);
        if (id === "list") setViewingId(null);
        if (id === "bill") resetForm();
      }}
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
          {tabBtn("vendors", `Vendors (${vendors?.length ?? 0})`, Store)}
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            {tab === "vendors" && (
              <Button
                type="button"
                size="sm"
                onClick={() => setVendorPickerOpen(true)}
                className="h-9 rounded-xl px-3 text-sm"
              >
                <Plus className="size-4" /> New vendor
              </Button>
            )}
            {tab !== "vendors" && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  resetForm();
                  setTab("bill");
                }}
                className="h-9 rounded-xl px-3 text-sm"
              >
                <Plus className="size-4" /> Add bill
              </Button>
            )}
          </div>
        )}
      </div>

      {materials.length === 0 && (
        <p className="rounded-xl border border-dashed bg-card px-4 py-3 text-center text-sm text-muted-foreground">
          Add raw materials first — then you can buy stock for them here.
        </p>
      )}

      {/* ── Purchase list ───────────────────────────────────────────── */}
      {tab === "list" && viewed !== null && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Purchase bill
              </p>
              <h2 className="font-display text-lg font-semibold font-mono">
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
                onClick={() => {
                  setViewingId(null);
                  setTab("list");
                }}
                className="h-8 rounded-lg text-xs"
              >
                <X className="size-3.5" /> Close
              </Button>
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
                    <td className="py-2 text-xs text-muted-foreground tabular-nums">{index + 1}</td>
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
                  {money(
                    viewed.lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0),
                  )}
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
                <CheckCircle2 className="size-3.5" /> Mark {viewed.isPaid ? "unpaid" : "paid"}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => startEdit(viewed)}
                className="h-9 rounded-lg text-xs"
              >
                <Pencil className="size-3.5" /> Edit bill
              </Button>
            </div>
          )}
        </section>
      )}

      {tab === "list" && viewed === null && (
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
                    <tr
                      key={bill._id}
                      onClick={() => setViewingId(bill._id)}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-accent/40",
                        viewingId === bill._id && "bg-primary/[0.05]",
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setViewingId(bill._id);
                          }}
                          className="cursor-pointer hover:underline"
                        >
                          {bill.number}
                        </button>
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
                                void removeBill({ id: bill._id }).catch((error) =>
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Couldn't delete the bill.",
                                  ),
                                );
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
      )}

      {/* ── Vendors tab ─────────────────────────────────────────────── */}
      {tab === "vendors" && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
            <h2 className="text-sm font-semibold">
              Vendors
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                {vendors?.length ?? 0} supplier{(vendors?.length ?? 0) === 1 ? "" : "s"} ·{" "}
                {money(
                  (bills ?? [])
                    .filter((b) => b.supplierId !== undefined)
                    .reduce((sum, b) => sum + b.total, 0),
                )}{" "}
                billed to saved vendors
              </span>
            </h2>
            <Button
              type="button"
              size="sm"
              onClick={() => setVendorPickerOpen(true)}
              className="h-8 rounded-lg px-2.5 text-xs"
            >
              <Plus className="size-3.5" /> New vendor
            </Button>
          </div>

          {vendors === undefined ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading vendors…
            </div>
          ) : vendors.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Store className="mx-auto size-7 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium">No vendors yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add a supplier once and every bill can pick it from the list.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                    <th className="px-4 py-2 text-left font-medium">Vendor</th>
                    <th className="px-3 py-2 text-left font-medium">Contact</th>
                    <th className="px-3 py-2 text-left font-medium">Phone</th>
                    <th className="px-3 py-2 text-left font-medium">Email</th>
                    <th className="px-3 py-2 text-left font-medium">Address</th>
                    <th className="px-3 py-2 text-right font-medium">Bills</th>
                    <th className="px-3 py-2 text-right font-medium">Billed</th>
                    <th className="w-20 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {vendors.map((vendor) => {
                    const theirBills = (bills ?? []).filter(
                      (b) => b.supplierId === vendor._id,
                    );
                    return (
                      <tr
                        key={vendor._id}
                        className="transition-colors hover:bg-accent/40"
                      >
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{vendor.name}</p>
                          {vendor.note && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              {vendor.note}
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          {vendor.contactName || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                          {vendor.phone || "—"}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          <span className="block max-w-48 truncate">
                            {vendor.email || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">
                          <span className="block max-w-56 truncate">
                            {vendor.address || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                          {theirBills.length}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                          {theirBills.length > 0
                            ? money(theirBills.reduce((sum, b) => sum + b.total, 0))
                            : "—"}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <button
                              type="button"
                              aria-label={`Use ${vendor.name}`}
                              title="Start a bill with this vendor"
                              onClick={() => {
                                setSupplierId(vendor._id);
                                setSupplier(vendor.name);
                                if (vendor.address) setSupplierAddress(vendor.address);
                                setViewingId(null);
                                setTab("bill");
                              }}
                              className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                            >
                              <Receipt className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Edit ${vendor.name}`}
                              title="Edit vendor"
                              onClick={() => {
                                setVendorEditing(vendor);
                                setVendorPickerOpen(true);
                              }}
                              className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove ${vendor.name}`}
                              title="Remove vendor"
                              onClick={() =>
                                void dropVendor({ id: vendor._id }).catch((error) =>
                                  toast.error(
                                    error instanceof Error
                                      ? error.message
                                      : "Couldn't remove the vendor.",
                                  ),
                                )
                              }
                              className="grid size-6 place-items-center rounded text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
              <p className="font-mono text-sm font-semibold">
                {editingId !== null
                  ? `Editing ${bills?.find((b) => b._id === editingId)?.number ?? "bill"}`
                  : "Auto PUR0001…"}
              </p>
              <p className="text-muted-foreground">
                {editingId !== null
                  ? "Saving adjusts stock by the difference"
                  : `Date ${formatDueLabel(openedAt)}`}
              </p>
            </div>
          </div>

          {/* supplier + dates */}
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
                    {editingId !== null ? "Cancel edit" : "Clear"}
                  </Button>
                  <Button type="submit" disabled={busy} className="h-9 rounded-lg text-xs">
                    {busy ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Save className="size-3.5" />
                    )}
                    {editingId !== null
                      ? "Save changes & adjust stock"
                      : "Save bill & add to stock"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </form>
      )}

      <ContactDialog
        kind="vendor"
        open={vendorPickerOpen}
        onOpenChange={(next) => {
          setVendorPickerOpen(next);
          if (!next) setVendorEditing(null);
        }}
        contacts={vendors}
        editTarget={vendorEditing}
        onCreate={async (args) => addVendor(args)}
        onUpdate={async (id, args) => {
          await editVendor({ id: id as Id<"vendors">, ...args });
        }}
        onRemove={async (id) => {
          await dropVendor({ id: id as Id<"vendors"> });
        }}
        onPick={(contact) => {
          setSupplier(contact.name);
          setSupplierId(contact.id as Id<"vendors"> | undefined);
          if (contact.address) setSupplierAddress(contact.address);
        }}
      />
    </div>
  );
}
