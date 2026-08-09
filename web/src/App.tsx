import { useCallback, useEffect, useRef, useState } from "react";
import { get, post, del, pollJob } from "./api.js";

// ---------- types ----------

interface Bean {
  id: string;
  name: string;
  origin: string;
  process: string;
  roastLevel: string;
  variety?: string;
  packageWeightG?: number;
  remainingG?: number;
  auto?: boolean;
  finished?: boolean;
  altitude?: string;
  flavorNotes?: string;
  roastDate?: string;
  openedDate?: string;
  referenceGrind?: string;
  brewCount?: number;
  lastBrewedAt?: string;
  lastRating?: number;
  addedAt: string;
}

interface Taste {
  rating?: number;
  acidity?: string;
  astringency?: string;
  bitterness?: string;
  body?: string;
  aroma?: string;
  aromaType?: string;
  stalled?: boolean;
  note?: string;
  wantIteration?: boolean;
}

interface HistoryEntry {
  id: string;
  beanId?: string;
  beanName?: string;
  recipeName: string;
  recipeId?: number;
  cloudRecordId?: number;
  brewedAt: string;
  source?: string;
  taste?: Taste;
  params?: RecipeParams;
  stallHint?: boolean;
  expectedTime?: number | null;
  brewTime?: number | null;
}

interface RecipeParams {
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
}

interface SuggestionContent {
  deltas?: Array<{ param: string; from: number | null; to: number | null; direction: string; reason: string; expected: string }>;
  summary?: string;
}

interface ChatMessage {
  role: "user" | "ai";
  text: string;
  thought?: string;
  adjust?: { deltas?: Array<{ param: string; from: number | null; to: number | null; direction: string; reason: string; expected: string }>; summary?: string } | null;
  ts: string;
}

interface ChatAdjust {
  deltas?: Array<{ param: string; from: number | null; to: number | null; direction: string; reason: string; expected: string }>;
  summary?: string;
}

interface Suggestion {
  id: number;
  bean_id: string | null;
  history_id: string | null;
  status: string;
  content?: SuggestionContent;
  version?: number;
  error?: string;
  created_at: string;
}

interface Recipe {
  name: string;
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
  summary?: string;
}

// ---------- helpers ----------

function daysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr.replace(/\//g, "-"));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function freshness(bean: Bean): { label: string; tone: string } | null {
  const roast = daysSince(bean.roastDate);
  if (roast == null) return null;
  const opened = daysSince(bean.openedDate);
  let label: string;
  let tone: string;
  if (roast < 7) {
    label = `养豆期 ${roast} 天`;
    tone = "amber";
  } else if (roast <= 21) {
    label = `最佳窗口 ${roast} 天`;
    tone = "green";
  } else if (roast <= 35) {
    label = `开始衰减 ${roast} 天`;
    tone = "amber";
  } else if (roast <= 60) {
    label = `老化 ${roast} 天`;
    tone = "red";
  } else {
    label = `风味流失 ${roast} 天`;
    tone = "red";
  }
  if (opened != null && opened > 10) {
    label += ` · 开封 ${opened} 天`;
    tone = tone === "green" ? "amber" : tone;
  }
  return { label, tone };
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function tasteSummary(t?: Taste): string {
  if (!t) return "未反馈";
  const parts: string[] = [];
  if (t.rating) parts.push(`${"★".repeat(t.rating)}`);
  if (t.acidity) parts.push(`酸${t.acidity === "ok" ? "适中" : t.acidity === "weak" ? "弱" : "强"}`);
  if (t.astringency) parts.push(`涩${t.astringency === "ok" ? "适中" : t.astringency === "weak" ? "弱" : "强"}`);
  if (t.bitterness) parts.push(`苦${t.bitterness === "ok" ? "适中" : t.bitterness === "weak" ? "弱" : "强"}`);
  if (t.body) parts.push(`body${t.body === "medium" ? "适中" : t.body === "light" ? "清爽" : "厚重"}`);
  if (t.aroma) parts.push(`香${t.aroma === "none" ? "无" : t.aroma === "light" ? "淡" : "明显"}`);
  if (t.stalled) parts.push("卡粉");
  return parts.join(" · ") || "已反馈";
}

const ROAST_LEVELS = ["light", "medium-light", "medium", "medium-dark", "dark"];
const ROAST_LABEL: Record<string, string> = { light: "浅烘", "medium-light": "中浅", medium: "中烘", "medium-dark": "中深", dark: "深烘" };
const PROCESSES = ["washed", "natural", "honey", "anaerobic", "special_fermented", "other"];
const PROCESS_LABEL: Record<string, string> = { washed: "水洗", natural: "日晒", honey: "蜜处理", anaerobic: "厌氧", special_fermented: "特殊发酵", other: "其他" };
const AROMA_TYPES = ["花香", "果香", "坚果", "焦糖", "发酵酒香", "茶感", "其他"];

// ---------- app ----------

type Tab = "records" | "beans" | "brew" | "cloud" | "chat";
const TABS: Tab[] = ["records", "beans", "brew", "cloud", "chat"];

const HERO_SLIDES = [
  { src: "/media/banner.mp4" },
  { src: "/media/hero-video.mp4", poster: "/media/hero-kv.jpg" },
  { src: "/media/pour.mp4" },
  { src: "/media/simple-use-h264.mp4" },
];

function tabFromHash(): Tab {
  const h = window.location.hash.replace(/^#/, "") as Tab;
  return TABS.includes(h) ? h : "records";
}

export function App() {
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [loginOpen, setLoginOpen] = useState(false);
  const [heroSlide, setHeroSlide] = useState(0);
  const heroVideos = useRef<(HTMLVideoElement | null)[]>([]);
  const [status, setStatus] = useState<{ loggedIn: boolean; pendingCount: number; beanCount: number; hermesAvailable: boolean } | null>(null);
  const [origins, setOrigins] = useState<string[]>([]);

  const refreshStatus = useCallback(() => {
    get<{ loggedIn: boolean; pendingCount: number; beanCount: number; hermesAvailable: boolean }>("/api/status")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const restoreScroll = (y: number) => {
    requestAnimationFrame(() => {
      window.scrollTo(0, y);
      setTimeout(() => window.scrollTo(0, y), 400);
      setTimeout(() => window.scrollTo(0, y), 900);
    });
  };

  useEffect(() => {
    get<Bean[]>("/api/beans")
      .then((bs) => {
        const list = [...new Set(bs.map((b) => b.origin).filter(Boolean))];
        setOrigins(list.length ? list : ["埃塞俄比亚", "巴拿马", "肯尼亚", "云南", "越南", "洪都拉斯"]);
      })
      .catch(() => setOrigins(["埃塞俄比亚", "巴拿马", "肯尼亚", "云南", "越南", "洪都拉斯"]));
  }, []);

  useEffect(() => {
    const h = () => setLoginOpen(true);
    window.addEventListener("xbloom:needauth", h);
    return () => window.removeEventListener("xbloom:needauth", h);
  }, []);

  useEffect(refreshStatus, [refreshStatus]);

  useEffect(() => {
    const timer = setInterval(() => setHeroSlide((a) => (a + 1) % HERO_SLIDES.length), 6500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    heroVideos.current.forEach((v, i) => {
      if (!v) return;
      if (i === heroSlide) v.play().catch(() => {});
      else v.pause();
    });
  }, [heroSlide]);

  const setTab = (t: Tab) => {
    const keep = window.scrollY;
    setTabState(t);
    history.pushState({ tab: t }, "", `#${t}`);
    restoreScroll(keep);
  };

  useEffect(() => {
    const onPop = () => {
      const t = tabFromHash();
      setTabState(t);
      restoreScroll(window.scrollY);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="app">
      <section className="hero-banner">
        <div className="hero-slides">
          {HERO_SLIDES.map((s, i) => (
            <div key={s.src} className={`hero-slide ${heroSlide === i ? "active" : ""}`}>
              <video
                ref={(el) => {
                  heroVideos.current[i] = el;
                }}
                src={s.src}
                poster={s.poster}
                muted
                loop
                playsInline
                preload="auto"
              />
            </div>
          ))}
        </div>
        <div className="hero-overlay">
          <div className="eyebrow">PERSONAL BREWING LOOP</div>
          <h1>
            XBLOOM <em>loop</em>
          </h1>
        </div>
        <div className="hero-status hero-status-corner">
          <span className={`dot ${status?.loggedIn ? "ok" : "down"}`} />
          {status?.loggedIn ? "已连接云端" : "未登录"} · {status?.pendingCount ?? 0} 条待反馈
          {!status?.loggedIn && <button onClick={() => setLoginOpen(true)}>登录</button>}
        </div>
      </section>
      <div className="ticker" aria-hidden="true">
        <div className="ticker-track">
          {[...origins, ...origins, ...origins].map((o, i) => (
            <span key={i}>{o}</span>
          ))}
        </div>
      </div>
      <nav>
        {(
          [
            ["records", "记录"],
            ["beans", "豆子"],
            ["brew", "迭代"],
            ["cloud", "云端配方"],
            ["chat", "对话"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>
      <main key={tab} className="fade-in">
        {tab === "beans" && <BeansPage />}
        {tab === "brew" && <IterationPage />}
        {tab === "records" && <RecordsPage onChanged={refreshStatus} />}
        {tab === "cloud" && <CloudPage />}
        {tab === "chat" && <ChatPage />}
      </main>
      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </div>
  );
}

// ---------- beans ----------

function BeansPage() {
  const [beans, setBeans] = useState<Bean[]>([]);
  const [editing, setEditing] = useState<Partial<Bean> | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState<"active" | "finished" | "all">("active");
  const [refillBean, setRefillBean] = useState<Bean | null>(null);

  const load = useCallback(() => get<Bean[]>("/api/beans").then(setBeans), []);
  useEffect(() => {
    load();
  }, [load]);

  const loadSuggestions = useCallback(() => {
    if (!detailId) return;
    get<Suggestion[]>(`/api/suggestions?beanId=${detailId}`).then((rows) => {
      setSuggestions(
        rows.map((s) => ({
          ...s,
          content: typeof s.content === "string" ? (JSON.parse(s.content) as Suggestion["content"]) : s.content,
        })),
      );
    }).catch(() => setSuggestions([]));
  }, [detailId]);

  useEffect(() => {
    if (!detailId) return;
    get<HistoryEntry[]>(`/api/history?beanId=${detailId}`).then(setHistory).catch(() => setHistory([]));
    loadSuggestions();
  }, [detailId, loadSuggestions]);

  const save = async (bean: Partial<Bean>) => {
    await post("/api/beans", bean);
    setEditing(null);
    await load();
  };

  const finish = async (b: Bean) => {
    await post(`/api/beans/${b.id}/finish`);
    await load();
  };

  const applySuggestion = async (id: number) => {
    setMsg("");
    try {
      const r = await post<{ ok: boolean; version: number }>(`/api/suggestions/${id}/apply`);
      setMsg(`已应用建议（v${r.version}），云端配方已更新`);
      loadSuggestions();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (text.includes("不一致") || text.includes("已中止")) {
        if (window.confirm("云端配方已被手动修改。基于云端当前参数强制应用此方案？（保留手动调整，只套用方案目标值）")) {
          try {
            const r = await post<{ ok: boolean; version: number }>(`/api/suggestions/${id}/apply`, { force: true });
            setMsg(`已基于云端当前参数应用（v${r.version}），云端配方已更新`);
          } catch (e2) {
            setMsg(e2 instanceof Error ? e2.message : String(e2));
          }
        } else {
          setMsg(text);
        }
      } else {
        setMsg(text);
      }
      loadSuggestions();
    }
  };

  const ignoreSuggestion = async (id: number) => {
    await post(`/api/suggestions/${id}/ignore`);
    loadSuggestions();
  };

  const visible = beans
    .filter((b) => (filter === "active" ? !b.finished : filter === "finished" ? !!b.finished : true))
    .sort((a, b) => {
      if (!a.lastBrewedAt) return b.lastBrewedAt ? 1 : 0;
      if (!b.lastBrewedAt) return -1;
      return b.lastBrewedAt.localeCompare(a.lastBrewedAt);
    });

  return (
    <div className="page">
      <div className="row between">
        <h2>豆库</h2>
        <div className="row">
          <button onClick={() => setEditing({})}>+ 加豆子</button>
        </div>
      </div>
      <div className="seg">
        {(
          [
            ["active", "在喝"],
            ["finished", "喝完了"],
            ["all", "全部"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>
            {label}（{k === "active" ? beans.filter((b) => !b.finished).length : k === "finished" ? beans.filter((b) => b.finished).length : beans.length}）
          </button>
        ))}
      </div>
      {editing && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="modal">
            <BeanForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
          </div>
        </div>
      )}
      {refillBean && (
        <RefillDialog
          bean={refillBean}
          onClose={() => setRefillBean(null)}
          onDone={async () => {
            setRefillBean(null);
            await load();
          }}
        />
      )}
      <div className="grid">
        {visible.map((b) => {
          const f = freshness(b);
          return (
            <div key={b.id} className="card">
              <div className="row between">
                <strong>{b.name}</strong>
                <div className="row">
                  {b.finished && <span className="badge red">已喝完</span>}
                  {b.auto && <span className="badge amber">自动</span>}
                  {f && <span className={`badge ${f.tone}`}>{f.label}</span>}
                </div>
              </div>
              {b.packageWeightG != null && (
                <div className="capacity">
                  <div className="row between">
                    <span className="muted">
                      剩余 {b.remainingG ?? "—"}g / 容量 {b.packageWeightG}g
                    </span>
                    {b.remainingG != null && b.remainingG <= 0 && <span className="badge red">空袋</span>}
                    {b.remainingG != null && b.remainingG > 0 && b.remainingG < 30 && <span className="badge amber">快没了</span>}
                  </div>
                  <div className="bar">
                    <div
                      className={`bar-fill ${b.remainingG != null && b.remainingG < 30 ? "low" : ""}`}
                      style={{ width: `${Math.max(0, Math.min(100, ((b.remainingG ?? 0) / b.packageWeightG) * 100))}%` }}
                    />
                  </div>
                </div>
              )}
              <div className="muted">
                {b.origin || "未知产地"} · {(ROAST_LABEL[b.roastLevel] ?? b.roastLevel) || "未知烘焙"} · {(PROCESS_LABEL[b.process] ?? b.process) || "未知处理法"}
                {b.variety ? ` · ${b.variety}` : ""}
              </div>
              <div className="row between">
                <span className="muted">
                  {b.brewCount ? `已冲 ${b.brewCount} 杯` : "未记录冲泡"}
                  {b.lastRating ? ` · 最近 ${b.lastRating} 星` : ""}
                </span>
                <div className="row">
                  <button onClick={() => setEditing(b)}>编辑</button>
                  {b.finished ? (
                    <button className="primary" onClick={() => setRefillBean(b)}>
                      开新袋
                    </button>
                  ) : (
                    <button onClick={() => finish(b)}>喝完了</button>
                  )}
                  <button
                    onClick={async () => {
                      if (window.confirm(`删除豆子「${b.name}」？历史冲泡记录会保留。`)) {
                        await del(`/api/beans/${b.id}`);
                        await load();
                      }
                    }}
                  >
                    删除
                  </button>
                  <button onClick={() => setDetailId(detailId === b.id ? null : b.id)}>
                    {detailId === b.id ? "收起" : "详情"}
                  </button>
                </div>
              </div>
              {b.flavorNotes && <p className="muted">{b.flavorNotes}</p>}
              {detailId === b.id && (
                <div className="detail">
                  <h4>历史（{history.length}）</h4>
                  {history.slice(0, 8).map((h) => (
                    <div key={h.id} className="row between">
                      <span>
                        {fmtDate(h.brewedAt)} · {h.recipeName}
                      </span>
                      <span className={h.taste ? "" : "muted"}>{tasteSummary(h.taste)}</span>
                    </div>
                  ))}
                  <h4>建议</h4>
                  {suggestions.length === 0 && <p className="muted">暂无建议</p>}
                  {msg && <p className={msg.includes("失败") || msg.includes("已中止") ? "error" : "ok"}>{msg}</p>}
                  {suggestions.map((s) => (
                    <div key={s.id} className="suggestion card tight">
                      <div className="row between">
                        <span className={`badge ${s.status === "done" ? "green" : s.status === "applied" ? "blue" : s.status === "error" ? "red" : "amber"}`}>
                          {s.status === "done" ? "待处理" : s.status === "applied" ? `已应用 v${s.version ?? "?"}` : s.status === "ignored" ? "已忽略" : s.status === "error" ? "失败" : "生成中"}
                        </span>
                        <span className="muted">{new Date(s.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })}</span>
                      </div>
                      <span>{s.content?.summary ?? s.error ?? "生成中…"}</span>
                      {(s.content?.deltas ?? []).slice(0, 4).map((d, i) => (
                        <div key={i} className="muted">
                          · {d.param}: {d.from ?? "?"} → {d.to ?? "?"}（{d.direction}）
                        </div>
                      ))}
                      {s.status === "done" && (
                        <div className="row">
                          <button className="primary" onClick={() => applySuggestion(s.id)}>
                            应用
                          </button>
                          <button onClick={() => ignoreSuggestion(s.id)}>忽略</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface EditPour {
  volume_ml: number;
  temperature_c: number;
  pattern: string;
  flow_rate: number;
  pause_seconds: number;
  agitate_before: boolean;
  agitate_after: boolean;
}

function RecipeEditModal({ recipeId, onClose, onSaved }: { recipeId: number; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [dose, setDose] = useState("");
  const [ratio, setRatio] = useState("");
  const [grind, setGrind] = useState("");
  const [rpm, setRpm] = useState("");
  const [pours, setPours] = useState<EditPour[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    get<{
      name: string;
      dose: number;
      ratio: number;
      grindSize: number;
      rpm: number;
      pourList: Array<{ volume: number; temperature: number; pattern: number; flowRate: number; pausing: number; agitateBefore?: boolean; agitateAfter?: boolean }>;
    }>(`/api/cloud-recipes/${recipeId}`)
      .then((r) => {
        setName(r.name);
        setDose(String(r.dose));
        setRatio(String(r.ratio));
        setGrind(String(r.grindSize));
        setRpm(String(r.rpm));
        setPours(
          r.pourList.map((p) => ({
            volume_ml: p.volume,
            temperature_c: p.temperature,
            pattern: { 1: "centered", 2: "spiral", 3: "circular" }[p.pattern] ?? "circular",
            flow_rate: p.flowRate,
            pause_seconds: p.pausing,
            agitate_before: !!p.agitateBefore,
            agitate_after: !!p.agitateAfter,
          })),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [recipeId]);

  const setPour = (i: number, k: keyof EditPour, v: unknown) => {
    setPours((prev) => prev.map((p, idx) => (idx === i ? { ...p, [k]: v } : p)));
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post(`/api/cloud-recipes/${recipeId}/edit`, {
        params: {
          name,
          dose_g: Number(dose),
          ratio: Number(ratio),
          grind_size: Number(grind),
          grind_rpm: Number(rpm),
          pours: pours.map((p) => ({ ...p })),
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>预览/编辑配方：{name || `#${recipeId}`}</h3>
        <div className="row two">
          <label>
            名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            粉量 g
            <input type="number" value={dose} onChange={(e) => setDose(e.target.value)} />
          </label>
          <label>
            比例 1:
            <input type="number" value={ratio} onChange={(e) => setRatio(e.target.value)} />
          </label>
          <label>
            研磨
            <input type="number" value={grind} onChange={(e) => setGrind(e.target.value)} />
          </label>
          <label>
            转速 rpm
            <input type="number" value={rpm} onChange={(e) => setRpm(e.target.value)} />
          </label>
        </div>
        <h4 style={{ margin: "10px 0 6px" }}>注水段</h4>
        <div className="stack">
          {pours.map((p, i) => (
            <div key={i} className="row" style={{ gap: 6 }}>
              <span className="muted">段{i + 1}</span>
              <input type="number" style={{ width: 70 }} value={p.volume_ml} onChange={(e) => setPour(i, "volume_ml", Number(e.target.value))} title="水量" />
              <input type="number" style={{ width: 60 }} value={p.temperature_c} onChange={(e) => setPour(i, "temperature_c", Number(e.target.value))} title="水温" />
              <select style={{ width: 100 }} value={p.pattern} onChange={(e) => setPour(i, "pattern", e.target.value)}>
                <option value="centered">centered</option>
                <option value="spiral">spiral</option>
                <option value="circular">circular</option>
              </select>
              <input type="number" step="0.1" style={{ width: 60 }} value={p.flow_rate} onChange={(e) => setPour(i, "flow_rate", Number(e.target.value))} title="流速" />
              <input type="number" style={{ width: 60 }} value={p.pause_seconds} onChange={(e) => setPour(i, "pause_seconds", Number(e.target.value))} title="暂停s" />
              <label className="inline">
                <input type="checkbox" checked={p.agitate_before} onChange={(e) => setPour(i, "agitate_before", e.target.checked)} />
                震前
              </label>
              <label className="inline">
                <input type="checkbox" checked={p.agitate_after} onChange={(e) => setPour(i, "agitate_after", e.target.checked)} />
                震后
              </label>
            </div>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? "保存中…" : "保存到云端"}
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

// ---------- per-recipe chat ----------

function chatParamLabel(recipeParam: string): string {
  const m = recipeParam.match(/^pours\[(\d+)\]\.(\w+)$/);
  if (m) {
    const field = m[2];
    const fieldLabel: Record<string, string> = { temperature_c: "水温", pause_seconds: "暂停", pattern: "Pattern", flow_rate: "流速", volume_ml: "水量" };
    return `第${Number(m[1]) + 1}段${fieldLabel[field] ?? field}`;
  }
  const labels: Record<string, string> = { grind_size: "研磨", grind_rpm: "转速", dose_g: "粉量", ratio: "比例", temperature_c: "水温", flow_rate: "流速", pause_seconds: "暂停", pattern: "Pattern" };
  return labels[recipeParam] ?? recipeParam;
}

function latestThoughtLine(thought: string): string {
  const lines = thought
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1] ?? thought.trim();
  return last.length > 80 ? `…${last.slice(-80)}` : last;
}

function RecipeChatPanel({ recipeId, recipeName, onApplied }: { recipeId: number; recipeName: string; onApplied?: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<ChatAdjust | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streamThought, setStreamThought] = useState("");
  const [streamThoughtOpen, setStreamThoughtOpen] = useState(false);
  const [openThought, setOpenThought] = useState<Set<number>>(new Set());
  const streamThoughtRef = useRef("");
  const esRef = useRef<EventSource | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const data = await get<{ recipeName: string | null; messages: ChatMessage[]; pendingAdjust: ChatAdjust | null }>(`/api/chat/${recipeId}`);
    setMessages(data.messages);
    setPending(data.pendingAdjust);
  }, [recipeId]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages, streamText, streamThought]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pending) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pending]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || busy) return;
    setBusy(true);
    setError("");
    setInput("");
    setStreamText("");
    setStreamThought("");
    setStreamThoughtOpen(false);
    streamThoughtRef.current = "";
    setMessages((prev) => [...prev, { role: "user", text: msg, ts: new Date().toISOString() }]);
    try {
      const { streamId } = await post<{ streamId: string }>(`/api/chat/${recipeId}/message`, { message: msg });
      const es = new EventSource(`/api/chat/${recipeId}/stream/${streamId}`);
      esRef.current = es;
      streamIdRef.current = streamId;
      let closed = false;
      const finish = async () => {
        if (closed) return;
        closed = true;
        esRef.current = null;
        streamIdRef.current = null;
        es.close();
        setBusy(false);
        setStreamText("");
        setStreamThought("");
        await load();
        if (streamThoughtRef.current) {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "ai") next[next.length - 1] = { ...last, thought: streamThoughtRef.current };
            return next;
          });
        }
      };
      es.addEventListener("delta", (ev) => {
        const t = JSON.parse((ev as MessageEvent).data) as string;
        setStreamText((prev) => prev + t);
      });
      es.addEventListener("thought", (ev) => {
        const t = JSON.parse((ev as MessageEvent).data) as string;
        streamThoughtRef.current += t;
        setStreamThought((prev) => prev + t);
      });
      es.addEventListener("done", finish);
      es.addEventListener("error", finish);
      es.addEventListener("cancelled", finish);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const stop = async () => {
    const sid = streamIdRef.current;
    streamIdRef.current = null;
    esRef.current?.close();
    esRef.current = null;
    streamThoughtRef.current = "";
    setBusy(false);
    setStreamText("");
    setStreamThought("");
    if (sid) {
      post(`/api/chat/${recipeId}/stop/${sid}`).catch(() => {});
    }
    await load();
  };

  const applyAdjust = async () => {
    setError("");
    try {
      await post(`/api/chat/${recipeId}/apply-adjust`);
      await load();
      onApplied?.();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (text.includes("不一致")) {
        if (window.confirm("云端配方参数已变化（与方案生成时不同）。仍按方案目标值应用？")) {
          try {
            await post(`/api/chat/${recipeId}/apply-adjust`, { force: true });
            await load();
            onApplied?.();
          } catch (e2) {
            setError(e2 instanceof Error ? e2.message : String(e2));
          }
        } else {
          setError(text);
        }
      } else {
        setError(text);
      }
    }
  };

  const ignoreAdjust = async () => {
    await post(`/api/chat/${recipeId}/ignore-adjust`);
    await load();
  };

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <strong>和「{recipeName}」的 AI 对话</strong>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && <p className="muted">问点什么吧——关于这个配方，AI 只谈它自己。</p>}
        {messages.map((m, i) => {
          const isCurrentPending = !!(pending && m.adjust && JSON.stringify(m.adjust) === JSON.stringify(pending));
          return (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.thought && (
                <div className="chat-thought-box">
                  <div className={`chat-thought-lines ${openThought.has(i) ? "expanded" : ""}`}>{m.thought}</div>
                  <button
                    className="thought-toggle"
                    onClick={() =>
                      setOpenThought((prev) => {
                        const n = new Set(prev);
                        if (n.has(i)) n.delete(i);
                        else n.add(i);
                        return n;
                      })
                    }
                  >
                    {openThought.has(i) ? "收起" : "展示"}
                  </button>
                </div>
              )}
              <div className="chat-bubble">{m.text}</div>
              {m.adjust && !isCurrentPending && (
                <div className="chat-adjust">
                  <div className="muted">AI 参数调整方案：{m.adjust.summary}</div>
                  <div className="delta-list">
                    {(m.adjust.deltas ?? []).map((d, j) => (
                      <span key={j} className="badge new">
                        {chatParamLabel(d.param)}: {d.from ?? "?"} → {d.to ?? "?"}（{d.direction}）
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <div className="chat-msg ai">
            {streamThought && (
              <>
                <div className="chat-thought-box">
                  <div className={`chat-thought-lines ${streamThoughtOpen ? "expanded" : ""}`}>{streamThought}</div>
                  <button className="thought-toggle" onClick={() => setStreamThoughtOpen((v) => !v)}>
                    {streamThoughtOpen ? "收起" : "展示"}
                  </button>
                </div>
              </>
            )}
            <div className="chat-bubble">{streamText || "思考中…"}</div>
          </div>
        )}
      </div>
      {pending && (
        <div className="chat-adjust">
          <div className="muted">AI 给出了参数调整方案：{pending.summary}</div>
          <div className="delta-list">
            {(pending.deltas ?? []).map((d, j) => (
              <span key={j} className="badge new">
                {chatParamLabel(d.param)}: {d.from ?? "?"} → {d.to ?? "?"}（{d.direction}）
              </span>
            ))}
          </div>
          <div className="row">
            <button className="primary" onClick={applyAdjust}>
              保存到配方
            </button>
            <button onClick={ignoreAdjust}>忽略</button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) send();
          }}
          placeholder="问这个配方的问题…"
          disabled={busy}
        />
        {busy ? (
          <button className="primary" onClick={stop}>
            停止
          </button>
        ) : (
          <button className="primary" disabled={!input.trim()} onClick={send}>
            发送
          </button>
        )}
      </div>
    </div>
  );
}

// ---------- iteration ----------

interface VersionRow {
  id: number;
  bean_id: string;
  recipe_id: number;
  version: number;
  params: string;
  source: string;
  applied_at: string;
}

function IterationPage() {
  const [beans, setBeans] = useState<Bean[]>([]);
  const [beanId, setBeanId] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const [feedbackEntry, setFeedbackEntry] = useState<HistoryEntry | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [showGen, setShowGen] = useState(false);
  const [genMode, setGenMode] = useState<"hot" | "iced">("iced");
  const [busy, setBusy] = useState(false);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [error, setError] = useState("");
  const [pushResult, setPushResult] = useState("");
  const [msg, setMsg] = useState("");
  const [openChats, setOpenChats] = useState<Set<number>>(new Set());
  const [cloudRecipes, setCloudRecipes] = useState<CloudRecipeRow[]>([]);
  const [editRecipeId, setEditRecipeId] = useState<number | null>(null);

  useEffect(() => {
    get<Bean[]>("/api/beans")
      .then((bs) => {
        setBeans(bs);
        const active = bs.filter((b) => !b.finished);
        const saved = localStorage.getItem("xbloom-iter-bean");
        setBeanId(saved && active.some((b) => b.id === saved) ? saved : active[0]?.id ?? "");
      })
      .catch(() => setBeans([]));
    get<VersionRow[]>("/api/versions").then(setVersions).catch(() => setVersions([]));
    get<CloudRecipeRow[]>("/api/cloud-recipes").then(setCloudRecipes).catch(() => setCloudRecipes([]));
  }, [reloadTick]);

  useEffect(() => {
    if (!beanId) return;
    get<HistoryEntry[]>(`/api/history?beanId=${beanId}`).then(setHistory).catch(() => setHistory([]));
    get<Suggestion[]>(`/api/suggestions?beanId=${beanId}`)
      .then((rows) => {
        setSuggestions(
          rows.map((s) => ({
            ...s,
            content: typeof s.content === "string" ? (JSON.parse(s.content) as Suggestion["content"]) : s.content,
          })),
        );
      })
      .catch(() => setSuggestions([]));
  }, [beanId, reloadTick]);

  const byVersion = new Map<number, Suggestion>();
  for (const s of suggestions) {
    if (s.status === "applied" && s.version != null) byVersion.set(s.version, s);
  }

  const EMPTY_PARAMS: RecipeParams = { dose_g: 0, ratio: 0, grind_size: 0, grind_rpm: 0, pours: [] };
  const activeBeans = beans
    .filter((b) => !b.finished)
    .sort((a, b) => {
      if (!a.lastBrewedAt) return b.lastBrewedAt ? 1 : 0;
      if (!b.lastBrewedAt) return -1;
      return b.lastBrewedAt.localeCompare(a.lastBrewedAt);
    });

  interface IterEvent {
    ts: string;
    kind: "version" | "brew";
    version?: number;
    source?: string;
    params: RecipeParams;
    deltas?: SuggestionContent["deltas"];
    summary?: string;
    triggerTaste?: Taste;
    taste?: Taste;
    entry?: HistoryEntry;
  }

  const groups = new Map<string, HistoryEntry[]>();
  for (const h of [...history].sort((a, b) => (a.brewedAt < b.brewedAt ? 1 : -1))) {
    const key = h.recipeId ? `rid:${h.recipeId}` : `name:${h.recipeName}`;
    const list = groups.get(key) ?? [];
    list.push(h);
    groups.set(key, list);
  }

  const chains = [...groups.entries()]
    .map(([key, entries]) => {
      const recipeId = entries[0].recipeId ?? null;
      const recipeName = entries[0].recipeName;
      const mode = recipeName.includes("冰饮") ? "iced" : recipeName.includes("热饮") ? "hot" : "other";
      const versionRows = recipeId != null ? versions.filter((v) => v.bean_id === beanId && v.recipe_id === recipeId) : [];
      const events: IterEvent[] = versionRows
        .sort((a, b) => a.version - b.version)
        .map((v) => {
          const s = byVersion.get(v.version);
          const triggerEntry = s?.history_id ? history.find((h) => h.id === s.history_id) : undefined;
          return {
            ts: v.applied_at,
            kind: "version" as const,
            version: v.version,
            source: v.source,
            params: JSON.parse(v.params) as RecipeParams,
            deltas: s?.content?.deltas,
            summary: s?.content?.summary,
            triggerTaste: triggerEntry?.taste,
          };
        });
      if (!versionRows.length) {
        const earliest = entries[entries.length - 1];
        events.unshift({
          ts: earliest.brewedAt,
          kind: "version",
          version: 0,
          source: "initial",
          params: earliest.params ?? EMPTY_PARAMS,
        });
      }
      for (const h of entries) {
        events.push({ ts: h.brewedAt, kind: "brew", params: h.params ?? EMPTY_PARAMS, taste: h.taste, entry: h });
      }
      events.sort((a, b) => (a.ts < b.ts ? -1 : 1));
      const maxVersion = versionRows.reduce((m, v) => Math.max(m, v.version), versionRows.length ? 0 : 0);
      const current = events[events.length - 1]?.params ?? events[0]?.params;
      return {
        key,
        recipeName,
        mode,
        events,
        maxVersion,
        current,
        brewCount: entries.length,
        recipeId: entries[0].recipeId ?? null,
        pourCount: entries[0].params?.pours.length ?? 0,
      };
    })
    .sort((a, b) => {
      const ta = a.events[a.events.length - 1]?.ts ?? "";
      const tb = b.events[b.events.length - 1]?.ts ?? "";
      return ta < tb ? 1 : -1;
    });

  const chainKeys = new Set(chains.map((c) => c.key));
  const cloudChains = cloudRecipes
    .filter((r) => r.beanId === beanId && !chainKeys.has(`rid:${r.tableId}`))
    .map((r) => ({
      key: `rid:${r.tableId}`,
      recipeName: r.name,
      mode: r.name.includes("冰饮") ? ("iced" as const) : r.name.includes("热饮") ? ("hot" as const) : ("other" as const),
      events: [] as IterEvent[],
      maxVersion: 0,
      current: { dose_g: r.dose, ratio: r.ratio, grind_size: r.grindSize, grind_rpm: r.rpm, pours: [] as RecipeParams["pours"] },
      brewCount: 0,
      recipeId: r.tableId,
      pourCount: r.pourCount,
    }));
  const allChains = [...chains, ...cloudChains];

  const paramLabel = (param: string): string => {
    const m = param.match(/^pours\[(\d+)\]\.(\w+)$/);
    if (m) {
      const field = m[2];
      const fieldLabel: Record<string, string> = { temperature_c: "水温", pause_seconds: "暂停", pattern: "Pattern", flow_rate: "流速", volume_ml: "水量" };
      return `第${Number(m[1]) + 1}段${fieldLabel[field] ?? field}`;
    }
    const labels: Record<string, string> = { grind_size: "研磨", grind_rpm: "转速", dose_g: "粉量", ratio: "比例", temperature_c: "水温", flow_rate: "流速", pause_seconds: "暂停", pattern: "Pattern" };
    return labels[param] ?? param;
  };

  const applySuggestion = async (id: number) => {
    setMsg("");
    try {
      const r = await post<{ ok: boolean; version: number }>(`/api/suggestions/${id}/apply`);
      setMsg(`已应用建议（v${r.version}），云端配方已更新`);
      setReloadTick((t) => t + 1);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (text.includes("不一致") || text.includes("已中止")) {
        if (window.confirm("云端配方已被手动修改。基于云端当前参数强制应用此方案？（保留手动调整，只套用方案目标值）")) {
          try {
            const r = await post<{ ok: boolean; version: number }>(`/api/suggestions/${id}/apply`, { force: true });
            setMsg(`已基于云端当前参数应用（v${r.version}），云端配方已更新`);
          } catch (e2) {
            setMsg(e2 instanceof Error ? e2.message : String(e2));
          }
        } else {
          setMsg(text);
        }
      } else {
        setMsg(text);
      }
      setReloadTick((t) => t + 1);
    }
  };

  const ignoreSuggestion = async (id: number) => {
    await post(`/api/suggestions/${id}/ignore`);
    setReloadTick((t) => t + 1);
  };

  const toggleChat = (recipeId: number) => {
    setOpenChats((prev) => {
      const next = new Set(prev);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  };

  const generate = async () => {
    setError("");
    setPushResult("");
    setRecipe(null);
    setBusy(true);
    try {
      const { jobId } = await post<{ jobId: string }>("/api/recipes/generate", { beanId, mode: genMode });
      pollJob<Recipe>(
        jobId,
        (r) => {
          setRecipe(r);
          setBusy(false);
        },
        (err) => {
          setError(`生成失败：${err}`);
          setBusy(false);
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const push = async () => {
    if (!recipe) return;
    setError("");
    try {
      const r = await post<{ tableId: number; message: string; version: number }>("/api/recipes/push", { beanId, recipe });
      setPushResult(`已推送：配方 ID ${r.tableId}（版本 v${r.version}），手机 App 下拉刷新即可使用`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      <div className="row between">
        <h2>配方迭代</h2>
        <div className="row">
          <button className="primary" onClick={() => setShowGen((v) => !v)}>
            {showGen ? "收起新配方" : "+ 生成新配方"}
          </button>
        </div>
      </div>
      <div className="bean-chips">
        {activeBeans.map((b) => (
          <button
            key={b.id}
            className={`chip ${beanId === b.id ? "active" : ""}`}
            onClick={() => {
              setBeanId(b.id);
              localStorage.setItem("xbloom-iter-bean", b.id);
            }}
          >
            {b.name}
            {b.brewCount ? <span className="chip-count">· {b.brewCount} 杯</span> : null}
          </button>
        ))}
      </div>
      {activeBeans.length === 0 && <p className="muted">没有在喝的豆子——去豆库开新袋吧。</p>}

      {showGen && (
        <div className="card">
          <div className="row">
            <label className="inline">
              饮用方式
              <select value={genMode} onChange={(e) => setGenMode(e.target.value as "hot" | "iced")}>
                <option value="iced">冰饮</option>
                <option value="hot">热饮</option>
              </select>
            </label>
            <button className="primary" disabled={!beanId || busy} onClick={generate}>
              {busy ? "Hermes 推演中（可能要几分钟）…" : "出配方"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {recipe && (
            <div className="recipe">
              <h3>{recipe.name}</h3>
              <p>{recipe.summary}</p>
              <div className="row">
                <span className="muted">
                  {recipe.dose_g}g · 1:{recipe.ratio} · 研磨 {recipe.grind_size} · {recipe.grind_rpm}rpm · {recipe.pours.length} 段
                </span>
                <button className="primary" onClick={push}>
                  确认，推送到云端
                </button>
              </div>
              {pushResult && <p className="ok">{pushResult}</p>}
            </div>
          )}
        </div>
      )}

      <h3>AI 迭代方案（{suggestions.length}）</h3>
      {msg && <p className={msg.includes("失败") || msg.includes("已中止") ? "error" : "ok"}>{msg}</p>}
      {suggestions.length === 0 && (
        <p className="muted">还没有 AI 方案——反馈时勾选"需要迭代参数建议"即可生成，生成的方案会在这里迭代。</p>
      )}
      <div className="stack">
        {suggestions.map((s) => {
          const triggerEntry = s.history_id ? history.find((h) => h.id === s.history_id) : undefined;
          return (
            <div key={s.id} className="card tight">
              <div className="row between">
                <span
                  className={`badge ${s.status === "done" ? "new" : s.status === "applied" ? "green" : s.status === "ignored" ? "gray" : s.status === "error" ? "red" : "amber"}`}
                >
                  {s.status === "done" ? "待处理" : s.status === "applied" ? `已应用 v${s.version ?? "?"}` : s.status === "ignored" ? "已忽略" : s.status === "error" ? "失败" : "生成中"}
                </span>
                <span className="muted">{fmtDate(s.created_at)}</span>
              </div>
              {triggerEntry?.taste && <div className="muted">触发反馈：{tasteSummary(triggerEntry.taste)}</div>}
              <div>{s.content?.summary ?? s.error ?? "生成中…"}</div>
              {(s.content?.deltas ?? []).map((d, i) => (
                <div key={i} className="delta-line">
                  <span className="badge new">
                    {paramLabel(d.param)}: {d.from ?? "?"} → {d.to ?? "?"}（{d.direction}）
                  </span>
                  <span className="muted">{d.reason}</span>
                </div>
              ))}
              {s.status === "done" && (
                <div className="row">
                  <button className="primary" onClick={() => applySuggestion(s.id)}>
                    应用
                  </button>
                  <button onClick={() => ignoreSuggestion(s.id)}>忽略</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <h3>迭代记录（{allChains.length} 个配方）</h3>
      {allChains.length === 0 && <p className="muted">这只豆子还没有配方，点"生成新配方"开始。</p>}
      <div className="stack">
        {allChains.map((c) => (
          <div key={c.key} className="card">
            <div className="row between">
              <strong>{c.recipeName}</strong>
              <div className="row">
                {c.mode === "iced" && <span className="badge blue">冰饮</span>}
                {c.mode === "hot" && <span className="badge amber">热饮</span>}
                <span className="badge green">v{c.maxVersion || "初始"}</span>
                <span className="muted">{c.brewCount} 杯</span>
              </div>
            </div>
            <div className="muted">
              当前参数：
              {c.current ? `${c.current.dose_g}g · 1:${c.current.ratio} · 研磨 ${c.current.grind_size} · ${c.current.grind_rpm}rpm · ${c.pourCount} 段` : "—"}
            </div>
            {c.events.length === 0 && c.brewCount === 0 && <p className="muted">尚未冲泡——可以直接和 AI 聊这个配方。</p>}
            <div className="timeline">
              {c.events.map((e, i) =>
                e.kind === "version" ? (
                  <div key={i} className="tl-node version">
                    <div className="row">
                      <span className={`badge ${e.source === "push" ? "blue" : e.version === 0 ? "amber" : "green"}`}>
                        {e.version === 0 ? "初始（云端记录）" : e.source === "push" ? `初始推送 v${e.version}` : `建议应用 v${e.version}`}
                      </span>
                      <span className="muted">{fmtDate(e.ts)}</span>
                    </div>
                    {e.triggerTaste && <div className="muted">触发反馈：{tasteSummary(e.triggerTaste)}</div>}
                    {(e.deltas ?? []).map((d, j) => (
                      <div key={j} className="delta-line">
                        <span className="badge new">
                          {paramLabel(d.param)}: {d.from ?? "?"} → {d.to ?? "?"}（{d.direction}）
                        </span>
                        <span className="muted">{d.reason}</span>
                      </div>
                    ))}
                    {e.summary && <div className="muted">{e.summary}</div>}
                  </div>
                ) : (
                  <div key={i} className="tl-node brew">
                    <div className="row">
                      <span className="muted">冲泡 · {fmtDate(e.ts)}</span>
                      {e.taste ? <span>{tasteSummary(e.taste)}</span> : <span className="muted">未反馈</span>}
                      <span className="muted">
                        · 研磨 {e.params.grind_size} · {e.params.pours.length} 段
                      </span>
                      {e.entry && (
                        <button onClick={() => setFeedbackEntry(e.entry!)}>{e.taste ? "改评" : "反馈"}</button>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button disabled={c.recipeId == null} onClick={() => c.recipeId != null && setEditRecipeId(c.recipeId)}>
                预览/编辑
              </button>
              <button
                disabled={c.recipeId == null}
                onClick={() => c.recipeId != null && toggleChat(c.recipeId)}
              >
                {c.recipeId != null && openChats.has(c.recipeId) ? "收起对话" : "💬 AI 对话"}
              </button>
            </div>
            {c.recipeId != null && openChats.has(c.recipeId) && (
              <RecipeChatPanel recipeId={c.recipeId} recipeName={c.recipeName} onApplied={() => setReloadTick((t) => t + 1)} />
            )}
          </div>
        ))}
      </div>
      {feedbackEntry && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setFeedbackEntry(null); }}>
          <div className="modal">
            <FeedbackForm
              entry={feedbackEntry}
              beans={beans}
              onDone={() => {
                setFeedbackEntry(null);
                setReloadTick((t) => t + 1);
              }}
            />
          </div>
        </div>
      )}
      {editRecipeId != null && (
        <RecipeEditModal
          recipeId={editRecipeId}
          onClose={() => setEditRecipeId(null)}
          onSaved={() => {
            setEditRecipeId(null);
            setReloadTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}

// ---------- cloud recipes ----------

interface CloudRecipeRow {
  tableId: number;
  name: string;
  dose: number;
  ratio: number;
  grindSize: number;
  rpm: number;
  pourCount: number;
  shareLink: string | null;
  beanId: string | null;
  beanName: string | null;
}

function CloudPage() {
  const [recipes, setRecipes] = useState<CloudRecipeRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    get<CloudRecipeRow[]>("/api/cloud-recipes")
      .then(setRecipes)
      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const remove = async () => {
    if (!selected.size) return;
    if (!window.confirm(`确定删除云端 ${selected.size} 个配方？此操作不可恢复。`)) return;
    setBusy(true);
    let failed = 0;
    for (const id of [...selected]) {
      try {
        await del(`/api/cloud-recipes/${id}`);
      } catch {
        failed += 1;
      }
    }
    setSelected(new Set());
    setMsg(failed ? `完成，${failed} 个删除失败（请重试）` : `已删除 ${selected.size} 个配方`);
    await load();
    setBusy(false);
  };

  return (
    <div className="page">
      <div className="row between">
        <h2>云端配方（{recipes.length}）</h2>
        <div className="row">
          <button className="primary" disabled={!selected.size || busy} onClick={remove}>
            删除所选（{selected.size}）
          </button>
        </div>
      </div>
      {msg && <p className={msg.includes("失败") ? "error" : "ok"}>{msg}</p>}
      <p className="muted">删除为手动操作、逐条执行，云端与本地映射会一起清理；历史冲泡记录保留。</p>
      <div className="stack">
        {recipes.map((r) => (
          <div key={r.tableId} className="row between card tight">
            <label className="row" style={{ flex: 1, cursor: "pointer" }}>
              <input type="checkbox" checked={selected.has(r.tableId)} onChange={() => toggle(r.tableId)} />
              <span>
                <strong>{r.name}</strong>
                <span className="muted">
                  {" "}
                  · {r.dose}g · 1:{r.ratio} · 研磨 {r.grindSize} · {r.rpm}rpm · {r.pourCount} 段
                </span>
              </span>
            </label>
            <span className={r.beanName ? "" : "muted"}>
              {r.beanName ? `豆子：${r.beanName}` : "未关联豆子"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BeanForm({ initial, onSave, onCancel }: { initial: Partial<Bean>; onSave: (b: Partial<Bean>) => void; onCancel: () => void }) {
  const [form, setForm] = useState<Partial<Bean>>(initial);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div className="form">
      <h3>{initial.id ? "编辑豆子" : "加豆子"}</h3>
      <label>
        名称 *
        <input value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="如 锦绣 - 耶加雪菲" />
      </label>
      <div className="row two">
        <label>
          产地 *
          <input value={form.origin ?? ""} onChange={(e) => set("origin", e.target.value)} placeholder="如 埃塞俄比亚" />
        </label>
        <label>
          豆种
          <input value={form.variety ?? ""} onChange={(e) => set("variety", e.target.value)} placeholder="如 瑰夏 / SL28" />
        </label>
      </div>
      <div className="row two">
        <label>
          烘焙度 *
          <select value={form.roastLevel ?? ""} onChange={(e) => set("roastLevel", e.target.value)}>
            <option value="">未设置</option>
            {ROAST_LEVELS.map((r) => (
              <option key={r} value={r}>
                {ROAST_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          处理法
          <select value={form.process ?? ""} onChange={(e) => set("process", e.target.value)}>
            <option value="">未设置</option>
            {PROCESSES.map((p) => (
              <option key={p} value={p}>
                {PROCESS_LABEL[p]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row two">
        <label>
          烘焙日期
          <input type="date" value={form.roastDate ?? ""} onChange={(e) => set("roastDate", e.target.value)} />
        </label>
        <label>
          开封日期（选填）
          <input type="date" value={form.openedDate ?? ""} onChange={(e) => set("openedDate", e.target.value)} />
        </label>
      </div>
      <div className="row two">
        <label>
          容量（克重）g
          <input type="number" value={form.packageWeightG ?? ""} onChange={(e) => set("packageWeightG", Number(e.target.value))} placeholder="如 250" />
        </label>
        <label>
          参考研磨度
          <input value={form.referenceGrind ?? ""} onChange={(e) => set("referenceGrind", e.target.value)} placeholder="如 C40 18 / 800um" />
        </label>
      </div>
      <label>
        风味描述
        <textarea value={form.flavorNotes ?? ""} onChange={(e) => set("flavorNotes", e.target.value)} placeholder="花香、果酸、甜感…" />
      </label>
      <div className="row">
        <button className="primary" disabled={!form.name || !form.origin} onClick={() => onSave(form)}>
          保存
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
      <p className="muted">拍照识别为 v2 占位（DeepSeek 暂不支持多模态）</p>
    </div>
  );
}

function RefillDialog({ bean, onClose, onDone }: { bean: Bean; onClose: () => void; onDone: () => void }) {
  const [g, setG] = useState<string>(bean.packageWeightG != null ? String(bean.packageWeightG) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    const n = Number(g);
    if (!n || n <= 0) {
      setErr("请输入有效容量");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await post(`/api/beans/${bean.id}/refill`, { packageWeightG: n });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>开新袋：{bean.name}</h3>
        <label>
          新袋容量（g）
          <input type="number" value={g} onChange={(e) => setG(e.target.value)} placeholder="如 250" autoFocus />
        </label>
        {err && <p className="error">{err}</p>}
        <div className="row">
          <button className="primary" disabled={busy} onClick={submit}>
            确认开新袋
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

function LoginModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await post("/api/login", { email, password });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <h3>重新登录 XBloom</h3>
        <label>
          邮箱
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label>
          密码
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) submit();
            }}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy || !email || !password} onClick={submit}>
            {busy ? "登录中…" : "登录"}
          </button>
          <button onClick={onClose}>取消</button>
        </div>
      </div>
    </div>
  );
}

// ---------- brew ----------

function BrewPage() {
  const [beans, setBeans] = useState<Bean[]>([]);
  const [beanId, setBeanId] = useState("");
  const [filter, setFilter] = useState<"all" | "iced" | "hot">("all");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showGen, setShowGen] = useState(false);
  const [genMode, setGenMode] = useState<"hot" | "iced">("iced");
  const [busy, setBusy] = useState(false);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState("");
  const [pushResult, setPushResult] = useState("");

  useEffect(() => {
    get<Bean[]>("/api/beans").then((bs) => {
      setBeans(bs);
      if (bs.length) setBeanId((cur) => cur || bs[0].id);
    }).catch(() => setBeans([]));
  }, []);

  useEffect(() => {
    if (!beanId) return;
    get<HistoryEntry[]>(`/api/history?beanId=${beanId}`).then(setHistory).catch(() => setHistory([]));
    get<Suggestion[]>(`/api/suggestions?beanId=${beanId}`).then((rows) => {
      setSuggestions(
        rows.map((s) => ({
          ...s,
          content: typeof s.content === "string" ? (JSON.parse(s.content) as Suggestion["content"]) : s.content,
        })),
      );
    }).catch(() => setSuggestions([]));
  }, [beanId]);

  const lastSuggestion = suggestions.find((s) => s.status === "done" || s.status === "applied");
  const deltaMap = new Map<string, { to: number | string | null; direction: string; reason: string }>();
  for (const d of lastSuggestion?.content?.deltas ?? []) {
    deltaMap.set(d.param, { to: d.to ?? null, direction: d.direction, reason: d.reason });
  }

  interface RecipeCard {
    key: string;
    recipeName: string;
    entries: HistoryEntry[];
    latest: HistoryEntry;
    mode: string;
  }
  const groups = new Map<string, HistoryEntry[]>();
  for (const h of [...history].sort((a, b) => (a.brewedAt < b.brewedAt ? 1 : -1))) {
    const key = h.recipeId ? `rid:${h.recipeId}` : `name:${h.recipeName}`;
    const list = groups.get(key) ?? [];
    list.push(h);
    groups.set(key, list);
  }
  let cards: RecipeCard[] = [...groups.entries()].map(([key, entries]) => {
    const latest = entries[0];
    const mode = latest.recipeName.includes("冰饮") ? "iced" : latest.recipeName.includes("热饮") ? "hot" : "other";
    return { key, recipeName: latest.recipeName, entries, latest, mode };
  });
  if (filter !== "all") cards = cards.filter((c) => c.mode === filter);

  const paramLabel = (param: string): string => {
    const m = param.match(/^pours\[(\d+)\]\.(\w+)$/);
    if (m) {
      const field = m[2];
      const fieldLabel: Record<string, string> = { temperature_c: "水温", pause_seconds: "暂停", pattern: "Pattern", flow_rate: "流速", volume_ml: "水量" };
      return `第${Number(m[1]) + 1}段${fieldLabel[field] ?? field}`;
    }
    const labels: Record<string, string> = { grind_size: "研磨", grind_rpm: "转速", dose_g: "粉量", ratio: "比例", temperature_c: "水温", flow_rate: "流速", pause_seconds: "暂停", pattern: "Pattern" };
    return labels[param] ?? param;
  };
  const valueLabel = (param: string, v: number | string | null): string => {
    if (v == null) return "?";
    if (param === "grind_size" || param === "grind_rpm" || param === "pause_seconds") return String(v);
    if (param.endsWith("flow_rate")) return String(v);
    if (param.endsWith("temperature_c") || param.endsWith("volume_ml")) return `${v}`;
    if (param === "ratio") return `1:${v}`;
    if (param === "dose_g") return `${v}g`;
    if (param === "pattern") return String(v);
    return String(v);
  };

  const paramRows = (card: RecipeCard): Array<[string, string]> => {
    const p = card.latest.params ?? { dose_g: 0, ratio: 0, grind_size: 0, grind_rpm: 0, pours: [] };
    const rows: Array<[string, string]> = [
      ["粉量", `${p.dose_g}g`],
      ["比例", `1:${p.ratio}`],
      ["研磨", String(p.grind_size)],
      ["转速", `${p.grind_rpm} rpm`],
      ["段数", `${p.pours.length} 段`],
      ["水温", p.pours.length ? `${p.pours.map((x) => x.temperature_c).sort((a, b) => a - b)[0]}–${p.pours.map((x) => x.temperature_c).sort((a, b) => b - a)[0]}°C` : "—"],
      ["流速", p.pours[0]?.flow_rate ? `${p.pours[0].flow_rate} ml/s` : "—"],
    ];
    return rows;
  };

  const rowChanged = (label: string): boolean => {
    const mapping: Record<string, string[]> = {
      粉量: ["dose_g"],
      比例: ["ratio"],
      研磨: ["grind_size"],
      转速: ["grind_rpm"],
      水温: ["temperature_c"],
      流速: ["flow_rate"],
    };
    const keys = mapping[label] ?? [];
    return keys.some((k) => deltaMap.has(k) || [...deltaMap.keys()].some((p) => p.endsWith(`.${k}`)));
  };

  const generate = async () => {
    setError("");
    setPushResult("");
    setRecipe(null);
    setRaw("");
    setBusy(true);
    try {
      const { jobId } = await post<{ jobId: string }>("/api/recipes/generate", { beanId, mode: genMode });
      pollJob<Recipe>(
        jobId,
        (r) => {
          setRecipe(r);
          setBusy(false);
        },
        (err) => {
          setError(`生成失败：${err}`);
          setBusy(false);
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const push = async () => {
    if (!recipe) return;
    setError("");
    try {
      const r = await post<{ tableId: number; message: string; version: number }>("/api/recipes/push", { beanId, recipe });
      setPushResult(`已推送：配方 ID ${r.tableId}（版本 v${r.version}），手机 App 下拉刷新即可使用`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="page">
      <div className="row between">
        <h2>冲煮向导</h2>
        <button className="primary" onClick={() => setShowGen((v) => !v)}>
          {showGen ? "收起新配方" : "+ 生成新配方"}
        </button>
      </div>

      <div className="row two">
        <label>
          豆子
          <select value={beanId} onChange={(e) => setBeanId(e.target.value)}>
            {beans.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          饮用方式
          <select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "iced" | "hot")}>
            <option value="all">全部</option>
            <option value="iced">冰饮</option>
            <option value="hot">热饮</option>
          </select>
        </label>
      </div>

      {showGen && (
        <div className="card">
          <div className="row">
            <label className="inline">
              饮用方式
              <select value={genMode} onChange={(e) => setGenMode(e.target.value as "hot" | "iced")}>
                <option value="iced">冰饮</option>
                <option value="hot">热饮</option>
              </select>
            </label>
            <button className="primary" disabled={!beanId || busy} onClick={generate}>
              {busy ? "Hermes 推演中（可能要几分钟）…" : "出配方"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          {raw && <pre>{raw}</pre>}
          {recipe && (
            <div className="recipe">
              <h3>{recipe.name}</h3>
              <p>{recipe.summary}</p>
              <table>
                <tbody>
                  <tr>
                    <td>粉量</td>
                    <td>{recipe.dose_g}g</td>
                    <td>比例</td>
                    <td>1:{recipe.ratio}</td>
                  </tr>
                  <tr>
                    <td>研磨</td>
                    <td>{recipe.grind_size}</td>
                    <td>转速</td>
                    <td>{recipe.grind_rpm} rpm</td>
                  </tr>
                </tbody>
              </table>
              <div className="row">
                <button className="primary" onClick={push}>
                  确认，推送到云端
                </button>
              </div>
              {pushResult && <p className="ok">{pushResult}</p>}
            </div>
          )}
        </div>
      )}

      <h3>配方列表（{cards.length}）</h3>
      {cards.length === 0 && <p className="muted">这只豆子还没有冲泡记录，点"生成新配方"开始。</p>}
      <div className="stack">
        {cards.map((card) => {
          const rated = card.entries.filter((e) => e.taste?.rating).sort((a, b) => (a.brewedAt < b.brewedAt ? 1 : -1));
          const latestTaste = rated[0]?.taste;
          return (
            <div key={card.key} className="card">
              <div className="row between">
                <strong>{card.recipeName}</strong>
                <div className="row">
                  {card.mode === "iced" && <span className="badge blue">冰饮</span>}
                  {card.mode === "hot" && <span className="badge amber">热饮</span>}
                  <span className="muted">{card.entries.length} 杯</span>
                </div>
              </div>
              {lastSuggestion && (
                <div className="banner">
                  <strong>上次总结：</strong>
                  <span>{lastSuggestion.content?.summary}</span>
                  <span className={`badge ${lastSuggestion.status === "applied" ? "green" : "new"}`}>
                    {lastSuggestion.status === "applied" ? `已应用 v${lastSuggestion.version ?? "?"}` : "新推荐"}
                  </span>
                </div>
              )}
              <div className="param-grid">
                {paramRows(card).map(([label, value]) => (
                  <span key={label} className={rowChanged(label) ? "changed" : ""}>
                    {label} {value}
                  </span>
                ))}
              </div>
              {deltaMap.size > 0 && (
                <div className="delta-list">
                  {[...deltaMap.entries()].map(([param, d]) => (
                    <span key={param} className={`badge ${lastSuggestion?.status === "applied" ? "green" : "new"}`}>
                      {paramLabel(param)} {valueLabel(param, d.to)}（{d.direction}）
                    </span>
                  ))}
                </div>
              )}
              <div className="muted">
                {latestTaste ? `最近反馈：${tasteSummary(latestTaste)}` : "暂无反馈"}
                {rated.length > 0 && ` · 评分 ${rated.map((e) => e.taste?.rating).join("/")}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- records ----------

function RecordsPage({ onChanged }: { onChanged: () => void }) {
  const [pending, setPending] = useState<HistoryEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [beans, setBeans] = useState<Bean[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    get<HistoryEntry[]>("/api/pending").then(setPending).catch(() => setPending([]));
    get<HistoryEntry[]>("/api/history").then(setHistory).catch(() => setHistory([]));
    get<Bean[]>("/api/beans").then(setBeans).catch(() => setBeans([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const sync = async () => {
    setSyncing(true);
    setMsg("");
    try {
      const r = await post<{ total: number; created: number; updated: number; pending: number }>("/api/sync");
      setMsg(`同步完成：云端 ${r.total} 条，新增 ${r.created}，待反馈 ${r.pending}`);
      onChanged();
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const assign = async (cloudRecordId: number, beanId: string) => {
    await post("/api/assign-bean", { cloudRecordId, beanId });
    await load();
  };

  const ignore = async (cloudRecordId: number) => {
    await post("/api/ignore-record", { cloudRecordId });
    await load();
  };

  return (
    <div className="page">
      <div className="row between">
        <h2>冲泡记录</h2>
        <div className="row">
          <button className="primary" disabled={syncing} onClick={sync}>
            {syncing ? "同步中…" : "同步云端"}
          </button>
        </div>
      </div>
      {msg && <p className={msg.startsWith("同步完成") ? "ok" : "error"}>{msg}</p>}

      <h3>待反馈（{pending.length}）</h3>
      {pending.length === 0 && <p className="muted">没有待反馈的杯次</p>}
      <div className="stack">
        {pending.map((h) => (
          <div key={h.id} className="card">
            <div className="row between">
              <div>
                <strong>{h.recipeName}</strong>
                <div className="muted">
                  {fmtDate(h.brewedAt)}
                  {h.brewTime ? ` · 实际 ${h.brewTime}s` : " · 时长缺失"}
                  {h.expectedTime ? ` / 预期约 ${h.expectedTime}s` : ""}
                </div>
              </div>
              <div className="row">
                {h.stallHint && <span className="badge red">疑似卡粉</span>}
                {h.brewTime === 0 && <span className="badge amber">未完成?</span>}
                <button onClick={() => setOpenId(openId === h.id ? null : h.id)}>反馈</button>
                <button onClick={() => h.cloudRecordId != null && ignore(h.cloudRecordId)}>忽略</button>
              </div>
            </div>
            {!h.beanId && (
              <div className="row">
                <span className="muted">未关联豆子：</span>
                <select defaultValue="" onChange={(e) => h.cloudRecordId != null && e.target.value && assign(h.cloudRecordId, e.target.value)}>
                  <option value="" disabled>
                    选择豆子
                  </option>
                  {beans.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {openId === h.id && <FeedbackForm entry={h} beans={beans} onDone={load} />}
          </div>
        ))}
      </div>

      <h3>最近历史</h3>
      <div className="stack">
        {history.slice(0, 30).map((h) => (
          <div key={h.id} className="row between card tight">
            <span>
              {fmtDate(h.brewedAt)} · {h.recipeName}
            </span>
            <span className={h.taste ? "" : "muted"}>{tasteSummary(h.taste)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedbackForm({ entry, beans, onDone }: { entry: HistoryEntry; beans: Bean[]; onDone: () => void }) {
  const [taste, setTaste] = useState<Taste>({ stalled: entry.stallHint });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const set = (k: string, v: unknown) => setTaste((t) => ({ ...t, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setMsg("");
    setSuggestion(null);
    try {
      const r = await post<{ ok: boolean; suggestionId: number | null }>("/api/feedback", {
        historyId: entry.id,
        cloudRecordId: entry.cloudRecordId,
        beanId: entry.beanId,
        taste,
      });
      if (r.suggestionId != null) {
        setMsg("反馈已记录，正在生成参数建议…");
        const timer = setInterval(async () => {
          const s = await get<Suggestion>(`/api/suggestions/${r.suggestionId}`);
          if (s.status !== "running") {
            clearInterval(timer);
            setSuggestion({ ...s, content: typeof s.content === "string" ? JSON.parse(s.content) : s.content });
            setMsg("建议已生成");
          }
        }, 3000);
      } else {
        setMsg("反馈已记录");
      }
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (id: number) => {
    try {
      const r = await post<{ ok: boolean; version: number }>(`/api/suggestions/${id}/apply`);
      setMsg(`建议已应用（v${r.version}），云端配方已更新`);
      setSuggestion(null);
      onDone();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const Tri = ({ label, value, options, onChange }: { label: string; value?: string; options: Array<[string, string]>; onChange: (v: string) => void }) => (
    <div className="tristate">
      <span>{label}</span>
      <div className="row">
        {options.map(([v, l]) => (
          <button key={v} className={value === v ? "active" : ""} onClick={() => onChange(value === v ? "" : v)}>
            {l}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="form feedback">
      <p className="muted">酸/涩/苦是感知强度（弱/中/强），不是好坏——强度由总体星评判</p>
      <div className="stars">
        <span>总体</span>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={taste.rating === n ? "active" : ""} onClick={() => set("rating", taste.rating === n ? undefined : n)}>
            ★
          </button>
        ))}
      </div>
      <Tri label="酸" value={taste.acidity} options={[["weak", "弱"], ["ok", "中"], ["strong", "强"]]} onChange={(v) => set("acidity", v)} />
      <Tri label="涩" value={taste.astringency} options={[["weak", "弱"], ["ok", "中"], ["strong", "强"]]} onChange={(v) => set("astringency", v)} />
      <Tri label="苦" value={taste.bitterness} options={[["weak", "弱"], ["ok", "中"], ["strong", "强"]]} onChange={(v) => set("bitterness", v)} />
      <Tri label="body" value={taste.body} options={[["light", "清爽"], ["medium", "适中"], ["heavy", "厚重"]]} onChange={(v) => set("body", v)} />
      <Tri label="香气" value={taste.aroma} options={[["none", "没闻到"], ["light", "淡"], ["strong", "明显"]]} onChange={(v) => set("aroma", v)} />
      {taste.aroma === "strong" && (
        <label>
          香气类型
          <select value={taste.aromaType ?? ""} onChange={(e) => set("aromaType", e.target.value)}>
            <option value="">选择</option>
            {AROMA_TYPES.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </label>
      )}
      <div className="row">
        <label className="inline">
          <input type="checkbox" checked={!!taste.stalled} onChange={(e) => set("stalled", e.target.checked)} />
          卡粉{entry.stallHint ? "（系统根据时长自动预判，可修改）" : ""}
        </label>
        <label className="inline">
          <input type="checkbox" checked={!!taste.wantIteration} onChange={(e) => set("wantIteration", e.target.checked)} />
          需要迭代参数建议
        </label>
      </div>
      <label>
        备注
        <textarea value={taste.note ?? ""} onChange={(e) => set("note", e.target.value)} placeholder="一句话，可选" />
      </label>
      <div className="row">
        <button className="primary" disabled={busy || !taste.rating} onClick={submit}>
          提交反馈
        </button>
      </div>
      {msg && <p className={msg.includes("失败") ? "error" : "ok"}>{msg}</p>}
      {suggestion && (
        <div className="suggestion card">
          <h4>参数建议</h4>
          <p>{suggestion.content?.summary}</p>
          {(suggestion.content?.deltas ?? []).map((d, i) => (
            <p key={i}>
              <strong>{d.param}</strong>: {d.from ?? "?"} → {d.to ?? "?"}（{d.direction}）· {d.reason} · 预期 {d.expected}
            </p>
          ))}
          {suggestion.status === "done" && (
            <div className="row">
              <button className="primary" onClick={() => apply(suggestion.id)}>
                应用
              </button>
              <button onClick={() => setSuggestion(null)}>忽略</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- chat ----------

function ChatPage() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");

  const send = async () => {
    if (!message.trim()) return;
    setBusy(true);
    setError("");
    setReply("");
    try {
      const { jobId } = await post<{ jobId: string }>("/api/chat", { message });
      pollJob<string>(
        jobId,
        (r) => {
          setReply(r);
          setBusy(false);
        },
        (err) => {
          setError(err);
          setBusy(false);
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h2>对话（接 Hermes）</h2>
      <div className="card">
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="问任何关于豆子、配方、冲煮的问题…" />
        <div className="row">
          <button className="primary" disabled={busy || !message.trim()} onClick={send}>
            {busy ? "思考中…" : "发送"}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {reply && <pre className="reply">{reply}</pre>}
      </div>
    </div>
  );
}
