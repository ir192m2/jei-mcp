import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, initSchema, clearGraph, closeDb } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_DIR = join(__dirname, "../../../jei-graph");

function importGraph() {
  console.log("Loading JSON files...");
  const t0 = Date.now();

  const itemsPath = join(GRAPH_DIR, "items.json");
  const edgesPath = join(GRAPH_DIR, "edges.json");
  if (!existsSync(itemsPath) || !existsSync(edgesPath)) {
    console.error("Missing items.json or edges.json in", GRAPH_DIR);
    process.exit(1);
  }

  const items = JSON.parse(readFileSync(itemsPath, "utf-8"));
  const edges = JSON.parse(readFileSync(edgesPath, "utf-8"));

  console.log(`Loaded ${Object.keys(items).length} items, ${edges.length} edges in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const db = getDb();
  initSchema(db);
  clearGraph(db);

  console.log("Building item index...");
  const insertItem = db.prepare(`
    INSERT INTO items (uid, display_name, mod_id, registry_name, metadata, recipe_count, use_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItemFts = db.prepare(`
    INSERT INTO items_fts (uid, display_name, mod_id) VALUES (?, ?, ?)
  `);

  const itemStats = {};
  for (const [uid, data] of Object.entries(items)) {
    itemStats[uid] = { r: 0, u: 0 };
  }

  db.exec("BEGIN");
  for (const [uid, data] of Object.entries(items)) {
    insertItem.run(uid, data.d, data.m, data.r, data.n || 0, 0, 0);
    insertItemFts.run(uid, data.d, data.m);
  }
  db.exec("COMMIT");
  console.log(`  Inserted ${Object.keys(items).length} items`);

  console.log("Building edges (counting multiplicities)...");
  const edgeMultiplicity = new Map();
  for (const edge of edges) {
    const [src, tgt, cat] = edge;
    const key = src + "\0" + tgt + "\0" + cat;
    edgeMultiplicity.set(key, (edgeMultiplicity.get(key) || 0) + 1);
  }

  const insertEdge = db.prepare(`
    INSERT OR IGNORE INTO edges (source, target, category, multiplicity) VALUES (?, ?, ?, ?)
  `);
  const insertEdgeFts = db.prepare(`
    INSERT INTO edges_fts (source, target, category) VALUES (?, ?, ?)
  `);

  let uniqueEdges = 0;
  let totalEdges = 0;
  db.exec("BEGIN");
  for (const [key, mult] of edgeMultiplicity) {
    const [src, tgt, cat] = key.split("\0");
    insertEdge.run(src, tgt, cat, mult);
    insertEdgeFts.run(src, tgt, cat);
    if (itemStats[src]) itemStats[src].r += mult;
    if (itemStats[tgt]) itemStats[tgt].u += mult;
    uniqueEdges++;
    totalEdges += mult;
  }
  db.exec("COMMIT");
  console.log(`  Inserted ${uniqueEdges} unique edges (${totalEdges} raw with multiplicities)`);

  console.log("Updating item stats...");
  const updateStats = db.prepare("UPDATE items SET recipe_count = ?, use_count = ? WHERE uid = ?");
  db.exec("BEGIN");
  for (const [uid, stats] of Object.entries(itemStats)) {
    updateStats.run(stats.r, stats.u, uid);
  }
  db.exec("COMMIT");

  console.log("Building mod stats...");
  const modCounts = {};
  for (const [, data] of Object.entries(items)) {
    if (!modCounts[data.m]) modCounts[data.m] = { items: 0, recipes: 0 };
    modCounts[data.m].items++;
  }
  for (const [uid, stats] of Object.entries(itemStats)) {
    const mod = items[uid]?.m;
    if (mod && modCounts[mod]) modCounts[mod].recipes += stats.r;
  }
  const insertMod = db.prepare("INSERT OR REPLACE INTO mods (mod_id, item_count, recipe_count) VALUES (?, ?, ?)");
  db.exec("BEGIN");
  for (const [modId, counts] of Object.entries(modCounts)) {
    insertMod.run(modId, counts.items, counts.recipes);
  }
  db.exec("COMMIT");
  console.log(`  ${Object.keys(modCounts).length} mods`);

  console.log("Building category stats...");
  const catCounts = {};
  for (const edge of edges) {
    const cat = edge[2];
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }
  const insertCat = db.prepare("INSERT OR REPLACE INTO categories (category, edge_count) VALUES (?, ?)");
  db.exec("BEGIN");
  for (const [cat, count] of Object.entries(catCounts)) {
    insertCat.run(cat, count);
  }
  db.exec("COMMIT");
  console.log(`  ${Object.keys(catCounts).length} categories`);

  db.exec("ANALYZE");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s — SQLite graph ready at ${join(GRAPH_DIR, "graph.db")}`);
  closeDb();
}

importGraph();
