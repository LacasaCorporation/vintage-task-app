import type { Doc, Id } from "@/convex/_generated/dataModel";
import PartyLedgerDialog, {
  SUPPLIER_ROLE,
  type PartyDocument,
} from "@/components/PartyLedgerDialog";

type VendorDoc = Doc<"vendors">;
type BillDoc = Doc<"purchases">;

/**
 * What one supplier owes you, bill by bill: everything billed, everything
 * settled, and the running balance in between. Opened by clicking a vendor in
 * the Purchase → Vendors table.
 */
export default function VendorLedgerDialog({
  vendor,
  bills,
  money,
  onClose,
  onOpenBill,
  onNewBill,
  canCreate = true,
}: {
  vendor: VendorDoc;
  bills: BillDoc[];
  money: (n: number) => string;
  onClose: () => void;
  /** Open an existing bill for reading. */
  onOpenBill: (id: Id<"purchases">) => void;
  /** Start a new bill with this vendor. */
  onNewBill: () => void;
  canCreate?: boolean;
}) {
  return (
    <PartyLedgerDialog
      party={vendor}
      role={SUPPLIER_ROLE}
      documents={bills.map(
        (b): PartyDocument<Id<"purchases">> => ({
          id: b._id,
          number: b.number,
          at: b.purchasedAt,
          dueAt: b.dueAt,
          total: b.total,
          isPaid: b.isPaid === true,
          note: b.note,
        }),
      )}
      money={money}
      onClose={onClose}
      onOpenDocument={onOpenBill}
      onNewDocument={onNewBill}
      canCreate={canCreate}
    />
  );
}
