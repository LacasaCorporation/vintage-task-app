/**
 * Excel (.xlsx) import/export for bulk raw-material entry.
 *
 * The "smart check" pass reads messy real-world sheets (title rows, odd headers,
 * currency-formatted prices, unit spellings like "Kgs") and turns them into clean
 * rows: it maps columns by fuzzy header aliases, normalises units/categories
 * against the user's master data, fuses duplicates, flags price outliers and
 * scores every row with a confidence value.
 */

export type Field = "code" | "name" | "category" | "subCategory" | "unit" | "price";

export type IssueLevel = "error" | "warning" | "info";

export type Issue = {
  level: IssueLevel;
  field?: Field;
  message: string;
};

export type RowStatus = "ready" | "fixed" | "warning" | "error" | "duplicate";

export type MaterialInput = {
  code: string;
  name: string;
  category: string;
  subCategory: string;
  unit: string;
  pricePerUnit: number;
};

export type AnalyzedRow = {
  /** Stable id for React keys / toggling. */
  key: string;
  /** Row number in the source sheet (1-based, as Excel shows it). */
  sourceRow: number;
  raw: MaterialInput;
  parsedPrice: number | null;
  issues: Issue[];
  status: RowStatus;
  confidence: number;
  /** Existing material this row matches (duplicate by code or name+unit). */
  existingId?: string;
  existingPrice?: number;
  /** What the importer will do with this row. */
  action: "create" | "update" | "skip";
  include: boolean;
};

export type ExistingMaterial = {
  _id: string;
  code?: string;
  name: string;
  category?: string;
  subCategory?: string;
  unit: string;
  pricePerUnit: number;
};

export type MasterItem = { _id: string; name: string; parentId?: string };

export type AnalyzeOptions = {
  /** Create units/categories that don't exist yet (otherwise the row errors). */
  autoCreate: boolean;
};

export type ImportSummary = {
  total: number;
  ready: number;
  fixed: number;
  warnings: number;
  errors: number;
  duplicates: number;
  newUnits: string[];
  newCategories: string[];
  newSubCategories: string[];
  /** Average confidence of importable rows. */
  score: number;
};

// ── Header detection ──────────────────────────────────────────────────

const HEADER_ALIASES: Record<Field, string[]> = {
  code: [
    "code",
    "itemcode",
    "materialcode",
    "rmcode",
    "sku",
    "partno",
    "partnumber",
    "itemno",
    "ref",
    "reference",
  ],
  name: [
    "name",
    "itemname",
    "materialname",
    "material",
    "item",
    "description",
    "particulars",
    "particular",
    "details",
  ],
  category: ["category", "cat", "group", "type", "materialcategory", "head", "maincategory"],
  subCategory: [
    "subcategory",
    "subcat",
    "subgroup",
    "subhead",
    "subtype",
    "childcategory",
    "sub",
  ],
  unit: ["unit", "uom", "unitofmeasure", "units", "measure", "uomunit", "per"],
  price: [
    "price",
    "unitprice",
    "rate",
    "priceperunit",
    "unitcost",
    "cost",
    "costprice",
    "amount",
    "value",
  ],
};

const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Map a header row to field→column index using the alias table. */
export function detectColumns(header: unknown[]): Partial<Record<Field, number>> {
  const found: Partial<Record<Field, number>> = {};
  header.forEach((cell, index) => {
    const key = normalizeHeader(cell);
    if (!key) return;
    for (const field of Object.keys(HEADER_ALIASES) as Field[]) {
      if (found[field] !== undefined) continue;
      if (HEADER_ALIASES[field].includes(key)) {
        found[field] = index;
        return;
      }
    }
  });
  return found;
}

/** Score how likely a row is the header row (used to skip title/blank rows). */
function headerScore(row: unknown[]): number {
  const found = detectColumns(row);
  let score = Object.keys(found).length;
  if (found.name !== undefined) score += 2;
  if (found.price !== undefined) score += 1;
  if (found.unit !== undefined) score += 1;
  return score;
}

// ── Value cleaning ────────────────────────────────────────────────────

export function cleanText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "");
}

/** Parse money written in any common style: "$1,234.50", "1.234,50", "1200/-", 12.5 */
export function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let text = cleanText(value);
  if (!text) return null;
  // currency words (with any trailing dot) and symbols
  text = text.replace(/\b(rs|inr|usd|aed|dhs|sar|egp|php|ngn|kes|zar|eur|gbp)\b\.?/gi, "");
  text = text.replace(/[$€£¥₹]/g, "");
  // trailing qualifiers: "per kg", "1200/-"
  text = text.replace(/\bper\b.*$/i, "");
  text = text.replace(/\/-?\s*$/, "");
  // thousands written with spaces ("1 500")
  text = text.replace(/\s/g, "");
  text = text.replace(/[^\d.,-]/g, "");
  if (!text || !/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    text =
      lastComma > lastDot
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
  } else if (lastComma > -1) {
    const decimals = text.length - lastComma - 1;
    text = decimals === 3 ? text.replace(/,/g, "") : text.replace(",", ".");
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Canonical unit spellings for the messy ways people write units. */
const UNIT_ALIASES: Record<string, string> = {
  kg: "kg", kgs: "kg", kgm: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
  ton: "ton", tons: "ton", tonne: "ton", tonnes: "ton", mt: "ton",
  m: "m", mtr: "m", mtrs: "m", mtrq: "m", meter: "m", meters: "m", metre: "m", metres: "m",
  rmt: "m", rm: "m", rft: "ft",
  cm: "cm", cms: "cm", mm: "mm",
  ft: "ft", foot: "ft", feet: "ft",
  in: "in", inch: "in", inches: "in",
  sqft: "sq ft", sft: "sq ft", sqfeet: "sq ft", sqm: "sq m", sqmt: "sq m",
  cft: "cft", cubicft: "cft", cbm: "cbm", cum: "cbm",
  pcs: "pcs", pc: "pcs", piece: "pcs", pieces: "pcs", no: "pcs", nos: "pcs", number: "pcs",
  ea: "pcs", each: "pcs", unit: "pcs", units: "pcs", qty: "pcs", pce: "pcs",
  set: "set", sets: "set",
  box: "box", boxes: "box", ctn: "box", carton: "box",
  roll: "roll", rolls: "roll", bundle: "bundle", bundles: "bundle",
  bag: "bag", bags: "bag", sack: "bag", sacks: "bag",
  pack: "pack", packs: "pack", pkt: "pack", packet: "pack",
  pair: "pair", pairs: "pair", pr: "pair",
  dz: "dz", dzn: "dz", dozen: "dz", dozens: "dz",
  l: "L", ltr: "L", ltrs: "L", litre: "L", litres: "L", liter: "L", liters: "L",
  ml: "ml", mls: "ml",
  hr: "hr", hrs: "hr", hour: "hr", hours: "hr",
  day: "day", days: "day", shift: "shift", shifts: "shift",
  lot: "lot", job: "job", sheet: "sheet", sheets: "sheet", plate: "plate", plates: "plate",
};

const canonicalUnit = (raw: string): string => {
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return UNIT_ALIASES[key] ?? raw;
};

/** Title-case ALL-CAPS input ("WOOD" → "Wood"), leave mixed case alone. */
function tidyName(raw: string): string {
  const text = cleanText(raw);
  if (!text) return "";
  if (text.length > 1 && text === text.toUpperCase() && /[A-Z]/.test(text)) {
    return text
      .toLowerCase()
      .replace(/\b[a-z]/g, (c) => c.toUpperCase())
      .replace(/\b(Pvc|Upvc|MdF|Mdf|Hdpe|Ldpe|Pu)\b/g, (m) => m.toUpperCase());
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const normalizeCode = (raw: string): string => {
  const text = cleanText(raw);
  if (!text) return "";
  return text.toUpperCase().replace(/\s+/g, "");
};

const pairKey = (name: string, unit: string) =>
  `${name.trim().toLowerCase()}|${unit.trim().toLowerCase()}`;

// ── Analysis ──────────────────────────────────────────────────────────

type AnalyzeContext = {
  existing: ExistingMaterial[];
  units: MasterItem[];
  categories: MasterItem[];
  options: AnalyzeOptions;
};

/** Median of a numeric list (used for outlier detection). */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function confidenceFor(issues: Issue[]): number {
  let score = 100;
  for (const issue of issues) {
    if (issue.level === "error") score -= 35;
    else if (issue.level === "warning") score -= 12;
    else score -= 2;
  }
  return Math.max(0, Math.min(100, score));
}

function statusFor(issues: Issue[]): RowStatus {
  if (issues.some((i) => i.level === "error")) return "error";
  if (issues.some((i) => i.level === "warning")) return "warning";
  if (issues.some((i) => i.level === "info")) return "fixed";
  return "ready";
}

/**
 * Analyze a single row against existing data + master lists.
 * Pure function so the review dialog can re-run it after an inline fix.
 */
export function analyzeRow(
  row: MaterialInput,
  sourceRow: number,
  ctx: AnalyzeContext,
  medianByUnit: Map<string, number>,
): AnalyzedRow {
  const issues: Issue[] = [];

  // name
  const name = cleanText(row.name);
  if (!name) issues.push({ level: "error", field: "name", message: "No material name." });
  else if (name.length > 120)
    issues.push({ level: "error", field: "name", message: "Name is longer than 120 characters." });

  // code
  const code = normalizeCode(row.code);
  const existingByCode = code
    ? ctx.existing.find((m) => (m.code ?? "").toUpperCase() === code)
    : undefined;

  // unit
  const rawUnit = cleanText(row.unit);
  let unit = "";
  if (!rawUnit) {
    unit = ctx.units[0]?.name ?? "pcs";
    issues.push({ level: "warning", field: "unit", message: `No unit — using “${unit}”.` });
  } else {
    const master = ctx.units.find((u) => u.name.toLowerCase() === rawUnit.toLowerCase());
    if (master) {
      unit = master.name;
    } else {
      const canonical = canonicalUnit(rawUnit);
      const masterCanonical = ctx.units.find((u) => u.name.toLowerCase() === canonical.toLowerCase());
      if (masterCanonical) {
        unit = masterCanonical.name;
        issues.push({
          level: "info",
          field: "unit",
          message: `Unit “${rawUnit}” matched to “${masterCanonical.name}”.`,
        });
      } else if (ctx.options.autoCreate) {
        unit = canonical;
        issues.push({
          level: "info",
          field: "unit",
          message: `New unit “${unit}” will be created.`,
        });
      } else {
        unit = canonical;
        issues.push({
          level: "error",
          field: "unit",
          message: `Unknown unit “${rawUnit}” — add it in Manage units & categories.`,
        });
      }
    }
  }

  // category / sub-category
  const rawCategory = cleanText(row.category);
  let category = "";
  if (rawCategory) {
    const master = ctx.categories.find(
      (c) => c.parentId === undefined && c.name.toLowerCase() === rawCategory.toLowerCase(),
    );
    if (master) {
      category = master.name;
    } else if (ctx.options.autoCreate) {
      category = tidyName(rawCategory);
      issues.push({
        level: "info",
        field: "category",
        message: `New category “${category}” will be created.`,
      });
    } else {
      category = tidyName(rawCategory);
      issues.push({
        level: "error",
        field: "category",
        message: `Unknown category “${rawCategory}”.`,
      });
    }
  }

  const rawSub = cleanText(row.subCategory);
  let subCategory = "";
  if (rawSub) {
    if (!category) {
      issues.push({
        level: "warning",
        field: "subCategory",
        message: "Sub-category needs a category — it will be skipped.",
      });
    } else {
      const parent = ctx.categories.find(
        (c) => c.parentId === undefined && c.name.toLowerCase() === category.toLowerCase(),
      );
      const known = parent
        ? ctx.categories.find(
            (c) => c.parentId === parent._id && c.name.toLowerCase() === rawSub.toLowerCase(),
          )
        : undefined;
      if (known) {
        subCategory = known.name;
      } else if (ctx.options.autoCreate) {
        subCategory = tidyName(rawSub);
        issues.push({
          level: "info",
          field: "subCategory",
          message: `New sub-category “${subCategory}” under “${category}”.`,
        });
      } else {
        subCategory = tidyName(rawSub);
        issues.push({
          level: "error",
          field: "subCategory",
          message: `Unknown sub-category “${rawSub}”.`,
        });
      }
    }
  }

  // price
  const price = row.pricePerUnit;
  const priceValid = Number.isFinite(price);
  if (!priceValid) {
    issues.push({
      level: "error",
      field: "price",
      message: "No unit price (or it isn't a number).",
    });
  } else if (price < 0) {
    issues.push({ level: "error", field: "price", message: "Price can't be negative." });
  } else if (price === 0) {
    issues.push({
      level: "warning",
      field: "price",
      message: "Price is 0 — costing sheets will show a zero cost.",
    });
  }

  // duplicate against existing rows
  const existingByName = ctx.existing.find(
    (m) => name && pairKey(m.name, m.unit) === pairKey(name, unit),
  );
  const existingNameOnly = ctx.existing.find((m) => name && m.name.toLowerCase() === name.toLowerCase());
  const existing = existingByCode ?? existingByName;
  if (
    existingByCode &&
    existingByName &&
    existingByCode._id !== existingByName._id &&
    existingByCode.name.toLowerCase() !== name.toLowerCase()
  ) {
    // the code belongs to a different material than the name does
    issues.push({
      level: "warning",
      message: `Code “${code}” already belongs to “${existingByCode.name}”.`,
    });
  }
  if (
    !existingByName &&
    existingNameOnly &&
    existingNameOnly.unit.toLowerCase() !== unit.toLowerCase()
  ) {
    issues.push({
      level: "warning",
      field: "unit",
      message: `“${existingNameOnly.name}” already exists with unit “${existingNameOnly.unit}” — check the unit.`,
    });
  }
  if (existing) {
    if (Number.isFinite(price) && price > 0) {
      const delta = ((price - existing.pricePerUnit) / existing.pricePerUnit) * 100;
      if (Math.abs(delta) >= 25) {
        issues.push({
          level: "warning",
          field: "price",
          message: `Price is ${Math.abs(delta).toFixed(0)}% ${
            delta > 0 ? "higher" : "lower"
          } than the saved price (${existing.pricePerUnit.toLocaleString()}).`,
        });
      }
    }
    issues.push({
      level: "info",
      message: `Already in the list as “${existing.name}” (${existing.code ?? "no code"}).`,
    });
  }

  // statistical price outlier among rows sharing the unit
  const unitMedian = medianByUnit.get(unit.toLowerCase());
  if (priceValid && price > 0 && unitMedian && unitMedian > 0 && !existing) {
    const ratio = price / unitMedian;
    if (ratio >= 4 || ratio <= 0.25) {
      issues.push({
        level: "warning",
        field: "price",
        message: `Unusual price for a “${unit}” item — file median is ${unitMedian.toLocaleString()}.`,
      });
    }
  }

  const status = statusFor(issues);
  const duplicateOfExisting = Boolean(existing) && status !== "error";
  return {
    key: `${sourceRow}-${name}-${unit}`,
    sourceRow,
    raw: { code, name, category, subCategory, unit, pricePerUnit: price },
    parsedPrice: priceValid ? price : null,
    issues,
    status: duplicateOfExisting && status !== "warning" ? "duplicate" : status,
    confidence: confidenceFor(issues),
    existingId: existing?._id,
    existingPrice: existing?.pricePerUnit,
    action: status === "error" ? "skip" : existing ? "update" : "create",
    include: status !== "error",
  };
}

/** Re-run the whole analysis: used after an inline fix or an option change. */
export function analyzeAll(
  inputs: { row: MaterialInput; sourceRow: number }[],
  ctx: Omit<AnalyzeContext, "options"> & { options: AnalyzeOptions },
): AnalyzedRow[] {
  // File-level price median per unit (needs every row first).
  const byUnit = new Map<string, number[]>();
  for (const { row } of inputs) {
    const price = row.pricePerUnit;
    const unit = cleanText(row.unit).toLowerCase();
    if (!unit || !Number.isFinite(price) || price <= 0) continue;
    const list = byUnit.get(unit) ?? [];
    list.push(price);
    byUnit.set(unit, list);
  }
  const medianByUnit = new Map<string, number>();
  for (const [unit, prices] of byUnit) {
    if (prices.length >= 4) medianByUnit.set(unit, median(prices));
    const canonical = canonicalUnit(unit).toLowerCase();
    if (canonical !== unit && prices.length >= 4) medianByUnit.set(canonical, median(prices));
  }

  const analyzed = inputs.map(({ row, sourceRow }) =>
    analyzeRow(row, sourceRow, ctx, medianByUnit),
  );

  // Merge rows that repeat inside the file (same name + unit).
  const seen = new Map<string, AnalyzedRow>();
  for (const row of analyzed) {
    if (!row.raw.name) continue;
    const key = pairKey(row.raw.name, row.raw.unit);
    const first = seen.get(key);
    if (!first) {
      seen.set(key, row);
      continue;
    }
    row.status = row.status === "error" ? "error" : "duplicate";
    row.action = "skip";
    row.include = false;
    row.issues.push({
      level: "info",
      message: `Duplicate of row ${first.sourceRow} in this file — merged.`,
    });
    row.confidence = confidenceFor(row.issues);
  }
  return analyzed;
}

/** Roll the analyzed rows up into headline numbers for the review panel. */
export function summarize(rows: AnalyzedRow[]): ImportSummary {
  const importable = rows.filter((r) => r.include && r.action !== "skip");
  const score =
    importable.length === 0
      ? 0
      : Math.round(importable.reduce((sum, r) => sum + r.confidence, 0) / importable.length);
  const collect = (predicate: (i: Issue) => boolean, field?: Field) =>
    Array.from(
      new Set(
        rows
          .flatMap((r) => r.issues)
          .filter((i) => predicate(i) && (field === undefined || i.field === field))
          .map((i) => i.message),
      ),
    );
  return {
    total: rows.length,
    ready: rows.filter((r) => r.status === "ready").length,
    fixed: rows.filter((r) => r.status === "fixed").length,
    warnings: rows.filter((r) => r.status === "warning").length,
    errors: rows.filter((r) => r.status === "error").length,
    duplicates: rows.filter((r) => r.status === "duplicate").length,
    newUnits: collect((i) => i.message.startsWith("New unit"), "unit").map((m) =>
      m.replace(/^New unit “([^”]+)”.*$/, "$1"),
    ),
    newCategories: collect((i) => i.message.startsWith("New category"), "category").map((m) =>
      m.replace(/^New category “([^”]+)”.*$/, "$1"),
    ),
    newSubCategories: collect((i) => i.message.startsWith("New sub-category"), "subCategory").map(
      (m) => m.replace(/^New sub-category “([^”]+)”.*$/, "$1"),
    ),
    score,
  };
}

// ── Reading a workbook ────────────────────────────────────────────────

export type ReadResult = {
  inputs: { row: MaterialInput; sourceRow: number }[];
  columns: Partial<Record<Field, number>>;
  sheetName: string;
  skipped: number;
};

/**
 * Read the first usable sheet of an .xlsx/.xls/.csv file, find the header row
 * (even when the file starts with title or blank rows) and pull the data rows.
 */
export async function readMaterialWorkbook(file: File): Promise<ReadResult> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: false });

  let best: { aoa: unknown[][]; headerIndex: number; columns: Partial<Record<Field, number>>; sheetName: string } | null =
    null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });
    const limit = Math.min(aoa.length, 12);
    let bestHere: { index: number; columns: Partial<Record<Field, number>>; score: number } | null =
      null;
    // scan the top rows so files that start with a title or blank lines still work
    for (let i = 0; i < limit; i++) {
      const row = aoa[i] ?? [];
      const score = headerScore(row);
      if (score >= 3 && (!bestHere || score > bestHere.score)) {
        bestHere = { index: i, columns: detectColumns(row), score };
      }
    }
    if (
      bestHere &&
      (!best || bestHere.score > headerScore(best.aoa[best.headerIndex] ?? []))
    ) {
      best = { aoa, headerIndex: bestHere.index, columns: bestHere.columns, sheetName };
    }
  }

  if (!best) {
    // Fall back to the first sheet, assuming row 1 is the header.
    const first = workbook.SheetNames[0];
    const sheet = first ? workbook.Sheets[first] : undefined;
    if (!sheet) throw new Error("That file has no sheets.");
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false,
    });
    const columns = detectColumns(aoa[0] ?? []);
    if (columns.name === undefined && columns.price === undefined) {
      throw new Error(
        "Couldn't find the columns. Use the template — headers like Code, Name, Category, Sub-category, Unit, Price.",
      );
    }
    best = { aoa, headerIndex: 0, columns, sheetName: first ?? "Sheet1" };
  }

  const { aoa, headerIndex, columns } = best;
  const inputs: { row: MaterialInput; sourceRow: number }[] = [];
  let skipped = 0;

  for (let i = headerIndex + 1; i < aoa.length; i++) {
    const line = aoa[i] ?? [];
    const cell = (field: Field) => {
      const index = columns[field];
      return index === undefined ? "" : (line[index] ?? "");
    };
    const blank = line.every((v) => cleanText(v) === "");
    if (blank) {
      skipped++;
      continue;
    }
    const parsedPrice = parsePrice(cell("price"));
    inputs.push({
      row: {
        code: cleanText(cell("code")),
        name: cleanText(cell("name")),
        category: cleanText(cell("category")),
        subCategory: cleanText(cell("subCategory")),
        unit: cleanText(cell("unit")),
        pricePerUnit: parsedPrice === null ? Number.NaN : parsedPrice,
      },
      sourceRow: i + 1,
    });
  }

  return { inputs, columns, sheetName: best.sheetName, skipped };
}

/** Quick format check before we bother parsing. */
export function isSupportedFile(file: File): boolean {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(file.name);
}

// ── Writing workbooks ─────────────────────────────────────────────────

async function downloadWorkbook(
  sheets: { name: string; aoa: unknown[][]; widths?: number[] }[],
  filename: string,
) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  for (const spec of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(spec.aoa);
    if (spec.widths) sheet["!cols"] = spec.widths.map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(workbook, sheet, spec.name.slice(0, 31));
  }
  XLSX.writeFile(workbook, filename);
}

const MATERIAL_HEADERS = [
  "Code",
  "Name",
  "Category",
  "Sub-category",
  "Unit",
  "Unit price",
];

/** Reference sheet listing the master data so the import keeps its shape. */
function referenceSheet(units: MasterItem[], categories: MasterItem[]): unknown[][] {
  const parents = categories.filter((c) => c.parentId === undefined);
  const maxRows = Math.max(parents.length, units.length, 1);
  const aoa: unknown[][] = [["Category", "Sub-categories", "Units"]];
  for (let i = 0; i < maxRows; i++) {
    const cat = parents[i];
    const subs = cat
      ? categories
          .filter((c) => c.parentId === cat._id)
          .map((c) => c.name)
          .join(", ")
      : "";
    aoa.push([cat?.name ?? "", subs, units[i]?.name ?? ""]);
  }
  return aoa;
}

/** Export every material as a real .xlsx workbook. */
export async function exportMaterials(
  materials: ExistingMaterial[],
  units: MasterItem[],
  categories: MasterItem[],
) {
  const rows = materials.map((m) => [
    m.code ?? "",
    m.name,
    m.category ?? "",
    m.subCategory ?? "",
    m.unit,
    m.pricePerUnit,
  ]);
  const aoa: unknown[][] = [[`Raw materials — ${materials.length} items · ${dateStamp()}`], MATERIAL_HEADERS, ...rows];
  await downloadWorkbook(
    [
      { name: "Raw materials", aoa, widths: [14, 34, 18, 18, 10, 14] },
      { name: "Reference", aoa: referenceSheet(units, categories), widths: [22, 30, 14] },
    ],
    `raw-materials-${fileStamp()}.xlsx`,
  );
}

/** A blank template with example rows so bulk entry has the right shape. */
export async function exportMaterialTemplate(
  units: MasterItem[],
  categories: MasterItem[],
  nextCode: string,
) {
  const aoa: unknown[][] = [
    ["Raw materials — bulk import template"],
    ["Fill the rows below, then use Import from Excel. Leave Code blank to auto-number."],
    [],
    MATERIAL_HEADERS,
    ["", "Teak wood", "Wood", "Hardwood", units[0]?.name ?? "cft", 2400],
    ["", "MDF 18mm sheet", "Wood", "Engineered", units[1]?.name ?? "pcs", 1750],
    [nextCode, "Glass sheet 6mm", "Glass", "", units[2]?.name ?? "sq ft", 175],
  ];
  const howTo: unknown[][] = [
    ["How to use this template"],
    [""],
    ["1", "Keep the header row (Code, Name, Category, Sub-category, Unit, Unit price) exactly where it is."],
    ["2", "One material per row. Extra columns and blank rows are ignored."],
    ["3", "Leave Code blank — RM0001, RM0002… are generated automatically."],
    ["4", "Prices accept any style: 1,200 · $1,200.50 · 1.200,50 · 1200/-"],
    ["5", "Units are matched to your list (kgs → kg, nos → pcs). New ones are created on import."],
    ["6", "Save as .xlsx (or .csv) and use Import from Excel in the Raw materials page."],
    ["7", "The import shows a full check report — duplicates, odd prices and typos — before anything is saved."],
  ];
  await downloadWorkbook(
    [
      { name: "Raw materials", aoa, widths: [14, 34, 18, 18, 10, 14] },
      { name: "How to use", aoa: howTo, widths: [6, 96] },
      { name: "Reference", aoa: referenceSheet(units, categories), widths: [22, 30, 14] },
    ],
    "raw-materials-template.xlsx",
  );
}

function fileStamp() {
  return new Date().toISOString().slice(0, 10);
}

function dateStamp() {
  return new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
