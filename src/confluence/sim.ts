// Confluence's simulation, after Osmos: drops of water drifting in a round basin. Where two
// drops overlap, the bigger one draws water from the smaller until they only just touch, or
// swallows it whole. A drop moves by flicking out a droplet of itself, which pushes it the other
// way, so every move costs a little size. Rain keeps adding small drops and the biggest slowly
// evaporate, so the basin never ends up as one giant drop.
//
// Mass is area, and a drop's radius is the square root of its mass. The simulation is pure and
// seeded; clients run the same `drift` between updates, so it must stay deterministic.

export const CONFIG = {
  radius: 2000,
  tick: 1 / 20,
  drag: 0.12,              // share of speed lost per second
  bounce: 0.6,             // share of speed kept off the basin's edge
  ejectShare: 0.025,       // share of mass flicked out per push
  ejectMin: 3,
  ejectSpeed: 320,         // how fast a flicked droplet leaves, relative to the drop
  pushCooldown: 0.1,       // seconds between pushes
  minPushMass: 40,         // too small to push any more
  spawnMass: 400,
  evaporateFrom: 6000,     // drops bigger than this lose some of the excess every second
  evaporateRate: 0.015,
  rainPerTick: 3,
  waterBase: 50000,        // the basin tops itself up to this much water, plus some per player
  waterPerActor: 2500,
  maxDrops: 520,           // times the average raindrop (about 113) must comfortably exceed waterBase
  spawnSafe: 2,            // seconds after spawning when a drop can't be absorbed
} as const;

export type Kind = 'mote' | 'player' | 'bot';

export interface Drop {
  id: number;
  kind: Kind;
  name: string;
  color: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mass: number;
  peak: number;
  cooldown: number;
  safe: number;
}

export interface Absorbed {
  id: number;
  kind: Kind;
  peak: number;
  by: number;  // the drop that took the last of it
}

export interface World {
  drops: Map<number, Drop>;
  nextId: number;
  random: () => number;
  // Drops whose motion changed other than by drifting, and ones that were removed, since the
  // last call to takeChanges. Clients can't predict these, so they're what gets sent.
  changed: Set<number>;
  removed: number[];
}

export const radiusOf = (mass: number) => Math.sqrt(mass);

export function mulberry(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newWorld(random: () => number = Math.random): World {
  const world: World = { drops: new Map(), nextId: 1, random, changed: new Set(), removed: [] };
  rain(world, Infinity);
  takeChanges(world);
  return world;
}

export function takeChanges(world: World) {
  const changes = { changed: [...world.changed].filter(id => world.drops.has(id)), removed: world.removed };
  world.changed = new Set();
  world.removed = [];
  return changes;
}

export function addDrop(world: World, props: Partial<Drop> & { x: number; y: number; mass: number }): Drop {
  const d: Drop = {
    id: world.nextId++, kind: 'mote', name: '', color: 0, vx: 0, vy: 0, peak: props.mass, cooldown: 0, safe: 0, ...props,
  };
  world.drops.set(d.id, d);
  world.changed.add(d.id);
  return d;
}

function removeDrop(world: World, id: number) {
  if (world.drops.delete(id)) world.removed.push(id);
}

function randomPoint(world: World, maxR: number): [number, number] {
  const r = Math.sqrt(world.random()) * maxR, a = world.random() * Math.PI * 2;
  return [r * Math.cos(a), r * Math.sin(a)];
}

// Adds a player's or bot's drop in the clearest spot out of a handful of tries.
export function spawnActor(world: World, kind: 'player' | 'bot', name: string, color: number, mass: number = CONFIG.spawnMass): Drop {
  let best: [number, number] = [0, 0], bestGap = -Infinity;
  for (let tries = 0; tries < 16; tries++) {
    const p = randomPoint(world, CONFIG.radius * 0.8);
    let gap = Infinity;
    for (const d of world.drops.values()) {
      if (d.mass < mass * 0.5) continue;  // small drops nearby are food, not a threat
      gap = Math.min(gap, Math.hypot(d.x - p[0], d.y - p[1]) - radiusOf(d.mass));
    }
    if (gap > bestGap) { best = p; bestGap = gap; }
  }
  return addDrop(world, { kind, name, color, x: best[0], y: best[1], mass, safe: CONFIG.spawnSafe });
}

export function totalWater(world: World) {
  let m = 0;
  for (const d of world.drops.values()) m += d.mass;
  return m;
}

// Rain: new small drops fall wherever the basin is short of water.
function rain(world: World, perTick: number) {
  let actors = 0;
  for (const d of world.drops.values()) if (d.kind !== 'mote') actors++;
  const want = CONFIG.waterBase + CONFIG.waterPerActor * actors;
  let water = totalWater(world);
  for (let n = 0; n < perTick && water < want && world.drops.size < CONFIG.maxDrops; n++) {
    const [x, y] = randomPoint(world, CONFIG.radius - 80);
    const mass = 20 + Math.pow(world.random(), 2) * 280;  // mostly small, a few bigger; about 113 on average
    const a = world.random() * Math.PI * 2, speed = world.random() * 30;
    addDrop(world, { x, y, mass, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed });
    water += mass;
  }
}

// Flicks a droplet out of `d` towards `angle`, which pushes `d` the opposite way. Momentum is
// conserved. Returns false if the drop is too small or pushed too recently.
export function push(world: World, d: Drop, angle: number): boolean {
  if (d.cooldown > 0 || d.mass < CONFIG.minPushMass) return false;
  const e = Math.max(CONFIG.ejectMin, d.mass * CONFIG.ejectShare);
  const cx = Math.cos(angle), cy = Math.sin(angle);
  d.mass -= e;
  d.vx -= cx * CONFIG.ejectSpeed * e / d.mass;
  d.vy -= cy * CONFIG.ejectSpeed * e / d.mass;
  const gap = radiusOf(d.mass) + radiusOf(e) + 1;
  addDrop(world, {
    x: d.x + cx * gap, y: d.y + cy * gap, mass: e,
    vx: d.vx + cx * CONFIG.ejectSpeed * (1 + e / d.mass), vy: d.vy + cy * CONFIG.ejectSpeed * (1 + e / d.mass),
  });
  d.cooldown = CONFIG.pushCooldown;
  world.changed.add(d.id);
  return true;
}

// Moves a drop for dt seconds with drag, bouncing off the edge. Clients run this too, so the
// arithmetic here must match public/confluence/game.js exactly. Returns true if it bounced.
export function drift(d: { x: number; y: number; vx: number; vy: number; mass: number }, dt: number, radius: number = CONFIG.radius): boolean {
  const k = 1 - CONFIG.drag * dt;
  d.vx *= k; d.vy *= k;
  d.x += d.vx * dt; d.y += d.vy * dt;
  const r = radiusOf(d.mass), dist = Math.hypot(d.x, d.y);
  if (dist + r <= radius || dist === 0) return false;
  const nx = d.x / dist, ny = d.y / dist, out = d.vx * nx + d.vy * ny;
  if (out > 0) { d.vx -= (1 + CONFIG.bounce) * out * nx; d.vy -= (1 + CONFIG.bounce) * out * ny; }
  const inside = Math.max(0, radius - r);
  d.x = nx * inside; d.y = ny * inside;
  return true;
}

// Where two drops overlap, water moves from the smaller to the bigger until they just touch:
// with total area S and centres D apart, the smaller's new radius is (D - √(2S - D²)) / 2.
// If that would be nothing (or less), the smaller is swallowed.
function absorb(world: World, big: Drop, small: Drop, dist: number): boolean {
  const rs = radiusOf(small.mass), rb = radiusOf(big.mass);
  if (dist >= rs + rb) return false;
  const S = big.mass + small.mass, disc = 2 * S - dist * dist;
  const rsNew = disc >= 0 ? (dist - Math.sqrt(disc)) / 2 : -1;
  const moved = rsNew <= 1 ? small.mass : small.mass - rsNew * rsNew;
  if (moved <= 0) return false;
  // The moved water brings its momentum with it.
  big.vx = (big.vx * big.mass + small.vx * moved) / (big.mass + moved);
  big.vy = (big.vy * big.mass + small.vy * moved) / (big.mass + moved);
  big.mass += moved;
  small.mass -= moved;
  world.changed.add(big.id);
  world.changed.add(small.id);
  return small.mass <= 1;
}

const CELL = 160;
const key = (cx: number, cy: number) => (cx + 1000) * 4000 + (cy + 1000);

export enum Rain { On, Off }  // tests switch rain off to check that water is conserved

// Advances the world by dt seconds and returns the players and bots that were absorbed.
export function step(world: World, dt: number = CONFIG.tick, weather: Rain = Rain.On): Absorbed[] {
  for (const d of world.drops.values()) {
    if (drift(d, dt)) world.changed.add(d.id);
    d.cooldown = Math.max(0, d.cooldown - dt);
    d.safe = Math.max(0, d.safe - dt);
  }

  // Find overlapping pairs with a grid, then settle them biggest first so a large drop
  // passing through a cluster takes it in a sensible order.
  const grid = new Map<number, Drop[]>();
  for (const d of world.drops.values()) {
    const r = radiusOf(d.mass);
    for (let cx = Math.floor((d.x - r) / CELL); cx <= Math.floor((d.x + r) / CELL); cx++) {
      for (let cy = Math.floor((d.y - r) / CELL); cy <= Math.floor((d.y + r) / CELL); cy++) {
        const k = key(cx, cy);
        let cell = grid.get(k);
        if (!cell) grid.set(k, (cell = []));
        cell.push(d);
      }
    }
  }
  const pairs = new Map<string, [Drop, Drop, number]>();
  for (const cell of grid.values()) {
    for (let i = 0; i < cell.length; i++) for (let j = i + 1; j < cell.length; j++) {
      const a = cell[i], b = cell[j];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist >= radiusOf(a.mass) + radiusOf(b.mass)) continue;
      const pk = a.id < b.id ? `${a.id},${b.id}` : `${b.id},${a.id}`;
      if (!pairs.has(pk)) pairs.set(pk, [a, b, dist]);
    }
  }
  const absorbed: Absorbed[] = [];
  const ordered = [...pairs.values()].sort((p, q) => Math.max(q[0].mass, q[1].mass) - Math.max(p[0].mass, p[1].mass));
  for (const [a, b] of ordered) {
    if (!world.drops.has(a.id) || !world.drops.has(b.id)) continue;
    // The bigger drop wins; exact ties go to the older one.
    const [big, small] = a.mass > b.mass || (a.mass === b.mass && a.id < b.id) ? [a, b] : [b, a];
    if (small.safe > 0 || big.safe > 0 && small.kind !== 'mote') continue;
    if (absorb(world, big, small, Math.hypot(a.x - b.x, a.y - b.y))) {
      if (small.kind !== 'mote') absorbed.push({ id: small.id, kind: small.kind, peak: small.peak, by: big.id });
      big.mass += small.mass;
      removeDrop(world, small.id);
    }
  }

  for (const d of world.drops.values()) {
    if (d.mass > CONFIG.evaporateFrom) {
      d.mass -= (d.mass - CONFIG.evaporateFrom) * CONFIG.evaporateRate * dt;
      world.changed.add(d.id);
    }
    if (d.kind !== 'mote') d.peak = Math.max(d.peak, d.mass);
  }
  // Drops too small to see just dry up.
  for (const d of world.drops.values()) if (d.kind === 'mote' && d.mass < 2) removeDrop(world, d.id);
  if (weather === Rain.On) rain(world, CONFIG.rainPerTick);
  return absorbed;
}

// ---------- bots ----------
// A bot wants to drift towards the best meal it can catch and away from anything that could
// swallow it, and pushes when its velocity is far from that. Pushing costs mass, so it only
// pushes when the correction is worth it.
export function steerBot(world: World, d: Drop) {
  if (d.cooldown > 0 || d.mass < CONFIG.minPushMass * 3) return;
  const r = radiusOf(d.mass);
  let wantX = 0, wantY = 0, bestMeal = 0, mealX = 0, mealY = 0, threatened = false;
  for (const o of world.drops.values()) {
    if (o === d) continue;
    const dx = o.x - d.x, dy = o.y - d.y, dist = Math.hypot(dx, dy), gap = dist - r - radiusOf(o.mass);
    if (gap > 600) continue;
    if (o.mass > d.mass * 0.95) {
      // Flee harder from bigger drops that are close or closing in.
      const closing = -((o.vx - d.vx) * dx + (o.vy - d.vy) * dy) / (dist || 1);
      const near = Math.max(0, Math.min(1, (300 - gap) / 300));
      const threat = near * (1 + Math.max(0, closing) / 60) * 120;
      if (gap < 250) threatened = true;
      wantX -= dx / (dist || 1) * threat;
      wantY -= dy / (dist || 1) * threat;
    } else if (o.mass < d.mass * 0.8 && o.mass > d.mass * 0.05 && o.safe === 0) {
      // Each push costs 2.5% of the bot, so a meal smaller than a couple of pushes isn't worth the chase.
      const worth = o.mass / Math.max(40, gap);
      if (worth > bestMeal) { bestMeal = worth; mealX = dx / (dist || 1); mealY = dy / (dist || 1); }
    }
  }
  // Food can wait while something big is close; otherwise a droplet next to a threat (often one
  // the bot flicked out itself) can lure it back in.
  if (!threatened) { wantX += mealX * 60; wantY += mealY * 60; }
  // Keep off the edge.
  const fromCentre = Math.hypot(d.x, d.y);
  if (fromCentre + r > CONFIG.radius - 200) { wantX -= d.x / fromCentre * 50; wantY -= d.y / fromCentre * 50; }
  const want = Math.hypot(wantX, wantY);
  if (want > 90) { wantX *= 90 / want; wantY *= 90 / want; }
  const ex = wantX - d.vx, ey = wantY - d.vy;
  // Push opposite to the change in velocity we want: always when something big is close, and
  // only some of the time when just chasing food, to save water.
  const off = Math.hypot(ex, ey);
  if (threatened ? off > 30 : off > 40 && world.random() < 0.25) push(world, d, Math.atan2(-ey, -ex));
}
