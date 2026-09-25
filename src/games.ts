// Every game the leaderboard accepts scores for. Scores are stored as integers: the client
// sends a score in the game's own unit and the server multiplies it by `scale`.
//
// `maxPerSecond` bounds how fast a score can grow in real time. The server rejects any score
// above maxPerSecond * (seconds since the run started), which is the whole of the anti-cheat.
export interface Game {
  modes: number;
  scale: number;
  maxPerSecond: number;
  // Scores are recorded by the server itself (see src/flock/pond.ts), so clients can't post them.
  serverOnly?: boolean;
  // Scores are checked by replaying the run (see src/replayed.ts), not posted directly.
  replayed?: boolean;
  // How long a run id stays redeemable, if not the default hour.
  runTtlMs?: number;
}

export const GAMES: Record<string, Game> = {
  // Seconds survived, stored in milliseconds.
  hexaduck: { modes: 3, scale: 1000, maxPerSecond: 1 },
  // Metres run, stored in whole metres. The duck's top speed is 45 m/s.
  runoff: { modes: 1, scale: 1, maxPerSecond: 50 },
  // Metres flown, stored in whole metres. The duck's top speed is 80 m/s, during a tailwind.
  tailwind: { modes: 1, scale: 1, maxPerSecond: 85 },
  // Most ducklings in a line at once. The pond's Durable Object runs the game and records these.
  flock: { modes: 1, scale: 1, maxPerSecond: 0, serverOnly: true },
  // Biggest a player's drop grew, in its mass units (shown as ml). Recorded by the basin.
  confluence: { modes: 1, scale: 1, maxPerSecond: 0, serverOnly: true },
  // A run's score, worked out by replaying it. Runs can be long and resumed, so ids last a fortnight.
  scopecreep: { modes: 1, scale: 1, maxPerSecond: 0, replayed: true, runTtlMs: 14 * 24 * 60 * 60 * 1000 },
  // Audit, Please: savings plus correct calls and the ending, worked out by replaying the run.
  audit: { modes: 1, scale: 1, maxPerSecond: 0, replayed: true, runTtlMs: 14 * 24 * 60 * 60 * 1000 },
};

export function getGame(id: unknown): [string, Game] | null {
  return typeof id === 'string' && Object.hasOwn(GAMES, id) ? [id, GAMES[id]] : null;
}
