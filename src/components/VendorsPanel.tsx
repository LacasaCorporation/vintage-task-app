import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { HandCoins, Loader2, Pencil, Plus, Receipt, Store, Trash2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import ContactDialog from "@/components/ContactDialog";
import VendorLedgerDialog from "@/components/VendorLedgerDialog";
import { useAppDialogs } from "@/components/AppDialogs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The vendor register: every supplier, what was billed, what has been paid and
 * what is still owed. Opening a row shows that vendor's ledger, and a bill or a
 * payment can be started from it.
 */
export default function VendorsPanel({
  canCreate,
  canEdit,
  canDelete,
  onStartBill,
  onOpenBill,
  onStartPayment,
}: {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  /** Opens the bill form with this vendor already chosen. */
  onStartBill?: (vendor: Doc<"vendors">) => void;
  /** Opens a saved bill's detail screen from the vendor's ledger. */
  onOpenBill?: (billId: Id<"purchases">) => void;
  /** Opens the payment form with this vendor already chosen. */
  onStartPayment?: (vendor: Doc<"vendors">) => void;
}) {
  const vendors = useQuery(api.contacts.listVendors);
  const bills = useQuery(api.purchases.list);
  const { format: money } = useWorkspaceCurrency();
  const { confirm } = useAppDialogs();
  const addVendor = useMutation(api.contacts.createVendor);
  const editVendor = useMutation(api.contacts.updateVendor);
  const dropVendor = useMutation(api.contacts.removeVendor);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [editing, setEditing] = useState<Doc<"vendors"> | null>(null);
  const [ledgerVendor, setLedgerVendor] = useState<Doc<"vendors"> | null>(null);

  const outstandingByVendor = useMemo(() => {
    const map = new Map<
      Id<"vendors">,
      { billed: number; paid: number; bills: Doc<"purchases">[] }
    >();
    for (const bill of bills ?? []) {
      if (bill.supplierId === undefined) continue;
      const entry = map.get(bill.supplierId) ?? { billed: 0, paid: 0, bills: [] };
      entry.billed = round2(entry.billed + bill.total);
      if (bill.isPaid === true) entry.paid = round2(entry.paid + bill.total);
      entry.bills.push(bill);
      map.set(bill.supplierId, entry);
    }
    return map;
  }, [bills]);

  const totals = useMemo(() => {
    let billed = 0;
    let paid = 0;
    for (const entry of outstandingByVendor.values()) {
      billed = round2(billed + entry.billed);
      paid = round2(paid + entry.paid);
    }
    return { billed, paid, outstanding: round2(billed - paid) };
  }, [outstandingByVendor]);

  const confirmRemove = async (vendor: Doc<"vendors">) => {
    const ok = await confirm({
      title: `Remove “${vendor.name}”?`,
      message:
        "The vendor is taken off the list. Bills already recorded against it stay, but they will no longer be grouped under it.",
      confirmLabel: "Remove vendor",
      danger: true,
    });
    if (!ok) return;
    try {
      await dropVendor({ id: vendor._id });
      toast.success(`${vendor.name} removed.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't remove the vendor.",
      );
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Vendors
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {vendors?.length ?? 0} supplier{(vendors?.length ?? 0) === 1 ? "" : "s"} ·{" "}
            {money(totals.billed)} billed · {money(totals.paid)} paid ·{" "}
            <span
              className={cn(
                "font-medium",
                totals.outstanding > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {money(totals.outstanding)} outstanding
            </span>
          </span>
        </h2>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setPickerOpen(true);
            }}
            aria-label="New vendor"
            title="New vendor"
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {vendors === undefined ? (
          <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading vendors…
          </div>
        ) : vendors.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Store className="mx-auto size-7 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-medium">No vendors yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add a supplier once and every bill can pick it from the list.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                  <th className="px-4 py-2 text-left font-medium">Vendor</th>
                  <th className="px-3 py-2 text-left font-medium">Contact</th>
                  <th className="px-3 py-2 text-left font-medium">Phone</th>
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Tax no.</th>
                  <th className="px-3 py-2 text-left font-medium">Address</th>
                  <th className="px-3 py-2 text-right font-medium">Bills</th>
                  <th className="px-3 py-2 text-right font-medium">Billed</th>
                  <th className="px-3 py-2 text-right font-medium">Paid</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 text-left font-medium">Credit</th>
                  <th className="w-20 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {vendors.map((vendor) => {
                  const entry = outstandingByVendor.get(vendor._id);
                  const billed = entry?.billed ?? 0;
                  const paid = entry?.paid ?? 0;
                  const owing = round2(billed - paid);
                  const count = entry?.bills.length ?? 0;
                  const overLimit =
                    vendor.creditLimit !== undefined &&
                    owing > vendor.creditLimit;
                  const usedPct =
                    vendor.creditLimit !== undefined && vendor.creditLimit > 0
                      ? Math.min(100, Math.max(0, (owing / vendor.creditLimit) * 100))
                      : 0;
                  return (
                    <tr
                      key={vendor._id}
                      // the whole row opens the ledger; the buttons inside it
                      // stop the click so they keep doing their own thing
                      onClick={() => setLedgerVendor(vendor)}
                      className="cursor-pointer transition-colors hover:bg-accent/40"
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{vendor.name}</p>
                        {vendor.note && (
                          <p className="truncate text-[11px] text-muted-foreground">
                            {vendor.note}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {vendor.contactName || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                        {vendor.phone || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        <span className="block max-w-48 truncate">
                          {vendor.email || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {vendor.taxId || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        <span className="block max-w-56 truncate">
                          {vendor.address || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                        {count}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                        {count > 0 ? money(billed) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                        {paid > 0 ? money(paid) : count > 0 ? "—" : ""}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2.5 text-right font-semibold tabular-nums",
                          owing > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground",
                        )}
                      >
                        {count > 0 ? money(owing) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {vendor.creditLimit !== undefined ? (
                          <div className="min-w-24">
                            <p
                              className={cn(
                                "text-[11px] font-medium tabular-nums",
                                overLimit
                                  ? "text-rose-600 dark:text-rose-400"
                                  : "text-muted-foreground",
                              )}
                            >
                              {overLimit
                                ? `${money(round2(owing - vendor.creditLimit))} over`
                                : `${money(round2(vendor.creditLimit - owing))} left`}
                            </p>
                            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  overLimit
                                    ? "bg-rose-500"
                                    : usedPct > 80
                                      ? "bg-amber-500"
                                      : "bg-emerald-500",
                                )}
                                style={{ width: `${Math.max(usedPct, 2)}%` }}
                              />
                            </div>
                            <p className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                              of {money(vendor.creditLimit)}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <div
                          className="flex items-center justify-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            aria-label={`New bill for ${vendor.name}`}
                            title="Start a bill with this vendor"
                            onClick={() => onStartBill?.(vendor)}
                            className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                          >
                            <Receipt className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Pay ${vendor.name}`}
                            title="Record a payment to this vendor"
                            onClick={() => onStartPayment?.(vendor)}
                            className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                          >
                            <HandCoins className="size-3.5" />
                          </button>
                          {canEdit && (
                            <button
                              type="button"
                              aria-label={`Edit ${vendor.name}`}
                              title="Edit vendor"
                              onClick={() => {
                                setEditing(vendor);
                                setPickerOpen(true);
                              }}
                              className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              aria-label={`Remove ${vendor.name}`}
                              title="Remove vendor"
                              onClick={() => void confirmRemove(vendor)}
                              className="grid size-6 place-items-center rounded text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ledgerVendor !== null && (
        <VendorLedgerDialog
          vendor={ledgerVendor}
          bills={(bills ?? []).filter((b) => b.supplierId === ledgerVendor._id)}
          money={money}
          canCreate={canCreate}
          onClose={() => setLedgerVendor(null)}
          onOpenBill={(id) => {
            setLedgerVendor(null);
            onOpenBill?.(id);
          }}
          onNewBill={() => {
            const vendor = ledgerVendor;
            setLedgerVendor(null);
            onStartBill?.(vendor);
          }}
        />
      )}

      <ContactDialog
        kind="vendor"
        open={pickerOpen}
        onOpenChange={(next) => {
          setPickerOpen(next);
          if (!next) setEditing(null);
        }}
        contacts={vendors}
        editTarget={editing}
        balanceOf={(id) => {
          const entry = outstandingByVendor.get(id as Id<"vendors">);
          return {
            outstanding: round2((entry?.billed ?? 0) - (entry?.paid ?? 0)),
            documents: entry?.bills.length ?? 0,
          };
        }}
        onCreate={async (args) => addVendor(args)}
        onUpdate={async (id, args) => {
          await editVendor({ id: id as Id<"vendors">, ...args });
        }}
        onRemove={async (id) => {
          await dropVendor({ id: id as Id<"vendors"> });
        }}
      />
    </div>
  );
}
