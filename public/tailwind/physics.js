// Tailwind's terrain and duck physics, kept free of the DOM so they can be tested.
//
// World coordinates have y pointing up, with the sea at y = 0. The terrain is a chain of
// islands, each a run of hills joined by cosine curves so the ground is smooth everywhere.

export const PX_PER_M = 20;
export const G = 1100, G_HEAVY = 3800;               // holding makes the duck heavy, so it dives
export const START_SPEED = 320, MIN_SPEED = 160;      // px/s; the duck always paddles forward on the ground
export const MAX_SPEED = 1400, FEVER_MAX = 1600;      // FEVER_MAX is 80 m/s (see src/games.ts)
export const FEVER_KICK = 220;                        // px/s added when a tailwind starts
export const PERFECT = 0.25, BAD = 0.6;               // landing quality: share of speed going into the ground
export const BAD_LANDING_KEEP = 0.75;
export const GROUND_DRAG = 0.12;                      // share of speed lost per second while sliding
export const MIN_FLIGHT = 0.3;                        // seconds in the air before a landing is judged
export const START_TIME = 45;                         // seconds of daylight at the start

export const islandBonus = i => Math.max(6, 18 - 2 * i);  // daylight gained on reaching island i (1-based)
export const islandLength = i => 9000 + 3000 * i;

export class Terrain {
  constructor(random = Math.random) {
    this.random = random;
    this.points = [{ x: -900, y: 300 }, { x: -200, y: 300 }];  // a flat-topped start, then downhill
    this.islands = [];  // [{ index, start, end }]
    this.addIsland(-200);
  }

  rand(a, b) { return a + this.random() * (b - a); }

  // Appends island n+1, starting at `x0` on the last point (a peak for the first island, a
  // valley at the waterline otherwise). Hills grow taller and wider on later islands.
  addIsland(x0) {
    const index = this.islands.length;
    const end = x0 + islandLength(index);
    const grow = 1 + 0.08 * index;
    let x = x0, peak = this.points[this.points.length - 1].y > 150;
    while (x < end - 1600) {
      peak = !peak;
      x += this.rand(450, 950) * grow;
      const y = peak ? Math.min(430, this.rand(190, 300) + 18 * index) : this.rand(40, 100);
      this.points.push({ x, y });
    }
    // Every island ends on a big ramp and a long drop to the water, where the next begins.
    if (peak) this.points.push({ x: (x += 450), y: this.rand(50, 90) });
    this.points.push({ x: (x += 500), y: Math.min(480, 360 + 20 * index) });
    this.points.push({ x: (x += 1100), y: 15 });
    this.islands.push({ index, start: x0, end: x });
  }

  ensure(x) {
    while (this.points[this.points.length - 1].x < x) this.addIsland(this.points[this.points.length - 1].x);
  }

  // Index of the point at or before x.
  segment(x) {
    this.ensure(x + 1);
    const p = this.points;
    let lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p[mid].x <= x) lo = mid; else hi = mid; }
    return lo;
  }

  height(x) {
    const i = this.segment(x), a = this.points[i], b = this.points[i + 1];
    const t = (x - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * (1 - Math.cos(Math.PI * t)) / 2;
  }

  slope(x) {
    const i = this.segment(x), a = this.points[i], b = this.points[i + 1];
    const t = (x - a.x) / (b.x - a.x);
    return (b.y - a.y) * Math.PI / 2 * Math.sin(Math.PI * t) / (b.x - a.x);
  }

  // 0-based island the point x is on.
  islandAt(x) {
    this.ensure(x + 1);
    for (const isl of this.islands) if (x < isl.end) return isl.index;
    return this.islands.length - 1;
  }
}

export function newDuck(terrain) {
  const x = -150;
  return { x, y: terrain.height(x), vx: START_SPEED, vy: 0, ground: true, air: 0 };
}

// Advances the duck by dt seconds and returns what happened: 'takeoff', 'perfect', 'bad' or
// 'land'. `held` is whether the player is holding (diving), `maxSpeed` the current cap.
export function step(d, terrain, held, dt, maxSpeed = MAX_SPEED) {
  const events = [];
  d.vy -= (held ? G_HEAVY : G) * dt;
  d.x += d.vx * dt;
  d.y += d.vy * dt;
  const h = terrain.height(d.x);
  if (d.y <= h) {
    const s = terrain.slope(d.x), len = Math.hypot(1, s);
    const nx = -s / len, ny = 1 / len;
    const vn = d.vx * nx + d.vy * ny;  // negative when moving into the ground
    d.y = h;
    let keep = 1;
    if (!d.ground) {
      if (d.air >= MIN_FLIGHT) {
        const speed = Math.hypot(d.vx, d.vy);
        const impact = speed > 0 ? Math.max(0, -vn) / speed : 0;
        const kind = impact < PERFECT && s < -0.05 ? 'perfect' : impact > BAD ? 'bad' : 'land';
        if (kind === 'bad') keep = BAD_LANDING_KEEP;
        events.push(kind);
      }
      d.ground = true;
    }
    if (vn < 0) { d.vx -= vn * nx; d.vy -= vn * ny; }
    keep *= 1 - GROUND_DRAG * dt;
    d.vx *= keep; d.vy *= keep;
    if (d.vx < MIN_SPEED) { d.vx = MIN_SPEED; d.vy = MIN_SPEED * s; }
  } else if (d.y > h + 0.5) {
    if (d.ground) { d.ground = false; d.air = 0; events.push('takeoff'); }
    d.air += dt;
  }
  const speed = Math.hypot(d.vx, d.vy);
  if (speed > maxSpeed) { d.vx *= maxSpeed / speed; d.vy *= maxSpeed / speed; }
  return events;
}
