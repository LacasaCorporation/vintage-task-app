import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Loader2, Plus, Printer, Save, Trash2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import ItemPicker, { type PickerItem } from "@/components/ItemPicker";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { toast } from "@/lib/toast";
import { priceTaxedLines } from "@/lib/line-tax";
import { cn } from "@/lib/utils";
import {
  DOC_TONE,
  PRINT_HINT,
  printDocument,
  type FirmProfile,
  type PrintableDoc,
  type SalesDocRecord,
  type SalesDocKind,
} from "@/components/SalesDocumentPrint";

type FgDoc = Doc<"finishedGoods">;
type CustomerDoc = Doc<"customers">;

const pad = (n: number) => String(n).padStart(2, "0");
const toInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromInput = (value: string) => Date.parse(`${value}T12:00:00`);
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const HEAD =
  "border-b border-border/60 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase";
const LABEL = "mb-1 block text-xs font-medium";
const FIELD =
  "rounded-lg border bg-background px-2.5 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

/** One line being typed. Kept as strings so a half-typed number survives. */
type DraftLine = {
  productId: Id<"finishedGoods"> | "";
  qty: string;
  price: string;
  /** This line's own tax rate. Empty means "use the product's". */
  tax: string;
};

const blankLine = (): DraftLine => ({
  productId: "",
  qty: "1",
  price: "",
  tax: "",
});

/** What the form is being used for right now. */
export type SalesDocTarget =
  | {
      mode: "new";
      kind: "quotation" | "invoice";
      /** Pre-fills the customer — raised from a statement or a customer row. */
      customer?: { id?: Id<"customers">; name: string; address?: string };
    }
  | { mode: "newDelivery"; saleId: Id<"sales"> }
  | {
      mode: "edit";
      kind: SalesDocKind;
      id: Id<"quotations"> | Id<"sales"> | Id<"deliveryNotes">;
    }
  | { mode: "view"; doc: PrintableDoc };

const TITLE: Record<SalesDocKind, string> = {
  quotation: "Quotation",
  invoice: "Invoice",
  delivery: "Delivery note",
};

/**
 * The form, with the reading of the record kept outside it.
 *
 * The editor is remounted on the record's id rather than filled in by an
 * effect. That is not a stylistic choice: a Convex read can land after the
 * form is already on screen and someone has started typing, and an effect
 * filling the fields would then overwrite their work.
 */
export default function SalesDocumentForm(props: {
  target: SalesDocTarget;
  products: FgDoc[];
  /**
   * Where the document lives. "dialog" is the popup the sales list used to
   * open; "page" is the same form on its own route, which is how a quotation,
   * an invoice and a delivery note are reached now.
   */
  layout?: "dialog" | "page";
  onClose: () => void;
  onSaved?: (doc: SalesDocRecord) => void;
}) {
  const { target } = props;
  const recordId: Id<"quotations"> | Id<"sales"> | Id<"deliveryNotes"> | null =
    target.mode === "newDelivery"
      ? target.saleId
      : target.mode === "edit"
        ? target.id
        : null;
  const record = useQuery(
    api.sales.documentById,
    recordId === null ? "skip" : { id: recordId },
  );
  // still on its way: an empty form would flash up and then be filled in
  if (recordId !== null && record === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Opening…
      </div>
    );
  }
  return (
    <SalesDocEditor
      {...props}
      key={record?._id ?? "blank"}
      initial={record ?? null}
    />
  );
}

/**
 * The professional sales document form.
 *
 * One form for a quotation, an invoice and a delivery note, because the three
 * are the same document with a different claim attached — and a business that
 * types them into three different shapes ends up with three different
 * letterheads and three different sets of totals. The field each one needs
 * that the others do not is shown and explained rather than hidden: a
 * quotation asks when the offer lapses, an invoice asks when the money is due
 * and whether it has been paid, a delivery note asks who handed it over and
 * who signed for it.
 *
 * The numbers are worked out here as you type so the total is never a
 * surprise on save, but the server prices the document again on the way in.
 * A figure that only the browser believed would not survive a reload.
 */
/**
 * The frame around the document.
 *
 * The document itself has always been the same on screen; only the container
 * changed, so it is written once and wrapped here. On a page it is a plain
 * column with room to breathe; in the list it is still a dialog, for the one
 * place a document is opened over what raised it.
 */
function EditorShell({
  layout = "dialog",
  onClose,
  children,
}: {
  layout?: "dialog" | "page";
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (layout === "page") {
    return (
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-16">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {children}
        </div>
      </div>
    );
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] gap-0 overflow-y-auto p-0 sm:max-w-[min(100%,1100px)]">
        {children}
      </DialogContent>
    </Dialog>
  );
}

function SalesDocEditor({
  target,
  products,
  layout = "dialog",
  onClose,
  onSaved,
  initial,
}: {
  target: SalesDocTarget;
  products: FgDoc[];
  layout?: "dialog" | "page";
  onClose: () => void;
  onSaved?: (doc: SalesDocRecord) => void;
  /** The record being opened, read once by the parent. */
  initial: SalesDocRecord | null;
}) {
  const { format: money, symbol } = useWorkspaceCurrency();
  const firm = useQuery(api.settings.firmProfile) as FirmProfile | null;
  const taxDefault = useQuery(api.sales.postingDefaults);
  const customers = useQuery(api.contacts.listCustomers);
  const addCustomer = useMutation(api.contacts.createCustomer);

  // Every field starts from the record being opened, not from a blank form
  // that is filled in a moment later. Reading the record once, at mount, is
  // what keeps a half-typed line from being overwritten by data arriving
  // late — and it is why the editor is remounted when the record changes.
  const seed = initial;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  /** A new document raised straight from a customer carries them in already. */
  const preset = target.mode === "new" ? target.customer : undefined;

  const [customerId, setCustomerId] = useState<Id<"customers"> | "">(() => {
    if (seed && "customerId" in seed) return seed.customerId ?? "";
    return preset?.id ?? "";
  });
  const [customerName, setCustomerName] = useState(() =>
    seed
      ? text("customerName" in seed ? seed.customerName : "")
      : (preset?.name ?? ""),
  );
  const [customerAddress, setCustomerAddress] = useState(() =>
    seed
      ? text("customerAddress" in seed ? seed.customerAddress : "")
      : (preset?.address ?? ""),
  );
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerAddress, setNewCustomerAddress] = useState("");
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);

  /** Walk-in first, then the firm's customers alphabetically. */
  const customerItems = useMemo<PickerItem[]>(
    () => [
      { id: "", label: "Walk-in / not listed", keywords: "walk in none" },
      ...((customers ?? []) as CustomerDoc[]).map((c) => ({
        id: c._id as string,
        label: c.name,
        sub: [c.contactName, c.phone, c.email].filter(Boolean).join(" · ") || undefined,
        hint: c.address ? "has address" : undefined,
        keywords: [c.address, c.note].filter(Boolean).join(" "),
      })),
    ],
    [customers],
  );

  /** Choosing a customer fills the printed name and address from the record. */
  const pickCustomer = (id: string) => {
    setCustomerId(id as Id<"customers"> | "");
    if (id === "") return;
    const c = (customers ?? []).find((x) => x._id === id);
    if (c) {
      setCustomerName(c.name);
      setCustomerAddress(c.address ?? "");
    }
  };

  /** Add a customer from inside the document, then select it. */
  const createAndPickCustomer = async () => {
    const name = newCustomerName.trim();
    if (name === "") return;
    setSavingCustomer(true);
    try {
      const id = await addCustomer({
        name,
        address: newCustomerAddress.trim() || undefined,
      });
      setCustomerId(id);
      setCustomerName(name);
      if (newCustomerAddress.trim() !== "") {
        setCustomerAddress(newCustomerAddress.trim());
      }
      setNewCustomerName("");
      setNewCustomerAddress("");
      setNewCustomerOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not add that customer.",
      );
    } finally {
      setSavingCustomer(false);
    }
  };
  const [poRef, setPoRef] = useState(() =>
    seed ? text("poRef" in seed ? seed.poRef : "") : "",
  );
  const [terms, setTerms] = useState(() =>
    seed ? text("terms" in seed ? seed.terms : "") : "",
  );
  const [note, setNote] = useState(() =>
    seed ? text("note" in seed ? seed.note : "") : "",
  );
  const [date, setDate] = useState(() => {
    if (!seed) return toInput(Date.now());
    if ("soldAt" in seed) return toInput(seed.soldAt);
    if ("quotedAt" in seed) return toInput(seed.quotedAt);
    return toInput(seed.deliveredAt);
  });
  const [secondDate, setSecondDate] = useState(() => {
    if (!seed) return "";
    if ("validUntil" in seed && seed.validUntil !== undefined) {
      return toInput(seed.validUntil);
    }
    if ("dueAt" in seed && seed.dueAt !== undefined) {
      return toInput(seed.dueAt);
    }
    return "";
  });
  const [discount, setDiscount] = useState(() =>
    seed && "discountPct" in seed && seed.discountPct !== undefined
      ? String(seed.discountPct)
      : "0",
  );
  const [tax, setTax] = useState(() =>
    // a document with no saved rate inherits the workspace default rather
    // than starting from a hard zero
    seed && "taxPct" in seed && seed.taxPct !== undefined
      ? String(seed.taxPct)
      : "",
  );
  const [lines, setLines] = useState<DraftLine[]>(() =>
    seed && "lines" in seed && seed.lines.length > 0
      ? seed.lines.map((l) => ({
          productId: l.productId,
          qty: String(l.qty),
          price: String(l.unitPrice),
          // a saved line keeps the rate it was raised at
          tax: l.taxPct !== undefined ? String(l.taxPct) : "",
        }))
      : [blankLine()],
  );
  const [deliveredBy, setDeliveredBy] = useState(() =>
    seed ? text("deliveredBy" in seed ? seed.deliveredBy : "") : "",
  );
  const [docketRef, setDocketRef] = useState(() =>
    seed ? text("docketRef" in seed ? seed.docketRef : "") : "",
  );
  const [receivedBy, setReceivedBy] = useState(() =>
    seed ? text("receivedBy" in seed ? seed.receivedBy : "") : "",
  );
  const [busy, setBusy] = useState(false);
  /** The invoice a delivery note hangs off, when there is one. */
  const [against] = useState<Doc<"sales"> | null>(() =>
    seed && "soldAt" in seed ? (seed as Doc<"sales">) : null,
  );

  const createQuotation = useMutation(api.sales.createQuotation);
  const createSale = useMutation(api.sales.createSale);
  const updateQuotation = useMutation(api.sales.updateQuotationLines);
  const updateSale = useMutation(api.sales.updateSale);
  const createNote = useMutation(api.sales.createDeliveryNote);
  const setNoteStatus = useMutation(api.sales.updateDeliveryNote);

  const readOnly = target.mode === "view";
  const kind: SalesDocKind =
    target.mode === "view"
      ? target.doc.kind
      : target.mode === "newDelivery"
        ? "delivery"
        : target.kind;
  const editing = target.mode === "edit";

  /** How much of the invoice is still to go out. */
  const due = useQuery(
    api.sales.deliveryDue,
    target.mode === "newDelivery" ? { saleId: target.saleId } : "skip",
  );

  /**
   * An empty tax field means "whatever the workspace charges", so the field
   * shows that rate without having to write it into state. A rate that has
   * been cleared on purpose stays cleared.
   */
  const taxValue = tax === "" ? String(taxDefault?.taxPct ?? 0) : tax;

  /**
   * The picker carries the rate, so the price is known before a line is even
   * added rather than discovered afterwards that the sheet says something
   * else.
   */
  /**
   * What each product sells for, from its costing sheet.
   *
   * The rate is offered rather than demanded: choosing a product fills the
   * rate in, because the sheet already knows the answer and a figure typed by
   * hand every time is a figure that eventually disagrees with it. It stays
   * editable, because a one-off price for a one-off invoice is a legitimate
   * thing to want, and a form that refuses it just gets worked around.
   */
  const priceList = useQuery(api.sales.priceList);
  const listById = useMemo(
    () => new Map((priceList ?? []).map((e) => [e.productId, e])),
    [priceList],
  );

  /**
   * The product's whole identity on one row, the same shape every other
   * picker in the app uses: the name, then what it is (code · category · how
   * many are on hand), then what it costs per unit. A sales document is
   * priced from the product list, so the price has to be readable before the
   * line exists — not discovered after it is added.
   */
  const pickerItems = useMemo<PickerItem[]>(
    () =>
      products.map((p) => {
        const entry = listById.get(p._id);
        const price =
          entry && entry.hasSheet && entry.price > 0 ? entry.price : undefined;
        const unit = p.unit?.trim() || "unit";
        return {
          id: p._id as string,
          label: p.name,
          sub:
            [
              p.code,
              p.category,
              `${(p.stock ?? 0).toLocaleString()} ${unit} in stock`,
            ]
              .filter((v) => !!v && v !== "")
              .join(" · ") || undefined,
          hint: price !== undefined ? `${money(price)}/${unit}` : `per ${unit}`,
          keywords: p.subCategory ?? "",
        };
      }),
    [products, listById, money],
  );

  const byId = useMemo(
    () => new Map(products.map((p) => [p._id, p])),
    [products],
  );

  /** The typed lines, resolved against the product list. */
  const priced = useMemo(
    () =>
      lines.map((l) => {
        const product = l.productId === "" ? undefined : byId.get(l.productId);
        return {
          productId: l.productId,
          name: product?.name ?? "",
          unit: product?.unit ?? "pcs",
          qty: num(l.qty),
          price: num(l.price),
          // a line with no rate of its own takes the product's, falling back
          // to the document default — the same order the server applies
          taxPct:
            l.tax.trim() === ""
              ? (product?.salesTaxPct ?? Math.max(0, num(taxValue)))
              : Math.min(100, Math.max(0, num(l.tax))),
        };
      }),
    [lines, byId, taxValue],
  );

  const totals = useMemo(() => {
    // the same arithmetic the server runs, so what is shown is what is saved
    const p = priceTaxedLines(priced, num(discount));
    return {
      net: p.net,
      discount: p.discount,
      tax: p.tax,
      grand: p.grand,
      lineGrand: p.lineGrand,
    };
  }, [priced, discount]);

  const realLines = priced.filter((l) => l.productId !== "" && l.qty > 0);
  const problem =
    realLines.length === 0
      ? kind === "delivery"
        ? "A delivery note needs at least one product."
        : "Add at least one product to the document."
      : realLines.some((l) => l.price < 0)
        ? "A unit price can't be negative."
        : realLines.some(
            (l) =>
              l.price === 0 &&
              (l.productId === "" ? 0 : (listById.get(l.productId)?.price ?? 0)) > 0,
          )
          ? "A line is at 0.00 although the costing sheet has a rate — set it, or clear the product."
          : null;

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, n) => (n === i ? { ...l, ...patch } : l)));

  const chooseProduct = (i: number, id: string) => {
    const entry = listById.get(id as Id<"finishedGoods">);
    const current = lines[i];
    // an empty or untouched rate takes the sheet's price; a rate someone has
    // deliberately typed is left exactly as it is
    const keepTyped = current.price !== "" && current.price !== "0";
    const product = byId.get(id as Id<"finishedGoods">);
    setLine(i, {
      productId: id as Id<"finishedGoods">,
      price:
        keepTyped || !entry || entry.price <= 0 ? current.price : String(entry.price),
      // offered, not imposed — the field fills in and stays editable
      tax:
        current.tax ||
        (product?.salesTaxPct !== undefined ? String(product.salesTaxPct) : ""),
    });
  };

  /** Put a line back onto the rate its costing sheet says. */
  const restoreListPrice = (i: number) => {
    const entry = listById.get(lines[i].productId as Id<"finishedGoods">);
    if (entry) setLine(i, { price: String(entry.price) });
  };

  /* ── save ─────────────────────────────────────────────────────── */
  const save = async () => {
    if (readOnly || busy) return;
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const common = {
        customerId: customerId === "" ? undefined : customerId,
        customerName: customerName.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
        poRef: poRef.trim() || undefined,
        terms: terms.trim() || undefined,
        note: note.trim() || undefined,
        discountPct: num(discount),
        taxPct: num(taxValue),
      };
      // `realLines` already resolved each line's rate (its own, else the
      // product's, else the document default) — that is what gets saved
      const payload = realLines.map((l) => ({
        productId: l.productId as Id<"finishedGoods">,
        qty: l.qty,
        unitPrice: l.price,
        taxPct: l.taxPct || undefined,
      }));

      if (kind === "quotation") {
        const args = {
          ...common,
          quotedAt: fromInput(date),
          validUntil: secondDate ? fromInput(secondDate) : undefined,
          lines: payload,
        };
        const id = editing
          ? await updateQuotation({
              ...args,
              id: target.id as Id<"quotations">,
            })
          : await createQuotation(args);
        toast.success(editing ? "Quotation updated." : "Quotation saved.");
        setSavedId(id);
        return;
      }

      if (kind === "invoice") {
        const args = {
          ...common,
          soldAt: fromInput(date),
          dueAt: secondDate ? fromInput(secondDate) : undefined,
          lines: payload,
        };
        const id = editing
          ? await updateSale({ ...args, id: target.id as Id<"sales"> })
          : await createSale(args);
        toast.success(editing ? "Invoice updated." : "Invoice saved.");
        setSavedId(id);
        return;
      }

      // delivery note
      if (target.mode === "newDelivery" && due !== undefined) {
        const quantities = due
          .map((d) => ({
            productId: d.productId,
            qty: Math.min(
              d.due,
              realLines.find((l) => l.productId === d.productId)?.qty ?? 0,
            ),
          }))
          .filter((q) => q.qty > 0);
        if (quantities.length === 0) {
          toast.error("Nothing is left to deliver on this invoice.");
          return;
        }
        const id = await createNote({
          saleId: target.saleId,
          deliveredAt: fromInput(date),
          deliveredBy: deliveredBy.trim() || undefined,
          docketRef: docketRef.trim() || undefined,
          note: note.trim() || undefined,
          poRef: poRef.trim() || undefined,
          status: receivedBy.trim() ? "delivered" : "pending",
          receivedBy: receivedBy.trim() || undefined,
          quantities,
        });
        toast.success("Delivery note raised.");
        setSavedId(id);
        return;
      }

      if (editing && kind === "delivery") {
        await setNoteStatus({
          id: target.id as Id<"deliveryNotes">,
          status: receivedBy.trim() ? "delivered" : "pending",
          receivedBy: receivedBy.trim() || undefined,
          deliveredBy: deliveredBy.trim() || undefined,
          docketRef: docketRef.trim() || undefined,
        });
        toast.success("Delivery note updated.");
        setSavedId(target.id);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the document.",
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * The document that was just saved, read back.
   *
   * The number is assigned on the server, so the form cannot know what the
   * document is called until it comes back. Rather than guess, it hands the
   * id to a child that waits for the record and passes the real thing up.
   */
  const [savedId, setSavedId] = useState<
    Id<"quotations"> | Id<"sales"> | Id<"deliveryNotes"> | null
  >(null);

  /* ── view mode renders the printed sheet ──────────────────────── */
  if (readOnly) {
    const doc = target.doc;
    return (
      <EditorShell layout={layout} onClose={onClose}>
        {layout === "page" ? (
          <span className="sr-only">
            {TITLE[doc.kind]} {doc.number}
          </span>
        ) : (
          <DialogTitle className="sr-only">
            {TITLE[doc.kind]} {doc.number}
          </DialogTitle>
        )}
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className={cn("rounded-md px-1.5 py-0.5 text-xs", DOC_TONE[doc.kind])}>
              {TITLE[doc.kind]}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {doc.number}
            </span>
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              onClick={() => {
                const opened = printDocument(doc, firm, symbol);
                if (!opened)
                  toast.error("Allow pop-ups to print this document.");
              }}
            >
              <Printer className="size-3.5" /> Print
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label={layout === "page" ? "Back" : "Close"}
              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="space-y-4 p-4">
          <ViewSheet doc={doc} firm={firm} money={money} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={onClose}
            >
              {layout === "page" ? "Back to sales" : "Close"}
            </Button>
          </div>
        </div>
      </EditorShell>
    );
  }

  const secondaryLabel =
    kind === "quotation"
      ? "Valid until"
      : kind === "invoice"
        ? "Payment due"
        : "Received on";

  return (
    <EditorShell layout={layout} onClose={onClose}>
      {layout === "page" ? (
        <span className="sr-only">
          {editing ? "Edit" : "New"} {TITLE[kind].toLowerCase()}. {PRINT_HINT[kind]}
        </span>
      ) : (
        <>
          <DialogTitle className="sr-only">
            {editing ? "Edit" : "New"} {TITLE[kind].toLowerCase()}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {PRINT_HINT[kind]}
          </DialogDescription>
        </>
      )}

        {/* ── the document header ── */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            {kind === "delivery" ? (
              <Truck className="size-4 text-muted-foreground" />
            ) : (
              <FileText className="size-4 text-muted-foreground" />
            )}
            <p className="text-sm font-semibold">
              {editing ? "Edit" : "New"} {TITLE[kind].toLowerCase()}
            </p>
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                DOC_TONE[kind],
              )}
            >
              {TITLE[kind]}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              disabled={busy}
              onClick={() => {
                if (problem) {
                  toast.error(problem);
                  return;
                }
                const printable = previewDoc();
                if (printable === null) return;
                const opened = printDocument(printable, firm, symbol);
                if (!opened)
                  toast.error("Allow pop-ups to print this document.");
              }}
            >
              <Printer className="size-3.5" /> Print
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {editing ? "Save changes" : "Save"}
            </Button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── the document body ── */}
          <div className="space-y-4">
            {/* who it is for, and when */}
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <label className={LABEL} htmlFor="doc-customer">
                  {kind === "delivery" ? "Deliver to" : "Customer"}
                </label>
                <ItemPicker
                  items={customerItems}
                  value={customerId}
                  onChange={pickCustomer}
                  aria-label={kind === "delivery" ? "Deliver to" : "Customer"}
                  placeholder="Walk-in / not listed"
                  searchPlaceholder="Search customers…"
                  emptyLabel="No customer by that name."
                  createNewLabel={`Add customer “${newCustomerName.trim() || "new"}”`}
                  onCreateNew={(term) => {
                    setNewCustomerName(term);
                    setNewCustomerAddress("");
                    setNewCustomerOpen(true);
                  }}
                  className="w-full"
                />
                {customerId === "" && customerName.trim() !== "" && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Saved under a one-off name — link it to a customer record to
                    keep their history together.
                  </p>
                )}
              </div>
              <div>
                <label className={LABEL} htmlFor="doc-date">
                  {kind === "quotation"
                    ? "Quoted on"
                    : kind === "invoice"
                      ? "Invoice date"
                      : "Delivered on"}
                </label>
                <Input
                  id="doc-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={cn(FIELD, "w-full")}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="doc-second">
                  {secondaryLabel}
                </label>
                <Input
                  id="doc-second"
                  type="date"
                  value={secondDate}
                  onChange={(e) => setSecondDate(e.target.value)}
                  className={cn(FIELD, "w-full")}
                />
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className={LABEL} htmlFor="doc-name">
                  {kind === "delivery" ? "Deliver to" : "Customer name"}
                </label>
                <Input
                  id="doc-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Customer name"
                  className={cn(FIELD, "w-full")}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="doc-po">
                  {kind === "delivery" ? "Docket / PO" : "PO reference"}
                </label>
                <Input
                  id="doc-po"
                  value={poRef}
                  onChange={(e) => setPoRef(e.target.value)}
                  placeholder="Optional"
                  className={cn(FIELD, "w-full")}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="doc-terms">
                  {kind === "quotation" ? "Terms" : "Payment terms"}
                </label>
                <Input
                  id="doc-terms"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="e.g. 30 days from invoice"
                  className={cn(FIELD, "w-full")}
                />
              </div>
            </section>

            <div>
              <label className={LABEL} htmlFor="doc-address">
                Address
              </label>
              <Textarea
                id="doc-address"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                rows={2}
                placeholder="Street, city, country"
                className={cn(FIELD, "w-full resize-y")}
              />
            </div>

            {/* the goods */}
            <section className="overflow-hidden rounded-xl border">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                  Items
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-lg text-xs"
                  onClick={() => setLines((p) => [...p, blankLine()])}
                >
                  <Plus className="size-3.5" /> Add line
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={HEAD}>
                      <th className="w-8 px-2 py-2 text-right">#</th>
                      <th className="px-2 py-2 text-left">Item</th>
                      <th className="w-24 px-2 py-2 text-right">Qty</th>
                      <th className="w-20 px-2 py-2 text-left">Unit</th>
                      <th className="w-24 px-2 py-2 text-right">Rate</th>
                      <th className="w-20 px-2 py-2 text-right">Tax %</th>
                      <th className="w-32 px-2 py-2 text-right">Amount</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {lines.map((l, i) => {
                      const p = priced[i];
                      const entry =
                        l.productId === "" ? undefined : listById.get(l.productId);
                      return (
                        <tr key={i}>
                          <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                            {i + 1}
                          </td>
                          <td className="px-2 py-1.5">
                            <ItemPicker
                              items={pickerItems}
                              value={l.productId}
                              onChange={(id) => chooseProduct(i, id)}
                              placeholder="Choose a product…"
                            />
                            {entry && entry.hasSheet && l.price !== "" && (
                              Number(l.price) !== entry.price ? (
                                <button
                                  type="button"
                                  onClick={() => restoreListPrice(i)}
                                  title="This rate is not the one on the costing sheet — click to go back to it"
                                  className="mt-0.5 text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
                                >
                                  sheet rate {money(entry.price)}
                                </button>
                              ) : (
                                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                                  from costing sheet
                                </span>
                              )
                            )}
                            {entry && !entry.hasSheet && (
                              <span className="mt-0.5 block text-[10px] text-amber-700 dark:text-amber-400">
                                no costing sheet — set a rate
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={l.qty}
                              onChange={(e) => setLine(i, { qty: e.target.value })}
                              aria-label="Quantity"
                              className={cn(FIELD, "h-8 w-full py-1 text-right text-xs")}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-xs text-muted-foreground">
                            {p?.unit ?? "—"}
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={l.price}
                              onChange={(e) =>
                                setLine(i, { price: e.target.value })
                              }
                              aria-label="Rate"
                              placeholder={
                                entry ? String(entry.price) : "0.00"
                              }
                              className={cn(FIELD, "h-8 w-full py-1 text-right text-xs")}
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              value={l.tax}
                              placeholder={String(
                                p?.taxPct ?? Math.max(0, num(taxValue)),
                              )}
                              onChange={(e) =>
                                setLine(i, { tax: e.target.value })
                              }
                              aria-label="Line tax percent"
                              className={cn(FIELD, "h-8 w-full py-1 text-right text-xs")}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-medium tabular-nums">
                            {money(
                              p === undefined
                                ? 0
                                : totals.lineGrand({
                                    qty: p.qty,
                                    unitPrice: p.price,
                                    taxPct: p.taxPct,
                                  }),
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right">
                            <button
                              type="button"
                              aria-label="Remove line"
                              onClick={() =>
                                setLines((prev) =>
                                  prev.length === 1
                                    ? [blankLine()]
                                    : prev.filter((_, n) => n !== i),
                                )
                              }
                              className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-rose-600"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {kind === "delivery" && (
              <section className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className={LABEL} htmlFor="doc-by">
                    Delivered by
                  </label>
                  <Input
                    id="doc-by"
                    value={deliveredBy}
                    onChange={(e) => setDeliveredBy(e.target.value)}
                    placeholder="Driver or staff member"
                    className={cn(FIELD, "w-full")}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="doc-docket">
                    Docket
                  </label>
                  <Input
                    id="doc-docket"
                    value={docketRef}
                    onChange={(e) => setDocketRef(e.target.value)}
                    placeholder="Optional"
                    className={cn(FIELD, "w-full")}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="doc-received">
                    Received by
                  </label>
                  <Input
                    id="doc-received"
                    value={receivedBy}
                    onChange={(e) => setReceivedBy(e.target.value)}
                    placeholder="Signed for on arrival"
                    className={cn(FIELD, "w-full")}
                  />
                </div>
              </section>
            )}

            <div>
              <label className={LABEL} htmlFor="doc-note">
                Notes
              </label>
              <Textarea
                id="doc-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Anything the customer should read on the document"
                className={cn(FIELD, "w-full resize-y")}
              />
            </div>
          </div>

          {/* ── the money ── */}
          <aside className="space-y-3">
            <div className="rounded-xl border p-3">
              <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                Summary
              </p>
              <dl className="mt-2 space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted-foreground">Sub total</dt>
                  <dd className="tabular-nums font-medium">
                    {money(totals.net)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="flex items-center gap-1 text-muted-foreground">
                    Discount
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={discount}
                      onChange={(e) => setDiscount(e.target.value)}
                      aria-label="Discount percent"
                      className={cn(FIELD, "h-7 w-14 py-0.5 text-right text-xs")}
                    />
                    %
                  </dt>
                  <dd className="tabular-nums text-muted-foreground">
                    {totals.discount === 0 ? "—" : `−${money(totals.discount)}`}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
                  <dt className="text-muted-foreground">
                    Tax amount
                    <Input
                      type="number"
                      min="0"
                      value={taxValue}
                      onChange={(e) => setTax(e.target.value)}
                      aria-label="Default tax percent"
                      className={cn(FIELD, "ml-2 h-7 w-14 py-0.5 text-right text-xs")}
                    />
                    %
                  </dt>
                  <dd className="tabular-nums font-medium">
                    {totals.tax === 0 ? "—" : money(totals.tax)}
                  </dd>
                </div>
                <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums text-primary">
                    {money(totals.grand)}
                  </dd>
                </div>
              </dl>
            </div>

            {/* the arithmetic, shown so the total is never a surprise */}
            <p className="rounded-xl border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
              {money(totals.net)}
              {totals.discount > 0 ? ` − ${money(totals.discount)}` : ""}
              {totals.tax > 0 ? ` + ${money(totals.tax)} tax` : ""} ={" "}
              <strong className="text-foreground">{money(totals.grand)}</strong>{" "}
              over {realLines.length}{" "}
              {realLines.length === 1 ? "line" : "lines"}
            </p>

            {kind === "delivery" ? (
              <p className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-800 dark:text-violet-300">
                A delivery note moves no money. It records that the goods left
                and takes them off the shelf; the invoice remains the document
                that says what is owed.
              </p>
            ) : (
              <p className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {kind === "quotation"
                  ? "A quotation is an offer. Nothing is reserved, nothing is charged, and the goods stay on the shelf until it is accepted."
                  : "Saving an invoice posts it to the ledger and takes the goods off the shelf. A settled invoice cannot be edited — delete it and raise a new one, so both events stay visible."}
              </p>
            )}

            {problem && (
              <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                {problem}
              </p>
            )}

            {kind === "delivery" && target.mode === "newDelivery" && due && (
              <div className="rounded-xl border p-3">
                <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                  Still to deliver
                </p>
                <ul className="mt-1.5 space-y-1 text-xs">
                  {due.length === 0 && (
                    <li className="text-muted-foreground">
                      This invoice has been delivered in full.
                    </li>
                  )}
                  {due.map((d) => (
                    <li
                      key={d.productId}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{d.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {d.due} {d.unit ?? ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
        {savedId !== null && (
          <SavedDocHandoff
            id={savedId}
            onReady={(doc) => {
              setSavedId(null);
              onSaved?.(doc);
              onClose();
            }}
          />
        )}
        {/* add a customer without leaving the document */}
        <Dialog
          open={newCustomerOpen}
          onOpenChange={(o) =>
            !o && !savingCustomer && setNewCustomerOpen(false)
          }
        >
          <DialogContent className="sm:max-w-[min(100%,420px)]">
            <DialogTitle>New customer</DialogTitle>
            <DialogDescription>
              Saved to your customer list and selected on this document.
            </DialogDescription>
            <div className="grid gap-3">
              <div>
                <label className={LABEL} htmlFor="new-customer-name">
                  Name
                </label>
                <Input
                  id="new-customer-name"
                  value={newCustomerName}
                  autoFocus
                  placeholder="Customer or company name"
                  className={cn(FIELD, "w-full")}
                  onChange={(e) => setNewCustomerName(e.target.value)}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="new-customer-address">
                  Address
                </label>
                <Textarea
                  id="new-customer-address"
                  value={newCustomerAddress}
                  rows={2}
                  placeholder="Optional"
                  className={cn(FIELD, "w-full resize-y")}
                  onChange={(e) => setNewCustomerAddress(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-lg text-xs"
                  disabled={savingCustomer}
                  onClick={() => setNewCustomerOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg text-xs"
                  disabled={savingCustomer || newCustomerName.trim() === ""}
                  onClick={() => void createAndPickCustomer()}
                >
                  {savingCustomer && (
                    <Loader2 className="size-3.5 animate-spin" />
                  )}
                  Add customer
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
    </EditorShell>
  );

  /** The document as it would print, before it has been saved. */
  function previewDoc(): PrintableDoc | null {
    if (kind === "delivery" && target.mode === "newDelivery" && !against) {
      // there is no invoice yet to hang the note on, so nothing to print
      toast.error("Save the note against its invoice first.");
      return null;
    }
    return {
      kind,
      number:
        editing || (kind === "delivery" && against)
          ? "— new —"
          : "— new —",
      date: fromInput(date),
      secondaryDate: secondDate ? fromInput(secondDate) : undefined,
      secondaryLabel,
      poRef: poRef.trim() || undefined,
      customerName: customerName.trim() || "Customer",
      customerAddress: customerAddress.trim() || undefined,
      note: note.trim() || undefined,
      terms: terms.trim() || undefined,
      fromRef: against?.number,
      deliveredBy: deliveredBy.trim() || undefined,
      docketRef: docketRef.trim() || undefined,
      receivedBy: receivedBy.trim() || undefined,
      currency: symbol,
      lines: priced
        .filter((l) => l.name !== "" && l.qty > 0)
        .map((l) => ({
          productId: l.productId as Id<"finishedGoods">,
          name: l.name,
          unit: l.unit,
          qty: l.qty,
          unitPrice: l.price,
          taxPct: l.taxPct || undefined,
        })),
      discountPct: num(discount),
      taxPct: num(taxValue),
    };
  }
}

/**
 * Waits for a just-saved document to come back and hands it up.
 *
 * A component rather than a call, because Convex reads are subscriptions: the
 * only honest way to read a record that has just been written is to ask for it
 * and let the answer arrive when it arrives.
 */
function SavedDocHandoff({
  id,
  onReady,
}: {
  id: Id<"quotations"> | Id<"sales"> | Id<"deliveryNotes">;
  onReady: (doc: SalesDocRecord) => void;
}) {
  const doc = useQuery(api.sales.documentById, { id });
  const handed = useRef<string | null>(null);
  useEffect(() => {
    if (doc === null || doc === undefined) return;
    if (handed.current === doc._id) return;
    handed.current = doc._id;
    onReady(doc);
  }, [doc, onReady]);
  return null;
}

/* ── the read-only sheet, as it will print ─────────────────────────── */

function ViewSheet({
  doc,
  firm,
  money,
}: {
  doc: PrintableDoc;
  firm: FirmProfile | null;
  money: (n: number) => string;
}) {
  const net = doc.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const day = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="flex items-start gap-2.5">
          {firm?.logo ? (
            <img
              src={firm.logo}
              alt=""
              className="size-10 rounded-lg object-contain"
            />
          ) : null}
          <div>
            <p className="text-sm font-semibold">
              {firm?.name || "Your business"}
            </p>
            <p className="text-[11px] whitespace-pre-line text-muted-foreground">
              {[firm?.address, firm?.phone, firm?.email, firm?.taxId]
                .filter(Boolean)
                .join("\n")}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p
            className={cn(
              "text-lg font-bold tracking-widest",
              DOC_TONE[doc.kind],
            )}
          >
            {TITLE[doc.kind].toUpperCase()}
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            {doc.number}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{day(doc.date)}</p>
          {doc.secondaryDate !== undefined && (
            <p className="text-xs text-muted-foreground">
              {doc.secondaryLabel}: {day(doc.secondaryDate)}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            {doc.kind === "delivery" ? "Deliver to" : "Bill to"}
          </p>
          <p className="mt-0.5 text-sm font-medium">{doc.customerName}</p>
          {doc.customerAddress && (
            <p className="text-xs whitespace-pre-line text-muted-foreground">
              {doc.customerAddress}
            </p>
          )}
        </div>
        <div className="sm:text-right">
          {doc.poRef && (
            <p className="text-xs text-muted-foreground">PO {doc.poRef}</p>
          )}
          {doc.fromRef && (
            <p className="text-xs text-muted-foreground">From {doc.fromRef}</p>
          )}
          {doc.receivedBy && (
            <p className="text-xs text-muted-foreground">
              Received by {doc.receivedBy}
            </p>
          )}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className={HEAD}>
            <th className="px-4 py-2 text-left">Description</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">Unit price</th>
            <th className="px-4 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {doc.lines.map((l, i) => (
            <tr key={i}>
              <td className="px-4 py-2 text-xs font-medium">{l.name}</td>
              <td className="px-3 py-2 text-right text-xs tabular-nums">
                {l.qty} {l.unit ?? ""}
              </td>
              <td className="px-3 py-2 text-right text-xs tabular-nums">
                {money(l.unitPrice)}
              </td>
              <td className="px-4 py-2 text-right text-xs font-medium tabular-nums">
                {money(l.qty * l.unitPrice)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2">
            <td colSpan={3} className="px-4 py-2 text-right text-sm font-semibold">
              {doc.kind === "delivery" ? "Value of goods delivered" : "Total"}
            </td>
            <td className="px-4 py-2 text-right text-sm font-semibold tabular-nums">
              {money(net)}
            </td>
          </tr>
        </tfoot>
      </table>

      {(doc.note || doc.terms) && (
        <div className="grid gap-3 border-t px-4 py-3 sm:grid-cols-2">
          {doc.note && (
            <div>
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                Notes
              </p>
              <p className="text-xs whitespace-pre-line text-muted-foreground">
                {doc.note}
              </p>
            </div>
          )}
          {doc.terms && (
            <div>
              <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
                Terms
              </p>
              <p className="text-xs whitespace-pre-line text-muted-foreground">
                {doc.terms}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── turning a saved record into something printable ───────────────── */

export function printableQuotation(q: Doc<"quotations">): PrintableDoc {
  return {
    kind: "quotation",
    number: q.number,
    date: q.quotedAt,
    secondaryDate: q.validUntil,
    secondaryLabel: "Valid until",
    poRef: q.poRef,
    customerName: q.customerName ?? "Customer",
    customerAddress: q.customerAddress,
    note: q.note,
    terms: q.terms,
    status: q.status,
    currency: q.currency ?? "",
    lines: q.lines,
    discountPct: q.discountPct,
    taxPct: q.taxPct,
  };
}

export function printableInvoice(s: Doc<"sales">): PrintableDoc {
  return {
    kind: "invoice",
    number: s.number,
    date: s.soldAt,
    secondaryDate: s.dueAt,
    secondaryLabel: "Payment due",
    poRef: s.poRef,
    customerName: s.customerName ?? "Customer",
    customerAddress: s.customerAddress,
    note: s.note,
    terms: s.terms,
    fromRef: s.quotationId,
    currency: s.currency ?? "",
    lines: s.lines,
    discountPct: s.discountPct,
    taxPct: s.taxPct,
    paid: s.isPaid === true ? s.total : 0,
  };
}

export function printableNote(d: Doc<"deliveryNotes">): PrintableDoc {
  return {
    kind: "delivery",
    number: d.number,
    date: d.deliveredAt,
    secondaryLabel: "Received on",
    poRef: d.docketRef ?? d.poRef,
    customerName: d.customerName ?? "Customer",
    customerAddress: d.customerAddress,
    note: d.note,
    deliveredBy: d.deliveredBy,
    docketRef: d.docketRef,
    receivedBy: d.receivedBy,
    receivedAt: d.receivedAt,
    status: d.status,
    currency: d.currency ?? "",
    lines: d.lines,
  };
}
