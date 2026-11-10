import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, foundCity, playerUnits, unitList, cityList, tileAt, isCivil, playerCities } from '../src/core/game.js';
import { endTurn } from '../src/core/turn.js';
import { TERRAIN, UNITS } from '../src/core/data.js';

function checkInvariants(s) {
  const seen = new Map();
  for (const u of unitList(s)) {
    assert.ok(s.players[u.owner].alive, 'у выбывших нет юнитов');
    assert.ok(UNITS[u.type].flying || TERRAIN[tileAt(s, u.x, u.y).t].move !== Infinity, 'юнит стоит на проходимой клетке');
    assert.ok(u.hp > 0 && u.hp <= 100);
    const key = `${u.x},${u.y},${isCivil(u.type)}`;
    assert.ok(!seen.has(key), `два юнита одного слоя на ${key}`);
    seen.set(key, u);
    const other = unitList(s).find((o) => o.x === u.x && o.y === u.y && o.owner !== u.owner);
    assert.ok(!other, 'на клетке нет юнитов разных игроков');
  }
  for (const c of cityList(s)) {
    assert.ok(s.players[c.owner].alive);
    assert.ok(c.pop >= 1);
    assert.equal(tileAt(s, c.x, c.y).owner, c.owner);
  }
}

test('ИИ против ИИ: 120 ходов без ошибок, правила не нарушаются, ИИ развивается', () => {
  const s = createGame({ seed: 11, opponents: 3, allAI: true });
  for (let i = 0; i < 120 && !s.over; i++) {
    endTurn(s);
    if (i % 10 === 0) checkInvariants(s);
  }
  checkInvariants(s);
  const alive = s.players.filter((p) => p.alive && p.kind === 'major');
  for (const p of alive) {
    assert.ok(playerCities(s, p.id).length >= 1, `${p.name}: есть города`);
    assert.ok(p.techs.length >= 8, `${p.name}: изучено технологий ${p.techs.length}`);
  }
  assert.ok(alive.filter((p) => playerCities(s, p.id).length >= 3).length * 2 >= alive.length, 'большинство фракций расширилось');
});

test('ИИ доводит войну до конца: в дуэли кто-то побеждает', () => {
  const s = createGame({ seed: 2, opponents: 1, allAI: true });
  while (!s.over && s.turn < 400) endTurn(s);
  assert.ok(s.over, 'партия закончилась');
  assert.notEqual(s.winner, null);
  checkInvariants(s);
});

test('ИИ нападает на игрока-человека, который ничего не делает', () => {
  const s = createGame({ seed: 4, opponents: 1, difficulty: 'hard' });
  foundCity(s, playerUnits(s, 0).find((u) => u.type === 'settler').id);
  while (!s.over && s.turn < 300) endTurn(s);
  assert.ok(s.over);
  assert.equal(s.result, 'defeat');
});

test('ИИ находит и уничтожает игрока без городов', () => {
  const s = createGame({ seed: 4, opponents: 1 });
  while (!s.over && s.turn < 300) endTurn(s);
  assert.ok(s.over);
  assert.equal(s.result, 'defeat');
});
