// Scope Creep scores. The game is single-player and runs in the browser, so rather than trust a
// posted score the server replays the whole run: the seed comes from a run id the server issued,
// and the rules engine is the same file the browser uses. If every action replays and the run
// has ended, the replayed score is what's recorded.
//
//   POST /api/scope-creep/finish { runId, name, actions } -> { score, parts, won, name, rank, best, improved }

// The engine is plain JavaScript, shared with the browser.
import { apply, IllegalAction, newRun, score, seedFrom } from '../public/scope-creep/engine.js';
import { GAMES } from './games';
import { error, normaliseName, recordScore } from './leaderboard';

export const GAME_ID = 'scopecreep';
export const MAX_ACTIONS = 20000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

export async function finishScopeCreep(req: Request, env: Env): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return error(400, 'invalid body'); }
  if (!body || typeof body !== 'object') return error(400, 'invalid body');
  const name = normaliseName(body.name);
  if (!name) return error(400, "name must be 1-16 letters, digits, spaces or _.'-");
  if (typeof body.runId !== 'string') return error(400, 'invalid runId');
  const actions = body.actions;
  if (!Array.isArray(actions) || actions.length > MAX_ACTIONS) return error(400, 'invalid actions');

  const ttl = GAMES[GAME_ID].runTtlMs!;
  const run = await env.DB.prepare('SELECT id FROM runs WHERE id = ? AND game = ? AND used = 0 AND started_at >= ?')
    .bind(body.runId, GAME_ID, Date.now() - ttl)
    .first();
  if (!run) return error(409, 'unknown, expired or already used run');

  const s = newRun(seedFrom(body.runId));
  try {
    for (const a of actions) {
      if (!a || typeof a !== 'object') throw new IllegalAction('not an action');
      apply(s, a);
    }
  } catch (e) {
    if (e instanceof IllegalAction) return error(422, "that run doesn't replay");
    throw e;
  }
  if (s.screen !== 'gameover' && s.screen !== 'victory') return error(422, "that run isn't over");

  // Only now claim the run, so a rejected post doesn't use it up.
  const claimed = await env.DB.prepare('UPDATE runs SET used = 1 WHERE id = ? AND used = 0 RETURNING id').bind(body.runId).first();
  if (!claimed) return error(409, 'unknown, expired or already used run');
  const result = score(s);
  const standing = await recordScore(env, GAME_ID, 0, name, result.total);
  return json({ score: result.total, parts: result.parts, won: result.won, name, ...standing });
}
