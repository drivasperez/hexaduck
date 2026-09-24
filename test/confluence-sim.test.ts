import { describe, expect, it } from 'vitest';
import {
  addDrop, CONFIG, drift, type Drop, mulberry, newWorld, push, radiusOf, Rain, spawnActor, step, steerBot, takeChanges,
  totalWater, type World,
} from '../src/confluence/sim';

function empty(seed = 1): World {
  const w = newWorld(mulberry(seed));
  w.drops.clear();
  takeChanges(w);
  return w;
}

const momentum = (w: World) => {
  let x = 0, y = 0;
  for (const d of w.drops.values()) { x += d.mass * d.vx; y += d.mass * d.vy; }
  return [x, y];
};

describe('Confluence physics', () => {
  it('pushing flicks a droplet one way and the drop the other, conserving momentum', () => {
    const w = empty();
    const d = addDrop(w, { x: 0, y: 0, mass: 400, vx: 10, vy: -5 });
    const before = momentum(w);
    expect(push(w, d, 0)).toBe(true);  // flick towards +x
    expect(d.vx).toBeLessThan(10);      // so the drop moves towards -x
    expect(d.mass).toBeCloseTo(400 * (1 - CONFIG.ejectShare), 6);
    expect(w.drops.size).toBe(2);
    const after = momentum(w);
    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(totalWater(w)).toBeCloseTo(400, 6);
  });

  it('places the flicked droplet outside the drop, moving away from it', () => {
    const w = empty();
    const d = addDrop(w, { x: 0, y: 0, mass: 900 });
    push(w, d, Math.PI / 2);
    const droplet = [...w.drops.values()].find(o => o !== d)!;
    expect(Math.hypot(droplet.x - d.x, droplet.y - d.y)).toBeGreaterThan(radiusOf(d.mass) + radiusOf(droplet.mass));
    expect(droplet.vy - d.vy).toBeGreaterThan(CONFIG.ejectSpeed * 0.99);
    // It must not be swallowed straight back.
    step(w, CONFIG.tick, Rain.Off);
    expect(w.drops.has(droplet.id)).toBe(true);
  });

  it('limits pushes by cooldown and by size', () => {
    const w = empty();
    const d = addDrop(w, { x: 0, y: 0, mass: 400 });
    expect(push(w, d, 0)).toBe(true);
    expect(push(w, d, 0)).toBe(false);
    const tiny = addDrop(w, { x: 500, y: 0, mass: CONFIG.minPushMass - 1 });
    expect(push(w, tiny, 0)).toBe(false);
  });

  it('draws water from the smaller of two overlapping drops until they just touch', () => {
    const w = empty();
    const big = addDrop(w, { x: 0, y: 0, mass: 900 });      // radius 30
    const small = addDrop(w, { x: 38, y: 0, mass: 100 });   // radius 10, overlapping by 2
    step(w, 0, Rain.Off);
    expect(big.mass).toBeGreaterThan(900);
    expect(radiusOf(big.mass) + radiusOf(small.mass)).toBeCloseTo(38, 4);
    expect(big.mass + small.mass).toBeCloseTo(1000, 6);
  });

  it('swallows a drop whose centre is well inside a bigger one, keeping momentum', () => {
    const w = empty();
    const big = addDrop(w, { x: 0, y: 0, mass: 900, vx: 0 });
    const small = addDrop(w, { x: 5, y: 0, mass: 100, vx: 50 });
    const before = momentum(w);
    step(w, 0, Rain.Off);
    expect(w.drops.has(small.id)).toBe(false);
    expect(big.mass).toBeCloseTo(1000, 6);
    expect(momentum(w)[0]).toBeCloseTo(before[0], 4);
  });

  it('reports players and bots that are swallowed, and by whom', () => {
    const w = empty();
    const shark = addDrop(w, { x: 0, y: 0, mass: 2000, kind: 'bot', name: 'Shark' });
    const player = addDrop(w, { x: 3, y: 0, mass: 300, kind: 'player', name: 'Minnow', peak: 450 });
    const gone = step(w, 0, Rain.Off);
    expect(gone).toEqual([{ id: player.id, kind: 'player', peak: 450, by: shark.id }]);
  });

  it('protects a freshly spawned drop from being absorbed', () => {
    const w = empty();
    addDrop(w, { x: 0, y: 0, mass: 5000 });
    const p = addDrop(w, { x: 10, y: 0, mass: 400, kind: 'player', safe: CONFIG.spawnSafe });
    expect(step(w, CONFIG.tick, Rain.Off)).toEqual([]);
    expect(p.mass).toBeCloseTo(400, 6);
  });

  it('bounces off the edge of the basin and stays inside it', () => {
    const d = { x: CONFIG.radius - 25, y: 0, vx: 200, vy: 0, mass: 400 };
    expect(drift(d, CONFIG.tick)).toBe(true);
    expect(d.vx).toBeLessThan(0);
    expect(Math.hypot(d.x, d.y) + radiusOf(d.mass)).toBeLessThanOrEqual(CONFIG.radius + 1e-9);
  });

  it('slows drifting drops with drag', () => {
    const d = { x: 0, y: 0, vx: 100, vy: 0, mass: 100 };
    for (let i = 0; i < 20; i++) drift(d, CONFIG.tick);
    expect(d.vx).toBeCloseTo(100 * Math.pow(1 - CONFIG.drag * CONFIG.tick, 20), 6);
  });

  it('evaporates the biggest drops towards the threshold', () => {
    const w = empty();
    const d = addDrop(w, { x: 0, y: 0, mass: CONFIG.evaporateFrom * 2 });
    for (let i = 0; i < 20 * 30; i++) step(w, CONFIG.tick, Rain.Off);
    expect(d.mass).toBeLessThan(CONFIG.evaporateFrom * 2);
    expect(d.mass).toBeGreaterThan(CONFIG.evaporateFrom);
  });

  it('rains until the basin is back to its level of water', () => {
    const w = empty();
    spawnActor(w, 'player', 'P', 0);
    for (let i = 0; i < 20 * 60; i++) step(w);
    const want = CONFIG.waterBase + CONFIG.waterPerActor;
    expect(totalWater(w)).toBeGreaterThan(want * 0.95);
    expect(totalWater(w)).toBeLessThan(want * 1.1);
  });

  it('reports only drops whose motion changed as changed', () => {
    const w = empty();
    const still = addDrop(w, { x: -500, y: 0, mass: 100, vx: 3 });
    const pusher = addDrop(w, { x: 500, y: 0, mass: 400 });
    takeChanges(w);
    push(w, pusher, 0);
    step(w, CONFIG.tick, Rain.Off);
    const { changed } = takeChanges(w);
    expect(changed).toContain(pusher.id);
    expect(changed).not.toContain(still.id);
  });
});

describe('Confluence bots', () => {
  it('flee a bigger drop bearing down on them', () => {
    const w = empty();
    const bot = addDrop(w, { x: 0, y: 0, mass: 800, kind: 'bot' });
    addDrop(w, { x: 120, y: 0, mass: 4000, vx: -60 });
    for (let i = 0; i < 20; i++) { steerBot(w, bot); step(w, CONFIG.tick, Rain.Off); }
    expect(bot.vx).toBeLessThan(-20);
  });

  it('chase and eat smaller drops', () => {
    const w = empty();
    const bot = addDrop(w, { x: 0, y: 0, mass: 800, kind: 'bot' });
    const meal = addDrop(w, { x: 250, y: 0, mass: 200 });
    for (let i = 0; i < 20 * 10 && w.drops.has(meal.id); i++) { steerBot(w, bot); step(w, CONFIG.tick, Rain.Off); }
    expect(w.drops.has(meal.id)).toBe(false);
  });

  it('mostly survive and grow in a busy basin', () => {
    const w = newWorld(mulberry(5));
    const bots: Drop[] = [];
    for (let i = 0; i < 8; i++) bots.push(spawnActor(w, 'bot', `Bot ${i}`, i, 250 + i * 150));
    let lost = 0;
    for (let i = 0; i < 20 * 60; i++) {
      for (const d of w.drops.values()) if (d.kind === 'bot') steerBot(w, d);
      lost += step(w).length;
    }
    const alive = bots.filter(b => w.drops.has(b.id));
    expect(lost).toBeLessThan(6);
    expect(Math.max(...alive.map(b => b.peak))).toBeGreaterThan(1500);
  });
});
