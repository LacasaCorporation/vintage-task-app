import { Fragment, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ClipboardList,
  FileText,
  Loader2,
  PackageCheck,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { toLocalInput } from "@/lib/task-utils";
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

/** The raise-an-order form, used for both a new LPO and editing one. */
function LpoForm({
  materials,
  editing,
  onClose,
}: {
  materials: MaterialDoc[];
  editing: LpoDoc | null;
  onClose: () => void;
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

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + num(l.qty) * num(l.rate), 0),
    [lines],
  );

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const submit = async () => {
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
      } else {
        await createLpo({ ...payload, status: send ? "ordered" : "draft" });
        toast.success(
          send ? "Order raised and marked as sent." : "Order saved as a draft.",
        );
      }
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the order.",
      );
    } finally {
      setBusy(false);
    }
  };

  const selectCls =
    "h-9 rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-[min(100%,720px)]">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.number}` : "New purchase order"}</DialogTitle>
          <DialogDescription>
            An order says what you have asked a vendor for. Receiving it puts the
            quantities into raw-material stock.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs font-medium sm:col-span-1">
            <span className="text-muted-foreground">Vendor</span>
            <Input
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. Maida Traders"
              className="h-9"
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Ordered on</span>
            <Input
              type="date"
              value={orderedOn}
              onChange={(e) => setOrderedOn(e.target.value)}
              className="h-9"
            />
          </label>
          <label className="space-y-1 text-xs font-medium">
            <span className="text-muted-foreground">Expected</span>
            <Input
              type="date"
              value={expectedOn}
              onChange={(e) => setExpectedOn(e.target.value)}
              className="h-9"
            />
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Items
          </p>
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={line.materialId}
                onChange={(e) => {
                  const materialId = e.target.value as Id<"rawMaterials"> | "";
                  const material = materials.find((m) => m._id === materialId);
                  updateLine(i, {
                    materialId,
                    rate:
                      material && line.rate === ""
                        ? String(material.pricePerUnit)
                        : line.rate,
                  });
                }}
                aria-label="Material"
                className={cn(selectCls, "min-w-0 flex-1")}
              >
                <option value="">Choose a material…</option>
                {materials.map((m) => (
                  <option key={m._id} value={m._id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                min="0"
                step="any"
                value={line.qty}
                onChange={(e) => updateLine(i, { qty: e.target.value })}
                aria-label="Quantity"
                placeholder="Qty"
                className="h-9 w-24 text-right"
              />
              <Input
                type="number"
                min="0"
                step="any"
                value={line.rate}
                onChange={(e) => updateLine(i, { rate: e.target.value })}
                aria-label="Rate"
                placeholder="Rate"
                className="h-9 w-28 text-right"
              />
              <button
                type="button"
                aria-label="Remove line"
                onClick={() =>
                  setLines((current) =>
                    current.length === 1 ? [emptyLine()] : current.filter((_, x) => x !== i),
                  )
                }
                className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setLines((current) => [...current, emptyLine()])}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            <Plus className="size-3.5" /> Add line
          </Button>
        </div>

        <label className="space-y-1 text-xs font-medium">
          <span className="text-muted-foreground">Note</span>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Terms, delivery instructions…"
          />
        </label>

        <p className="text-right text-sm">
          <span className="text-muted-foreground">Order total </span>
          <span className="font-semibold tabular-nums">
            {subtotal.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </p>

        <DialogFooter>
          {!editing && (
            <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={send}
                onChange={(e) => setSend(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              Mark as sent to the vendor
            </label>
          )}
          <Button type="button" variant="outline" onClick={onClose} className="rounded-lg">
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {editing ? "Save changes" : send ? "Raise order" : "Save draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Local purchase orders: what has been asked of a vendor and what has landed.
 * The goods come in exactly once — either as a plain receipt, or as a bill
 * raised from the order — so the stock is never counted twice for one
 * delivery.
 */
export default function LpoPanel({
  materials,
  canCreate,
  canEdit,
  canDelete,
  formOpen,
  onFormOpenChange,
  onCreateBill,
  billNumberOf,
}: {
  materials: MaterialDoc[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
  /** Opens the bill form pre-filled from this order's lines. */
  onCreateBill: (lpo: LpoDoc) => void;
  /** The bill number an order was raised into, so the row can name it. */
  billNumberOf: (billId: Id<"purchases">) => string | undefined;
}) {
  const lpos = useQuery(api.lpo.list);
  const { format: money } = useWorkspaceCurrency();
  const setStatus = useMutation(api.lpo.setStatus);
  const receive = useMutation(api.lpo.receive);
  const removeLpo = useMutation(api.lpo.remove);
  const [editing, setEditing] = useState<LpoDoc | null>(null);
  const [expanded, setExpanded] = useState<Id<"lpos"> | null>(null);
  const [busy, setBusy] = useState<Id<"lpos"> | null>(null);

  const open = useMemo(
    () => (lpos ?? []).filter((l) => l.status !== "cancelled"),
    [lpos],
  );
  const onOrder = open.filter((l) => l.status === "ordered").length;
  const committed = open
    .filter((l) => l.status === "ordered")
    .reduce((sum, l) => sum + l.total, 0);

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

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <h2 className="text-sm font-semibold">
            Purchase orders
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {open.length} open · {onOrder} with vendors · {money(committed)} committed
            </span>
          </h2>
        </div>

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
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  <th className="w-8 px-2 py-2" />
                  <th className="w-24 px-3 py-2">Order</th>
                  <th className="px-3 py-2">Vendor</th>
                  <th className="w-24 px-3 py-2">Ordered</th>
                  <th className="w-24 px-3 py-2">Expected</th>
                  <th className="w-16 px-3 py-2 text-right">Items</th>
                  <th className="w-28 px-3 py-2 text-right">Total</th>
                  <th className="w-24 px-3 py-2">Status</th>
                  <th className="w-72 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {lpos.map((l) => (
                  <Fragment key={l._id}>
                    <tr className="transition-colors hover:bg-accent/40">
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === l._id ? null : l._id)}
                          aria-expanded={expanded === l._id}
                          aria-label={`${expanded === l._id ? "Hide" : "Show"} items on ${l.number}`}
                          className="grid size-5 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <span
                            className={cn(
                              "text-xs leading-none transition-transform",
                              expanded === l._id && "rotate-90",
                            )}
                          >
                            ›
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{l.number}</td>
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
                            {billNumberOf(l.billId) ?? "billed"}
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
                          {l.status !== "received" && l.status !== "cancelled" && canEdit && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                disabled={busy === l._id}
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
                          {l.status !== "received" && l.status !== "cancelled" && l.billId === undefined && canEdit && (
                            <button
                              type="button"
                              aria-label={`Edit ${l.number}`}
                              title="Edit order"
                              onClick={() => setEditing(l)}
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
                          {l.status !== "received" && l.billId === undefined && canDelete && (
                            <button
                              type="button"
                              aria-label={`Delete ${l.number}`}
                              disabled={busy === l._id}
                              onClick={() =>
                                void act(l._id, () => removeLpo({ id: l._id }), `${l.number} deleted.`)
                              }
                              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                    {expanded === l._id && (
                      <tr>
                        <td colSpan={9} className="bg-muted/25 px-4 py-2.5">
                          <table className="w-full text-xs">
                            <tbody className="divide-y divide-border/40">
                              {l.lines.map((line) => (
                                <tr key={line.materialId}>
                                  <td className="py-1 font-medium">{line.name}</td>
                                  <td className="w-28 py-1 text-right tabular-nums text-muted-foreground">
                                    {line.qty} {line.unit}
                                  </td>
                                  <td className="w-28 py-1 text-right tabular-nums text-muted-foreground">
                                    @ {money(line.unitCost)}
                                  </td>
                                  <td className="w-28 py-1 text-right tabular-nums">
                                    {money(line.qty * line.unitCost)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {l.note && (
                            <p className="mt-2 text-[11px] text-muted-foreground">{l.note}</p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(formOpen || editing !== null) && canCreate && (
        <LpoForm
          key={editing?._id ?? "new"}
          materials={materials}
          editing={editing}
          onClose={() => {
            setEditing(null);
            onFormOpenChange(false);
          }}
        />
      )}
    </div>
  );
}
