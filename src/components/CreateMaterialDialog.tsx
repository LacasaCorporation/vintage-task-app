import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Loader2, PackagePlus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/lib/toast";

const fieldCls =
  "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-primary/30";
/** A real dropdown: a native select needs its own look and padding. */
const selectCls =
  "h-9 w-full cursor-pointer appearance-none rounded-lg border bg-card px-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30";

/**
 * Create a raw material without leaving the costing sheet: the dropdown that
 * offers this hands the new material's id back so it is selected straight
 * away, ready to drop onto a line.
 */
export default function CreateMaterialDialog({
  open,
  initialName,
  onClose,
  onCreated,
}: {
  open: boolean;
  /** The material already being looked for, prefilled as the new name. */
  initialName?: string;
  onClose: () => void;
  onCreated: (materialId: string) => void;
}) {
  const addMaterial = useMutation(api.costing.addMaterial);
  // managed master data, so both dropdowns offer the same values as the rest
  // of the app instead of free text that can drift
  const units = useQuery(api.costing.listUnits) ?? [];
  const categories = useQuery(api.costing.listCategories) ?? [];
  const topCategories = categories.filter((c) => c.parentId === undefined);
  const [name, setName] = useState(initialName ?? "");
  const [code, setCode] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) {
      toast.error("Give the material a name.");
      return;
    }
    const priceNum = Number(price);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      toast.error("Enter a valid price per unit.");
      return;
    }
    setSaving(true);
    try {
      const id = await addMaterial({
        code: code.trim() || undefined,
        name: clean,
        category: category.trim() || undefined,
        unit: unit.trim() || "pcs",
        pricePerUnit: priceNum,
      });
      if (!unit.trim()) toast.info(`No unit chosen — saved as “pcs”.`);
      toast.success(`“${clean}” added to raw materials.`);
      onCreated(id);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Couldn't add the material.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <PackagePlus className="size-4" />
            </span>
            New raw material
          </DialogTitle>
          <DialogDescription className="text-xs">
            Added to the raw-materials list and selected straight away, ready
            to use on this sheet.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Name *</label>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Oak board"
              className={fieldCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Code</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Auto (RM0001)"
                className={fieldCls}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Category"
                className={selectCls}
              >
                <option value="">Not set</option>
                {topCategories.map((c) => (
                  <option key={c._id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Unit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                aria-label="Unit"
                className={selectCls}
              >
                <option value="">Not set</option>
                {units.map((u) => (
                  <option key={u._id} value={u.name}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Price per unit *</label>
              <Input
                type="number"
                min={0}
                step="any"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className={fieldCls}
              />
            </div>
          </div>
          <DialogFooter className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="rounded-lg"
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Add material
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
