export function searchItems(db, query, options = {}) {
  const { limit = 20, mod, kind } = options;

  let ftsQuery = query
    .replace(/[^\w\s:-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => `"${t}"*`)
    .join(" ");

  if (mod) ftsQuery += ` AND mod_id:${mod}`;
  if (kind) ftsQuery += ` AND kind:${kind}`;

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
  } catch {
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
  try {
    const stmt = db.prepare(`
      SELECT e.source, e.target, e.category, e.multiplicity
      FROM edges_fts f
      JOIN edges e ON e.rowid = f.rowid
      WHERE edges_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(`"${query}"*`, limit);
  } catch {
    return db.prepare(`
      SELECT source, target, category, multiplicity FROM edges
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
    SELECT e.target as uid, e.category, e.multiplicity, i.display_name, i.mod_id
    FROM edges e
    JOIN items i ON i.uid = e.target
    WHERE e.source = ? AND e.category != 'jei.information'
    ORDER BY e.multiplicity DESC, e.category
    LIMIT ?
  `).all(uid, limit);
}

export function getUses(db, uid, limit = 50) {
  return db.prepare(`
    SELECT e.source as uid, e.category, e.multiplicity, i.display_name, i.mod_id
    FROM edges e
    JOIN items i ON i.uid = e.source
    WHERE e.target = ? AND e.category != 'jei.information'
    ORDER BY e.multiplicity DESC, e.category
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
    SELECT category, SUM(multiplicity) as total_recipes, COUNT(*) as unique_pairs
    FROM edges
    GROUP BY category
    ORDER BY total_recipes DESC
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

export function countItems(db) {
  return db.prepare("SELECT COUNT(*) as c FROM items").get().c;
}

export function countEdges(db) {
  const row = db.prepare("SELECT COUNT(*) as unique_edges, SUM(multiplicity) as total_edges FROM edges").get();
  return { unique: row.unique_edges, total: row.total_edges };
}

export function countMods(db) {
  return db.prepare("SELECT COUNT(*) as c FROM mods").get().c;
}
