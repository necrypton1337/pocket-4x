// Интерфейс: один понятный выбор за раз.
import * as G from '../core/game.js';
import { endTurn, runAutoWorkers } from '../core/turn.js';
import { serialize, deserialize } from '../core/save.js';
import { UNITS, BUILDINGS, TECHS, IMPROVEMENTS, TERRAIN, DIFFICULTY, RESOURCES, FACTIONS, PLAYABLE_FACTIONS, EMPEROR_TRAITS, MINOR_TYPES, RULES } from '../core/data.js';
import { distance, tilesInRadius } from '../core/hex.js';
import { render, renderOverview, tileCenter, pixelToTile, BASE_SIZE, loadSprites, KY } from './render.js';
import { suggestSites } from '../core/ai.js';
import { I, thumb } from './icons.js';

const SAVE_KEY = 'pocket4x.save';
const PREF_KEY = 'pocket4x.prefs';

const $ = (id) => document.getElementById(id);
const canvas = $('map');
const ctx = canvas.getContext('2d');
const panel = $('panel');
const nextBtn = $('next');

let s = null;
let me = 0;
const ui = { sel: null, reach: null, targets: null, visible: new Set(), pending: null, gotoMark: null };
const view = { width: 0, height: 0, dpr: 1, cam: { x: 0, y: 0, zoom: 1.45 } };
let dpr = 1;

// ---------- Хранилище ----------

function store(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function fetchStore(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function prefs() {
  try { return JSON.parse(fetchStore(PREF_KEY)) || {}; } catch { return {}; }
}
function setPref(k, v) {
  const p = prefs(); p[k] = v; store(PREF_KEY, JSON.stringify(p));
}
function save() {
  if (s) store(SAVE_KEY, serialize(s));
}
function loadSaved() {
  const t = fetchStore(SAVE_KEY);
  if (!t) return null;
  try { return deserialize(t); } catch { return null; }
}

// ---------- Камера ----------

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  view.dpr = dpr;
  view.width = window.innerWidth;
  view.height = window.innerHeight;
  canvas.width = Math.round(view.width * dpr);
  canvas.height = Math.round(view.height * dpr);
  draw();
}

function mapArea() {
  const top = $('top').getBoundingClientRect().bottom;
  const bottom = $('bottom').getBoundingClientRect().top;
  return { top, bottom: Math.max(top + 50, bottom) };
}

function centerOn(x, y) {
  const size = BASE_SIZE * view.cam.zoom;
  const [wx, wy] = tileCenter(x, y, size);
  const a = mapArea();
  view.cam.x = view.width / 2 - wx;
  view.cam.y = (a.top + a.bottom) / 2 - wy;
  clampCam();
  draw();
}

function clampCam() {
  if (!s) return;
  const size = BASE_SIZE * view.cam.zoom;
  const mapW = size * Math.sqrt(3) * (s.width + 0.5), mapH = size * 1.5 * s.height * KY;
  const m = 120;
  view.cam.x = Math.min(m, Math.max(view.width - mapW - m, view.cam.x));
  view.cam.y = Math.min(m + 60, Math.max(view.height - mapH - m - 120, view.cam.y));
}

let raf = 0;
function draw() {
  if (raf || !s) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    drawNow();
  });
}

function drawNow() {
  if (!s) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const more = render(ctx, view, s, me, ui);
  if (more && !playing) draw();
}

// ---------- Анимации ----------

let playing = null;
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function snapshotUnits() {
  const m = new Map();
  for (const u of G.unitList(s)) m.set(u.id, { ...u, anim: null });
  return m;
}

function tween(ms, fn) {
  return new Promise((resolve) => {
    if (!playing || playing.skip) { fn(1); resolve(); return; }
    const t0 = performance.now();
    const step = (now) => {
      const t = playing && !playing.skip ? Math.min(1, (now - t0) / ms) : 1;
      fn(t);
      drawNow();
      if (t >= 1) resolve(); else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
const pause = (ms) => tween(ms, () => {});

function float(x, y, text, color) {
  ui.floats = ui.floats || [];
  ui.floats.push({ x, y, text, color, born: performance.now() });
}

async function playFx(list, ghosts, own) {
  if (!list.length) return;
  playing = { skip: false };
  ui.ghosts = ghosts;
  ui.shots = [];
  const seen = (x, y) => ui.visible.has(G.idx(s, x, y));
  const focus = (x, y) => { if (!playing.skip && !onScreenTile(x, y)) centerOn(x, y); };
  for (const f of list) {
    const live = !playing.skip;
    if (f.t === 'move') {
      let g = ghosts.get(f.id);
      if (!g) { g = { id: f.id, type: f.type, owner: f.owner, hp: f.hp, x: f.fx, y: f.fy }; ghosts.set(f.id, g); }
      if (live && (own || seen(f.fx, f.fy) || seen(f.x, f.y))) {
        focus(f.x, f.y);
        g.anim = { fx: f.fx, fy: f.fy, tx: f.x, ty: f.y, t: 0 };
        await tween(own ? 140 : 120, (t) => { g.anim.t = ease(t); });
        g.anim = null;
      }
      g.x = f.x; g.y = f.y;
    } else if (f.t === 'attack') {
      const a = ghosts.get(f.id);
      const d = f.defId != null ? ghosts.get(f.defId) : null;
      if (live && (own || seen(f.ax, f.ay) || seen(f.x, f.y))) {
        focus(f.x, f.y);
        if (f.ranged) {
          const sh = { fx: f.ax, fy: f.ay, tx: f.x, ty: f.y, t: 0 };
          ui.shots.push(sh);
          await tween(300, (t) => { sh.t = t; });
          ui.shots = ui.shots.filter((x) => x !== sh);
        } else if (a) {
          a.anim = { fx: f.ax, fy: f.ay, tx: f.x, ty: f.y, t: 0 };
          await tween(260, (t) => { a.anim.t = Math.sin(Math.PI * t) * 0.5; });
          a.anim = null;
        }
        float(f.x, f.y, `−${f.toDef}`, '#f87171');
        if (f.toAtk) float(f.ax, f.ay, `−${f.toAtk}`, '#fdba74');
        await pause(own ? 250 : 320);
      }
      if (d) d.hp = Math.max(1, d.hp - f.toDef);
      if (a && f.toAtk) a.hp = Math.max(1, a.hp - f.toAtk);
    } else if (f.t === 'shot') {
      const g = ghosts.get(f.id);
      if (live && (seen(f.x, f.y) || seen(f.tx, f.ty))) {
        focus(f.tx, f.ty);
        const sh = { fx: f.x, fy: f.y, tx: f.tx, ty: f.ty, t: 0, color: '#fde68a' };
        ui.shots.push(sh);
        await tween(300, (t) => { sh.t = t; });
        ui.shots = ui.shots.filter((x) => x !== sh);
        float(f.tx, f.ty, `−${f.dmg}`, '#f87171');
        await pause(200);
      }
      if (g) g.hp = Math.max(1, g.hp - f.dmg);
    } else if (f.t === 'remove') {
      const g = ghosts.get(f.id);
      if (g && live && (g.owner === me || seen(g.x, g.y)) && !G.isCivil(g.type)) {
        float(g.x, g.y, '✕', '#ff8a80');
        ghosts.delete(f.id);
        await pause(180);
      }
      ghosts.delete(f.id);
    } else if (f.t === 'owner') {
      const g = ghosts.get(f.id);
      if (g) { g.owner = f.owner; g.type = f.type; }
    }
  }
  ui.ghosts = null;
  ui.shots = null;
  playing = null;
  draw();
}

// Выполнить действие и показать, что произошло
async function withFx(action, own = true) {
  const ghosts = snapshotUnits();
  s._fx = [];
  let result, list;
  try { result = action(); } finally { list = s._fx; delete s._fx; }
  ui.visible = G.updateExplored(s, me);
  ui.reach = null; ui.targets = null; ui.path = null; ui.cityTiles = null; ui.sites = null;
  await playFx(list, ghosts, own);
  return result;
}

// ---------- Жесты ----------

const pointers = new Map();
let gesture = null;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    gesture = { type: 'pan', sx: e.clientX, sy: e.clientY, cx: view.cam.x, cy: view.cam.y, moved: false };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = {
      type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: view.cam.zoom,
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: view.cam.x, cy: view.cam.y,
    };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  if (gesture.type === 'pan' && pointers.size === 1) {
    const dx = e.clientX - gesture.sx, dy = e.clientY - gesture.sy;
    if (Math.hypot(dx, dy) > 8) gesture.moved = true;
    if (gesture.moved) {
      view.cam.x = gesture.cx + dx;
      view.cam.y = gesture.cy + dy;
      clampCam();
      draw();
    }
  } else if (gesture.type === 'pinch' && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    zoomAround(gesture, Math.min(2.6, Math.max(0.45, gesture.z0 * d / gesture.d0)), (a.x + b.x) / 2, (a.y + b.y) / 2);
  }
});

function zoomAround(g, z, mx, my) {
  const wx = (g.mx - g.cx) / g.z0, wy = (g.my - g.cy) / g.z0;
  view.cam.zoom = z;
  view.cam.x = mx - wx * z;
  view.cam.y = my - wy * z;
  clampCam();
  draw();
}

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  if (gesture && gesture.type === 'pan' && !gesture.moved && pointers.size === 1 && e.type === 'pointerup') {
    onTap(e.clientX, e.clientY);
  }
  pointers.delete(e.pointerId);
  if (pointers.size === 0) gesture = null;
  else if (gesture && gesture.type === 'pinch') gesture = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const g = { mx: e.clientX, my: e.clientY, cx: view.cam.x, cy: view.cam.y, z0: view.cam.zoom };
  zoomAround(g, Math.min(2.6, Math.max(0.45, view.cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89))), e.clientX, e.clientY);
}, { passive: false });

// ---------- Выбор и нажатия на карту ----------

const myUnitsAt = (x, y) => G.unitsAt(s, x, y).filter((u) => u.owner === me);

function selectUnit(u, center = false) {
  ui.sel = { kind: 'unit', id: u.id, x: u.x, y: u.y };
  ui.pending = null;
  if (center) centerOn(u.x, u.y);
  refresh();
}
function selectCity(c, center = false) {
  ui.sel = { kind: 'city', id: c.id, x: c.x, y: c.y };
  ui.pending = null;
  if (center) centerOn(c.x, c.y);
  refresh();
}
function selectTile(x, y) {
  ui.sel = { kind: 'tile', x, y };
  ui.pending = null;
  refresh();
}
function clearSel() {
  ui.sel = null;
  ui.pending = null;
  refresh();
}

function onTap(sx, sy) {
  if (!s) return;
  if (playing) { playing.skip = true; return; }
  const size = BASE_SIZE * view.cam.zoom;
  const [x, y] = pixelToTile(sx - view.cam.x, sy - view.cam.y, size);
  if (!G.inside(s, x, y)) { clearSel(); return; }
  const i = G.idx(s, x, y);
  const explored = s.players[me].explored[i];
  const selU = ui.sel && ui.sel.kind === 'unit' ? s.units[ui.sel.id] : null;
  const mine = myUnitsAt(x, y);
  const city = G.cityAt(s, x, y);

  if (selU && selU.owner === me && !s.over) {
    if (selU.x === x && selU.y === y) {
      // Повторное нажатие — переключаемся на соседа по клетке или город
      const other = mine.find((u) => u.id !== selU.id);
      if (other) return selectUnit(other);
      if (city && city.owner === me) return selectCity(city);
      return clearSel();
    }
    if (G.canAttack(s, selU, x, y) && G.isRangedType(selU.type)) {
      ui.pending = { x, y };
      return refresh();
    }
    const info = ui.reach && ui.reach.get(i);
    if (info && info.kind === 'attack') {
      ui.pending = { x, y, from: info.from };
      return refresh();
    }
    // Ход только после подтверждения: сначала показываем путь и клетку.
    const path = explored ? G.findPath(s, selU, x, y) : null;
    if (path) {
      ui.pending = { move: true, x, y };
      return refresh();
    }
  }
  if (mine.length) {
    const cur = ui.sel && ui.sel.x === x && ui.sel.y === y;
    const ordered = [...mine].sort((a, b) => (G.isCivil(a.type) ? 1 : 0) - (G.isCivil(b.type) ? 1 : 0));
    if (!cur) {
      const needing = ordered.find((u) => G.needsOrders(s, me).includes(u));
      if (city && city.owner === me && !needing) return selectCity(city);
      return selectUnit(needing || ordered[0]);
    }
    if (city && city.owner === me) return selectCity(city);
    return selectUnit(ordered[0]);
  }
  if (city && explored) return selectCity(city);
  if (explored) {
    const enemy = G.unitsAt(s, x, y).find((u) => ui.visible.has(i));
    if (enemy) { ui.sel = { kind: 'unit', id: enemy.id, x, y }; ui.pending = null; return refresh(); }
    return selectTile(x, y);
  }
  clearSel();
}

function afterUnitAction(uid) {
  const u = s.units[uid];
  ui.pending = null;
  if (u && u.moves > 0 && !u.fortified && u.skipTurn !== s.turn && !u.work && !u.auto) {
    ui.sel = { kind: 'unit', id: u.id, x: u.x, y: u.y };
    refresh();
    return;
  }
  // Юнит закончил — переходим к следующему, кто ждёт приказа
  const next = G.needsOrders(s, me)[0];
  if (next) {
    ui.sel = { kind: 'unit', id: next.id, x: next.x, y: next.y };
    refresh();
    if (!onScreenTile(next.x, next.y)) centerOn(next.x, next.y);
  } else if (u) {
    ui.sel = { kind: 'unit', id: u.id, x: u.x, y: u.y };
    refresh();
  } else {
    clearSel();
  }
}

function onScreenTile(x, y) {
  const size = BASE_SIZE * view.cam.zoom;
  const [wx, wy] = tileCenter(x, y, size);
  const sx = wx + view.cam.x, sy = wy + view.cam.y;
  const a = mapArea();
  return sx > 30 && sx < view.width - 30 && sy > a.top + 30 && sy < a.bottom - 30;
}

// ---------- Обновление экрана ----------

function refresh() {
  if (!s) return;
  ui.visible = G.updateExplored(s, me);
  ui.reach = null; ui.targets = null; ui.gotoMark = null; ui.path = null;
  if (ui.sel && ui.sel.kind === 'unit') {
    const u = s.units[ui.sel.id];
    if (!u) ui.sel = null;
    else {
      ui.sel.x = u.x; ui.sel.y = u.y;
      if (u.owner === me && !s.over) {
        ui.reach = G.reachable(s, u);
        if (G.isRangedType(u.type) && u.moves > 0) {
          ui.targets = tilesInRadius(s.width, s.height, u.x, u.y, UNITS[u.type].range)
            .filter(([x, y]) => G.canAttack(s, u, x, y) && ui.visible.has(G.idx(s, x, y)));
        }
        if (u.goto) ui.gotoMark = u.goto;
        if (ui.pending && ui.pending.move) {
          ui.path = G.findPath(s, u, ui.pending.x, ui.pending.y);
          if (!ui.path) ui.pending = null;
        }
      }
    }
  }
  ui.cityTiles = null; ui.sites = null;
  if (ui.sel && ui.sel.kind === 'city' && !s.cities[ui.sel.id]) ui.sel = null;
  if (ui.sel && ui.sel.kind === 'city' && s.cities[ui.sel.id].owner === me) {
    const c = s.cities[ui.sel.id];
    const worked = new Set(G.workedTiles(s, c));
    ui.cityTiles = [];
    s.tiles.forEach((t, i) => {
      if (t.city !== c.id) return;
      const x = i % s.width, y = Math.floor(i / s.width);
      if (x === c.x && y === c.y) return;
      const yv = G.tileYield(s, x, y, me);
      ui.cityTiles.push({ x, y, worked: worked.has(i), food: yv.food, prod: yv.prod });
    });
  }
  if (ui.sel && ui.sel.kind === 'unit' && !ui.pending) {
    const u = s.units[ui.sel.id];
    if (u && u.owner === me && u.type === 'settler') ui.sites = suggestSites(s, me, u);
  }
  updateTop();
  updatePanel();
  updateNext();
  draw();
  save();
}

function techTurns(pid, tech) {
  const p = s.players[pid];
  const rate = Math.max(1, G.playerScience(s, pid));
  return Math.max(1, Math.ceil((TECHS[tech].cost - p.sci) / rate));
}

function updateTop() {
  const p = s.players[me];
  const inc = G.playerIncome(s, me);
  $('turn').innerHTML = `<b>Ход ${s.turn}</b><small>${I.gold} ${p.gold} <span style="color:${inc < 0 ? 'var(--danger)' : 'var(--good)'}">${inc >= 0 ? '+' : ''}${inc}</span></small>`;
  const btn = $('research');
  if (p.research) {
    const pr = Math.min(100, Math.round((100 * p.sci) / TECHS[p.research].cost));
    btn.innerHTML = `${I.sci}<span class="pl">${TECHS[p.research].name}</span><span class="pn">${techTurns(me, p.research)} х.</span><i class="pbar" style="width:${pr}%"></i>`;
    btn.classList.remove('attention');
  } else if (G.availableTechs(s, me).length) {
    btn.innerHTML = `${I.sci}<span class="pl">Выбрать исследование</span>`;
    btn.classList.toggle('attention', G.playerCities(s, me).length > 0);
  } else {
    btn.innerHTML = `${I.sci}<span class="pl">Всё изучено</span>`;
    btn.classList.remove('attention');
  }
}

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};
const turnsText = (n) => `${n} ${plural(n, 'ход', 'хода', 'ходов')}`;

function teamName(pid) {
  const p = s.players[pid];
  return p.kind === 'minor' ? 'minor' : p.kind === 'fauna' ? 'fauna' : p.faction || 'colonists';
}
function unitThumb(u) {
  return thumb(`unit_${u.type}_${teamName(u.owner)}`, 'unit');
}

function swatch(pid) {
  return `<span class="swatch" style="background:${s.players[pid].color}"></span>`;
}

function updatePanel() {
  if (!ui.sel || s.over) { panel.innerHTML = s.over ? '' : hintHtml(); return; }
  if (ui.sel.kind === 'unit') panel.innerHTML = unitPanel(s.units[ui.sel.id]);
  else if (ui.sel.kind === 'city') panel.innerHTML = cityPanel(s.cities[ui.sel.id]);
  else panel.innerHTML = tilePanel(ui.sel.x, ui.sel.y);
}

function hintHtml() {
  if (s.turn <= 3 && G.playerCities(s, me).length === 0) {
    return '<div class="hint">Нажмите «Дальше», чтобы выбрать колонистов, и основайте первый город.</div>';
  }
  return '';
}

function unitPanel(u) {
  const d = UNITS[u.type];
  const owner = s.players[u.owner];
  const power = G.isRangedType(u.type) ? `<span>${I.rng} ${d.rng} · дальность ${d.range}</span><span>${I.def} ${d.str}</span>` : d.str ? `<span>${I.str} ${d.str}</span>` : '';
  let html = `<div class="head">${unitThumb(u)}<div><div class="hn">${d.name}${u.vet ? ' <span class="tag">ветеран</span>' : ''}</div><div class="ho">${swatch(u.owner)}${owner.name}</div></div></div>
    <div class="stats"><span>${I.hp} ${u.hp}/100</span>${u.owner === me ? `<span>${I.moves} ${u.moves}/${d.moves}</span>` : ''}${power}</div>`;
  if (u.owner !== me) {
    const peace = !G.atWar(s, me, u.owner) ? ' Вы не воюете с ними.' : '';
    return html + `<div class="hint">${d.desc}${peace}</div>`;
  }
  if (ui.pending) return html + (ui.pending.move ? moveHtml(u, ui.pending.x, ui.pending.y) : attackHtml(u, ui.pending.x, ui.pending.y));
  const acts = [];
  let hint = '';
  if (u.work) {
    hint = `Строит: ${IMPROVEMENTS[u.work.imp].name}, осталось ${turnsText(u.work.left)}.`;
    acts.push(`<button data-act="wake">Отменить стройку</button>`);
  } else if (u.type === 'settler') {
    const ok = G.canFoundCity(s, u);
    acts.push(`<button class="primary" data-act="found" ${ok === true ? '' : 'disabled'}>Основать город</button>`);
    if (ok !== true) hint = ok + '. ⭐ на карте — хорошие места поблизости.';
    else hint = 'Можно основать здесь. ⭐ на карте — хорошие места поблизости.';
  } else if (u.type === 'worker') {
    const imps = G.availableImprovements(s, u);
    for (const k of imps) acts.push(`<button class="primary" data-act="imp:${k}">${IMPROVEMENTS[k].name} · ${turnsText(IMPROVEMENTS[k].turns)}</button>`);
    if (u.auto) {
      hint = 'Работает сам: выбирает клетки и строит улучшения.';
      acts.length = 0;
      acts.push(`<button data-act="wake">Управлять вручную</button>`);
    } else {
      hint = imps.length ? '' : 'Здесь нечего строить. Отведите рабочего на свою клетку без улучшения или включите автоматический режим.';
      acts.push(`<button data-act="auto">Работать самостоятельно</button>`);
    }
  } else if (G.isSupport(u.type)) {
    hint = d.desc + ' Можно поставить на одну клетку с бойцом.';
  } else {
    hint = u.moves > 0 ? 'Нажмите на клетку, чтобы идти, или на врага, чтобы атаковать.' : 'Ходы закончились.';
  }
  const upTo = G.upgradeTarget(s, u);
  if (upTo && !u.work) {
    const ok = G.canUpgrade(s, u);
    acts.push(`<button data-act="upgrade" ${ok === true ? '' : 'disabled'} title="${ok === true ? '' : ok}">${I.up} ${UNITS[upTo].name} · ${G.upgradeCost(s, u)} ${I.gold}</button>`);
    if (ok !== true && ok !== 'Не хватает денег') hint += ` Улучшение: ${ok.toLowerCase()}.`;
  }
  if (u.fortified) { hint = 'Укреплён: +25% к защите.'; acts.push(`<button data-act="wake">Снять укрепление</button>`); }
  else if (!G.isCivil(u.type) && !u.work) acts.push(`<button data-act="fortify">${I.def} Укрепиться</button>`);
  if (G.isSupport(u.type) && u.fortified) acts.length = 0;
  if (u.goto) { hint = 'Идёт к отмеченной точке.'; acts.push(`<button data-act="wake">Остановить</button>`); }
  if (!u.work && !u.fortified && !u.auto && u.moves > 0) acts.push(`<button data-act="skip">Пропустить</button>`);
  return html + (hint ? `<div class="hint">${hint}</div>` : '') + `<div class="actions">${acts.join('')}</div>`;
}

// Сколько ходов займёт путь
function pathTurns(u, path) {
  const max = UNITS[u.type].moves;
  let moves = u.moves > 0 ? u.moves : max, turns = u.moves > 0 ? 1 : 2;
  for (const [x, y] of path) {
    if (moves <= 0) { turns++; moves = max; }
    moves -= UNITS[u.type].flying ? 1 : TERRAIN[G.tileAt(s, x, y).t].move;
  }
  return turns;
}

function moveHtml(u, x, y) {
  const path = G.findPath(s, u, x, y);
  if (!path) return '';
  const t = G.tileAt(s, x, y);
  const tt = TERRAIN[t.t];
  const yv = G.tileYield(s, x, y, me);
  const turns = pathTurns(u, path);
  const when = turns <= 1 ? 'дойдёт в этом ходу' : `дойдёт за ${turnsText(turns)}`;
  const bits = tileBits(x, y);
  const owner = t.owner >= 0 ? ` · ${s.players[t.owner].name}` : '';
  const city = G.cityAt(s, x, y);
  const there = myUnitsAt(x, y).length || (city && city.owner === me);
  return `<div class="stats"><span>Цель: <b style="color:var(--text)">${city ? city.name : tt.name}${t.imp ? ` + ${IMPROVEMENTS[t.imp].name}` : ''}</b>${owner}</span></div>
    <div class="stats">${bits.map((b) => `<span>${b}</span>`).join('')}<span>${when}</span></div>
    ${featureHint(t)}
    <div class="actions"><button class="primary" data-act="go">Идти сюда</button>
    ${there ? `<button data-act="pickThere">Выбрать там</button>` : ''}<button data-act="cancel">Отмена</button></div>`;
}

function attackHtml(u, x, y) {
  const pv = G.combatPreview(s, u, x, y);
  if (!pv) return '';
  let verdict, cls;
  if (pv.kills) { verdict = pv.isCity ? 'Город будет захвачен' : 'Враг будет уничтожен'; cls = 'good'; }
  else if (pv.dies) { verdict = 'Ваш юнит скорее всего погибнет'; cls = 'bad'; }
  else if (pv.toDef >= pv.toAtk) { verdict = 'Выгодная атака'; cls = 'good'; }
  else { verdict = 'Рискованно: вы потеряете больше'; cls = 'mid'; }
  if (pv.isCity && pv.ranged && pv.toDef >= pv.defHp) verdict = 'Город почти пал — добейте бойцом ближнего боя';
  return `<div class="stats"><span>Цель: ${pv.defName} · ${I.hp} ${pv.defHp}</span></div>
    <div class="stats"><span>Урон врагу ≈ ${pv.toDef}</span><span>${pv.ranged ? 'Ответного урона нет' : `Урон вам ≈ ${pv.toAtk}`}</span></div>
    ${pv.shielded ? '<div class="hint">Цель под щитом: урон по ней на 25% меньше.</div>' : ''}
    <div class="verdict ${cls}">${verdict}</div>
    <div class="actions"><button class="danger" data-act="attack">Атаковать</button><button data-act="cancel">Отмена</button></div>`;
}

function cityPanel(c) {
  const owner = s.players[c.owner];
  const head = `<div class="head"><span class="cityicon" style="background:${owner.color}">${c.pop}</span><div><div class="hn">${c.name}${c.capital ? ' <span class="tag">столица</span>' : ''}</div><div class="ho">${owner.kind === 'minor' ? 'Нейтральное поселение' : owner.name} · ${c.pop} ${plural(c.pop, 'житель', 'жителя', 'жителей')}</div></div></div>`;
  if (owner.kind === 'minor') return minorPanel(c, owner, head);
  if (c.owner !== me) {
    return head + `<div class="stats"><span>${I.hp} ${c.hp}/${G.cityMaxHp(c)}</span><span>${I.def} сила ${Math.round(G.cityStrength(s, c))}</span></div>
      <div class="hint">Чтобы захватить город, сбейте его прочность до нуля и войдите бойцом ближнего боя.</div>`;
  }
  const y = G.cityYield(s, c);
  const grow = y.surplus > 0 ? `рост через ${turnsText(Math.max(1, Math.ceil((y.need - c.food) / y.surplus)))}` : y.surplus < 0 ? 'голод!' : 'не растёт';
  let build = '<div class="hint" style="color:var(--accent)">Город ничего не строит — выберите, что строить.</div>';
  const acts = [`<button class="${c.build ? '' : 'primary'}" data-act="production">${c.build ? 'Сменить' : 'Что строить'}</button>`];
  if (c.build && c.build.kind === 'project') {
    build = `<div class="buildline">Проект: <b>Коммерция</b> · +${Math.floor(y.prod / 2)} ${I.gold} в ход</div>`;
  } else if (c.build) {
    const cost = G.buildCost(c.build);
    const d = c.build.kind === 'unit' ? UNITS[c.build.id] : BUILDINGS[c.build.id];
    const wait = c.build.id === 'settler' && c.pop < 2 ? ' (ждёт 2-го жителя)' : '';
    const turns = y.prod > 0 ? turnsText(G.turnsToBuild(s, c)) : 'стоит';
    build = `<div class="buildline">${c.build.kind === 'unit' ? thumb(`unit_${c.build.id}_${teamName(c.owner)}`, 'sm') : ''}Строит: <b>${d.name}</b> · ${turns}${wait}</div>
      <div class="bar"><i style="width:${Math.min(100, (100 * c.prodStore) / cost)}%"></i></div>`;
    const ok = G.canPurchase(s, c);
    acts.push(`<button data-act="buy" ${ok === true ? '' : 'disabled'}>Купить · ${G.purchaseCost(s, c)} ${I.gold}</button>`);
  }
  const unrest = c.unrest > 0 ? `<div class="hint" style="color:var(--danger)">Беспорядки после захвата: город не работает ещё ${turnsText(c.unrest)}.</div>` : '';
  const blds = c.buildings.map((b) => BUILDINGS[b].name).join(', ');
  return head + `<div class="stats"><span>${I.food} ${y.surplus >= 0 ? '+' : ''}${y.surplus} <span class="muted">${grow}</span></span><span>${I.prod} ${y.prod}</span><span>${I.sci} ${y.sci}</span><span>${I.gold} ${y.gold}</span><span>${I.hp} ${c.hp}</span></div>
    ${unrest}${build}${blds ? `<div class="hint">Здания: ${blds}</div>` : ''}
    <div class="actions">${acts.join('')}</div>`;
}

function minorPanel(c, m, head) {
  const type = MINOR_TYPES[m.minorType];
  const mine = m.influence[me] || 0;
  const allyName = m.ally != null ? (m.ally === me ? 'вы' : s.players[m.ally].name) : 'нет';
  const war = m.hostile.includes(me);
  const bar = (v) => `<div class="bar"><i style="width:${Math.max(0, v)}%;background:${v >= RULES.allyInfluence ? 'var(--good)' : 'var(--accent)'}"></i></div>`;
  const acts = [];
  if (!war) {
    acts.push(`<button class="primary" data-act="gift" ${s.players[me].gold >= RULES.giftGold ? '' : 'disabled'}>${I.gift} Подарить ${RULES.giftGold} ${I.gold}</button>`);
    acts.push(`<button class="danger" data-act="war">Объявить войну</button>`);
  }
  return head + `<div class="stats"><span>${type.name}</span><span>Союзник: ${allyName}</span><span>${I.hp} ${c.hp}/${G.cityMaxHp(c)}</span></div>
    <div class="hint">Союзнику даёт: ${type.ally}. Союз — от ${RULES.allyInfluence} влияния.</div>
    ${war ? '<div class="verdict bad">Вы воюете с этим поселением</div>' : `<div class="stats"><span>Ваше влияние: ${mine}</span></div>${bar(mine)}`}
    <div class="actions">${acts.join('')}</div>`;
}

function tileBits(x, y) {
  const t = G.tileAt(s, x, y);
  const tt = TERRAIN[t.t];
  const yv = G.tileYield(s, x, y, me);
  const bits = [];
  if (tt.move !== Infinity || t.t === 'water') {
    bits.push(`${I.food} ${yv.food}`, `${I.prod} ${yv.prod}`);
    if (yv.gold) bits.push(`${I.gold} ${yv.gold}`);
    if (yv.sci) bits.push(`${I.sci} ${yv.sci}`);
  }
  if (tt.move === 2) bits.push(`${I.moves} 2`);
  if (tt.def) bits.push(`${I.def} +${tt.def * 100}%`);
  return bits;
}

function featureHint(t) {
  const out = [];
  if (t.res) out.push(`Ресурс: ${RESOURCES[t.res].name}`);
  if (t.feature === 'ruins') out.push('Неисследованные руины — зайдите любым юнитом');
  if (t.feature === 'ruins_done') out.push('Исследованные руины');
  if (t.feature === 'nest') out.push('Гнездо фауны — уничтожьте бойцом');
  return out.length ? `<div class="hint">${out.join(' · ')}</div>` : '';
}

function tilePanel(x, y) {
  const t = G.tileAt(s, x, y);
  const tt = TERRAIN[t.t];
  const bits = tileBits(x, y);
  if (tt.move === Infinity && t.t !== 'water') bits.push('Непроходимо');
  if (t.t === 'water') bits.push('Только для летающих');
  const owner = t.owner >= 0 ? ` · ${s.players[t.owner].name}` : '';
  return `<div class="head">${tt.name}${t.imp ? ` + ${IMPROVEMENTS[t.imp].name}` : ''}<span class="muted" style="font-weight:400">${owner}</span></div>
    <div class="stats">${bits.map((b) => `<span>${b}</span>`).join('')}</div>${featureHint(t)}`;
}

panel.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b || !s || playing) return;
  const act = b.dataset.act;
  const u = ui.sel && ui.sel.kind === 'unit' ? s.units[ui.sel.id] : null;
  const c = ui.sel && ui.sel.kind === 'city' ? s.cities[ui.sel.id] : null;
  if (act === 'found' && u) {
    const city = G.foundCity(s, u.id);
    if (city) {
      ui.sel = { kind: 'city', id: city.id, x: city.x, y: city.y };
      refresh();
      openProduction(city);
    }
  } else if (act.startsWith('imp:') && u) {
    G.startImprovement(s, u.id, act.slice(4));
    afterUnitAction(u.id);
  } else if (act === 'fortify' && u) {
    G.fortify(s, u.id); afterUnitAction(u.id);
  } else if (act === 'auto' && u) {
    G.automateUnit(s, u.id); runAutoWorkers(s, me); afterUnitAction(u.id);
  } else if (act === 'skip' && u) {
    G.skipUnit(s, u.id); afterUnitAction(u.id);
  } else if (act === 'wake' && u) {
    G.wakeUnit(s, u.id); u.work = null; refresh();
  } else if (act === 'go' && u && ui.pending && ui.pending.move) {
    const { x, y } = ui.pending;
    ui.pending = null;
    await withFx(() => G.orderMove(s, u.id, x, y));
    afterUnitAction(u.id);
  } else if (act === 'pickThere' && ui.pending) {
    const { x, y } = ui.pending;
    ui.sel = null; ui.pending = null;
    const there = myUnitsAt(x, y).filter((o) => !u || o.id !== u.id);
    const city = G.cityAt(s, x, y);
    if (there.length) selectUnit(there[0]);
    else if (city) selectCity(city);
    else refresh();
  } else if (act === 'attack' && u && ui.pending && !ui.pending.move) {
    const { x, y, from } = ui.pending;
    ui.pending = null;
    const target = G.militaryAt(s, x, y) || G.cityAt(s, x, y);
    const res = await withFx(() => {
      if (from != null && !G.canAttack(s, u, x, y)) G.orderMove(s, u.id, from % s.width, Math.floor(from / s.width));
      return s.units[u.id] && G.canAttack(s, u, x, y) ? G.attack(s, u.id, x, y) : null;
    });
    if (res) {
      const name = target && target.name ? target.name : 'враг';
      if (res.captured) toast(`Город ${name} захвачен!`);
      else if (res.killed) toast('Враг уничтожен');
      else if (res.died) toast('Ваш юнит погиб', true);
      else toast(`Урон врагу ${res.toDef}${res.toAtk ? `, вам ${res.toAtk}` : ''}`);
    }
    ui.pending = null;
    if (s.over) { refresh(); showGameOver(); return; }
    afterUnitAction(u.id);
  } else if (act === 'upgrade' && u) {
    G.upgradeUnit(s, u.id); refresh();
  } else if (act === 'buy' && c) {
    if (G.purchase(s, c.id)) toast(`${c.name}: куплено`);
    refresh();
  } else if (act === 'gift' && c) {
    G.giftGold(s, me, c.owner); refresh();
  } else if (act === 'war' && c) {
    const minor = s.players[c.owner];
    confirmBox(`Объявить войну поселению ${minor.name}? Вы потеряете всё влияние на него.`, 'Объявить войну', () => { G.declareWar(s, me, minor.id); refresh(); });
  } else if (act === 'cancel') {
    ui.pending = null; refresh();
  } else if (act === 'production' && c) {
    openProduction(c);
  }
});

// ---------- Кнопка «Дальше» ----------

function pendingTask() {
  if (s.over) return { kind: 'over', label: 'Новая игра' };
  const p = s.players[me];
  if (p.pendingEmperor && G.playerCities(s, me).length) return { kind: 'emperor', label: `${I.crown} Выбрать императора` };
  if (!p.research && G.availableTechs(s, me).length && G.playerCities(s, me).length) {
    return { kind: 'research', label: `${I.sci} Выбрать исследование` };
  }
  const c = G.citiesWithoutProduction(s, me)[0];
  if (c) return { kind: 'city', c, label: `${c.name}: что строить?` };
  const units = G.needsOrders(s, me);
  if (units.length) {
    const cur = ui.sel && ui.sel.kind === 'unit' ? units.find((u) => u.id === ui.sel.id) : null;
    const u = cur ? units.find((x) => x !== cur) || cur : units[0];
    return { kind: 'unit', u, label: `Дальше: ${UNITS[u.type].name}${units.length > 1 ? ` <span class="cnt">${units.length}</span>` : ''}` };
  }
  return { kind: 'end', label: 'Конец хода ▶' };
}

function updateNext() {
  const t = pendingTask();
  nextBtn.innerHTML = t.label;
  nextBtn.classList.toggle('primary', true);
  skipBtn.classList.toggle('hidden', t.kind === 'end' || t.kind === 'over');
}

nextBtn.addEventListener('click', () => {
  if (!s) return;
  if (playing) { playing.skip = true; return; }
  const t = pendingTask();
  if (t.kind === 'emperor') openEmperor();
  else if (t.kind === 'research') openResearch();
  else if (t.kind === 'city') { selectCity(t.c, true); openProduction(t.c); }
  else if (t.kind === 'unit') selectUnit(t.u, !onScreenTile(t.u.x, t.u.y));
  else if (t.kind === 'end') doEndTurn();
  else if (t.kind === 'over') openNewGame();
});

// Маленькая кнопка «закончить ход сейчас», если не хочется раздавать приказы
const skipBtn = document.createElement('button');
skipBtn.innerHTML = I.skip;
skipBtn.className = 'icon';
skipBtn.setAttribute('aria-label', 'Закончить ход');
skipBtn.style.position = 'absolute';
const row = document.createElement('div');
row.style.cssText = 'display:flex;gap:8px';
nextBtn.replaceWith(row);
row.append(nextBtn, skipBtn);
skipBtn.style.position = '';
skipBtn.style.minHeight = '52px';
skipBtn.style.width = '56px';
skipBtn.addEventListener('click', () => {
  if (!s || s.over) return;
  const left = G.needsOrders(s, me).length;
  const msg = left ? `Закончить ход? ${left} ${plural(left, 'юнит', 'юнита', 'юнитов')} без приказа просто постоят.` : 'Закончить ход?';
  confirmBox(msg, 'Закончить ход', doEndTurn);
});

function relevant(e) {
  return e.pid === me || e.pid === null || (Array.isArray(e.pid) && e.pid.includes(me));
}

async function doEndTurn() {
  if (playing) return;
  ui.sel = null; ui.pending = null;
  refresh();
  const myName = s.players[me].name;
  nextBtn.textContent = 'Ходят соперники… (нажмите, чтобы пропустить)';
  skipBtn.classList.add('hidden');
  const events = (await withFx(() => endTurn(s), false)).filter(relevant);
  refresh();
  const bad = (e) => !e.text.startsWith(myName) && /атакует|захватили|голод|обстрелял|уничтожены/.test(e.text);
  const sorted = [...events.filter(bad), ...events.filter((e) => !bad(e))];
  sorted.slice(0, 3).forEach((e, k) => setTimeout(() => toast(e.text, bad(e), e.x, e.y), k * 120));
  if (sorted.length > 3) setTimeout(() => toast(`…и ещё ${sorted.length - 3} — смотрите журнал в меню`), 400);
  if (s.over) { showGameOver(); return; }
  const attacked = events.find((e) => bad(e) && e.x != null);
  if (attacked) centerOn(attacked.x, attacked.y);
}

// ---------- Уведомления ----------

function toast(text, bad = false, x = null, y = null) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = text;
  if (x != null) el.addEventListener('click', () => { centerOn(x, y); el.remove(); });
  $('toasts').append(el);
  while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), 3800);
}

// ---------- Окна ----------

function openModal(title, html, { center = false, closable = true } = {}) {
  $('modalTitle').textContent = title;
  $('modalBody').innerHTML = html;
  $('modal').classList.remove('hidden');
  $('modal').classList.toggle('center', center);
  $('modalClose').style.visibility = closable ? 'visible' : 'hidden';
  $('modal').dataset.closable = closable ? '1' : '';
}
function closeModal() {
  $('modal').classList.add('hidden');
  $('modalBody').innerHTML = '';
}
$('modalClose').addEventListener('click', closeModal);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal') && $('modal').dataset.closable) closeModal(); });

function confirmBox(text, okLabel, onOk) {
  openModal('Подтвердите', `<p>${text}</p><div class="choice"><button class="primary" id="cOk">${okLabel}</button><button id="cNo">Отмена</button></div>`, { center: true });
  $('cOk').onclick = () => { closeModal(); onOk(); };
  $('cNo').onclick = closeModal;
}

function openResearch() {
  const p = s.players[me];
  const opts = G.availableTechs(s, me).sort((a, b) => TECHS[a].cost - TECHS[b].cost);
  const total = Object.keys(TECHS).length;
  const items = opts.map((t) => `<button class="item ${p.research === t ? 'current' : ''}" data-tech="${t}">
      <span class="ic">${I.sci}</span><span class="tx"><div class="nm">${TECHS[t].name}</div><div class="ds">Открывает: ${TECHS[t].desc}</div></span>
      <span class="rt">${turnsText(techTurns(me, t))}</span></button>`).join('');
  const known = p.techs.map((t) => TECHS[t].name).join(', ');
  openModal('Что исследовать?', `<div class="list">${items || '<p class="muted">Всё изучено.</p>'}</div>
    <p class="muted">Изучено ${p.techs.length} из ${total}${known ? `: ${known}` : ''}.</p>`);
  $('modalBody').querySelectorAll('[data-tech]').forEach((b) => b.addEventListener('click', () => {
    G.setResearch(s, me, b.dataset.tech);
    closeModal();
    refresh();
  }));
}

function openProduction(c) {
  const opts = G.productionOptions(s, c);
  const y = G.cityYield(s, c);
  const row = (o) => {
    const cur = c.build && c.build.kind === o.kind && c.build.id === o.id;
    const extra = o.id === 'settler' && c.pop < 2 ? ' Нужно 2 жителя.' : '';
    const right = o.kind === 'project' ? `+${Math.floor(y.prod / 2)} ${I.gold}` : turnsText(G.turnsToBuild(s, c, o));
    return `<button class="item ${cur ? 'current' : ''}" data-kind="${o.kind}" data-id="${o.id}">
      <span class="ic">${o.kind === 'unit' ? thumb(`unit_${o.id}_${teamName(c.owner)}`) : o.kind === 'project' ? I.gold : I.build}</span><span class="tx"><div class="nm">${o.name}${o.unique ? ' <span class="tag">особый</span>' : ''}</div><div class="ds">${o.desc}${extra}</div></span>
      <span class="rt">${right}</span></button>`;
  };
  const units = opts.filter((o) => o.kind === 'unit');
  const blds = opts.filter((o) => o.kind === 'building');
  const projects = opts.filter((o) => o.kind === 'project');
  openModal(`${c.name}: что строить?`, `<div class="list">
    <div class="section">Юниты</div>${units.map(row).join('')}
    ${blds.length ? `<div class="section">Здания</div>${blds.map(row).join('')}` : ''}
    ${projects.length ? `<div class="section">Проекты</div>${projects.map(row).join('')}` : ''}</div>`);
  $('modalBody').querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
    G.setProduction(s, c.id, b.dataset.kind, b.dataset.id);
    closeModal();
    refresh();
  }));
}

function openEmperor() {
  const p = s.players[me];
  const prev = p.emperor ? `<p class="muted">Правление императора ${p.emperor.name} окончено.</p>` : '<p class="muted">Империи нужен правитель. Его черта действует 35 ходов.</p>';
  const items = Object.entries(EMPEROR_TRAITS).map(([k, t]) => `<button class="item" data-trait="${k}">
      <span class="ic">${{ conqueror: I.str, builder: I.prod, diplomat: I.gift }[k]}</span><span class="tx"><div class="nm">${t.name}</div><div class="ds">${t.desc}</div></span></button>`).join('');
  openModal('Новый император', `${prev}<div class="list">${items}</div>`);
  $('modalBody').querySelectorAll('[data-trait]').forEach((b) => b.addEventListener('click', () => {
    G.chooseEmperor(s, me, b.dataset.trait);
    closeModal();
    toast(`На трон взошёл ${s.players[me].emperor.name}`);
    refresh();
  }));
}

$('research').addEventListener('click', () => { if (s && !s.over) openResearch(); });

// ---------- Обзор карты и список городов ----------

function openOverview() {
  const w = Math.min(520, window.innerWidth - 28);
  const h = Math.round(w * (s.height * 0.866 + 0.3) / (s.width + 0.5));
  const cities = G.playerCities(s, me).sort((a, b) => (b.capital ? 1 : 0) - (a.capital ? 1 : 0) || b.pop - a.pop);
  const rows = cities.map((c) => {
    const what = !c.build ? '<span style="color:var(--accent)">ничего не строит</span>'
      : c.build.kind === 'project' ? 'Коммерция'
      : `${(c.build.kind === 'unit' ? UNITS : BUILDINGS)[c.build.id].name} · ${turnsText(G.turnsToBuild(s, c))}`;
    return `<button class="item" data-city="${c.id}"><span class="ic"><span class="cityicon" style="background:${s.players[me].color}">${c.pop}</span></span>
      <span class="tx"><div class="nm">${c.name} · ${c.pop}</div><div class="ds">${what}</div></span></button>`;
  }).join('');
  openModal('Обзор', `<canvas id="ov" style="width:${w}px;height:${h}px;border-radius:10px;display:block"></canvas>
    <p class="muted" style="margin:6px 0 10px">Нажмите на карту, чтобы перейти туда.</p>
    <div class="section">Ваши города</div><div class="list">${rows || '<p class="muted">Пока нет городов.</p>'}</div>
    <div class="section">Нейтральные поселения</div><div class="list">${minorRows() || '<p class="muted">Пока никого не встретили.</p>'}</div>`);
  const cv = $('ov');
  cv.width = w * dpr; cv.height = h * dpr;
  const octx = cv.getContext('2d');
  octx.scale(dpr, dpr);
  const size = BASE_SIZE * view.cam.zoom;
  const camRect = { x: -view.cam.x / (size * Math.sqrt(3)), y: -view.cam.y / (size * 1.5 * KY),
    w: view.width / (size * Math.sqrt(3)), h: view.height / (size * 1.5 * KY) };
  const cell = renderOverview(octx, s, me, w, h, camRect);
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const y = Math.max(0, Math.min(s.height - 1, Math.floor((e.clientY - r.top) / (cell * 0.866))));
    const x = Math.max(0, Math.min(s.width - 1, Math.floor((e.clientX - r.left) / cell - 0.5 * (y & 1))));
    closeModal();
    centerOn(x, y);
  });
  $('modalBody').querySelectorAll('[data-city]').forEach((b) => b.addEventListener('click', () => {
    closeModal();
    selectCity(s.cities[+b.dataset.city], true);
  }));
}

function minorRows() {
  return G.minors(s).filter((m) => {
    const c = m.alive && G.minorCity(s, m);
    return c && s.players[me].explored[G.idx(s, c.x, c.y)];
  }).map((m) => {
    const c = G.minorCity(s, m);
    const t = MINOR_TYPES[m.minorType];
    const status = m.hostile.includes(me) ? '<span style="color:var(--danger)">война</span>'
      : m.ally === me ? '<span style="color:var(--good)">ваш союзник</span>'
      : m.ally != null ? `союзник: ${s.players[m.ally].name}` : 'ничей';
    return `<button class="item" data-city="${c.id}"><span class="ic"><span class="cityicon" style="background:${m.color}">${c.pop}</span></span>
      <span class="tx"><div class="nm">${m.name} · ${t.name}</div><div class="ds">Влияние ${m.influence[me] || 0} · ${status}</div></span></button>`;
  }).join('');
}
$('mapBtn').addEventListener('click', () => { if (s && !playing) openOverview(); });

function statsTable() {
  const rows = G.majors(s).map((p) => {
    const st = G.playerStats(s, p.id);
    const met = p.id === me || G.playerCities(s, p.id).some((c) => s.players[me].explored[G.idx(s, c.x, c.y)]);
    return `<tr><td>${swatch(p.id)} ${p.name}${p.id === me ? ' (вы)' : ''}</td>
      <td>${p.alive ? (met ? st.cities : '?') : '✝'}</td><td>${p.alive && met ? st.army : '—'}</td><td>${p.alive ? st.techs : '—'}</td></tr>`;
  }).join('');
  return `<table class="stats"><tr><th>Игрок</th><th>Города</th><th>Армия</th><th>Техн.</th></tr>${rows}</table>`;
}

$('menuBtn').addEventListener('click', () => {
  if (!s) return openNewGame();
  openModal('Меню', `${statsTable()}<div class="list">
    <button class="item" id="mLog"><span class="ic">${I.build}</span><span class="tx"><div class="nm">Журнал событий</div></span></button>
    <button class="item" id="mHelp"><span class="ic">${I.star}</span><span class="tx"><div class="nm">Как играть</div></span></button>
    <button class="item" id="mNew"><span class="ic">${I.skip}</span><span class="tx"><div class="nm">Новая игра</div><div class="ds">Текущая партия будет потеряна</div></span></button>
  </div><p class="muted">Партия сохраняется автоматически после каждого действия.</p>`);
  $('mLog').onclick = openLog;
  $('mHelp').onclick = openHelp;
  $('mNew').onclick = () => confirmBox('Начать новую игру? Текущая партия пропадёт.', 'Новая игра', openNewGame);
});

function openLog() {
  const items = s.events.filter(relevant).slice(-40).reverse()
    .map((e) => `<div class="item" style="padding:6px 4px"><span class="tx"><span class="muted">Ход ${e.turn}:</span> ${e.text}</span></div>`).join('');
  openModal('Журнал', items || '<p class="muted">Пока пусто.</p>');
}

function openHelp() {
  openModal('Как играть', `<div class="help">
    <p><b>Цель:</b> захватить или уничтожить все города других фракций. Потеряете все свои — поражение.</p>
    <p><b>Кнопка внизу</b> всегда подсказывает следующий шаг: выбрать исследование, что строить в городе, куда идти юниту. Когда всё сделано — «Конец хода».</p>
    <p><b>Юниты:</b> нажмите на юнита, затем на клетку и подтвердите «Идти сюда». Красная рамка — можно атаковать, перед атакой покажут ожидаемый урон.</p>
    <p><b>Города</b> растут от еды, строят за счёт производства, дают науку и деньги. Новый город основывают колонисты, не ближе 3 клеток к другому.</p>
    <p><b>Деньги:</b> армия сверх бесплатной требует содержания. За деньги можно сразу купить то, что строит город, улучшить старый юнит и делать подарки поселениям.</p>
    <p><b>Нейтральные поселения:</b> дарите им деньги, чтобы стать союзником и получать бонус. Нападать на них можно, только объявив войну.</p>
    <p><b>Планета:</b> руины дают находки, гнёзда порождают фауну — уничтожьте их бойцом. Особые ресурсы (кристаллы, гейзеры, плодородная почва, металлы, планктон) усиливают клетки.</p>
    <p><b>Бой:</b> лес и скалы дают +25% к защите, укрепление ещё +25%. Чтобы взять город, сбейте его прочность и войдите бойцом ближнего боя.</p>
    <p><b>Карта:</b> двигайте пальцем, щипок — масштаб, кнопка карты сверху — обзор.</p></div>`);
}

function openNewGame() {
  const saved = s && !s.over ? null : loadSaved();
  let opp = prefs().opp || 2, diff = prefs().diff || 'normal', fac = prefs().faction || 'empire';
  const facCards = () => PLAYABLE_FACTIONS.map((k) => {
    const f = FACTIONS[k];
    return `<button class="item fac ${k === fac ? 'current' : ''}" data-fac="${k}">
      <span class="facbar" style="background:${f.color};box-shadow:inset 0 0 0 2px ${f.rim}"></span>
      <span class="tx"><div class="nm">${f.name}</div><div class="ds">${f.tagline}</div>
      <div class="ds"><b style="color:var(--text)">${f.bonus}:</b> ${f.bonusDesc}</div></span></button>`;
  }).join('');
  const html = () => `<div class="title-screen">
    <h1>Pocket 4X</h1><div class="muted sub">Пошаговая стратегия на чужой планете</div>
    ${saved && !saved.over ? `<div class="col"><button class="primary big" id="nContinue">Продолжить · ход ${saved.turn}</button></div><div class="section" style="margin-top:18px">Или новая партия</div>` : ''}
    <div class="section" style="margin-top:14px">Ваша фракция</div>
    <div class="list" style="text-align:left;margin:6px 0 12px">${facCards()}</div>
    <div class="section">Соперники</div>
    <div class="choice">${[1, 2, 3].map((n) => `<button data-opp="${n}" class="${n === opp ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="section">Сложность</div>
    <div class="choice">${Object.entries(DIFFICULTY).map(([k, d]) => `<button data-diff="${k}" class="${k === diff ? 'on' : ''}">${d.name}</button>`).join('')}</div>
    <button class="${saved && !saved.over ? '' : 'primary'} big" id="nStart">Начать новую партию</button></div>`;
  const bind = () => {
    $('modalBody').querySelectorAll('[data-opp]').forEach((b) => b.onclick = () => { opp = +b.dataset.opp; $('modalBody').innerHTML = html(); bind(); });
    $('modalBody').querySelectorAll('[data-diff]').forEach((b) => b.onclick = () => { diff = b.dataset.diff; $('modalBody').innerHTML = html(); bind(); });
    $('modalBody').querySelectorAll('[data-fac]').forEach((b) => b.onclick = () => { fac = b.dataset.fac; $('modalBody').innerHTML = html(); bind(); });
    $('nStart').onclick = () => {
      setPref('opp', opp); setPref('diff', diff); setPref('faction', fac);
      startGame(G.createGame({ seed: (Date.now() ^ (Math.random() * 1e9)) | 0, opponents: opp, difficulty: diff, faction: fac }));
      closeModal();
      if (!prefs().seenHelp) { setPref('seenHelp', true); openHelp(); }
    };
    const cont = $('nContinue');
    if (cont) cont.onclick = () => { startGame(saved); closeModal(); };
  };
  openModal('', html(), { center: true, closable: !!s });
  bind();
}

function showGameOver() {
  const win = s.result === 'victory';
  openModal(win ? 'Победа' : 'Поражение', `<p>${win ? `Все соперники повержены на ходу ${s.turn}.` : `Ваша держава пала на ходу ${s.turn}.`}</p>
    ${statsTable()}<div class="choice"><button class="primary" id="goNew">Новая игра</button><button id="goMap">Посмотреть карту</button></div>`, { center: true });
  $('goNew').onclick = openNewGame;
  $('goMap').onclick = () => { s.players[me].explored.fill(1); closeModal(); refresh(); };
}

function startGame(state) {
  s = state;
  me = (G.humanPlayer(s) || s.players[0]).id;
  ui.sel = null; ui.pending = null;
  resize();
  refresh();
  const first = G.playerCities(s, me).find((c) => c.capital) || G.playerUnits(s, me)[0] || G.playerCities(s, me)[0];
  if (first) centerOn(first.x, first.y);
  if (s.over) showGameOver();
}

// ---------- Запуск ----------

window.addEventListener('resize', () => { resize(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

$('mapBtn').innerHTML = I.map;
$('menuBtn').innerHTML = I.menu;
$('modalClose').innerHTML = I.close;
resize();
loadSprites().then(() => {
  const existing = loadSaved();
  if (existing && !existing.over) startGame(existing);
  else openNewGame();
  draw();
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// для отладки в консоли
window.__game = () => s;
window.__ui = { refresh, showGameOver };
