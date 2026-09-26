import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Check, ImageUp, Loader2, Trash2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { messageFrom } from "@/lib/errors";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Square edge length the stored logo is shrunk to. */
const LOGO_SIZE = 256;
/** Matches the server's cap so an oversized pick fails before the round trip. */
const LOGO_MAX_CHARS = 300_000;

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load that image."));
    img.src = src;
  });
}

/**
 * Turn any picked image into a small square data URL: centre-cropped so the
 * subject survives, drawn at 256px so a 4MB phone photo doesn't end up in the
 * firm's settings row. PNG first because logos rely on transparency; if that is
 * still too big, fall back to JPEG.
 */
async function shrinkToLogo(file: File): Promise<string> {
  const img = await loadImage(await readAsDataURL(file));
  // an SVG with no intrinsic size reports 0 here — nothing to crop from
  if (img.naturalWidth < 1 || img.naturalHeight < 1) {
    throw new Error("That image has no size. Try a PNG or JPEG.");
  }
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_SIZE;
  canvas.height = LOGO_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("Your browser couldn't process that image.");
  ctx.drawImage(
    img,
    (img.naturalWidth - side) / 2,
    (img.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    LOGO_SIZE,
    LOGO_SIZE,
  );
  const png = canvas.toDataURL("image/png");
  if (png.length <= LOGO_MAX_CHARS) return png;
  const jpeg = canvas.toDataURL("image/jpeg", 0.85);
  if (jpeg.length > LOGO_MAX_CHARS) {
    throw new Error("That image is too large. Pick a smaller one.");
  }
  return jpeg;
}

/** The mark shown until a firm uploads its own. */
export function FirmMark({
  logo,
  className,
  markClassName,
}: {
  logo?: string | null;
  className?: string;
  markClassName?: string;
}) {
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        className={cn("rounded-lg object-cover", className)}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm",
        className,
      )}
    >
      <Check className={markClassName ?? "size-4"} strokeWidth={3} />
    </span>
  );
}

/**
 * Settings → Organisation: change the firm's logo. It is stored on the firm, so
 * it is the mark in the app's own header and sidebar for everyone in the firm —
 * and only the person who owns the firm may change it.
 */
export default function FirmLogoPicker({
  logo,
  canEdit,
  isOwner,
}: {
  logo: string | null;
  canEdit: boolean;
  isOwner: boolean;
}) {
  const setLogo = useMutation(api.firms.setLogo);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File) => {
    setBusy(true);
    try {
      const shrunk = await shrinkToLogo(file);
      await setLogo({ logo: shrunk });
      toast.success("Logo updated.");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't change the logo."));
    } finally {
      setBusy(false);
      // let the same file be picked again straight away
      if (input.current !== null) input.current.value = "";
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      await setLogo({});
      toast.success("Logo removed — back to the Slate mark.");
    } catch (error) {
      toast.error(messageFrom(error, "Couldn't remove the logo."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed bg-muted/30 px-3 py-2.5 sm:col-span-2">
      <FirmMark
        logo={logo}
        className="size-10"
        markClassName="size-5"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Firm logo
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {logo
            ? "Shown in the app header and sidebar for everyone in the firm."
            : "Using the Slate mark. Upload a square logo and it replaces it everywhere in the app."}
        </p>
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ImageUp className="size-3.5" />
            )}
            {logo ? "Change logo" : "Upload logo"}
          </Button>
          {logo && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void clear()}
              aria-label="Remove the firm logo"
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          )}
        </div>
      )}
      {canEdit && !isOwner && (
        <p className="w-full text-[11px] text-muted-foreground">
          Only the person who owns this firm can change the logo — ask them if
          you need a different one.
        </p>
      )}
    </div>
  );
}
