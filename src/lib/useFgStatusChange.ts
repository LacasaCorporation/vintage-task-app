import { useMutation } from "convex/react";
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
