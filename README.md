# Duck Arcade

Small duck-themed arcade games with a shared leaderboard, deployed as a Cloudflare Worker with static assets and a D1 (SQLite) database.

- [Hexaduck](public/hexaduck/) is a Super Hexagon clone: steer around the hexagon and dodge the walls.
- [Runoff](public/runoff/) is a Canabalt clone: run across rooftops above rising floodwater.
- [Tailwind](public/tailwind/) is a Tiny Wings clone: dive down hills and fly off the tops, racing the sunset across the islands. Add `?day=5` to the URL for a five-second day, which the e2e tests use; it can only make the day shorter.
- [Flock](public/flock/) is a multiplayer slither.io clone: gather the longest line of ducklings in a shared pond without swimming into anyone else's.

Each game lives in its own folder under `public/` as plain HTML, CSS and JavaScript with no build step, and `public/index.html` is the landing page that links to them. `public/shared/` holds the leaderboard client and its styles, which every game uses. `src/` is a small Worker that only handles `/api/*`; every other request is served straight from the asset store. Flock's ponds are Durable Objects in `src/flock/`.

## Developing

```sh
npm install
npm run db:migrate:local   # create or update the local D1 database
npm run dev                # http://localhost:8787
npm test                   # API, migration, level and physics tests, run inside workerd
npm run test:e2e           # browser tests against wrangler dev (desktop and mobile)
npm run typecheck
```

The e2e tests need a browser: either run `npx playwright install chromium` once, or set `PW_CHANNEL=chrome` to use an installed Chrome.

## Deploying

`npm run deploy` applies any pending migrations to the remote database and deploys the Worker to its custom domain (see `routes` in `wrangler.jsonc`).

## Adding a game

Add an entry to `GAMES` in `src/games.ts` with its number of modes, how to store its score as an integer, and the fastest its score can grow per second of real time. Then create `public/<game>/`, call `createLeaderboard` from `/shared/leaderboard.js` with the same id, and add a card to `public/index.html`. No migration is needed.

## How the leaderboard works

When a game starts the client asks for a run id (`POST /api/runs` with the game and mode), and the server records when it handed it out. When the run ends the client redeems that id with a name and a score (`POST /api/scores`). Each id can be redeemed once, within an hour, and the score can't be higher than the game's `maxPerSecond` times the wall-clock seconds since the run began. That rules out simply posting a made-up number, but it is not real anti-cheat: someone determined could request a run id, wait, and claim the most the elapsed time allows. The board keeps each name's best score per game and mode, and names are compared case-insensitively.

Players choose a name the first time they post and it's remembered in `localStorage` for every game, so later runs are posted automatically.

## How Flock works

Each room is a Durable Object (`src/flock/pond.ts`) that runs the simulation in `src/flock/sim.ts` twenty times a second and streams snapshots to everyone connected over a WebSocket at `/api/flock?room=<name>`. The client (`public/flock/game.js`) only ever sends a steering angle and whether it's boosting, so the server decides every collision, and it records scores in D1 itself: `POST /api/runs` refuses Flock, and nobody can post a made-up flock. Bots keep at least ten ducks in the pond. Players join `pond-1` and move on to `pond-2` and beyond when a room has 30 people; any lowercase room name works, which the e2e tests use to get a pond of their own.

Snapshots only carry each duck's head. Clients draw about 110 ms behind the newest snapshot so they can interpolate between two, and rebuild every trail of ducklings from where the head has been. A pond's Durable Object stays awake while anyone is connected, which is what Cloudflare bills for, and resets when the last person leaves.
