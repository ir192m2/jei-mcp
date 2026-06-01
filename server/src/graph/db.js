import { DatabaseSync } from "node:sqlite";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db = null;

export function getDb(dbPath) {
  if (_db) return _db;
  const p = dbPath || join(__dirname, "../../../jei-graph/graph.db");
  _db = new DatabaseSync(p);
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA busy_timeout=5000");
  _db.exec("PRAGMA mmap_size=268435456");
  _db.exec("PRAGMA synchronous=NORMAL");
  _db.exec("PRAGMA cache_size=-64000");
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
      source TEXT NOT NULL,
      target TEXT NOT NULL,
      category TEXT NOT NULL,
      multiplicity INTEGER DEFAULT 1,
      UNIQUE(source, target, category)
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
    CREATE INDEX IF NOT EXISTS idx_edges_category ON edges(category);

    CREATE TABLE IF NOT EXISTS mods (
      mod_id TEXT PRIMARY KEY,
      item_count INTEGER DEFAULT 0,
      recipe_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS categories (
      category TEXT PRIMARY KEY,
      edge_count INTEGER DEFAULT 0
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
}
