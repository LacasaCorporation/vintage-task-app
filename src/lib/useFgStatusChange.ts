import { useConvex, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAppDialogs } from "@/components/AppDialogs";
import { PROJECT_STATUS_FINISH } from "@/lib/project-statuses";
import { toast } from "@/lib/toast";

/** The product fields this hook reads and writes — any product doc fits. */
type StatusProduct = {
  _id: Id<"finishedGoods">;
  name: string;
  isCompleted?: boolean;
  projectStatus?: string;
};

/** Whether a product is finished, by either of the two marks it carries. */
function isFinished(fg: StatusProduct): boolean {
  return fg.isCompleted === true || fg.projectStatus === PROJECT_STATUS_FINISH;
}

/**
 * Move a product between statuses, asking first when that takes it off Finish.
 *
 * Reopening a finished product puts it back on the list while its units stay on
 * the shelf and its cost stays counted in the job's totals, so the server wants
 * that said out loud. This is where the reader says it — once, for every
 * control that can move a product's status: a row's dropdown, the side panel's,
 * and a card dropped on the board. It answers false when the change was
 * declined or refused, so a caller can leave its own state alone.
 */
export function useFgStatusChange() {
  const { confirm } = useAppDialogs();
  const convex = useConvex();
  const setFgStatus = useMutation(api.costing.setFgProjectStatus);
  return async (fg: StatusProduct, status: string): Promise<boolean> => {
    const reopening = status !== PROJECT_STATUS_FINISH && isFinished(fg);
    if (reopening) {
      const goAhead = await confirm({
        title: `Reopen “${fg.name}”?`,
        message:
          "It is finished, so its units are already on the shelf and its cost is counted in the job's totals. Moving it out of Finish puts it back on the list — the stock, the cost and those totals are not changed.",
        confirmLabel: "Reopen",
        danger: true,
      });
      if (!goAhead) return false;
    }
    const finishing = status === PROJECT_STATUS_FINISH && !isFinished(fg);
    if (finishing) {
      try {
        const items = await convex.query(api.costing.listFgItems, { fgId: fg._id });
        const totalCost = (items ?? []).reduce(
          (sum, it) => sum + (it.qty || 0) * (it.unitPrice || 0),
          0,
        );
        if ((items ?? []).length === 0 || totalCost <= 0) {
          const goAhead = await confirm({
            title: `Finish “${fg.name}” with zero cost?`,
            message:
              "This product has no recipe lines or its total cost is 0.00. Finishing it will land zero-costed stock on the books. Do you want to finish it anyway?",
            confirmLabel: "Finish anyway",
            danger: true,
          });
          if (!goAhead) return false;
        }
      } catch {
        // continue
      }
    }
    try {
      await setFgStatus({ id: fg._id, status, confirmReverse: reopening });
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't update the product status.",
      );
      return false;
    }
  };
}
