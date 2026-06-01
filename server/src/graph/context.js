import { getItem, getRecipes, getUses, countEdges } from "./search.js";

const MAX_CACHE_SIZE = 5000;

export class ContextBuilder {
  constructor(db, traverser) {
    this.db = db;
    this.traverser = traverser;
    this._itemCache = new Map();
  }

  _getItem(uid) {
    if (this._itemCache.has(uid)) return this._itemCache.get(uid);
    const item = getItem(this.db, uid);
    if (this._itemCache.size >= MAX_CACHE_SIZE) {
      const firstKey = this._itemCache.keys().next().value;
      this._itemCache.delete(firstKey);
    }
    this._itemCache.set(uid, item);
    return item;
  }

  buildRecipeContext(uid, options = {}) {
    const { depth = 2, maxTokens = 2000, includeUses = true } = options;
    const item = this._getItem(uid);
    if (!item) return null;

    const subgraph = this.traverser.getSubgraph(uid, {
      maxDepth: depth,
      direction: "both",
      maxNodes: 50,
    });

    const recipes = getRecipes(this.db, uid);
    const uses = includeUses ? getUses(this.db, uid) : [];

    const lines = [];
    lines.push(`# ${item.display_name}`);
    lines.push(`Mod: ${item.mod_id} | UID: ${item.uid}`);
    lines.push(`Recipes: ${item.recipe_count} | Uses: ${item.use_count}`);
    lines.push("");

    if (recipes.length > 0) {
      lines.push("## Produces (recipes using this item)");
      const grouped = {};
      for (const r of recipes) {
        if (!grouped[r.category]) grouped[r.category] = [];
        grouped[r.category].push(r);
      }
      for (const [cat, rs] of Object.entries(grouped).slice(0, 10)) {
        lines.push(`### ${cat}`);
        for (const r of rs.slice(0, 5)) {
          lines.push(`- ${r.display_name} (${r.mod_id})`);
        }
        if (rs.length > 5) lines.push(`  ... and ${rs.length - 5} more`);
      }
      if (Object.keys(grouped).length > 10) lines.push(`... and ${Object.keys(grouped).length - 10} more categories`);
    }

    if (uses.length > 0) {
      lines.push("");
      lines.push("## Requires (ingredients)");
      const seen = new Set();
      for (const u of uses.slice(0, 20)) {
        if (seen.has(u.uid)) continue;
        seen.add(u.uid);
        lines.push(`- ${u.display_name} (${u.mod_id}) [${u.category}]`);
      }
      if (uses.length > 20) lines.push(`... and ${uses.length - 20} more`);
    }

    const text = lines.join("\n");
    if (text.length > maxTokens * 4) return text.substring(0, maxTokens * 4);
    return text;
  }

  buildDependencyTree(uid, maxDepth = 3) {
    const item = this._getItem(uid);
    if (!item) return null;

    const tree = { uid, name: item.display_name, mod: item.mod_id, children: [] };
    const visited = new Set([uid]);

    const build = (current, depth) => {
      if (depth >= maxDepth) return [];
      const uses = getUses(this.db, current.uid, 10);
      return uses
        .filter((u) => !visited.has(u.uid))
        .map((u) => {
          visited.add(u.uid);
          const child = { uid: u.uid, name: u.display_name, mod: u.mod_id, children: [] };
          child.children = build(child, depth + 1);
          return child;
        });
    };

    tree.children = build(tree, 0);
    return tree;
  }

  buildItemSummary(uid) {
    const item = this._getItem(uid);
    if (!item) return null;
    const recipes = getRecipes(this.db, uid, 10);
    const uses = getUses(this.db, uid, 10);
    return {
      uid: item.uid,
      name: item.display_name,
      mod: item.mod_id,
      recipeCount: item.recipe_count,
      useCount: item.use_count,
      topRecipes: recipes.map((r) => ({ name: r.display_name, category: r.category, mod: r.mod_id })),
      topUses: uses.map((u) => ({ name: u.display_name, category: u.category, mod: u.mod_id })),
    };
  }
}
