/* Testes do núcleo Ford-Fulkerson — execute com:  node tests/test.js */
const assert = require('assert');
const FF = require('../js/fordFulkerson.js');
const A = require('../js/analysis.js');
const NET = require('../js/network.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓', name); }
  catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; }
}

function graph(n, edges) {
  const g = new FF.ResidualNetwork(n);
  edges.forEach(([u, v, c]) => g.addEdge(u, v, c));
  return g;
}

console.log('Núcleo Ford-Fulkerson');
// Exemplo clássico do CLRS (Fig. 26.1): fluxo máximo = 23
const clrs = [[0,1,16],[0,2,13],[2,1,4],[1,3,12],[3,2,9],[2,4,14],[4,3,7],[3,5,20],[4,5,4]];
for (const strategy of ['bfs', 'dfs']) {
  test(`CLRS 26.1 = 23 (${strategy})`, () => {
    assert.strictEqual(FF.fordFulkerson(graph(6, clrs), 0, 5, { strategy }).maxFlow, 23);
  });
}
test('arestas antiparalelas (u->v e v->u)', () => {
  const g = graph(4, [[0,1,10],[1,0,5],[1,2,4],[2,1,3],[2,3,10],[0,2,2]]);
  assert.strictEqual(FF.fordFulkerson(g, 0, 3).maxFlow, 6);
});
test('caminho que exige cancelar fluxo (arco reverso)', () => {
  // DFS pega s-a-b-t primeiro; o ótimo exige desfazer a->b
  const g = graph(4, [[0,1,1],[0,2,1],[1,2,1],[1,3,1],[2,3,1]]);
  assert.strictEqual(FF.fordFulkerson(g, 0, 3, { strategy: 'dfs' }).maxFlow, 2);
});
test('sem caminho => fluxo 0', () => {
  assert.strictEqual(FF.fordFulkerson(graph(3, [[0,1,5]]), 0, 2).maxFlow, 0);
});

console.log('Rede real (Maracanã → Praça da Bandeira)');
const caps = NET.edges.map((e) => e.cap);
const base = A.solve(NET, caps, { record: true });
test(`${NET.nodes.length - 2} cruzamentos (requisito: no mínimo 15–20)`, () => {
  assert.ok(NET.nodes.length - 2 >= 15);
});
test('BFS e DFS chegam ao mesmo fluxo máximo', () => {
  assert.strictEqual(A.solve(NET, caps, { strategy: 'dfs' }).maxFlow, base.maxFlow);
});
test('fluxo máximo = capacidade do corte mínimo', () => {
  assert.strictEqual(base.maxFlow, base.cutCapacity);
});
test('capacidade e conservação respeitadas', () => {
  assert.ok(base.check.capacityOk && base.check.conservationOk);
  assert.strictEqual(base.check.outOfSource, base.maxFlow);
});
test('arestas do corte mínimo estão saturadas', () => {
  base.minCut.forEach((id) => assert.ok(base.saturated.includes(id)));
});
test('cenário A: interditar via do corte reduz o fluxo', () => {
  const r = A.scenarioA(NET, caps, base.minCut[0], 'close');
  assert.ok(r.after < r.before && r.lossPct > 0);
});
test('cenário B: ganho nunca excede X', () => {
  const r = A.scenarioB(NET, caps, 600);
  r.candidates.forEach((c) => assert.ok(c.gain >= 0 && c.gain <= 600));
});

console.log(`\nFluxo máximo: ${base.maxFlow} veíc/h em ${base.iterations} caminhos aumentantes`);
console.log('Vias saturadas:');
base.saturated.forEach((id) => {
  const e = NET.edges[id];
  console.log(`  ${NET.nodes[e.u].id}->${NET.nodes[e.v].id}  ${e.name}  (${e.cap} veíc/h)${base.minCut.includes(id) ? '  [corte mínimo]' : ''}`);
});
const b = A.scenarioB(NET, caps, 600);
console.log('Cenário B (+600):', b.candidates.map((c) => `${NET.edges[c.edgeId].name}: +${c.gain}`).join(' | '));
console.log(`\n${passed} testes passaram.`);
