import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import ProductFormPage from "@/components/ProductFormPage";

/** Where the products list lives, and where a saved product goes back to. */
const BACK = "/dashboard?section=costing&view=products";

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
      onSaved={() => navigate(BACK)}
      onCancel={() => navigate(BACK)}
    />
  );
}