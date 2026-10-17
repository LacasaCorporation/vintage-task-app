import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";

/**
 * The store issue a product's materials went out on.
 *
 * A row already says what is being made and how many; this says which voucher
 * moved the materials to the factory, so the production and project pages can
 * be read against the Store module without opening it. Only dispatched issues
 * count — a draft has not moved anything yet.
 */
type IssueRef = { number: string; issuedAt: number; total: number };

const IssueRefsContext = createContext<ReadonlyMap<string, IssueRef[]> | null>(
  null,
);

/**
 * One query for the whole page, one map for every row. Reading the vouchers
 * per row would open a subscription per product, which is a lot of sockets to
 * answer a question the page already has the data for.
 */
export function IssueProvider({ children }: { children: ReactNode }) {
  const rows = useQuery(api.store.listIssues);
  const refs = useMemo(() => {
    const map = new Map<string, IssueRef[]>();
    for (const row of rows ?? []) {
      if (row.status !== "issued" || row.fgId === undefined) continue;
      const list = map.get(row.fgId) ?? [];
      list.push({
        number: row.number,
        issuedAt: row.issuedAt,
        total: row.total,
      });
      map.set(row.fgId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.issuedAt - a.issuedAt);
    }
    return map;
  }, [rows]);

  return (
    <IssueRefsContext.Provider value={refs}>
      {children}
    </IssueRefsContext.Provider>
  );
}

/** Renders nothing until materials have actually been issued to the product. */
export default function IssueInline({
  fgId,
  className,
}: {
  fgId: string;
  className?: string;
}) {
  const refs = useContext(IssueRefsContext);
  const issues = refs?.get(fgId);
  if (issues === undefined || issues.length === 0) return null;

  const latest = issues[0];
  if (latest === undefined) return null;
  const extra = issues.length - 1;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md bg-violet-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium whitespace-nowrap text-violet-700 dark:text-violet-400",
        className,
      )}
      title={issues
        .map(
          (i) =>
            `${i.number} · ${new Date(i.issuedAt).toLocaleDateString()} · ${i.total.toFixed(2)}`,
        )
        .join("\n")}
    >
      {latest.number}
      {extra > 0 && (
        <span className="font-sans font-normal opacity-70">+{extra}</span>
      )}
    </span>
  );
}
