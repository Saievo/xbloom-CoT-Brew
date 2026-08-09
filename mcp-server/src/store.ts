import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DATA_DIR = join(homedir(), ".xbloom");

async function ensureDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

function filePath(name: string): string {
  return join(DATA_DIR, name);
}

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath(name), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(name: string, data: unknown): Promise<void> {
  await ensureDir();
  await writeFile(filePath(name), JSON.stringify(data, null, 2), "utf-8");
}

// --- Typed accessors ---

export interface XBloomConfig {
  memberId: number;
  token: string;
  email: string;
}

export interface Preferences {
  /** Desired direction: "sour" | "balanced" | "bitter" */
  sourBitterBias?: string;
  /** Desired strength: "light" | "medium" | "strong" */
  strength?: string;
  /** Desired body: "light" (清爽) | "medium" (适中) | "heavy" (厚重) */
  bodyPref?: string;
  /** How much aroma matters: "low" | "medium" | "high" */
  aromaPriority?: string;
  notes?: string;
  updatedAt?: string;
  // --- legacy fields (pre-2026-08) ---
  acidity?: string;
  sweetness?: string;
  body?: string;
}

/** Map the legacy 4-dimension preference shape onto the new model. */
export function normalizePreferences(raw: Preferences | Record<string, unknown> | null | undefined): Preferences {
  if (!raw) return {};
  const legacy = raw as unknown as Record<string, string>;
  const out: Preferences = {
    sourBitterBias: legacy.sourBitterBias ?? (legacy.acidity === "bright" ? "sour" : legacy.acidity === "low" ? "bitter" : "balanced"),
    strength: legacy.strength ?? "medium",
    bodyPref: legacy.bodyPref ?? (legacy.body === "full" ? "heavy" : legacy.body === "light" ? "light" : "medium"),
    aromaPriority: legacy.aromaPriority ?? "medium",
    notes: legacy.notes,
    updatedAt: legacy.updatedAt ?? new Date().toISOString(),
  };
  return out;
}

export interface Bean {
  id: string;
  name: string;
  origin: string;
  process: string;
  roastLevel: string;
  /** Coffee variety/cultivar, e.g. 瑰夏, SL28, 铁皮卡. */
  variety?: string;
  /** Package weight in grams (e.g. 250g bag). */
  packageWeightG?: number;
  /** Remaining grams in the current bag (auto-decremented per brew; reset by 开新袋). */
  remainingG?: number;
  /** True when the current bag is finished (喝完了). Cleared by 开新袋. */
  finished?: boolean;
  altitude?: string;
  flavorNotes?: string;
  roastDate?: string;
  /** Optional: date the package was opened (YYYY/MM/DD). Drives open-aging track. */
  openedDate?: string;
  /** Roaster's reference grind, e.g. "C40 18" or "800um". Convert to Studio level via knowledge base §11. */
  referenceGrind?: string;
  /** How many brews have been recorded for this bean (auto-updated by save_history). */
  brewCount?: number;
  /** ISO timestamp of the most recent recorded brew. */
  lastBrewedAt?: string;
  /** Rating (1-5) of the most recent brew with a rating. */
  lastRating?: number;
  /** True when the bean was auto-created from a cloud recipe name (可删除的后悔药). */
  auto?: boolean;
  addedAt: string;
}

/** Structured feedback (one cup). All dimensions are optional — skip what you can't taste. */
export interface Feedback {
  /** Overall cup score 1-5. */
  rating?: number;
  /** 酸: "weak" | "ok" | "strong" */
  acidity?: string;
  /** 涩: "weak" | "ok" | "strong" */
  astringency?: string;
  /** 苦: "weak" | "ok" | "strong" */
  bitterness?: string;
  /** body 口感: "light"(清爽) | "medium"(适中) | "heavy"(厚重) */
  body?: string;
  /** 香气: "none"(没闻到) | "light"(淡) | "strong"(明显) */
  aroma?: string;
  /** Optional aroma type, e.g. 花香/果香/坚果/焦糖/发酵酒香. */
  aromaType?: string;
  /** 卡粉 (stalled/clogged brew): true when flagged. */
  stalled?: boolean;
  /** Optional free-text note. */
  note?: string;
  /** User asked for parameter iteration suggestions. */
  wantIteration?: boolean;
}

export interface HistoryEntry {
  id: string;
  beanId?: string;
  beanName?: string;
  recipeName: string;
  recipeId?: number;
  params: {
    dose_g: number;
    ratio: number;
    grind_size: number;
    grind_rpm: number;
    pours: Array<{
      volume_ml: number;
      temperature_c: number;
      pattern: string;
      flow_rate: number;
      pause_seconds: number;
      agitate_before?: boolean;
      agitate_after?: boolean;
    }>;
  };
  /** Where the record came from: cloud sync or manual entry. */
  source?: "cloud" | "manual";
  /** Cloud record id when source is cloud (dedupe key). */
  cloudRecordId?: number;
  /** Recipe version snapshot (web loop state). */
  version?: number;
  /** Structured one-cup feedback. */
  taste?: Feedback;
  /** Legacy free-text feedback (kept for compatibility). */
  feedback?: string;
  /** Legacy rating 1-10 (kept for compatibility; new entries use taste.rating 1-5). */
  rating?: number;
  brewedAt: string;
}

export interface WaterProfile {
  tds?: number;
  calcium?: number;
  magnesium?: number;
  alkalinity?: number;
  ph?: number;
  source: string;
  updatedAt: string;
}

export async function getConfig(): Promise<XBloomConfig | null> {
  return readJson<XBloomConfig>("config.json");
}

export async function saveConfig(config: XBloomConfig): Promise<void> {
  await writeJson("config.json", config);
}

export async function getPreferences(): Promise<Preferences | null> {
  return readJson<Preferences>("preferences.json");
}

export async function savePreferences(prefs: Preferences): Promise<void> {
  await writeJson("preferences.json", prefs);
}

export async function getBeans(): Promise<Bean[]> {
  return (await readJson<Bean[]>("beans.json")) ?? [];
}

export async function saveBeans(beans: Bean[]): Promise<void> {
  await writeJson("beans.json", beans);
}

export interface BeanStatsUpdate {
  brewedAt: string;
  rating?: number;
  /** Count a new brew (default true). Set false when only rating/feedback is updated. */
  increment?: boolean;
}

export async function updateBeanStats(beanId: string, opts: BeanStatsUpdate): Promise<Bean | null> {
  const beans = await getBeans();
  const bean = beans.find((b) => b.id === beanId);
  if (!bean) return null;
  if (opts.increment !== false) {
    bean.brewCount = (bean.brewCount ?? 0) + 1;
  }
  bean.lastBrewedAt = opts.brewedAt;
  if (opts.rating !== undefined) {
    bean.lastRating = opts.rating;
  }
  await saveBeans(beans);
  return bean;
}

export async function getHistory(): Promise<HistoryEntry[]> {
  return (await readJson<HistoryEntry[]>("history.json")) ?? [];
}

export async function saveHistory(history: HistoryEntry[]): Promise<void> {
  await writeJson("history.json", history);
}

export async function getWater(): Promise<WaterProfile | null> {
  return readJson<WaterProfile>("water.json");
}

export async function saveWater(water: WaterProfile): Promise<void> {
  await writeJson("water.json", water);
}
