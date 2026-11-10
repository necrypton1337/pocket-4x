import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neighbors, distance, tilesInRadius } from '../src/core/hex.js';

test('у внутренней клетки 6 соседей, и все на расстоянии 1', () => {
  for (const [x, y] of [[4, 4], [4, 5], [3, 3]]) {
    const n = neighbors(10, 10, x, y);
    assert.equal(n.length, 6);
    for (const [nx, ny] of n) assert.equal(distance(x, y, nx, ny), 1);
  }
});

test('у угловой клетки меньше соседей', () => {
  assert.ok(neighbors(10, 10, 0, 0).length < 6);
});

test('расстояние симметрично и соблюдает неравенство треугольника', () => {
  const pts = [[0, 0], [5, 3], [2, 7], [9, 9], [4, 4]];
  for (const a of pts) for (const b of pts) {
    assert.equal(distance(...a, ...b), distance(...b, ...a));
    for (const c of pts) assert.ok(distance(...a, ...c) <= distance(...a, ...b) + distance(...b, ...c));
  }
});

test('в радиусе 1 — 7 клеток, в радиусе 2 — 19', () => {
  assert.equal(tilesInRadius(20, 20, 10, 10, 1).length, 7);
  assert.equal(tilesInRadius(20, 20, 10, 11, 2).length, 19);
});
