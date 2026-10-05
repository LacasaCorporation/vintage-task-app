import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ItemPicker, { type PickerItem } from "@/components/ItemPicker";
import type { CostingView } from "@/components/CostingSidebar";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Copy,
  Download,
  Factory,
  FileSpreadsheet,
  ImagePlus,
  Link2,
  Loader2,
  Package,
  Pencil,
  Percent,
  Plus,
  Printer,
  Save,
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import ConnectJobDialog from "@/components/ConnectJobDialog";
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
import { blendedRate, cleanRate, priceTaxedLines } from "@/lib/line-tax";

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

/**
 * A costing line that is not a raw material. Labour and overhead are kept
 * apart because a recipe quotes them separately from the goods that come out
 * of stock — and because labour is very often tax-exempt while freight is not.
 */
type CostLineKind = "labour" | "expense" | "custom";

const COST_KINDS: {
  kind: CostLineKind;
  label: string;
  hint: string;
  /** Tailwind classes for the badge in the grid. */
  badge: string;
}[] = [
  {
    kind: "labour",
    label: "Labour",
    hint: "Wages, piecework, overtime — time put into making this",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    kind: "expense",
    label: "Expense",
    hint: "Freight, power, rent, consumables — money spent to make this",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    kind: "custom",
    label: "Custom",
    hint: "Any other cost that is not a raw material",
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
];

const costKindMeta = (kind: string | undefined) =>
  COST_KINDS.find((k) => k.kind === kind) ?? COST_KINDS[2];
function AreaLoading({ label }: { label: string }) {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      Opening {label}…
    </p>
  );
}

type FgDoc = Doc<"finishedGoods">;
type MaterialDoc = Doc<"rawMaterials">;

/**
 * A cell of the costing line table. Tighter than {@link cellCls}, because a
 * recipe with thirty lines should fit on one screen without shrinking.
 */
const lineCls =
  "h-7 w-full rounded-md bg-transparent px-1.5 text-[11px] outline-none transition-colors focus:bg-primary/5 focus:ring-2 focus:ring-primary/30";

/**
 * One cell of the totals strip: a small label, the figure, and a footnote that
 * says where the figure came from. The strip is the bottom of the page, so it
 * reads as a single line of arithmetic — sub total, tax, cost, margin, price.
 */
function Stat({
  label,
  value,
  hint,
  strong,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 bg-card px-3 py-1.5">
      <div className="text-[9px] leading-tight font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={cn(
          "truncate text-sm leading-tight tabular-nums",
          accent
            ? "font-bold text-primary"
            : strong
              ? "font-semibold text-foreground"
              : "font-medium text-foreground/80",
        )}
      >
        {value}
      </div>
      {hint !== undefined && (
        <div className="truncate text-[10px] leading-tight text-muted-foreground/70">
          {hint}
        </div>
      )}
    </div>
  );
}

/**
 * The “production is running — continue?” prompt.
 *
 * It is rendered inside the costing sheet whenever the sheet is open, because
 * a banner at the top of the page sits behind the sheet's modal: the edit
 * would go through with no prompt ever seen, or look like it silently did
 * nothing.
 */
function ProductionWarning({
  label,
  onContinue,
  onCancel,
}: {
  label: string;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <strong>Production is running</strong> — {label} will change the
        materials this production uses. Stock is adjusted by the difference
        right away, and stopping production returns whatever is left. Continue?
      </span>
      <Button
        type="button"
        size="sm"
        className="h-8 rounded-lg bg-amber-600 px-3 text-xs text-white hover:bg-amber-700"
        onClick={onContinue}
      >
        Continue
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-lg px-3 text-xs"
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
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
  /**
   * "dialog" opens the costing sheet over whatever list is on screen, which is
   * how it has always worked. "page" renders the same sheet on a page of its
   * own, so a recipe with many lines has room and the back button means
   * something.
   */
  layout = "dialog",
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
  layout?: "dialog" | "page";
}) {
  const navigate = useNavigate();
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
  /**
   * Putting this product into a job. A product stands on its own until it is
   * given one, and the job's own totals count it from that moment — so the
   * button lives on the sheet, next to Save, where the product is being worked
   * on.
   */
  const attachToJobM = useMutation(api.costing.attachToJob);
  const allJobs = useQuery(api.jobs.listJobs);
  const [connectOpen, setConnectOpen] = useState(false);
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
  /**
   * Tax on the cost line being added. Left at-1 it has not been touched yet,
   * so the field shows the firm default until the user types their own rate.
   */
  const [customTax, setCustomTax] = useState("-1");
  /** The firm default rate, so an untouched tax box is a choice, not a gap. */
  const defaultTax = useQuery(api.purchases.postingDefaults);
  /**
   * What the new non-material line is: labour, an overhead expense, or a
   * plain custom line. Chosen at the same place the name is typed, so the
   * recipe never mixes a wage into a carton of glue by accident.
   */
  const [customKind, setCustomKind] = useState<CostLineKind>("labour");
  /**
   * Typed amount for a labour/expense line. Left blank the rate is used as
   * entered; once an amount is typed it drives the line and the rate field
   * shows the derived per-unit figure instead of fighting the user.
   */
  /** Unit for a cost line — hours, days, trips, boxes. */
  const [customUnit, setCustomUnit] = useState("");

  /**
   * The cost line being typed, priced exactly as the server will store it, so
   * every figure in the row is the figure the sheet will get. A typed amount
   * wins over the rate and is spread back over the quantity, which is what
   * makes subtotal, tax and total here agree with the saved row.
   */
  const costPreview = useMemo(() => {
    const qty = Number(customQty);
    const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
    const rate = Number(customPrice);
    // subtotal is worked out, never typed: it is simply qty x rate
    const subtotal = safeQty * rate;
    // the tax box opens on the firm's default rate and only follows the user's
    // own once they have typed one
    const typedTax = Number(customTax);
    const taxPct = customTax.trim() === "" || typedTax < 0
      ? cleanRate(defaultTax?.taxPct ?? 0)
      : cleanRate(typedTax);
    const tax = subtotal * (taxPct / 100);
    return {
      qty: safeQty,
      qtyValid: Number.isFinite(qty) && qty > 0,
      rateValid: Number.isFinite(rate) && rate >= 0,
      /** what the sheet stores: the rate exactly as typed */
      unitPrice: rate,
      subtotal: Number.isFinite(subtotal) ? subtotal : 0,
      taxPct,
      tax: Number.isFinite(tax) ? tax : 0,
      total: (Number.isFinite(subtotal) ? subtotal : 0) + (Number.isFinite(tax) ? tax : 0),
    };
  }, [customQty, customPrice, customTax, defaultTax?.taxPct]);

  // Draft state — edits stay local until "Save" is pressed.
  const [drafts, setDrafts] = useState<
    {
      id: Id<"costingItems">;
      label: string;
      qty: number;
      unitPrice: number;
      /** Tax on this line alone — a recipe buys at mixed rates. */
      taxPct: number;
    }[]
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

  // The sheet has its own address now, at `/costing/:fgId`, so anything that
  // used to pop it open over a list sends the user to that page instead. One
  // redirect here covers every entry point in the app at once.
  const sheetRoute = view?.kind === "fg" ? `/costing/${view.fgId}` : null;
  useEffect(() => {
    if (layout === "dialog" && sheetRoute !== null) navigate(sheetRoute);
  }, [layout, sheetRoute, navigate]);

  // the sheet opens either as its own page (view.kind === "fg") or as an
  // overlay on top of whatever list the user was looking at
  const activeFgId = view?.kind === "fg" ? view.fgId : sheetId;
  const activeFg =
    activeFgId === null
      ? null
      : (finishedGoods.find((f) => f._id === activeFgId) ?? null);
  // the sheet renders as a modal over everything else, so anything it needs to
  // show the user has to live inside that modal
  const sheetOpen = (view?.kind === "fg" || sheetId !== null) && activeFg !== null;
  const { format, format: money, code: currencyCode } = useWorkspaceCurrency();
  const markupPct = activeFg?.markupPct ?? 0;

  // keyed on whichever product the sheet is showing, not on the view kind —
  // the sheet also opens as an overlay, where the view is still the list
  const items = useQuery(
    api.costing.listFgItems,
    activeFgId === null ? "skip" : { fgId: activeFgId },
  );
  const rows = useMemo(() => items ?? [], [items]);

  /** The jobs this product already sits in, so the button can say so. */
  const jobNames = useMemo(() => {
    const ids =
      activeFg?.jobIds ??
      (activeFg?.jobId !== undefined ? [activeFg.jobId] : []);
    return ids
      .map((id) => (allJobs ?? []).find((j) => j._id === id)?.name)
      .filter((name): name is string => name !== undefined);
  }, [activeFg, allJobs]);

  /** Every job in the firm, as the connect dialog's options. */
  const jobOptions = useMemo(
    () =>
      (allJobs ?? []).map((j) => ({ _id: j._id, name: j.name, code: j.code })),
    [allJobs],
  );

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

  /**
   * What the picked material will cost on the sheet, shown before it is added
   * so a wrong pick or a wrong quantity is caught here rather than three rows
   * down. Priced the same way the server prices it: the material's own
   * purchase rate, and the line's tax is that rate applied to qty × rate.
   */
  const materialPreview = useMemo(() => {
    const m = materials.find((x) => x._id === addingMaterialId);
    if (m === undefined) return null;
    const qty = Number(materialQty);
    const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 0;
    const rate = m.pricePerUnit;
    const taxPct = cleanRate(m.purchaseTaxPct);
    const amount = safeQty * rate;
    const tax = amount * (taxPct / 100);
    return {
      material: m,
      qty: safeQty,
      qtyValid: Number.isFinite(qty) && qty > 0,
      rate,
      taxPct,
      amount,
      tax,
      total: amount + tax,
      stock: m.stock ?? 0,
      short: (m.stock ?? 0) < safeQty,
    };
  }, [materials, addingMaterialId, materialQty]);

  // Collapse duplicate rows (same description/price/unit/tax/type) once per sheet open.
  useEffect(() => {
    if (!activeFg || items === undefined || items.length < 2) return;
    if (mergedOnceFor.current === activeFg._id) return;
    // kind is part of the identity: a labour line and an expense line that share a
    // name are two different costs, not a duplicate
    const hasDupes =
      new Set(
        items.map(
          (i) =>
            `${i.label}::${i.unitPrice}::${i.unit ?? ""}::${i.taxPct ?? 0}::${i.kind ?? ""}`,
        ),
      ).size !== items.length;
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

  // ── Draft (save-button) logic ─────────────────────────────────────
  // Keep a local draft of every visible row; reset it when the sheet's
  // server data changes shape (rows added/removed or another FG opened).
  const [syncedItems, setSyncedItems] = useState(items);
  if (items !== syncedItems) {
    setSyncedItems(items);
    setDrafts(
      rows.map((r) => ({
        id: r._id,
        label: r.label,
        qty: r.qty,
        unitPrice: r.unitPrice,
        taxPct: r.taxPct ?? 0,
      })),
    );
  }

  const isDirty = useMemo(() => {
    if (drafts.length !== rows.length) return rows.length > 0;
    return rows.some((r) => {
      const d = drafts.find((x) => x.id === r._id);
      return d
        ? d.label !== r.label ||
            d.qty !== r.qty ||
            d.unitPrice !== r.unitPrice ||
            d.taxPct !== (r.taxPct ?? 0)
        : false;
    });
  }, [drafts, rows]);

  const updateDraft = (
    id: Id<"costingItems">,
    patch: Partial<{ label: string; qty: number; unitPrice: number; taxPct: number }>,
  ) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  /** True when a draft line and its stored row differ on anything. */
  const draftChanged = (r: (typeof rows)[number], d: (typeof drafts)[number] | undefined) =>
    d !== undefined &&
    (d.label !== r.label ||
      d.qty !== r.qty ||
      d.unitPrice !== r.unitPrice ||
      d.taxPct !== (r.taxPct ?? 0));

  /**
   * The lines as the user is looking at them right now — stored rows with the
   * unsaved draft folded over them. Everything below prices these, not the
   * stored rows, so a figure on screen is always the figure that will save.
   */
  const pricedRows = useMemo(
    () =>
      rows.map((r) => {
        const d = drafts.find((x) => x.id === r._id);
        return {
          qty: d?.qty ?? r.qty,
          unitPrice: d?.unitPrice ?? r.unitPrice,
          taxPct: d?.taxPct ?? r.taxPct ?? 0,
        };
      }),
    [rows, drafts],
  );

  /**
   * The sheet prices ONE product. The batch quantity is deliberately absent
   * here — it is applied on the project line, where the product's cost is
   * multiplied by how many are being made.
   *
   * Tax is charged per line, the same way a bill is, so a recipe where boards
   * are 18% and glue is 12% totals honestly. Margin is taken on the true cost
   * — what the recipe costs including the tax already paid on it — and the
   * sales price is that cost plus the margin.
   */
  const totals = useMemo(() => {
    const priced = priceTaxedLines(pricedRows, 0);
    const cost = priced.grand;
    const markup = cost * (markupPct / 100);
    // labour and overhead are split out of the same total so the recipe can be
    // read as "materials + labour + expenses" without re-adding the rows
    const byKind = { material: 0, labour: 0, expense: 0, custom: 0 };
    pricedRows.forEach((line, i) => {
      const row = rows[i];
      if (row === undefined) return;
      const bucket =
        row.materialId !== undefined
          ? "material"
          : row.kind === "labour" || row.kind === "expense" || row.kind === "custom"
            ? row.kind
            : "custom";
      byKind[bucket] += line.qty * line.unitPrice * (1 + cleanRate(line.taxPct) / 100);
    });
    return {
      subtotal: priced.subtotal,
      tax: priced.tax,
      cost,
      markup,
      grand: cost + markup,
      blendedTax: blendedRate(priced.net, priced.tax),
      materials: byKind.material,
      labour: byKind.labour,
      expenses: byKind.expense,
      other: byKind.custom,
    };
  }, [pricedRows, markupPct, rows]);

  /**
   * What the sheet is trying to tell the user before they save it: a line
   * priced at nothing, a material whose own tax rate was quietly dropped, a
   * batch that eats more of a material than is in stock. Warnings block
   * nothing — they are read, then acted on.
   */
  const warnings = useMemo(() => {
    const out: { id: string; text: string; note?: boolean }[] = [];
    pricedRows.forEach((line, i) => {
      const row = rows[i];
      if (row === undefined) return;
      const material =
        row.materialId !== undefined
          ? materials.find((x) => x._id === row.materialId)
          : undefined;
      const rate = cleanRate(line.taxPct);
      if (line.qty > 0 && line.unitPrice === 0) {
        out.push({
          id: `price-${row._id}`,
          text: `“${row.label}” has no unit price`,
        });
      }
      if (rate === 0) {
        const materialTax = material?.purchaseTaxPct ?? 0;
        if (materialTax > 0) {
          out.push({
            id: `tax-${row._id}`,
            text: `“${row.label}” is at 0% but ${material?.name ?? "the material"} carries ${materialTax}%`,
          });
        } else if (material === undefined) {
          out.push({
            id: `taxc-${row._id}`,
            text: `“${row.label}” has no tax rate — labour is often exempt`,
            note: true,
          });
        }
      }
      if (material !== undefined && (material.stock ?? 0) < line.qty) {
        out.push({
          id: `stock-${row._id}`,
          text: `Only ${(material.stock ?? 0).toLocaleString()} ${material.unit ?? ""} of ${row.label} on hand — this needs ${line.qty.toLocaleString()}`,
        });
      }
    });
    return out;
  }, [pricedRows, rows, materials]);

  const saveSheet = async () => {
    if (!activeFg) return;
    const run = async () => {
      setSavingSheet(true);
      try {
        for (const r of rows) {
          const d = drafts.find((x) => x.id === r._id);
          if (!d) continue;
          if (draftChanged(r, d)) {
            await updateItem({
              id: r._id,
              label: d.label,
              qty: d.qty,
              unitPrice: d.unitPrice,
              taxPct: d.taxPct,
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
        if (!draftChanged(r, d)) continue;
        await updateItem({
          id: r._id,
          label: d.label,
          qty: d.qty,
          unitPrice: d.unitPrice,
          taxPct: d.taxPct,
        });
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
  const handleEditRow = async (row: {
    _id: Id<"costingItems">;
    label: string;
    qty: number;
    unitPrice: number;
    taxPct?: number;
    kind?: string;
  }) => {
    if (!activeFg) return;
    const result = await promptMulti({
      title: `Edit line — ${row.label}`,
      message: "Change the description, quantity, unit price or tax.",
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
        {
          key: "tax",
          label: "Tax %",
          initial: String(row.taxPct ?? 0),
          type: "number",
          required: true,
        },
      ],
    });
    if (result === null) return;
    const qty = Number(result.qty);
    const price = Number(result.price);
    const tax = Number(result.tax);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Price can't be negative.");
      return;
    }
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      toast.error("Tax must be between 0 and 100.");
      return;
    }
    try {
      await updateItem({
        id: row._id,
        label: result.label,
        qty,
        unitPrice: price,
        taxPct: tax,
      });
      toast.success("Line updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the line.");
    }
  };
  const editRow = (
    row: {
      _id: Id<"costingItems">;
      label: string;
      qty: number;
      unitPrice: number;
      taxPct?: number;
      kind?: string;
    },
  ) => guardProduction("Editing a line", () => void handleEditRow(row));

  /** Reclassify a cost line as labour / expense / custom, straight from its badge. */
  const setRowKind = async (row: { _id: Id<"costingItems"> }, kind: CostLineKind) => {
    const run = async () => {
      try {
        await updateItem({ id: row._id, kind });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't change the cost type.",
        );
      }
    };
    if (activeFg?.productionStartedAt !== undefined) {
      setPendingEdit({ label: "Changing the cost type", run });
      return;
    }
    await run();
  };

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
    // the rate is the only thing typed; subtotal and tax are worked out from it
    const rate = Number(customPrice);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Quantity must be greater than zero.");
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      toast.error("Rate can't be negative.");
      return;
    }
    try {
      await addFgItem({
        fgId: activeFg._id,
        label: customLabel.trim() || COST_KINDS.find((k) => k.kind === customKind)!.label,
        qty,
        // the sheet stores a rate, never a total
        unitPrice: rate,
        // an untouched tax box saves the firm default, not a silent zero
        taxPct: costPreview.taxPct,
        kind: customKind,
        unit: customUnit.trim() || undefined,
      });
      setCustomLabel("");
      setCustomQty("1");
      setCustomPrice("0");
      setCustomUnit("");
      // back to "follow the firm default" for the next line
      setCustomTax("-1");
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
        "Tax %",
        `Amount (${currencyCode})`,
        `Tax (${currencyCode})`,
        `Total (${currencyCode})`,
        "Type",
      ].join(","),
      ...pricedRows.map((l, i) => {
        const r = rows[i];
        const amount = l.qty * l.unitPrice;
        const tax = amount * (cleanRate(l.taxPct) / 100);
        return [
          `"${(r?.label ?? "").replace(/"/g, '""')}"`,
          String(l.qty),
          r?.unit ?? "",
          l.unitPrice.toFixed(2),
          String(cleanRate(l.taxPct)),
          amount.toFixed(2),
          tax.toFixed(2),
          (amount + tax).toFixed(2),
          // a raw material is left blank; labour/expense say what they are
          r?.materialId === undefined && r?.kind !== undefined
            ? costKindMeta(r.kind).label
            : "",
        ].join(",");
      }),
      `"Sub total",,,,,,,,"${totals.subtotal.toFixed(2)}",`,
      `"Total tax",,,,,,,,"${totals.tax.toFixed(2)}",`,
      `"Total cost",,,,,,,,"${totals.cost.toFixed(2)}",`,
      `"Margin (${markupPct}%)",,,,,,,,"${totals.markup.toFixed(2)}",`,
      `"SALES PRICE",,,,,,,,"${totals.grand.toFixed(2)}",`,
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
    const rowsHtml = pricedRows
      .map((l, i) => {
        const r = rows[i];
        const amount = l.qty * l.unitPrice;
        const tax = amount * (cleanRate(l.taxPct) / 100);
        return `
        <tr>
          <td class="num">${i + 1}</td>
          <td>${escapeHtml(r?.label ?? "")}</td>
          <td class="num">${l.qty.toLocaleString()}</td>
          <td class="muted">${escapeHtml(r?.unit ?? "—")}</td>
          <td class="muted">${
            r?.materialId === undefined && r?.kind !== undefined
              ? escapeHtml(costKindMeta(r.kind).label)
              : ""
          }</td>
          ${withAmounts ? `<td class="num">${format(l.unitPrice)}</td>
          <td class="num">${cleanRate(l.taxPct)}%</td>
          <td class="num">${format(amount)}</td>
          <td class="num muted">${format(tax)}</td>
          <td class="num strong">${format(amount + tax)}</td>` : ""}
        </tr>`;
      })
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
      <tr><th class="num">#</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th>Type</th>${withAmounts ? `<th class="num">Unit price</th><th class="num">Tax %</th><th class="num">Amount</th><th class="num">Tax</th><th class="num">Total</th>` : ""}</tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  ${withAmounts ? `
  <table class="totals">
    <tr><td class="lbl">Sub total</td><td class="val">${money(totals.subtotal)}</td></tr>
    <tr><td class="lbl">Tax amount</td><td class="val">${money(totals.tax)}</td></tr>
    <tr><td class="lbl">Total cost</td><td class="val">${money(totals.cost)}</td></tr>
    <tr><td class="lbl">Margin (${markupPct}%)</td><td class="val">+${money(totals.markup)}</td></tr>
    <tr class="grand"><td class="lbl">Sales price</td><td class="val">${money(totals.grand)}</td></tr>
    ${
      totals.labour > 0 || totals.expenses > 0 || totals.other > 0
        ? `<tr><td class="lbl">of which materials</td><td class="val">${money(totals.materials)}</td></tr>
    <tr><td class="lbl">of which labour</td><td class="val">${money(totals.labour)}</td></tr>
    <tr><td class="lbl">of which expenses</td><td class="val">${money(totals.expenses)}</td></tr>`
        : ""
    }
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

  /**
   * The sheet's own actions — dirty marker, "put into a job", save.
   *
   * A dialog puts them in the product header; a page puts them in the sticky
   * bar instead, so they stay in reach however long the recipe is. One value,
   * two homes, so the two can never drift apart.
   */
  const sheetActions = (
    <>
      <span
        className={cn(
          "text-[11px] whitespace-nowrap transition-opacity",
          isDirty ? "text-amber-600" : "text-muted-foreground/60 opacity-0",
        )}
      >
        Unsaved changes
      </span>
      {canEdit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConnectOpen(true)}
          title="Put this product into a job — the job's cost and sales value then include it"
          className="h-7 shrink-0 gap-1.5 rounded-lg text-xs"
        >
          <Link2 className="size-3" />
          Put into a job
        </Button>
      )}
      {canEdit && (
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
      )}
    </>
  );

  /**
   * Where the sheet is a page, closing it means going back to the products
   * list; as a dialog it means dismissing the overlay.
   */
  const closeSheet = () => {
    if (layout === "page") {
      navigate("/dashboard?section=costing&view=products");
      return;
    }
    setSheetId(null);
    if (view?.kind === "fg") onSelectView(null);
  };

  /**
   * The costing sheet itself — the header, the add-row bar, the line table and
   * the totals.
   *
   * Kept as one value rather than written out twice, because it is rendered
   * two ways: over the products list as a dialog, and on `/costing/:fgId` as
   * a page with room for a long recipe. Both take the same body, so the two
   * can never drift apart.
   */
  const sheetBody = activeFg ? (
        <>
          {pendingEdit !== null && (
            <ProductionWarning
              label={pendingEdit.label}
              onContinue={() => {
                const run = pendingEdit.run;
                setPendingEdit(null);
                void run();
              }}
              onCancel={() => setPendingEdit(null)}
            />
          )}
          {/* product header */}
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5 rounded-xl border bg-card px-2.5 py-1.5 shadow-sm">
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
                {jobNames.length > 0 && ` · in ${jobNames.join(", ")}`}
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
            {layout === "dialog" && sheetActions}
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

          {/* add-row bars: labour/expenses on their own line above the material
              picker, so the two kinds of line never share one crowded row */}
          {canCreate && (
            <div className="mt-1.5 flex flex-col gap-px overflow-hidden rounded-xl border bg-card shadow-sm">
              {/* cost line — labour, expenses and other non-material costs */}
              <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
              <span
                className="flex shrink-0 items-center gap-1 pr-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"
                title="Add labour, transport, packaging or any other cost"
              >
                <Plus className="size-3" />
                Cost
              </span>
              {/* the kind is chosen right where the name is, so labour never
                  lands on a sheet as an anonymous custom line */}
              <div
                className="flex shrink-0 overflow-hidden rounded-lg border"
                role="radiogroup"
                aria-label="Cost type"
              >
                {COST_KINDS.map((k, i) => (
                  <button
                    key={k.kind}
                    type="button"
                    role="radio"
                    aria-checked={customKind === k.kind}
                    title={k.hint}
                    onClick={() => setCustomKind(k.kind)}
                    className={cn(
                      "h-7 px-2 text-[11px] font-medium transition-colors",
                      i > 0 && "border-l",
                      customKind === k.kind
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
              <Input
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder={
                  customKind === "labour"
                    ? "e.g. Cutting, Stitching…"
                    : customKind === "expense"
                      ? "e.g. Freight, Power…"
                      : "e.g. Packaging…"
                }
                aria-label="Cost line name"
                className="h-7 min-w-[10rem] flex-1 rounded-lg text-xs"
              />
              <Input
                type="number"
                min="0"
                step="any"
                value={customQty}
                onChange={(e) => setCustomQty(e.target.value)}
                aria-label="Cost line quantity"
                title="How many — hours, days, trips or units"
                className="h-7 w-14 shrink-0 rounded-lg text-xs"
              />
              <Input
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value)}
                placeholder="Unit"
                aria-label="Cost line unit"
                title="Unit this line is measured in — hrs, days, trips…"
                className="h-7 w-16 shrink-0 rounded-lg text-xs"
              />
              <Input
                type="number"
                min="0"
                step="any"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                aria-label="Cost line rate"
                title="Rate per unit of quantity"
                className="h-7 w-20 shrink-0 rounded-lg text-xs"
              />
              {/* subtotal is qty x rate, worked out here rather than typed, so
                  it can never disagree with the two fields it comes from */}
              <span
                className="flex h-7 w-24 shrink-0 items-center justify-end rounded-lg border border-dashed bg-muted/30 px-2 text-xs text-muted-foreground tabular-nums"
                title="Quantity × rate — worked out for you"
                aria-label="Cost line subtotal"
              >
                {money(costPreview.subtotal)}
              </span>
              <div className="relative shrink-0">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={customTax === "" || Number(customTax) < 0 ? "" : customTax}
                  placeholder={String(costPreview.taxPct)}
                  onChange={(e) => setCustomTax(e.target.value)}
                  onFocus={() => {
                    // first focus adopts the firm default as a real value, so
                    // what is saved is never the placeholder
                    if (customTax === "" || Number(customTax) < 0) {
                      setCustomTax(String(costPreview.taxPct));
                    }
                  }}
                  aria-label="Cost line tax percent"
                  title={`Tax on this line — the firm default is ${costPreview.taxPct}%`}
                  className="h-7 w-14 shrink-0 rounded-lg pr-4 text-xs tabular-nums"
                />
                <Percent
                  className="pointer-events-none absolute top-1/2 right-1 size-2.5 -translate-y-1/2 text-muted-foreground/70"
                  aria-hidden
                />
              </div>
              {/* tax amount and total are worked out of the row, not typed —
                  they are here so the line can be checked before it is added */}
              <span
                className="w-20 shrink-0 pr-1 text-right text-xs text-muted-foreground tabular-nums"
                title="Tax on this subtotal"
              >
                {money(costPreview.tax)}
              </span>
              <span
                className="w-24 shrink-0 pr-1 text-right text-xs font-semibold tabular-nums"
                title="Subtotal + tax — what this line will cost"
              >
                {money(costPreview.total)}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="size-7 shrink-0 rounded-lg"
                disabled={items === undefined || !costPreview.qtyValid || !costPreview.rateValid}
                onClick={() =>
                  guardProduction(
                    `Adding a ${customKind === "custom" ? "custom" : customKind} line`,
                    () => void addCustomRow(),
                  )
                }
                title={`Add this ${customKind === "custom" ? "custom" : customKind} line to the sheet`}
              >
                <Plus className="size-3.5" />
              </Button>
              </div>

              {/* material line — raw materials from the master price list */}
              <div className="flex flex-wrap items-center gap-1 border-t bg-muted/25 px-2 py-1.5">
                <span
                  className="flex shrink-0 items-center gap-1 pr-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"
                  title="Add a raw material from the master price list"
                >
                  <Package className="size-3" />
                  Material
                </span>
                <ItemPicker
                  className="min-w-[170px] flex-1"
                  size="sm"
                  items={materialOptions}
                  value={addingMaterialId}
                  onChange={setAddingMaterialId}
                  placeholder="Choose or search material…"
                  searchPlaceholder="Search name, code or category…"
                  emptyLabel="No material matches that."
                  aria-label="Choose a raw material"
                  onCreateNew={(term) =>
                    navigate(
                      `/materials/new?name=${encodeURIComponent(term.trim())}`,
                    )
                  }
                />
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={materialQty}
                  onChange={(e) => setMaterialQty(e.target.value)}
                  aria-label="Material quantity"
                  className="h-7 w-16 shrink-0 rounded-lg text-xs"
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

                {/* the picked material, priced exactly as it will land on the
                    sheet — caught here rather than after it is added */}
                {materialPreview !== null && (
                  <div
                    className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-primary/25 bg-primary/[0.04] px-2.5 py-1 text-[11px]"
                    aria-live="polite"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-xs font-semibold">
                        {materialPreview.material.name}
                      </span>
                      {materialPreview.material.code && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {materialPreview.material.code}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      Unit{" "}
                      <span className="font-medium text-foreground">
                        {materialPreview.material.unit}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Stock{" "}
                      <span
                        className={cn(
                          "font-medium tabular-nums",
                          materialPreview.short
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-foreground",
                        )}
                        title={
                          materialPreview.short
                            ? `Only ${materialPreview.stock.toLocaleString()} on hand — this line needs ${materialPreview.qty.toLocaleString()}`
                            : `${materialPreview.stock.toLocaleString()} on hand`
                        }
                      >
                        {materialPreview.stock.toLocaleString()}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Qty{" "}
                      <span className="font-medium text-foreground tabular-nums">
                        {materialPreview.qty.toLocaleString()}
                      </span>
                      {!materialPreview.qtyValid && (
                        <span className="text-amber-600 dark:text-amber-400">
                          {" "}
                          — must be more than zero
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      Rate{" "}
                      <span className="font-medium text-foreground tabular-nums">
                        {money(materialPreview.rate)}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Tax{" "}
                      <span className="font-medium text-foreground tabular-nums">
                        {materialPreview.taxPct}% ({money(materialPreview.tax)})
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Amount{" "}
                      <span className="font-medium text-foreground tabular-nums">
                        {money(materialPreview.amount)}
                      </span>
                    </span>
                    <span className="text-foreground">
                      Total{" "}
                      <span className="font-semibold tabular-nums">
                        {money(materialPreview.total)}
                      </span>
                    </span>
                  </div>
                )}

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
            </div>
          )}

          {/* what the sheet is asking to be checked before it is saved */}
          {warnings.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-2.5 py-1 text-[11px] text-amber-800 dark:text-amber-300">
              <span className="flex shrink-0 items-center gap-1 font-semibold">
                <AlertTriangle className="size-3" />
                {warnings.length} to check
              </span>
              {warnings.slice(0, 3).map((w) => (
                <span key={w.id} className="opacity-90">
                  · {w.text}
                </span>
              ))}
              {warnings.length > 3 && (
                <span className="opacity-70">+{warnings.length - 3} more</span>
              )}
            </div>
          )}

          {/* the spreadsheet */}
          <section className="mt-1.5 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-muted/40 text-left text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                    <th className="w-8 px-2 py-1.5 font-semibold">#</th>
                    <th className="px-2 py-1.5 font-semibold">Description</th>
                    <th className="w-[4.25rem] px-2 py-1.5 text-right font-semibold">Qty</th>
                    <th className="w-14 px-2 py-1.5 font-semibold">Unit</th>
                    <th className="w-24 px-2 py-1.5 text-right font-semibold">Rate</th>
                    <th className="w-[4.5rem] px-2 py-1.5 text-right font-semibold">
                      <span className="inline-flex items-center justify-end gap-0.5">
                        <Percent className="size-2.5" aria-hidden />
                        Tax
                      </span>
                    </th>
                    <th className="w-28 px-2 py-1.5 text-right font-semibold">Amount</th>
                    <th className="w-28 px-2 py-1.5 text-right font-semibold">Total</th>
                    <th className="w-9 px-1 py-1.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {items === undefined ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                        <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
                        Loading rows…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                        Empty sheet — add a raw material or a custom line above.
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => {
                      // the numbers on screen are the drafts, so an unsaved
                      // edit already shows in the amount, the tax and the total
                      const d = drafts.find((x) => x.id === row._id);
                      const qty = d?.qty ?? row.qty;
                      const rate = d?.unitPrice ?? row.unitPrice;
                      const taxPct = d?.taxPct ?? row.taxPct ?? 0;
                      const amount = qty * rate;
                      const lineTax = amount * (cleanRate(taxPct) / 100);
                      const material =
                        row.materialId !== undefined
                          ? materials.find((x) => x._id === row.materialId)
                          : undefined;
                      // labour/expense lines are badged so the recipe reads as
                      // "materials + labour + overhead" at a glance
                      const kindMeta =
                        row.materialId === undefined && row.kind !== undefined
                          ? costKindMeta(row.kind)
                          : null;
                      const short =
                        material !== undefined && (material.stock ?? 0) < qty;
                      return (
                        <tr
                          key={row._id}
                          className={cn(
                            "group/row transition-colors hover:bg-accent/40",
                            rate === 0 || (taxPct === 0 && amount > 0)
                              ? "bg-amber-500/[0.04]"
                              : undefined,
                          )}
                        >
                          <td className="px-2 py-1 align-top text-[11px] text-muted-foreground tabular-nums">
                            {i + 1}
                          </td>
                          <td className="max-w-0 px-2 py-1 align-top">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-medium">
                                {row.label}
                              </span>
                              {kindMeta !== null && canEdit && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className={cn(
                                        "shrink-0 rounded px-1 py-px text-[9px] font-semibold tracking-wide uppercase transition-opacity hover:opacity-80",
                                        kindMeta.badge,
                                      )}
                                      title={`${kindMeta.hint} — click to change the type`}
                                      aria-label={`Cost type: ${kindMeta.label}. Change it`}
                                    >
                                      {kindMeta.label}
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start" className="w-56">
                                    {COST_KINDS.map((k) => (
                                      <DropdownMenuItem
                                        key={k.kind}
                                        onSelect={() => void setRowKind(row, k.kind)}
                                        className="flex flex-col items-start gap-0.5"
                                      >
                                        <span className="font-medium">{k.label}</span>
                                        <span className="text-[11px] text-muted-foreground">
                                          {k.hint}
                                        </span>
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                              {kindMeta !== null && !canEdit && (
                                <span
                                  className={cn(
                                    "shrink-0 rounded px-1 py-px text-[9px] font-semibold tracking-wide uppercase",
                                    kindMeta.badge,
                                  )}
                                  title={kindMeta.hint}
                                >
                                  {kindMeta.label}
                                </span>
                              )}
                              {material !== undefined && (
                                <span
                                  className={cn(
                                    "inline-flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums",
                                    short
                                      ? "text-amber-600 dark:text-amber-400"
                                      : "text-muted-foreground/70",
                                  )}
                                  title={
                                    short
                                      ? `Only ${(material.stock ?? 0).toLocaleString()} ${material.unit ?? ""} on hand — this batch needs ${qty.toLocaleString()}`
                                      : `${(material.stock ?? 0).toLocaleString()} ${material.unit ?? ""} on hand`
                                  }
                                >
                                  {short && <AlertTriangle className="size-2.5" />}
                                  {(material.stock ?? 0).toLocaleString()}{" "}
                                  {material.unit ?? ""} on hand
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-1 py-1 align-top">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={qty}
                              onChange={(e) =>
                                updateDraft(row._id, { qty: Number(e.target.value) })
                              }
                              className={cn(lineCls, "text-right tabular-nums")}
                              aria-label="Quantity"
                            />
                          </td>
                          <td className="px-2 py-1 align-top text-[11px] text-muted-foreground">
                            {row.unit ?? "—"}
                          </td>
                          <td className="px-1 py-1 align-top">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={rate}
                              onChange={(e) =>
                                updateDraft(row._id, {
                                  unitPrice: Number(e.target.value),
                                })
                              }
                              className={cn(
                                lineCls,
                                "text-right tabular-nums",
                                rate === 0 && "text-amber-600 dark:text-amber-400",
                              )}
                              aria-label="Unit price"
                            />
                          </td>
                          <td className="px-1 py-1 align-top">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="any"
                              value={taxPct}
                              onChange={(e) =>
                                updateDraft(row._id, {
                                  taxPct: cleanRate(Number(e.target.value)),
                                })
                              }
                              title={`Tax on this line — ${cleanRate(taxPct)}% of ${money(amount)} is ${money(lineTax)}`}
                              className={cn(
                                lineCls,
                                "text-right tabular-nums",
                                taxPct === 0 && "text-muted-foreground",
                              )}
                              aria-label="Tax percent"
                            />
                            <div className="pr-1.5 text-right text-[9px] leading-none text-muted-foreground/70 tabular-nums">
                              {money(lineTax)}
                            </div>
                          </td>
                          <td className="px-2 py-1 align-top text-right text-xs font-medium tabular-nums">
                            {money(amount)}
                          </td>
                          <td className="px-2 py-1 align-top text-right text-xs font-semibold tabular-nums">
                            {money(amount + lineTax)}
                          </td>
                          <td className="px-1 py-1 align-top text-right">
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
                                      taxPct: row.taxPct ?? 0,
                                      ...(row.materialId !== undefined
                                        ? { materialId: row.materialId }
                                        : {}),
                                      ...(row.kind !== undefined ? { kind: row.kind } : {}),
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
                      );
                    })
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-border/70 bg-muted/30">
                      <td
                        colSpan={5}
                        className="px-2 py-1 text-right text-[10px] tracking-wider text-muted-foreground uppercase"
                      >
                        Lines
                        <span className="ml-1.5 opacity-70">{rows.length}</span>
                      </td>
                      <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums">
                        {money(totals.tax)}
                      </td>
                      <td className="px-2 py-1 text-right text-xs text-muted-foreground tabular-nums">
                        {money(totals.subtotal)}
                      </td>
                      <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums">
                        {money(totals.cost)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {rows.length > 0 && (
            /* ── totals: sub total → tax → cost → margin → sales price ──
                One strip at the foot of the sheet, so a whole recipe adds up
                without scrolling and without opening anything. */
            <div className="mt-1.5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-sm sm:grid-cols-3 lg:grid-cols-5">
              <Stat
                label="Sub total"
                value={money(totals.subtotal)}
                hint={`${rows.length} line${rows.length === 1 ? "" : "s"} · before tax`}
              />
              <Stat
                label="Tax amount"
                value={money(totals.tax)}
                hint={
                  totals.tax > 0
                    ? `blended ${totals.blendedTax}%`
                    : `no tax on any line · default ${defaultTax?.taxPct ?? 0}%`
                }
                strong={totals.tax > 0}
              />
              <Stat
                label="Total cost"
                value={money(totals.cost)}
                hint="sub total + tax"
                strong
              />
              {/* margin is edited in place, the way it always was */}
              <div className="min-w-0 bg-card px-3 py-1.5">
                <div className="text-[9px] leading-tight font-semibold tracking-widest text-muted-foreground uppercase">
                  Margin
                </div>
                <div className="flex items-baseline gap-0.5">
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
                    className="w-10 border-b border-transparent bg-transparent px-0.5 text-sm font-semibold tabular-nums outline-none focus:border-primary/60"
                  />
                  <span className="text-[11px] text-muted-foreground">%</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                    {money(totals.markup)}
                  </span>
                </div>
                <div className="truncate text-[10px] leading-tight text-muted-foreground/70">
                  on total cost
                </div>
              </div>
              <Stat
                label="Sales price"
                value={money(totals.grand)}
                hint={`per ${activeFg.unit ?? "pcs"}`}
                accent
              />
            </div>
          )}

          {/* the same total, split the way the sheet was entered — materials
              against labour against overhead, so a costing can be reviewed
              without picking through the rows */}
          {rows.length > 0 &&
            (totals.labour > 0 || totals.expenses > 0 || totals.other > 0) && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border bg-card px-3 py-1.5 text-[11px] shadow-sm">
                <span className="text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Cost split
                </span>
                <span className="text-muted-foreground">
                  Materials{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {money(totals.materials)}
                  </span>
                </span>
                {totals.labour > 0 && (
                  <span className="text-muted-foreground">
                    Labour{" "}
                    <span className="font-semibold text-violet-700 tabular-nums dark:text-violet-300">
                      {money(totals.labour)}
                    </span>
                  </span>
                )}
                {totals.expenses > 0 && (
                  <span className="text-muted-foreground">
                    Expenses{" "}
                    <span className="font-semibold text-amber-700 tabular-nums dark:text-amber-300">
                      {money(totals.expenses)}
                    </span>
                  </span>
                )}
                {totals.other > 0 && (
                  <span className="text-muted-foreground">
                    Other{" "}
                    <span className="font-semibold text-sky-700 tabular-nums dark:text-sky-300">
                      {money(totals.other)}
                    </span>
                  </span>
                )}
                <span className="ml-auto text-muted-foreground/80">
                  all figures include that line's tax
                </span>
              </div>
            )}

          {rows.length > 0 && (
            <div className="mt-1.5 flex items-center justify-end gap-1.5">
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
                      <span className="text-[10px] text-muted-foreground">Prices, tax and sales price</span>
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
          {/* putting the product into a job: the dialog closes the sheet's
              own dialog behind it, so it is mounted outside that content */}
          {connectOpen && (
            <ConnectJobDialog
              open
              productName={activeFg.name}
              productUnit={activeFg.unit ?? "pcs"}
              defaultQty={activeFg.qty ?? 1}
              jobs={jobOptions}
              currentJobId={activeFg.jobId}
              onClose={() => setConnectOpen(false)}
              onSubmit={async (jobId, qty) => {
                await attachToJobM({ fgId: activeFg._id, jobId, qty });
                const job = (allJobs ?? []).find((j) => j._id === jobId);
                toast.success(
                  `“${activeFg.name}” put into ${job?.name ?? "the job"} — ${qty} needed.`,
                );
              }}
            />
          )}
        </>
  ) : null;

  return (
    <div>
      {/* ── Production warning: editing a running product asks first ──
          Shown on the page only while the sheet is closed; when the sheet is
          open it renders inside the sheet's modal instead, or it would sit
          behind it and never be seen. */}
      {pendingEdit !== null && !sheetOpen && (
        <ProductionWarning
          label={pendingEdit.label}
          onContinue={() => {
            const run = pendingEdit.run;
            setPendingEdit(null);
            void run();
          }}
          onCancel={() => setPendingEdit(null)}
        />
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
            tab={view.tab}
            onTabChange={(tab) => onSelectView({ kind: "purchase", tab })}
          />
        </Suspense>
      ) : view?.kind === "sales" && canViewSales ? (
        <Suspense fallback={<AreaLoading label="sales" />}>
          <SalesPanel
            canCreate={canCreatePurchase}
            canEdit={canEditPurchase}
            canDelete={canDeletePurchase}
            tab={view.tab}
            onTabChange={(tab) => onSelectView({ kind: "sales", tab })}
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
        layout === "page" ? (
          /* ── the sheet, on a page of its own ───────────────────────
              Everything about one product on one screen: the lines, the
              warnings and the full set of totals, with the actions pinned
              to the top so a long recipe never scrolls them away. */
          <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
              <div className="mx-auto flex h-12 max-w-[1320px] items-center gap-2 px-3">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 gap-1.5 rounded-lg text-xs"
                  onClick={closeSheet}
                >
                  <ArrowLeft className="size-3.5" />
                  Products
                </Button>
                <nav
                  aria-label="Breadcrumb"
                  className="hidden min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex"
                >
                  <button
                    type="button"
                    onClick={closeSheet}
                    className="truncate hover:text-foreground hover:underline"
                  >
                    {activeFg.projectName ?? "Products"}
                  </button>
                  <ChevronRight className="size-3 shrink-0 opacity-50" />
                  <span className="truncate font-medium text-foreground">
                    {activeFg.name}
                  </span>
                </nav>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {sheetActions}
                </div>
              </div>
            </header>
            <main className="mx-auto w-full max-w-[1320px] px-3 py-2">
              {sheetBody}
            </main>
          </div>
        ) : (
          <Dialog open onOpenChange={(open) => !open && closeSheet()}>
            <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[min(100%,1240px)]">
              <DialogTitle className="sr-only">
                Costing sheet — {activeFg.name}
              </DialogTitle>
              {sheetBody}
            </DialogContent>
          </Dialog>
        )
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
              onOpenSheet={(id) => navigate(`/costing/${id}`)}
              initialProject={view?.kind === "products" ? projectFocus : null}
            />
          </Suspense>
        </div>
      )}

    </div>
  );
}
