import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, playerUnits, foundCity } from '../src/core/game.js';
import { endTurn } from '../src/core/turn.js';
import { serialize, deserialize } from '../src/core/save.js';

test('сохранение и загрузка дают ту же самую партию', () => {
  const s = createGame({ seed: 77, opponents: 2 });
  foundCity(s, playerUnits(s, 0).find((u) => u.type === 'settler').id);
  for (let i = 0; i < 10; i++) endTurn(s);
  const text = serialize(s);
  const loaded = deserialize(text);
  assert.deepEqual(loaded, s);
  // Дальше партия идёт одинаково — генератор случайностей тоже сохранился.
  for (let i = 0; i < 15; i++) { endTurn(s); endTurn(loaded); }
  assert.equal(serialize(loaded), serialize(s));
});

test('сохранение компактное', () => {
  const s = createGame({ seed: 1, opponents: 3 });
  assert.ok(serialize(s).length < 200_000);
});

test('несовместимое сохранение отклоняется', () => {
  assert.throws(() => deserialize(JSON.stringify({ version: 999 })));
});
