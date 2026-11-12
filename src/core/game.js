// Правила игры. Всё состояние — простой объект, который целиком сохраняется в JSON.
import {
  TERRAIN, IMPROVEMENTS, UNITS, BUILDINGS, TECHS, FACTIONS, PLAYABLE_FACTIONS, RESOURCES, EMPEROR_TRAITS,
  MINOR_TYPES, FAUNA_STYLE, DIFFICULTY, MAP_SIZES, RULES, ROAD,
} from './data.js';
import { neighbors, distance, tilesInRadius } from './hex.js';
import { rand, randInt, shuffle } from './rng.js';
import { generateMap } from './mapgen.js';

export const SAVE_VERSION = 2;

// ---------- Базовые запросы ----------

export const idx = (s, x, y) => y * s.width + x;
export const tileAt = (s, x, y) => s.tiles[y * s.width + x];
export const inside = (s, x, y) => x >= 0 && y >= 0 && x < s.width && y < s.height;
// «Мирный слой»: мирные юниты и поддержка могут стоять на одной клетке с бойцом.
export const isCivil = (type) => UNITS[type].kind === 'civil' || UNITS[type].kind === 'support';
export const isSupport = (type) => UNITS[type].kind === 'support';
export const isRangedType = (type) => UNITS[type].kind === 'ranged' || UNITS[type].kind === 'siege';
export const hasTech = (s, pid, tech) => tech == null || s.players[pid].techs.includes(tech);
export const unitList = (s) => Object.values(s.units);
export const cityList = (s) => Object.values(s.cities);
export const playerUnits = (s, pid) => unitList(s).filter((u) => u.owner === pid);
export const playerCities = (s, pid) => cityList(s).filter((c) => c.owner === pid);
export const humanPlayer = (s) => s.players.find((p) => p.human) || null;
export const isMajor = (s, pid) => s.players[pid].kind === 'major';
export const majors = (s) => s.players.filter((p) => p.kind === 'major');
export const minors = (s) => s.players.filter((p) => p.kind === 'minor');
export const faunaPlayer = (s) => s.players.find((p) => p.kind === 'fauna') || null;
export const factionOf = (s, pid) => s.players[pid].faction || null;
export const capitalOf = (s, pid) => playerCities(s, pid).find((c) => c.capital) || null;

// Кто с кем воюет. Крупные фракции — всегда (пока нет дипломатии), фауна — со всеми,
// нейтральные поселения — только с теми, кто им объявил войну.
export function atWar(s, a, b) {
  if (a === b) return false;
  const pa = s.players[a], pb = s.players[b];
  if (pa.kind === 'fauna' || pb.kind === 'fauna') return true;
  if (pa.kind === 'major' && pb.kind === 'major') return true;
  if (pa.kind === 'minor' && pb.kind === 'minor') return false;
  const minor = pa.kind === 'minor' ? pa : pb;
  const major = pa.kind === 'minor' ? b : a;
  return minor.hostile.includes(major);
}

export function unitsAt(s, x, y) {
  return unitList(s).filter((u) => u.x === x && u.y === y);
}
export function militaryAt(s, x, y) {
  return unitList(s).find((u) => u.x === x && u.y === y && !isCivil(u.type)) || null;
}
export function civilAt(s, x, y) {
  return unitList(s).find((u) => u.x === x && u.y === y && isCivil(u.type)) || null;
}
export function cityAt(s, x, y) {
  return cityList(s).find((c) => c.x === x && c.y === y) || null;
}

function event(s, text, pid = null, x = null, y = null) {
  s.eventSeq = (s.eventSeq || 0) + 1;
  s.events.push({ seq: s.eventSeq, turn: s.turn, text, pid, x, y });
  if (s.events.length > 300) s.events.splice(0, s.events.length - 300);
}

// ---------- Фракционные замены ----------

// Какой юнит фракция строит вместо обычного id (например, Империя — челнок вместо багги).
export function resolveUnit(s, pid, id) {
  const f = factionOf(s, pid);
  if (!f) return id;
  const rep = Object.keys(UNITS).find((k) => UNITS[k].faction === f && UNITS[k].replaces === id);
  return rep || id;
}
export function resolveBuilding(s, pid, id) {
  const f = factionOf(s, pid);
  if (!f) return id;
  const rep = Object.keys(BUILDINGS).find((k) => BUILDINGS[k].faction === f && BUILDINGS[k].replaces === id);
  return rep || id;
}
function unitAllowed(s, pid, id) {
  const d = UNITS[id], p = s.players[pid];
  if (d.fauna) return false;
  if (d.faction && d.faction !== p.faction) return false;
  if (p.kind !== 'major' && isCivil(id)) return false;
  return resolveUnit(s, pid, id) === id;
}
// Есть ли в городе здание id (или фракционная замена)
export function cityHas(c, id) {
  if (c.buildings.includes(id)) return true;
  return c.buildings.some((b) => BUILDINGS[b].replaces === id);
}

// ---------- Создание партии ----------

const SYL = ['ар', 'бел', 'вен', 'гор', 'дан', 'ер', 'зар', 'ил', 'кор', 'лин', 'мар', 'нор', 'ост', 'пел', 'рад',
  'сол', 'тар', 'ул', 'фен', 'хар', 'чер', 'ям', 'ве', 'ла', 'ми', 'то', 'ра', 'ни', 'да', 'ск', 'ор', 'ель'];

function makeName(s, unique = true) {
  for (let tries = 0; tries < 100; tries++) {
    const n = 2 + (randInt(s, 3) === 0 ? 1 : 0);
    let name = '';
    for (let i = 0; i < n; i++) name += SYL[randInt(s, SYL.length)];
    name = name[0].toUpperCase() + name.slice(1);
    if (name.length >= 4 && name.length <= 9 && (!unique || !s.usedNames.includes(name))) {
      if (unique) s.usedNames.push(name);
      return name;
    }
  }
  return 'Город ' + s.nextId;
}

function newPlayer(s, props) {
  const id = s.players.length;
  const p = {
    id, kind: 'major', faction: null, name: '', color: '#888', human: false, alive: true,
    techs: [], research: null, sci: 0, gold: 0, explored: new Array(s.width * s.height).fill(0),
    everHadCity: false, mult: 1, ai: {}, ...props,
  };
  s.players.push(p);
  return p;
}

export function createGame({ seed = Date.now(), opponents = 2, difficulty = 'normal', allAI = false, faction = null } = {}) {
  const holder = { rng: seed | 0 };
  const [w, h] = MAP_SIZES[opponents];
  const n = opponents + 1;
  const { tiles, starts } = generateMap(holder, w, h, n);
  const s = {
    version: SAVE_VERSION, seed, rng: holder.rng, turn: 1, width: w, height: h, tiles,
    players: [], units: {}, cities: {}, nextId: 1, difficulty, over: false, winner: null, result: null,
    events: [], usedNames: [], nests: {},
  };
  // Крупные фракции
  const pool = shuffle(s, [...PLAYABLE_FACTIONS]);
  let myFaction = faction && PLAYABLE_FACTIONS.includes(faction) ? faction : pool[0];
  const others = pool.filter((f) => f !== myFaction);
  for (let i = 0; i < n; i++) {
    const human = !allAI && i === 0;
    const f = i === 0 ? myFaction : others[i - 1] || 'colonists';
    const fd = FACTIONS[f];
    newPlayer(s, {
      kind: 'major', faction: f, name: fd.name, color: fd.color, human,
      mult: human ? 1 : DIFFICULTY[difficulty].aiMult, gold: 20,
    });
    const st = starts[i];
    spawnUnit(s, 'settler', i, st.x, st.y);
    const spot = neighbors(w, h, st.x, st.y).find(([x, y]) => TERRAIN[tileAt(s, x, y).t].move !== Infinity);
    spawnUnit(s, 'warrior', i, spot ? spot[0] : st.x, spot ? spot[1] : st.y);
    if (!human && difficulty === 'hard') {
      const spot2 = neighbors(w, h, st.x, st.y).filter(([x, y]) => TERRAIN[tileAt(s, x, y).t].move !== Infinity && !militaryAt(s, x, y))[0];
      if (spot2) spawnUnit(s, 'warrior', i, spot2[0], spot2[1]);
    }
  }
  placeMinors(s, starts, n + 1);
  newPlayer(s, { kind: 'fauna', name: FAUNA_STYLE.name, color: FAUNA_STYLE.color });
  placeFeatures(s, starts);
  for (const p of s.players) beginPlayerTurn(s, p.id);
  return s;
}

function landTile(s, x, y) {
  const t = tileAt(s, x, y);
  return t.t !== 'water' && TERRAIN[t.t].move !== Infinity;
}

function placeMinors(s, starts, count) {
  const types = shuffle(s, Object.keys(MINOR_TYPES));
  const placed = [];
  const cands = [];
  for (let y = 2; y < s.height - 2; y++) for (let x = 2; x < s.width - 2; x++) {
    if (!landTile(s, x, y) || tileAt(s, x, y).t === 'hills') continue;
    if (starts.some((st) => distance(st.x, st.y, x, y) < 6)) continue;
    cands.push([x, y]);
  }
  shuffle(s, cands);
  for (const [x, y] of cands) {
    if (placed.length >= count) break;
    if (placed.some(([px, py]) => distance(px, py, x, y) < 6)) continue;
    placed.push([x, y]);
    const type = types[placed.length % types.length];
    const p = newPlayer(s, {
      kind: 'minor', minorType: type, name: makeName(s, true), color: MINOR_TYPES[type].color,
      influence: {}, hostile: [], ally: null, lastMerc: 0,
    });
    const c = createCity(s, p.id, x, y);
    c.pop = 2;
    claimTerritory(s, c);
    spawnUnit(s, 'warrior', p.id, x, y);
  }
}

function placeFeatures(s, starts) {
  for (let i = 0; i < s.tiles.length; i++) {
    const t = s.tiles[i];
    const fits = Object.keys(RESOURCES).filter((k) => RESOURCES[k].on.includes(t.t));
    if (fits.length && rand(s) < (t.t === 'water' ? 0.05 : 0.08)) t.res = fits[randInt(s, fits.length)];
  }
  const free = [];
  for (let y = 1; y < s.height - 1; y++) for (let x = 1; x < s.width - 1; x++) {
    if (!landTile(s, x, y) || tileAt(s, x, y).owner !== -1) continue;
    if (starts.some((st) => distance(st.x, st.y, x, y) < 4)) continue;
    free.push([x, y]);
  }
  shuffle(s, free);
  const ruins = Math.round(s.width * s.height / 70);
  const nests = Math.round(s.width * s.height / 95);
  const used = [];
  const far = (x, y, d) => used.every(([ux, uy]) => distance(ux, uy, x, y) >= d);
  for (const [x, y] of free) {
    if (used.length >= ruins) break;
    if (!far(x, y, 3)) continue;
    tileAt(s, x, y).feature = 'ruins';
    used.push([x, y]);
  }
  let made = 0;
  for (const [x, y] of free) {
    if (made >= nests) break;
    if (!far(x, y, 4) || starts.some((st) => distance(st.x, st.y, x, y) < 6)) continue;
    if (cityList(s).some((c) => distance(c.x, c.y, x, y) < 4)) continue;
    tileAt(s, x, y).feature = 'nest';
    s.nests[idx(s, x, y)] = { last: 0 };
    used.push([x, y]);
    made++;
  }
}

export function spawnUnit(s, type, owner, x, y) {
  const id = s.nextId++;
  const u = { id, type, owner, x, y, hp: RULES.unitHp, moves: UNITS[type].moves, fortified: false,
    work: null, goto: null, acted: false, skipTurn: 0, vet: false };
  s.units[id] = u;
  return u;
}

// Запись событий для анимации. Включается, только если интерфейс положил массив в s._fx.
function fx(s, e) {
  if (s._fx) s._fx.push(e);
}

function removeUnit(s, u) {
  fx(s, { t: 'remove', id: u.id });
  delete s.units[u.id];
}

// ---------- Видимость ----------

export function visibleSet(s, pid) {
  const v = new Set();
  const add = (x, y, r) => { for (const [nx, ny] of tilesInRadius(s.width, s.height, x, y, r)) v.add(idx(s, nx, ny)); };
  for (const u of playerUnits(s, pid)) add(u.x, u.y, RULES.unitSight);
  for (const c of playerCities(s, pid)) add(c.x, c.y, RULES.citySight);
  s.tiles.forEach((t, i) => { if (t.owner === pid) v.add(i); });
  return v;
}

export function updateExplored(s, pid) {
  const v = visibleSet(s, pid);
  const ex = s.players[pid].explored;
  for (const i of v) ex[i] = 1;
  return v;
}

// ---------- Клетки и города ----------

export function tileYield(s, x, y, pid) {
  const tile = tileAt(s, x, y);
  const t = TERRAIN[tile.t];
  let food = t.food, prod = t.prod, gold = t.gold || 0, sci = 0;
  if (tile.imp) {
    const imp = IMPROVEMENTS[tile.imp];
    food += imp.food;
    prod += imp.prod;
    if (tile.imp === 'farm' && pid != null && hasTech(s, pid, 'irrigation')) food += 1;
  }
  if (tile.res) {
    const r = RESOURCES[tile.res];
    food += r.food; prod += r.prod; gold += r.gold; sci += r.sci;
  }
  return { food, prod, gold, sci };
}

export const growthNeed = (pop) => 15 + 8 * (pop - 1) + Math.floor(Math.pow(pop - 1, 1.8));
export const cityMaxHp = (c) => RULES.cityBaseHp + (cityHas(c, 'walls') ? 100 : 0) + (cityHas(c, 'castle') ? 100 : 0);
export const territoryRadius = (pop) => (pop >= 6 ? 3 : pop >= 3 ? 2 : 1);

// Жители выбирают клетки по очереди: пока еды мало — еду, потом больше производство.
export function workedTiles(s, c) {
  const options = [];
  s.tiles.forEach((t, i) => {
    if (t.city !== c.id) return;
    const x = i % s.width, y = Math.floor(i / s.width);
    if (x === c.x && y === c.y) return;
    if (TERRAIN[t.t].move === Infinity && t.t !== 'water') return;
    const enemy = unitList(s).some((u) => u.x === x && u.y === y && u.owner !== c.owner && atWar(s, u.owner, c.owner));
    if (enemy) return;
    const yv = tileYield(s, x, y, c.owner);
    options.push({ i, ...yv });
  });
  const center = tileYield(s, c.x, c.y, c.owner);
  let surplus = Math.max(2, center.food) + (cityHas(c, 'granary') ? 2 : 0) - c.pop * 2;
  const picked = [];
  for (let k = 0; k < c.pop && options.length; k++) {
    const wf = surplus < 2 ? 2.2 : surplus < 4 ? 1.0 : surplus < 8 ? 0.45 : 0.2;
    const val = (o) => o.food * wf + o.prod * 1.25 + o.gold * 0.6 + o.sci * 0.8;
    let best = 0;
    for (let j = 1; j < options.length; j++) {
      const va = val(options[j]), vb = val(options[best]);
      if (va > vb || (va === vb && options[j].i < options[best].i)) best = j;
    }
    const o = options.splice(best, 1)[0];
    surplus += o.food;
    picked.push(o.i);
  }
  return picked;
}

// Союзник нейтрального поселения (id крупной фракции) или null
export const allyOf = (s, minorPid) => s.players[minorPid].ally ?? null;
export function allyCount(s, pid, type) {
  return minors(s).filter((m) => m.alive && m.ally === pid && m.minorType === type).length;
}
// Города, связанные дорогой со столицей (кэш до следующей стройки дороги или смены владельца города)
const connCache = new WeakMap();
export function connectedCities(s, pid) {
  let entry = connCache.get(s);
  const ver = `${s.roadVer || 0}|${s.turn}`;
  if (!entry || entry.ver !== ver) { entry = { ver, byPlayer: new Map() }; connCache.set(s, entry); }
  if (entry.byPlayer.has(pid)) return entry.byPlayer.get(pid);
  const set = new Set();
  const cap = playerCities(s, pid).find((c) => c.capital);
  if (cap) {
    const seen = new Set([idx(s, cap.x, cap.y)]);
    const stack = [[cap.x, cap.y]];
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [nx, ny] of neighbors(s.width, s.height, x, y)) {
        const i = idx(s, nx, ny);
        const t = s.tiles[i];
        if (seen.has(i) || !t.road || (t.owner !== -1 && t.owner !== pid && atWar(s, pid, t.owner))) continue;
        seen.add(i);
        stack.push([nx, ny]);
      }
    }
    for (const c of playerCities(s, pid)) if (!c.capital && seen.has(idx(s, c.x, c.y))) set.add(c.id);
  }
  entry.byPlayer.set(pid, set);
  return set;
}
export const roadBonus = (c) => 1 + Math.floor(c.pop / 3);

const emperorTrait = (s, pid) => (s.players[pid].emperor ? s.players[pid].emperor.trait : null);

export function cityYield(s, c) {
  const p = s.players[c.owner];
  const center = tileYield(s, c.x, c.y, c.owner);
  let food = Math.max(2, center.food), prod = Math.max(2, center.prod) + 1;
  let gold = 1 + center.gold, resSci = center.sci;
  const worked = workedTiles(s, c);
  for (const i of worked) {
    const y = tileYield(s, i % s.width, Math.floor(i / s.width), c.owner);
    food += y.food; prod += y.prod; gold += y.gold; resSci += y.sci;
  }
  if (cityHas(c, 'granary')) food += 2;
  if (cityHas(c, 'workshop')) prod += 2;
  if (cityHas(c, 'forge')) prod += 3;
  if (c.capital) food += 3 * allyCount(s, c.owner, 'farmers');
  if (!c.capital && p.kind === 'major' && connectedCities(s, c.owner).has(c.id)) gold += roadBonus(c);
  if (cityHas(c, 'market')) gold = (gold + 2) * 1.25;
  if (p.faction === 'believers') gold += Math.floor(c.pop / 2) + 1;
  let sciMult = 1;
  if (cityHas(c, 'library')) sciMult += 0.5;
  if (cityHas(c, 'university')) sciMult += 0.5;
  if (hasTech(s, c.owner, 'philosophy')) sciMult += 0.15;
  let archiveSci = 0;
  if (c.buildings.includes('archive')) {
    s.tiles.forEach((t) => { if (t.city === c.id && (t.feature === 'ruins' || t.feature === 'ruins_done')) archiveSci += 3; });
  }
  let sci = Math.round((c.pop + 1 + (c.capital ? 2 : 0) + resSci + archiveSci) * sciMult * p.mult);
  const prodMult = emperorTrait(s, c.owner) === 'builder' ? 1.2 : 1;
  prod = Math.round(prod * p.mult * prodMult);
  gold = Math.round(gold);
  if (c.unrest > 0) { prod = 0; sci = 0; gold = 0; }
  const surplus = food - c.pop * 2;
  return { food, prod, sci, gold, surplus, worked, need: growthNeed(c.pop) };
}

function claimTerritory(s, c) {
  const r = territoryRadius(c.pop);
  for (const [x, y] of tilesInRadius(s.width, s.height, c.x, c.y, r)) {
    const t = tileAt(s, x, y);
    if (t.owner === -1) { t.owner = c.owner; t.city = c.id; }
    if (t.owner === c.owner && t.feature === 'nest') { delete t.feature; delete s.nests[idx(s, x, y)]; }
  }
  const center = tileAt(s, c.x, c.y);
  center.owner = c.owner;
  center.city = c.id;
  if (center.feature === 'nest') { delete center.feature; delete s.nests[idx(s, c.x, c.y)]; }
}

export function canFoundCity(s, u) {
  if (!u || u.type !== 'settler') return 'Только колонисты могут основать город';
  if (u.moves <= 0) return 'Нет очков движения';
  const t = tileAt(s, u.x, u.y);
  if (t.owner !== -1 && t.owner !== u.owner) return 'Это чужая земля';
  for (const c of cityList(s)) {
    if (distance(c.x, c.y, u.x, u.y) < RULES.minCityDistance) return 'Слишком близко к другому городу';
  }
  return true;
}

function createCity(s, owner, x, y) {
  const id = s.nextId++;
  const first = playerCities(s, owner).length === 0;
  const c = { id, name: makeName(s), owner, origOwner: owner, x, y, pop: 1, food: 0,
    prodStore: 0, build: null, buildings: [], hp: RULES.cityBaseHp, capital: first, founded: s.turn, shot: false, unrest: 0 };
  s.cities[id] = c;
  s.players[owner].everHadCity = true;
  tileAt(s, x, y).road = true;
  s.roadVer = (s.roadVer || 0) + 1;
  return c;
}

export function foundCity(s, uid) {
  const u = s.units[uid];
  if (canFoundCity(s, u) !== true) return null;
  const c = createCity(s, u.owner, u.x, u.y);
  removeUnit(s, u);
  claimTerritory(s, c);
  event(s, `Основан город ${c.name}`, c.owner, c.x, c.y);
  return c;
}

// ---------- Исследования и производство ----------

export function availableTechs(s, pid) {
  const known = s.players[pid].techs;
  return Object.keys(TECHS).filter((k) => !known.includes(k) && TECHS[k].req.every((r) => known.includes(r)));
}

export function setResearch(s, pid, tech) {
  if (!availableTechs(s, pid).includes(tech)) return false;
  s.players[pid].research = tech;
  return true;
}

export function playerScience(s, pid) {
  return playerCities(s, pid).reduce((a, c) => a + cityYield(s, c).sci, 0) + 4 * allyCount(s, pid, 'hermits');
}

export function productionOptions(s, c) {
  const out = [];
  for (const [id, d] of Object.entries(UNITS)) {
    if (!hasTech(s, c.owner, d.tech) || !unitAllowed(s, c.owner, id)) continue;
    out.push({ kind: 'unit', id, name: d.name, icon: d.icon, cost: d.cost, desc: d.desc, unique: !!d.faction });
  }
  for (const [id, d] of Object.entries(BUILDINGS)) {
    if (!hasTech(s, c.owner, d.tech) || c.buildings.includes(id)) continue;
    if (d.faction && d.faction !== s.players[c.owner].faction) continue;
    if (resolveBuilding(s, c.owner, id) !== id) continue;
    if (d.national && (!c.capital || cityList(s).some((x) => x.owner === c.owner && x.buildings.includes(id)))) continue;
    out.push({ kind: 'building', id, name: d.name, icon: d.icon, cost: d.cost, desc: d.desc, unique: !!d.faction });
  }
  if (s.players[c.owner].kind === 'major') {
    out.push({ kind: 'project', id: 'wealth', name: 'Коммерция', icon: '💰', cost: Infinity, desc: 'Половина производства города каждый ход превращается в деньги.' });
  }
  return out;
}

export function buildCost(build) {
  if (build.kind === 'project') return Infinity;
  return build.kind === 'unit' ? UNITS[build.id].cost : BUILDINGS[build.id].cost;
}

export function setProduction(s, cid, kind, id) {
  const c = s.cities[cid];
  if (!c) return false;
  if (!productionOptions(s, c).some((o) => o.kind === kind && o.id === id)) return false;
  c.build = { kind, id };
  return true;
}

export function turnsToBuild(s, c, build = c.build) {
  if (!build || build.kind === 'project') return null;
  const prod = Math.max(1, cityYield(s, c).prod);
  return Math.max(1, Math.ceil((buildCost(build) - c.prodStore) / prod));
}

// ---------- Деньги ----------

export function upkeep(s, pid) {
  const mil = playerUnits(s, pid).filter((u) => !isCivil(u.type)).length;
  const per = 1 + Math.floor(s.turn / 150);
  return Math.max(0, mil - RULES.freeUnits - playerCities(s, pid).length) * per;
}

export function playerIncome(s, pid) {
  const cities = playerCities(s, pid).reduce((a, c) => a + cityYield(s, c).gold, 0);
  return cities + 5 * allyCount(s, pid, 'traders') - upkeep(s, pid);
}

export function purchaseCost(s, c, build = c.build) {
  if (!build || build.kind === 'project') return null;
  if (build.kind === 'unit') {
    const d = UNITS[build.id];
    return Math.round((d.cost * 2 + 10) * (d.buyMult || 1));
  }
  return Math.round(BUILDINGS[build.id].cost * 2.5);
}

export function canPurchase(s, c) {
  if (!c || !c.build) return 'Город ничего не строит';
  if (c.build.kind === 'project') return 'Это постоянный проект';
  if (c.unrest > 0) return 'В городе беспорядки';
  if (c.build.kind === 'unit' && c.build.id === 'settler' && c.pop < 2) return 'Нужно 2 жителя';
  if (c.build.kind === 'unit' && !spawnSpot(s, c, c.build.id)) return 'Рядом нет места';
  if (s.players[c.owner].gold < purchaseCost(s, c)) return 'Не хватает денег';
  return true;
}

export function purchase(s, cid) {
  const c = s.cities[cid];
  if (canPurchase(s, c) !== true) return false;
  s.players[c.owner].gold -= purchaseCost(s, c);
  c.prodStore = Math.max(c.prodStore, buildCost(c.build));
  return completeBuild(s, c);
}

// Улучшение юнита: в лучший доступный юнит его линейки
export function upgradeTarget(s, u) {
  let id = UNITS[u.type].up, best = null;
  for (let i = 0; i < 6 && id; i++) {
    const rid = resolveUnit(s, u.owner, id);
    if (hasTech(s, u.owner, UNITS[rid].tech)) best = rid;
    id = UNITS[rid].up;
  }
  return best;
}
export function upgradeCost(s, u, to = upgradeTarget(s, u)) {
  if (!to) return null;
  return Math.max(10, Math.round((UNITS[to].cost - UNITS[u.type].cost) * 1.5));
}
export function canUpgrade(s, u) {
  const to = upgradeTarget(s, u);
  if (!to) return 'Нечем улучшить';
  if (tileAt(s, u.x, u.y).owner !== u.owner) return 'Только на своей земле';
  if (u.moves <= 0) return 'Нет очков движения';
  if (s.players[u.owner].gold < upgradeCost(s, u, to)) return 'Не хватает денег';
  return true;
}
export function upgradeUnit(s, uid) {
  const u = s.units[uid];
  if (canUpgrade(s, u) !== true) return false;
  const to = upgradeTarget(s, u);
  s.players[u.owner].gold -= upgradeCost(s, u, to);
  event(s, `${UNITS[u.type].name} улучшен до: ${UNITS[to].name}`, u.owner, u.x, u.y);
  u.type = to;
  u.moves = 0;
  u.fortified = false;
  return true;
}

// Модернизация Учёных: в своих границах сами улучшаются за полцены
function modernize(s, pid) {
  const p = s.players[pid];
  for (const u of playerUnits(s, pid)) {
    if (tileAt(s, u.x, u.y).owner !== pid) continue;
    const to = upgradeTarget(s, u);
    if (!to) continue;
    const cost = Math.ceil(upgradeCost(s, u, to) / 2);
    if (p.gold < cost) continue;
    p.gold -= cost;
    event(s, `Модернизация: ${UNITS[u.type].name} → ${UNITS[to].name} (−${cost} 💰)`, pid, u.x, u.y);
    u.type = to;
  }
}

// ---------- Императоры ----------

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function chooseEmperor(s, pid, trait) {
  const p = s.players[pid];
  if (!p.pendingEmperor || !EMPEROR_TRAITS[trait]) return false;
  p.reigns = (p.reigns || 0) + 1;
  p.dynasty = p.dynasty || makeName(s, false);
  const name = `${p.dynasty} ${ROMAN[(p.reigns - 1) % ROMAN.length]}`;
  p.emperor = { trait, name, from: s.turn, until: s.turn + RULES.reignTurns };
  p.pendingEmperor = false;
  event(s, `На трон взошёл император ${name}: ${EMPEROR_TRAITS[trait].name}`, pid);
  return true;
}

// ---------- Поселения ----------

export function giftGold(s, pid, minorPid) {
  const p = s.players[pid], m = s.players[minorPid];
  if (!m || m.kind !== 'minor' || !m.alive || m.hostile.includes(pid) || p.gold < RULES.giftGold) return false;
  p.gold -= RULES.giftGold;
  const k = emperorTrait(s, pid) === 'diplomat' ? 1.5 : 1;
  m.influence[pid] = Math.min(100, (m.influence[pid] || 0) + Math.round(RULES.giftInfluence * k));
  updateAlly(s, m);
  event(s, `Подарок поселению ${m.name}: влияние ${m.influence[pid]}`, pid);
  return true;
}

export function declareWar(s, pid, minorPid) {
  const m = s.players[minorPid];
  if (!m || m.kind !== 'minor' || m.hostile.includes(pid)) return false;
  m.hostile.push(pid);
  m.influence[pid] = -100;
  updateAlly(s, m);
  event(s, `${s.players[pid].name} объявили войну поселению ${m.name}`, null);
  return true;
}

function hasBeacon(s, pid) {
  return playerCities(s, pid).some((c) => c.buildings.includes('beacon'));
}

function updateAlly(s, m) {
  let best = null, bestV = RULES.allyInfluence - 1;
  for (const [k, v] of Object.entries(m.influence)) {
    if (v > bestV && s.players[k] && s.players[k].alive) { bestV = v; best = +k; }
  }
  if (best !== m.ally) {
    if (m.ally != null) event(s, `${m.name} больше не ваш союзник`, m.ally);
    if (best != null) event(s, `${m.name} теперь ваш союзник: ${MINOR_TYPES[m.minorType].ally}`, best);
    m.ally = best;
  }
}

export function minorCity(s, m) {
  return playerCities(s, m.id)[0] || null;
}

// Раз в ход: влияние, бонусы союзников, технологии поселений
export function worldTick(s) {
  const alive = majors(s).filter((p) => p.alive);
  for (const m of minors(s)) {
    if (!m.alive) continue;
    const city = minorCity(s, m);
    for (const p of alive) {
      if (m.hostile.includes(p.id)) { m.influence[p.id] = -100; continue; }
      let v = m.influence[p.id] || 0;
      const known = city && p.explored[idx(s, city.x, city.y)];
      if (known && hasBeacon(s, p.id)) v += 3;
      if (known && emperorTrait(s, p.id) === 'diplomat') v += 3;
      const othersBeacon = alive.some((o) => o.id !== p.id && hasBeacon(s, o.id));
      if (v > 0) v -= othersBeacon ? 2 : 1;
      m.influence[p.id] = Math.max(-100, Math.min(100, v));
    }
    updateAlly(s, m);
    if (m.ally != null && city) {
      const a = s.players[m.ally];
      if (m.minorType === 'traders') a.gold += 5;
      if (m.minorType === 'hermits') a.sci += 4;
      if (m.minorType === 'mercs' && s.turn - m.lastMerc >= RULES.mercEvery) {
        let best = 'warrior';
        for (const id of Object.keys(UNITS)) {
          const d = UNITS[id];
          if (d.kind === 'melee' && !d.fauna && unitAllowed(s, m.ally, id) && hasTech(s, m.ally, d.tech) && d.str > UNITS[best].str) best = id;
        }
        const probe = { id: -1, type: best, owner: m.ally, x: city.x, y: city.y };
        const spot = neighbors(s.width, s.height, city.x, city.y).find(([x, y]) => enterKind(s, probe, x, y) === 'move');
        if (spot) {
          const u = spawnUnit(s, best, m.ally, spot[0], spot[1]);
          u.moves = 0;
          m.lastMerc = s.turn;
          event(s, `${m.name} прислали бойца: ${UNITS[best].name}`, m.ally, spot[0], spot[1]);
        }
      }
    }
    // Поселения перенимают технологии, известные половине фракций
    if (s.turn % 10 === 0) {
      for (const t of Object.keys(TECHS)) {
        if (!m.techs.includes(t) && alive.filter((p) => p.techs.includes(t)).length * 2 >= alive.length) m.techs.push(t);
      }
    }
  }
}

// ---------- Движение ----------

const passableFor = (u, t) => !!UNITS[u.type].flying || TERRAIN[t].move !== Infinity;
// По дороге (с дорожной клетки на дорожную) ход стоит треть очка.
function moveCostFor(s, u, x, y, fx = null, fy = null) {
  if (UNITS[u.type].flying) return 1;
  if (fx != null && tileAt(s, fx, fy).road && tileAt(s, x, y).road) return ROAD.cost;
  return TERRAIN[tileAt(s, x, y).t].move;
}
const roundMoves = (m) => Math.max(0, Math.round(m * 1000) / 1000);

// Что произойдёт, если юнит войдёт на клетку: 'move' | 'capture' | 'attack' | null
export function enterKind(s, u, x, y) {
  if (!inside(s, x, y)) return null;
  const t = tileAt(s, x, y);
  if (!passableFor(u, t.t)) return null;
  const civil = isCivil(u.type);
  const city = cityAt(s, x, y);
  if (city && city.owner !== u.owner) return !civil && atWar(s, u.owner, city.owner) ? 'attack' : null;
  let enemyMil = false, enemyCiv = false, ownSame = false, foreign = false;
  for (const o of unitList(s)) {
    if (o.x !== x || o.y !== y || o.id === u.id) continue;
    if (o.owner !== u.owner) {
      if (!atWar(s, u.owner, o.owner)) foreign = true;
      else if (isCivil(o.type)) enemyCiv = true;
      else enemyMil = true;
    } else if (isCivil(o.type) === civil) ownSame = true;
  }
  if (foreign) return null;
  if (enemyMil) return civil ? null : 'attack';
  if (enemyCiv) return civil ? null : 'capture';
  if (ownSame) return null;
  return 'move';
}

class Heap {
  constructor() { this.a = []; }
  push(item, pr) {
    const a = this.a;
    a.push([pr, item]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() { return this.a.length; }
}

// Путь от юнита до клетки (A*). Промежуточные клетки должны быть свободны,
// последняя может быть целью атаки. Возвращает [[x,y], ...] без стартовой клетки.
export function findPath(s, u, tx, ty, { maxCost = Infinity } = {}) {
  if (!inside(s, tx, ty) || (u.x === tx && u.y === ty)) return null;
  const targetKind = enterKind(s, u, tx, ty);
  if (!targetKind) return null;
  const start = idx(s, u.x, u.y), goal = idx(s, tx, ty);
  const g = new Map([[start, 0]]);
  const from = new Map();
  const heap = new Heap();
  heap.push(start, 0);
  const passCache = new Map();
  const passable = (x, y) => {
    const i = idx(s, x, y);
    if (!passCache.has(i)) passCache.set(i, enterKind(s, u, x, y) === 'move');
    return passCache.get(i);
  };
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) break;
    const cx = cur % s.width, cy = Math.floor(cur / s.width);
    const cg = g.get(cur);
    for (const [nx, ny] of neighbors(s.width, s.height, cx, cy)) {
      const ni = idx(s, nx, ny);
      if (ni !== goal && !passable(nx, ny)) continue;
      const cost = Math.min(moveCostFor(s, u, nx, ny, cx, cy), UNITS[u.type].moves);
      if (!isFinite(cost)) continue;
      const ng = cg + cost;
      if (ng > maxCost) continue;
      if (!g.has(ni) || ng < g.get(ni)) {
        g.set(ni, ng);
        from.set(ni, cur);
        heap.push(ni, ng + distance(nx, ny, tx, ty) * ROAD.cost);
      }
    }
  }
  if (!from.has(goal)) return null;
  const path = [];
  for (let c = goal; c !== start; c = from.get(c)) path.push([c % s.width, Math.floor(c / s.width)]);
  return path.reverse();
}

// Куда юнит может дойти в этом ходу. Map(idx -> {kind, rem, from})
export function reachable(s, u) {
  const out = new Map();
  if (u.moves <= 0) return out;
  const best = new Map([[idx(s, u.x, u.y), u.moves]]);
  const heap = new Heap();
  heap.push(idx(s, u.x, u.y), -u.moves);
  const melee = !isCivil(u.type) && !isRangedType(u.type);
  while (heap.size) {
    const cur = heap.pop();
    const rem = best.get(cur);
    if (rem <= 0) continue;
    const cx = cur % s.width, cy = Math.floor(cur / s.width);
    for (const [nx, ny] of neighbors(s.width, s.height, cx, cy)) {
      const ni = idx(s, nx, ny);
      const kind = enterKind(s, u, nx, ny);
      if (!kind) continue;
      if (kind === 'attack') {
        if (melee && !out.has(ni) && canAttackFrom(s, u, nx, ny)) out.set(ni, { kind, rem: 0, from: cur });
        continue;
      }
      const nr = roundMoves(rem - moveCostFor(s, u, nx, ny, cx, cy));
      if (!best.has(ni) || nr > best.get(ni)) {
        best.set(ni, nr);
        out.set(ni, { kind, rem: nr, from: cur });
        if (kind === 'move') heap.push(ni, -nr);
      }
    }
  }
  return out;
}

function stepUnit(s, u, x, y) {
  const kind = enterKind(s, u, x, y);
  if (kind !== 'move' && kind !== 'capture') return false;
  if (distance(u.x, u.y, x, y) !== 1 || u.moves <= 0) return false;
  u.moves = roundMoves(u.moves - moveCostFor(s, u, x, y, u.x, u.y));
  fx(s, { t: 'move', id: u.id, type: u.type, owner: u.owner, hp: u.hp, fx: u.x, fy: u.y, x, y });
  u.x = x; u.y = y;
  u.fortified = false;
  u.work = null;
  u.acted = true;
  if (kind === 'capture') captureCiviliansAt(s, x, y, u.owner);
  enterFeature(s, u);
  return true;
}

// Руины и гнёзда
function enterFeature(s, u) {
  const t = tileAt(s, u.x, u.y);
  if (!isMajor(s, u.owner)) return;
  const p = s.players[u.owner];
  if (t.feature === 'ruins') {
    t.feature = 'ruins_done';
    const roll = randInt(s, 5);
    let text;
    if (roll === 0) { const g = 40 + randInt(s, 41); p.gold += g; text = `в руинах найдены ценности: +${g} 💰`; }
    else if (roll === 1) { p.sci += 35; text = 'в руинах найдены записи: +35 науки'; }
    else if (roll === 2) {
      const probe = { id: -1, type: 'warrior', owner: u.owner, x: u.x, y: u.y };
      const spot = [[u.x, u.y], ...neighbors(s.width, s.height, u.x, u.y)].find(([x, y]) => enterKind(s, probe, x, y) === 'move');
      if (spot) { spawnUnit(s, 'warrior', u.owner, spot[0], spot[1]).moves = 0; text = 'в руинах прятались выжившие: новый отряд ополчения'; }
      else { p.gold += 40; text = 'в руинах найдены ценности: +40 💰'; }
    } else if (roll === 3) {
      for (const [x, y] of tilesInRadius(s.width, s.height, u.x, u.y, 5)) p.explored[idx(s, x, y)] = 1;
      text = 'в руинах найдена карта окрестностей';
    } else { u.hp = RULES.unitHp; p.gold += 20; text = 'в руинах найдены медикаменты и припасы: +20 💰'; }
    event(s, `Руины: ${text}`, u.owner, u.x, u.y);
  } else if (t.feature === 'nest' && !isCivil(u.type)) {
    delete t.feature;
    delete s.nests[idx(s, u.x, u.y)];
    p.gold += 40;
    event(s, 'Гнездо фауны уничтожено: +40 💰', u.owner, u.x, u.y);
  }
}

function captureCiviliansAt(s, x, y, newOwner) {
  for (const o of unitsAt(s, x, y)) {
    if (o.owner === newOwner || !isCivil(o.type)) continue;
    const old = o.owner;
    if (isSupport(o.type) || s.players[newOwner].kind !== 'major') {
      event(s, `${UNITS[o.type].name} уничтожен`, old, x, y);
      removeUnit(s, o);
    } else {
      o.owner = newOwner;
      fx(s, { t: 'owner', id: o.id, owner: newOwner, type: o.type === 'settler' ? 'worker' : o.type });
      o.moves = 0; o.work = null; o.goto = null; o.auto = false;
      if (o.type === 'settler') o.type = 'worker';
      event(s, `${s.players[newOwner].name} захватили инженеров`, old, x, y);
    }
    checkElimination(s, old);
  }
}

// Приказ идти к клетке. Идёт сколько может, остаток пути запоминает.
// Если в конце пути враг и юнит ближнего боя — атакует.
export function orderMove(s, uid, tx, ty) {
  const u = s.units[uid];
  if (!u || s.over) return { ok: false };
  const path = findPath(s, u, tx, ty);
  if (!path) { u.goto = null; return { ok: false }; }
  let attacked = null;
  for (let i = 0; i < path.length && u.moves > 0; i++) {
    const [nx, ny] = path[i];
    const kind = enterKind(s, u, nx, ny);
    if (kind === 'attack') {
      if (i === path.length - 1 && canAttack(s, u, nx, ny)) attacked = attack(s, uid, nx, ny);
      break;
    }
    if (!stepUnit(s, u, nx, ny)) break;
  }
  if (s.units[uid]) {
    const done = attacked || (u.x === tx && u.y === ty);
    u.goto = done ? null : [tx, ty];
    u.skipTurn = 0;
  }
  return { ok: true, attacked };
}

export function fortify(s, uid) {
  const u = s.units[uid];
  if (!u || isCivil(u.type)) return false;
  u.fortified = true;
  u.goto = null;
  return true;
}

export function skipUnit(s, uid) {
  const u = s.units[uid];
  if (!u) return false;
  u.skipTurn = s.turn;
  u.goto = null;
  return true;
}

export function wakeUnit(s, uid) {
  const u = s.units[uid];
  if (!u) return false;
  u.fortified = false;
  u.skipTurn = 0;
  u.goto = null;
  u.auto = false;
  return true;
}

export function automateUnit(s, uid) {
  const u = s.units[uid];
  if (!u || u.type !== 'worker') return false;
  u.auto = true;
  u.goto = null;
  return true;
}

export function disbandUnit(s, uid) {
  const u = s.units[uid];
  if (!u) return false;
  removeUnit(s, u);
  checkElimination(s, u.owner);
  return true;
}

// ---------- Улучшения ----------

export function availableImprovements(s, u) {
  if (!u || u.type !== 'worker') return [];
  const t = tileAt(s, u.x, u.y);
  if (cityAt(s, u.x, u.y) || TERRAIN[t.t].move === Infinity) return [];
  const out = t.owner !== u.owner ? [] : Object.keys(IMPROVEMENTS).filter((k) => {
    const imp = IMPROVEMENTS[k];
    return imp.on.includes(t.t) && t.imp !== k && hasTech(s, u.owner, imp.tech);
  });
  if (!t.road && (t.owner === u.owner || t.owner === -1)) out.push('road');
  return out;
}

export function startImprovement(s, uid, imp) {
  const u = s.units[uid];
  if (!u || u.moves <= 0 || !availableImprovements(s, u).includes(imp)) return false;
  u.work = { imp, left: imp === 'road' ? ROAD.turns : IMPROVEMENTS[imp].turns };
  u.moves = 0;
  u.goto = null;
  return true;
}

// ---------- Бой ----------

const hpFactor = (hp, max) => 0.5 + 0.5 * Math.max(0, hp) / max;

function unitBonus(s, u) {
  let m = 1;
  if (u.vet) m += 0.15;
  if (hasTech(s, u.owner, 'tactics')) m += 0.15;
  return m;
}

function bestMeleeStr(s, pid) {
  let best = 8;
  for (const d of Object.values(UNITS)) if (d.kind === 'melee' && !d.fauna && !d.faction && hasTech(s, pid, d.tech)) best = Math.max(best, d.str);
  return best;
}

// Сила города растёт с технологиями владельца, а не только с населением.
export function cityStrength(s, c) {
  let str = 4 + bestMeleeStr(s, c.owner) * 0.6 + c.pop * 0.4;
  if (cityHas(c, 'walls')) str += 5;
  if (cityHas(c, 'castle')) str += 7;
  const g = militaryAt(s, c.x, c.y);
  if (g && g.owner === c.owner) str += UNITS[g.type].str * 0.3;
  if (tileAt(s, c.x, c.y).t === 'hills') str *= 1.25;
  return str;
}

function attackStrength(s, u, target) {
  const d = UNITS[u.type];
  let str = isRangedType(u.type) ? d.rng : d.str;
  let m = unitBonus(s, u);
  if (emperorTrait(s, u.owner) === 'conqueror') m += 0.15;
  if (target.city && d.kind === 'siege') m += 0.75;
  if (target.unit && d.antiMounted && UNITS[target.unit.type].mounted) m += 0.5;
  return str * m * hpFactor(u.hp, RULES.unitHp);
}

function defenseStrength(s, def, attacker) {
  const d = UNITS[def.type];
  let m = unitBonus(s, def) + (d.flying ? 0 : TERRAIN[tileAt(s, def.x, def.y).t].def);
  if (def.fortified) m += 0.25;
  if (d.antiMounted && UNITS[attacker.type].mounted) m += 0.5;
  return d.str * m * (d.defMult || 1) * hpFactor(def.hp, RULES.unitHp);
}

// Щит Учёных: если рядом свой генератор щита — урон меньше
export function shieldFactor(s, def) {
  for (const o of unitList(s)) {
    if (o.owner !== def.owner || !UNITS[o.type].shield) continue;
    if (distance(o.x, o.y, def.x, def.y) <= 1) return 1 - UNITS[o.type].shield;
  }
  return 1;
}

function damage(ratio) {
  return 30 * Math.pow(ratio, 0.9);
}

function targetAt(s, attackerOwner, x, y) {
  const city = cityAt(s, x, y);
  if (city && city.owner !== attackerOwner && atWar(s, attackerOwner, city.owner)) {
    if (s.players[attackerOwner].kind === 'fauna') return null;
    return { city };
  }
  const unit = militaryAt(s, x, y);
  if (unit && unit.owner !== attackerOwner && atWar(s, attackerOwner, unit.owner)) return { unit };
  return null;
}

// Можно ли атаковать клетку, если бы юнит стоял рядом (для подсветки целей)
function canAttackFrom(s, u, x, y) {
  return !!targetAt(s, u.owner, x, y) && TERRAIN[tileAt(s, x, y).t].move !== Infinity;
}

export function canAttack(s, u, x, y) {
  if (!u || isCivil(u.type) || u.moves <= 0 || !inside(s, x, y)) return false;
  if (!targetAt(s, u.owner, x, y)) return false;
  const d = distance(u.x, u.y, x, y);
  if (isRangedType(u.type)) return d >= 1 && d <= UNITS[u.type].range;
  return d === 1 && TERRAIN[tileAt(s, x, y).t].move !== Infinity;
}

// Ожидаемый результат боя (без случайности) — показываем игроку перед атакой.
export function combatPreview(s, u, x, y) {
  const target = targetAt(s, u.owner, x, y);
  if (!target) return null;
  const A = attackStrength(s, u, target);
  let D, defHp, shield = 1;
  if (target.city) {
    D = cityStrength(s, target.city) * hpFactor(target.city.hp, cityMaxHp(target.city));
    defHp = target.city.hp;
  } else {
    D = defenseStrength(s, target.unit, u);
    defHp = target.unit.hp;
    shield = shieldFactor(s, target.unit);
  }
  const ratio = A / D;
  const ranged = isRangedType(u.type);
  const toDef = Math.round(damage(ratio) * shield);
  const toAtk = ranged ? 0 : Math.round(damage(1 / ratio) * shieldFactor(s, u));
  return {
    ranged, isCity: !!target.city, attackStr: A, defenseStr: D, shielded: shield < 1,
    toDef, toAtk, defHp, atkHp: u.hp,
    defName: target.city ? target.city.name : UNITS[target.unit.type].name,
    kills: toDef >= defHp,
    dies: !ranged && toAtk >= u.hp && toDef < defHp,
  };
}

function roll(s) {
  return 0.85 + rand(s) * 0.3;
}

export function attack(s, uid, x, y) {
  const u = s.units[uid];
  if (!canAttack(s, u, x, y)) return null;
  const target = targetAt(s, u.owner, x, y);
  const pv = combatPreview(s, u, x, y);
  const toDef = Math.max(1, Math.round(pv.toDef * roll(s)));
  const toAtk = pv.ranged ? 0 : Math.max(1, Math.round(pv.toAtk * roll(s)));
  const res = { attacker: u.type, owner: u.owner, toDef, toAtk, killed: false, died: false, captured: null, x, y };
  fx(s, { t: 'attack', id: u.id, type: u.type, owner: u.owner, ax: u.x, ay: u.y, x, y, toDef, toAtk, ranged: pv.ranged,
    defId: target.unit ? target.unit.id : null, city: target.city ? target.city.id : null });
  u.moves = 0;
  u.acted = true;
  u.fortified = false;
  u.goto = null;
  const atkName = `${s.players[u.owner].name}: ${UNITS[u.type].name}`;
  if (target.city) {
    const c = target.city;
    const defOwner = c.owner;
    c.lastHit = s.turn;
    if (pv.ranged) {
      c.hp = Math.max(1, c.hp - toDef);
    } else {
      c.hp -= toDef;
      if (c.hp <= 0) {
        fx(s, { t: 'move', id: u.id, type: u.type, owner: u.owner, hp: u.hp, fx: u.x, fy: u.y, x: c.x, y: c.y });
        captureCity(s, c, u.owner);
        u.x = c.x; u.y = c.y;
        res.captured = c.id;
      } else {
        u.hp -= toAtk;
        if (u.hp <= 0) { removeUnit(s, u); res.died = true; }
      }
    }
    event(s, `${atkName} атакует город ${c.name} (−${toDef})` + (res.died ? ' — атакующий погиб' : ''), defOwner, x, y);
  } else {
    const d = target.unit;
    const defOwner = d.owner;
    const defName = UNITS[d.type].name;
    d.hp -= toDef;
    if (!pv.ranged) u.hp -= toAtk;
    if (d.hp <= 0) {
      removeUnit(s, d);
      res.killed = true;
      if (u.hp <= 0) u.hp = 1;
      if (s.players[defOwner].kind === 'fauna' && isMajor(s, u.owner)) {
        s.players[u.owner].gold += 10;
        res.bounty = 10;
      }
      if (!pv.ranged && enterKind(s, u, x, y)) {
        const kind = enterKind(s, u, x, y);
        fx(s, { t: 'move', id: u.id, type: u.type, owner: u.owner, hp: u.hp, fx: u.x, fy: u.y, x, y });
        u.x = x; u.y = y;
        if (kind === 'capture') captureCiviliansAt(s, x, y, u.owner);
        enterFeature(s, u);
      }
      checkElimination(s, defOwner);
    } else if (u.hp <= 0) {
      removeUnit(s, u);
      res.died = true;
    }
    event(s, `${atkName} атакует ${s.players[defOwner].name.toLowerCase()}: ${defName} −${toDef}` +
      (pv.ranged ? '' : `, ответ −${toAtk}`) +
      (res.killed ? ` — ${defName} уничтожен` : '') + (res.died ? ` — ${UNITS[u.type].name} погиб` : '') +
      (res.bounty ? ` (+${res.bounty} 💰)` : ''), defOwner, x, y);
  }
  return res;
}

function commandaturaNear(s, pid, c) {
  return playerCities(s, pid).some((o) => o.id !== c.id && o.buildings.includes('commandatura') && distance(o.x, o.y, c.x, c.y) <= 6);
}

function captureCity(s, c, newOwner) {
  const old = c.owner;
  for (const o of unitsAt(s, c.x, c.y)) if (o.owner === old) removeUnit(s, o);
  const wasCapital = c.capital;
  c.owner = newOwner;
  c.capital = false;
  c.hp = Math.round(cityMaxHp(c) * 0.3);
  c.pop = Math.max(1, c.pop - 1);
  c.build = null;
  c.prodStore = 0;
  c.food = 0;
  // Особые здания старого хозяина превращаются в обычные, национальные пропадают
  const newFaction = s.players[newOwner].faction;
  c.buildings = c.buildings.flatMap((b) => {
    const d = BUILDINGS[b];
    if (!d.faction || d.faction === newFaction) return [b];
    if (d.national) return [];
    return d.replaces ? [resolveBuilding(s, newOwner, d.replaces)] : [];
  });
  c.unrest = commandaturaNear(s, newOwner, c) ? 0 : RULES.unrestTurns;
  s.roadVer = (s.roadVer || 0) + 1;
  s.tiles.forEach((t) => { if (t.city === c.id) t.owner = newOwner; });
  event(s, `${s.players[newOwner].name} захватили город ${c.name}!` + (c.unrest ? ` Беспорядки ${c.unrest} хода.` : ''), [old, newOwner], c.x, c.y);
  if (wasCapital) {
    const rest = playerCities(s, old).sort((a, b) => b.pop - a.pop);
    if (rest.length) rest[0].capital = true;
  }
  if (!playerCities(s, newOwner).some((x) => x.capital)) c.capital = true;
  checkElimination(s, old);
}

function checkElimination(s, pid) {
  const p = s.players[pid];
  if (!p.alive || p.kind === 'fauna') return;
  const cities = playerCities(s, pid).length;
  const settlers = playerUnits(s, pid).some((u) => u.type === 'settler');
  if (cities > 0 || (!p.everHadCity && settlers)) return;
  p.alive = false;
  for (const u of playerUnits(s, pid)) removeUnit(s, u);
  s.tiles.forEach((t) => { if (t.owner === pid) { t.owner = -1; t.city = -1; } });
  event(s, p.kind === 'minor' ? `Поселение ${p.name} пало` : `${p.name} уничтожены!`, null);
  checkGameOver(s);
}

function checkGameOver(s) {
  if (s.over) return;
  const alive = majors(s).filter((p) => p.alive);
  const h = humanPlayer(s);
  if (h && !h.alive) {
    s.over = true; s.result = 'defeat';
    s.winner = alive.length === 1 ? alive[0].id : null;
  } else if (alive.length <= 1) {
    s.over = true;
    s.winner = alive.length ? alive[0].id : null;
    s.result = h ? (s.winner === h.id ? 'victory' : 'defeat') : 'done';
  }
}

// ---------- Ход ----------

export function needsOrders(s, pid) {
  return playerUnits(s, pid).filter((u) => u.moves > 0 && !u.fortified && !u.work && !u.goto && !u.auto && u.skipTurn !== s.turn);
}

export function citiesWithoutProduction(s, pid) {
  return playerCities(s, pid).filter((c) => !c.build);
}

export function beginPlayerTurn(s, pid) {
  const p = s.players[pid];
  if (!p.alive) return;
  for (const u of playerUnits(s, pid)) {
    if (!u.acted && u.hp < RULES.unitHp) {
      const t = tileAt(s, u.x, u.y);
      const heal = cityAt(s, u.x, u.y) ? 25 : t.owner === pid ? 15 : 10;
      u.hp = Math.min(RULES.unitHp, u.hp + heal);
    }
    u.acted = false;
    u.moves = u.work ? 0 : UNITS[u.type].moves;
  }
  for (const c of playerCities(s, pid)) c.shot = false;
  if (p.kind === 'major') {
    if (p.faction === 'empire' && (!p.emperor || s.turn >= p.emperor.until)) p.pendingEmperor = true;
    if (p.faction === 'scientists') modernize(s, pid);
  }
  if (p.human) {
    for (const u of playerUnits(s, pid)) {
      if (u.goto && s.units[u.id]) {
        const [gx, gy] = u.goto;
        const r = orderMove(s, u.id, gx, gy);
        if (!r.ok && s.units[u.id]) s.units[u.id].goto = null;
      }
    }
  }
  if (p.kind !== 'fauna') updateExplored(s, pid);
}

function spawnSpot(s, c, type) {
  const probe = { id: -1, type, owner: c.owner, x: c.x, y: c.y };
  if (enterKind(s, probe, c.x, c.y) === 'move') return [c.x, c.y];
  for (const r of [1, 2]) {
    for (const [x, y] of tilesInRadius(s.width, s.height, c.x, c.y, r)) {
      if (distance(x, y, c.x, c.y) === r && enterKind(s, probe, x, y) === 'move') return [x, y];
    }
  }
  return null;
}

// Достроить текущий заказ города, если хватает производства. true — готово.
function completeBuild(s, c) {
  if (!c.build || c.build.kind === 'project') return false;
  const cost = buildCost(c.build);
  if (c.prodStore < cost) return false;
  const pid = c.owner;
  if (c.build.kind === 'building') {
    c.buildings.push(c.build.id);
    if (c.build.id === 'walls' || c.build.id === 'castle') c.hp += 100;
    event(s, `${c.name}: построено — ${BUILDINGS[c.build.id].name}`, pid, c.x, c.y);
    c.prodStore -= cost;
    c.build = null;
    return true;
  }
  const type = c.build.id;
  if (type === 'settler' && c.pop < 2) return false;
  const spot = spawnSpot(s, c, type);
  if (!spot) return false;
  const u = spawnUnit(s, type, pid, spot[0], spot[1]);
  u.moves = 0;
  if (cityHas(c, 'barracks') && !isCivil(type)) u.vet = true;
  if (type === 'settler') c.pop--;
  event(s, `${c.name}: готов ${UNITS[type].name}`, pid, c.x, c.y);
  c.prodStore -= cost;
  c.build = null;
  return true;
}

export function finishPlayerTurn(s, pid) {
  const p = s.players[pid];
  if (!p.alive) return;
  // Рабочие
  for (const u of playerUnits(s, pid)) {
    if (!u.work) continue;
    u.work.left--;
    if (u.work.left <= 0) {
      const t = tileAt(s, u.x, u.y);
      if (u.work.imp === 'road') {
        t.road = true;
        s.roadVer = (s.roadVer || 0) + 1;
        event(s, 'Построена дорога', pid, u.x, u.y);
      } else {
        t.imp = u.work.imp;
        event(s, `Построено: ${IMPROVEMENTS[t.imp].name}`, pid, u.x, u.y);
      }
      u.work = null;
    }
  }
  // Города
  let sci = 0;
  for (const c of playerCities(s, pid)) {
    const y = cityYield(s, c);
    sci += y.sci;
    c.food += y.surplus;
    if (c.food >= y.need) {
      c.pop++;
      c.food = cityHas(c, 'aqueduct') ? Math.floor(y.need * 0.4) : 0;
      claimTerritory(s, c);
      event(s, `${c.name} вырос до ${c.pop}`, pid, c.x, c.y);
    } else if (c.food < 0) {
      if (c.pop > 1) {
        c.pop--;
        event(s, `${c.name}: голод, жителей стало ${c.pop}`, pid, c.x, c.y);
      }
      c.food = 0;
    }
    if (c.build && c.build.kind === 'project') {
      if (p.kind === 'major') p.gold += Math.floor(y.prod / 2);
    } else {
      c.prodStore += y.prod;
      completeBuild(s, c);
    }
    if (c.unrest > 0) c.unrest--;
    const regen = s.turn - (c.lastHit || -10) >= 2 ? 20 : 5;
    c.hp = Math.min(cityMaxHp(c), c.hp + regen);
  }
  // Деньги и содержание армии
  if (p.kind === 'major') {
    p.gold += playerIncome(s, pid);
    if (p.gold < 0) {
      const victim = playerUnits(s, pid).filter((u) => !isCivil(u.type) && !cityAt(s, u.x, u.y))
        .sort((a, b) => UNITS[a.type].cost - UNITS[b.type].cost)[0];
      if (victim) {
        event(s, `Нечем платить армии: ${UNITS[victim.type].name} распущен`, pid, victim.x, victim.y);
        removeUnit(s, victim);
      }
      p.gold = 0;
    }
  }
  // Наука
  p.sci += sci;
  while (p.research && p.sci >= TECHS[p.research].cost) {
    p.sci -= TECHS[p.research].cost;
    p.techs.push(p.research);
    event(s, `Изучено: ${TECHS[p.research].name}`, pid);
    p.research = null;
  }
  // Города обстреливают соседних врагов
  for (const c of playerCities(s, pid)) {
    if (c.shot) continue;
    let best = null;
    for (const u of unitList(s)) {
      if (u.owner === pid || isCivil(u.type) || !atWar(s, pid, u.owner)) continue;
      if (distance(c.x, c.y, u.x, u.y) > RULES.cityRange) continue;
      if (!best || u.hp < best.hp) best = u;
    }
    if (!best) continue;
    const A = cityStrength(s, c) * 0.6 * hpFactor(c.hp, cityMaxHp(c));
    const D = defenseStrength(s, best, { type: 'warrior' });
    const dmg = Math.max(1, Math.round(damage(A / D) * shieldFactor(s, best) * roll(s)));
    fx(s, { t: 'shot', x: c.x, y: c.y, tx: best.x, ty: best.y, id: best.id, dmg });
    best.hp -= dmg;
    c.shot = true;
    const name = UNITS[best.type].name;
    const owner = best.owner;
    if (best.hp <= 0) {
      removeUnit(s, best);
      checkElimination(s, owner);
      if (s.players[owner].kind === 'fauna' && p.kind === 'major') p.gold += 10;
    }
    event(s, `Город ${c.name} обстрелял: ${name} −${dmg}` + (best.hp <= 0 ? ' — уничтожен' : ''), owner, best.x, best.y);
  }
}

// ---------- Сводка ----------

export function playerStats(s, pid) {
  const cities = playerCities(s, pid);
  const units = playerUnits(s, pid);
  return {
    cities: cities.length,
    pop: cities.reduce((a, c) => a + c.pop, 0),
    army: units.filter((u) => !isCivil(u.type)).length,
    techs: s.players[pid].techs.length,
    gold: s.players[pid].gold,
  };
}
