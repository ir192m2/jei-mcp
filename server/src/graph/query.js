import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, initSchema, closeDb } from "./db.js";
import {
  searchItems, searchEdges, getItem, getRecipes, getUses,
  getModStats, getCategoryStats, getTopConnected,
  countItems, countEdges, countMods,
} from "./search.js";
import { GraphTraverser } from "./traversal.js";
import { ContextBuilder } from "./context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let _rawEdges = null;
function getRawEdges() {
  if (!_rawEdges) {
    const p = join(__dirname, "../../../jei-graph/edges.json");
    _rawEdges = JSON.parse(readFileSync(p, "utf-8"));
  }
  return _rawEdges;
}

const db = getDb();
initSchema(db);
const traverser = new GraphTraverser(db);
const context = new ContextBuilder(db, traverser);

const totalItems = countItems(db);
const edgeCounts = countEdges(db);
const totalMods = countMods(db);

console.log(`JEI Recipe Graph — ${totalItems} items, ${edgeCounts.unique} unique edges (${edgeCounts.total} raw), ${totalMods} mods\n`);
console.log("Commands:");
console.log("  search <query>                — FTS search items (BM25 ranked)");
console.log("  info <uid>                    — Item details");
console.log("  recipes <uid> [limit]         — What this item produces");
console.log("  uses <uid> [limit]            — What makes this item");
console.log("  bfs <uid> [depth]             — Breadth-first expansion");
console.log("  dfs <uid> [depth]             — Depth-first expansion");
console.log("  path <from> <to>              — Shortest recipe path (BFS)");
console.log("  subgraph <uid> [depth]        — Extract recipe subgraph");
console.log("  ancestors <uid>               — Walk up dependency tree");
console.log("  descendants <uid>             — Walk down dependency tree");
console.log("  impact <uid>                  — Impact analysis (what breaks if this item changes)");
console.log("  cycles                        — Detect recipe cycles");
console.log("  context <uid> [depth]         — Build LLM-ready context");
console.log("  tree <uid> [depth]            — Dependency tree");
console.log("  summary <uid>                 — Quick item summary");
console.log("  mod [modId]                   — Mod stats or items in mod");
console.log("  category [name]               — Category stats");
console.log("  raw <uid>                     — Raw edges from JSON (shows duplicates)");
console.log("  dups [limit]                  — Most duplicated edges");
console.log("  top [limit]                   — Most connected items");
console.log("  stats                         — Overview");
console.log("  quit                          — Exit\n");

const rl = createInterface({ input: process.stdin, output: process.stdout });

function shutdown() {
  closeDb();
  rl.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function printTable(rows, columns) {
  if (!rows || rows.length === 0) { console.log("  (no results)"); return; }
  const widths = columns.map(c => Math.max(c.label.length, ...rows.map(r => String(r[c.key] ?? "").length)));
  const header = columns.map((c, i) => c.label.padEnd(widths[i])).join("  ");
  console.log(`  ${header}`);
  console.log(`  ${widths.map(w => "\u2500".repeat(w)).join("\u2500\u2500")}`);
  for (const row of rows) {
    const line = columns.map((c, i) => String(row[c.key] ?? "").padEnd(widths[i])).join("  ");
    console.log(`  ${line}`);
  }
}

function resolveUid(query) {
  const results = searchItems(db, query, { limit: 1 });
  return results.length > 0 ? results[0].uid : query;
}

function prompt() {
  rl.question("> ", (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    const arg1 = parts[1];
    const arg2 = parts[2];

    try {
      switch (cmd) {
        case "search":
        case "s": {
          if (!arg1) { console.log("Usage: search <query>"); break; }
          const mod = arg2?.startsWith("mod:") ? arg2.slice(4) : undefined;
          const results = searchItems(db, arg1, { limit: 20, mod });
          printTable(results.map(r => ({
            uid: r.uid, name: r.display_name, mod: r.mod_id,
            recipes: r.recipe_count, uses: r.use_count,
            score: r.rank ? (-r.rank).toFixed(3) : "-",
          })), [
            { label: "Score", key: "score" },
            { label: "UID", key: "uid" },
            { label: "Name", key: "name" },
            { label: "Mod", key: "mod" },
            { label: "R", key: "recipes" },
            { label: "U", key: "uses" },
          ]);
          console.log(`\n  ${results.length} results`);
          break;
        }
        case "info":
        case "i": {
          if (!arg1) { console.log("Usage: info <uid>"); break; }
          const uid = resolveUid(arg1);
          const item = getItem(db, uid);
          if (!item) { console.log("  Not found:", uid); break; }
          console.log(`  UID:          ${item.uid}`);
          console.log(`  Name:         ${item.display_name}`);
          console.log(`  Mod:          ${item.mod_id}`);
          console.log(`  Registry:     ${item.registry_name}`);
          console.log(`  Metadata:     ${item.metadata}`);
          console.log(`  Recipes:      ${item.recipe_count}`);
          console.log(`  Uses:         ${item.use_count}`);
          break;
        }
        case "recipes":
        case "r": {
          if (!arg1) { console.log("Usage: recipes <uid> [limit]"); break; }
          const uid = resolveUid(arg1);
          const limit = parseInt(arg2) || 30;
          const recipes = getRecipes(db, uid, limit);
          printTable(recipes.map(r => ({
            uid: r.uid, name: r.display_name, mod: r.mod_id, cat: r.category, n: r.multiplicity,
          })), [
            { label: "Output", key: "uid" },
            { label: "Name", key: "name" },
            { label: "Mod", key: "mod" },
            { label: "Category", key: "cat" },
            { label: "N", key: "n" },
          ]);
          console.log(`\n  ${recipes.length} unique recipes`);
          break;
        }
        case "uses":
        case "u": {
          if (!arg1) { console.log("Usage: uses <uid> [limit]"); break; }
          const uid = resolveUid(arg1);
          const limit = parseInt(arg2) || 30;
          const uses = getUses(db, uid, limit);
          printTable(uses.map(r => ({
            uid: r.uid, name: r.display_name, mod: r.mod_id, cat: r.category, n: r.multiplicity,
          })), [
            { label: "Input", key: "uid" },
            { label: "Name", key: "name" },
            { label: "Mod", key: "mod" },
            { label: "Category", key: "cat" },
            { label: "N", key: "n" },
          ]);
          console.log(`\n  ${uses.length} unique uses`);
          break;
        }
        case "bfs": {
          if (!arg1) { console.log("Usage: bfs <uid> [depth]"); break; }
          const uid = resolveUid(arg1);
          const depth = parseInt(arg2) || 3;
          const nodes = traverser.traverseBFS(uid, { maxDepth: depth, maxNodes: 100 });
          const enriched = nodes.map(n => {
            const item = getItem(db, n.uid);
            return { uid: n.uid, name: item?.display_name || "?", mod: item?.mod_id || "?", depth: n.depth };
          });
          printTable(enriched, [
            { label: "Depth", key: "depth" },
            { label: "UID", key: "uid" },
            { label: "Name", key: "name" },
            { label: "Mod", key: "mod" },
          ]);
          console.log(`\n  ${nodes.length} nodes`);
          break;
        }
        case "dfs": {
          if (!arg1) { console.log("Usage: dfs <uid> [depth]"); break; }
          const uid = resolveUid(arg1);
          const depth = parseInt(arg2) || 3;
          const nodes = traverser.traverseDFS(uid, { maxDepth: depth, maxNodes: 100 });
          const enriched = nodes.map(n => {
            const item = getItem(db, n.uid);
            return { uid: n.uid, name: item?.display_name || "?", mod: item?.mod_id || "?", depth: n.depth };
          });
          printTable(enriched, [
            { label: "Depth", key: "depth" },
            { label: "UID", key: "uid" },
            { label: "Name", key: "name" },
            { label: "Mod", key: "mod" },
          ]);
          console.log(`\n  ${nodes.length} nodes`);
          break;
        }
        case "path":
        case "p": {
          if (!arg1 || !arg2) { console.log("Usage: path <from> <to>"); break; }
          const from = resolveUid(arg1);
          const to = resolveUid(arg2);
          const path = traverser.findPath(from, to);
          if (!path) { console.log(`  No path found from ${from} to ${to}`); break; }
          console.log(`  Shortest path (${path.length - 1} steps):`);
          for (let i = 0; i < path.length; i++) {
            const item = getItem(db, path[i]);
            const prefix = i === 0 ? "  FROM" : i === path.length - 1 ? "  TO  " : "    ->";
            console.log(`${prefix} ${item?.display_name || path[i]} (${path[i]})`);
          }
          break;
        }
        case "subgraph":
        case "sg": {
          if (!arg1) { console.log("Usage: subgraph <uid> [depth]"); break; }
          const uid = resolveUid(arg1);
          const depth = parseInt(arg2) || 2;
          const sg = traverser.getSubgraph(uid, { maxDepth: depth, maxNodes: 80 });
          console.log(`  Subgraph: ${sg.nodes.length} nodes, ${sg.edges.length} edges`);
          const enriched = sg.nodes.map(n => {
            const item = getItem(db, n);
            return { uid: n, name: item?.display_name || "?", mod: item?.mod_id || "?" };
          });
          printTable(enriched, [
            { label: "UID", key: "uid" },
            { label: "Name", key: "name" },
            { label: "Mod", key: "mod" },
          ]);
          break;
        }
        case "ancestors":
        case "a": {
          if (!arg1) { console.log("Usage: ancestors <uid>"); break; }
          const uid = resolveUid(arg1);
          const anc = traverser.getAncestors(uid, parseInt(arg2) || 10);
          printTable(anc.map(n => {
            const item = getItem(db, n.uid);
            return { uid: n.uid, name: item?.display_name || "?", depth: n.depth };
          }), [
            { label: "Depth", key: "depth" },
            { label: "UID", key: "uid" },
            { label: "Name", key: "name" },
          ]);
          console.log(`\n  ${anc.length} ancestors`);
          break;
        }
        case "descendants":
        case "d": {
          if (!arg1) { console.log("Usage: descendants <uid>"); break; }
          const uid = resolveUid(arg1);
          const desc = traverser.getDescendants(uid, parseInt(arg2) || 10);
          printTable(desc.map(n => {
            const item = getItem(db, n.uid);
            return { uid: n.uid, name: item?.display_name || "?", depth: n.depth };
          }), [
            { label: "Depth", key: "depth" },
            { label: "UID", key: "uid" },
            { label: "Name", key: "name" },
          ]);
          console.log(`\n  ${desc.length} descendants`);
          break;
        }
        case "impact": {
          if (!arg1) { console.log("Usage: impact <uid>"); break; }
          const uid = resolveUid(arg1);
          const impacted = traverser.impactAnalysis(uid);
          const enriched = impacted.map(n => {
            const item = getItem(db, n);
            return { uid: n, name: item?.display_name || "?", mod: item?.mod_id || "?" };
          }).slice(0, 30);
          printTable(enriched, [
            { label: "UID", key: "uid" },
            { label: "Name", key: "name" },
            { label: "Mod", key: "mod" },
          ]);
          console.log(`\n  ${impacted.length} items impacted`);
          break;
        }
        case "cycles":
        case "cy": {
          const cycles = traverser.detectCycles();
          if (cycles.length === 0) { console.log("  No cycles detected"); break; }
          console.log(`  ${cycles.length} cycles found:`);
          for (const cycle of cycles.slice(0, 10)) {
            console.log(`  [${cycle.length} nodes] ${cycle.map(n => {
              const item = getItem(db, n);
              return item?.display_name || n;
            }).join(" -> ")}`);
          }
          if (cycles.length > 10) console.log(`  ... and ${cycles.length - 10} more`);
          break;
        }
        case "context":
        case "ctx": {
          if (!arg1) { console.log("Usage: context <uid> [depth]"); break; }
          const uid = resolveUid(arg1);
          const depth = parseInt(arg2) || 2;
          const text = context.buildRecipeContext(uid, { depth });
          if (text) console.log(text);
          else console.log("  Not found");
          break;
        }
        case "tree":
        case "t": {
          if (!arg1) { console.log("Usage: tree <uid> [depth]"); break; }
          const uid = resolveUid(arg1);
          const depth = parseInt(arg2) || 3;
          const tree = context.buildDependencyTree(uid, depth);
          if (!tree) { console.log("  Not found"); break; }
          function printTree(node, indent = 0) {
            const prefix = indent === 0 ? "" : "  ".repeat(indent) + "\u251C\u2500\u2500 ";
            console.log(`${prefix}${node.name} (${node.mod}) [${node.uid}]`);
            for (const child of node.children) printTree(child, indent + 1);
          }
          printTree(tree);
          break;
        }
        case "summary":
        case "sm": {
          if (!arg1) { console.log("Usage: summary <uid>"); break; }
          const uid = resolveUid(arg1);
          const summary = context.buildItemSummary(uid);
          if (!summary) { console.log("  Not found"); break; }
          console.log(`  ${summary.name} (${summary.mod}) [${summary.uid}]`);
          console.log(`  Recipes: ${summary.recipeCount} | Uses: ${summary.useCount}`);
          if (summary.topRecipes.length > 0) {
            console.log("  Top recipes:");
            for (const r of summary.topRecipes.slice(0, 5)) {
              console.log(`    -> ${r.name} (${r.mod}) [${r.category}]`);
            }
          }
          if (summary.topUses.length > 0) {
            console.log("  Top ingredients:");
            for (const u of summary.topUses.slice(0, 5)) {
              console.log(`    <- ${u.name} (${u.mod}) [${u.category}]`);
            }
          }
          break;
        }
        case "mod":
        case "m": {
          if (!arg1) {
            const mods = getModStats(db, parseInt(arg2) || 20);
            printTable(mods, [
              { label: "Mod", key: "mod_id" },
              { label: "Items", key: "item_count" },
              { label: "Recipes", key: "recipe_count" },
            ]);
          } else {
            const results = searchItems(db, "*", { limit: parseInt(arg2) || 20, mod: arg1 });
            if (results.length === 0) {
              const direct = db.prepare("SELECT uid, display_name FROM items WHERE mod_id = ? LIMIT ?").all(arg1, parseInt(arg2) || 20);
              printTable(direct, [
                { label: "UID", key: "uid" },
                { label: "Name", key: "display_name" },
              ]);
            } else {
              printTable(results.map(r => ({ uid: r.uid, name: r.display_name })), [
                { label: "UID", key: "uid" },
                { label: "Name", key: "name" },
              ]);
            }
          }
          break;
        }
        case "category":
        case "cat": {
          if (!arg1) {
            const cats = getCategoryStats(db, parseInt(arg2) || 20);
            printTable(cats, [
              { label: "Category", key: "category" },
              { label: "Recipes", key: "total_recipes" },
              { label: "Pairs", key: "unique_pairs" },
            ]);
          } else {
            const edges = db.prepare("SELECT source, target FROM edges WHERE category = ? LIMIT ?").all(arg1, parseInt(arg2) || 20);
            printTable(edges.map(e => {
              const s = getItem(db, e.source);
              const t = getItem(db, e.target);
              return { from: e.source, fromName: s?.display_name || "?", to: e.target, toName: t?.display_name || "?" };
            }), [
              { label: "From", key: "fromName" },
              { label: "To", key: "toName" },
            ]);
            console.log(`\n  Showing first ${Math.min(edges.length, parseInt(arg2) || 20)} edges`);
          }
          break;
        }
        case "raw": {
          if (!arg1) { console.log("Usage: raw <uid> — show raw edges from JSON (with duplicates)"); break; }
          const uid = resolveUid(arg1);
          const raw = getRawEdges();
          const matching = raw.filter(e => e[0] === uid || e[1] === uid);
          const grouped = {};
          for (const [s, t, c] of matching) {
            const dir = s === uid ? "produces" : "consumed_by";
            const other = s === uid ? t : s;
            const key = dir + "|" + c;
            if (!grouped[key]) grouped[key] = { dir, category: c, targets: new Map() };
            grouped[key].targets.set(other, (grouped[key].targets.get(other) || 0) + 1);
          }
          const item = getItem(db, uid);
          console.log(`  Raw edges for ${item?.display_name || uid} (${uid}):`);
          console.log(`  ${matching.length} raw edges total\n`);
          for (const g of Object.values(grouped).sort((a, b) => b.targets.size - a.targets.size).slice(0, 15)) {
            const dirLabel = g.dir === "produces" ? "PRODUCES" : "USED BY";
            console.log(`  ${dirLabel} [${g.category}] (${g.targets.size} unique):`);
            const sorted = [...g.targets.entries()].sort((a, b) => b[1] - a[1]);
            for (const [target, count] of sorted.slice(0, 5)) {
              const tItem = getItem(db, target);
              const mult = count > 1 ? ` x${count}` : "";
              console.log(`    ${tItem?.display_name || target} (${target})${mult}`);
            }
            if (sorted.length > 5) console.log(`    ... and ${sorted.length - 5} more`);
          }
          break;
        }
        case "dups": {
          const raw = getRawEdges();
          const multMap = new Map();
          for (const [s, t, c] of raw) {
            const key = s + "\0" + t + "\0" + c;
            multMap.set(key, (multMap.get(key) || 0) + 1);
          }
          const duped = [...multMap.entries()]
            .filter(([, m]) => m > 1)
            .sort((a, b) => b[1] - a[1])
            .slice(0, parseInt(arg1) || 20);
          printTable(duped.map(([key, mult]) => {
            const [s, t, c] = key.split("\0");
            const sItem = getItem(db, s);
            const tItem = getItem(db, t);
            return {
              from: sItem?.display_name || s, to: tItem?.display_name || t,
              cat: c, n: mult,
            };
          }), [
            { label: "From", key: "from" },
            { label: "To", key: "to" },
            { label: "Category", key: "cat" },
            { label: "Count", key: "n" },
          ]);
          break;
        }
        case "top": {
          const top = getTopConnected(db, parseInt(arg1) || 15);
          printTable(top.map(r => ({
            uid: r.uid, name: r.display_name, mod: r.mod_id,
            recipes: r.recipe_count, uses: r.use_count, total: r.total,
          })), [
            { label: "UID", key: "uid" },
            { label: "Name", key: "name" },
            { label: "Mod", key: "mod" },
            { label: "R", key: "recipes" },
            { label: "U", key: "uses" },
            { label: "Total", key: "total" },
          ]);
          break;
        }
        case "stats": {
          const top = getTopConnected(db, 5);
          const mods = getModStats(db, 5);
          const cats = getCategoryStats(db, 5);
          console.log(`  Items: ${totalItems} | Edges: ${edgeCounts.unique} unique (${edgeCounts.total} raw) | Mods: ${totalMods}`);
          console.log(`  Top 5 connected:`);
          for (const t of top) console.log(`    ${t.display_name} (${t.mod_id}): ${t.total} edges`);
          console.log(`  Top 5 mods:`);
          for (const m of mods) console.log(`    ${m.mod_id}: ${m.item_count} items, ${m.recipe_count} recipes`);
          console.log(`  Top 5 categories:`);
          for (const c of cats) console.log(`    ${c.category}: ${c.total_recipes} recipes (${c.unique_pairs} unique pairs)`);
          break;
        }
        case "quit":
        case "q":
        case "exit":
          closeDb();
          rl.close();
          process.exit(0);
          break;
        default:
          if (cmd) console.log(`  Unknown command: ${cmd}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
    console.log("");
    prompt();
  });
}

prompt();
