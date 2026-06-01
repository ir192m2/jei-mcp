function escapeSqlString(s) {
  return String(s).replace(/'/g, "''");
}

function buildCatClause(categoryFilter) {
  return categoryFilter ? ` AND e.category = '${escapeSqlString(categoryFilter)}'` : "";
}

export class GraphTraverser {
  constructor(db) {
    this.db = db;
  }

  _iterativeBfs(startUid, options, direction) {
    const { maxDepth = 3, maxNodes = 500, categoryFilter = null } = options;
    if (!startUid) return [];
    const catClause = buildCatClause(categoryFilter);
    const sourceCol = direction === "in" ? "target" : "source";
    const neighborCol = direction === "in" ? "source" : "target";

    const seen = new Map();
    seen.set(startUid, 0);
    let frontier = [startUid];

    for (let d = 0; d <= maxDepth && frontier.length > 0; d++) {
      if (seen.size >= maxNodes) break;
      const placeholders = frontier.map(() => "?").join(",");
      const sql = `
        SELECT DISTINCT ${neighborCol} as uid
        FROM edges
        WHERE ${sourceCol} IN (${placeholders})${catClause}
      `;
      let next;
      try {
        next = this.db.prepare(sql).all(...frontier);
      } catch (e) {
        throw new Error(`BFS query at depth ${d} failed: ${e.message}`);
      }
      const newFrontier = [];
      for (const { uid } of next) {
        if (!seen.has(uid)) {
          seen.set(uid, d + 1);
          newFrontier.push(uid);
          if (seen.size >= maxNodes) break;
        }
      }
      frontier = newFrontier;
    }

    const result = [...seen.entries()].map(([uid, depth]) => ({ uid, depth }));
    result.sort((a, b) => a.depth - b.depth || (a.uid < b.uid ? -1 : 1));
    return result;
  }

  traverseBFS(startUid, options = {}) {
    return this._iterativeBfs(startUid, options, "out");
  }

  traverseDFS(startUid, options = {}) {
    return this._iterativeBfs(startUid, options, "out");
  }

  findPath(fromUid, toUid, options = {}) {
    const { maxDepth = 10, categoryFilter = null } = options;
    if (!fromUid || !toUid) return null;
    if (fromUid === toUid) return [fromUid];
    const catClause = buildCatClause(categoryFilter);

    const visited = new Map();
    const parent = new Map();
    visited.set(fromUid, 0);
    let frontier = [fromUid];

    for (let d = 0; d < maxDepth; d++) {
      if (frontier.length === 0) return null;
      const placeholders = frontier.map(() => "?").join(",");
      const sql = `
        SELECT DISTINCT target as uid, source as src
        FROM edges
        WHERE source IN (${placeholders})${catClause}
      `;
      let next;
      try {
        next = this.db.prepare(sql).all(...frontier);
      } catch (e) {
        throw new Error(`Path query at depth ${d} failed: ${e.message}`);
      }
      const newFrontier = [];
      for (const { uid, src } of next) {
        if (!visited.has(uid)) {
          visited.set(uid, d + 1);
          parent.set(uid, src);
          newFrontier.push(uid);
          if (uid === toUid) {
            const path = [uid];
            let cur = uid;
            while (parent.has(cur)) {
              cur = parent.get(cur);
              path.unshift(cur);
            }
            return path;
          }
        }
      }
      frontier = newFrontier;
    }
    return null;
  }

  getSubgraph(startUid, options = {}) {
    const { maxDepth = 2, direction = "both", categoryFilter = null, maxNodes = 100 } = options;
    if (!startUid) return { nodes: [], edges: [] };

    const nodeUids = new Set([startUid]);
    if (direction === "out" || direction === "both") {
      for (const n of this._iterativeBfs(startUid, { maxDepth, maxNodes, categoryFilter }, "out")) {
        nodeUids.add(n.uid);
      }
    }
    if (direction === "in" || direction === "both") {
      for (const n of this._iterativeBfs(startUid, { maxDepth, maxNodes, categoryFilter }, "in")) {
        nodeUids.add(n.uid);
      }
    }

    const nodeList = [...nodeUids];
    if (nodeList.length === 0) return { nodes: [], edges: [] };
    const placeholders = nodeList.map(() => "?").join(",");
    const catClause = buildCatClause(categoryFilter);
    const edgeSql = `SELECT source, target, category FROM edges WHERE source IN (${placeholders}) AND target IN (${placeholders})${catClause}`;
    let edges = [];
    try {
      edges = this.db.prepare(edgeSql).all(...nodeList, ...nodeList);
    } catch (e) {
      throw new Error(`Subgraph edge query failed: ${e.message}`);
    }
    return { nodes: nodeList, edges };
  }

  getAncestors(uid, maxDepth = 10) {
    if (!uid) return [];
    const all = this._iterativeBfs(uid, { maxDepth, maxNodes: 10000 }, "in");
    return all.filter((n) => n.uid !== uid);
  }

  getDescendants(uid, maxDepth = 10) {
    if (!uid) return [];
    const all = this._iterativeBfs(uid, { maxDepth, maxNodes: 10000 }, "out");
    return all.filter((n) => n.uid !== uid);
  }

  detectCycles(maxNodes = 1000, maxCycles = 100, perNodeDegreeCap = 5000) {
    const cycles = [];
    const startNodes = this.db.prepare("SELECT DISTINCT source FROM edges LIMIT ?").all(maxNodes);

    for (const { source } of startNodes) {
      const inStack = new Set([source]);
      const localParent = new Map();
      const stack = [{ uid: source, iter: 0, neighbors: this._neighborsOf(source, perNodeDegreeCap) }];
      const localVisited = new Set([source]);

      while (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (top.iter >= top.neighbors.length) {
          inStack.delete(top.uid);
          stack.pop();
          continue;
        }
        const { target } = top.neighbors[top.iter++];
        if (inStack.has(target)) {
          const cycle = [target];
          let cur = top.uid;
          while (cur !== target) {
            cycle.unshift(cur);
            cur = localParent.get(cur);
            if (cur === undefined) break;
          }
          cycle.unshift(target);
          cycles.push(cycle);
          if (cycles.length >= maxCycles) return cycles;
        } else if (!localVisited.has(target)) {
          localVisited.add(target);
          localParent.set(target, top.uid);
          inStack.add(target);
          stack.push({ uid: target, iter: 0, neighbors: this._neighborsOf(target, perNodeDegreeCap) });
        }
      }
      if (cycles.length >= maxCycles) break;
    }
    return cycles;
  }

  _neighborsOf(uid, cap) {
    const rows = this.db.prepare(
      "SELECT target FROM edges WHERE source = ? LIMIT ?"
    ).all(uid, cap);
    return rows;
  }

  impactAnalysis(uid) {
    if (!uid) return [];
    return this._iterativeBfs(uid, { maxDepth: 100, maxNodes: 100000 }, "in")
      .filter((n) => n.uid !== uid)
      .map((n) => n.uid);
  }

  criticalPath(startUid, endUid) {
    return this.findPath(startUid, endUid, { maxDepth: 20 });
  }
}
