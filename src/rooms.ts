// Shared plumbing for multiplayer games: a Durable Object per room that accepts WebSockets,
// rate-limits and parses what clients send, runs a fixed-rate tick while anyone is connected,
// and records scores. Flock's ponds (./flock/pond.ts) and Confluence's basins
// (./confluence/basin.ts) build on it.
//
// Every game speaks JSON with a `t` field. The shared messages are:
//   client -> server  { t: 'join', name }   start playing (or play again)
//   server -> client  { t: 'you', id }      the id of your piece in the game
//                     { t: 'full' }         too many players; try another room

import { DurableObject } from 'cloudflare:workers';
import { normaliseName, recordScore } from './leaderboard';

const MAX_MESSAGE = 512;
const MAX_MESSAGES_PER_SECOND = 60;

export interface Client {
  ws: WebSocket;
  name: string | null;    // set once the client has joined
  actor: number | null;   // the id of their piece while they're alive
  windowStart: number;
  messages: number;
}

export abstract class GameRoom extends DurableObject<Env> {
  clients = new Set<Client>();
  timer: ReturnType<typeof setInterval> | null = null;
  ticks = 0;

  abstract readonly gameId: string;
  abstract readonly maxHumans: number;
  abstract readonly tickSeconds: number;
  // Sends a new connection the state of the room so far.
  abstract greet(c: Client): void;
  // Creates a piece for a client who has joined and returns its id.
  abstract spawn(c: Client, name: string): number;
  // Handles any message other than 'join'.
  abstract onInput(c: Client, msg: Record<string, unknown>): void;
  // Removes a departing client's piece and returns the score it had reached.
  abstract remove(actor: number): number | null;
  abstract tick(): void;
  // Starts the room afresh once everyone has left.
  abstract reset(): void;
  // Scores at or below this aren't worth a leaderboard entry.
  abstract readonly minScore: number;

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    const c: Client = { ws: server, name: null, actor: null, windowStart: Date.now(), messages: 0 };
    if (this.humans() >= this.maxHumans) {
      server.send(JSON.stringify({ t: 'full' }));
      server.close(1013, 'full');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.clients.add(c);
    server.addEventListener('message', e => this.onMessage(c, e.data));
    server.addEventListener('close', () => this.onClose(c));
    server.addEventListener('error', () => this.onClose(c));
    if (!this.timer) this.timer = setInterval(() => { this.tick(); this.ticks++; }, this.tickSeconds * 1000);
    this.greet(c);
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

  clientFor(actor: number): Client | undefined {
    for (const c of this.clients) if (c.actor === actor) return c;
    return undefined;
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
      if (c.actor !== null) return;
      c.name = normaliseName(msg.name) ?? `Duckling ${Math.floor(Math.random() * 900 + 100)}`;
      c.actor = this.spawn(c, c.name);
      this.send(c, { t: 'you', id: c.actor });
    } else this.onInput(c, msg);
  }

  onClose(c: Client) {
    if (!this.clients.delete(c)) return;
    if (c.actor !== null) {
      const score = this.remove(c.actor);
      if (score !== null) this.record(c, score);
      c.actor = null;
    }
    if (this.clients.size === 0) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.ticks = 0;
      this.reset();
    }
  }

  // Tells the owner of a piece that was knocked out, with where they now stand on the board.
  died(actor: number, message: Record<string, unknown>, score: number) {
    const c = this.clientFor(actor);
    if (!c) return;
    c.actor = null;
    this.record(c, score).then(
      result => this.send(c, result ? { ...message, ...result } : message),
      () => this.send(c, message),
    );
  }

  async record(c: Client, score: number) {
    if (!c.name || score <= this.minScore) return null;
    try {
      return await recordScore(this.env, this.gameId, 0, c.name, Math.round(score));
    } catch (e) {
      console.error(`failed to record a ${this.gameId} score`, e);
      return null;
    }
  }
}
