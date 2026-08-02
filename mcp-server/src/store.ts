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
  acidity: string;
  sweetness: string;
  body: string;
  strength: string;
  notes: string;
  updatedAt: string;
}

export interface Bean {
  id: string;
  name: string;
  origin: string;
  process: string;
  roastLevel: string;
  altitude?: string;
  flavorNotes?: string;
  roastDate?: string;
  /** Roaster's reference grind, e.g. "C40 18" or "800um". Convert to Studio level via knowledge base §11. */
  referenceGrind?: string;
  /** How many brews have been recorded for this bean (auto-updated by save_history). */
  brewCount?: number;
  /** ISO timestamp of the most recent recorded brew. */
  lastBrewedAt?: string;
  /** Rating (1-10) of the most recent brew with a rating. */
  lastRating?: number;
  addedAt: string;
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
    }>;
  };
  feedback?: string;
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
