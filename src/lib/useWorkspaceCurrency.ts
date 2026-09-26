import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  currencyOrDefault,
  currencySymbol,
  formatCurrency,
} from "@/lib/currency";

/**
 * The workspace currency, plus a formatter that reads it reactively.
 * Every money display in the app should go through this so switching the
 * currency in Settings → Organisation changes the whole workspace at once.
 */
export function useWorkspaceCurrency() {
  const saved = useQuery(api.settings.getCurrency);
  const code = currencyOrDefault(saved);

  return useMemo(
    () => ({
      code,
      symbol: currencySymbol(code),
      /** e.g. format(1250) → "AED 1,250.00" */
      format: (amount: number, fractionDigits = 2) =>
        formatCurrency(amount, code, fractionDigits),
    }),
    [code],
  );
}
