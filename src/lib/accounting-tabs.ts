import {
  BookOpen,
  CalendarDays,
  Landmark,
  Scale,
  ScrollText,
  Wallet,
} from "lucide-react";

/**
 * The sub-pages of the accounting module, in the order the sidebar lists them.
 *
 * They live here, apart from the panel that draws them, because the navigation
 * bar needs the names and the icons — and nothing else. Importing them from the
 * panel pulled the whole ledger, its dialogs and the journal form into the
 * first download of the app, for a row of buttons.
 */
export type AccountingTab =
  | "accounts"
  | "journal"
  | "receipt"
  | "cashbook"
  | "daybook"
  | "balance";

export const ACCOUNTING_TABS: {
  id: AccountingTab;
  label: string;
  icon: typeof BookOpen;
  hint: string;
}[] = [
  { id: "accounts", label: "Chart of accounts", icon: BookOpen, hint: "Every ledger account and its running balance" },
  { id: "balance", label: "Opening balance", icon: Scale, hint: "Opening balances — assets against liabilities and equity" },
  { id: "journal", label: "Journal entry", icon: ScrollText, hint: "A balanced debit and credit posting" },
  { id: "receipt", label: "Receipt / payment", icon: Wallet, hint: "Money received from a customer, or paid to a supplier" },
  { id: "cashbook", label: "Cash book", icon: Landmark, hint: "Cash and bank movement only" },
  { id: "daybook", label: "Day book", icon: CalendarDays, hint: "Every posting, by day" },
];
