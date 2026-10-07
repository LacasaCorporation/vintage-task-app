import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { ArrowLeft, Boxes, Loader2 } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import CostingPanel from "@/components/CostingPanel";
import { Button } from "@/components/ui/button";

/** Where the products list lives, and where the Back button goes by default. */
const BACK = "/dashboard?section=costing&view=products";

/**
 * A product's costing sheet on a page of its own, at `/costing/:fgId`.
 *
 * This used to be a dialog over the products list. A recipe is a spreadsheet —
 * dozens of lines, a tax rate on each one, the whole set of totals — and a
 * modal caps all three: it scrolls inside a box, the totals are off the
 * bottom, and the browser back button does nothing. A page has room for the
 * sheet, a sticky bar for the actions, and an address worth pasting to a
 * colleague.
 *
 * When the URL carries a `from` query parameter (set whenever the user was
 * viewing a different list before opening the sheet — e.g. the projects view
 * when they "clone product into this job") — every back action (← button,
 * closeSheet, Save-successful redirect on page mode) returns them there
 * instead of forcing the generic products list.
 */
export default function CostingPage() {
  const { fgId } = useParams<{ fgId: string }>();
  const [query] = useSearchParams();
  const navigate = useNavigate();

  const returnTo = query.get("from") ?? undefined;

  const materials = useQuery(api.costing.listMaterials);
  const finishedGoods = useQuery(api.costing.listFinishedGoods);

  const id = fgId as Id<"finishedGoods"> | undefined;
  const known = id !== undefined && (finishedGoods ?? []).some((f) => f._id === id);

  if (materials === undefined || finishedGoods === undefined || id === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Opening the costing sheet…
      </div>
    );
  }

  if (!known) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <Boxes className="size-8 text-muted-foreground/50" />
        <p className="text-sm font-semibold">That product is not here</p>
        <p className="text-xs text-muted-foreground">
          It may have been deleted, or the link may belong to a different
          workspace.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 rounded-lg text-xs"
          onClick={() => navigate(returnTo ?? BACK)}
        >
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
      </div>
    );
  }

  return (
    <CostingPanel
      materials={materials}
      finishedGoods={finishedGoods}
      loading={false}
      view={{ kind: "fg", fgId: id }}
      onSelectView={(next) => {
        if (next === null) navigate(returnTo ?? BACK);
      }}
      layout="page"
      returnTo={returnTo}
    />
  );
}