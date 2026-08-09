import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as store from "../../mcp-server/dist/store.js";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export interface Job {
  id: string;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
  createdAt: string;
}

const jobs = new Map<string, Job>();

export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
}

export function createJob(runner: () => Promise<string>): string {
  const id = randomUUID();
  jobs.set(id, { id, status: "running", createdAt: new Date().toISOString() });
  runner()
    .then((result) => {
      const job = jobs.get(id);
      if (job) job.status = "done", job.result = result;
    })
    .catch((err: unknown) => {
      const job = jobs.get(id);
      if (job) job.status = "error", job.error = err instanceof Error ? err.message : String(err);
    });
  return id;
}

export function runHermesOnce(prompt: string, timeoutMs = 420_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("hermes", ["chat", "-q", prompt, "-Q"], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Hermes 生成超时（7 分钟）"));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`Hermes 退出码 ${code}: ${err.slice(-500) || "无错误输出"}`));
    });
  });
}

export function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // fall through
  }
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(cleaned.slice(first, last + 1)) as T;
    } catch {
      return null;
    }
  }
  return null;
}

export function generateRecipeJob(bean: store.Bean, mode: "hot" | "iced"): string {
  return createJob(async () => {
    const prompt = `你是 XBloom 咖啡配方专家。请为豆库中的豆子设计一个${mode === "iced" ? "冰饮" : "热饮"}配方。\n豆子信息：${JSON.stringify(bean)}\n\n严格按仓库 AGENTS.md 的三步流程执行：\n1) 读 data/xbloom_brewing_knowledge_base.md 推演初始参数（必要时读 data/brewing-reference.md）；\n2) 调 xbloom_list_recipes 对比账号里同类豆子的已有配方；\n3) 输出最终参数。\n${mode === "iced" ? "冰饮必须按知识库第十节从头重构：热水比例约 1:10、研磨比热饮细 6-8 格、水温 +2-3°C、闷蒸 45s、3 段注水。\n" : ""}只输出一个 JSON 对象，不要输出 JSON 以外的任何文字：\n{"name":"豆名+风味/版本后缀","dose_g":15,"ratio":15,"grind_size":50,"grind_rpm":80,"pours":[{"volume_ml":30,"temperature_c":93,"pattern":"centered|spiral|circular","flow_rate":3.0,"pause_seconds":45,"agitate_before":false,"agitate_after":false}],"summary":"推演与已有配方的关键差异点（一句话）"}`;
    return await runHermesOnce(prompt);
  });
}

export function suggestionJob(entry: store.HistoryEntry, bean: store.Bean | undefined, history: store.HistoryEntry[]): string {
  return createJob(async () => {
    const sameBean = history
      .filter((h) => h.beanId && h.beanId === entry.beanId && h.taste)
      .slice(-8);
    const prompt = `你是 XBloom 咖啡配方迭代助手。以下是同一只豆子的冲煮记录与本次反馈，请产出 1-3 条参数调整建议。\n豆子：${JSON.stringify(bean ?? null)}\n本次记录：${JSON.stringify(entry)}\n同豆已有反馈历史：${JSON.stringify(sameBean)}\n\n规则：\n- 卡粉杯次（taste.stalled=true）不参与"苦=过萃"的配方归因，先提示机器/磨豆机问题\n- 每个参数调整必须有豆子特性或萃取科学的实质理由\n- 没有把握就不建议\n\n只输出一个 JSON 对象，不要输出其他文字：\n{"deltas":[{"param":"grind_size","from":50,"to":47,"direction":"finer","reason":"...","expected":"预期效果"}],"summary":"一句话总结"}\n若无需调整，输出 {"deltas":[],"summary":"暂不需要调整"}`;
    return await runHermesOnce(prompt);
  });
}

export function chatJob(message: string): string {
  return createJob(async () => {
    return await runHermesOnce(message);
  });
}

export interface RecipeChatJobOpts {
  recipeId: number;
  recipeName: string;
  bean: store.Bean | null;
  params: store.HistoryEntry["params"] | null;
  messages: Array<{ role: "user" | "ai"; text: string }>;
  userMessage: string;
}

export function buildRecipeChatPrompt(opts: RecipeChatJobOpts): string {
  const history = opts.messages
    .map((m) => `${m.role === "user" ? "用户" : "AI"}：${m.text}`)
    .join("\n");
  return `你是这台 XBloom Studio 的配方顾问，只讨论当前这一个配方，绝不扯其他豆子或其他配方。\n\n配方名：${opts.recipeName}\n豆子资料（唯一权威，缺失字段就标注"未知"，不得臆测）：${JSON.stringify(opts.bean ?? null)}\n当前配方参数（以此为准，勿用对话历史里的旧值）：${JSON.stringify(opts.params ?? null)}\n\n对话历史：\n${history || "（无）"}\n\n用户最新提问：${opts.userMessage}\n\n规则：\n- 只针对这个配方回答、答疑、给建议；需要时可以读仓库 data/ 知识库和 AGENTS.md\n- **不要调用任何工具**，纯文字回答\n- **烘焙度、处理法、豆种等只认"豆子资料"里的值**；资料缺失就标注"未知"并说明，禁止默认假设为日晒/水洗/浅烘等\n- 如果认为应该调整参数，回答末尾附加一个 JSON 块（不要包在代码块里）：{"__adjust":{"deltas":[{"param":"grind_size","from":49,"to":52,"direction":"coarser","reason":"...","expected":"..."}],"summary":"一句话"}}\n- **调整注水段必须用逐段格式**：如 {"param":"pours[0].volume_ml","from":53,"to":56,"direction":"increase"}、{"param":"pours[1].pattern","from":"spiral","to":"circular"}；**禁止用整个 pours 数组**作为 param\n- **所有注水段水量总和必须等于 粉量×比例**，改粉量/比例时同步调整各段\n- 没有调整意图就只输出聊天回复，不要输出该 JSON\n- 普通回复用自然中文，简洁直接`;
}

/** 针对单个配方的顾问对话（无状态：每次携带完整上下文，只谈当前配方）。 */
export function recipeChatJob(opts: RecipeChatJobOpts): string {
  return createJob(async () => {
    return await runHermesOnce(buildRecipeChatPrompt(opts));
  });
}

export interface StreamChatCallbacks {
  onDelta: (text: string) => void;
  onThought?: (text: string) => void;
  onCancel?: () => void;
  onDone: (fullText: string, thoughtText: string) => void;
  onError: (err: string) => void;
}

/**
 * 通过 `hermes acp`（不稳定协议）流式对话。
 * 精简 JSON-RPC 客户端：线协议格式来自 hermes-agent acp_adapter 源码。
 */
export async function streamRecipeChat(prompt: string, callbacks: StreamChatCallbacks, signal?: AbortSignal): Promise<void> {
  const child = spawn("hermes", ["acp"], { cwd: REPO_ROOT, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.on("data", () => {});

  let lineBuf = "";
  let msgId = 0;
  const pending = new Map<number, (msg: Record<string, unknown>) => void>();
  let accumulated = "";
  let accumulatedThought = "";
  let sessionId: string | null = null;
  let stopped = false;

  const onAbort = (): void => {
    if (stopped) return;
    stopped = true;
    try {
      if (sessionId) send("session/cancel", { sessionId }, true);
    } catch {
      // ignore
    }
    for (const [rid, resolve] of [...pending]) {
      resolve({});
      pending.delete(rid);
    }
    try {
      child.kill();
    } catch {
      // ignore
    }
    callbacks.onCancel?.();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const send = (method: string, params: unknown, notify = false): Promise<Record<string, unknown>> | null => {
    const msg: Record<string, unknown> = { jsonrpc: "2.0", method, params };
    if (notify) {
      child.stdin.write(JSON.stringify(msg) + "\n");
      return null;
    }
    const rid = ++msgId;
    msg.id = rid;
    return new Promise((resolve) => {
      pending.set(rid, resolve);
      child.stdin.write(JSON.stringify(msg) + "\n");
    });
  };

  const handleIncoming = (m: Record<string, unknown>): void => {
    if (m.id != null && typeof m.id === "number" && pending.has(m.id)) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === "session/update") {
      const params = m.params as { update?: { sessionUpdate?: string; content?: { type?: string; text?: string } } };
      const u = params?.update ?? {};
      if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text" && u.content.text) {
        accumulated += u.content.text;
        callbacks.onDelta(u.content.text);
      } else if (u.sessionUpdate === "agent_thought_chunk" && u.content?.type === "text" && u.content.text) {
        accumulatedThought += u.content.text;
        callbacks.onThought?.(u.content.text);
      }
      return;
    }
    // 其余请求/通知（如 session/request_permission）：拒绝权限请求，其余忽略
    if (typeof m.id === "number" && m.method && !m.result && !m.error) {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: m.id, result: { outcome: "rejected" } }) + "\n");
    }
  };

  child.stdout.on("data", (d: Buffer) => {
    lineBuf += d.toString();
    let i: number;
    while ((i = lineBuf.indexOf("\n")) >= 0) {
      const line = lineBuf.slice(0, i).trim();
      lineBuf = lineBuf.slice(i + 1);
      if (!line) continue;
      try {
        handleIncoming(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // 忽略无法解析的行
      }
    }
  });

  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
    callbacks.onError("Hermes 流式对话超时");
  }, 300_000);

  try {
    await send("initialize", { protocolVersion: 1, clientCapabilities: {} });
    const sess = await send("session/new", { cwd: REPO_ROOT, mcpServers: [] });
    sessionId = (sess?.result as { sessionId?: string } | undefined)?.sessionId ?? null;
    if (!sessionId) throw new Error("session/new 失败");
    await send("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
    clearTimeout(timeout);
    if (stopped) return;
    callbacks.onDone(accumulated || "（空回复）", accumulatedThought);
  } catch (e) {
    clearTimeout(timeout);
    if (!stopped) callbacks.onError(e instanceof Error ? e.message : String(e));
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
}
