import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CircleDot, Loader2 } from "lucide-react";
import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * The Active mark, as a button.
 *
 * A status says where something stands; Active says you are working on it right
 * now. It is one act on a project, a job, a product and a raw material, so one
 * button serves them all — the row picks the thing to mark, and every list
 * behaves the same way. Marked things gather on the Active list.
 */
export type ActiveTarget =
  | { kind: "project"; id: Id<"projects"> }
  | { kind: "job"; id: Id<"projectJobs"> }
  | { kind: "product"; id: Id<"finishedGoods"> }
  | { kind: "material"; id: Id<"rawMaterials"> };

export default function ActiveToggle({
  target,
  active,
  compact = false,
  /** What stands under this job or project, so the tooltip can warn first. */
  blockedBy,
}: {
  target: ActiveTarget;
  active: boolean;
  /** Dense rows get the dot alone — the tooltip still names it. */
  compact?: boolean;
  /**
   * How many things sit under a job or project. A parent cannot be kept back
   * while work is inside it, so the button says so before it is pressed rather
   * than only refusing afterwards.
   */
  blockedBy?: { jobs?: number; products?: number };
}) {
  const setActive = useMutation(api.active.setActive);
  const [busy, setBusy] = useState(false);
  const what = target.kind === "project" ? "project" : "job";
  const bits: string[] = [];
  if (blockedBy?.jobs !== undefined && blockedBy.jobs > 0)
    bits.push(
      `${blockedBy.jobs} job${blockedBy.jobs === 1 ? "" : "s"}`,
    );
  if (blockedBy?.products !== undefined && blockedBy.products > 0)
    bits.push(
      `${blockedBy.products} product${blockedBy.products === 1 ? "" : "s"}`,
    );
  const under = bits.join(" and ");

  const toggle = async () => {
    setBusy(true);
    try {
      await setActive({ target, active: !active });
      toast.success(
        active ? "Taken off Active." : "Marked active — it is on the Active list.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't change the Active mark.",
      );
    } finally {
      setBusy(false);
    }
  };

  const title = active
    ? under
      ? `Still has ${under} under it — a ${what} cannot be kept back while work sits in it`
      : "On the Active list — click to take the mark off"
    : "Mark active — gather it on the Active list";

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void toggle()}
      aria-pressed={active}
      // the mark can still be pressed — the server has the last word — but the
      // warning is in the tooltip and in the toast if it refuses
      aria-label={title}
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-1 rounded-full border text-[10px] font-medium transition-colors disabled:opacity-50",
        compact ? "size-5" : "px-2 py-0.5",
        active
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground/50 hover:border-primary/30 hover:text-primary",
      )}
    >
      {busy ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <CircleDot className={cn(compact ? "size-3" : "size-2.5", active && "fill-current")} />
      )}
      {!compact && "Active"}
    </button>
  );
}
