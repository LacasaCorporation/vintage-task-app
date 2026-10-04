import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Folder, Loader2, Mail, Phone, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ContactDialog from "@/components/ContactDialog";
import CustomerLedgerDialog from "@/components/CustomerLedgerDialog";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The customer master list: everyone a project can be for, with the projects
 * each one is behind, so the list is useful on its own and not just a picker.
 *
 * The money columns are a statement at a glance; clicking a row opens the same
 * statement in full, so a customer can be interrogated without leaving the
 * list. Mirrors the Vendors tab in Purchase.
 */
export default function CustomersPanel({
  picked,
  onPick,
}: {
  /** Highlights the customer a project is currently set to. */
  picked?: string;
  onPick?: (name: string) => void;
}) {
  const { format: money } = useWorkspaceCurrency();
  const rows = useQuery(api.contacts.listCustomersWithProjects);
  const sales = useQuery(api.sales.listSales);
  const addCustomer = useMutation(api.contacts.createCustomer);
  const editCustomer = useMutation(api.contacts.updateCustomer);
  const removeCustomer = useMutation(api.contacts.removeCustomer);
  const [open, setOpen] = useState(false);
  const [ledgerCustomer, setLedgerCustomer] = useState<Doc<"customers"> | null>(
    null,
  );

  const customers = rows?.map((row) => row.customer) ?? undefined;
  const projectCount = rows?.reduce((sum, row) => sum + row.projects.length, 0) ?? 0;

  /** Everything invoiced and received across the whole book, for the header. */
  const totals = (sales ?? []).reduce(
    (acc, s) => ({
      invoiced: round2(acc.invoiced + s.total),
      received: round2(acc.received + (s.isPaid === true ? s.total : 0)),
    }),
    { invoiced: 0, received: 0 },
  );
  const outstanding = round2(totals.invoiced - totals.received);

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <p className="text-sm font-semibold">
          <Users className="mr-1.5 inline size-4 text-primary" />
          Customers
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {rows?.length ?? 0} customer{(rows?.length ?? 0) === 1 ? "" : "s"} ·{" "}
            {projectCount} project{projectCount === 1 ? "" : "s"} ·{" "}
            {money(totals.invoiced)} invoiced · {money(totals.received)} received ·{" "}
            <span
              className={cn(
                "font-medium",
                outstanding > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400",
              )}
            >
              {money(outstanding)} outstanding
            </span>
          </span>
        </p>
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            Click a row to open its statement
          </span>
          <Button
            type="button"
            size="sm"
            onClick={() => setOpen(true)}
            className="h-7 rounded-lg px-2.5 text-xs"
          >
            <Plus className="size-3" /> New customer
          </Button>
        </div>
      </div>

      {rows === undefined || sales === undefined ? (
        <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading customers…
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          No customers yet — add one and it becomes available on every project.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/60 text-[11px] tracking-wide text-muted-foreground uppercase">
                <th className="px-4 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-left font-medium">Contact</th>
                <th className="px-3 py-2 text-left font-medium">Phone</th>
                <th className="px-3 py-2 text-left font-medium">Email</th>
                <th className="px-3 py-2 text-left font-medium">Tax no.</th>
                <th className="px-3 py-2 text-left font-medium">Projects</th>
                <th className="px-3 py-2 text-right font-medium">Invoices</th>
                <th className="px-3 py-2 text-right font-medium">Invoiced</th>
                <th className="px-3 py-2 text-right font-medium">Received</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2 text-left font-medium">Credit</th>
                <th className="w-14 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map(({ customer, projects }) => {
                const theirSales = (sales ?? []).filter(
                  (s) => s.customerId === customer._id,
                );
                const invoiced = round2(
                  theirSales.reduce((sum, s) => sum + s.total, 0),
                );
                const received = round2(
                  theirSales
                    .filter((s) => s.isPaid === true)
                    .reduce((sum, s) => sum + s.total, 0),
                );
                const owing = round2(invoiced - received);
                const overLimit =
                  customer.creditLimit !== undefined &&
                  owing > customer.creditLimit;
                const usedPct =
                  customer.creditLimit !== undefined && customer.creditLimit > 0
                    ? Math.min(100, Math.max(0, (owing / customer.creditLimit) * 100))
                    : 0;
                return (
                  <tr
                    key={customer._id}
                    // the whole row opens the statement
                    onClick={() => setLedgerCustomer(customer)}
                    title={`Open the ${customer.name} statement`}
                    className={cn(
                      "group/customer cursor-pointer transition-colors hover:bg-accent/40",
                      picked === customer.name && "bg-primary/[0.05]",
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-medium">
                        <span className="underline decoration-transparent underline-offset-2 transition-colors group-hover/customer:decoration-current">
                          {customer.name}
                        </span>
                        {picked === customer.name && (
                          <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            In use
                          </span>
                        )}
                      </p>
                      {customer.address && (
                        <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                          <Folder className="size-2.5 shrink-0" />
                          <span className="truncate">{customer.address}</span>
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {customer.contactName || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                      {customer.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-2.5" />
                          {customer.phone}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {customer.email ? (
                        <span className="flex min-w-0 items-center gap-1">
                          <Mail className="size-2.5 shrink-0" />
                          <span className="block max-w-40 truncate">
                            {customer.email}
                          </span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                      {customer.taxId || "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {projects.length > 0 ? (
                        <span
                          className="inline-block max-w-40 truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          title={projects.map((p) => p.name).join(", ")}
                        >
                          {projects.length} project
                          {projects.length === 1 ? "" : "s"}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums">
                      {theirSales.length}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium tabular-nums">
                      {theirSales.length > 0 ? money(invoiced) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400">
                      {received > 0 ? money(received) : theirSales.length > 0 ? "—" : ""}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2.5 text-right font-semibold tabular-nums",
                        owing > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {theirSales.length > 0 ? money(owing) : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {customer.creditLimit !== undefined ? (
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
                              ? `${money(round2(owing - customer.creditLimit))} over`
                              : `${money(round2(customer.creditLimit - owing))} left`}
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
                            of {money(customer.creditLimit)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {onPick && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPick(customer.name);
                          }}
                          className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                        >
                          Use
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ledgerCustomer !== null && (
        <CustomerLedgerDialog
          customer={ledgerCustomer}
          sales={(sales ?? []).filter((s) => s.customerId === ledgerCustomer._id)}
          money={money}
          onClose={() => setLedgerCustomer(null)}
        />
      )}

      <ContactDialog
        kind="customer"
        open={open}
        onOpenChange={setOpen}
        contacts={customers}
        balanceOf={(id) => {
          const theirs = (sales ?? []).filter((s) => s.customerId === id);
          const billed = round2(theirs.reduce((sum, s) => sum + s.total, 0));
          const settled = round2(
            theirs
              .filter((s) => s.isPaid === true)
              .reduce((sum, s) => sum + s.total, 0),
          );
          return {
            outstanding: round2(billed - settled),
            documents: theirs.length,
          };
        }}
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
