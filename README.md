# Duck Arcade

Small duck-themed arcade games with a shared leaderboard, deployed as a Cloudflare Worker with static assets and a D1 (SQLite) database.

- [Hexaduck](public/hexaduck/) is a Super Hexagon clone: steer around the hexagon and dodge the walls.
- [Runoff](public/runoff/) is a Canabalt clone: run across rooftops above rising floodwater.
- [Tailwind](public/tailwind/) is a Tiny Wings clone: dive down hills and fly off the tops, racing the sunset across the islands. Add `?day=5` to the URL for a five-second day, which the e2e tests use; it can only make the day shorter.
- [Flock](public/flock/) is a multiplayer slither.io clone: gather the longest line of ducklings in a shared pond without swimming into anyone else's.
- [Confluence](public/confluence/) is a multiplayer Osmos clone: ride a raindrop, absorb smaller drops, and flick water out behind you to move.
- [Scope Creep](public/scope-creep/) is a Slay the Spire-style deckbuilder about ducks and emissions accounting, with a run-long carbon budget that makes every later fight harder.
- [Audit, Please](public/audit/) is a Papers, Please clone about verifying sustainability claims: check each company's paperwork against a rulebook that grows every day, and keep three ducklings fed on the pay.

Each game lives in its own folder under `public/` as plain HTML, CSS and JavaScript with no build step, and `public/index.html` is the landing page that links to them. `public/shared/` holds the leaderboard client and its styles, which every game uses. `src/` is a small Worker that only handles `/api/*`; every other request is served straight from the asset store. Flock's ponds and Confluence's basins are Durable Objects, in `src/flock/` and `src/confluence/`, sharing the room plumbing in `src/rooms.ts` (and `public/shared/room.js` in the browser).

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

## How Confluence works

Each basin is a Durable Object (`src/confluence/basin.ts`) running `src/confluence/sim.ts`, built on the same room plumbing as Flock. Drops are circles whose mass is their area. Where two overlap, water flows from the smaller to the bigger until they just touch, and a drop moves by flicking out a droplet of itself, conserving momentum. Rain tops the basin back up to a set amount of water and the biggest drops slowly evaporate, so there's always food and nobody stays huge forever.

Because drops only drift (with drag, bouncing off the edge) unless something happens to them, the server sends only the drops whose motion changed each tick, and the browser runs the same `drift` in between. A full refresh every ten seconds is a backstop; a test checks the browser's prediction matches the server. Your own flicks are applied in the browser straight away and confirmed by the next update.

## How Scope Creep works

The rules live in `public/scope-creep/engine.js`, with the content in `cards.js`, `foes.js` and `extras.js`, and the interface in `ui.js`. The engine is pure and deterministic: a run is a seed and a list of actions, with separate random streams for the map, rewards, combat and everything else. The browser saves a run as exactly that and replays it on load.

Scores are checked by replaying. A new run asks `POST /api/runs` for a run id and derives its seed from it; at the end, `POST /api/scope-creep/finish` sends the actions, and the Worker (`src/replayed.ts`) replays them with the same engine file. If every action is legal and the run has ended, it records the replayed score. Replaying a whole run takes under a millisecond. Run ids last a fortnight, since runs are long and can be resumed.

Because saves and scores are replays, any change to the rules that would make an existing run play out differently (card numbers, rewards, new cards in the reward pools) needs `VERSION` in `engine.js` bumped. Players with a run in progress are then told it can't be restored, rather than having it silently go wrong, and such runs can't be posted.

The design centres on a second health bar that lasts the whole run: carbon. Enemies that Emit add to it until they're abated, Fossil cards add to it for power now, and every 15 carbon is a point of Heat that gives every later enemy 1 Drive. Offsets are cheap but are audited at each boss (half fail and come back doubled); removals are dear but permanent. Rest ponds choose between healing, upgrading and restoring a wetland.

`test/scope-creep/players.js` has automated players used for testing and tuning: a random player for fuzzing, and a planner that searches over whole turns. The tests check the rules, maps and replays, fuzz random runs for impossible states, and keep the planner's results in a difficulty band. For tuning, the planner can be biased towards a play style. Measured over 250 runs each, focused decks of each of the four styles (Measure, Flock, Fossil, Policy) win 3 to 4% of the time and reach Scope 3 about half the time, against 2% for an unfocused deck, and looking after carbon keeps Heat around 2 instead of 5.

## How Audit, Please works

The rules live in `public/audit/rules.js` and the rest of the game in `public/audit/engine.js`, with the interface in `ui.js`. It's built the same way as Scope Creep: a pure, deterministic engine where a run is a seed and a list of actions, saved in the browser and replayed by the Worker through `POST /api/audit/finish` (in `src/replayed.ts`, which serves both games). The same `VERSION` rule applies: bump it whenever a change would make a saved run play out differently.

Each case is a set of documents, each a list of labelled fields. The generator in `engine.js` builds a claim that satisfies every rule in force and then, some of the time, plants one flaw. The checker in `rules.js` knows nothing about how cases are made; it reads the documents fresh and returns each broken rule along with the pairs of things that prove it (two fields, or a field and a rule or reference list). Inspecting two things asks whether they're one of those pairs. The tests cross-check the two halves: every clean case must pass, and every planted flaw must break exactly its own rule and nothing else.

Time only moves when you act. Calling an applicant costs 18 minutes, an inspection 5 and a stamp 4, and reading is free, so the day's length is set by how carefully you work rather than how fast you read. Pay is £3 per correct decision, plus £1 for a rejection you documented; the first two citations each day are warnings and later ones cost £5. Each night the rent is due (into debt if need be), and food, heating and medicine for the ducklings are optional. Two nights hungry or cold make a duckling sick, and two nights sick without medicine and it's gone.

Grand Mallard Petroleum files on days 3, 5, 7 and 10, each time a little less honestly, and the Reed Collective gets in touch on the nights of days 2 and 6. Rejecting the final claim with the collective's help and the evidence from their earlier filings exposes them; approving it gets you promoted. Taking envelopes risks dismissal (12% per envelope taken, checked every night).

`test/audit/players.js` has a random player for fuzzing and a clerk that can see the answers, with settings for accuracy, whether it inspects, and whether it takes envelopes. The tests use it to keep the economy in a band: a perfect clerk gets through with every duckling, while one who's right 80% of the time loses about a fifth of their runs.

