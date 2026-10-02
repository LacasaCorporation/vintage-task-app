import {
  ClipboardList,
  HandCoins,
  LayoutDashboard,
  PackageCheck,
  Receipt,
  Store,
  Wallet,
} from "lucide-react";

/**
 * The pages of the purchase module, in the order the sidebar lists them.
 *
 * The order follows the way buying actually runs: an overview, then the four
 * documents in sequence — order, delivery, bill, payment — and the two
 * supporting lists that hang off them.
 *
 * They live here, apart from the panels that draw them, because the navigation
 * needs the names and the icons and nothing else — importing them from the
 * panels would pull every purchase screen into the first download for a row of
 * buttons.
 */
export type PurchaseTab =
  | "dashboard"
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
    id: "dashboard",
    label: "Purchase dashboard",
    icon: LayoutDashboard,
    hint: "Where buying stands — what is on order, owed and paid",
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
    id: "bills",
    label: "Purchase bill",
    icon: Receipt,
    hint: "Bills from suppliers — saving one brings the stock in",
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