#!/usr/bin/env node
import { getDb, getMetaNumber } from '../src/graph/db.js';
import { searchItems } from '../src/graph/search.js';
import { GraphTraverser } from '../src/graph/traversal.js';

function getStats(db) {
  return {
    item_count: getMetaNumber(db, 'item_count') || 0,
    edge_count: getMetaNumber(db, 'edge_count') || 0,
    mod_count: getMetaNumber(db, 'mod_count') || 0,
    category_count: getMetaNumber(db, 'category_count') || 0,
  };
}

const start = Date.now();
let pass = 0, fail = 0;
const checks = [];
function check(name, ok, detail) {
  if (ok) { pass++; checks.push(`  PASS  ${name}`); }
  else    { fail++; checks.push(`  FAIL  ${name} — ${detail}`); }
}

const db = getDb();
const t = new GraphTraverser(db);
console.log('graph engine smoke test\n');

const stats = getStats(db);
check('stats returns object', typeof stats === 'object', JSON.stringify(stats));
check('item_count > 0', stats.item_count > 0, `item_count=${stats.item_count}`);
check('edge_count > 1M', stats.edge_count > 1_000_000, `edge_count=${stats.edge_count}`);
check('mod_count > 0', stats.mod_count > 0, `mod_count=${stats.mod_count}`);

const t0 = Date.now();
const ironResults = searchItems(db, 'iron ingot', 5);
check('search "iron ingot" returns results', ironResults.length > 0, `got ${ironResults.length}`);
check('search < 1s', Date.now() - t0 < 1000, `took ${Date.now()-t0}ms`);

const t1 = Date.now();
const path = t.findPath('minecraft:iron_ore', 'minecraft:iron_ingot', { maxDepth: 5 });
check('findPath iron_ore->iron_ingot', path !== null && path.length > 0, `path=${path ? JSON.stringify(path.slice(0,3)) : 'null'}`);
check('findPath < 1s', Date.now() - t1 < 1000, `took ${Date.now()-t1}ms`);

const t2 = Date.now();
const sub = t.getSubgraph('minecraft:iron_ingot', { maxDepth: 2 });
check('subgraph iron_ingot d2 nodes > 0', sub.nodes.length > 0, `nodes=${sub.nodes.length}`);
check('subgraph edges > 0', sub.edges.length > 0, `edges=${sub.edges.length}`);
check('subgraph < 30s (cold)', Date.now() - t2 < 30000, `took ${Date.now()-t2}ms`);

const t3 = Date.now();
const anc = t.getAncestors('minecraft:iron_ingot', 3);
check('getAncestors iron_ingot d3', anc.length > 0, `got ${anc.length}`);
check('getAncestors < 30s (cold)', Date.now() - t3 < 30000, `took ${Date.now()-t3}ms`);

const t4 = Date.now();
const desc = t.getDescendants('minecraft:iron_ore', 2);
check('getDescendants iron_ore d2', desc.length > 0, `got ${desc.length}`);
check('getDescendants < 30s (cold)', Date.now() - t4 < 30000, `took ${Date.now()-t4}ms`);

const t5 = Date.now();
const cyc = t.detectCycles(500);
check('detectCycles returns array', Array.isArray(cyc), `got ${typeof cyc}, value=${JSON.stringify(cyc).slice(0,100)}`);
check('detectCycles < 60s', Date.now() - t5 < 60000, `took ${Date.now()-t5}ms`);

const t6 = Date.now();
const imp = t.impactAnalysis('minecraft:coal');
check('impactAnalysis coal returns array', Array.isArray(imp), `got ${typeof imp}, len=${imp ? imp.length : 'n/a'}`);
check('impactAnalysis < 30s (cold)', Date.now() - t6 < 30000, `took ${Date.now()-t6}ms`);

console.log(checks.join('\n'));
console.log(`\n${pass} pass, ${fail} fail, total ${Date.now()-start}ms`);
db.close();
process.exit(fail > 0 ? 1 : 0);
