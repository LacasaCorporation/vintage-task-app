import type { PrimarySection } from "@/components/PrimaryNav";
import type { CostingView } from "@/components/CostingSidebar";
import { api } from "@/convex/_generated/api";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { Reorder, useDragControls } from "framer-motion";
import {
  Building2,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  EyeOff,
  FolderKanban,
  GripVertical,
  ListTodo,
  PackageSearch,
  Percent,
  Receipt,
  RotateCcw,
  ScrollText,
  Settings2,
  ShoppingCart,
  TrendingUp,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LucideIcon } from "lucide-react";

/** Good morning / afternoon / evening from the clock. */
function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const DAY_MS = 86_400_000;

/** A human "due" phrase plus the tone it should be written in. */
function dueLabel(ms: number, todayStart: number) {
  const days = Math.round((ms - todayStart) / DAY_MS);
  if (days < 0)
    return {
      text: days === -1 ? "1 day overdue" : `${Math.abs(days)} days overdue`,
      tone: "text-rose-600 dark:text-rose-400",
    };
  if (days === 0) return { text: "Due today", tone: "text-amber-600 dark:text-amber-400" };
  if (days === 1) return { text: "Due tomorrow", tone: "text-muted-foreground" };
  return { text: `In ${days} days`, tone: "text-muted-foreground" };
}

/* ────────────────────────────────────────────────────────────────────────
 * The dashboard is assembled from a registry of cards and panels, so the
 * reader can design their own: hide what is noise, drag what matters to the
 * top, and stretch a card across the row. The choice is stored in this
 * browser (same place as the collapsed-nav preference) and every card still
 * reads from the same documents as the rest of the app — nothing here is a
 * separate source of truth.
 * ──────────────────────────────────────────────────────────────────────── */

type KpiSize = "normal" | "wide";

type Layout = {
  /** Cards on the board, in the order the reader wants them. */
  kpis: { id: string; size: KpiSize }[];
  /** Panels below the cards, in order. */
  panels: string[];
};

const LAYOUT_KEY = "slate.home.layout.v1";

/** What every card gets to compute itself from the registers. */
type KpiCtx = {
  openTasks: number;
  overdue: number;
  dueToday: number;
  activeProjects: number;
  projectsTotal: number;
  salesMonth: number;
  salesMonthCount: number;
  purchasesMonth: number;
  purchasesMonthCount: number;
  invoicesMonthCount: number;
  receivable: number;
  payable: number;
  net: number;
  lowStock: number;
  collectionPct: number;
  openQuotes: number;
  openQuotesCount: number;
  money: (n: number, digits?: number) => string;
};

/** Which permission a card needs; "both" means sales AND purchase. */
type KpiNeed = "sales" | "purchase" | "both";

type KpiDef = {
  label: string;
  Icon: LucideIcon;
  tone: string;
  chip: string;
  need?: KpiNeed;
  compute: (c: KpiCtx) => { value: string; hint: string; tone?: string; chip?: string };
};

/** Every headline number the dashboard can show. */
const KPI_DEFS: Record<string, KpiDef> = {
  openTasks: {
    label: "Open tasks",
    Icon: ListTodo,
    tone: "text-primary",
    chip: "bg-primary/10",
    compute: (c) => ({
      value: String(c.openTasks),
      hint: c.overdue > 0 ? `${c.overdue} overdue` : "Nothing overdue",
      tone: c.overdue > 0 ? "text-rose-600 dark:text-rose-400" : undefined,
      chip: c.overdue > 0 ? "bg-rose-500/10" : undefined,
    }),
  },
  overdue: {
    label: "Overdue tasks",
    Icon: TriangleAlert,
    tone: "text-rose-600 dark:text-rose-400",
    chip: "bg-rose-500/10",
    compute: (c) => ({
      value: String(c.overdue),
      hint: c.overdue > 0 ? "Past their due date" : "Nothing late",
      tone: c.overdue > 0 ? undefined : "text-emerald-600 dark:text-emerald-400",
      chip: c.overdue > 0 ? undefined : "bg-emerald-500/10",
    }),
  },
  dueToday: {
    label: "Due today",
    Icon: CalendarDays,
    tone: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/10",
    compute: (c) => ({
      value: String(c.dueToday),
      hint: c.dueToday > 0 ? "Falling due today" : "Nothing due today",
    }),
  },
  activeProjects: {
    label: "Active projects",
    Icon: FolderKanban,
    tone: "text-primary",
    chip: "bg-primary/10",
    compute: (c) => ({
      value: String(c.activeProjects),
      hint: `${c.projectsTotal} in total`,
    }),
  },
  lowStock: {
    label: "Low stock",
    Icon: PackageSearch,
    tone: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/10",
    compute: (c) => ({
      value: String(c.lowStock),
      hint:
        c.lowStock > 0 ? "At or below reorder level" : "Everything above reorder",
    }),
  },
  salesMonth: {
    label: "Sales this month",
    Icon: ShoppingCart,
    tone: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/10",
    need: "sales",
    compute: (c) => ({
      value: c.money(c.salesMonth, 0),
      hint: `${c.salesMonthCount} invoice${c.salesMonthCount === 1 ? "" : "s"} raised`,
    }),
  },
  purchasesMonth: {
    label: "Purchases this month",
    Icon: Receipt,
    tone: "text-sky-600 dark:text-sky-400",
    chip: "bg-sky-500/10",
    need: "purchase",
    compute: (c) => ({
      value: c.money(c.purchasesMonth, 0),
      hint: `${c.purchasesMonthCount} bill${c.purchasesMonthCount === 1 ? "" : "s"} booked`,
    }),
  },
  invoicesMonth: {
    label: "Invoices this month",
    Icon: ClipboardList,
    tone: "text-primary",
    chip: "bg-primary/10",
    need: "sales",
    compute: (c) => ({
      value: String(c.invoicesMonthCount),
      hint: "Count raised this month",
    }),
  },
  receivable: {
    label: "Owed to the firm",
    Icon: Wallet,
    tone: "text-sky-600 dark:text-sky-400",
    chip: "bg-sky-500/10",
    need: "sales",
    compute: (c) => ({
      value: c.money(c.receivable, 0),
      hint: "Unpaid sales invoices",
    }),
  },
  payable: {
    label: "The firm owes",
    Icon: Wallet,
    tone: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/10",
    need: "purchase",
    compute: (c) => ({
      value: c.money(c.payable, 0),
      hint: "Unpaid purchase bills",
    }),
  },
  net: {
    label: "Net position",
    Icon: TrendingUp,
    tone: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/10",
    need: "both",
    compute: (c) => ({
      value: c.money(c.net, 0),
      hint: c.net >= 0 ? "In the firm's favour" : "More going out than in",
      tone: c.net >= 0 ? undefined : "text-rose-600 dark:text-rose-400",
      chip: c.net >= 0 ? undefined : "bg-rose-500/10",
    }),
  },
  collectionRate: {
    label: "Collection rate",
    Icon: Percent,
    tone: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-500/10",
    need: "sales",
    compute: (c) => ({
      value: `${Math.round(c.collectionPct)}%`,
      hint: "Of all invoices settled",
    }),
  },
  openQuotes: {
    label: "Open quotations",
    Icon: ScrollText,
    tone: "text-violet-600 dark:text-violet-400",
    chip: "bg-violet-500/10",
    need: "sales",
    compute: (c) => ({
      value: c.money(c.openQuotes, 0),
      hint: `${c.openQuotesCount} quote${c.openQuotesCount === 1 ? "" : "s"} not yet invoiced`,
    }),
  },
};

const DEFAULT_LAYOUT: Layout = {
  kpis: [
    { id: "openTasks", size: "normal" },
    { id: "activeProjects", size: "normal" },
    { id: "salesMonth", size: "normal" },
    { id: "purchasesMonth", size: "normal" },
    { id: "receivable", size: "normal" },
    { id: "payable", size: "normal" },
    { id: "net", size: "normal" },
  ],
  panels: ["dueSoon", "trend", "lowStock", "recentInvoices", "recentBills"],
};

const PANEL_DEFS: Record<
  string,
  { title: string; subtitle: string; wide: boolean; need?: KpiNeed }
> = {
  dueSoon: {
    title: "Due soon",
    subtitle: "Open tasks with a date, soonest first",
    wide: false,
  },
  trend: {
    title: "Sales vs purchases",
    subtitle: "Last six months, by month",
    wide: true,
    need: "both",
  },
  lowStock: {
    title: "Low stock",
    subtitle: "At or below reorder level",
    wide: false,
  },
  recentInvoices: {
    title: "Recent invoices",
    subtitle: "Newest sales bills",
    wide: false,
    need: "sales",
  },
  recentBills: {
    title: "Recent bills",
    subtitle: "Newest purchase bills",
    wide: false,
    need: "purchase",
  },
};

const cloneDefault = (): Layout => ({
  kpis: DEFAULT_LAYOUT.kpis.map((k) => ({ ...k })),
  panels: [...DEFAULT_LAYOUT.panels],
});

/** A stored layout may predate a card, or hand-edit badly — trust but check. */
function loadLayout(): Layout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_KEY);
    if (raw === null) return cloneDefault();
    const parsed = JSON.parse(raw) as Partial<Layout>;
    const seenK = new Set<string>();
    const kpis = (Array.isArray(parsed.kpis) ? parsed.kpis : [])
      .filter(
        (k): k is { id: string; size: KpiSize } =>
          k != null &&
          typeof k.id === "string" &&
          k.id in KPI_DEFS &&
          !seenK.has(k.id) &&
          (seenK.add(k.id), true),
      )
      .map((k) => ({
        id: k.id,
        size: k.size === "wide" ? ("wide" as const) : ("normal" as const),
      }));
    const seenP = new Set<string>();
    const panels = (Array.isArray(parsed.panels) ? parsed.panels : []).filter(
      (p): p is string =>
        typeof p === "string" &&
        p in PANEL_DEFS &&
        !seenP.has(p) &&
        (seenP.add(p), true),
    );
    if (kpis.length === 0 && panels.length === 0) return cloneDefault();
    return { kpis, panels };
  } catch {
    return cloneDefault();
  }
}

/** One headline number. A wide card lays its value beside the label. */
function Kpi({
  label,
  value,
  hint,
  Icon,
  tone,
  chip,
  wide,
}: {
  label: string;
  value: string;
  hint: string;
  Icon: LucideIcon;
  tone: string;
  chip: string;
  wide: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
        wide && "sm:col-span-2",
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40 transition-opacity group-hover:opacity-70"
        style={{
          background:
            "radial-gradient(120% 110% at 100% 0%, color-mix(in oklab, var(--primary) 7%, transparent), transparent 62%)",
        }}
      />
      {wide ? (
        <div className="relative flex items-center gap-4">
          <span
            className={cn("grid size-9 shrink-0 place-items-center rounded-xl", chip, tone)}
          >
            <Icon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-muted-foreground">
              {label}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {hint}
            </span>
          </div>
          <p
            className={cn(
              "shrink-0 font-display text-3xl font-semibold tracking-tight tabular-nums",
              tone,
            )}
          >
            {value}
          </p>
        </div>
      ) : (
        <>
          <div className="relative flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {label}
            </span>
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-lg",
                chip,
                tone,
              )}
            >
              <Icon className="size-3.5" />
            </span>
          </div>
          <p
            className={cn(
              "relative mt-3 font-display text-2xl font-semibold tracking-tight tabular-nums",
              tone,
            )}
          >
            {value}
          </p>
          <p className="relative mt-0.5 text-[11px] text-muted-foreground">
            {hint}
          </p>
        </>
      )}
    </div>
  );
}

/** A titled card used for the panels below the tiles. */
function Panel({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border bg-card shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          {subtitle && (
            <p className="truncate text-[11px] text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      <div className="min-h-0 flex-1 p-2">{children}</div>
    </div>
  );
}

const emptyCls = "px-2 py-6 text-center text-xs text-muted-foreground";

/**
 * What the app opens on: today's work and the firm's money in one view, drawn
 * from the same documents the rest of the app uses. Nothing here is a separate
 * source of truth — the tiles are sums over the registers. The reader decides
 * which tiles and panels appear, in what order, and how wide; the layout is
 * remembered in this browser.
 */
export default function HomeDashboard({
  firstName,
  firmName,
  canViewSales,
  canViewPurchase,
  onGo,
  onGoView,
}: {
  firstName: string;
  firmName: string;
  canViewSales: boolean;
  canViewPurchase: boolean;
  onGo: (section: PrimarySection) => void;
  onGoView: (view: CostingView) => void;
}) {
  const { format: money } = useWorkspaceCurrency();

  const tasksQ = useQuery(api.tasks.list, { scope: "mine" });
  const projectsQ = useQuery(api.costing.listProjects, {});
  const salesQ = useQuery(api.sales.listSales, {});
  const quotationsQ = useQuery(api.sales.listQuotations, {});
  const purchasesQ = useQuery(api.purchases.list, {});
  const lowQ = useQuery(api.reports.lowStock, {});

  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const monthStart = startOfMonth(now).getTime();
  const monthEnd = endOfMonth(now).getTime();
  const inMonth = (ms: number) => ms >= monthStart && ms <= monthEnd;

  const tasks = tasksQ ?? [];
  const openTasks = tasks.filter((t) => !t.isCompleted);
  const overdue = openTasks.filter(
    (t) => t.dueAt !== undefined && t.dueAt < todayStart,
  );
  const dueToday = openTasks.filter(
    (t) => t.dueAt !== undefined && t.dueAt >= todayStart && t.dueAt < todayStart + DAY_MS,
  );
  const dueSoon = openTasks
    .filter((t) => t.dueAt !== undefined)
    .sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
    .slice(0, 6);

  const projects = projectsQ ?? [];
  const activeProjects = projects.filter(
    (p) => p.status !== "completed" && p.status !== "cancelled",
  );

  const sales = salesQ ?? [];
  const quotations = quotationsQ ?? [];
  const purchases = purchasesQ ?? [];

  const salesThisMonth = sales.filter((s) => inMonth(s.soldAt));
  const purchasesThisMonth = purchases.filter((p) => inMonth(p.purchasedAt));
  const salesMonth = salesThisMonth.reduce((n, s) => n + s.total, 0);
  const purchasesMonth = purchasesThisMonth.reduce((n, p) => n + p.total, 0);

  const receivable = sales.reduce(
    (n, s) => n + Math.max(0, s.total - (s.amountPaid ?? 0)),
    0,
  );
  const payable = purchases.reduce(
    (n, p) => n + Math.max(0, p.total - (p.amountPaid ?? 0)),
    0,
  );
  const net = receivable - payable;

  const invoicedAll = sales.reduce((n, s) => n + s.total, 0);
  const receivedAll = sales.reduce(
    (n, s) => n + Math.min(s.amountPaid ?? 0, s.total),
    0,
  );
  const collectionPct = invoicedAll > 0 ? (receivedAll / invoicedAll) * 100 : 0;

  const openQuoteRows = quotations.filter((q) => q.invoicedAs === undefined);
  const openQuotes = openQuoteRows.reduce((n, q) => n + q.total, 0);

  const lowRows = lowQ?.rows ?? [];

  const statementFor = (total: number, amountPaid?: number) =>
    amountPaid !== undefined && amountPaid >= total ? "Paid" : "Open";

  /** Six months of sales against purchases, for the trend panel. */
  const trend = Array.from({ length: 6 }, (_, i) => {
    const d = subMonths(now, 5 - i);
    const from = startOfMonth(d).getTime();
    const to = endOfMonth(d).getTime();
    return {
      label: format(d, "MMM"),
      Sales: sales
        .filter((s) => s.soldAt >= from && s.soldAt <= to)
        .reduce((n, s) => n + s.total, 0),
      Purchases: purchases
        .filter((p) => p.purchasedAt >= from && p.purchasedAt <= to)
        .reduce((n, p) => n + p.total, 0),
    };
  });
  const trendEmpty = trend.every((t) => t.Sales === 0 && t.Purchases === 0);

  /* ── the reader's layout ──────────────────────────────────────── */
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [customizing, setCustomizing] = useState(false);

  /**
   * Every change is a functional update, so two controls touched in one tick
   * cannot clobber each other, and the board is written back to this browser
   * after each of them.
   */
  const applyLayout = (update: (prev: Layout) => Layout) => setLayout(update);

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      // a full or private storage — the board still works, just not remembered
    }
  }, [layout]);

  const maySee = (need?: KpiNeed) =>
    need === undefined ||
    (need === "sales" && canViewSales) ||
    (need === "purchase" && canViewPurchase) ||
    (need === "both" && canViewSales && canViewPurchase);

  const kpiCtx: KpiCtx = {
    openTasks: openTasks.length,
    overdue: overdue.length,
    dueToday: dueToday.length,
    activeProjects: activeProjects.length,
    projectsTotal: projects.length,
    salesMonth,
    salesMonthCount: salesThisMonth.length,
    purchasesMonth,
    purchasesMonthCount: purchasesThisMonth.length,
    invoicesMonthCount: salesThisMonth.length,
    receivable,
    payable,
    net,
    lowStock: lowRows.length,
    collectionPct,
    openQuotes,
    openQuotesCount: openQuoteRows.length,
    money,
  };

  /** Cards on the board the reader may actually see. */
  const visibleKpis = layout.kpis.filter((k) => maySee(KPI_DEFS[k.id]?.need));
  /** Cards left in the drawer — everything the registry offers. */
  const hiddenKpis = Object.keys(KPI_DEFS).filter(
    (id) =>
      maySee(KPI_DEFS[id]!.need) && !layout.kpis.some((k) => k.id === id),
  );
  const visiblePanels = layout.panels.filter((p) =>
    maySee(PANEL_DEFS[p]?.need),
  );
  const hiddenPanels = Object.keys(PANEL_DEFS).filter(
    (id) => maySee(PANEL_DEFS[id]!.need) && !layout.panels.includes(id),
  );

  const hideKpi = (id: string) =>
    applyLayout((prev) => ({
      ...prev,
      kpis: prev.kpis.filter((k) => k.id !== id),
    }));
  const addKpi = (id: string) =>
    applyLayout((prev) =>
      prev.kpis.some((k) => k.id === id)
        ? prev
        : { ...prev, kpis: [...prev.kpis, { id, size: "normal" }] },
    );
  const toggleSize = (id: string) =>
    applyLayout((prev) => ({
      ...prev,
      kpis: prev.kpis.map((k) =>
        k.id === id ? { ...k, size: k.size === "wide" ? "normal" : "wide" } : k,
      ),
    }));
  const togglePanel = (id: string) =>
    applyLayout((prev) => ({
      ...prev,
      panels: prev.panels.includes(id)
        ? prev.panels.filter((p) => p !== id)
        : [...prev.panels, id],
    }));
  /**
   * The new order of the cards on show. Cards this reader may not see keep
   * their place at the end rather than being dropped from the layout.
   */
  const reorderVisible = (next: Layout["kpis"]) =>
    applyLayout((prev) => {
      const shown = new Set(next.map((k) => k.id));
      return {
        ...prev,
        kpis: [...next, ...prev.kpis.filter((k) => !shown.has(k.id))],
      };
    });
  const resetLayout = () => applyLayout(() => cloneDefault());

  return (
    <div className="space-y-6">
      {/* ── Greeting ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 text-border"
          style={{
            backgroundImage:
              "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            maskImage: "linear-gradient(115deg, black, transparent 72%)",
            WebkitMaskImage: "linear-gradient(115deg, black, transparent 72%)",
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background/70 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground backdrop-blur">
              <Building2 className="size-3" />
              {firmName}
            </span>
            <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {greetingForHour(now.getHours())}
              {firstName ? `, ${firstName}` : ""}.
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {format(now, "EEEE, d MMMM yyyy")} · {openTasks.length} open
              {overdue.length > 0 ? `, ${overdue.length} overdue` : ""}
              {dueToday.length > 0 ? `, ${dueToday.length} due today` : ""}.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onGo("tasks")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 hover:bg-primary/90"
            >
              <ListTodo className="size-3.5" />
              Tasks
            </button>
            <button
              type="button"
              onClick={() => onGoView({ kind: "projects" })}
              className="inline-flex items-center gap-1.5 rounded-xl border bg-background/70 px-3.5 py-2 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-accent"
            >
              <FolderKanban className="size-3.5" />
              Projects
            </button>
            <button
              type="button"
              onClick={() => onGoView({ kind: "reports", area: "financial" })}
              className="inline-flex items-center gap-1.5 rounded-xl border bg-background/70 px-3.5 py-2 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-accent"
            >
              <ChartColumn className="size-3.5" />
              Reports
            </button>
            <button
              type="button"
              onClick={() => setCustomizing(true)}
              title="Design this dashboard — show, hide, reorder and resize the cards"
              className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/[0.06] px-3.5 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Settings2 className="size-3.5" />
              Customize
            </button>
          </div>
        </div>
      </section>

      {/* ── The reader's board ───────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">
            Overview
          </h2>
          <button
            type="button"
            onClick={() => setCustomizing(true)}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            Customize this board
          </button>
        </div>
        {visibleKpis.length === 0 ? (
          <div className="rounded-2xl border border-dashed px-6 py-10 text-center">
            <Settings2 className="mx-auto size-6 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-medium">No cards on the board</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add some back and they will fill themselves from your registers.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 h-8 rounded-lg text-xs"
              onClick={() => setCustomizing(true)}
            >
              <Settings2 className="size-3.5" /> Customize
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {visibleKpis.map(({ id, size }) => {
              const def = KPI_DEFS[id]!;
              const out = def.compute(kpiCtx);
              return (
                <Kpi
                  key={id}
                  label={def.label}
                  value={out.value}
                  hint={out.hint}
                  Icon={def.Icon}
                  tone={out.tone ?? def.tone}
                  chip={out.chip ?? def.chip}
                  wide={size === "wide"}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ── Panels the reader chose, in their order ──────────────── */}
      {visiblePanels.length > 0 && (
        <section className="grid gap-4 lg:grid-cols-2">
          {visiblePanels.map((id) => {
            const def = PANEL_DEFS[id]!;
            const wide = def.wide;
            const className = wide ? "lg:col-span-2" : undefined;

            if (id === "trend")
              return (
                <Panel
                  key={id}
                  title={def.title}
                  subtitle={def.subtitle}
                  className={className}
                  action={
                    <button
                      type="button"
                      onClick={() =>
                        onGoView({ kind: "reports", area: "financial" })
                      }
                      className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                    >
                      Reports
                    </button>
                  }
                >
                  {trendEmpty ? (
                    <p className={emptyCls}>
                      Nothing has been sold or booked yet — the chart fills in
                      as documents land.
                    </p>
                  ) : (
                    <div className="h-56 px-1 pt-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={trend}
                          margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="var(--border)"
                          />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            fontSize={11}
                            stroke="var(--muted-foreground)"
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            fontSize={11}
                            width={48}
                            stroke="var(--muted-foreground)"
                            tickFormatter={(v) =>
                              Math.abs(Number(v)) >= 1000
                                ? `${Math.round(Number(v) / 1000)}k`
                                : String(Math.round(Number(v)))
                            }
                          />
                          <Tooltip
                            cursor={{ fill: "var(--accent)", opacity: 0.5 }}
                            formatter={(value) => money(Number(value))}
                            contentStyle={{
                              borderRadius: 12,
                              border: "1px solid var(--border)",
                              background: "var(--card)",
                              fontSize: 12,
                            }}
                            labelStyle={{ color: "var(--muted-foreground)" }}
                          />
                          <Bar
                            dataKey="Sales"
                            fill="#10b981"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={26}
                          />
                          <Bar
                            dataKey="Purchases"
                            fill="#0ea5e9"
                            radius={[4, 4, 0, 0]}
                            maxBarSize={26}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Panel>
              );

            if (id === "dueSoon")
              return (
                <Panel
                  key={id}
                  title={def.title}
                  subtitle={def.subtitle}
                  className={className}
                  action={
                    <button
                      type="button"
                      onClick={() => onGo("tasks")}
                      className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                    >
                      All tasks
                    </button>
                  }
                >
                  {tasksQ === undefined ? (
                    <p className={emptyCls}>Loading…</p>
                  ) : dueSoon.length === 0 ? (
                    <p className={emptyCls}>Nothing scheduled. Enjoy the quiet.</p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {dueSoon.map((task) => {
                        const due = dueLabel(task.dueAt ?? 0, todayStart);
                        return (
                          <li
                            key={task._id}
                            className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent/50"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span
                                className={cn(
                                  "size-2 shrink-0 rounded-full",
                                  task.dueAt !== undefined &&
                                    task.dueAt < todayStart
                                    ? "bg-rose-500"
                                    : "bg-primary/50",
                                )}
                              />
                              <span className="truncate text-sm">{task.text}</span>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 text-[11px] font-medium",
                                due.tone,
                              )}
                            >
                              {due.text}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Panel>
              );

            if (id === "lowStock")
              return (
                <Panel
                  key={id}
                  title={def.title}
                  subtitle={
                    lowQ === undefined
                      ? "Checking the shelves"
                      : lowRows.length === 0
                        ? "Everything above its reorder level"
                        : `${lowRows.length} at or below reorder level`
                  }
                  className={className}
                  action={
                    <button
                      type="button"
                      onClick={() => onGoView({ kind: "materials" })}
                      className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                    >
                      Stock
                    </button>
                  }
                >
                  {lowQ === undefined ? (
                    <p className={emptyCls}>Loading…</p>
                  ) : lowRows.length === 0 ? (
                    <p className={emptyCls}>
                      Nothing needs reordering right now.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {lowRows.slice(0, 6).map((row) => (
                        <li
                          key={row.key}
                          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent/50"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <PackageSearch className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm">
                                {row.name}
                              </span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {row.kind === "material" ? "Raw material" : "Product"}
                                {row.code ? ` · ${row.code}` : ""}
                              </span>
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm tabular-nums">
                              {row.stock} {row.unit}
                            </span>
                            <span className="block text-[11px] text-muted-foreground tabular-nums">
                              reorder at {row.threshold}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              );

            if (id === "recentInvoices")
              return (
                <Panel
                  key={id}
                  title={def.title}
                  subtitle={def.subtitle}
                  className={className}
                  action={
                    <button
                      type="button"
                      onClick={() =>
                        onGoView({ kind: "sales", tab: "invoices" })
                      }
                      className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                    >
                      Open register
                    </button>
                  }
                >
                  {salesQ === undefined ? (
                    <p className={emptyCls}>Loading…</p>
                  ) : sales.length === 0 ? (
                    <p className={emptyCls}>No invoices raised yet.</p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {sales.slice(0, 5).map((s) => (
                        <li
                          key={s._id}
                          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent/50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm">
                              {s.customerName || "Walk-in customer"}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {s.number} · {format(new Date(s.soldAt), "d MMM")}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm tabular-nums">
                              {money(s.total)}
                            </span>
                            <span
                              className={cn(
                                "block text-[11px] font-medium",
                                statementFor(s.total, s.amountPaid) === "Paid"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400",
                              )}
                            >
                              {statementFor(s.total, s.amountPaid)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              );

            if (id === "recentBills")
              return (
                <Panel
                  key={id}
                  title={def.title}
                  subtitle={def.subtitle}
                  className={className}
                  action={
                    <button
                      type="button"
                      onClick={() =>
                        onGoView({ kind: "purchase", tab: "bills" })
                      }
                      className="shrink-0 text-[11px] font-medium text-primary hover:underline"
                    >
                      Open register
                    </button>
                  }
                >
                  {purchasesQ === undefined ? (
                    <p className={emptyCls}>Loading…</p>
                  ) : purchases.length === 0 ? (
                    <p className={emptyCls}>No purchase bills booked yet.</p>
                  ) : (
                    <ul className="divide-y divide-border/60">
                      {purchases.slice(0, 5).map((p) => (
                        <li
                          key={p._id}
                          className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent/50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm">
                              {p.supplier || "Unnamed supplier"}
                            </span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">
                              {p.number} ·{" "}
                              {format(new Date(p.purchasedAt), "d MMM")}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-sm tabular-nums">
                              {money(p.total)}
                            </span>
                            <span
                              className={cn(
                                "block text-[11px] font-medium",
                                statementFor(p.total, p.amountPaid) === "Paid"
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-amber-600 dark:text-amber-400",
                              )}
                            >
                              {statementFor(p.total, p.amountPaid)}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              );

            return null;
          })}
        </section>
      )}

      {/* ── The designer ─────────────────────────────────────────── */}
      <Dialog open={customizing} onOpenChange={setCustomizing}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b px-5 py-4 text-left">
            <DialogTitle className="font-display text-base font-semibold">
              Design your dashboard
            </DialogTitle>
            <DialogDescription className="text-xs">
              Drag the cards into your order, stretch one across the row, or
              take it off the board. The panels below the cards can be switched
              on and off. Your layout is remembered on this device.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] min-h-0 space-y-5 overflow-y-auto px-5 py-4">
            {/* ── cards on the board ─────────────────────────────── */}
            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Cards on the board
              </p>
              {visibleKpis.length === 0 ? (
                <p className="rounded-xl border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                  Nothing here — add a card from below.
                </p>
              ) : (
                <Reorder.Group
                  axis="y"
                  values={visibleKpis}
                  onReorder={reorderVisible}
                  className="space-y-1.5 select-none"
                >
                  {visibleKpis.map((k) => (
                    <KpiRow
                      key={k.id}
                      item={k}
                      onHide={() => hideKpi(k.id)}
                      onSize={() => toggleSize(k.id)}
                    />
                  ))}
                </Reorder.Group>
              )}
              {hiddenKpis.length > 0 && (
                <>
                  <p className="mt-4 mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                    In the drawer
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {hiddenKpis.map((id) => {
                      const def = KPI_DEFS[id]!;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => addKpi(id)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-primary/40 bg-primary/[0.04] px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                        >
                          <def.Icon className="size-3" />
                          {def.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {/* ── panels ─────────────────────────────────────────── */}
            <div>
              <p className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Panels below the cards
              </p>
              <div className="space-y-1">
                {visiblePanels.map((id) => (
                  <label
                    key={id}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-accent/50"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm">{PANEL_DEFS[id]!.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {PANEL_DEFS[id]!.subtitle}
                      </span>
                    </span>
                    <Switch
                      checked
                      onCheckedChange={() => togglePanel(id)}
                      aria-label={`Hide ${PANEL_DEFS[id]!.title}`}
                    />
                  </label>
                ))}
                {hiddenPanels.map((id) => (
                  <label
                    key={id}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 opacity-60 hover:bg-accent/50"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm">{PANEL_DEFS[id]!.title}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {PANEL_DEFS[id]!.subtitle}
                      </span>
                    </span>
                    <Switch
                      checked={false}
                      onCheckedChange={() => togglePanel(id)}
                      aria-label={`Show ${PANEL_DEFS[id]!.title}`}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetLayout}
              className="h-8 rounded-lg text-xs"
            >
              <RotateCcw className="size-3.5" /> Reset to default
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setCustomizing(false)}
              className="h-8 rounded-lg text-xs"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One row in the designer: drag handle, name, size toggle, hide. */
function KpiRow({
  item,
  onHide,
  onSize,
}: {
  /** The very object held in the layout, so Reorder can match it by identity. */
  item: { id: string; size: KpiSize };
  onHide: () => void;
  onSize: () => void;
}) {
  const controls = useDragControls();
  const def = KPI_DEFS[item.id]!;
  const size = item.size;
  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-2 rounded-xl border bg-card px-2 py-2 shadow-sm"
    >
      <button
        type="button"
        aria-label={`Drag ${def.label}`}
        onPointerDown={(e) => controls.start(e)}
        className="grid size-7 shrink-0 cursor-grab place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
      <def.Icon className="size-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-sm">{def.label}</span>
      <button
        type="button"
        onClick={onSize}
        title={
          size === "wide" ? "Make it a normal card" : "Stretch it across the row"
        }
        aria-label={
          size === "wide" ? `Make ${def.label} normal` : `Make ${def.label} wide`
        }
        className={cn(
          "shrink-0 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
          size === "wide"
            ? "border-primary/40 bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        {size === "wide" ? "Wide" : "Normal"}
      </button>
      <button
        type="button"
        onClick={onHide}
        title="Take it off the board"
        aria-label={`Hide ${def.label}`}
        className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
      >
        <EyeOff className="size-3.5" />
      </button>
    </Reorder.Item>
  );
}
