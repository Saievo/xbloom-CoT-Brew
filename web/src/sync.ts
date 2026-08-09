import * as api from "../../mcp-server/dist/xbloom-api.js";
import * as store from "../../mcp-server/dist/store.js";
import {
  upsertBrewRecord,
  listBrewRecords as listBrewRows,
  getRecipeBeanMapping,
  setRecipeBeanMapping,
} from "./db.js";

const PATTERN_REV: Record<number, string> = { 1: "centered", 2: "spiral", 3: "circular" };

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s·\-_⭐🧊⚠️:：]+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function expectedSeconds(desired: Record<string, unknown> | null): number {
  if (!desired) return 0;
  const pours = desired.pourList as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(pours)) return 0;
  let total = 0;
  for (const p of pours) {
    const vol = Number(p.volume ?? 0);
    const rate = Number(p.flowRate ?? 3);
    if (rate > 0) total += vol / rate;
    total += Number(p.pausing ?? 0);
  }
  return Math.round(total);
}

export function stallHint(brewTime: number, expected: number): boolean {
  return brewTime > 0 && expected > 0 && brewTime - expected > 45;
}

export function buildParams(desired: Record<string, unknown> | null): store.HistoryEntry["params"] {
  const pours = (desired?.pourList as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    dose_g: Number(desired?.dose ?? 0),
    ratio: Number(desired?.grandWater ?? 0),
    grind_size: Number(desired?.grinderSize ?? 0),
    grind_rpm: Number(desired?.rpm ?? 0),
    pours: pours.map((p) => ({
      volume_ml: Number(p.volume ?? 0),
      temperature_c: Number(p.temperature ?? 0),
      pattern: PATTERN_REV[Number(p.pattern ?? 2)] ?? "circular",
      flow_rate: Number(p.flowRate ?? 3),
      pause_seconds: Number(p.pausing ?? 0),
      agitate_before: Number(p.isEnableVibrationBefore) === 1,
      agitate_after: Number(p.isEnableVibrationAfter) === 1,
    })),
  };
}

function matchBeanByName(recipeName: string, beans: store.Bean[]): store.Bean | null {
  const key = norm(recipeName);
  let best: store.Bean | null = null;
  for (const bean of beans) {
    const beanKey = norm(bean.name);
    if (!beanKey) continue;
    if (key.includes(beanKey) || beanKey.includes(key)) {
      if (!best || bean.name.length > best.name.length) best = bean;
    }
  }
  return best;
}

interface BeanHints {
  name: string;
  origin?: string;
  process?: string;
  roastLevel?: string;
}

const PROCESS_HINTS: Array<[RegExp, string]> = [
  [/日晒/, "natural"],
  [/水洗/, "washed"],
  [/蜜处理/, "honey"],
  [/厌氧/, "anaerobic"],
  [/特殊发酵/, "special_fermented"],
];
const ROAST_HINTS: Array<[RegExp, string]> = [
  [/浅烘/, "light"],
  [/中浅/, "medium-light"],
  [/中烘/, "medium"],
  [/中深/, "medium-dark"],
  [/深烘/, "dark"],
];

/**
 * 从配方名解析豆子：配方名 = 豆名 + 风味/版本后缀（"⭐️ 糖心车厘子2.0 · 日晒 · 冰饮"）。
 * 返回豆名与能确定的产地/处理法/烘焙度提示；无法解析返回 null。
 */
export function parseBeanFromRecipeName(recipeName: string): BeanHints | null {
  const s = recipeName.trim().replace(/^[⭐🧊⚠️\s]+/, "");
  const parts = s.split("·").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const name = parts[0].replace(/\s+v\d+$/i, "").trim();
  if (!name) return null;
  const hints: BeanHints = { name };
  for (const part of parts.slice(1)) {
    for (const [re, v] of PROCESS_HINTS) if (re.test(part)) hints.process = v;
    for (const [re, v] of ROAST_HINTS) if (re.test(part)) hints.roastLevel = v;
  }
  const core = name;
  if (/肯尼亚|Kenya/i.test(core)) hints.origin = "肯尼亚";
  else if (/果丁丁|花魁|樱桃茉莉|白玉兰|Narsha|瑰夏村|耶加|古吉/i.test(core)) hints.origin = "埃塞俄比亚";
  else if (/El Puente|Lerida/i.test(core)) hints.origin = "巴拿马";
  return hints;
}

/** 若豆库没有该配方对应的豆子，则自动建档（豆名取配方名主段）。 */
function ensureBeanFromRecipe(recipeName: string, beans: store.Bean[]): store.Bean | null {
  const hints = parseBeanFromRecipeName(recipeName);
  if (!hints) return null;
  const key = norm(hints.name);
  if (!key) return null;
  for (const b of beans) {
    if (norm(b.name) === key) return b;
  }
  const slug = key.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 40) || "unknown";
  const bean: store.Bean = {
    id: `bean_auto_${slug}`,
    name: hints.name,
    origin: hints.origin ?? "",
    process: hints.process ?? "",
    roastLevel: hints.roastLevel ?? "",
    auto: true,
    addedAt: new Date().toISOString(),
  };
  beans.push(bean);
  return bean;
}

export interface SyncResult {
  total: number;
  created: number;
  updated: number;
  pending: number;
}

export async function syncCloudRecords(): Promise<SyncResult> {
  const creds = await store.getConfig();
  if (!creds) {
    throw new Error("Not logged in — 请先在 Hermes 里用 xbloom_login 登录 XBloom");
  }
  const page = await api.listBrewRecords(creds, { pageNumber: 1, countPerPage: 100 });
  const history = await store.getHistory();
  const beans = await store.getBeans();
  // 只与本次同步之前就存在的"手动推送"记录做配方级去重（12h 内视为同一杯）；
  // 云端记录之间绝不互相合并——同一天同一配方冲两杯就是两条记录。
  const preexisting = [...history];
  const seen = new Set<number>();
  let created = 0;
  let updated = 0;

  for (const rec of page.records) {
    seen.add(rec.recordId);
    const expected = expectedSeconds(rec.desired);
    const stall = stallHint(rec.brewTime, expected) ? 1 : 0;
    const brewedAt = new Date(rec.createTimeStamp).toISOString();

    let beanId: string | null = null;
    const mapping = getRecipeBeanMapping(rec.recipeId);
    if (mapping?.bean_id && beans.some((b) => b.id === mapping.bean_id)) {
      beanId = mapping.bean_id;
    }
    if (!beanId) {
      const matched = matchBeanByName(rec.recipeName, beans) ?? ensureBeanFromRecipe(rec.recipeName, beans);
      if (matched) {
        beanId = matched.id;
        if (rec.recipeId) setRecipeBeanMapping(rec.recipeId, matched.id, rec.recipeName);
      }
    }

    let idx = history.findIndex((h) => h.cloudRecordId === rec.recordId);
    if (idx < 0) {
      const recTs = rec.createTimeStamp;
      idx = preexisting.findIndex(
        (h) => h.recipeId === rec.recipeId && h.source !== "cloud" && h.brewedAt && Math.abs(new Date(h.brewedAt).getTime() - recTs) < 12 * 3600 * 1000,
      );
    }

    let entryId: string;
    let createdNew = false;
    let newDose = 0;
    if (idx < 0) {
      const entry: store.HistoryEntry = {
        id: `brew_${Date.now()}_${rec.recordId}`,
        beanId: beanId ?? undefined,
        beanName: beanId ? beans.find((b) => b.id === beanId)?.name : undefined,
        recipeName: rec.recipeName,
        recipeId: rec.recipeId ?? undefined,
        source: "cloud",
        cloudRecordId: rec.recordId,
        brewedAt,
        params: buildParams(rec.desired),
      };
      history.push(entry);
      entryId = entry.id;
      createdNew = true;
      newDose = Number(entry.params.dose_g ?? 0);
      created += 1;
    } else {
      const existing = history[idx];
      if (!existing.cloudRecordId || !existing.source) {
        existing.cloudRecordId = rec.recordId;
        existing.source = "cloud";
        updated += 1;
      }
      if (beanId && !existing.beanId) {
        existing.beanId = beanId;
        existing.beanName = beans.find((b) => b.id === beanId)?.name;
        updated += 1;
      }
      entryId = existing.id;
    }

    upsertBrewRecord({
      cloud_record_id: rec.recordId,
      brewed_at: brewedAt,
      bean_id: beanId,
      recipe_id: rec.recipeId,
      recipe_name: rec.recipeName,
      brew_time_s: rec.brewTime,
      expected_time_s: expected,
      stall_hint: stall,
      status: "recorded",
      history_id: entryId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (createdNew && beanId && newDose > 0) {
      const bean = beans.find((b) => b.id === beanId);
      if (bean) {
        if (bean.remainingG == null && bean.packageWeightG != null) bean.remainingG = bean.packageWeightG;
        if (bean.remainingG != null) bean.remainingG = Math.max(0, bean.remainingG - newDose);
        if (bean.remainingG != null && bean.remainingG <= 0) bean.finished = true;
      }
    }
  }

  await store.saveHistory(history);
  for (const b of beans) {
    if (b.id.startsWith("bean_auto_")) b.auto = true;
  }
  await store.saveBeans(beans);
  await recomputeBeanStats();
  const pending = countPending(history);
  return { total: page.totalCount, created, updated, pending };
}

/** 从 history.json 幂等重算豆库统计（brewCount / lastBrewedAt / lastRating）。 */
export async function recomputeBeanStats(): Promise<void> {
  const beans = await store.getBeans();
  const history = await store.getHistory();
  const byBean = new Map<string, store.HistoryEntry[]>();
  for (const h of history) {
    if (!h.beanId) continue;
    const list = byBean.get(h.beanId) ?? [];
    list.push(h);
    byBean.set(h.beanId, list);
  }
  for (const bean of beans) {
    const entries = (byBean.get(bean.id) ?? []).sort((a, b) => (a.brewedAt < b.brewedAt ? -1 : 1));
    const rated = entries.filter((e) => e.taste?.rating != null);
    bean.brewCount = entries.length || undefined;
    bean.lastBrewedAt = entries.length ? entries[entries.length - 1].brewedAt : undefined;
    bean.lastRating = rated.length ? rated[rated.length - 1].taste!.rating : undefined;
  }
  await store.saveBeans(beans);
}

export function countPending(history: store.HistoryEntry[]): number {
  const ignored = new Set(listBrewRows().filter((r) => r.status === "ignored").map((r) => r.cloud_record_id));
  return history.filter((h) => h.source === "cloud" && !h.taste && h.cloudRecordId != null && !ignored.has(h.cloudRecordId)).length;
}

export async function listPendingFeedback(): Promise<Array<store.HistoryEntry & { stallHint: boolean; expectedTime: number | null; brewTime: number }>> {
  const history = [...(await store.getHistory())].sort((a, b) => (a.brewedAt < b.brewedAt ? 1 : -1));
  const rows = new Map(listBrewRows().map((r) => [r.cloud_record_id, r]));
  const ignored = new Set(listBrewRows().filter((r) => r.status === "ignored").map((r) => r.cloud_record_id));
  return history
    .filter((h) => h.source === "cloud" && !h.taste && h.cloudRecordId != null && !ignored.has(h.cloudRecordId))
    .map((h) => {
      const row = h.cloudRecordId != null ? rows.get(h.cloudRecordId) : null;
      return {
        ...h,
        stallHint: row?.stall_hint === 1,
        expectedTime: row?.expected_time_s ?? null,
        brewTime: row?.brew_time_s ?? 0,
      };
    });
}
