/* Interface — Traffic Planning (Ford-Fulkerson) — mapa estilo Google Maps + animações estilo Waze */
(function () {
  'use strict';
  const NET = window.NETWORK;
  const A = window.Analysis;
  const GEO = window.GEOMETRY || {};
  const SVGNS = 'http://www.w3.org/2000/svg';

  // ------------------------------------------------------------------ utilidades
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const nf = new Intl.NumberFormat('pt-BR');
  const fmt = (x) => nf.format(Math.round(x));
  const pct = (x, d = 1) => `${x.toFixed(d).replace('.', ',')}%`;
  const svgEl = (tag, attrs = {}, parent) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  const fmtTime = (min) => {
    if (!isFinite(min)) return '∞';
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`;
  };
  const street = (id) => NET.edges[id].name;
  const nodeName = (i) => NET.nodes[i].name;
  const isMobile = () => window.innerWidth <= 820;

  // ------------------------------------------------------------------ estado
  const baseCaps = NET.edges.map((e) => e.cap);
  const BASE = A.solve(NET, baseCaps, { record: true });
  const zeros = () => NET.edges.map(() => 0);
  const state = {
    tab: 'normal',
    caps: baseCaps.slice(),
    display: zeros(),
    closures: new Map(), // edgeId -> 'close' | 'half'
    expansion: null, // { edgeId, X }
    normalDone: false,
    resA: null,
    resB: null,
    cut: false,
    busy: false,
    speed: 1,
    evac: { ...NET.evacuation },
  };
  let token = 0;
  const CANCEL = Symbol('cancel');
  const sleep = (ms, tk) => new Promise((res, rej) => setTimeout(() => (tk !== token ? rej(CANCEL) : res()), ms / state.speed));

  // ------------------------------------------------------------------ mapa base
  const map = L.map('map', { zoomControl: false, minZoom: 13.5, maxZoom: 18.5, zoomSnap: 0.25, zoomDelta: 0.5 });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // mapa de fundo minimalista (cinza-claro, sem ícones) + camada só com os nomes das ruas
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  L.tileLayer(`${ESRI}World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, {
    maxNativeZoom: 16, maxZoom: 19,
    attribution: 'Mapa © Esri, HERE, Garmin, © colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  map.createPane('labels');
  map.getPane('labels').style.zIndex = 450; // nomes das ruas por cima das linhas coloridas
  map.getPane('labels').style.pointerEvents = 'none';
  L.tileLayer(`${ESRI}World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, { pane: 'labels', maxNativeZoom: 16, maxZoom: 19, opacity: 0.85 }).addTo(map);
  let dragging = false;
  map.on('dragstart', () => { dragging = true; hideTip(); });
  map.on('dragend', () => setTimeout(() => (dragging = false), 60));

  // projeção Web Mercator em "pixels do zoom 16" — o SVG inteiro usa essas coordenadas
  const Z = 16, WORLD = 256 * 2 ** Z;
  const project = (lat, lon) => {
    const s = Math.sin((lat * Math.PI) / 180);
    return [((lon + 180) / 360) * WORLD, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD];
  };
  const unproject = (x, y) => {
    const lon = (x / WORLD) * 360 - 180;
    const n = Math.PI - (2 * Math.PI * y) / WORLD;
    return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon];
  };
  const keyOf = (e) => `${NET.nodes[e.u].id}>${NET.nodes[e.v].id}`;
  const latlngs = NET.edges.map((e) => GEO[keyOf(e)] || [[NET.nodes[e.u].lat, NET.nodes[e.u].lon], [NET.nodes[e.v].lat, NET.nodes[e.v].lon]]);
  const allPts = latlngs.flat();
  const PADD = 0.006;
  const minLat = Math.min(...allPts.map((p) => p[0])) - PADD, maxLat = Math.max(...allPts.map((p) => p[0])) + PADD;
  const minLon = Math.min(...allPts.map((p) => p[1])) - PADD, maxLon = Math.max(...allPts.map((p) => p[1])) + PADD;
  const NW = project(maxLat, minLon), SE = project(minLat, maxLon);
  const W = SE[0] - NW[0], H = SE[1] - NW[1];
  const local = (lat, lon) => { const p = project(lat, lon); return [p[0] - NW[0], p[1] - NW[1]]; };
  const toLatLng = (x, y) => unproject(x + NW[0], y + NW[1]);

  const svg = svgEl('svg', { id: 'net', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });
  const gEdges = svgEl('g', {}, svg);
  const gRoute = svgEl('g', {}, svg);
  const gCars = svgEl('g', {}, svg);
  const gNodes = svgEl('g', {}, svg);
  L.svgOverlay(svg, [[minLat, minLon], [maxLat, maxLon]], { interactive: false }).addTo(map);

  const NETBOUNDS = L.latLngBounds(allPts);
  function fit(animate = false) {
    const opts = isMobile()
      ? { paddingTopLeft: [16, 80], paddingBottomRight: [16, window.innerHeight * 0.54], animate }
      : { paddingTopLeft: [420, 30], paddingBottomRight: [30, 110], animate };
    map.fitBounds(NETBOUNDS, opts);
  }

  // ------------------------------------------------------------------ geometria das ruas
  const pairs = new Set(NET.edges.map((e) => `${e.u}-${e.v}`));
  const basePts = latlngs.map((ll) => ll.map(([la, lo]) => local(la, lo)));
  const geo = []; // por aresta: { pts, cum, len }
  let K = 1; // fator: unidades do SVG por pixel de tela

  function offsetLine(pts, d) {
    if (!d) return pts.map((p) => p.slice());
    const n = pts.length;
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const L0 = Math.hypot(dx, dy) || 1;
      dx /= L0; dy /= L0;
      return [p[0] - dy * d, p[1] + dx * d]; // normal à direita do sentido
    });
  }
  function measure(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] || 1 };
  }
  function pointAt(g, d) {
    d = Math.max(0, Math.min(g.len, d));
    let i = 1;
    while (i < g.cum.length - 1 && g.cum[i] < d) i++;
    const seg = g.cum[i] - g.cum[i - 1] || 1;
    const t = (d - g.cum[i - 1]) / seg;
    const a = g.pts[i - 1], b = g.pts[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }
  const dPath = (pts) => 'M' + pts.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L');
  const midLatLng = (id) => { const p = pointAt(geo[id], geo[id].len / 2); return toLatLng(p[0], p[1]); };

  // ------------------------------------------------------------------ desenho
  const edgeEls = [];
  const nodeEls = [];
  function buildNetwork() {
    NET.edges.forEach((e, i) => {
      const g = svgEl('g', { class: `edge${e.type === 'acesso' ? ' access' : ''}`, 'data-id': i }, gEdges);
      const w = e.type === 'acesso' ? 3 : 3 + e.cap / 1100;
      const casing = svgEl('path', { class: 'casing', 'stroke-width': w + 3 }, g);
      const line = svgEl('path', { class: 'line', 'stroke-width': w, stroke: '#7d8fa3' }, g);
      const arrow = svgEl('polygon', { class: 'arrow', points: '-3.5,-3.2 4,0 -3.5,3.2', fill: '#5f6f82' }, g);
      const hit = svgEl('path', { class: 'hit' }, g);
      edgeEls[i] = { g, casing, line, arrow, hit, w };
    });
    NET.nodes.forEach((n, i) => {
      if (i === NET.s || i === NET.t) return;
      const [x, y] = local(n.lat, n.lon);
      const g = svgEl('g', { class: 'node', 'data-id': i }, gNodes);
      const c = svgEl('circle', { cx: x, cy: y, r: 4, fill: '#fff', stroke: '#6b7c8f', 'stroke-width': 1.5 }, g);
      c.style.pointerEvents = 'all';
      c.style.cursor = 'help';
      nodeEls[i] = c;
    });
  }
  function relayout() {
    K = 2 ** (Z - map.getZoom());
    svg.classList.toggle('z-low', map.getZoom() < 15.5); // afastado: esconde detalhes miúdos
    NET.edges.forEach((e, i) => {
      const off = pairs.has(`${e.v}-${e.u}`) ? 3.4 * K : 0;
      geo[i] = measure(offsetLine(basePts[i], off));
      const d = dPath(geo[i].pts);
      const el = edgeEls[i];
      el.casing.setAttribute('d', d);
      el.line.setAttribute('d', d);
      el.hit.setAttribute('d', d);
      const [x, y, a] = pointAt(geo[i], geo[i].len * 0.55);
      el.arrow.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((a * 180) / Math.PI).toFixed(0)}) scale(${K})`);
    });
    nodeEls.forEach((c) => c && c.setAttribute('r', 3.6 * K));
    rebuildCars();
    redrawRoute();
  }
  map.on('zoomend', relayout);

  const anyFlow = () => state.display.some((f) => f > 0);
  function trafficColor(f, c) {
    if (c <= 0) return '#5f6368';
    if (f <= 0) return anyFlow() ? '#b0b8c1' : '#7d8fa3';
    const u = f / c;
    return u >= 0.999 ? '#d93025' : u >= 0.5 ? '#f29900' : '#1ea362';
  }
  function renderEdges() {
    const showClosures = state.tab === 'a';
    const flowing = anyFlow();
    NET.edges.forEach((e, i) => {
      const el = edgeEls[i];
      const c = state.caps[i], f = state.display[i];
      const col = trafficColor(f, c);
      el.line.setAttribute('stroke', col);
      el.arrow.setAttribute('fill', f > 0 ? col : '#5f6f82');
      el.g.classList.toggle('idle', flowing && f <= 0);
      el.g.classList.toggle('jam', c > 0 && f >= c && f > 0);
      const cl = showClosures ? state.closures.get(i) : null;
      el.g.classList.toggle('closed', cl === 'close');
      el.g.classList.toggle('half', cl === 'half');
      const inCut = state.cut && BASE.minCut.includes(i);
      el.g.classList.toggle('cut', inCut);
      el.g.classList.toggle('dim', state.cut && !inCut);
    });
    rebuildCars();
  }

  // ------------------------------------------------------------------ carros animados
  const PALETTE = ['#33ccff', '#ff6b6b', '#ffd93d', '#6bcb77', '#b388ff', '#ff9f43', '#ffffff', '#4d96ff'];
  let cars = [];
  function makeCar() {
    const g = svgEl('g', { class: 'car' }, gCars);
    const body = svgEl('rect', { x: -5.5, y: -3, width: 11, height: 6, rx: 2.4, class: 'car-body' }, g);
    svgEl('rect', { x: 0.8, y: -2.2, width: 2.4, height: 4.4, rx: 0.8, fill: 'rgba(30,40,60,.55)' }, g);
    return { g, body };
  }
  function rebuildCars() {
    const want = [];
    NET.edges.forEach((e, i) => {
      const f = state.display[i];
      if (f <= 0 || state.caps[i] <= 0) return;
      const n = Math.max(1, Math.round(f / 520));
      const u = Math.min(1, f / state.caps[i]);
      for (let k = 0; k < n; k++) want.push({ edge: i, phase: (k + Math.random() * 0.3) / n, u });
    });
    while (cars.length < want.length) cars.push(makeCar());
    cars.forEach((c, k) => {
      const w = want[k];
      if (!w) { c.g.style.display = 'none'; c.edge = -1; return; }
      c.g.style.display = '';
      if (c.edge !== w.edge) c.body.setAttribute('fill', PALETTE[(k * 7 + w.edge) % PALETTE.length]);
      Object.assign(c, w);
      c.speed = 34 * (1.15 - 0.8 * w.u); // pixels de tela por segundo — rua no limite = trânsito lento
    });
  }
  let last = performance.now(), clock = 0;
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    clock += dt;
    for (const c of cars) {
      if (c.edge === undefined || c.edge < 0) continue;
      const g = geo[c.edge];
      const d = (c.phase * g.len + clock * c.speed * K) % g.len;
      const [x, y, a] = pointAt(g, d);
      c.g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${((a * 180) / Math.PI).toFixed(0)}) scale(${K})`);
    }
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------------ marcadores (pinos e balões)
  const pinSvg = (color, emoji) => `<div class="pin"><svg width="36" height="46" viewBox="0 0 36 46"><path d="M18 45C18 45 3 28 3 17a15 15 0 0 1 30 0c0 11-15 28-15 28z" fill="${color}" stroke="#fff" stroke-width="2.5"/><circle cx="18" cy="17" r="10" fill="#fff"/></svg><span class="pe">${emoji}</span></div>`;
  const htmlMarker = (latlng, html, z = 500) => L.marker(latlng, { icon: L.divIcon({ className: 'pin-wrap', html, iconSize: [0, 0] }), interactive: false, zIndexOffset: z }).addTo(map);
  const S = NET.nodes[NET.s], T = NET.nodes[NET.t];
  htmlMarker([S.lat, S.lon], '<div class="youare"></div><div class="place-label">Estádio do Maracanã</div>', 900);
  htmlMarker([T.lat, T.lon], `${pinSvg('#d93025', '🏁')}<div class="place-label t">Praça da Bandeira</div>`, 900);

  const bubbles = new Set();
  function bubble(latlng, html, cls = '', ms = 1600) {
    const m = htmlMarker(latlng, `<div class="bubble ${cls}">${html}</div>`, 1000);
    bubbles.add(m);
    if (ms) setTimeout(() => removeBubble(m), ms / Math.max(0.5, state.speed));
    return m;
  }
  function removeBubble(m) {
    if (!bubbles.has(m)) return;
    bubbles.delete(m);
    const el = m.getElement() && m.getElement().querySelector('.bubble');
    if (el) el.classList.add('out');
    setTimeout(() => map.removeLayer(m), 350);
  }
  function clearBubbles() { [...bubbles].forEach((m) => { bubbles.delete(m); map.removeLayer(m); }); }
  function poof(latlng) {
    const m = htmlMarker(latlng, '<div class="poof">💨</div>', 1000);
    setTimeout(() => map.removeLayer(m), 850);
  }

  // pinos das interdições e da obra
  const closurePins = new Map();
  function syncClosurePins() {
    closurePins.forEach((m) => map.removeLayer(m));
    closurePins.clear();
    if (state.tab !== 'a') return;
    state.closures.forEach((kind, id) => closurePins.set(id, htmlMarker(midLatLng(id), pinSvg(kind === 'close' ? '#d93025' : '#f29900', kind === 'close' ? '⛔' : '🚧'), 800)));
  }
  let obraPin = null;
  function syncObraPin() {
    if (obraPin) { map.removeLayer(obraPin); obraPin = null; }
    if (state.tab === 'b' && state.expansion) obraPin = htmlMarker(midLatLng(state.expansion.edgeId), pinSvg('#1ea362', '🏗️'), 800);
  }

  // ------------------------------------------------------------------ rota (caminho aumentante)
  let routeState = null; // { pts, progress, rev }
  let routeEls = null;
  function routePoints(step) {
    const pts = [];
    step.path.forEach((p) => {
      const g = geo[p.edge].pts;
      pts.push(...(p.forward ? g : g.slice().reverse()));
    });
    return pts;
  }
  function redrawRoute() {
    if (!routeState) return;
    if (!routeEls) {
      routeEls = {
        casing: svgEl('path', { class: 'route-casing', 'stroke-width': 10 }, gRoute),
        line: svgEl('path', { class: 'route', 'stroke-width': 6 }, gRoute),
        head: svgEl('circle', { class: 'head' }, gRoute),
      };
    }
    const m = measure(routeState.pts);
    const upto = m.len * routeState.progress;
    const pts = [];
    for (let i = 0; i < m.pts.length && m.cum[i] <= upto; i++) pts.push(m.pts[i]);
    const [hx, hy] = pointAt(m, upto);
    pts.push([hx, hy]);
    const d = dPath(pts);
    routeEls.casing.setAttribute('d', d);
    routeEls.line.setAttribute('d', d);
    routeEls.head.setAttribute('cx', hx);
    routeEls.head.setAttribute('cy', hy);
    routeEls.head.setAttribute('r', 7 * K);
    routeEls.line.classList.toggle('rev', !!routeState.rev);
  }
  function clearRoute() {
    routeState = null;
    if (routeEls) { Object.values(routeEls).forEach((e) => e.remove()); routeEls = null; }
  }
  function drawRoute(step, tk) {
    // os pontos são recalculados a cada quadro: assim a rota acompanha o zoom
    const total = measure(routePoints(step)).len / K;
    const dur = Math.max(900, (total / 520) * 1000) / state.speed;
    routeState = { pts: routePoints(step), progress: 0, rev: step.path.some((p) => !p.forward) };
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const frame = (now) => {
        if (tk !== token) { reject(CANCEL); return; }
        const k = Math.min(1, (now - t0) / dur);
        routeState.pts = routePoints(step);
        routeState.progress = 1 - Math.pow(1 - k, 2);
        redrawRoute();
        if (k < 1) requestAnimationFrame(frame); else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  // ------------------------------------------------------------------ contador e barra inferior
  let counterRaf;
  function setCounter(to, dur = 700) {
    const el = $('#sb-flow');
    const from = parseFloat(el.dataset.v || '0');
    el.dataset.v = to;
    cancelAnimationFrame(counterRaf);
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) counterRaf = requestAnimationFrame(step);
    };
    counterRaf = requestAnimationFrame(step);
  }
  const intoT = (flows) => NET.edges.reduce((a, e, i) => a + (e.v === NET.t ? flows[i] : 0), 0);
  const status = (txt) => { $('#sb-text').textContent = txt; };

  function setBusy(on, btn) {
    state.busy = on;
    $('#statusbar').classList.toggle('busy', on);
    $('#btn-skip').classList.toggle('hidden', !on);
    $$('.play').forEach((b) => b.classList.remove('running'));
    if (on && btn) btn.classList.add('running');
    $('#tabs').style.pointerEvents = on ? 'none' : '';
    $('#tabs').style.opacity = on ? 0.6 : 1;
  }
  let skipFn = null;
  function stopAnimation() {
    token++;
    clearRoute();
    clearBubbles();
    $$('.edge.testing').forEach((g) => g.classList.remove('testing'));
    setBusy(false);
    const r = $('.recalc'); if (r) r.remove();
  }

  // ------------------------------------------------------------------ CENÁRIO NORMAL
  async function playNormal() {
    if (state.busy) return;
    stopAnimation();
    state.cut = false;
    const tk = ++token;
    setBusy(true, $('#play-normal'));
    skipFn = finishNormal;
    state.caps = baseCaps.slice();
    state.display = zeros();
    renderEdges();
    setCounter(0, 300);
    $('#res-normal').innerHTML = '';
    status('procurando caminhos livres…');
    try {
      await sleep(400, tk);
      for (let i = 0; i < BASE.steps.length; i++) {
        const st = BASE.steps[i];
        status(`caminho ${i + 1}: traçando rota de s até t…`);
        await drawRoute(st, tk);
        const prev = i ? BASE.steps[i - 1].flows : zeros();
        const bn = st.path.find((p) => (p.forward ? baseCaps[p.edge] - prev[p.edge] : prev[p.edge]) === st.bottleneck);
        bubble(midLatLng(bn.edge), `⚠️ Gargalo: ${street(bn.edge)} · cabem +${fmt(st.bottleneck)}`, 'warn', 1700);
        status(`caminho ${i + 1}: +${fmt(st.bottleneck)} carros/h`);
        await sleep(900, tk);
        state.display = st.flows.slice();
        renderEdges();
        setCounter(st.total);
        await sleep(500, tk);
        clearRoute();
      }
      finishNormal();
      bubble([T.lat, T.lon], `🏁 ${fmt(BASE.maxFlow)} carros/h`, 'good', 3000);
    } catch (e) { if (e !== CANCEL) throw e; }
  }
  function finishNormal() {
    stopAnimation();
    state.caps = baseCaps.slice();
    state.display = BASE.flows.slice();
    state.normalDone = true;
    renderEdges();
    setCounter(BASE.maxFlow);
    status('chegando à Praça da Bandeira (máximo)');
    renderResNormal();
  }
  function renderResNormal() {
    const r = BASE;
    const sat = r.saturated.slice().sort((a, b) => r.minCut.includes(b) - r.minCut.includes(a));
    $('#res-normal').innerHTML = `<div class="result">
      <div class="big"><div class="k">Fluxo máximo</div><div class="v">${fmt(r.maxFlow)}</div><div class="u">carros por hora</div></div>
      <div class="explain">O algoritmo achou <b>${r.iterations} caminhos</b>. Depois disso não existe mais nenhum caminho com espaço livre do estádio até a praça, então <b>esse é o máximo</b>.</div>
      <div class="sec">🔴 Ruas no limite (${sat.length})</div>
      <div class="list">${sat.map((id, k) => `
        <div class="item" data-id="${id}" style="animation-delay:${k * 0.04}s"><div class="ic">${r.minCut.includes(id) ? '✂️' : '🔴'}</div>
        <div class="tx"><b>${street(id)}</b><small>${fmt(r.flows[id])} de ${fmt(baseCaps[id])} carros/h${r.minCut.includes(id) ? ' · <b style="display:inline;color:#8e24aa">gargalo real</b>' : ''}</small></div></div>`).join('')}</div>
      <button class="btn small" id="btn-cut" style="margin-top:10px">✂️ ${state.cut ? 'Esconder' : 'Mostrar'} o gargalo real no mapa</button>
      <div class="explain">Das ${sat.length} ruas no limite, só <b>${r.minCut.length}</b> (✂️) travam o total: elas formam o <b>corte mínimo</b>. Somando a capacidade delas: ${r.minCut.map((id) => fmt(baseCaps[id])).join(' + ')} = <b>${fmt(r.cutCapacity)}</b>, exatamente o fluxo máximo. Isso <b>prova</b> que não dá para passar mais carros.</div>
      <details class="more"><summary>Ver os ${r.iterations} caminhos encontrados</summary><div class="list">${r.steps.map((st, i) => {
        const prev = i ? r.steps[i - 1].flows : zeros();
        const bn = st.path.find((p) => (p.forward ? baseCaps[p.edge] - prev[p.edge] : prev[p.edge]) === st.bottleneck);
        return `<div class="item replay" data-i="${i}"><div class="ic">${i + 1}</div><div class="tx"><b>Gargalo: ${street(bn.edge)}</b><small>${st.path.length} ruas${st.path.some((p) => !p.forward) ? ' · desfaz fluxo de outra rota' : ''}</small></div><div class="val g">+${fmt(st.bottleneck)}</div></div>`;
      }).join('')}</div></details>
    </div>`;
    $$('#res-normal .item[data-id]').forEach((it) => (it.onclick = () => focusEdge(+it.dataset.id)));
    $$('#res-normal .replay').forEach((it) => (it.onclick = () => showRoute(BASE.steps[+it.dataset.i])));
    $('#btn-cut').onclick = () => { state.cut = !state.cut; renderEdges(); renderResNormal(); if (state.cut) cutBubbles(); else clearBubbles(); };
  }
  function cutBubbles() {
    clearBubbles();
    BASE.minCut.forEach((id) => bubble(midLatLng(id), `✂️ ${fmt(baseCaps[id])}`, 'purple', 0));
  }
  async function showRoute(step) {
    if (state.busy) return;
    const tk = ++token;
    try {
      await drawRoute(step, tk);
      await sleep(1400, tk);
      clearRoute();
    } catch (e) { if (e !== CANCEL) throw e; }
  }

  // ------------------------------------------------------------------ CENÁRIO A — interdição escolhida pela pessoa
  function chooseClosure(id, latlng) {
    const cur = state.closures.get(id);
    const html = `<div class="choose"><h4>${street(id)}</h4><p>${nodeName(NET.edges[id].u)} → ${nodeName(NET.edges[id].v)} · ${fmt(baseCaps[id])} carros/h</p>
      <div class="opts">
        <button data-k="close">⛔ Interditada<small>a rua fecha totalmente (capacidade 0)</small></button>
        <button data-k="half">🚧 Uma faixa bloqueada<small>capacidade cai 50% (${fmt(Math.floor(baseCaps[id] / 2))} carros/h)</small></button>
        ${cur ? '<button data-k="rm" class="rm">✕ Liberar esta rua</button>' : ''}
      </div></div>`;
    const pop = L.popup({ closeButton: false, offset: [0, -4], minWidth: 230 }).setLatLng(latlng).setContent(html).openOn(map);
    $$('.choose button', pop.getElement()).forEach((b) => (b.onclick = () => {
      map.closePopup();
      if (b.dataset.k === 'rm') state.closures.delete(id); else state.closures.set(id, b.dataset.k);
      state.resA = null;
      $('#res-a').innerHTML = '';
      state.caps = baseCaps.slice();
      state.display = BASE.flows.slice();
      setCounter(BASE.maxFlow);
      renderEdges();
      syncClosurePins();
      renderClosures();
    }));
  }
  function renderClosures() {
    const box = $('#closures');
    if (!state.closures.size) {
      box.innerHTML = '<div class="empty"><b>👆</b>Nenhuma rua escolhida ainda.<br>Toque numa rua do mapa.</div>';
      return;
    }
    box.innerHTML = `<div class="sec" style="margin-top:0">Ruas escolhidas</div><div class="list" style="margin-bottom:14px">${[...state.closures].map(([id, k]) => `
      <div class="item" data-id="${id}"><div class="ic">${k === 'close' ? '⛔' : '🚧'}</div>
      <div class="tx"><b>${street(id)}</b><small>${k === 'close' ? 'interditada' : 'uma faixa bloqueada (−50%)'}</small></div>
      <button class="x" data-rm="${id}" title="Remover">✕</button></div>`).join('')}</div>`;
    $$('#closures .item').forEach((it) => (it.onclick = (ev) => {
      if (ev.target.dataset.rm) {
        state.closures.delete(+ev.target.dataset.rm);
        state.resA = null;
        $('#res-a').innerHTML = '';
        state.caps = baseCaps.slice();
        state.display = BASE.flows.slice();
        setCounter(BASE.maxFlow);
        renderEdges(); syncClosurePins(); renderClosures();
      } else focusEdge(+it.dataset.id);
    }));
  }
  const capsWithClosures = () => {
    const c = baseCaps.slice();
    state.closures.forEach((k, id) => (c[id] = k === 'close' ? 0 : Math.floor(baseCaps[id] * 0.5)));
    return c;
  };
  async function playA() {
    if (state.busy) return;
    if (!state.closures.size) {
      const b = $('#play-a'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      toast('👆 Primeiro toque numa rua do mapa para interditar');
      return;
    }
    stopAnimation();
    const tk = ++token;
    setBusy(true, $('#play-a'));
    skipFn = finishA;
    $('#res-a').innerHTML = '';
    state.caps = baseCaps.slice();
    state.display = BASE.flows.slice();
    renderEdges();
    setCounter(BASE.maxFlow, 300);
    status('trânsito normal…');
    try {
      await sleep(900, tk);
      for (const [id, k] of state.closures) {
        bubble(midLatLng(id), k === 'close' ? '⛔ Rua interditada!' : '🚧 Faixa bloqueada!', 'bad', 1800);
        if (k === 'close') poof(midLatLng(id));
        state.caps[id] = k === 'close' ? 0 : Math.floor(baseCaps[id] * 0.5);
        state.display[id] = Math.min(state.display[id], state.caps[id]);
        renderEdges();
        await sleep(700, tk);
      }
      status('recalculando rotas…');
      const rc = document.createElement('div');
      rc.className = 'recalc';
      rc.innerHTML = '<i></i>Recalculando rotas…';
      document.body.appendChild(rc);
      await sleep(1500, tk);
      rc.remove();
      finishA();
    } catch (e) { if (e !== CANCEL) throw e; }
  }
  function finishA() {
    stopAnimation();
    const caps = capsWithClosures();
    const r = A.solve(NET, caps);
    const loss = BASE.maxFlow - r.maxFlow;
    const lossPct = (100 * loss) / BASE.maxFlow;
    state.resA = { r, loss, lossPct, caps };
    state.caps = caps;
    state.display = r.flows.slice();
    renderEdges();
    setCounter(r.maxFlow);
    status(loss > 0 ? `perda de ${pct(lossPct)} no escoamento` : 'sem perda — o trânsito desviou');
    bubble([T.lat, T.lon], loss > 0 ? `📉 −${pct(lossPct)}` : '✅ sem perda', loss > 0 ? 'bad' : 'good', 3500);
    const newSat = r.saturated.filter((id) => !BASE.saturated.includes(id) && !state.closures.has(id));
    newSat.slice(0, 3).forEach((id) => bubble(midLatLng(id), '🔴 novo gargalo', 'bad', 3500));
    $('#res-a').innerHTML = `<div class="result">
      <div class="big ${loss > 0 ? 'bad' : 'good'}"><div class="k">${loss > 0 ? 'Perda de escoamento' : 'Sem perda'}</div>
      <div class="v">${loss > 0 ? '−' + pct(lossPct) : '0%'}</div>
      <div class="vs"><s>${fmt(BASE.maxFlow)}</s> → <span>${fmt(r.maxFlow)} carros/h</span></div></div>
      <div class="explain">${loss > 0
        ? `Com ${state.closures.size > 1 ? 'essas interdições' : 'essa interdição'}, <b>${fmt(loss)} carros/h a menos</b> conseguem sair. O trânsito tenta desviar, mas as outras ruas não têm espaço suficiente.`
        : 'O trânsito encontrou <b>rotas alternativas</b> com folga, então o total não muda. Essa rua não é crítica.'}</div>
      ${newSat.length ? `<div class="sec">🔴 Ruas que passaram a ficar no limite</div><div class="list">${newSat.map((id) => `<div class="item" data-id="${id}"><div class="ic">🔴</div><div class="tx"><b>${street(id)}</b><small>${fmt(r.flows[id])} de ${fmt(caps[id])} carros/h</small></div></div>`).join('')}</div>` : ''}
    </div>`;
    $$('#res-a .item[data-id]').forEach((it) => (it.onclick = () => focusEdge(+it.dataset.id)));
    renderEvac();
  }

  // ------------------------------------------------------------------ CENÁRIO B — obra
  async function playB() {
    if (state.busy) return;
    stopAnimation();
    const X = Math.max(1, Math.round(+$('#b-x').value || 0));
    const tk = ++token;
    setBusy(true, $('#play-b'));
    state.expansion = null;
    syncObraPin();
    state.caps = baseCaps.slice();
    state.display = BASE.flows.slice();
    renderEdges();
    setCounter(BASE.maxFlow, 300);
    const cands = BASE.saturated.slice();
    const results = [];
    skipFn = () => finishB(X);
    $('#res-b').innerHTML = `<div class="result"><div class="sec" style="margin-top:0">Testando ${cands.length} ruas no limite…</div><div class="list" id="b-live"></div></div>`;
    try {
      await sleep(500, tk);
      for (const id of cands) {
        status(`testando obra: ${street(id)}`);
        edgeEls[id].g.classList.add('testing');
        const tb = bubble(midLatLng(id), `🏗️ testando +${fmt(X)}…`, 'warn', 0);
        await sleep(650, tk);
        const c = baseCaps.slice();
        c[id] += X;
        const gain = A.solve(NET, c).maxFlow - BASE.maxFlow;
        results.push({ id, gain });
        removeBubble(tb);
        bubble(midLatLng(id), gain > 0 ? `+${fmt(gain)}` : '+0', gain > 0 ? 'good' : 'zero', 1300);
        $('#b-live').insertAdjacentHTML('beforeend', `<div class="item"><div class="ic">🏗️</div><div class="tx"><b>${street(id)}</b></div><div class="val ${gain > 0 ? 'g' : 'z'}">+${fmt(gain)}</div></div>`);
        edgeEls[id].g.classList.remove('testing');
        await sleep(450, tk);
      }
      finishB(X);
    } catch (e) { if (e !== CANCEL) throw e; }
  }
  function finishB(X) {
    stopAnimation();
    const r = A.scenarioB(NET, baseCaps, X);
    const pair = A.bestPair(NET, baseCaps, X);
    state.resB = r;
    if (r.best) {
      state.expansion = { edgeId: r.best.edgeId, X };
      const c = baseCaps.slice();
      c[r.best.edgeId] += X;
      const after = A.solve(NET, c);
      state.caps = c;
      state.display = after.flows.slice();
      setCounter(after.maxFlow);
      bubble(midLatLng(r.best.edgeId), `🏆 Melhor obra: +${fmt(r.best.gain)}`, 'good', 4000);
      bubble([T.lat, T.lon], `📈 +${pct((100 * r.best.gain) / r.before)}`, 'good', 3500);
      status(`com a obra: ${fmt(after.maxFlow)} carros/h`);
    } else {
      state.expansion = null;
      status('nenhuma obra aumenta o fluxo');
    }
    renderEdges();
    syncObraPin();
    const max = Math.max(1, ...r.candidates.map((c) => c.gain));
    const zero = r.candidates.filter((c) => c.gain === 0).length;
    $('#res-b').innerHTML = `<div class="result">
      ${r.best ? `<div class="big good"><div class="k">Melhor obra</div><div class="v">+${fmt(r.best.gain)}</div><div class="u">carros/h (+${pct((100 * r.best.gain) / r.before)})</div></div>
      <div class="explain">🏆 Alargar a <b>${street(r.best.edgeId)}</b> de ${fmt(baseCaps[r.best.edgeId])} para ${fmt(baseCaps[r.best.edgeId] + X)} carros/h.</div>`
        : '<div class="big"><div class="k">Resultado</div><div class="v">+0</div><div class="u">nenhuma obra isolada ajuda</div></div>'}
      <div class="sec">Ganho de cada obra testada</div>
      <div class="list">${r.candidates.map((c) => `
        <div class="item${r.best && c.edgeId === r.best.edgeId ? ' best' : ''}" data-id="${c.edgeId}"><div class="ic">${r.best && c.edgeId === r.best.edgeId ? '🏆' : c.gain > 0 ? '👍' : '🤷'}</div>
          <div class="tx"><b>${street(c.edgeId)}</b><div class="bar"><i data-w="${(100 * c.gain) / max}"></i></div></div>
          <div class="val ${c.gain > 0 ? 'g' : 'z'}">+${fmt(c.gain)}</div></div>`).join('')}</div>
      <div class="explain">💡 <b>${zero} de ${r.candidates.length}</b> ruas no limite não melhoram nada quando alargadas: os carros extras esbarram em outro gargalo logo depois. Só as ruas do <b>gargalo real</b> (corte mínimo) podem aumentar o total.</div>
      ${pair && r.best && pair.gain > r.best.gain ? `<div class="explain">🔗 Se desse para fazer <b>duas obras</b>, o melhor par seria <b>${street(pair.pair[0])}</b> + <b>${street(pair.pair[1])}</b>: +${fmt(pair.gain)} carros/h.</div>` : ''}
    </div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#res-b .bar i').forEach((i) => (i.style.width = `${i.dataset.w}%`))));
    $$('#res-b .item[data-id]').forEach((it) => (it.onclick = () => focusEdge(+it.dataset.id)));
  }

  // ------------------------------------------------------------------ MAIS
  function readEvac() {
    state.evac.attendance = Math.max(0, +$('#ev-pub').value || 0);
    state.evac.carShare = Math.min(100, Math.max(0, +$('#ev-share').value || 0)) / 100;
    state.evac.occupancy = Math.max(1, +$('#ev-occ').value || 1);
  }
  function renderEvac() {
    readEvac();
    const ev = A.evacuation(BASE.maxFlow, state.evac);
    let html = `<b class="t">${fmtTime(ev.minutes)}</b>${fmt(ev.vehicles)} carros ÷ ${fmt(BASE.maxFlow)} carros/h, no melhor caso.`;
    if (state.resA && state.resA.loss > 0) {
      const ea = A.evacuation(state.resA.r.maxFlow, state.evac);
      html += `<br>Com a interdição do Cenário A: <b>${fmtTime(ea.minutes)}</b> (+${fmtTime(ea.minutes - ev.minutes)}).`;
    }
    $('#ev-out').innerHTML = html;
  }
  let vulnCache = null;
  function renderMore() {
    renderEvac();
    if (!vulnCache) vulnCache = A.vulnerability(NET, baseCaps).filter((v) => v.loss > 0).slice(0, 6);
    $('#vuln').innerHTML = `<div class="list">${vulnCache.map((v) => `
      <div class="item" data-id="${v.edgeId}"><div class="ic">🔥</div><div class="tx"><b>${street(v.edgeId)}</b><div class="bar"><i data-w="${v.lossPct}" style="background:var(--jam)"></i></div></div><div class="val r">−${pct(v.lossPct, 0)}</div></div>`).join('')}</div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => $$('#vuln .bar i').forEach((i) => (i.style.width = `${i.dataset.w}%`))));
    $$('#vuln .item').forEach((it) => (it.onclick = () => focusEdge(+it.dataset.id)));

    const dfs = A.solve(NET, baseCaps, { strategy: 'dfs' });
    const ck = BASE.check;
    $('#tech').innerHTML = `
      <p class="small" style="margin:0 0 8px">A cidade vira um <b>grafo</b>: ${NET.nodes.length - 2} cruzamentos (vértices) e ${NET.edges.length} ruas de mão única (arestas). Cada rua tem uma capacidade: <b>800 carros/h por faixa</b> em avenidas e <b>600</b> em ruas locais. As coordenadas vêm do <b>OpenStreetMap</b>.</p>
      <pre class="pseudo">enquanto existe caminho s→t com espaço livre:
    gargalo = menor espaço livre no caminho
    envia "gargalo" carros por esse caminho
    atualiza a rede residual (sobra + arco de volta)
retorna o total enviado</pre>
      <p class="small" style="margin:10px 0 0">A <b>rede residual</b> guarda, para cada rua, quanto ainda cabe (c − f) e um arco de volta (f) que permite ao algoritmo desfazer uma escolha ruim.</p>
      <div class="list">
        <div class="item"><div class="ic">🔎</div><div class="tx"><b>BFS (Edmonds-Karp)</b><small>usado na animação</small></div><div class="val">${BASE.iterations} caminhos</div></div>
        <div class="item"><div class="ic">🧭</div><div class="tx"><b>DFS (clássico)</b><small>mesmo resultado: ${fmt(dfs.maxFlow)}</small></div><div class="val">${dfs.iterations} caminhos</div></div>
        <div class="item"><div class="ic">${ck.conservationOk ? '✅' : '❌'}</div><div class="tx"><b>Conservação de fluxo</b><small>em todos os ${ck.intersections} cruzamentos, entra = sai</small></div></div>
        <div class="item"><div class="ic">${ck.capacityOk ? '✅' : '❌'}</div><div class="tx"><b>Capacidade respeitada</b><small>nenhuma rua passa do limite</small></div></div>
      </div>`;
  }

  // ------------------------------------------------------------------ tooltip e cliques no mapa
  const tip = $('#tooltip');
  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    let x = ev.clientX + 16, y = ev.clientY + 16;
    if (x + tip.offsetWidth > window.innerWidth - 10) x = ev.clientX - tip.offsetWidth - 16;
    if (y + tip.offsetHeight > window.innerHeight - 10) y = ev.clientY - tip.offsetHeight - 16;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  function hideTip() { tip.classList.add('hidden'); }
  function edgeTip(i) {
    const e = NET.edges[i];
    const c = state.caps[i], f = state.display[i];
    const u = c ? Math.min(1, f / c) : 0;
    const col = trafficColor(f, c);
    const kind = e.type === 'acesso' ? 'saída do estádio' : `${e.lanes} faixa${e.lanes > 1 ? 's' : ''} · ${e.type === 'arterial' ? 'avenida' : 'rua local'}`;
    return `<b class="n">${e.name}</b><div class="d">${kind}</div>
      <div class="row"><span>Capacidade</span><span>${fmt(c)} carros/h</span></div>
      <div class="row"><span>Passando agora</span><span>${fmt(f)} carros/h</span></div>
      <div class="meter"><i style="width:${100 * u}%;background:${col}"></i></div>
      ${state.tab === 'a' && !state.busy ? '<div class="tip">👆 toque para interditar</div>' : ''}`;
  }
  gEdges.addEventListener('pointermove', (ev) => {
    const g = ev.target.closest('.edge');
    if (!g || dragging) return;
    $$('#net .edge.hover').forEach((x) => x !== g && x.classList.remove('hover'));
    g.classList.add('hover');
    showTip(edgeTip(+g.dataset.id), ev);
  });
  gEdges.addEventListener('pointerout', (ev) => {
    const g = ev.target.closest('.edge');
    if (g) g.classList.remove('hover');
    hideTip();
  });
  gEdges.addEventListener('click', (ev) => {
    if (dragging) return;
    const g = ev.target.closest('.edge');
    if (!g) return;
    L.DomEvent.stopPropagation(ev);
    hideTip();
    const id = +g.dataset.id;
    if (state.tab === 'a' && !state.busy) chooseClosure(id, map.mouseEventToLatLng(ev));
    else if (state.tab !== 'a') toast('🚧 Para interditar uma rua, abra a aba <b>Interdição</b>');
  });
  gNodes.addEventListener('pointermove', (ev) => {
    const c = ev.target.closest('.node');
    if (!c) return;
    const n = NET.nodes[+c.dataset.id];
    showTip(`<b class="n">${n.name}</b><div class="d" style="margin:0">${n.desc}</div>`, ev);
  });
  gNodes.addEventListener('pointerout', hideTip);

  function focusEdge(id) {
    const b = L.latLngBounds(latlngs[id]);
    const opts = isMobile() ? { paddingBottomRight: [40, window.innerHeight * 0.55], maxZoom: 17 } : { paddingTopLeft: [440, 80], paddingBottomRight: [80, 120], maxZoom: 17 };
    map.flyToBounds(b, { ...opts, duration: 0.8 });
    const g = edgeEls[id].g;
    setTimeout(() => {
      g.classList.add('focus');
      setTimeout(() => g.classList.remove('focus'), 1800);
    }, 850);
  }

  // ------------------------------------------------------------------ abas
  function openTab(name) {
    if (state.busy) return;
    stopAnimation();
    map.closePopup();
    state.tab = name;
    state.cut = false;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
    $('#hint').classList.toggle('hidden', name !== 'a');
    if (name === 'normal') {
      state.caps = baseCaps.slice();
      state.display = state.normalDone ? BASE.flows.slice() : zeros();
      if (state.normalDone) renderResNormal();
      setCounter(state.normalDone ? BASE.maxFlow : 0);
      status(state.normalDone ? 'chegando à Praça da Bandeira (máximo)' : 'aperte ▶ para simular');
    } else if (name === 'a') {
      if (state.resA) { state.caps = state.resA.caps; state.display = state.resA.r.flows.slice(); setCounter(state.resA.r.maxFlow); }
      else { state.caps = baseCaps.slice(); state.display = BASE.flows.slice(); setCounter(BASE.maxFlow); }
      renderClosures();
      status(state.resA ? 'com a interdição' : 'escolha as ruas interditadas');
    } else if (name === 'b') {
      if (state.resB && state.expansion) {
        const c = baseCaps.slice(); c[state.expansion.edgeId] += state.expansion.X;
        const r = A.solve(NET, c);
        state.caps = c; state.display = r.flows.slice(); setCounter(r.maxFlow);
      } else { state.caps = baseCaps.slice(); state.display = BASE.flows.slice(); setCounter(BASE.maxFlow); }
      status(state.resB ? 'com a melhor obra' : 'aperte ▶ para testar as obras');
    } else {
      state.caps = baseCaps.slice(); state.display = BASE.flows.slice(); setCounter(BASE.maxFlow);
      status('situação normal');
      renderMore();
    }
    renderEdges();
    syncClosurePins();
    syncObraPin();
  }

  // ------------------------------------------------------------------ relatório
  function downloadReport() {
    const r = BASE;
    const L1 = [];
    L1.push('# Traffic Planning — Relatório', '', `**Recorte:** ${NET.title} (${NET.city})  `, `**Gerado em:** ${new Date().toLocaleString('pt-BR')}`, '');
    L1.push('## Fluxo máximo', '', `- **${fmt(r.maxFlow)} carros/hora** (Ford-Fulkerson com BFS, ${r.iterations} caminhos aumentantes)`, `- Rede: ${NET.nodes.length - 2} cruzamentos, ${NET.edges.length} ruas`, `- Corte mínimo: ${r.minCut.map(street).join(', ')} = ${fmt(r.cutCapacity)}`, '');
    L1.push('## Ruas saturadas (c_f = 0)', '', '| Rua | Fluxo | Capacidade | Corte mínimo |', '|---|---:|---:|:-:|');
    r.saturated.forEach((id) => L1.push(`| ${street(id)} | ${fmt(r.flows[id])} | ${fmt(baseCaps[id])} | ${r.minCut.includes(id) ? '✂' : ''} |`));
    if (state.resA) {
      L1.push('', '## Cenário A — interdição', '');
      state.closures.forEach((k, id) => L1.push(`- ${k === 'close' ? 'Interditada' : 'Faixa bloqueada (−50%)'}: ${street(id)}`));
      L1.push('', `Fluxo: ${fmt(r.maxFlow)} → ${fmt(state.resA.r.maxFlow)} carros/h (perda de ${pct(state.resA.lossPct)})`);
    }
    const b = state.resB || A.scenarioB(NET, baseCaps, 600);
    L1.push('', `## Cenário B — obra (+${fmt(b.X)} carros/h)`, '', '| Rua | Ganho |', '|---|---:|');
    b.candidates.forEach((c) => L1.push(`| ${street(c.edgeId)} | +${fmt(c.gain)} |`));
    if (b.best) L1.push('', `**Recomendação:** ${street(b.best.edgeId)} (+${fmt(b.best.gain)} carros/h)`);
    L1.push('', '## Fluxo em todas as ruas', '', '| Rua | f | c |', '|---|---:|---:|');
    NET.edges.forEach((e) => L1.push(`| ${e.name} | ${fmt(r.flows[e.id])} | ${fmt(baseCaps[e.id])} |`));
    const blob = new Blob([L1.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'relatorio-traffic-planning.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('📄 Relatório baixado');
  }

  // ------------------------------------------------------------------ toasts e eventos
  function toast(html) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
  }
  function bind() {
    $$('#tabs button').forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));
    $('#play-normal').onclick = playNormal;
    $('#play-a').onclick = playA;
    $('#play-b').onclick = playB;
    $('#btn-skip').onclick = () => { if (state.busy && skipFn) skipFn(); };
    const speeds = [1, 2, 4, 0.5];
    $('#btn-speed').onclick = () => {
      state.speed = speeds[(speeds.indexOf(state.speed) + 1) % speeds.length];
      $('#btn-speed').textContent = `${state.speed === 0.5 ? '½' : state.speed}×`;
    };
    $$('#b-chips button').forEach((b) => (b.onclick = () => {
      $$('#b-chips button').forEach((x) => x.classList.toggle('active', x === b));
      $('#b-x').value = b.dataset.x;
    }));
    $('#b-x').oninput = () => $$('#b-chips button').forEach((x) => x.classList.toggle('active', x.dataset.x === $('#b-x').value));
    ['#ev-pub', '#ev-share', '#ev-occ'].forEach((s) => ($(s).oninput = renderEvac));
    $('#btn-report').onclick = downloadReport;
    window.addEventListener('keydown', (ev) => {
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        if (state.busy) { if (skipFn) skipFn(); return; }
        ({ normal: playNormal, a: playA, b: playB }[state.tab] || (() => {}))();
      }
    });
    window.addEventListener('resize', () => map.invalidateSize());
  }

  // ------------------------------------------------------------------ início
  $('#ev-pub').value = state.evac.attendance;
  $('#ev-share').value = Math.round(state.evac.carShare * 100);
  $('#ev-occ').value = state.evac.occupancy;
  buildNetwork();
  fit(false);
  relayout();
  renderEdges();
  renderClosures();
  bind();
  status('aperte ▶ para simular');
  requestAnimationFrame(tick);
  window.__app = { state, map, openTab }; // para depuração
})();
