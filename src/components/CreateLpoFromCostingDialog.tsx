import { useState, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { toast } from "@/lib/toast";
import {
  AlertTriangle,
  Loader2,
  Package,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface CreateLpoItem {
  materialId: Id<"rawMaterials">;
  name: string;
  unit: string;
  qty: number;
  unitCost: number;
  stock?: number;
}

interface CreateLpoFromCostingDialogProps {
  open: boolean;
  onClose: () => void;
  items: CreateLpoItem[];
  productName?: string;
  productCode?: string;
  onLpoCreated?: (lpoId: Id<"lpos">) => void;
}

export default function CreateLpoFromCostingDialog({
  open,
  onClose,
  items: initialItems,
  productName,
  productCode,
  onLpoCreated,
}: CreateLpoFromCostingDialogProps) {
  const { format: money } = useWorkspaceCurrency();
  const createLpo = useMutation(api.lpo.create);
  const vendors = useQuery(api.contacts.listVendors);

  const [lines, setLines] = useState<
    {
      materialId: Id<"rawMaterials">;
      name: string;
      unit: string;
      qty: number;
      unitCost: number;
      stock?: number;
    }[]
  >([]);

  const [vendorId, setVendorId] = useState<Id<"vendors"> | "">("");
  const [customVendor, setCustomVendor] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"draft" | "ordered">("draft");
  const [expectedAt, setExpectedAt] = useState("");
  const [busy, setBusy] = useState(false);

  // Sync lines when dialog opens or initialItems change
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setLines(initialItems.map((i) => ({ ...i })));
      setVendorId("");
      setCustomVendor("");
      setAddress("");
      setNote(
        productName
          ? `Costing sheet order for: ${productName}${productCode ? ` (${productCode})` : ""}`
          : "Raw materials order from costing sheet",
      );
      setStatus("draft");
      setExpectedAt("");
    }
  }

  const handleVendorSelect = (val: string) => {
    if (val === "" || val === "custom") {
      setVendorId("");
      return;
    }
    const found = (vendors ?? []).find((v) => v._id === val);
    if (found) {
      setVendorId(found._id);
      setCustomVendor(found.name);
      setAddress(found.address ?? "");
    }
  };

  const handleUpdateQty = (index: number, val: number) => {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, qty: val } : line)),
    );
  };

  const handleUpdateCost = (index: number, val: number) => {
    setLines((prev) =>
      prev.map((line, i) => (i === index ? { ...line, unitCost: val } : line)),
    );
  };

  const handleRemoveLine = (index: number) => {
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const grandTotal = useMemo(
    () => lines.reduce((sum, l) => sum + (l.qty || 0) * (l.unitCost || 0), 0),
    [lines],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (lines.length === 0) {
      toast.error("Please include at least one raw material in the order.");
      return;
    }

    for (const l of lines) {
      if (!(l.qty > 0)) {
        toast.error(`Quantity for “${l.name}” must be greater than zero.`);
        return;
      }
      if (l.unitCost < 0) {
        toast.error(`Unit rate for “${l.name}” cannot be negative.`);
        return;
      }
    }

    setBusy(true);
    try {
      const selectedVendorDoc = (vendors ?? []).find((v) => v._id === vendorId);
      const chosenVendorName =
        selectedVendorDoc?.name || customVendor.trim() || undefined;

      const expectedDateMs = expectedAt
        ? new Date(expectedAt).getTime()
        : undefined;

      const lpoId = await createLpo({
        vendorId: vendorId ? (vendorId as Id<"vendors">) : undefined,
        vendor: chosenVendorName,
        supplierAddress: address.trim() || undefined,
        note: note.trim() || undefined,
        expectedAt: Number.isFinite(expectedDateMs) ? expectedDateMs : undefined,
        status,
        lines: lines.map((l) => ({
          materialId: l.materialId,
          qty: Number(l.qty),
          unitCost: Number(l.unitCost),
        })),
      });

      toast.success(
        `Purchase order created (${status === "ordered" ? "Ordered" : "Draft"}).`,
      );
      onClose();
      onLpoCreated?.(lpoId);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't create the purchase order.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-5">
        <DialogHeader className="gap-1 border-b pb-3">
          <div className="flex items-center gap-2 text-primary">
            <ShoppingCart className="size-5" />
            <DialogTitle className="text-base font-semibold">
              Create Local Purchase Order (LPO)
            </DialogTitle>
          </div>
          <p className="text-xs text-muted-foreground">
            Generate an official purchase order for raw materials selected in
            the costing sheet.
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {/* Vendor selection & Expected Delivery */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="space-y-1">
              <label className="font-medium text-foreground">Vendor / Supplier</label>
              <select
                aria-label="Choose vendor"
                className="w-full h-8 rounded-lg border bg-background px-2 text-xs"
                value={vendorId}
                onChange={(e) => handleVendorSelect(e.target.value)}
              >
                <option value="">— Select a registered vendor —</option>
                {(vendors ?? []).map((v) => (
                  <option key={v._id} value={v._id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="font-medium text-foreground">
                Or custom vendor name
              </label>
              <Input
                type="text"
                placeholder="Supplier or shop name…"
                value={customVendor}
                onChange={(e) => {
                  setCustomVendor(e.target.value);
                  if (vendorId) setVendorId("");
                }}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-foreground">
                Expected Delivery Date
              </label>
              <Input
                type="date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-foreground">Initial Status</label>
              <select
                aria-label="Order status"
                className="w-full h-8 rounded-lg border bg-background px-2 text-xs"
                value={status}
                onChange={(e) => setStatus(e.target.value as "draft" | "ordered")}
              >
                <option value="draft">Draft (Save order for later)</option>
                <option value="ordered">Ordered (Mark as sent to vendor)</option>
              </select>
            </div>
          </div>

          {/* Lines Table */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Order Items ({lines.length})
              </span>
              <span className="text-xs text-muted-foreground">
                Total:{" "}
                <strong className="text-foreground tabular-nums">
                  {money(grandTotal)}
                </strong>
              </span>
            </div>

            <div className="rounded-xl border overflow-hidden bg-card">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50 text-[11px] font-semibold text-muted-foreground text-left">
                    <th className="px-2.5 py-1.5">Material</th>
                    <th className="px-2 py-1.5 w-24 text-right">Qty</th>
                    <th className="px-2 py-1.5 w-16">Unit</th>
                    <th className="px-2 py-1.5 w-24 text-right">Unit Rate</th>
                    <th className="px-2.5 py-1.5 w-28 text-right">Total</th>
                    <th className="px-1 py-1.5 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {lines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-3 py-6 text-center text-xs text-muted-foreground"
                      >
                        No materials selected.
                      </td>
                    </tr>
                  ) : (
                    lines.map((line, idx) => {
                      const amount = (line.qty || 0) * (line.unitCost || 0);
                      const isShort =
                        line.stock !== undefined && line.stock < line.qty;

                      return (
                        <tr key={line.materialId} className="hover:bg-muted/30">
                          <td className="px-2.5 py-1.5 align-middle">
                            <div className="flex flex-col">
                              <span className="font-medium text-foreground">
                                {line.name}
                              </span>
                              {line.stock !== undefined && (
                                <span
                                  className={cn(
                                    "flex items-center gap-1 text-[10px] tabular-nums",
                                    isShort
                                      ? "text-amber-600 dark:text-amber-400 font-medium"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {isShort && (
                                    <AlertTriangle className="size-2.5" />
                                  )}
                                  Stock: {line.stock.toLocaleString()}{" "}
                                  {line.unit}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 align-middle text-right">
                            <Input
                              type="number"
                              min="0.001"
                              step="any"
                              value={line.qty}
                              onChange={(e) =>
                                handleUpdateQty(idx, Number(e.target.value))
                              }
                              className="h-7 w-20 text-right text-xs tabular-nums font-medium ml-auto"
                            />
                          </td>
                          <td className="px-2 py-1.5 align-middle text-muted-foreground">
                            {line.unit || "—"}
                          </td>
                          <td className="px-2 py-1.5 align-middle text-right">
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={line.unitCost}
                              onChange={(e) =>
                                handleUpdateCost(idx, Number(e.target.value))
                              }
                              className="h-7 w-20 text-right text-xs tabular-nums ml-auto"
                            />
                          </td>
                          <td className="px-2.5 py-1.5 align-middle text-right font-semibold tabular-nums text-foreground">
                            {money(amount)}
                          </td>
                          <td className="px-1 py-1.5 align-middle text-center">
                            {lines.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(idx)}
                                className="text-muted-foreground/60 hover:text-destructive p-1 rounded transition-colors"
                                title="Remove line"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1 text-xs">
            <label className="font-medium text-foreground">Notes / Reference</label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Internal notes or instructions for the supplier…"
              className="text-xs resize-none"
            />
          </div>

          {/* Footer actions */}
          <DialogFooter className="flex items-center justify-between gap-2 border-t pt-3 sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Total Order Amount:{" "}
              <strong className="text-sm font-bold text-foreground tabular-nums">
                {money(grandTotal)}
              </strong>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={busy}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={busy || lines.length === 0}
                className="h-8 text-xs gap-1.5"
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ShoppingCart className="size-3.5" />
                )}
                Create LPO ({money(grandTotal)})
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
