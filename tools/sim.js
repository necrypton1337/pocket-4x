// Прогон партий ИИ против ИИ: node tools/sim.js [партий] [соперников] [макс. ходов]
import { createGame, playerStats, majors } from '../src/core/game.js';
import { endTurn } from '../src/core/turn.js';
const games = +process.argv[2] || 3, opp = +process.argv[3] || 3, maxT = +process.argv[4] || 400;
const wins = {};
for (let g = 0; g < games; g++) {
  const s = createGame({ seed: 1000 + g, opponents: opp, allAI: true });
  const t0 = Date.now();
  while (!s.over && s.turn < maxT) endTurn(s);
  const w = s.winner != null ? s.players[s.winner].faction : 'нет';
  wins[w] = (wins[w] || 0) + 1;
  console.log(`game ${g}: turn ${s.turn}, winner ${w}, ${((Date.now() - t0) / s.turn).toFixed(1)}ms/turn |`,
    majors(s).map((p) => `${p.faction}:${p.alive ? JSON.stringify(playerStats(s, p.id)) : 'X'}`).join(' '));
}
console.log('wins', wins);
