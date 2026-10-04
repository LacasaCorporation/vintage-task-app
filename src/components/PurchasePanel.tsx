import { useState } from "react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import LpoPanel from "@/components/LpoPanel";
import PurchaseDashboard from "@/components/PurchaseDashboard";
import ExpensesPanel from "@/components/ExpensesPanel";
import BillsPanel, { type BillSeed } from "@/components/BillsPanel";
import PaymentsPanel, { type PaymentSeed } from "@/components/PaymentsPanel";
import GrvPanel, { type GrvSeed } from "@/components/GrvPanel";
import VendorsPanel from "@/components/VendorsPanel";
import type { PurchaseTab } from "@/lib/purchase-tabs";

type MaterialDoc = Doc<"rawMaterials">;
type LpoDoc = Doc<"lpos">;
type GrvDoc = Doc<"grvs">;
type VendorDoc = Doc<"vendors">;

/**
 * Buying: one section at a time, each a full screen of its own.
 *
 * The sections used to be tabs across the top of one panel, which made every
 * document feel like a widget on a page. They are now separate screens reached
 * from the sidebar, so a bill, an order, a delivery, a payment, an expense and
 * a vendor each get the whole working area — and the cross-links between them
 * (raise a bill from an order, pay a vendor) move you to the right screen
 * instead of opening a dialog over the one you were on.
 */
export default function PurchasePanel({
  materials,
  canCreate,
  canEdit,
  canDelete,
  tab,
  onTabChange,
}: {
  materials: MaterialDoc[];
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Which purchase section is open. */
  tab: PurchaseTab;
  onTabChange: (tab: PurchaseTab) => void;
}) {
  // A bill being started from somewhere else in the module. The key forces the
  // bills panel to remount so its form opens from the seed rather than being
  // filled in after the fact.
  const [billSeed, setBillSeed] = useState<BillSeed | null>(null);
  const [billKey, setBillKey] = useState(0);
  const [paymentSeed, setPaymentSeed] = useState<PaymentSeed>(null);
  const [paymentKey, setPaymentKey] = useState(0);
  // A voucher being started from an order. Same one-shot arrangement as the
  // bill: the panel is remounted so its form opens from the seed.
  const [grvSeed, setGrvSeed] = useState<GrvSeed | null>(null);
  const [grvKey, setGrvKey] = useState(0);

  /**
   * A cross-link — raising a bill from an order, paying a vendor — is consumed
   * once. Leaving a section drops it, so coming back shows the register rather
   * than reopening whatever was being filled in. Kept as derived state, the
   * same way the sidebar follows the open area, rather than as an effect that
   * would fire a second render every time.
   */
  const [lastTab, setLastTab] = useState(tab);
  if (lastTab !== tab) {
    setLastTab(tab);
    if (tab !== "bills" && billSeed !== null) setBillSeed(null);
    if (tab !== "payments" && paymentSeed !== null) setPaymentSeed(null);
    if (tab !== "grv" && grvSeed !== null) setGrvSeed(null);
  }

  const startBillFromLpo = (lpo: LpoDoc) => {
    setBillSeed({ mode: "fromLpo", lpo });
    setBillKey((k) => k + 1);
    onTabChange("bills");
  };

  /** The same, from a delivery rather than an order. */
  const startBillFromGrv = (grv: GrvDoc) => {
    setBillSeed({ mode: "fromGrv", grv });
    setBillKey((k) => k + 1);
    onTabChange("bills");
  };

  /** Record what arrived against an order. */
  const startGrvFromLpo = (lpo: LpoDoc) => {
    setGrvSeed({ mode: "new", lpoId: lpo._id });
    setGrvKey((k) => k + 1);
    onTabChange("grv");
  };

  const startBillForVendor = (vendor: VendorDoc) => {
    setBillSeed({
      mode: "new",
      supplierId: vendor._id,
      supplier: vendor.name,
      address: vendor.address,
    });
    setBillKey((k) => k + 1);
    onTabChange("bills");
  };

  const viewBill = (billId: Id<"purchases">) => {
    setBillSeed({ mode: "view", billId });
    setBillKey((k) => k + 1);
    onTabChange("bills");
  };

  const startPaymentForVendor = (vendor: VendorDoc) => {
    setPaymentSeed({ vendorId: vendor._id, vendor: vendor.name });
    setPaymentKey((k) => k + 1);
    onTabChange("payments");
  };

  if (tab === "dashboard") {
    return <PurchaseDashboard onTabChange={onTabChange} />;
  }

  if (tab === "lpo") {
    return (
      <LpoPanel
        materials={materials}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        onCreateBill={startBillFromLpo}
        onCreateGrv={startGrvFromLpo}
      />
    );
  }

  if (tab === "grv") {
    return (
      <GrvPanel
        key={grvKey}
        materials={materials}
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        seed={grvSeed}
        onCreateBill={startBillFromGrv}
      />
    );
  }

  if (tab === "payments") {
    return (
      <PaymentsPanel
        key={paymentKey}
        canCreate={canCreate}
        canDelete={canDelete}
        seed={paymentSeed}
      />
    );
  }

  if (tab === "expenses") {
    return (
      <ExpensesPanel
        canCreate={canCreate}
        canDelete={canDelete}
      />
    );
  }

  if (tab === "vendors") {
    return (
      <VendorsPanel
        canCreate={canCreate}
        canEdit={canEdit}
        canDelete={canDelete}
        onStartBill={startBillForVendor}
        onOpenBill={viewBill}
        onStartPayment={startPaymentForVendor}
      />
    );
  }

  return (
    <BillsPanel
      key={billKey}
      materials={materials}
      canCreate={canCreate}
      canEdit={canEdit}
      canDelete={canDelete}
      seed={billSeed}
    />
  );
}
