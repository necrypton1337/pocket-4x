import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeState, unit } from './helpers.js';
import * as G from '../src/core/game.js';
import { endTurn } from '../src/core/turn.js';
import { TECHS, UNITS } from '../src/core/data.js';

function cityFor(s, owner, x, y) {
  const u = unit(s, 'settler', owner, x, y);
  return G.foundCity(s, u.id);
}

test('новая партия: у каждого поселенец и воин, начало на суше', () => {
  const s = G.createGame({ seed: 5, opponents: 3 });
  const majors = s.players.filter((p) => p.kind === 'major');
  assert.equal(majors.length, 4);
  assert.ok(s.players[0].human);
  assert.equal(new Set(majors.map((p) => p.faction)).size, 4, 'фракции не повторяются');
  for (const p of majors) {
    const types = G.playerUnits(s, p.id).map((u) => u.type).sort();
    assert.deepEqual(types, ['settler', 'warrior']);
  }
});

test('поселенец основывает город, рядом второй нельзя', () => {
  const s = makeState();
  const c = cityFor(s, 0, 3, 3);
  assert.ok(c);
  assert.ok(c.capital);
  assert.equal(G.tileAt(s, 3, 3).owner, 0);
  assert.equal(G.tileAt(s, 4, 3).owner, 0, 'клетки вокруг стали своими');
  const u2 = unit(s, 'settler', 0, 5, 3);
  assert.equal(typeof G.canFoundCity(s, u2), 'string');
  assert.equal(G.foundCity(s, u2.id), null);
  const u3 = unit(s, 'settler', 0, 7, 3);
  assert.ok(G.foundCity(s, u3.id));
  assert.equal(G.playerCities(s, 0).filter((x) => x.capital).length, 1);
});

test('город растёт, когда накопил еду, и расширяет границы', () => {
  const s = makeState(12, 10);
  const c = cityFor(s, 0, 5, 5);
  const need = G.growthNeed(1);
  c.food = need - 1;
  G.finishPlayerTurn(s, 0);
  assert.equal(c.pop, 2);
  c.food = G.growthNeed(2);
  G.finishPlayerTurn(s, 0);
  assert.equal(c.pop, 3);
  assert.equal(G.tileAt(s, 7, 5).owner, 0, 'при 3 жителях радиус 2');
});

test('производство: юнит появляется, когда накоплено достаточно', () => {
  const s = makeState();
  const c = cityFor(s, 0, 3, 3);
  assert.ok(G.setProduction(s, c.id, 'unit', 'warrior'));
  c.prodStore = UNITS.warrior.cost;
  G.finishPlayerTurn(s, 0);
  const w = G.playerUnits(s, 0).filter((u) => u.type === 'warrior');
  assert.equal(w.length, 1);
  assert.equal(c.build, null, 'после постройки город снова ждёт выбора');
});

test('нельзя строить то, что ещё не открыто', () => {
  const s = makeState();
  const c = cityFor(s, 0, 3, 3);
  assert.equal(G.setProduction(s, c.id, 'unit', 'swordsman'), false);
  assert.equal(G.setProduction(s, c.id, 'building', 'library'), false);
  s.players[0].techs.push('pottery', 'writing');
  assert.ok(G.setProduction(s, c.id, 'building', 'library'));
});

test('поселенец забирает жителя и ждёт, пока в городе не станет 2', () => {
  const s = makeState();
  const c = cityFor(s, 0, 3, 3);
  G.setProduction(s, c.id, 'unit', 'settler');
  c.prodStore = 999;
  G.finishPlayerTurn(s, 0);
  assert.equal(G.playerUnits(s, 0).filter((u) => u.type === 'settler').length, 0);
  c.pop = 2;
  G.finishPlayerTurn(s, 0);
  assert.equal(G.playerUnits(s, 0).filter((u) => u.type === 'settler').length, 1);
  assert.equal(c.pop, 1);
});

test('исследование: только доступные технологии, изучается по накоплению', () => {
  const s = makeState();
  cityFor(s, 0, 3, 3);
  assert.equal(G.setResearch(s, 0, 'iron'), false, 'нет предпосылок');
  assert.ok(G.setResearch(s, 0, 'mining'));
  s.players[0].sci = TECHS.mining.cost;
  G.finishPlayerTurn(s, 0);
  assert.ok(s.players[0].techs.includes('mining'));
  assert.equal(s.players[0].research, null);
  assert.ok(G.availableTechs(s, 0).includes('bronze'));
});

test('движение: лес и холмы стоят 2, горы и вода непроходимы', () => {
  const s = makeState(10, 8, { '4,3': 'forest', '2,3': 'mountain', '3,2': 'water' });
  const u = unit(s, 'warrior', 0, 3, 3);
  const r = G.reachable(s, u);
  assert.ok(r.has(G.idx(s, 4, 3)));
  assert.equal(r.get(G.idx(s, 4, 3)).rem, 0);
  assert.ok(!r.has(G.idx(s, 2, 3)));
  assert.ok(!r.has(G.idx(s, 3, 2)));
  G.orderMove(s, u.id, 4, 3);
  assert.deepEqual([u.x, u.y], [4, 3]);
  assert.equal(u.moves, 0);
});

test('дальний приказ: юнит идёт несколько ходов и доходит сам', () => {
  const s = makeState(14, 6);
  const u = unit(s, 'warrior', 0, 1, 2);
  G.orderMove(s, u.id, 9, 2);
  assert.deepEqual([u.x, u.y], [3, 2]);
  assert.deepEqual(u.goto, [9, 2]);
  for (let i = 0; i < 4; i++) { G.finishPlayerTurn(s, 0); s.turn++; G.beginPlayerTurn(s, 0); }
  assert.deepEqual([u.x, u.y], [9, 2]);
  assert.equal(u.goto, null);
});

test('путь обходит воду', () => {
  const water = {};
  for (let y = 0; y < 5; y++) water[`5,${y}`] = 'water';
  const s = makeState(10, 8, water);
  const u = unit(s, 'warrior', 0, 3, 2);
  const path = G.findPath(s, u, 7, 2);
  assert.ok(path);
  for (const [x, y] of path) assert.notEqual(G.tileAt(s, x, y).t, 'water');
});

test('два бойца одного игрока не встают на одну клетку, мирный и боец — могут', () => {
  const s = makeState();
  const a = unit(s, 'warrior', 0, 3, 3);
  unit(s, 'warrior', 0, 4, 3);
  assert.equal(G.enterKind(s, a, 4, 3), null);
  unit(s, 'worker', 0, 2, 3);
  assert.equal(G.enterKind(s, a, 2, 3), 'move');
});

test('ближний бой: оба получают урон, слабый погибает', () => {
  const s = makeState();
  const a = unit(s, 'swordsman', 0, 3, 3);
  const d = unit(s, 'warrior', 1, 4, 3);
  d.hp = 20;
  const pv = G.combatPreview(s, a, 4, 3);
  assert.ok(pv.toDef > pv.toAtk);
  assert.ok(pv.kills);
  const r = G.attack(s, a.id, 4, 3);
  assert.ok(r.killed);
  assert.equal(s.units[d.id], undefined);
  assert.deepEqual([a.x, a.y], [4, 3], 'победитель занимает клетку');
  assert.equal(a.moves, 0);
});

test('стрелок не получает ответного урона и бьёт через клетку', () => {
  const s = makeState();
  s.players[0].techs.push('archery');
  const a = unit(s, 'archer', 0, 2, 3);
  const d = unit(s, 'warrior', 1, 4, 3);
  assert.ok(G.canAttack(s, a, 4, 3));
  const r = G.attack(s, a.id, 4, 3);
  assert.equal(r.toAtk, 0);
  assert.equal(a.hp, 100);
  assert.ok(d.hp < 100);
  assert.deepEqual([a.x, a.y], [2, 3]);
});

test('укрепление и холмы усиливают защиту', () => {
  const s = makeState(10, 8, { '5,3': 'hills' });
  const a = unit(s, 'warrior', 0, 3, 3);
  const d1 = unit(s, 'warrior', 1, 4, 3);
  const plain = G.combatPreview(s, a, 4, 3).toDef;
  d1.fortified = true;
  assert.ok(G.combatPreview(s, a, 4, 3).toDef < plain);
  const a2 = unit(s, 'warrior', 0, 6, 3);
  unit(s, 'warrior', 1, 5, 3);
  assert.ok(G.combatPreview(s, a2, 5, 3).toDef < plain);
});

test('копейщик силён против всадника', () => {
  const s = makeState();
  const h = unit(s, 'horseman', 0, 3, 3);
  const sp = unit(s, 'spearman', 1, 4, 3);
  const pv = G.combatPreview(s, h, 4, 3);
  assert.ok(pv.toAtk > pv.toDef);
  assert.ok(sp);
});

test('стрелок не может взять город, боец ближнего боя — может', () => {
  const s = makeState();
  s.players[0].techs.push('archery');
  const c = cityFor(s, 1, 5, 3);
  cityFor(s, 1, 9, 6); // второй город, чтобы игрок не выбыл сразу
  const ar = unit(s, 'archer', 0, 3, 3);
  c.hp = 5;
  G.attack(s, ar.id, 5, 3);
  assert.equal(c.owner, 1);
  assert.equal(c.hp, 1);
  const sw = unit(s, 'swordsman', 0, 4, 3);
  const r = G.attack(s, sw.id, 5, 3);
  assert.equal(r.captured, c.id);
  assert.equal(c.owner, 0);
  assert.deepEqual([sw.x, sw.y], [5, 3]);
  assert.equal(G.tileAt(s, 5, 3).owner, 0);
  assert.ok(G.playerCities(s, 1)[0].capital, 'столица переехала в оставшийся город');
});

test('боец захватывает одинокого мирного юнита', () => {
  const s = makeState();
  const w = unit(s, 'warrior', 0, 3, 3);
  const wk = unit(s, 'worker', 1, 4, 3);
  cityFor(s, 1, 8, 6);
  assert.equal(G.enterKind(s, w, 4, 3), 'capture');
  G.orderMove(s, w.id, 4, 3);
  assert.equal(wk.owner, 0);
});

test('потеря последнего города — поражение, уничтожение всех врагов — победа', () => {
  const s = makeState();
  const mine = cityFor(s, 0, 2, 2);
  const theirs = cityFor(s, 1, 6, 3);
  const enemyUnit = unit(s, 'warrior', 1, 8, 6);
  theirs.hp = 1;
  const sw = unit(s, 'swordsman', 0, 5, 3);
  G.attack(s, sw.id, 6, 3);
  assert.equal(s.players[1].alive, false);
  assert.equal(s.units[enemyUnit.id], undefined, 'юниты выбывшего исчезают');
  assert.ok(s.over);
  assert.equal(s.result, 'victory');
  assert.ok(mine);

  const s2 = makeState();
  const m2 = cityFor(s2, 0, 2, 2);
  cityFor(s2, 1, 7, 5);
  m2.hp = 1;
  const enemy = unit(s2, 'swordsman', 1, 3, 2);
  G.attack(s2, enemy.id, 2, 2);
  assert.ok(s2.over);
  assert.equal(s2.result, 'defeat');
});

test('рабочий строит ферму, и клетка даёт больше еды', () => {
  const s = makeState();
  cityFor(s, 0, 3, 3);
  const wk = unit(s, 'worker', 0, 4, 3);
  const before = G.tileYield(s, 4, 3, 0).food;
  assert.deepEqual(G.availableImprovements(s, wk), ['farm', 'road']);
  assert.ok(G.startImprovement(s, wk.id, 'farm'));
  for (let i = 0; i < 4; i++) { G.finishPlayerTurn(s, 0); G.beginPlayerTurn(s, 0); }
  assert.equal(G.tileAt(s, 4, 3).imp, 'farm');
  assert.equal(G.tileYield(s, 4, 3, 0).food, before + 1);
  s.players[0].techs.push('irrigation');
  assert.equal(G.tileYield(s, 4, 3, 0).food, before + 2);
});

test('рабочий не строит на чужой земле', () => {
  const s = makeState();
  cityFor(s, 1, 3, 3);
  const wk = unit(s, 'worker', 0, 4, 3);
  assert.deepEqual(G.availableImprovements(s, wk), []);
});

test('город сам обстреливает врага рядом', () => {
  const s = makeState();
  cityFor(s, 0, 3, 3);
  const e = unit(s, 'warrior', 1, 5, 3);
  G.finishPlayerTurn(s, 0);
  assert.ok(!s.units[e.id] || e.hp < 100);
});

test('раненый юнит лечится, если не действовал', () => {
  const s = makeState();
  const u = unit(s, 'warrior', 0, 3, 3);
  u.hp = 50;
  G.beginPlayerTurn(s, 0);
  assert.equal(u.hp, 60);
  u.acted = true;
  G.beginPlayerTurn(s, 0);
  assert.equal(u.hp, 60);
});

test('ход: «нужны приказы» — только юниты с ходами и без задания', () => {
  const s = makeState();
  const a = unit(s, 'warrior', 0, 3, 3);
  const b = unit(s, 'warrior', 0, 5, 3);
  const c = unit(s, 'warrior', 0, 7, 3);
  G.fortify(s, a.id);
  G.skipUnit(s, b.id);
  assert.deepEqual(G.needsOrders(s, 0).map((u) => u.id), [c.id]);
});

test('смена хода проходит, номер хода растёт', () => {
  const s = G.createGame({ seed: 3, opponents: 2 });
  const settler = G.playerUnits(s, 0).find((u) => u.type === 'settler');
  G.foundCity(s, settler.id);
  endTurn(s);
  assert.equal(s.turn, 2);
  assert.ok(G.playerCities(s, 1).length + G.playerCities(s, 2).length >= 1, 'ИИ основал города');
});

test('рабочий на автомате сам строит улучшение и не просит приказов', async () => {
  const { runAutoWorkers } = await import('../src/core/turn.js');
  const s = makeState();
  cityFor(s, 0, 3, 3);
  const wk = unit(s, 'worker', 0, 3, 3);
  G.automateUnit(s, wk.id);
  assert.deepEqual(G.needsOrders(s, 0).map((u) => u.id), []);
  for (let i = 0; i < 8; i++) { G.beginPlayerTurn(s, 0); runAutoWorkers(s, 0); G.finishPlayerTurn(s, 0); }
  assert.ok(s.tiles.some((t) => t.imp), 'что-то построено');
  G.wakeUnit(s, wk.id);
  assert.equal(wk.auto, false);
});

test('для анимаций записываются ход, атака и гибель; в сохранение запись не попадает', async () => {
  const { serialize } = await import('../src/core/save.js');
  const s = makeState();
  const a = unit(s, 'swordsman', 0, 2, 3);
  const d = unit(s, 'warrior', 1, 4, 3);
  d.hp = 5;
  s._fx = [];
  G.orderMove(s, a.id, 3, 3);
  G.attack(s, a.id, 4, 3);
  const kinds = s._fx.map((e) => e.t);
  assert.deepEqual(kinds, ['move', 'attack', 'remove', 'move']);
  assert.equal(s._fx[1].defId, d.id);
  assert.ok(!serialize(s).includes('_fx'));
});
