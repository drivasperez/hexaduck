import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_HUMANS, MIN_DUCKS, type Pond } from '../src/flock/pond';
import { CONFIG } from '../src/flock/sim';

type Msg = Record<string, any>;
const BASE = 'https://arcade.test';
const open: WebSocket[] = [];

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
});
afterEach(() => {
  for (const ws of open.splice(0)) try { ws.close(); } catch {}
});

let roomCounter = 0;
const freshRoom = () => `test-${Date.now().toString(36)}-${roomCounter++}`;

async function connect(room: string) {
  const res = await SELF.fetch(`${BASE}/api/flock?room=${room}`, { headers: { Upgrade: 'websocket' } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  open.push(ws);
  const inbox: Msg[] = [];
  let closed: { code: number } | null = null;
  const listeners = new Set<() => void>();
  ws.addEventListener('message', e => { inbox.push(JSON.parse(e.data as string)); listeners.forEach(l => l()); });
  ws.addEventListener('close', e => { closed = { code: e.code }; listeners.forEach(l => l()); });
  // Resolves with the first message (already received or yet to come) that matches.
  function next(match: (m: Msg) => boolean, timeout = 3000): Promise<Msg> {
    return new Promise((resolve, reject) => {
      let seen = 0;
      const check = () => {
        for (; seen < inbox.length; seen++) if (match(inbox[seen])) { listeners.delete(check); clearTimeout(timer); resolve(inbox[seen]); return; }
      };
      const timer = setTimeout(() => { listeners.delete(check); reject(new Error('timed out waiting for a message')); }, timeout);
      listeners.add(check);
      check();
    });
  }
  const send = (m: Msg) => ws.send(JSON.stringify(m));
  return { ws, inbox, next, send, closed: () => closed };
}

const pond = (room: string) => env.POND.get(env.POND.idFromName(room));
const snapshotWith = (id: number) => (m: Msg) => m.t === 's' && m.d.some((d: number[]) => d[0] === id);

describe('Flock pond', () => {
  it('rejects bad room names and plain HTTP', async () => {
    expect((await SELF.fetch(`${BASE}/api/flock?room=Bad_Room!`, { headers: { Upgrade: 'websocket' } })).status).toBe(400);
    expect((await SELF.fetch(`${BASE}/api/flock?room=ok`)).status).toBe(426);
  });

  it('greets a watcher with the pond and fills it with bots', async () => {
    const c = await connect(freshRoom());
    const hi = await c.next(m => m.t === 'hi');
    expect(hi.cfg.radius).toBe(CONFIG.radius);
    expect(hi.crumbs.length).toBeGreaterThan(CONFIG.crumbsBase - 1);
    const snap = await c.next(m => m.t === 's');
    expect(snap.d.length).toBeGreaterThanOrEqual(MIN_DUCKS);
    const top = await c.next(m => m.t === 'top', 2000);
    expect(top.humans).toBe(0);
  });

  it('gives a player a duck that follows their steering', async () => {
    const c = await connect(freshRoom());
    c.send({ t: 'join', name: '  Mallard  ' });
    const { id } = await c.next(m => m.t === 'you');
    const named = await c.next(m => m.t === 'n' && m.d.some((d: unknown[]) => d[0] === id));
    expect(named.d.find((d: unknown[]) => d[0] === id)).toEqual([id, 'Mallard', expect.any(Number), 0]);

    c.send({ t: 'in', a: Math.PI / 2, b: 0 });
    // After a second the duck should be facing (roughly) straight down the y axis.
    await new Promise(r => setTimeout(r, 1000));
    const snap = await c.next(m => m.t === 's' && c.inbox.indexOf(m) > c.inbox.length - 3 && snapshotWith(id)(m));
    const [, , , angle] = snap.d.find((d: number[]) => d[0] === id);
    expect(angle).toBeCloseTo(Math.PI / 2, 1);
  });

  it('records a scattered flock on the leaderboard and tells the player where they stand', async () => {
    const room = freshRoom();
    const c = await connect(room);
    c.send({ t: 'join', name: 'Pintail' });
    const { id } = await c.next(m => m.t === 'you');
    // Grow the duck and steer it into the shore.
    await runInDurableObject(pond(room), (p: Pond) => {
      const d = p.world.ducks.get(id)!;
      Object.assign(d, { length: 30, peak: 30, safe: 0, x: CONFIG.radius - 20, y: 0, angle: 0, target: 0 });
    });
    const dead = await c.next(m => m.t === 'dead');
    expect(dead).toEqual({ t: 'dead', peak: 30, killer: null, rank: 1, best: 30, improved: true });
    const row = await env.DB.prepare("SELECT name, score FROM scores WHERE game = 'flock'").first();
    expect(row).toEqual({ name: 'Pintail', score: 30 });

    // Joining again gives a fresh duck.
    c.send({ t: 'join', name: 'Pintail' });
    const again = await c.next(m => m.t === 'you' && m.id !== id);
    expect(again.id).not.toBe(id);
  });

  it("doesn't record flocks that never grew", async () => {
    const room = freshRoom();
    const c = await connect(room);
    c.send({ t: 'join', name: 'Tiny' });
    const { id } = await c.next(m => m.t === 'you');
    await runInDurableObject(pond(room), (p: Pond) => {
      Object.assign(p.world.ducks.get(id)!, { safe: 0, x: CONFIG.radius - 20, y: 0, angle: 0, target: 0 });
    });
    const dead = await c.next(m => m.t === 'dead');
    expect(dead).toEqual({ t: 'dead', peak: CONFIG.startLength, killer: null });
    expect(await env.DB.prepare("SELECT * FROM scores WHERE game = 'flock'").first()).toBeNull();
  });

  it('records the flock of a player who disconnects mid-swim', async () => {
    const room = freshRoom();
    const c = await connect(room);
    c.send({ t: 'join', name: 'Leaver' });
    const { id } = await c.next(m => m.t === 'you');
    await runInDurableObject(pond(room), (p: Pond) => { Object.assign(p.world.ducks.get(id)!, { length: 12, peak: 12 }); });
    c.ws.close();
    let row: unknown = null;
    for (let i = 0; i < 40 && !row; i++) {
      await new Promise(r => setTimeout(r, 50));
      row = await env.DB.prepare("SELECT name, score FROM scores WHERE game = 'flock'").first();
    }
    expect(row).toEqual({ name: 'Leaver', score: 12 });
  });

  it('turns players away when the room is full', async () => {
    const room = freshRoom();
    await connect(room);
    await runInDurableObject(pond(room), (p: Pond) => {
      const fake = { send() {}, close() {} } as unknown as WebSocket;
      for (let i = 0; i < MAX_HUMANS; i++) p.clients.add({ ws: fake, name: `P${i}`, duck: null, windowStart: 0, messages: 0 });
    });
    const late = await connect(room);
    expect(await late.next(m => m.t === 'full')).toEqual({ t: 'full' });
  });

  it('disconnects a client that floods it with messages', async () => {
    const c = await connect(freshRoom());
    await c.next(m => m.t === 'hi');
    for (let i = 0; i < 100; i++) c.send({ t: 'in', a: 0, b: 0 });
    for (let i = 0; i < 40 && !c.closed(); i++) await new Promise(r => setTimeout(r, 25));
    expect(c.closed()?.code).toBe(1008);
  });

  it('ignores steering from someone who has not joined, and junk messages', async () => {
    const room = freshRoom();
    const c = await connect(room);
    await c.next(m => m.t === 'hi');
    c.ws.send('not json');
    c.send({ t: 'in', a: 1, b: 1 });
    c.send({ t: 'join', name: 'x'.repeat(600) });  // too long to even parse
    await new Promise(r => setTimeout(r, 200));
    const humans = await runInDurableObject(pond(room), (p: Pond) => p.humans());
    expect(humans).toBe(0);
  });
});
