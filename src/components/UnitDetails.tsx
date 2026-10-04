import type { Doc } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

type UnitDoc = Doc<"costUnits">;

/** Trim a float to at most 6 decimals so 1/12 doesn't print as 0.083333… */
function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 1e6) / 1e6);
}

/**
 * The detail line beneath a unit dropdown: what the unit is called in full,
 * the short form documents show, and how it converts — so a picked unit reads
 * as a fact rather than a bare name.
 */
export default function UnitDetails({
  unit,
  units,
  className,
}: {
  /** The selected unit's `name`, or "" when nothing is picked. */
  unit: string;
  units: UnitDoc[];
  className?: string;
}) {
  if (unit.trim() === "") return null;
  const selected = units.find((u) => u.name === unit);
  if (selected === undefined) return null;

  const short = selected.abbreviation?.trim();
  const full = selected.fullName?.trim();
  const parent =
    selected.parentId !== undefined
      ? units.find((p) => p._id === selected.parentId)
      : undefined;

  const bits: string[] = [];
  if (full !== undefined && full !== "" && full !== selected.name)
    bits.push(full);
  if (short !== undefined && short !== "" && short !== selected.name)
    bits.push(`documents show “${short}”`);
  if (parent !== undefined) {
    bits.push(
      `1 ${selected.name} = ${fmtNum(selected.factor ?? 1)} × ${parent.name}`,
    );
  } else {
    bits.push("Base unit — nothing it converts to");
  }

  return (
    <p className={cn("text-[11px] leading-snug text-muted-foreground/85", className)}>
      {bits.join(" · ")}
    </p>
  );
}
