import { env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { apply, IllegalAction, newRun, score, seedFrom } from '../public/audit/engine.js';
import { clerk, mulberry, playRun } from './audit/players.js';

const BASE = 'https://arcade.test';
const post = (path: string, body: unknown) =>
  SELF.fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM runs'), env.DB.prepare('DELETE FROM scores')]);
});

async function newRunId(game = 'audit'): Promise<string> {
  const res = await post('/api/runs', { game, mode: 0 });
  expect(res.status).toBe(200);
  return ((await res.json()) as { runId: string }).runId;
}
const playFor = (runId: string) => playRun(seedFrom(runId), clerk(1, { accuracy: 0.95 }));

describe('POST /api/audit/finish', () => {
  it('replays a finished run and records its score and ending', async () => {
    const runId = await newRunId();
    const { s, actions } = playFor(runId);
    const res = await post('/api/audit/finish', { runId, name: 'Heron', actions });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ score: score(s).total, ending: s.ending, name: 'Heron', rank: 1, improved: true });
    const row = await env.DB.prepare("SELECT name, score FROM scores WHERE game = 'audit'").first();
    expect(row).toEqual({ name: 'Heron', score: score(s).total });
  });

  it("rejects a run that doesn't replay, without using up the run", async () => {
    const runId = await newRunId();
    const { actions } = playFor(runId);
    // Someone claims to have stamped a claim before calling anyone to the window.
    const tampered = [...actions.slice(0, 2), { type: 'stamp', verdict: 'approve' }, ...actions.slice(2)];
    const bad = await post('/api/audit/finish', { runId, name: 'Cheat', actions: tampered });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toEqual({ error: "that run doesn't replay" });
    expect((await post('/api/audit/finish', { runId, name: 'Honest', actions })).status).toBe(200);
  });

  it("rejects a run that isn't over", async () => {
    const runId = await newRunId();
    const { actions } = playFor(runId);
    const res = await post('/api/audit/finish', { runId, name: 'Early', actions: actions.slice(0, 30) });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "that run isn't over" });
  });

  it("won't take another game's run id", async () => {
    const runId = await newRunId('scopecreep');
    const { actions } = playFor(runId);
    expect((await post('/api/audit/finish', { runId, name: 'Mixup', actions })).status).toBe(409);
  });

  it('only records a run once, and refuses a posted score', async () => {
    const runId = await newRunId();
    expect((await post('/api/scores', { runId, name: 'Shortcut', score: 9999 })).status).toBe(400);
    const { actions } = playFor(runId);
    expect((await post('/api/audit/finish', { runId, name: 'Once', actions })).status).toBe(200);
    expect((await post('/api/audit/finish', { runId, name: 'Twice', actions })).status).toBe(409);
  });
});

// Anything a client posts must either replay or be refused as an IllegalAction; a crash would
// be a 500 from the server.
describe('Audit, Please with malformed actions', () => {
  it('refuses nonsense as illegal rather than crashing', () => {
    const { actions } = playRun(7, clerk(7));
    const junk = [null, 'x', 3, [], true, { type: 'constructor' }, { type: '__proto__' }, { type: 'inspect', a: '__proto__.x', b: 'rule.year' },
      { type: 'inspect', a: 'toString', b: 'rule.year' }, { type: 'choose', index: 'length' }, { type: 'choose', index: -1 },
      { type: 'sleep', food: 'yes', heat: 'please', medicine: {} }, { type: 'stamp', verdict: 'toString' }, { type: 'bribe', take: 'maybe' }];
    const rand = mulberry(99);
    for (let trial = 0; trial < 300; trial++) {
      const s = newRun(7);
      const at = Math.floor(rand() * actions.length);
      for (const a of actions.slice(0, at)) apply(s, a);
      const bad = junk[Math.floor(rand() * junk.length)];
      try { apply(s, bad); } catch (e) { expect(e, JSON.stringify(bad)).toBeInstanceOf(IllegalAction); }
    }
  });
});
