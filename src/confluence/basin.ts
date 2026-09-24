// A Confluence basin: one Durable Object per room runs ./sim.ts at 20 ticks a second (see
// ../rooms.ts for the shared plumbing). Drops drift predictably, so rather than every drop on
// every tick the server sends only drops whose motion changed some other way, and clients run
// the same drift in between. A full refresh every ten seconds mops up any rounding drift.
//
// Client -> server (JSON):
//   { t: 'join', name }       start (or start again after being absorbed)
//   { t: 'push', a }          flick a droplet towards angle `a`, drifting the other way
// Server -> client (JSON):
//   { t: 'hi', cfg, drops }   on connect: every drop, as rows (below); watch until you join
//   { t: 'you', id }          your drop after joining
//   { t: 's', u, rm, k, full? } a tick: changed drops as rows, removed ids, absorbed [id, by];
//                             `full` means `u` is every drop and anything else is gone
//   { t: 'top', l: [[name, mass, bot]], humans }   the biggest drops, once a second
//   { t: 'dead', peak, by, rank?, best?, improved? } you were absorbed
//   { t: 'full' }             too many players; try another room
//
// A row is [id, x, y, vx, vy, mass, kind] for a raindrop (kind 0), with name and colour after
// for a player (1) or bot (2).

import { type Client, GameRoom } from '../rooms';
import { CONFIG, type Drop, newWorld, push, spawnActor, step, steerBot, takeChanges, type World } from './sim';

export const MAX_HUMANS = 30;
export const MIN_ACTORS = 8;
// Ticks between full refreshes. Measured over 20 seconds, clients' drift stays within a tenth
// of a unit of the server's without one; the refresh is a backstop, and at 500 drops it's the
// costliest message.
export const FULL_EVERY = 200;
const BOT_NAMES = ['Dewdrop', 'Drizzle', 'Puddle', 'Rivulet', 'Brook', 'Eddy', 'Spring', 'Mizzle', 'Torrent', 'Tarn', 'Beck', 'Burn'];
const COLORS = 8;
const KIND = { mote: 0, player: 1, bot: 2 } as const;

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
export function row(d: Drop): (number | string)[] {
  const base = [d.id, r1(d.x), r1(d.y), r2(d.vx), r2(d.vy), r1(d.mass), KIND[d.kind]];
  return d.kind === 'mote' ? base : [...base, d.name, d.color];
}

export class Basin extends GameRoom {
  readonly gameId = 'confluence';
  readonly maxHumans = MAX_HUMANS;
  readonly tickSeconds = CONFIG.tick;
  readonly minScore = CONFIG.spawnMass * 1.1;  // you have to have grown a little to make the board
  world: World = newWorld();
  nextColor = 0;

  greet(c: Client) {
    const { tick, drag, bounce, radius, ejectShare, ejectMin, ejectSpeed, pushCooldown, minPushMass } = CONFIG;
    this.send(c, {
      t: 'hi',
      cfg: { tick, drag, bounce, radius, ejectShare, ejectMin, ejectSpeed, pushCooldown, minPushMass },
      drops: [...this.world.drops.values()].map(row),
    });
  }

  spawn(_c: Client, name: string) {
    return spawnActor(this.world, 'player', name, this.nextColor++ % COLORS).id;
  }

  onInput(c: Client, msg: Record<string, unknown>) {
    if (msg.t !== 'push' || typeof msg.a !== 'number' || !Number.isFinite(msg.a)) return;
    const drop = c.actor !== null ? this.world.drops.get(c.actor) : undefined;
    if (drop) push(this.world, drop, msg.a);
  }

  remove(actor: number) {
    const drop = this.world.drops.get(actor);
    if (!drop) return null;
    // A departing player's drop stays behind as a raindrop for someone else to take.
    drop.kind = 'mote';
    drop.name = '';
    this.world.changed.add(drop.id);
    return drop.peak;
  }

  reset() {
    this.world = newWorld();
  }

  tick() {
    const w = this.world;
    let actors = 0;
    for (const d of w.drops.values()) if (d.kind !== 'mote') actors++;
    for (; actors < MIN_ACTORS; actors++) {
      const mass = 250 + w.random() * 1050;
      spawnActor(w, 'bot', BOT_NAMES[Math.floor(w.random() * BOT_NAMES.length)], this.nextColor++ % COLORS, mass);
    }
    for (const d of w.drops.values()) if (d.kind === 'bot') steerBot(w, d);
    const absorbed = step(w);

    const { changed, removed } = takeChanges(w);
    const full = this.ticks % FULL_EVERY === 0;
    this.broadcast({
      t: 's',
      u: full ? [...w.drops.values()].map(row) : changed.map(id => row(w.drops.get(id)!)),
      rm: removed,
      k: absorbed.map(a => [a.id, a.by]),
      ...(full ? { full: 1 } : {}),
    });
    for (const a of absorbed) {
      if (a.kind !== 'player') continue;
      const by = w.drops.get(a.by);
      this.died(a.id, { t: 'dead', peak: Math.round(a.peak), by: by && by.kind !== 'mote' ? by.name : null }, a.peak);
    }

    if (this.ticks % Math.round(1 / CONFIG.tick) === 0) {
      const top = [...w.drops.values()].filter(d => d.kind !== 'mote').sort((a, b) => b.mass - a.mass).slice(0, 5);
      this.broadcast({ t: 'top', l: top.map(d => [d.name, Math.round(d.mass), d.kind === 'bot' ? 1 : 0]), humans: this.humans() });
    }
  }
}
