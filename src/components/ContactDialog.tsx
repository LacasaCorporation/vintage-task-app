import { useState } from "react";
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
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Kind = "vendor" | "customer";

/** One saved vendor or customer, as returned by the contacts queries. */
export type Contact = {
  _id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  note?: string;
};

const FIELDS: {
  key: keyof typeof noContact;
  label: string;
  required?: boolean;
  full?: boolean;
}[] = [
  { key: "name", label: "Name", required: true, full: true },
  { key: "contactName", label: "Contact person" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "address", label: "Address", full: true },
];

const noContact = {
  name: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  note: "",
};

/**
 * Popup for the vendor / customer master list. It is opened from a bill or a
 * project form with a `+ New vendor` button, and it lists everything already
 * saved so the names can be picked instead of retyped. It reports the chosen
 * row (or a newly created one) back through `onPick`.
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
}: {
  kind: Kind;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  contacts: Contact[] | undefined;
  onCreate: (args: Omit<typeof noContact, ""> & { name: string }) => Promise<string>;
  onUpdate: (id: string, args: Omit<typeof noContact, ""> & { name: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** Called with the name (and id) the user settled on. */
  onPick?: (contact: { id?: string; name: string; address?: string }) => void;
}) {
  const label = kind === "vendor" ? "vendor" : "customer";
  const [draft, setDraft] = useState(noContact);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openForm = (contact?: Contact) => {
    setEditingId(contact?._id ?? null);
    setDraft({
      name: contact?.name ?? "",
      contactName: contact?.contactName ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      address: contact?.address ?? "",
      note: contact?.note ?? "",
    });
  };

  const close = (next: boolean) => {
    if (!next) {
      setEditingId(null);
      setDraft(noContact);
    }
    onOpenChange(next);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draft.name.trim().length === 0) {
      toast.error(`Give the ${label} a name.`);
      return;
    }
    setBusy(true);
    try {
      if (editingId === null) {
        const id = await onCreate(draft);
        toast.success(`${label[0]!.toUpperCase()}${label.slice(1)} “${draft.name.trim()}” added.`);
        onPick?.({ id, name: draft.name.trim(), address: draft.address.trim() || undefined });
        close(false);
      } else {
        await onUpdate(editingId, draft);
        toast.success(`${label[0]!.toUpperCase()}${label.slice(1)} updated.`);
        onPick?.({
          id: editingId,
          name: draft.name.trim(),
          address: draft.address.trim() || undefined,
        });
        setEditingId(null);
        setDraft(noContact);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Couldn't save the ${label}.`);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (contact: Contact) => {
    openForm(contact);
  };

  const remove = async (contact: Contact) => {
    setBusy(true);
    try {
      await onRemove(contact._id);
      toast.success(`“${contact.name}” removed.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Couldn't remove the ${label}.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="capitalize">{label}s</DialogTitle>
          <DialogDescription>
            {kind === "vendor"
              ? "Suppliers you buy raw materials from. Pick one to fill this bill."
              : "People and companies your projects are for. Pick one to fill this project."}
          </DialogDescription>
        </DialogHeader>

        {/* saved list */}
        {contacts === undefined ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </p>
        ) : contacts.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            No {label}s yet — add the first one below.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-lg border">
            {contacts.map((contact) => (
              <li key={contact._id} className="flex items-start gap-2 px-3 py-2">
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
                  <p className="truncate text-sm font-medium">{contact.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[contact.contactName, contact.phone, contact.email]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </button>
                <button
                  type="button"
                  aria-label={`Edit ${contact.name}`}
                  title="Edit"
                  onClick={() => startEdit(contact)}
                  className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${contact.name}`}
                  title="Remove"
                  onClick={() => void remove(contact)}
                  className="grid size-6 place-items-center rounded text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* create / edit form */}
        <form onSubmit={save} className="space-y-3 border-t border-border/60 pt-4">
          <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            {editingId === null ? `New ${label}` : `Edit ${label}`}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {FIELDS.map((field) => (
              <label key={field.key} className={cnFull(field.full ?? false)}>
                <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  {field.label}
                  {field.required ? " *" : ""}
                </span>
                <Input
                  value={draft[field.key]}
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, [field.key]: e.target.value }))
                  }
                  className="h-9 rounded-lg text-sm"
                />
              </label>
            ))}
          </div>
          <label className="block">
            <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
              Note
            </span>
            <Textarea
              value={draft.note}
              onChange={(e) => setDraft((current) => ({ ...current, note: e.target.value }))}
              rows={2}
              placeholder="Payment terms, tax id, opening hours…"
              className="mt-1 rounded-lg text-sm"
            />
          </label>

          <DialogFooter className="gap-2">
            {editingId !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 rounded-lg text-xs"
                onClick={() => {
                  setEditingId(null);
                  setDraft(noContact);
                }}
              >
                Cancel edit
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
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Fields marked `full` span both columns of the popup grid. */
function cnFull(full: boolean): string {
  return full ? "block sm:col-span-2" : "block";
}
