/**
 * Camada de análise de tráfego sobre o núcleo Ford-Fulkerson:
 *   - solve(): fluxo máximo + diagnóstico (vias saturadas, corte mínimo, verificação)
 *   - scenarioA(): obra/acidente (interdição ou faixa bloqueada)
 *   - scenarioB(): investimento — testa +X em cada via saturada e recomenda a melhor
 *   - Extras: ranking de vulnerabilidade, pares de obras (sinergia), evacuação
 */
(function (root) {
  'use strict';
  const FF = (typeof module !== 'undefined' && module.exports) ? require('./fordFulkerson.js') : root.FF;

  /** Constrói a rede residual a partir das capacidades `caps` (array por aresta). */
  function build(net, caps) {
    const g = new FF.ResidualNetwork(net.nodes.length);
    const arcOf = net.edges.map((e) => g.addEdge(e.u, e.v, caps[e.id]));
    return { g, arcOf };
  }

  function solve(net, caps, opts = {}) {
    const { g, arcOf } = build(net, caps);
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
    const run = FF.fordFulkerson(g, net.s, net.t, { strategy: opts.strategy || 'bfs', record: !!opts.record });
    const elapsed = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    const flows = net.edges.map((e) => g.flow(arcOf[e.id]));
    const reach = FF.residualReachable(g, net.s);

    // Diagnóstico de gargalos: c_f(u,v) = c(u,v) - f(u,v) = 0
    const saturated = net.edges
      .filter((e) => caps[e.id] > 0 && g.res[arcOf[e.id]] === 0)
      .map((e) => e.id);
    // Corte mínimo (S,T): arestas de S para T — teorema fluxo máximo / corte mínimo
    const minCut = net.edges.filter((e) => reach[e.u] && !reach[e.v] && caps[e.id] > 0).map((e) => e.id);
    const cutCapacity = minCut.reduce((a, id) => a + caps[id], 0);

    // Passos convertidos de "arcos residuais" para (aresta, sentido)
    const arcToEdge = new Map(arcOf.map((a, i) => [a, i]));
    const steps = run.steps.map((st) => ({
      bottleneck: st.bottleneck,
      total: st.total,
      flows: st.flows,
      visited: st.visited,
      path: st.path.map((arc) => ({
        edge: arcToEdge.get(arc & ~1),
        forward: (arc & 1) === 0,
      })),
    }));

    return {
      maxFlow: run.maxFlow,
      iterations: run.iterations,
      elapsed,
      flows,
      residual: net.edges.map((e) => g.res[arcOf[e.id]]),
      saturated,
      minCut,
      cutCapacity,
      reach: Array.from(reach),
      steps,
      check: verify(net, caps, flows),
    };
  }

  /** Verifica restrição de capacidade e conservação de fluxo em cada cruzamento. */
  function verify(net, caps, flows) {
    const balance = new Array(net.nodes.length).fill(0);
    let capacityOk = true;
    net.edges.forEach((e) => {
      if (flows[e.id] < 0 || flows[e.id] > caps[e.id]) capacityOk = false;
      balance[e.u] -= flows[e.id];
      balance[e.v] += flows[e.id];
    });
    const violations = balance
      .map((b, i) => ({ node: i, b }))
      .filter((x) => x.node !== net.s && x.node !== net.t && x.b !== 0);
    return {
      capacityOk,
      conservationOk: violations.length === 0,
      intersections: net.nodes.length - 2,
      outOfSource: -balance[net.s],
      intoSink: balance[net.t],
      violations,
    };
  }

  /** Cenário A — rua interditada (c=0) ou com faixa bloqueada (c × 0,5). */
  function scenarioA(net, caps, edgeId, mode) {
    const before = solve(net, caps).maxFlow;
    const newCaps = caps.slice();
    newCaps[edgeId] = mode === 'close' ? 0 : Math.floor(caps[edgeId] * 0.5);
    const res = solve(net, newCaps);
    const loss = before - res.maxFlow;
    return {
      edgeId, mode, before, after: res.maxFlow, loss,
      lossPct: before > 0 ? (100 * loss) / before : 0,
      caps: newCaps, result: res,
    };
  }

  /** Cenário B — testa +X em CADA via saturada e recomenda a de maior ganho real. */
  function scenarioB(net, caps, X) {
    const base = solve(net, caps);
    const candidates = base.saturated.map((id) => {
      const c = caps.slice();
      c[id] += X;
      const after = solve(net, c).maxFlow;
      return { edgeId: id, after, gain: after - base.maxFlow, inMinCut: base.minCut.includes(id) };
    });
    candidates.sort((a, b) => b.gain - a.gain || a.edgeId - b.edgeId);
    const best = candidates.length && candidates[0].gain > 0 ? candidates[0] : null;
    return { before: base.maxFlow, X, candidates, best };
  }

  /** Extra — sinergia: melhor PAR de obras (+X em duas vias saturadas ao mesmo tempo). */
  function bestPair(net, caps, X) {
    const base = solve(net, caps);
    const sat = base.saturated;
    let best = null;
    for (let i = 0; i < sat.length; i++) {
      for (let j = i + 1; j < sat.length; j++) {
        const c = caps.slice();
        c[sat[i]] += X;
        c[sat[j]] += X;
        const gain = solve(net, c).maxFlow - base.maxFlow;
        if (!best || gain > best.gain) best = { pair: [sat[i], sat[j]], gain };
      }
    }
    return best;
  }

  /** Extra — vulnerabilidade: perda de fluxo se cada rua for interditada isoladamente. */
  function vulnerability(net, caps) {
    const base = solve(net, caps).maxFlow;
    return net.edges
      .filter((e) => caps[e.id] > 0)
      .map((e) => {
        const c = caps.slice();
        c[e.id] = 0;
        const after = solve(net, c).maxFlow;
        return { edgeId: e.id, loss: base - after, lossPct: base ? (100 * (base - after)) / base : 0 };
      })
      .sort((a, b) => b.loss - a.loss);
  }

  /** Extra — tempo para escoar todos os veículos do estádio dado o fluxo máximo. */
  function evacuation(maxFlow, p) {
    const vehicles = Math.round((p.attendance * p.carShare) / p.occupancy);
    const hours = maxFlow > 0 ? vehicles / maxFlow : Infinity;
    return { vehicles, hours, minutes: hours * 60 };
  }

  const api = { build, solve, verify, scenarioA, scenarioB, bestPair, vulnerability, evacuation };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Analysis = api;
})(typeof window !== 'undefined' ? window : globalThis);
