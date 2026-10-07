import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Loader2, Tag } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import MasterDataManager from "@/components/MasterDataManager";
import { cn } from "@/lib/utils";

type UnitDoc = Doc<"costUnits">;
type CategoryDoc = Doc<"costCategories">;

/**
 * A dedicated, full-page home for the shared master data — units of measure
 * and the category tree behind every product and raw material.
 *
 * It used to live inside the Settings tab. Moving it to its own address gives
 * it room to breathe, a back link that means something, and a URL worth
 * bookmarking for the people who maintain it.
 */
export default function UnitsCategoriesPage() {
  const navigate = useNavigate();
  const units = useQuery(api.costing.listUnits);
  const categories = useQuery(api.costing.listCategories);

  if (units === undefined || categories === undefined) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      {/* ── Breadcrumb ─────────────────────────────────────────────── */}
      <nav
        aria-label="Breadcrumb"
        className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Link
          to="/dashboard"
          className="transition-colors hover:text-foreground"
        >
          Dashboard
        </Link>
        <span aria-hidden>·</span>
        <Link
          to="/dashboard?section=settings"
          className="transition-colors hover:text-foreground"
        >
          Settings
        </Link>
        <span aria-hidden>·</span>
        <span className="text-foreground">Units &amp; categories</span>
      </nav>

      {/* ── Page header ─────────────────────────────────────────────── */}
      <header className="mb-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Tag className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-tight">
              Units &amp; categories
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The shared master data behind every finished-good product and
              raw material. Units form a conversion tree — a base unit has no
              parent, and a derived unit points at what it converts to.
            </p>
          </div>
        </div>
      </header>

      {/* ── Card ────────────────────────────────────────────────────── */}
      <section
        id="settings-catalog"
        className={cn(
          "overflow-hidden rounded-2xl border bg-card shadow-sm",
          // subtle gradient accent on the top edge
          "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px",
          "before:bg-gradient-to-r before:from-primary/40 before:via-primary/10 before:to-transparent",
        )}
      >
        <MasterDataManager
          units={units}
          categories={categories}
          onClose={() => navigate("/dashboard?section=settings")}
          embedded={false}
        />
      </section>

      <footer className="mt-6 text-xs text-muted-foreground">
        <strong>Super user</strong> — full control (created automatically, one
        per workspace). <strong>Admin</strong> — can add users and change roles.
        Use <strong>Roles</strong> to build reusable permission sets, and{" "}
        <strong>Permissions</strong> on a user for individual overrides (they
        layer on top of the assigned role).
      </footer>
    </div>
  );
}