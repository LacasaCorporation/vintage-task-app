import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Receipt } from "lucide-react";
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
 * be read against the Store module without opening it. A dispatched voucher is
 * the real one; a draft is shown too, marked, so a voucher that has been
 * prepared is visible before it moves anything.
 */
type IssueRef = {
  number: string;
  issuedAt: number;
  total: number;
  issued: boolean;
};

type IssueLookup = {
  byId: ReadonlyMap<string, IssueRef[]>;
  byName: ReadonlyMap<string, IssueRef[]>;
};

const EMPTY: IssueLookup = { byId: new Map(), byName: new Map() };

const IssueRefsContext = createContext<IssueLookup>(EMPTY);

const nameKey = (name: string | undefined) =>
  (name ?? "").trim().toLowerCase();

function push(map: Map<string, IssueRef[]>, key: string, ref: IssueRef) {
  if (!key) return;
  const list = map.get(key) ?? [];
  list.push(ref);
  map.set(key, list);
}

/**
 * One query for the whole page, one lookup for every row. Reading the vouchers
 * per row would open a subscription per product, which is a lot of sockets to
 * answer a question the page already has the data for.
 */
export function IssueProvider({ children }: { children: ReactNode }) {
  const rows = useQuery(api.store.listIssues);
  const lookup = useMemo(() => {
    const byId = new Map<string, IssueRef[]>();
    const byName = new Map<string, IssueRef[]>();
    for (const row of rows ?? []) {
      // a reversed voucher moved nothing, so it is not worth a chip
      if (row.status === "cancelled") continue;
      const ref: IssueRef = {
        number: row.number,
        issuedAt: row.issuedAt,
        total: row.total,
        issued: row.status === "issued",
      };
      if (row.fgId !== undefined) push(byId, row.fgId, ref);
      // older vouchers may only carry the product's name
      push(byName, nameKey(row.fgName), ref);
    }
    // newest first, but a dispatched voucher outranks a newer draft
    const order = (a: IssueRef, b: IssueRef) =>
      Number(b.issued) - Number(a.issued) || b.issuedAt - a.issuedAt;
    for (const list of byId.values()) list.sort(order);
    for (const list of byName.values()) list.sort(order);
    return { byId, byName };
  }, [rows]);

  return (
    <IssueRefsContext.Provider value={lookup}>
      {children}
    </IssueRefsContext.Provider>
  );
}

/** Renders nothing until an issue voucher exists for the product. */
export default function IssueInline({
  fgId,
  name,
  className,
}: {
  fgId: string;
  /** Fallback match for vouchers that only recorded the product's name. */
  name?: string;
  className?: string;
}) {
  const lookup = useContext(IssueRefsContext);
  const issues =
    lookup.byId.get(fgId) ?? lookup.byName.get(nameKey(name)) ?? [];
  const latest = issues[0];
  if (latest === undefined) return null;

  const extra = issues.length - 1;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium whitespace-nowrap",
        latest.issued
          ? "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400"
          : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        className,
      )}
      title={issues
        .map(
          (i) =>
            `${i.number} · ${new Date(i.issuedAt).toLocaleDateString()} · ${i.total.toFixed(2)}${i.issued ? "" : " · draft, not dispatched"}`,
        )
        .join("\n")}
    >
      <Receipt className="size-2.5" />
      {latest.number}
      {extra > 0 && (
        <span className="font-sans font-normal opacity-70">+{extra}</span>
      )}
    </span>
  );
}
