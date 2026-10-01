import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CreateMaterialDialog from "@/components/CreateMaterialDialog";
import ItemPicker, { type PickerItem } from "@/components/ItemPicker";
import type { CostingView } from "@/components/CostingSidebar";
import {
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Copy,
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
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useAppDialogs } from "@/components/AppDialogs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

/**
 * Every working area is its own chunk.
 *
 * Sales, purchasing, projects, the materials sheet, reports and accounting
 * were all in one file's graph, so opening the costing tab downloaded the lot
 * even when only the products list was wanted. Each one now arrives when its
 * sidebar row is opened, and the sheet beside it stays put while it does.
 */
const MaterialsSheet = lazy(() => import("@/components/MaterialsSheet"));
const ProjectsSheet = lazy(() => import("@/components/ProjectsSheet"));
const PurchasePanel = lazy(() => import("@/components/PurchasePanel"));
const SalesPanel = lazy(() => import("@/components/SalesPanel"));
const AccountingPanel = lazy(() => import("@/components/AccountingPanel"));
const ReportsPanel = lazy(() => import("@/components/ReportsPanel"));
const ProductForm = lazy(() => import("@/components/ProductForm"));
const ActivePanel = lazy(() => import("@/components/ActivePanel"));

/** A quiet placeholder for the moment a working area is being fetched. */
function AreaLoading({ label }: { label: string }) {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      Opening {label}…
    </p>
  );
}

type FgDoc = Doc<"finishedGoods">;
type MaterialDoc = Doc<"rawMaterials">;

const cellCls =
  "w-full bg-transparent px-2 py-1 text-xs outline-none focus:bg-primary/5 focus:ring-2 focus:ring-primary/30 rounded-md";

/** The little chevron between two figures on the summary line. */
function Arrow() {
  return (
    <ChevronRight
      className="size-3 shrink-0 text-muted-foreground/40"
      aria-hidden
    />
  );
}

/** One figure on the thin summary line: a muted label and its value. */
function Figure({
  label,
  children,
  strong,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "text-xs tabular-nums",
          strong ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        {children}
      </span>
    </span>
  );
}

/** Main costing area: raw-materials sheet, product form/list, or FG costing grid. */
export default function CostingPanel({
  materials,
  finishedGoods,
  loading,
  view,
  onSelectView,
  onNewProduct,
  onNewProject,
  onEditProject,
  onDeleteProject,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  canViewMaterials = true,
  canViewPurchase = true,
  canViewSales = true,
  canViewAccounting = true,
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
  canViewSales?: boolean;
  canViewAccounting?: boolean;
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
  /** The product whose costing sheet is open over the current view. */
  const [sheetId, setSheetId] = useState<Id<"finishedGoods"> | null>(null);
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
  const [createMaterialOpen, setCreateMaterialOpen] = useState(false);
  // bumped on every open so the dialog starts with blank fields
  const [createMaterialKey, setCreateMaterialKey] = useState(0);
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

  // the sheet opens either as its own page (view.kind === "fg") or as an
  // overlay on top of whatever list the user was looking at
  const activeFgId = view?.kind === "fg" ? view.fgId : sheetId;
  const activeFg =
    activeFgId === null
      ? null
      : (finishedGoods.find((f) => f._id === activeFgId) ?? null);
  const { format, format: money, code: currencyCode } = useWorkspaceCurrency();
  const markupPct = activeFg?.markupPct ?? 0;

  // keyed on whichever product the sheet is showing, not on the view kind —
  // the sheet also opens as an overlay, where the view is still the list
  const items = useQuery(
    api.costing.listFgItems,
    activeFgId === null ? "skip" : { fgId: activeFgId },
  );
  const rows = useMemo(() => items ?? [], [items]);

  /** Searchable options for the "add a material" picker. */
  const materialOptions = useMemo<PickerItem[]>(
    () =>
      materials.map((m) => ({
        id: m._id,
        label: m.name,
        sub: [m.code, m.category].filter((v) => !!v && v !== "").join(" · ") || undefined,
        hint: `${money(m.pricePerUnit)}/${m.unit}`,
        keywords: `${(m.stock ?? 0).toLocaleString()} ${m.unit} in stock`,
      })),
    [materials, money],
  );

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

  /**
   * The sheet prices ONE product. The batch quantity is deliberately absent
   * here — it is applied on the project line, where the product's cost is
   * multiplied by how many are being made.
   */
  const totals = useMemo(() => {
    const subtotal = rows.reduce((sum, r) => sum + r.qty * r.unitPrice, 0);
    const markup = subtotal * (markupPct / 100);
    return { subtotal, markup, grand: subtotal + markup };
  }, [rows, markupPct]);

  // ── Draft (save-button) logic ─────────────────────────────────────
  // Keep a local draft of every visible row; reset it when the sheet's
  // server data changes shape (rows added/removed or another FG opened).
  const [syncedItems, setSyncedItems] = useState(items);
  if (items !== syncedItems) {
    setSyncedItems(items);
    setDrafts(
      rows.map((r) => ({ id: r._id, label: r.label, qty: r.qty, unitPrice: r.unitPrice })),
    );
  }

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

  /**
   * The one save for this sheet: the product's own record first, then any
   * line edits still sitting in the draft.
   */
  const saveAll = async () => {
    if (!activeFg || savingSheet) return;
    setSavingSheet(true);
    try {
      await updateFg({
        id: activeFg._id,
        name: activeFg.name,
        code: activeFg.code ?? "",
        unit: activeFg.unit ?? "",
        projectName: activeFg.projectName,
        note: activeFg.note,
      });
      for (const r of rows) {
        const d = drafts.find((x) => x.id === r._id);
        if (!d) continue;
        if (d.label === r.label && d.qty === r.qty && d.unitPrice === r.unitPrice) {
          continue;
        }
        await updateItem({ id: r._id, label: d.label, qty: d.qty, unitPrice: d.unitPrice });
      }
      toast.success(`“${activeFg.name}” saved.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save.");
    } finally {
      setSavingSheet(false);
    }
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
      [
        "Description",
        "Qty",
        "Unit",
        `Unit price (${currencyCode})`,
        `Amount (${currencyCode})`,
      ].join(","),
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
    const money = (v: number) => (withAmounts ? format(v) : "");
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
          ${withAmounts ? `<td class="num">${format(r.unitPrice)}</td>
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
            materials this production uses. Stock is adjusted by the difference right
            away, and stopping production returns whatever is left. Continue?
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
        <Suspense fallback={<AreaLoading label="purchasing" />}>
          <PurchasePanel
            materials={materials}
            canCreate={canCreatePurchase}
            canEdit={canEditPurchase}
            canDelete={canDeletePurchase}
          />
        </Suspense>
      ) : view?.kind === "sales" && canViewSales ? (
        <Suspense fallback={<AreaLoading label="sales" />}>
          <SalesPanel
            canCreate={canCreatePurchase}
            canEdit={canEditPurchase}
            canDelete={canDeletePurchase}
          />
        </Suspense>
      ) : view?.kind === "accounting" && canViewAccounting ? (
        <Suspense fallback={<AreaLoading label="accounting" />}>
          <AccountingPanel
            tab={view.tab}
            onTabChange={(tab) => onSelectView({ kind: "accounting", tab })}
          />
        </Suspense>
      ) : view?.kind === "reports" && canViewAccounting ? (
        <Suspense fallback={<AreaLoading label="reports" />}>
          <ReportsPanel />
        </Suspense>
      ) : view?.kind === "active" || view?.kind === "inactive" ? (
        <div className="mt-4">
          <Suspense
            fallback={
              <AreaLoading
                label={view.kind === "active" ? "the Active list" : "the Inactive list"}
              />
            }
          >
            <ActivePanel
              scope={view.kind}
              onSelectView={onSelectView}
            />
          </Suspense>
        </div>
      ) : view?.kind === "materials" && canViewMaterials ? (
        <div className="mt-4">
          <Suspense fallback={<AreaLoading label="the materials sheet" />}>
          <MaterialsSheet
            materials={materials}
            loading={materials === undefined}
            canCreate={canCreateMaterial}
            canEdit={canEditMaterial}
            canDelete={canDeleteMaterial}
            canImportExport={canImportExport}
            canImport={canImport}
          />
          </Suspense>
        </div>
      ) : view === null || view?.kind === "projects" ? (
        <div className="mt-4">
          <Suspense fallback={<AreaLoading label="projects" />}>
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
          </Suspense>
        </div>
      ) : (view?.kind === "fg" || sheetId !== null) && activeFg ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (open) return;
            setSheetId(null);
            if (view?.kind === "fg") onSelectView(null);
          }}
        >
          <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[min(100%,1240px)]">
            <DialogTitle className="sr-only">
              Costing sheet — {activeFg.name}
            </DialogTitle>
        <>
          {/* product header */}
          <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-xl border bg-card px-3 py-2 shadow-sm">
            {/* product image: thumbnail or add button */}
            {activeFg.imageUrl ? (
              <div className="group/img relative shrink-0">
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  title="Click to enlarge"
                  className="block size-10 overflow-hidden rounded-lg border bg-muted"
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
                className="grid size-10 shrink-0 place-items-center rounded-lg border border-dashed bg-muted/40 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
              >
                {uploadingImage ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImagePlus className="size-4" />
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
              <p className="truncate font-display text-sm font-semibold">{activeFg.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">
                {activeFg.projectName}
                {activeFg.code ? ` · ${activeFg.code}` : ""}
                {activeFg.unit ? ` · per ${activeFg.unit}` : ""}
                {activeFg.productionStartedAt !== undefined && " · in production"}
                {activeFg.isCompleted === true && " · finished"}
              </p>
              {activeFg.note && (
                <p className="truncate text-[11px] text-muted-foreground/80">{activeFg.note}</p>
              )}
            </div>
            {/* at-a-glance figures, so the sheet needs no scrolling to read */}
            <dl className="flex shrink-0 items-center gap-3 text-right">
              <div
                title="Finished units on hand, ready to sell. A sales bill takes stock off this."
              >
                <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  Stock
                </dt>
                <dd
                  className={cn(
                    "text-xs font-semibold tabular-nums",
                    (activeFg.stock ?? 0) < 0
                      ? "text-destructive"
                      : (activeFg.stock ?? 0) > 0
                        ? "text-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {(activeFg.stock ?? 0).toLocaleString()}{" "}
                  <span className="font-normal text-muted-foreground">
                    {activeFg.unit ?? "pcs"}
                  </span>
                </dd>
              </div>
              {(activeFg.inProduction ?? 0) > 0 && (
                <div
                  title="Part-made right now — a run has started but not finished"
                >
                  <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
                    In production
                  </dt>
                  <dd className="text-xs font-semibold tabular-nums text-primary">
                    {activeFg.inProduction?.toLocaleString()}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  Sales price
                </dt>
                <dd className="text-sm font-bold tabular-nums text-foreground">
                  {money(totals.grand)}
                </dd>
              </div>
            </dl>
            {canEdit && (
              <>
                <span
                  className={cn(
                    "text-[11px] transition-opacity",
                    isDirty ? "text-amber-600" : "text-muted-foreground/60 opacity-0",
                  )}
                >
                  Unsaved changes
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={savingSheet}
                  onClick={() => void saveAll()}
                  title="Save the product details and any sheet changes (Ctrl/Cmd+S)"
                  className={cn(
                    "h-7 shrink-0 gap-1.5 rounded-lg text-xs",
                    isDirty && "animate-pulse",
                  )}
                >
                  {savingSheet ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Save className="size-3" />
                  )}
                  {savingSheet ? "Saving" : "Save"}
                </Button>
              </>
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

          {/* add-row bar: both kinds of line on one compact row */}
          {canCreate && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border bg-card px-2.5 py-2 shadow-sm">
              <span
                className="flex items-center gap-1 pr-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"
                title="Add a raw material from the master price list"
              >
                <Package className="size-3" />
                Material
              </span>
              <ItemPicker
                className="min-w-[180px] flex-1"
                size="sm"
                items={materialOptions}
                value={addingMaterialId}
                onChange={setAddingMaterialId}
                placeholder="Choose or search material…"
                searchPlaceholder="Search name, code or category…"
                emptyLabel="No material matches that."
                aria-label="Choose a raw material"
                onCreateNew={() => {
                  setCreateMaterialKey((k) => k + 1);
                  setCreateMaterialOpen(true);
                }}
              />
              <Input
                type="number"
                min="0"
                step="any"
                value={materialQty}
                onChange={(e) => setMaterialQty(e.target.value)}
                aria-label="Material quantity"
                className="h-7 w-16 rounded-lg text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="size-7 shrink-0 rounded-lg"
                disabled={!addingMaterialId || items === undefined}
                onClick={addMaterialRowGuarded}
                title="Add this material to the sheet"
              >
                <Plus className="size-3.5" />
              </Button>

              <span className="mx-1 h-4 w-px bg-border" />

              <span
                className="flex items-center gap-1 pr-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"
                title="Add labour, transport, packaging or any other cost"
              >
                <Plus className="size-3" />
                Custom
              </span>
              <Input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="e.g. Labor, Transport…"
                aria-label="Custom line label"
                className="h-7 w-36 rounded-lg text-xs"
              />
              <Input
                type="number"
                min="0"
                step="any"
                value={customQty}
                onChange={(e) => setCustomQty(e.target.value)}
                aria-label="Custom line quantity"
                className="h-7 w-14 rounded-lg text-xs"
              />
              <Input
                type="number"
                min="0"
                step="any"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                aria-label="Custom line unit price"
                className="h-7 w-16 rounded-lg text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="size-7 shrink-0 rounded-lg"
                disabled={items === undefined}
                onClick={() => guardProduction("Adding a custom line", () => void addCustomRow())}
                title="Add this custom line to the sheet"
              >
                <Plus className="size-3.5" />
              </Button>

              {materials.length === 0 && (
                <button
                  type="button"
                  onClick={() => onSelectView({ kind: "materials" })}
                  className="text-[11px] text-primary hover:underline"
                >
                  + Add raw materials first
                </button>
              )}
            </div>
          )}

          {/* the spreadsheet */}
          <section className="mt-2.5 overflow-hidden rounded-2xl border bg-card shadow-sm">
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
                        <td className="px-3 py-1.5">
                          <span className="font-medium">{row.label}</span>
                          {row.materialId !== undefined
                            ? (() => {
                                const m = materials.find((x) => x._id === row.materialId);
                                if (m === undefined) return null;
                                const need =
                                  drafts.find((d) => d.id === row._id)?.qty ?? row.qty;
                                const short = (m.stock ?? 0) < need;
                                return (
                                  <span
                                    className={cn(
                                      "ml-1.5 inline-flex items-center gap-0.5 text-[10px] tabular-nums",
                                      short
                                        ? "text-amber-600 dark:text-amber-400"
                                        : "text-muted-foreground/70",
                                    )}
                                    title={
                                      short
                                        ? `Only ${(m.stock ?? 0).toLocaleString()} ${m.unit} on hand — this batch needs ${need.toLocaleString()}`
                                        : `${(m.stock ?? 0).toLocaleString()} ${m.unit} on hand`
                                    }
                                  >
                                    {short && <AlertTriangle className="size-2.5" />}
                                    {(m.stock ?? 0).toLocaleString()} {m.unit} on hand
                                  </span>
                                );
                              })()
                            : null}
                        </td>
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
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">{row.unit ?? "—"}</td>
                        <td className="px-1 py-1">
                          <span className="block px-2 py-1.5 text-right tabular-nums">
                            {money(row.unitPrice)}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                          {money(
                            (drafts.find((d) => d.id === row._id)?.qty ?? row.qty) *
                              (drafts.find((d) => d.id === row._id)?.unitPrice ?? row.unitPrice),
                          )}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <span
                            className="hidden items-center gap-0.5 group-hover/row:inline-flex"
                            aria-label={`Actions for ${row.label}`}
                          >
                            {canCreate && (
                              <button
                                type="button"
                                aria-label={`Duplicate ${row.label}`}
                                title="Duplicate this line"
                                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                                onClick={() =>
                                  guardProduction("Duplicating a line", () =>
                                    void addFgItem({
                                      fgId: activeFg._id,
                                      label: `${row.label} (copy)`,
                                      qty: row.qty,
                                      unitPrice: row.unitPrice,
                                      ...(row.materialId !== undefined
                                        ? { materialId: row.materialId }
                                        : {}),
                                    }).catch(() =>
                                      toast.error("Couldn't duplicate the line."),
                                    ),
                                  )
                                }
                              >
                                <Copy className="size-3" />
                              </button>
                            )}
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
                      <td colSpan={4} className="px-3 py-1.5 text-right text-xs text-muted-foreground">
                        Lines
                        <span className="ml-1.5 text-[10px] opacity-70">
                          {rows.length} row{rows.length === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td colSpan={3} className="px-3 py-1.5 text-right text-sm font-semibold tabular-nums">
                        {money(totals.subtotal)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {rows.length > 0 && (
            /* ── the summary line: cost → margin → sales price ───────── */
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-muted-foreground">
              <Figure label="Cost" strong>
                {money(totals.subtotal)}
              </Figure>
              <Arrow />
              <Figure label="Margin">
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
                  aria-label="Margin percent"
                  className="w-12 border-b border-transparent bg-transparent px-0.5 text-right text-xs text-muted-foreground tabular-nums outline-none focus:border-primary/60 focus:text-foreground"
                />
                %{" "}
                {money(totals.markup)}
              </Figure>
              <Arrow />
              <Figure label="Sales price" strong>
                {money(totals.grand)}
              </Figure>
              <span className="text-[10px] text-muted-foreground/60">
                per {activeFg.unit ?? "pcs"}
              </span>
            </div>
          )}

          {rows.length > 0 && (
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-lg text-xs"
                onClick={exportCsv}
                title="Export this sheet as CSV"
              >
                <Download className="size-3.5" />
                CSV
              </Button>
              {canPrint && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 rounded-lg text-xs"
                    title="Print this sheet"
                  >
                    <Printer className="size-3" />
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
          </DialogContent>
        </Dialog>
      ) : loading ? (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <div className="mt-4">
          <Suspense fallback={<AreaLoading label="products" />}>
            <ProductForm
              finishedGoods={finishedGoods}
              activeFgId={activeFgId}
              onSelectFg={(id) => onSelectView({ kind: "fg", fgId: id })}
              onOpenSheet={(id) => setSheetId(id)}
              initialProject={view?.kind === "products" ? projectFocus : null}
            />
          </Suspense>
        </div>
      )}

      <CreateMaterialDialog
        key={createMaterialKey}
        open={createMaterialOpen}
        onClose={() => setCreateMaterialOpen(false)}
        onCreated={(id) => setAddingMaterialId(id)}
      />
    </div>
  );
}
