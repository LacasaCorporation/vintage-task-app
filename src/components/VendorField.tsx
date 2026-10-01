import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, ChevronDown, Link2, Loader2, Plus, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import ContactDialog from "@/components/ContactDialog";

/**
 * The Supplier field on a purchase bill. Typing a name still works for a
 * one-off supplier, but picking a saved vendor links the bill to that vendor
 * record, so the Vendors tab can count its bills and total what it was billed.
 */
export default function VendorField({
  supplier,
  supplierId,
  address,
  onChange,
}: {
  supplier: string;
  supplierId: Id<"vendors"> | undefined;
  address: string;
  onChange: (patch: {
    supplier?: string;
    supplierId?: Id<"vendors"> | undefined;
    supplierAddress?: string;
  }) => void;
}) {
  const vendors = useQuery(api.contacts.listVendors);
  const addVendor = useMutation(api.contacts.createVendor);
  const editVendor = useMutation(api.contacts.updateVendor);
  const removeVendor = useMutation(api.contacts.removeVendor);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");

  const linked = vendors?.find((vendor) => vendor._id === supplierId);
  const needle = query.trim().toLowerCase();
  const matches =
    needle === ""
      ? (vendors ?? [])
      : (vendors ?? []).filter((vendor) =>
          [vendor.name, vendor.contactName, vendor.phone, vendor.email]
            .filter(Boolean)
            .some((field) => field!.toLowerCase().includes(needle)),
        );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Supplier
        </p>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
        >
          <Plus className="size-3" /> New vendor
        </button>
      </div>

      <div className="flex gap-1.5">
        <div className="relative min-w-0 flex-1">
          <input
            value={supplier}
            onChange={(e) => {
              // editing the text detaches the bill from the saved vendor
              const next = e.target.value;
              onChange({
                supplier: next,
                supplierId: undefined,
                supplierAddress: linked && next !== linked.name ? address : undefined,
              });
            }}
            placeholder="Supplier / vendor name"
            className="h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          />
          <button
            type="button"
            aria-label="Pick a saved vendor"
            title="Pick a saved vendor"
            onClick={() => setMenuOpen((open) => !open)}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="size-4" />
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                aria-label="Close vendor list"
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => {
                  setMenuOpen(false);
                  setQuery("");
                }}
              />
              <ul className="absolute top-full left-0 z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-card py-1 shadow-lg">
                <li className="sticky top-0 bg-card px-1.5 pb-1.5">
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search vendors…"
                    aria-label="Search vendors"
                    className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </li>
                {vendors === undefined ? (
                  <li className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" /> Loading…
                  </li>
                ) : vendors.length === 0 ? (
                  <li className="px-2.5 py-2 text-xs text-muted-foreground">
                    No vendors yet — use “New vendor”.
                  </li>
                ) : matches.length === 0 ? (
                  <li className="px-2.5 py-2 text-xs text-muted-foreground">
                    No vendor matches that.
                  </li>
                ) : (
                  matches.map((vendor) => (
                    <li key={vendor._id}>
                      <button
                        type="button"
                        onClick={() => {
                          onChange({
                            supplier: vendor.name,
                            supplierId: vendor._id,
                            supplierAddress: vendor.address ?? "",
                          });
                          setMenuOpen(false);
                          setQuery("");
                        }}
                        className={cn(
                          "flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-sm hover:bg-accent",
                          vendor._id === supplierId && "bg-primary/10 text-primary",
                        )}
                      >
                        {vendor._id === supplierId ? (
                          <CheckCircle2 className="size-3 shrink-0" />
                        ) : (
                          <span className="size-3 shrink-0" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{vendor.name}</span>
                        {vendor.contactName && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {vendor.contactName}
                          </span>
                        )}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </div>
      </div>

      <textarea
        value={address}
        onChange={(e) => onChange({ supplierAddress: e.target.value })}
        placeholder="Address, contact, phone…"
        rows={2}
        className="w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
      />

      {/* whether this bill is actually attached to a saved vendor */}
      {linked ? (
        <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
          <Link2 className="size-2.5" />
          Linked to “{linked.name}”
          <button
            type="button"
            onClick={() => onChange({ supplierId: undefined })}
            className="inline-flex items-center gap-0.5 rounded-full px-1 hover:bg-emerald-500/20"
            title="Unlink from this vendor"
          >
            <Unlink className="size-2.5" /> Unlink
          </button>
        </p>
      ) : supplier.trim().length > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          Not linked to a saved vendor — this bill won't show in the Vendors tab.
        </p>
      ) : null}

      <ContactDialog
        kind="vendor"
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        contacts={vendors}
        onCreate={async (args) => addVendor(args)}
        onUpdate={async (id, args) => {
          await editVendor({ id: id as Id<"vendors">, ...args });
        }}
        onRemove={async (id) => {
          await removeVendor({ id: id as Id<"vendors"> });
        }}
        onPick={(contact) =>
          onChange({
            supplier: contact.name,
            supplierId: contact.id as Id<"vendors"> | undefined,
            supplierAddress: contact.address ?? address,
          })
        }
      />
    </div>
  );
}
