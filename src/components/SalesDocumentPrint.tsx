import type { Doc, Id } from "@/convex/_generated/dataModel";

/**
 * The printed sales document: quotation, invoice or delivery note.
 *
 * Three documents, one sheet. What separates them is not the layout but the
 * claims they make, and the layout is arranged to make that difference
 * obvious rather than to hide it:
 *
 *  - a quotation asks for a decision, so it carries an expiry and no money
 *    is owed;
 *  - an invoice states what is owed and by when, so it carries a due date
 *    and a balance;
 *  - a delivery note says only that the goods left. It carries no totals in
 *    the way an invoice does, because a delivery note that looked like a bill
 *    would get paid by somebody who thought it was one. The value is printed
 *    once, plainly marked as the value of the goods, and never as a balance.
 *
 * The sheet is built as a string and opened in a print window rather than
 * printed from the page, so what comes out is the document and not the app.
 */

export type SalesDocKind = "quotation" | "invoice" | "delivery";

/** Any saved sales document, whichever table it lives in. */
export type SalesDocRecord =
  | Doc<"quotations">
  | Doc<"sales">
  | Doc<"deliveryNotes">;

type Line = {
  productId: Id<"finishedGoods">;
  name: string;
  unit?: string;
  qty: number;
  unitPrice: number;
};

export type FirmProfile = {
  name: string;
  logo?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  taxId?: string;
};

export type PrintableDoc = {
  kind: SalesDocKind;
  number: string;
  date: number;
  /** The customer's own reference — their PO number. */
  poRef?: string;
  /** Invoice: when the money is due. Quotation: when the offer expires. */
  secondaryDate?: number;
  secondaryLabel: string;
  customerName: string;
  customerAddress?: string;
  customerEmail?: string;
  note?: string;
  terms?: string;
  /** Invoice only: the quotation this was raised from. */
  fromRef?: string;
  deliveredBy?: string;
  docketRef?: string;
  receivedBy?: string;
  receivedAt?: number;
  status?: string;
  currency: string;
  lines: Line[];
  discountPct?: number;
  taxPct?: number;
  /** What has been paid against the invoice, if anything. */
  paid?: number;
};

const TITLE: Record<SalesDocKind, string> = {
  quotation: "QUOTATION",
  invoice: "INVOICE",
  delivery: "DELIVERY NOTE",
};

const SUBTITLE: Record<SalesDocKind, string> = {
  quotation: "Offer issued — not a demand for payment",
  invoice: "Payment due as shown below",
  delivery: "Goods received in good condition? Please sign below",
};

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const qtyFmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");

/** The same arithmetic the server uses to price the document. */
function totals(doc: PrintableDoc) {
  const net = doc.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const discount = Math.min(100, Math.max(0, doc.discountPct ?? 0));
  const tax = Math.max(0, doc.taxPct ?? 0);
  const afterDiscount = net - (net * discount) / 100;
  const taxAmount = (afterDiscount * tax) / 100;
  const grand = afterDiscount + taxAmount;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    net: round2(net),
    discount: round2((net * discount) / 100),
    discountPct: discount,
    tax: round2(taxAmount),
    taxPct: tax,
    grand: round2(grand),
  };
}

const STYLE = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif; color: #111827; font-size: 12px;
    line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { max-width: 210mm; margin: 0 auto; padding: 8mm 6mm; }
  .head { display: flex; justify-content: space-between; align-items: flex-start;
    gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 14px; }
  .brand { display: flex; gap: 12px; align-items: flex-start; }
  .logo { width: 52px; height: 52px; object-fit: contain; border-radius: 8px; }
  .brand h1 { margin: 0; font-size: 17px; letter-spacing: -0.01em; }
  .brand .contact { margin-top: 4px; color: #4b5563; font-size: 11px; }
  .brand .contact div { display: block; }
  .doc { text-align: right; }
  .doc .kind { font-size: 22px; font-weight: 700; letter-spacing: 0.08em; }
  .doc .sub { color: #6b7280; font-size: 10.5px; margin-top: 2px; }
  .doc .num { margin-top: 8px; font-size: 13px; font-weight: 600; }
  .parties { display: flex; gap: 24px; margin: 18px 0 6px; }
  .party { flex: 1; }
  .label { font-size: 9.5px; letter-spacing: 0.09em; text-transform: uppercase;
    color: #6b7280; font-weight: 600; }
  .party .name { font-weight: 600; font-size: 13px; margin-top: 4px; }
  .party .lines { color: #374151; margin-top: 2px; font-size: 11.5px; }
  .meta { display: flex; gap: 24px; margin: 14px 0 18px; }
  .meta .block { min-width: 120px; }
  .meta .v { font-weight: 600; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th { text-align: left; font-size: 9.5px; letter-spacing: 0.07em; text-transform: uppercase;
    color: #6b7280; border-bottom: 1px solid #d1d5db; padding: 7px 8px; }
  th.r, td.r { text-align: right; }
  td { padding: 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  td.name { font-weight: 600; }
  td.muted { color: #6b7280; font-size: 11px; }
  .totals { display: flex; justify-content: flex-end; margin-top: 16px; }
  .totals table { width: 260px; }
  .totals td { border: none; padding: 4px 8px; }
  .totals tr.grand td { border-top: 2px solid #111827; font-size: 15px;
    font-weight: 700; padding-top: 8px; }
  .totals tr.due td { font-size: 13px; font-weight: 700; }
  .paid-stamp { display: inline-block; border: 2px solid #047857; color: #047857;
    font-weight: 700; letter-spacing: 0.1em; padding: 3px 10px; border-radius: 4px;
    font-size: 11px; }
  .notes { margin-top: 22px; display: flex; gap: 24px; }
  .notes > div { flex: 1; }
  .notes p { margin: 4px 0 0; color: #374151; font-size: 11.5px; white-space: pre-wrap; }
  .sign { margin-top: 26px; display: flex; gap: 40px; }
  .sign > div { flex: 1; }
  .sign .rule { margin-top: 34px; border-top: 1px solid #9ca3af; padding-top: 4px;
    color: #6b7280; font-size: 10.5px; }
  .foot { margin-top: 26px; border-top: 1px solid #e5e7eb; padding-top: 10px;
    color: #6b7280; font-size: 10px; text-align: center; }
  .warn { margin-top: 14px; border: 1px solid #d1d5db; border-left: 3px solid #111827;
    padding: 8px 12px; font-size: 11px; color: #374151; background: #f9fafb; }
  .due { color: #b91c1c; font-weight: 600; }
`;

/** The printable HTML for one document. Exported so it can be tested. */
export function documentHtml(
  doc: PrintableDoc,
  firm: FirmProfile | null | undefined,
  currency: string,
): string {
  const t = totals(doc);
  const money = (n: number) =>
    `${currency}${n.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const party = doc.customerName.trim() || "Customer";
  const now = Date.now();

  const contact = [
    firm?.address,
    firm?.phone,
    firm?.email,
    firm?.website,
    firm?.taxId ? `Tax ID ${firm.taxId}` : undefined,
  ].filter((v): v is string => Boolean(v && v.trim()));

  const head = `
    <div class="head">
      <div class="brand">
        ${firm?.logo ? `<img class="logo" src="${firm.logo}" alt="" />` : ""}
        <div>
          <h1>${esc(firm?.name || "Your business")}</h1>
          <div class="contact">${contact.map((c) => `<div>${esc(c)}</div>`).join("")}</div>
        </div>
      </div>
      <div class="doc">
        <div class="kind">${TITLE[doc.kind]}</div>
        <div class="sub">${esc(SUBTITLE[doc.kind])}</div>
        <div class="num">${esc(doc.number)}</div>
      </div>
    </div>`;

  const parties = `
    <div class="parties">
      <div class="party">
        <div class="label">${doc.kind === "delivery" ? "Deliver to" : "Bill to"}</div>
        <div class="name">${esc(party)}</div>
        <div class="lines">
          ${(doc.customerAddress ?? "")
            .split("\n")
            .filter((l) => l.trim())
            .map((l) => `<div>${esc(l)}</div>`)
            .join("")}
          ${doc.customerEmail ? `<div>${esc(doc.customerEmail)}</div>` : ""}
        </div>
      </div>
      <div class="party" style="max-width: 46mm;">
        <div class="label">Reference</div>
        <div class="lines" style="margin-top: 4px;">
          ${doc.poRef ? `<div>PO ${esc(doc.poRef)}</div>` : ""}
          ${doc.fromRef ? `<div>From ${esc(doc.fromRef)}</div>` : ""}
          ${doc.docketRef ? `<div>Docket ${esc(doc.docketRef)}</div>` : ""}
          ${doc.kind === "delivery" && doc.status
            ? `<div>Status: ${esc(doc.status)}</div>`
            : ""}
        </div>
      </div>
    </div>`;

  const dateLabel =
    doc.kind === "quotation"
      ? "Quoted on"
      : doc.kind === "invoice"
        ? "Invoice date"
        : "Delivered on";

  const meta = `
    <div class="meta">
      <div class="block">
        <div class="label">${dateLabel}</div>
        <div class="v">${day(doc.date)}</div>
      </div>
      ${
        doc.secondaryDate !== undefined
          ? `<div class="block">
              <div class="label">${esc(doc.secondaryLabel)}</div>
              <div class="v${
                doc.kind === "invoice" && doc.secondaryDate < now ? " due" : ""
              }">${day(doc.secondaryDate)}</div>
            </div>`
          : ""
      }
      ${
        doc.deliveredBy
          ? `<div class="block"><div class="label">Delivered by</div><div class="v">${esc(
              doc.deliveredBy,
            )}</div></div>`
          : ""
      }
    </div>`;

  const rows = doc.lines
    .map(
      (l, i) => `
      <tr>
        <td style="width: 8mm;" class="muted">${i + 1}</td>
        <td class="name">${esc(l.name)}</td>
        <td class="r" style="width: 18mm;">${qtyFmt(l.qty)}</td>
        <td class="muted" style="width: 16mm;">${esc(l.unit ?? "")}</td>
        <td class="r" style="width: 26mm;">${money(l.unitPrice)}</td>
        <td class="r" style="width: 30mm; font-weight: 600;">${money(
          l.qty * l.unitPrice,
        )}</td>
      </tr>`,
    )
    .join("");

  const table = `
    <table>
      <thead>
        <tr>
          <th style="width: 8mm;">#</th>
          <th>Description</th>
          <th class="r" style="width: 18mm;">Qty</th>
          <th style="width: 16mm;">Unit</th>
          <th class="r" style="width: 26mm;">Rate</th>
          <th class="r" style="width: 30mm;">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  // A delivery note shows what the goods are worth, but never as a balance:
  // the day someone treats a delivery note as a bill, it gets paid twice.
  const totalsBlock =
    doc.kind === "delivery"
      ? `
      <div class="totals">
        <table>
          <tr><td>Value of goods delivered</td><td class="r">${money(t.net)}</td></tr>
        </table>
      </div>
      <div class="warn">
        This is a delivery note. It records goods handed over only — it is not an
        invoice and nothing is payable on account of it. The invoice above
        reference is the document that states what is owed.
      </div>`
      : `
      <div class="totals">
        <table>
          <tr><td>Sub total</td><td class="r">${money(t.net)}</td></tr>
          ${
            t.discountPct > 0
              ? `<tr><td>Discount (${t.discountPct}%)</td><td class="r">−${money(
                  t.discount,
                )}</td></tr>`
              : ""
          }
          ${
            t.taxPct > 0
              ? `<tr><td>Tax amount (${t.taxPct}%)</td><td class="r">${money(
                  t.tax,
                )}</td></tr>`
              : ""
          }
          <tr class="grand"><td>Total</td><td class="r">${money(t.grand)}</td></tr>
          ${
            doc.kind === "invoice" && (doc.paid ?? 0) > 0
              ? `<tr><td>Paid</td><td class="r">−${money(doc.paid ?? 0)}</td></tr>
                 <tr class="due"><td>Balance due</td><td class="r">${money(
                   t.grand - (doc.paid ?? 0),
                 )}</td></tr>`
              : ""
          }
        </table>
      </div>`;

  const settled =
    doc.kind === "invoice" && (doc.paid ?? 0) >= t.grand && t.grand > 0;

  const notes = `
    <div class="notes">
      ${
        doc.note
          ? `<div><div class="label">Notes</div><p>${esc(doc.note)}</p></div>`
          : ""
      }
      ${
        doc.terms
          ? `<div><div class="label">${
              doc.kind === "quotation" ? "Terms" : "Payment terms"
            }</div><p>${esc(doc.terms)}</p></div>`
          : ""
      }
    </div>`;

  const signatures =
    doc.kind === "delivery"
      ? `
      <div class="sign">
        <div><div class="label">Received by</div><div class="rule">Name and signature</div></div>
        <div><div class="label">Date</div><div class="rule">&nbsp;</div></div>
        <div><div class="label">Condition on arrival</div><div class="rule">&nbsp;</div></div>
      </div>`
      : `
      <div class="sign">
        <div><div class="label">Accepted for ${esc(
          firm?.name || "the supplier",
        )}</div><div class="rule">Name, signature and date</div></div>
      </div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${TITLE[doc.kind]} ${esc(doc.number)}</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="sheet">
    ${head}
    ${parties}
    ${meta}
    ${table}
    ${totalsBlock}
    ${settled ? `<div style="margin-top:14px"><span class="paid-stamp">PAID IN FULL</span></div>` : ""}
    ${notes}
    ${signatures}
    <div class="foot">
      ${esc(firm?.name || "")}${
        firm?.email ? ` · ${esc(firm.email)}` : ""
      }${firm?.phone ? ` · ${esc(firm.phone)}` : ""}
      ${firm?.taxId ? ` · Tax ID ${esc(firm.taxId)}` : ""}
    </div>
  </div>
</body>
</html>`;
}

/**
 * Open the document in a print window.
 *
 * The styles are written into the document rather than linked, because a
 * print window has no stylesheet pipeline and a printed invoice that arrives
 * unstyled is worse than none at all.
 */
export function printDocument(
  doc: PrintableDoc,
  firm: FirmProfile | null | undefined,
  currency: string,
): boolean {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) return false;
  win.document.open();
  win.document.write(documentHtml(doc, firm, currency));
  win.document.close();
  // give the browser a moment to lay the sheet out before offering the dialog
  win.setTimeout(() => {
    win.focus();
    win.print();
  }, 300);
  return true;
}

/** The document a given saved record is, for the form to reopen it. */
export function docKindOf(
  doc: Doc<"sales"> | Doc<"quotations"> | Doc<"deliveryNotes">,
): SalesDocKind {
  if ("deliveredAt" in doc) return "delivery";
  if ("soldAt" in doc) return "invoice";
  return "quotation";
}

export const DOC_TONE: Record<SalesDocKind, string> = {
  quotation: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  invoice: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  delivery: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
};

export const PRINT_HINT: Record<SalesDocKind, string> = {
  quotation: "Print the quotation for the customer",
  invoice: "Print the invoice for the customer",
  delivery: "Print the delivery note for the driver to sign",
};

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

export { totals as documentTotals };
