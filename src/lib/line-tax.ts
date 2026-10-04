/**
 * How a document with per-line tax adds up.
 *
 * Tax used to be one percentage for the whole document, which cannot describe a
 * bill where boards are 18% and glue is 12%. Each line now carries its own
 * rate, and the document total is the sum of what each line actually owes.
 *
 * Discount still applies to the document, so it is shared across lines in
 * proportion to what each one contributes — a line taxed at a higher rate is
 * not charged for a discount it did not get.
 *
 * When every line carries the same rate this reduces exactly to the old
 * formula, so a document raised before per-line tax still reads true.
 */

/**
 * One priced line, with the rate that applies to it.
 *
 * A purchase line calls its price `unitCost` and a sales line calls it
 * `unitPrice`, so either name is accepted and picked up here.
 */
export type TaxedLine = {
  qty: number;
  unitPrice?: number;
  unitCost?: number;
  /** The rate for this line. Absent means no tax on it. */
  taxPct?: number | undefined;
};

/** What one unit of a line costs, whichever name the caller gave it. */
const rateOf = (line: TaxedLine): number => line.unitPrice ?? line.unitCost ?? 0;

export type Priced = {
  /** Line totals before any discount or tax. */
  subtotal: number;
  /** The discount, as a money figure. */
  discount: number;
  /** The document total after discount. */
  net: number;
  /** Tax summed across the lines, each at its own rate. */
  tax: number;
  /** What the customer or supplier pays: net + tax. */
  grand: number;
  /** What one line owes in total, discount and tax included. */
  lineGrand: (line: TaxedLine) => number;
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** A rate the way it is stored: never negative, never above 100. */
export const cleanRate = (value: number | undefined): number =>
  Math.min(100, Math.max(0, value ?? 0));

/**
 * Price a document from its lines. Discount is a percentage of the subtotal,
 * spread across the lines in proportion, and each line is then taxed at its
 * own rate — so the total is the sum of the lines, not one rate applied to
 * everything.
 */
export function priceTaxedLines(
  lines: readonly TaxedLine[],
  discountPct: number | undefined,
): Priced {
  const discountRate = Math.min(100, Math.max(0, discountPct ?? 0));
  const keep = 1 - discountRate / 100;

  let subtotal = 0;
  let net = 0;
  let tax = 0;
  for (const line of lines) {
    const gross = line.qty * rateOf(line);
    subtotal += gross;
    // this line's share of the discount is its share of the subtotal
    const lineNet = gross * keep;
    net += lineNet;
    tax += lineNet * (cleanRate(line.taxPct) / 100);
  }

  return {
    subtotal: cents(subtotal),
    discount: cents(subtotal - net),
    net: cents(net),
    tax: cents(tax),
    grand: cents(net + tax),
    lineGrand: (line) =>
      cents(line.qty * rateOf(line) * keep * (1 + cleanRate(line.taxPct) / 100)),
  };
}

/**
 * The one percentage that would produce this same tax on this same net.
 *
 * The ledger posts a document as a gross total plus a single tax figure, so a
 * document whose lines carry different rates is stored with this blended rate
 * alongside it. Posting stays exact: the tax written to the entry is the tax
 * that was actually calculated, never a re-derived approximation.
 */
export function blendedRate(net: number, tax: number): number {
  if (net <= 0) return 0;
  return Math.round((tax / net) * 100 * 100) / 100;
}