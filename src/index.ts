// Entry point. Static assets are served by the asset store; only /api/* reaches here.
// Workers only allow handlers as named exports from this module, so the logic lives in ./leaderboard.
import { error, listScores, startRun, submitScore } from './leaderboard';

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
      }
      if (url.pathname.startsWith('/api/')) return error(404, 'not found');
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return error(500, 'internal error');
    }
  },
} satisfies ExportedHandler<Env>;
