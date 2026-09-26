import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Folder, Loader2, Mail, Phone, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ContactDialog from "@/components/ContactDialog";

/**
 * The customer master list: everyone a project can be for, with the projects
 * each one is behind, so the list is useful on its own and not just a picker.
 */
export default function CustomersPanel({
  onPick,
  picked,
}: {
  /** Highlights the customer a project is currently set to. */
  picked?: string;
  onPick?: (name: string) => void;
}) {
  const rows = useQuery(api.contacts.listCustomersWithProjects);
  const addCustomer = useMutation(api.contacts.createCustomer);
  const editCustomer = useMutation(api.contacts.updateCustomer);
  const removeCustomer = useMutation(api.contacts.removeCustomer);
  const [open, setOpen] = useState(false);

  const customers = rows?.map((row) => row.customer) ?? undefined;
  const projectCount = rows?.reduce((sum, row) => sum + row.projects.length, 0) ?? 0;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <p className="text-sm font-semibold">
          <Users className="mr-1.5 inline size-4 text-primary" />
          Customers
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {rows?.length ?? 0} customer{(rows?.length ?? 0) === 1 ? "" : "s"} ·{" "}
            {projectCount} project{projectCount === 1 ? "" : "s"}
          </span>
        </p>
        <Button
          type="button"
          size="sm"
          onClick={() => setOpen(true)}
          className="h-7 rounded-lg px-2.5 text-xs"
        >
          <Plus className="size-3" /> New customer
        </Button>
      </div>

      {rows === undefined ? (
        <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading customers…
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No customers yet — add one and it becomes available on every project.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map(({ customer, projects }) => (
            <li
              key={customer._id}
              className={cn(
                "flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm",
                picked === customer.name && "bg-primary/[0.05]",
              )}
            >
              <Users className="size-3.5 shrink-0 text-sky-500/80" />
              <span className="font-medium">{customer.name}</span>
              {picked === customer.name && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  In use
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {customer.contactName && <span>{customer.contactName}</span>}
                {customer.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="size-2.5" />
                    {customer.phone}
                  </span>
                )}
                {customer.email && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Mail className="size-2.5" />
                    <span className="truncate">{customer.email}</span>
                  </span>
                )}
                {customer.address && (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Folder className="size-2.5" />
                    <span className="truncate">{customer.address}</span>
                  </span>
                )}
              </span>
              {projects.length > 0 ? (
                <span
                  className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  title={projects.map((p) => p.name).join(", ")}
                >
                  {projects.length} project{projects.length === 1 ? "" : "s"}
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  No projects
                </span>
              )}
              {onPick && (
                <button
                  type="button"
                  onClick={() => onPick(customer.name)}
                  className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                >
                  Use
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <ContactDialog
        kind="customer"
        open={open}
        onOpenChange={setOpen}
        contacts={customers}
        onCreate={async (args) => addCustomer(args)}
        onUpdate={async (id, args) => {
          await editCustomer({ id: id as Id<"customers">, ...args });
        }}
        onRemove={async (id) => {
          await removeCustomer({ id: id as Id<"customers"> });
        }}
        onPick={(contact) => onPick?.(contact.name)}
      />
    </section>
  );
}
