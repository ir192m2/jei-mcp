#!/usr/bin/env node
/**
 * Export items.json + edges.json (NDJSON) from a live JEI bridge
 * (default http://127.0.0.1:18732) into a snapshot suitable for
 * `npm run graph:import`.
 *
 * - items.json: { [uid]: { d, m, r, n } }  (all items, in-memory)
 * - edges.json: NDJSON, one line per edge as
 *               ["src_uid", "tgt_uid", "category"]
 *   where source = ingredient, target = output.
 *
 * Usage:
 *   node server/scripts/export-graph.mjs [--bridge http://127.0.0.1:18732] \
 *                                        [--out   jei-graph] [--concurrency 16]
 *
 * Resumable: writes `items.json.tmp` and `edges.json.tmp`, then renames on
 * success. Existing `items.json`/`edges.json` are not deleted until the new
 * pair is fully written.
 */
import { writeFileSync, renameSync, existsSync, statSync, createWriteStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(__dirname, "..", "..", "jei-graph");
const DEFAULT_BRIDGE = "http://127.0.0.1:18732";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const BRIDGE = (arg("--bridge", DEFAULT_BRIDGE) || DEFAULT_BRIDGE).replace(/\/+$/, "");
const OUT_DIR = arg("--out", DEFAULT_OUT);
const CONCURRENCY = Number(arg("--concurrency", "16"));
const PAGE_SIZE = 1000;

mkdirSync(OUT_DIR, { recursive: true });

async function jget(path) {
  const r = await fetch(`${BRIDGE}${path}`);
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}

function uidFromIngredient(ing) {
  if (!ing || !ing.registryName) return null;
  const md = (ing.metadata ?? 0) >>> 0;
  return md === 0 ? ing.registryName : `${ing.registryName}:${md}`;
}

function* flatten(slotList) {
  for (const slot of slotList || []) {
    for (const stack of slot || []) {
      const u = uidFromIngredient(stack);
      if (u) yield u;
    }
  }
}

async function* paginateItems() {
  let offset = 0;
  while (true) {
    const page = await jget(`/api/items/all?limit=${PAGE_SIZE}&offset=${offset}`);
    for (const it of page.results) yield it;
    if (!page.results.length || offset + page.results.length >= page.total) return;
    offset += page.results.length;
  }
}

async function runWithConcurrency(items, limit, fn, onEach) {
  const it = items[Symbol.iterator]();
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const next = it.next();
      if (next.done) return;
      const v = next.value;
      try { await fn(v); } catch (e) { console.error("  worker error:", e.message); }
      if (onEach) onEach();
    }
  });
  await Promise.all(workers);
}

async function main() {
  const t0 = Date.now();
  console.log(`[export] bridge=${BRIDGE} out=${OUT_DIR} concurrency=${CONCURRENCY}`);

  console.log("[export] health check...");
  const h = await jget("/api/health");
  if (h.status !== "ok") throw new Error(`bridge not ok: ${JSON.stringify(h)}`);
  console.log(`  ${h.item_count} items live`);

  console.log("[export] collecting items...");
  const items = {};
  let n = 0;
  for await (const it of paginateItems()) {
    const md = (it.metadata ?? 0) >>> 0;
    items[it.uid] = { d: it.displayName, m: it.modId, r: it.registryName, n: md };
    n++;
    if (n % 5000 === 0) console.log(`  ${n.toLocaleString()} items collected`);
  }
  console.log(`  ${n.toLocaleString()} items total`);

  const itemsPath = join(OUT_DIR, "items.json.tmp");
  const edgesPath = join(OUT_DIR, "edges.json.tmp");
  console.log(`[export] writing ${itemsPath}`);
  writeFileSync(itemsPath, JSON.stringify(items));

  console.log(`[export] streaming edges to ${edgesPath}`);
  const ws = createWriteStream(edgesPath, { encoding: "utf-8" });
  const uids = Object.keys(items);
  let done = 0;
  let edges = 0;
  let recipeCount = 0;
  let useCount = 0;
  const startedAt = Date.now();

  const ingestItem = async (uid) => {
    let r, u;
    try { r = await jget(`/api/items/${encodeURIComponent(uid)}/recipes?limit=0`); }
    catch (e) { /* skip */ }
    try { u = await jget(`/api/items/${encodeURIComponent(uid)}/uses?limit=0`); }
    catch (e) { /* skip */ }

    const writes = [];
    for (const recipe of r?.recipes || []) {
      recipeCount++;
      const cat = recipe.categoryUid || recipe.categoryModName || "unknown";
      for (const output of flatten(recipe.outputs)) {
        if (output === uid) continue;
        for (const input of flatten(recipe.inputs)) {
          if (input === output) continue;
          writes.push(JSON.stringify([input, output, cat]));
        }
      }
    }
    for (const recipe of u?.recipes || []) {
      useCount++;
      const cat = recipe.categoryUid || recipe.categoryModName || "unknown";
      for (const output of flatten(recipe.outputs)) {
        if (output === uid) continue;
        for (const input of flatten(recipe.inputs)) {
          if (input === output) continue;
          writes.push(JSON.stringify([input, output, cat]));
        }
      }
    }
    if (writes.length) {
      const line = writes.join("\n") + "\n";
      if (!ws.write(line)) {
        await new Promise(res => ws.once("drain", res));
      }
      edges += writes.length;
    }
  };

  await runWithConcurrency(uids, CONCURRENCY, ingestItem, () => {
    done++;
    if (done % 500 === 0) {
      const rate = done / ((Date.now() - startedAt) / 1000);
      const eta = (uids.length - done) / rate;
      console.log(`  ${done.toLocaleString()}/${uids.length.toLocaleString()} uids (${edges.toLocaleString()} edges, ${rate.toFixed(1)}/s, ETA ${eta.toFixed(0)}s)`);
    }
  });
  await new Promise(res => ws.end(res));
  console.log(`  ${uids.length.toLocaleString()} uids processed`);
  console.log(`  ${recipeCount.toLocaleString()} recipes scanned (output side)`);
  console.log(`  ${useCount.toLocaleString()} uses scanned (input side)`);
  console.log(`  ${edges.toLocaleString()} raw edges written`);

  const finalItems = join(OUT_DIR, "items.json");
  const finalEdges = join(OUT_DIR, "edges.json");
  if (existsSync(finalItems)) renameSync(finalItems, finalItems + ".bak");
  if (existsSync(finalEdges)) renameSync(finalEdges, finalEdges + ".bak");
  renameSync(itemsPath, finalItems);
  renameSync(edgesPath, finalEdges);
  console.log(`[export] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  ${statSync(finalItems).size.toLocaleString()} bytes  ${finalItems}`);
  console.log(`  ${statSync(finalEdges).size.toLocaleString()} bytes  ${finalEdges}`);
}

main().catch(e => { console.error(e); process.exit(1); });
