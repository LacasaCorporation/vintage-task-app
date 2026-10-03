import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Receipt,
  Save,
  Send,
  ShoppingCart,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { toLocalInput } from "@/lib/task-utils";
import ItemPicker, { type PickerItem } from "@/components/ItemPicker";
import { useAppDialogs } from "@/components/AppDialogs";
import SalesPageHeading from "@/components/SalesPageHeading";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

type OrderDoc = Doc<"salesOrders">;
type Status = OrderDoc["status"];

const STATUS_STYLE: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  ordered: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  invoiced: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

const STATUS_LABEL: Record<Status, string> = {
  draft: "Draft",
  ordered: "Confirmed",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const num = (value: string) => (Number.isFinite(Number(value)) ? Number(value) : 0);

type DraftLine = { productId: Id<"finishedGoods"> | ""; qty: string; price: string };

const emptyLine = (): DraftLine => ({ productId: "", qty: "1", price: "" });

const FIELD =
  "text-[11px] font-semibold tracking-widest text-muted-foreground uppercase";
const selectCls =
  "mt-1 h-9 w-full rounded-lg border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

/**
 * How the panel is asked to open: a blank order, one raised from an accepted
 * quotation, or a saved order in either its own screen or the form. The panel
 * is remounted on this so the form starts from the seed rather than being
 * filled in by an effect.
 */
export type SalesOrderSeed =
  | { mode: "new" }
  | { mode: "fromQuotation"; quotation: Doc<"quotations"> }
  | { mode: "edit"; orderId: Id<"salesOrders"> }
  | { mode: "view"; orderId: Id<"salesOrders"> };

/** The order form, full screen — the same page shape as the purchase order. */
function SalesOrderForm({
  editing,
  seedQuotation,
  canCreate,
  onClose,
  onSaved,
}: {
  editing: OrderDoc | null;
  /** A quotation this order is being confirmed from. */
  seedQuotation: Doc<"quotations"> | null;
  canCreate: boolean;
  onClose: () => void;
  onSaved: (id: Id<"salesOrders"> | null) => void;
}) {
  const createOrder = useMutation(api.salesOrders.create);
  const updateOrder = useMutation(api.salesOrders.update);
  const customers = useQuery(api.contacts.listCustomers);
  const products = useQuery(api.costing.listFinishedGoods);
  const priceList = useQuery(api.sales.priceList);
  const { format: money } = useWorkspaceCurrency();
  const priceOf = useMemo(
    () => new Map((priceList ?? []).map((e) => [e.productId, e.price])),
    [priceList],
  );

  const [customerId, setCustomerId] = useState<Id<"customers"> | "">(
    editing?.customerId ?? "",
  );
  const [customerName, setCustomerName] = useState(
    editing?.customerName ?? seedQuotation?.customerName ?? "",
  );
  const [orderedOn, setOrderedOn] = useState(() =>
    toLocalInput(new Date(editing?.orderedAt ?? Date.now())),
  );
  const [expectedOn, setExpectedOn] = useState(() =>
    editing?.expectedAt !== undefined ? toLocalInput(new Date(editing.expectedAt)) : "",
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [poRef, setPoRef] = useState(editing?.poRef ?? "");
  const [discount, setDiscount] = useState(
    String(editing?.discountPct ?? seedQuotation?.discountPct ?? 0),
  );
  const [tax, setTax] = useState(String(editing?.taxPct ?? seedQuotation?.taxPct ?? 0));
  const [lines, setLines] = useState<DraftLine[]>(() => {
    const source = editing?.lines ?? seedQuotation?.lines ?? [];
    return source.length > 0
      ? source.map((l) => ({
          productId: l.productId,
          qty: String(l.qty),
          price: String(l.unitPrice),
        }))
      : [emptyLine()];
  });
  const [send, setSend] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => products ?? [], [products]);
  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + num(l.qty) * num(l.price), 0),
    [lines],
  );
  const discountAmount = (subtotal * num(discount)) / 100;
  const grandTotal = subtotal - discountAmount + ((subtotal - discountAmount) * num(tax)) / 100;

  /**
   * The product's whole identity on one row — name, code · category · stock
   * on hand, and the rate per unit — so an order is priced from the product
   * list rather than from memory. Quotations and invoices use the same shape.
   */
  const productOptions = useMemo<PickerItem[]>(
    () =>
      rows.map((p) => {
        const price = priceOf.get(p._id) ?? 0;
        const unit = p.unit?.trim() || "unit";
        return {
          id: p._id,
          label: p.name,
          sub:
            [
              p.code,
              p.category,
              `${(p.stock ?? 0).toLocaleString()} ${unit} in stock`,
            ]
              .filter((v) => !!v && v !== "")
              .join(" · ") || undefined,
          hint: price > 0 ? `${money(price)}/${unit}` : `per ${unit}`,
          keywords: p.subCategory ?? "",
        };
      }),
    [rows, money, priceOf],
  );

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line, i) => (i === index ? { ...line, ...patch } : line)),
    );

  const clear = () => {
    setCustomerId("");
    setCustomerName("");
    setOrderedOn(toLocalInput(new Date()));
    setExpectedOn("");
    setNote("");
    setPoRef("");
    setDiscount("0");
    setTax("0");
    setLines([emptyLine()]);
    setSend(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = lines.filter((l) => l.productId !== "");
    if (clean.length === 0) {
      toast.error("Add at least one product to the order.");
      return;
    }
    if (clean.some((l) => !(num(l.qty) > 0))) {
      toast.error("Every line needs a quantity above zero.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        customerId: customerId === "" ? undefined : customerId,
        customerName: customerName.trim() || undefined,
        orderedAt: new Date(`${orderedOn}T12:00:00`).getTime(),
        expectedAt: expectedOn ? new Date(`${expectedOn}T12:00:00`).getTime() : undefined,
        note: note.trim() || undefined,
        poRef: poRef.trim() || undefined,
        discountPct: num(discount) || undefined,
        taxPct: num(tax) || undefined,
        lines: clean.map((l) => ({
          productId: l.productId as Id<"finishedGoods">,
          qty: num(l.qty),
          unitPrice: num(l.price),
        })),
      };
      if (editing) {
        await updateOrder({ id: editing._id, ...payload });
        toast.success(`${editing.number} updated.`);
        onSaved(editing._id);
      } else {
        const id = await createOrder({
          ...payload,
          status: send ? "ordered" : "draft",
          quotationId: seedQuotation?._id,
        });
        toast.success(send ? "Order confirmed." : "Order saved as a draft.");
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

  return (
    <form
      onSubmit={submit}
      className="overflow-hidden rounded-2xl border bg-card shadow-sm"
    >
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
            {editing ? `Edit ${editing.number}` : "New sales order"}
          </h2>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2">
            <p className="hidden font-mono text-xs text-muted-foreground sm:block">
              {editing ? editing.number : "Auto SO0001…"}
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
            <Button
              type="submit"
              size="sm"
              disabled={busy}
              className="h-8 rounded-lg text-xs"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {editing ? "Save changes" : send ? "Confirm order" : "Save draft"}
            </Button>
          </div>
        )}
      </div>

      {seedQuotation !== null && (
        <p className="flex items-center gap-2 border-b border-border/60 bg-emerald-500/[0.07] px-5 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="size-3.5 shrink-0" />
          Confirmed from quotation{" "}
          <span className="font-mono font-medium">{seedQuotation.number}</span> —
          the quote is not raised twice.
        </p>
      )}

      <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className={FIELD}>Customer</span>
          <select
            value={customerId}
            onChange={(e) => {
              const id = e.target.value as Id<"customers"> | "";
              setCustomerId(id);
              const found = (customers ?? []).find((c) => c._id === id);
              if (found) setCustomerName(found.name);
            }}
            className={selectCls}
          >
            <option value="">Walk-in / not listed</option>
            {(customers ?? []).map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={FIELD}>Ordered on</span>
          <Input
            type="date"
            value={orderedOn}
            onChange={(e) => setOrderedOn(e.target.value)}
            className="mt-1 h-9 rounded-lg text-sm"
          />
        </label>
        <label className="block">
          <span className={FIELD}>Expected</span>
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
              <th className="py-1.5 text-left font-medium">Product</th>
              <th className="w-24 py-1.5 text-right font-medium">Qty</th>
              <th className="w-32 py-1.5 text-right font-medium">Price</th>
              <th className="w-32 py-1.5 text-right font-medium">Amount</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="border-b border-border/50">
                <td className="py-2 text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </td>
                <td className="py-2 pr-2">
                  <ItemPicker
                    className="w-full"
                    items={productOptions}
                    value={line.productId}
                    onChange={(id) => {
                      const productId = id as Id<"finishedGoods"> | "";
                      const product = rows.find((p) => p._id === productId);
                      updateLine(index, {
                        productId,
                        price:
                          product && line.price === ""
                            ? String(priceOf.get(product._id) ?? 0)
                            : line.price,
                      });
                    }}
                    placeholder="Choose or search product…"
                    searchPlaceholder="Search name or code…"
                    emptyLabel="No product matches that."
                    aria-label="Product"
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
                    value={line.price}
                    onChange={(e) => updateLine(index, { price: e.target.value })}
                    aria-label="Price"
                    placeholder="Price"
                    className="ml-auto block h-9 w-28 rounded-lg text-right text-sm"
                  />
                </td>
                <td className="py-2 text-right font-medium tabular-nums">
                  {money(num(line.qty) * num(line.price))}
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
        <div className="min-w-[240px] flex-1 space-y-3">
          <label className="block">
            <span className={FIELD}>Note</span>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Terms, delivery instructions…"
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className={FIELD}>Customer's reference</span>
            <Input
              value={poRef}
              onChange={(e) => setPoRef(e.target.value)}
              placeholder="Their PO number"
              className="mt-1 h-9 rounded-lg text-sm"
            />
          </label>
        </div>
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-6 text-muted-foreground">
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
                onChange={(e) => setTax(e.target.value)}
                aria-label="Tax percent"
                className="h-7 w-16 rounded-md text-right text-xs tabular-nums"
              />
              %
            </span>
            <span className="tabular-nums">
              + {money(((subtotal - discountAmount) * num(tax)) / 100)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-6 border-t border-border pt-2 text-base font-semibold">
            <span>Order total</span>
            <span className="tabular-nums">{money(grandTotal)}</span>
          </div>
          {!editing && (
            <label className="flex items-center gap-2 pt-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={send}
                onChange={(e) => setSend(e.target.checked)}
                className="size-3.5 accent-primary"
              />
              The customer has confirmed this order
            </label>
          )}
        </div>
      </div>
    </form>
  );
}

/**
 * Sales orders: what the customer has confirmed they will take.
 *
 * The register, the full-screen order form and the order's own screen. An
 * order moves no money and touches no stock — invoicing it does both — so the
 * page is the place the commitment is recorded and then handed on.
 */
export default function SalesOrdersPanel({
  canCreate,
  canEdit,
  canDelete,
  seed = null,
  onInvoiced,
}: {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Opens the panel on a particular screen instead of the register. */
  seed?: SalesOrderSeed | null;
  /** Called after an order is invoiced, so the caller can show the invoices. */
  onInvoiced?: () => void;
}) {
  const orders = useQuery(api.salesOrders.list);
  const setStatus = useMutation(api.salesOrders.setStatus);
  const convert = useMutation(api.salesOrders.convertToInvoice);
  const removeOrder = useMutation(api.salesOrders.remove);
  const { confirm } = useAppDialogs();
  const { format: money } = useWorkspaceCurrency();

  // the two screens this panel can show besides the register
  const [formOpen, setFormOpen] = useState(
    canCreate && seed !== null && seed.mode !== "view",
  );
  const [editingId, setEditingId] = useState<Id<"salesOrders"> | null>(
    seed !== null && seed.mode === "edit" ? seed.orderId : null,
  );
  const [viewingId, setViewingId] = useState<Id<"salesOrders"> | null>(
    seed !== null && seed.mode === "view" ? seed.orderId : null,
  );
  const [busy, setBusy] = useState<Id<"salesOrders"> | null>(null);
  const seedQuotation =
    seed !== null && seed.mode === "fromQuotation" ? seed.quotation : null;

  const open = useMemo(
    () => (orders ?? []).filter((o) => o.status !== "cancelled"),
    [orders],
  );
  const committed = open
    .filter((o) => o.status === "ordered")
    .reduce((sum, o) => sum + o.total, 0);
  const viewed = orders?.find((o) => o._id === viewingId) ?? null;
  const editing = orders?.find((o) => o._id === editingId) ?? null;

  const invoice = async (order: OrderDoc) => {
    await act(
      order._id,
      () => convert({ id: order._id }),
      `${order.number} invoiced — stock updated.`,
    );
    onInvoiced?.();
  };

  const act = async (
    id: Id<"salesOrders">,
    run: () => Promise<unknown>,
    message: string,
  ) => {
    setBusy(id);
    try {
      await run();
      toast.success(message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't update the order.",
      );
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = async (order: OrderDoc) => {
    const ok = await confirm({
      title: `Delete ${order.number}?`,
      message:
        "The order is removed from the register. Nothing is posted and no stock moves — an order is a commitment, not a movement.",
      confirmLabel: "Delete order",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeOrder({ id: order._id });
      if (viewingId === order._id) setViewingId(null);
      toast.success(`${order.number} deleted.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't delete the order.",
      );
    }
  };

  /* ── the order form, full-screen ───────────────────────────────── */
  if (formOpen) {
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
      <div className="space-y-4">
        <SalesPageHeading
          title="Sales orders"
          hint="What the customer has confirmed. Invoicing an order closes it."
        />
        <SalesOrderForm
          key={editingId ?? seedQuotation?._id ?? "new"}
          editing={editing}
          seedQuotation={seedQuotation}
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
      </div>
    );
  }

  /* ── one order's own screen ────────────────────────────────────── */
  if (viewed !== null) {
    const canInvoice = viewed.status !== "invoiced" && viewed.status !== "cancelled";
    return (
      <div className="space-y-4">
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 bg-muted/30 px-5 py-4">
            <div>
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Sales order
              </p>
              <h2 className="font-display font-mono text-lg font-semibold">
                {viewed.number}
              </h2>
              <p className="text-xs text-muted-foreground">
                {viewed.customerName || "Walk-in"} · ordered {day(viewed.orderedAt)}
                {viewed.expectedAt !== undefined
                  ? ` · expected ${day(viewed.expectedAt)}`
                  : ""}
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
                      `${viewed.number} confirmed.`,
                    )
                  }
                  className="h-8 rounded-lg text-xs"
                >
                  <Send className="size-3.5" /> Confirm
                </Button>
              )}
              {canInvoice && canEdit && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy === viewed._id}
                  onClick={() => void invoice(viewed)}
                  title="Raises the invoice, takes the goods out of stock and closes the order"
                  className="h-8 rounded-lg text-xs text-emerald-600 hover:text-emerald-600"
                >
                  {busy === viewed._id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Receipt className="size-3.5" />
                  )}
                  Invoice it
                </Button>
              )}
              {viewed.status !== "invoiced" && canEdit && (
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
            </div>
          </div>

          <div className="grid gap-4 border-b border-border/60 px-5 py-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Customer
              </p>
              <p className="text-sm">{viewed.customerName || "Walk-in / not listed"}</p>
              {viewed.customerAddress && (
                <p className="text-xs text-muted-foreground">{viewed.customerAddress}</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Their reference
              </p>
              <p className="text-sm">{viewed.poRef || "—"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Status
              </p>
              <p className="text-sm">
                {viewed.invoicedAt !== undefined
                  ? `Invoiced ${day(viewed.invoicedAt)}`
                  : STATUS_LABEL[viewed.status]}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto px-5 py-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] tracking-wide text-muted-foreground uppercase">
                  <th className="w-8 py-1.5 text-left font-medium">#</th>
                  <th className="py-1.5 text-left font-medium">Product</th>
                  <th className="w-24 py-1.5 text-right font-medium">Qty</th>
                  <th className="w-32 py-1.5 text-right font-medium">Price</th>
                  <th className="w-32 py-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {viewed.lines.map((line, index) => (
                  <tr
                    key={`${line.productId}-${index}`}
                    className="border-b border-border/50"
                  >
                    <td className="py-2 text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </td>
                    <td className="py-2">{line.name}</td>
                    <td className="py-2 text-right tabular-nums">
                      {line.qty} {line.unit}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {money(line.unitPrice)}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {money(line.qty * line.unitPrice)}
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
              {viewed.status !== "invoiced" && (
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
      </div>
    );
  }

  /* ── the register ──────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <SalesPageHeading
        title="Sales orders"
        hint={`${open.length} open · ${money(committed)} confirmed and not yet invoiced`}
      >
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
      </SalesPageHeading>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {orders === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading orders…
          </div>
        ) : orders.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <ShoppingCart className="mx-auto size-7 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">No sales orders yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Record what the customer has confirmed, then invoice it in one step.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  <th className="w-28 px-3 py-2">Order</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="w-24 px-3 py-2">Ordered</th>
                  <th className="w-24 px-3 py-2">Expected</th>
                  <th className="w-16 px-3 py-2 text-right">Items</th>
                  <th className="w-28 px-3 py-2 text-right">Total</th>
                  <th className="w-28 px-3 py-2">Status</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {orders.map((o) => (
                  <tr
                    key={o._id}
                    className={cn(
                      "transition-colors hover:bg-accent/40",
                      o.status === "cancelled" && "opacity-60",
                    )}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setViewingId(o._id)}
                        className="font-mono text-xs font-medium hover:text-primary hover:underline"
                      >
                        {o.number}
                      </button>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {o.customerName || "Walk-in"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {day(o.orderedAt)}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {o.expectedAt !== undefined ? day(o.expectedAt) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {o.lines.length}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(o.total)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          STATUS_STYLE[o.status],
                        )}
                      >
                        {STATUS_LABEL[o.status]}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-right">
                      <span className="inline-flex items-center gap-1">
                        {o.status !== "invoiced" && o.status !== "cancelled" && canEdit && (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy === o._id}
                              onClick={() => void invoice(o)}
                              title="Raises the invoice and closes the order"
                              className="h-7 rounded-lg px-2 text-xs text-emerald-600 hover:text-emerald-600"
                            >
                              <FileText className="size-3" /> Invoice
                            </Button>
                            <button
                              type="button"
                              aria-label={`Edit ${o.number}`}
                              title="Edit order"
                              onClick={() => {
                                setEditingId(o._id);
                                setFormOpen(true);
                              }}
                              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          </>
                        )}
                        {o.status !== "invoiced" && canDelete && (
                          <button
                            type="button"
                            aria-label={`Delete ${o.number}`}
                            disabled={busy === o._id}
                            onClick={() => void confirmDelete(o)}
                            className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </span>
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
