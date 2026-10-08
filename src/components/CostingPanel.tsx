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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useWorkspaceCurrency } from "@/lib/useWorkspaceCurrency";
import { blendedRate, cleanRate, priceTaxedLines } from "@/lib/line-tax";

/** Every working area is its own chunk. */ const MaterialsSheet = lazy(() => import("@/components/MaterialsSheet"));
const ProjectsSheet = lazy(() => import("@/components/ProjectsSheet"));
const PurchasePanel = lazy(() => import("@/components/PurchasePanel"));
const SalesPanel = lazy(() => import("@/components/SalesPanel"));
const AccountingPanel = lazy(() => import("@/components/AccountingPanel"));
const ReportsPanel = lazy(() => import("@/components/ReportsPanel"));
const ProductForm = lazy(() => import("@/components/ProductForm"));
const ActivePanel = lazy(() => import("@/components/ActivePanel"));

/** A quiet placeholder for the moment a working area is being fetched. */
function SectionLoading({ label }: { label: string }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      Loading {label}…
    </div>
  );
}

/** A costing line that is not a raw material. Labour and overhead are kept apart because a recipe quotes them separately from the goods that come out of stock — and because labour is very often tax-exempt while freight is not. */
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
    badge: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  },
  {
    kind: "expense",
    label: "Expense",
    hint: "Freight, consumables, power — a cost, not inventory",
    badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  {
    kind: "custom",
    label: "Custom",
    hint: "Whatever does not fit the two above",
    badge: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  },
];

/** A costing sheet line on a finished good, as stored in this view only. */
type ViewLine = {
  id: string;
  kind: CostLineKind | "material" | "overhead";
  key: string;
  code: string;
  name: string;
  rate: number;
  qty: number;
  taxRate: number;
  taxMode: "exclusive" | "inclusive" | "none";
  note: string;
  pos: number;
};

/** A costing line that is not a raw material. Labour and overhead are kept apart because a recipe quotes them separately from the goods that come out of stock — and because labour is very often tax-exempt while freight is not. */
export default function CostingPanel(props: {
  materials?: Doc<"rawMaterials">[];
  finishedGoods?: Doc<"finishedGoods">[];
  loading?: boolean;
  view?: CostingView;
  onSelectView?: (view: CostingView | null) => void;
  onNewProject?: (() => void) | undefined;
  onEditProject?: (doc: Doc<"projects">) => void;
  onDeleteProject?: (doc: Doc<"projects">) => void;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canViewMaterials?: boolean;
  canViewPurchase?: boolean;
  canViewSales?: boolean;
  canViewAccounting?: boolean;
  canCreatePurchase?: boolean;
  canEditPurchase?: boolean;
  canDeletePurchase?: boolean;
  canCreateMaterial?: boolean;
  canEditMaterial?: boolean;
  canDeleteMaterial?: boolean;
  canPrint?: boolean;
  canImportExport?: boolean;
  canImport?: boolean;
  canEditProject?: boolean;
  canDeleteProject?: boolean;
  layout?: "page" | "sheet";
  returnTo?: string;
}) {
  const {
    materials,
    finishedGoods,
    loading,
    view = { kind: "products" },
    onSelectView,
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
    canCreatePurchase = false,
    canEditPurchase = false,
    canDeletePurchase = false,
    canCreateMaterial = false,
    canEditMaterial = false,
    canDeleteMaterial = false,
    canPrint = false,
    canImportExport = false,
    canImport = false,
    canEditProject = false,
    canDeleteProject = false,
    layout = "sheet",
    returnTo,
  } = props;

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="text-muted-foreground">Costing</span>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => {}}>
            {layout === "sheet" ? "Page" : "Sheet"}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-48 flex flex-col border-r border-border/60 bg-muted/30 p-2">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            onClick={() => onSelectView?.({ kind: "products" })}
          >
            Products
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            onClick={() => onSelectView?.({ kind: "materials" })}
          >
            Materials
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            onClick={() => onSelectView?.({ kind: "purchase", tab: "items" })}
          >
            Purchases
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            onClick={() => onSelectView?.({ kind: "sales", tab: "items" })}
          >
            Sales
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            onClick={() => onSelectView?.({ kind: "accounting", tab: "accounts" })}
          >
            Accounting
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            onClick={() => onSelectView?.({ kind: "projects" })}
          >
            Projects
          </button>
        </div>

        <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
          {view?.kind === "products" && (
            <Suspense fallback={<SectionLoading label="products" />}>
              <MaterialsSheet materials={materials ?? []} loading={loading ?? false} />
            </Suspense>
          )}

          {view?.kind === "materials" && (
            <Suspense fallback={<SectionLoading label="materials" />}>
              <MaterialsSheet materials={materials ?? []} loading={loading ?? false} />
            </Suspense>
          )}

          {view?.kind === "purchase" && (
            <Suspense fallback={<SectionLoading label="purchases" />}>
              <PurchasePanel materials={materials ?? []} loading={loading ?? false} canCreate={canCreatePurchase} canEdit={canEditPurchase} canDelete={canDeletePurchase} onTabChange={() => {}} tab="items" />
            </Suspense>
          )}

          {view?.kind === "sales" && (
            <Suspense fallback={<SectionLoading label="sales" />}>
              <SalesPanel materials={materials ?? []} finishedGoods={finishedGoods ?? []} loading={loading ?? false} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} onTabChange={() => {}} tab="items" />
            </Suspense>
          )}

          {view?.kind === "accounting" && (
            <Suspense fallback={<SectionLoading label="accounting" />}>
              <AccountingPanel />
            </Suspense>
          )}

          {view?.kind === "projects" && (
            <Suspense fallback={<SectionLoading label="projects" />}>
              <ProjectsSheet finishedGoods={finishedGoods ?? []} loading={loading ?? false} onOpenProject={onEditProject} onOpenProduct={() => {}} activeFgId={finishedGoods?.[0]?._id ?? null} />
            </Suspense>
          )}

          {view?.kind === "fg" && (
            <Suspense fallback={<SectionLoading label="costing" />}>
              <ProductForm finishedGoods={finishedGoods ?? []} onSelectFg={() => {}} onOpenSheet={() => {}} activeFgId={finishedGoods?.[0]?._id ?? null} product={finishedGoods?.find((p) => p._id === view.fgId) ?? null} />
            </Suspense>
          )}

          {view?.kind === "material" && (
            <Suspense fallback={<SectionLoading label="material" />}>
              <MaterialsSheet materials={materials ?? []} loading={loading ?? false} selectedId={view.materialId} canImport={canImport} canImportExport={canImportExport} canCreate={canCreateMaterial} canEdit={canEditMaterial} canDelete={canDeleteMaterial} onTabChange={() => {}} tab="list" />
            </Suspense>
          )}

          {view?.kind === "project" && (
            <Suspense fallback={<SectionLoading label="project" />}>
              <ProjectsSheet finishedGoods={finishedGoods ?? []} loading={loading ?? false} selectedProjectId={view.projectId} onOpenProject={onEditProject} onOpenProduct={() => {}} activeFgId={finishedGoods?.[0]?._id ?? null} />
            </Suspense>
          )}
        </main>
      </div>
    </div>
  );
}
