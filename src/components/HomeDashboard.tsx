import type { PrimarySection } from "@/components/PrimaryNav";
import type { CostingView } from "@/components/CostingSidebar";
import { api } from "@/convex/_generated/api";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { endOfMonth, format, startOfMonth } from "date-fns";
import {
  ArrowUpRight,
  Building2,
  ChartColumn,
  Clock,
  FolderKanban,
  ListTodo,
  PackageSearch,
  Receipt,
  ShoppingCart,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { ReactNode } from "react";

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
  if (days === 0)
    return { text: "Due today", tone: "text-amber-600 dark:text-amber-400" };
  if (days === 1) return { text: "Due tomorrow", tone: "text-muted-foreground" };
  return { text: `In ${days} days`, tone: "text-muted-foreground" };
}

/** One headline number. */
function Kpi({
  label,
  value,
  hint,
  Icon,
  tone = "text-primary",
  chip = "bg-primary/10",
}: {
  label: string;
  value: string;
  hint: string;
  Icon: typeof Clock;
  tone?: string;
  chip?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <span
          className={cn("grid size-7 shrink-0 place-items-center rounded-lg", chip, tone)}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <p
        className={cn(
          "mt-3 font-display text-2xl font-semibold tracking-tight tabular-nums",
          tone,
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** A titled card used for the lists below the tiles. */
function Panel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border bg-card shadow-sm">
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
 * source of truth — the tiles are sums over the registers.
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
  const purchases = purchasesQ ?? [];

  const salesMonth = sales
    .filter((s) => inMonth(s.soldAt))
    .reduce((n, s) => n + s.total, 0);
  const purchasesMonth = purchases
    .filter((p) => inMonth(p.purchasedAt))
    .reduce((n, p) => n + p.total, 0);

  const receivable = sales.reduce(
    (n, s) => n + Math.max(0, s.total - (s.amountPaid ?? 0)),
    0,
  );
  const payable = purchases.reduce(
    (n, p) => n + Math.max(0, p.total - (p.amountPaid ?? 0)),
    0,
  );
  const net = receivable - payable;

  const lowRows = lowQ?.rows ?? [];

  const statementFor = (total: number, amountPaid?: number) =>
    amountPaid !== undefined && amountPaid >= total ? "Paid" : "Open";

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
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5"
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
          </div>
        </div>
      </section>

      {/* ── Today ────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">
          Today
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            label="Open tasks"
            value={String(openTasks.length)}
            hint={
              overdue.length > 0
                ? `${overdue.length} overdue`
                : "Nothing overdue"
            }
            Icon={ListTodo}
            tone={overdue.length > 0 ? "text-rose-600 dark:text-rose-400" : "text-primary"}
            chip={overdue.length > 0 ? "bg-rose-500/10" : "bg-primary/10"}
          />
          <Kpi
            label="Active projects"
            value={String(activeProjects.length)}
            hint={`${projects.length} in total`}
            Icon={FolderKanban}
          />
          <Kpi
            label="Sales this month"
            value={money(salesMonth, 0)}
            hint={`${sales.filter((s) => inMonth(s.soldAt)).length} invoices raised`}
            Icon={ShoppingCart}
            tone="text-emerald-600 dark:text-emerald-400"
            chip="bg-emerald-500/10"
          />
          <Kpi
            label="Purchases this month"
            value={money(purchasesMonth, 0)}
            hint={`${purchases.filter((p) => inMonth(p.purchasedAt)).length} bills booked`}
            Icon={Receipt}
            tone="text-sky-600 dark:text-sky-400"
            chip="bg-sky-500/10"
          />
        </div>
      </section>

      {/* ── Money at a glance ────────────────────────────────────── */}
      {(canViewSales || canViewPurchase) && (
        <section>
          <h2 className="mb-3 font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground/70">
            Money at a glance
          </h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi
              label="Owed to the firm"
              value={money(receivable, 0)}
              hint="Unpaid sales invoices"
              Icon={Wallet}
              tone="text-sky-600 dark:text-sky-400"
              chip="bg-sky-500/10"
            />
            <Kpi
              label="The firm owes"
              value={money(payable, 0)}
              hint="Unpaid purchase bills"
              Icon={Wallet}
              tone="text-amber-600 dark:text-amber-400"
              chip="bg-amber-500/10"
            />
            <Kpi
              label="Net position"
              value={money(net, 0)}
              hint={net >= 0 ? "In the firm's favour" : "More going out than in"}
              Icon={net >= 0 ? ArrowUpRight : TriangleAlert}
              tone={net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
              chip={net >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10"}
            />
          </div>
        </section>
      )}

      {/* ── Due soon + low stock ─────────────────────────────────── */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel
            title="Due soon"
            subtitle="Open tasks with a date, soonest first"
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
                            task.dueAt !== undefined && task.dueAt < todayStart
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
        </div>

        <Panel
          title="Low stock"
          subtitle={
            lowQ === undefined
              ? "Checking the shelves"
              : lowRows.length === 0
                ? "Everything above its reorder level"
                : `${lowRows.length} at or below reorder level`
          }
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
                      <span className="block truncate text-sm">{row.name}</span>
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
      </section>

      {/* ── Recent documents ─────────────────────────────────────── */}
      {(canViewSales || canViewPurchase) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {canViewSales && (
            <Panel
              title="Recent invoices"
              subtitle="Newest sales bills"
              action={
                <button
                  type="button"
                  onClick={() => onGoView({ kind: "sales", tab: "invoices" })}
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
          )}

          {canViewPurchase && (
            <Panel
              title="Recent bills"
              subtitle="Newest purchase bills"
              action={
                <button
                  type="button"
                  onClick={() => onGoView({ kind: "purchase", tab: "bills" })}
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
          )}
        </section>
      )}
    </div>
  );
}
