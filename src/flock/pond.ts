// A Flock pond: one Durable Object per room runs the simulation in ./sim.ts at 20 ticks a
// second and streams it to everyone connected over WebSockets. Clients only ever send a
// steering angle and whether they're boosting, so the server decides every outcome and records
// scores itself.
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

import { DurableObject } from 'cloudflare:workers';
import { normaliseName, recordScore } from '../leaderboard';
import {
  buildGrid, CONFIG, type Death, type Duck, newWorld, scatter, spawnDuck, step, steerBot, takeCrumbChanges, type World,
} from './sim';

export const MAX_HUMANS = 30;
export const MIN_DUCKS = 10;           // bots keep the pond at least this busy
const MAX_MESSAGE = 512;
const MAX_MESSAGES_PER_SECOND = 60;
const BOT_NAMES = ['Mallard', 'Teal', 'Eider', 'Wigeon', 'Pintail', 'Gadwall', 'Scaup', 'Merganser', 'Shoveler', 'Goldeneye', 'Bufflehead', 'Smew'];
const COLORS = 10;

interface Client {
  ws: WebSocket;
  name: string | null;
  duck: number | null;
  windowStart: number;
  messages: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const crumbRow = (c: { id: number; x: number; y: number; value: number }) => [c.id, r1(c.x), r1(c.y), c.value];
const duckRow = (d: Duck) => [d.id, d.name, d.color, d.bot ? 1 : 0];

export class Pond extends DurableObject<Env> {
  world: World = newWorld();
  clients = new Set<Client>();
  timer: ReturnType<typeof setInterval> | null = null;
  ticks = 0;
  nextColor = 0;

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const c: Client = { ws: server, name: null, duck: null, windowStart: Date.now(), messages: 0 };
    if (this.humans() >= MAX_HUMANS) {
      server.send(JSON.stringify({ t: 'full' }));
      server.close(1013, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.clients.add(c);
    server.addEventListener('message', e => this.onMessage(c, e.data));
    server.addEventListener('close', () => this.onClose(c));
    server.addEventListener('error', () => this.onClose(c));
    this.start();
    this.send(c, {
      t: 'hi',
      cfg: { radius: CONFIG.radius, spacing: CONFIG.spacing, headRadius: CONFIG.headRadius, tick: CONFIG.tick },
      crumbs: [...this.world.crumbs.values()].map(crumbRow),
      ducks: [...this.world.ducks.values()].map(duckRow),
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  humans() {
    let n = 0;
    for (const c of this.clients) if (c.name !== null) n++;
    return n;
  }

  send(c: Client, msg: unknown) {
    try { c.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch { this.onClose(c); }
  }

  broadcast(msg: unknown) {
    const text = JSON.stringify(msg);
    for (const c of this.clients) this.send(c, text);
  }

  onMessage(c: Client, data: string | ArrayBuffer) {
    const now = Date.now();
    if (now - c.windowStart > 1000) { c.windowStart = now; c.messages = 0; }
    if (++c.messages > MAX_MESSAGES_PER_SECOND) { c.ws.close(1008, 'too many messages'); return; }
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return;
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join') {
      if (c.duck !== null && this.world.ducks.has(c.duck)) return;
      c.name = normaliseName(msg.name) ?? `Duckling ${Math.floor(Math.random() * 900 + 100)}`;
      const duck = spawnDuck(this.world, c.name, this.nextColor++ % COLORS, false);
      c.duck = duck.id;
      this.send(c, { t: 'you', id: duck.id });
      this.broadcast({ t: 'n', d: [duckRow(duck)] });
    } else if (msg.t === 'in') {
      const duck = c.duck !== null ? this.world.ducks.get(c.duck) : undefined;
      if (!duck) return;
      if (typeof msg.a === 'number' && Number.isFinite(msg.a)) duck.target = msg.a;
      duck.boost = msg.b === 1;
    }
  }

  onClose(c: Client) {
    if (!this.clients.delete(c)) return;
    if (c.duck !== null) {
      const duck = this.world.ducks.get(c.duck);
      if (duck) {
        this.record(c, duck.peak);
        scatter(this.world, duck.id);
      }
    }
    if (this.clients.size === 0) this.stop();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), CONFIG.tick * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Nobody is watching, so let the pond start fresh next time.
    this.world = newWorld();
    this.ticks = 0;
  }

  tick() {
    const w = this.world;
    this.topUpBots();
    const grid = buildGrid(w);
    for (const d of w.ducks.values()) if (d.bot) steerBot(w, d, grid);
    const deaths = step(w);
    this.ticks++;

    const { added, removed } = takeCrumbChanges(w);
    this.broadcast({
      t: 's',
      d: [...w.ducks.values()].map(d => [d.id, r1(d.x), r1(d.y), Math.round(d.angle * 1000) / 1000, d.length, d.boost ? 1 : 0, d.safe > 0 ? 1 : 0]),
      ca: added.map(crumbRow),
      cr: removed,
      k: deaths.map(d => [d.id, d.killer]),
    });
    for (const death of deaths) this.onDeath(death);

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

  onDeath(death: Death) {
    const killer = death.killer !== null ? this.world.ducks.get(death.killer)?.name ?? null : null;
    for (const c of this.clients) {
      if (c.duck !== death.id) continue;
      c.duck = null;
      const reply = { t: 'dead', peak: death.peak, killer };
      this.record(c, death.peak).then(
        result => this.send(c, result ? { ...reply, ...result } : reply),
        () => this.send(c, reply),
      );
    }
  }

  // Posts a finished flock to the leaderboard. Only flocks that grew at all are worth keeping.
  async record(c: Client, peak: number) {
    if (!c.name || peak <= CONFIG.startLength) return null;
    try {
      return await recordScore(this.env, 'flock', 0, c.name, peak);
    } catch (e) {
      console.error('failed to record a flock score', e);
      return null;
    }
  }
}
