import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Link2, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";

type JobOption = { _id: Id<"projectJobs">; name: string; code?: string };

/**
 * Connecting a product to a job. A product stands on its own — this is the
 * moment it gets a job, and the batch is asked for here rather than living
 * on the product, so one product can need a different quantity per job.
 */
export default function ConnectJobDialog({
  open,
  productName,
  productUnit,
  defaultQty,
  jobs,
  currentJobId,
  onClose,
  onSubmit,
}: {
  open: boolean;
  productName: string;
  productUnit?: string;
  defaultQty: number;
  jobs: JobOption[];
  currentJobId?: Id<"projectJobs">;
  onClose: () => void;
  onSubmit: (jobId: Id<"projectJobs">, qty: number) => Promise<void>;
}) {
  const [jobId, setJobId] = useState<string>(currentJobId ?? "");
  const [qty, setQty] = useState<string>(String(defaultQty));
  const [busy, setBusy] = useState(false);

  const unit = productUnit ?? "pcs";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (jobId === "") {
      toast.error("Pick the job this belongs to.");
      return;
    }
    const value = Number(qty);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Enter how many this job needs.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(jobId as Id<"projectJobs">, value);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't connect the product.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Link2 className="size-4" />
            </span>
            Connect to a job
          </DialogTitle>
          <DialogDescription className="text-xs">
            {productName} stands on its own. Linking it to a job asks how many
            that job needs — the project totals use this figure.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label
              htmlFor="connect-job"
              className="mb-1 block text-[11px] font-medium text-muted-foreground"
            >
              Job
            </label>
            <select
              id="connect-job"
              autoFocus
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="h-8 w-full rounded-lg border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Choose a job…</option>
              {jobs.map((j) => (
                <option key={j._id} value={j._id}>
                  {j.code ? `${j.code} · ` : ""}
                  {j.name}
                </option>
              ))}
            </select>
            {jobs.length === 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                No jobs yet — open a project and add one first.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="connect-qty"
              className="mb-1 block text-[11px] font-medium text-muted-foreground"
            >
              How many does this job need?
            </label>
            <div className="flex items-center gap-1.5">
              <Input
                id="connect-qty"
                type="number"
                min={0}
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-label="Batch quantity"
                className="h-8 w-24 rounded-lg text-xs"
              />
              <span className="text-[11px] text-muted-foreground">{unit}</span>
            </div>
          </div>

          <DialogFooter className="gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onClose}
              className="h-7 rounded-lg text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={busy || jobId === "" || jobs.length === 0}
              className="h-7 gap-1.5 rounded-lg text-xs"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Link2 className="size-3.5" />
              )}
              Connect
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
