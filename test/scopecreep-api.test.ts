import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { newRun, score, seedFrom } from '../public/scope-creep/engine.js';
import { playRun, randomPlayer } from './scope-creep/players.js';

const BASE = 'https://arcade.test';
const post = (path: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM scores')]);
});

async function newRunId(): Promise<string> {
  const res = await post('/api/runs', { game: 'scopecreep', mode: 0 });
  expect(res.status).toBe(200);
  return ((await res.json()) as { runId: string }).runId;
}

// Plays a whole (random) run on the seed the server's run id implies.
function playFor(runId: string, seed = 1) {
  return playRun(seedFrom(runId), randomPlayer(seed));
}

describe('POST /api/scope-creep/finish', () => {
  it('replays a finished run and records its score', async () => {
    const runId = await newRunId();
    const { s, actions } = playFor(runId);
    const res = await post('/api/scope-creep/finish', { runId, name: 'Mallard', actions });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ score: score(s).total, name: 'Mallard', rank: 1, improved: true });
    const row = await env.DB.prepare("SELECT name, score FROM scores WHERE game = 'scopecreep'").first();
    expect(row).toEqual({ name: 'Mallard', score: score(s).total });
  });

  it("rejects a run that doesn't replay, without using up the run", async () => {
    const runId = await newRunId();
    const { actions } = playFor(runId);
    // Someone claims to have played cards they couldn't have.
    const tampered = [...actions.slice(0, 5), { type: 'play', index: 0, target: 0 }, ...actions.slice(5)];
    const bad = await post('/api/scope-creep/finish', { runId, name: 'Cheat', actions: tampered });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: "that run doesn't replay" });
    expect((await post('/api/scope-creep/finish', { runId, name: 'Honest', actions })).status).toBe(200);
  });

  it("rejects a run played on a different seed", async () => {
    const runId = await newRunId();
    const { actions } = playRun(12345, randomPlayer(1));
    const res = await post('/api/scope-creep/finish', { runId, name: 'Seedy', actions });
    expect(res.status).toBe(422);
  });

  it("rejects a run that isn't over", async () => {
    const runId = await newRunId();
    const { actions } = playFor(runId);
    const res = await post('/api/scope-creep/finish', { runId, name: 'Early', actions: actions.slice(0, 20) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "that run isn't over" });
  });

  it('only records a run once', async () => {
    const runId = await newRunId();
    const { actions } = playFor(runId);
    expect((await post('/api/scope-creep/finish', { runId, name: 'Once', actions })).status).toBe(200);
    expect((await post('/api/scope-creep/finish', { runId, name: 'Twice', actions })).status).toBe(409);
  });

  it('validates the body', async () => {
    const runId = await newRunId();
    expect((await post('/api/scope-creep/finish', { runId, name: '', actions: [] })).status).toBe(400);
    expect((await post('/api/scope-creep/finish', { runId, name: 'Duck', actions: 'lots' })).status).toBe(400);
    expect((await post('/api/scope-creep/finish', { runId: 42, name: 'Duck', actions: [] })).status).toBe(400);
    expect((await post('/api/scope-creep/finish', { runId, name: 'Duck', actions: [null] })).status).toBe(422);
  });

  it('keeps Scope Creep run ids for a fortnight, while other games expire after an hour', async () => {
    const day = 24 * 60 * 60 * 1000;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO runs (id, game, mode, started_at) VALUES ('old-hexaduck', 'hexaduck', 0, ?)").bind(Date.now() - 2 * 60 * 60 * 1000),
      env.DB.prepare("INSERT INTO runs (id, game, mode, started_at) VALUES ('week-old-scope', 'scopecreep', 0, ?)").bind(Date.now() - 7 * day),
      env.DB.prepare("INSERT INTO runs (id, game, mode, started_at) VALUES ('ancient-scope', 'scopecreep', 0, ?)").bind(Date.now() - 15 * day),
    ]);
    await newRunId();  // starting any run prunes expired ones
    const ids = (await env.DB.prepare('SELECT id FROM runs ORDER BY id').all<{ id: string }>()).results.map(r => r.id);
    expect(ids).toContain('week-old-scope');
    expect(ids).not.toContain('old-hexaduck');
    expect(ids).not.toContain('ancient-scope');
  });
});

describe('POST /api/scores for Scope Creep', () => {
  it('refuses a posted score, and leaves the run usable', async () => {
    const runId = await newRunId();
    const res = await post('/api/scores', { runId, name: 'Shortcut', score: 9999 });
    expect(res.status).toBe(400);
    const { actions } = playFor(runId);
    expect((await post('/api/scope-creep/finish', { runId, name: 'Proper', actions })).status).toBe(200);
  });

  it('derives the same seed from a run id as the browser does', () => {
    expect(newRun(seedFrom('abc')).seed).toBe(seedFrom('abc'));
    expect(seedFrom('abc')).not.toBe(seedFrom('abd'));
  });
});
