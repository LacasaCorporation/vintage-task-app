import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  analyzeAll,
  exportMaterialTemplate,
  isSupportedFile,
  readMaterialWorkbook,
  summarize,
  type AnalyzedRow,
  type MaterialInput,
} from "@/lib/materialImport";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  Info,
  Loader2,
  ShieldAlert,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type MaterialDoc = Doc<"rawMaterials">;
type UnitDoc = Doc<"costUnits">;
type CategoryDoc = Doc<"costCategories">;

type Filter = "all" | "ready" | "warnings" | "errors" | "duplicates" | "ai-check" | "ai-reject";

const STATUS_STYLE: Record<AnalyzedRow["status"], { label: string; className: string }> = {
  ready: {
    label: "Ready",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  fixed: { label: "Auto-fixed", className: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  warning: { label: "Check", className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-500" },
  error: { label: "Error", className: "border-destructive/40 bg-destructive/10 text-destructive" },
  duplicate: { label: "Duplicate", className: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400" },
};

const ISSUE_DOT: Record<string, string> = {
  error: "bg-destructive",
  warning: "bg-amber-500",
  info: "bg-sky-500",
};

/**
 * Smart bulk import: read an Excel/CSV file, run the validation engine and let
 * the user review every row (with inline fixes) before writing anything.
 */
export default function MaterialImportDialog({
  open,
  onOpenChange,
  materials,
  units,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  materials: MaterialDoc[];
  units: UnitDoc[];
  categories: CategoryDoc[];
}) {
  const bulkImport = useMutation(api.costing.bulkImportMaterials);
  const aiCheckRows = useAction(api.aiCheck.aiCheckRows);
  const fileInput = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<"pick" | "review">("pick");
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [baseInputs, setBaseInputs] = useState<{ row: MaterialInput; sourceRow: number }[]>([]);
  const [overrides, setOverrides] = useState<Record<number, Partial<MaterialInput>>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [autoCreate, setAutoCreate] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [importing, setImporting] = useState(false);
  const [aiChecking, setAiChecking] = useState(false);
  const [aiVerdicts, setAiVerdicts] = useState<
    Record<number, { verdict: "ok" | "check" | "reject"; note: string }>
  >({});

  // reset when reopened
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStage("pick");
      setFileName("");
      setBaseInputs([]);
      setOverrides({});
      setExcluded(new Set());
      setFilter("all");
      setReading(false);
      setImporting(false);
      setAiChecking(false);
      setAiVerdicts({});
    }
  }

  const inputs = useMemo(
    () =>
      baseInputs.map(({ row, sourceRow }) => ({
        row: { ...row, ...(overrides[sourceRow] ?? {}) },
        sourceRow,
      })),
    [baseInputs, overrides],
  );

  const analyzed = useMemo(() => {
    if (inputs.length === 0) return [];
    const result = analyzeAll(inputs, {
      existing: materials.map((m) => ({
        _id: m._id,
        code: m.code,
        name: m.name,
        category: m.category,
        subCategory: m.subCategory,
        unit: m.unit,
        pricePerUnit: m.pricePerUnit,
      })),
      units: units.map((u) => ({ _id: u._id, name: u.name })),
      categories: categories.map((c) => ({ _id: c._id, name: c.name, parentId: c.parentId })),
      options: { autoCreate },
    });
    return result.map((row) => ({
      ...row,
      include: row.include && !excluded.has(row.key),
    }));
  }, [inputs, materials, units, categories, autoCreate, excluded]);

  const summary = useMemo(() => summarize(analyzed), [analyzed]);
  const aiRejectCount = analyzed.filter((r) => aiVerdicts[r.sourceRow]?.verdict === "reject").length;
  const toImport = analyzed.filter(
    (row) =>
      row.include && row.action !== "skip" && aiVerdicts[row.sourceRow]?.verdict !== "reject",
  );
  const updateCount = toImport.filter((row) => row.action === "update").length;
  const createCount = toImport.length - updateCount;

  const visible = useMemo(() => {
    if (filter === "all") return analyzed;
    if (filter === "ready") return analyzed.filter((r) => r.status === "ready" || r.status === "fixed");
    if (filter === "warnings") return analyzed.filter((r) => r.status === "warning");
    if (filter === "errors") return analyzed.filter((r) => r.status === "error");
    if (filter === "ai-check")
      return analyzed.filter((r) => aiVerdicts[r.sourceRow]?.verdict === "check");
    if (filter === "ai-reject")
      return analyzed.filter((r) => aiVerdicts[r.sourceRow]?.verdict === "reject");
    return analyzed.filter((r) => r.status === "duplicate");
  }, [analyzed, filter, aiVerdicts]);

  const handleFile = async (file: File) => {
    if (!isSupportedFile(file)) {
      toast.error("Use an Excel file (.xlsx, .xls) or a .csv export.");
      return;
    }
    setReading(true);
    try {
      const result = await readMaterialWorkbook(file);
      if (result.inputs.length === 0) {
        toast.error("No data rows found under the header row.");
        return;
      }
      setBaseInputs(result.inputs);
      setFileName(file.name);
      setOverrides({});
      setExcluded(new Set());
      setStage("review");
      toast.success(`${result.inputs.length} rows read from “${file.name}”.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't read that file.");
    } finally {
      setReading(false);
    }
  };

  const toggleRow = (row: AnalyzedRow) => {
    if (row.action === "skip" && row.status === "error") return; // fix it first
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(row.key)) next.delete(row.key);
      else next.add(row.key);
      return next;
    });
  };

  /**
   * Special AI checking: send the reviewed rows through an LLM audit that
   * flags subtle typos, wrong units, implausible prices and junk entries that
   * the rule engine can't catch. Verdicts render inline on each row.
   */
  const runAiCheck = async () => {
    const candidates = analyzed
      .filter((r) => r.raw.name && r.action !== "skip")
      .map((r) => ({
        index: r.sourceRow,
        code: r.raw.code,
        name: r.raw.name,
        category: r.raw.category,
        subCategory: r.raw.subCategory,
        unit: r.raw.unit,
        price: Number.isFinite(r.raw.pricePerUnit) ? r.raw.pricePerUnit : 0,
      }));
    if (candidates.length === 0) {
      toast.error("Nothing to check — fix the error rows first.");
      return;
    }
    setAiChecking(true);
    try {
      const verdicts = await aiCheckRows({ rows: candidates });
      setAiVerdicts(
        Object.fromEntries(verdicts.map((v) => [v.index, { verdict: v.verdict, note: v.note }])),
      );
      const rejects = verdicts.filter((v) => v.verdict === "reject").length;
      const checks = verdicts.filter((v) => v.verdict === "check").length;
      toast.success(
        `AI check done — ${rejects} to reject, ${checks} to review, ${
          verdicts.length - rejects - checks
        } clean.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI check failed.");
    } finally {
      setAiChecking(false);
    }
  };

  const runImport = async () => {
    if (toImport.length === 0) return;
    setImporting(true);
    try {
      const result = await bulkImport({
        rows: toImport.map((row) => ({
          code: row.raw.code || undefined,
          name: row.raw.name,
          category: row.raw.category || undefined,
          subCategory: row.raw.subCategory || undefined,
          unit: row.raw.unit,
          pricePerUnit: row.parsedPrice ?? 0,
        })),
        mode,
        autoCreate,
      });
      const parts = [
        result.created > 0 ? `${result.created} added` : null,
        result.updated > 0 ? `${result.updated} updated` : null,
        result.skipped > 0 ? `${result.skipped} skipped` : null,
        result.unitsCreated > 0 ? `${result.unitsCreated} unit(s) created` : null,
        result.categoriesCreated > 0 ? `${result.categoriesCreated} category item(s) created` : null,
      ].filter(Boolean);
      toast.success(`Import finished — ${parts.join(", ")}.`);
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} row(s) were rejected: ${result.errors[0]}`);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  const nextCode = `RM${String(materials.length + 1).padStart(4, "0")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" />
            </span>
            Bulk import raw materials
          </DialogTitle>
          <DialogDescription className="text-xs">
            {stage === "pick"
              ? "Bring in a filled template or any spreadsheet — every row is checked before it is saved."
              : `Smart check on ${analyzed.length} rows from “${fileName}”.`}
          </DialogDescription>
        </DialogHeader>

        {stage === "pick" ? (
          <div className="px-5 py-5">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFile(file);
              }}
              className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-muted/30 px-6 py-12 text-center"
            >
              <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
                {reading ? (
                  <Loader2 className="size-6 animate-spin" />
                ) : (
                  <Upload className="size-6" />
                )}
              </span>
              <div>
                <p className="text-sm font-medium">
                  {reading ? "Reading the file…" : "Drop your Excel file here"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  .xlsx, .xls or .csv — headers can be in any order, on any sheet.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="rounded-lg"
                  onClick={() => fileInput.current?.click()}
                  disabled={reading}
                >
                  <FileSpreadsheet className="size-3.5" />
                  Choose file
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-lg"
                  onClick={() =>
                    void exportMaterialTemplate(
                      units.map((u) => ({ _id: u._id, name: u.name })),
                      categories.map((c) => ({ _id: c._id, name: c.name, parentId: c.parentId })),
                      nextCode,
                    )
                  }
                >
                  Download template
                </Button>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.xlsm,.csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleFile(file);
                }}
              />
            </div>

            <ul className="mt-4 grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
              {[
                "Column names are matched automatically (Code, Item, Rate, UOM…).",
                "Units like “Kgs” or “Nos” are mapped to your master list.",
                "Duplicate codes and names are flagged and merged.",
                "Odd or changed prices are called out before saving.",
                "AI check audits every row for typos, bad units & implausible prices.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-1.5">
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary/70" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {/* ── check summary ─────────────────────────────────────── */}
            <div className="border-b border-border/60 bg-muted/25 px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "grid size-10 place-items-center rounded-xl border text-sm font-bold tabular-nums",
                      summary.score >= 90
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : summary.score >= 70
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-500"
                          : "border-destructive/40 bg-destructive/10 text-destructive",
                    )}
                  >
                    {summary.score}
                  </span>
                  <div className="text-xs">
                    <p className="font-semibold">Data score</p>
                    <p className="text-muted-foreground">
                      {summary.score >= 90
                        ? "Clean file — safe to import"
                        : summary.score >= 70
                          ? "Mostly fine — review the flags"
                          : "Several rows need attention"}
                    </p>
                  </div>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ["all", "All", analyzed.length],
                      ["ready", "Ready", summary.ready + summary.fixed],
                      ["warnings", "Check", summary.warnings],
                      ["errors", "Errors", summary.errors],
                      ["duplicates", "Duplicates", summary.duplicates],
                      [
                        "ai-check",
                        "AI: review",
                        analyzed.filter((r) => aiVerdicts[r.sourceRow]?.verdict === "check").length,
                      ],
                      [
                        "ai-reject",
                        "AI: reject",
                        analyzed.filter((r) => aiVerdicts[r.sourceRow]?.verdict === "reject").length,
                      ],
                    ] as [Filter, string, number][]
                  ).map(([id, label, count]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setFilter(id)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs font-medium tabular-nums transition-colors",
                        filter === id
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {label} {count}
                    </button>
                  ))}
                </div>
              </div>

              {(summary.newUnits.length > 0 ||
                summary.newCategories.length > 0 ||
                summary.newSubCategories.length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Info className="size-3" />
                    Will be created:
                  </span>
                  {summary.newUnits.map((u) => (
                    <span key={`u-${u}`} className="rounded-full bg-sky-500/10 px-2 py-0.5 text-sky-600 dark:text-sky-400">
                      unit · {u}
                    </span>
                  ))}
                  {summary.newCategories.map((c) => (
                    <span key={`c-${c}`} className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-600 dark:text-violet-400">
                      category · {c}
                    </span>
                  ))}
                  {summary.newSubCategories.map((c) => (
                    <span key={`s-${c}`} className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-600 dark:text-violet-400">
                      sub · {c}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* ── rows ──────────────────────────────────────────────── */}
            <div className="max-h-[42vh] overflow-y-auto">
              {visible.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  Nothing in this filter.
                </p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {visible.map((row) => {
                    const style = STATUS_STYLE[row.status];
                    const aiVerdict = aiVerdicts[row.sourceRow];
                    const priceError = row.issues.some(
                      (i) => i.level === "error" && i.field === "price",
                    );
                    const nameError = row.issues.some(
                      (i) => i.level === "error" && i.field === "name",
                    );
                    return (
                      <li
                        key={row.key}
                        className={cn(
                          "flex items-start gap-3 px-5 py-2.5 transition-colors",
                          (excluded.has(row.key) || aiVerdicts[row.sourceRow]?.verdict === "reject") &&
                            "opacity-55",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 size-3.5 accent-[var(--primary)]"
                          checked={row.include}
                          disabled={row.status === "error"}
                          onChange={() => toggleRow(row)}
                          aria-label={`Include row ${row.sourceRow}`}
                        />
                        <span className="mt-0.5 w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground/70">
                          {row.sourceRow}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                            <span className="font-medium">{row.raw.name || "—"}</span>
                            {row.raw.code && (
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {row.raw.code}
                              </span>
                            )}
                            {row.raw.category && (
                              <span className="text-xs text-muted-foreground">
                                {row.raw.category}
                                {row.raw.subCategory ? ` › ${row.raw.subCategory}` : ""}
                              </span>
                            )}
                            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {row.raw.unit || "unit?"}
                            </span>
                            <span className="text-sm font-medium tabular-nums">
                              {row.parsedPrice === null
                                ? "no price"
                                : row.parsedPrice.toLocaleString()}
                            </span>
                            {row.existingPrice !== undefined &&
                              row.parsedPrice !== null &&
                              row.existingPrice !== row.parsedPrice && (
                                <span className="text-[10px] text-muted-foreground line-through">
                                  {row.existingPrice.toLocaleString()}
                                </span>
                              )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {row.issues.map((issue, i) => (
                              <span
                                key={`${row.key}-i${i}`}
                                className="flex items-center gap-1 text-[11px] text-muted-foreground"
                              >
                                <span
                                  className={cn(
                                    "size-1.5 rounded-full",
                                    ISSUE_DOT[issue.level] ?? "bg-muted-foreground",
                                  )}
                                />
                                {issue.message}
                              </span>
                            ))}
                          </div>

                          {aiVerdict && (
                            <div
                              className={cn(
                                "mt-1.5 flex items-start gap-1.5 rounded-lg border px-2 py-1 text-[11px]",
                                aiVerdict.verdict === "reject"
                                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                                  : aiVerdict.verdict === "check"
                                    ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-500"
                                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                              )}
                            >
                              {aiVerdict.verdict === "reject" ? (
                                <ShieldAlert className="mt-0.5 size-3 shrink-0" />
                              ) : (
                                <Bot className="mt-0.5 size-3 shrink-0" />
                              )}
                              <span>
                                <span className="font-semibold">AI:</span> {aiVerdict.note}
                              </span>
                            </div>
                          )}

                          {(priceError || nameError) && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              {nameError && (
                                <input
                                  className="h-7 min-w-[160px] rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
                                  placeholder="Type the material name…"
                                  value={overrides[row.sourceRow]?.name ?? row.raw.name}
                                  onChange={(e) =>
                                    setOverrides((prev) => ({
                                      ...prev,
                                      [row.sourceRow]: {
                                        ...(prev[row.sourceRow] ?? {}),
                                        name: e.target.value,
                                      },
                                    }))
                                  }
                                />
                              )}
                              {priceError && (
                                <input
                                  className="h-7 w-28 rounded-md border bg-background px-2 text-xs tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
                                  placeholder="Unit price"
                                  value={
                                    overrides[row.sourceRow]?.pricePerUnit !== undefined &&
                                    Number.isFinite(overrides[row.sourceRow]?.pricePerUnit)
                                      ? String(overrides[row.sourceRow]?.pricePerUnit)
                                      : ""
                                  }
                                  onChange={(e) =>
                                    setOverrides((prev) => ({
                                      ...prev,
                                      [row.sourceRow]: {
                                        ...(prev[row.sourceRow] ?? {}),
                                        pricePerUnit: e.target.value === "" ? Number.NaN : Number(e.target.value),
                                      },
                                    }))
                                  }
                                />
                              )}
                              <span className="text-[10px] text-muted-foreground">
                                fix it here instead of editing the file
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                              style.className,
                            )}
                          >
                            {style.label}
                          </span>
                          <span className="text-[10px] tabular-nums text-muted-foreground/70">
                            {row.confidence}%
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* ── options + actions ─────────────────────────────────── */}
            <div className="border-t border-border/60 bg-muted/25 px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Existing items:</span>
                  <div className="flex rounded-lg border bg-card p-0.5">
                    {(
                      [
                        ["skip", "Skip"],
                        ["update", "Update price"],
                      ] as ["skip" | "update", string][]
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMode(id)}
                        className={cn(
                          "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                          mode === id
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-1.5 text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--primary)]"
                    checked={autoCreate}
                    onChange={(e) => setAutoCreate(e.target.checked)}
                  />
                  Auto-create missing units &amp; categories
                </label>
                <div className="ml-auto flex items-center gap-3 text-muted-foreground">
                  {summary.errors > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <XCircle className="size-3.5" />
                      {summary.errors} row{summary.errors === 1 ? "" : "s"} need a fix
                    </span>
                  )}
                  {summary.warnings > 0 && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
                      <AlertTriangle className="size-3.5" />
                      {summary.warnings} to review
                    </span>
                  )}
                  {summary.duplicates > 0 && (
                    <span className="flex items-center gap-1">
                      <Copy className="size-3.5" />
                      {summary.duplicates} merged
                    </span>
                  )}
                  {aiRejectCount > 0 && (
                    <span className="flex items-center gap-1 text-destructive">
                      <ShieldAlert className="size-3.5" />
                      {aiRejectCount} AI-rejected
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {createCount > 0 && `${createCount} new`}
                  {createCount > 0 && updateCount > 0 && " · "}
                  {updateCount > 0 && `${updateCount} existing (${mode === "skip" ? "skipped" : "price updated"})`}
                  {toImport.length === 0 && "Select at least one row to import."}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    disabled={aiChecking || importing}
                    onClick={() => void runAiCheck()}
                    title="Run an AI audit over these rows — flags typos, wrong units and implausible prices"
                  >
                    {aiChecking ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Bot className="size-3.5" />
                    )}
                    {aiChecking
                      ? "AI checking…"
                      : aiVerdicts && Object.keys(aiVerdicts).length > 0
                        ? "Re-run AI check"
                        : "AI check"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => setStage("pick")}
                  >
                    Choose another file
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-lg"
                    disabled={toImport.length === 0 || importing}
                    onClick={() => void runImport()}
                  >
                    {importing && <Loader2 className="size-3.5 animate-spin" />}
                    Import {toImport.length} row{toImport.length === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
