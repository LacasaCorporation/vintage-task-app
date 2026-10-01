import {
  ClipboardList,
  HandCoins,
  PackageCheck,
  Receipt,
  Store,
  Wallet,
} from "lucide-react";

/**
 * The sub-pages of the purchase module, in the order the sidebar lists them.
 *
 * They live here, apart from the panels that draw them, because the navigation
 * needs the names and the icons and nothing else — importing them from the
 * panels would pull every purchase screen into the first download for a row of
 * buttons.
 */
export type PurchaseTab =
  | "bills"
  | "lpo"
  | "grv"
  | "payments"
  | "expenses"
  | "vendors";

export const PURCHASE_TABS: {
  id: PurchaseTab;
  label: string;
  icon: typeof Receipt;
  hint: string;
}[] = [
  {
    id: "bills",
    label: "Purchase bills",
    icon: Receipt,
    hint: "Bills from suppliers — saving one brings the stock in",
  },
  {
    id: "lpo",
    label: "Purchase orders",
    icon: ClipboardList,
    hint: "What has been asked of a vendor",
  },
  {
    id: "grv",
    label: "Goods received",
    icon: PackageCheck,
    hint: "Deliveries counted into stock before the bill arrives",
  },
  {
    id: "payments",
    label: "Payments",
    icon: HandCoins,
    hint: "Money paid out to suppliers",
  },
  {
    id: "expenses",
    label: "Expenses",
    icon: Wallet,
    hint: "Money spent that is not stock",
  },
  {
    id: "vendors",
    label: "Vendors",
    icon: Store,
    hint: "The suppliers bills and payments are raised against",
  },
];
