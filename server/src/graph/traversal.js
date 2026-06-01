export class GraphTraverser {
  constructor(db) {
    this.db = db;
    this._adjOut = null;
    this._adjIn = null;
  }

  _buildAdjacency() {
    if (this._adjOut) return;
    this._adjOut = new Map();
    this._adjIn = new Map();
    const edges = this.db.prepare("SELECT source, target, category FROM edges").all();
    for (const e of edges) {
      if (!this._adjOut.has(e.source)) this._adjOut.set(e.source, []);
      this._adjOut.get(e.source).push({ to: e.target, category: e.category });
      if (!this._adjIn.has(e.target)) this._adjIn.set(e.target, []);
      this._adjIn.get(e.target).push({ from: e.source, category: e.category });
    }
  }

  traverseBFS(startUid, options = {}) {
    this._buildAdjacency();
    const { maxDepth = 3, edgeFilter = null, maxNodes = 500 } = options;
    const visited = new Set();
    const result = [];
    const queue = [{ uid: startUid, depth: 0 }];
    visited.add(startUid);

    while (queue.length > 0 && result.length < maxNodes) {
      const { uid, depth } = queue.shift();
      if (depth > maxDepth) continue;
      result.push({ uid, depth });
      const neighbors = this._adjOut.get(uid) || [];
      for (const { to, category } of neighbors) {
        if (visited.has(to)) continue;
        if (edgeFilter && !edgeFilter(category)) continue;
        visited.add(to);
        queue.push({ uid: to, depth: depth + 1 });
      }
    }
    return result;
  }

  traverseDFS(startUid, options = {}) {
    this._buildAdjacency();
    const { maxDepth = 3, edgeFilter = null, maxNodes = 500 } = options;
    const visited = new Set();
    const result = [];

    const dfs = (uid, depth) => {
      if (depth > maxDepth || visited.has(uid) || result.length >= maxNodes) return;
      visited.add(uid);
      result.push({ uid, depth });
      const neighbors = this._adjOut.get(uid) || [];
      for (const { to, category } of neighbors) {
        if (edgeFilter && !edgeFilter(category)) continue;
        dfs(to, depth + 1);
      }
    };

    dfs(startUid, 0);
    return result;
  }

  findPath(fromUid, toUid, options = {}) {
    this._buildAdjacency();
    const { maxDepth = 10, edgeFilter = null } = options;
    const visited = new Map();
    const parent = new Map();
    const queue = [{ uid: fromUid, depth: 0 }];
    visited.set(fromUid, 0);

    while (queue.length > 0) {
      const { uid, depth } = queue.shift();
      if (uid === toUid) {
        const path = [];
        let cur = toUid;
        while (cur !== undefined) { path.unshift(cur); cur = parent.get(cur); }
        return path;
      }
      if (depth >= maxDepth) continue;
      const neighbors = this._adjOut.get(uid) || [];
      for (const { to, category } of neighbors) {
        if (edgeFilter && !edgeFilter(category)) continue;
        if (visited.has(to)) continue;
        visited.set(to, depth + 1);
        parent.set(to, uid);
        queue.push({ uid: to, depth: depth + 1 });
      }
    }
    return null;
  }

  getSubgraph(startUid, options = {}) {
    this._buildAdjacency();
    const { maxDepth = 2, direction = "both", edgeFilter = null, maxNodes = 100 } = options;
    const visited = new Set();
    const nodes = new Set();
    const edges = [];

    const expand = (uid, depth) => {
      if (depth > maxDepth || visited.has(uid) || nodes.size >= maxNodes) return;
      visited.add(uid);
      nodes.add(uid);

      if (direction === "out" || direction === "both") {
        for (const { to, category } of (this._adjOut.get(uid) || [])) {
          if (edgeFilter && !edgeFilter(category)) continue;
          edges.push({ source: uid, target: to, category });
          expand(to, depth + 1);
        }
      }
      if (direction === "in" || direction === "both") {
        for (const { from, category } of (this._adjIn.get(uid) || [])) {
          if (edgeFilter && !edgeFilter(category)) continue;
          edges.push({ source: from, target: uid, category });
          expand(from, depth + 1);
        }
      }
    };

    expand(startUid, 0);
    return { nodes: [...nodes], edges };
  }

  getAncestors(uid, maxDepth = 10) {
    this._buildAdjacency();
    const ancestors = [];
    const visited = new Set();
    const queue = [{ uid, depth: 0 }];
    while (queue.length > 0) {
      const { uid: current, depth } = queue.shift();
      if (depth > maxDepth || visited.has(current)) continue;
      visited.add(current);
      if (depth > 0) ancestors.push({ uid: current, depth });
      for (const { from } of (this._adjIn.get(current) || [])) {
        queue.push({ uid: from, depth: depth + 1 });
      }
    }
    return ancestors;
  }

  getDescendants(uid, maxDepth = 10) {
    this._buildAdjacency();
    const descendants = [];
    const visited = new Set();
    const queue = [{ uid, depth: 0 }];
    while (queue.length > 0) {
      const { uid: current, depth } = queue.shift();
      if (depth > maxDepth || visited.has(current)) continue;
      visited.add(current);
      if (depth > 0) descendants.push({ uid: current, depth });
      for (const { to } of (this._adjOut.get(current) || [])) {
        queue.push({ uid: to, depth: depth + 1 });
      }
    }
    return descendants;
  }

  detectCycles() {
    this._buildAdjacency();
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    const parent = new Map();
    const cycles = [];

    for (const node of this._adjOut.keys()) {
      if (color.has(node)) continue;
      const stack = [node];
      while (stack.length > 0) {
        const u = stack[stack.length - 1];
        if (!color.has(u)) color.set(u, WHITE);
        if (color.get(u) === WHITE) {
          color.set(u, GRAY);
          for (const { to } of (this._adjOut.get(u) || [])) {
            if (!color.has(to)) {
              parent.set(to, u);
              stack.push(to);
            } else if (color.get(to) === GRAY) {
              const cycle = [to];
              let cur = u;
              while (cur !== to) { cycle.unshift(cur); cur = parent.get(cur); }
              cycle.unshift(to);
              cycles.push(cycle);
            }
          }
        } else {
          color.set(u, BLACK);
          stack.pop();
        }
      }
    }
    return cycles;
  }

  impactAnalysis(uid) {
    this._buildAdjacency();
    const impacted = new Set();
    const queue = [uid];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const { from } of (this._adjIn.get(current) || [])) {
        if (!impacted.has(from)) {
          impacted.add(from);
          queue.push(from);
        }
      }
    }
    return [...impacted];
  }

  criticalPath(startUid, endUid) {
    return this.findPath(startUid, endUid, { maxDepth: 20 });
  }
}
