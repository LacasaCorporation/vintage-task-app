import { useCallback, useEffect, useRef, useState } from "react";

export type PlacedImage = {
  id: string;
  src: string;
  // position of the image box, normalized 0..1 relative to the page
  x: number;
  y: number;
  w: number;
  h: number;
  // crop of the source image, normalized 0..1 (left/top/right/bottom)
  crop: { l: number; t: number; r: number; b: number };
};

export function parseImages(json: string | undefined): PlacedImage[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as PlacedImage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const MAX_IMAGES_PER_PAGE = 12;
const MAX_BYTES = 1_500_000; // keep localStorage/db payloads small

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Couldn't read that image."));
    reader.readAsDataURL(file);
  });
}

/** Shrink large images so data URLs stay reasonable. */
async function normalizeFile(file: File): Promise<string> {
  const raw = await readAsDataURL(file);
  if (raw.length <= MAX_BYTES) return raw;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Couldn't load that image."));
    img.src = raw;
  });
  const scale = Math.min(1, Math.sqrt((MAX_BYTES * 1.4) / raw.length));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return raw;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

type DragState =
  | { kind: "move"; id: string; startX: number; startY: number; ox: number; oy: number }
  | {
      kind: "crop";
      id: string;
      handle: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
      startX: number;
      startY: number;
      crop: PlacedImage["crop"];
    }
  | { kind: "resize"; id: string; handle: "nw" | "ne" | "sw" | "se"; startX: number; startY: number; w: number; h: number; x: number; y: number }
  | null;

type CornerHandle = "nw" | "ne" | "sw" | "se";
type EdgeHandle = "n" | "s" | "e" | "w";

/**
 * Image layer over the page. Click a picture to select it (handles appear);
 * click anywhere else (or Esc) to deselect and return to typing.
 * Handles: corners resize, edges crop, × removes.
 */
export function ImageLayer({
  images,
  onChange,
  active,
  onActiveChange,
}: {
  images: PlacedImage[];
  onChange: (images: PlacedImage[]) => void;
  active: boolean;
  onActiveChange: (active: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const norm = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    ];
  };

  const update = (id: string, patch: Partial<PlacedImage>) => {
    onChange(images.map((img) => (img.id === id ? { ...img, ...patch } : img)));
  };

  const onPointerDown = (
    e: React.PointerEvent,
    img: PlacedImage,
    mode: "move" | "resize" | "crop",
    handle: CornerHandle | EdgeHandle,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const [x, y] = norm(e);
    if (mode === "move") {
      dragRef.current = { kind: "move", id: img.id, startX: x, startY: y, ox: img.x, oy: img.y };
    } else if (mode === "resize") {
      dragRef.current = { kind: "resize", id: img.id, handle: handle as CornerHandle, startX: x, startY: y, w: img.w, h: img.h, x: img.x, y: img.y };
    } else {
      dragRef.current = {
        kind: "crop",
        id: img.id,
        handle: handle as "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se",
        startX: x,
        startY: y,
        crop: { ...img.crop },
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = dragRef.current;
    if (!st) return;
    const [x, y] = norm(e);
    const dx = x - st.startX;
    const dy = y - st.startY;
    if (st.kind === "move") {
      update(st.id, {
        x: Math.min(0.98, Math.max(0, st.ox + dx)),
        y: Math.min(0.98, Math.max(0, st.oy + dy)),
      });
    } else if (st.kind === "resize") {
      let { x: nx, y: ny, w, h } = st;
      if (st.handle.includes("e")) w = Math.min(1 - nx, Math.max(0.06, st.w + dx));
      if (st.handle.includes("s")) h = Math.min(1 - ny, Math.max(0.04, st.h + dy));
      if (st.handle.includes("w")) {
        const right = st.x + st.w;
        nx = Math.min(right - 0.06, Math.max(0, st.x + dx));
        w = right - nx;
      }
      if (st.handle.includes("n")) {
        const bottom = st.y + st.h;
        ny = Math.min(bottom - 0.04, Math.max(0, st.y + dy));
        h = bottom - ny;
      }
      update(st.id, { x: nx, y: ny, w, h });
    } else {
      // crop: pull the dragged edge/corner inward on the SOURCE image
      const c = st.crop;
      update(st.id, {
        crop: {
          l: st.handle.includes("w") ? Math.min(c.r - 0.05, Math.max(0, c.l + dx)) : c.l,
          t: st.handle.includes("n") ? Math.min(c.b - 0.05, Math.max(0, c.t + dy)) : c.t,
          r: st.handle.includes("e") ? Math.max(c.l + 0.05, Math.min(1, c.r + dx)) : c.r,
          b: st.handle.includes("s") ? Math.max(c.t + 0.05, Math.min(1, c.b + dy)) : c.b,
        },
      });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // Esc deselects back to typing mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null);
        onActiveChange(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onActiveChange]);

  const handleImages = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const room = MAX_IMAGES_PER_PAGE - images.length;
      if (room <= 0) {
        onChange(images);
        return;
      }
      const next: PlacedImage[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        if (!file.type.startsWith("image/")) continue;
        try {
          const src = await normalizeFile(file);
          next.push({
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            src,
            x: 0.08 + next.length * 0.04,
            y: 0.3 + next.length * 0.08,
            w: 0.34,
            h: 0.26,
            crop: { l: 0, t: 0, r: 1, b: 1 },
          });
        } catch {
          // skip unreadable files
        }
      }
      if (next.length > 0) {
        onChange([...images, ...next]);
        setSelectedId(next[next.length - 1].id);
        onActiveChange(true);
      }
    },
    [images, onChange, onActiveChange],
  );

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0 z-20"
      style={{
        pointerEvents: active ? "auto" : "none",
        cursor: active ? "default" : undefined,
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onPointerDown={(e) => {
        // clicking the paper around images exits image editing.
        // preventDefault so the click doesn't blur the contentEditable editor.
        if (active) {
          e.preventDefault();
          setSelectedId(null);
          onActiveChange(false);
        }
      }}
      onDragOver={(e) => {
        if (active) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!active) return;
        e.preventDefault();
        void handleImages(e.dataTransfer.files);
      }}
    >
      {images.map((img) => {
        const isSelected = img.id === selectedId;
        return (
          <div
            key={img.id}
            className="group absolute shadow-md"
            style={{
              left: `${img.x * 100}%`,
              top: `${img.y * 100}%`,
              width: `${img.w * 100}%`,
              height: `${img.h * 100}%`,
              cursor: active ? "move" : "pointer",
              pointerEvents: "auto",
              outline: isSelected
                ? "2px solid hsl(var(--primary))"
                : undefined,
              outlineOffset: 2,
              zIndex: isSelected ? 5 : 1,
            }}
            onPointerDown={(e) => {
              e.stopPropagation(); // don't bubble to the deselect-on-paper handler
              // select this image and enter edit mode (drags also move it)
              setSelectedId(img.id);
              onActiveChange(true);
              if (isSelected) {
                onPointerDown(e, img, "move", "se");
              }
            }}
          >
            {/* cropped view */}
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="pointer-events-none size-full rounded-md object-cover select-none"
              style={{
                objectPosition: "center",
                clipPath: `inset(${img.crop.t * 100}% ${(1 - img.crop.r) * 100}% ${(1 - img.crop.b) * 100}% ${img.crop.l * 100}%)`,
                transform: "scale(1.02)",
              }}
            />
            {isSelected && (
              <>
                {/* corner resize handles */}
                {(["nw", "ne", "sw", "se"] as const).map((h) => (
                  <span
                    key={h}
                    role="button"
                    tabIndex={0}
                    aria-label={`Resize image ${h}`}
                    className={cnHandle(h)}
                    style={{ cursor: cursorFor(h) }}
                    onPointerDown={(e) => onPointerDown(e, img, "resize", h)}
                  />
                ))}
                {/* edge crop handles */}
                {(["n", "s", "e", "w"] as const).map((h) => (
                  <span
                    key={h}
                    role="button"
                    tabIndex={0}
                    aria-label={`Crop image ${h}`}
                    title="Drag to crop"
                    className={cnEdge(h)}
                    style={{ cursor: edgeCursor(h) }}
                    onPointerDown={(e) => onPointerDown(e, img, "crop", h)}
                  />
                ))}
                {/* delete */}
                <button
                  type="button"
                  aria-label="Remove image"
                  className="absolute -top-2.5 -right-2.5 z-10 grid size-5 place-items-center rounded-full border bg-card text-xs text-muted-foreground shadow hover:text-destructive"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(images.filter((i) => i.id !== img.id));
                    setSelectedId(null);
                  }}
                >
                  ×
                </button>
              </>
            )}
          </div>
        );
      })}

      {active && (
        <label
          className="absolute top-2 right-2 z-30 flex cursor-pointer items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium shadow-md hover:bg-accent"
          onPointerDown={(e) => e.stopPropagation()}
        >
          + Add image
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void handleImages(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      )}
    </div>
  );
}

/* handle helpers */

function cnHandle(h: CornerHandle) {
  const pos = {
    nw: "-top-1.5 -left-1.5",
    ne: "-top-1.5 -right-1.5",
    sw: "-bottom-1.5 -left-1.5",
    se: "-bottom-1.5 -right-1.5",
  }[h];
  return `absolute ${pos} z-10 size-3.5 rounded-sm border-2 border-white bg-primary shadow`;
}

function cursorFor(h: CornerHandle) {
  return { nw: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", se: "nwse-resize" }[h];
}

function cnEdge(h: EdgeHandle) {
  const pos = {
    n: "-top-1 left-1/2 -translate-x-1/2 h-2.5 w-6",
    s: "-bottom-1 left-1/2 -translate-x-1/2 h-2.5 w-6",
    e: "-right-1 top-1/2 -translate-y-1/2 h-6 w-2.5",
    w: "-left-1 top-1/2 -translate-y-1/2 h-6 w-2.5",
  }[h];
  return `absolute ${pos} z-10 rounded-sm border-2 border-white bg-amber-500 shadow`;
}

function edgeCursor(h: EdgeHandle) {
  return { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" }[h];
}
