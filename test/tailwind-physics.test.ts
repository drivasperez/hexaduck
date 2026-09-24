import { describe, expect, it } from 'vitest';
import { GAMES } from '../src/games';
import {
  FEVER_MAX, MAX_SPEED, MIN_SPEED, newDuck, PX_PER_M, START_TIME, step, Terrain,
} from '../public/tailwind/physics.js';

function mulberry(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Duck = ReturnType<typeof newDuck>;
type Policy = (d: Duck, terrain: Terrain) => boolean;

// Never touches the controls.
const idle: Policy = () => false;
// Dives on downhills and lets go on uphills, which is how the game is meant to be played.
const diver: Policy = (d, terrain) => (d.ground ? terrain.slope(d.x) < 0 : d.vy < 0 && terrain.slope(d.x + d.vx * 0.15) < 0);

// Runs the game's fixed-step loop (see public/tailwind/game.js) for `seconds` of play.
function simulate(seed: number, policy: Policy, seconds: number) {
  const terrain = new Terrain(mulberry(seed));
  const d = newDuck(terrain);
  const dt = 1 / 240;
  let maxSpeed = 0, minVx = Infinity, perfect = 0, bad = 0;
  for (let t = 0; t < seconds; t += dt) {
    for (const e of step(d, terrain, policy(d, terrain), dt, MAX_SPEED)) {
      if (e === 'perfect') perfect++;
      if (e === 'bad') bad++;
    }
    maxSpeed = Math.max(maxSpeed, Math.hypot(d.vx, d.vy));
    minVx = Math.min(minVx, d.vx);
    expect(d.y).toBeGreaterThanOrEqual(terrain.height(d.x) - 0.001);
  }
  return { metres: d.x / PX_PER_M, island: terrain.islandAt(d.x), maxSpeed, minVx, perfect, bad };
}

describe('Tailwind terrain', () => {
  it('is smooth: height and slope are continuous across every joint', () => {
    const terrain = new Terrain(mulberry(1));
    terrain.ensure(200_000);
    for (const p of terrain.points.slice(1, -1)) {
      expect(Math.abs(terrain.height(p.x - 0.01) - terrain.height(p.x + 0.01))).toBeLessThan(0.05);
      expect(Math.abs(terrain.slope(p.x - 0.01) - terrain.slope(p.x + 0.01))).toBeLessThan(0.01);
    }
  });

  it('stays above the sea and below the ceiling', () => {
    const terrain = new Terrain(mulberry(2));
    for (let x = -900; x < 200_000; x += 37) {
      const h = terrain.height(x);
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThanOrEqual(480);
    }
  });

  it('numbers islands in order along the course', () => {
    const terrain = new Terrain(mulberry(3));
    terrain.ensure(150_000);
    let last = 0;
    for (let x = 0; x < 150_000; x += 500) {
      const i = terrain.islandAt(x);
      expect(i === last || i === last + 1).toBe(true);
      last = i;
    }
    expect(last).toBeGreaterThan(3);
  });
});

describe('Tailwind duck', () => {
  for (const seed of [1, 2, 3]) {
    it(`always moves forward, even without input (seed ${seed})`, () => {
      const run = simulate(seed, idle, START_TIME);
      expect(run.minVx).toBeGreaterThanOrEqual(MIN_SPEED - 1e-9);
      expect(run.metres).toBeGreaterThan((MIN_SPEED * START_TIME) / PX_PER_M);
    });

    it(`goes much further when diving well (seed ${seed})`, () => {
      const lazy = simulate(seed, idle, START_TIME);
      const good = simulate(seed, diver, START_TIME);
      expect(good.metres).toBeGreaterThan(lazy.metres * 1.5);
      expect(good.perfect).toBeGreaterThan(0);
    });

    it(`never exceeds the speed cap (seed ${seed})`, () => {
      expect(simulate(seed, diver, START_TIME).maxSpeed).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
    });
  }

  it("keeps the server's score limit above the fastest possible run", () => {
    expect(GAMES.tailwind.maxPerSecond).toBeGreaterThanOrEqual(FEVER_MAX / PX_PER_M);
  });
});
