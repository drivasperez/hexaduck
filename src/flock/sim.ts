// Flock's simulation: a pond of mother ducks, each trailed by a line of ducklings. It is pure
// (no I/O, seeded randomness) so the Durable Object in ./pond.ts can run it and tests can too.
//
// Each duck steers towards a target angle. Eating crumbs grows the line; boosting spends it.
// A duck whose head touches another duck's ducklings, or the edge of the pond, dies, and its
// ducklings scatter as loose ones that anyone can collect.

export const CONFIG = {
  radius: 2200,          // the pond is a circle this big, centred on 0,0
  speed: 230,            // units per second
  boostSpeed: 440,
  turn: 4.2,             // radians per second for a short duck; long ducks turn slower
  spacing: 22,           // distance between ducklings along the trail
  startLength: 4,
  maxLength: 220,
  headRadius: 15,
  crumbValue: 0.25,      // ducklings gained per crumb
  boostCost: 2,          // ducklings spent per second of boosting
  spawnSafe: 1.5,        // seconds after spawning when a duck can't die
  crumbsBase: 450,
  crumbsPerDuck: 12,
  tick: 1 / 20,
} as const;

export const duckRadius = (length: number) => 10 + Math.min(8, length / 20);
const turnRate = (length: number) => CONFIG.turn / (1 + length / 120);

export interface Duck {
  id: number;
  name: string;
  color: number;
  bot: boolean;
  x: number;
  y: number;
  angle: number;
  target: number;
  boost: boolean;
  length: number;
  growth: number;
  boostDebt: number;
  peak: number;
  safe: number;
  // Past head positions, newest first, as flat [x0, y0, x1, y1, ...].
  path: number[];
  // Duckling positions for this tick, flat [x, y, ...], nearest the head first.
  chicks: number[];
}

export interface Crumb {
  id: number;
  x: number;
  y: number;
  value: number;  // 1 for a loose duckling, less for a breadcrumb
}

export interface Death {
  id: number;
  peak: number;
  killer: number | null;  // the duck whose ducklings it hit, or null for the edge
}

export interface World {
  ducks: Map<number, Duck>;
  crumbs: Map<number, Crumb>;
  nextId: number;
  random: () => number;
  // Changes since the last call to takeCrumbChanges, for sending to clients.
  added: Crumb[];
  removed: number[];
}

export function mulberry(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newWorld(random: () => number = Math.random): World {
  const world: World = { ducks: new Map(), crumbs: new Map(), nextId: 1, random, added: [], removed: [] };
  topUpCrumbs(world);
  world.added = [];
  return world;
}

function randomPoint(world: World, maxR: number): [number, number] {
  const r = Math.sqrt(world.random()) * maxR, a = world.random() * Math.PI * 2;
  return [r * Math.cos(a), r * Math.sin(a)];
}

export function addCrumb(world: World, x: number, y: number, value: number): Crumb {
  const c = { id: world.nextId++, x, y, value };
  world.crumbs.set(c.id, c);
  world.added.push(c);
  return c;
}

function removeCrumb(world: World, id: number) {
  if (world.crumbs.delete(id)) world.removed.push(id);
}

export function takeCrumbChanges(world: World) {
  const changes = { added: world.added, removed: world.removed };
  world.added = [];
  world.removed = [];
  return changes;
}

function topUpCrumbs(world: World) {
  const want = CONFIG.crumbsBase + CONFIG.crumbsPerDuck * world.ducks.size;
  let breadcrumbs = 0;
  for (const c of world.crumbs.values()) if (c.value < 1) breadcrumbs++;
  for (let i = breadcrumbs; i < want; i++) {
    const [x, y] = randomPoint(world, CONFIG.radius - 60);
    addCrumb(world, x, y, CONFIG.crumbValue);
  }
}

// Adds a duck somewhere clear of other ducks' heads, facing roughly towards the middle.
export function spawnDuck(world: World, name: string, color: number, bot: boolean): Duck {
  let best: [number, number] = [0, 0], bestGap = -1;
  for (let tries = 0; tries < 12; tries++) {
    const p = randomPoint(world, CONFIG.radius * 0.75);
    let gap = Infinity;
    for (const d of world.ducks.values()) gap = Math.min(gap, Math.hypot(d.x - p[0], d.y - p[1]));
    if (gap > bestGap) { best = p; bestGap = gap; }
  }
  const [x, y] = best;
  const angle = Math.atan2(-y, -x) + (world.random() - 0.5);
  const duck: Duck = {
    id: world.nextId++, name, color, bot, x, y, angle, target: angle, boost: false,
    length: CONFIG.startLength, growth: 0, boostDebt: 0, peak: CONFIG.startLength, safe: CONFIG.spawnSafe,
    path: [], chicks: [],
  };
  // Lay the starting trail out straight behind the duck.
  for (let i = 0; i <= (CONFIG.startLength + 2) * 2; i++) {
    duck.path.push(x - Math.cos(angle) * i * CONFIG.spacing / 2, y - Math.sin(angle) * i * CONFIG.spacing / 2);
  }
  placeChicks(duck);
  world.ducks.set(duck.id, duck);
  return duck;
}

// Walks the path from the head and puts a duckling every `spacing` units.
function placeChicks(d: Duck) {
  const out: number[] = [];
  const p = d.path;
  let want = CONFIG.spacing, walked = 0;
  for (let i = 0; i + 3 < p.length && out.length < d.length * 2; i += 2) {
    const seg = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    while (seg > 0 && walked + seg >= want && out.length < d.length * 2) {
      const k = (want - walked) / seg;
      out.push(p[i] + (p[i + 2] - p[i]) * k, p[i + 1] + (p[i + 3] - p[i + 1]) * k);
      want += CONFIG.spacing;
    }
    walked += seg;
  }
  // If the trail is still too short (the duck just grew), stack the rest at the tail.
  while (out.length < d.length * 2) out.push(out.length ? out[out.length - 2] : d.x, out.length ? out[out.length - 1] : d.y);
  d.chicks = out;
}

function trimPath(d: Duck) {
  const keep = (d.length + 2) * CONFIG.spacing;
  const p = d.path;
  let walked = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    walked += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    if (walked > keep) { p.length = i + 4; return; }
  }
}

// A coarse grid of every duckling, rebuilt each tick, for collision and bot look-ahead.
const CELL = 64;
export type Grid = Map<number, number[]>;  // cell key -> flat [x, y, radius, ownerId, ...]
const cellKey = (cx: number, cy: number) => (cx + 1000) * 4000 + (cy + 1000);

export function buildGrid(world: World): Grid {
  const grid: Grid = new Map();
  for (const d of world.ducks.values()) {
    const r = duckRadius(d.length);
    for (let i = 0; i < d.chicks.length; i += 2) {
      const key = cellKey(Math.floor(d.chicks[i] / CELL), Math.floor(d.chicks[i + 1] / CELL));
      let cell = grid.get(key);
      if (!cell) grid.set(key, (cell = []));
      cell.push(d.chicks[i], d.chicks[i + 1], r, d.id);
    }
  }
  return grid;
}

// The id of a duck (other than `self`) with a duckling within `r` of (x, y), or null.
export function hitAt(grid: Grid, x: number, y: number, r: number, self: number): number | null {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
    const cell = grid.get(cellKey(i, j));
    if (!cell) continue;
    for (let k = 0; k < cell.length; k += 4) {
      if (cell[k + 3] === self) continue;
      const dx = cell[k] - x, dy = cell[k + 1] - y, rr = r + cell[k + 2];
      if (dx * dx + dy * dy < rr * rr) return cell[k + 3];
    }
  }
  return null;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// Advances the world by dt seconds and returns the ducks that died.
export function step(world: World, dt: number = CONFIG.tick): Death[] {
  for (const d of world.ducks.values()) {
    const diff = wrapAngle(d.target - d.angle), max = turnRate(d.length) * dt;
    d.angle = wrapAngle(d.angle + Math.max(-max, Math.min(max, diff)));
    const boosting = d.boost && d.length > CONFIG.startLength;
    const speed = boosting ? CONFIG.boostSpeed : CONFIG.speed;
    if (boosting) {
      d.boostDebt += CONFIG.boostCost * dt;
      // The small allowance stops float error from dropping one duckling in twenty ticks.
      while (d.boostDebt >= 1 - 1e-9 && d.length > CONFIG.startLength) {
        d.boostDebt -= 1;
        d.length--;
        // Boosting leaves a trail of crumbs worth half a duckling.
        const tx = d.chicks[d.chicks.length - 2] ?? d.x, ty = d.chicks[d.chicks.length - 1] ?? d.y;
        addCrumb(world, tx, ty, 0.5);
      }
    } else d.boostDebt = 0;
    d.x += Math.cos(d.angle) * speed * dt;
    d.y += Math.sin(d.angle) * speed * dt;
    d.path.unshift(d.x, d.y);
    trimPath(d);
    placeChicks(d);
    d.safe = Math.max(0, d.safe - dt);
  }

  // Eating
  for (const d of world.ducks.values()) {
    const reach = CONFIG.headRadius + 12;
    for (const c of world.crumbs.values()) {
      const dx = c.x - d.x, dy = c.y - d.y;
      if (dx * dx + dy * dy > reach * reach) continue;
      removeCrumb(world, c.id);
      d.growth += c.value;
    }
    while (d.growth >= 1 && d.length < CONFIG.maxLength) { d.growth -= 1; d.length++; }
    if (d.length >= CONFIG.maxLength) d.growth = 0;
    d.peak = Math.max(d.peak, d.length);
  }

  // Collisions are judged against everyone's positions after moving, then applied together,
  // so two ducks can knock each other out in the same tick.
  const grid = buildGrid(world);
  const deaths: Death[] = [];
  for (const d of world.ducks.values()) {
    if (d.safe > 0) continue;
    if (Math.hypot(d.x, d.y) > CONFIG.radius - CONFIG.headRadius) { deaths.push({ id: d.id, peak: d.peak, killer: null }); continue; }
    const killer = hitAt(grid, d.x, d.y, CONFIG.headRadius, d.id);
    if (killer !== null) deaths.push({ id: d.id, peak: d.peak, killer });
  }
  for (const death of deaths) scatter(world, death.id);
  topUpCrumbs(world);
  return deaths;
}

// Removes a duck and leaves its ducklings behind as loose ones.
export function scatter(world: World, id: number) {
  const d = world.ducks.get(id);
  if (!d) return;
  world.ducks.delete(id);
  for (let i = 0; i < d.chicks.length; i += 2) {
    const jitter = () => (world.random() - 0.5) * 16;
    const x = d.chicks[i] + jitter(), y = d.chicks[i + 1] + jitter();
    if (Math.hypot(x, y) < CONFIG.radius - 30) addCrumb(world, x, y, 1);
  }
}

// ---------- bots ----------
// A bot heads for the most valuable crumb nearby, but first checks a fan of directions ahead
// and steers away from any that run into ducklings or the shore.
export function steerBot(world: World, d: Duck, grid: Grid) {
  let goal = d.angle, goalScore = -Infinity, tooClose = -Infinity;
  // A crumb inside either of the tightest circles the duck can swim can't be reached by turning
  // towards it: chasing it just orbits it, and so does settling for food behind the duck.
  const circle = CONFIG.speed / turnRate(d.length), reach = CONFIG.headRadius + 12;
  const nx = -Math.sin(d.angle) * circle, ny = Math.cos(d.angle) * circle;
  for (const c of world.crumbs.values()) {
    const dx = c.x - d.x, dy = c.y - d.y, dist = Math.hypot(dx, dy);
    if (dist > 700) continue;
    // Worth, less the seconds it would take to turn and swim there, so food ahead wins over
    // food behind that would need a loop to reach.
    const toward = Math.atan2(dy, dx);
    const seconds = dist / CONFIG.speed + Math.abs(wrapAngle(toward - d.angle)) / turnRate(d.length);
    const score = c.value * 3 - seconds * 1.2;
    const inside = dist > reach && (Math.hypot(dx - nx, dy - ny) < circle - reach || Math.hypot(dx + nx, dy + ny) < circle - reach);
    if (inside) tooClose = Math.max(tooClose, c.value * 3 - dist / CONFIG.speed * 1.2);
    else if (score > goalScore) { goalScore = score; goal = toward; }
  }
  // The best food is too close to turn onto: swim straight until it's far enough to come back for.
  if (tooClose > goalScore) { goal = d.angle; goalScore = tooClose; }
  else if (goalScore === -Infinity) goal = Math.atan2(-d.y, -d.x);  // nothing nearby: head for the middle

  // Try swimming towards each of a fan of headings for the next 0.64 s, turning at the duck's
  // real rate, and see which of those curved paths runs into ducklings or the shore.
  const rate = turnRate(d.length), dt = 0.08;
  // Where nearby ducks' heads are heading: their ducklings will soon be there too.
  const ahead: number[] = [];
  for (const o of world.ducks.values()) {
    if (o === d || Math.hypot(o.x - d.x, o.y - d.y) > 400) continue;
    for (const t of [0.15, 0.3, 0.45]) ahead.push(o.x + Math.cos(o.angle) * CONFIG.speed * t, o.y + Math.sin(o.angle) * CONFIG.speed * t);
  }
  const nearHead = (x: number, y: number) => {
    for (let i = 0; i < ahead.length; i += 2) if (Math.hypot(ahead[i] - x, ahead[i + 1] - y) < CONFIG.headRadius * 2 + 10) return true;
    return false;
  };
  let best = goal, bestCost = Infinity;
  for (const off of [0, -0.4, 0.4, -0.8, 0.8, -1.3, 1.3, -2, 2, Math.PI]) {
    const a = d.angle + off;
    let x = d.x, y = d.y, h = d.angle, danger = 0;
    for (let k = 1; k <= 8; k++) {
      const diff = wrapAngle(a - h);
      h += Math.max(-rate * dt, Math.min(rate * dt, diff));
      x += Math.cos(h) * CONFIG.speed * dt;
      y += Math.sin(h) * CONFIG.speed * dt;
      // Sooner collisions count for more.
      if (Math.hypot(x, y) > CONFIG.radius - 40) danger += 9 - k;
      if (hitAt(grid, x, y, CONFIG.headRadius + 8, d.id) !== null) danger += (9 - k) * 2;
      else if (nearHead(x, y)) danger += 9 - k;
    }
    const cost = danger * 10 + Math.abs(wrapAngle(a - goal));
    if (cost < bestCost) { bestCost = cost; best = a; }
  }
  d.target = best;
  d.boost = d.length > 12 && goalScore > 1.5 && bestCost < 1 && world.random() < 0.05;
}
