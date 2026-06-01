# JEI Recipe Graph Engine

SQLite-backed directed graph of all items and recipe relationships from any JEI 1.12.2 modpack, with FTS5 search, BFS/DFS traversal, shortest path, cycle detection, and LLM context builder.

Built on graph algorithms adapted from [CodeGraph](https://github.com/colbymchenry/codegraph).

## Files

| File | Purpose |
|------|---------|
| `src/graph/db.js` | SQLite connection, schema, WAL mode, FTS5 tables |
| `src/graph/search.js` | FTS5 BM25 search, item/recipe/use queries, stats |
| `src/graph/traversal.js` | BFS, DFS, shortest path, subgraph extraction, ancestors/descendants, cycle detection, impact analysis |
| `src/graph/context.js` | LLM-ready context builder, dependency trees, item summaries |
| `src/graph/import.js` | JSON → SQLite importer (~1s for 20K+ items) |
| `src/graph/query.js` | Interactive CLI with 22 commands |

## Quick Start

```bash
# 1. Fetch graph data (requires running Minecraft + JEI bridge)
cd server && node dist/fetch-graph.js

# 2. Import into SQLite
node src/graph/import.js

# 3. Interactive query tool (no JVM needed)
node src/graph/query.js
```

## Commands

| Command | Description |
|---------|-------------|
| `search <query>` | FTS5 search with BM25 ranking. Supports `mod:xxx` filter. |
| `info <uid>` | Item details (name, mod, recipe/use counts) |
| `recipes <uid>` | What this item is used to make |
| `uses <uid>` | What makes this item (ingredients) |
| `bfs <uid> [depth]` | Breadth-first expansion |
| `dfs <uid> [depth]` | Depth-first expansion |
| `path <from> <to>` | Shortest recipe path (BFS) |
| `subgraph <uid> [depth]` | Extract recipe subgraph |
| `ancestors <uid>` | Walk up dependency tree |
| `descendants <uid>` | Walk down dependency tree |
| `impact <uid>` | Impact analysis (what breaks if this item changes) |
| `cycles` | Detect recipe cycles |
| `context <uid> [depth]` | Build LLM-ready context |
| `tree <uid> [depth]` | Dependency tree |
| `summary <uid>` | Quick item summary |
| `raw <uid>` | Raw edges from JSON (shows duplicates) |
| `dups [limit]` | Most duplicated edges |
| `mod [modId]` | Mod stats or items in mod |
| `category [name]` | Category stats |
| `top [limit]` | Most connected items |
| `stats` | Overview |

## Algorithms (from CodeGraph)

- **BFS** — Breadth-first expansion with depth/edge-kind filtering
- **DFS** — Depth-first expansion with same filters
- **Shortest Path** — BFS-based shortest path between any two items
- **Subgraph Extraction** — Depth-limited bidirectional expansion
- **Cycle Detection** — DFS-based cycle finding
- **Impact Analysis** — Upstream dependency traversal (what uses this item)
- **FTS5 BM25** — Full-text search with relevance ranking

## Schema

```sql
items (uid TEXT PK, display_name, mod_id, registry_name, metadata, recipe_count, use_count)
edges (source TEXT, target TEXT, category TEXT, multiplicity INTEGER, UNIQUE(source, target, category))
mods (mod_id TEXT PK, item_count, recipe_count)
categories (category TEXT PK, edge_count)
items_fts (FTS5: uid, display_name, mod_id)
edges_fts (FTS5: source, target, category)
```
