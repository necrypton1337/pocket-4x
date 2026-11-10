import { rand, randInt } from './rng.js';
import { neighbors, tilesInRadius, distance } from './hex.js';
import { TERRAIN } from './data.js';

function makeNoise(holder, w, h, cell) {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const grid = [];
  for (let i = 0; i < gw * gh; i++) grid.push(rand(holder));
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / cell, fy = y / cell;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = smooth(fx - ix), ty = smooth(fy - iy);
    const g = (a, b) => grid[b * gw + a];
    const top = g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx;
    const bot = g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx;
    return top * (1 - ty) + bot * ty;
  };
}

function fbm(holder, w, h, cells) {
  const layers = cells.map((c) => makeNoise(holder, w, h, c));
  return (x, y) => {
    let v = 0, amp = 1, sum = 0;
    for (const n of layers) { v += n(x, y) * amp; sum += amp; amp *= 0.5; }
    return v / sum;
  };
}

function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

export function isPassable(t) {
  return TERRAIN[t].move !== Infinity;
}

function tryGenerate(holder, w, h, numPlayers) {
  const elevN = fbm(holder, w, h, [7, 3.5, 1.8]);
  const moistN = fbm(holder, w, h, [5, 2.5]);
  const hillN = fbm(holder, w, h, [3, 1.5]);
  const N = w * h;
  const elev = new Array(N), moist = new Array(N), hill = new Array(N);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = (x / (w - 1) - 0.5) * 2, dy = (y / (h - 1) - 0.5) * 2;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      elev[i] = elevN(x, y) - 0.6 * Math.pow(d, 3);
      moist[i] = moistN(x, y);
      hill[i] = hillN(x, y);
    }
  }
  const waterLevel = quantile(elev, 0.42);
  const tiles = [];
  for (let i = 0; i < N; i++) tiles.push({ t: 'water', imp: null, owner: -1, city: -1 });
  const land = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) continue;
      if (elev[i] > waterLevel) land.push(i);
    }
  }
  const mountainLevel = quantile(land.map((i) => elev[i]), 0.95);
  const hillLevel = quantile(land.map((i) => hill[i]), 0.82);
  const forestLevel = quantile(land.map((i) => moist[i]), 0.72);
  const dryLevel = quantile(land.map((i) => moist[i]), 0.12);
  for (const i of land) {
    const y = Math.floor(i / w);
    const lat = Math.abs(y / (h - 1) - 0.5) * 2;
    let t;
    if (elev[i] >= mountainLevel) t = 'mountain';
    else if (hill[i] >= hillLevel) t = 'hills';
    else if (lat > 0.82) t = 'tundra';
    else if (moist[i] >= forestLevel) t = 'forest';
    else if (moist[i] <= dryLevel && lat < 0.6) t = 'desert';
    else t = moist[i] > 0.5 ? 'grass' : (randInt(holder, 3) === 0 ? 'grass' : 'plains');
    tiles[i].t = t;
  }

  // Оставляем только самый большой проходимый материк, остальную сушу топим.
  const comp = new Array(N).fill(-1);
  let best = -1, bestSize = 0, c = 0;
  for (let i = 0; i < N; i++) {
    if (comp[i] !== -1 || !isPassable(tiles[i].t) || tiles[i].t === 'water') continue;
    let size = 0;
    const stack = [i];
    comp[i] = c;
    while (stack.length) {
      const j = stack.pop();
      size++;
      for (const [nx, ny] of neighbors(w, h, j % w, Math.floor(j / w))) {
        const k = ny * w + nx;
        if (comp[k] === -1 && isPassable(tiles[k].t)) { comp[k] = c; stack.push(k); }
      }
    }
    if (size > bestSize) { bestSize = size; best = c; }
    c++;
  }
  for (let i = 0; i < N; i++) {
    if (tiles[i].t !== 'water' && tiles[i].t !== 'mountain' && comp[i] !== best) tiles[i].t = 'water';
  }

  // Стартовые позиции: хорошие места, как можно дальше друг от друга.
  const score = (x, y) => {
    let s = 0;
    for (const [nx, ny] of tilesInRadius(w, h, x, y, 2)) {
      const tt = TERRAIN[tiles[ny * w + nx].t];
      if (tt.move !== Infinity) s += tt.food * 1.5 + tt.prod;
    }
    return s;
  };
  const cands = [];
  for (let i = 0; i < N; i++) {
    const t = tiles[i].t;
    if (comp[i] !== best || t === 'desert' || t === 'tundra' || t === 'hills') continue;
    const x = i % w, y = Math.floor(i / w);
    cands.push({ x, y, s: score(x, y) });
  }
  if (cands.length < numPlayers * 10) return null;
  cands.sort((a, b) => b.s - a.s);
  const good = cands.slice(0, Math.ceil(cands.length * 0.5));
  const starts = [good[randInt(holder, Math.min(good.length, 8))]];
  while (starts.length < numPlayers) {
    let pickC = null, pickD = -1;
    for (const cnd of good) {
      const d = Math.min(...starts.map((s) => distance(s.x, s.y, cnd.x, cnd.y)));
      const v = d + cnd.s * 0.05;
      if (v > pickD) { pickD = v; pickC = cnd; }
    }
    starts.push(pickC);
  }
  let minD = Infinity;
  for (let a = 0; a < starts.length; a++)
    for (let b = a + 1; b < starts.length; b++)
      minD = Math.min(minD, distance(starts[a].x, starts[a].y, starts[b].x, starts[b].y));
  if (minD < 7) return null;
  return { tiles, starts: starts.map(({ x, y }) => ({ x, y })) };
}

export function generateMap(holder, w, h, numPlayers) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const res = tryGenerate(holder, w, h, numPlayers);
    if (res) return res;
  }
  throw new Error('Не удалось сгенерировать карту');
}
