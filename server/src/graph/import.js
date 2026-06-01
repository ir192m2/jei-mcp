import { readFileSync, createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, initSchema, clearGraph, closeDb, validateGraph, setMeta } from "./db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRAPH_DIR = process.env.JEI_GRAPH_DIR || join(__dirname, "../../../jei-graph");

async function importGraph() {
  const t0 = Date.now();

  const itemsPath = join(GRAPH_DIR, "items.json");
  const edgesPath = join(GRAPH_DIR, "edges.json");
  if (!existsSync(itemsPath) || !existsSync(edgesPath)) {
    console.error(`Missing items.json or edges.json in ${GRAPH_DIR}`);
    process.exit(1);
  }

  console.log("Loading items.json...");
  let items;
  try {
    items = JSON.parse(readFileSync(itemsPath, "utf-8"));
  } catch (e) {
    console.error(`Failed to parse items.json: ${e.message}`);
    process.exit(1);
  }
  const itemCount = Object.keys(items).length;
  console.log(`  Loaded ${itemCount} items in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const db = getDb();
  initSchema(db);
  clearGraph(db);

  console.log("Inserting items...");
  const insertItem = db.prepare(`
    INSERT INTO items (uid, display_name, mod_id, registry_name, metadata, recipe_count, use_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItemFts = db.prepare(`
    INSERT INTO items_fts (uid, display_name, mod_id) VALUES (?, ?, ?)
  `);
  const itemStats = {};
  for (const uid of Object.keys(items)) itemStats[uid] = { r: 0, u: 0 };

  db.exec("BEGIN");
  try {
    for (const [uid, data] of Object.entries(items)) {
      insertItem.run(uid, data.d, data.m, data.r, data.n || 0, 0, 0);
      insertItemFts.run(uid, data.d, data.m);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    console.error(`Item insert failed: ${e.message}`);
    process.exit(1);
  }
  console.log(`  Inserted ${itemCount} items`);

  console.log("Streaming edges (single pass: edges + FTS + category counts)...");
  db.exec("PRAGMA journal_mode=OFF");
  db.exec("PRAGMA synchronous=OFF");
  db.exec("PRAGMA temp_store=MEMORY");

  const insertEdge = db.prepare(`INSERT INTO edges (source, target, category) VALUES (?, ?, ?)`);
  const insertEdgeFts = db.prepare(`INSERT INTO edges_fts (source, target, category) VALUES (?, ?, ?)`);
  const catCounts = {};

  let edgeCount = 0;
  let lineCount = 0;
  let skipped = { bracket: 0, parse: 0, missing: 0, shape: 0 };
  let lastReport = Date.now();
  const REPORT_INTERVAL_MS = 5000;
  const COMMIT_INTERVAL = 500000;

  const stream = createReadStream(edgesPath, { encoding: "utf-8", highWaterMark: 1 << 20 });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  db.exec("BEGIN");
  try {
    for await (const line of rl) {
      lineCount++;
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "[" || trimmed === "]" || trimmed === "],") continue;

      let jsonText = trimmed;
      if (jsonText.endsWith(",")) jsonText = jsonText.slice(0, -1);
      if (!jsonText.startsWith("[")) { skipped.bracket++; continue; }

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        skipped.parse++;
        continue;
      }
      if (!Array.isArray(parsed) || parsed.length < 3) { skipped.shape++; continue; }
      const [src, tgt, cat] = parsed;
      if (typeof src !== "string" || typeof tgt !== "string" || typeof cat !== "string") {
        skipped.shape++;
        continue;
      }
      const hasSrc = Object.prototype.hasOwnProperty.call(itemStats, src);
      const hasTgt = Object.prototype.hasOwnProperty.call(itemStats, tgt);
      if (!hasSrc) skipped.missing++;
      if (!hasTgt) skipped.missing++;
      if (!hasSrc || !hasTgt) continue;

      insertEdge.run(src, tgt, cat);
      insertEdgeFts.run(src, tgt, cat);
      itemStats[src].r++;
      itemStats[tgt].u++;
      catCounts[cat] = (catCounts[cat] || 0) + 1;
      edgeCount++;

      if (edgeCount % COMMIT_INTERVAL === 0) {
        db.exec("COMMIT");
        db.exec("BEGIN");
      }
      const now = Date.now();
      if (now - lastReport > REPORT_INTERVAL_MS) {
        console.log(`  ${(edgeCount / 1e6).toFixed(1)}M edges (${lineCount.toLocaleString()} lines, ${skipped.missing} missing uid)`);
        lastReport = now;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    console.error(`Edge insert failed at ${edgeCount}: ${e.message}`);
    process.exit(1);
  }

  console.log(`  Inserted ${edgeCount.toLocaleString()} raw edges`);
  console.log(`  Indexed ${edgeCount.toLocaleString()} edges in FTS (single pass)`);
  if (skipped.bracket || skipped.parse || skipped.missing || skipped.shape) {
    console.log(`  Skipped: ${skipped.bracket} bracket-mismatch, ${skipped.parse} parse-error, ${skipped.missing} missing-uid, ${skipped.shape} wrong-shape`);
  }

  console.log("Updating item stats...");
  const updateStats = db.prepare("UPDATE items SET recipe_count = ?, use_count = ? WHERE uid = ?");
  db.exec("BEGIN");
  try {
    for (const [uid, stats] of Object.entries(itemStats)) {
      updateStats.run(stats.r, stats.u, uid);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    console.error(`Item stats update failed: ${e.message}`);
    process.exit(1);
  }

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
  const insertCat = db.prepare("INSERT OR REPLACE INTO categories (category, edge_count) VALUES (?, ?)");
  db.exec("BEGIN");
  for (const [cat, count] of Object.entries(catCounts)) {
    insertCat.run(cat, count);
  }
  db.exec("COMMIT");
  console.log(`  ${Object.keys(catCounts).length} categories`);

  console.log("Writing metadata...");
  db.exec("BEGIN");
  setMeta(db, "item_count", itemCount);
  setMeta(db, "edge_count", edgeCount);
  setMeta(db, "mod_count", Object.keys(modCounts).length);
  setMeta(db, "category_count", Object.keys(catCounts).length);
  setMeta(db, "import_timestamp", new Date().toISOString());
  setMeta(db, "import_duration_seconds", ((Date.now() - t0) / 1000).toFixed(1));
  setMeta(db, "import_skipped_bracket", skipped.bracket);
  setMeta(db, "import_skipped_parse", skipped.parse);
  setMeta(db, "import_skipped_missing", skipped.missing);
  setMeta(db, "import_skipped_shape", skipped.shape);
  db.exec("COMMIT");

  db.exec("ANALYZE");
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=NORMAL");

  console.log("Validating graph (fast check, no orphan scan)...");
  const validation = validateGraph(db, { checkOrphans: false });
  if (!validation.ok) {
    console.error("Validation FAILED:");
    for (const issue of validation.issues) console.error("  -", issue);
    console.error(`  Stats: ${JSON.stringify(validation.stats)}`);
    process.exit(1);
  }
  console.log(`  OK — ${validation.stats.itemCount} items, ${validation.stats.edgeCount} edges`);

  console.log("Checking for orphan references (slow on 26M edges)...");
  const tOrphan = Date.now();
  const fullCheck = validateGraph(db, { checkOrphans: true });
  if (!fullCheck.ok) {
    console.error("Orphan check FAILED:");
    for (const issue of fullCheck.issues) console.error("  -", issue);
  } else {
    console.log(`  OK — no orphan references (${((Date.now() - tOrphan) / 1000).toFixed(1)}s)`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${elapsed}s — SQLite graph ready at ${join(GRAPH_DIR, "graph.db")}`);
  closeDb();
}

importGraph().catch(e => { console.error("Fatal:", e); process.exit(1); });
