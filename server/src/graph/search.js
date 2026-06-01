function buildFtsQuery(query) {
  return String(query || "")
    .replace(/[^\w\s:-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`)
    .join(" ");
}

export function searchItems(db, query, options = {}) {
  const { limit = 20, mod } = options;

  if (!query || !query.trim()) return [];

  let ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];

  if (mod) {
    const safeMod = String(mod).replace(/[^a-zA-Z0-9_]/g, "");
    if (safeMod) ftsQuery += ` AND mod_id:"${safeMod}"`;
  }

  try {
    const stmt = db.prepare(`
      SELECT i.uid, i.display_name, i.mod_id, i.metadata, i.recipe_count, i.use_count,
             rank
      FROM items_fts f
      JOIN items i ON i.uid = f.uid
      WHERE items_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(ftsQuery, limit);
  } catch (e) {
    console.warn(`[searchItems] FTS query failed for "${query}": ${e.message}; falling back to LIKE`);
    return fallbackSearch(db, query, limit, mod);
  }
}

function fallbackSearch(db, query, limit, mod) {
  const q = `%${query.toLowerCase()}%`;
  let sql = `SELECT uid, display_name, mod_id, metadata, recipe_count, use_count, 0 as rank FROM items WHERE (lower(display_name) LIKE ? OR lower(uid) LIKE ?)`;
  const params = [q, q];
  if (mod) { sql += ` AND mod_id = ?`; params.push(mod); }
  sql += ` ORDER BY recipe_count + use_count DESC LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function searchEdges(db, query, limit = 20) {
  if (!query || !query.trim()) return [];
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return [];
  try {
    const stmt = db.prepare(`
      SELECT e.source, e.target, e.category
      FROM edges_fts f
      JOIN edges e ON e.id = f.rowid
      WHERE edges_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(ftsQuery, limit);
  } catch (e) {
    console.warn(`[searchEdges] FTS query failed for "${query}": ${e.message}; falling back to LIKE`);
    return db.prepare(`
      SELECT source, target, category FROM edges
      WHERE category LIKE ? OR source LIKE ? OR target LIKE ?
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, limit);
  }
}

export function getItem(db, uid) {
  return db.prepare("SELECT * FROM items WHERE uid = ?").get(uid);
}

export function getRecipes(db, uid, limit = 50) {
  return db.prepare(`
    SELECT e.target as uid, e.category, i.display_name, i.mod_id
    FROM edges e
    JOIN items i ON i.uid = e.target
    WHERE e.source = ? AND e.category != 'jei.information'
    ORDER BY e.category
    LIMIT ?
  `).all(uid, limit);
}

export function getUses(db, uid, limit = 50) {
  return db.prepare(`
    SELECT e.source as uid, e.category, i.display_name, i.mod_id
    FROM edges e
    JOIN items i ON i.uid = e.source
    WHERE e.target = ? AND e.category != 'jei.information'
    ORDER BY e.category
    LIMIT ?
  `).all(uid, limit);
}

export function getModStats(db, limit = 30) {
  return db.prepare(`
    SELECT mod_id, item_count, recipe_count
    FROM mods
    ORDER BY item_count DESC
    LIMIT ?
  `).all(limit);
}

export function getCategoryStats(db, limit = 30) {
  return db.prepare(`
    SELECT category, COUNT(*) as edge_count
    FROM edges
    GROUP BY category
    ORDER BY edge_count DESC
    LIMIT ?
  `).all(limit);
}

export function getTopConnected(db, limit = 20) {
  return db.prepare(`
    SELECT uid, display_name, mod_id, recipe_count, use_count,
           recipe_count + use_count as total
    FROM items
    WHERE recipe_count + use_count > 0
    ORDER BY total DESC
    LIMIT ?
  `).all(limit);
}

import { getMetaNumber } from "./db.js";

export function countItems(db) {
  const v = getMetaNumber(db, "item_count");
  return v > 0 ? v : db.prepare("SELECT COUNT(*) as c FROM items").get().c;
}

export function countEdges(db) {
  const v = getMetaNumber(db, "edge_count");
  return { raw: v > 0 ? v : db.prepare("SELECT COUNT(*) as c FROM edges").get().c };
}

export function countMods(db) {
  const v = getMetaNumber(db, "mod_count");
  return v > 0 ? v : db.prepare("SELECT COUNT(*) as c FROM mods").get().c;
}
