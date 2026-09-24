// A Flock pond: one Durable Object per room runs the simulation in ./sim.ts at 20 ticks a
// second and streams it to everyone connected (see ../rooms.ts for the shared plumbing).
// Clients only ever send a steering angle and whether they're boosting, so the server decides
// every outcome and records scores itself.
//
// Client -> server (JSON):
//   { t: 'join', name }             start swimming (or swim again after dying)
//   { t: 'in', a, b }               target angle in radians, boosting 0/1
// Server -> client (JSON):
//   { t: 'hi', cfg, crumbs, ducks } on connect: the pond so far; watch until you join
//   { t: 'you', id }                your duck after joining
//   { t: 'n', d: [[id, name, color, bot]] }                         new ducks
//   { t: 's', d: [[id, x, y, angle, length, boost, safe]], ca, cr, k }  a tick: ducks, crumbs added/removed, deaths
//   { t: 'top', l: [[name, length, bot]], humans }                 the room's biggest flocks, once a second
//   { t: 'dead', peak, killer, rank?, best?, improved? }           your flock scattered
//   { t: 'full' }                                                   too many players; try another room

import { type Client, GameRoom } from '../rooms';
import {
  buildGrid, CONFIG, type Duck, newWorld, scatter, spawnDuck, step, steerBot, takeCrumbChanges, type World,
} from './sim';

export const MAX_HUMANS = 30;
export const MIN_DUCKS = 10;           // bots keep the pond at least this busy
const BOT_NAMES = ['Mallard', 'Teal', 'Eider', 'Wigeon', 'Pintail', 'Gadwall', 'Scaup', 'Merganser', 'Shoveler', 'Goldeneye', 'Bufflehead', 'Smew'];
const COLORS = 10;

const r1 = (v: number) => Math.round(v * 10) / 10;
const crumbRow = (c: { id: number; x: number; y: number; value: number }) => [c.id, r1(c.x), r1(c.y), c.value];
const duckRow = (d: Duck) => [d.id, d.name, d.color, d.bot ? 1 : 0];

export class Pond extends GameRoom {
  readonly gameId = 'flock';
  readonly maxHumans = MAX_HUMANS;
  readonly tickSeconds = CONFIG.tick;
  readonly minScore = CONFIG.startLength;  // only flocks that grew at all make the board
  world: World = newWorld();
  nextColor = 0;

  greet(c: Client) {
    this.send(c, {
      t: 'hi',
      cfg: { radius: CONFIG.radius, spacing: CONFIG.spacing, headRadius: CONFIG.headRadius, tick: CONFIG.tick },
      crumbs: [...this.world.crumbs.values()].map(crumbRow),
      ducks: [...this.world.ducks.values()].map(duckRow),
    });
  }

  spawn(_c: Client, name: string) {
    const duck = spawnDuck(this.world, name, this.nextColor++ % COLORS, false);
    this.broadcast({ t: 'n', d: [duckRow(duck)] });
    return duck.id;
  }

  onInput(c: Client, msg: Record<string, unknown>) {
    if (msg.t !== 'in') return;
    const duck = c.actor !== null ? this.world.ducks.get(c.actor) : undefined;
    if (!duck) return;
    if (typeof msg.a === 'number' && Number.isFinite(msg.a)) duck.target = msg.a;
    duck.boost = msg.b === 1;
  }

  remove(actor: number) {
    const duck = this.world.ducks.get(actor);
    if (!duck) return null;
    scatter(this.world, actor);
    return duck.peak;
  }

  reset() {
    // Nobody is watching, so let the pond start fresh next time.
    this.world = newWorld();
  }

  tick() {
    const w = this.world;
    this.topUpBots();
    const grid = buildGrid(w);
    for (const d of w.ducks.values()) if (d.bot) steerBot(w, d, grid);
    const deaths = step(w);

    const { added, removed } = takeCrumbChanges(w);
    this.broadcast({
      t: 's',
      d: [...w.ducks.values()].map(d => [d.id, r1(d.x), r1(d.y), Math.round(d.angle * 1000) / 1000, d.length, d.boost ? 1 : 0, d.safe > 0 ? 1 : 0]),
      ca: added.map(crumbRow),
      cr: removed,
      k: deaths.map(d => [d.id, d.killer]),
    });
    for (const death of deaths) {
      const killer = death.killer !== null ? w.ducks.get(death.killer)?.name ?? null : null;
      this.died(death.id, { t: 'dead', peak: death.peak, killer }, death.peak);
    }

    if (this.ticks % Math.round(1 / CONFIG.tick) === 0) {
      const top = [...w.ducks.values()].sort((a, b) => b.length - a.length).slice(0, 5);
      this.broadcast({ t: 'top', l: top.map(d => [d.name, d.length, d.bot ? 1 : 0]), humans: this.humans() });
    }
  }

  topUpBots() {
    const w = this.world;
    for (let n = w.ducks.size; n < MIN_DUCKS; n++) {
      const name = BOT_NAMES[Math.floor(w.random() * BOT_NAMES.length)];
      const duck = spawnDuck(w, name, this.nextColor++ % COLORS, true);
      this.broadcast({ t: 'n', d: [duckRow(duck)] });
    }
  }
}
