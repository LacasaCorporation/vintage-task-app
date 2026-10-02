import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { ArrowLeft, ChevronRight, FileText, Loader2, Truck } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import SalesDocumentForm, {
  type SalesDocTarget,
} from "@/components/SalesDocumentForm";
import {
  printableInvoice,
  printableNote,
  printableQuotation,
  type PrintableDoc,
  type SalesDocKind,
  type SalesDocRecord,
} from "@/components/SalesDocumentPrint";
import { cn } from "@/lib/utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

/** The three documents, by the section of the address bar that opens them. */
const SECTIONS: Record<string, SalesDocKind> = {
  invoices: "invoice",
  quotations: "quotation",
  "delivery-notes": "delivery",
};

const LABEL: Record<SalesDocKind, string> = {
  quotation: "Quotation",
  invoice: "Invoice",
  delivery: "Delivery note",
};

const PLURAL: Record<SalesDocKind, string> = {
  quotation: "quotations",
  invoice: "invoices",
  delivery: "delivery-notes",
};

const backToSales = "/dashboard?view=sales";

/** Where a saved document lives, once it has a number. */
function savedPath(doc: SalesDocRecord): string {
  if ("soldAt" in doc) return `/sales/invoices/${doc._id}?view=1`;
  if ("deliveredAt" in doc) return `/sales/delivery-notes/${doc._id}?view=1`;
  return `/sales/quotations/${doc._id}?view=1`;
}

/** A record as the printed sheet it turns into. */
function asPrintable(doc: SalesDocRecord, kind: SalesDocKind): PrintableDoc {
  if (kind === "invoice") return printableInvoice(doc as Doc<"sales">);
  if (kind === "delivery") return printableNote(doc as Doc<"deliveryNotes">);
  return printableQuotation(doc as Doc<"quotations">);
}

/**
 * A quotation, an invoice and a delivery note, each on a page of its own.
 *
 * They used to open in a dialog over the sales list, which was fine while a
 * document was three fields and is not fine now: an invoice is a full page of
 * lines, it is worked on for a while, and the browser's back button has to
 * mean something. One route per document, the same form either way.
 */
export default function SalesDocumentPage() {
  const params = useParams<{ section: string; id?: string }>();
  const [query] = useSearchParams();
  const navigate = useNavigate();
  const { format: money } = useWorkspaceCurrency();

  const kind: SalesDocKind | undefined = SECTIONS[params.section ?? ""];
  /**
   * "new" is the address the module links to for a blank document, not an id.
   * Left as the id it reached the editor as an edit of a record called "new",
   * which is not a document at all.
   */
  const id = params.id === "new" ? undefined : params.id;
  const readOnly = query.get("view") === "1";
  const invoiceId = query.get("invoice");
  const customerId = query.get("customer");
  const customerName = query.get("name") ?? "";

  const products = useQuery(api.costing.listFinishedGoods);
  const sales = useQuery(
    api.sales.listSales,
    kind === "delivery" && id === undefined && invoiceId === null
      ? {}
      : "skip",
  );
  /** Only read mode needs the record here; the editor reads its own. */
  const record = useQuery(
    api.sales.documentById,
    readOnly && id !== undefined
      ? { id: id as Id<"quotations"> | Id<"sales"> | Id<"deliveryNotes"> }
      : "skip",
  );

  if (kind === undefined) {
    return (
      <Shell
        onBack={() => navigate(backToSales)}
        crumbs={["Sales", "Not found"]}
        title="No such document"
      >
        <p className="px-4 py-16 text-center text-sm text-muted-foreground">
          That address is not a quotation, an invoice or a delivery note.
        </p>
      </Shell>
    );
  }

  const title = readOnly
    ? `${LABEL[kind]}`
    : id === undefined
      ? `New ${LABEL[kind].toLowerCase()}`
      : `Edit ${LABEL[kind].toLowerCase()}`;

  const crumbs = ["Sales", PLURAL[kind], title];

  /* ── a delivery note needs an invoice to come off ──────────────── */
  if (kind === "delivery" && id === undefined && invoiceId === null) {
    return (
      <Shell onBack={() => navigate(backToSales)} crumbs={crumbs} title="New delivery note">
        <div className="px-4 py-6">
          <p className="text-sm text-muted-foreground">
            A delivery note takes its items from an invoice, so it is raised
            against one. Pick the invoice the goods are going out on.
          </p>
          {sales === undefined ? (
            <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading the sales book…
            </p>
          ) : sales.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">
              There are no invoices yet.{" "}
              <button
                type="button"
                onClick={() => navigate("/sales/invoices/new")}
                className="font-medium text-primary underline underline-offset-2"
              >
                Raise the first one
              </button>
              .
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border/60 rounded-xl border">
              {[...sales]
                .sort((a, b) => b.soldAt - a.soldAt)
                .map((s) => (
                  <li key={s._id}>
                    <button
                      type="button"
                      onClick={() =>
                        navigate(
                          `/sales/delivery-notes/new?invoice=${s._id}`,
                        )
                      }
                      className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-accent/50"
                    >
                      <span className="font-mono text-xs">{s.number}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {s.customerName ?? "Walk-in / not listed"}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {new Date(s.soldAt).toLocaleDateString()}
                      </span>
                      <span className="w-28 text-right font-medium tabular-nums">
                        {money(s.total)}
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </Shell>
    );
  }

  /* ── reading a saved document ─────────────────────────────────── */
  if (readOnly && id !== undefined) {
    if (record === undefined) {
      return (
        <Shell onBack={() => navigate(backToSales)} crumbs={crumbs} title={title}>
          <p className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Opening…
          </p>
        </Shell>
      );
    }
    if (record === null) {
      return (
        <Shell onBack={() => navigate(backToSales)} crumbs={crumbs} title={title}>
          <p className="px-4 py-16 text-center text-sm text-muted-foreground">
            That document is no longer on file.
          </p>
        </Shell>
      );
    }
  }

  const target: SalesDocTarget | null =
    id === undefined
      ? kind === "delivery" && invoiceId !== null
        ? { mode: "newDelivery", saleId: invoiceId as Id<"sales"> }
        : {
            mode: "new",
            kind: kind === "delivery" ? "invoice" : kind,
            customer:
              customerId !== null || customerName !== ""
                ? {
                    id: customerId as Id<"customers"> | undefined,
                    name: customerName,
                    address: query.get("address") ?? undefined,
                  }
                : undefined,
          }
      : readOnly
        ? null
        : { mode: "edit", kind, id: id as Id<"quotations"> | Id<"sales"> | Id<"deliveryNotes"> };

  return (
    <Shell onBack={() => navigate(backToSales)} crumbs={crumbs} title={title}>
      {target === null ? (
        <SalesDocumentForm
          layout="page"
          target={{
            mode: "view",
            doc: asPrintable(record as SalesDocRecord, kind),
          }}
          products={products ?? []}
          onClose={() => navigate(backToSales)}
        />
      ) : (
        <SalesDocumentForm
          layout="page"
          target={target}
          products={products ?? []}
          onClose={() => navigate(backToSales)}
          onSaved={(doc) => navigate(savedPath(doc))}
        />
      )}
    </Shell>
  );
}

/**
 * The page frame: where you are, and a way back to the list the document
 * came from. The document brings its own actions, so this stays out of the way.
 */
function Shell({
  crumbs,
  title,
  onBack,
  children,
}: {
  crumbs: string[];
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center gap-3 px-4 py-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs"
            onClick={onBack}
          >
            <ArrowLeft className="size-3.5" /> Sales
          </Button>
          <nav
            aria-label="Breadcrumb"
            className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex"
          >
            {crumbs.map((crumb, i) => (
              <span key={`${crumb}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="size-3" />}
                <span
                  className={cn(
                    i === crumbs.length - 1 && "font-medium text-foreground",
                  )}
                >
                  {crumb}
                </span>
              </span>
            ))}
          </nav>
          <p className="ml-auto flex items-center gap-2 text-sm font-semibold sm:hidden">
            {title === "New delivery note" ? (
              <Truck className="size-4 text-muted-foreground" />
            ) : (
              <FileText className="size-4 text-muted-foreground" />
            )}
            {title}
          </p>
        </div>
      </header>
      <main className="pt-6">{children}</main>
    </div>
  );
}
