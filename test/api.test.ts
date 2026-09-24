import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { GAMES } from '../src/games';
import { CLOCK_SLACK_MS, LEADERBOARD_SIZE, normaliseName, RUN_TTL_MS } from '../src/leaderboard';
import * as entry from '../src/index';

const BASE = 'https://arcade.test';

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM scores')]);
});

const post = (path: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function startRun(game = 'hexaduck', mode = 0): Promise<string> {
  const res = await post('/api/runs', { game, mode });
  expect(res.status).toBe(200);
  return ((await res.json()) as { runId: string }).runId;
}

// Inserts a run that began `ageMs` ago, so tests can claim big scores without waiting.
async function runStartedAgo(ageMs: number, game = 'hexaduck', mode = 0): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO runs (id, game, mode, started_at) VALUES (?, ?, ?, ?)')
    .bind(id, game, mode, Date.now() - ageMs)
    .run();
  return id;
}

// Posts a Hexaduck survival time from a run that has been going for long enough to allow it.
async function submit(name: string, time: number, mode = 0) {
  const runId = await runStartedAgo(time * 1000 + 100, 'hexaduck', mode);
  return post('/api/scores', { runId, name, score: time });
}

async function board(game = 'hexaduck', mode = 0) {
  const res = await SELF.fetch(`${BASE}/api/scores?game=${game}&mode=${mode}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { scores: { name: string; score: number }[] }).scores;
}

describe('normaliseName', () => {
  it('trims and collapses whitespace', () => {
    expect(normaliseName('  Mallard   Duck ')).toBe('Mallard Duck');
  });
  it('accepts unicode letters', () => {
    expect(normaliseName('Canard_Ç')).toBe('Canard_Ç');
  });
  it('rejects empty, overlong and markup names', () => {
    expect(normaliseName('   ')).toBeNull();
    expect(normaliseName('x'.repeat(17))).toBeNull();
    expect(normaliseName('<b>duck</b>')).toBeNull();
    expect(normaliseName(42)).toBeNull();
  });
});

describe('POST /api/runs', () => {
  it('rejects a bad game or mode', async () => {
    expect((await post('/api/runs', { game: 'pong', mode: 0 })).status).toBe(400);
    expect((await post('/api/runs', { mode: 0 })).status).toBe(400);
    expect((await post('/api/runs', { game: 'hexaduck', mode: 3 })).status).toBe(400);
    expect((await post('/api/runs', { game: 'hexaduck', mode: 1.5 })).status).toBe(400);
    expect((await post('/api/runs', { game: 'runoff', mode: 1 })).status).toBe(400);
    expect((await post('/api/runs', 'not json')).status).toBe(400);
  });

  it('rejects inherited object keys as game ids', async () => {
    expect((await post('/api/runs', { game: 'toString', mode: 0 })).status).toBe(400);
    expect((await post('/api/runs', { game: '__proto__', mode: 0 })).status).toBe(400);
  });

  it('prunes runs older than the TTL', async () => {
    const stale = await runStartedAgo(RUN_TTL_MS + 1000);
    await startRun();
    const row = await env.DB.prepare('SELECT id FROM runs WHERE id = ?').bind(stale).first();
    expect(row).toBeNull();
  });
});

describe('POST /api/scores', () => {
  it('records a score and reports its rank', async () => {
    const res = await submit('Mallard', 12.345);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ game: 'hexaduck', mode: 0, name: 'Mallard', rank: 1, best: 12.345, improved: true });
    expect(await board()).toEqual([{ name: 'Mallard', score: 12.345 }]);
  });

  it('accepts a short run submitted straight away', async () => {
    const runId = await startRun();
    const res = await post('/api/scores', { runId, name: 'Quick', score: 0.5 });
    expect(res.status).toBe(200);
  });

  it('refuses to redeem the same run twice', async () => {
    const runId = await runStartedAgo(10_000);
    expect((await post('/api/scores', { runId, name: 'Once', score: 5 })).status).toBe(200);
    expect((await post('/api/scores', { runId, name: 'Twice', score: 5 })).status).toBe(409);
  });

  it('refuses unknown and expired runs', async () => {
    expect((await post('/api/scores', { runId: 'nope', name: 'Duck', score: 1 })).status).toBe(409);
    const old = await runStartedAgo(RUN_TTL_MS + 1000);
    expect((await post('/api/scores', { runId: old, name: 'Duck', score: 1 })).status).toBe(409);
  });

  it('refuses a time longer than the run has existed', async () => {
    const runId = await runStartedAgo(10_000);
    const res = await post('/api/scores', { runId, name: 'Cheat', score: 10 + CLOCK_SLACK_MS / 1000 + 1 });
    expect(res.status).toBe(422);
    expect(await board()).toEqual([]);
  });

  it('validates name and score', async () => {
    const runId = await runStartedAgo(10_000);
    expect((await post('/api/scores', { runId, name: '', score: 1 })).status).toBe(400);
    expect((await post('/api/scores', { runId, name: 'Duck', score: -1 })).status).toBe(400);
    expect((await post('/api/scores', { runId, name: 'Duck', score: 'fast' })).status).toBe(400);
    // None of those should have burned the run.
    expect((await post('/api/scores', { runId, name: 'Duck', score: 1 })).status).toBe(200);
  });

  it('keeps only the best score per name, case-insensitively', async () => {
    await submit('Mallard', 20);
    const worse = await (await submit('mallard', 15)).json();
    expect(worse).toMatchObject({ improved: false, best: 20, rank: 1 });
    const better = await (await submit('MALLARD', 30)).json();
    expect(better).toMatchObject({ improved: true, best: 30 });
    expect(await board()).toEqual([{ name: 'MALLARD', score: 30 }]);
  });

  it('ranks against other players and keeps modes separate', async () => {
    await submit('Teal', 40);
    await submit('Eider', 25);
    await submit('Scoter', 99, 2);
    const res = await (await submit('Wigeon', 30)).json();
    expect(res).toMatchObject({ rank: 2 });
    expect((await board()).map(s => s.name)).toEqual(['Teal', 'Wigeon', 'Eider']);
    expect(await board('hexaduck', 2)).toEqual([{ name: 'Scoter', score: 99 }]);
    expect(await board('hexaduck', 1)).toEqual([]);
  });
});

describe('Runoff scores', () => {
  const { maxPerSecond } = GAMES.runoff;

  it('stores whole metres on their own board', async () => {
    const runId = await runStartedAgo(60_000, 'runoff');
    const res = await post('/api/scores', { runId, name: 'Mallard', score: 1234.4 });
    expect(await res.json()).toMatchObject({ game: 'runoff', rank: 1, best: 1234 });
    expect(await board('runoff')).toEqual([{ name: 'Mallard', score: 1234 }]);
    expect(await board('hexaduck')).toEqual([]);
  });

  it('allows up to the top speed for the time elapsed', async () => {
    const runId = await runStartedAgo(20_000, 'runoff');
    expect((await post('/api/scores', { runId, name: 'Fast', score: maxPerSecond * 20 })).status).toBe(200);
  });

  it('refuses a distance faster than the duck can run', async () => {
    const runId = await runStartedAgo(20_000, 'runoff');
    const tooFar = maxPerSecond * (20 + CLOCK_SLACK_MS / 1000) + 10;
    expect((await post('/api/scores', { runId, name: 'Cheat', score: tooFar })).status).toBe(422);
  });

  it('does not let the same name clash across games', async () => {
    await submit('Mallard', 10);
    const runId = await runStartedAgo(60_000, 'runoff');
    await post('/api/scores', { runId, name: 'Mallard', score: 500 });
    expect(await board('hexaduck')).toEqual([{ name: 'Mallard', score: 10 }]);
    expect(await board('runoff')).toEqual([{ name: 'Mallard', score: 500 }]);
  });
});

describe('Tailwind scores', () => {
  it('accepts a flight at top speed and refuses one faster', async () => {
    const { maxPerSecond } = GAMES.tailwind;
    const ok = await runStartedAgo(30_000, 'tailwind');
    expect((await post('/api/scores', { runId: ok, name: 'Swift', score: maxPerSecond * 30 })).status).toBe(200);
    const cheat = await runStartedAgo(30_000, 'tailwind');
    const tooFar = maxPerSecond * (30 + CLOCK_SLACK_MS / 1000) + 10;
    expect((await post('/api/scores', { runId: cheat, name: 'Cheat', score: tooFar })).status).toBe(422);
    expect(await board('tailwind')).toEqual([{ name: 'Swift', score: maxPerSecond * 30 }]);
  });
});

describe('GET /api/scores', () => {
  it(`returns at most ${LEADERBOARD_SIZE} rows, best first`, async () => {
    for (let i = 1; i <= LEADERBOARD_SIZE + 3; i++) await submit(`Duck ${i}`, i);
    const scores = await board();
    expect(scores).toHaveLength(LEADERBOARD_SIZE);
    expect(scores[0]).toEqual({ name: `Duck ${LEADERBOARD_SIZE + 3}`, score: LEADERBOARD_SIZE + 3 });
  });

  it('rejects a bad game or mode', async () => {
    expect((await SELF.fetch(`${BASE}/api/scores?game=hexaduck&mode=7`)).status).toBe(400);
    expect((await SELF.fetch(`${BASE}/api/scores?game=hexaduck`)).status).toBe(400);
    expect((await SELF.fetch(`${BASE}/api/scores?mode=0`)).status).toBe(400);
  });

  it('404s unknown API routes', async () => {
    expect((await SELF.fetch(`${BASE}/api/nope`)).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/api/scores`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('entry module', () => {
  // Regression: workerd refuses to start if the entry module has non-handler named exports.
  it('only has a default export', () => {
    expect(Object.keys(entry)).toEqual(['default']);
  });
});
