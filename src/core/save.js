// Сохранение партии в строку и обратно.
import { SAVE_VERSION } from './game.js';

export function serialize(s) {
  const { _fx, ...rest } = s;
  const copy = { ...rest, players: s.players.map((p) => ({ ...p, explored: p.explored.join('') })) };
  return JSON.stringify(copy);
}

export function deserialize(text) {
  const s = JSON.parse(text);
  if (!s || s.version !== SAVE_VERSION) throw new Error('Несовместимое сохранение');
  for (const p of s.players) p.explored = Array.from(p.explored, (ch) => (ch === '1' ? 1 : 0));
  return s;
}
