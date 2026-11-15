// Wales 3D world v0.5.0 — the 1877 → today timelapse.
// The 3D world stays a normal, orbitable 3D world; this layer adds a play bar along the top, redraws the family's land
// parcels on the terrain for each year, shows the archive record for each event in a modal, and loops.
// Data: data/timeline.json (events, holders, sources) and data/family-parcels.geojson (the four parcels, EPSG:4326).
// Status shown on every event: solid = a record has been seen; dashed = the family's case or a record not yet seen.
// URL: ?tl=0 starts the normal world with the timelapse off; ?tl=pause opens it paused.
const DATA = (document.querySelector('meta[name=w3d-data]') || {}).content || new URL('data/', import.meta.url).href;
const Q = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ready = () => window.__w3d ? Promise.resolve(window.__w3d) : new Promise(r => addEventListener('w3d:ready', () => r(window.__w3d), { once: true }));

(async function () {
  const [W, TL, GJ] = await Promise.all([ready(), fetch(DATA + 'timeline.json?v=0.5.0').then(r => r.json()), fetch(DATA + 'family-parcels.geojson?v=0.5.0').then(r => r.json())]);
  const { THREE, scene, camera, controls, world, ovl } = W;
  const root = $('#w3d'); if (!root) return;
  const EV = TL.events, START = TL.start, END = TL.end, RATE = 3.7; // years of story per second at 1×
  const demIdx = EV.findIndex(e => e.demolish), modIdx = EV.findIndex(e => e.modern);

  // ---------- parcels in world coordinates ----------
  const polys = GJ.features.map(f => {
    const rings = f.geometry.coordinates.map(r => r.map(([lng, lat]) => W.llToXZ(lat, lng)));
    let sx = 0, sz = 0; rings[0].forEach(p => { sx += p[0]; sz += p[1]; });
    return { id: f.properties.id, rings, c: [sx / rings[0].length, sz / rings[0].length] };
  });
  const bb = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
  polys.forEach(p => p.rings[0].forEach(([x, z]) => { bb.x0 = Math.min(bb.x0, x); bb.x1 = Math.max(bb.x1, x); bb.z0 = Math.min(bb.z0, z); bb.z1 = Math.max(bb.z1, z); }));
  const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2, span = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0);
  const ah = world.anchors.tymawr || [cx, cz];
  W.views.tl_aerial = [cx, cz, Math.max(260, span * 1.9), 63, 0];   // north up, like a map
  W.views.tl_house = [ah[0], ah[1], 105, 24, 140];

  // ---------- state of the land for a given event index ----------
  const initial = () => Object.fromEntries(polys.map(p => [p.id, { h: 'bute', s: 'dashed' }]));
  function foldTo(k) { const cur = initial(); for (let i = 0; i <= k; i++) Object.entries(EV[i].set || {}).forEach(([id, [h, s]]) => { cur[id] = { h, s }; }); return cur; }
  const noteFor = k => { const o = {}; for (let i = 0; i <= k; i++) Object.assign(o, EV[i].note || {}); return o; };
  let cur = foldTo(-1), curNote = {}, split = false;

  // ---------- overlay drawing (the terrain's overlay texture) ----------
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`; };
  const dark = hex => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) * 0.45 | 0},${(n >> 8 & 255) * 0.45 | 0},${(n & 255) * 0.45 | 0})`; };
  let flash = null, flashOn = false;
  function custom(g, X, Y, S) {
    const path = p => { g.beginPath(); p.rings.forEach(r => { r.forEach(([x, z], i) => i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))); g.closePath(); }); };
    if (!split) { // before 1877 the ground is one holding: one fill, no inner lines
      g.beginPath(); polys.forEach(p => p.rings.forEach(r => { r.forEach(([x, z], i) => i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))); g.closePath(); }));
      g.fillStyle = rgba(TL.holders.bute.col, 0.5); g.fill('evenodd');
    } else polys.forEach(p => {
      const c = cur[p.id], H = TL.holders[c.h]; path(p); g.fillStyle = rgba(H.col, 0.52); g.fill('evenodd');
      const hot = flashOn && flash && flash.ids.includes(p.id);
      g.lineJoin = 'round'; g.lineWidth = hot ? 9 : 5; g.strokeStyle = hot ? '#fff6a8' : dark(H.col); g.setLineDash(c.s === 'dashed' ? [24, 15] : []); g.stroke(); g.setLineDash([]);
    });
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 15px system-ui,sans-serif';
    polys.forEach(p => { if (!split && p.id !== 'AM') return; const t = split ? TL.parcels[p.id] : 'Tŷ Mawr land';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(t, X(p.c[0]), Y(p.c[1])); g.fillStyle = '#fff'; g.fillText(t, X(p.c[0]), Y(p.c[1])); });
  }
  const redraw = () => W.drawOverlay();

  // ---------- primitive stage: church, farmhouse (until 1988), rubble, dust ----------
  const stage = new THREE.Group(); stage.visible = false; scene.add(stage);
  const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true });
  const wall = M(0xe6dfcc), slate = M(0x4a4f57), stone = M(0xb4ada0), brick = M(0x8a5a44), rub = M(0x8c8576);
  function gable(w, d, h, mat) { const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }); g.translate(0, 0, -d / 2); return new THREE.Mesh(g, mat); }
  function box(w, h, d, mat, baseAtZero) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, baseAtZero ? h / 2 : 0, 0); return new THREE.Mesh(g, mat); }
  const placeAt = (grp, x, z, rot) => { grp.position.set(x, W.hAt(x, z), z); grp.rotation.y = rot || 0; };
  // church (St Dochdwy's): nave, tower, roof. Stands throughout; the OSM buildings replace it once they are switched on.
  const church = new THREE.Group(); { const nave = box(14, 6, 7, stone, true); nave.position.y = -2; nave.scale.y = 1; church.add(nave);
    const r = gable(8.4, 14.4, 3.2, slate); r.rotation.y = Math.PI / 2; r.position.y = 4; church.add(r);
    const tw = box(5, 12, 5, stone, true); tw.position.set(-9, -2, 0); church.add(tw);
    const tr = gable(5.6, 5.6, 2.6, slate); tr.position.set(-9, 10, 0); church.add(tr); }
  if (world.anchors.church) placeAt(church, world.anchors.church[0], world.anchors.church[1], 0.1); else church.visible = false;
  stage.add(church);
  // farmhouse (Great House, Tŷ Mawr): a stand-in block with a pitched roof, at the OS anchor point
  const house = new THREE.Group(); placeAt(house, ah[0], ah[1], -0.3);
  const hWalls = box(12, 6, 6.2, wall, true); hWalls.position.y = -2; hWalls.scale.y = 1; house.add(hWalls);
  const hRoof = gable(7.6, 12.8, 3.2, slate); hRoof.rotation.y = Math.PI / 2; hRoof.position.y = 4; house.add(hRoof);
  const chim = box(1, 3, 1, brick, true); chim.position.set(4.5, 4, 0); house.add(chim);
  const barn = box(8, 4, 5, wall, true); barn.position.set(-10, -2, 6); house.add(barn);
  const bRoof = gable(6, 8.6, 2, slate); bRoof.rotation.y = Math.PI / 2; bRoof.position.set(-10, 2, 6); house.add(bRoof);
  const rubble = new THREE.Group(); for (let i = 0; i < 18; i++) { const b = box(0.8 + Math.random() * 1.8, 0.4 + Math.random() * 0.9, 0.8 + Math.random() * 1.6, rub, true);
    b.position.set((Math.random() - 0.5) * 15, -0.6, (Math.random() - 0.5) * 9); b.rotation.set(Math.random() * 0.4, Math.random() * 3, Math.random() * 0.4); rubble.add(b); }
  rubble.visible = false; house.add(rubble); stage.add(house);
  const NP = 90, dpos = new Float32Array(NP * 3), dvel = new Float32Array(NP * 3);
  const dust = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(dpos, 3)),
    new THREE.PointsMaterial({ color: 0xbdb6a6, size: 7, transparent: true, opacity: 0, depthWrite: false })); dust.frustumCulled = false; dust.visible = false; stage.add(dust);
  let demoAt = 0, dustAt = 0;
  function setDemo(p) { const e = p * p * (3 - 2 * p); hWalls.scale.y = 1 - 0.86 * e; hRoof.position.y = 4 - 3.4 * e; hRoof.rotation.x = 0.55 * e; hRoof.rotation.z = 0.2 * e;
    hRoof.scale.setScalar(1 - 0.35 * e); hRoof.visible = p < 0.92; chim.visible = p < 0.4; barn.scale.y = 1 - 0.8 * e; bRoof.visible = p < 0.7; bRoof.position.y = 2 - 1.6 * e; rubble.visible = p > 0.45; rubble.scale.setScalar(0.2 + 0.8 * Math.min(1, p * 1.2)); }
  function startDust() { const base = house.position; for (let i = 0; i < NP; i++) { dpos[i * 3] = base.x + (Math.random() - 0.5) * 12; dpos[i * 3 + 1] = base.y + Math.random() * 3; dpos[i * 3 + 2] = base.z + (Math.random() - 0.5) * 8;
      dvel[i * 3] = (Math.random() - 0.5) * 2.2; dvel[i * 3 + 1] = 1.2 + Math.random() * 3; dvel[i * 3 + 2] = (Math.random() - 0.5) * 2.2; }
    dust.geometry.attributes.position.needsUpdate = true; dust.visible = true; dustAt = performance.now(); }
  function houseState(demolished, modernOn) { demoAt = 0; dust.visible = false; house.visible = !modernOn; church.visible = !modernOn; [hWalls, hRoof, chim, barn, bRoof].forEach(o => { o.visible = true; }); setDemo(demolished ? 1 : 0); }

  // ---------- modern buildings (OpenStreetMap) are gated by year ----------
  let fadeAt = 0;
  const bmat = () => { const b = world.buildings; return b ? [b.mesh.material, b.keepMesh && b.keepMesh.material].filter(Boolean) : []; };
  function setModern(on, animate) { world.gate = on ? true : false; bmat().forEach(m => { m.transparent = true; m.opacity = on && animate ? 0 : 1; }); fadeAt = on && animate ? performance.now() : 0; W.applyBld(); }

  // ---------- UI ----------
  root.classList.add('tl');
  const bar = el('div'); bar.id = 'tlbar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Timelapse 1877 to today');
  const play = el('button', null, '▶ Play'); play.id = 'tlplay'; play.type = 'button'; play.setAttribute('aria-pressed', 'false'); play.title = 'Play or stop the timelapse (space)';
  const year = el('span', null, '1877'); year.id = 'tlyear'; year.setAttribute('aria-live', 'off');
  const track = el('div'); track.id = 'tltrack'; track.setAttribute('role', 'slider'); track.setAttribute('aria-label', 'Year'); track.setAttribute('aria-valuemin', START); track.setAttribute('aria-valuemax', Math.floor(END)); track.tabIndex = 0;
  const fill = el('div'); fill.id = 'tlfill'; const head = el('div'); head.id = 'tlhead'; track.append(fill);
  const pct = t => ((t - START) / (END - START) * 100);
  const ticks = EV.map((e, i) => { const b = el('button', 'tltick' + (e.status === 'dashed' ? ' dashed' : '')); b.type = 'button'; b.style.left = pct(e.t) + '%'; b.title = e.title; b.setAttribute('aria-label', e.title);
    b.addEventListener('click', ev => { ev.stopPropagation(); seekEvent(i); }); b.addEventListener('pointerdown', ev => ev.stopPropagation()); track.append(b); return b; });
  track.append(head);
  const ends = el('div'); ends.id = 'tlends'; ends.append(el('span', null, '1877'), el('span', null, 'today')); ends.style.top = '-2px'; track.append(ends);
  const speed = el('select'); speed.id = 'tlspd'; speed.setAttribute('aria-label', 'Speed'); [['0.5', '½×'], ['1', '1×'], ['2', '2×'], ['4', '4×']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if (v === '1') o.selected = true; speed.append(o); });
  const loopL = el('label'); const loop = el('input'); loop.type = 'checkbox'; loop.checked = true; loopL.append(loop, 'Loop');
  const parL = el('label'); const parOn = el('input'); parOn.type = 'checkbox'; parOn.checked = true; parL.append(parOn, 'Parcels');
  const exit = el('button', null, 'Exit'); exit.type = 'button'; exit.title = 'Leave the timelapse and return to the normal world'; exit.style.padding = '3px 8px';
  bar.append(play, year, track, speed, loopL, parL, exit); root.append(bar);
  const legend = el('div'); legend.id = 'tllegend'; root.append(legend);
  const modal = el('div'); modal.id = 'tlmodal'; modal.hidden = true; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-live', 'polite'); root.append(modal);

  function updateLegend() {
    legend.replaceChildren(el('b', null, split ? 'Who held the land' : 'Tŷ Mawr land, before 1877'));
    if (!split) { const d = el('div'); const i = el('i', 'd'); i.style.background = TL.holders.bute.col; d.append(i, 'One holding · Bute Estate'); legend.append(d); }
    else polys.forEach(p => { const c = cur[p.id], H = TL.holders[c.h], d = el('div'); const i = el('i', c.s === 'dashed' ? 'd' : ''); i.style.background = rgba(H.col, 0.8); i.style.borderColor = dark(H.col);
      d.append(i, `${TL.parcels[p.id]} · ${H.short}${curNote[p.id] ? ' (' + curNote[p.id] + ')' : ''}`); legend.append(d); });
    legend.append(el('small', null, 'Solid outline: a record has been seen. Dashed: the family’s case, or a record not yet seen.'));
  }

  // ---------- modal ----------
  let modalIdx = -1, dwell = 0, dwellTotal = 1, bar2 = null;
  function dwellFor(e) { return (e.dwell || (6.5 + e.text.length / 110)) / Number(speed.value); }
  function showModal(i) {
    const e = EV[i]; modalIdx = i; modal.hidden = false; modal.className = e.status === 'dashed' ? 'dashed' : ''; modal.replaceChildren();
    const x = el('button', 'tlx', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', closeModal);
    modal.append(x, el('div', 'tld', e.date), el('h3', null, e.title),
      el('span', 'tlst', e.status === 'dashed' ? 'Not established' + (e.reason ? ' · ' + e.reason : '') : 'Record seen'), el('p', null, e.text));
    const ch = Object.entries(e.set || {}); if (ch.length) modal.append(el('p', 'tlch', 'On the map: ' + ch.map(([id, [h]]) => `${TL.parcels[id]} → ${TL.holders[h].short}`).join('; ') + '.'));
    if (e.sources && e.sources.length) { modal.append(el('div', 'tld', 'Archive records')); const ul = el('ul');
      e.sources.forEach(s => { const li = el('li'), a = el('a', null, s.t); a.href = s.u; a.target = '_blank'; a.rel = 'noopener'; li.append(a); ul.append(li); }); modal.append(ul); }
    const nx = el('button', 'tlnext', 'Next event ▸'); nx.type = 'button'; nx.addEventListener('click', () => { dwell = 0.001; }); modal.append(nx);
    bar2 = el('div', 'tlbar2'); modal.append(bar2);
  }
  function closeModal() { modal.hidden = true; modalIdx = -1; dwell = 0; }

  // ---------- control ----------
  let on = false, playing = false, t = START, idx = 0, last = performance.now(), flashT = 0;
  function setPlaying(p) { playing = p; play.textContent = p ? '■ Stop' : '▶ Play'; play.setAttribute('aria-pressed', String(p)); }
  function applyInstant(k) { // state of the world after events 0..k, no animation
    cur = foldTo(k); curNote = noteFor(k); split = k >= 1;
    const dem = demIdx >= 0 && k >= demIdx, mod = modIdx >= 0 && k >= modIdx; houseState(dem, mod); setModern(mod, false); flash = null; flashOn = false; redraw(); updateLegend();
  }
  function trigger(i) {
    const e = EV[i]; cur = foldTo(i); curNote = noteFor(i); if (i >= 1) split = true; if (i === 0) { split = false; applyInstant(0); split = false; redraw(); updateLegend(); }
    if (i === 0) W.flyTo('tl_aerial');
    if (e.demolish) { houseState(false, false); demoAt = performance.now(); startDust(); W.flyTo('tl_house'); }
    else if (i === demIdx + 1 && demIdx >= 0) W.flyTo('tl_aerial');
    if (e.modern) { house.visible = false; church.visible = false; rubble.visible = false; setModern(true, true); }
    const ids = Object.keys(e.set || {}); flash = ids.length ? { ids, until: performance.now() + 2600 } : null; flashOn = !!flash; flashT = performance.now();
    redraw(); updateLegend(); showModal(i); dwellTotal = dwell = dwellFor(e);
  }
  function seek(nt) { // scrub to a year, no modal
    t = Math.max(START, Math.min(END, nt)); let k = -1; EV.forEach((e, i) => { if (e.t <= t) k = i; }); idx = k + 1; closeModal(); applyInstant(k);
    if (k < 1) { split = false; redraw(); updateLegend(); }
  }
  function seekEvent(i) { if (!on) setMode(true); closeModal(); applyInstant(i - 1); if (i < 1) { split = false; } t = EV[i].t; idx = i + 1; trigger(i); }
  function endOfRun() {
    if (loop.checked) { t = START; idx = 0; closeModal(); applyInstant(-1); split = false; redraw(); updateLegend(); trigger(0); idx = 1; }
    else { setPlaying(false); }
  }
  function setMode(m) {
    on = m; root.classList.toggle('tl', m); stage.visible = m; legend.hidden = !m; bar.querySelectorAll('select,label,#tltrack,#tlyear').forEach(n => n.hidden = !m);
    exit.textContent = m ? 'Exit' : '⏱ Timelapse'; exit.title = m ? 'Leave the timelapse and return to the normal world' : 'Open the 1877 → today timelapse';
    if (m) { ovl.custom = parOn.checked ? custom : () => {}; seek(t); } else { setPlaying(false); closeModal(); ovl.custom = null; world.gate = undefined; bmat().forEach(mm => { mm.opacity = 1; }); W.applyBld(); redraw(); }
    root.classList.toggle('tl', true);
  }
  play.addEventListener('click', () => { if (!on) setMode(true); if (!playing) { if (t >= END - 0.01 && idx >= EV.length) { t = START; idx = 0; applyInstant(-1); split = false; redraw(); updateLegend(); trigger(0); idx = 1; } setPlaying(true); last = performance.now(); } else setPlaying(false); });
  exit.addEventListener('click', () => setMode(!on));
  parOn.addEventListener('change', () => { if (on) { ovl.custom = parOn.checked ? custom : () => {}; redraw(); } });
  const trackT = ev => { const r = track.getBoundingClientRect(); return START + Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * (END - START); };
  let dragging = false; track.addEventListener('pointerdown', ev => { dragging = true; track.setPointerCapture(ev.pointerId); seek(trackT(ev)); });
  track.addEventListener('pointermove', ev => { if (dragging) seek(trackT(ev)); }); track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('keydown', ev => { if (ev.key === 'ArrowRight') { seek(t + 1); ev.preventDefault(); } else if (ev.key === 'ArrowLeft') { seek(t - 1); ev.preventDefault(); } });
  addEventListener('keydown', ev => { if (ev.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(ev.target.tagName || '')) { ev.preventDefault(); play.click(); } else if (ev.key === 'Escape' && !modal.hidden) closeModal(); });

  // ---------- the loop ----------
  function frameTl(now) {
    requestAnimationFrame(frameTl); const dt = Math.min(0.1, (now - last) / 1000); last = now; if (!on) return;
    if (playing) {
      if (dwell > 0) { dwell -= dt; if (bar2) bar2.style.transform = `scaleX(${Math.max(0, dwell / dwellTotal)})`;
        if (dwell <= 0) { dwell = 0; if (idx >= EV.length) endOfRun(); } }
      else { t = Math.min(END, t + dt * RATE * Number(speed.value)); const e = EV[idx];
        if (e && t >= e.t) { t = e.t; trigger(idx++); } else if (!e && t >= END) endOfRun(); }
    }
    year.textContent = Math.floor(t) >= Math.floor(END) ? 'Today' : String(Math.floor(t)); fill.style.width = pct(t) + '%'; head.style.left = pct(t) + '%'; track.setAttribute('aria-valuenow', Math.floor(t));
    ticks.forEach((b, i) => b.classList.toggle('on', i === modalIdx));
    if (flash) { if (now > flash.until) { flash = null; flashOn = false; redraw(); } else if (now - flashT > 380) { flashT = now; flashOn = !flashOn; redraw(); } }
    if (demoAt) { const p = Math.min(1, (now - demoAt) / 4200); setDemo(p); if (p >= 1) demoAt = 0; }
    if (dust.visible) { const q = (now - dustAt) / 6000; if (q >= 1) dust.visible = false; else { for (let i = 0; i < NP; i++) { dpos[i * 3] += dvel[i * 3] * dt; dpos[i * 3 + 1] += dvel[i * 3 + 1] * dt; dpos[i * 3 + 2] += dvel[i * 3 + 2] * dt; }
      dust.geometry.attributes.position.needsUpdate = true; dust.material.opacity = Math.min(0.55, q * 6) * (1 - q); dust.material.size = 7 + q * 14; } }
    if (fadeAt) { const k = Math.min(1, (now - fadeAt) / 3000); bmat().forEach(m => { m.opacity = k; }); if (k >= 1) fadeAt = 0; }
  }
  requestAnimationFrame(frameTl);

  window.__tl = { seek, seekEvent, play: () => { if (!playing) play.click(); }, stop: () => { if (playing) play.click(); }, events: EV, get t() { return t; }, get on() { return on; } };
  setMode(Q.get('tl') !== '0'); if (Q.get('tl') === '0') { year.hidden = true; }
  if (on) { applyInstant(-1); split = false; redraw(); updateLegend(); trigger(0); idx = 1; if (Q.get('tl') !== 'pause') setPlaying(true); }
})().catch(e => console.warn('timelapse:', e));
