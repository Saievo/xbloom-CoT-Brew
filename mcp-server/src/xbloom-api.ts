import { publicEncrypt, constants } from "node:crypto";
import { Buffer } from "node:buffer";

const API_BASE = "https://clientcn-api.xbloomcoffee.cn";
const SHARE_BASE = "https://share-h5.xbloom.com";

const RSA_PUBLIC_KEY_B64 =
  "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC4LF40GZ72SdhMyl765K/i4nY5" +
  "CPcHz2Q1IKWKZ9S79xmK7G8pUhbVf4EZLvnNF1+9IvOFQUKV5Z7ZNNviqSpnql9" +
  "tAT+8+J/He0R7pcirvVSxgdr2i9V/C/gmqAEZ5qVTzRnd3uWdFoKzPdEBxP0Ipor" +
  "J1VBbCv90yBSOhVxO+QIDAQAB";

const pemBody = RSA_PUBLIC_KEY_B64.match(/.{1,64}/g)!.join("\n");
const RSA_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----`;

const API_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Referer": `${SHARE_BASE}/`,
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
};

export interface XBloomCreds {
  memberId: number;
  token: string;
  email: string;
}

const PATTERN_MAP: Record<string, number> = { centered: 1, spiral: 2, circular: 3 };
const PATTERN_REV: Record<number, string> = { 1: "centered", 2: "spiral", 3: "circular" };

// --- RSA Encryption ---

function rsaEncrypt(payload: Record<string, unknown>): string {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
  const chunkSize = 117;
  const chunks: Buffer[] = [];
  for (let i = 0; i < plaintext.length; i += chunkSize) {
    const chunk = plaintext.subarray(i, i + chunkSize);
    const encrypted = publicEncrypt(
      { key: RSA_PUBLIC_KEY_PEM, padding: constants.RSA_PKCS1_PADDING },
      chunk,
    );
    chunks.push(encrypted);
  }
  return Buffer.concat(chunks).toString("base64");
}

// --- HTTP helpers ---

async function postPlain(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const resp = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: API_HEADERS,
    body: JSON.stringify(payload),
  });
  return await resp.json() as Record<string, unknown>;
}

async function postEncrypted(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const encrypted = rsaEncrypt(payload);
  const resp = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: { ...API_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(encrypted),
  });
  return await resp.json() as Record<string, unknown>;
}

function authBase(creds: XBloomCreds): Record<string, unknown> {
  return {
    interfaceVersion: 20240918,
    skey: "testskey",
    phoneType: "Android",
    memberId: creds.memberId,
    clientType: 2,
    languageType: 1,
    token: creds.token,
  };
}

// --- Pour helpers ---

interface Pour {
  volume_ml?: number;
  temperature_c?: number;
  pattern?: string;
  flow_rate?: number;
  pause_seconds?: number;
  agitate_before?: boolean;
  agitate_after?: boolean;
}

function buildPourList(pours: Pour[]) {
  return pours.map((p, i) => ({
    theName: i === 0 ? "Bloom" : `Pour ${i + 1}`,
    volume: Number(p.volume_ml ?? 30),
    temperature: Number(p.temperature_c ?? 93),
    flowRate: Number(p.flow_rate ?? 3.0),
    pattern: PATTERN_MAP[p.pattern ?? "circular"] ?? 2,
    pausing: Number(p.pause_seconds ?? 0),
    isEnableVibrationBefore: p.agitate_before ? 1 : 2,
    isEnableVibrationAfter: p.agitate_after ? 1 : 2,
  }));
}

// --- Public API functions ---

export async function login(email: string, password: string): Promise<XBloomCreds> {
  const resp = await postPlain("tMemberLogin.thtml", {
    interfaceVersion: 20240918,
    skey: "testskey",
    clientType: 2,
    phoneType: "Android",
    languageType: 1,
    email,
    password,
  });

  if (resp.result !== "success") {
    throw new Error("Login failed. Check your email and password.");
  }

  const member = resp.member as Record<string, unknown>;
  return {
    memberId: member.tableId as number,
    token: resp.token as string,
    email,
  };
}

export async function listRecipes(creds: XBloomCreds): Promise<string> {
  const payload = { ...authBase(creds), pageNumber: 1, countPerPage: 100, adaptedModel: 1 };
  const resp = await postEncrypted("tuMyTeaRecipeCreated.tuhtml", payload);
  if (resp.result !== "success") {
    throw new Error("Failed to list recipes. Session may have expired — try logging in again.");
  }
  const recipes = (resp.list as Record<string, unknown>[]) || [];
  if (!recipes.length) return "No recipes found.";
  const lines = [`Found ${recipes.length} recipes:\n`];
  for (const r of recipes) {
    lines.push(`  [${r.tableId}] ${r.theName} — ${r.dose}g, 1:${r.grandWater}, grind ${r.grinderSize}, rpm ${r.rpm}`);
    if (r.shareRecipeLink) lines.push(`    Share: ${r.shareRecipeLink}`);
  }
  return lines.join("\n");
}

export async function createRecipe(
  creds: XBloomCreds,
  args: { name: string; dose_g: number; ratio: number; grind_size: number; grind_rpm: number; pours: Pour[]; color?: string },
): Promise<string> {
  const pourList = buildPourList(args.pours);
  // API requires total pour volume == dose * ratio exactly
  const targetVolume = Math.round(args.dose_g * args.ratio);
  const actualVolume = pourList.reduce((s, p) => s + Number(p.volume), 0);
  if (actualVolume !== targetVolume) {
    const diff = targetVolume - actualVolume;
    pourList[pourList.length - 1].volume = Number(pourList[pourList.length - 1].volume) + diff;
  }
  const capacity = pourList.reduce((s, p) => s + Number(p.volume), 0);
  const payload = {
    ...authBase(creds),
    theName: args.name,
    dose: args.dose_g,
    grandWater: args.ratio,
    capacity,
    grinderSize: args.grind_size,
    rpm: args.grind_rpm,
    cupType: 2,
    adaptedModel: 1,
    isEnableBypassWater: 2,
    isSetGrinderSize: 1,
    theColor: args.color || "#C9D5B8",
    theSubsetId: 0,
    bypassTemp: 85.0,
    bypassVolume: 5.0,
    subSetType: 2,
    appPlace: [4],
    createTimeStamp: Date.now(),
    isShortcuts: 2,
    pourDataJSONStr: JSON.stringify(pourList),
  };
  const resp = await postEncrypted("tuRecipeAdd.tuhtml", payload);
  if (resp.result !== "success") {
    throw new Error(`Failed to create recipe: ${resp.info ?? "unknown error"}`);
  }
  const shareId = btoa(String(resp.tableId));
  return `Recipe '${args.name}' created! ID: ${resp.tableId}\nShare: ${SHARE_BASE}/?id=${encodeURIComponent(shareId)}`;
}

export async function createTeaRecipe(
  creds: XBloomCreds,
  args: { name: string; dose_g: number; ratio: number; steeps: Array<{ volume_ml?: number; temperature_c?: number; steep_seconds?: number; flow_rate?: number }>; color?: string },
): Promise<string> {
  const pourList = args.steeps.slice(0, 3).map((s, i) => ({
    theName: `Steep ${i + 1}`,
    volume: Math.min(Number(s.volume_ml ?? 80), 90),
    temperature: Number(s.temperature_c ?? 85),
    flowRate: Number(s.flow_rate ?? 3.0),
    pattern: 3,
    pausing: Math.min(Number(s.steep_seconds ?? 120), 360),
    isEnableVibrationBefore: 2,
    isEnableVibrationAfter: 2,
  }));
  const payload = {
    ...authBase(creds),
    theName: args.name,
    dose: Math.min(args.dose_g, 10),
    grandWater: args.ratio,
    grinderSize: 50,
    rpm: 60,
    cupType: 4,
    adaptedModel: 1,
    isEnableBypassWater: 2,
    isSetGrinderSize: 2,
    theColor: args.color || "#A8C686",
    theSubsetId: 0,
    bypassTemp: 85.0,
    bypassVolume: 5.0,
    subSetType: 2,
    appPlace: [4],
    createTimeStamp: Date.now(),
    isShortcuts: 2,
    pourDataJSONStr: JSON.stringify(pourList),
  };
  const resp = await postEncrypted("tuRecipeAdd.tuhtml", payload);
  if (resp.result !== "success") {
    throw new Error("Failed to create tea recipe. Session may have expired.");
  }
  const shareId = btoa(String(resp.tableId));
  return `Tea recipe '${args.name}' created! ID: ${resp.tableId}\nShare: ${SHARE_BASE}/?id=${encodeURIComponent(shareId)}`;
}

export async function editRecipe(
  creds: XBloomCreds,
  args: { recipe_id: number; name?: string; dose_g?: number; ratio?: number; grind_size?: number; grind_rpm?: number; pours?: Pour[]; color?: string },
): Promise<string> {
  const listPayload = { ...authBase(creds), pageNumber: 1, countPerPage: 100, adaptedModel: 1 };
  const listResp = await postEncrypted("tuMyTeaRecipeCreated.tuhtml", listPayload);
  let current: Record<string, unknown> | null = null;
  if (listResp.result === "success") {
    for (const r of (listResp.list as Record<string, unknown>[]) || []) {
      if (r.tableId === args.recipe_id) { current = r; break; }
    }
  }
  if (!current) throw new Error(`Recipe [${args.recipe_id}] not found.`);

  const payload: Record<string, unknown> = {
    ...authBase(creds),
    tableId: args.recipe_id,
    theName: args.name || current.theName,
    dose: args.dose_g ?? Number(current.dose),
    grandWater: args.ratio ?? Number(current.grandWater),
    grinderSize: args.grind_size ?? Number(current.grinderSize),
    rpm: args.grind_rpm ?? Number(current.rpm),
    theColor: args.color || current.theColor || "#C9D5B8",
    cupType: current.cupType ?? 2,
    adaptedModel: 1,
    isEnableBypassWater: 2,
    isSetGrinderSize: current.isSetGrinderSize ?? 1,
    theSubsetId: current.theSubsetId ?? 0,
    bypassTemp: current.bypassTemp ?? 85.0,
    bypassVolume: current.bypassVolume ?? 5.0,
    subSetType: 2,
    appPlace: [4],
    isShortcuts: current.isShortcuts ?? 2,
  };

  if (args.pours) {
    payload.pourDataJSONStr = JSON.stringify(buildPourList(args.pours));
  } else {
    const existing = (current.pourList as Record<string, unknown>[]) || [];
    payload.pourDataJSONStr = JSON.stringify(existing.map(p => ({
      theName: p.theName,
      volume: Number(p.volume ?? 30),
      temperature: Number(p.temperature ?? 93),
      flowRate: Number(p.flowRate ?? 3.0),
      pattern: Number(p.pattern ?? 2),
      pausing: Number(p.pausing ?? 0),
      isEnableVibrationBefore: Number(p.isEnableVibrationBefore ?? 2),
      isEnableVibrationAfter: Number(p.isEnableVibrationAfter ?? 2),
    })));
  }

  const resp = await postEncrypted("tuRecipeUpdate.tuhtml", payload);
  if (resp.result !== "success") {
    throw new Error("Failed to update recipe. Session may have expired.");
  }
  return `Recipe [${args.recipe_id}] updated!`;
}

export async function deleteRecipe(creds: XBloomCreds, recipeId: number): Promise<string> {
  const resp = await postEncrypted("tuRecipeDelete.tuhtml", { ...authBase(creds), tableId: recipeId });
  if (resp.result !== "success") {
    throw new Error("Failed to delete recipe. Session may have expired.");
  }
  return `Recipe [${recipeId}] deleted.`;
}

export async function fetchRecipe(shareUrl: string): Promise<string> {
  let shareId: string | null = shareUrl;
  if (shareId.includes("share-h5.xbloom")) {
    const url = new URL(shareId);
    shareId = url.searchParams.get("id");
  }
  if (!shareId) throw new Error(`Could not parse share ID from: ${shareUrl}`);

  const resp = await postPlain("RecipeDetail.html", { tableIdOfRSA: shareId, interfaceVersion: 19700101, skey: "testskey" });
  if (resp.result !== "success") {
    throw new Error("Failed to fetch recipe. The share URL may be invalid.");
  }
  const rv = resp.recipeVo as Record<string, unknown>;
  const pourList = (rv.pourList as Record<string, unknown>[]) || [];
  return JSON.stringify({
    name: rv.theName ?? "Imported Recipe",
    dose_g: rv.dose ?? 15,
    ratio: rv.grandWater ?? 15,
    grind_size: rv.grinderSize ?? 70,
    grind_rpm: rv.rpm ?? 80,
    cup_type: "omni",
    pours: pourList.map(p => ({
      volume_ml: p.volume ?? 30,
      temperature_c: p.temperature ?? 93,
      pattern: PATTERN_REV[Number(p.pattern ?? 2)] ?? "circular",
      flow_rate: p.flowRate ?? 3.0,
      pause_seconds: p.pausing ?? 0,
      agitate_before: p.isEnableVibrationBefore === 1,
      agitate_after: p.isEnableVibrationAfter === 1,
    })),
  }, null, 2);
}
