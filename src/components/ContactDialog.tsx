import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CreditCard,
  Landmark,
  Loader2,
  Mail,
  MapPin,
  Percent,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Search,
  Store,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

type Kind = "vendor" | "customer";

/**
 * One saved vendor or customer, as returned by the contacts queries. Every
 * field beyond the name is optional, so rows saved before the company, tax and
 * credit fields existed still read true.
 */
export type Contact = {
  _id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  note?: string;
  legalName?: string;
  contactRole?: string;
  altPhone?: string;
  website?: string;
  taxId?: string;
  taxOffice?: string;
  defaultTaxPct?: number;
  registrationNo?: string;
  currency?: string;
  leadTimeDays?: number;
  creditLimit?: number;
  creditDays?: number;
  priceList?: string;
};

/**
 * What the dialog hands back to be saved. Numeric fields are already numbers
 * here, and anything left blank is `undefined` rather than a zero the user
 * never typed.
 */
export type ContactPayload = {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  note?: string;
  legalName?: string;
  contactRole?: string;
  altPhone?: string;
  website?: string;
  taxId?: string;
  taxOffice?: string;
  defaultTaxPct?: number;
  registrationNo?: string;
  currency?: string;
  leadTimeDays?: number;
  creditLimit?: number;
  creditDays?: number;
  priceList?: string;
};

/** Every field as text, so one draft can drive every input. */
const emptyDraft = {
  name: "",
  legalName: "",
  registrationNo: "",
  website: "",
  contactName: "",
  contactRole: "",
  phone: "",
  altPhone: "",
  email: "",
  address: "",
  note: "",
  taxId: "",
  taxOffice: "",
  defaultTaxPct: "",
  currency: "",
  creditLimit: "",
  creditDays: "",
  leadTimeDays: "",
  priceList: "",
};

type Draft = typeof emptyDraft;

/** A number the user left blank stays blank; anything else is parsed. */
const numOrUndefined = (value: string): number | undefined => {
  const clean = value.trim();
  if (clean === "") return undefined;
  const n = Number(clean);
  return Number.isFinite(n) ? n : undefined;
};

const textOrUndefined = (value: string): string | undefined => {
  const clean = value.trim();
  return clean === "" ? undefined : clean;
};

/** The tab strip down the side of the form. */
const TABS = [
  { id: "identity", label: "Company", icon: Building2 },
  { id: "contact", label: "Contact", icon: UserRound },
  { id: "tax", label: "Tax & billing", icon: Landmark },
  { id: "credit", label: "Credit", icon: CreditCard },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * One labelled field. The label is the app's small uppercase caption, with an
 * optional sentence underneath that says what the number is for.
 */
function Field({
  label,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
        {required === true && <span className="text-destructive"> *</span>}
      </span>
      {children}
      {hint !== undefined && (
        <span className="block text-[11px] leading-snug text-muted-foreground/85">
          {hint}
        </span>
      )}
    </label>
  );
}

/**
 * The vendor / customer master form.
 *
 * It opens as a list of everyone already saved — so a bill or a project can
 * pick a name instead of retyping one — and the same panel becomes the full
 * record: the company behind the trading name, the person to ask for, the tax
 * registration, and the credit terms. The credit tab shows what is currently
 * owed, so the limit is a number with a meaning rather than a bare field.
 */
export default function ContactDialog({
  kind,
  open,
  onOpenChange,
  contacts,
  onCreate,
  onUpdate,
  onRemove,
  onPick,
  editTarget,
  balanceOf,
}: {
  kind: Kind;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  contacts: Contact[] | undefined;
  onCreate: (args: ContactPayload) => Promise<string>;
  onUpdate: (id: string, args: ContactPayload) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Called with the name (and id) the user settled on. */
  onPick?: (contact: { id?: string; name: string; address?: string }) => void;
  /** Row to load straight into the form, set by an edit button outside. */
  editTarget?: Contact | null;
  /**
   * What a saved contact currently owes, so the credit tab can show the
   * headroom. Omitted where the caller has no balances to hand.
   */
  balanceOf?: (
    id: string,
  ) => { outstanding: number; documents: number } | undefined;
}) {
  const label = kind === "vendor" ? "vendor" : "customer";
  const plural = kind === "vendor" ? "Vendors" : "Customers";
  const { format: money } = useWorkspaceCurrency();

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("identity");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  /** Whether the form is showing, as opposed to the list of everyone saved. */
  const [formMode, setFormMode] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /** Load a saved row into the form, or clear it for a new one. */
  const openForm = (contact?: Contact) => {
    setEditingId(contact?._id ?? null);
    setTab("identity");
    setFormMode(true);
    setDraft(
      contact === undefined
        ? emptyDraft
        : {
            name: contact.name,
            legalName: contact.legalName ?? "",
            registrationNo: contact.registrationNo ?? "",
            website: contact.website ?? "",
            contactName: contact.contactName ?? "",
            contactRole: contact.contactRole ?? "",
            phone: contact.phone ?? "",
            altPhone: contact.altPhone ?? "",
            email: contact.email ?? "",
            address: contact.address ?? "",
            note: contact.note ?? "",
            taxId: contact.taxId ?? "",
            taxOffice: contact.taxOffice ?? "",
            defaultTaxPct:
              contact.defaultTaxPct !== undefined
                ? String(contact.defaultTaxPct)
                : "",
            currency: contact.currency ?? "",
            creditLimit:
              contact.creditLimit !== undefined ? String(contact.creditLimit) : "",
            creditDays:
              contact.creditDays !== undefined ? String(contact.creditDays) : "",
            leadTimeDays:
              contact.leadTimeDays !== undefined ? String(contact.leadTimeDays) : "",
            priceList: contact.priceList ?? "",
          },
    );
  };

  const closeForm = () => {
    setEditingId(null);
    setDraft(emptyDraft);
    setFormMode(false);
  };

  // an edit button elsewhere (a list row) can open the dialog already filled in
  const [prefilledId, setPrefilledId] = useState<string | null>(null);
  const prefillTargetId = open && editTarget ? editTarget._id : null;
  if (prefillTargetId !== prefilledId) {
    setPrefilledId(prefillTargetId);
    if (editTarget) openForm(editTarget);
  }

  const close = (next: boolean) => {
    if (!next) {
      closeForm();
      setQuery("");
    }
    onOpenChange(next);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.name.trim().length === 0) {
      toast.error(`Give the ${label} a name.`);
      setTab("identity");
      return;
    }
    const payload: ContactPayload = {
      name: draft.name.trim(),
      legalName: textOrUndefined(draft.legalName),
      registrationNo: textOrUndefined(draft.registrationNo),
      website: textOrUndefined(draft.website),
      contactName: textOrUndefined(draft.contactName),
      contactRole: textOrUndefined(draft.contactRole),
      phone: textOrUndefined(draft.phone),
      altPhone: textOrUndefined(draft.altPhone),
      email: textOrUndefined(draft.email),
      address: textOrUndefined(draft.address),
      note: textOrUndefined(draft.note),
      taxId: textOrUndefined(draft.taxId),
      taxOffice: textOrUndefined(draft.taxOffice),
      defaultTaxPct: numOrUndefined(draft.defaultTaxPct),
      currency: textOrUndefined(draft.currency),
      creditLimit: numOrUndefined(draft.creditLimit),
      creditDays: numOrUndefined(draft.creditDays),
      leadTimeDays: numOrUndefined(draft.leadTimeDays),
      priceList: textOrUndefined(draft.priceList),
    };
    setBusy(true);
    try {
      if (editingId === null) {
        const id = await onCreate(payload);
        toast.success(`${label[0]!.toUpperCase()}${label.slice(1)} “${payload.name}” added.`);
        onPick?.({ id, name: payload.name, address: payload.address });
        close(false);
      } else {
        await onUpdate(editingId, payload);
        toast.success(`${label[0]!.toUpperCase()}${label.slice(1)} updated.`);
        onPick?.({ id: editingId, name: payload.name, address: payload.address });
        closeForm();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Couldn't save the ${label}.`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (contact: Contact) => {
    setBusy(true);
    try {
      await onRemove(contact._id);
      toast.success(`“${contact.name}” removed.`);
      if (editingId === contact._id) closeForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Couldn't remove the ${label}.`);
    } finally {
      setBusy(false);
    }
  };

  const needle = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (needle === "") return contacts ?? [];
    return (contacts ?? []).filter((c) =>
      [
        c.name,
        c.legalName,
        c.contactName,
        c.contactRole,
        c.phone,
        c.email,
        c.taxId,
        c.address,
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(needle)),
    );
  }, [contacts, needle]);

  /** What the contact being edited owes, for the credit tab. */
  const balance = editingId !== null ? balanceOf?.(editingId) : undefined;
  const limit = numOrUndefined(draft.creditLimit);
  const overBy =
    limit !== undefined && balance !== undefined
      ? Math.max(0, balance.outstanding - limit)
      : 0;
  const headroom =
    limit !== undefined && balance !== undefined ? limit - balance.outstanding : undefined;
  const usedPct =
    limit !== undefined && limit > 0 && balance !== undefined
      ? Math.min(100, Math.max(0, (balance.outstanding / limit) * 100))
      : 0;

  const Icon = kind === "vendor" ? Store : Users;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {/* ── header ─────────────────────────────────────────────── */}
        <DialogHeader className="flex-row items-start gap-3 border-b bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent px-5 py-4 pr-12 text-left">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="font-display text-base font-semibold">
              {formMode
                ? editingId === null
                  ? `New ${label}`
                  : `Edit ${draft.name || label}`
                : plural}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {formMode
                ? `Company details, the person to contact, tax registration and credit terms.`
                : kind === "vendor"
                  ? "Suppliers you buy raw materials from. Pick one to fill this bill."
                  : "People and companies your projects are for. Pick one to fill this project."}
            </DialogDescription>
          </div>
        </DialogHeader>

        {formMode ? (
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            {/* ── tab strip ──────────────────────────────────────── */}
            <div className="border-b px-5 py-2.5">
              <div className="flex flex-wrap gap-1 rounded-xl border bg-muted/40 p-1">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    aria-current={tab === t.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                      tab === t.id
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <t.icon className="size-3.5" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {/* ── company ────────────────────────────────────── */}
              {tab === "identity" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Name"
                    required
                    hint="How this contact is filed in every list and picker."
                    className="sm:col-span-2"
                  >
                    <Input
                      value={draft.name}
                      autoFocus
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="e.g. Maida Traders"
                      className="h-10 rounded-lg text-sm"
                    />
                  </Field>
                  <Field
                    label="Legal / registered name"
                    hint="The entity that goes on the paperwork, if it differs."
                  >
                    <Input
                      value={draft.legalName}
                      onChange={(e) => set("legalName", e.target.value)}
                      placeholder="e.g. Maida Traders Pvt Ltd"
                      className="h-10 rounded-lg text-sm"
                    />
                  </Field>
                  <Field
                    label="Company registration no."
                    hint="Incorporation or business registration number."
                  >
                    <Input
                      value={draft.registrationNo}
                      onChange={(e) => set("registrationNo", e.target.value)}
                      placeholder="e.g. PV-123456"
                      className="h-10 rounded-lg text-sm"
                    />
                  </Field>
                  <Field label="Website" className="sm:col-span-2">
                    <Input
                      value={draft.website}
                      onChange={(e) => set("website", e.target.value)}
                      placeholder="e.g. maidatraders.com"
                      className="h-10 rounded-lg text-sm"
                    />
                  </Field>
                </div>
              )}

              {/* ── contact ────────────────────────────────────── */}
              {tab === "contact" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Contact person">
                    <Input
                      value={draft.contactName}
                      onChange={(e) => set("contactName", e.target.value)}
                      placeholder="e.g. Ravi Kumar"
                      className="h-10 rounded-lg text-sm"
                    />
                  </Field>
                  <Field label="Their role" hint="Who to ask for, and about what.">
                    <Input
                      value={draft.contactRole}
                      onChange={(e) => set("contactRole", e.target.value)}
                      placeholder="e.g. Sales manager"
                      className="h-10 rounded-lg text-sm"
                    />
                  </Field>
                  <Field label="Phone">
                    <Input
                      value={draft.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      placeholder="e.g. +91 98765 43210"
                      className="h-10 rounded-lg text-sm"
                    />
                  </Field>
                  <Field label="Alternate phone" hint="Office line, or a second person.">
                    <Input
                      value={draft.altPhone}
                      onChange={(e) => set("altPhone", e.target.value)}
                      placeholder="Optional"
                      className="h-10 rounded-lg text-sm"
                    />
                  </Field>
                  <Field label="Email" className="sm:col-span-2">
                    <Input
                      type="email"
                      value={draft.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="e.g. accounts@maidatraders.com"
                      className="h-10 rounded-lg text-sm"
                    />
                  </Field>
                  <Field
                    label="Address"
                    className="sm:col-span-2"
                    hint="Printed on orders, vouchers and bills raised against this contact."
                  >
                    <Textarea
                      value={draft.address}
                      onChange={(e) => set("address", e.target.value)}
                      rows={2}
                      placeholder="Street, city, postal code"
                      className="rounded-lg text-sm"
                    />
                  </Field>
                  <Field
                    label="Note"
                    className="sm:col-span-2"
                    hint="Payment terms, opening hours, anything worth remembering."
                  >
                    <Textarea
                      value={draft.note}
                      onChange={(e) => set("note", e.target.value)}
                      rows={2}
                      placeholder="Payment terms, tax id, opening hours…"
                      className="rounded-lg text-sm"
                    />
                  </Field>
                </div>
              )}

              {/* ── tax ────────────────────────────────────────── */}
              {tab === "tax" && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Tax registration number"
                      hint="VAT, TIN or GSTIN — whichever this firm registers under."
                    >
                      <Input
                        value={draft.taxId}
                        onChange={(e) => set("taxId", e.target.value)}
                        placeholder="e.g. 27AABCU9603R1ZM"
                        className="h-10 rounded-lg font-mono text-sm"
                      />
                    </Field>
                    <Field
                      label="Tax office / jurisdiction"
                      hint="Where that number is registered."
                    >
                      <Input
                        value={draft.taxOffice}
                        onChange={(e) => set("taxOffice", e.target.value)}
                        placeholder="e.g. Mumbai West"
                        className="h-10 rounded-lg text-sm"
                      />
                    </Field>
                    <Field
                      label="Default tax rate"
                      hint={
                        kind === "vendor"
                          ? "Offered on this supplier's purchase lines. A line can still differ."
                          : "Offered on this customer's sales lines. A line can still differ."
                      }
                    >
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          step="any"
                          value={draft.defaultTaxPct}
                          onChange={(e) => set("defaultTaxPct", e.target.value)}
                          placeholder="0"
                          className="h-10 rounded-lg pr-8 text-sm tabular-nums"
                        />
                        <Percent className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      </div>
                    </Field>
                    <Field
                      label="Currency"
                      hint="Only if they bill in something other than the workspace default."
                    >
                      <Input
                        value={draft.currency}
                        onChange={(e) => set("currency", e.target.value)}
                        placeholder="e.g. USD"
                        className="h-10 rounded-lg text-sm uppercase"
                      />
                    </Field>
                  </div>
                  <p className="flex items-start gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[11px] leading-snug text-muted-foreground">
                    <BadgeCheck className="mt-px size-3.5 shrink-0 text-primary" />
                    The tax number is stored exactly as typed and shown on every
                    document raised against this {label}, so it can also be used as
                    a compliance reference.
                  </p>
                </div>
              )}

              {/* ── credit ─────────────────────────────────────── */}
              {tab === "credit" && (
                <div className="space-y-4">
                  {/* where they stand right now */}
                  {balance !== undefined && (
                    <div className="rounded-xl border bg-muted/30 px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                          Currently outstanding
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {balance.documents}{" "}
                          {balance.documents === 1 ? "document" : "documents"}
                        </p>
                      </div>
                      <p
                        className={cn(
                          "mt-0.5 text-xl font-semibold tabular-nums",
                          overBy > 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-foreground",
                        )}
                      >
                        {money(balance.outstanding)}
                      </p>
                      {limit !== undefined ? (
                        <>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full transition-[width]",
                                overBy > 0
                                  ? "bg-rose-500"
                                  : usedPct > 80
                                    ? "bg-amber-500"
                                    : "bg-emerald-500",
                              )}
                              style={{ width: `${Math.max(usedPct, 2)}%` }}
                            />
                          </div>
                          <p className="mt-1.5 text-[11px] text-muted-foreground">
                            {overBy > 0 ? (
                              <span className="font-medium text-rose-600 dark:text-rose-400">
                                {money(overBy)} over the limit of {money(limit)}
                              </span>
                            ) : (
                              <>
                                {money(headroom ?? 0)} of {money(limit)} left to
                                spend
                              </>
                            )}
                          </p>
                        </>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          No ceiling set — {money(balance.outstanding)} outstanding
                          with nothing enforced.
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Credit limit"
                      hint="Blank means no ceiling is enforced. Saving past it is refused unless overridden."
                    >
                      <Input
                        type="number"
                        min={0}
                        step="any"
                        value={draft.creditLimit}
                        onChange={(e) => set("creditLimit", e.target.value)}
                        placeholder="No limit"
                        className="h-10 rounded-lg text-sm tabular-nums"
                      />
                    </Field>
                    <Field
                      label="Credit period"
                      hint="Days allowed to settle, used for the due date."
                    >
                      <div className="relative">
                        <Input
                          type="number"
                          min={0}
                          step="1"
                          value={draft.creditDays}
                          onChange={(e) => set("creditDays", e.target.value)}
                          placeholder="e.g. 30"
                          className="h-10 rounded-lg pr-10 text-sm tabular-nums"
                        />
                        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted-foreground">
                          days
                        </span>
                      </div>
                    </Field>
                    {kind === "vendor" && (
                      <Field
                        label="Lead time"
                        hint="How long they usually take to deliver."
                      >
                        <div className="relative">
                          <Input
                            type="number"
                            min={0}
                            step="1"
                            value={draft.leadTimeDays}
                            onChange={(e) => set("leadTimeDays", e.target.value)}
                            placeholder="e.g. 7"
                            className="h-10 rounded-lg pr-10 text-sm tabular-nums"
                          />
                          <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted-foreground">
                            days
                          </span>
                        </div>
                      </Field>
                    )}
                    <Field
                      label="Price list"
                      hint="The list or agreement their prices come from."
                      className={kind === "customer" ? "sm:col-span-2" : undefined}
                    >
                      <Input
                        value={draft.priceList}
                        onChange={(e) => set("priceList", e.target.value)}
                        placeholder="e.g. Wholesale 2026"
                        className="h-10 rounded-lg text-sm"
                      />
                    </Field>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="flex-row items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeForm}
                className="h-9 rounded-lg text-xs"
              >
                <ArrowLeft className="size-3.5" />
                Back to {plural.toLowerCase()}
              </Button>
              <div className="flex items-center gap-2">
                {editingId !== null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={closeForm}
                    className="h-9 rounded-lg text-xs"
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={busy || draft.name.trim().length === 0}
                  className="h-9 rounded-lg text-xs"
                >
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  {editingId === null ? `Add ${label}` : "Save changes"}
                </Button>
              </div>
            </DialogFooter>
          </form>
        ) : (
          <>
            {/* ── the register ───────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${plural.toLowerCase()} by name, person, phone, tax no…`}
                  className="h-9 rounded-lg pl-8 text-sm"
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => openForm()}
                className="h-9 rounded-lg text-xs"
              >
                <Plus className="size-3.5" /> New {label}
              </Button>
            </div>

            <div className="max-h-[52vh] min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {contacts === undefined ? (
                <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading…
                </p>
              ) : contacts.length === 0 ? (
                <div className="rounded-xl border border-dashed px-3 py-8 text-center">
                  <Icon className="mx-auto size-6 text-muted-foreground/40" />
                  <p className="mt-2 text-sm font-medium">No {label}s yet</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Add the first one and it becomes available everywhere.
                  </p>
                </div>
              ) : matches.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No {label} matches “{query.trim()}”.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {matches.map((contact) => {
                    const owed = balanceOf?.(contact._id);
                    const over =
                      contact.creditLimit !== undefined &&
                      owed !== undefined &&
                      owed.outstanding > contact.creditLimit;
                    return (
                      <li
                        key={contact._id}
                        className="group flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-accent/40"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onPick?.({
                              id: contact._id,
                              name: contact.name,
                              address: contact.address,
                            });
                            close(false);
                          }}
                          className="min-w-0 flex-1 cursor-pointer text-left"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <p className="truncate text-sm font-medium">
                              {contact.name}
                            </p>
                            {contact.legalName && (
                              <span className="truncate text-[11px] text-muted-foreground">
                                {contact.legalName}
                              </span>
                            )}
                            {contact.creditLimit !== undefined && (
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                                  over
                                    ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                                    : "bg-muted text-muted-foreground",
                                )}
                                title={
                                  over
                                    ? `Over its credit limit of ${money(contact.creditLimit)}`
                                    : `Credit limit ${money(contact.creditLimit)}`
                                }
                              >
                                <CreditCard className="mr-0.5 inline size-2.5" />
                                {over ? "Over limit" : money(contact.creditLimit)}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                            {(contact.contactName || contact.contactRole) && (
                              <span className="inline-flex items-center gap-1">
                                <UserRound className="size-2.5" />
                                {[contact.contactName, contact.contactRole]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            )}
                            {contact.phone && (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="size-2.5" />
                                {contact.phone}
                              </span>
                            )}
                            {contact.email && (
                              <span className="inline-flex items-center gap-1">
                                <Mail className="size-2.5" />
                                {contact.email}
                              </span>
                            )}
                            {contact.taxId && (
                              <span className="inline-flex items-center gap-1 font-mono">
                                <Receipt className="size-2.5" />
                                {contact.taxId}
                              </span>
                            )}
                            {contact.address && (
                              <span className="inline-flex min-w-0 items-center gap-1">
                                <MapPin className="size-2.5 shrink-0" />
                                <span className="max-w-56 truncate">
                                  {contact.address}
                                </span>
                              </span>
                            )}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button
                            type="button"
                            aria-label={`Edit ${contact.name}`}
                            title="Edit"
                            onClick={() => openForm(contact)}
                            className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${contact.name}`}
                            title="Remove"
                            disabled={busy}
                            onClick={() => void remove(contact)}
                            className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}