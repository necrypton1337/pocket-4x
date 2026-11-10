// Рисует простые PNG-иконки (гекс на тёмном фоне) без сторонних библиотек.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function insideHex(px, py, cx, cy, r) {
  const dx = Math.abs(px - cx), dy = Math.abs(py - cy);
  return dy <= r && dx <= r * Math.sqrt(3) / 2 && dx * 0.5 + dy * (Math.sqrt(3) / 2) * (Math.sqrt(3) / 2) * 1.1547 <= r * Math.sqrt(3) / 2;
}
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const c = size / 2;
  const hexes = [[0, 0, '#facc15'], [-0.29, -0.17, '#6faa4a'], [0.29, -0.17, '#3b82f6'], [0, 0.33, '#e04848']];
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let col = [11, 15, 20];
      for (const [ox, oy, hex] of hexes.slice(1).concat([hexes[0]])) {
        const r = hexes[0] === undefined ? 0 : (hex === '#facc15' ? 0.16 : 0.17) * size;
        if (insideHex(x, y, c + ox * size, c + oy * size, r)) {
          col = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
        }
      }
      raw.set(col, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const n of [192, 512]) writeFileSync(new URL(`../icons/icon-${n}.png`, import.meta.url), png(n));
console.log('icons ok');
