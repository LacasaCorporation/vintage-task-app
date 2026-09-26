import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import ContactDialog from "@/components/ContactDialog";

/**
 * The Client field on a project: a list of the saved customers plus a
 * "+ New customer" button that opens the popup, so a project's client is
 * picked from master data instead of being retyped every time. The customer
 * name is written straight to the project, which is what every other surface
 * already reads.
 */
export default function ClientField({
  value,
  onChange,
  className,
  compact = false,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  /** Compact form for a project row: a chip-sized picker. */
  compact?: boolean;
}) {
  const customers = useQuery(api.contacts.listCustomers);
  const addCustomer = useMutation(api.contacts.createCustomer);
  const editCustomer = useMutation(api.contacts.updateCustomer);
  const removeCustomer = useMutation(api.contacts.removeCustomer);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <div className={cn("flex gap-1.5", className)}>
        <div className="relative min-w-0 flex-1">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={compact ? "Add a customer…" : "e.g. Acme Ltd"}
            list="slate-customers"
            className={cn(
              "w-full rounded-lg border bg-card outline-none focus:ring-2 focus:ring-primary/30",
              compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1.5 text-sm",
            )}
          />
          <datalist id="slate-customers">
            {(customers ?? []).map((customer) => (
              <option key={customer._id} value={customer.name} />
            ))}
          </datalist>
          {customers !== undefined && customers.length > 0 && (
            <>
              <button
                type="button"
                aria-label="Pick a customer"
                title="Pick a customer"
                onClick={() => setMenuOpen((open) => !open)}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className="size-3.5" />
              </button>
              {menuOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close customer list"
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setMenuOpen(false)}
                  />
                  <ul className="absolute top-full left-0 z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-card py-1 shadow-lg">
                    {(customers ?? []).map((customer) => (
                      <li key={customer._id}>
                        <button
                          type="button"
                          onClick={() => {
                            onChange(customer.name);
                            setMenuOpen(false);
                          }}
                          className={cn(
                            "flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-sm hover:bg-accent",
                            customer.name === value && "bg-primary/10 text-primary",
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate">{customer.name}</span>
                          {customer.contactName && (
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {customer.contactName}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          title="Create a customer"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-primary/40 font-medium text-primary transition-colors hover:bg-primary/10",
            compact ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1.5 text-[11px]",
          )}
        >
          {customers === undefined ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Plus className="size-3" />
          )}
          New customer
        </button>
      </div>

      <ContactDialog
        kind="customer"
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        contacts={customers}
        onCreate={async (args) => addCustomer(args)}
        onUpdate={async (id, args) => {
          await editCustomer({ id: id as Id<"customers">, ...args });
        }}
        onRemove={async (id) => {
          await removeCustomer({ id: id as Id<"customers"> });
        }}
        onPick={(contact) => onChange(contact.name)}
      />
    </>
  );
}
