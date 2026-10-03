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
  Lock,
  Package,
  PackagePlus,
  Plus,
  Save,
  Search as SearchIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import ProductQtyInline from "@/components/ProductQtyInline";

type JobDoc = Doc<"projectJobs">;
type FgDoc = Doc<"finishedGoods">;

const inputCls =
  "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30";
const selectCls =
  "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30";

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
  const [qty, setQty] = useState("");
  // the unit is a managed master value, so it is picked rather than typed
  const units = useQuery(api.costing.listUnits) ?? [];
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
        qty: Number.isFinite(Number(qty)) && Number(qty) > 0 ? Number(qty) : undefined,
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
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              aria-label="Sold per unit"
              className={selectCls}
            >
              <option value="">Not set</option>
              {units.map((u) => (
                <option key={u._id} value={u.name}>
                  {u.name}
                </option>
              ))}
            </select>
            {units.length === 0 && (
              <p className="text-[11px] text-muted-foreground">
                No units set up yet — add them in Projects → Costing.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">How many to produce</label>
            <div className="relative">
              <Input
                type="number"
                min={0}
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 12"
                aria-label="How many to produce"
                className={cn(inputCls, unit.trim() && "pr-14")}
              />
              {unit.trim() && (
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
                  {unit.trim()}
                </span>
              )}
            </div>
          </div>
          {/* margin and cost are worked out by the costing sheet, so they are
              shown frozen here rather than typed in */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-dashed bg-muted/20 p-2.5">
            {[
              { label: "Margin %", value: "0%" },
              { label: "Cost", value: "—" },
            ].map((field) => (
              <div key={field.label} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {field.label}
                </label>
                <div
                  className="flex h-9 items-center rounded-lg border border-dashed bg-card/60 px-2.5 text-sm text-muted-foreground/70 select-none"
                  title="Calculated from the product's costing sheet"
                >
                  {field.value}
                </div>
              </div>
            ))}
            <p className="col-span-2 text-[11px] text-muted-foreground">
              Margin and cost are calculated by the costing sheet — they fill in
              once the product has its material lines.
            </p>
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
                      <span className="flex items-baseline gap-1.5">
                        <span className="min-w-0 truncate font-medium">{fg.name}</span>
                        <ProductQtyInline qty={fg.qty} unit={fg.unit} className="text-[10px]" />
                      </span>
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

/**
 * A value the record has settled on, shown rather than offered for editing.
 * Used for a product's project and job once it is connected, and for its code
 * in every case: those identify the record, so they are not retyped.
 */
function FrozenField({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">{label}</label>
      <div
        className={cn(
          inputCls,
          "flex items-center justify-between gap-2 bg-muted/50 text-muted-foreground",
        )}
        title={title ?? "Fixed — this is where the record sits."}
      >
        <span className="truncate">{value}</span>
        <Lock className="size-3 shrink-0 opacity-60" />
      </div>
    </div>
  );
}

/**
 * Edit a product in place: the name, code, quantity and unit shown on its row.
 * The costing sheet and everything else stays where it is.
 */
export function EditProductDialog({
  fg,
  onClose,
}: {
  fg: Doc<"finishedGoods">;
  onClose: () => void;
}) {
  const updateFg = useMutation(api.costing.updateFinishedGood);
  const setFgJobsM = useMutation(api.costing.setFgJobs);
  const [name, setName] = useState(fg.name);
  const [qty, setQty] = useState(fg.qty === undefined ? "" : String(fg.qty));
  const [unit, setUnit] = useState(fg.unit ?? "");
  const [note, setNote] = useState(fg.note ?? "");
  const [saving, setSaving] = useState(false);

  /**
   * Where the product sits, and whether that can still be changed.
   *
   * A product on the board is reached through its project and job, and every
   * sheet, order and total quotes it by that path — so once it is connected
   * the two are shown frozen rather than offered for editing. Only a product
   * with nothing attached yet gets the pickers, and the choice made here is
   * then just as fixed.
   */
  const projects = useQuery(api.costing.listProjects) ?? [];
  const allJobs = useQuery(api.jobs.listJobs) ?? [];
  const jobIds = fg.jobIds ?? (fg.jobId ? [fg.jobId] : []);
  const connectedJob = allJobs.find((j) => jobIds.includes(j._id)) ?? null;
  // A job implies its project, so a product on a job is connected to both.
  // One that is only grouped under a project has not been placed yet, and
  // still gets the pickers — otherwise it could never be given a job.
  const connected = connectedJob !== null;
  const [project, setProject] = useState(fg.projectName ?? "");
  const [jobId, setJobId] = useState(connectedJob?._id ?? "");
  const projectJobs = allJobs.filter((j) =>
    projects.some((p) => p.name === project && p._id === j.projectId),
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      toast.error("Give the product a name.");
      return;
    }
    // A connected product keeps the project and job it is on. Only one with
    // nothing attached yet gets to choose, and that choice is fixed on save.
    const chosenJob = jobId === "" ? null : allJobs.find((j) => j._id === jobId) ?? null;
    setSaving(true);
    try {
      await updateFg({
        id: fg._id,
        name: clean,
        // sent back unchanged: the code is fixed once created
        code: fg.code ?? "",
        qty: qty.trim() === "" ? undefined : Number(qty),
        unit: unit.trim(),
        // a job carries its own project, so linking sets that itself
        projectName:
          connected || chosenJob !== null
            ? fg.projectName
            : project.trim() || undefined,
        note: note.trim() || undefined,
      });
      // linking here is what makes the choice permanent; left unlinked, the
      // product keeps whichever project it was grouped under
      if (chosenJob !== null) {
        await setFgJobsM({ id: fg._id, jobIds: [chosenJob._id] });
      }
      toast.success(`“${clean}” updated.`);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't save the product.",
      );
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
              <Package className="size-4" />
            </span>
            Edit product
          </DialogTitle>
          <DialogDescription className="text-xs">
            The name and quantity are what every product row shows.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-3">
          {/* Project / job — frozen once the product is connected, a pair of
              pickers while it is still standalone. */}
          {connectedJob !== null ? (
            <div className="grid grid-cols-2 gap-3">
              {/* a job carries its project, so both are settled together */}
              <FrozenField label="Project" value={fg.projectName ?? "—"} />
              <FrozenField
                label="Job"
                value={`${connectedJob.name}${connectedJob.code ? ` · ${connectedJob.code}` : ""}`}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Project</label>
                <select
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value);
                    setJobId("");
                  }}
                  aria-label="Project"
                  className={selectCls}
                >
                  <option value="">Standalone (no project)</option>
                  {projects.map((p) => (
                    <option key={p._id} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Job</label>
                <select
                  value={jobId}
                  onChange={(e) => setJobId(e.target.value)}
                  aria-label="Job"
                  disabled={projectJobs.length === 0}
                  className={cn(selectCls, "disabled:opacity-60")}
                >
                  <option value="">
                    {projectJobs.length === 0 ? "No jobs in this project" : "No specific job"}
                  </option>
                  {projectJobs.map((j) => (
                    <option key={j._id} value={j._id}>
                      {j.name}
                      {j.code ? ` · ${j.code}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Code</label>
            {/* the code is the product's identity on every sheet, order and
                ledger line that quotes it, so it is shown rather than typed */}
            <div
              className={cn(
                inputCls,
                "flex items-center justify-between gap-2 bg-muted/50 text-muted-foreground",
              )}
              title="Fixed — the code is the product's identity and cannot change."
            >
              <span className="truncate font-mono">{fg.code || "—"}</span>
              <Lock className="size-3 shrink-0 opacity-60" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Qty</label>
              <Input
                type="number"
                min={0}
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="e.g. 12"
                className={inputCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Sold per (unit)</label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g. pcs"
                className={inputCls}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Note</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything worth remembering"
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
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
