import { useState } from "react";
import { useMutation } from "convex/react";
import { Loader2, Minus, Plus } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const qtyText = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");

/**
 * How many a product is at, editable from its own row.
 *
 * A product put into a job used to be asked for its batch once, at the moment
 * of linking, and never again — there was no way to give a product already
 * sitting under a job more (or fewer) units without unlinking it and linking
 * it again. This is that control: `−` and `+` move it a step at a time, and
 * clicking the number sets it outright.
 *
 * It is read-only while the product is in production or already finished —
 * its costs and stock are on the books by then, and the server refuses the
 * change with the same reason.
 */
export default function ProductQtyStepper({
  fgId,
  jobId,
  qty,
  unit,
  className,
}: {
  fgId: Id<"finishedGoods">;
  /** The job this row sits under, so the job's record follows the quantity. */
  jobId?: Id<"projectJobs">;
  qty: number | undefined;
  unit: string | undefined;
  className?: string;
}) {
  const setQtyM = useMutation(api.costing.setProductQty);
  const [busy, setBusy] = useState(false);
  const current = qty !== undefined && qty > 0 ? qty : 1;
  const label = unit ?? "pcs";

  const set = async (next: number) => {
    setBusy(true);
    try {
      await setQtyM({ id: fgId, qty: next, jobId });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't change the quantity.",
      );
    } finally {
      setBusy(false);
    }
  };

  /** Clicking the number types the quantity outright. */
  const typeIt = () => {
    const text = window.prompt(`How many ${label}?`, qtyText(current));
    if (text === null) return;
    const value = Number(text);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter how many this job needs.");
      return;
    }
    void set(value);
  };

  const btn =
    "grid size-4 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground";

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border bg-card py-0.5 pr-1 pl-0.5 text-[10px] font-medium text-muted-foreground tabular-nums",
        className,
      )}
      title={`Quantity for this job — ${qtyText(current)} ${label}. − and + step it, clicking the number sets it.`}
    >
      {busy ? (
        <Loader2 className="size-3 shrink-0 animate-spin" />
      ) : (
        <>
          <button
            type="button"
            className={cn(btn, current <= 1 && "opacity-40")}
            disabled={current <= 1}
            onClick={() => void set(current - 1)}
            aria-label={`One ${label} fewer`}
            title={`One ${label} fewer`}
          >
            <Minus className="size-2.5" />
          </button>
          <button
            type="button"
            onClick={typeIt}
            className="min-w-4 rounded px-0.5 text-center text-foreground transition-colors hover:bg-accent"
            aria-label={`Quantity for this job — ${qtyText(current)} ${label}. Click to type a different one.`}
            title="Click to type a different quantity"
          >
            {qtyText(current)}
          </button>
          <button
            type="button"
            className={btn}
            onClick={() => void set(current + 1)}
            aria-label={`One more ${label}`}
            title={`One more ${label}`}
          >
            <Plus className="size-2.5" />
          </button>
        </>
      )}
      <span className="pr-0.5">{label}</span>
    </span>
  );
}
