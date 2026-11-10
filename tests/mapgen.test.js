import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMap, isPassable } from '../src/core/mapgen.js';
import { neighbors, distance } from '../src/core/hex.js';

test('одинаковое зерно даёт одинаковую карту', () => {
  const a = generateMap({ rng: 42 }, 26, 18, 3);
  const b = generateMap({ rng: 42 }, 26, 18, 3);
  assert.deepEqual(a, b);
});

for (const seed of [1, 7, 99, 2024]) {
  test(`карта ${seed}: старты на суше, далеко друг от друга, вся суша связна`, () => {
    const w = 30, h = 20;
    const { tiles, starts } = generateMap({ rng: seed }, w, h, 4);
    assert.equal(starts.length, 4);
    for (const st of starts) assert.ok(isPassable(tiles[st.y * w + st.x].t) && tiles[st.y * w + st.x].t !== 'water');
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      assert.ok(distance(starts[i].x, starts[i].y, starts[j].x, starts[j].y) >= 7);
    }
    const land = (i) => tiles[i].t !== 'water' && isPassable(tiles[i].t);
    const seen = new Set([starts[0].y * w + starts[0].x]);
    const stack = [...seen];
    while (stack.length) {
      const i = stack.pop();
      for (const [x, y] of neighbors(w, h, i % w, Math.floor(i / w))) {
        const k = y * w + x;
        if (!seen.has(k) && land(k)) { seen.add(k); stack.push(k); }
      }
    }
    const total = tiles.filter((_, i) => land(i)).length;
    assert.equal(seen.size, total);
    assert.ok(total > w * h * 0.35, 'суши достаточно');
  });
}
