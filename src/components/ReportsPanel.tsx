import { api } from "@/convex/_generated/api";
import PageTabs, { type PageTab } from "@/components/PageTabs";
import TradingAccount from "./TradingAccount";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  CalendarDays,
  Check,
  Clock,
  Download,
  FileBarChart,
  FileText,
  Folder,
  Landmark,
  Package,
  Percent,
  Receipt,
  ShoppingCart,
  Tags,
  TrendingDown,
  TrendingUp,
  Warehouse,
  Scale,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ReportsArea } from "@/components/CostingSidebar";
import { useQuery } from "convex/react";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";

/** ... rest of file ... */

/* ── shared furniture ─────────────────────────────────────────────── */

export function Tile({
  label,
  value,
  tone = "text-foreground",
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3 shadow-sm">
      <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", tone)}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Panel({
  title,
  count,
  actions,
  children,
}: {
  title: string;
  count?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <p className="text-sm font-semibold">
          {title}
          {count && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </p>
        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Proof({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs",
        ok
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
          : "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
      )}
    >
      {ok ? (
        <Check className="size-3.5 shrink-0" />
      ) : (
        <AlertTriangle className="size-3.5 shrink-0" />
      )}
      {children}
    </p>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-4 py-12 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function SubTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly PageTab<T>[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <PageTabs
      tabs={tabs}
      value={value}
      onChange={onChange}
      label={label}
      className="bg-card"
    />
  );
}

export const HEAD =
  "border-b border-border/60 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase";
export const CELL = "px-3 py-2 text-right text-xs tabular-nums";
export const CELL_LEFT = "px-3 py-2 text-xs";
export const ROW = "transition-colors hover:bg-accent/40";
export const TOTAL = "border-t border-border/60 text-sm font-semibold";
export const TH_R = cn(HEAD, "px-3 py-2 text-right");

export const num = (n: number) => n.toFixed(2);

export const GAIN = "text-emerald-600 dark:text-emerald-400";
export const LOSS = "text-rose-600 dark:text-rose-400";

export function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** ... rest of file ... */
