import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { type Basin, MIN_ACTORS, row } from '../src/confluence/basin';
import { CONFIG, drift } from '../src/confluence/sim';
import { connect as connectTo, freshRoom, type Msg, sleep } from './rooms';

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scores').run();
});

const connect = (room: string) => connectTo('/api/confluence', room);
const basin = (room: string) => env.BASIN.get(env.BASIN.idFromName(room));
const rowFor = (m: Msg, id: number) => m.t === 's' && m.u.find((r: number[]) => r[0] === id);

describe('Confluence basin', () => {
  it('greets a watcher with every drop, including bots', async () => {
    const c = await connect(freshRoom());
    const hi = await c.next(m => m.t === 'hi');
    expect(hi.cfg).toMatchObject({ radius: CONFIG.radius, drag: CONFIG.drag, ejectSpeed: CONFIG.ejectSpeed });
    expect(hi.drops.length).toBeGreaterThan(100);
    // The first tick is a full refresh, by which time the bots have arrived.
    const full = await c.next(m => m.t === 's' && m.full === 1);
    expect(full.u.filter((r: unknown[]) => r[6] === 2)).toHaveLength(MIN_ACTORS);
  });

  it('only sends drops whose motion changed, apart from the periodic full refresh', async () => {
    const c = await connect(freshRoom());
    const hi = await c.next(m => m.t === 'hi');
    const partials: Msg[] = [];
    for (let i = 0; i < 10; i++) partials.push(await c.next(m => m.t === 's' && !m.full && !partials.includes(m)));
    const perTick = partials.reduce((n, m) => n + m.u.length, 0) / partials.length;
    expect(perTick).toBeLessThan(hi.drops.length / 10);
  });

  it('matches what a client predicts between updates', async () => {
    // A client runs `drift` on the last row it saw. A second of server ticks later, raindrops
    // that nothing touched should be (almost) exactly where that prediction puts them.
    const room = freshRoom();
    await connect(room);
    await sleep(200);
    const snapshot = (b: Basin) => ({ ticks: b.ticks, rows: [...b.world.drops.values()].filter(d => d.kind === 'mote').map(row) });
    const a = await runInDurableObject(basin(room), snapshot);
    await sleep(1000);
    const b = await runInDurableObject(basin(room), snapshot);
    const ticks = b.ticks - a.ticks;
    expect(ticks).toBeGreaterThan(10);
    let checked = 0;
    for (const r of a.rows as number[][]) {
      const later = (b.rows as number[][]).find(x => x[0] === r[0]);
      if (!later || later[5] !== r[5]) continue;  // absorbed or grew in between
      const d = { x: r[1], y: r[2], vx: r[3], vy: r[4], mass: r[5] };
      for (let i = 0; i < ticks; i++) drift(d, CONFIG.tick);
      expect(Math.hypot(d.x - later[1], d.y - later[2])).toBeLessThan(0.5);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('lets a player push their drop, and reports the new motion', async () => {
    const room = freshRoom();
    const c = await connect(room);
    c.send({ t: 'join', name: 'Rivulet' });
    const { id } = await c.next(m => m.t === 'you');
    const first = await c.next(m => !!rowFor(m, id));
    expect(rowFor(first, id).slice(6)).toEqual([1, 'Rivulet', expect.any(Number)]);
    await sleep(CONFIG.spawnSafe * 1000);
    c.send({ t: 'push', a: 0 });  // flick towards +x, so the drop drifts towards -x
    const after = await c.next(m => { const r = rowFor(m, id); return !!r && r[3] < -1; });
    // The same tick carries the flicked droplet, a new raindrop racing off towards +x.
    const me = rowFor(after, id);
    const droplet = (after.u as number[][]).find(r => r[6] === 0 && r[3] > CONFIG.ejectSpeed * 0.9 && r[1] > me[1]);
    expect(droplet).toBeDefined();
  });

  it('records an absorbed player on the leaderboard', async () => {
    const room = freshRoom();
    const c = await connect(room);
    c.send({ t: 'join', name: 'Puddle' });
    const { id } = await c.next(m => m.t === 'you');
    await runInDurableObject(basin(room), (b: Basin) => {
      const me = b.world.drops.get(id)!;
      Object.assign(me, { mass: 300, peak: 900, safe: 0 });
      b.world.drops.set(9_999_999, { ...me, id: 9_999_999, kind: 'bot', name: 'Torrent', mass: 5000, peak: 5000, safe: 0 });
    });
    const dead = await c.next(m => m.t === 'dead');
    expect(dead).toEqual({ t: 'dead', peak: 900, by: 'Torrent', rank: 1, best: 900, improved: true });
    expect(await env.DB.prepare("SELECT name, score FROM scores WHERE game = 'confluence'").first()).toEqual({ name: 'Puddle', score: 900 });
  });

  it('leaves a departing player behind as a raindrop and records how big they got', async () => {
    const room = freshRoom();
    const c = await connect(room);
    c.send({ t: 'join', name: 'Leaver' });
    const { id } = await c.next(m => m.t === 'you');
    await runInDurableObject(basin(room), (b: Basin) => { Object.assign(b.world.drops.get(id)!, { peak: 777 }); });
    const watcher = await connect(room);
    c.ws.close();
    const asMote = await watcher.next(m => { const r = rowFor(m, id); return !!r && r[6] === 0; });
    expect(rowFor(asMote, id)).toHaveLength(7);
    expect(await env.DB.prepare("SELECT name, score FROM scores WHERE game = 'confluence'").first()).toEqual({ name: 'Leaver', score: 777 });
  });

  it('ignores pushes before joining and malformed ones', async () => {
    const room = freshRoom();
    const c = await connect(room);
    await c.next(m => m.t === 'hi');
    c.send({ t: 'push', a: 1 });
    c.send({ t: 'join', name: 'Tarn' });
    const { id } = await c.next(m => m.t === 'you');
    // A push leaves a droplet close by, racing straight out from the drop's centre. (Bots flick
    // droplets just as fast, but theirs aren't lined up with this drop.)
    const flicked = () => runInDurableObject(basin(room), (b: Basin) => {
      const me = b.world.drops.get(id)!;
      return [...b.world.drops.values()].some(d => {
        if (d.kind !== 'mote') return false;
        const ox = d.x - me.x, oy = d.y - me.y, vx = d.vx - me.vx, vy = d.vy - me.vy;
        const dist = Math.hypot(ox, oy), speed = Math.hypot(vx, vy);
        return dist < 150 && speed > CONFIG.ejectSpeed * 0.5 && (ox * vx + oy * vy) / (dist * speed) > 0.99;
      });
    });
    c.send({ t: 'push', a: 'left' });
    c.send({ t: 'push', a: null });
    c.send({ t: 'push' });
    await sleep(200);
    expect(await flicked()).toBe(false);
    // And a well-formed push still works afterwards.
    c.send({ t: 'push', a: 0 });
    await sleep(100);
    expect(await flicked()).toBe(true);
  });
});
