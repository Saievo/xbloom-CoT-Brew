import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DATA_DIR = join(homedir(), ".xbloom");
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "loop.db"));

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS recipe_beans (
    recipe_id   INTEGER PRIMARY KEY,
    bean_id     TEXT,
    recipe_name TEXT,
    version     INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS brew_records (
    cloud_record_id INTEGER PRIMARY KEY,
    brewed_at       TEXT NOT NULL,
    bean_id         TEXT,
    recipe_id       INTEGER,
    recipe_name     TEXT,
    brew_time_s     INTEGER NOT NULL DEFAULT 0,
    expected_time_s REAL,
    stall_hint      INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'recorded',
    history_id      TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS suggestions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bean_id     TEXT,
    history_id  TEXT,
    record_id   INTEGER,
    content     TEXT,
    status      TEXT NOT NULL DEFAULT 'running',
    version     INTEGER,
    error       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recipe_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bean_id     TEXT,
    recipe_id   INTEGER,
    version     INTEGER NOT NULL,
    params      TEXT NOT NULL,
    source      TEXT NOT NULL,
    applied_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recipe_chats (
    recipe_id     INTEGER PRIMARY KEY,
    bean_id       TEXT,
    recipe_name   TEXT,
    messages      TEXT NOT NULL DEFAULT '[]',
    pending_adjust TEXT,
    updated_at    TEXT NOT NULL
  );
`);

export interface ChatMessage {
  role: "user" | "ai";
  text: string;
  thought?: string;
  adjust?: { deltas?: Array<Record<string, unknown>>; summary?: string } | null;
  ts: string;
}

export interface RecipeChat {
  recipe_id: number;
  bean_id: string | null;
  recipe_name: string | null;
  messages: ChatMessage[];
  pending_adjust: string | null;
}

export function getRecipeChat(recipeId: number): RecipeChat | null {
  const row = db.prepare("SELECT * FROM recipe_chats WHERE recipe_id = ?").get(recipeId) as
    | { recipe_id: number; bean_id: string | null; recipe_name: string | null; messages: string; pending_adjust: string | null }
    | null;
  if (!row) return null;
  return {
    recipe_id: row.recipe_id,
    bean_id: row.bean_id,
    recipe_name: row.recipe_name,
    messages: JSON.parse(row.messages) as ChatMessage[],
    pending_adjust: row.pending_adjust,
  };
}

export function upsertRecipeChat(
  recipeId: number,
  beanId: string | null,
  recipeName: string | null,
  messages: ChatMessage[],
  pendingAdjust: string | null,
): void {
  db.prepare(`
    INSERT INTO recipe_chats (recipe_id, bean_id, recipe_name, messages, pending_adjust, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(recipe_id) DO UPDATE SET
      bean_id = excluded.bean_id,
      recipe_name = excluded.recipe_name,
      messages = excluded.messages,
      pending_adjust = excluded.pending_adjust,
      updated_at = excluded.updated_at
  `).run(recipeId, beanId, recipeName, JSON.stringify(messages), pendingAdjust, new Date().toISOString());
}

export interface BrewRecordRow {
  cloud_record_id: number;
  brewed_at: string;
  bean_id: string | null;
  recipe_id: number | null;
  recipe_name: string;
  brew_time_s: number;
  expected_time_s: number | null;
  stall_hint: number;
  status: string;
  history_id: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertBrewRecord(row: BrewRecordRow): void {
  db.prepare(`
    INSERT INTO brew_records
      (cloud_record_id, brewed_at, bean_id, recipe_id, recipe_name, brew_time_s,
       expected_time_s, stall_hint, status, history_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cloud_record_id) DO UPDATE SET
      bean_id = excluded.bean_id,
      recipe_id = excluded.recipe_id,
      recipe_name = excluded.recipe_name,
      brew_time_s = excluded.brew_time_s,
      expected_time_s = excluded.expected_time_s,
      stall_hint = excluded.stall_hint,
      status = excluded.status,
      history_id = excluded.history_id,
      updated_at = excluded.updated_at
  `).run(
    row.cloud_record_id,
    row.brewed_at,
    row.bean_id,
    row.recipe_id,
    row.recipe_name,
    row.brew_time_s,
    row.expected_time_s,
    row.stall_hint,
    row.status,
    row.history_id,
    row.created_at,
    row.updated_at,
  );
}

export function getBrewRecord(cloudRecordId: number): BrewRecordRow | null {
  return db.prepare("SELECT * FROM brew_records WHERE cloud_record_id = ?").get(cloudRecordId) as unknown as BrewRecordRow | null;
}

export function listBrewRecords(): BrewRecordRow[] {
  return db.prepare("SELECT * FROM brew_records ORDER BY brewed_at DESC").all() as unknown as BrewRecordRow[];
}

export function getRecipeBeanMapping(recipeId: number | null): { bean_id: string } | null {
  if (!recipeId) return null;
  return db.prepare("SELECT bean_id FROM recipe_beans WHERE recipe_id = ?").get(recipeId) as { bean_id: string } | null;
}

export function setRecipeBeanMapping(recipeId: number, beanId: string, recipeName: string): void {
  db.prepare(`
    INSERT INTO recipe_beans (recipe_id, bean_id, recipe_name, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(recipe_id) DO UPDATE SET bean_id = excluded.bean_id, recipe_name = excluded.recipe_name
  `).run(recipeId, beanId, recipeName, new Date().toISOString());
}

export function deleteRecipeMapping(recipeId: number): void {
  db.prepare("DELETE FROM recipe_beans WHERE recipe_id = ?").run(recipeId);
}

export function deleteBeanAssociations(beanId: string): void {
  db.prepare("DELETE FROM recipe_beans WHERE bean_id = ?").run(beanId);
  db.prepare("DELETE FROM suggestions WHERE bean_id = ?").run(beanId);
}

export function nextRecipeVersion(recipeId: number): number {
  const row = db.prepare("SELECT version FROM recipe_beans WHERE recipe_id = ?").get(recipeId) as { version: number } | null;
  const next = (row?.version ?? 0) + 1;
  if (!row) {
    db.prepare("INSERT OR IGNORE INTO recipe_beans (recipe_id, bean_id, recipe_name, version, created_at) VALUES (?, NULL, NULL, 0, ?)").run(
      recipeId,
      new Date().toISOString(),
    );
  }
  db.prepare("UPDATE recipe_beans SET version = ? WHERE recipe_id = ?").run(next, recipeId);
  return next;
}

export function listMappings(): Array<{ recipe_id: number; bean_id: string | null; recipe_name: string | null }> {
  return db.prepare("SELECT recipe_id, bean_id, recipe_name FROM recipe_beans ORDER BY recipe_id DESC").all() as Array<{
    recipe_id: number;
    bean_id: string | null;
    recipe_name: string | null;
  }>;
}

export function createSuggestion(beanId: string | null, historyId: string | null, recordId: number | null): number {
  const now = new Date().toISOString();
  const res = db.prepare(`
    INSERT INTO suggestions (bean_id, history_id, record_id, content, status, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 'running', ?, ?)
  `).run(beanId, historyId, recordId, now, now);
  return Number(res.lastInsertRowid);
}

export function finishSuggestion(id: number, content: string | null, error: string | null, version?: number): void {
  db.prepare(`
    UPDATE suggestions SET content = ?, status = ?, version = ?, error = ?, updated_at = ?
    WHERE id = ?
  `).run(content, error ? "error" : "done", version ?? null, error, new Date().toISOString(), id);
}

export function getSuggestion(id: number): Record<string, unknown> | null {
  return db.prepare("SELECT * FROM suggestions WHERE id = ?").get(id) as Record<string, unknown> | null;
}

export function listSuggestions(beanId?: string): Record<string, unknown>[] {
  if (beanId) {
    return db.prepare("SELECT * FROM suggestions WHERE bean_id = ? ORDER BY id DESC LIMIT 20").all(beanId) as Record<string, unknown>[];
  }
  return db.prepare("SELECT * FROM suggestions ORDER BY id DESC LIMIT 20").all() as Record<string, unknown>[];
}

export function markSuggestionStatus(id: number, status: "applied" | "ignored", version?: number): void {
  db.prepare("UPDATE suggestions SET status = ?, version = ?, updated_at = ? WHERE id = ?").run(
    status,
    version ?? null,
    new Date().toISOString(),
    id,
  );
}

export function addRecipeVersion(beanId: string, recipeId: number, version: number, params: unknown, source: string): void {
  db.prepare(`
    INSERT INTO recipe_versions (bean_id, recipe_id, version, params, source, applied_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(beanId, recipeId, version, JSON.stringify(params), source, new Date().toISOString());
}

export function listRecipeVersions(recipeId?: number): Array<Record<string, unknown>> {
  if (recipeId) {
    return db.prepare("SELECT * FROM recipe_versions WHERE recipe_id = ? ORDER BY version DESC").all(recipeId) as Array<Record<string, unknown>>;
  }
  return db.prepare("SELECT * FROM recipe_versions ORDER BY id DESC LIMIT 50").all() as Array<Record<string, unknown>>;
}
