import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_BRAND,
  THEME_PRESETS,
  applyMixedTheme,
  clearTheme,
  contrastRatio,
  hexToOklch,
  mixTheme,
  oklchCss,
  oklchToHex,
  readStoredBrand,
  storeBrand,
  type Oklch,
} from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Check, Palette, RotateCcw } from "lucide-react";
import { useState } from "react";

const HUE_STEPS = 12;

const startingBrand = () => readStoredBrand() ?? DEFAULT_BRAND;

/**
 * Appearance → the workspace's own colour.
 *
 * One colour drives everything: the accent, its readable ink, the focus ring,
 * the surface ramps and the chart ramp. Every change applies and saves as it is
 * made, so mixing is something you watch happen rather than something you
 * submit — and it stays on this browser only, like the other appearance
 * preferences.
 */
export default function ThemeSettings() {
  const [base, setBase] = useState<Oklch>(() => hexToOklch(startingBrand())!);
  const [hexDraft, setHexDraft] = useState(() => startingBrand().toUpperCase());
  const [hexError, setHexError] = useState(false);

  const mixed = mixTheme(base);
  if (!mixed) return null;

  const picked = oklchToHex(base);
  const onWhite = contrastRatio(mixed.effective, "#ffffff");

  /** Mix and remember a colour, applying it to the whole app immediately. */
  const apply = (next: Oklch, hex = oklchToHex(next)) => {
    const mixedNext = mixTheme(next);
    if (!mixedNext) return;
    setBase(next);
    setHexDraft(hex.toUpperCase());
    setHexError(false);
    applyMixedTheme(mixedNext);
    storeBrand(hex);
  };

  const applyHex = (hex: string) => {
    const next = hexToOklch(hex);
    if (!next) {
      setHexError(true);
      return;
    }
    apply(next, hex.startsWith("#") ? hex.toLowerCase() : `#${hex.toLowerCase()}`);
  };

  const reset = () => {
    clearTheme();
    storeBrand(null);
    setBase(hexToOklch(DEFAULT_BRAND)!);
    setHexDraft(DEFAULT_BRAND.toUpperCase());
    setHexError(false);
  };

  const isDefault = picked.toLowerCase() === DEFAULT_BRAND.toLowerCase();

  return (
    <div className="grid gap-5 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      {/* ── the mixer ───────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-5">
        <div>
          <Label className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Presets
          </Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {THEME_PRESETS.map((preset) => {
              const selected = picked.toLowerCase() === preset.hex.toLowerCase();
              return (
                <button
                  key={preset.hex}
                  type="button"
                  title={preset.label}
                  aria-label={preset.label}
                  aria-pressed={selected}
                  onClick={() => applyHex(preset.hex)}
                  className={cn(
                    "grid size-8 place-items-center rounded-lg border border-black/10 shadow-sm transition-transform hover:scale-110",
                    selected && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                  )}
                  style={{ backgroundColor: preset.hex }}
                >
                  {selected && <Check className="size-4 text-white drop-shadow" />}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <Label className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Mix the hue
            </Label>
            <span className="font-mono text-[11px] text-muted-foreground">
              {Math.round(base.h)}°
            </span>
          </div>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: HUE_STEPS }, (_, i) => {
              const stepHue = (360 / HUE_STEPS) * i;
              const selected = Math.abs(base.h - stepHue) < 360 / HUE_STEPS / 2;
              return (
                <button
                  key={i}
                  type="button"
                  aria-label={`Hue ${Math.round(stepHue)} degrees`}
                  title={`Hue ${Math.round(stepHue)}°`}
                  onClick={() => apply({ ...base, h: stepHue })}
                  className={cn(
                    "h-8 min-w-0 flex-1 rounded-md border border-black/5 transition-transform hover:scale-y-110",
                    selected && "ring-2 ring-primary ring-offset-2 ring-offset-card",
                  )}
                  style={{
                    backgroundColor: oklchCss(base.l, Math.max(base.c, 0.04), stepHue),
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="theme-chroma" className="text-xs">
                Saturation
              </Label>
              <span className="font-mono text-[11px] text-muted-foreground">
                {Math.round(base.c * 100)}%
              </span>
            </div>
            <Slider
              id="theme-chroma"
              className="mt-2"
              min={0}
              max={24}
              step={1}
              value={[Math.round(base.c * 100)]}
              onValueChange={([next]) => apply({ ...base, c: (next ?? 0) / 100 })}
            />
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="theme-lightness" className="text-xs">
                Lightness
              </Label>
              <span className="font-mono text-[11px] text-muted-foreground">
                {Math.round(base.l * 100)}%
              </span>
            </div>
            <Slider
              id="theme-lightness"
              className="mt-2"
              min={4}
              max={100}
              step={1}
              value={[Math.round(base.l * 100)]}
              onValueChange={([next]) => apply({ ...base, l: (next ?? 0) / 100 })}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div className="space-y-1.5">
            <Label htmlFor="theme-picker" className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              Exact colour
            </Label>
            <div className="flex items-center gap-2">
              <input
                id="theme-picker"
                type="color"
                aria-label="Pick the theme colour"
                value={picked}
                onChange={(e) => applyHex(e.target.value)}
                className="size-8 shrink-0 cursor-pointer rounded-lg border bg-transparent p-0.5"
              />
              <Input
                aria-label="Theme colour hex"
                className="h-8 w-28 font-mono text-xs"
                value={hexDraft}
                onChange={(e) => {
                  setHexDraft(e.target.value);
                  const next = hexToOklch(e.target.value);
                  if (next) apply(next, e.target.value);
                  else setHexError(e.target.value.trim().length > 2);
                }}
              />
            </div>
          </div>
          <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
            {hexError
              ? "That isn't a colour — try a hex like #80426E."
              : "Saved on this browser. Surfaces, buttons, focus rings and charts all follow the one colour."}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={reset}
            disabled={isDefault && !readStoredBrand()}
          >
            <RotateCcw className="size-3.5" />
            Reset to plum
          </Button>
        </div>
      </div>

      {/* ── what it looks like ──────────────────────────────────────── */}
      <div className="min-w-0">
        <Label className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Preview
        </Label>
        <div
          className="mt-2 space-y-3 rounded-xl border p-3"
          style={{
            backgroundColor: mixed.light["--background"],
            borderColor: mixed.light["--border"],
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium shadow-sm"
              style={{
                backgroundColor: mixed.light["--primary"],
                color: mixed.light["--primary-foreground"],
              }}
            >
              Primary
            </span>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: mixed.light["--accent"],
                color: mixed.light["--accent-foreground"],
              }}
            >
              Draft
            </span>
            <span
              className="text-xs font-medium underline"
              style={{ color: mixed.light["--primary"] }}
            >
              A link
            </span>
          </div>

          <div
            className="rounded-lg border p-2.5"
            style={{
              backgroundColor: mixed.light["--card"],
              borderColor: mixed.light["--border"],
            }}
          >
            <p
              className="text-xs font-medium"
              style={{ color: mixed.light["--foreground"] }}
            >
              Card heading
            </p>
            <p
              className="mt-0.5 text-[11px]"
              style={{ color: mixed.light["--muted-foreground"] }}
            >
              Muted supporting line
            </p>
          </div>

          <div className="flex h-16 items-end gap-1.5">
            {[1, 2, 3, 4, 5].map((n, i) => (
              <span
                key={n}
                className="min-w-0 flex-1 rounded-t"
                style={{
                  backgroundColor: mixed.light[`--chart-${n}`],
                  height: `${[100, 62, 78, 44, 88][i]}%`,
                }}
              />
            ))}
          </div>
          <p className="text-[11px]" style={{ color: mixed.light["--muted-foreground"] }}>
            The five chart colours rotate off the same hue.
          </p>
        </div>

        <dl className="mt-3 space-y-1 text-[11px] text-muted-foreground">
          <div className="flex justify-between gap-2">
            <dt>Accent used</dt>
            <dd className="font-mono text-foreground">{mixed.effective.toUpperCase()}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Button label on accent</dt>
            <dd
              className={cn(
                "font-mono",
                mixed.contrast >= 4.5 ? "text-foreground" : "text-destructive",
              )}
            >
              {mixed.contrast}:1
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Link on white</dt>
            <dd
              className={cn(
                "font-mono",
                onWhite >= 4.5 ? "text-foreground" : "text-destructive",
              )}
            >
              {onWhite}:1
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {mixed.adjusted
            ? "Your lightness sat outside the readable band, so the accent was mixed to the nearest strength that still passes 4.5:1."
            : isDefault
              ? "This is the colour the workspace ships with."
              : "Kept exactly as picked — it already carries readable text."}
        </p>
        {!isDefault && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-medium text-primary">
            <Palette className="size-3.5" />
            Applied across the workspace
          </p>
        )}
      </div>
    </div>
  );
}
