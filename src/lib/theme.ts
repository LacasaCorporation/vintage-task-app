/**
 * The app's colour theme — one brand colour mixed into the whole token set.
 *
 * index.css authors the tokens in oklch, so the mixer works in oklch too: from
 * a single base colour we derive the accent, its readable ink, the focus ring,
 * the surface ramps, the five chart colours and the sidebar, by keeping the
 * base hue and scaling chroma. That is what makes any starting colour look
 * deliberate instead of pasted on top of a fixed grey.
 *
 * Nothing here touches the stylesheet: `applyTheme` injects one rule set that
 * overrides the values in index.css, so a reader who never opens Settings keeps
 * exactly the defaults the app ships with.
 */

export type Oklch = { l: number; c: number; h: number };

/** Token name (e.g. "--primary") to CSS value. */
export type ThemeTokens = Record<string, string>;

export type MixedTheme = {
  /** What the reader picked, in oklch. */
  base: Oklch;
  /** The accent actually used in light mode, as hex. */
  effective: string;
  /** True when readability clamped the picked lightness. */
  adjusted: boolean;
  /** Contrast of `--primary-foreground` on `--primary`, light mode. */
  contrast: number;
  light: ThemeTokens;
  dark: ThemeTokens;
};

export const THEME_STORAGE_KEY = "slate.theme.v1";

/** The shipped accent. Keep in step with `--primary` in index.css. */
export const DEFAULT_BRAND = "#80426E";

/**
 * The colours worth offering as one-click presets: a spread of hues that each
 * survive the readability clamp, plus the neutral graphite for a no-colour
 * workspace.
 */
export const THEME_PRESETS: { hex: string; label: string }[] = [
  { hex: DEFAULT_BRAND, label: "Plum (default)" },
  { hex: "#b03060", label: "Raspberry" },
  { hex: "#c2410c", label: "Terracotta" },
  { hex: "#a16207", label: "Ochre" },
  { hex: "#15803d", label: "Forest" },
  { hex: "#0f766e", label: "Pine" },
  { hex: "#0369a1", label: "Ocean" },
  { hex: "#1d4ed8", label: "Cobalt" },
  { hex: "#6d28d9", label: "Iris" },
  { hex: "#3f3f46", label: "Graphite" },
];

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const hue = (value: number) => ((value % 360) + 360) % 360;

/* ── colour-space I/O ────────────────────────────────────────────── */

/** `#abc`, `#aabbcc` and a missing `#` all parse; anything else is null. */
export function parseHex(input: string): { r: number; g: number; b: number } | null {
  const raw = input.trim().replace(/^#/, "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function hexToOklch(input: string): Oklch | null {
  const rgb = parseHex(input);
  if (!rgb) return null;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = lin(rgb.r);
  const g = lin(rgb.g);
  const b = lin(rgb.b);

  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;

  const l = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z);
  const m = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z);
  const s = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z);

  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return {
    l: L,
    c: Math.sqrt(A * A + B * B),
    h: hue((Math.atan2(B, A) * 180) / Math.PI),
  };
}

/** oklch to sRGB hex, gamut-clipping per channel. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  const a = c * Math.cos(rad);
  const b = c * Math.sin(rad);

  const l3 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const gamma = (v: number) => {
    const clamped = clamp(v, 0, 1);
    return clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  };
  const channel = (v: number) =>
    Math.round(gamma(v) * 255)
      .toString(16)
      .padStart(2, "0");

  return (
    "#" +
    channel(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3) +
    channel(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3) +
    channel(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3)
  );
}

/**
 * Compact CSS form of an oklch triple, as used throughout index.css.
 * Lightness and chroma keep four decimals so a picked colour round-trips back
 * to the exact same hex — at three, a preset like #0369a1 drifted by a channel.
 */
export function oklchCss(l: number, c: number, h: number): string {
  return `oklch(${round(clamp(l, 0, 1), 4)} ${round(clamp(c, 0, 0.4), 4)} ${round(
    hue(h),
    1,
  )})`;
}

/** WCAG relative luminance of a hex colour. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
  );
}

/** WCAG contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return round((hi + 0.05) / (lo + 0.05), 2);
}

/* ── the mix ─────────────────────────────────────────────────────── */

/** Near-white ink pulled a hair toward the brand hue. */
const inkLight = (h: number, c: number): Oklch => ({
  l: 0.985,
  c: clamp(c * 0.03, 0, 0.006),
  h,
});

/** Near-black ink, likewise tinted rather than pure grey. */
const inkDark = (h: number, c: number): Oklch => ({
  l: 0.19,
  c: clamp(c * 0.14, 0, 0.02),
  h,
});

/** Whichever of the two inks reads better on a filled swatch. */
function readableInk(bg: Oklch, h: number, c: number) {
  const back = oklchToHex(bg);
  const onLight = contrastRatio(back, oklchToHex(inkLight(h, c)));
  const onDark = contrastRatio(back, oklchToHex(inkDark(h, c)));
  return onDark > onLight
    ? { ink: inkDark(h, c), ratio: onDark }
    : { ink: inkLight(h, c), ratio: onLight };
}

/** Light-mode cards are white, so that is the surface the accent must clear. */
const CARD = "#ffffff";
const MIN_CONTRAST = 4.5;

/**
 * The accent a light-mode page can actually use.
 *
 * A fixed lightness clamp is not enough, because one colour has to hold two
 * jobs at once: link text on a white card, and the fill under a button label.
 * That pair is decided by hue and chroma as much as lightness — a yellow and a
 * violet at the same lightness sit 1.5 ratios apart — so the picked colour is
 * kept exactly when it already passes both, and otherwise mixed down until it
 * does. Mid-tone colours are the awkward ones: they are dark enough for white
 * ink to fail and light enough for link text to fail, so both are checked on
 * every step.
 */
function primaryForLight(base: Oklch, chroma: number, h: number) {
  // The floor only stops the walk from reaching zero; a genuinely dark pick is
  // left dark, because darker is never worse for either role.
  let candidate: Oklch = { l: clamp(base.l, 0.05, 0.72), c: chroma, h };
  const evaluate = () => {
    const ink = readableInk(candidate, h, chroma);
    return {
      onWhite: contrastRatio(oklchToHex(candidate), CARD),
      ink,
    };
  };

  let steps = 0;
  let state = evaluate();
  while (
    (state.onWhite < MIN_CONTRAST || state.ink.ratio < MIN_CONTRAST) &&
    candidate.l > 0.05 &&
    steps < 160
  ) {
    candidate = { ...candidate, l: round(candidate.l - 0.005, 4) };
    steps += 1;
    state = evaluate();
  }

  return {
    primary: candidate,
    adjusted: steps > 0 || Math.abs(candidate.l - base.l) > 0.004,
    ink: state.ink.ink,
    contrast: state.ink.ratio,
  };
}

/**
 * Mix one colour into a complete light + dark token set.
 *
 * The accent keeps the colour the reader picked whenever that colour can serve
 * as both a filled button and link text; when it cannot, it is mixed to the
 * nearest strength that can, and `adjusted` says so.
 */
export function mixTheme(input: string | Oklch): MixedTheme | null {
  const base = typeof input === "string" ? hexToOklch(input) : input;
  if (!base) return null;

  // 0.30 is close to the most saturated colour sRGB can hold; capping lower
  // than that would quietly trim a vivid pick (a violet like #6d28d9 lost a
  // channel at 0.24) rather than reproduce it.
  const chroma = clamp(base.c, 0, 0.3);
  const h = hue(base.h);

  const {
    primary: primaryLight,
    adjusted,
    ink: lightInkInk,
    contrast: lightInkRatio,
  } = primaryForLight(base, chroma, h);
  const effective = oklchToHex(primaryLight);

  const darkChroma = clamp(chroma * 1.1, 0, 0.3);
  const primaryDark: Oklch = {
    l: clamp(base.l + 0.19, 0.58, 0.82),
    c: darkChroma,
    h,
  };
  const darkInk = readableInk(primaryDark, h, chroma);

  /** A neutral surface that carries a trace of the brand hue. */
  const surface = (l: number, k: number): string =>
    oklchCss(l, clamp(chroma * k, 0, 0.024), h);

  const ringLight = oklchCss(
    clamp(primaryLight.l + 0.08, 0, 0.72),
    clamp(chroma * 1.25, 0, 0.2),
    h,
  );
  const ringDark = oklchCss(
    clamp(primaryDark.l + 0.06, 0, 0.85),
    clamp(darkChroma, 0, 0.2),
    h,
  );

  /**
   * Five chart colours: the accent plus four rotations of the same hue. They
   * keep distinct lightness as well as hue, so a printout in greyscale still
   * separates them.
   */
  const chartRamp = (dark: boolean) => [
    oklchCss(dark ? primaryDark.l : primaryLight.l, chroma, h),
    oklchCss(dark ? 0.72 : 0.64, 0.13, h + 34),
    oklchCss(dark ? 0.71 : 0.63, 0.12, h - 46),
    oklchCss(dark ? 0.82 : 0.74, 0.14, h + 92),
    oklchCss(dark ? 0.7 : 0.62, 0.17, h - 118),
  ];

  const inkHexDark = oklchToHex(darkInk.ink);
  const chartLight = chartRamp(false);
  const chartDark = chartRamp(true);

  const light: ThemeTokens = {
    "--background": surface(0.985, 0.045),
    "--foreground": surface(0.19, 0.16),
    "--card": oklchCss(1, 0, h),
    "--card-foreground": surface(0.19, 0.16),
    "--popover": oklchCss(1, 0, h),
    "--popover-foreground": surface(0.19, 0.16),
    "--primary": oklchCss(primaryLight.l, primaryLight.c, h),
    "--primary-foreground": oklchCss(
      lightInkInk.l,
      lightInkInk.c,
      lightInkInk.h,
    ),
    "--secondary": surface(0.965, 0.09),
    "--secondary-foreground": surface(0.28, 0.2),
    "--muted": surface(0.965, 0.09),
    "--muted-foreground": surface(0.55, 0.22),
    "--accent": surface(0.958, 0.13),
    "--accent-foreground": surface(0.28, 0.2),
    "--border": surface(0.92, 0.09),
    "--input": surface(0.92, 0.09),
    "--ring": ringLight,
    "--chart-1": chartLight[0]!,
    "--chart-2": chartLight[1]!,
    "--chart-3": chartLight[2]!,
    "--chart-4": chartLight[3]!,
    "--chart-5": chartLight[4]!,
    "--sidebar": oklchCss(1, 0, h),
    "--sidebar-foreground": surface(0.19, 0.16),
    "--sidebar-primary": oklchCss(primaryLight.l, primaryLight.c, h),
    "--sidebar-primary-foreground": oklchCss(
      lightInkInk.l,
      lightInkInk.c,
      lightInkInk.h,
    ),
    "--sidebar-accent": surface(0.958, 0.13),
    "--sidebar-accent-foreground": surface(0.28, 0.2),
    "--sidebar-border": surface(0.92, 0.09),
    "--sidebar-ring": ringLight,
  };

  const dark: ThemeTokens = {
    "--background": surface(0.16, 0.13),
    "--foreground": surface(0.975, 0.045),
    "--card": surface(0.215, 0.15),
    "--card-foreground": surface(0.975, 0.045),
    "--popover": surface(0.215, 0.15),
    "--popover-foreground": surface(0.975, 0.045),
    "--primary": oklchCss(primaryDark.l, primaryDark.c, h),
    "--primary-foreground": inkHexDark,
    "--secondary": surface(0.275, 0.17),
    "--secondary-foreground": surface(0.975, 0.045),
    "--muted": surface(0.275, 0.17),
    "--muted-foreground": surface(0.72, 0.22),
    "--accent": surface(0.3, 0.21),
    "--accent-foreground": surface(0.975, 0.045),
    "--border": "oklch(1 0 0 / 12%)",
    "--input": "oklch(1 0 0 / 16%)",
    "--ring": ringDark,
    "--chart-1": chartDark[0]!,
    "--chart-2": chartDark[1]!,
    "--chart-3": chartDark[2]!,
    "--chart-4": chartDark[3]!,
    "--chart-5": chartDark[4]!,
    "--sidebar": surface(0.215, 0.15),
    "--sidebar-foreground": surface(0.975, 0.045),
    "--sidebar-primary": oklchCss(primaryDark.l, primaryDark.c, h),
    "--sidebar-primary-foreground": inkHexDark,
    "--sidebar-accent": surface(0.3, 0.21),
    "--sidebar-accent-foreground": surface(0.975, 0.045),
    "--sidebar-border": "oklch(1 0 0 / 12%)",
    "--sidebar-ring": ringDark,
  };

  return {
    base,
    effective,
    adjusted,
    contrast: lightInkRatio,
    light,
    dark,
  };
}

/* ── applying, storing ───────────────────────────────────────────── */

const STYLE_ID = "slate-theme";

/**
 * `html:root` outranks the plain `:root` in index.css, so this survives both
 * Vite's dev-time style injection order and the built stylesheet.
 */
function ruleBlock(selector: string, tokens: ThemeTokens) {
  const body = Object.entries(tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `${selector} {\n${body}\n}`;
}

export function applyMixedTheme(mixed: MixedTheme) {
  if (typeof document === "undefined") return;
  const css =
    ruleBlock("html:root", mixed.light) +
    "\n" +
    ruleBlock("html.dark", mixed.dark);
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

/** Drop every override and fall back to the values in index.css. */
export function clearTheme() {
  if (typeof document === "undefined") return;
  document.getElementById(STYLE_ID)?.remove();
}

export function readStoredBrand(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored && parseHex(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function storeBrand(hex: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (hex === null) window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, hex);
  } catch {
    // private mode or a full quota — the theme still applies, just not remembered
  }
}

/**
 * Apply the reader's saved brand colour. Called once at boot, before the first
 * render, so a custom theme never flashes the default one first.
 */
export function applyStoredTheme() {
  const stored = readStoredBrand();
  if (!stored) return null;
  const mixed = mixTheme(stored);
  if (mixed) applyMixedTheme(mixed);
  return mixed;
}
