import { describe, expect, it } from 'vitest';
import {
  CRATE_SLOW, G, GLIDE_FALL, GLIDE_TIME, JUMP_V, MAX_SPEED, nextBuilding, ROOF_MAX, ROOF_MIN, START_SPEED,
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

describe('Runoff level generation', () => {
  for (const speed of [START_SPEED, 600, MAX_SPEED]) {
    it(`every gap can be cleared at ${speed} px/s by jumping at the edge`, () => {
      for (const [from, to] of roofs(speed, speed, 3000)) {
        expect(clears(from, to, speed, from.x + from.w, Glide.Off), JSON.stringify({ from, to })).toBe(true);
      }
    });

    it(`every gap can be cleared at ${speed} px/s by jumping a tenth of a second early`, () => {
      for (const [from, to] of roofs(speed + 1, speed, 3000)) {
        expect(clears(from, to, speed, from.x + from.w - speed * 0.1, Glide.Off), JSON.stringify({ from, to })).toBe(true);
      }
    });

    it(`every gap can still be cleared at ${speed} px/s just after hitting a crate, with a glide`, () => {
      const slowed = speed * CRATE_SLOW;
      for (const [from, to] of roofs(speed + 2, speed, 3000)) {
        expect(clears(from, to, slowed, from.x + from.w, Glide.On), JSON.stringify({ from, to })).toBe(true);
      }
    });
  }

  it('keeps roofs between the height limits and never overlapping', () => {
    for (const [from, to] of roofs(7, 500, 3000)) {
      expect(to.top).toBeGreaterThanOrEqual(ROOF_MIN);
      expect(to.top).toBeLessThanOrEqual(ROOF_MAX);
      expect(to.x).toBeGreaterThan(from.x + from.w);
    }
  });
});
