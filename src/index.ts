// Entry point. Static assets are served by the asset store; only /api/* reaches here.
// Workers only allow handlers and Durable Object classes as named exports from this module,
// so the rest of the logic lives in ./leaderboard and ./flock.
import { error, listScores, startRun, submitScore } from './leaderboard';

export { Pond } from './flock/pond';

const ROOM_RE = /^[a-z0-9-]{1,32}$/;

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    const route = `${req.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'POST /api/runs':
          return await startRun(req, env);
        case 'POST /api/scores':
          return await submitScore(req, env);
        case 'GET /api/scores':
          return await listScores(url, env);
        case 'GET /api/flock': {
          // Each room name is its own pond, run by its own Durable Object.
          const room = url.searchParams.get('room') ?? 'pond-1';
          if (!ROOM_RE.test(room)) return error(400, 'invalid room');
          if (req.headers.get('Upgrade') !== 'websocket') return error(426, 'expected a websocket');
          return env.POND.get(env.POND.idFromName(room)).fetch(req);
        }
      }
      if (url.pathname.startsWith('/api/')) return error(404, 'not found');
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return error(500, 'internal error');
    }
  },
} satisfies ExportedHandler<Env>;
