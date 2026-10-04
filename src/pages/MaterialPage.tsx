import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import MaterialFormPage from "@/components/MaterialFormPage";

/** Where the materials list lives, and where a saved material goes back to. */
const BACK = "/dashboard?section=costing&view=materials";

/**
 * A raw material on a page of its own, at `/materials/new` or `/materials/:id`.
 *
 * It used to be a five-field popup opened from a costing sheet. A master
 * record now carries stock levels and tax rates as well, so it gets the same
 * treatment a document gets: its own address, the back button means something,
 * and it can be linked to directly.
 */
export default function MaterialPage() {
  const params = useParams<{ id?: string }>();
  const [query] = useSearchParams();
  const navigate = useNavigate();

  /** "new" is an address, not an id — left as one it would edit nothing. */
  const id = params.id === undefined || params.id === "new" ? null : params.id;
  const editing = useQuery(
    api.costing.getMaterial,
    id !== null ? { id: id as Id<"rawMaterials"> } : "skip",
  );

  if (id !== null && editing === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Opening the material…
      </div>
    );
  }

  return (
    <MaterialFormPage
      editing={editing ?? null}
      initialName={query.get("name") ?? undefined}
      onDone={() => navigate(BACK)}
    />
  );
}