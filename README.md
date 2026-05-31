# JEI-MCP

Bridges [Just Enough Items (JEI)](https://github.com/mezz/JustEnoughItems) (1.12.2) to [Model Context Protocol (MCP)](https://modelcontextprotocol.io), allowing KiloCode (and other MCP clients) to query Minecraft item and recipe data from a running game instance.

## Architecture

```
KiloCode ──MCP stdio──> jei-mcp-server (TypeScript) ──HTTP──> Minecraft Client (Forge mod + JEI)
```

Two components:

### 1. `mod/` — Forge 1.12.2 Mod

A client-side Forge mod that:
- Hooks into JEI via `@JEIPlugin` to get `IJeiRuntime`
- Starts a local HTTP server on `127.0.0.1:18732`
- Exposes REST endpoints for item search, details, recipes, uses, and categories
- Runs all JEI queries on the Minecraft main thread for thread safety

### 2. `server/` — MCP Server (TypeScript)

An MCP stdio server that:
- Implements the Model Context Protocol
- Provides tools that proxy requests to the in-game mod
- Handles connection errors when Minecraft isn't running

## Setup

### Prerequisites

- Minecraft 1.12.2 with Forge 14.23.5.2860+
- JEI 4.16.x for 1.12.2

### Building the Mod

```bash
cd mod
# Set up Forge workspace (requires JDK 8)
./gradlew build
# Output: build/libs/jei-mcp-bridge-1.0.0.jar
```

Place the built JAR in your Minecraft `mods/` folder alongside JEI.

### Setting up the MCP Server

```bash
cd server
npm install
npm run build
```

### Configuring KiloCode

Add the MCP server to your KiloCode configuration:

```jsonc
// .kilo/kilo.jsonc
{
  "mcpServers": {
    "jei-mcp": {
      "command": "node",
      "args": ["path/to/jei-mcp/server/dist/index.js"]
    }
  }
}
```

## Usage

1. Launch Minecraft with JEI and the bridge mod installed
2. Join a world (the mod starts automatically on the title screen)
3. KiloCode can now query items and recipes via MCP tools

### Available Tools

| Tool | Description |
|------|-------------|
| `jei_search_items` | Search items by name, mod ID, or resource path |
| `jei_get_item` | Get detailed info about a specific item (tooltip, ore dict, etc.) |
| `jei_get_recipes` | Get all recipes that produce an item |
| `jei_get_uses` | Get all recipes that consume an item |
| `jei_list_all_items` | List all items alphabetically (paginated) |
| `jei_list_categories` | List all recipe categories |
| `jei_health` | Check if the bridge mod is reachable |

## API Endpoints (Mod HTTP Server)

The mod exposes these endpoints on `http://127.0.0.1:18732/api/`:

| Endpoint | Params | Description |
|----------|--------|-------------|
| `GET /health` | — | Health check, returns `jei_runtime` boolean |
| `GET /items/search` | `q`, `limit`, `offset` | Search items by query |
| `GET /items/all` | `limit`, `offset` | Paginated list of all items |
| `GET /items/<uid>` | — | Item details with tooltip |
| `GET /items/<uid>/recipes` | — | Recipes that produce the item |
| `GET /items/<uid>/uses` | — | Recipes that use the item |
| `GET /categories` | — | List all recipe categories |
| `GET /items/count` | — | Total item count |

## Technical Notes

- The mod uses Java's built-in `com.sun.net.httpserver.HttpServer` — no additional HTTP dependencies
- JSON serialization uses Gson (bundled with Minecraft/Forge)
- All JEI API calls are dispatched to the Minecraft main thread via `Minecraft.addScheduledTask()`
- The HTTP server binds to `127.0.0.1` only (localhost) for security
