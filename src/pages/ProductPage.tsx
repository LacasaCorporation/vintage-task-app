import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import ProductFormPage from "@/components/ProductFormPage";

/** Where the products list lives, and where a saved product goes back to
 *  by default. Overridden when the URL carries a `from` return address,
 *  which is set whenever the user enters this page from a non-products
 *  context (e.g. the job-project view after a "clone product into job").
 */
const BACK = "/dashboard?section=costing&view=products";

function deriveBackLabel(returnTo: string | undefined): string {
  if (returnTo === undefined) return "Products";
  try {
    const q = returnTo.includes("?")
      ? new URLSearchParams(returnTo.slice(returnTo.indexOf("?") + 1))
      : new URLSearchParams();
    const kind = q.get("view");
    if (kind === null || kind === "products" || kind === "fg")
      return "Products";
    const kindLabels: Record<string, string> = {
      projects: "Projects",
      active: "Active",
      inactive: "Inactive",
      materials: "Materials",
    };
    if (kind in kindLabels) return kindLabels[kind];
    const tab = q.get("tab");
    const area = q.get("area");
    if (kind === "purchase")
      return tab !== null
        ? `Purchase · ${tab.charAt(0).toUpperCase() + tab.slice(1)}`
        : "Purchase";
    if (kind === "sales")
      return tab !== null
        ? `Sales · ${tab.charAt(0).toUpperCase() + tab.slice(1)}`
        : "Sales";
    if (kind === "accounting")
      return tab !== null
        ? `Accounting · ${tab.charAt(0).toUpperCase() + tab.slice(1)}`
        : "Accounting";
    if (kind === "reports")
      return area !== null
        ? `Reports · ${area.charAt(0).toUpperCase() + area.slice(1)}`
        : "Reports";
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  } catch {
    return "Products";
  }
}

/**
 * A product on a page of its own, at `/products/new` or `/products/:id`.
 *
 * It used to be a dialog over the product list. A master record now carries
 * stock levels and a tax rate as well, so it gets the same treatment a raw
 * material and a document already get: its own address, room for every
 * standard field, and a back button that means something.
 */
export default function ProductPage() {
  const params = useParams<{ id?: string }>();
  const [query] = useSearchParams();
  const navigate = useNavigate();

  /** "new" is an address, not an id — left as one it would edit nothing. */
  const id = params.id === undefined || params.id === "new" ? null : params.id;
  const editing = useQuery(
    api.costing.getFinishedGood,
    id !== null ? { id: id as Id<"finishedGoods"> } : "skip",
  );

  const returnTo = query.get("from") ?? undefined;
  const backLabel = deriveBackLabel(returnTo);
  const back = () => navigate(returnTo ?? BACK);

  if (id !== null && editing === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Opening the product…
      </div>
    );
  }

  return (
    <ProductFormPage
      editing={editing ?? null}
      initialProject={query.get("project")}
      backLabel={backLabel}
      onSaved={() => back()}
      onCancel={() => back()}
    />
  );
}
