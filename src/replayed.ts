// Scores for single-player games that run in the browser (Scope Creep, Audit, Please). Rather
// than trust a posted score, the server replays the whole run: the seed comes from a run id the
// server issued, and the rules engine is the same file the browser uses. If every action
// replays and the run has ended, the replayed score is what's recorded.
//
//   POST /api/scope-creep/finish { runId, name, actions }
//   POST /api/audit/finish       { runId, name, actions }
//     -> { score, parts, name, rank, best, improved, ...details }

// The engines are plain JavaScript, shared with the browser.
import * as audit from '../public/audit/engine.js';
import * as scope from '../public/scope-creep/engine.js';
import { GAMES } from './games';
import { error, normaliseName, recordScore } from './leaderboard';

export const MAX_ACTIONS = 20000;

// What the server needs from each game's engine.
interface Engine {
  newRun(seed: number): any;
  apply(s: any, a: any): any;
  IllegalAction: new (...args: any[]) => Error;
  seedFrom(text: string): number;
  finished(s: any): boolean;
  result(s: any): { score: number; parts: Record<string, number>; details: Record<string, unknown> };
}

export const ENGINES: Record<string, Engine> = {
  scopecreep: {
    ...scope,
    finished: s => s.screen === 'gameover' || s.screen === 'victory',
    result: s => { const r = scope.score(s); return { score: r.total, parts: r.parts, details: { won: r.won } }; },
  },
  audit: {
    ...audit,
    finished: audit.finished,
    result: s => { const r = audit.score(s); return { score: r.total, parts: r.parts, details: { ending: r.ending } }; },
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export async function finishReplayed(req: Request, env: Env, gameId: string): Promise<Response> {
  const engine = ENGINES[gameId];
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return error(400, 'invalid body'); }
  if (!body || typeof body !== 'object') return error(400, 'invalid body');
  const name = normaliseName(body.name);
  if (!name) return error(400, "name must be 1-16 letters, digits, spaces or _.'-");
  if (typeof body.runId !== 'string') return error(400, 'invalid runId');
  const actions = body.actions;
  if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) return error(400, 'invalid actions');

  const ttl = GAMES[gameId].runTtlMs!;
  const run = await env.DB.prepare('SELECT id FROM runs WHERE id = ? AND game = ? AND used = 0 AND started_at >= ?')
    .bind(body.runId, gameId, Date.now() - ttl)
    .first();
  if (!run) return error(409, 'unknown, expired or already used run');

  const s = engine.newRun(engine.seedFrom(body.runId));
  try {
    for (const a of actions) {
      if (!a || typeof a !== 'object') throw new engine.IllegalAction('not an action');
      engine.apply(s, a);
    }
  } catch (e) {
    if (e instanceof engine.IllegalAction) return error(422, "that run doesn't replay");
    throw e;
  }
  if (!engine.finished(s)) return error(422, "that run isn't over");

  // Only now claim the run, so a rejected post doesn't use it up.
  const claimed = await env.DB.prepare('UPDATE runs SET used = 1 WHERE id = ? AND used = 0 RETURNING id').bind(body.runId).first();
  if (!claimed) return error(409, 'unknown, expired or already used run');
  const { score, parts, details } = engine.result(s);
  const standing = await recordScore(env, gameId, 0, name, score);
  return json({ score, parts, ...details, name, ...standing });
}
