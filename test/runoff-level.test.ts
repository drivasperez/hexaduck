import { describe, expect, it } from 'vitest';
import {
  G, GLIDE_FALL, GLIDE_TIME, JUMP_V, MAX_SPEED, nextBuilding, ROOF_MAX, ROOF_MIN, START_SPEED,
} from '../public/runoff/level.js';

interface Roof { x: number; w: number; top: number }

// A seeded generator so failures are reproducible.
function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

enum Glide { Off, On }

// Mirrors the duck's airborne update in public/runoff/game.js: holding jump the whole time,
// taking off at `takeoffX`, and landing by the same rule as the game (front or back foot over
// the roof, arriving from above or close enough to step up).
function clears(from: Roof, to: Roof, speed: number, takeoffX: number, glide: Glide): boolean {
  const dt = 1 / 120;
  let x = takeoffX, y = from.top, vy = -JUMP_V, glideLeft = GLIDE_TIME;
  const over = (r: Roof, px: number) => px >= r.x && px <= r.x + r.w;
  for (let t = 0; t < 5; t += dt) {
    const prevY = y;
    x += speed * dt;
    if (glide === Glide.On && vy > 0 && glideLeft > 0) { glideLeft -= dt; vy += (GLIDE_FALL - vy) * Math.min(1, dt * 12); }
    else vy = Math.min(1400, vy + G * dt);
    y += vy * dt;
    for (const r of [from, to]) {
      if (!(over(r, x + 8) || over(r, x - 8)) || y < r.top) continue;
      if (prevY <= r.top + 2 || y - r.top < 12) return r === to;
      return false;  // hit the wall
    }
  }
  return false;
}

function* roofs(seed: number, speed: number, count: number): Generator<[Roof, Roof]> {
  const random = mulberry(seed);
  let prev: Roof = { x: 0, w: 1500, top: 380 };
  for (let i = 0; i < count; i++) {
    const next = nextBuilding(prev, speed, random) as Roof;
    yield [prev, next];
    prev = next;
  }
}

// The range of takeoff points, in seconds before the roof's edge, that still clear the gap.
// A wide window means the jump barely needs timing.
function takeoffWindow(from: Roof, to: Roof, speed: number, glide: Glide): number {
  let ok = 0;
  const step = 0.01;
  for (let early = 0; early <= 1.5; early += step) if (clears(from, to, speed, from.x + from.w - speed * early, glide)) ok++;
  return ok * step;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const medianWindow = (speed: number, glide: Glide) =>
  median([...roofs(speed + 3, speed, 150)].map(([from, to]) => takeoffWindow(from, to, speed, glide)));

describe('Runoff level generation', () => {
  for (const speed of [START_SPEED, 600, MAX_SPEED]) {
    it(`every gap can be cleared at ${speed} px/s by jumping at the edge`, () => {
      for (const [from, to] of roofs(speed, speed, 3000)) {
        expect(clears(from, to, speed, from.x + from.w, Glide.Off), JSON.stringify({ from, to })).toBe(true);
      }
    });

    it(`every gap can be cleared at ${speed} px/s by jumping a twentieth of a second early`, () => {
      for (const [from, to] of roofs(speed + 1, speed, 3000)) {
        expect(clears(from, to, speed, from.x + from.w - speed * 0.05, Glide.Off), JSON.stringify({ from, to })).toBe(true);
      }
    });
  }

  // Regression: the first version let you jump almost a second early at any speed and still
  // make it, which made the game far too easy.
  it('demands tighter timing as the duck speeds up', () => {
    const start = medianWindow(START_SPEED, Glide.Off), top = medianWindow(MAX_SPEED, Glide.Off);
    expect(top).toBeLessThan(start * 0.7);
    expect(top).toBeLessThan(0.25);
  });

  it('keeps the glide a rescue rather than a free pass at top speed', () => {
    expect(medianWindow(MAX_SPEED, Glide.On)).toBeLessThan(0.45);
  });

  it('keeps roofs between the height limits and never overlapping', () => {
    for (const [from, to] of roofs(7, 500, 3000)) {
      expect(to.top).toBeGreaterThanOrEqual(ROOF_MIN);
      expect(to.top).toBeLessThanOrEqual(ROOF_MAX);
      expect(to.x).toBeGreaterThan(from.x + from.w);
    }
  });
});
