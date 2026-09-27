import type { Doc, Id } from "@/convex/_generated/dataModel";
import PartyLedgerDialog, {
  CUSTOMER_ROLE,
  type PartyDocument,
} from "@/components/PartyLedgerDialog";

type CustomerDoc = Doc<"customers">;
type SaleDoc = Doc<"sales">;

/**
 * What one customer owes you, invoice by invoice: everything invoiced,
 * everything received, and the running balance in between. Opened by clicking
 * a customer in the Projects → Customers list.
 */
export default function CustomerLedgerDialog({
  customer,
  sales,
  money,
  onClose,
  onOpenInvoice,
  onNewInvoice,
  canCreate = true,
}: {
  customer: CustomerDoc;
  sales: SaleDoc[];
  money: (n: number) => string;
  onClose: () => void;
  /** Open an existing invoice for reading, where a viewer can be reached. */
  onOpenInvoice?: (id: Id<"sales">) => void;
  /** Start a new invoice for this customer. */
  onNewInvoice?: () => void;
  canCreate?: boolean;
}) {
  return (
    <PartyLedgerDialog
      party={customer}
      role={CUSTOMER_ROLE}
      documents={sales.map(
        (s): PartyDocument<Id<"sales">> => ({
          id: s._id,
          number: s.number,
          at: s.soldAt,
          dueAt: s.dueAt,
          total: s.total,
          isPaid: s.isPaid === true,
          note: s.note,
        }),
      )}
      money={money}
      onClose={onClose}
      onOpenDocument={onOpenInvoice}
      onNewDocument={onNewInvoice}
      canCreate={canCreate}
    />
  );
}
