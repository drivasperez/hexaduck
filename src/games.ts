// Every game the leaderboard accepts scores for. Scores are stored as integers: the client
// sends a score in the game's own unit and the server multiplies it by `scale`.
//
// `maxPerSecond` bounds how fast a score can grow in real time. The server rejects any score
// above maxPerSecond * (seconds since the run started), which is the whole of the anti-cheat.
export interface Game {
  modes: number;
  scale: number;
  maxPerSecond: number;
}

export const GAMES: Record<string, Game> = {
  // Seconds survived, stored in milliseconds.
  hexaduck: { modes: 3, scale: 1000, maxPerSecond: 1 },
  // Metres run, stored in whole metres. The duck's top speed is 45 m/s.
  runoff: { modes: 1, scale: 1, maxPerSecond: 50 },
  // Metres flown, stored in whole metres. The duck's top speed is 80 m/s, during a tailwind.
  tailwind: { modes: 1, scale: 1, maxPerSecond: 85 },
};

export function getGame(id: unknown): [string, Game] | null {
  return typeof id === 'string' && Object.hasOwn(GAMES, id) ? [id, GAMES[id]] : null;
}
