// Смена хода: игрок закончил → ходят ИИ, поселения и фауна → общий тик мира → новый ход игрока.
import { beginPlayerTurn, finishPlayerTurn, humanPlayer, playerUnits, worldTick } from './game.js';
import { runAI, runWorker, runMinor, runFauna } from './ai.js';

// Инженеры игрока на автомате сами выбирают, что строить.
export function runAutoWorkers(s, pid) {
  for (const u of playerUnits(s, pid)) {
    if (u.auto && u.type === 'worker' && s.units[u.id] && u.moves > 0) runWorker(s, pid, u);
  }
}

export function endTurn(s) {
  if (s.over) return [];
  const before = s.eventSeq || 0;
  const h = humanPlayer(s);
  if (h && h.alive) finishPlayerTurn(s, h.id);
  for (const p of s.players) {
    if (p.human || !p.alive || s.over) continue;
    beginPlayerTurn(s, p.id);
    if (p.kind === 'major') runAI(s, p.id);
    else if (p.kind === 'minor') runMinor(s, p.id);
    else runFauna(s, p.id);
    finishPlayerTurn(s, p.id);
  }
  if (!s.over) worldTick(s);
  s.turn++;
  if (h && h.alive && !s.over) {
    beginPlayerTurn(s, h.id);
    runAutoWorkers(s, h.id);
  }
  return s.events.filter((e) => e.seq > before);
}
