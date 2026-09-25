// Entry point. Static assets are served by the asset store; only /api/* reaches here.
// Workers only allow handlers and Durable Object classes as named exports from this module,
// so the rest of the logic lives in ./leaderboard, ./flock and ./confluence.
import { error, listScores, startRun, submitScore } from './leaderboard';
import { finishScopeCreep } from './scopecreep';

export { Basin } from './confluence/basin';
export { Pond } from './flock/pond';

const ROOM_RE = /^[a-z0-9-]{1,32}$/;

// Each room name is its own Durable Object, which runs that room's game.
function joinRoom(req: Request, url: URL, rooms: DurableObjectNamespace): Promise<Response> | Response {
  const room = url.searchParams.get('room') ?? 'pond-1';
  if (!ROOM_RE.test(room)) return error(400, 'invalid room');
  if (req.headers.get('Upgrade') !== 'websocket') return error(426, 'expected a websocket');
  return rooms.get(rooms.idFromName(room)).fetch(req);
}

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
        case 'POST /api/scope-creep/finish':
          return await finishScopeCreep(req, env);
        case 'GET /api/flock':
          return joinRoom(req, url, env.POND);
        case 'GET /api/confluence':
          return joinRoom(req, url, env.BASIN);
      }
      if (url.pathname.startsWith('/api/')) return error(404, 'not found');
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return error(500, 'internal error');
    }
  },
} satisfies ExportedHandler<Env>;
