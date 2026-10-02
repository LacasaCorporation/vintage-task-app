import {
  FileText,
  HandCoins,
  LayoutDashboard,
  Receipt,
  ShoppingCart,
  Store,
  Truck,
} from "lucide-react";

/**
 * The pages of the sales module, in the order the sidebar lists them.
 *
 * It is the mirror of the purchase tabs: the same journey with the customer
 * instead of the vendor — an overview, a quotation, an order, an invoice, the
 * goods going out, the money coming in, and the customers it is all raised
 * against.
 *
 * They live here, apart from the panels that draw them, because the navigation
 * needs the names and the icons and nothing else.
 */
export type SalesTab =
  | "dashboard"
  | "quotations"
  | "orders"
  | "invoices"
  | "deliveries"
  | "receipts"
  | "customers";

export const SALES_TABS: {
  id: SalesTab;
  label: string;
  icon: typeof Receipt;
  hint: string;
}[] = [
  {
    id: "dashboard",
    label: "Sales dashboard",
    icon: LayoutDashboard,
    hint: "Where selling stands — quoted, ordered, invoiced and collected",
  },
  {
    id: "quotations",
    label: "Quotations",
    icon: FileText,
    hint: "Offers sent to customers, waiting to be accepted",
  },
  {
    id: "orders",
    label: "Sales orders",
    icon: ShoppingCart,
    hint: "What the customer has confirmed — invoiced in one step",
  },
  {
    id: "invoices",
    label: "Invoices",
    icon: Receipt,
    hint: "What the customer owes; saving one takes the goods out of stock",
  },
  {
    id: "deliveries",
    label: "Delivery notes",
    icon: Truck,
    hint: "Goods handed over against an invoice",
  },
  {
    id: "receipts",
    label: "Receipts",
    icon: HandCoins,
    hint: "Money received from customers",
  },
  {
    id: "customers",
    label: "Customers",
    icon: Store,
    hint: "The customers quotations, orders and receipts are raised against",
  },
];
