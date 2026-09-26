import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Check, ChevronsUpDown, Coins, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_CURRENCIES,
  currencyOrDefault,
  type CurrencyCode,
} from "@/lib/currency";

/**
 * Workspace currency picker. Saved on the settings row and read by
 * `useWorkspaceCurrency()`, so every amount in the app — old records included —
 * is displayed in this currency.
 */
export default function CurrencyPicker({ canEdit }: { canEdit: boolean }) {
  const currency = useQuery(api.settings.getCurrency);
  const setCurrency = useMutation(api.settings.setCurrency);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);

  const current = currencyOrDefault(currency);
  const currentEntry =
    WORKSPACE_CURRENCIES.find((c) => c.code === current) ??
    WORKSPACE_CURRENCIES[0];

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return WORKSPACE_CURRENCIES;
    return WORKSPACE_CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q),
    );
  }, [query]);

  const pick = async (code: CurrencyCode) => {
    if (code === current) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await setCurrency({ currency: code });
      toast.success(`Currency set to ${code}.`);
      setOpen(false);
      setQuery("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't change the currency.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        Currency
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={!canEdit || busy}
            className="h-9 w-full justify-between px-2.5 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Coins className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">
                {currentEntry.code} · {currentEntry.label}
              </span>
              <span className="shrink-0 text-muted-foreground">
                ({currentEntry.symbol})
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search currency…"
                aria-label="Search currency"
                className="h-8 pl-7 text-sm"
              />
            </div>
          </div>
          <ul className="max-h-64 overflow-y-auto p-1">
            {matches.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">
                No currency matches “{query}”.
              </li>
            ) : (
              matches.map((entry) => (
                <li key={entry.code}>
                  <button
                    type="button"
                    onClick={() => void pick(entry.code)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                      entry.code === current && "bg-primary/10 text-primary",
                    )}
                  >
                    <span className="w-12 shrink-0 font-mono text-xs">
                      {entry.symbol}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {entry.code}
                    </span>
                    {entry.code === current && (
                      <Check className="size-3.5 shrink-0" />
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </PopoverContent>
      </Popover>
      <p className="text-[11px] text-muted-foreground">
        Every amount in the app is shown in {currentEntry.code} — new projects,
        products and bills included. Changing it re-displays existing amounts
        too; the numbers themselves are never re-priced.
      </p>
    </div>
  );
}
