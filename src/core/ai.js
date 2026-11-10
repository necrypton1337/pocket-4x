// Компьютерные соперники, нейтральные поселения и фауна. Пользуются теми же действиями, что и игрок.
// Упрощение: ИИ видит всю карту (не учитывает туман войны).
import { UNITS, BUILDINGS, TECHS, IMPROVEMENTS, TERRAIN, RESOURCES, RULES } from './data.js';
import { distance, neighbors, tilesInRadius } from './hex.js';
import { randInt, rand } from './rng.js';
import {
  playerCities, playerUnits, unitList, cityList, isCivil, isSupport, isRangedType, hasTech, tileAt, cityAt, militaryAt,
  availableTechs, setResearch, setProduction, productionOptions, foundCity, canFoundCity, findPath, orderMove,
  enterKind, availableImprovements, startImprovement, canAttack, attack, combatPreview, fortify, atWar, majors, minors,
  resolveBuilding, purchase, canPurchase, purchaseCost, upgradeUnit, canUpgrade, upgradeCost, chooseEmperor,
  giftGold, minorCity, spawnUnit, idx, playerIncome,
} from './game.js';

const BUILD_ORDER = ['granary', 'library', 'market', 'workshop', 'walls', 'barracks', 'beacon', 'forge', 'university', 'aqueduct', 'castle'];

function enemiesOf(s, pid) {
  return s.players.filter((p) => p.alive && p.id !== pid && p.kind !== 'fauna' && atWar(s, pid, p.id)).map((p) => p.id);
}

function chooseResearch(s, pid) {
  const p = s.players[pid];
  if (p.research) return;
  const opts = availableTechs(s, pid);
  if (!opts.length) return;
  const minCost = Math.min(...opts.map((t) => TECHS[t].cost));
  const cheap = opts.filter((t) => TECHS[t].cost === minCost);
  setResearch(s, pid, cheap[randInt(s, cheap.length)]);
}

function bestUnitOf(s, c, kinds) {
  const opts = productionOptions(s, c).filter((o) => o.kind === 'unit' && kinds.includes(UNITS[o.id].kind));
  if (!opts.length) return null;
  const power = (id) => (isRangedType(id) ? UNITS[id].rng : UNITS[id].str);
  opts.sort((a, b) => power(b.id) - power(a.id));
  return opts[0].id;
}

function threatNear(s, pid, x, y, r) {
  return unitList(s).some((u) => u.owner !== pid && !isCivil(u.type) && atWar(s, pid, u.owner) && distance(u.x, u.y, x, y) <= r);
}

// Угроза от армий (крупные фракции и враждебные поселения), без бродячей фауны
function armyThreat(s, pid, x, y, r) {
  return unitList(s).some((u) => u.owner !== pid && !isCivil(u.type) && s.players[u.owner].kind !== 'fauna' &&
    atWar(s, pid, u.owner) && distance(u.x, u.y, x, y) <= r);
}

function siteScore(s, pid, x, y) {
  let sc = 0;
  for (const [nx, ny] of tilesInRadius(s.width, s.height, x, y, 2)) {
    const t = tileAt(s, nx, ny);
    if (t.owner !== -1 && t.owner !== pid) continue;
    const tt = TERRAIN[t.t];
    if (tt.move === Infinity && t.t !== 'water') continue;
    sc += tt.food * 1.5 + tt.prod + (tt.gold || 0) * 0.5;
    if (t.res) sc += 2;
  }
  return sc;
}

function validSite(s, pid, x, y) {
  const t = tileAt(s, x, y);
  if (TERRAIN[t.t].move === Infinity) return false;
  if (t.owner !== -1 && t.owner !== pid) return false;
  if (t.feature === 'nest') return false;
  for (const c of cityList(s)) if (distance(c.x, c.y, x, y) < RULES.minCityDistance + 1) return false;
  return true;
}

function findSite(s, pid, u, maxDist) {
  let best = null, bestV = -Infinity;
  const taken = Object.values(s.players[pid].ai.sites || {});
  for (const [x, y] of tilesInRadius(s.width, s.height, u.x, u.y, maxDist)) {
    if (!validSite(s, pid, x, y)) continue;
    if (taken.some(([tx, ty]) => distance(tx, ty, x, y) < 3)) continue;
    if (threatNear(s, pid, x, y, 2)) continue;
    const v = siteScore(s, pid, x, y) - distance(u.x, u.y, x, y) * 1.3;
    if (v > bestV) { bestV = v; best = [x, y]; }
  }
  return best;
}

// Подсказка игроку: лучшие места для города рядом с колонистами.
export function suggestSites(s, pid, u, n = 3) {
  const cands = [];
  for (const [x, y] of tilesInRadius(s.width, s.height, u.x, u.y, 6)) {
    if (!validSite(s, pid, x, y) || !s.players[pid].explored[y * s.width + x]) continue;
    cands.push({ x, y, v: siteScore(s, pid, x, y) - distance(u.x, u.y, x, y) * 0.8 });
  }
  cands.sort((a, b) => b.v - a.v);
  const out = [];
  for (const c of cands) {
    if (out.every(([ox, oy]) => distance(ox, oy, c.x, c.y) >= 3)) out.push([c.x, c.y]);
    if (out.length >= n) break;
  }
  return out;
}

function hasSiteFor(s, pid) {
  for (const c of playerCities(s, pid)) {
    for (const [x, y] of tilesInRadius(s.width, s.height, c.x, c.y, 6)) if (validSite(s, pid, x, y)) return true;
  }
  return false;
}

function chooseProduction(s, pid, c) {
  const units = playerUnits(s, pid);
  const cities = playerCities(s, pid);
  const mil = units.filter((u) => !isCivil(u.type));
  const pending = (id) => cities.filter((x) => x.build && x.build.id === id).length;
  const settlers = units.filter((u) => u.type === 'settler').length + pending('settler');
  const workers = units.filter((u) => u.type === 'worker').length + pending('worker');
  const wantCities = Math.min(8, 3 + Math.floor(s.width * s.height / 160));
  const wantMil = Math.min(8 + cities.length * 2, Math.floor(cities.length * 1.5 + 1 + s.turn / 14));

  const set = (kind, id) => id && setProduction(s, c.id, kind, id);

  const danger = armyThreat(s, pid, c.x, c.y, 3);
  const cap = 8 + cities.length * 2 + Math.floor(s.players[pid].gold / 300);
  if (danger && !militaryAt(s, c.x, c.y)) {
    if (set('unit', bestUnitOf(s, c, ['melee']))) return;
  }
  if (danger && mil.length < cap) {
    if (set('unit', bestUnitOf(s, c, ['ranged', 'melee']))) return;
  }
  if (mil.length < 1 + Math.floor(cities.length / 2)) {
    if (set('unit', bestUnitOf(s, c, ['melee']))) return;
  }
  if ((c.pop >= 2 || cities.length === 1) && cities.length + settlers < wantCities && settlers < 2 && s.turn < 140 && hasSiteFor(s, pid)) {
    if (set('unit', 'settler')) return;
  }
  if (workers < Math.min(cities.length, 5)) {
    if (set('unit', 'worker')) return;
  }
  const supports = units.filter((u) => isSupport(u.type)).length + pending('shieldgen');
  if (mil.length >= 5 && supports < mil.length / 6 && bestUnitOf(s, c, ['support'])) {
    if (set('unit', bestUnitOf(s, c, ['support']))) return;
  }
  const broke = playerIncome(s, pid) < 0 && s.players[pid].gold < 60;
  if (mil.length < wantMil && !broke) {
    const ranged = mil.filter((u) => UNITS[u.type].kind === 'ranged').length;
    const siege = mil.filter((u) => UNITS[u.type].kind === 'siege').length;
    let kinds = ['melee'];
    if (siege < mil.length / 5 && bestUnitOf(s, c, ['siege'])) kinds = ['siege'];
    else if (ranged < mil.length / 4) kinds = ['ranged'];
    if (set('unit', bestUnitOf(s, c, kinds) || bestUnitOf(s, c, ['melee']))) return;
  }
  for (const base of BUILD_ORDER) {
    const b = resolveBuilding(s, pid, base);
    if (!BUILDINGS[b] || c.buildings.includes(b) || !hasTech(s, pid, BUILDINGS[b].tech)) continue;
    if (set('building', b)) return;
  }
  if (mil.length < cap && !broke) set('unit', bestUnitOf(s, c, ['melee', 'ranged', 'siege']));
  else set('project', 'wealth');
}

// Подойти к клетке на расстояние dist (0 — встать на неё).
function approach(s, u, tx, ty, dist = 0) {
  let goals;
  if (dist === 0) goals = [[tx, ty]];
  else {
    goals = tilesInRadius(s.width, s.height, tx, ty, dist)
      .filter(([x, y]) => distance(x, y, tx, ty) >= 1 && (x === u.x && y === u.y || enterKind(s, u, x, y) === 'move'))
      .sort((a, b) => distance(a[0], a[1], u.x, u.y) - distance(b[0], b[1], u.x, u.y));
    if (goals.some(([x, y]) => x === u.x && y === u.y)) return true;
  }
  for (const [gx, gy] of goals.slice(0, 4)) {
    if (enterKind(s, u, gx, gy) !== 'move') continue;
    if (!findPath(s, u, gx, gy)) continue;
    orderMove(s, u.id, gx, gy);
    if (s.units[u.id]) s.units[u.id].goto = null;
    return true;
  }
  // Обходной вариант: шаг по пути к самой цели, не атакуя.
  const path = findPath(s, u, tx, ty);
  if (path && path.length > 1) {
    const [sx, sy] = path[Math.min(path.length - 2, UNITS[u.type].moves)];
    if (enterKind(s, u, sx, sy) === 'move') {
      orderMove(s, u.id, sx, sy);
      if (s.units[u.id]) s.units[u.id].goto = null;
    }
  }
  return false;
}

function goodAttack(s, u, x, y) {
  const pv = combatPreview(s, u, x, y);
  if (!pv) return false;
  if (pv.ranged) return true;
  if (pv.dies) return false;
  if (pv.kills) return true;
  if (pv.isCity) return pv.toAtk < u.hp * 0.6 && pv.defHp < 120;
  return pv.toDef >= pv.toAtk * 1.1 && pv.toAtk < u.hp * 0.7;
}

function tryAttacks(s, u, { meleeAllowed = true, always = false } = {}) {
  if (!s.units[u.id] || u.moves <= 0) return false;
  const range = isRangedType(u.type) ? UNITS[u.type].range : 1;
  if (!isRangedType(u.type) && !meleeAllowed) return false;
  for (const [x, y] of neighbors(s.width, s.height, u.x, u.y)) {
    if (enterKind(s, u, x, y) === 'capture') {
      orderMove(s, u.id, x, y);
      return true;
    }
  }
  const targets = [];
  for (const [x, y] of tilesInRadius(s.width, s.height, u.x, u.y, range)) {
    if (!canAttack(s, u, x, y) || (!always && !goodAttack(s, u, x, y))) continue;
    const pv = combatPreview(s, u, x, y);
    targets.push({ x, y, v: (pv.kills ? 100 : 0) + (pv.isCity ? 30 : 0) + pv.toDef - pv.toAtk });
  }
  if (!targets.length) return false;
  targets.sort((a, b) => b.v - a.v);
  attack(s, u.id, targets[0].x, targets[0].y);
  return true;
}

function runSettler(s, pid, u) {
  const mem = s.players[pid].ai;
  mem.sites = mem.sites || {};
  if (playerCities(s, pid).length === 0) {
    if (canFoundCity(s, u) === true) { foundCity(s, u.id); return; }
  }
  let site = mem.sites[u.id];
  if (site && !validSite(s, pid, site[0], site[1])) site = null;
  if (!site) {
    delete mem.sites[u.id];
    site = findSite(s, pid, u, playerCities(s, pid).length === 0 ? 3 : 9);
    if (!site) {
      if (canFoundCity(s, u) === true && playerCities(s, pid).length === 0) foundCity(s, u.id);
      return;
    }
    mem.sites[u.id] = site;
  }
  if (u.x === site[0] && u.y === site[1]) {
    if (canFoundCity(s, u) === true) { foundCity(s, u.id); delete mem.sites[u.id]; }
    else delete mem.sites[u.id];
    return;
  }
  if (!findPath(s, u, site[0], site[1])) { delete mem.sites[u.id]; return; }
  orderMove(s, u.id, site[0], site[1]);
  if (s.units[u.id]) s.units[u.id].goto = null;
  if (s.units[u.id] && u.x === site[0] && u.y === site[1] && u.moves > 0 && canFoundCity(s, u) === true) {
    foundCity(s, u.id);
    delete mem.sites[u.id];
  }
}

export function runWorker(s, pid, u) {
  if (u.work) return;
  const here = availableImprovements(s, u);
  if (here.length && !threatNear(s, pid, u.x, u.y, 2)) {
    const pref = here.includes('mine') ? 'mine' : here[0];
    startImprovement(s, u.id, pref);
    return;
  }
  let best = null, bestD = Infinity;
  s.tiles.forEach((t, i) => {
    if (t.owner !== pid || t.imp || t.city === -1) return;
    const x = i % s.width, y = Math.floor(i / s.width);
    if (cityAt(s, x, y)) return;
    const ok = Object.keys(IMPROVEMENTS).some((k) => IMPROVEMENTS[k].on.includes(t.t) && hasTech(s, pid, IMPROVEMENTS[k].tech));
    if (!ok) return;
    if (enterKind(s, u, x, y) !== 'move') return;
    const d = distance(u.x, u.y, x, y) - (t.res ? 2 : 0);
    if (d < bestD) { bestD = d; best = [x, y]; }
  });
  if (!best) return;
  approach(s, u, best[0], best[1], 0);
  if (s.units[u.id] && u.moves > 0) {
    const imps = availableImprovements(s, u);
    if (imps.length) startImprovement(s, u.id, imps.includes('mine') ? 'mine' : imps[0]);
  }
}

function pickWarTarget(s, pid) {
  const mine = playerCities(s, pid);
  if (!mine.length) return null;
  const enemies = enemiesOf(s, pid);
  let best = null, bestD = Infinity;
  for (const c of cityList(s)) {
    if (!enemies.includes(c.owner) || s.players[c.owner].kind !== 'major') continue;
    const d = Math.min(...mine.map((m) => distance(m.x, m.y, c.x, c.y)));
    const v = d + c.pop * 0.3 + (s.players[c.owner].human ? -1 : 0);
    if (v < bestD) { bestD = v; best = c; }
  }
  return best;
}

// Деньги: выкуп, улучшения, подарки поселениям
function runEconomy(s, pid) {
  const p = s.players[pid];
  const mem = p.ai;
  // Выкуп обороны в городе под угрозой и добровольцев
  for (const c of playerCities(s, pid)) {
    if (!c.build) continue;
    const urgent = armyThreat(s, pid, c.x, c.y, 3) && c.build.kind === 'unit' && !isCivil(c.build.id);
    const cheap = c.build.kind === 'unit' && UNITS[c.build.id].buyMult;
    const reserve = urgent ? 0 : cheap ? 40 : 160;
    if (canPurchase(s, c) === true && p.gold - purchaseCost(s, c) >= reserve) purchase(s, c.id);
  }
  // Улучшения юнитов
  for (const u of playerUnits(s, pid)) {
    if (canUpgrade(s, u) === true && p.gold - upgradeCost(s, u) >= 60) upgradeUnit(s, u.id);
  }
  // Подарки поселениям
  const giftReserve = p.faction === 'believers' ? 60 : 140;
  if (p.gold >= RULES.giftGold + giftReserve && (playerIncome(s, pid) > 2)) {
    const known = minors(s).filter((m) => {
      const c = m.alive && minorCity(s, m);
      return c && p.explored[idx(s, c.x, c.y)] && !m.hostile.includes(pid);
    });
    known.sort((a, b) => (b.influence[pid] || 0) - (a.influence[pid] || 0));
    const target = known.find((m) => (m.influence[pid] || 0) < 90);
    if (target) giftGold(s, pid, target.id);
  }
  mem.lastGold = p.gold;
}

function supportFollow(s, pid, u) {
  // Генератор щита держится рядом с армией
  const army = playerUnits(s, pid).filter((o) => !isCivil(o.type) && !cityAt(s, o.x, o.y));
  if (!army.length) return;
  army.sort((a, b) => distance(a.x, a.y, u.x, u.y) - distance(b.x, b.y, u.x, u.y));
  const t = army[0];
  if (distance(t.x, t.y, u.x, u.y) <= 0) return;
  if (enterKind(s, u, t.x, t.y) === 'move') approach(s, u, t.x, t.y, 0);
  else approach(s, u, t.x, t.y, 1);
}

export function runAI(s, pid) {
  const p = s.players[pid];
  if (!p.alive || s.over) return;
  const mem = p.ai;
  chooseResearch(s, pid);
  if (p.pendingEmperor) {
    const war = mem.phase === 'march' || playerCities(s, pid).some((c) => threatNear(s, pid, c.x, c.y, 4));
    chooseEmperor(s, pid, war ? 'conqueror' : s.turn < 50 ? 'builder' : rand(s) < 0.5 ? 'conqueror' : 'builder');
  }

  // Мирные юниты
  for (const u of playerUnits(s, pid)) {
    if (s.over || !s.units[u.id]) continue;
    if (u.type === 'settler') runSettler(s, pid, u);
    else if (u.type === 'worker') runWorker(s, pid, u);
  }

  const cities = playerCities(s, pid);
  // Гарнизоны
  const garrison = new Set();
  for (const c of cities) {
    const g = militaryAt(s, c.x, c.y);
    if (g && g.owner === pid) { garrison.add(g.id); continue; }
    const free = playerUnits(s, pid)
      .filter((u) => !isCivil(u.type) && !garrison.has(u.id) && !isRangedType(u.type))
      .sort((a, b) => distance(a.x, a.y, c.x, c.y) - distance(b.x, b.y, c.x, c.y));
    if (free.length && distance(free[0].x, free[0].y, c.x, c.y) <= 6) {
      garrison.add(free[0].id);
      approach(s, free[0], c.x, c.y, 0);
    }
  }

  // Армия
  const army = playerUnits(s, pid).filter((u) => !isCivil(u.type) && !garrison.has(u.id));
  let target = mem.target != null ? s.cities[mem.target] : null;
  if (!target || target.owner === pid || mem.phase !== 'march') target = pickWarTarget(s, pid);
  mem.target = target ? target.id : null;
  const front = target && cities.length
    ? cities.slice().sort((a, b) => distance(a.x, a.y, target.x, target.y) - distance(b.x, b.y, target.x, target.y))[0]
    : null;
  const minArmy = 3 + Math.floor(s.turn / 60);
  if (!target || army.length < 2) mem.phase = 'gather';
  else if (mem.phase === 'march') {
    if (army.length < Math.max(2, (mem.marchSize || 0) * 0.35)) mem.phase = 'gather';
  } else if (front) {
    const near = army.filter((u) => distance(u.x, u.y, front.x, front.y) <= 3).length;
    if (army.length >= minArmy && near >= Math.ceil(army.length * 0.7)) {
      mem.phase = 'march';
      mem.marchSize = army.length;
    }
  }
  // Охотник на ближайшее гнездо, пока армия собирается
  let hunter = mem.hunter != null ? s.units[mem.hunter] : null;
  const nestNear = Object.keys(s.nests).map(Number).map((i) => [i % s.width, Math.floor(i / s.width)])
    .filter(([x, y]) => cities.some((c) => distance(c.x, c.y, x, y) <= 7));
  if (!nestNear.length || mem.phase === 'march') hunter = null;
  else if (!hunter || hunter.owner !== pid) hunter = army.find((u) => !isRangedType(u.type) && u.hp > 70) || null;
  mem.hunter = hunter ? hunter.id : null;

  for (const u of playerUnits(s, pid)) {
    if (s.over || !s.units[u.id]) continue;
    if (isSupport(u.type)) { supportFollow(s, pid, u); continue; }
    if (isCivil(u.type)) continue;
    if (garrison.has(u.id)) {
      tryAttacks(s, u, { meleeAllowed: false });
      if (s.units[u.id] && cityAt(s, u.x, u.y)) fortify(s, u.id);
      continue;
    }
    if (tryAttacks(s, u)) continue;
    // Защита своих городов от ближайшей угрозы
    let threat = null, threatD = Infinity;
    for (const e of unitList(s)) {
      if (e.owner === pid || isCivil(e.type) || !atWar(s, pid, e.owner)) continue;
      for (const c of cities) {
        const d = distance(e.x, e.y, c.x, c.y);
        if (d <= 3 && distance(u.x, u.y, e.x, e.y) <= 6 && d < threatD) { threatD = d; threat = e; }
      }
    }
    if (threat) {
      approach(s, u, threat.x, threat.y, isRangedType(u.type) ? UNITS[u.type].range : 1);
      tryAttacks(s, u);
      continue;
    }
    if (hunter && u.id === hunter.id) {
      nestNear.sort((a, b) => distance(a[0], a[1], u.x, u.y) - distance(b[0], b[1], u.x, u.y));
      approach(s, u, nestNear[0][0], nestNear[0][1], 0);
      tryAttacks(s, u);
      continue;
    }
    if (mem.phase === 'march' && target) {
      const ranged = isRangedType(u.type);
      const reach = ranged ? UNITS[u.type].range : 1;
      const ok = approach(s, u, target.x, target.y, reach);
      if (!ok && s.units[u.id] && distance(u.x, u.y, target.x, target.y) > reach) {
        // Подступы заняты — бьём тех, кто заслоняет город
        const blocker = unitList(s).filter((e) => !isCivil(e.type) && atWar(s, pid, e.owner) && distance(e.x, e.y, target.x, target.y) <= 3)
          .sort((a, b) => distance(a.x, a.y, u.x, u.y) - distance(b.x, b.y, u.x, u.y))[0];
        if (blocker) approach(s, u, blocker.x, blocker.y, reach);
      }
      tryAttacks(s, u, { always: s.units[u.id] && distance(u.x, u.y, target.x, target.y) <= 3 && ranged });
      continue;
    }
    // Городов у врагов нет — охотимся на их юниты
    if (!target) {
      const prey = unitList(s).filter((e) => e.owner !== pid && s.players[e.owner].kind === 'major' && atWar(s, pid, e.owner))
        .sort((a, b) => distance(a.x, a.y, u.x, u.y) - distance(b.x, b.y, u.x, u.y))[0];
      if (prey) { approach(s, u, prey.x, prey.y, isRangedType(u.type) ? UNITS[u.type].range : 1); tryAttacks(s, u); }
      continue;
    }
    // Сбор армии у ближайшего к врагу города
    if (front) {
      if (distance(u.x, u.y, front.x, front.y) > 2) approach(s, u, front.x, front.y, 2);
      if (s.units[u.id] && u.moves > 0) fortify(s, u.id);
    }
  }

  for (const c of playerCities(s, pid)) {
    if (c.build && c.build.kind === 'project') c.build = null;
    if (!c.build) chooseProduction(s, pid, c);
  }
  runEconomy(s, pid);
}

// ---------- Нейтральные поселения ----------

export function runMinor(s, pid) {
  const p = s.players[pid];
  if (!p.alive) return;
  const c = minorCity(s, p);
  if (!c) return;
  const defenders = playerUnits(s, pid).filter((u) => !isCivil(u.type));
  for (const u of defenders) {
    tryAttacks(s, u, { meleeAllowed: distance(u.x, u.y, c.x, c.y) <= 2 });
    if (!s.units[u.id]) continue;
    if (distance(u.x, u.y, c.x, c.y) > 2) approach(s, u, c.x, c.y, 1);
    else if (u.moves > 0) fortify(s, u.id);
  }
  if (!c.build) {
    const want = 1 + (c.pop >= 4 ? 1 : 0) + (p.hostile.length ? 1 : 0);
    if (defenders.length < want) {
      const id = bestUnitOf(s, c, ['melee']);
      if (id) setProduction(s, c.id, 'unit', id);
    } else {
      const wall = ['walls', 'granary', 'workshop', 'castle'].find((b) => productionOptions(s, c).some((o) => o.id === b));
      if (wall) setProduction(s, c.id, 'building', wall);
    }
  }
}

// ---------- Фауна ----------

function faunaType(s) {
  const t = s.turn;
  const pool = ['crawler', 'stinger'];
  if (t > 70) pool.push('armadillo');
  if (t > 140) pool.push('colossus');
  return pool[randInt(s, pool.length)];
}

export function runFauna(s, pid) {
  // Гнёзда порождают тварей
  for (const [key, nest] of Object.entries(s.nests)) {
    const i = +key, x = i % s.width, y = Math.floor(i / s.width);
    const near = playerUnits(s, pid).filter((u) => distance(u.x, u.y, x, y) <= 4).length;
    if (s.turn < 3 || near >= 2 || s.turn - nest.last < RULES.nestSpawnEvery) continue;
    const type = faunaType(s);
    const probe = { id: -1, type, owner: pid, x, y };
    const spot = [[x, y], ...neighbors(s.width, s.height, x, y)].find(([nx, ny]) => enterKind(s, probe, nx, ny) === 'move');
    if (!spot) continue;
    const u = spawnUnit(s, type, pid, spot[0], spot[1]);
    u.home = i;
    u.moves = 0;
    nest.last = s.turn;
  }
  for (const u of playerUnits(s, pid)) {
    if (!s.units[u.id] || u.moves <= 0) continue;
    // Ближайшая жертва
    let prey = null, pd = Infinity;
    for (const o of unitList(s)) {
      if (o.owner === pid) continue;
      const d = distance(o.x, o.y, u.x, u.y);
      if (d <= 4 && d < pd && !cityAt(s, o.x, o.y)) { pd = d; prey = o; }
    }
    if (prey) {
      if (pd > 1) approach(s, u, prey.x, prey.y, 1);
      if (s.units[u.id]) tryAttacks(s, u, { always: true });
      continue;
    }
    // Бродит у гнезда, на ничьей земле
    const hx = u.home != null ? u.home % s.width : u.x, hy = u.home != null ? Math.floor(u.home / s.width) : u.y;
    const opts = neighbors(s.width, s.height, u.x, u.y)
      .filter(([x, y]) => enterKind(s, u, x, y) === 'move' && tileAt(s, x, y).owner === -1 && distance(x, y, hx, hy) <= 3);
    if (opts.length && rand(s) < 0.6) {
      const [x, y] = opts[randInt(s, opts.length)];
      orderMove(s, u.id, x, y);
      if (s.units[u.id]) s.units[u.id].goto = null;
    }
  }
}
