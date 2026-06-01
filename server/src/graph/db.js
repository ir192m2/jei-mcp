import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db = null;

function resolveDbPath(dbPath) {
  if (dbPath) return dbPath;
  const env = process.env.JEI_GRAPH_DB;
  if (env) return env;
  const defaultPath = join(__dirname, "../../../jei-graph/graph.db");
  if (existsSync(defaultPath)) return defaultPath;
  throw new Error(
    `Graph database not found at ${defaultPath}. ` +
    `Set JEI_GRAPH_DB env var or run \`npm run graph:import\` to build it.`
  );
}

export function getDb(dbPath) {
  if (_db) return _db;
  const p = resolveDbPath(dbPath);
  _db = new DatabaseSync(p);
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA busy_timeout=5000");
  _db.exec("PRAGMA mmap_size=268435456");
  _db.exec("PRAGMA synchronous=NORMAL");
  _db.exec("PRAGMA cache_size=-2000000");
  _db.exec("PRAGMA temp_store=MEMORY");
  _db.exec("PRAGMA read_uncommitted=true");
  return _db;
}

export function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

export function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS items (
      uid TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      mod_id TEXT NOT NULL,
      registry_name TEXT,
      metadata INTEGER DEFAULT 0,
      recipe_count INTEGER DEFAULT 0,
      use_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      category TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
    CREATE INDEX IF NOT EXISTS idx_edges_category ON edges(category);
    CREATE INDEX IF NOT EXISTS idx_edges_st ON edges(source, target);

    CREATE TABLE IF NOT EXISTS mods (
      mod_id TEXT PRIMARY KEY,
      item_count INTEGER DEFAULT 0,
      recipe_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      category TEXT PRIMARY KEY,
      edge_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      uid,
      display_name,
      mod_id,
      tokenize='porter unicode61'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS edges_fts USING fts5(
      source,
      target,
      category,
      tokenize='porter unicode61'
    );
  `);
}

export function clearGraph(db) {
  db.exec("DELETE FROM items_fts");
  db.exec("DELETE FROM edges_fts");
  db.exec("DELETE FROM edges");
  db.exec("DELETE FROM items");
  db.exec("DELETE FROM mods");
  db.exec("DELETE FROM categories");
  db.exec("DELETE FROM meta");
}

export function setMeta(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(key, String(value));
}

export function getMeta(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row ? row.value : null;
}

export function getMetaNumber(db, key) {
  const v = getMeta(db, key);
  return v == null ? 0 : Number(v);
}

export function validateGraph(db, options = {}) {
  const { checkOrphans = false } = options;
  const issues = [];
  const itemCount = Number(getMeta(db, "item_count")) || db.prepare("SELECT COUNT(*) as c FROM items").get().c;
  const edgeCount = Number(getMeta(db, "edge_count")) || db.prepare("SELECT COUNT(*) as c FROM edges").get().c;
  const ftsItemCount = db.prepare("SELECT COUNT(*) as c FROM items_fts").get().c;
  const ftsEdgeCount = db.prepare("SELECT COUNT(*) as c FROM edges_fts").get().c;
  if (itemCount !== ftsItemCount) {
    issues.push(`items count (${itemCount}) != items_fts count (${ftsItemCount})`);
  }
  if (edgeCount !== ftsEdgeCount) {
    issues.push(`edges count (${edgeCount}) != edges_fts count (${ftsEdgeCount})`);
  }
  let orphanSrc = 0, orphanTgt = 0;
  if (checkOrphans) {
    orphanSrc = db.prepare("SELECT COUNT(*) as c FROM edges e WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.uid = e.source)").get().c;
    orphanTgt = db.prepare("SELECT COUNT(*) as c FROM edges e WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.uid = e.target)").get().c;
    if (orphanSrc > 0) issues.push(`${orphanSrc} edges have unknown source uid`);
    if (orphanTgt > 0) issues.push(`${orphanTgt} edges have unknown target uid`);
  }
  return { ok: issues.length === 0, issues, stats: { itemCount, edgeCount, ftsItemCount, ftsEdgeCount, orphanSrc, orphanTgt } };
}
