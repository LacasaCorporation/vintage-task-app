import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
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
import {
  Briefcase,
  Copy,
  Loader2,
  Package,
  PackagePlus,
  Plus,
  Search as SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

type JobDoc = Doc<"projectJobs">;
type FgDoc = Doc<"finishedGoods">;

const inputCls =
  "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30";

/** Inline form for creating / editing a job under a project. */
export function JobDialog({
  projectId,
  projectLabel,
  job,
  onClose,
}: {
  projectId: Id<"projects"> | null;
  projectLabel: string;
  job: JobDoc | null;
  onClose: () => void;
}) {
  const addJob = useMutation(api.jobs.addJob);
  const updateJob = useMutation(api.jobs.updateJob);
  const [name, setName] = useState(job?.name ?? "");
  const [description, setDescription] = useState(job?.description ?? "");
  const [assignee, setAssignee] = useState(job?.assignee ?? "");
  const [dueDate, setDueDate] = useState(
    job?.dueAt !== undefined ? new Date(job.dueAt).toISOString().slice(0, 10) : "",
  );
  const [priority, setPriority] = useState<"high" | "medium" | "low">(
    job?.priority ?? "medium",
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Give the job a name.");
      return;
    }
    if (projectId === null) return;
    setSaving(true);
    try {
      const dueAt = dueDate
        ? new Date(`${dueDate}T12:00:00`).getTime()
        : undefined;
      if (job) {
        await updateJob({
          id: job._id,
          name: name.trim(),
          description: description.trim() || undefined,
          assignee: assignee.trim() || undefined,
          dueAt,
          priority: priority as "high" | "medium" | "low",
        });
        toast.success("Job updated.");
      } else {
        await addJob({
          projectId,
          name: name.trim(),
          description: description.trim() || undefined,
          assignee: assignee.trim() || undefined,
          dueAt,
          priority: priority as "high" | "medium" | "low",
        });
        toast.success(`Job “${name.trim()}” created — add products to it next.`);
      }
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save the job.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Briefcase className="size-4" />
            </span>
            {job ? `Edit “${job.name}”` : `New job under “${projectLabel}”`}
          </DialogTitle>
          <DialogDescription className="text-xs">
            A job is a task inside the project — products (FG) belong to a job.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Job name *</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Cutting & assembly"
              className={inputCls}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Assigned to</label>
              <Input
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="e.g. Sarah"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Due date</label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Priority</label>
            <select
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as "high" | "medium" | "low")
              }
              aria-label="Priority"
              className={inputCls}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Description</label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scope, instructions…"
              className={inputCls}
            />
          </div>
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" className="rounded-lg" disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              {job ? "Save changes" : "Create job"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog to add a product (FG) under a job — create new, or clone an existing product from any project. */
export function AddProductToJobDialog({
  job,
  projectLabel,
  allProducts,
  onOpenProduct,
  onClose,
}: {
  job: JobDoc;
  projectLabel: string;
  allProducts: FgDoc[];
  onOpenProduct: (fgId: Id<"finishedGoods">) => void;
  onClose: () => void;
}) {
  const addFg = useMutation(api.costing.addFinishedGood);
  const cloneFg = useMutation(api.costing.cloneFinishedGood);
  const attachJobs = useMutation(api.costing.setFgJobs);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [saving, setSaving] = useState(false);
  const [cloneBusy, setCloneBusy] = useState<Id<"finishedGoods"> | null>(null);
  const [existingSearch, setExistingSearch] = useState("");

  /** Every other product (any project/job/standalone) matching the search. */
  const matchingExisting = useMemo(() => {
    const q = existingSearch.trim().toLowerCase();
    return allProducts
      .filter(
        (f) =>
          !q ||
          f.name.toLowerCase().includes(q) ||
          (f.code ?? "").toLowerCase().includes(q) ||
          (f.projectName ?? "").toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [allProducts, existingSearch]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      toast.error("Give the product a name.");
      return;
    }
    setSaving(true);
    try {
      await addFg({
        jobId: job._id,
        name: clean,
        unit: unit.trim() || undefined,
      });
      toast.success(`“${clean}” added to job “${job.name}”.`);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the product.");
    } finally {
      setSaving(false);
    }
  };

  /** Clone the chosen product and attach the clone to this job. */
  const handleClone = async (fg: FgDoc) => {
    setCloneBusy(fg._id);
    try {
      const cloneId = await cloneFg({ id: fg._id });
      await attachJobs({ id: cloneId, jobIds: [job._id] });
      toast.success(
        `“${fg.name}” cloned and attached to job “${job.name}” — all BOM lines copied.`,
      );
      onOpenProduct(cloneId);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't clone the product.");
    } finally {
      setCloneBusy(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <PackagePlus className="size-4" />
            </span>
            Add product to “{job.name}”
          </DialogTitle>
          <DialogDescription className="text-xs">
            Create a new product for this job, or search any existing product
            (from another project or standalone) and clone it here — its whole
            BOM comes along. The clone belongs to {projectLabel}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Product name *</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Oak door panel"
              className={inputCls}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Sold per (unit)</label>
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. pcs, m², set"
              className={inputCls}
            />
          </div>
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" className="rounded-lg" disabled={saving}>
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              Add product
            </Button>
          </DialogFooter>
        </form>

        {/* search & clone an existing product (from any project) */}
        <div className="space-y-2 rounded-xl border border-dashed bg-muted/20 p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            <SearchIcon className="size-3" />
            Or clone an existing product (any project)
          </p>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={existingSearch}
              onChange={(e) => setExistingSearch(e.target.value)}
              placeholder="Search name, code, or project…"
              className="w-full rounded-lg border bg-background py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {allProducts.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No products exist yet — create the first one above.
            </p>
          ) : matchingExisting.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              Nothing matches “{existingSearch}”.
            </p>
          ) : (
            <ul className="max-h-44 space-y-1 overflow-y-auto">
              {matchingExisting.map((fg) => (
                <li key={fg._id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg bg-card px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                    onClick={() => void handleClone(fg)}
                    disabled={cloneBusy !== null}
                  >
                    <Package className="size-3.5 shrink-0 text-muted-foreground/70" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{fg.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground/80">
                        From: {fg.projectName ?? "Standalone"}
                      </span>
                    </span>
                    {fg.code && (
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">
                        {fg.code}
                      </span>
                    )}
                    <Copy className="size-3 shrink-0 text-primary" />
                    {cloneBusy === fg._id && (
                      <Loader2 className="size-3 shrink-0 animate-spin text-primary" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
