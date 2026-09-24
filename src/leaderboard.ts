// Leaderboard API handlers, shared by every game in src/games.ts.
//
//   POST /api/runs                     { game, mode }          -> { runId }
//   POST /api/scores                   { runId, name, score }  -> { game, mode, name, rank, best, improved }
//   GET  /api/scores?game=hexaduck&mode=0                      -> { game, mode, scores: [{ name, score }] }
//
// Scores in requests and responses are in the game's own unit (seconds, metres, ...).

import { type Game, getGame } from './games';

export const LEADERBOARD_SIZE = 10;
export const NAME_MAX = 16;
// A run's id stays redeemable for this long after the game starts.
export const RUN_TTL_MS = 60 * 60 * 1000;
// Allowance for the latency between the client starting its clock and the server recording the run.
export const CLOCK_SLACK_MS = 2000;

const NAME_RE = new RegExp(`^[\\p{L}\\p{N} _.'-]{1,${NAME_MAX}}$`, 'u');

export function normaliseName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  return NAME_RE.test(name) ? name : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export const error = (status: number, message: string) => json({ error: message }, status);

function parseMode(game: Game, v: unknown): number | null {
  const n = typeof v === 'string' && v !== '' ? Number(v) : v;
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) < game.modes ? (n as number) : null;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function startRun(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  const found = getGame(body?.game);
  if (!found) return error(400, 'unknown game');
  const [gameId, game] = found;
  const mode = parseMode(game, body?.mode);
  if (mode === null) return error(400, 'invalid mode');
  const now = Date.now();
  const runId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM runs WHERE started_at < ?').bind(now - RUN_TTL_MS),
    env.DB.prepare('INSERT INTO runs (id, game, mode, started_at) VALUES (?, ?, ?, ?)').bind(runId, gameId, mode, now),
  ]);
  return json({ runId });
}

export async function submitScore(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (!body) return error(400, 'invalid body');
  const name = normaliseName(body.name);
  if (!name) return error(400, `name must be 1-${NAME_MAX} letters, digits, spaces or _.'-`);
  const score = body.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return error(400, 'invalid score');
  if (typeof body.runId !== 'string') return error(400, 'invalid runId');

  const now = Date.now();
  // Claim the run atomically so a run id can only ever be redeemed once.
  const run = await env.DB.prepare(
    'UPDATE runs SET used = 1 WHERE id = ? AND used = 0 AND started_at >= ? RETURNING game, mode, started_at',
  )
    .bind(body.runId, now - RUN_TTL_MS)
    .first<{ game: string; mode: number; started_at: number }>();
  if (!run) return error(409, 'unknown, expired or already used run');
  const found = getGame(run.game);
  if (!found) return error(409, 'unknown game');
  const [, game] = found;
  const elapsedSeconds = (now - run.started_at + CLOCK_SLACK_MS) / 1000;
  if (score > game.maxPerSecond * elapsedSeconds) return error(422, 'score is higher than the run allows');
  const stored = Math.round(score * game.scale);

  const [upsert, standing] = await env.DB.batch<Record<string, number>>([
    env.DB.prepare(
      `INSERT INTO scores (game, mode, name, score, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (game, mode, name) DO UPDATE SET score = excluded.score, created_at = excluded.created_at, name = excluded.name
       WHERE excluded.score > scores.score
       RETURNING score`,
    ).bind(run.game, run.mode, name, stored, now),
    env.DB.prepare(
      `SELECT me.score AS best, 1 + (SELECT COUNT(*) FROM scores o WHERE o.game = me.game AND o.mode = me.mode AND o.score > me.score) AS rank
       FROM scores me WHERE me.game = ?1 AND me.mode = ?2 AND me.name = ?3`,
    ).bind(run.game, run.mode, name),
  ]);
  const { best, rank } = standing.results[0];
  return json({
    game: run.game,
    mode: run.mode,
    name,
    rank,
    best: best / game.scale,
    improved: upsert.results.length > 0,
  });
}

export async function listScores(url: URL, env: Env): Promise<Response> {
  const found = getGame(url.searchParams.get('game'));
  if (!found) return error(400, 'unknown game');
  const [gameId, game] = found;
  const mode = parseMode(game, url.searchParams.get('mode'));
  if (mode === null) return error(400, 'invalid mode');
  const { results } = await env.DB.prepare(
    'SELECT name, score FROM scores WHERE game = ? AND mode = ? ORDER BY score DESC, created_at ASC LIMIT ?',
  )
    .bind(gameId, mode, LEADERBOARD_SIZE)
    .all<{ name: string; score: number }>();
  return json({ game: gameId, mode, scores: results.map(r => ({ name: r.name, score: r.score / game.scale })) });
}
