# JEI-MCP Bridge Fuzz Test Suite

Fuzz testing for the JEI-MCP bridge (HTTP + MCP + state integration).

## Running

From the `server` directory:

```bash
npm run test:fuzz
```

Or run individual suites:

```bash
node ../test/fuzz/jei/http-fuzz.mjs  # HTTP bridge (85 cases)
node ../test/fuzz/jei/mcp-fuzz.mjs   # MCP server (90 cases)
node ../test/fuzz/shared/state-integration.mjs  # Cross-bridge workflow (23 cases)
node ../test/fuzz/master.mjs          # All 3 suites
```

## Prerequisites

- JEI-MCP bridge running on `127.0.0.1:18732` (default port)
- BQ-MCP bridge running on `127.0.0.1:18733` (required for state integration tests)
- Node.js 26+ (uses built-in `node:fetch` and `node:child_process`)

## Structure

```
test/fuzz/
├── shared/
│   ├── harness.mjs           # Shared FuzzReport, FUZZ_INPUTS, httpReq, bridgeUp
│   └── state-integration.mjs  # Cross-bridge workflow tests
├── jei/
│   ├── http-fuzz.mjs         # HTTP bridge fuzz (85 cases)
│   └── mcp-fuzz.mjs          # MCP server fuzz (90 cases)
├── master.mjs                # Runs all suites, writes reports/aggregate.json
├── reports/                  # Generated (gitignored)
│   └── aggregate.json
└── .gitignore
```

## Test Coverage

| Suite | Cases | What it tests |
|-------|-------|---------------|
| JEI HTTP | 85 | All `/api/*` endpoints: health, items/search, items/all, items/count, items/{uid}, items/{uid}/recipes, items/{uid}/uses, categories, method tampering, malformed JSON, path traversal, security, concurrency |
| JEI MCP | 90 | MCP protocol: initialize, tools/list, all 7 tools, boundary inputs, unknown tools, JSON-RPC abuse, large payloads, concurrency |
| State Integration | 23 | Cross-bridge: read consistency, pagination integrity, recipe graph sanity, BQ dry-run safety, audit log, stress |

## Bugs Found (v1.0.0 → v1.2.1)

| ID | Severity | Component | Description |
|----|----------|-----------|-------------|
| BUG-C | LOW | JEI MCP server | Node 26 `fetch failed` error returned raw to LLM. Fixed: detect ECONNREFUSED/`fetch failed`, return "Bridge not running" message. |
| BUG-D | MINOR | JEI HTTP search | `limit=-1` or `offset=-1` caused `IllegalArgumentException: fromIndex(0) > toIndex(-1)` from `subList()`. Fixed: validate `>= min` before use. |
| BUG-E | MINOR | JEI HTTP search | `limit=abc` returned 400 with raw `NumberFormatException thrown` text (info leak). Fixed: catch `NumberFormatException`, return sanitized "Invalid limit value: not a number". |

## Test Design Notes

- **CRLF rejection**: Java `HttpServer` rejects CRLF in headers at protocol level (status=0 = connection drop). This is correct security behavior — tests assert status=0.
- **limit=0 is valid**: Returns empty results array with 200 OK.
- **limit clamping**: Values > max are silently clamped to max (not rejected).
