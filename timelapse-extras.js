// Wales 3D world v1.0.0 — timelapse extras. Additive: it only uses the public hooks window.__w3d and window.__tl,
// so timelapse.js and wales-3d.js are untouched. Adds:
//   1. Deep links: #e1955 (an event id) opens that event, paused, ready to cite or share; the hash follows the story.
//   2. Event navigation in every modal: previous / next, "n of N", chapter name, copy link. Keys [ and ] step events.
//   3. Chapter bands along the top bar: lordship, estate plan, division and occupation, possession and title, redevelopment.
//   4. Cinematic orbit: a slow drift round the land while it plays; any touch or drag stops it for a while.
//      Off for people who prefer reduced motion. Switch in Options.
//   5. Export the whole chronology, with status and archive links, as CSV for lawyers and researchers (Options).
const Q = new URLSearchParams(location.search);
const $ = s => document.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
const CHAPTERS = [
  { from: 1535, name: 'Lordship and the manor', col: '#7c6bb3' },
  { from: 1824, name: 'Estate plan and tithe', col: '#4f8cff' },
  { from: 1877, name: 'Division and occupation', col: '#2fb5a8' },
  { from: 1955, name: 'Possession and title', col: '#e0453a' },
  { from: 1988, name: 'Demolition and redevelopment', col: '#d9a441' }
];
const chapterOf = t => { let c = CHAPTERS[0]; CHAPTERS.forEach(x => { if (t >= x.from) c = x; }); return c; };

function boot() {
  const TLH = window.__tl, W = window.__w3d, root = $('#w3d'), track = $('#tltrack'), modal = $('#tlmodal');
  if (!TLH || !W || !root || !track || !modal) return false;
  const EV = TLH.events, N = EV.length, START = 1535, END = EV[N - 1].t;
  const pct = t => Math.max(0, Math.min(100, (t - START) / (END - START) * 100));
  const playBtn = $('#tlplay'), isPlaying = () => playBtn && playBtn.getAttribute('aria-pressed') === 'true';
  const currentIdx = () => { const ts = [...track.querySelectorAll('.tltick')]; return ts.findIndex(b => b.classList.contains('on')); };
  const go = i => { if (i < 0 || i >= N) return; TLH.seekEvent(i); if (isPlaying()) playBtn.click(); };   // step manually: pause on the event

  // ---- styles ----
  const css = el('style'); css.textContent = `
#tlxchap{position:absolute;left:0;right:0;top:3px;height:4px;pointer-events:none}
#tlxchap i{position:absolute;top:0;height:4px;opacity:.9;border-radius:2px}
.tlxnav{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 2px;font-size:12px}
.tlxnav button{background:#2b3648;color:#eef;border:1px solid #4a5870;border-radius:6px;font:inherit;font-size:12px;padding:6px 10px;min-height:36px;cursor:pointer}
.tlxnav button:disabled{opacity:.4;cursor:default}
.tlxnav .tlxc{display:inline-flex;align-items:center;gap:5px;color:#cdd6e4}
.tlxnav .tlxc i{width:10px;height:10px;border-radius:3px;display:inline-block}
.tlxnav .tlxn{margin-left:auto;opacity:.85}
.tlxopt{display:flex;gap:6px;align-items:center;font-size:12px}
.tlxbtn{background:#2b3648;color:#eef;border:1px solid #4a5870;border-radius:6px;font:inherit;font-size:13px;padding:6px 10px;cursor:pointer;min-height:36px}`;
  document.head.append(css);

  // ---- chapter bands ----
  const bands = el('div'); bands.id = 'tlxchap';
  CHAPTERS.forEach((c, i) => { const to = i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].from : END, b = el('i'); b.style.left = pct(c.from) + '%'; b.style.width = (pct(to) - pct(c.from)) + '%'; b.style.background = c.col; b.title = c.name + ' · ' + c.from + '–' + (i + 1 < CHAPTERS.length ? to : 'today'); bands.append(b); });
  track.append(bands);

  // ---- modal navigation ----
  function copyText(text) { if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise((ok, no) => { const a = el('textarea'); a.value = text; a.style.cssText = 'position:fixed;opacity:0'; document.body.append(a); a.select(); try { document.execCommand('copy') ? ok() : no(); } catch (e) { no(e); } a.remove(); }); }
  const linkFor = id => location.origin + location.pathname + location.search + '#' + id;
  function addNav() {
    if (modal.hidden || modal.querySelector('.tlxnav')) return;
    const i = currentIdx(); if (i < 0) return; const e = EV[i], ch = chapterOf(e.t);
    const nav = el('div', 'tlxnav');
    const prev = el('button', null, '◀ Previous'); prev.type = 'button'; prev.disabled = i === 0; prev.addEventListener('click', () => go(i - 1));
    const next = el('button', null, 'Next ▶'); next.type = 'button'; next.disabled = i >= N - 1; next.addEventListener('click', () => go(i + 1));
    const copy = el('button', null, '🔗 Copy link'); copy.type = 'button';
    copy.addEventListener('click', () => { copyText(linkFor(e.id)).then(() => { copy.textContent = '✓ Link copied'; }, () => { copy.textContent = 'Copy failed'; }); setTimeout(() => { copy.textContent = '🔗 Copy link'; }, 2200); });
    const chip = el('span', 'tlxc'); const dot = el('i'); dot.style.background = ch.col; chip.append(dot, ch.name);
    nav.append(prev, next, copy, chip, el('span', 'tlxn', 'Event ' + (i + 1) + ' of ' + N));
    const heading = modal.querySelector('h3'); (heading ? heading.parentNode : modal).insertBefore(nav, modal.querySelector('.tlhear') || modal.querySelector('.tleventdetails'));
  }
  // the modal is rebuilt for each event and the bar marks the open event a frame later, so add the row after two frames (and on a slow poll)
  new MutationObserver(() => requestAnimationFrame(() => requestAnimationFrame(addNav))).observe(modal, { childList: true });
  setInterval(addNav, 300);
  addEventListener('keydown', ev => { if (ev.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ev.target.tagName)) return;
    if (ev.key === ']' || ev.key === '[') { const i = currentIdx(), j = i < 0 ? EV.findIndex(e => e.t >= TLH.t) : i + (ev.key === ']' ? 1 : -1); go(Math.max(0, Math.min(N - 1, j))); ev.preventDefault(); } });

  // ---- deep links: #id in, hash follows the story ----
  let lastHash = '';
  const wanted = (location.hash || '').slice(1) || Q.get('event');
  const wi = wanted ? EV.findIndex(e => e.id === wanted) : -1;
  if (wi >= 0) { go(wi); lastHash = '#' + EV[wi].id; }
  setInterval(() => { if (!TLH.on) return; const i = currentIdx(); if (i < 0) return; const h = '#' + EV[i].id;
    if (h !== lastHash) { lastHash = h; try { history.replaceState(null, '', location.pathname + location.search + h); } catch (e) {} } }, 400);

  // ---- options: cinematic orbit and CSV export ----
  const body = $('#tlmore .tlmorebody') || $('#tlmore');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let orbit = store.get('w3d-orbit', reduce ? '0' : '1') === '1' && !reduce, touched = 0;
  const orbitL = el('label', 'tlxopt'); const orbitC = el('input'); orbitC.type = 'checkbox'; orbitC.checked = orbit; orbitC.disabled = reduce; orbitL.append(orbitC, reduce ? 'Cinematic orbit (off: reduced motion)' : 'Cinematic orbit');
  orbitC.addEventListener('change', () => { orbit = orbitC.checked; store.set('w3d-orbit', orbit ? '1' : '0'); });
  const csvBtn = el('button', 'tlxbtn', '⬇ Export chronology (CSV)'); csvBtn.type = 'button';
  csvBtn.addEventListener('click', () => {
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['id', 'year', 'date', 'chapter', 'category', 'record_status', 'status_reason', 'title', 'text', 'archive_records']];
    EV.forEach(e => rows.push([e.id, Math.floor(e.t), e.date, chapterOf(e.t).name, e.category || '', e.status === 'dashed' ? 'reconstructed / not established' : 'source record seen', e.reason || '', e.title, e.text,
      (e.sources || []).map(s => s.t + ' <' + s.u + '>').join(' | ')]));
    const blob = new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'tymawr-chronology-1535-today.csv'; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  body.append(orbitL, csvBtn);

  const controls = W.controls, canvas = $('#w3dc');
  const touch = () => { touched = performance.now(); }; if (canvas) ['pointerdown', 'wheel', 'touchstart', 'keydown'].forEach(k => canvas.addEventListener(k, touch, { passive: true }));
  setInterval(() => { const go = orbit && TLH.on && isPlaying() && performance.now() - touched > 9000;
    if (controls.autoRotate !== go) { controls.autoRotate = go; controls.autoRotateSpeed = 0.35; } if (!TLH.on && controls.autoRotate) controls.autoRotate = false; }, 500);
  return true;
}
const iv = setInterval(() => { try { if (boot()) clearInterval(iv); } catch (e) { clearInterval(iv); console.warn('timelapse extras:', e); } }, 300);
setTimeout(() => clearInterval(iv), 60000);
