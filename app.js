/* Focos de queimadas · Paraíba 2026 — app.js (Vue 3 global + Leaflet + Highcharts) */
(() => {
'use strict';
const { createApp, ref, shallowRef, reactive, computed, watch, nextTick } = Vue;

const TZ = 'America/Fortaleza', OFF = 3 * 36e5, DAY = 864e5, JAN1 = Date.UTC(2026, 0, 1, 3);
const FILES = [
  { k: 'queimadas', path: 'dados/focos_2026.geojson', rot: 'Focos de queimadas' },
  { k: 'municipios', path: 'dados/municipios_simplificado.geojson', rot: 'Municípios' },
  { k: 'limite', path: 'dados/limite_pb_simplificado.geojson', rot: 'Limite do estado' }
];
const VIEWS = [{ k: 'cluster', t: 'Agrupados' }, { k: 'heat', t: 'Densidade' }, { k: 'intens', t: 'Intensidade' }, { k: 'mun', t: 'Municípios' }];
const UNITS = [{ k: 'dia', t: 'Dia' }, { k: 'semana', t: 'Semana' }, { k: 'mes', t: 'Mês' }];
const FAIXAS = [[10, '#f59e0b', '1–9', 38], [50, '#ea580c', '10–49', 44], [200, '#dc2626', '50–199', 50], [Infinity, '#7f1d1d', '200 ou mais', 56]];
const CLS_FRP = [{ m: 5, c: '#fcd34d', t: '< 5 MW' }, { m: 20, c: '#fb923c', t: '5–20 MW' }, { m: 50, c: '#dc2626', t: '20–50 MW' }, { m: Infinity, c: '#7f1d1d', t: '≥ 50 MW' }];
const CORES_MUN = ['#fee8c8', '#fdbb84', '#fc8d59', '#e34a33', '#990000'];
const corFrp = v => (CLS_FRP.find(c => v < c.m) || CLS_FRP[3]).c;
const rFrp = v => Math.min(18, 4 + Math.sqrt(Math.max(v || 0, 0)) * 1.3);

const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n, d = 0) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: d });
const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fDia = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const fCurto = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric', month: 'short' });
const fMes = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, month: 'long', year: 'numeric' });
const fHora = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
const titulo = s => String(s || '').toLowerCase().split(' ').map((w, i) => /^d'/.test(w) ? "d'" + cap(w.slice(2)) : (i && ['de', 'da', 'do', 'das', 'dos', 'e'].includes(w)) ? w : cap(w)).join(' ');
const parseUTC = s => { s = String(s).trim().replace(' ', 'T'); return Date.parse(/(Z|[+-]\d\d:?\d\d)$/i.test(s) ? s : s + 'Z'); };

/* passos: sempre começam à meia-noite de UTC-3 e nunca antes de 1º de janeiro */
function buildSteps(unit, fim) {
  const s = [];
  if (unit === 'dia') for (let t = JAN1; t < fim; t += DAY) s.push(t);
  else if (unit === 'semana') { let t = JAN1; while (t < fim) { s.push(t); const dow = (new Date(t - OFF).getUTCDay() + 6) % 7; t += (7 - dow) * DAY; } }
  else for (let m = 0; ; m++) { const t = Date.UTC(2026, m, 1, 3); if (t >= fim) break; s.push(t); }
  return s;
}

/* camada sincronizada: faz o TimeDimension emitir 'timeload' a cada novo instante */
const SyncLayer = L.TimeDimension.Layer.extend({
  initialize() { L.TimeDimension.Layer.prototype.initialize.call(this, L.layerGroup()); },
  onAdd(map) { this._map = map; this._timeDimension = map.timeDimension; this._timeDimension.registerSyncedLayer(this); this._onNewTimeLoading({ time: this._timeDimension.getCurrentTime() }); },
  onRemove() { if (this._timeDimension) this._timeDimension.unregisterSyncedLayer(this); },
  _onNewTimeLoading(e) { this.fire('timeload', { time: e.time }); },
  isReady() { return true; }, setZIndex() {}, setOpacity() {}, eachLayer() {}
});

createApp({
  setup() {
    /* ---------- carregamento ---------- */
    const files = reactive(FILES.map(f => ({ ...f, estado: 'carregando', erro: '' })));
    const dados = shallowRef({});
    const pronto = ref(false), baseAviso = ref(false);
    const todosOk = computed(() => files.every(f => f.estado === 'ok'));
    const temErro = computed(() => files.some(f => f.estado === 'erro'));
    async function carregar(f) {
      f.estado = 'carregando'; f.erro = '';
      try {
        const r = await fetch(f.path, { cache: 'no-cache' });
        if (!r.ok) throw new Error('o servidor respondeu HTTP ' + r.status + (r.statusText ? ' (' + r.statusText + ')' : '') + '; confira se o arquivo está em "' + f.path + '"');
        let j; try { j = await r.json(); } catch (e) { throw new Error('o conteúdo não é um JSON válido (' + e.message + ')'); }
        if (!j || !Array.isArray(j.features)) throw new Error('o arquivo não é um GeoJSON com "features"');
        dados.value = { ...dados.value, [f.k]: j }; f.estado = 'ok';
      } catch (e) {
        f.estado = 'erro';
        f.erro = e instanceof TypeError ? 'não foi possível ler "' + f.path + '". Abra a página por um servidor local (por exemplo, python -m http.server) em vez de file://, e confira o caminho' : e.message;
      }
    }
    async function tentarNovamente() { await Promise.all(files.filter(f => f.estado === 'erro').map(carregar)); if (todosOk.value && !pronto.value) iniciar(); }

    /* ---------- dados derivados ---------- */
    const focos = shallowRef([]), meta = reactive({ fonte: '—', satelite: '—' });
    const nomes = new Map(), biomas = ref([]), fim = ref(0);
    const nomeMun = f => nomes.get(f.key) || f.mun || '—';
    function iniciar() {
      const q = dados.value.queimadas, m = q.metadados || q.metadata || {};
      meta.fonte = m.fonte || '—'; meta.satelite = m.satelite || m['satélite'] || '—';
      dados.value.municipios.features.forEach(f => { const p = f.properties || {}; nomes.set(norm(p.municipio || p.nome), p.nome || titulo(p.municipio)); });
      const arr = [];
      q.features.forEach((f, i) => {
        const g = f.geometry; if (!g || g.type !== 'Point') return;
        const p = f.properties || {}, t = parseUTC(p.datahora != null ? p.datahora : p.data_hora), lat = +g.coordinates[1], lng = +g.coordinates[0];
        if (isNaN(t) || isNaN(lat) || isNaN(lng)) return;
        arr.push({ i, t, lat, lng, mun: p.municipio, key: norm(p.municipio), bioma: p.bioma || '', frp: num(p.frp), risco: num(p.riscofogo != null ? p.riscofogo : p.risco_fogo), dias: num(p.diasemchuva != null ? p.diasemchuva : p.dias_sem_chuva), prec: num(p.precipitacao), sat: p.satelite || '', loc: t - OFF });
      });
      arr.forEach(f => { if (!nomes.has(f.key) && f.mun) nomes.set(f.key, titulo(f.mun)); });
      focos.value = arr;
      biomas.value = [...new Set(arr.map(f => f.bioma).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
      const tmax = arr.reduce((a, f) => Math.max(a, f.t), JAN1);
      fim.value = Math.floor((tmax - OFF) / DAY) * DAY + OFF + DAY;
      const st = buildSteps('mes', fim.value), out = Date.UTC(2026, 9, 1, 3);
      cur.value = st.includes(out) ? out : st[st.length - 1];
      pronto.value = true;
      nextTick(() => { montarSelect(); iniciarMapa(); criarGraficos(); atualizarTudo(); });
    }

    /* ---------- estado ---------- */
    const filtro = reactive({ mun: '', bioma: '' });
    const view = ref('cluster'), unit = ref('mes'), modo = ref('passo'), cur = ref(JAN1);
    const steps = computed(() => fim.value ? buildSteps(unit.value, fim.value) : []);
    const idx = computed(() => { let k = 0; steps.value.forEach((s, i) => { if (s <= cur.value) k = i; }); return k; });
    const win = computed(() => [modo.value === 'cum' ? steps.value[0] : steps.value[idx.value], idx.value + 1 < steps.value.length ? steps.value[idx.value + 1] : fim.value]);
    const F = computed(() => focos.value.filter(f => (!filtro.mun || f.key === filtro.mun) && (!filtro.bioma || f.bioma === filtro.bioma)));
    const W = computed(() => { const [a, b] = win.value; return F.value.filter(f => f.t >= a && f.t < b); });
    const nomeMunSel = computed(() => nomes.get(filtro.mun) || filtro.mun);
    const unitSing = computed(() => ({ dia: 'dia', semana: 'semana', mes: 'mês' }[unit.value]));
    const rotuloPasso = i => {
      const s = steps.value[i]; if (s == null) return '—';
      const e = (steps.value[i + 1] || fim.value) - DAY;
      return unit.value === 'dia' ? cap(fDia.format(s)) : unit.value === 'semana' ? fCurto.format(s) + ' a ' + fDia.format(e) : cap(fMes.format(s));
    };
    const rotuloPeriodo = computed(() => {
      if (!steps.value.length) return '';
      if (modo.value === 'cum') return 'Acumulado até ' + fDia.format(win.value[1] - DAY);
      return rotuloPasso(idx.value) + ' · só ' + ({ dia: 'este dia', semana: 'esta semana', mes: 'este mês' }[unit.value]);
    });

    /* ---------- indicadores ---------- */
    const cartoes = computed(() => {
      const w = W.value, tot = F.value.length, vazio = 'sem focos na seleção';
      if (!w.length) return ['Focos', 'Municípios atingidos', 'Dia com mais focos', 'Maior FRP', '% na Caatinga'].map(t => ({ t, v: '—', n: vazio }));
      const muns = new Set(w.map(f => f.key)), munsF = new Set(F.value.map(f => f.key));
      const dias = {}; w.forEach(f => { const d = Math.floor(f.loc / DAY); dias[d] = (dias[d] || 0) + 1; });
      const dTop = Object.keys(dias).reduce((a, b) => dias[b] > dias[a] ? b : a);
      const mx = w.reduce((a, f) => (f.frp || -1) > (a.frp || -1) ? f : a, w[0]);
      const cat = w.filter(f => norm(f.bioma) === 'CAATINGA').length;
      return [
        { t: 'Focos', v: nf(w.length), n: nf(w.length) + ' de ' + nf(tot) + ' focos selecionados' },
        { t: 'Municípios atingidos', v: nf(muns.size), n: nf(muns.size) + ' de ' + nf(munsF.size) + ' com focos na seleção' },
        { t: 'Dia com mais focos', v: fCurto.format(+dTop * DAY + OFF), n: nf(dias[dTop]) + ' focos nesse dia' },
        { t: 'Maior FRP', v: mx.frp == null ? '—' : nf(mx.frp, 1) + ' MW', n: nomeMun(mx) + ' · ' + fHora.format(mx.t) },
        { t: '% na Caatinga', v: nf(cat / w.length * 100, 1) + '%', n: nf(cat) + ' de ' + nf(w.length) + ' focos na janela' }
      ];
    });
    const top10 = computed(() => W.value.filter(f => f.frp != null).slice().sort((a, b) => b.frp - a.frp).slice(0, 10));

    /* ---------- Tom Select ---------- */
    let ts = null;
    function montarSelect() {
      const cont = {}; focos.value.forEach(f => { cont[f.key] = (cont[f.key] || 0) + 1; });
      const opts = [{ value: '', nome: 'Todos os municípios', n: focos.value.length }];
      [...nomes.keys()].sort((a, b) => nomes.get(a).localeCompare(nomes.get(b), 'pt-BR')).forEach(k => opts.push({ value: k, nome: nomes.get(k), n: cont[k] || 0 }));
      ts = new TomSelect(refs.selMun.value, {
        options: opts, items: [''], valueField: 'value', labelField: 'nome', searchField: ['nome'], create: false, allowEmptyOption: true, maxOptions: 400, diacritics: true,
        render: { option: (d, e) => '<div class="flex justify-between gap-3"><span>' + e(d.nome) + '</span><span class="text-slate-500">' + nf(d.n) + '</span></div>', item: (d, e) => '<div>' + e(d.nome) + ' (' + nf(d.n) + ')</div>', no_results: () => '<div class="no-results">Nenhum município encontrado</div>' },
        onChange: v => { filtro.mun = v || ''; }
      });
      ts.control_input.setAttribute('aria-label', 'Buscar município');
    }
    watch(() => filtro.mun, v => { if (ts && ts.getValue() !== v) ts.setValue(v, true); });

    /* ---------- mapa ---------- */
    const refs = { selMun: ref(null), mapEl: ref(null), wrap: ref(null), cPasso: ref(null), cMun: ref(null), cBioma: ref(null), cHora: ref(null) };
    let map, td, camada = null, home, linhasMun, popup = null;
    const cardHtml = f => '<div class="pc"><div class="pc-frp"><b>' + (f.frp == null ? '—' : nf(f.frp, 1)) + '</b><span>MW · FRP</span></div><div class="pc-t">' + esc(nomeMun(f)) + '</div><div class="pc-s">' + esc(f.bioma || '—') + ' · ' + fHora.format(f.t) + '</div><dl><dt>Risco de fogo</dt><dd>' + (f.risco == null ? '—' : nf(f.risco, 2)) + '</dd><dt>Dias sem chuva</dt><dd>' + (f.dias == null ? '—' : nf(f.dias)) + '</dd><dt>Precipitação</dt><dd>' + (f.prec == null ? '—' : nf(f.prec, 1) + ' mm') + '</dd>' + (f.sat ? '<dt>Satélite</dt><dd>' + esc(f.sat) + '</dd>' : '') + '</dl></div>';
    const bindCard = (m, f) => m.bindPopup(() => cardHtml(f), { className: 'popup-card', maxWidth: 280 });
    const legMun = ref([]);

    function iniciarMapa() {
      const lim = L.geoJSON(dados.value.limite);
      home = lim.getBounds();
      map = L.map(refs.mapEl.value, { zoomControl: false, preferCanvas: true, minZoom: 5, timeDimension: true, timeDimensionOptions: { times: steps.value, currentTime: cur.value } });
      td = map.timeDimension;
      const base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      let erros = 0, oks = 0;
      base.on('tileload', () => { oks++; baseAviso.value = false; });
      base.on('tileerror', () => { erros++; if (erros >= 3 && oks === 0) baseAviso.value = true; });
      map.fitBounds(home);

      const ZoomHome = L.Control.Zoom.extend({ onAdd(m) {
        const c = L.DomUtil.create('div', 'leaflet-control-zoom leaflet-bar'), o = this.options; this._map = m;
        this._zoomInButton = this._createButton(o.zoomInText, 'Aproximar', 'leaflet-control-zoom-in', c, this._zoomIn);
        this._createButton('⌂', 'Voltar ao estado inteiro', 'leaflet-control-zoom-home', c, () => m.fitBounds(home));
        this._zoomOutButton = this._createButton(o.zoomOutText, 'Afastar', 'leaflet-control-zoom-out', c, this._zoomOut);
        this._updateDisabled(); m.on('zoomend zoomlevelschange', this._updateDisabled, this); return c; } });
      new ZoomHome({ position: 'topleft' }).addTo(map);
      const Full = L.Control.extend({ onAdd() {
        const b = L.DomUtil.create('a', 'leaflet-bar'); b.href = '#'; b.role = 'button'; b.title = 'Tela cheia'; b.setAttribute('aria-label', 'Alternar tela cheia'); b.style.cssText = 'width:30px;height:30px;line-height:30px;text-align:center;background:#fff;font-size:16px;color:#000';
        b.textContent = '⛶'; L.DomEvent.disableClickPropagation(b);
        L.DomEvent.on(b, 'click', e => { L.DomEvent.preventDefault(e); document.fullscreenElement ? document.exitFullscreen() : refs.wrap.value.requestFullscreen && refs.wrap.value.requestFullscreen(); }); return b; } });
      new Full({ position: 'topleft' }).addTo(map);
      document.addEventListener('fullscreenchange', () => setTimeout(() => map.invalidateSize(), 150));

      L.geoJSON(dados.value.limite, { style: { color: '#0f172a', weight: 2.5, fill: false }, interactive: false }).addTo(map);
      linhasMun = L.geoJSON(dados.value.municipios, { style: { color: '#475569', weight: 0.8, fill: false }, interactive: false });
      const limites = () => map.getZoom() >= 9 ? linhasMun.addTo(map) : map.removeLayer(linhasMun);
      map.on('zoomend', limites); limites();

      new SyncLayer().addTo(map);
      td.on('timeload', e => { cur.value = e.time || td.getCurrentTime(); });
    }
    function irPara(ms) { if (ms == null) return; td.setCurrentTime(ms); cur.value = td.getCurrentTime() || ms; }
    const passo = d => irPara(steps.value[Math.min(Math.max(idx.value + d, 0), steps.value.length - 1)]);

    function desenhar() {
      if (!map) return;
      if (camada) { map.removeLayer(camada); camada = null; }
      const pts = W.value, v = view.value;
      if (v === 'cluster') {
        camada = L.markerClusterGroup({ showCoverageOnHover: false, chunkedLoading: true, maxClusterRadius: 50,
          iconCreateFunction: c => { const n = c.getChildCount(), fx = FAIXAS.find(x => n < x[0]); return L.divIcon({ html: '<div class="cl" style="width:' + fx[3] + 'px;height:' + fx[3] + 'px;background:' + fx[1] + '">' + nf(n) + '</div>', className: '', iconSize: [fx[3], fx[3]] }); } });
        pts.forEach(f => camada.addLayer(bindCard(L.circleMarker([f.lat, f.lng], { radius: 6, color: '#fff', weight: 1.5, fillColor: '#ea580c', fillOpacity: .95 }), f)));
      } else if (v === 'heat') {
        camada = L.heatLayer(pts.map(f => [f.lat, f.lng, 0.5]), { radius: 16, blur: 20, minOpacity: .25, gradient: { .2: '#fde68a', .5: '#f97316', .8: '#dc2626', 1: '#7f1d1d' } });
      } else if (v === 'intens') {
        camada = L.layerGroup(pts.map(f => bindCard(L.circleMarker([f.lat, f.lng], { radius: rFrp(f.frp), color: '#fff', weight: 1, fillColor: corFrp(f.frp || 0), fillOpacity: .85 }), f)));
      } else {
        const c = {}; pts.forEach(f => { c[f.key] = (c[f.key] || 0) + 1; });
        const pos = Object.values(c).sort((a, b) => a - b), n = pos.length, q = p => pos[Math.min(n - 1, Math.floor(p * n))];
        const b = n ? [q(.2), q(.4), q(.6), q(.8)] : [0, 0, 0, 0], mx = n ? pos[n - 1] : 0;
        const cls = v2 => v2 ? 1 + b.filter(x => v2 > x).length : 0;
        const lo = [1, b[0] + 1, b[1] + 1, b[2] + 1, b[3] + 1], hi = [b[0], b[1], b[2], b[3], mx];
        legMun.value = [{ c: '#f1f5f9', t: 'sem focos' }].concat(CORES_MUN.map((col, k) => ({ c: col, t: lo[k] > hi[k] ? null : (lo[k] === hi[k] ? nf(lo[k]) : nf(lo[k]) + '–' + nf(hi[k])) })).filter(x => x.t));
        camada = L.geoJSON(dados.value.municipios, {
          style: ft => { const k = norm((ft.properties || {}).municipio || (ft.properties || {}).nome), cl = cls(c[k] || 0); return { stroke: false, fillColor: cl ? CORES_MUN[cl - 1] : '#f1f5f9', fillOpacity: cl ? .8 : .5 }; },
          onEachFeature: (ft, l) => { const p = ft.properties || {}, k = norm(p.municipio || p.nome); l.bindTooltip(esc(p.nome || p.municipio) + ': ' + nf(c[k] || 0) + ' focos', { sticky: true }); }
        });
      }
      camada.addTo(map);
      if (linhasMun && map.hasLayer(linhasMun)) linhasMun.bringToFront();
    }
    function abrirFoco(f) {
      map.setView([f.lat, f.lng], Math.max(map.getZoom(), 12));
      popup = L.popup({ className: 'popup-card', maxWidth: 280 }).setLatLng([f.lat, f.lng]).setContent(cardHtml(f)).openOn(map);
      refs.wrap.value.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /* ---------- gráficos ---------- */
    const G = {};
    function criarGraficos() {
      Highcharts.setOptions({ lang: { thousandsSep: '.', decimalPoint: ',' } });
      const base = { chart: { animation: false, style: { fontFamily: 'inherit' }, height: 280 }, title: { text: null }, credits: { enabled: false }, legend: { enabled: false }, yAxis: { title: { text: null }, allowDecimals: false }, plotOptions: { series: { animation: false, borderRadius: 2, cursor: 'pointer' } }, tooltip: { pointFormat: '<b>{point.y}</b> focos' } };
      G.passo = Highcharts.chart(refs.cPasso.value, Highcharts.merge(base, { chart: { type: 'column' }, xAxis: { type: 'category', labels: { enabled: true } }, series: [{ name: 'Focos', data: [], point: { events: { click() { irPara(steps.value[this.index]); } } } }] }));
      G.mun = Highcharts.chart(refs.cMun.value, Highcharts.merge(base, { chart: { type: 'bar', height: 420 }, xAxis: { categories: [] }, series: [{ name: 'Focos', data: [], point: { events: { click() { const k = G.munKeys[this.index]; filtro.mun = filtro.mun === k ? '' : k; } } } }] }));
      G.bioma = Highcharts.chart(refs.cBioma.value, Highcharts.merge(base, { chart: { type: 'column' }, xAxis: { categories: [] }, series: [{ name: 'Focos', data: [], point: { events: { click() { const b = this.category; filtro.bioma = filtro.bioma === b ? '' : b; } } } }] }));
      G.hora = Highcharts.chart(refs.cHora.value, Highcharts.merge(base, { chart: { type: 'column' }, xAxis: { categories: Array.from({ length: 24 }, (_, h) => h + 'h') }, series: [{ name: 'Focos', data: [], cursor: 'default' }] }));
    }
    function atualizarGraficos() {
      if (!G.passo) return;
      const st = steps.value, cont = st.map(() => 0); let k = 0;
      F.value.slice().sort((a, b) => a.t - b.t).forEach(f => { while (k + 1 < st.length && f.t >= st[k + 1]) k++; cont[k]++; });
      G.passo.series[0].setData(cont.map((y, j) => ({ name: rotuloPasso(j), y, color: (modo.value === 'cum' ? j <= idx.value : j === idx.value) ? '#c2410c' : '#fdba74' })), true, false);
      const c = {}, bi = {}, h = Array(24).fill(0);
      W.value.forEach(f => { c[f.key] = (c[f.key] || 0) + 1; if (f.bioma) bi[f.bioma] = (bi[f.bioma] || 0) + 1; h[Math.floor((f.loc % DAY) / 36e5)]++; });
      const top = Object.keys(c).sort((a, b) => c[b] - c[a]).slice(0, 15); G.munKeys = top;
      G.mun.xAxis[0].setCategories(top.map(x => nomes.get(x) || x), false);
      G.mun.series[0].setData(top.map(x => ({ y: c[x], color: x === filtro.mun ? '#c2410c' : '#fb923c' })), true, false);
      const bs = Object.keys(bi).sort((a, b) => bi[b] - bi[a]);
      G.bioma.xAxis[0].setCategories(bs, false);
      G.bioma.series[0].setData(bs.map(x => ({ y: bi[x], color: x === filtro.bioma ? '#c2410c' : '#fb923c' })), true, false);
      G.hora.series[0].setData(h.map((y, j) => ({ y, color: j >= 8 && j <= 18 ? '#fb923c' : '#94a3b8' })), true, false);
    }
    function atualizarTudo() { desenhar(); atualizarGraficos(); }

    /* ---------- reações ---------- */
    watch([W, view], () => { if (map) desenhar(); });
    watch([W, F, steps, modo], () => atualizarGraficos(), { flush: 'post' });
    watch(unit, () => { if (!td) return; td.setAvailableTimes(steps.value, 'replace'); irPara(steps.value[idx.value]); });

    FILES.forEach((_, i) => carregar(files[i]).then(() => { if (todosOk.value && !pronto.value) iniciar(); }));

    return { files, todosOk, temErro, tentarNovamente, pronto, baseAviso, meta, filtro, biomas, nomeMunSel, cartoes, VIEWS, view, FAIXAS, CLS_FRP, legMun, steps, idx, passo, irPara, rotuloPasso, rotuloPeriodo, unit, UNITS, unitSing, modo, W, top10, abrirFoco, nomeMun, fHora, nf, ...refs };
  }
}).mount('#app');
})();
