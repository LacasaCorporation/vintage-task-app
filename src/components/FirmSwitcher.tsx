import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Building2, Check, ChevronsUpDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WORKSPACE_CURRENCIES } from "@/lib/currency";

const ROLE_LABEL: Record<string, string> = {
  super: "Owner",
  admin: "Admin",
  user: "User",
  member: "Member",
};

/**
 * Create a firm. Each firm has its own name, currency, people and data. An
 * account can own only one firm, so after your first one you name the username
 * of the person who should own this — you join as an admin.
 */
export function CreateFirmDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const createFirm = useMutation(api.firms.createFirm);
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Give the firm a name.");
      return;
    }
    setBusy(true);
    try {
      const res = await createFirm({
        name: name.trim(),
        ownerUsername: owner.trim() || undefined,
        currency,
      });
      toast.success(
        res.ownedByYou
          ? `“${name.trim()}” created — it's now the firm you're working in.`
          : `“${name.trim()}” created. You joined it as an admin.`,
      );
      setName("");
      setOwner("");
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't create the firm.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="size-4" />
            </span>
            Create a firm
          </DialogTitle>
          <DialogDescription>
            A firm keeps its own people, roles, currency and data — projects,
            products, tasks and notes are never shared between firms.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="firm-name">Firm name</Label>
            <Input
              id="firm-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Safari Interiors LLC"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="firm-owner">Owner username</Label>
            <Input
              id="firm-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Leave blank to own it yourself"
            />
            <p className="text-[11px] text-muted-foreground">
              Each account can own only one firm. If you already own one, enter
              the username of the person who should own this — they become the
              owner and you join as an admin. Create their login first.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="firm-currency">Currency</Label>
            <select
              id="firm-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              {WORKSPACE_CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.label} ({c.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Building2 className="size-4" />
            )}
            Create firm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Top-bar switcher. Everything on screen belongs to the active firm, so
 * switching reloads tasks, notes, materials, products and projects into the
 * other firm's data.
 */
export default function FirmSwitcher() {
  const data = useQuery(api.firms.listMyFirms);
  const switchFirm = useMutation(api.firms.switchFirm);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const firms = data?.firms ?? [];
  const active = firms.find((f) => f.firmId === data?.activeFirmId) ?? firms[0];
  if (data === undefined) return null;

  const pick = async (firmId: (typeof firms)[number]["firmId"]) => {
    if (firmId === data.activeFirmId) return;
    setBusy(true);
    try {
      await switchFirm({ firmId });
      toast.success("Switched firm.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't switch firm.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="max-w-56 shrink-0 gap-1.5 rounded-lg"
            aria-label="Switch firm"
          >
            <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {active?.name ?? "No firm yet"}
            </span>
            {active?.code && (
              <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground sm:inline">
                {active.code}
              </span>
            )}
            <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <p className="px-2 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Your firms
          </p>
          {firms.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              You are not in a firm yet — create the first one below.
            </p>
          ) : (
            firms.map((firm) => (
              <DropdownMenuItem
                key={firm.firmId}
                disabled={busy}
                onSelect={() => void pick(firm.firmId)}
                className="flex items-center gap-2"
              >
                <Building2 className="size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{firm.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {ROLE_LABEL[firm.role] ?? firm.role} · {firm.memberCount}{" "}
                    {firm.memberCount === 1 ? "person" : "people"}
                    {firm.code ? ` · ${firm.code}` : ""}
                  </span>
                </span>
                {firm.firmId === data.activeFirmId && (
                  <Check className="size-3.5 shrink-0" />
                )}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus className="size-3.5" />
            Create a firm
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateFirmDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

/** Small "add another firm" button for the settings page. */
export function CreateFirmButton({ className }: { className?: string }) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("gap-1.5", className)}
        onClick={() => setCreating(true)}
      >
        <Plus className="size-4" />
        Create firm
      </Button>
      <CreateFirmDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
