/**
 * Núcleo algorítmico — Método de Ford-Fulkerson implementado do zero.
 *
 * Nenhuma biblioteca de grafos é usada. A rede residual G_f é mantida
 * EXPLICITAMENTE como uma lista de arcos residuais:
 *
 *   - Para cada rua (u,v) com capacidade c(u,v) criamos DOIS arcos residuais:
 *       arco 2k   : u -> v  com capacidade residual c_f(u,v) = c(u,v) - f(u,v)
 *       arco 2k+1 : v -> u  com capacidade residual c_f(v,u) = f(u,v)   (arco reverso)
 *   - O par de um arco i é sempre i ^ 1 (XOR 1), o que torna o "aumento" O(1).
 *   - O fluxo de uma rua é lido diretamente da rede residual: f(u,v) = c_f(v,u).
 *
 * Isso também resolve naturalmente ruas antiparalelas (u->v e v->u, ex.: avenida
 * de mão dupla modelada como dois arcos), pois cada uma tem o seu próprio reverso.
 *
 * Funciona no navegador (window.FF) e no Node (module.exports) para os testes.
 */
(function (root) {
  'use strict';

  class ResidualNetwork {
    constructor(n) {
      this.n = n;
      this.adj = Array.from({ length: n }, () => []); // adj[u] = ids de arcos residuais saindo de u
      this.to = [];       // destino de cada arco residual
      this.from = [];     // origem de cada arco residual
      this.res = [];      // capacidade residual c_f de cada arco
      this.cap = [];      // capacidade original (0 nos arcos reversos)
    }

    /** Adiciona a rua u->v. Retorna o id do arco "para frente" (sempre par). */
    addEdge(u, v, c) {
      if (c < 0) throw new Error('Capacidade negativa');
      const id = this.to.length;
      this.from.push(u, v);
      this.to.push(v, u);
      this.res.push(c, 0);
      this.cap.push(c, 0);
      this.adj[u].push(id);
      this.adj[v].push(id + 1);
      return id;
    }

    /** f(u,v) da rua cujo arco para frente é `id`. */
    flow(id) { return this.res[id ^ 1]; }

    /** Empurra `delta` unidades pelo arco residual `id` (atualiza o par). */
    push(id, delta) {
      this.res[id] -= delta;
      this.res[id ^ 1] += delta;
    }
  }

  /** Busca em LARGURA na rede residual (Edmonds-Karp): caminho com menos arestas. */
  function bfsPath(g, s, t, visitLog) {
    const parent = new Int32Array(g.n).fill(-1);
    const seen = new Uint8Array(g.n);
    const queue = [s];
    seen[s] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      if (visitLog) visitLog.push(u);
      if (u === t) break;
      for (const id of g.adj[u]) {
        const v = g.to[id];
        if (!seen[v] && g.res[id] > 0) {
          seen[v] = 1;
          parent[v] = id;
          queue.push(v);
        }
      }
    }
    return seen[t] ? rebuild(g, parent, s, t) : null;
  }

  /** Busca em PROFUNDIDADE na rede residual (Ford-Fulkerson "clássico"). */
  function dfsPath(g, s, t, visitLog) {
    const parent = new Int32Array(g.n).fill(-1);
    const seen = new Uint8Array(g.n);
    const stack = [s];
    while (stack.length) {
      const u = stack.pop();
      if (seen[u]) continue;
      seen[u] = 1;
      if (visitLog) visitLog.push(u);
      if (u === t) break;
      // empilha em ordem reversa para explorar na ordem de adjacência
      for (let k = g.adj[u].length - 1; k >= 0; k--) {
        const id = g.adj[u][k];
        const v = g.to[id];
        if (!seen[v] && g.res[id] > 0) {
          parent[v] = id;
          stack.push(v);
        }
      }
    }
    return seen[t] ? rebuild(g, parent, s, t) : null;
  }

  function rebuild(g, parent, s, t) {
    const path = [];
    for (let v = t; v !== s; v = g.from[parent[v]]) path.push(parent[v]);
    return path.reverse();
  }

  /**
   * Método de Ford-Fulkerson.
   * @param {ResidualNetwork} g  rede residual (é modificada)
   * @param {number} s origem, @param {number} t destino
   * @param {{strategy?:'bfs'|'dfs', record?:boolean}} opts
   * @returns {{maxFlow:number, steps:Array, iterations:number}}
   */
  function fordFulkerson(g, s, t, opts = {}) {
    const strategy = opts.strategy || 'bfs';
    const find = strategy === 'dfs' ? dfsPath : bfsPath;
    const steps = [];
    let maxFlow = 0;
    let iterations = 0;

    // Linha 1: f(u,v) <- 0 para toda aresta (garantido pela construção)
    while (true) {
      const visited = opts.record ? [] : null;
      // Linha 2: enquanto existir caminho aumentante p em G_f
      const path = find(g, s, t, visited);
      if (!path) break;
      // Linha 3: c_f(p) = min c_f(u,v) em p
      let bottleneck = Infinity;
      for (const id of path) bottleneck = Math.min(bottleneck, g.res[id]);
      // Linhas 4-6: aumenta o fluxo (arco para frente soma, arco reverso cancela)
      for (const id of path) g.push(id, bottleneck);
      maxFlow += bottleneck;
      iterations++;
      if (opts.record) {
        steps.push({
          path: path.slice(),
          bottleneck,
          total: maxFlow,
          visited,
          // fluxo de cada rua após este aumento (para a animação passo a passo)
          flows: snapshot(g),
        });
      }
      if (iterations > 1e6) throw new Error('Iterações demais (capacidades irracionais?)');
    }
    return { maxFlow, steps, iterations };
  }

  function snapshot(g) {
    const m = g.to.length / 2;
    const f = new Array(m);
    for (let k = 0; k < m; k++) f[k] = g.flow(2 * k);
    return f;
  }

  /** Conjunto S alcançável a partir de s na rede residual final (corte mínimo). */
  function residualReachable(g, s) {
    const seen = new Uint8Array(g.n);
    const queue = [s];
    seen[s] = 1;
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      for (const id of g.adj[u]) {
        const v = g.to[id];
        if (!seen[v] && g.res[id] > 0) { seen[v] = 1; queue.push(v); }
      }
    }
    return seen;
  }

  const api = { ResidualNetwork, fordFulkerson, bfsPath, dfsPath, residualReachable, snapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FF = api;
})(typeof window !== 'undefined' ? window : globalThis);
