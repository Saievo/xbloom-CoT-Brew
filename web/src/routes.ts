import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import * as api from "../../mcp-server/dist/xbloom-api.js";
import * as store from "../../mcp-server/dist/store.js";
import {
  db,
  getBrewRecord,
  listBrewRecords as listBrewRows,
  listMappings,
  listSuggestions,
  getSuggestion,
  createSuggestion,
  finishSuggestion,
  markSuggestionStatus,
  setRecipeBeanMapping,
  deleteRecipeMapping,
  deleteBeanAssociations,
  getRecipeBeanMapping,
  getRecipeChat,
  upsertRecipeChat,
  nextRecipeVersion,
  addRecipeVersion,
  listRecipeVersions,
} from "./db.js";
import { syncCloudRecords, listPendingFeedback } from "./sync.js";
import { generateRecipeJob, suggestionJob, chatJob, buildRecipeChatPrompt, streamRecipeChat, getJob, extractJson } from "./hermes.js";

interface RecipePushArgs {
  name: string;
  dose_g: number;
  ratio: number;
  grind_size: number;
  grind_rpm: number;
  pours: Array<{
    volume_ml?: number;
    temperature_c?: number;
    pattern?: string;
    flow_rate?: number;
    pause_seconds?: number;
    agitate_before?: boolean;
    agitate_after?: boolean;
  }>;
  color?: string;
}

function parseTableId(text: string): number {
  const m = text.match(/ID:\s*(\d+)/);
  if (!m) throw new Error(`无法从响应解析配方 ID：${text.slice(0, 120)}`);
  return Number(m[1]);
}

const PATTERN_CODE: Record<string, number> = { centered: 1, spiral: 2, circular: 3 };
const PATTERN_REV: Record<number, string> = { 1: "centered", 2: "spiral", 3: "circular" };

function cloudToParams(cloud: api.CloudRecipe): store.HistoryEntry["params"] {
  return {
    dose_g: cloud.dose,
    ratio: cloud.ratio,
    grind_size: cloud.grindSize,
    grind_rpm: cloud.rpm,
    pours: cloud.pourList.map((p) => ({
      volume_ml: p.volume,
      temperature_c: p.temperature,
      pattern: PATTERN_REV[p.pattern] ?? "circular",
      flow_rate: p.flowRate,
      pause_seconds: p.pausing,
      agitate_before: p.agitateBefore,
      agitate_after: p.agitateAfter,
    })),
  };
}

function applyDeltas(
  params: store.HistoryEntry["params"],
  pours: store.HistoryEntry["params"]["pours"],
  deltas: Array<Record<string, unknown>>,
): void {
  for (const delta of deltas) {
    const param = String(delta.param);
    const to = delta.to;
    const pourIdxMatch = param.match(/^pours\[(\d+)\]\.(\w+)$/);
    if (pourIdxMatch) {
      const idx = Number(pourIdxMatch[1]);
      const field = pourIdxMatch[2];
      if (pours[idx]) (pours[idx] as Record<string, unknown>)[field] = to;
    } else if (param === "pours") {
      let arr: unknown = to;
      if (typeof to === "string") {
        try {
          arr = JSON.parse(to);
        } catch {
          arr = null;
        }
      }
      if (Array.isArray(arr)) {
        arr.forEach((v, idx) => {
          const target = pours[idx];
          if (!target) return;
          if (typeof v === "number") {
            (target as Record<string, unknown>).volume_ml = v;
          } else if (v && typeof v === "object") {
            for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
              if (k !== "from" && k !== "to") (target as Record<string, unknown>)[k] = val;
            }
          }
        });
      }
    } else if (param === "grind_size" || param === "grind_rpm" || param === "dose_g" || param === "ratio") {
      if (typeof to === "number") (params as Record<string, unknown>)[param] = to;
    } else if (param === "temperature_c" || param === "flow_rate" || param === "pause_seconds" || param === "pattern") {
      for (const p of pours) (p as Record<string, unknown>)[param] = to;
    }
  }
}

function extractAdjust(text: string): {
  text: string;
  adjust: { deltas?: Array<Record<string, unknown>>; summary?: string; basedOn?: store.HistoryEntry["params"] } | null;
} {
  const idx = text.indexOf('{"__adjust"');
  if (idx < 0) return { text, adjust: null };
  let depth = 0;
  let end = -1;
  for (let i = idx; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return { text, adjust: null };
  const raw = text.slice(idx, end + 1);
  try {
    const parsed = JSON.parse(raw) as { __adjust?: { deltas?: Array<Record<string, unknown>>; summary?: string } };
    if (parsed.__adjust) {
      return { text: (text.slice(0, idx) + text.slice(end + 1)).trim(), adjust: parsed.__adjust };
    }
  } catch {
    // fall through
  }
  return { text, adjust: null };
}

/** 云端配方 vs 本地快照的差异清单（空数组=一致）。 */
function recipeDiff(cloud: api.CloudRecipe, params: store.HistoryEntry["params"]): string[] {
  const diffs: string[] = [];
  const num = (a: number, b: number) => Math.abs(a - b) > 0.01;
  const fmt = (label: string, a: number | string, b: number | string) => `${label} 云端=${a} 本地=${b}`;
  if (num(cloud.dose, params.dose_g)) diffs.push(fmt("粉量", cloud.dose, params.dose_g));
  if (num(cloud.ratio, params.ratio)) diffs.push(fmt("比例", cloud.ratio, params.ratio));
  if (num(cloud.grindSize, params.grind_size)) diffs.push(fmt("研磨", cloud.grindSize, params.grind_size));
  if (num(cloud.rpm, params.grind_rpm)) diffs.push(fmt("转速", cloud.rpm, params.grind_rpm));
  const cp = cloud.pourList;
  const lp = params.pours;
  if (cp.length !== lp.length) {
    diffs.push(`段数 云端=${cp.length} 本地=${lp.length}`);
  } else {
    for (let i = 0; i < cp.length; i++) {
      const c = cp[i];
      const l = lp[i];
      if (num(c.volume, l.volume_ml)) diffs.push(fmt(`第${i + 1}段水量`, c.volume, l.volume_ml));
      if (num(c.temperature, l.temperature_c)) diffs.push(fmt(`第${i + 1}段水温`, c.temperature, l.temperature_c));
      if (num(c.flowRate, l.flow_rate)) diffs.push(fmt(`第${i + 1}段流速`, c.flowRate, l.flow_rate));
      if (num(c.pausing, l.pause_seconds)) diffs.push(fmt(`第${i + 1}段暂停`, c.pausing, l.pause_seconds));
      if (PATTERN_CODE[l.pattern] !== c.pattern) diffs.push(`第${i + 1}段 pattern 不一致`);
    }
  }
  return diffs;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // --- status ---
  app.get("/api/status", async () => {
    const config = await store.getConfig();
    const history = await store.getHistory();
    return {
      ok: true,
      loggedIn: !!config,
      beanCount: (await store.getBeans()).length,
      historyCount: history.length,
      pendingCount: history.filter((h) => h.source === "cloud" && !h.taste).length,
      hermesAvailable: !!(await findHermes()),
    };
  });

  app.post("/api/login", async (req) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    if (!email || !password) throw new Error("请输入邮箱和密码");
    const creds = await api.login(email, password);
    await store.saveConfig(creds);
    return { ok: true, email: creds.email };
  });

  // --- beans ---
  app.get("/api/beans", async () => store.getBeans());

  app.post("/api/beans", async (req) => {
    const body = req.body as Record<string, unknown>;
    const beans = await store.getBeans();
    const requestedId = (body.id as string | undefined) ?? `bean_${Date.now()}`;
    const idx = beans.findIndex((b) => b.id === requestedId);
    const existing = idx >= 0 ? beans[idx] : null;
    const bean: store.Bean = {
      ...(existing ?? ({} as store.Bean)),
      ...(body as Partial<store.Bean>),
      id: requestedId,
      addedAt: existing?.addedAt ?? new Date().toISOString(),
    };
    if (bean.packageWeightG != null && bean.remainingG == null) bean.remainingG = bean.packageWeightG;
    if (idx >= 0) beans[idx] = bean;
    else beans.push(bean);
    await store.saveBeans(beans);
    return { ok: true, bean };
  });

  app.delete("/api/beans/:id", async (req) => {
    const { id } = req.params as { id: string };
    const beans = await store.getBeans();
    await store.saveBeans(beans.filter((b) => b.id !== id));
    deleteBeanAssociations(id);
    return { ok: true };
  });

  app.post("/api/beans/:id/refill", async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { packageWeightG?: number };
    const beans = await store.getBeans();
    const bean = beans.find((b) => b.id === id);
    if (!bean) throw new Error("豆子不存在");
    if (body.packageWeightG != null) bean.packageWeightG = body.packageWeightG;
    if (bean.packageWeightG == null) throw new Error("请填写新袋容量（克重）");
    bean.remainingG = bean.packageWeightG;
    bean.finished = false;
    if (!bean.openedDate) bean.openedDate = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
    await store.saveBeans(beans);
    return { ok: true, bean };
  });

  app.post("/api/beans/:id/finish", async (req) => {
    const { id } = req.params as { id: string };
    const beans = await store.getBeans();
    const bean = beans.find((b) => b.id === id);
    if (!bean) throw new Error("豆子不存在");
    bean.finished = true;
    bean.remainingG = 0;
    await store.saveBeans(beans);
    return { ok: true, bean };
  });

  // --- preferences ---
  app.get("/api/preferences", async () => {
    const prefs = await store.getPreferences();
    return store.normalizePreferences(prefs);
  });

  app.post("/api/preferences", async (req) => {
    const current = await store.getPreferences();
    const merged = {
      ...store.normalizePreferences(current),
      ...(req.body as Record<string, unknown>),
      updatedAt: new Date().toISOString(),
    };
    await store.savePreferences(merged as store.Preferences);
    return { ok: true, preferences: merged };
  });

  // --- cloud sync ---
  app.post("/api/sync", async () => syncCloudRecords());

  // --- history / pending / records ---
  app.get("/api/history", async (req) => {
    const { beanId } = req.query as { beanId?: string };
    const history = await store.getHistory();
    const rows = new Map(listBrewRows().map((r) => [r.cloud_record_id, r]));
    return history
      .filter((h) => !beanId || h.beanId === beanId)
      .sort((a, b) => (a.brewedAt < b.brewedAt ? 1 : -1))
      .map((h) => {
        const row = h.cloudRecordId != null ? rows.get(h.cloudRecordId) : null;
        return {
          ...h,
          stallHint: row?.stall_hint === 1,
          expectedTime: row?.expected_time_s ?? null,
          brewTime: row?.brew_time_s ?? null,
        };
      });
  });

  app.get("/api/pending", async () => listPendingFeedback());

  app.get("/api/records", async () => listBrewRows());

  app.get("/api/mappings", async () => listMappings());

  // --- feedback ---
  app.post("/api/feedback", async (req) => {
    const body = req.body as {
      historyId?: string;
      cloudRecordId?: number;
      beanId?: string;
      taste: store.Feedback;
    };
    const history = await store.getHistory();
    const idx = history.findIndex((h) =>
      body.historyId ? h.id === body.historyId : h.cloudRecordId === body.cloudRecordId,
    );
    if (idx < 0) throw new Error("冲泡记录不存在，请先同步云端");
    const entry = history[idx];
    entry.taste = body.taste;
    entry.feedback = body.taste.note ?? entry.feedback;
    if (body.beanId) {
      entry.beanId = body.beanId;
      entry.beanName = (await store.getBeans()).find((b) => b.id === body.beanId)?.name;
    }
    history[idx] = entry;
    await store.saveHistory(history);
    if (entry.beanId) {
      await store.updateBeanStats(entry.beanId, {
        brewedAt: entry.brewedAt,
        rating: body.taste.rating,
        increment: false,
      });
    }
    let suggestionId: number | null = null;
    if (body.taste.wantIteration && entry.beanId) {
      suggestionId = createSuggestion(entry.beanId, entry.id, entry.cloudRecordId ?? null);
      const bean = (await store.getBeans()).find((b) => b.id === entry.beanId);
      const jobId = suggestionJob(entry, bean, history);
      void pollSuggestionJob(jobId, suggestionId);
    }
    return { ok: true, entry, suggestionId };
  });

  async function pollSuggestionJob(jobId: string, suggestionId: number): Promise<void> {
    while (true) {
      await new Promise((r) => setTimeout(r, 3000));
      const job = getJob(jobId);
      if (!job || job.status === "running") continue;
      if (job.status === "done") {
        const parsed = extractJson<{ deltas?: unknown[]; summary?: string }>(job.result ?? "");
        finishSuggestion(suggestionId, parsed ? JSON.stringify(parsed) : job.result ?? null, null);
      } else {
        finishSuggestion(suggestionId, null, job.error ?? "未知错误");
      }
      return;
    }
  }

  // --- bean assignment / ignore ---
  app.post("/api/assign-bean", async (req) => {
    const { cloudRecordId, beanId } = req.body as { cloudRecordId: number; beanId: string };
    const row = getBrewRecord(cloudRecordId);
    if (!row) throw new Error("云端记录不存在");
    const beans = await store.getBeans();
    const bean = beans.find((b) => b.id === beanId);
    if (!bean) throw new Error("豆子不存在");
    if (row.recipe_id) setRecipeBeanMapping(row.recipe_id, beanId, row.recipe_name);
    const history = await store.getHistory();
    const idx = history.findIndex((h) => h.cloudRecordId === cloudRecordId);
    if (idx >= 0) {
      history[idx].beanId = beanId;
      history[idx].beanName = bean.name;
      await store.saveHistory(history);
    }
    return { ok: true };
  });

  app.post("/api/ignore-record", async (req) => {
    const { cloudRecordId } = req.body as { cloudRecordId: number };
    const history = await store.getHistory();
    const idx = history.findIndex((h) => h.cloudRecordId === cloudRecordId);
    if (idx >= 0 && !history[idx].taste) {
      history.splice(idx, 1);
      await store.saveHistory(history);
    }
    db.prepare("UPDATE brew_records SET status = 'ignored', updated_at = ? WHERE cloud_record_id = ?").run(
      new Date().toISOString(),
      cloudRecordId,
    );
    return { ok: true };
  });

  // --- suggestions ---
  app.get("/api/suggestions", async (req) => {
    const { beanId } = req.query as { beanId?: string };
    return listSuggestions(beanId);
  });

  app.get("/api/suggestions/:id", async (req) => {
    const { id } = req.params as { id: string };
    const row = getSuggestion(Number(id));
    if (!row) throw new Error("建议不存在");
    if (row.content) row.content = JSON.parse(row.content as string);
    return row;
  });

  app.post("/api/suggestions/:id/ignore", async (req) => {
    const { id } = req.params as { id: string };
    markSuggestionStatus(Number(id), "ignored");
    return { ok: true };
  });

  app.post("/api/suggestions/:id/apply", async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { force?: boolean };
    const row = getSuggestion(Number(id));
    if (!row) throw new Error("建议不存在");
    if (row.status === "running") throw new Error("建议还在生成中");
    if (row.status === "applied") throw new Error("该建议已应用过");
    const content = row.content ? JSON.parse(row.content as string) : null;
    if (!content?.deltas?.length) throw new Error("没有可应用的调整项");
    const history = await store.getHistory();
    const entry = history.find((h) => h.id === row.history_id || h.cloudRecordId === row.record_id);
    if (!entry?.recipeId || !entry.beanId) throw new Error("找不到关联配方或豆子");

    let params = entry.params;
    const pours = params.pours.map((p) => ({ ...p }));
    applyDeltas(params, pours, content.deltas as Array<Record<string, unknown>>);

    const creds = await store.getConfig();
    if (!creds) throw new Error("Not logged in");
    // Q7 契约：apply 前校验云端当前配方，防止覆盖 App 手动修改
    const cloudRecipes = await api.listRecipesData(creds);
    const cloud = cloudRecipes.find((r) => r.tableId === entry.recipeId);
    if (!cloud) {
      throw new Error("云端找不到该配方（可能已被删除），已中止应用");
    }
    const diffs = recipeDiff(cloud, entry.params);
    if (diffs.length && !body.force) {
      throw new Error(
        `云端配方与本地快照不一致（${diffs.slice(0, 4).join("；")}${diffs.length > 4 ? "…" : ""}）。可能是 App 手动修改过——为避免覆盖，已中止。请先同步最新冲泡记录，或基于云端最新参数重新生成建议。`,
      );
    }
    if (body.force) {
      params = cloudToParams(cloud);
      pours.length = 0;
      pours.push(...params.pours.map((p) => ({ ...p })));
      applyDeltas(params, pours, content.deltas as Array<Record<string, unknown>>);
    }
    await api.editRecipe(creds, {
      recipe_id: entry.recipeId,
      name: entry.recipeName,
      dose_g: params.dose_g,
      ratio: params.ratio,
      grind_size: params.grind_size,
      grind_rpm: params.grind_rpm,
      pours: pours.map((p) => ({
        volume_ml: p.volume_ml,
        temperature_c: p.temperature_c,
        pattern: p.pattern as "centered" | "spiral" | "circular",
        flow_rate: p.flow_rate,
        pause_seconds: p.pause_seconds,
        agitate_before: p.agitate_before,
        agitate_after: p.agitate_after,
      })),
    });
    const version = nextRecipeVersion(entry.recipeId);
    addRecipeVersion(entry.beanId, entry.recipeId, version, { ...params, pours }, "suggestion");
    markSuggestionStatus(Number(id), "applied", version);
    return { ok: true, version };
  });

  // --- cloud recipe management (Q8) ---
  app.get("/api/cloud-recipes", async () => {
    const creds = await store.getConfig();
    if (!creds) throw new Error("Not logged in");
    const recipes = await api.listRecipesData(creds);
    const mappings = new Map(listMappings().map((m) => [m.recipe_id, m.bean_id]));
    const beans = await store.getBeans();
    return recipes.map((r) => {
      const beanId = mappings.get(r.tableId) ?? null;
      return {
        tableId: r.tableId,
        name: r.name,
        dose: r.dose,
        ratio: r.ratio,
        grindSize: r.grindSize,
        rpm: r.rpm,
        pourCount: r.pourList.length,
        shareLink: r.shareLink ?? null,
        beanId,
        beanName: beanId ? (beans.find((b) => b.id === beanId)?.name ?? null) : null,
      };
    });
  });

  app.delete("/api/cloud-recipes/:id", async (req) => {
    const { id } = req.params as { id: string };
    const creds = await store.getConfig();
    if (!creds) throw new Error("Not logged in");
    const text = await api.deleteRecipe(creds, Number(id));
    deleteRecipeMapping(Number(id));
    return { ok: true, message: text };
  });

  app.get("/api/cloud-recipes/:id", async (req) => {
    const recipeId = Number((req.params as { id: string }).id);
    const creds = await store.getConfig();
    if (!creds) throw new Error("Not logged in");
    const recipes = await api.listRecipesData(creds);
    const cloud = recipes.find((r) => r.tableId === recipeId);
    if (!cloud) throw new Error("云端找不到该配方");
    return cloud;
  });

  app.post("/api/cloud-recipes/:id/edit", async (req) => {
    const recipeId = Number((req.params as { id: string }).id);
    const body = (req.body ?? {}) as {
      params: {
        name?: string;
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
    };
    if (!body.params) throw new Error("缺少配方参数");
    const creds = await store.getConfig();
    if (!creds) throw new Error("Not logged in");
    const recipes = await api.listRecipesData(creds);
    const cloud = recipes.find((r) => r.tableId === recipeId);
    if (!cloud) throw new Error("云端找不到该配方");
    await api.editRecipe(creds, {
      recipe_id: recipeId,
      name: body.params.name ?? cloud.name,
      dose_g: body.params.dose_g,
      ratio: body.params.ratio,
      grind_size: body.params.grind_size,
      grind_rpm: body.params.grind_rpm,
      pours: body.params.pours,
    });
    const version = nextRecipeVersion(recipeId);
    const mapping = getRecipeBeanMapping(recipeId);
    if (mapping?.bean_id) addRecipeVersion(mapping.bean_id, recipeId, version, body.params, "manual-edit");
    return { ok: true, version };
  });

  // --- recipe generation / push ---
  app.post("/api/recipes/generate", async (req) => {
    const { beanId, mode } = req.body as { beanId: string; mode: "hot" | "iced" };
    const bean = (await store.getBeans()).find((b) => b.id === beanId);
    if (!bean) throw new Error("豆子不存在");
    const jobId = generateRecipeJob(bean, mode);
    return { jobId };
  });

  app.get("/api/jobs/:id", async (req) => {
    const { id } = req.params as { id: string };
    const job = getJob(id);
    if (!job) throw new Error("任务不存在或已过期");
    return { ...job, result: job.status === "done" ? extractJson<unknown>(job.result ?? "") : job.result };
  });

  app.post("/api/recipes/push", async (req) => {
    const body = req.body as { beanId: string; recipe: RecipePushArgs };
    const creds = await store.getConfig();
    if (!creds) throw new Error("Not logged in");
    const text = await api.createRecipe(creds, body.recipe);
    const tableId = parseTableId(text);
    setRecipeBeanMapping(tableId, body.beanId, body.recipe.name);
    const version = nextRecipeVersion(tableId);
    addRecipeVersion(body.beanId, tableId, version, body.recipe, "push");
    return { ok: true, tableId, message: text, version };
  });

  // --- chat ---
  app.post("/api/chat", async (req) => {
    const { message } = req.body as { message: string };
    if (!message?.trim()) throw new Error("消息不能为空");
    return { jobId: chatJob(message.trim()) };
  });

  // --- per-recipe AI chat ---

  app.get("/api/chat/:recipeId", async (req) => {
    const recipeId = Number((req.params as { recipeId: string }).recipeId);
    const chat = getRecipeChat(recipeId);
    return {
      recipeId,
      recipeName: chat?.recipe_name ?? null,
      beanId: chat?.bean_id ?? null,
      messages: chat?.messages ?? [],
      pendingAdjust: chat?.pending_adjust ? JSON.parse(chat.pending_adjust) : null,
    };
  });

  app.post("/api/chat/:recipeId/message", async (req) => {
    const recipeId = Number((req.params as { recipeId: string }).recipeId);
    const { message } = (req.body ?? {}) as { message?: string };
    if (!message?.trim()) throw new Error("消息不能为空");

    const chat = getRecipeChat(recipeId);
    const messages = [...(chat?.messages ?? [])];
    messages.push({ role: "user", text: message.trim(), ts: new Date().toISOString() });

    let beanId: string | null = null;
    let recipeName = "全局对话";
    let prompt: string;
    let promptParams: store.HistoryEntry["params"] | null = null;

    if (recipeId === 0) {
      // 全局对话：注入对话历史，让模型延续上下文（不绑定配方）
      const historyLines = messages
        .slice(0, -1)
        .map((m) => `${m.role === "user" ? "用户" : "AI"}：${m.text}`)
        .join("\n");
      prompt = `你是这个项目（XBLOOM loop）的助手。请延续对话，自然回答，不要调用工具。\n\n对话历史：\n${historyLines || "（无）"}\n\n用户最新提问：${message.trim()}`;
    } else {
      const creds = await store.getConfig();
      if (!creds) throw new Error("Not logged in");
      const cloudRecipes = await api.listRecipesData(creds);
      const cloud = cloudRecipes.find((r) => r.tableId === recipeId) ?? null;
      const history = await store.getHistory();
      const lastEntry = history.filter((h) => h.recipeId === recipeId).sort((a, b) => (a.brewedAt < b.brewedAt ? 1 : -1))[0];
      promptParams = cloud ? cloudToParams(cloud) : (lastEntry?.params ?? null);
      recipeName = cloud?.name ?? lastEntry?.recipeName ?? `配方 ${recipeId}`;
      const beans = await store.getBeans();
      const mapping = getRecipeBeanMapping(recipeId);
      if (mapping?.bean_id) beanId = mapping.bean_id;
      else if (lastEntry?.beanId) beanId = lastEntry.beanId;
      const bean = beanId ? (beans.find((b) => b.id === beanId) ?? null) : null;
      prompt = buildRecipeChatPrompt({
        recipeId,
        recipeName,
        bean,
        params: promptParams,
        messages: messages.slice(0, -1).map((m) => ({ role: m.role, text: m.text })),
        userMessage: message.trim(),
      });
    }
    upsertRecipeChat(recipeId, beanId, recipeName, messages, chat?.pending_adjust ?? null);

    const streamId = randomUUID();
    chatStreams.set(streamId, { events: [], done: false, listeners: [] });
    const controller = new AbortController();
    chatStreams.get(streamId)!.cancel = () => controller.abort();
    let cancelled = false;
    void (async () => {
      let full = "";
      let thought = "";
      try {
        await streamRecipeChat(prompt, {
          onDelta: (t) => {
            full += t;
            pushChatStream(streamId, "delta", t);
          },
          onThought: (t) => {
            thought += t;
            pushChatStream(streamId, "thought", t);
          },
          onDone: async (text, thoughtText) => {
            if (cancelled) return;
            full = text && text !== "（空回复）" ? text : full;
            void thoughtText;
            await finalizeChatAiReply(recipeId, full, null, promptParams);
            pushChatStream(streamId, "done", full);
            markChatStreamDone(streamId);
          },
          onCancel: () => {
            cancelled = true;
            markChatStreamDone(streamId);
            pushChatStream(streamId, "cancelled", null);
          },
          onError: async (err) => {
            if (cancelled) return;
            await finalizeChatAiReply(recipeId, "", err, promptParams);
            pushChatStream(streamId, "error", err);
            markChatStreamDone(streamId);
          },
        }, controller.signal);
      } catch (e) {
        if (cancelled) return;
        const err = e instanceof Error ? e.message : String(e);
        await finalizeChatAiReply(recipeId, "", err, promptParams);
        pushChatStream(streamId, "error", err);
        markChatStreamDone(streamId);
      }
    })();
    return { streamId };
  });

  app.post("/api/chat/:recipeId/stop/:streamId", async (req) => {
    const streamId = (req.params as { streamId: string }).streamId;
    const s = chatStreams.get(streamId);
    if (!s) throw new Error("对话流不存在或已结束");
    s.cancel?.();
    return { ok: true };
  });

  app.get("/api/chat/:recipeId/stream/:streamId", async (req, reply) => {
    const streamId = (req.params as { streamId: string }).streamId;
    const s = chatStreams.get(streamId);
    if (!s) throw new Error("对话流不存在或已过期");
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    reply.raw.write("retry: 3000\n\n");
    let ended = false;
    const timer = setInterval(() => {
      if (!reply.raw.writableEnded) reply.raw.write(": ping\n\n");
    }, 15000);
    const send = (e: { type: string; data: string }) => {
      if (ended) return;
      reply.raw.write(`event: ${e.type}\ndata: ${e.data}\n\n`);
      if (e.type === "done" || e.type === "error") {
        ended = true;
        clearInterval(timer);
        reply.raw.end();
      }
    };
    for (const e of s.events) send(e);
    if (s.done) {
      clearInterval(timer);
      if (!reply.raw.writableEnded) reply.raw.end();
      return;
    }
    s.listeners.push(send);
    req.raw.on("close", () => {
      clearInterval(timer);
      s.listeners = s.listeners.filter((l) => l !== send);
    });
  });

  app.post("/api/chat/:recipeId/apply-adjust", async (req) => {
    const recipeId = Number((req.params as { recipeId: string }).recipeId);
    const body = (req.body ?? {}) as { force?: boolean };
    const chat = getRecipeChat(recipeId);
    if (!chat?.pending_adjust) throw new Error("没有待保存的调整");
    const adjust = JSON.parse(chat.pending_adjust) as {
      deltas?: Array<Record<string, unknown>>;
      summary?: string;
      basedOn?: store.HistoryEntry["params"];
    };
    const creds = await store.getConfig();
    if (!creds) throw new Error("Not logged in");
    const cloudRecipes = await api.listRecipesData(creds);
    const cloud = cloudRecipes.find((r) => r.tableId === recipeId);
    if (!cloud) throw new Error("云端找不到该配方（可能已被删除）");
    if (adjust.basedOn) {
      const diffs = recipeDiff(cloud, adjust.basedOn);
      if (diffs.length && !body.force) {
        throw new Error(
          `云端参数与方案生成时不一致（${diffs.slice(0, 3).join("；")}${diffs.length > 3 ? "…" : ""}）。建议基于最新参数重新生成；仍要按方案目标值应用请重试并确认。`,
        );
      }
    }
    const params = cloudToParams(cloud);
    const pours = params.pours.map((p) => ({ ...p }));
    applyDeltas(params, pours, adjust.deltas ?? []);
    await api.editRecipe(creds, {
      recipe_id: recipeId,
      name: cloud.name,
      dose_g: params.dose_g,
      ratio: params.ratio,
      grind_size: params.grind_size,
      grind_rpm: params.grind_rpm,
      pours: pours.map((p) => ({
        volume_ml: p.volume_ml,
        temperature_c: p.temperature_c,
        pattern: p.pattern as "centered" | "spiral" | "circular",
        flow_rate: p.flow_rate,
        pause_seconds: p.pause_seconds,
        agitate_before: p.agitate_before,
        agitate_after: p.agitate_after,
      })),
    });
    const version = nextRecipeVersion(recipeId);
    if (chat.bean_id) addRecipeVersion(chat.bean_id, recipeId, version, { ...params, pours }, "chat-adjust");
    upsertRecipeChat(recipeId, chat.bean_id, chat.recipe_name, chat.messages, null);
    return { ok: true, version };
  });

  app.post("/api/chat/:recipeId/ignore-adjust", async (req) => {
    const recipeId = Number((req.params as { recipeId: string }).recipeId);
    const chat = getRecipeChat(recipeId);
    if (!chat) throw new Error("对话不存在");
    upsertRecipeChat(recipeId, chat.bean_id, chat.recipe_name, chat.messages, null);
    return { ok: true };
  });

  app.get("/api/versions", async () => listRecipeVersions());
}

interface ChatStreamEntry {
  events: Array<{ type: string; data: string }>;
  done: boolean;
  listeners: Array<(e: { type: string; data: string }) => void>;
  cancel?: () => void;
}

const chatStreams = new Map<string, ChatStreamEntry>();

function pushChatStream(streamId: string, type: string, data: unknown): void {
  const s = chatStreams.get(streamId);
  if (!s) return;
  const e = { type, data: JSON.stringify(data) };
  s.events.push(e);
  for (const l of [...s.listeners]) l(e);
}

function markChatStreamDone(streamId: string): void {
  const s = chatStreams.get(streamId);
  if (s) s.done = true;
}

async function finalizeChatAiReply(
  recipeId: number,
  text: string,
  error: string | null,
  basedOn?: store.HistoryEntry["params"] | null,
): Promise<void> {
  const chat = getRecipeChat(recipeId);
  const messages = [...(chat?.messages ?? [])];
  const now = new Date().toISOString();
  if (error) {
    messages.push({ role: "ai", text: `（生成失败：${error}）`, ts: now });
    upsertRecipeChat(recipeId, chat?.bean_id ?? null, chat?.recipe_name ?? null, messages, chat?.pending_adjust ?? null);
    return;
  }
  const { text: clean, adjust } = extractAdjust(text);
  if (adjust && basedOn) adjust.basedOn = basedOn;
  messages.push({ role: "ai", text: clean || "（空回复）", adjust, ts: now });
  const pending = adjust ? JSON.stringify(adjust) : (chat?.pending_adjust ?? null);
  upsertRecipeChat(recipeId, chat?.bean_id ?? null, chat?.recipe_name ?? null, messages, pending);
}

async function findHermes(): Promise<string | null> {
  const { existsSync, statSync } = await import("node:fs");
  const path = await import("node:path");
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  dirs.push("/Users/edward/.local/bin");
  for (const dir of dirs) {
    const candidate = path.join(dir, "hermes");
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      // keep scanning
    }
  }
  return null;
}
