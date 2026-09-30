import { api } from "@/convex/_generated/api";
import ActiveToggle from "@/components/ActiveToggle";
import type { CostingView } from "@/components/CostingSidebar";
import { Briefcase, Boxes, Folder, Loader2, Package } from "lucide-react";
import { useQuery } from "convex/react";
import type { ReactNode } from "react";

/**
 * Everything carrying the Active mark, in one place.
 *
 * The Active button sits on projects, jobs, products and raw materials alike,
 * so the list that gathers them is read the same way: one section per kind,
 * newest mark first, with the same button here to take the mark off again.
 * Opening a row goes to where that thing is worked on.
 */
export default function ActivePanel({
  onSelectView,
}: {
  onSelectView: (view: CostingView) => void;
}) {
  const data = useQuery(api.active.activeWork);

  if (data === undefined) {
    return (
      <p className="mt-6 flex items-center gap-2 px-1 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Reading the Active list…
      </p>
    );
  }

  const total =
    data.projects.length +
    data.jobs.length +
    data.products.length +
    data.materials.length;

  return (
    <div className="mt-4 space-y-4">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <p className="text-sm font-semibold">
            Active
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {total === 1 ? "1 item being worked on" : `${total} items being worked on`}
            </span>
          </p>
          <span className="text-[11px] text-muted-foreground">
            Marked by hand, whatever their status
          </span>
        </div>

        {total === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-muted-foreground">
            Nothing is marked active yet — the <strong>Active</strong> button on any
            project, job, product or material gathers it here.
          </p>
        ) : (
          <div className="divide-y divide-border/60">
            <Section
              title="Projects"
              icon={<Folder className="size-3.5 text-primary" />}
              count={data.projects.length}
            >
              {data.projects.map((row) => (
                <Row
                  key={row._id}
                  name={row.name}
                  code={row.code}
                  context={row.status}
                  onOpen={() => onSelectView({ kind: "projects" })}
                  toggle={
                    <ActiveToggle
                      target={{ kind: "project", id: row._id }}
                      active
                    />
                  }
                />
              ))}
            </Section>

            <Section
              title="Jobs"
              icon={<Briefcase className="size-3.5 text-sky-500" />}
              count={data.jobs.length}
            >
              {data.jobs.map((row) => (
                <Row
                  key={row._id}
                  name={row.name}
                  code={row.code}
                  context={row.projectName ?? row.status}
                  onOpen={() => onSelectView({ kind: "projects" })}
                  toggle={
                    <ActiveToggle target={{ kind: "job", id: row._id }} active />
                  }
                />
              ))}
            </Section>

            <Section
              title="Products"
              icon={<Package className="size-3.5 text-sky-500" />}
              count={data.products.length}
            >
              {data.products.map((row) => (
                <Row
                  key={row._id}
                  name={row.name}
                  code={row.code}
                  context={
                    row.jobName ??
                    row.projectName ??
                    `${row.stock.toLocaleString()} in stock`
                  }
                  onOpen={() => onSelectView({ kind: "fg", fgId: row._id })}
                  toggle={
                    <ActiveToggle
                      target={{ kind: "product", id: row._id }}
                      active
                    />
                  }
                />
              ))}
            </Section>

            <Section
              title="Raw materials"
              icon={<Boxes className="size-3.5 text-amber-500" />}
              count={data.materials.length}
            >
              {data.materials.map((row) => (
                <Row
                  key={row._id}
                  name={row.name}
                  code={row.code}
                  context={`${row.stock.toLocaleString()} ${row.unit} on hand`}
                  onOpen={() => onSelectView({ kind: "materials" })}
                  toggle={
                    <ActiveToggle
                      target={{ kind: "material", id: row._id }}
                      active
                    />
                  }
                />
              ))}
            </Section>
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        The mark is yours to set: it does not change a status, a flag or a
        costing figure, and taking it off only removes the row from this list.
      </p>
    </div>
  );
}

/** One kind of thing, with its own count and its rows. */
function Section({
  title,
  icon,
  count,
  children,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="px-4 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
        <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
          {count}
        </span>
      </p>
      <ul className="mt-2 space-y-1">{children}</ul>
    </div>
  );
}

/** One marked thing: what it is, where it belongs, and the way to it. */
function Row({
  name,
  code,
  context,
  onOpen,
  toggle,
}: {
  name: string;
  code?: string;
  context?: string;
  onOpen: () => void;
  toggle: ReactNode;
}) {
  return (
    <li className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent/40">
      <button
        type="button"
        onClick={onOpen}
        title="Open it where it is worked on"
        className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm hover:underline"
      >
        {name}
      </button>
      {code && (
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
          {code}
        </span>
      )}
      {context && (
        <span className="hidden shrink-0 truncate text-[11px] text-muted-foreground sm:block">
          {context}
        </span>
      )}
      {toggle}
    </li>
  );
}
