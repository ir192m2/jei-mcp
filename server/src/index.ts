import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_PORT = 18732;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}/api`;
const REQUEST_TIMEOUT = 30_000;

interface BridgeItem {
  uid: string;
  wildcardId?: string;
  displayName: string;
  modId: string;
  resourceDomain?: string;
  resourcePath: string;
  registryName?: string;
  metadata?: number;
  count?: number;
}

interface BridgeItemDetail extends BridgeItem {
  tooltip?: string[];
  oreDict?: string[];
  creativeTabs?: string[];
}

interface BridgeRecipe {
  categoryUid: string;
  categoryTitle: string;
  categoryModName: string;
  inputs: { registryName: string; displayName: string; count: number; metadata: number }[][];
  outputs: { registryName: string; displayName: string; count: number; metadata: number }[][];
}

interface BridgeCategory {
  uid: string;
  title: string;
  modName: string;
}

async function bridgeFetch<T>(path: string): Promise<T> {
  const url = `${BRIDGE_BASE}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Bridge returned ${resp.status}: ${body}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

const server = new McpServer({
  name: "jei-mcp-server",
  version: "1.0.0",
});

server.registerTool(
  "jei_search_items",
  {
    description:
      "Search for Minecraft items by name, mod ID, or resource path. Requires JEI bridge mod running in-game.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("Search term (item name, mod ID, or resource path)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(50)
        .describe("Maximum results to return"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Pagination offset"),
    }),
  },
  async (args) => {
    try {
      const q = encodeURIComponent(args.query);
      const data = await bridgeFetch<{
        total: number;
        offset: number;
        limit: number;
        results: BridgeItem[];
      }>(`/items/search?q=${q}&limit=${args.limit}&offset=${args.offset}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text", text: `Bridge error: ${msg}` }],
      };
    }
  }
);

server.registerTool(
  "jei_get_item",
  {
    description:
      "Get detailed information about a specific Minecraft item by its JEI unique ID.",
    inputSchema: z.object({
      uid: z
        .string()
        .min(1)
        .describe(
          "JEI unique identifier (e.g. 'minecraft:diamond' or 'minecraft:wool:0')"
        ),
    }),
  },
  async (args) => {
    try {
      const data = await bridgeFetch<BridgeItemDetail>(
        `/items/${args.uid}`
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text", text: `Bridge error: ${msg}` }],
      };
    }
  }
);

server.registerTool(
  "jei_get_recipes",
  {
    description:
      "Get all recipes that produce (craft/smelt/etc.) a given item.",
    inputSchema: z.object({
      uid: z
        .string()
        .min(1)
        .describe(
          "JEI unique identifier for the item (e.g. 'minecraft:diamond')"
        ),
    }),
  },
  async (args) => {
    try {
      const data = await bridgeFetch<{
        uid: string;
        displayName: string;
        mode: string;
        count: number;
        recipes: BridgeRecipe[];
      }>(`/items/${args.uid}/recipes`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text", text: `Bridge error: ${msg}` }],
      };
    }
  }
);

server.registerTool(
  "jei_get_uses",
  {
    description:
      "Get all recipes/uses that consume or use a given item as input.",
    inputSchema: z.object({
      uid: z
        .string()
        .min(1)
        .describe(
          "JEI unique identifier for the item (e.g. 'minecraft:stick')"
        ),
    }),
  },
  async (args) => {
    try {
      const data = await bridgeFetch<{
        uid: string;
        displayName: string;
        mode: string;
        count: number;
        recipes: BridgeRecipe[];
      }>(`/items/${args.uid}/uses`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text", text: `Bridge error: ${msg}` }],
      };
    }
  }
);

server.registerTool(
  "jei_list_all_items",
  {
    description:
      "List all items registered in JEI, sorted alphabetically. Use pagination for large modpacks.",
    inputSchema: z.object({
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Pagination offset"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(5000)
        .default(200)
        .describe("Items per page"),
    }),
  },
  async (args) => {
    try {
      const data = await bridgeFetch<{
        total: number;
        offset: number;
        limit: number;
        results: BridgeItem[];
      }>(`/items/all?limit=${args.limit}&offset=${args.offset}`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text", text: `Bridge error: ${msg}` }],
      };
    }
  }
);

server.registerTool(
  "jei_list_categories",
  {
    description: "List all JEI recipe categories (crafting, smelting, etc.).",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = await bridgeFetch<{
        categories: BridgeCategory[];
        count: number;
      }>("/categories");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [{ type: "text", text: `Bridge error: ${msg}` }],
      };
    }
  }
);

server.registerTool(
  "jei_health",
  {
    description:
      "Check if the JEI bridge mod is running and connected.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = await bridgeFetch<{ status: string; jei_runtime: boolean }>(
        "/health"
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Bridge not reachable (is Minecraft running with JEI MCP Bridge installed?): ${msg}`,
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("JEI MCP Server connected via stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
