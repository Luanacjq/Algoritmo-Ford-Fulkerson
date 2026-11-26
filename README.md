# Traffic Planning — Algoritmo de Ford-Fulkerson

Simulador de **fluxo máximo de veículos** na saída de um jogo no **Estádio do Maracanã** até a **Praça da Bandeira** (Rio de Janeiro), no horário de pico. A rede viária vira um grafo de fluxo G = (V, E), resolvido pelo **Método de Ford-Fulkerson implementado do zero**, com a rede residual mantida explicitamente.

> **Pergunta central:** qual o maior número de veículos que pode viajar da origem até o destino em uma hora, respeitando a capacidade das vias e a conservação de fluxo nos cruzamentos?
>
> **Resposta (rede original): 6.200 veículos/hora.**

## Apresentação

📊 Slides: https://canva.link/7mnu59sz7kvrxcq

## Como executar

Basta **abrir o `index.html` no navegador** (Chrome, Edge ou Firefox). Não precisa instalar nada.
O fundo do mapa (Esri Light Gray, um mapa cinza-claro minimalista) precisa de internet; sem conexão o simulador funciona, só que sem o mapa de fundo.

Testes do algoritmo (Node.js):

```bash
node tests/test.js
```

## Como usar

A interface parece um app de mapa: há um painel à esquerda com 4 abas e um contador de carros/hora na parte de baixo.

| Aba | O que acontece ao apertar ▶ |
|---|---|
| 🚦 **Normal** | O algoritmo traça, um por um, os caminhos aumentantes (linha azul), mostra o gargalo de cada um e solta os carros. No fim mostra o fluxo máximo, as ruas no limite e o corte mínimo. |
| 🚧 **Interdição** (Cenário A) | **Você escolhe** as ruas tocando nelas no mapa: *interditada* (c = 0) ou *faixa bloqueada* (−50%). O ▶ fecha as ruas, mostra "Recalculando rotas…" e exibe a perda percentual. |
| 🏗️ **Obra** (Cenário B) | Testa +X carros/h em cada rua saturada (uma de cada vez, no mapa) e recomenda a obra de maior ganho real. |
| ➕ **Mais** | Tempo para esvaziar o estádio, ruas mais críticas, explicação do algoritmo e download do relatório. |

As cores das ruas seguem o padrão de trânsito dos apps de mapa: verde = livre, laranja = lento, vermelho = no limite, cinza = sem uso.

## Estrutura

| Arquivo | Conteúdo |
|---|---|
| `js/fordFulkerson.js` | **Núcleo algorítmico**: rede residual explícita + Ford-Fulkerson (BFS/Edmonds-Karp ou DFS) |
| `js/network.js` | Modelagem do recorte real: cruzamentos (lat/lon do OSM), ruas, sentidos e capacidades |
| `js/geometry.js` | Traçado real de cada rua (pontos do OSM), só para o desenho no mapa |
| `js/analysis.js` | Gargalos, corte mínimo, Cenários A e B, criticidade e evacuação |
| `js/app.js` | Interface: mapa, animações e painel |
| `css/style.css` | Visual |
| `vendor/leaflet/` | Biblioteca de mapa Leaflet 1.9.4 (usada **só para exibir o mapa**, não no cálculo) |
| `tests/test.js` | Testes (exemplo do CLRS, arestas antiparalelas, cancelamento de fluxo, rede real) |

## 1. Modelagem e núcleo algorítmico

### Recorte real
- **28 cruzamentos + origem `s` (Maracanã) + destino `t` (Praça da Bandeira) = 30 vértices e 55 ruas orientadas.** O enunciado pede no mínimo 15 a 20.
- As coordenadas dos cruzamentos e o traçado das ruas vêm do **OpenStreetMap** (Overpass API). Os sentidos de mão única seguem a tag `oneway` e o número de faixas a tag `lanes`. Uma avenida de mão dupla vira **dois arcos antiparalelos**.

### Capacidades estimadas
| Tipo de via | veíc/h por faixa | Exemplo |
|---|---:|---|
| Arterial (avenida) | 800 | 3 faixas = 2.400 veíc/h |
| Coletora / local | 600 | 1 faixa = 600 veíc/h |
| Acessos do estádio (saindo de `s`) | — | vazão estimada dos portões/estacionamentos |

### Implementação (sem bibliotecas de grafos)
A rede residual G_f é uma lista de arcos. Para cada rua (u,v):

- arco `2k`: u → v com **c_f(u,v) = c(u,v) − f(u,v)**
- arco `2k+1`: v → u (reverso) com **c_f(v,u) = f(u,v)**

O par de um arco `i` é `i ^ 1`, então cada aumento de fluxo custa O(1) por arco. A busca do caminho aumentante pode ser **BFS (Edmonds-Karp, O(V·E²))** ou **DFS (O(E·|f*|))**.

```
1  para cada (u,v) ∈ E:  f(u,v) ← 0
2  enquanto ∃ caminho p de s a t em G_f:
3      c_f(p) ← min{ c_f(u,v) : (u,v) ∈ p }
4      para cada (u,v) ∈ p:
5          se (u,v) ∈ E:  f(u,v) ← f(u,v) + c_f(p)
6          senão:         f(v,u) ← f(v,u) − c_f(p)
7  retorne f
```

## 2. Diagnóstico de gargalos

Depois do cálculo, o programa lista **todas as ruas com c_f(u,v) = 0**. São **10 ruas no limite**. Dessas, 4 formam o **corte mínimo**, que é o gargalo real:

| Rua do corte mínimo | Capacidade |
|---|---:|
| R. Almirante Cóchrane | 1.200 |
| R. Senador Furtado | 600 |
| R. Teixeira Soares | 3.200 |
| R. Francisco Eugênio (trecho leste) | 1.200 |
| **Total = fluxo máximo** | **6.200** ✓ |

O programa também verifica a restrição de capacidade e a conservação de fluxo em todos os cruzamentos.

## 3. Simulador "E se?"

- **Cenário A:** o usuário escolhe no mapa as ruas interditadas ou com faixa bloqueada; o sistema não escolhe nada. Exemplo: interditar a R. Teixeira Soares derruba o fluxo de 6.200 para 3.000 veíc/h (**−51,6%**).
- **Cenário B:** com X = 600, a obra recomendada é **alargar a R. Almirante Cóchrane (+600 veíc/h, +9,7%)**. **6 das 10 ruas saturadas não trazem ganho nenhum** quando alargadas, porque o tráfego extra esbarra em outro gargalo.

## ✨ Extras
- Mapa no estilo dos apps de navegação, com zoom suave e ruas coloridas por nível de trânsito seguindo o traçado real.
- Animações: carrinhos andando (mais lentos nas ruas no limite), linha azul percorrendo cada caminho, balões de alerta, pinos que caem, aviso "Recalculando rotas…" e contador animado.
- Botão ▶ em cada cenário, ⏭ para pular a animação e velocidade de ½× a 4×. Atalho: `Espaço`.
- Corte mínimo destacado no mapa (✂️).
- Sinergia: o melhor **par** de obras, para o caso de haver orçamento para duas.
- Ranking das ruas mais críticas.
- Tempo para esvaziar o estádio: cerca de 1h06min com 60 mil torcedores.
- Comparação BFS × DFS.
- Relatório `.md` para baixar.

---
Mapa de fundo © Esri, HERE, Garmin. Dados viários © colaboradores do [OpenStreetMap](https://www.openstreetmap.org/copyright) (ODbL). Leaflet © Vladimir Agafonkin (BSD-2).
