import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import MaterialImportDialog from "@/components/MaterialImportDialog";
import CreateMaterialDialog from "@/components/CreateMaterialDialog";
import StockMovementList from "@/components/StockMovementList";
import type { StockRow } from "@/lib/stock-types";
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  Download,
  FileSpreadsheet,
  History,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Scale,
  Search as SearchIcon,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportMaterialTemplate, exportMaterials } from "@/lib/materialImport";
import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "@/lib/toast";
import { useAppDialogs } from "@/components/AppDialogs";
import { cn } from "@/lib/utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";

type MaterialDoc = Doc<"rawMaterials">;

/**
 * The opening-balance view: what each material carried into the books. Saving
 * posts the difference as a correction, so it shows up in the ledger's "In"
 * column and can always be traced back here.
 */
function OpeningBalances({
  rows,
  stockByMaterial,
  canEdit,
}: {
  rows: MaterialDoc[];
  stockByMaterial: Map<Id<"rawMaterials">, StockRow>;
  canEdit: boolean;
}) {
  const setOpening = useMutation(api.stock.setOpening);
  const { format: money } = useWorkspaceCurrency();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Id<"rawMaterials"> | null>(null);

  /** The figure a row shows: what has been typed, or what is already saved. */
  const shownQty = (m: MaterialDoc) => {
    const typed = drafts[m._id];
    if (typed !== undefined) return Number(typed) || 0;
    return stockByMaterial.get(m._id)?.opening ?? 0;
  };
  // the opening is stock you already own, so it is worth money at the same
  // per-unit price every costing sheet uses
  const total = rows.reduce(
    (sum, m) => sum + shownQty(m) * m.pricePerUnit,
    0,
  );

  const save = async (m: MaterialDoc) => {
    const value = Number((drafts[m._id] ?? "").trim());
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter an opening quantity of zero or more.");
      return;
    }
    setSaving(m._id);
    try {
      await setOpening({ materialId: m._id, qty: value });
      setDrafts((d) => {
        const next = { ...d };
        delete next[m._id];
        return next;
      });
      toast.success(`Opening balance set for ${m.name}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't set that opening.",
      );
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <p className="text-sm font-semibold">
          Opening balance
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {rows.length} material{rows.length === 1 ? "" : "s"}
          </span>
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          Nothing matches the current search/filter.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                <th className="w-24 px-3 py-2">Code</th>
                <th className="px-3 py-2">Material</th>
                <th className="w-16 px-3 py-2">Unit</th>
                <th className="w-28 px-3 py-2 text-right">Price / unit</th>
                <th className="w-32 px-3 py-2 text-right">Current balance</th>
                <th className="w-48 px-3 py-2 text-right">Opening qty</th>
                <th className="w-28 px-3 py-2 text-right">Value</th>
                <th className="w-20 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((m) => {
                const current = stockByMaterial.get(m._id)?.balance ?? 0;
                const opening = stockByMaterial.get(m._id)?.opening ?? 0;
                const dirty = drafts[m._id] !== undefined && drafts[m._id] !== "";
                return (
                  <tr key={m._id} className="transition-colors hover:bg-accent/40">
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {m.code ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-medium">{m.name}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">
                      {m.unit}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                      {money(m.pricePerUnit)}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-muted-foreground">
                      {current.toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          disabled={!canEdit}
                          value={drafts[m._id] ?? (opening === 0 ? "" : String(opening))}
                          onChange={(e) =>
                            setDrafts((d) => ({ ...d, [m._id]: e.target.value }))
                          }
                          placeholder="0"
                          aria-label={`Opening quantity for ${m.name}`}
                          className="h-7 w-32 rounded-lg border bg-background px-2 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                        />
                        <span className="text-[11px] text-muted-foreground">
                          {m.unit}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">
                      {shownQty(m) === 0 ? (
                        <span className="text-muted-foreground/50">—</span>
                      ) : (
                        money(shownQty(m) * m.pricePerUnit)
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {canEdit && dirty && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={saving === m._id}
                          onClick={() => void save(m)}
                          className="h-7 rounded-lg px-2 text-xs text-primary"
                        >
                          {saving === m._id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            "Set"
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-border/70 bg-muted/40">
                <td className="px-3 py-2 text-xs font-semibold" colSpan={6}>
                  Total opening stock
                </td>
                <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums">
                  {money(total)}
                </td>
                <td className="px-2 py-1" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border/60 px-4 py-2.5 text-[11px] text-muted-foreground">
        The opening figure is what was already on hand before any bill was
        recorded. Saving it posts the difference so the ledger still explains
        every unit.
      </p>
    </section>
  );
}

/** In-page raw-material listing sheet (Excel-style rows, master price list). */
export default function MaterialsSheet({
  materials,
  loading,
  canCreate = true,
  canEdit = true,
  canDelete = true,
  canImportExport = true,
  canImport = true,
}: {
  materials: MaterialDoc[];
  loading: boolean;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  /** See the Excel menu (import + exports). */
  canImportExport?: boolean;
  /** Actually import rows from a spreadsheet. */
  canImport?: boolean;
}) {
  const { format: money, code: currencyCode } = useWorkspaceCurrency();
  const updateMaterial = useMutation(api.costing.updateMaterial);
  const removeMaterial = useMutation(api.costing.removeMaterial);

  // managed master data for dropdowns
  const masterUnits = useQuery(api.costing.listUnits);
  const masterCategories = useQuery(api.costing.listCategories);
  /** What still depends on each material — recipes, bills and stock. */
  const usageData = useQuery(api.usage.masterUsage);
  const materialUsage = useMemo(
    () => new Map((usageData?.materials ?? []).map((u) => [u.id, u] as const)),
    [usageData],
  );
  const units = masterUnits ?? [];
  const allCategories = masterCategories ?? [];
  const { promptMulti, confirm } = useAppDialogs();

  /** Open the styled edit dialog for one material row. */
  const handleEdit = async (m: MaterialDoc) => {
    const result = await promptMulti({
      title: `Edit “${m.name}”`,
      message: "Update the raw material details.",
      columns: 2,
      confirmLabel: "Save changes",
      fields: [
        { key: "code", label: "Code", initial: m.code ?? "", placeholder: "RM0001" },
        { key: "name", label: "Material name", initial: m.name, required: true },
        {
          key: "category",
          label: "Category",
          initial: m.category ?? "",
          placeholder: "e.g. Wood",
        },
        {
          key: "subCategory",
          label: "Sub-category",
          initial: m.subCategory ?? "",
          placeholder: "e.g. Hardwood",
        },
        { key: "unit", label: "Unit", initial: m.unit, required: true, placeholder: "pcs" },
        {
          key: "price",
          label: "Unit price",
          initial: String(m.pricePerUnit),
          type: "number",
          required: true,
          validate: (v) =>
            v && (Number.isNaN(Number(v)) || Number(v) < 0) ? "Enter a valid price." : null,
        },
      ],
    });
    if (result === null) return;
    const priceNum = Number(result.price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.error("Enter a valid price per unit.");
      return;
    }
    try {
      await updateMaterial({
        id: m._id,
        code: result.code,
        name: result.name,
        category: result.category,
        subCategory: result.subCategory,
        unit: result.unit,
        pricePerUnit: priceNum,
      });
      toast.success("Material updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update the material.");
    }
  };

  const handleDelete = async (m: MaterialDoc) => {
    // a recipe or a purchase bill holds it; its own stock ledger does not,
    // because that goes with the material
    const used = materialUsage.get(m._id);
    const blocked = used?.reasons ?? [];
    if (blocked.length > 0) {
      await confirm({
        title: `“${m.name}” is still in use`,
        message: `It is ${blocked.join(", ")}. Remove it from those documents first, then delete the material.`,
        confirmLabel: "Got it",
        danger: true,
      });
      return;
    }
    const leftovers = used?.notes ?? [];
    const ok = await confirm({
      title: `Delete “${m.name}”?`,
      message:
        leftovers.length > 0
          ? `The material and its stock ledger will be removed — including ${leftovers.join(", ")}. Existing costing lines keep their copied values.`
          : "The material is removed from the master list. Existing costing lines keep their copied values.",
      confirmLabel: "Delete material",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeMaterial({ id: m._id });
      toast.success("Material deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the material.");
    }
  };

  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [importOpen, setImportOpen] = useState(false);
  /** the material whose income / outgoing transactions are open */
  const [openStock, setOpenStock] = useState<Id<"rawMaterials"> | null>(null);
  const [tab, setTab] = useState<"ledger" | "opening">("ledger");
  // the movement report, joined onto the table below by material id
  const stockReport = useQuery(api.stock.report, { limit: 500 });
  const stockByMaterial = useMemo(
    () =>
      new Map((stockReport ?? []).map((row) => [row.materialId, row] as const)),
    [stockReport],
  );

  const categories = useMemo(
    () => Array.from(new Set(materials.map((m) => m.category).filter(Boolean) as string[])).sort(),
    [materials],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials
      .filter((m) => {
        if (categoryFilter !== "all" && (m.category ?? "") !== categoryFilter) return false;
        if (!q) return true;
        return (
          m.name.toLowerCase().includes(q) ||
          (m.code ?? "").toLowerCase().includes(q) ||
          (m.category ?? "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [materials, search, categoryFilter]);

  const exportCsv = () => {
    const lines = [
      [
        "Code",
        "Name",
        "Category",
        "Sub-category",
        "Unit",
        `Price per unit (${currencyCode})`,
      ].join(","),
      ...rows.map((m) =>
        [
          `"${(m.code ?? "").replace(/"/g, '""')}"`,
          `"${m.name.replace(/"/g, '""')}"`,
          `"${(m.category ?? "").replace(/"/g, '""')}"`,
          `"${(m.subCategory ?? "").replace(/"/g, '""')}"`,
          m.unit,
          String(m.pricePerUnit),
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "raw-materials.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* ── Toolbar: + create, the two views, then search & filter ───── */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {canCreate && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setCreateOpen(true)}
              title="New raw material — name, code, unit, price"
              className="h-7 shrink-0 gap-1.5 rounded-lg border-primary/30 bg-primary/[0.06] px-2 text-xs font-medium text-primary transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
            >
              <Plus className="size-3.5" />
              Material
            </Button>
          )}
          <div className="flex items-center gap-1 rounded-xl border bg-card p-1 shadow-sm">
            {(
              [
                ["ledger", "Stock ledger", Layers],
                ["opening", "Opening balance", Scale],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  tab === id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, name…"
              aria-label="Search raw materials"
              className="h-7 w-40 rounded-lg border bg-card pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
            className="h-7 rounded-lg border bg-card px-2 text-xs outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {tab === "opening" ? (
        <OpeningBalances rows={rows} stockByMaterial={stockByMaterial} canEdit={canEdit} />
      ) : (
      /* ── Stock ledger: in, out, balance ─────────────────────────── */
      <section className="mt-2.5 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <p className="text-sm font-semibold">
            Stock ledger
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {rows.length} item{rows.length === 1 ? "" : "s"}
              {categories.length > 0 ? ` · ${categories.length} categories` : ""}
            </span>
          </p>
          <div className="flex items-center gap-1.5">
            {canImportExport && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-7 rounded-lg text-xs">
                  <FileSpreadsheet className="size-3" />
                  Excel
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {canImport && (
                  <>
                    <DropdownMenuItem onClick={() => setImportOpen(true)}>
                      <Sparkles className="size-3.5" />
                      <div className="flex flex-col">
                        <span className="text-xs font-medium">Import from Excel</span>
                        <span className="text-[10px] text-muted-foreground">
                          Bulk entry with a full check report
                        </span>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  onClick={() =>
                    void exportMaterials(
                      materials.map((m) => ({
                        _id: m._id,
                        code: m.code,
                        name: m.name,
                        category: m.category,
                        subCategory: m.subCategory,
                        unit: m.unit,
                        pricePerUnit: m.pricePerUnit,
                      })),
                      units.map((u) => ({ _id: u._id, name: u.name })),
                      allCategories.map((c) => ({ _id: c._id, name: c.name, parentId: c.parentId })),
                    )
                  }
                >
                  <Download className="size-3.5" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">Export to Excel</span>
                    <span className="text-[10px] text-muted-foreground">
                      All {materials.length} materials + reference sheet
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void exportMaterialTemplate(
                      units.map((u) => ({ _id: u._id, name: u.name })),
                      allCategories.map((c) => ({ _id: c._id, name: c.name, parentId: c.parentId })),
                      `RM${String(materials.length + 1).padStart(4, "0")}`,
                    )
                  }
                >
                  <Plus className="size-3.5" />
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">Blank template</span>
                    <span className="text-[10px] text-muted-foreground">
                      Headers, examples &amp; how-to sheet
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={exportCsv}>
                  <Download className="size-3.5" />
                  <span className="text-xs font-medium">Export CSV (visible rows)</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/40 text-left text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                <th className="w-8 px-2 py-2" />
                <th className="w-8 px-3 py-2 font-semibold">#</th>
                <th className="w-24 px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="w-28 px-3 py-2 font-semibold">Category</th>
                <th className="w-16 px-3 py-2 font-semibold">Unit</th>
                <th className="w-28 px-3 py-2 text-right font-semibold">Unit price</th>
                <th className="w-24 px-3 py-2 text-right font-semibold">In</th>
                <th className="w-24 px-3 py-2 text-right font-semibold">Out</th>
                <th className="w-28 px-3 py-2 text-right font-semibold">Balance</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
                    Loading materials…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-12 text-center text-muted-foreground">
                    {search || categoryFilter !== "all"
                      ? "Nothing matches the current search/filter."
                      : "No raw materials yet — add your first one above."}
                  </td>
                </tr>
              ) : (
                rows.map((m, i) => {
                  const stock = stockByMaterial.get(m._id);
                  const open = openStock === m._id;
                  // a material with no recorded movement still has a balance
                  const income = stock?.income ?? 0;
                  const outgoing = stock?.outgoing ?? 0;
                  const opening = stock?.opening ?? 0;
                  // The ledger reads in / out / balance: the opening figure is
                  // folded into what came in, so one number tells the story.
                  const received = opening + income;
                  const issued = outgoing;
                  const movementRow: StockRow = stock ?? {
                    materialId: m._id,
                    name: m.name,
                    code: m.code,
                    unit: m.unit,
                    category: m.category,
                    income: 0,
                    outgoing: 0,
                    balance: m.stock ?? 0,
                    opening: 0,
                    movements: [],
                  };
                  return (
                  <Fragment key={m._id}>
                  <tr
                    className={cn(
                      "group/row transition-colors hover:bg-accent/40",
                      open && "bg-accent/40",
                    )}
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setOpenStock(open ? null : m._id)}
                        aria-expanded={open}
                        title={
                          open
                            ? "Hide transactions"
                            : "Show income and outgoing transactions"
                        }
                        className="grid size-5 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ChevronDown
                          className={cn(
                            "size-3.5 transition-transform",
                            open && "rotate-180",
                          )}
                        />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{m.code ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{m.name}</span>
                        {(materialUsage.get(m._id)?.reasons.length ?? 0) > 0 && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                            title={`In use — ${materialUsage.get(m._id)?.reasons.join(" · ")}`}
                          >
                            <BadgeCheck className="size-3" />
                            In use
                          </span>
                        )}
                        {(materialUsage.get(m._id)?.reasons.length ?? 0) === 0 &&
                          (materialUsage.get(m._id)?.notes.length ?? 0) > 0 && (
                            <span
                              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                              title={`Stock only — ${materialUsage.get(m._id)?.notes.join(" · ")}. No document points at this material, so it can be deleted and its ledger will go with it.`}
                            >
                              <History className="size-3" />
                              Stock only
                            </span>
                          )}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{m.category ?? "—"}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{m.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(m.pricePerUnit)}</td>
                    <td
                      className="px-3 py-2 text-right text-xs tabular-nums text-emerald-600 dark:text-emerald-400"
                      title="Stock received — purchases, returns and the opening figure"
                    >
                      {received === 0 ? "—" : `+${received.toLocaleString()}`}
                    </td>
                    <td
                      className="px-3 py-2 text-right text-xs tabular-nums text-rose-600 dark:text-rose-400"
                      title="Stock issued — consumed by production"
                    >
                      {issued === 0 ? "—" : `−${issued.toLocaleString()}`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span
                        className={cn(
                          "font-medium",
                          (m.stock ?? 0) < 0
                            ? "text-destructive"
                            : (m.stock ?? 0) > 0
                              ? "text-foreground"
                              : "text-muted-foreground/60",
                        )}
                        title={
                          (m.stock ?? 0) < 0
                            ? `Short ${Math.abs(m.stock ?? 0).toLocaleString()} ${m.unit} — top up with a purchase bill`
                            : `${(m.stock ?? 0).toLocaleString()} ${m.unit} on hand`
                        }
                      >
                        {(m.stock ?? 0) < 0 && (
                          <AlertTriangle className="mr-1 inline size-3 align-[-2px]" />
                        )}
                        {(m.stock ?? 0).toLocaleString()}
                      </span>
                      <span className="ml-1 text-[10px] text-muted-foreground">{m.unit}</span>
                    </td>
                    <td className="px-2 py-1 text-center">
                      <span className="hidden gap-0.5 group-hover/row:inline-flex">
                        {canEdit && (
                          <button
                            type="button"
                            aria-label={`Edit ${m.name}`}
                            title="Edit material"
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-primary"
                            onClick={() => void handleEdit(m)}
                          >
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            aria-label={`Delete ${m.name}`}
                            title="Delete material"
                            className="grid size-6 place-items-center rounded-md text-muted-foreground hover:text-destructive"
                            onClick={() => void handleDelete(m)}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={12} className="p-0">
                        <StockMovementList row={movementRow} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        This list is the master price list — costing sheets pick materials from here, so prices stay
        consistent across products.
      </p>

      <CreateMaterialDialog
        key={createOpen ? "open" : "closed"}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {}}
      />

      <MaterialImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        materials={materials}
        units={units}
        categories={allCategories}
      />
    </div>
  );
}
