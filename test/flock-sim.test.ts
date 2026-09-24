import { describe, expect, it } from 'vitest';
import {
  addCrumb, buildGrid, CONFIG, type Duck, mulberry, newWorld, spawnDuck, step, steerBot, takeCrumbChanges, type World,
} from '../src/flock/sim';

function world(seed = 1): World {
  const w = newWorld(mulberry(seed));
  w.crumbs.clear();  // most tests want an empty pond; topUpCrumbs refills it on each step
  return w;
}

// Puts a duck at (x, y) facing `angle` with a straight trail behind it and no spawn protection.
function place(w: World, x: number, y: number, angle: number, length: number = CONFIG.startLength, name = 'Duck'): Duck {
  const d = spawnDuck(w, name, 0, false);
  Object.assign(d, { x, y, angle, target: angle, length, peak: length, safe: 0, path: [] as number[] });
  for (let i = 0; i <= (length + 2) * 2; i++) d.path.push(x - Math.cos(angle) * i * CONFIG.spacing / 2, y - Math.sin(angle) * i * CONFIG.spacing / 2);
  step(w, 0);
  return d;
}

describe('Flock simulation', () => {
  it('moves a duck forward at its speed and trails its ducklings behind it', () => {
    const w = world();
    const d = place(w, 0, 0, 0);
    for (let i = 0; i < 20; i++) step(w);
    expect(d.x).toBeCloseTo(CONFIG.speed * 20 * CONFIG.tick, 5);
    expect(d.chicks).toHaveLength(d.length * 2);
    // Ducklings sit behind the head, one spacing apart.
    expect(d.chicks[0]).toBeCloseTo(d.x - CONFIG.spacing, 3);
    expect(d.chicks[2]).toBeCloseTo(d.x - 2 * CONFIG.spacing, 3);
  });

  it('turns no faster than the turn rate', () => {
    const w = world();
    const d = place(w, 0, 0, 0);
    d.target = Math.PI / 2;
    step(w);
    expect(d.angle).toBeCloseTo(CONFIG.turn / (1 + d.length / 120) * CONFIG.tick, 6);
  });

  it('grows by one duckling for every four breadcrumbs, and fully from a loose duckling', () => {
    const w = world();
    const d = place(w, 0, 0, 0);
    for (let i = 0; i < 4; i++) addCrumb(w, d.x + 5, d.y, CONFIG.crumbValue);
    step(w);
    expect(d.length).toBe(CONFIG.startLength + 1);
    addCrumb(w, d.x + 5, d.y, 1);
    step(w);
    expect(d.length).toBe(CONFIG.startLength + 2);
    expect(d.peak).toBe(CONFIG.startLength + 2);
  });

  it('kills a duck whose head runs into another duck\'s ducklings and scatters them as loose ducklings', () => {
    const w = world();
    const wall = place(w, 0, 0, Math.PI / 2, 20, 'Wall');  // a line of ducklings along the y axis below the head
    const victim = place(w, -40, -200, 0, 10, 'Victim');   // heading straight across that line
    takeCrumbChanges(w);
    let deaths: ReturnType<typeof step> = [];
    for (let i = 0; i < 20 && !deaths.length; i++) deaths = step(w);
    expect(deaths).toEqual([{ id: victim.id, peak: 10, killer: wall.id }]);
    expect(w.ducks.has(victim.id)).toBe(false);
    const loose = takeCrumbChanges(w).added.filter(c => c.value === 1);
    expect(loose).toHaveLength(10);
  });

  it('kills a duck that swims into the shore', () => {
    const w = world();
    const d = place(w, CONFIG.radius - 20, 0, 0);
    const deaths = step(w);
    expect(deaths).toEqual([{ id: d.id, peak: d.peak, killer: null }]);
  });

  it('protects a freshly spawned duck', () => {
    const w = world();
    const d = spawnDuck(w, 'New', 0, false);
    Object.assign(d, { x: CONFIG.radius - 5, y: 0 });
    expect(step(w)).toEqual([]);
  });

  it('spends ducklings while boosting and drops them as crumbs', () => {
    const w = world();
    const d = place(w, 0, 0, 0, 10);
    d.boost = true;
    takeCrumbChanges(w);
    for (let i = 0; i < 20; i++) step(w);  // one second
    expect(d.length).toBe(10 - CONFIG.boostCost);
    expect(d.x).toBeCloseTo(CONFIG.boostSpeed, 0);
    expect(takeCrumbChanges(w).added.filter(c => c.value === 0.5)).toHaveLength(CONFIG.boostCost);
  });

  it('never boosts below the starting length', () => {
    const w = world();
    const d = place(w, 0, 0, 0);
    d.boost = true;
    for (let i = 0; i < 40; i++) step(w);
    expect(d.length).toBe(CONFIG.startLength);
    expect(d.x).toBeCloseTo(CONFIG.speed * 2, 0);
  });

  it('keeps the pond stocked with breadcrumbs', () => {
    const w = newWorld(mulberry(2));
    spawnDuck(w, 'A', 0, false);
    step(w);
    const breadcrumbs = [...w.crumbs.values()].filter(c => c.value < 1).length;
    expect(breadcrumbs).toBe(CONFIG.crumbsBase + CONFIG.crumbsPerDuck);
  });

  it('lets two ducks knock each other out in the same tick', () => {
    const w = world();
    // A heads right into B's line of ducklings at x = 30, while B heads right into A's at x = -20.
    const a = place(w, 0, 0, 0, 14, 'A');
    const b = place(w, -52, 100, 0, 14, 'B');
    a.path = [0, 0, -20, 0, -20, 300];
    b.path = [-52, 100, -52, 120, 30, 120, 30, -200];
    expect(step(w, 0)).toEqual([]);  // both heads start just clear of the other line
    const deaths = step(w);
    expect(deaths.map(d => d.id).sort()).toEqual([a.id, b.id].sort());
    expect(deaths.find(d => d.id === a.id)?.killer).toBe(b.id);
    expect(deaths.find(d => d.id === b.id)?.killer).toBe(a.id);
  });
});

describe('Flock bots', () => {
  it('survive a crowded pond for a while and find food', () => {
    const w = newWorld(mulberry(3));
    const bots = Array.from({ length: 10 }, (_, i) => spawnDuck(w, `Bot ${i}`, i, true));
    let deaths = 0;
    for (let i = 0; i < 20 * 60; i++) {  // one minute
      const grid = buildGrid(w);
      for (const d of w.ducks.values()) steerBot(w, d, grid);
      deaths += step(w).length;
      while (w.ducks.size < 10) spawnDuck(w, 'Bot', 0, true);
    }
    // Bots should mostly avoid dying, and should grow by eating.
    expect(deaths).toBeLessThan(15);
    expect(Math.max(...[...w.ducks.values()].map(d => d.peak))).toBeGreaterThan(20);
    expect(bots.length).toBe(10);
  });

  it('steers away from the shore', () => {
    const w = world();
    const d = place(w, CONFIG.radius - 120, 0, 0);
    for (let i = 0; i < 40; i++) { steerBot(w, d, buildGrid(w)); expect(step(w)).toEqual([]); }
  });
});
