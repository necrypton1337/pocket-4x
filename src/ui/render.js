// Отрисовка карты. Графика — спрайты, отрендеренные в Blender (tools/blender/render_assets.py).
// Карта наклонена так же, как камера рендера: по вертикали гексы сжаты в KY раз.
// Порядок кадра: земля → подсветки и границы → объекты по рядам (дальние раньше ближних) → подписи.
import { TERRAIN, UNITS, FACTIONS } from '../core/data.js';
import { cityList, unitList, isCivil, cityMaxHp, idx, cityHas } from '../core/game.js';

const SQRT3 = Math.sqrt(3);
export const BASE_SIZE = 30;
export let KY = Math.cos((40 * Math.PI) / 180);

// ---------- спрайты ----------

const sprites = new Map();
let spritesReady = false;

export async function loadSprites(base = 'assets/') {
  try {
    const man = await (await fetch(base + 'manifest.json')).json();
    KY = man.k;
    const entries = Object.entries(man.sprites);
    await Promise.all(entries.map(([name, m]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { sprites.set(name, { ...m, img }); resolve(); };
      img.onerror = resolve;
      img.src = base + name + '.' + (man.ext || 'png');
    })));
    spritesReady = true;
  } catch {
    spritesReady = false;
  }
  return spritesReady;
}
export const assetsReady = () => spritesReady;

// Производные спрайты (затемнённые для тумана, земля с мягким краем) считаем один раз.
const derived = new Map();
function darkVersion(name) {
  const key = name + '|dark';
  if (derived.has(key)) return derived.get(key);
  const sp = sprites.get(name);
  if (!sp) return null;
  const c = document.createElement('canvas');
  c.width = sp.w; c.height = sp.h;
  const g = c.getContext('2d');
  g.drawImage(sp.img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(12,16,26,0.55)';
  g.fillRect(0, 0, sp.w, sp.h);
  const out = { ...sp, img: c };
  derived.set(key, out);
  return out;
}
function softGround(name) {
  const key = name + '|soft';
  if (derived.has(key)) return derived.get(key);
  const sp = sprites.get(name);
  if (!sp) return null;
  const c = document.createElement('canvas');
  c.width = sp.w; c.height = sp.h;
  const g = c.getContext('2d');
  g.drawImage(sp.img, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.save();
  g.translate(sp.ax, sp.ay);
  g.scale(1, KY);
  const R = sp.px;
  const grad = g.createRadialGradient(0, 0, R * 0.78, 0, 0, R * 1.12);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(0, 0, R * 1.2, 0, Math.PI * 2); g.fill();
  g.restore();
  const out = { ...sp, img: c };
  derived.set(key, out);
  return out;
}

function drawSprite(ctx, sp, sx, sy, size, scale = 1) {
  if (!sp) return false;
  const k = (size / sp.px) * scale;
  ctx.drawImage(sp.img, sx - sp.ax * k, sy - sp.ay * k, sp.w * k, sp.h * k);
  return true;
}

// ---------- геометрия ----------

export function tileCenter(x, y, size) {
  return [size * SQRT3 * (x + 0.5 * (y & 1)), size * 1.5 * y * KY];
}

export function pixelToTile(px, py, size) {
  py /= KY;
  const q = ((SQRT3 / 3) * px - py / 3) / size;
  const r = ((2 / 3) * py) / size;
  let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
  const dx = Math.abs(rx - q), dy = Math.abs(ry - (-q - r)), dz = Math.abs(rz - r);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy <= dz) rz = -rx - ry;
  const row = rz;
  return [rx + (row - (row & 1)) / 2, row];
}

function hexPath(ctx, cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const px = cx + size * Math.cos(a), py = cy + size * Math.sin(a) * KY;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

const EDGE_CORNERS = [[0, 1], [5, 0], [4, 5], [3, 4], [2, 3], [1, 2]];
function corner(cx, cy, size, i) {
  const a = (Math.PI / 180) * (60 * i - 30);
  return [cx + size * Math.cos(a), cy + size * Math.sin(a) * KY];
}
function neighborDirs(x, y) {
  const EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
  const ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
  return (y & 1 ? ODD : EVEN).map(([dx, dy]) => [x + dx, y + dy]);
}

function ellipse(ctx, x, y, rx, ry) {
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

// ---------- выбор спрайтов ----------

const shallowCache = new WeakMap();
function shallowMap(s) {
  let m = shallowCache.get(s.tiles);
  if (m) return m;
  m = s.tiles.map((t, i) => {
    if (t.t !== 'water') return false;
    const x = i % s.width, y = Math.floor(i / s.width);
    return neighborDirs(x, y).some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < s.width && ny < s.height && s.tiles[ny * s.width + nx].t !== 'water');
  });
  shallowCache.set(s.tiles, m);
  return m;
}

const variantOf = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % 3;

function groundName(s, i, x, y, shallow) {
  const t = s.tiles[i].t;
  return `ground_${t === 'water' && shallow[i] ? 'shallow' : t}_${variantOf(x, y)}`;
}
function propName(t, x, y) {
  return t === 'forest' || t === 'hills' || t === 'mountain' ? `prop_${t}_${variantOf(x + 7, y + 3)}` : null;
}
function cityStyle(s, c) {
  const p = s.players[c.owner];
  if (p.kind === 'minor') return 'minor';
  return p.faction ? FACTIONS[p.faction].style : 'colonists';
}
function teamOf(s, owner) {
  const p = s.players[owner];
  if (p.kind === 'fauna') return 'fauna';
  if (p.kind === 'minor') return 'minor';
  return p.faction || 'colonists';
}

// ---------- мелкие элементы интерфейса на карте ----------

function hpBar(ctx, x, y, w, frac) {
  ctx.fillStyle = 'rgba(8,10,14,0.75)';
  ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
  ctx.fillStyle = frac > 0.6 ? '#5fd38a' : frac > 0.3 ? '#e8c04a' : '#e5534b';
  ctx.fillRect(x - w / 2, y, w * frac, 3);
}

function drawUnitSprite(ctx, s, u, sx, sy, size, opts) {
  const team = teamOf(s, u.owner);
  const sp = sprites.get(`unit_${u.type}_${team}`) || sprites.get(`unit_${u.type}_colonists`);
  const scale = opts.small ? 0.9 : 1.25;
  if (opts.selected) {
    ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 2.5;
    ellipse(ctx, sx, sy, size * 0.36 * scale, size * 0.36 * KY * scale); ctx.stroke();
  }
  if (!drawSprite(ctx, sp, sx, sy, size, scale)) {
    ctx.fillStyle = s.players[u.owner].color;
    ellipse(ctx, sx, sy - size * 0.2, size * 0.3, size * 0.3); ctx.fill();
  }
  const top = sy - size * 0.72 * scale;
  if (u.hp < 100) hpBar(ctx, sx, top, size * 0.5 * scale, u.hp / 100);
  if (opts.ready) {
    ctx.fillStyle = '#ffd84d'; ctx.strokeStyle = '#1a1400'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx + size * 0.28 * scale, top - 2, Math.max(3.5, size * 0.07), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  if (opts.fortified) {
    // маленький щит
    const fx = sx - size * 0.3 * scale, fy = top - 4, r = Math.max(4, size * 0.08);
    ctx.fillStyle = '#d7dde8'; ctx.strokeStyle = '#1f2937'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(fx - r, fy - r); ctx.lineTo(fx + r, fy - r); ctx.lineTo(fx + r, fy); ctx.quadraticCurveTo(fx, fy + r * 1.6, fx - r, fy); ctx.closePath();
    ctx.fill(); ctx.stroke();
  }
}

function drawCityLabel(ctx, s, c, sx, sy, size) {
  const p = s.players[c.owner];
  const color = p.color;
  const fs = Math.max(11, Math.round(size * 0.3));
  ctx.font = `600 ${fs}px system-ui, -apple-system, sans-serif`;
  const tw = ctx.measureText(c.name).width;
  const h = Math.round(fs * 1.55);
  const w = tw + h + 14;
  const lx = Math.round(sx - w / 2), ly = Math.round(sy + size * 0.55 * KY + 4);
  ctx.fillStyle = 'rgba(14,17,24,0.9)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(lx, ly, w, h, 5); else ctx.rect(lx, ly, w, h);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillRect(lx, ly, h, h);
  const light = isLight(color);
  ctx.fillStyle = light ? '#111827' : '#fff';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(c.pop), lx + h / 2, ly + h / 2 + 1);
  ctx.fillStyle = '#f3f4f6';
  ctx.textAlign = 'left';
  ctx.fillText(c.name, lx + h + 7, ly + h / 2 + 1);
  if (c.capital) {
    ctx.fillStyle = '#ffd84d';
    ctx.beginPath(); ctx.arc(lx + w - 4, ly + 4, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.textAlign = 'center';
  const max = cityMaxHp(c);
  if (c.hp < max) hpBar(ctx, sx, ly + h + 3, w - 6, c.hp / max);
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 > 170;
}

// ---------- кадр ----------

export function render(ctx, view, s, me, ui) {
  const { width: W, height: H, cam } = view;
  const size = BASE_SIZE * cam.zoom;
  const now = performance.now();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#0c1017';
  ctx.fillRect(0, 0, W, H);
  const explored = s.players[me].explored;
  const vis = ui.visible;
  const shallow = shallowMap(s);
  const toScreen = (x, y) => {
    const [wx, wy] = tileCenter(x, y, size);
    return [wx + cam.x, wy + cam.y];
  };
  const onScreen = (sx, sy, pad = 2) => sx > -size * pad && sy > -size * pad && sx < W + size * pad && sy < H + size * (pad + 1);
  const visibleTiles = [];
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const [sx, sy] = toScreen(x, y);
    if (onScreen(sx, sy)) visibleTiles.push([x, y, sx, sy]);
  }

  // 1. Земля: сначала чёткий гекс, потом мягкий край поверх соседей — переходы без «сот».
  for (const [x, y, sx, sy] of visibleTiles) {
    const i = y * s.width + x;
    if (!explored[i]) continue;
    const name = groundName(s, i, x, y, shallow);
    const sp = sprites.get(name);
    if (sp) {
      ctx.save();
      hexPath(ctx, sx, sy, size + 0.8);
      ctx.clip();
      drawSprite(ctx, sp, sx, sy, size);
      ctx.restore();
    } else {
      hexPath(ctx, sx, sy, size + 0.6);
      ctx.fillStyle = TERRAIN[s.tiles[i].t].color;
      ctx.fill();
    }
  }
  for (const [x, y, sx, sy] of visibleTiles) {
    const i = y * s.width + x;
    if (!explored[i]) continue;
    drawSprite(ctx, softGround(groundName(s, i, x, y, shallow)), sx, sy, size);
  }
  // Неразведанное — тёмная дымка с мягким краем
  for (const [x, y, sx, sy] of visibleTiles) {
    const i = y * s.width + x;
    if (explored[i]) continue;
    hexPath(ctx, sx, sy, size * 1.08);
    ctx.fillStyle = '#0c1017';
    ctx.fill();
  }
  // Туман: разведано, но сейчас не видно
  ctx.fillStyle = 'rgba(12,16,26,0.5)';
  for (const [x, y, sx, sy] of visibleTiles) {
    const i = y * s.width + x;
    if (!explored[i] || vis.has(i)) continue;
    hexPath(ctx, sx, sy, size + 0.8);
    ctx.fill();
  }

  // 2. Территория и подсветки (лежат на земле)
  for (const [x, y, sx, sy] of visibleTiles) {
    const i = y * s.width + x;
    const tile = s.tiles[i];
    if (tile.owner < 0 || !explored[i]) continue;
    const color = s.players[tile.owner].color;
    hexPath(ctx, sx, sy, size);
    ctx.globalAlpha = 0.1; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, size * 0.09);
    ctx.lineCap = 'round';
    neighborDirs(x, y).forEach(([nx, ny], d) => {
      const inside = nx >= 0 && ny >= 0 && nx < s.width && ny < s.height;
      if (inside && s.tiles[ny * s.width + nx].owner === tile.owner) return;
      const [a, b] = EDGE_CORNERS[d];
      const [x1, y1] = corner(sx, sy, size * 0.93, a);
      const [x2, y2] = corner(sx, sy, size * 0.93, b);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });
  }
  if (ui.cityTiles) {
    for (const ct of ui.cityTiles) {
      const [sx, sy] = toScreen(ct.x, ct.y);
      hexPath(ctx, sx, sy, size * 0.88);
      if (ct.worked) { ctx.fillStyle = 'rgba(255,216,77,0.16)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,216,77,0.9)'; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }
  if (ui.reach) {
    for (const [i, info] of ui.reach) {
      const [sx, sy] = toScreen(i % s.width, Math.floor(i / s.width));
      hexPath(ctx, sx, sy, size * 0.86);
      if (info.kind === 'attack') { ctx.strokeStyle = '#e5534b'; ctx.lineWidth = 3; ctx.stroke(); }
      else { ctx.fillStyle = info.kind === 'capture' ? 'rgba(255,216,77,0.3)' : 'rgba(255,255,255,0.17)'; ctx.fill(); }
    }
  }
  if (ui.targets) {
    for (const [x, y] of ui.targets) {
      const [sx, sy] = toScreen(x, y);
      hexPath(ctx, sx, sy, size * 0.86);
      ctx.strokeStyle = '#e5534b'; ctx.lineWidth = 3; ctx.stroke();
    }
  }
  if (ui.sites) {
    for (const [x, y] of ui.sites) {
      const [sx, sy] = toScreen(x, y);
      hexPath(ctx, sx, sy, size * 0.8);
      ctx.strokeStyle = '#5fd38a'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  if (ui.sel) {
    const [sx, sy] = toScreen(ui.sel.x, ui.sel.y);
    hexPath(ctx, sx, sy, size * 0.95);
    ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 3; ctx.stroke();
  }
  if (ui.path && ui.path.length) {
    ctx.fillStyle = '#ffd84d';
    ui.path.forEach(([x, y], k) => {
      const [sx, sy] = toScreen(x, y);
      if (k === ui.path.length - 1) {
        hexPath(ctx, sx, sy, size * 0.8);
        ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 3.5; ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]);
      } else {
        ellipse(ctx, sx, sy, size * 0.1, size * 0.1 * KY); ctx.fill();
      }
    });
  }
  if (ui.gotoMark) {
    const [sx, sy] = toScreen(ui.gotoMark[0], ui.gotoMark[1]);
    ellipse(ctx, sx, sy, size * 0.18, size * 0.18 * KY);
    ctx.fillStyle = 'rgba(255,216,77,0.8)'; ctx.fill();
  }

  // 3. Объекты по рядам: рельеф, улучшения, ресурсы, города, юниты
  const selId = ui.sel && ui.sel.kind === 'unit' ? ui.sel.id : null;
  const list = ui.ghosts ? [...ui.ghosts.values()] : unitList(s);
  const unitsByTile = new Map();
  const moving = [];
  for (const u of list) {
    if (u.anim) { moving.push(u); continue; }
    const k = u.y * s.width + u.x;
    if (!unitsByTile.has(k)) unitsByTile.set(k, []);
    unitsByTile.get(k).push(u);
  }
  const cityByTile = new Map(cityList(s).map((c) => [idx(s, c.x, c.y), c]));
  const pick = (name, fog) => (fog ? darkVersion(name) : sprites.get(name));
  for (const [x, y, sx, sy] of visibleTiles) {
    const i = y * s.width + x;
    if (!explored[i]) continue;
    const tile = s.tiles[i];
    const fog = !vis.has(i);
    const city = cityByTile.get(i);
    const pn = propName(tile.t, x, y);
    if (pn && !(city && tile.t !== 'mountain')) drawSprite(ctx, pick(pn, fog), sx, sy, size);
    if (tile.imp && !city) {
      const n = { farm: 'imp_farm', mine: 'imp_mine', lumber: 'imp_lumber' }[tile.imp];
      drawSprite(ctx, pick(n, fog), sx - size * (tile.imp === 'farm' ? 0 : 0.35), sy + size * 0.18 * KY, size, tile.imp === 'farm' ? 1.3 : 0.8);
    }
    if (tile.feature) drawSprite(ctx, pick(`prop_${tile.feature}_0`, fog), sx, sy, size, 0.9);
    if (tile.res) drawSprite(ctx, pick(`res_${tile.res}`, fog), sx + size * 0.42, sy + size * 0.3 * KY, size, 0.85);
    if (city) {
      const style = cityStyle(s, city);
      const level = city.pop >= 8 ? 3 : city.pop >= 4 ? 2 : 1;
      drawSprite(ctx, pick(`city_${style}_${level}`, fog), sx, sy, size, 1.3);
      if (city.capital) drawSprite(ctx, pick(`capital_${style}`, fog), sx + size * 0.05, sy - size * 0.08, size, 1.4);
      if (cityHas(city, 'walls') || cityHas(city, 'castle')) drawSprite(ctx, pick(`walls_${style}`, fog), sx, sy, size, 1.15);
    }
    const here = unitsByTile.get(i);
    if (here) {
      const shared = here.length > 1 || !!city;
      here.sort((a, b) => (isCivil(b.type) ? 1 : 0) - (isCivil(a.type) ? 1 : 0));
      for (const u of here) {
        if (u.owner !== me && fog) continue;
        const civ = isCivil(u.type);
        let ox = 0, oy = 0;
        if (shared) { ox = civ ? -size * 0.38 : size * 0.22; oy = civ ? size * 0.2 : size * 0.28; }
        const isMine = u.owner === me && !ui.ghosts;
        const ready = isMine && u.moves > 0 && !u.fortified && !u.work && !u.goto && !u.auto && u.skipTurn !== s.turn;
        drawUnitSprite(ctx, s, u, sx + ox, sy + oy * KY, size, { small: civ && shared, selected: u.id === selId, ready, fortified: u.fortified });
      }
    }
  }
  // Движущиеся юниты — поверх всего
  for (const u of moving) {
    const [ax, ay] = toScreen(u.anim.fx, u.anim.fy);
    const [bx, by] = toScreen(u.anim.tx, u.anim.ty);
    const t = u.anim.t;
    const fi = idx(s, u.anim.fx, u.anim.fy), ti = idx(s, u.anim.tx, u.anim.ty);
    if (u.owner !== me && !vis.has(fi) && !vis.has(ti)) continue;
    drawUnitSprite(ctx, s, u, ax + (bx - ax) * t, ay + (by - ay) * t, size, { selected: u.id === selId });
  }

  // 4. Подписи городов, выстрелы, цифры урона
  for (const [x, y, sx, sy] of visibleTiles) {
    const c = cityByTile.get(y * s.width + x);
    if (c && explored[y * s.width + x]) drawCityLabel(ctx, s, c, sx, sy, size);
  }
  if (ui.cityTiles) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const ct of ui.cityTiles) {
      const [sx, sy] = toScreen(ct.x, ct.y);
      const parts = [];
      if (ct.food) parts.push(['#9be07a', ct.food]);
      if (ct.prod) parts.push(['#f0b35a', ct.prod]);
      const fs = Math.max(10, Math.round(size * 0.28));
      ctx.font = `700 ${fs}px system-ui, sans-serif`;
      const w = parts.length * fs * 1.3 + 6;
      ctx.fillStyle = ct.worked ? 'rgba(20,18,8,0.85)' : 'rgba(14,17,24,0.65)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(sx - w / 2, sy - fs * 0.7, w, fs * 1.4, 4); else ctx.rect(sx - w / 2, sy - fs * 0.7, w, fs * 1.4);
      ctx.fill();
      parts.forEach(([col, v], k) => {
        const px = sx - w / 2 + 3 + fs * 1.3 * (k + 0.5);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(px - fs * 0.32, sy, fs * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f3f4f6';
        ctx.fillText(String(v), px + fs * 0.18, sy + 1);
      });
    }
  }
  if (ui.shots) {
    for (const sh of ui.shots) {
      const [ax, ay] = toScreen(sh.fx, sh.fy);
      const [bx, by] = toScreen(sh.tx, sh.ty);
      const t = sh.t;
      const px = ax + (bx - ax) * t, py = ay + (by - ay) * t - Math.sin(Math.PI * t) * size * 0.9 - size * 0.4;
      ctx.fillStyle = sh.color || '#fff4c2';
      ctx.beginPath(); ctx.arc(px, py, Math.max(3, size * 0.08), 0, Math.PI * 2); ctx.fill();
    }
  }
  if (ui.floats) {
    ui.floats = ui.floats.filter((f) => now - f.born < 1100);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of ui.floats) {
      const k = (now - f.born) / 1100;
      const [sx, sy] = toScreen(f.x, f.y);
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `800 ${Math.round(size * 0.46)}px system-ui, sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      const fy = sy - size * (0.9 + k * 0.8);
      ctx.strokeText(f.text, sx, fy);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, fy);
      ctx.globalAlpha = 1;
    }
  }
  return !!(ui.floats && ui.floats.length);
}

// Маленькая карта целиком — для окна «Обзор»
export function renderOverview(ctx, s, me, w, h, camRect) {
  const cell = Math.min(w / (s.width + 0.5), h / (s.height * 0.866 + 0.3));
  ctx.fillStyle = '#0c1017';
  ctx.fillRect(0, 0, w, h);
  const ex = s.players[me].explored;
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) {
    const i = y * s.width + x;
    const px = (x + 0.5 * (y & 1)) * cell, py = y * cell * 0.866;
    if (!ex[i]) ctx.fillStyle = '#161d27';
    else {
      const t = s.tiles[i];
      ctx.fillStyle = TERRAIN[t.t].color;
      ctx.fillRect(px, py, cell + 0.5, cell * 0.9);
      if (t.owner < 0) continue;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = s.players[t.owner].color;
    }
    ctx.fillRect(px, py, cell + 0.5, cell * 0.9);
    ctx.globalAlpha = 1;
  }
  for (const c of cityList(s)) {
    if (!ex[idx(s, c.x, c.y)]) continue;
    const px = (c.x + 0.5 * (c.y & 1) + 0.5) * cell, py = (c.y * 0.866 + 0.45) * cell;
    ctx.fillStyle = '#0c1017';
    ctx.beginPath(); ctx.arc(px, py, cell * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = s.players[c.owner].color;
    ctx.beginPath(); ctx.arc(px, py, cell * 0.42, 0, Math.PI * 2); ctx.fill();
  }
  if (camRect) {
    ctx.strokeStyle = '#ffd84d'; ctx.lineWidth = 2;
    ctx.strokeRect(camRect.x * cell, camRect.y * cell * 0.866, camRect.w * cell, camRect.h * cell * 0.866);
  }
  return cell;
}
