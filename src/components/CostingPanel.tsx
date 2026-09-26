import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MaterialsSheet from "@/components/MaterialsSheet";
import ProductForm from "@/components/ProductForm";
import ProjectsSheet from "@/components/ProjectsSheet";
import type { CostingView } from "@/components/CostingSidebar";
import PurchasePanel from "@/components/PurchasePanel";
import {
  ChevronDown,
  AlertTriangle,
  Download,
  Factory,
  FileSpreadsheet,
  ImagePlus,
  Loader2,
  Package,
  Pencil,
  Plus,
  Printer,
  Save,
  Sigma,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { useAppDialogs } from "@/components/AppDialogs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type FgId = Id<"finishedGoods">;
type FgDoc = Doc<"finishedGoods">;
type MaterialDoc = Doc<"rawMaterials">;

const cellCls =
  "w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-primary/5 focus:ring-2 focus:ring-primary/30 rounded-md";

function money(value: number, currency: string) {
  return `${currency}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Main costing area: raw-materials sheet, product form/list, or FG costing grid. */
export default function CostingPanel({
  materials,
  finishedGoods,
  loading,
  view,
  onSelectView,
  onNewFg,
  onRenameFg,
  onDeleteFg,
  onEditFg,
  onNewProduct,
  onNewProject,
  onEditProject,
  onDeleteProject,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  canViewMaterials = true,
  canViewPurchase = true,
  canCreatePurchase = true,
  canEditPurchase = true,
  canDeletePurchase = true,
  canCreateMaterial = true,
  canEditMaterial = true,
  canDeleteMaterial = true,
  canPrint = true,
  canImportExport = true,
  canImport = true,
  canEditProject = true,
  canDeleteProject = true,
}: {
  materials: MaterialDoc[];
  finishedGoods: FgDoc[];
  loading: boolean;
  view: CostingView;
  onSelectView: (view: CostingView) => void;
  onNewFg: (projectName: string) => void;
  onRenameFg: (fg: FgDoc) => void;
  onDeleteFg: (fg: FgDoc) => void;
  onEditFg: (fg: FgDoc) => void;
  onNewProduct?: (projectName: string) => void;
  onNewProject?: () => void;
  onEditProject?: (project: Doc<"projects">) => void;
  onDeleteProject?: (project: Doc<"projects">) => void;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canViewMaterials?: boolean;
  canViewPurchase?: boolean;
  canCreatePurchase?: boolean;
  canEditPurchase?: boolean;
  canDeletePurchase?: boolean;
  /** Raw material item permissions (separate from products). */
  canCreateMaterial?: boolean;
  canEditMaterial?: boolean;
  canDeleteMaterial?: boolean;
  canPrint?: boolean;
  /** Excel menu visibility (dataImport.view). */
  canImportExport?: boolean;
  /** Row importing (dataImport.create). */
  canImport?: boolean;
  canEditProject?: boolean;
  canDeleteProject?: boolean;
}) {
  const [projectFocus, setProjectFocus] = useState<string | null>(null);
  const addFgItem = useMutation(api.costing.addFgItem);
  const updateItem = useMutation(api.costing.updateItem);
  const removeItem = useMutation(api.costing.removeItem);
  const updateFg = useMutation(api.costing.updateFinishedGood);
  const setFgImage = useMutation(api.costing.setFgImage);
  const clearFgImageM = useMutation(api.costing.clearFgImage);
  const mergeDuplicates = useMutation(api.costing.mergeFgDuplicateItems);
  const mergedOnceFor = useRef<Id<"finishedGoods"> | null>(null);
  const { confirm, promptMulti } = useAppDialogs();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const handlePickImage = () => imageInputRef.current?.click();

  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !activeFg) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choose an image file (photo, PNG, JPG…).");
      return;
    }
    if (file.size > 900_000) {
      toast.error("Images up to ~900 KB can be attached.");
      return;
    }
    setUploadingImage(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      await setFgImage({ id: activeFg._id, data, name: file.name, size: file.size });
      toast.success("Product image updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't attach the image.");
    } finally {
      setUploadingImage(false);
    }
  };

  const handleRemoveImage = async () => {
    if (!activeFg?.imageUrl) return;
    const ok = await confirm({
      title: "Remove the product image?",
      message: "The photo is detached from this product. It can be added again anytime.",
      confirmLabel: "Remove image",
      danger: true,
    });
    if (!ok) return;
    try {
      await clearFgImageM({ id: activeFg._id });
      toast.success("Image removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't remove the image.");
    }
  };

  // ── FG costing grid state ──────────────────────────────────────────
  const [addingMaterialId, setAddingMaterialId] = useState("");
  const [materialQty, setMaterialQty] = useState("1");
  const [customLabel, setCustomLabel] = useState("");
  const [customQty, setCustomQty] = useState("1");
  const [customPrice, setCustomPrice] = useState("0");

  // Draft state — edits stay local until "Save" is pressed.
  const [drafts, setDrafts] = useState<
    { id: Id<"costingItems">; label: string; qty: number; unitPrice: number }[]
  >([]);
  const [savingSheet, setSavingSheet] = useState(false);
  /** A change waiting on the "production is running, continue?" warning. */
  const [pendingEdit, setPendingEdit] = useState<{
    label: string;
    run: () => void | Promise<void>;
  } | null>(null);

  /**
   * Editing a product whose production is running always warns first — the
   * sheet is what decides which materials leave the stock.
   */
  const guardProduction = (label: string, run: () => void | Promise<void>) => {
    if (activeFg?.productionStartedAt === undefined) return void run();
    setPendingEdit({ label, run });
  };

  const activeFg =
    view?.kind === "fg"
      ? (finishedGoods.find((f) => f._id === view.fgId) ?? null)
      : null;
  const currency = activeFg?.currency ?? "$";
  const markupPct = activeFg?.markupPct ?? 0;

  const items = useQuery(
    api.costing.listFgItems,
    view?.kind === "fg" ? { fgId: view.fgId } : "skip",
  );
  const rows = items ?? [];

  // Collapse duplicate rows (same description/price/unit) once per sheet open.
  useEffect(() => {
    if (!activeFg || items === undefined || items.length < 2) return;
    if (mergedOnceFor.current === activeFg._id) return;
    const hasDupes = new Set(items.map((i) => `${i.label}::${i.unitPrice}::${i.unit ?? ""}`)).size
      !== items.length;
    if (!hasDupes) {
      mergedOnceFor.current = activeFg._id;
      return;
    }
    mergedOnceFor.current = activeFg._id;
    void mergeDuplicates({ fgId: activeFg._id })
      .then((removed) => {
        if (removed > 0) toast.success(`Merged ${removed} duplicate row${removed === 1 ? "" : "s"}.`);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, activeFg?._id]);

  const totals = useMemo(() => {
    const subtotal = rows.reduce((sum, r) => sum + r.qty * r.unitPrice, 0);
    const markup = subtotal * (markupPct / 100);
    return { subtotal, markup, grand: subtotal + markup };
  }, [rows, markupPct]);

  // ── Draft (save-button) logic ─────────────────────────────────────
  // Keep a local draft of every visible row; reset it when the sheet's
  // server data changes shape (rows added/removed or another FG opened).
  useEffect(() => {
    setDrafts(
      rows.map((r) => ({ id: r._id, label: r.label, qty: r.qty, unitPrice: r.unitPrice })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, activeFg?._id]);

  const isDirty = useMemo(() => {
    if (drafts.length !== rows.length) return rows.length > 0;
    return rows.some((r) => {
      const d = drafts.find((x) => x.id === r._id);
      return d ? d.label !== r.label || d.qty !== r.qty || d.unitPrice !== r.unitPrice : false;
    });
  }, [drafts, rows]);

  const updateDraft = (id: Id<"costingItems">, patch: Partial<{ label: string; qty: number; unitPrice: number }>) =>
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const saveSheet = async () => {
    if (!activeFg) return;
    const run = async () => {
      setSavingSheet(true);
      try {
        for (const r of rows) {
          const d = drafts.find((x) => x.id === r._id);
          if (!d) continue;
          const changed =
            d.label !== r.label || d.qty !== r.qty || d.unitPrice !== r.unitPrice;
          if (changed) {
            await updateItem({
              id: r._id,
              label: d.label,
              qty: d.qty,
              unitPrice: d.unitPrice,
            });
          }
        }
        toast.success("Sheet saved.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Couldn't save the sheet.");
      } finally {
        setSavingSheet(false);
      }
    };
    guardProduction("Saving the sheet", run);
  };

  // Ctrl/Cmd+S saves the sheet.
  useEffect(() => {
    if (!isDirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveSheet();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, drafts]);

  /** Per-row edit dialog (pencil icon). */
  const handleEditRow = async (row: { _id: Id<"costingItems">; label: string; qty: number; unitPrice: number }) => {
    if (!activeFg) return;
    const result = await promptMulti({
      title: `Edit line — ${row.label}`,
      message: "Change the description, quantity, or unit price.",
      columns: 2,
      confirmLabel: "Apply",
      fields: [
        { key: "label", label: "Description", initial: row.label, required: true },
        { key: "qty", label: "Quantity", initial: String(row.qty), type: "number", required: true },
        {
          key: "price",
          label: "Unit price",
          initial: String(row.unitPrice),
          type: "number",
          required: true,
        },
      ],
    });
    if (result === null) return;
    const qty = Number(result.qty);
    const price = Number(result.price);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Price can't be negative.");
      return;
    }
    try {
      await updateItem({ id: row._id, label: result.label, qty, unitPrice: price });
      toast.success("Line updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the line.");
    }
  };
  const editRow = (
    row: { _id: Id<"costingItems">; label: string; qty: number; unitPrice: number },
  ) => guardProduction("Editing a line", () => void handleEditRow(row));

  const addMaterialRow = async () => {
    if (!activeFg || !addingMaterialId) return;
    const qty = Number(materialQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Enter a quantity greater than zero.");
      return;
    }
    try {
      await addFgItem({
        fgId: activeFg._id,
        materialId: addingMaterialId as MaterialDoc["_id"],
        qty,
      });
      setAddingMaterialId("");
      setMaterialQty("1");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the row.");
    }
  };
  const addMaterialRowGuarded = () =>
    guardProduction("Adding a material", () => void addMaterialRow());

  const addCustomRow = async () => {
    if (!activeFg) return;
    const qty = Number(customQty);
    const price = Number(customPrice);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Price can't be negative.");
      return;
    }
    try {
      await addFgItem({
        fgId: activeFg._id,
        label: customLabel.trim() || "Custom line",
        qty,
        unitPrice: price,
      });
      setCustomLabel("");
      setCustomQty("1");
      setCustomPrice("0");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the row.");
    }
  };

  const exportCsv = () => {
    if (!activeFg) return;
    const lines = [
      ["Description", "Qty", "Unit", "Unit price", "Amount"].join(","),
      ...rows.map((r) =>
        [
          `"${r.label.replace(/"/g, '""')}"`,
          String(r.qty),
          r.unit ?? "",
          String(r.unitPrice),
          (r.qty * r.unitPrice).toFixed(2),
        ].join(","),
      ),
      `"Margin (${markupPct}%)",,,,"${totals.markup.toFixed(2)}"`,
      `"SALES PRICE",,,,"${totals.grand.toFixed(2)}"`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeFg.name.replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Open a print-ready costing sheet in a new window and show the print dialog.
   *  withAmounts=false prints a production-floor sheet: quantities and units only,
   *  no prices, amounts, margin or sales price. */
  const printSheet = (withAmounts: boolean) => {
    if (!activeFg) return;
    const cur = currency;
    const money = (v: number) =>
      withAmounts
        ? `${cur}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "";
    const today = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const codeLine = [
      activeFg.projectCode ? activeFg.projectCode : null,
      activeFg.code ? activeFg.code : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const rowsHtml = rows
      .map(
        (r, i) => `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r.label)}</td>
          <td class="num">${r.qty.toLocaleString()}</td>
          <td class="muted">${escapeHtml(r.unit ?? "—")}</td>
          ${withAmounts ? `<td class="num">${r.unitPrice.toLocaleString()}</td>
          <td class="num strong">${money(r.qty * r.unitPrice)}</td>` : ""}
        </tr>`,
      )
      .join("");
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) {
      toast.error("Allow pop-ups to print the sheet.");
      return;
    }
    win.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${withAmounts ? "Costing sheet" : "Production sheet"} — ${escapeHtml(activeFg.name)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #18181b; margin: 40px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #4f46e5; padding-bottom: 16px; margin-bottom: 8px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .meta { font-size: 12px; color: #52525b; line-height: 1.5; }
    .brand { font-size: 11px; letter-spacing: 3px; color: #4f46e5; font-weight: 700; margin-bottom: 6px; }
    .date { font-size: 12px; color: #52525b; text-align: right; }
    img.photo { width: 72px; height: 72px; object-fit: cover; border-radius: 8px; border: 1px solid #e4e4e7; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px; }
    th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #71717a; border-bottom: 1.5px solid #d4d4d8; padding: 8px 10px; }
    td { border-bottom: 1px solid #e4e4e7; padding: 9px 10px; }
    td.num, th.num { text-align: right; }
    td.strong { font-weight: 600; }
    .muted { color: #71717a; }
    .totals { margin-top: 16px; margin-left: auto; width: 46%; font-size: 13px; }
    .totals td { border: none; padding: 6px 10px; }
    .totals .lbl { text-align: right; color: #52525b; }
    .totals .val { text-align: right; font-variant-numeric: tabular-nums; }
    .totals tr.grand td { border-top: 1.5px solid #4f46e5; font-weight: 700; font-size: 15px; color: #4f46e5; padding-top: 10px; }
    .note { margin-top: 8px; font-size: 12px; color: #71717a; }
    @page { margin: 14mm; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <div class="brand">${withAmounts ? "COSTING SHEET" : "PRODUCTION SHEET"}</div>
      <h1>${escapeHtml(activeFg.name)}</h1>
      <div class="meta">
        Project: ${escapeHtml(activeFg.projectName ?? "Standalone")}${codeLine ? ` &nbsp;·&nbsp; ${escapeHtml(codeLine)}` : ""}<br />
        ${activeFg.unit ? `Sold per: ${escapeHtml(activeFg.unit)}${withAmounts ? ` &nbsp;·&nbsp; Margin: ${markupPct}%` : ""}` : ""}
      </div>
    </div>
    <div style="text-align:right">
      ${activeFg.imageUrl ? `<img class="photo" src="${activeFg.imageUrl}" alt="" />` : ""}
      <div class="date">${today}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr><th class="num">#</th><th>Description</th><th class="num">Qty</th><th>Unit</th>${withAmounts ? `<th class="num">Unit price</th><th class="num">Amount</th>` : ""}</tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  ${withAmounts ? `
  <table class="totals">
    <tr><td class="lbl">Subtotal</td><td class="val">${money(totals.subtotal)}</td></tr>
    <tr><td class="lbl">Margin (${markupPct}%)</td><td class="val">+${money(totals.markup)}</td></tr>
    <tr class="grand"><td class="lbl">Sales price</td><td class="val">${money(totals.grand)}</td></tr>
  </table>` : ""}
  ${activeFg.note ? `<p class="note">${escapeHtml(activeFg.note)}</p>` : ""}
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`);
    win.document.close();
  };

  /** Minimal HTML escaping for interpolated values. */
  function escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return (
    <div>
      {/* ── Production warning: editing a running product asks first ── */}
      {pendingEdit !== null && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>Production is running</strong> — {pendingEdit.label} will change the
            materials this production uses. Continue?
          </span>
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg bg-amber-600 px-3 text-xs text-white hover:bg-amber-700"
            onClick={() => {
              const run = pendingEdit.run;
              setPendingEdit(null);
              void run();
            }}
          >
            Continue
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg px-3 text-xs"
            onClick={() => setPendingEdit(null)}
          >
            Cancel
          </Button>
        </div>
      )}

      {/* ── Open product chip (navigation lives in the sidebar) ──────── */}
      {activeFg && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary">
            <FileSpreadsheet className="size-3.5" />
            {activeFg.name}
            <span className="text-xs font-normal text-primary/70">{activeFg.projectName}</span>
            <button
              type="button"
              aria-label="Close product sheet"
              className="text-primary/60 hover:text-primary"
              onClick={() => onSelectView(null)}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {/* ── Views ────────────────────────────────────────────────────── */}
      {view?.kind === "purchase" && canViewPurchase ? (
        <PurchasePanel
          materials={materials}
          canCreate={canCreatePurchase}
          canEdit={canEditPurchase}
          canDelete={canDeletePurchase}
        />
      ) : view?.kind === "materials" && canViewMaterials ? (
        <div className="mt-4">
          <MaterialsSheet
            materials={materials}
            loading={materials === undefined}
            canCreate={canCreateMaterial}
            canEdit={canEditMaterial}
            canDelete={canDeleteMaterial}
            canImportExport={canImportExport}
            canImport={canImport}
          />
        </div>
      ) : view === null || view?.kind === "projects" ? (
        <div className="mt-4">
          <ProjectsSheet
            finishedGoods={finishedGoods}
            loading={loading}
            onOpenProject={(name) => {
              setProjectFocus(name);
              onSelectView({ kind: "products" });
            }}
            onNewProject={onNewProject}
            onNewProduct={
              canCreate ? (name) => onNewProduct?.(name) : undefined
            }
            onEditProject={canEditProject ? onEditProject : undefined}
            onDeleteProject={
              canDeleteProject ? (p) => onDeleteProject?.(p) : undefined
            }
            onOpenProduct={(fgId) => onSelectView({ kind: "fg", fgId })}
          />
        </div>
      ) : view?.kind === "fg" && activeFg ? (
        <>
          {/* product header */}
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
            {/* product image: thumbnail or add button */}
            {activeFg.imageUrl ? (
              <div className="group/img relative shrink-0">
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  title="Click to enlarge"
                  className="block size-14 overflow-hidden rounded-lg border bg-muted"
                >
                  <img
                    src={activeFg.imageUrl}
                    alt={activeFg.imageAlt ?? activeFg.name}
                    className="size-full object-cover"
                  />
                </button>
                <span className="absolute -right-1.5 -top-1.5 hidden gap-0.5 group-hover/img:flex">
                  <button
                    type="button"
                    aria-label="Replace image"
                    title="Replace image"
                    className="grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-primary"
                    onClick={handlePickImage}
                  >
                    <Pencil className="size-2.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove image"
                    title="Remove image"
                    className="grid size-5 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive"
                    onClick={() => void handleRemoveImage()}
                  >
                    <Trash2 className="size-2.5" />
                  </button>
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={handlePickImage}
                title="Add a product image"
                className="grid size-14 shrink-0 place-items-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                {uploadingImage ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-5" />
                )}
              </button>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageFile}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-semibold">{activeFg.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {activeFg.projectName}
                {activeFg.code ? ` · ${activeFg.code}` : ""}
                {activeFg.unit ? ` · per ${activeFg.unit}` : ""}
              </p>
              {activeFg.note && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{activeFg.note}</p>
              )}
            </div>
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => onEditFg(activeFg)}
              >
                Edit details
              </Button>
            )}
          </div>

          {/* image lightbox */}
          {lightboxOpen && activeFg.imageUrl && (
            <div
              className="fixed inset-0 z-[100] grid place-items-center bg-foreground/60 p-6 backdrop-blur-sm animate-in fade-in duration-150"
              onClick={() => setLightboxOpen(false)}
            >
              <figure className="max-h-full max-w-3xl">
                <img
                  src={activeFg.imageUrl}
                  alt={activeFg.imageAlt ?? activeFg.name}
                  className="max-h-[80vh] max-w-full rounded-xl border bg-card object-contain shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                />
                <figcaption className="mt-2 flex items-center justify-between gap-3 text-xs text-background/90">
                  <span className="truncate">
                    {activeFg.name}
                    {activeFg.imageAlt ? ` — ${activeFg.imageAlt}` : ""}
                  </span>
                  <span className="shrink-0 opacity-70">Click anywhere to close</span>
                </figcaption>
              </figure>
            </div>
          )}

          {/* add-row bars */}
          <div className={cn("mt-3 grid gap-2 md:grid-cols-2", !canCreate && "hidden")}>
            <div className="rounded-xl border bg-card p-3 shadow-sm">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <Package className="size-3.5" />
                Add raw material
              </p>
              <div className="flex gap-1.5">
                <select
                  value={addingMaterialId}
                  onChange={(e) => setAddingMaterialId(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border bg-card px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">Choose material…</option>
                  {materials.map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.code ? `${m.code} · ` : ""}
                      {m.name}
                      {m.category ? ` [${m.category}]` : ""} ({m.pricePerUnit}/{m.unit})
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={materialQty}
                  onChange={(e) => setMaterialQty(e.target.value)}
                  className="h-9 w-20 rounded-lg text-sm"
                  aria-label="Quantity"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-9 rounded-lg"
                  disabled={!addingMaterialId || items === undefined}
                  onClick={addMaterialRowGuarded}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
              {materials.length === 0 && (
                <button
                  type="button"
                  onClick={() => onSelectView({ kind: "materials" })}
                  className="mt-1.5 text-xs text-primary hover:underline"
                >
                  + Add raw materials first (open the Raw materials tab)
                </button>
              )}
            </div>

            <div className="rounded-xl border bg-card p-3 shadow-sm">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <Plus className="size-3.5" />
                Add custom line
              </p>
              <div className="flex gap-1.5">
                <Input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="e.g. Labor, Transport…"
                  className="h-9 min-w-0 flex-1 rounded-lg text-sm"
                />
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={customQty}
                  onChange={(e) => setCustomQty(e.target.value)}
                  className="h-9 w-16 rounded-lg text-sm"
                  aria-label="Quantity"
                />
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  className="h-9 w-20 rounded-lg text-sm"
                  aria-label="Unit price"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 rounded-lg"
                  disabled={items === undefined}
                  onClick={() => guardProduction("Adding a custom line", () => void addCustomRow())}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>

          {/* the spreadsheet */}
          <section className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Description</th>
                    <th className="w-24 px-3 py-2 text-right font-semibold">Qty</th>
                    <th className="w-20 px-3 py-2 font-semibold">Unit</th>
                    <th className="w-28 px-3 py-2 text-right font-semibold">Unit price</th>
                    <th className="w-32 px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="w-10 px-2 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items === undefined ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
                        Loading rows…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        Empty sheet — add a raw material or a custom line above.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => (
                      <tr key={row._id} className="group/row transition-colors hover:bg-accent/40">
                        <td className="px-3 py-1 text-xs text-muted-foreground tabular-nums">
                          {i + 1}
                        </td>
                        <td className="px-3 py-2 font-medium">{row.label}</td>
                        <td className="px-1 py-1">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={drafts.find((d) => d.id === row._id)?.qty ?? row.qty}
                            onChange={(e) =>
                              updateDraft(row._id, { qty: Number(e.target.value) })
                            }
                            className={cn(cellCls, "text-right tabular-nums")}
                            aria-label="Quantity"
                          />
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{row.unit ?? "—"}</td>
                        <td className="px-1 py-1">
                          <span className="block px-2 py-1.5 text-right tabular-nums">
                            {row.unitPrice.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {money(
                            (drafts.find((d) => d.id === row._id)?.qty ?? row.qty) *
                              (drafts.find((d) => d.id === row._id)?.unitPrice ?? row.unitPrice),
                            currency,
                          )}
                        </td>
                        <td className="px-2 py-1 text-center">
                          <span className="hidden gap-0.5 group-hover/row:inline-flex">
                            {canEdit && (
                              <button
                                type="button"
                                aria-label={`Edit ${row.label}`}
                                title="Edit line"
                                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                                onClick={() => editRow(row)}
                              >
                                <Pencil className="size-3.5" />
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                aria-label="Delete row"
                                title="Delete line"
                                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-destructive"
                                onClick={() =>
                                  void removeItem({ id: row._id }).catch(() =>
                                    toast.error("Couldn't delete the row."),
                                  )
                                }
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-border/70 bg-muted/30">
                      <td colSpan={4} className="px-3 py-2 text-right text-xs text-muted-foreground">
                        Subtotal
                      </td>
                      <td colSpan={3} className="px-3 py-2 text-right font-medium tabular-nums">
                        {money(totals.subtotal, currency)}
                      </td>
                    </tr>
                    <tr className="bg-muted/30">
                      <td colSpan={4} className="px-3 py-2 text-right text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          Margin
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={markupPct}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (Number.isFinite(v) && v >= 0 && activeFg) {
                                void updateFg({ id: activeFg._id, markupPct: v }).catch(() =>
                                  toast.error("Couldn't update the margin."),
                                );
                              }
                            }}
                            className="w-14 rounded border bg-card px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
                            aria-label="Margin percent"
                          />
                          %
                        </span>
                      </td>
                      <td colSpan={3} className="px-3 py-2 text-right font-medium tabular-nums">
                        +{money(totals.markup, currency)}
                      </td>
                    </tr>
                    <tr className="border-t border-border/70 bg-primary/5">
                      <td colSpan={4} className="px-3 py-2.5 text-right text-sm font-semibold">
                        <span className="inline-flex items-center gap-1.5">
                          <Sigma className="size-3.5 text-primary" />
                          Sales price
                        </span>
                      </td>
                      <td
                        colSpan={3}
                        className="px-3 py-2.5 text-right font-display text-base font-bold tabular-nums text-primary"
                      >
                        {money(totals.grand, currency)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {rows.length > 0 && (
            <div className="mt-3 flex items-center justify-end gap-2">
              <span
                className={cn(
                  "text-xs transition-opacity",
                  isDirty ? "text-amber-600" : "text-muted-foreground/60 opacity-0",
                )}
              >
                Unsaved changes
              </span>
              <Button
                type="button"
                size="sm"
                className={cn("rounded-lg", isDirty && "animate-pulse")}
                disabled={!isDirty || savingSheet}
                onClick={() => void saveSheet()}
                title="Save all sheet edits (Ctrl/Cmd+S)"
              >
                {savingSheet ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {isDirty ? "Save" : "Saved"}
              </Button>
              <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={exportCsv}>
                <Download className="size-3.5" />
                Export CSV
              </Button>
              {canPrint && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    title="Print this sheet"
                  >
                    <Printer className="size-3.5" />
                    Print
                    <ChevronDown className="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => printSheet(true)}>
                    <Printer className="size-3.5" />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">With amounts</span>
                      <span className="text-[10px] text-muted-foreground">Prices &amp; sales price</span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => printSheet(false)}>
                    <Factory className="size-3.5" />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">Without amounts</span>
                      <span className="text-[10px] text-muted-foreground">Production sheet — qty only</span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              )}
            </div>
          )}
        </>
      ) : loading ? (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="mt-4">
          <ProductForm
            finishedGoods={finishedGoods}
            activeFgId={view?.kind === "fg" ? view.fgId : null}
            onSelectFg={(id) => onSelectView({ kind: "fg", fgId: id })}
            initialProject={view?.kind === "products" ? projectFocus : null}
          />
        </div>
      )}
    </div>
  );
}
