import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLOCK_SLACK_MS, LEADERBOARD_SIZE, normaliseName, RUN_TTL_MS } from '../src/leaderboard';
import * as entry from '../src/index';

const BASE = 'https://hexaduck.test';

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM scores')]);
});

const post = (path: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

async function startRun(mode = 0): Promise<string> {
  const res = await post('/api/runs', { mode });
  expect(res.status).toBe(200);
  return ((await res.json()) as { runId: string }).runId;
}

// Inserts a run that began `ageMs` ago, so tests can claim long times without waiting.
async function runStartedAgo(ageMs: number, mode = 0): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO runs (id, mode, started_at) VALUES (?, ?, ?)')
    .bind(id, mode, Date.now() - ageMs)
    .run();
  return id;
}

async function submit(name: string, time: number, mode = 0) {
  const runId = await runStartedAgo(time * 1000 + 100, mode);
  return post('/api/scores', { runId, name, time });
}

async function board(mode = 0) {
  const res = await SELF.fetch(`${BASE}/api/scores?mode=${mode}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { scores: { name: string; time: number }[] }).scores;
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
  it('rejects a bad mode', async () => {
    expect((await post('/api/runs', { mode: 3 })).status).toBe(400);
    expect((await post('/api/runs', { mode: 1.5 })).status).toBe(400);
    expect((await post('/api/runs', 'not json')).status).toBe(400);
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
    expect(await res.json()).toEqual({ mode: 0, name: 'Mallard', rank: 1, best: 12.345, improved: true });
    expect(await board()).toEqual([{ name: 'Mallard', time: 12.345 }]);
  });

  it('accepts a short run submitted straight away', async () => {
    const runId = await startRun();
    const res = await post('/api/scores', { runId, name: 'Quick', time: 0.5 });
    expect(res.status).toBe(200);
  });

  it('refuses to redeem the same run twice', async () => {
    const runId = await runStartedAgo(10_000);
    expect((await post('/api/scores', { runId, name: 'Once', time: 5 })).status).toBe(200);
    expect((await post('/api/scores', { runId, name: 'Twice', time: 5 })).status).toBe(409);
  });

  it('refuses unknown and expired runs', async () => {
    expect((await post('/api/scores', { runId: 'nope', name: 'Duck', time: 1 })).status).toBe(409);
    const old = await runStartedAgo(RUN_TTL_MS + 1000);
    expect((await post('/api/scores', { runId: old, name: 'Duck', time: 1 })).status).toBe(409);
  });

  it('refuses a time longer than the run has existed', async () => {
    const runId = await runStartedAgo(10_000);
    const res = await post('/api/scores', { runId, name: 'Cheat', time: 10 + CLOCK_SLACK_MS / 1000 + 1 });
    expect(res.status).toBe(422);
    expect(await board()).toEqual([]);
  });

  it('validates name and time', async () => {
    const runId = await runStartedAgo(10_000);
    expect((await post('/api/scores', { runId, name: '', time: 1 })).status).toBe(400);
    expect((await post('/api/scores', { runId, name: 'Duck', time: -1 })).status).toBe(400);
    expect((await post('/api/scores', { runId, name: 'Duck', time: 'fast' })).status).toBe(400);
    // None of those should have burned the run.
    expect((await post('/api/scores', { runId, name: 'Duck', time: 1 })).status).toBe(200);
  });

  it('keeps only the best time per name, case-insensitively', async () => {
    await submit('Mallard', 20);
    const worse = await (await submit('mallard', 15)).json();
    expect(worse).toMatchObject({ improved: false, best: 20, rank: 1 });
    const better = await (await submit('MALLARD', 30)).json();
    expect(better).toMatchObject({ improved: true, best: 30 });
    expect(await board()).toEqual([{ name: 'MALLARD', time: 30 }]);
  });

  it('ranks against other players and keeps scopes separate', async () => {
    await submit('Teal', 40);
    await submit('Eider', 25);
    await submit('Scoter', 99, 2);
    const res = await (await submit('Wigeon', 30)).json();
    expect(res).toMatchObject({ rank: 2 });
    expect((await board()).map(s => s.name)).toEqual(['Teal', 'Wigeon', 'Eider']);
    expect(await board(2)).toEqual([{ name: 'Scoter', time: 99 }]);
    expect(await board(1)).toEqual([]);
  });
});

describe('GET /api/scores', () => {
  it(`returns at most ${LEADERBOARD_SIZE} rows, best first`, async () => {
    for (let i = 1; i <= LEADERBOARD_SIZE + 3; i++) await submit(`Duck ${i}`, i);
    const scores = await board();
    expect(scores).toHaveLength(LEADERBOARD_SIZE);
    expect(scores[0]).toEqual({ name: `Duck ${LEADERBOARD_SIZE + 3}`, time: LEADERBOARD_SIZE + 3 });
  });

  it('rejects a bad mode', async () => {
    expect((await SELF.fetch(`${BASE}/api/scores?mode=7`)).status).toBe(400);
    expect((await SELF.fetch(`${BASE}/api/scores`)).status).toBe(400);
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
