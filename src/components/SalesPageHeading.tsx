import type { ReactNode } from "react";

/**
 * The heading every sales page opens with, so the seven of them read as one
 * module: the page named, a line saying what it is for, and the action that
 * belongs to that page.
 */
export default function SalesPageHeading({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-semibold tracking-tight">
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}
