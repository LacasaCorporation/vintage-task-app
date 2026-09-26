import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MaterialImportDialog from "@/components/MaterialImportDialog";
import {
  ChevronDown,
  Download,
  FileSpreadsheet,
  Loader2,
  Package,
  Pencil,
  Plus,
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
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { useAppDialogs } from "@/components/AppDialogs";
import { cn } from "@/lib/utils";

type MaterialDoc = Doc<"rawMaterials">;

const cellCls =
  "w-full bg-transparent px-2 py-1.5 text-sm outline-none focus:bg-primary/5 focus:ring-2 focus:ring-primary/30 rounded-md";

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
  const addMaterial = useMutation(api.costing.addMaterial);
  const updateMaterial = useMutation(api.costing.updateMaterial);
  const removeMaterial = useMutation(api.costing.removeMaterial);

  // managed master data for dropdowns
  const masterUnits = useQuery(api.costing.listUnits);
  const masterCategories = useQuery(api.costing.listCategories);
  const units = masterUnits ?? [];
  const parentCategories = (masterCategories ?? []).filter((c) => c.parentId === undefined);
  const allCategories = masterCategories ?? [];
  const subsOf = (name: string) => {
    const parent = parentCategories.find((c) => c.name === name);
    if (!parent) return [];
    return allCategories.filter((c) => c.parentId === parent._id);
  };
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
    const ok = await confirm({
      title: `Delete “${m.name}”?`,
      message:
        "The material is removed from the master list. Existing costing lines keep their copied values.",
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

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [importOpen, setImportOpen] = useState(false);

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

  const handleAdd = async (e: React.FormEvent) => {
    if (!canCreate) {
      e.preventDefault();
      toast.error("Adding raw materials is restricted for your role.");
      return;
    }
    e.preventDefault();
    const clean = name.trim();
    const priceNum = Number(price);
    if (!clean) {
      toast.error("Give the material a name.");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.error("Enter a valid price per unit.");
      return;
    }
    setSaving(true);
    try {
      await addMaterial({
        code: code.trim() || undefined,
        name: clean,
        category: category.trim() || undefined,
        subCategory: subCategory.trim() || undefined,
        unit: unit.trim() || "pcs",
        pricePerUnit: priceNum,
      });
      setCode("");
      setName("");
      setSubCategory("");
      setPrice("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the material.");
    } finally {
      setSaving(false);
    }
  };

  const exportCsv = () => {
    const lines = [
      ["Code", "Name", "Category", "Sub-category", "Unit", "Price per unit"].join(","),
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
      {/* add material bar — units & categories are managed in Settings */}
      {canCreate && (
      <form
        onSubmit={handleAdd}
        className="rounded-xl border bg-card p-3 shadow-sm"
      >
        <div className="mb-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <Package className="size-3.5" />
            Add raw material
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Auto code (RM0001)"
            aria-label="Material code — leave blank to auto-generate"
            title="Leave blank to auto-generate the next RM code"
            className="h-9 w-32 rounded-lg text-sm"
          />
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Material name, e.g. Teak wood"
            className="h-9 min-w-[150px] flex-1 rounded-lg text-sm"
          />
          <select
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setSubCategory("");
            }}
            aria-label="Category"
            className="h-9 w-32 rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Category…</option>
            {parentCategories.map((c) => (
              <option key={c._id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={subCategory}
            onChange={(e) => setSubCategory(e.target.value)}
            aria-label="Sub-category"
            disabled={!category || subsOf(category).length === 0}
            className="h-9 w-32 rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          >
            <option value="">Sub-category…</option>
            {subsOf(category).map((c) => (
              <option key={c._id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            aria-label="Unit"
            className="h-9 w-20 rounded-lg border bg-card px-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
          >
            <option value="">Unit…</option>
            {units.map((u) => (
              <option key={u._id} value={u.name}>
                {u.name}
              </option>
            ))}
          </select>
          <Input
            type="number"
            min="0"
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Unit price"
            aria-label="Price per unit"
            className="h-9 w-24 rounded-lg text-sm"
          />
          <Button type="submit" size="sm" className="h-9 rounded-lg" disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add
          </Button>
        </div>
      </form>
      )}

      {/* listing sheet */}
      <section className="mt-4 overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <p className="text-sm font-semibold">
            Raw materials
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {rows.length} item{rows.length === 1 ? "" : "s"}
              {categories.length > 0 ? ` · ${categories.length} categories` : ""}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground/60" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code, name…"
                className="w-40 rounded-lg border bg-background py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
              className="rounded-lg border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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
                <th className="w-10 px-3 py-2 font-semibold">#</th>
                <th className="w-24 px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="w-28 px-3 py-2 font-semibold">Category</th>
                <th className="w-28 px-3 py-2 font-semibold">Sub-cat.</th>
                <th className="w-16 px-3 py-2 font-semibold">Unit</th>
                <th className="w-28 px-3 py-2 text-right font-semibold">Unit price</th>
                <th className="w-28 px-3 py-2 text-right font-semibold">Stock</th>
                <th className="w-10 px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
                    Loading materials…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                    {search || categoryFilter !== "all"
                      ? "Nothing matches the current search/filter."
                      : "No raw materials yet — add your first one above."}
                  </td>
                </tr>
              ) : (
                rows.map((m, i) => (
                  <tr key={m._id} className="group/row transition-colors hover:bg-accent/40">
                    <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{m.code ?? "—"}</td>
                    <td className="px-3 py-2 font-medium">{m.name}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{m.category ?? "—"}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{m.subCategory ?? "—"}</td>
                    <td className="px-3 py-2 text-sm text-muted-foreground">{m.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.pricePerUnit.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span
                        className={cn(
                          "font-medium",
                          (m.stock ?? 0) > 0
                            ? "text-foreground"
                            : "text-muted-foreground/60",
                        )}
                        title={`${(m.stock ?? 0).toLocaleString()} ${m.unit} on hand`}
                      >
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-3 text-xs text-muted-foreground">
        This list is the master price list — costing sheets pick materials from here, so prices stay
        consistent across products.
      </p>

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
