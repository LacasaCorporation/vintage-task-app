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
  FileText,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  Save,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { toLocalInput } from "@/lib/task-utils";
import ItemPicker, { type PickerItem } from "@/components/ItemPicker";
import { useAppDialogs } from "@/components/AppDialogs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

type MaterialDoc = Doc<"rawMaterials">;
type LpoDoc = Doc<"lpos">;

type Status = LpoDoc["status"];

const STATUS_STYLE: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  ordered: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  received: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  ordered: "Ordered",
  received: "Received",
  cancelled: "Cancelled",
};

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

/** One line being typed on the order form. */
type DraftLine = { materialId: Id<"rawMaterials"> | ""; qty: string; rate: string };

const emptyLine = (): DraftLine => ({ materialId: "", qty: "1", rate: "" });
const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/**
 * How the panel is asked to open: a blank order, or one saved order in either
 * its own screen or the form. The panel is remounted on this so the form
 * starts from the seed rather than being filled in by an effect.
 */
export type LpoSeed =
  | { mode: "new" }
  | { mode: "edit"; lpoId: Id<"lpos"> }
  | { mode: "view"; lpoId: Id<"lpos"> };

/**
 * The order form, full screen. Raising an order is a page of lines worked on
 * for a while, so it gets the whole working area rather than a dialog over the
 * register. Used for a new order and for editing a saved one.
 */
function LpoForm({
  materials,
  editing,
  canCreate,
  onClose,
  onSaved,
}: {
  materials: MaterialDoc[];
  editing: LpoDoc | null;
  canCreate: boolean;
  onClose: () => void;
  /** Called with the saved order's id, so the panel can show its detail screen. */
  onSaved: (id: Id<"lpos"> | null) => void;
}) {
  const createLpo = useMutation(api.lpo.create);
  const updateLpo = useMutation(api.lpo.update);
  const [vendor, setVendor] = useState(editing?.vendor ?? "");
  const [orderedOn, setOrderedOn] = useState(() =>
    toLocalInput(new Date(editing?.orderedAt ?? Date.now())),
  );
  const [expectedOn, setExpectedOn] = useState(() =>
    editing?.expectedAt !== undefined ? toLocalInput(new Date(editing.expectedAt)) : "",
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [lines, setLines] = useState<DraftLine[]>(
    editing
      ? editing.lines.map((l) => ({
          materialId: l.materialId,
          qty: String(l.qty),
          rate: String(l.unitCost),
        }))
      : [emptyLine()],
  );
  const [send, setSend] = useState(false);
  const [busy, setBusy] = useState(false);
  const { format: money } = useWorkspaceCurrency();

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + num(l.qty) * num(l.rate), 0),
    [lines],
  );

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  /** Blank the form without leaving it. */
  const clear = () => {
    setVendor("");
    setOrderedOn(toLocalInput(new Date()));
    setExpectedOn("");
    setNote("");
    setLines([emptyLine()]);
    setSend(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = lines.filter((l) => l.materialId !== "");
    if (clean.length === 0) {
      toast.error("Add at least one material to the order.");
      return;
    }
    if (clean.some((l) => !(num(l.qty) > 0))) {
      toast.error("Every line needs a quantity above zero.");
      return;
    }
    const payload = {
      vendor: vendor.trim() || undefined,
      orderedAt: new Date(`${orderedOn}T12:00:00`).getTime(),
      expectedAt: expectedOn ? new Date(`${expectedOn}T12:00:00`).getTime() : undefined,
      note: note.trim() || undefined,
      lines: clean.map((l) => ({
        materialId: l.materialId as Id<"rawMaterials">,
        qty: num(l.qty),
        unitCost: num(l.rate),
      })),
    };
    setBusy(true);
    try {
      if (editing) {
        await updateLpo({ id: editing._id, ...payload });
        toast.success(`${editing.number} updated.`);
        onSaved(editing._id);
      } else {
        const id = await createLpo({ ...payload, status: send ? "ordered" : "draft" });
        toast.success(
          send ? "Order raised and marked as sent." : "Order saved as a draft.",
        );
        onSaved(id ?? null);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the order.",
      );
    } finally {
      setBusy(false);
    }
  };

  /** Searchable options for the per-line material pickers. */
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

  return (
    <form onSubmit={submit} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs"
            onClick={onClose}
          >
            <ArrowLeft className="size-3.5" /> Orders
          </Button>
          <h2 className="font-display text-lg font-semibold">
            {editing ? `Edit ${editing.number}` : "New purchase order"}
          </h2>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <p className="hidden font-mono text-xs text-muted-foreground sm:block">
              {editing ? editing.number : "Auto LPO0001…"}
            </p>
            {!editing && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg text-xs"
                onClick={clear}
              >
                Clear
              </Button>
            )}
            <Button type="submit" size="sm" disabled={busy} className="h-8 rounded-lg text-xs">
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {editing ? "Save changes" : send ? "Raise order" : "Save draft"}
            </Button>
          </div>
        )}
      </div>

      <p className="border-b border-border/60 px-5 py-2.5 text-xs text-muted-foreground">
        An order says what you have asked a vendor for. Receiving it puts the
        quantities into raw-material stock.
      </p>

      <div className="grid gap-3 border-b border-border/60 px-5 py-4 sm:grid-cols-3">
        <label className="block">
          <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Vendor
          </span>
          <Input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="e.g. Maida Traders"
            className="mt-1 h-9 rounded-lg text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Ordered on
          </span>
          <Input
            type="date"
            value={orderedOn}
            onChange={(e) => setOrderedOn(e.target.value)}
            className="mt-1 h-9 rounded-lg text-sm"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Expected
          </span>
          <Input
            type="date"
            value={expectedOn}
            onChange={(e) => setExpectedOn(e.target.value)}
            className="mt-1 h-9 rounded-lg text-sm"
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
              <th className="w-32 py-1.5 text-right font-medium">Rate</th>
              <th className="w-32 py-1.5 text-right font-medium">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-border/50">
                <td className="py-2 text-xs text-muted-foreground tabular-nums">{index + 1}</td>
                <td className="py-2 pr-2">
                  <ItemPicker
                    className="w-full"
                    items={materialOptions}
                    value={line.materialId}
                    onChange={(id) => {
                      const materialId = id as Id<"rawMaterials"> | "";
                      const material = materials.find((m) => m._id === materialId);
                      // a different material means the rate on screen was the
                      // previous one's, so take the new one's rate
                      const changed = line.materialId !== materialId;
                      updateLine(index, {
                        materialId,
                        rate:
                          changed && material
                            ? String(material.pricePerUnit)
                            : changed
                              ? ""
                              : line.rate,
                      });
                    }}
                    placeholder="Choose or search material…"
                    searchPlaceholder="Search name, code or category…"
                    emptyLabel="No material matches that."
                    aria-label="Material"
                  />
                </td>
                <td className="py-2">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={line.qty}
                    onChange={(e) => updateLine(index, { qty: e.target.value })}
                    aria-label="Quantity"
                    placeholder="Qty"
                    className="ml-auto block h-9 w-24 rounded-lg text-right text-sm"
                  />
                </td>
                <td className="py-2">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={line.rate}
                    onChange={(e) => updateLine(index, { rate: e.target.value })}
                    aria-label="Rate"
                    placeholder="Rate"
                    className="ml-auto block h-9 w-28 rounded-lg text-right text-sm"
                  />
                </td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {money(num(line.qty) * num(line.rate))}
                </td>
                <td className="py-2 pl-2">
                  <button
                    type="button"
                    aria-label="Remove line"
                    onClick={() =>
                      setLines((current) =>
                        current.length === 1
                          ? [emptyLine()]
                          : current.filter((_, x) => x !== index),
                      )
                    }
                    className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                  >
                    <X className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setLines((current) => [...current, emptyLine()])}
          className="mt-2 h-8 rounded-lg px-2.5 text-xs"
        >
          <Plus className="size-3.5" /> Add line
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4 border-t border-border/60 px-5 py-4">
        <label className="block min-w-[240px] flex-1">
          <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Note
          </span>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Terms, delivery instructions…"
            className="mt-1"
          />
        </label>
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-6 text-muted-foreground">
            <span>Items</span>
            <span className="tabular-nums">
              {lines.filter((l) => l.materialId !== "").length}
            </span>
          </div>
          <div className="flex items-center justify-between gap-6 border-t border-border pt-2 text-base font-semibold">
            <span>Order total</span>
            <span className="tabular-nums">{money(subtotal)}</span>
          </div>
          {!editing && (
            <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={send}
                onChange={(e) => setSend(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              Mark as sent to the vendor
            </label>
          )}
        </div>
      </div>
    </form>
  );
}

/**
 * Purchase orders: what has been asked of a vendor and what has landed. The
 * order is a page of its own — the register, the full-screen form, and the
 * order's detail screen — rather than a dialog over the register, because an
 * order is filled in line by line and then travelled through its statuses.
 *
 * The goods come in exactly once — either as a plain receipt, or as a bill
 * raised from the order — so the stock is never counted twice for one
 * delivery.
 */
export default function LpoPanel({
  materials,
  canCreate,
  canEdit,
  canDelete,
  seed = null,
  onCreateBill,
  billNumberOf,
}: {
  materials: MaterialDoc[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Opens the panel on a particular screen instead of the register. */
  seed?: LpoSeed | null;
  /** Opens the bill form pre-filled from this order's lines. */
  onCreateBill: (lpo: LpoDoc) => void;
  /** The bill number an order was raised into, so it can be named. */
  billNumberOf?: (billId: Id<"purchases">) => string | undefined;
}) {
  const lpos = useQuery(api.lpo.list);
  const { confirm } = useAppDialogs();
  const { format: money } = useWorkspaceCurrency();
  const setStatus = useMutation(api.lpo.setStatus);
  const receive = useMutation(api.lpo.receive);
  const removeLpo = useMutation(api.lpo.remove);

  // the two screens this panel can show besides the register
  const [formOpen, setFormOpen] = useState(
    canCreate && seed !== null && seed.mode !== "view",
  );
  const [editingId, setEditingId] = useState<Id<"lpos"> | null>(
    seed !== null && seed.mode === "edit" ? seed.lpoId : null,
  );
  const [viewingId, setViewingId] = useState<Id<"lpos"> | null>(
    seed !== null && seed.mode === "view" ? seed.lpoId : null,
  );
  const [busy, setBusy] = useState<Id<"lpos"> | null>(null);

  const open = useMemo(
    () => (lpos ?? []).filter((l) => l.status !== "cancelled"),
    [lpos],
  );
  const onOrder = open.filter((l) => l.status === "ordered").length;
  const committed = open
    .filter((l) => l.status === "ordered")
    .reduce((sum, l) => sum + l.total, 0);

  const viewed = lpos?.find((l) => l._id === viewingId) ?? null;
  const editing = lpos?.find((l) => l._id === editingId) ?? null;

  const act = async (id: Id<"lpos">, run: () => Promise<unknown>, message: string) => {
    setBusy(id);
    try {
      await run();
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the order.");
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async (lpo: LpoDoc) => {
    const ok = await confirm({
      title: `Delete ${lpo.number}?`,
      message:
        "The order is removed from the register. If its goods were never received there is no stock to adjust.",
      confirmLabel: "Delete order",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeLpo({ id: lpo._id });
      if (viewingId === lpo._id) setViewingId(null);
      toast.success(`${lpo.number} deleted.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the order.");
    }
  };

  /* ── the order form, full-screen ───────────────────────────────── */
  if (formOpen) {
    // the order being edited hasn't loaded yet — wait for it rather than
    // showing a blank form that would overwrite it on save
    if (editingId !== null && editing === null) {
      return (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading order…
          </div>
        </section>
      );
    }
    return (
      <LpoForm
        key={editingId ?? "new"}
        materials={materials}
        editing={editing}
        canCreate={canCreate}
        onClose={() => {
          setEditingId(null);
          setFormOpen(false);
        }}
        onSaved={(id) => {
          setEditingId(null);
          setFormOpen(false);
          if (id !== null) setViewingId(id);
        }}
      />
    );
  }

  /* ── one order's detail screen ─────────────────────────────────── */
  if (viewed !== null) {
    const billable = viewed.status !== "received" && viewed.status !== "cancelled";
    return (
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Purchase order
            </p>
            <h2 className="font-display font-mono text-lg font-semibold">
              {viewed.number}
            </h2>
            <p className="text-xs text-muted-foreground">
              {viewed.vendor || "No vendor"} · ordered {day(viewed.orderedAt)}
              {viewed.expectedAt !== undefined ? ` · expected ${day(viewed.expectedAt)}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                STATUS_STYLE[viewed.status],
              )}
            >
              {STATUS_LABEL[viewed.status]}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setViewingId(null)}
              className="h-8 rounded-lg text-xs"
            >
              <ArrowLeft className="size-3.5" /> Orders
            </Button>
            {viewed.status === "draft" && canEdit && (
              <Button
                type="button"
                size="sm"
                disabled={busy === viewed._id}
                onClick={() =>
                  void act(
                    viewed._id,
                    () => setStatus({ id: viewed._id, status: "ordered" }),
                    `${viewed.number} marked as sent.`,
                  )
                }
                className="h-8 rounded-lg text-xs"
              >
                <Send className="size-3.5" /> Mark as sent
              </Button>
            )}
            {billable && canEdit && (
              <Button
                type="button"
                size="sm"
                onClick={() => onCreateBill(viewed)}
                title="Open the bill form with these lines filled in — saving it brings the stock in"
                className="h-8 rounded-lg text-xs text-emerald-600 hover:text-emerald-600"
              >
                <FileText className="size-3.5" /> Bill
              </Button>
            )}
            {billable && canEdit && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy === viewed._id}
                onClick={() =>
                  void act(
                    viewed._id,
                    () => receive({ id: viewed._id }),
                    `${viewed.number} received — stock updated.`,
                  )
                }
                title="Goods are here but there is no bill yet"
                className="h-8 rounded-lg text-xs"
              >
                {busy === viewed._id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <PackageCheck className="size-3.5" />
                )}
                Receive
              </Button>
            )}
            {viewed.status !== "received" &&
              viewed.billId === undefined &&
              canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingId(viewed._id);
                    setFormOpen(true);
                  }}
                  className="h-8 rounded-lg text-xs"
                >
                  <Pencil className="size-3.5" /> Edit
                </Button>
              )}
            {viewed.billId !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                <FileText className="size-3" />
                {billNumberOf?.(viewed.billId) ?? "billed"}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Vendor
            </p>
            <p className="text-sm">{viewed.vendor || "—"}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Ordered
            </p>
            <p className="text-sm">{day(viewed.orderedAt)}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Expected
            </p>
            <p className="text-sm">
              {viewed.expectedAt !== undefined ? day(viewed.expectedAt) : "—"}
            </p>
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
            {viewed.note || "No notes on this order."}
          </p>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-8 text-muted-foreground">
              <span>Items</span>
              <span className="tabular-nums">{viewed.lines.length}</span>
            </div>
            <div className="flex items-center justify-between gap-8 border-t border-border pt-2 text-base font-semibold">
              <span>Order total</span>
              <span className="tabular-nums">{money(viewed.total)}</span>
            </div>
          </div>
        </div>

        {canDelete && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 px-5 py-3">
            {viewed.status === "ordered" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy === viewed._id}
                onClick={() =>
                  void act(
                    viewed._id,
                    () => setStatus({ id: viewed._id, status: "cancelled" }),
                    `${viewed.number} cancelled.`,
                  )
                }
                className="h-9 rounded-lg text-xs"
              >
                Cancel order
              </Button>
            )}
            {viewed.status !== "received" && viewed.billId === undefined && (
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
          Purchase orders
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {open.length} open · {onOrder} with vendors · {money(committed)} committed
          </span>
        </h2>
        {canCreate && (
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setEditingId(null);
              setFormOpen(true);
            }}
            className="h-9 rounded-xl px-3 text-sm"
          >
            <Plus className="size-4" /> Add order
          </Button>
        )}
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {lpos === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading orders…
          </div>
        ) : lpos.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <ClipboardList className="mx-auto size-7 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">No purchase orders yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Raise an order for what you need, then receive it when it lands — the
              stock follows automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  <th className="w-28 px-3 py-2">Order</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="w-24 px-3 py-2">Ordered</th>
                  <th className="w-24 px-3 py-2">Expected</th>
                  <th className="w-16 px-3 py-2 text-right">Items</th>
                  <th className="w-28 px-3 py-2 text-right">Total</th>
                  <th className="w-28 px-3 py-2">Status</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {lpos.map((l) => {
                  const editable = l.status !== "received" && l.billId === undefined;
                  return (
                    <tr
                      key={l._id}
                      className={cn(
                        "transition-colors hover:bg-accent/40",
                        l.status === "cancelled" && "opacity-60",
                      )}
                    >
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setViewingId(l._id)}
                          className="font-mono text-xs font-medium hover:text-primary hover:underline"
                        >
                          {l.number}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium">{l.vendor || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {day(l.orderedAt)}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {l.expectedAt !== undefined ? day(l.expectedAt) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {l.lines.length}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(l.total)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            STATUS_STYLE[l.status],
                          )}
                        >
                          {STATUS_LABEL[l.status]}
                        </span>
                        {l.billId !== undefined && (
                          <span className="mt-0.5 block font-mono text-[10px] text-muted-foreground">
                            {billNumberOf?.(l.billId) ?? "billed"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <span className="inline-flex items-center gap-1">
                          {l.status === "draft" && canCreate && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy === l._id}
                              onClick={() =>
                                void act(
                                  l._id,
                                  () => setStatus({ id: l._id, status: "ordered" }),
                                  `${l.number} marked as sent.`,
                                )
                              }
                              className="h-7 rounded-lg px-2 text-xs"
                            >
                              <Send className="size-3" /> Send
                            </Button>
                          )}
                          {l.status !== "received" &&
                            l.status !== "cancelled" &&
                            canEdit && (
                              <>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => onCreateBill(l)}
                                  title="Open the bill form with these lines filled in — saving it brings the stock in"
                                  className="h-7 rounded-lg px-2 text-xs text-emerald-600 hover:text-emerald-600"
                                >
                                  <FileText className="size-3" /> Bill
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={busy === l._id}
                                  onClick={() =>
                                    void act(
                                      l._id,
                                      () => receive({ id: l._id }),
                                      `${l.number} received — stock updated.`,
                                    )
                                  }
                                  title="Goods are here but there is no bill yet"
                                  className="h-7 rounded-lg px-2 text-xs"
                                >
                                  {busy === l._id ? (
                                    <Loader2 className="size-3 animate-spin" />
                                  ) : (
                                    <PackageCheck className="size-3" />
                                  )}
                                  Receive
                                </Button>
                              </>
                            )}
                          {editable && canEdit && (
                            <button
                              type="button"
                              aria-label={`Edit ${l.number}`}
                              title="Edit order"
                              onClick={() => {
                                setEditingId(l._id);
                                setFormOpen(true);
                              }}
                              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          )}
                          {l.status === "ordered" && canDelete && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy === l._id}
                              onClick={() =>
                                void act(
                                  l._id,
                                  () => setStatus({ id: l._id, status: "cancelled" }),
                                  `${l.number} cancelled.`,
                                )
                              }
                              className="h-7 rounded-lg px-2 text-xs"
                            >
                              Cancel
                            </Button>
                          )}
                          {editable && canDelete && (
                            <button
                              type="button"
                              aria-label={`Delete ${l.number}`}
                              disabled={busy === l._id}
                              onClick={() => void confirmDelete(l)}
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