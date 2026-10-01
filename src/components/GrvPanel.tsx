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
  Loader2,
  PackageCheck,
  Plus,
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

type MaterialDoc = Doc<"rawMaterials">;
type GrvRow = Doc<"grvs"> & { lpoNumber?: string };

type DraftLine = { materialId: Id<"rawMaterials"> | ""; qty: string; rate: string };
const emptyLine = (): DraftLine => ({ materialId: "", qty: "1", rate: "" });
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
}: {
  materials: MaterialDoc[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  seed?: { lpoId?: Id<"lpos"> } | null;
}) {
  const grvs = useQuery(api.grv.list);
  const options = useQuery(api.grv.options);
  const vendors = useQuery(api.contacts.listVendors);
  const { format: money } = useWorkspaceCurrency();
  const { confirm } = useAppDialogs();
  const createGrv = useMutation(api.grv.create);
  const receiveGrv = useMutation(api.grv.receive);
  const removeGrv = useMutation(api.grv.remove);

  const [formOpen, setFormOpen] = useState(seed !== null && canCreate);
  const [vendorId, setVendorId] = useState<Id<"vendors"> | "">("");
  const [receivedOn, setReceivedOn] = useState(() => toLocalInput(new Date()));
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [lpoId, setLpoId] = useState<Id<"lpos"> | "">(seed?.lpoId ?? "");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);
  const [busy, setBusy] = useState(false);
  const [busyRow, setBusyRow] = useState<Id<"grvs"> | null>(null);

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
    setVendorId("");
    setReceivedOn(toLocalInput(new Date()));
    setReference("");
    setNote("");
    setLpoId("");
    setLines([emptyLine()]);
  };

  /** Choosing an order fills the vendor and copies its lines in. */
  const pickLpo = (id: string) => {
    setLpoId(id as Id<"lpos"> | "");
    if (id === "") return;
    const lpo = openLpos.find((l) => l.id === id);
    if (lpo === undefined) return;
    const match = (vendors ?? []).find((v) => v.name === (lpo.vendor ?? ""));
    if (match) setVendorId(match._id);
    if (lpo.lines.length > 0) {
      setLines(
        lpo.lines.map((line) => ({
          materialId: line.materialId,
          qty: String(line.qty),
          rate: String(line.unitCost),
        })),
      );
    }
  };

  const submit = async (status: "draft" | "received") => {
    const valid = lines.filter((l) => l.materialId !== "" && num(l.qty) > 0);
    if (valid.length === 0) {
      toast.error("Add at least one material and a quantity.");
      return;
    }
    setBusy(true);
    try {
      await createGrv({
        vendorId: vendorId === "" ? undefined : vendorId,
        vendor: (vendors ?? []).find((v) => v._id === vendorId)?.name,
        receivedAt: new Date(`${receivedOn}T12:00:00`).getTime(),
        lpoId: lpoId === "" ? undefined : lpoId,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        status,
        lines: valid.map((l) => ({
          materialId: l.materialId as Id<"rawMaterials">,
          qty: num(l.qty),
          unitCost: num(l.rate),
        })),
      });
      toast.success(
        status === "received"
          ? "Voucher saved — the goods are in stock."
          : "Voucher saved as a draft.",
      );
      resetForm();
      setFormOpen(false);
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
            <h2 className="font-display text-lg font-semibold">New goods received</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
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
              disabled={busy}
              onClick={() => void submit("received")}
              className="h-8 rounded-lg text-xs"
            >
              <PackageCheck className="size-3.5" /> Save &amp; count in
            </Button>
          </div>
        </div>

        <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Supplier</span>
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value as Id<"vendors"> | "")}
              className={FIELD}
            >
              <option value="">Choose a supplier…</option>
              {(vendors ?? []).map((v) => (
                <option key={v._id} value={v._id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Against an order (optional)</span>
            <select value={lpoId} onChange={(e) => pickLpo(e.target.value)} className={FIELD}>
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
                const material = materials.find((m) => m._id === line.materialId);
                return (
                  <tr key={index} className="border-b border-border/50">
                    <td className="py-2 text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </td>
                    <td className="py-2 pr-2">
                      <ItemPicker
                        items={materialOptions}
                        value={line.materialId}
                        onChange={(id) => {
                          updateLine(index, {
                            materialId: id as Id<"rawMaterials"> | "",
                            rate:
                              line.rate ||
                              String(
                                materials.find((m) => m._id === id)?.pricePerUnit ?? "",
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
          <div className="flex items-end justify-end text-sm">
            <span className="mr-3 text-muted-foreground">Value</span>
            <span className="text-base font-semibold tabular-nums">
              {money(subtotal)}
            </span>
          </div>
        </div>
      </div>
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
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="w-32 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {grvs.map((g) => {
                  const row = g as GrvRow;
                  return (
                    <tr key={row._id} className="transition-colors hover:bg-accent/40">
                      <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">
                        {row.number}
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
                          {row.status === "draft" && canEdit && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busyRow === row._id}
                              onClick={() => void receive(row)}
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
                              onClick={() => void confirmRemove(row)}
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
