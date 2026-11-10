import { spawnUnit } from '../src/core/game.js';

// Маленькая карта вручную: все клетки — луга, кроме перечисленных. Два игрока-фракции.
export function makeState(w = 10, h = 8, terrain = {}, factions = [null, null]) {
  const tiles = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    tiles.push({ t: terrain[`${x},${y}`] || 'grass', imp: null, owner: -1, city: -1 });
  }
  const s = {
    version: 2, seed: 1, rng: 12345, turn: 1, width: w, height: h, tiles, players: [], units: {}, cities: {},
    nextId: 1, difficulty: 'normal', over: false, winner: null, result: null, events: [], usedNames: [], nests: {},
  };
  for (let i = 0; i < 2; i++) addPlayer(s, { kind: 'major', faction: factions[i], name: i ? 'Красные' : 'Синие', human: i === 0 });
  return s;
}

export function addPlayer(s, props) {
  const p = {
    id: s.players.length, kind: 'major', faction: null, name: 'Игрок', color: '#000', human: false, alive: true, techs: [],
    research: null, sci: 0, gold: 0, explored: new Array(s.width * s.height).fill(0), everHadCity: false, mult: 1, ai: {},
    ...props,
  };
  if (p.kind === 'minor') Object.assign(p, { influence: {}, hostile: [], ally: null, lastMerc: 0, minorType: p.minorType || 'traders' });
  s.players.push(p);
  return p;
}

export function unit(s, type, owner, x, y) {
  return spawnUnit(s, type, owner, x, y);
}
