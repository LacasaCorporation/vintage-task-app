import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Calculator,
  ChartColumn,
  Check,
  ClipboardList,
  Factory,
  Landmark,
  Layers,
  ListChecks,
  Quote,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.6, ease: "easeOut" as const },
};

type Icon = typeof Factory;

/** The six working areas a firm moves through, in the order they hand off. */
const modules: { icon: Icon; tag: string; title: string; body: string }[] = [
  {
    icon: ListChecks,
    tag: "Plan",
    title: "Tasks, notes & projects",
    body: "Briefs, checklists, issues, comments and attachments live with the project, so the plan and the paperwork never drift apart.",
  },
  {
    icon: Calculator,
    tag: "Cost",
    title: "Cost every product",
    body: "Build each finished good from its raw materials, overheads and margin, and see where the money goes before you quote.",
  },
  {
    icon: Factory,
    tag: "Produce",
    title: "Run production",
    body: "Boards, GRNs and stock movements carry a product from raw material to despatch without a spreadsheet in sight.",
  },
  {
    icon: ShoppingCart,
    tag: "Trade",
    title: "Buy and sell",
    body: "Quotations, sales orders, LPOs, purchases, receipts and payments — one register per firm, every document accounted for.",
  },
  {
    icon: BookOpen,
    tag: "Account",
    title: "Keep the books",
    body: "Chart of accounts, journal entries and ledgers post from your documents and always balance to the paisa.",
  },
  {
    icon: ChartColumn,
    tag: "Report",
    title: "Read the numbers",
    body: "Trial balance, P&L, balance sheet, cash flow, ageing, tax and stock analysis — with plain-language proofs and CSV export.",
  },
];

/** How one job travels from a price to a balanced ledger. */
const steps: { icon: Icon; label: string; note: string }[] = [
  { icon: ClipboardList, label: "Quote", note: "Price the job from its real cost" },
  { icon: Calculator, label: "Cost", note: "Materials, labour and overheads" },
  { icon: Factory, label: "Produce", note: "Track stock as the work moves" },
  { icon: Receipt, label: "Invoice", note: "Raise the document, log the payment" },
  { icon: Landmark, label: "Ledger", note: "Post it and watch it balance" },
];

/** The trial balance shown in the hero preview — it is always in balance. */
const previewLedger = [
  { account: "Cash in hand", debit: "₹4,120.00", credit: "—" },
  { account: "Trade receivables", debit: "₹6,480.74", credit: "—" },
  { account: "Trade payables", debit: "—", credit: "₹3,300.74" },
  { account: "Sales", debit: "—", credit: "₹7,300.00" },
  { account: "Raw materials", debit: "₹3,506.00", credit: "—" },
];

const proofs = [
  { icon: Building2, title: "Built for many firms", body: "One login, a switch between firms, and separate books for each." },
  { icon: ShieldCheck, title: "Roles that hold", body: "User groups decide who may cost, who may post, and who may see sales." },
  { icon: Layers, title: "One place to look", body: "Tasks, production, trading and the accounts share the same master data." },
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top nav ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Layers className="size-4" strokeWidth={2.5} />
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">
              Slate
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="#how-it-fits"
              className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              How it fits together
            </a>
            <Button asChild variant="outline" size="sm" className="rounded-lg">
              <Link to="/auth">Sign in</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero ──────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 text-border"
            style={{
              backgroundImage:
                "radial-gradient(currentColor 1px, transparent 1px)",
              backgroundSize: "22px 22px",
              maskImage: "linear-gradient(to bottom, black, transparent 70%)",
              WebkitMaskImage:
                "linear-gradient(to bottom, black, transparent 70%)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-48 left-1/2 size-[560px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl"
          />
          <div className="relative mx-auto w-full max-w-3xl px-6 pb-14 pt-20 text-center sm:pt-24">
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm"
            >
              <Sparkles className="size-3.5 text-primary" />
              The workspace for production &amp; accounts
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.1 }}
              className="mt-6 font-display text-5xl font-bold tracking-tight sm:text-6xl"
            >
              From the shop floor{" "}
              <span className="text-primary">to the ledger</span>.
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground"
            >
              Slate keeps the work and the money in one place — tasks,
              production, costing, purchasing, sales and the books — for every
              firm you run.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.3 }}
              className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Button
                asChild
                size="lg"
                className="h-12 rounded-xl px-7 text-base shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg"
              >
                <Link to="/auth">
                  Open your workspace
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <a
                href="#modules"
                className="rounded-xl px-6 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                See the modules
              </a>
            </motion.div>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.45 }}
              className="mt-6 text-sm text-muted-foreground"
            >
              Tasks · Costing · Production · Purchasing · Sales · Accounts
            </motion.p>
          </div>
        </section>

        {/* ── Balanced-books preview ────────────────────────────────── */}
        <section className="relative mx-auto w-full max-w-3xl px-6 pb-20">
          <motion.div
            {...fadeUp}
            className="overflow-hidden rounded-2xl border bg-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <div className="flex items-center gap-2">
                <Landmark className="size-4 text-primary" />
                <p className="font-medium">Trial balance</p>
              </div>
              <p className="text-xs text-muted-foreground">As at today</p>
            </div>
            <div className="divide-y divide-border/60">
              {previewLedger.map((row) => (
                <div
                  key={row.account}
                  className="flex items-center justify-between px-5 py-3 text-sm"
                >
                  <span className="truncate text-muted-foreground">
                    {row.account}
                  </span>
                  <span className="flex shrink-0 gap-6 tabular-nums">
                    <span className="w-24 text-right">{row.debit}</span>
                    <span className="w-24 text-right">{row.credit}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-px bg-border/60 sm:grid-cols-3">
              <div className="bg-card px-5 py-4">
                <p className="text-xs text-muted-foreground">Total debits</p>
                <p className="mt-1 font-display text-lg font-semibold tabular-nums">
                  ₹14,106.74
                </p>
              </div>
              <div className="bg-card px-5 py-4">
                <p className="text-xs text-muted-foreground">Total credits</p>
                <p className="mt-1 font-display text-lg font-semibold tabular-nums">
                  ₹14,106.74
                </p>
              </div>
              <div className="bg-card px-5 py-4">
                <p className="text-xs text-muted-foreground">Difference</p>
                <p className="mt-1 flex items-center gap-1.5 font-display text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  <Check className="size-4" strokeWidth={3} />
                  ₹0.00
                </p>
              </div>
            </div>
          </motion.div>
          <motion.p
            {...fadeUp}
            className="mt-4 text-center text-sm text-muted-foreground"
          >
            Every document you raise posts itself — and the books stay balanced.
          </motion.p>
        </section>

        {/* ── Modules ───────────────────────────────────────────────── */}
        <section id="modules" className="mx-auto w-full max-w-6xl px-6 py-16">
          <motion.div {...fadeUp} className="text-center">
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              Six working areas, one slate
            </h2>
            <p className="mt-2 text-muted-foreground">
              The whole operation — not a pile of disconnected tools.
            </p>
          </motion.div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module, i) => (
              <motion.div
                key={module.title}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.07 }}
                className="group rounded-2xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <module.icon className="size-5" />
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                    {module.tag}
                  </span>
                </div>
                <h3 className="mt-4 font-semibold">{module.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {module.body}
                </p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── How it fits together ──────────────────────────────────── */}
        <section
          id="how-it-fits"
          className="mx-auto w-full max-w-6xl px-6 py-16"
        >
          <motion.div {...fadeUp} className="text-center">
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              How it fits together
            </h2>
            <p className="mt-2 text-muted-foreground">
              A job moves through five stages — and everything follows it.
            </p>
          </motion.div>

          <div className="mt-12 grid gap-4 md:grid-cols-5">
            {steps.map((step, i) => (
              <motion.div
                key={step.label}
                {...fadeUp}
                transition={{ ...fadeUp.transition, delay: i * 0.09 }}
                className="relative rounded-2xl border bg-card p-5 shadow-sm"
              >
                <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                  <step.icon className="size-4" />
                </span>
                <p className="mt-4 flex items-baseline gap-2 font-semibold">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {step.label}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {step.note}
                </p>
                {i < steps.length - 1 && (
                  <ArrowRight
                    aria-hidden
                    className="absolute -right-2.5 top-1/2 hidden size-5 -translate-y-1/2 text-border md:block"
                  />
                )}
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Multi-firm proofs ─────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-8">
          <motion.div
            {...fadeUp}
            className="grid gap-6 rounded-3xl border bg-card p-8 shadow-sm sm:grid-cols-3"
          >
            {proofs.map((proof) => (
              <div key={proof.title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <proof.icon className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{proof.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {proof.body}
                  </p>
                </div>
              </div>
            ))}
          </motion.div>
        </section>

        {/* ── Testimonial ───────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-3xl px-6 py-20">
          <motion.figure
            {...fadeUp}
            className="rounded-2xl border bg-card p-8 text-center shadow-sm"
          >
            <Quote className="mx-auto size-6 text-primary/40" />
            <blockquote className="mt-4 text-xl font-medium leading-relaxed">
              “We used to price a job from a costing sheet, then rebuild the
              same numbers in a ledger at month end. Slate does both from the
              same document.”
            </blockquote>
            <figcaption className="mt-5 flex items-center justify-center gap-3">
              <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                R
              </span>
              <span className="text-sm text-muted-foreground">
                Rohit · works manager, fabrication firm
              </span>
            </figcaption>
          </motion.figure>
        </section>

        {/* ── Closing CTA ───────────────────────────────────────────── */}
        <section className="mx-auto w-full max-w-5xl px-6 pb-24">
          <motion.div
            {...fadeUp}
            className="rounded-3xl bg-primary px-6 py-16 text-center text-primary-foreground shadow-lg"
          >
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              Run the whole firm from one place.
            </h2>
            <p className="mx-auto mt-3 max-w-md opacity-80">
              Set up your first firm, add a product and its cost, and watch the
              documents post themselves.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-8 h-12 rounded-xl bg-white px-7 text-base text-zinc-900 shadow-md transition-all hover:-translate-y-0.5 hover:bg-white/90 hover:shadow-lg"
            >
              <Link to="/auth">
                Get started
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </motion.div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-2 px-6 text-sm text-muted-foreground sm:flex-row">
          <p>© 2026 Slate</p>
          <p>Tasks, production and the books — for every firm you run.</p>
        </div>
      </footer>
    </div>
  );
}
