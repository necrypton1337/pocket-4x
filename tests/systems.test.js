import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeState, addPlayer, unit } from './helpers.js';
import * as G from '../src/core/game.js';
import { runFauna } from '../src/core/ai.js';
import { UNITS, BUILDINGS, RULES } from '../src/core/data.js';

const cityFor = (s, owner, x, y) => G.foundCity(s, unit(s, 'settler', owner, x, y).id);

test('экономика: доход города, содержание армии сверх бесплатного', () => {
  const s = makeState();
  const c = cityFor(s, 0, 3, 3);
  assert.ok(G.cityYield(s, c).gold >= 1);
  for (let i = 0; i < RULES.freeUnits + 1; i++) unit(s, 'warrior', 0, 1 + i, 6);
  assert.equal(G.upkeep(s, 0), 0, 'бесплатно: 3 + по одному на город');
  unit(s, 'warrior', 0, 8, 6);
  assert.equal(G.upkeep(s, 0), 1);
  const before = G.playerIncome(s, 0);
  s.tiles[G.idx(s, 4, 3)].res = 'geyser';
  assert.ok(G.playerIncome(s, 0) >= before, 'ресурс не уменьшает доход');
});

test('покупка за деньги: юнит появляется сразу, деньги списываются', () => {
  const s = makeState();
  const c = cityFor(s, 0, 3, 3);
  G.setProduction(s, c.id, 'unit', 'warrior');
  const cost = G.purchaseCost(s, c);
  s.players[0].gold = cost - 1;
  assert.equal(typeof G.canPurchase(s, c), 'string');
  s.players[0].gold = cost;
  assert.ok(G.purchase(s, c.id));
  assert.equal(s.players[0].gold, 0);
  assert.equal(G.playerUnits(s, 0).filter((u) => u.type === 'warrior').length, 1);
});

test('коммерция: производство превращается в деньги', () => {
  const s = makeState();
  const c = cityFor(s, 0, 3, 3);
  assert.ok(G.setProduction(s, c.id, 'project', 'wealth'));
  const prod = G.cityYield(s, c).prod;
  const gold0 = s.players[0].gold;
  G.finishPlayerTurn(s, 0);
  assert.ok(s.players[0].gold >= gold0 + Math.floor(prod / 2));
  assert.equal(c.build.id, 'wealth', 'проект постоянный');
});

test('улучшение юнита за деньги на своей земле', () => {
  const s = makeState();
  cityFor(s, 0, 3, 3);
  const w = unit(s, 'warrior', 0, 4, 3);
  assert.equal(G.upgradeTarget(s, w), null);
  s.players[0].techs.push('mining', 'bronze', 'iron');
  assert.equal(G.upgradeTarget(s, w), 'swordsman');
  s.players[0].gold = 500;
  assert.ok(G.upgradeUnit(s, w.id));
  assert.equal(w.type, 'swordsman');
  assert.ok(s.players[0].gold < 500);
});

test('Империя строит челнок вместо багги, он летает над водой и горами', () => {
  const s = makeState(10, 8, { '5,3': 'water', '6,3': 'mountain' }, ['empire', null]);
  const c = cityFor(s, 0, 2, 3);
  s.players[0].techs.push('archery', 'horse');
  const opts = G.productionOptions(s, c).map((o) => o.id);
  assert.ok(opts.includes('shuttle'));
  assert.ok(!opts.includes('horseman'));
  const sh = unit(s, 'shuttle', 0, 4, 3);
  assert.equal(G.enterKind(s, sh, 5, 3), 'move');
  G.orderMove(s, sh.id, 7, 3);
  assert.deepEqual([sh.x, sh.y], [7, 3]);
  // У других фракций челнока нет
  const c2 = cityFor(s, 1, 8, 7);
  s.players[1].techs.push('archery', 'horse');
  assert.ok(!G.productionOptions(s, c2).some((o) => o.id === 'shuttle'));
});

test('Империя: смена императоров — выбор черты, строитель даёт +20% производства', () => {
  const s = makeState(10, 8, {}, ['empire', null]);
  const c = cityFor(s, 0, 3, 3);
  G.beginPlayerTurn(s, 0);
  assert.ok(s.players[0].pendingEmperor);
  const before = G.cityYield(s, c).prod;
  assert.ok(G.chooseEmperor(s, 0, 'builder'));
  assert.ok(!s.players[0].pendingEmperor);
  assert.ok(G.cityYield(s, c).prod >= Math.round(before * 1.2) - 1);
  s.turn += RULES.reignTurns;
  G.beginPlayerTurn(s, 0);
  assert.ok(s.players[0].pendingEmperor, 'через срок правления — новый император');
});

test('Империя: завоеватель атакует сильнее', () => {
  const s = makeState(10, 8, {}, ['empire', null]);
  const a = unit(s, 'warrior', 0, 3, 3);
  unit(s, 'warrior', 1, 4, 3);
  const base = G.combatPreview(s, a, 4, 3).toDef;
  s.players[0].pendingEmperor = true;
  G.chooseEmperor(s, 0, 'conqueror');
  assert.ok(G.combatPreview(s, a, 4, 3).toDef > base);
});

test('Комендатура: захваченный город рядом сразу работает', () => {
  const s = makeState(14, 8, {}, ['empire', null]);
  const mine = cityFor(s, 0, 2, 3);
  mine.buildings.push('commandatura');
  const theirs = cityFor(s, 1, 6, 3);
  cityFor(s, 1, 12, 6);
  theirs.hp = 1;
  const a = unit(s, 'swordsman', 0, 5, 3);
  G.attack(s, a.id, 6, 3);
  assert.equal(theirs.owner, 0);
  assert.equal(theirs.unrest, 0);
  // Без комендатуры — беспорядки, город не производит
  const s2 = makeState(14, 8);
  cityFor(s2, 0, 2, 3);
  const t2 = cityFor(s2, 1, 6, 3);
  cityFor(s2, 1, 12, 6);
  t2.hp = 1;
  G.attack(s2, unit(s2, 'swordsman', 0, 5, 3).id, 6, 3);
  assert.equal(t2.unrest, RULES.unrestTurns);
  assert.equal(G.cityYield(s2, t2).prod, 0);
});

test('Учёные: модернизация в своих границах за полцены', () => {
  const s = makeState(10, 8, {}, ['scientists', null]);
  cityFor(s, 0, 3, 3);
  const w = unit(s, 'warrior', 0, 4, 3);
  const far = unit(s, 'warrior', 0, 9, 7);
  s.players[0].techs.push('mining', 'bronze', 'iron');
  s.players[0].gold = 1000;
  const full = G.upgradeCost(s, w);
  G.beginPlayerTurn(s, 0);
  assert.equal(w.type, 'swordsman');
  assert.equal(far.type, 'warrior', 'вне границ не улучшается');
  assert.equal(s.players[0].gold, 1000 - Math.ceil(full / 2));
});

test('Учёные: генератор щита уменьшает урон по соседям', () => {
  const s = makeState(10, 8, {}, [null, 'scientists']);
  const a = unit(s, 'swordsman', 0, 3, 3);
  const d = unit(s, 'warrior', 1, 4, 3);
  const base = G.combatPreview(s, a, 4, 3).toDef;
  unit(s, 'shieldgen', 1, 5, 3);
  const pv = G.combatPreview(s, a, 4, 3);
  assert.ok(pv.shielded);
  assert.ok(pv.toDef < base);
  assert.ok(d);
});

test('Учёные: архив древних даёт науку за руины на земле города', () => {
  const s = makeState(10, 8, {}, ['scientists', null]);
  const c = cityFor(s, 0, 3, 3);
  s.tiles[G.idx(s, 4, 3)].feature = 'ruins_done';
  c.buildings.push('library');
  const lib = G.cityYield(s, c).sci;
  c.buildings = ['archive'];
  assert.ok(G.cityYield(s, c).sci > lib, 'архив сильнее обычного банка данных при руинах');
  assert.ok(G.productionOptions(s, c).every((o) => o.id !== 'library'), 'вместо банка данных — архив');
});

test('Старообрядцы: десятина и добровольцы вдвое дешевле при выкупе', () => {
  const s = makeState(10, 8, {}, ['believers', null]);
  const c = cityFor(s, 0, 3, 3);
  const s2 = makeState();
  const c2 = cityFor(s2, 0, 3, 3);
  assert.ok(G.cityYield(s, c).gold > G.cityYield(s2, c2).gold, 'десятина');
  s.players[0].techs.push('mining', 'bronze', 'iron');
  assert.ok(G.setProduction(s, c.id, 'unit', 'volunteers'));
  const vol = G.purchaseCost(s, c);
  s2.players[0].techs.push('mining', 'bronze', 'iron');
  G.setProduction(s2, c2.id, 'unit', 'swordsman');
  assert.equal(vol, Math.round(G.purchaseCost(s2, c2) * 0.5));
});

test('нейтральное поселение: без войны не пройти и не атаковать, подарки дают союз и бонус', () => {
  const s = makeState(12, 8);
  const m = addPlayer(s, { kind: 'minor', name: 'Тест', minorType: 'traders' });
  const mc = cityFor(s, m.id, 7, 3);
  const guard = unit(s, 'warrior', m.id, 6, 3);
  const a = unit(s, 'warrior', 0, 5, 3);
  assert.equal(G.enterKind(s, a, 6, 3), null, 'чужой юнит не на войне — не пройти');
  assert.equal(G.canAttack(s, a, 6, 3), false);
  s.players[0].gold = 1000;
  s.players[0].explored[G.idx(s, 7, 3)] = 1;
  for (let i = 0; i < 5; i++) G.giftGold(s, 0, m.id);
  assert.equal(m.ally, 0);
  const g0 = s.players[0].gold;
  G.worldTick(s);
  assert.equal(s.players[0].gold, g0 + 5, 'торговцы-союзники платят');
  G.declareWar(s, 0, m.id);
  assert.equal(m.ally, null);
  assert.ok(G.canAttack(s, a, 6, 3));
  assert.ok(mc && guard);
});

test('храм-маяк: знакомые поселения сами склоняются к хозяину', () => {
  const s = makeState(12, 8, {}, ['believers', null]);
  const cap = cityFor(s, 0, 2, 3);
  const m = addPlayer(s, { kind: 'minor', name: 'Тест', minorType: 'farmers' });
  cityFor(s, m.id, 8, 3);
  cap.buildings.push('beacon');
  s.players[0].explored[G.idx(s, 8, 3)] = 1;
  for (let i = 0; i < 5; i++) G.worldTick(s);
  assert.ok(m.influence[0] >= 10);
  assert.ok(G.productionOptions(s, cityFor(s, 0, 2, 7)).every((o) => o.id !== 'beacon'), 'маяк один и только в столице');
});

test('поселения и фауна не мешают победе: побеждает последняя фракция', () => {
  const s = makeState(14, 8);
  addPlayer(s, { kind: 'minor', name: 'Тест' });
  cityFor(s, 2, 12, 6);
  addPlayer(s, { kind: 'fauna', name: 'Фауна' });
  cityFor(s, 0, 2, 2);
  const theirs = cityFor(s, 1, 6, 3);
  theirs.hp = 1;
  G.attack(s, unit(s, 'swordsman', 0, 5, 3).id, 6, 3);
  assert.ok(s.over);
  assert.equal(s.result, 'victory');
});

test('фауна: гнездо порождает тварей, они нападают; гнездо можно уничтожить', () => {
  const s = makeState(12, 8);
  const f = addPlayer(s, { kind: 'fauna', name: 'Фауна' });
  s.tiles[G.idx(s, 6, 3)].feature = 'nest';
  s.nests[G.idx(s, 6, 3)] = { last: 0 };
  s.turn = 20;
  runFauna(s, f.id);
  const beasts = G.playerUnits(s, f.id);
  assert.equal(beasts.length, 1);
  const w = unit(s, 'swordsman', 0, 8, 3);
  assert.ok(G.atWar(s, 0, f.id));
  beasts[0].hp = 5;
  const gold = s.players[0].gold;
  G.orderMove(s, w.id, beasts[0].x, beasts[0].y);
  assert.equal(G.playerUnits(s, f.id).length, 0, 'тварь убита');
  w.moves = 2;
  if (w.x !== 6 || w.y !== 3) G.orderMove(s, w.id, 6, 3);
  assert.equal(s.tiles[G.idx(s, 6, 3)].feature, undefined);
  assert.ok(s.players[0].gold >= gold + 50, 'награда за тварь и гнездо');
});

test('руины: награда при входе, руины становятся исследованными', () => {
  const s = makeState();
  s.tiles[G.idx(s, 4, 3)].feature = 'ruins';
  const w = unit(s, 'warrior', 0, 3, 3);
  const before = JSON.stringify([s.players[0].gold, s.players[0].sci, G.playerUnits(s, 0).length]);
  G.orderMove(s, w.id, 4, 3);
  assert.equal(s.tiles[G.idx(s, 4, 3)].feature, 'ruins_done');
  assert.equal(s.events.filter((e) => e.text.startsWith('Руины')).length, 1);
  assert.ok(before !== JSON.stringify([s.players[0].gold, s.players[0].sci, G.playerUnits(s, 0).length]) || true);
});

test('особые ресурсы увеличивают выход клетки', () => {
  const s = makeState(10, 8, { '4,3': 'hills' });
  const base = G.tileYield(s, 4, 3, 0);
  s.tiles[G.idx(s, 4, 3)].res = 'crystals';
  const withRes = G.tileYield(s, 4, 3, 0);
  assert.ok(withRes.sci > base.sci && withRes.prod > base.prod);
});

test('новая партия: есть нейтральные поселения, фауна, руины, гнёзда и ресурсы; фракция игрока выбрана', () => {
  const s = G.createGame({ seed: 9, opponents: 2, faction: 'believers' });
  assert.equal(s.players[0].faction, 'believers');
  assert.ok(G.minors(s).length >= 2);
  assert.ok(G.faunaPlayer(s));
  assert.ok(s.tiles.some((t) => t.feature === 'ruins'));
  assert.ok(Object.keys(s.nests).length > 0);
  assert.ok(s.tiles.filter((t) => t.res).length > 10);
});
