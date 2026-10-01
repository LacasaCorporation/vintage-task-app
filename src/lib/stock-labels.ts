/**
 * What each kind of stock movement is called in a transaction list. Kept out
 * of the component files so they only export components.
 */

/** Raw-material movements. */
export const MATERIAL_SOURCE_LABEL: Record<string, string> = {
  purchase: "Bought",
  lpo: "Received on order",
  grv: "Goods received",
  production: "Used in production",
  "production-return": "Returned from production",
  adjustment: "Stock correction",
};

/** Finished-product movements. */
export const PRODUCT_SOURCE_LABEL: Record<string, string> = {
  production: "Came off the line",
  sale: "Invoiced",
  "sale-return": "Invoice removed",
  adjustment: "Stock correction",
};
