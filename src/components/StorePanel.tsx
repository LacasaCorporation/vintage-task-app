import { useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Eye,
  Factory,
  FileSpreadsheet,
  FileText,
  Filter,
  Loader2,
  Package,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { toLocalInput } from "@/lib/task-utils";
import { useAppDialogs } from "@/components/AppDialogs";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

type MaterialDoc = Doc<"rawMaterials">;
type FgDoc = Doc<"finishedGoods">;

type IssueLineDraft = {
  materialId: Id<"rawMaterials"> | "";
  name: string;
  unit: string;
  budgetedQty: number;
  qty: number;
  unitCost: number;
  currentStock?: number;
};

const FIELD =
  "h-9 w-full rounded-lg border bg-background px-3 text-xs text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

export default function StorePanel({
  materials = [],
  finishedGoods = [],
  canEdit = true,
}: {
  materials?: MaterialDoc[];
  finishedGoods?: FgDoc[];
  canEdit?: boolean;
}) {
  const { format: money } = useWorkspaceCurrency();
  const { confirm } = useAppDialogs();

  // Mode: register dashboard vs wide standalone form
  const [viewMode, setViewMode] = useState<"register" | "issue-form" | "receipt-form">(
    "register",
  );

  // Active view tab inside register
  const [activeTab, setActiveTab] = useState<"issues" | "receipts">("issues");

  // Backend queries
  const issues = useQuery(api.store.listIssues);
  const receipts = useQuery(api.store.listReceipts);
  const storeSummary = useQuery(api.store.summary);
  const storeOptions = useQuery(api.store.options);

  // Mutations
  const createIssueM = useMutation(api.store.createIssue);
  const updateIssueM = useMutation(api.store.updateIssue);
  const dispatchIssueM = useMutation(api.store.dispatchIssue);
  const reverseIssueM = useMutation(api.store.reverseIssue);
  const deleteIssueM = useMutation(api.store.deleteIssue);

  const createReceiptM = useMutation(api.store.createReceipt);
  const updateConfirmReceiptM = useMutation(api.store.confirmReceipt);
  const deleteReceiptM = useMutation(api.store.deleteReceipt);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Filter products: only show in production or flagged (hide unflagged by default)
  const [onlyFlaggedOrInProd, setOnlyFlaggedOrInProd] = useState(true);

  // Modals state
  const [viewVoucher, setViewVoucher] = useState<{
    type: "issue" | "receipt";
    data: Doc<"storeIssues"> | Doc<"storeReceipts">;
  } | null>(null);

  // Issue form state
  const [issueDate, setIssueDate] = useState(() => toLocalInput(new Date()));
  const [selectedFgId, setSelectedFgId] = useState<Id<"finishedGoods"> | "">("");
  const [selectedJobId, setSelectedJobId] = useState<Id<"projectJobs"> | "">("");
  const [selectedProjectId, setSelectedProjectId] = useState<Id<"projects"> | "">("");
  const [issueNote, setIssueNote] = useState("");
  const [issuedBy, setIssuedBy] = useState("");
  const [issueLines, setIssueLines] = useState<IssueLineDraft[]>([]);
  const [editingIssueId, setEditingIssueId] = useState<Id<"storeIssues"> | null>(null);
  const [submittingIssue, setSubmittingIssue] = useState(false);

  // Receipt form state
  const [receiptDate, setReceiptDate] = useState(() => toLocalInput(new Date()));
  const [receiptFgId, setReceiptFgId] = useState<Id<"finishedGoods"> | "">("");
  const [receiptJobId, setReceiptJobId] = useState<Id<"projectJobs"> | "">("");
  const [receiptProjectId, setReceiptProjectId] = useState<Id<"projects"> | "">("");
  const [receiptBudgetedQty, setReceiptBudgetedQty] = useState<number>(1);
  const [receiptQty, setReceiptQty] = useState<number>(1);
  const [receiptUnit, setReceiptUnit] = useState("pcs");
  const [receiptUnitCost, setReceiptUnitCost] = useState<number>(0);
  const [receiptNote, setReceiptNote] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [submittingReceipt, setSubmittingReceipt] = useState(false);

  // Filter helper: in production or flagged
  const isFgInProdOrFlagged = (fg: FgDoc) => {
    const inProd =
      (fg.inProduction ?? 0) > 0 ||
      (fg.productionQty ?? 0) > 0 ||
      (fg as any).productionStartedAt !== undefined;
    const isFlagged = fg.isFlagged === true;
    return inProd || isFlagged;
  };

  const displayedIssueProducts = useMemo(() => {
    if (!finishedGoods) return [];
    if (!onlyFlaggedOrInProd) return finishedGoods;
    return finishedGoods.filter(
      (fg) => isFgInProdOrFlagged(fg) || fg._id === selectedFgId,
    );
  }, [finishedGoods, onlyFlaggedOrInProd, selectedFgId]);

  const displayedReceiptProducts = useMemo(() => {
    if (!finishedGoods) return [];
    if (!onlyFlaggedOrInProd) return finishedGoods;
    return finishedGoods.filter(
      (fg) => isFgInProdOrFlagged(fg) || fg._id === receiptFgId,
    );
  }, [finishedGoods, onlyFlaggedOrInProd, receiptFgId]);

  // Query budgeted materials when selectedFgId changes
  const budgetedMaterialsQuery = useQuery(
    api.store.getBudgetedMaterials,
    selectedFgId ? { fgId: selectedFgId as Id<"finishedGoods"> } : "skip",
  );

  // Handle product selection in Issue form: auto-populate recipe lines and project/job
  const handleSelectIssueFg = (fgId: Id<"finishedGoods"> | "") => {
    setSelectedFgId(fgId);
    if (!fgId) {
      setIssueLines([]);
      return;
    }
    const fg = (finishedGoods || []).find((f) => f._id === fgId);
    if (fg) {
      if (fg.jobIds && fg.jobIds.length > 0 && storeOptions?.jobs) {
        const foundJob = storeOptions.jobs.find((j) => fg.jobIds?.includes(j.id));
        if (foundJob) {
          setSelectedJobId(foundJob.id);
          setSelectedProjectId(foundJob.projectId || "");
        }
      }
    }
  };

  // Populate lines from budgeted materials query when loaded
  const handleLoadBudgetedMaterials = () => {
    if (!budgetedMaterialsQuery || budgetedMaterialsQuery.length === 0) {
      toast.info("No raw materials found in this product's costing sheet.");
      return;
    }
    const lines: IssueLineDraft[] = budgetedMaterialsQuery.map((bm) => ({
      materialId: bm.materialId,
      name: bm.name,
      unit: bm.unit,
      budgetedQty: bm.budgetedQty,
      qty: bm.qty,
      unitCost: bm.unitCost,
      currentStock: bm.currentStock,
    }));
    setIssueLines(lines);
    toast.success(`Loaded ${lines.length} budgeted materials from costing.`);
  };

  // Issue line helpers
  const handleAddIssueLine = () => {
    setIssueLines((prev) => [
      ...prev,
      {
        materialId: "",
        name: "",
        unit: "pcs",
        budgetedQty: 0,
        qty: 1,
        unitCost: 0,
        currentStock: 0,
      },
    ]);
  };

  const handleUpdateIssueLine = (
    index: number,
    field: keyof IssueLineDraft,
    val: any,
  ) => {
    setIssueLines((prev) => {
      const updated = [...prev];
      const cur = { ...updated[index], [field]: val };
      if (field === "materialId") {
        const mat = materials.find((m) => m._id === val);
        if (mat) {
          cur.name = mat.name;
          cur.unit = mat.unit || "pcs";
          cur.unitCost = mat.pricePerUnit || 0;
          cur.currentStock = mat.stock || 0;
        }
      }
      updated[index] = cur;
      return updated;
    });
  };

  const handleRemoveIssueLine = (index: number) => {
    setIssueLines((prev) => prev.filter((_, i) => i !== index));
  };

  const issueTotal = useMemo(() => {
    return issueLines.reduce((sum, l) => sum + (l.qty || 0) * (l.unitCost || 0), 0);
  }, [issueLines]);

  // Open Standalone Issue Form
  const openNewIssueForm = () => {
    setEditingIssueId(null);
    setIssueDate(toLocalInput(new Date()));
    setSelectedFgId("");
    setSelectedJobId("");
    setSelectedProjectId("");
    setIssueNote("");
    setIssuedBy("");
    setIssueLines([]);
    setViewMode("issue-form");
  };

  // Open Edit Issue Form
  const openEditIssueForm = (issue: Doc<"storeIssues">) => {
    setEditingIssueId(issue._id);
    setIssueDate(toLocalInput(new Date(issue.issuedAt)));
    setSelectedFgId(issue.fgId || "");
    setSelectedJobId(issue.jobId || "");
    setSelectedProjectId(issue.projectId || "");
    setIssueNote(issue.note || "");
    setIssuedBy(issue.issuedBy || "");
    setIssueLines(
      issue.lines.map((l) => {
        const mat = materials.find((m) => m._id === l.materialId);
        return {
          materialId: l.materialId,
          name: l.name,
          unit: l.unit,
          budgetedQty: l.budgetedQty || 0,
          qty: l.qty,
          unitCost: l.unitCost,
          currentStock: mat?.stock ?? 0,
        };
      }),
    );
    setViewMode("issue-form");
  };

  // Submit Issue
  const handleSaveIssue = async (dispatchNow: boolean = false) => {
    if (issueLines.length === 0) {
      toast.error("Please add at least one material to issue.");
      return;
    }
    for (const l of issueLines) {
      if (!l.materialId) {
        toast.error("Please select a raw material for all lines.");
        return;
      }
      if (l.qty <= 0) {
        toast.error(`Quantity for ${l.name || "material"} must be greater than zero.`);
        return;
      }
    }

    const fg = (finishedGoods || []).find((f) => f._id === selectedFgId);
    const job = storeOptions?.jobs.find((j) => j.id === selectedJobId);
    const project = storeOptions?.projects.find((p) => p.id === selectedProjectId);

    const payload = {
      issuedAt: new Date(issueDate).getTime(),
      fgId: selectedFgId ? (selectedFgId as Id<"finishedGoods">) : undefined,
      fgName: fg?.name,
      jobId: selectedJobId ? (selectedJobId as Id<"projectJobs">) : undefined,
      jobName: job?.name,
      projectId: selectedProjectId ? (selectedProjectId as Id<"projects">) : undefined,
      projectName: project?.name,
      note: issueNote.trim() || undefined,
      issuedBy: issuedBy.trim() || undefined,
      lines: issueLines.map((l) => ({
        materialId: l.materialId as Id<"rawMaterials">,
        name: l.name,
        unit: l.unit,
        budgetedQty: l.budgetedQty || undefined,
        qty: Number(l.qty),
        unitCost: Number(l.unitCost),
      })),
      total: issueTotal,
    };

    setSubmittingIssue(true);
    try {
      if (editingIssueId) {
        await updateIssueM({ issueId: editingIssueId, ...payload });
        if (dispatchNow) {
          await dispatchIssueM({ issueId: editingIssueId });
          toast.success("Store issue updated and dispatched to Factory (WIP)!");
        } else {
          toast.success("Draft store issue updated successfully.");
        }
      } else {
        const id = await createIssueM(payload);
        if (dispatchNow) {
          await dispatchIssueM({ issueId: id });
          toast.success("Materials moved from Store to Factory (WIP)!");
        } else {
          toast.success("Store issue draft created.");
        }
      }
      setViewMode("register");
    } catch (err: any) {
      toast.error(err.message || "Failed to save store issue voucher.");
    } finally {
      setSubmittingIssue(false);
    }
  };

  // Dispatch draft issue
  const handleDispatchIssue = async (issue: Doc<"storeIssues">) => {
    const ok = await confirm({
      title: `Dispatch ${issue.number} to Factory (WIP)?`,
      message: `This will move the raw materials out of the Store inventory and record them as Work-in-Progress (WIP) against ${issue.fgName || "production"}.`,
      confirmLabel: "Dispatch to Factory",
    });
    if (!ok) return;

    try {
      await dispatchIssueM({ issueId: issue._id });
      toast.success(`${issue.number} dispatched! Raw materials moved to WIP.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to dispatch issue voucher.");
    }
  };

  // Reverse issued voucher
  const handleReverseIssue = async (issue: Doc<"storeIssues">) => {
    const ok = await confirm({
      title: `Reverse ${issue.number}?`,
      message: `This will return all issued raw materials back into the Store inventory and mark this voucher as cancelled.`,
      confirmLabel: "Reverse & Return Stock",
      danger: true,
    });
    if (!ok) return;

    try {
      await reverseIssueM({ issueId: issue._id });
      toast.success(`${issue.number} reversed! Materials returned to Store.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to reverse issue voucher.");
    }
  };

  // Delete draft issue
  const handleDeleteIssue = async (issue: Doc<"storeIssues">) => {
    const ok = await confirm({
      title: `Delete ${issue.number}?`,
      message: "Are you sure you want to delete this draft voucher? This action cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;

    try {
      await deleteIssueM({ issueId: issue._id });
      toast.success("Draft voucher deleted.");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete voucher.");
    }
  };

  // Open Standalone Receipt Form
  const openNewReceiptForm = () => {
    setReceiptDate(toLocalInput(new Date()));
    setReceiptFgId("");
    setReceiptJobId("");
    setReceiptProjectId("");
    setReceiptBudgetedQty(1);
    setReceiptQty(1);
    setReceiptUnit("pcs");
    setReceiptUnitCost(0);
    setReceiptNote("");
    setReceivedBy("");
    setViewMode("receipt-form");
  };

  // Handle product selection in receipt form
  const handleSelectReceiptFg = (fgId: Id<"finishedGoods"> | "") => {
    setReceiptFgId(fgId);
    if (!fgId) return;
    const fg = (finishedGoods || []).find((f) => f._id === fgId);
    if (fg) {
      setReceiptUnit(fg.unit || "pcs");
      setReceiptBudgetedQty(fg.qty || 1);
      setReceiptQty(fg.qty || 1);
      if (fg.jobIds && fg.jobIds.length > 0 && storeOptions?.jobs) {
        const foundJob = storeOptions.jobs.find((j) => fg.jobIds?.includes(j.id));
        if (foundJob) {
          setReceiptJobId(foundJob.id);
          setReceiptProjectId(foundJob.projectId || "");
        }
      }
    }
  };

  // Submit Receipt
  const handleSaveReceipt = async (confirmNow: boolean = false) => {
    if (!receiptFgId) {
      toast.error("Please select a finished product.");
      return;
    }
    if (receiptQty <= 0) {
      toast.error("Received quantity must be greater than zero.");
      return;
    }

    const fg = (finishedGoods || []).find((f) => f._id === receiptFgId);
    const job = storeOptions?.jobs.find((j) => j.id === receiptJobId);
    const project = storeOptions?.projects.find((p) => p.id === receiptProjectId);

    const totalVal = (receiptQty || 0) * (receiptUnitCost || 0);

    const payload = {
      receivedAt: new Date(receiptDate).getTime(),
      fgId: receiptFgId as Id<"finishedGoods">,
      fgName: fg?.name || "Product",
      jobId: receiptJobId ? (receiptJobId as Id<"projectJobs">) : undefined,
      jobName: job?.name,
      projectId: receiptProjectId ? (receiptProjectId as Id<"projects">) : undefined,
      projectName: project?.name,
      note: receiptNote.trim() || undefined,
      receivedBy: receivedBy.trim() || undefined,
      budgetedQty: receiptBudgetedQty,
      qty: Number(receiptQty),
      unit: receiptUnit,
      unitCost: Number(receiptUnitCost) || undefined,
      total: totalVal > 0 ? totalVal : undefined,
    };

    setSubmittingReceipt(true);
    try {
      const id = await createReceiptM(payload);
      if (confirmNow) {
        await updateConfirmReceiptM({ receiptId: id });
        toast.success(`Finished goods received into stock! (${receiptQty} ${receiptUnit})`);
      } else {
        toast.success("Draft receipt voucher recorded.");
      }
      setViewMode("register");
    } catch (err: any) {
      toast.error(err.message || "Failed to record receipt voucher.");
    } finally {
      setSubmittingReceipt(false);
    }
  };

  // Confirm draft receipt
  const handleConfirmReceipt = async (receipt: Doc<"storeReceipts">) => {
    const ok = await confirm({
      title: `Confirm receipt ${receipt.number}?`,
      message: `This will receive ${receipt.qty} ${receipt.unit || "pcs"} of "${receipt.fgName}" from the Factory directly into Finished Goods inventory stock.`,
      confirmLabel: "Confirm Receipt into Stock",
    });
    if (!ok) return;

    try {
      await updateConfirmReceiptM({ receiptId: receipt._id });
      toast.success(`${receipt.number} confirmed! Added to finished goods stock.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to confirm receipt.");
    }
  };

  // Delete draft receipt
  const handleDeleteReceipt = async (receipt: Doc<"storeReceipts">) => {
    const ok = await confirm({
      title: `Delete draft receipt ${receipt.number}?`,
      message: "Are you sure you want to delete this draft receipt voucher?",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;

    try {
      await deleteReceiptM({ receiptId: receipt._id });
      toast.success("Draft receipt deleted.");
    } catch (err: any) {
      toast.error(err.message || "Failed to delete receipt.");
    }
  };

  // Filtered Issues
  const filteredIssues = useMemo(() => {
    if (!issues) return [];
    return issues.filter((i) => {
      if (statusFilter !== "all" && i.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesNum = i.number.toLowerCase().includes(q);
        const matchesFg = (i.fgName || "").toLowerCase().includes(q);
        const matchesJob = (i.jobName || "").toLowerCase().includes(q);
        const matchesProj = (i.projectName || "").toLowerCase().includes(q);
        const matchesNote = (i.note || "").toLowerCase().includes(q);
        if (!matchesNum && !matchesFg && !matchesJob && !matchesProj && !matchesNote) {
          return false;
        }
      }
      return true;
    });
  }, [issues, statusFilter, searchQuery]);

  // Filtered Receipts
  const filteredReceipts = useMemo(() => {
    if (!receipts) return [];
    return receipts.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesNum = r.number.toLowerCase().includes(q);
        const matchesFg = (r.fgName || "").toLowerCase().includes(q);
        const matchesJob = (r.jobName || "").toLowerCase().includes(q);
        const matchesProj = (r.projectName || "").toLowerCase().includes(q);
        const matchesNote = (r.note || "").toLowerCase().includes(q);
        if (!matchesNum && !matchesFg && !matchesJob && !matchesProj && !matchesNote) {
          return false;
        }
      }
      return true;
    });
  }, [receipts, statusFilter, searchQuery]);

  /* ══════════════════════════════════════════════════════════════════════
     STANDALONE FULL-WIDTH VIEW: ISSUE MATERIALS (STORE → FACTORY WIP)
     ══════════════════════════════════════════════════════════════════════ */
  if (viewMode === "issue-form") {
    return (
      <div className="mx-auto w-full space-y-4">
        {/* Top Action Ribbon */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-3.5 shadow-sm">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setViewMode("register")}
              className="h-8 gap-1.5 rounded-lg text-xs"
            >
              <ArrowLeft className="size-3.5" />
              Back to Store
            </Button>
            <div>
              <h2 className="text-base font-bold text-foreground sm:text-lg">
                {editingIssueId
                  ? "Edit Store Issue Voucher"
                  : "Issue Raw Materials to Factory (WIP)"}
              </h2>
              <p className="text-xs text-muted-foreground">
                Move stock from Store inventory to Factory floor as Work-in-Progress.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submittingIssue}
              onClick={() => handleSaveIssue(false)}
              className="h-8.5 gap-1.5 rounded-lg text-xs font-medium"
            >
              <Save className="size-3.5 text-muted-foreground" />
              Save as Draft
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={submittingIssue}
              onClick={() => handleSaveIssue(true)}
              className="h-8.5 gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90"
            >
              {submittingIssue ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Factory className="size-3.5" />
              )}
              Dispatch to Factory (WIP)
            </Button>
          </div>
        </div>

        {/* Master Details Card */}
        <div className="rounded-2xl border bg-card p-5 shadow-xs">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Production &amp; Destination Details
          </h3>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Product selection */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">
                  Budgeted Product <span className="text-destructive">*</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={onlyFlaggedOrInProd}
                    onChange={(e) => setOnlyFlaggedOrInProd(e.target.checked)}
                    className="size-3 rounded border"
                  />
                  <span>Flagged / In prod</span>
                </label>
              </div>

              <select
                value={selectedFgId}
                onChange={(e) =>
                  handleSelectIssueFg(e.target.value as Id<"finishedGoods"> | "")
                }
                className={FIELD}
              >
                <option value="">Select a product…</option>
                {displayedIssueProducts.length === 0 ? (
                  <option value="" disabled>
                    No products in production or flagged
                  </option>
                ) : (
                  displayedIssueProducts.map((fg) => {
                    const tags = [
                      fg.isFlagged ? "Flagged" : null,
                      (fg.inProduction ?? 0) > 0 ? "In production" : null,
                    ].filter(Boolean);
                    const tagText = tags.length > 0 ? ` (${tags.join(", ")})` : "";
                    return (
                      <option key={fg._id} value={fg._id}>
                        {fg.code ? `[${fg.code}] ` : ""}
                        {fg.name}
                        {tagText}
                      </option>
                    );
                  })
                )}
              </select>
            </div>

            {/* Project */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground">
                Project (optional)
              </label>
              <select
                value={selectedProjectId}
                onChange={(e) =>
                  setSelectedProjectId(e.target.value as Id<"projects"> | "")
                }
                className={FIELD}
              >
                <option value="">No project link</option>
                {(storeOptions?.projects || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Task / Job */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground">
                Task / Job (optional)
              </label>
              <select
                value={selectedJobId}
                onChange={(e) =>
                  setSelectedJobId(e.target.value as Id<"projectJobs"> | "")
                }
                className={FIELD}
              >
                <option value="">No job link</option>
                {(storeOptions?.jobs || [])
                  .filter((j) => !selectedProjectId || j.projectId === selectedProjectId)
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Issue Date & Issued By */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-foreground">
                  Issue Date
                </label>
                <Input
                  type="date"
                  value={issueDate}
                  onChange={(e) => setIssueDate(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-foreground">
                  Issued By
                </label>
                <Input
                  placeholder="Storekeeper"
                  value={issuedBy}
                  onChange={(e) => setIssuedBy(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="mt-3.5">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Voucher Notes / Factory Remarks
            </label>
            <Input
              placeholder="e.g. Batch #01 material dispatch, urgent fabrication release…"
              value={issueNote}
              onChange={(e) => setIssueNote(e.target.value)}
              className="h-9 text-xs"
            />
          </div>
        </div>

        {/* Wide Materials Table Card */}
        <div className="rounded-2xl border bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-4">
            <div>
              <h3 className="text-sm font-bold text-foreground">
                Materials to Dispatch to Factory Floor (WIP)
              </h3>
              <p className="text-xs text-muted-foreground">
                Raw materials dispatched here will immediately reduce store stock on
                hand and be accounted for as WIP.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {selectedFgId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleLoadBudgetedMaterials}
                  className="h-8 gap-1.5 rounded-lg border-primary/30 text-xs text-primary hover:bg-primary/5"
                >
                  <FileSpreadsheet className="size-3.5" />
                  Load Recipe / Costing Sheet
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddIssueLine}
                className="h-8 gap-1.5 rounded-lg text-xs"
              >
                <Plus className="size-3.5" />
                Add Material Line
              </Button>
            </div>
          </div>

          {issueLines.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <PackageMinus className="mb-2 size-9 opacity-40 text-amber-600" />
              <p className="text-sm font-semibold text-foreground">No materials listed</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Click &ldquo;Load Recipe / Costing Sheet&rdquo; to pull the budgeted raw
                materials from the selected product, or click &ldquo;Add Material Line&rdquo;
                to add lines manually.
              </p>
              <div className="mt-4 flex gap-2">
                {selectedFgId && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleLoadBudgetedMaterials}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <FileSpreadsheet className="size-3.5" />
                    Load Recipe
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddIssueLine}
                  className="h-8 gap-1.5 text-xs"
                >
                  <Plus className="size-3.5" />
                  Add Manual Line
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b bg-muted/20 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="py-2.5 pl-3 pr-2">#</th>
                    <th className="py-2.5 px-3 min-w-[280px]">Raw Material Item</th>
                    <th className="py-2.5 px-3 text-center">Store Stock</th>
                    <th className="py-2.5 px-3 text-center">Budgeted Qty</th>
                    <th className="py-2.5 px-3 text-center min-w-[110px]">Issue Qty</th>
                    <th className="py-2.5 px-3">Unit</th>
                    <th className="py-2.5 px-3 text-right min-w-[110px]">Unit Cost</th>
                    <th className="py-2.5 px-3 text-right">Line Total</th>
                    <th className="py-2.5 pl-2 pr-3 w-10 text-center" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {issueLines.map((line, idx) => {
                    const isShort =
                      line.currentStock !== undefined && line.currentStock < line.qty;
                    return (
                      <tr
                        key={idx}
                        className="transition-colors hover:bg-muted/10"
                      >
                        <td className="py-2.5 pl-3 pr-2 text-muted-foreground font-mono">
                          {idx + 1}
                        </td>

                        {/* Material selector */}
                        <td className="py-2.5 px-3">
                          <select
                            value={line.materialId}
                            onChange={(e) =>
                              handleUpdateIssueLine(
                                idx,
                                "materialId",
                                e.target.value as Id<"rawMaterials">,
                              )
                            }
                            className="h-8 w-full rounded-md border bg-background px-2.5 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
                          >
                            <option value="">Select a raw material…</option>
                            {materials.map((m) => (
                              <option key={m._id} value={m._id}>
                                {m.code ? `[${m.code}] ` : ""}
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Store Stock */}
                        <td className="py-2.5 px-3 text-center tabular-nums">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              isShort
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                                : "bg-muted text-foreground",
                            )}
                          >
                            {line.currentStock !== undefined
                              ? `${line.currentStock} ${line.unit}`
                              : "—"}
                          </span>
                        </td>

                        {/* Budgeted Qty */}
                        <td className="py-2.5 px-3 text-center tabular-nums text-muted-foreground">
                          {line.budgetedQty ? `${line.budgetedQty} ${line.unit}` : "—"}
                        </td>

                        {/* Issue Qty */}
                        <td className="py-2.5 px-3 text-center">
                          <Input
                            type="number"
                            min="0.001"
                            step="any"
                            value={line.qty}
                            onChange={(e) =>
                              handleUpdateIssueLine(
                                idx,
                                "qty",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="h-8 w-full text-center text-xs font-bold"
                          />
                        </td>

                        {/* Unit */}
                        <td className="py-2.5 px-3 text-muted-foreground font-medium">
                          {line.unit}
                        </td>

                        {/* Unit Cost */}
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            value={line.unitCost}
                            onChange={(e) =>
                              handleUpdateIssueLine(
                                idx,
                                "unitCost",
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            className="h-8 w-full text-right text-xs"
                          />
                        </td>

                        {/* Line Total */}
                        <td className="py-2.5 px-3 text-right font-bold tabular-nums text-foreground">
                          {money((line.qty || 0) * (line.unitCost || 0))}
                        </td>

                        {/* Delete line */}
                        <td className="py-2.5 pl-2 pr-3 text-center">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveIssueLine(idx)}
                            className="size-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Bottom Grand Total Box */}
              <div className="mt-4 flex flex-col items-end gap-2 border-t pt-4">
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-muted-foreground">
                    Total Lines:{" "}
                    <strong className="text-foreground">{issueLines.length}</strong>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-muted-foreground">
                      Total WIP Valuation:
                    </span>
                    <span className="text-lg font-black tracking-tight text-primary tabular-nums">
                      {money(issueTotal)}
                    </span>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setViewMode("register")}
                    className="h-9 px-4 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submittingIssue}
                    onClick={() => handleSaveIssue(false)}
                    className="h-9 gap-1.5 px-4 text-xs font-medium"
                  >
                    <Save className="size-3.5" />
                    Save Draft
                  </Button>
                  <Button
                    type="button"
                    disabled={submittingIssue}
                    onClick={() => handleSaveIssue(true)}
                    className="h-9 gap-1.5 bg-primary px-5 text-xs font-semibold text-primary-foreground shadow hover:bg-primary/90"
                  >
                    {submittingIssue ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Factory className="size-3.5" />
                    )}
                    Dispatch to Factory (WIP)
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     STANDALONE FULL-WIDTH VIEW: STORE RECEIPT (FINISHED GOODS FROM FACTORY)
     ══════════════════════════════════════════════════════════════════════ */
  if (viewMode === "receipt-form") {
    const totalReceiptValue = (receiptQty || 0) * (receiptUnitCost || 0);

    return (
      <div className="mx-auto w-full max-w-4xl space-y-4">
        {/* Top Action Ribbon */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card px-5 py-3.5 shadow-sm">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setViewMode("register")}
              className="h-8 gap-1.5 rounded-lg text-xs"
            >
              <ArrowLeft className="size-3.5" />
              Back to Store
            </Button>
            <div>
              <h2 className="text-base font-bold text-foreground sm:text-lg">
                Receive Finished Goods from Factory
              </h2>
              <p className="text-xs text-muted-foreground">
                Move completed production batches from factory into finished-goods stock.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={submittingReceipt}
              onClick={() => handleSaveReceipt(false)}
              className="h-8.5 gap-1.5 rounded-lg text-xs font-medium"
            >
              <Save className="size-3.5 text-muted-foreground" />
              Save as Draft
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={submittingReceipt}
              onClick={() => handleSaveReceipt(true)}
              className="h-8.5 gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow hover:bg-emerald-700"
            >
              {submittingReceipt ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PackageCheck className="size-3.5" />
              )}
              Confirm into Stock
            </Button>
          </div>
        </div>

        {/* Form Details Card */}
        <div className="rounded-2xl border bg-card p-6 shadow-xs space-y-5">
          {/* Product and Projects */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">
                  Completed Finished Product <span className="text-destructive">*</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <input
                    type="checkbox"
                    checked={onlyFlaggedOrInProd}
                    onChange={(e) => setOnlyFlaggedOrInProd(e.target.checked)}
                    className="size-3 rounded border"
                  />
                  <span>Flagged / In prod</span>
                </label>
              </div>

              <select
                value={receiptFgId}
                onChange={(e) =>
                  handleSelectReceiptFg(e.target.value as Id<"finishedGoods"> | "")
                }
                className={FIELD}
              >
                <option value="">Select completed product…</option>
                {displayedReceiptProducts.length === 0 ? (
                  <option value="" disabled>
                    No products in production or flagged
                  </option>
                ) : (
                  displayedReceiptProducts.map((fg) => {
                    const tags = [
                      fg.isFlagged ? "Flagged" : null,
                      (fg.inProduction ?? 0) > 0 ? "In production" : null,
                    ].filter(Boolean);
                    const tagText = tags.length > 0 ? ` (${tags.join(", ")})` : "";
                    return (
                      <option key={fg._id} value={fg._id}>
                        {fg.code ? `[${fg.code}] ` : ""}
                        {fg.name}
                        {tagText}
                      </option>
                    );
                  })
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-foreground">
                  Project (optional)
                </label>
                <select
                  value={receiptProjectId}
                  onChange={(e) =>
                    setReceiptProjectId(e.target.value as Id<"projects"> | "")
                  }
                  className={FIELD}
                >
                  <option value="">No project link</option>
                  {(storeOptions?.projects || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-foreground">
                  Job / Task (optional)
                </label>
                <select
                  value={receiptJobId}
                  onChange={(e) =>
                    setReceiptJobId(e.target.value as Id<"projectJobs"> | "")
                  }
                  className={FIELD}
                >
                  <option value="">No job link</option>
                  {(storeOptions?.jobs || [])
                    .filter(
                      (j) => !receiptProjectId || j.projectId === receiptProjectId,
                    )
                    .map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>

          {/* Quantities & Pricing Section */}
          <div className="rounded-xl border bg-muted/20 p-4">
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Quantity &amp; Valuation
            </h4>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Expected / Budgeted Qty
                </label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={receiptBudgetedQty}
                  onChange={(e) =>
                    setReceiptBudgetedQty(parseFloat(e.target.value) || 0)
                  }
                  className="h-9 text-center text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  Actual Received Qty <span className="text-destructive">*</span>
                </label>
                <Input
                  type="number"
                  min="0.001"
                  step="any"
                  value={receiptQty}
                  onChange={(e) => setReceiptQty(parseFloat(e.target.value) || 0)}
                  className="h-9 text-center text-xs font-bold text-emerald-600"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Unit
                </label>
                <Input
                  value={receiptUnit}
                  onChange={(e) => setReceiptUnit(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Unit Cost (Valuation)
                </label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={receiptUnitCost}
                  onChange={(e) =>
                    setReceiptUnitCost(parseFloat(e.target.value) || 0)
                  }
                  className="h-9 text-right text-xs"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t pt-3">
              <span className="text-xs font-medium text-muted-foreground">
                Total Stock Added Value:
              </span>
              <span className="text-base font-bold text-foreground">
                {money(totalReceiptValue)}
              </span>
            </div>
          </div>

          {/* Date, Inspector, Notes */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground">
                Receipt Date
              </label>
              <Input
                type="date"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-foreground">
                Received / Inspected By
              </label>
              <Input
                placeholder="e.g. Quality Inspector or Storekeeper"
                value={receivedBy}
                onChange={(e) => setReceivedBy(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Notes &amp; Quality Inspection Remarks
            </label>
            <Textarea
              placeholder="Optional batch inspection notes, warehouse rack location, packing details…"
              value={receiptNote}
              onChange={(e) => setReceiptNote(e.target.value)}
              className="h-20 text-xs"
            />
          </div>

          {/* Footer Buttons */}
          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setViewMode("register")}
              className="h-9 px-4 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={submittingReceipt}
              onClick={() => handleSaveReceipt(false)}
              className="h-9 gap-1.5 px-4 text-xs font-medium"
            >
              <Save className="size-3.5" />
              Save Draft
            </Button>
            <Button
              type="button"
              disabled={submittingReceipt}
              onClick={() => handleSaveReceipt(true)}
              className="h-9 gap-1.5 bg-emerald-600 px-5 text-xs font-semibold text-white shadow hover:bg-emerald-700"
            >
              {submittingReceipt ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <PackageCheck className="size-3.5" />
              )}
              Confirm into Stock
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     DEFAULT REGISTER / DASHBOARD VIEW
     ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-6">
      {/* ── Page Header ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Warehouse className="size-6 text-primary" />
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Store &amp; WIP Management
            </h1>
          </div>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Issue raw materials to factory as Work-in-Progress (WIP) against budgeted
            products, and receive finished goods into stock.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <Button
                type="button"
                onClick={openNewIssueForm}
                className="h-9 gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90"
              >
                <PackageMinus className="size-4" />
                Issue to Factory (WIP)
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={openNewReceiptForm}
                className="h-9 gap-1.5 rounded-lg border px-3.5 text-xs font-medium shadow-sm hover:bg-accent"
              >
                <PackagePlus className="size-4 text-emerald-600" />
                Receive Finished Goods
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── KPI Summary Cards ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Total WIP Issued</span>
            <Factory className="size-4 text-amber-600" />
          </div>
          <div className="mt-2 text-lg font-bold tabular-nums text-foreground">
            {money(storeSummary?.issues.totalIssued || 0)}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {storeSummary?.issues.issuedCount || 0} vouchers dispatched
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Pending Issues</span>
            <ClipboardList className="size-4 text-primary" />
          </div>
          <div className="mt-2 text-lg font-bold tabular-nums text-foreground">
            {storeSummary?.issues.draftCount || 0}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Draft issue vouchers
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Goods Received</span>
            <PackageCheck className="size-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-lg font-bold tabular-nums text-foreground">
            {storeSummary?.receipts.receivedCount || 0}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Finished production batches
          </p>
        </div>

        <div className="rounded-xl border bg-card p-3.5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">Pending Receipts</span>
            <Boxes className="size-4 text-indigo-600" />
          </div>
          <div className="mt-2 text-lg font-bold tabular-nums text-foreground">
            {storeSummary?.receipts.draftCount || 0}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Draft receipt vouchers
          </p>
        </div>
      </div>

      {/* ── Main Panel Navigation & Filters ─────────────────────────── */}
      <div className="rounded-xl border bg-card shadow-xs">
        {/* Navigation Tabs */}
        <div className="flex flex-col gap-3 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab("issues");
                setStatusFilter("all");
              }}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === "issues"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ArrowUpRight className="size-3.5 text-amber-600" />
              Store Issues (WIP to Factory)
              <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] tabular-nums">
                {issues?.length ?? 0}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("receipts");
                setStatusFilter("all");
              }}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === "receipts"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <ArrowDownLeft className="size-3.5 text-emerald-600" />
              Store Receipts (Finished Goods)
              <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] tabular-nums">
                {receipts?.length ?? 0}
              </span>
            </button>
          </div>

          {/* Search & Status Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search voucher, product, job…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-lg border bg-background px-2.5 text-xs text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft only</option>
              {activeTab === "issues" ? (
                <>
                  <option value="issued">Dispatched (WIP)</option>
                  <option value="cancelled">Cancelled</option>
                </>
              ) : (
                <option value="received">Received in Stock</option>
              )}
            </select>
          </div>
        </div>

        {/* ── Table Content ─────────────────────────────────────────── */}
        {activeTab === "issues" ? (
          /* ISSUES TABLE */
          <div className="overflow-x-auto">
            {issues === undefined ? (
              <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading store issues…
              </div>
            ) : filteredIssues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <PackageMinus className="mb-2 size-8 opacity-40 text-amber-600" />
                <p className="text-sm font-medium">No store issues found</p>
                <p className="mt-1 text-xs">
                  Issue raw materials to the factory floor against budgeted products as
                  Work-in-Progress (WIP).
                </p>
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={openNewIssueForm}
                    className="mt-4 h-8 gap-1.5 rounded-lg text-xs"
                  >
                    <Plus className="size-3.5" />
                    New Issue Voucher
                  </Button>
                )}
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/30 text-[11px] font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Voucher #</th>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Budgeted Product / Job</th>
                    <th className="px-4 py-2.5 text-center">Lines</th>
                    <th className="px-4 py-2.5 text-right">Total Cost</th>
                    <th className="px-4 py-2.5 text-center">Status</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredIssues.map((issue) => (
                    <tr
                      key={issue._id}
                      className="transition-colors hover:bg-muted/20"
                    >
                      <td className="px-4 py-3 font-semibold text-foreground">
                        <button
                          type="button"
                          onClick={() => setViewVoucher({ type: "issue", data: issue })}
                          className="font-mono text-primary hover:underline"
                        >
                          {issue.number}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(issue.issuedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">
                          {issue.fgName || "Standalone Production"}
                        </div>
                        {(issue.jobName || issue.projectName) && (
                          <div className="text-[11px] text-muted-foreground">
                            {[issue.projectName, issue.jobName]
                              .filter(Boolean)
                              .join(" / ")}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        {issue.lines.length} items
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                        {money(issue.total)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                            issue.status === "issued" &&
                              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                            issue.status === "draft" &&
                              "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                            issue.status === "cancelled" &&
                              "bg-muted text-muted-foreground",
                          )}
                        >
                          {issue.status === "issued" ? "Dispatched (WIP)" : issue.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewVoucher({ type: "issue", data: issue })}
                            title="View Voucher"
                            className="size-7 p-0"
                          >
                            <Eye className="size-3.5" />
                          </Button>

                          {canEdit && issue.status === "draft" && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => openEditIssueForm(issue)}
                                title="Edit voucher"
                                className="size-7 p-0"
                              >
                                <Pencil className="size-3.5" />
                              </Button>

                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleDispatchIssue(issue)}
                                title="Move raw materials to Factory (WIP)"
                                className="h-7 gap-1 rounded bg-emerald-600 px-2 text-[11px] font-medium text-white hover:bg-emerald-700"
                              >
                                <Factory className="size-3" />
                                Dispatch
                              </Button>

                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteIssue(issue)}
                                title="Delete draft"
                                className="size-7 p-0 text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          )}

                          {canEdit && issue.status === "issued" && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleReverseIssue(issue)}
                              title="Return stock from WIP back to Store"
                              className="h-7 gap-1 rounded border-destructive/40 text-[11px] text-destructive hover:bg-destructive/10"
                            >
                              <RefreshCw className="size-3" />
                              Reverse
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          /* RECEIPTS TABLE */
          <div className="overflow-x-auto">
            {receipts === undefined ? (
              <div className="flex items-center justify-center py-16 text-xs text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Loading store receipts…
              </div>
            ) : filteredReceipts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <PackagePlus className="mb-2 size-8 opacity-40 text-emerald-600" />
                <p className="text-sm font-medium">No store receipts found</p>
                <p className="mt-1 text-xs">
                  Receive completed products from the factory into the finished goods
                  inventory store.
                </p>
                {canEdit && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={openNewReceiptForm}
                    className="mt-4 h-8 gap-1.5 rounded-lg text-xs"
                  >
                    <Plus className="size-3.5" />
                    New Receipt Voucher
                  </Button>
                )}
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted/30 text-[11px] font-medium text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5">Receipt #</th>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Finished Product</th>
                    <th className="px-4 py-2.5">Project / Job</th>
                    <th className="px-4 py-2.5 text-center">Qty Received</th>
                    <th className="px-4 py-2.5 text-right">Value</th>
                    <th className="px-4 py-2.5 text-center">Status</th>
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredReceipts.map((receipt) => (
                    <tr
                      key={receipt._id}
                      className="transition-colors hover:bg-muted/20"
                    >
                      <td className="px-4 py-3 font-semibold text-foreground">
                        <button
                          type="button"
                          onClick={() => setViewVoucher({ type: "receipt", data: receipt })}
                          className="font-mono text-primary hover:underline"
                        >
                          {receipt.number}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(receipt.receivedAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {receipt.fgName}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {[receipt.projectName, receipt.jobName]
                          .filter(Boolean)
                          .join(" / ") || "—"}
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        <span className="font-semibold text-foreground">
                          {receipt.qty}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {receipt.unit || "pcs"}
                        </span>
                        {receipt.budgetedQty !== undefined && (
                          <span className="ml-1 text-[11px] text-muted-foreground">
                            (exp: {receipt.budgetedQty})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                        {receipt.total ? money(receipt.total) : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                            receipt.status === "received" &&
                              "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                            receipt.status === "draft" &&
                              "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                            receipt.status === "cancelled" &&
                              "bg-muted text-muted-foreground",
                          )}
                        >
                          {receipt.status === "received" ? "In Stock" : receipt.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewVoucher({ type: "receipt", data: receipt })}
                            title="View Voucher"
                            className="size-7 p-0"
                          >
                            <Eye className="size-3.5" />
                          </Button>

                          {canEdit && receipt.status === "draft" && (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleConfirmReceipt(receipt)}
                                title="Add to Finished Goods Stock"
                                className="h-7 gap-1 rounded bg-emerald-600 px-2 text-[11px] font-medium text-white hover:bg-emerald-700"
                              >
                                <PackageCheck className="size-3" />
                                Confirm Stock
                              </Button>

                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteReceipt(receipt)}
                                title="Delete draft"
                                className="size-7 p-0 text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* ── VIEW VOUCHER MODAL (Printable) ─────────────────────────── */}
      {viewVoucher && (
        <Dialog open onOpenChange={(open) => !open && setViewVoucher(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <DialogTitle className="text-base font-bold font-mono">
                    {viewVoucher.data.number}
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground">
                    {viewVoucher.type === "issue"
                      ? "Store Issue Voucher (Materials to Factory WIP)"
                      : "Store Receipt Voucher (Finished Goods from Factory)"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
                      viewVoucher.data.status === "issued" ||
                        viewVoucher.data.status === "received"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-amber-500/10 text-amber-600",
                    )}
                  >
                    {viewVoucher.data.status}
                  </span>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => window.print()}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <Printer className="size-3.5" />
                    Print
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-4 py-2 text-xs">
              <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/20 p-3">
                <div>
                  <span className="text-muted-foreground">Date:</span>{" "}
                  <span className="font-semibold text-foreground">
                    {new Date(
                      viewVoucher.type === "issue"
                        ? (viewVoucher.data as Doc<"storeIssues">).issuedAt
                        : (viewVoucher.data as Doc<"storeReceipts">).receivedAt,
                    ).toLocaleDateString()}
                  </span>
                </div>

                <div>
                  <span className="text-muted-foreground">
                    {viewVoucher.type === "issue" ? "Issued By:" : "Received By:"}
                  </span>{" "}
                  <span className="font-semibold text-foreground">
                    {(viewVoucher.type === "issue"
                      ? (viewVoucher.data as Doc<"storeIssues">).issuedBy
                      : (viewVoucher.data as Doc<"storeReceipts">).receivedBy) || "—"}
                  </span>
                </div>

                <div>
                  <span className="text-muted-foreground">Budgeted Product:</span>{" "}
                  <span className="font-semibold text-foreground">
                    {viewVoucher.data.fgName || "—"}
                  </span>
                </div>

                <div>
                  <span className="text-muted-foreground">Project / Job:</span>{" "}
                  <span className="font-semibold text-foreground">
                    {[viewVoucher.data.projectName, viewVoucher.data.jobName]
                      .filter(Boolean)
                      .join(" / ") || "—"}
                  </span>
                </div>
              </div>

              {viewVoucher.type === "issue" ? (
                <div>
                  <h4 className="mb-2 font-semibold text-foreground">
                    Materials Dispatched to WIP:
                  </h4>
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b text-[11px] font-medium text-muted-foreground">
                        <th className="py-1.5">Material</th>
                        <th className="py-1.5 text-center">Budgeted</th>
                        <th className="py-1.5 text-center">Issued Qty</th>
                        <th className="py-1.5">Unit</th>
                        <th className="py-1.5 text-right">Unit Cost</th>
                        <th className="py-1.5 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {(viewVoucher.data as Doc<"storeIssues">).lines.map(
                        (line, idx) => (
                          <tr key={idx}>
                            <td className="py-2 font-medium text-foreground">
                              {line.name}
                            </td>
                            <td className="py-2 text-center text-muted-foreground">
                              {line.budgetedQty || "—"}
                            </td>
                            <td className="py-2 text-center font-bold text-foreground">
                              {line.qty}
                            </td>
                            <td className="py-2 text-muted-foreground">{line.unit}</td>
                            <td className="py-2 text-right tabular-nums">
                              {money(line.unitCost)}
                            </td>
                            <td className="py-2 text-right font-medium tabular-nums text-foreground">
                              {money(line.qty * line.unitCost)}
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>

                  <div className="mt-3 flex justify-end border-t pt-2 text-sm font-bold text-foreground">
                    Total: {money((viewVoucher.data as Doc<"storeIssues">).total)}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">
                        Quantity Completed &amp; Received:
                      </span>
                      <span className="text-base font-bold text-emerald-600">
                        {(viewVoucher.data as Doc<"storeReceipts">).qty}{" "}
                        {(viewVoucher.data as Doc<"storeReceipts">).unit || "pcs"}
                      </span>
                    </div>

                    {(viewVoucher.data as Doc<"storeReceipts">).budgetedQty !==
                      undefined && (
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span>Expected / Budgeted Quantity:</span>
                        <span>
                          {(viewVoucher.data as Doc<"storeReceipts">).budgetedQty}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {viewVoucher.data.note && (
                <div className="rounded-lg border bg-muted/10 p-3">
                  <span className="font-medium text-muted-foreground">Notes:</span>
                  <p className="mt-1 text-foreground">{viewVoucher.data.note}</p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setViewVoucher(null)}
                className="text-xs"
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
