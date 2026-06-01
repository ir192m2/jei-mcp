# JEI Recipe Graph Engine

SQLite-backed directed graph of all 21K items and 31K recipe relationships from the NITRO modpack, with FTS5 search, BFS/DFS traversal, shortest path, cycle detection, and LLM context builder.

Built on graph algorithms adapted from [CodeGraph](https://github.com/colbymchenry/codegraph).

## Files

| File | Purpose |
|------|---------|
| `src/graph/db.js` | SQLite connection, schema, WAL mode, FTS5 tables |
| `src/graph/search.js` | FTS5 BM25 search, item/recipe/use queries, stats |
| `src/graph/traversal.js` | BFS, DFS, shortest path, subgraph extraction, ancestors/descendants, cycle detection, impact analysis |
| `src/graph/context.js` | LLM-ready context builder, dependency trees, item summaries |
| `src/graph/import.js` | JSON → SQLite importer (runs in ~1s) |
| `src/graph/query.js` | Interactive CLI with 20 commands |
| `../jei-graph/graph.db` | SQLite database (18 MB with FTS5 indices) |
| `../jei-graph/items.json` | Raw item data (2.5 MB) |
| `../jei-graph/edges.json` | Raw edge data (9.2 MB) |
| `../jei-graph/stats.json` | Graph statistics |

## Quick Start

```bash
# Rebuild from JSON (if game data changed)
node src/graph/import.js

# Interactive query tool
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
| `mod [modId]` | Mod stats or items in mod |
| `category [name]` | Category stats |
| `top [limit]` | Most connected items |
| `stats` | Overview |

## Algorithms (from CodeGraph)

- **BFS** — Breadth-first expansion with depth/edge-kind filtering
- **DFS** — Depth-first expansion with same filters
- **Shortest Path** — BFS-based shortest path between any two items
- **Subgraph Extraction** — Depth-limited bidirectional expansion
- **Cycle Detection** — DFS-based cycle finding (found 2,372 cycles, mostly chisel variants)
- **Impact Analysis** — Upstream dependency traversal (what uses this item)
- **FTS5 BM25** — Full-text search with relevance ranking
- **LRU Cache** — Bounded memoization for hot lookups

## Graph Stats

- 21,319 items across 55 mods
- 31,050 unique recipe edges (135,208 raw with multiplicities)
- 123 recipe categories
- Top mod: hbm (5,546 items)
- Most connected: Tiny Pile of Xenon-135 Powder (1,360 edges)

## Schema

```sql
items (uid TEXT PK, display_name, mod_id, registry_name, metadata, recipe_count, use_count)
edges (source TEXT, target TEXT, category TEXT, multiplicity INTEGER, UNIQUE(source, target, category))
mods (mod_id TEXT PK, item_count, recipe_count)
categories (category TEXT PK, edge_count)
items_fts (FTS5: uid, display_name, mod_id)
edges_fts (FTS5: source, target, category)
```
