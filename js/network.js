/**
 * Modelagem da rede viária — recorte real: entorno do Estádio do Maracanã
 * até a Praça da Bandeira (Rio de Janeiro, RJ), saída de um jogo no horário de pico.
 *
 * Fonte das coordenadas: OpenStreetMap (© colaboradores do OpenStreetMap, ODbL).
 * As coordenadas dos cruzamentos são os centróides dos nós OSM de cada interseção,
 * obtidos via Overpass API. Os sentidos de mão única seguem a tag `oneway` do OSM
 * e o número de faixas a tag `lanes` (quando disponível).
 *
 * Capacidades estimadas (veículos/hora):
 *   - Via arterial (avenida):  800 veíc/h por faixa  -> 3 faixas = 2.400 veíc/h
 *   - Via coletora / local:    600 veíc/h por faixa
 *   - Acessos do estádio (s):  vazão estimada dos portões / estacionamentos
 */
(function (root) {
  'use strict';

  const PER_LANE = { arterial: 800, coletora: 600 };

  // id, rótulo curto, nome do cruzamento, latitude, longitude
  const nodes = [
    { id: 's', name: 'Estádio do Maracanã', desc: 'Origem — saída dos estacionamentos do estádio', lat: -22.91215, lon: -43.23020 },
    { id: 'A', name: 'Rei Pelé × Manoel de Abreu', desc: 'Praça em frente à UERJ', lat: -22.91052, lon: -43.23303 },
    { id: 'B', name: 'Av. Rei Pelé (Portão Bellini)', desc: 'Radial Oeste, lado leste do estádio', lat: -22.91032, lon: -43.23052 },
    { id: 'C', name: 'Manoel de Abreu × S. F. Xavier', desc: 'Encontro com o Boulevard 28 de Setembro', lat: -22.91389, lon: -43.23475 },
    { id: 'D', name: 'Av. Maracanã × Paula Sousa', desc: 'Com R. S. F. Xavier e R. Prof. Eurico Rabelo', lat: -22.91606, lon: -43.22930 },
    { id: 'E', name: 'S. F. Xavier × Gen. Canabarro', desc: 'Corredor sul do estádio', lat: -22.91640, lon: -43.22690 },
    { id: 'F', name: 'Complexo Oduvaldo Cozzi', desc: 'Rei Pelé × Av. Maracanã × Osvaldo Aranha × Teixeira Soares', lat: -22.91043, lon: -43.22386 },
    { id: 'G', name: 'S. F. Xavier × Mariz e Barros', desc: 'Com R. Almirante Cóchrane', lat: -22.91894, lon: -43.22386 },
    { id: 'H', name: 'Mariz e Barros × Prof. Gabizo', desc: 'Tijuca', lat: -22.91637, lon: -43.22210 },
    { id: 'I', name: 'Mariz e Barros × Campos Sales', desc: 'Com R. Afonso Pena e R. Ibituruna', lat: -22.91441, lon: -43.21919 },
    { id: 'J', name: 'Francisco Eugênio × José Eugênio', desc: 'Binário de acesso a São Cristóvão', lat: -22.90860, lon: -43.22061 },
    { id: 'K', name: 'R. Ceará × São Cristóvão', desc: 'Com R. Francisco Eugênio', lat: -22.90729, lon: -43.21796 },
    { id: 'M', name: 'Teixeira Soares × R. Pará', desc: 'Praça Alagoas', lat: -22.91094, lon: -43.21638 },
    { id: 'N', name: 'Mariz e Barros × Sen. Furtado', desc: 'Com R. Felisberto de Menezes', lat: -22.91347, lon: -43.21625 },
    { id: 'O', name: 'Gonçalves Crespo × Silva Ramos', desc: 'Tijuca', lat: -22.91671, lon: -43.21930 },
    { id: 'P', name: 'Heitor Beltrão × Prof. Gabizo', desc: 'Com R. Silva Ramos', lat: -22.91794, lon: -43.22000 },
    { id: 'U', name: 'R. Bartolomeu de Gusmão', desc: 'Acesso norte do estádio', lat: -22.90786, lon: -43.22981 },
    { id: 'R', name: 'Francisco Eugênio × Viaduto', desc: 'Viaduto Eng. Paulo de Souza Reis', lat: -22.90688, lon: -43.21349 },
    { id: 't', name: 'Praça da Bandeira', desc: 'Destino — acesso à Av. Presidente Vargas / Centro', lat: -22.91087, lon: -43.21225 },
    // --- cruzamentos adicionais (ampliação da rede) ---
    { id: 'V', name: 'Rei Pelé × Visconde de Niterói', desc: 'Radial Oeste, lado da Mangueira', lat: -22.90934, lon: -43.23753 },
    { id: 'W', name: 'Boulevard 28 de Setembro', desc: 'Entrada de Vila Isabel', lat: -22.91410, lon: -43.23759 },
    { id: 'X', name: 'R. Felipe Camarão', desc: 'Maracanã / Vila Isabel', lat: -22.91722, lon: -43.23494 },
    { id: 'Y', name: 'Av. Maracanã × Pç. Varnhagen', desc: 'Com R. Major Ávila', lat: -22.91954, lon: -43.23432 },
    { id: 'Z', name: 'Av. Maracanã (trecho sul)', desc: 'Entre Paula Sousa e Pç. Varnhagen', lat: -22.91803, lon: -43.23161 },
    { id: 'L', name: 'R. Bartolomeu de Gusmão (meio)', desc: 'Lado norte do estádio', lat: -22.90762, lon: -43.22854 },
    { id: 'Q', name: 'Viaduto × Av. Francisco Bicalho', desc: 'Viaduto Eng. Paulo de Souza Reis', lat: -22.90656, lon: -43.21030 },
    { id: 'HS', name: 'R. Haddock Lobo (sul)', desc: 'Tijuca', lat: -22.91993, lon: -43.21554 },
    { id: 'HN', name: 'R. Haddock Lobo (norte)', desc: 'Tijuca / Rio Comprido', lat: -22.91794, lon: -43.21185 },
    { id: 'PF', name: 'Paulo de Frontin × Haddock Lobo', desc: 'Rio Comprido', lat: -22.91685, lon: -43.21018 },
    { id: 'PJ', name: 'Paulo de Frontin × João Paulo I', desc: 'Chegada à Praça da Bandeira', lat: -22.91404, lon: -43.21012 },
  ];

  // [origem, destino, nome da rua, nº de faixas, tipo]  (tipo 'acesso' => capacidade fixa em `cap`)
  const raw = [
    ['s', 'A', 'Acesso oeste (UERJ)', 0, 'acesso', 2400],
    ['s', 'B', 'Acesso leste (Portão Bellini)', 0, 'acesso', 3200],
    ['s', 'C', 'Acesso sul (R. Prof. Eurico Rabelo)', 0, 'acesso', 1800],
    ['s', 'D', 'Acesso sudeste (Av. Maracanã)', 0, 'acesso', 2400],
    ['s', 'U', 'Acesso norte (estacionamento)', 0, 'acesso', 1200],
    ['A', 'B', 'Av. Rei Pelé (sentido Centro)', 4, 'arterial'],
    ['B', 'A', 'Av. Rei Pelé (sentido Mangueira)', 4, 'arterial'],
    ['B', 'F', 'Av. Rei Pelé (Viaduto Oduvaldo Cozzi)', 4, 'arterial'],
    ['C', 'A', 'Av. Prof. Manoel de Abreu', 3, 'arterial'],
    ['A', 'C', 'Av. Prof. Manoel de Abreu (retorno)', 4, 'arterial'],
    ['C', 'D', 'R. São Francisco Xavier', 3, 'arterial'],
    ['D', 'C', 'R. Prof. Eurico Rabelo', 3, 'coletora'],
    ['D', 'E', 'R. São Francisco Xavier (trecho sul)', 3, 'arterial'],
    ['D', 'F', 'Av. Paula Sousa', 3, 'coletora'],
    ['F', 'D', 'Av. Maracanã', 4, 'arterial'],
    ['F', 'E', 'R. General Canabarro', 2, 'coletora'],
    ['E', 'G', 'R. São Francisco Xavier (trecho leste)', 3, 'arterial'],
    ['G', 'P', 'R. Almirante Cóchrane', 2, 'coletora'],
    ['H', 'G', 'R. Mariz e Barros (sentido Tijuca)', 3, 'coletora'],
    ['P', 'H', 'R. Prof. Gabizo', 2, 'coletora'],
    ['H', 'F', 'R. Prof. Gabizo (trecho norte)', 2, 'coletora'],
    ['P', 'O', 'R. Silva Ramos', 2, 'coletora'],
    ['O', 'N', 'R. Gonçalves Crespo', 3, 'coletora'],
    ['O', 'I', 'R. Campos Sales', 3, 'coletora'],
    ['I', 'O', 'R. Afonso Pena', 2, 'coletora'],
    ['I', 'H', 'R. Mariz e Barros', 2, 'coletora'],
    ['I', 'F', 'R. Ibituruna', 2, 'coletora'],
    ['N', 'I', 'R. Mariz e Barros (trecho central)', 2, 'coletora'],
    ['N', 't', 'R. Mariz e Barros (chegada à Praça)', 2, 'coletora'],
    ['F', 'N', 'R. Senador Furtado', 1, 'coletora'],
    ['F', 'M', 'R. Teixeira Soares', 4, 'arterial'],
    ['M', 't', 'R. Teixeira Soares (chegada à Praça)', 4, 'arterial'],
    ['M', 'N', 'R. Pará', 1, 'coletora'],
    ['M', 'F', 'Av. Osvaldo Aranha (sentido Maracanã)', 4, 'arterial'],
    ['U', 'F', 'R. Bartolomeu de Gusmão', 3, 'coletora'],
    ['F', 'J', 'R. Francisco Eugênio', 2, 'arterial'],
    ['J', 'F', 'R. José Eugênio', 2, 'coletora'],
    ['J', 'K', 'R. Francisco Eugênio (trecho leste)', 2, 'coletora'],
    ['K', 'R', 'R. Francisco Eugênio (São Cristóvão)', 3, 'arterial'],
    ['R', 'Q', 'Viaduto Eng. Paulo de Souza Reis', 3, 'arterial'],
    ['Q', 't', 'Av. Francisco Bicalho', 3, 'arterial'],
    // --- ruas adicionais (ampliação da rede) ---
    ['A', 'V', 'Av. Rei Pelé (trecho oeste)', 4, 'arterial'],
    ['V', 'A', 'Av. Rei Pelé (trecho oeste, sentido Centro)', 4, 'arterial'],
    ['C', 'W', 'Boulevard 28 de Setembro', 2, 'arterial'],
    ['D', 'Z', 'Av. Maracanã (sentido Tijuca)', 3, 'arterial'],
    ['Z', 'Y', 'Av. Maracanã (trecho sul)', 3, 'arterial'],
    ['Y', 'X', 'R. Felipe Camarão', 2, 'coletora'],
    ['X', 'C', 'R. Felipe Camarão (trecho norte)', 2, 'coletora'],
    ['F', 'L', 'R. Bartolomeu de Gusmão (sentido Mangueira)', 2, 'coletora'],
    ['L', 'U', 'R. Bartolomeu de Gusmão (trecho oeste)', 1, 'coletora'],
    ['P', 'HS', 'R. Heitor Beltrão → Haddock Lobo', 2, 'coletora'],
    ['HS', 'HN', 'R. Haddock Lobo', 3, 'coletora'],
    ['HN', 'PF', 'R. Haddock Lobo (trecho norte)', 3, 'coletora'],
    ['PF', 'PJ', 'Av. Paulo de Frontin (sentido Praça)', 2, 'arterial'],
    ['PJ', 't', 'Av. Paulo de Frontin (chegada à Praça)', 2, 'arterial'],
  ];

  const index = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const edges = raw.map(([u, v, name, lanes, type, fixed], i) => ({
    id: i,
    u: index[u],
    v: index[v],
    name,
    lanes,
    type,
    cap: type === 'acesso' ? fixed : lanes * PER_LANE[type],
  }));

  const NETWORK = {
    title: 'Saída do Maracanã → Praça da Bandeira',
    city: 'Rio de Janeiro — RJ',
    nodes,
    edges,
    s: index.s,
    t: index.t,
    perLane: PER_LANE,
    // parâmetros do simulador de evacuação (editáveis na interface)
    evacuation: { attendance: 60000, carShare: 0.25, occupancy: 2.2 },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NETWORK;
  else root.NETWORK = NETWORK;
})(typeof window !== 'undefined' ? window : globalThis);
