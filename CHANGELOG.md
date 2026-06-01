# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-01

### Added
- JEI MCP bridge mod: HTTP server on 127.0.0.1:18732, MCP stdio server, 6 HTTP endpoints, 7 MCP tools
- Read tools: `jei_health`, `jei_search_items`, `jei_get_item`, `jei_get_recipes`, `jei_get_uses`, `jei_list_all_items`, `jei_list_categories`
- HTTP endpoints: `/api/health`, `/api/items/search`, `/api/items/all`, `/api/items/count`, `/api/items/{uid}`, `/api/items/{uid}/recipes`, `/api/items/{uid}/uses`, `/api/categories`
- All JEI queries run on Minecraft client thread via `Minecraft.addScheduledTask` + `CompletableFuture`
- **Offline SQLite + FTS5 graph engine** (no JVM required for queries)
  - Schema: `items`, `edges`, `mods`, `categories`, `items_fts`
  - Iterative SQL BFS traversal (no recursive CTEs)
  - `findPath` between items, `detectCycles` with per-node degree cap
  - 7.7 GB graph DB with 26M+ raw edges
  - 2 GB page cache, WAL journal mode
- Graph engine modules: `db.js`, `import.js`, `traversal.js`, `search.js`, `query.js`, `context.js`
- 19 engine smoke tests at `server/test/smoke.mjs`
- 10 Java unit tests for `BridgeConfig`
- Fuzz test suite: 198 cases across HTTP, MCP, and state-integration suites
- `GraphQL` schema for graph edges at `jei-graph/schema.graphql`
- Live health check exposes `item_count` and `jei_runtime` flag

### Fixed
- **BUG-C (LOW)**: MCP server has `isBridgeDown()` + `bridgeError()` helpers
- **BUG-D (MINOR)**: `parseBoundedInt()` helper validates `limit >= 0`, `offset >= 0` → 400 instead of 500
- **BUG-E (MINOR)**: `NumberFormatException` caught → sanitized "Invalid limit value: …"
- `detectCycles` per-node degree cap of 5000 to prevent OOM
- `test/fuzz` script path: `../../../server/dist/index.js` (3 levels up from `test/fuzz/{bq,jei}/`)

## [0.3.0] - 2026-05-25

### Added
- Single-pass graph importer using streaming JSON parser
- FTS5 standalone tables (no `content=` clause)
- Bounded LRU context cache

## [0.1.0] - 2026-05-12

### Added
- Initial scaffold: mod, MCP server, JEI runtime access
