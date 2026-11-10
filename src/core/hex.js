// Гексы с острыми вершинами, координаты "odd-r": нечётные ряды сдвинуты вправо.
const EVEN = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const ODD = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];

export function neighbors(w, h, x, y) {
  const out = [];
  for (const [dx, dy] of (y & 1 ? ODD : EVEN)) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push([nx, ny]);
  }
  return out;
}

export function toAxial(x, y) {
  return [x - (y - (y & 1)) / 2, y];
}

export function distance(x1, y1, x2, y2) {
  const [q1, r1] = toAxial(x1, y1);
  const [q2, r2] = toAxial(x2, y2);
  const dq = q1 - q2, dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function tilesInRadius(w, h, x, y, r) {
  const out = [];
  for (let ny = Math.max(0, y - r); ny <= Math.min(h - 1, y + r); ny++) {
    for (let nx = Math.max(0, x - r - 1); nx <= Math.min(w - 1, x + r + 1); nx++) {
      if (distance(x, y, nx, ny) <= r) out.push([nx, ny]);
    }
  }
  return out;
}
