// Wales 3D world v0.11.0 — a 5× event-to-event narrated historical tour with a compact record banner.
// The 3D world stays orbitable. The bottom banner shows only the selected event year and title; tapping it opens
// the linked event record. Playback jumps directly between catalogued events rather than spending time in empty years.
// Data: timeline.json, family-parcels.geojson and parcels59.json (59 historical plan references; 44 drawn outlines).
// Status shown on every event: solid = a record has been seen; dashed = the family's case or a record not yet seen.
// URL: ?tl=0 starts the normal world with the timelapse off; ?tl=pause opens it paused.
const DATA = (document.querySelector('meta[name=w3d-data]') || {}).content || new URL('data/', import.meta.url).href;
const Q = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ready = () => window.__w3d ? Promise.resolve(window.__w3d) : new Promise(r => addEventListener('w3d:ready', () => r(window.__w3d), { once: true }));

(async function () {
  const [W, TL, GJ, HIST] = await Promise.all([ready(), fetch(DATA + 'timeline.json?v=0.8.0').then(r => r.json()), fetch(DATA + 'family-parcels.geojson?v=0.8.0').then(r => r.json()), fetch(DATA + 'parcels59.json?v=0.8.0').then(r => r.json())]);
  const { THREE, scene, camera, controls, world, ovl } = W;
  const root = $('#w3d'); if (!root) return;
  const EV = TL.events, START = TL.start, END = TL.end;
  const histPlanIdx = EV.findIndex(e => e.id === 'e1824'), histIdx = EV.findIndex(e => e.id === 'e1841');
  const demIdx = EV.findIndex(e => e.demolish), modIdx = EV.findIndex(e => e.modern), splitIdx = EV.findIndex(e => e.id === 'e1877');

  // ---------- parcels in world coordinates ----------
  const polys = GJ.features.map(f => {
    const rings = f.geometry.coordinates.map(r => r.map(([lng, lat]) => W.llToXZ(lat, lng)));
    let sx = 0, sz = 0; rings[0].forEach(p => { sx += p[0]; sz += p[1]; });
    return { id: f.properties.id, rings, c: [sx / rings[0].length, sz / rings[0].length] };
  });

  // Historic plan outlines share the terrain's local X/Z coordinate frame (E-317000, 174000-N).
  const histParcels = (HIST.parcels || []).map(p => {
    const rings = Array.isArray(p.rings) ? p.rings : [];
    const ring = rings[0] || [];
    let sx = 0, sz = 0; ring.forEach(([x, z]) => { sx += x; sz += z; });
    const owners = (p.owner || '').split(';').map(v => v.trim()).filter(Boolean);
    const occupiers = (p.occ || '').split(';').map(v => v.trim()).filter(Boolean);
    const familyCount = occupiers.filter(v => /Williams/i.test(v)).length;
    const familyOccupier = occupiers.length > 0 && familyCount === occupiers.length;
    const mixedFamily = familyCount > 0 && familyCount < occupiers.length;
    const ownerSet = [...new Set(owners)];
    const owner = ownerSet.length === 1 ? ownerSet[0] : '';
    const ownerColour = /Bute/i.test(owner) ? '#c58a2d' : /(Evans|Glebe)/i.test(owner) ? '#8658aa' : /Railway/i.test(owner) ? '#667d9f' : '#7a8794';
    return { ...p, id: String(p.id || p.label || ''), rings, c: ring.length ? [sx / ring.length, sz / ring.length] : null,
      owners, occupiers, familyOccupier, mixedFamily, owner, ownerSet, ownerColour };
  });
  const histDrawn = histParcels.filter(p => p.rings.length && p.rings[0].length >= 3);
  const histBB = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
  histDrawn.forEach(p => p.rings[0].forEach(([x, z]) => { histBB.x0 = Math.min(histBB.x0, x); histBB.x1 = Math.max(histBB.x1, x); histBB.z0 = Math.min(histBB.z0, z); histBB.z1 = Math.max(histBB.z1, z); }));
  const histCx = (histBB.x0 + histBB.x1) / 2, histCz = (histBB.z0 + histBB.z1) / 2;
  const histSpan = Math.max(histBB.x1 - histBB.x0, histBB.z1 - histBB.z0);
  const bb = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
  polys.forEach(p => p.rings[0].forEach(([x, z]) => { bb.x0 = Math.min(bb.x0, x); bb.x1 = Math.max(bb.x1, x); bb.z0 = Math.min(bb.z0, z); bb.z1 = Math.max(bb.z1, z); }));
  const cx = (bb.x0 + bb.x1) / 2, cz = (bb.z0 + bb.z1) / 2, span = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0);
  const ah = world.anchors.tymawr || [cx, cz];
  W.views.tl_aerial = [cx, cz, Math.max(220, span * 1.35), 63, 0];   // tighter north-up framing so standard-bearers read on phones
  W.views.tl_house = [ah[0], ah[1], 105, 24, 140];
  W.views.tl_history = [histCx, histCz, Math.max(2100, histSpan * 1.5), 63, 0];

  // ---------- state of the land for a given event index ----------
  const initial = () => Object.fromEntries(polys.map(p => [p.id, { h: 'unknown', s: 'dashed' }]));
  function foldTo(k) { const cur = initial(); for (let i = 0; i <= k; i++) Object.entries(EV[i].set || {}).forEach(([id, [h, s]]) => { cur[id] = { h, s }; }); return cur; }
  const noteFor = k => { const o = {}; for (let i = 0; i <= k; i++) Object.assign(o, EV[i].note || {}); return o; };
  let cur = foldTo(-1), curNote = {}, split = false, planMode = false, historyInfo = false;

  // ---------- overlay drawing (the terrain's overlay texture) ----------
  const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`; };
  const dark = hex => { const n = parseInt(hex.slice(1), 16); return `rgb(${(n >> 16) * 0.45 | 0},${(n >> 8 & 255) * 0.45 | 0},${(n & 255) * 0.45 | 0})`; };
  let flash = null, flashOn = false;

  function custom(g, X, Y, S) {
    const path = p => { g.beginPath(); p.rings.forEach(r => { r.forEach(([x, z], i) => i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))); g.closePath(); }); };
    if (planMode) {
      histDrawn.forEach(p => {
        path(p);
        const fill = !historyInfo ? TL.holders.unknown.col : p.familyOccupier ? '#21864e' : p.mixedFamily ? '#a78a44' : '#778493';
        g.fillStyle = rgba(fill, historyInfo ? (p.familyOccupier ? 0.34 : 0.13) : 0.055);
        g.fill('evenodd');
        g.lineJoin = 'round'; g.lineWidth = historyInfo ? 2.8 : 2.0;
        g.strokeStyle = historyInfo ? p.ownerColour : 'rgba(220,230,240,.8)';
        const uncertain = !p.read || p.read === 'unclear' || p.read === 'not read' || p.mixedFamily || p.ownerSet.length > 1;
        g.setLineDash(uncertain ? [10, 7] : []); g.stroke(); g.setLineDash([]);
      });
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 11px system-ui,sans-serif';
      histDrawn.forEach(p => {
        const label = p.label || p.id;
        g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.85)'; g.strokeText(label, X(p.c[0]), Y(p.c[1]));
        g.fillStyle = '#fff'; g.fillText(label, X(p.c[0]), Y(p.c[1]));
      });
      if (!historyInfo) {
        const label = '1824 Stewart survey · 59 references · 44 mapped outlines';
        g.font = '700 18px system-ui,sans-serif'; g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,.8)';
        g.strokeText(label, X(histCx), Y(histBB.z0 - 45)); g.fillStyle = '#fff'; g.fillText(label, X(histCx), Y(histBB.z0 - 45));
      }
    } else if (!split) {
      g.beginPath(); polys.forEach(p => p.rings.forEach(r => { r.forEach(([x, z], i) => i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z))); g.closePath(); }));
      g.fillStyle = rgba(TL.holders.unknown.col, 0.28); g.fill('evenodd');
    } else polys.forEach(p => {
      const c = cur[p.id], H = TL.holders[c.h]; path(p); g.fillStyle = rgba(H.col, 0.52); g.fill('evenodd');
      const hot = flashOn && flash && flash.ids.includes(p.id);
      g.lineJoin = 'round'; g.lineWidth = hot ? 9 : 5; g.strokeStyle = hot ? '#fff6a8' : dark(H.col); g.setLineDash(c.s === 'dashed' ? [24, 15] : []); g.stroke(); g.setLineDash([]);
    });
    if (!planMode) {
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 15px system-ui,sans-serif';
      polys.forEach(p => { if (!split && p.id !== 'AM') return; const t = split ? TL.parcels[p.id] : 'Tŷ Mawr · historic extent not mapped';
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(t, X(p.c[0]), Y(p.c[1])); g.fillStyle = '#fff'; g.fillText(t, X(p.c[0]), Y(p.c[1])); });
    }
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


  // ---------- symbolic standard-bearers for changing control and family presence ----------
  // Figures are visual markers only, not evidence that soldiers were physically present.
  const soldierLayer = new THREE.Group(); soldierLayer.visible = false; scene.add(soldierLayer);
  const flagTexture = (welsh) => {
    const c = document.createElement('canvas'); c.width = 320; c.height = 200; const g = c.getContext('2d');
    if (welsh) {
      g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 100); g.fillStyle = '#168447'; g.fillRect(0, 100, 320, 100);
      g.save(); g.translate(160, 100); g.fillStyle = '#d52835';
      g.beginPath(); g.moveTo(-82, 54); g.bezierCurveTo(-44, 45, -40, 16, -7, 6); g.bezierCurveTo(24, -2, 26, -32, 10, -48);
      g.bezierCurveTo(31, -44, 48, -30, 46, -11); g.lineTo(68, -28); g.lineTo(60, -2); g.lineTo(86, 3);
      g.lineTo(59, 15); g.lineTo(73, 35); g.lineTo(43, 25); g.bezierCurveTo(30, 54, -5, 58, -26, 41);
      g.bezierCurveTo(-42, 66, -62, 68, -82, 54); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-4, -42); g.lineTo(-28, -63); g.lineTo(-20, -38); g.lineTo(-43, -49); g.lineTo(-25, -21); g.fill();
      g.beginPath(); g.moveTo(29, -37); g.lineTo(50, -59); g.lineTo(46, -31); g.fill(); g.restore();
    } else {
      g.fillStyle = '#17345f'; g.fillRect(0, 0, 320, 200); g.lineCap = 'square';
      g.strokeStyle = '#fff'; g.lineWidth = 34; g.beginPath(); g.moveTo(0, 0); g.lineTo(320, 200); g.moveTo(320, 0); g.lineTo(0, 200); g.stroke();
      g.strokeStyle = '#c9233a'; g.lineWidth = 13; g.beginPath(); g.moveTo(0, 0); g.lineTo(320, 200); g.moveTo(320, 0); g.lineTo(0, 200); g.stroke();
      g.fillStyle = '#fff'; g.fillRect(0, 77, 320, 46); g.fillRect(137, 0, 46, 200);
      g.fillStyle = '#c9233a'; g.fillRect(0, 88, 320, 24); g.fillRect(148, 0, 24, 200);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  };
  const flags = {
    welsh: new THREE.SpriteMaterial({ map: flagTexture(true), transparent: false }),
    union: new THREE.SpriteMaterial({ map: flagTexture(false), transparent: false })
  };
  const soldierMaterials = {
    family: new THREE.MeshStandardMaterial({ color: 0x20844a, roughness: 0.8 }),
    familyDark: new THREE.MeshStandardMaterial({ color: 0x145d34, roughness: 0.85 }),
    red: new THREE.MeshStandardMaterial({ color: 0xa72836, roughness: 0.8 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x233f70, roughness: 0.85 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe8e5dc, roughness: 0.8 }),
    boots: new THREE.MeshStandardMaterial({ color: 0x29241f, roughness: 1 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd5a17b, roughness: 0.95 })
  };
  const soldierGeometry = {
    boot: new THREE.BoxGeometry(1.25, 0.62, 1.8), leg: new THREE.CylinderGeometry(0.48, 0.58, 2.0, 7),
    torso: new THREE.CylinderGeometry(0.92, 1.18, 2.8, 8), head: new THREE.SphereGeometry(0.78, 10, 8),
    cap: new THREE.CylinderGeometry(0.86, 0.92, 0.42, 8), arm: new THREE.CylinderGeometry(0.34, 0.42, 2.15, 7),
    pole: new THREE.CylinderGeometry(0.075, 0.095, 7.5, 6), flag: new THREE.PlaneGeometry(4.5, 2.8),
    strap: new THREE.BoxGeometry(2.15, 0.28, 0.12), belt: new THREE.BoxGeometry(2.15, 0.26, 1.75)
  };
  function soldierMesh(group, geometry, material, x, y, z, rx, ry, rz) {
    const m = new THREE.Mesh(geometry, material); m.position.set(x || 0, y || 0, z || 0);
    m.rotation.set(rx || 0, ry || 0, rz || 0); group.add(m); return m;
  }
  function pointForParcel(id, slot, radius) {
    const p = polys.find(v => v.id === id) || polys[0];
    const a = (slot || 0) * 2.399 + (radius ? 0.6 : 0), r = radius ? radius * (slot ? 8 : 3) : 0;
    return [p.c[0] + Math.cos(a) * r, p.c[1] + Math.sin(a) * r];
  }
  function createSoldier(kind, parcelId, slot, holder, plant, anchor, figureScale) {
    const family = kind === 'family', group = new THREE.Group();
    const jacket = family ? soldierMaterials.family : soldierMaterials.red;
    const trousers = family ? soldierMaterials.familyDark : soldierMaterials.blue;
    soldierMesh(group, soldierGeometry.boot, soldierMaterials.boots, -0.5, 0.35, 0.15);
    soldierMesh(group, soldierGeometry.boot, soldierMaterials.boots, 0.5, 0.35, 0.15);
    soldierMesh(group, soldierGeometry.leg, trousers, -0.5, 1.45, 0);
    soldierMesh(group, soldierGeometry.leg, trousers, 0.5, 1.45, 0);
    soldierMesh(group, soldierGeometry.torso, jacket, 0, 3.45, 0);
    soldierMesh(group, soldierGeometry.head, soldierMaterials.skin, 0, 5.35, 0.02);
    soldierMesh(group, soldierGeometry.cap, family ? soldierMaterials.familyDark : soldierMaterials.blue, 0, 6.05, 0);
    soldierMesh(group, soldierGeometry.arm, jacket, -1.15, 3.75, 0, 0, 0, -0.18);
    soldierMesh(group, soldierGeometry.arm, jacket, 1.15, 3.9, 0, 0, 0, 0.38);
    if (!family) {
      soldierMesh(group, soldierGeometry.strap, soldierMaterials.white, -0.05, 3.55, 0.94, 0, 0, -0.55);
      soldierMesh(group, soldierGeometry.belt, soldierMaterials.white, 0, 2.35, 0);
    }
    soldierMesh(group, soldierGeometry.pole, soldierMaterials.boots, 1.3, 4.25, -0.05);
    const flagGroup = new THREE.Group(); flagGroup.position.set(1.3, plant ? 4.3 : 6.1, -0.05); group.add(flagGroup);
    const flag = new THREE.Sprite(family ? flags.welsh : flags.union); flag.position.set(2.3, 0, 0); flag.scale.set(6.2, 3.9, 1); flagGroup.add(flag);
    group.scale.setScalar(figureScale || 3.0);
    const pos = anchor || pointForParcel(parcelId, slot, family ? 1 : 0);
    group.position.set(pos[0], W.hAt(pos[0], pos[1]) + (plant ? -1.2 : 0), pos[1]); soldierLayer.add(group);
    return { group, flag, flagGroup, kind, parcelId, holder, slot: slot || 0, targetId: parcelId,
      from: null, to: null, moveAt: 0, moveMs: 0, plantAt: plant ? performance.now() : 0,
      flagStartY: plant ? 4.3 : 6.1, flagTargetY: 6.1, flagScaleY: 3.9, phase: (slot || 0) * 1.7 + (family ? 0.4 : 1.2) };
  }
  function moveSoldier(actor, x, z, duration) {
    actor.from = actor.group.position.clone(); actor.to = new THREE.Vector3(x, W.hAt(x, z) + 0.35, z);
    actor.moveAt = performance.now(); actor.moveMs = duration || 1800;
  }
  function placeSoldier(actor, x, z) {
    actor.group.position.set(x, W.hAt(x, z) + 0.35, z); actor.from = actor.to = null; actor.moveAt = 0;
  }
  const familyStartIdx = EV.findIndex(e => Array.isArray(e.occupancy && e.occupancy.family));
  const familyExitIdx = demIdx;
  const familyStartIds = familyStartIdx >= 0
    ? EV[familyStartIdx].occupancy.family.filter(id => polys.some(p => p.id === id)) : [];
  const familyActors = [], britishActors = {}, historicalActors = [];
  let historicalActorsBuilt = false;
  function familyOccupancyAt(k) {
    let current = [];
    for (let j = 0; j <= k; j++) if (Array.isArray(EV[j].occupancy && EV[j].occupancy.family)) current = EV[j].occupancy.family.slice();
    return current;
  }
  function familyTargetFor(actor, slot, k) {
    if (familyExitIdx >= 0 && k >= familyExitIdx) return { id: 'off', off: true };
    const occupied = familyOccupancyAt(k).filter(id => polys.some(p => p.id === id));
    const id = occupied.length ? occupied[Math.min(slot, occupied.length - 1)] : 'AM';
    return { id, off: false };
  }
  function offLandPoint(slot) { return [cx - span * 0.78 + (slot - 1) * 8, cz + span * 0.78 + (slot - 1) * 6]; }
  function removeSoldier(actor) { if (actor && actor.group.parent) actor.group.parent.remove(actor.group); }

  function syncSoldiers(k, animate) {
    const stateAt = foldTo(k), historicPlan = planMode, historicInfo = historyInfo;
    if (k < familyStartIdx) {
      while (familyActors.length) removeSoldier(familyActors.pop());
    } else {
      while (familyActors.length < familyStartIds.length) {
        const n = familyActors.length, id = familyStartIds[n];
        familyActors.push(createSoldier('family', id, n, 'Williams family · occupation', false));
      }
      familyActors.forEach((actor, n) => {
        actor.group.visible = !historicPlan;
        const target = familyTargetFor(actor, n, k);
        const pt = target.off ? offLandPoint(n) : pointForParcel(target.id, n, 1);
        if (actor.targetId !== target.id) {
          actor.targetId = target.id;
          if (animate) moveSoldier(actor, pt[0], pt[1], target.off ? 3600 : 1900);
          else placeSoldier(actor, pt[0], pt[1]);
        } else if (!animate && !actor.from) placeSoldier(actor, pt[0], pt[1]);
      });
    }
    polys.forEach((p, n) => {
      const h = stateAt[p.id] ? stateAt[p.id].h : 'unknown';
      if (h === 'family' || h === 'unknown') {
        if (britishActors[p.id]) { removeSoldier(britishActors[p.id]); delete britishActors[p.id]; }
        return;
      }
      if (!britishActors[p.id] || britishActors[p.id].holder !== h) {
        if (britishActors[p.id]) removeSoldier(britishActors[p.id]);
        britishActors[p.id] = createSoldier('british', p.id, n, h, animate);
      }
    });
    Object.values(britishActors).forEach(actor => { actor.group.visible = !historicPlan; });

    if (historicInfo && !historicalActorsBuilt) {
      histDrawn.forEach((p, n) => {
        const spread = 4.5;
        if (p.familyOccupier) {
          historicalActors.push(createSoldier('family', 'historic-family-' + p.id, n, 'Williams family · occupier c.1841',
            false, [p.c[0] - spread, p.c[1] - spread], 1.65));
        }
        p.ownerSet.forEach((owner, k) => {
          historicalActors.push(createSoldier('british', 'historic-owner-' + p.id, n, owner,
            !!animate, [p.c[0] + spread + k * 2, p.c[1] + spread], 1.65));
        });
      });
      historicalActorsBuilt = true;
    }
    historicalActors.forEach(actor => { actor.group.visible = historicInfo; });
  }
  function updateSoldierActors(now) {
    familyActors.concat(Object.values(britishActors), historicalActors).forEach(actor => {
      if (actor.from && actor.to) {
        const p = Math.min(1, (now - actor.moveAt) / actor.moveMs), e = p * p * (3 - 2 * p);
        actor.group.position.lerpVectors(actor.from, actor.to, e);
        actor.group.position.y += Math.sin(p * Math.PI * 8) * (1 - p) * 0.35;
        if (p >= 1) { actor.from = actor.to = null; actor.moveAt = 0; }
      }
      if (actor.plantAt) {
        const p = Math.min(1, (now - actor.plantAt) / 1050), e = p * p * (3 - 2 * p);
        actor.flagGroup.position.y = actor.flagStartY + (actor.flagTargetY - actor.flagStartY) * e;
        actor.flag.scale.y = actor.flagScaleY * Math.max(0.04, e);
        if (p >= 1) { actor.plantAt = 0; actor.flagGroup.position.y = actor.flagTargetY; actor.flag.scale.y = actor.flagScaleY; }
      }
      const dx = camera.position.x - actor.group.position.x, dz = camera.position.z - actor.group.position.z;
      actor.flag.rotation.z = Math.sin(now / 620 + actor.phase) * 0.035;
    });
  }

  // ---------- modern buildings (OpenStreetMap) are gated by year ----------
  let fadeAt = 0;
  const bmat = () => { const b = world.buildings; return b ? [b.mesh.material, b.keepMesh && b.keepMesh.material].filter(Boolean) : []; };
  function setModern(on, animate) { world.gate = on ? true : false; bmat().forEach(m => { m.transparent = true; m.opacity = on && animate ? 0 : 1; }); fadeAt = on && animate ? performance.now() : 0; W.applyBld(); }

  // ---------- UI ----------
  root.classList.add('tl');
  const bar = el('div'); bar.id = 'tlbar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Timelapse 1535 to today');
  const play = el('button', null, '▶ Play'); play.id = 'tlplay'; play.type = 'button'; play.setAttribute('aria-pressed', 'false'); play.title = 'Play or stop the timelapse (space)';
  const year = el('span', null, '1535'); year.id = 'tlyear'; year.setAttribute('aria-live', 'off');
  const track = el('div'); track.id = 'tltrack'; track.setAttribute('role', 'slider'); track.setAttribute('aria-label', 'Year'); track.setAttribute('aria-valuemin', START); track.setAttribute('aria-valuemax', Math.floor(END)); track.tabIndex = 0;
  const fill = el('div'); fill.id = 'tlfill'; const head = el('div'); head.id = 'tlhead'; track.append(fill);
  const pct = t => ((t - START) / (END - START) * 100);
  const ticks = EV.map((e, i) => { const b = el('button', 'tltick' + (e.status === 'dashed' ? ' dashed' : '')); b.type = 'button'; b.style.left = pct(e.t) + '%'; b.title = e.title; b.setAttribute('aria-label', e.title);
    b.addEventListener('click', ev => { ev.stopPropagation(); seekEvent(i); }); b.addEventListener('pointerdown', ev => ev.stopPropagation()); track.append(b); return b; });
  track.append(head);
  const ends = el('div'); ends.id = 'tlends'; ends.append(el('span', null, '1535'), el('span', null, 'today')); ends.style.top = '-2px'; track.append(ends);
  const speed = el('select'); speed.id = 'tlspd'; speed.setAttribute('aria-label', 'Speed'); [['1', '1×'], ['2', '2×'], ['4', '4×'], ['5', '5×']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if (v === '5') o.selected = true; speed.append(o); });
  const speedL = el('label', 'tloption'); speedL.append(el('span', null, 'Speed'), speed);
  const loopL = el('label', 'tloption'); const loop = el('input'); loop.type = 'checkbox'; loop.checked = true; loopL.append(loop, 'Loop');
  const parL = el('label', 'tloption'); const parOn = el('input'); parOn.type = 'checkbox'; parOn.checked = true; parL.append(parOn, 'Parcels');
  let narrationOn = true, audioUnlocked = false, currentEvent = -1, voiceSequence = 0;
  const VOICE_ENDPOINT = 'https://cedwyn-timelapse-voice.righteous.workers.dev/speak';
  const voiceAudio = el('audio'); voiceAudio.id = 'tlvoiceaudio'; voiceAudio.preload = 'none'; voiceAudio.crossOrigin = 'anonymous';
  voiceAudio.playsInline = true; voiceAudio.setAttribute('playsinline', ''); voiceAudio.setAttribute('webkit-playsinline', '');
  voiceAudio.addEventListener('error', () => { narrationStatus.textContent = 'Audio failed to load · tap Hear headline to retry'; hearNowBtn.textContent = '🔊 Retry'; });
  root.append(voiceAudio);

  // ---------- floating spectral tour guide ----------
  // This is real Three.js geometry in the world, positioned in the camera's near field so it
  // remains beside the landscape as the visitor orbits. Its mouth is driven by the actual TTS
  // audio waveform (Web Audio analyser), not by a timer or a decorative speaking loop.
  const guideLayer = new THREE.Group(); guideLayer.visible = false; scene.add(guideLayer);
  const guide = new THREE.Group(); guideLayer.add(guide);
  const ghostMat = new THREE.MeshStandardMaterial({ color: 0xdaf7ff, emissive: 0x55c9e8, emissiveIntensity: 0.38,
    roughness: 0.3, metalness: 0, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x76ddff, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide });
  const faceMat = new THREE.MeshBasicMaterial({ color: 0x102638 });
  const aura = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glowMat);
  aura.scale.set(1.35, 2.0, 0.72); aura.position.y = 0.25; guide.add(aura);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.82, 18, 14), ghostMat);
  torso.scale.set(1.02, 1.18, 0.68); torso.position.y = 0.18; guide.add(torso);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.88, 1.8, 20, 1), ghostMat);
  tail.rotation.z = Math.PI; tail.position.y = -1.12; guide.add(tail);
  const guideHead = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 16), ghostMat);
  guideHead.position.set(0, 1.43, 0.02); guide.add(guideHead);
  const armGeo = new THREE.SphereGeometry(0.25, 14, 10);
  const leftArm = new THREE.Mesh(armGeo, ghostMat); leftArm.scale.set(0.92, 2.45, 0.9);
  leftArm.position.set(-0.86, 0.35, 0.02); leftArm.rotation.z = -0.55; guide.add(leftArm);
  const rightArm = new THREE.Mesh(armGeo, ghostMat); rightArm.scale.set(0.92, 2.45, 0.9);
  rightArm.position.set(0.86, 0.35, 0.02); rightArm.rotation.z = 0.55; guide.add(rightArm);
  const eyeGeo = new THREE.SphereGeometry(0.085, 10, 8);
  const leftEye = new THREE.Mesh(eyeGeo, faceMat); leftEye.position.set(-0.22, 1.52, 0.56); guide.add(leftEye);
  const rightEye = new THREE.Mesh(eyeGeo, faceMat); rightEye.position.set(0.22, 1.52, 0.56); guide.add(rightEye);
  const guideMouth = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), faceMat);
  guideMouth.position.set(0, 1.25, 0.585); guideMouth.scale.set(0.18, 0.04, 0.055); guide.add(guideMouth);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.025, 6, 28),
    new THREE.MeshBasicMaterial({ color: 0x9feeff, transparent: true, opacity: 0.52, depthWrite: false }));
  halo.rotation.x = Math.PI / 2; halo.position.y = 2.15; guide.add(halo);
  let guidePhone = matchMedia('(max-width: 700px)').matches;
  const guideOffset = new THREE.Vector3();
  addEventListener('resize', () => { guidePhone = matchMedia('(max-width: 700px)').matches; });

  let voiceContext = null, voiceAnalyser = null, voiceSource = null, voiceSamples = null;
  let voiceMeterUnavailable = false, guideLevel = 0;
  function enableVoiceMeter() {
    if (voiceMeterUnavailable) return false;
    if (!voiceContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) { voiceMeterUnavailable = true; return false; }
      try {
        voiceContext = new AudioCtx();
        voiceAnalyser = voiceContext.createAnalyser(); voiceAnalyser.fftSize = 256;
        voiceAnalyser.smoothingTimeConstant = 0.42;
        voiceSource = voiceContext.createMediaElementSource(voiceAudio);
        voiceSource.connect(voiceAnalyser); voiceAnalyser.connect(voiceContext.destination);
        voiceSamples = new Uint8Array(voiceAnalyser.fftSize);
      } catch (err) {
        voiceMeterUnavailable = true; console.warn('Ghost guide audio analyser unavailable:', err); return false;
      }
    }
    if (voiceContext.state === 'suspended') voiceContext.resume().catch(err => console.warn('Ghost guide audio context:', err));
    return !!voiceAnalyser;
  }
  function updateGuide(now) {
    // Keep the guide just beyond the camera near plane, scaling with the view so it remains
    // visible both in the close farmhouse view and in the high, whole-estate overview.
    const distance = Math.max(23, camera.near + 15);
    const halfHeight = distance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const halfWidth = halfHeight * camera.aspect;
    guideOffset.set(halfWidth * (guidePhone ? 0.65 : 0.48), -halfHeight * 0.32, -distance);
    guide.scale.setScalar(halfHeight * 0.085);
    camera.updateMatrixWorld(true);
    guideLayer.position.copy(guideOffset).applyMatrix4(camera.matrixWorld);
    guideLayer.quaternion.copy(camera.quaternion);
    const speaking = !voiceAudio.paused && !voiceAudio.ended;
    let amplitude = 0;
    if (speaking && voiceAnalyser && voiceContext && voiceContext.state === 'running') {
      voiceAnalyser.getByteTimeDomainData(voiceSamples);
      let sum = 0;
      for (let i = 0; i < voiceSamples.length; i++) { const v = (voiceSamples[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / voiceSamples.length);
      amplitude = Math.max(0, Math.min(1, (rms - 0.012) * 12));
    } else if (speaking) {
      // Graceful fallback for browsers without Web Audio: use the real media clock, never an idle loop.
      amplitude = 0.16 + 0.16 * Math.abs(Math.sin(voiceAudio.currentTime * 14));
    }
    guideLevel += (amplitude - guideLevel) * (amplitude > guideLevel ? 0.56 : 0.22);
    guideMouth.scale.set(0.18 + guideLevel * 0.045, speaking ? 0.035 + guideLevel * 0.27 : 0.035, 0.055);
    guideMouth.position.y = 1.25 - guideLevel * 0.035;
    guide.position.y = Math.sin(now * 0.00135) * 0.12;
    guide.rotation.y = Math.sin(now * 0.00065) * 0.055;
    guide.rotation.z = Math.sin(now * 0.0009) * 0.035;
    leftArm.rotation.z = -0.55 + Math.sin(now * 0.0012) * 0.07;
    rightArm.rotation.z = 0.55 - Math.sin(now * 0.0012) * 0.07;
  }

  const narrationStatus = el('small', 'tlnarrationstatus', 'Tap Hear to enable narration · ghost guide follows the audio');
  const hearNowBtn = el('button', 'tlvoicebtn', '🔊 Hear');
  hearNowBtn.id = 'tlvoice'; hearNowBtn.type = 'button'; hearNowBtn.title = 'Enable narration and play the current event headline';
  voiceAudio.addEventListener('ended', () => { hearNowBtn.textContent = '🔊 Hear'; narrationStatus.textContent = 'Ready · ghost guide follows the next narration'; });
  const narrationBtn = el('button', 'tloptionbtn', 'Auto narration: On'); narrationBtn.type = 'button';
  narrationBtn.title = 'Turn automatic narration on or off';
  const exit = el('button', 'tloptionbtn', 'Exit'); exit.type = 'button'; exit.title = 'Leave the timelapse and return to the normal world';
  const more = el('details'); more.id = 'tlmore'; more.append(el('summary', null, 'Options'));
  const moreBody = el('div'); moreBody.className = 'tlmorebody'; moreBody.append(speedL, loopL, parL, narrationBtn, exit); more.append(moreBody);
  bar.append(play, hearNowBtn, year, track, more); root.append(bar);
  const legend = el('details'); legend.id = 'tllegend'; const legendTitle = el('summary', null, 'Land & standards');
  const legendBody = el('div'); legendBody.className = 'tllegendbody'; legend.append(legendTitle, legendBody); moreBody.append(legend);
  legend.open = false; more.open = false;
  const layerDetails = $('#w3dctl'); if (layerDetails) layerDetails.open = false;
  const creditDetails = $('#w3dcred'); if (creditDetails) creditDetails.open = false;
  const modal = el('div'); modal.id = 'tlmodal'; modal.hidden = true; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-live', 'polite'); root.append(modal);
  const banner = el('button', 'tlbanner'); banner.id = 'tlbanner'; banner.type = 'button'; banner.hidden = true;
  banner.setAttribute('aria-haspopup', 'dialog'); banner.setAttribute('aria-controls', 'tlmodal'); banner.setAttribute('aria-live', 'polite');
  banner.title = 'Open the current historical event record'; root.append(banner);
  banner.addEventListener('click', () => { if (currentEvent >= 0) { if (playing) setPlaying(false); showModal(currentEvent, true); } });


  function updateLegend() {
    legendBody.replaceChildren();
    if (planMode) {
      legendBody.append(el('b', null, historyInfo ? 'c.1841 · occupation and landowner join' : '1824 · Stewart estate-plan outlines'));
      if (historyInfo) {
        const rows = [
          ['#21864e', 'Williams occupier recorded across this mapped group'],
          ['#c58a2d', 'Bute Estate · apportionment landowner column'],
          ['#8658aa', 'Evans / glebe · apportionment landowner column'],
          ['#778493', 'Other / mixed occupiers or ownership not uniquely joined']
        ];
        rows.forEach(([colour,label]) => { const d=el('div'); const sw=el('i','d'); sw.style.background=colour; d.append(sw,label); legendBody.append(d); });
        legendBody.append(el('small', null, histDrawn.length + ' outlines drawn from ' + histParcels.length + ' plan references; ' + (histParcels.length - histDrawn.length) + ' are unread or not placed. Labels identify plan references, not always one-to-one tithe plots. Dashed boundaries indicate unread, mixed or composite joins. Apportionment “owner” is not proof of registered freehold. Green figures mark Williams occupation; Union Jack standards mark the recorded landowner / estate interest.'));
      } else {
        const d=el('div'),sw=el('i','d'); sw.style.background=TL.holders.unknown.col; d.append(sw,'Historical estate-plan outlines · owner and occupier state not yet applied'); legendBody.append(d);
        legendBody.append(el('small',null,'The estate-plan reconstruction identifies ' + histParcels.length + ' references, of which ' + histDrawn.length + ' have drawable outlines. The remaining entries are unread or not placed; they stay listed rather than being given invented boundaries.'));
      }
    } else if (!split) {
      legendBody.append(el('b', null, 'Earlier landscape · extent unresolved'));
      const d = el('div'); const i = el('i', 'd'); i.style.background = rgba(TL.holders.unknown.col, 0.28); d.append(i, 'Historic farm extent not mapped; lordship and freehold records are separate'); legendBody.append(d);
    } else {
      legendBody.append(el('b', null, 'Mapped parties and interests'));
      polys.forEach(p => { const c = cur[p.id], H = TL.holders[c.h], d = el('div'); const i = el('i', c.s === 'dashed' ? 'd' : ''); i.style.background = rgba(H.col, 0.8); i.style.borderColor = dark(H.col);
        d.append(i, TL.parcels[p.id] + ' · ' + H.short + (curNote[p.id] ? ' (' + curNote[p.id] + ')' : '')); legendBody.append(d); });
    }
    legendBody.append(el('small', null, 'Colours show parties or interests identified in dated sources; they are not blanket findings of freehold title. Green figures represent Williams occupation, separately from title. Red/blue/white figures show other recorded parties or interests. Court orders, tenancy offers and village-green registration do not themselves convey freehold. All figures and flags are symbolic.'));
  }
  // ---------- modal ----------
  let modalIdx = -1, dwell = 0, dwellTotal = 1, bar2 = null;
  function dwellFor(e) { return (e.dwell || (6.5 + e.text.length / 110)) / Number(speed.value); }
  function updateBanner(i) {
    const e = Number.isInteger(i) && i >= 0 ? EV[i] : null;
    if (!e) { banner.hidden = true; return; }
    const yearLabel = e.id === 'now' ? 'Today' : String(Math.floor(e.t));
    const titleText = e.title.replace(/^(?:By\s+)?\d{4}(?:[–-]\d{2,4})?\s*·\s*/, '').replace(/^Today\s*·\s*/, '');
    banner.classList.toggle('dashed', e.status === 'dashed');
    banner.replaceChildren(
      el('span', 'tlbanner-year', yearLabel),
      el('span', 'tlbanner-title', titleText),
      el('span', 'tlbanner-open', 'View record ›')
    );
    banner.setAttribute('aria-label', 'Open ' + e.date + ': ' + e.title);
    banner.hidden = false;
  }
  function showModal(i, open = true) {
    const e = EV[i]; modalIdx = i; modal.hidden = !open; modal.className = e.status === 'dashed' ? 'dashed' : ''; modal.replaceChildren();
    const x = el('button', 'tlx', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.addEventListener('click', closeModal);
    modal.append(x, el('div', 'tld', e.date + (e.category ? ' · ' + e.category : '')), el('h3', null, e.title),
      el('span', 'tlst', e.status === 'dashed' ? 'Reconstructed / source gap' + (e.reason ? ' · ' + e.reason : '') : 'Source record seen'));
    const hearEvent = el('button', 'tlhear', '🔊 Hear this headline'); hearEvent.type = 'button';
    hearEvent.addEventListener('click', () => { audioUnlocked = true; narrationOn = true; speakHeadline(e.id, true); });
    modal.append(hearEvent, narrationStatus);
    const detail = el('details', 'tleventdetails'); detail.open = true; detail.append(el('summary', null, 'Record details & archive sources'));
    const body = el('div', 'tleventbody'); body.append(el('p', null, e.text));
    const ch = Object.entries(e.set || {}); if (ch.length) body.append(el('p', 'tlch', 'Mapped party / interest: ' + ch.map(entry => TL.parcels[entry[0]] + ' → ' + TL.holders[entry[1][0]].short + ' [' + (entry[1][1] === 'dashed' ? 'reconstructed / not fully established' : 'source seen') + ']').join('; ') + '.'));
    if (e.occupancy && Array.isArray(e.occupancy.family)) body.append(el('p', 'tlch', 'Williams family occupation shown on: ' + (e.occupancy.family.length ? e.occupancy.family.map(id => TL.parcels[id] || id).join('; ') : 'no longer on the land') + (e.occupancy.note ? '. ' + e.occupancy.note : '') + '.'));

    if (e.id === 'e1841') {
      const register = el('details', 'tlparcelregister');
      register.append(el('summary', null, 'Full historic parcel register · ' + histDrawn.length + ' mapped outlines / ' + histParcels.length + ' total references'));
      register.append(el('p', null, 'The list preserves every plan reference, including entries without drawable outlines. A plan reference may combine more than one tithe plot; composite rows are not divided into invented geometries. “Landowner” and “occupier” are the joined apportionment fields, not a modern title-register determination.'));
      const list = el('div', 'tlregisterlist');
      histParcels.forEach(p => {
        const row = el('div', 'tlregisterrow');
        const ident = el('strong', null, 'Plan ' + (p.label || p.id || 'unread') + ' · tithe plot ' + (p.plot || 'not joined'));
        const use = el('span', null, (p.use || 'Use not stated') + ' · ' + (p.tarea || (p.area != null ? Number(p.area).toFixed(2) + ' ha (reconstructed area)' : 'Area not stated')));
        const status = p.rings && p.rings.length ? 'Outline mapped' : (p.status || 'Not placed / unread');
        const detailText = 'Landowner: ' + (p.owner || 'not joined / composite') + ' · Occupier: ' + (p.occ || 'not joined') + ' · ' + status + (p.src ? ' · ' + p.src : '');
        row.append(ident, use, el('small', null, detailText)); list.append(row);
      });
      register.append(list); body.append(register);
    }
    if (e.sources && e.sources.length) { body.append(el('div', 'tld', 'Archive records')); const ul = el('ul');
      e.sources.forEach(s => { const li = el('li'), a = el('a', null, s.t); a.href = s.u; a.target = '_blank'; a.rel = 'noopener'; li.append(a); ul.append(li); }); body.append(ul); }
    const nx = el('button', 'tlnext', 'Next event ▸'); nx.type = 'button'; nx.addEventListener('click', () => { dwell = 0.001; }); body.append(nx);
    detail.append(body); modal.append(detail);
    bar2 = el('div', 'tlbar2'); modal.append(bar2);
  }
  function closeModal() { modal.hidden = true; modalIdx = -1; }

  // Play the CORS-enabled voice Worker audio directly from the user's tap.
  // Calling HTMLMediaElement.play() before awaiting anything preserves mobile user activation.
  function speakHeadline(eventId, force = false) {
    if ((!narrationOn && !force) || !eventId) return;
    enableVoiceMeter();
    const url = VOICE_ENDPOINT + '?id=' + encodeURIComponent(eventId) + '&v=2';
    narrationStatus.textContent = 'Loading Helios voice…'; hearNowBtn.textContent = '⏳ Loading';
    voiceAudio.pause();
    voiceAudio.removeAttribute('src');
    voiceAudio.src = url;
    voiceAudio.load();
    const attempt = voiceAudio.play();
    if (attempt && typeof attempt.then === 'function') {
      attempt.then(() => {
        narrationStatus.textContent = 'Playing · ghost guide speaking in sync'; hearNowBtn.textContent = '🔊 Playing';
      }).catch(err => {
        narrationStatus.textContent = 'Tap Hear headline to allow audio (' + (err && err.name ? err.name : 'blocked') + ')'; hearNowBtn.textContent = '🔊 Retry';
        console.warn('Timelapse AI audio playback:', err);
      });
    }
  }
  function narrateHeadline(eventId) {
    // Do not call the voice Worker just because the page was opened: a cache miss can invoke
    // Workers AI. The visitor's first explicit Hear/Play gesture unlocks narration for the tour.
    if (!audioUnlocked) {
      narrationStatus.textContent = 'Tap Hear to enable narration · the guide will then follow each event';
      hearNowBtn.textContent = '🔊 Hear';
      return;
    }
    speakHeadline(eventId);
  }
  function currentHeadlineId() {
    if (currentEvent >= 0) return EV[currentEvent].id;
    const next = EV.find(e => e.t >= t - 0.01);
    return next ? next.id : EV[EV.length - 1].id;
  }
  hearNowBtn.addEventListener('click', () => {
    audioUnlocked = true; narrationOn = true;
    speakHeadline(currentHeadlineId(), true);
  });
  narrationBtn.addEventListener('click', () => {
    narrationOn = !narrationOn;
    narrationBtn.textContent = narrationOn ? 'Auto narration: On' : 'Auto narration: Off';
    if (!narrationOn) { voiceAudio.pause(); narrationStatus.textContent = 'Auto narration off · use Hear to play a headline'; }
    else { narrationStatus.textContent = 'Auto narration on · tap Hear headline to test'; }
  });

  // ---------- control ----------
  let on = false, playing = false, t = START, idx = 0, last = performance.now(), flashT = 0;
  function setPlaying(p) { playing = p; play.textContent = p ? 'Ⅱ Pause' : '▶ Play'; play.setAttribute('aria-pressed', String(p)); }
  function applyInstant(k) { // state of the world after events 0..k, no animation
    const wasPlan = planMode; cur = foldTo(k); curNote = noteFor(k); split = k >= splitIdx;
    planMode = k >= histPlanIdx && k < splitIdx; historyInfo = k >= histIdx && k < splitIdx;
    if (planMode && !wasPlan) W.flyTo('tl_history'); else if (!planMode && wasPlan) W.flyTo('tl_aerial');
    const dem = demIdx >= 0 && k >= demIdx, mod = modIdx >= 0 && k >= modIdx; houseState(dem, mod); setModern(mod, false); syncSoldiers(k, false); flash = null; flashOn = false; redraw(); updateLegend();
  }
  function trigger(i) {
    const e = EV[i]; currentEvent = i; cur = foldTo(i); curNote = noteFor(i); split = i >= splitIdx;
    planMode = i >= histPlanIdx && i < splitIdx; historyInfo = i >= histIdx && i < splitIdx; if (i === 0) { split = false; applyInstant(0); split = false; redraw(); updateLegend(); }
    if (i === 0 || i === splitIdx) W.flyTo('tl_aerial');
    if (i === histPlanIdx || i === histIdx) W.flyTo('tl_history');
    if (e.demolish) { houseState(false, false); demoAt = performance.now(); startDust(); W.flyTo('tl_house'); }
    else if (i === demIdx + 1 && demIdx >= 0) W.flyTo('tl_aerial');
    if (e.modern) { house.visible = false; church.visible = false; rubble.visible = false; setModern(true, true); }
    const ids = Object.keys(e.set || {}); flash = ids.length ? { ids, until: performance.now() + 2600 } : null; flashOn = !!flash; flashT = performance.now();
    syncSoldiers(i, true); redraw(); updateLegend();
    if (!modal.hidden) closeModal();
    updateBanner(i); narrateHeadline(e.id); dwellTotal = dwell = dwellFor(e);
  }
  function seek(nt) { // scrub to a year, no modal; manual seeking pauses and clears the old event dwell
    if (playing) setPlaying(false); dwell = 0; dwellTotal = 1;
    t = Math.max(START, Math.min(END, nt)); let k = -1; EV.forEach((e, i) => { if (e.t <= t) k = i; }); idx = k + 1; currentEvent = k; closeModal(); updateBanner(k); applyInstant(k);
    if (k < splitIdx) { split = false; redraw(); updateLegend(); }
  }
  function seekEvent(i) { if (!on) setMode(true); if (playing) setPlaying(false); dwell = 0; closeModal(); applyInstant(i - 1); if (i < splitIdx) { split = false; } t = EV[i].t; idx = i + 1; trigger(i); }
  function endOfRun() {
    if (loop.checked) { t = START; idx = 0; closeModal(); applyInstant(-1); split = false; redraw(); updateLegend(); trigger(0); idx = 1; }
    else { setPlaying(false); }
  }
  function setMode(m) {
    on = m; root.classList.toggle('tl', m); stage.visible = m; soldierLayer.visible = !!m; guideLayer.visible = !!m; legend.hidden = !m; banner.hidden = !m || currentEvent < 0;
    if (world.labels) world.labels.forEach(l => { l.visible = !m && W.state.labels; }); bar.querySelectorAll('#tltrack,#tlyear,#tlmore').forEach(n => n.hidden = !m);
    exit.textContent = m ? 'Exit' : '⏱ Timelapse'; exit.title = m ? 'Leave the timelapse and return to the normal world' : 'Open the 1535 → today land, lordship and occupation timelapse';
    if (m) { ovl.custom = parOn.checked ? custom : () => {}; seek(t); } else { setPlaying(false); closeModal(); ovl.custom = null; world.gate = undefined; bmat().forEach(mm => { mm.opacity = 1; }); W.applyBld(); redraw(); }
    root.classList.toggle('tl', true);
  }
  play.addEventListener('click', () => { audioUnlocked = true; if (!on) setMode(true); if (!playing) { if (t >= END - 0.01 && idx >= EV.length) { t = START; idx = 0; dwell = 0; applyInstant(-1); split = false; redraw(); updateLegend(); } if (dwell <= 0 && idx < EV.length) { const nextIndex = idx; t = EV[nextIndex].t; trigger(nextIndex); idx = nextIndex + 1; } setPlaying(true); last = performance.now(); } else setPlaying(false); });
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
    updateGuide(now);
    if (world.labels) world.labels.forEach(l => { l.visible = false; });
    if (playing) {
      if (dwell > 0) {
        dwell -= dt;
        if (bar2 && !modal.hidden) bar2.style.transform = `scaleX(${Math.max(0, dwell / dwellTotal)})`;
        if (dwell <= 0) {
          dwell = 0;
          if (idx < EV.length) { t = EV[idx].t; trigger(idx++); }
          else endOfRun();
        }
      } else if (idx < EV.length) {
        // Event-to-event playback: jump straight to the next dated record. Years with no
        // timeline entry are never rendered as empty stops or given an artificial dwell.
        t = EV[idx].t; trigger(idx++);
      } else endOfRun();
    }
    year.textContent = Math.floor(t) >= Math.floor(END) ? 'Today' : String(Math.floor(t)); fill.style.width = pct(t) + '%'; head.style.left = pct(t) + '%'; track.setAttribute('aria-valuenow', Math.floor(t));
    ticks.forEach((b, i) => b.classList.toggle('on', i === currentEvent));
    if (flash) { if (now > flash.until) { flash = null; flashOn = false; redraw(); } else if (now - flashT > 380) { flashT = now; flashOn = !flashOn; redraw(); } }
    if (demoAt) { const p = Math.min(1, (now - demoAt) / 4200); setDemo(p); if (p >= 1) demoAt = 0; }
    if (dust.visible) { const q = (now - dustAt) / 6000; if (q >= 1) dust.visible = false; else { for (let i = 0; i < NP; i++) { dpos[i * 3] += dvel[i * 3] * dt; dpos[i * 3 + 1] += dvel[i * 3 + 1] * dt; dpos[i * 3 + 2] += dvel[i * 3 + 2] * dt; }
      dust.geometry.attributes.position.needsUpdate = true; dust.material.opacity = Math.min(0.55, q * 6) * (1 - q); dust.material.size = 7 + q * 14; } }
    if (fadeAt) { const k = Math.min(1, (now - fadeAt) / 3000); bmat().forEach(m => { m.opacity = k; }); if (k >= 1) fadeAt = 0; }
    updateSoldierActors(now);
  }
  requestAnimationFrame(frameTl);

  window.__tl = { seek, seekEvent, play: () => { if (!playing) play.click(); }, stop: () => { if (playing) play.click(); }, events: EV, get t() { return t; }, get on() { return on; }, get guideTalking() { return !voiceAudio.paused && !voiceAudio.ended; }, get guideLevel() { return guideLevel; } };
  setMode(Q.get('tl') !== '0'); if (Q.get('tl') === '0') { year.hidden = true; }
  if (on) { applyInstant(-1); split = false; redraw(); updateLegend(); idx = 0; currentEvent = 0; updateBanner(0); if (Q.get('tl') !== 'pause') setPlaying(true); }
})().catch(e => {
  console.warn('timelapse:', e);
  const info = document.querySelector('#w3dinfo');
  if (info) info.textContent = 'The guided timeline could not start: ' + (e && e.message ? e.message : String(e));
  const root = document.querySelector('#w3d');
  if (root) root.dataset.timelapseError = String(e && e.stack || e);
});
