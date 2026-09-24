// Hexaduck leaderboard API handlers.
//
//   POST /api/runs            { mode }               -> { runId }
//   POST /api/scores          { runId, name, time }  -> { rank, best, improved }
//   GET  /api/scores?mode=0                          -> { scores: [{ name, time }] }

export const MODES = 3;
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

function parseMode(v: unknown): number | null {
  const n = typeof v === 'string' && v !== '' ? Number(v) : v;
  return Number.isInteger(n) && (n as number) >= 0 && (n as number) < MODES ? (n as number) : null;
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
  const mode = parseMode(body?.mode);
  if (mode === null) return error(400, 'invalid mode');
  const now = Date.now();
  const runId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM runs WHERE started_at < ?').bind(now - RUN_TTL_MS),
    env.DB.prepare('INSERT INTO runs (id, mode, started_at) VALUES (?, ?, ?)').bind(runId, mode, now),
  ]);
  return json({ runId });
}

export async function submitScore(req: Request, env: Env): Promise<Response> {
  const body = await readJson(req);
  if (!body) return error(400, 'invalid body');
  const name = normaliseName(body.name);
  if (!name) return error(400, `name must be 1-${NAME_MAX} letters, digits, spaces or _.'-`);
  const time = body.time;
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return error(400, 'invalid time');
  const timeMs = Math.round(time * 1000);
  if (typeof body.runId !== 'string') return error(400, 'invalid runId');

  const now = Date.now();
  // Claim the run atomically so a run id can only ever be redeemed once.
  const run = await env.DB.prepare(
    'UPDATE runs SET used = 1 WHERE id = ? AND used = 0 AND started_at >= ? RETURNING mode, started_at',
  )
    .bind(body.runId, now - RUN_TTL_MS)
    .first<{ mode: number; started_at: number }>();
  if (!run) return error(409, 'unknown, expired or already used run');
  if (timeMs > now - run.started_at + CLOCK_SLACK_MS) return error(422, 'time is longer than the run');

  const [upsert, standing] = await env.DB.batch<Record<string, number>>([
    env.DB.prepare(
      `INSERT INTO scores (mode, name, time_ms, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (mode, name) DO UPDATE SET time_ms = excluded.time_ms, created_at = excluded.created_at, name = excluded.name
       WHERE excluded.time_ms > scores.time_ms
       RETURNING time_ms`,
    ).bind(run.mode, name, timeMs, now),
    env.DB.prepare(
      `SELECT me.time_ms AS best_ms, 1 + (SELECT COUNT(*) FROM scores o WHERE o.mode = me.mode AND o.time_ms > me.time_ms) AS rank
       FROM scores me WHERE me.mode = ?1 AND me.name = ?2`,
    ).bind(run.mode, name),
  ]);
  const { best_ms, rank } = standing.results[0];
  return json({ mode: run.mode, name, rank, best: best_ms / 1000, improved: upsert.results.length > 0 });
}

export async function listScores(url: URL, env: Env): Promise<Response> {
  const mode = parseMode(url.searchParams.get('mode'));
  if (mode === null) return error(400, 'invalid mode');
  const { results } = await env.DB.prepare(
    'SELECT name, time_ms FROM scores WHERE mode = ? ORDER BY time_ms DESC, created_at ASC LIMIT ?',
  )
    .bind(mode, LEADERBOARD_SIZE)
    .all<{ name: string; time_ms: number }>();
  return json({ mode, scores: results.map(r => ({ name: r.name, time: r.time_ms / 1000 })) });
}
