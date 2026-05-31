# JEI-MCP

Bridges [Just Enough Items (JEI)](https://github.com/mezz/JustEnoughItems) (1.12.2) to [Model Context Protocol (MCP)](https://modelcontextprotocol.io), allowing AI assistants (KiloCode, Claude, etc.) to query live Minecraft item and recipe data from a running game instance.

## Architecture

```
KiloCode ──MCP stdio──> jei-mcp-server (TypeScript) ──HTTP 127.0.0.1:18732──> Minecraft Client (Forge mod + JEI)
```

Two components:

### 1. `mod/` — Forge 1.12.2 Client Mod

A client-side Forge mod that:
- Hooks into JEI via `@JEIPlugin` to capture `IJeiRuntime`, `IIngredientRegistry`, and `IRecipeRegistry`
- Builds an in-memory `JeiDataCache` with all 22,000+ items indexed by UID, display name, mod ID, and resource path
- Starts a local HTTP server on `127.0.0.1:18732` (4-thread pool, localhost-only)
- Runs all JEI queries on the Minecraft main thread via `Minecraft.addScheduledTask()` + `CompletableFuture` for thread safety
- Returns JSON responses for every endpoint

### 2. `server/` — MCP Server (TypeScript)

An MCP stdio server that:
- Implements the Model Context Protocol via `@modelcontextprotocol/sdk`
- Provides 7 tools that proxy requests to the in-game HTTP server
- Handles connection errors gracefully when Minecraft isn't running
- Uses Zod schema validation for all tool parameters

## Setup

### Prerequisites

- Minecraft 1.12.2 with Forge 14.23.5.2860+
- JEI 4.16.x for 1.12.2 (CurseMaven file 3043174)
- JDK 21 (to run Gradle), targeting JDK 8 bytecode
- Node.js 18+ (for MCP server)

### Building the Mod

```bash
cd mod
# Requires JDK 21 on PATH (Gradle 8.12 needs it, mod targets Java 8)
JAVA_HOME=/usr/lib/jvm/java-21-openjdk ./gradlew build
# Output: build/libs/jei-mcp-bridge-1.0.0.jar
```

Place the built JAR in your Minecraft `mods/` folder alongside JEI.

### Building the MCP Server

```bash
cd server
npm install
npm run build
# Output: dist/index.js
```

### Configuring KiloCode

Add the MCP server to your KiloCode configuration:

```jsonc
// .kilo/kilo.jsonc
{
  "mcpServers": {
    "jei-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/jei-mcp/server/dist/index.js"]
    }
  }
}
```

## Usage

1. Launch Minecraft with JEI and the bridge mod installed
2. Join a world — the mod starts automatically when JEI runtime is ready
3. KiloCode can now query items and recipes via MCP tools

The HTTP server starts on `127.0.0.1:18732` automatically. You can verify it's running with:

```bash
curl http://127.0.0.1:18732/api/health
# {"status":"ok","jei_runtime":true,"item_count":22277}
```

## MCP Tools

### `jei_search_items`

Search for items by name, mod ID, or resource path. Matches against display name, mod ID, resource path, and UID (case-insensitive).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | *required* | Search term (min 1 char) |
| `limit` | int | 50 | Max results (1-500) |
| `offset` | int | 0 | Pagination offset |

**Example:**
```
jei_search_items(query="diamond", limit=5)
```
**Returns:** `{ total, offset, limit, results: [{ uid, displayName, modId, registryName, metadata }] }`

---

### `jei_get_item`

Get detailed information about a specific item by its JEI unique ID. Returns display name, tooltip lines, ore dictionary names, and creative tab memberships.

| Parameter | Type | Description |
|-----------|------|-------------|
| `uid` | string | JEI unique identifier (e.g. `minecraft:diamond` or `minecraft:wool:0`) |

**Example:**
```
jei_get_item(uid="minecraft:diamond")
```
**Returns:** `{ uid, displayName, modId, tooltip: [], oreDict: [], creativeTabs: [] }`

---

### `jei_get_recipes`

Get all recipes that produce (craft, smelt, etc.) a given item. Returns recipe category, inputs, and outputs for each recipe.

| Parameter | Type | Description |
|-----------|------|-------------|
| `uid` | string | JEI unique identifier for the output item |

**Example:**
```
jei_get_recipes(uid="minecraft:diamond_block")
```
**Returns:** `{ uid, displayName, mode: "recipes", count, recipes: [{ categoryUid, categoryTitle, categoryModName, inputs: [[{ registryName, displayName, count, metadata }]], outputs: [...] }] }`

Each input/output is a list of alternatives (e.g., any of 3 different planks).

---

### `jei_get_uses`

Get all recipes/uses that consume or use a given item as input.

| Parameter | Type | Description |
|-----------|------|-------------|
| `uid` | string | JEI unique identifier for the input item |

**Example:**
```
jei_get_uses(uid="minecraft:stick")
```
**Returns:** Same structure as `jei_get_recipes` but with `mode: "uses"`.

---

### `jei_list_all_items`

List all items registered in JEI, sorted alphabetically by display name. Supports pagination for large modpacks.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `offset` | int | 0 | Pagination offset |
| `limit` | int | 200 | Items per page (1-5000) |

**Example:**
```
jei_list_all_items(offset=0, limit=100)
```
**Returns:** `{ total, offset, limit, results: [{ uid, displayName, modId, registryName, metadata }] }`

---

### `jei_list_categories`

List all JEI recipe categories (crafting, smelting, machine-specific, etc.).

| Parameter | Type | Description |
|-----------|------|-------------|
| *(none)* | | |

**Example:**
```
jei_list_categories()
```
**Returns:** `{ count, categories: [{ uid, title, modName }] }`

---

### `jei_health`

Check if the JEI bridge mod is running and connected. Use this to verify the bridge is operational before making other queries.

| Parameter | Type | Description |
|-----------|------|-------------|
| *(none)* | | |

**Example:**
```
jei_health()
```
**Returns:** `{ status: "ok", jei_runtime: true, item_count: 22277 }`

## HTTP API (Direct)

The mod exposes these REST endpoints on `http://127.0.0.1:18732/api/`:

| Endpoint | Method | Params | Description |
|----------|--------|--------|-------------|
| `/health` | GET | — | Health check with runtime status and item count |
| `/items/search` | GET | `q`, `limit` (max 500), `offset` | Search items by query |
| `/items/all` | GET | `limit` (max 5000), `offset` | Paginated list of all items |
| `/items/count` | GET | — | Total registered item count |
| `/items/<uid>` | GET | — | Item details (tooltip, ore dict, creative tabs) |
| `/items/<uid>/recipes` | GET | — | Recipes that produce the item |
| `/items/<uid>/uses` | GET | — | Recipes that consume the item |
| `/categories` | GET | — | All recipe categories |

All endpoints return JSON. Errors return `{ "error": "message" }` with appropriate HTTP status codes (400, 404, 405, 500).

## Technical Details

- **HTTP Server:** Java's built-in `com.sun.net.httpserver.HttpServer` — no external dependencies
- **JSON:** Gson (bundled with Minecraft/Forge)
- **Thread Safety:** All JEI API calls dispatched to Minecraft main thread via `Minecraft.addScheduledTask()` + `CompletableFuture.get(30s timeout)`
- **Binding:** `127.0.0.1:18732` only (localhost, not exposed to network)
- **Item Cache:** Built once on JEI runtime initialization, sorted alphabetically, with O(1) UID lookup
- **Search:** Linear scan over all items matching against display name, mod ID, resource path, and UID (case-insensitive)
- **Recipe Lookup:** Delegates to JEI's `IRecipeRegistry` with `IFocus` (INPUT/OUTPUT mode)
- **Item IDs:** Uses JEI's `IIngredientHelper.getUniqueId()` — items with metadata use format `mod:item:damage`

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `jei_runtime: false` | Wait for JEI to fully initialize after joining a world |
| `Bridge not reachable` | Minecraft isn't running, or mod JAR not in `mods/` folder |
| Empty recipe results | Item may not have recipes in JEI (creative-only items) |
| MCP server won't start | Ensure `npm run build` completed successfully, check Node.js version |

## Fuzz Test Results

The HTTP API was fuzz-tested with 47 tests covering:
- Valid searches (case-insensitive, partial, mod-specific)
- Special characters and long queries
- Pagination boundaries (offset beyond total, large limit)
- Wildcard UIDs (`minecraft:planks`, `minecraft:wool`)
- Metadata UIDs (`minecraft:wool:0`)
- Invalid/missing resources (proper 404 errors)
- HTTP method validation (GET-only enforced)
- Empty queries (proper 400 errors)

**Result: 0 failures, 47/47 passed.**
