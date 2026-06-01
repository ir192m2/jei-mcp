# JEI Recipe Graph Engine

SQLite-backed directed graph of all items and recipe relationships from any JEI 1.12.2 modpack, with FTS5 search, BFS traversal, shortest path, cycle detection, and LLM context builder. Fully offline — no JVM, MC, or JEI runtime needed for queries.

Built on graph algorithms adapted from [CodeGraph](https://github.com/colbymchenry/codegraph).

## Files

| File | Purpose |
|------|---------|
| `src/graph/db.js` | SQLite connection, schema (items/edges/mods/categories/meta + FTS5 tables), `validateGraph()` |
| `src/graph/search.js` | FTS5 BM25 search, item/recipe/use queries, stats, fast counts via meta table |
| `src/graph/traversal.js` | Iterative SQL-based BFS, shortest path, subgraph extraction, ancestors/descendants, cycle detection, impact analysis |
| `src/graph/context.js` | LLM-ready context builder with bounded LRU cache, dependency trees, item summaries |
| `src/graph/import.js` | JSON → SQLite importer. Single-pass through `edges.json`, FTS5 indexing inline, metadata writes, validation |
| `src/graph/query.js` | Interactive CLI with 22 commands |

## Quick Start

```bash
# 1. Fetch graph data (requires running Minecraft + JEI bridge)
cd server && node dist/fetch-graph.js

# 2. Import into SQLite (~minutes for 26M edges)
node src/graph/import.js

# 3. Interactive query tool (no JVM needed)
node src/graph/query.js
```

## Environment Variables

| Var | Purpose | Default |
|-----|---------|---------|
| `JEI_GRAPH_DB` | Path to SQLite database | `../../../jei-graph/graph.db` |
| `JEI_GRAPH_DIR` | Directory containing items.json + edges.json | `../../../jei-graph` |

If `graph.db` doesn't exist at the default path, opening fails with a helpful message telling you to run `npm run graph:import` or set `JEI_GRAPH_DB`.

## Commands

| Command | Description |
|---------|-------------|
| `search <query>` | FTS5 search with BM25 ranking. Supports `mod:xxx` filter. |
| `info <uid>` | Item details (name, mod, recipe/use counts) |
| `recipes <uid>` | What this item is used to make |
| `uses <uid>` | What makes this item (ingredients) |
| `bfs <uid> [depth]` | Breadth-first expansion (iterative SQL, bounded) |
| `dfs <uid> [depth]` | Depth-first expansion (uses BFS internally) |
| `path <from> <to>` | Shortest recipe path (BFS) |
| `subgraph <uid> [depth]` | Extract recipe subgraph (bidirectional) |
| `ancestors <uid>` | Walk up dependency tree |
| `descendants <uid>` | Walk down dependency tree |
| `impact <uid>` | Impact analysis (what breaks if this item changes) |
| `cycles` | Detect recipe cycles |
| `context <uid> [depth]` | Build LLM-ready context |
| `tree <uid> [depth]` | Dependency tree |
| `summary <uid>` | Quick item summary |
| `raw <uid>` | Raw edges (with multiplicity via SQL `GROUP BY`) |
| `dups [limit]` | Most duplicated edges (via SQL `GROUP BY ... HAVING count > 1`) |
| `mod [modId]` | Mod stats or items in mod |
| `category [name]` | Category stats |
| `top [limit]` | Most connected items |
| `stats` | Overview |

## Schema

```sql
items (uid TEXT PK, display_name, mod_id, registry_name, metadata, recipe_count, use_count)
edges (id INTEGER PK AUTO, source TEXT, target TEXT, category TEXT)
  -- Raw edges are NOT deduplicated; multiplicity is recovered via COUNT(*)
mods (mod_id TEXT PK, item_count, recipe_count)
categories (category TEXT PK, edge_count)
meta (key TEXT PK, value TEXT)
  -- Pre-computed counts for fast queries (item_count, edge_count, mod_count, category_count,
  --    import_timestamp, import_duration_seconds, import_skipped_*)
items_fts (FTS5: uid, display_name, mod_id, tokenize='porter unicode61')
edges_fts (FTS5: source, target, category, tokenize='porter unicode61')

CREATE INDEX idx_edges_source ON edges(source);
CREATE INDEX idx_edges_target ON edges(target);
CREATE INDEX idx_edges_category ON edges(category);
CREATE INDEX idx_edges_st ON edges(source, target);
```

The DB runs in WAL mode with 64MB page cache, 256MB mmap, 5s busy timeout.

## Algorithms

All traversal is implemented as **iterative SQL queries** — no in-memory adjacency maps. This keeps memory usage O(visible frontier) instead of O(graph), so 26M-edge graphs work on modest hardware.

- **BFS** — Depth-bounded iterative expansion. Each depth level is a single `SELECT DISTINCT` from `edges WHERE source IN (frontier)`. Frontier is bounded by `maxNodes` (default 500).
- **DFS** — Same as BFS; depth-first vs breadth-first ordering doesn't matter for our query results.
- **Shortest Path** — Iterative BFS with parent map. Returns first-found shortest path; doesn't explore the full graph.
- **Subgraph Extraction** — Two BFS passes (forward and backward), then a single edge query to retrieve the edges between discovered nodes.
- **Ancestors / Descendants** — BFS in the appropriate direction, filtered to exclude the start node.
- **Cycle Detection** — Iterative DFS with explicit stack. Uses a per-iteration statement for neighbor fetching. Capped at 100 cycles, 1000 start nodes.
- **Impact Analysis** — BFS over incoming edges (what depends on this item).
- **FTS5 BM25** — Standard FTS5 with `porter unicode61` tokenizer. Search queries are sanitized to prevent FTS syntax errors.
- **Fast Counts** — `countItems()`, `countEdges()`, `countMods()` read pre-computed values from the `meta` table (~0ms). On a fresh DB without meta populated, they fall back to `COUNT(*)` (slow on 26M rows).

## Safety Properties

- **No OOM on 26M-edge graphs.** The `raw` and `dups` commands used to load the full `edges.json` (2GB) into memory. They now use SQL `GROUP BY`.
- **No silent data loss on import.** Lines that fail bracket/parse/shape checks or reference unknown uids are counted and reported. Successful edges are inserted; failures are counted, not silently dropped.
- **Import is a single transaction.** If any error occurs mid-import, the entire import rolls back. The DB never sees a partial import.
- **No SQL injection via search.** FTS5 queries are sanitized (special chars stripped, terms quoted). Mod filter is alphanumeric-only. Falls back to `LIKE` on FTS error.
- **Graph integrity check at import end.** `validateGraph()` asserts items/edges counts match FTS counts. Optionally checks for orphan edge references.

## Performance Notes

| Operation | Time (26M edges) | Notes |
|-----------|-------------------|-------|
| Open DB | <100ms | WAL mode, mmap enabled |
| `countItems()` | ~0ms | reads meta table |
| `countEdges()` | ~0ms | reads meta table |
| `BFS depth=1, maxNodes=30` | ~500ms | first call, cold cache |
| `BFS depth=2+, maxNodes=30` | ~15ms | warm cache |
| `findPath` (2-hop) | ~7ms | |
| `getSubgraph` (depth=1, both) | ~500ms | 2 BFS passes + edge query |
| `validateGraph({ checkOrphans: false })` | <50ms | fast check only |
| `validateGraph({ checkOrphans: true })` | ~7s | full 26M-row index lookup |

## Code Layout Notes

- All entry points are ES modules. Import paths must use `.js` extensions even for `.ts` source.
- `db.js` exports a singleton DB connection. `closeDb()` resets it.
- `search.js` reads from `meta` via `getMetaNumber()` for O(1) counts.
- `traversal.js` uses iterative SQL. Recursive CTEs were tried and rejected because they materialize the full walk table, which explodes on 26M edges with high connectivity.
- `import.js` uses a single `BEGIN`/`COMMIT` for the entire edges import. `journal_mode=OFF` and `synchronous=OFF` are set just for the edges import; WAL/NORMAL are restored at the end.

## Migration Notes

If you have an older `graph.db` without the `meta` table:
```bash
node --input-type=module -e "
import {getDb, setMeta} from './src/graph/db.js';
const db = getDb();
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
setMeta(db, 'item_count', db.prepare('SELECT COUNT(*) as c FROM items').get().c);
setMeta(db, 'edge_count', db.prepare('SELECT COUNT(*) as c FROM edges').get().c);
setMeta(db, 'mod_count', db.prepare('SELECT COUNT(*) as c FROM mods').get().c);
setMeta(db, 'category_count', db.prepare('SELECT COUNT(*) as c FROM categories').get().c);
"
```

This is a one-time backfill (~7s for 26M edges). After that, fast counts work.
