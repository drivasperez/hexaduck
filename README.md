# Hexaduck

A Watershed-themed Super Hexagon clone, deployed as a Cloudflare Worker with static assets and a D1 (SQLite) leaderboard.

The game itself lives in `public/` and is plain HTML, CSS and JavaScript with no build step. `src/` holds a small Worker that only handles `/api/*`; every other request is served straight from the asset store.

## Developing

```sh
npm install
npm run db:migrate:local   # create the local D1 database
npm run dev                # http://localhost:8787
npm test                   # API tests, run inside workerd against a real D1
npm run typecheck
```

## Deploying

The first time, create the database and paste the id it prints into `database_id` in `wrangler.jsonc`:

```sh
npx wrangler login
npx wrangler d1 create hexaduck
```

After that, `npm run deploy` applies any pending migrations to the remote database and deploys the Worker.

## How the leaderboard works

When a game starts the client asks for a run id (`POST /api/runs`), and the server records when it handed it out. When the duck dies the client redeems that id with a name and a time (`POST /api/scores`). Each id can be redeemed once, within an hour, and the claimed time can't exceed the wall-clock time since the run began. That rules out simply posting a made-up number, but it is not real anti-cheat: someone determined could request a run id, wait, and claim the elapsed time. The board keeps each name's best time per scope, and names are compared case-insensitively.

Players choose a name the first time they post and it's remembered in `localStorage`, so later runs are posted automatically.
