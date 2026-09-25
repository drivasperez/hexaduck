import { describe, expect, it } from 'vitest';
import { apply, newRun } from '../../public/scope-creep/engine.js';
import { plannerPlayer, playRun, randomPlayer } from './players.js';

// Walks a run and checks that nothing impossible ever happens along the way.
function checkedRun(seed: number, player: (s: any) => any) {
  const s: any = newRun(seed);
  for (let i = 0; i < 20000 && s.screen !== 'gameover' && s.screen !== 'victory'; i++) {
    apply(s, player(s));
    expect(s.hp).toBeGreaterThanOrEqual(0);
    expect(s.hp).toBeLessThanOrEqual(s.maxHp);
    expect(s.carbon).toBeGreaterThanOrEqual(0);
    expect(s.gold).toBeGreaterThanOrEqual(0);
    if (s.combat) {
      const c = s.combat;
      for (const e of c.enemies as any[]) { expect(Number.isFinite(e.hp)).toBe(true); expect(e.hp).toBeGreaterThanOrEqual(0); }
      expect(c.hand.length).toBeLessThanOrEqual(10);
      expect(c.energy).toBeGreaterThanOrEqual(0);
      // No card is ever in two piles at once.
      const uids = [...c.draw, ...c.hand, ...c.discard, ...c.exhaust].map((card: any) => card.uid);
      expect(new Set(uids).size).toBe(uids.length);
    }
  }
  expect(['gameover', 'victory']).toContain(s.screen);
  return s;
}

describe('Scope Creep fuzzing', () => {
  it('survives 60 runs of random play without errors or impossible states', () => {
    for (let seed = 1; seed <= 60; seed++) checkedRun(seed, randomPlayer(seed));
  });

  it('survives planned runs deep into the game', () => {
    const acts = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) acts.add(checkedRun(seed, plannerPlayer(seed)).act);
    expect(acts.has(3)).toBe(true);  // some reach Scope 3, so every act's content gets exercised
  });
});

// Guards against a change quietly making the game trivial or impossible. The planner is a
// decent but carbon-careless player; see test/scope-creep/players.js.
describe('Scope Creep difficulty', () => {
  it('keeps a competent player mostly clear of act 1 but rarely winning', () => {
    const N = 40;
    let pastAct1 = 0, wins = 0;
    for (let seed = 1000; seed < 1000 + N; seed++) {
      const { s } = playRun(seed, plannerPlayer(seed));
      if (s.act > 1 || s.screen === 'victory') pastAct1++;
      if (s.screen === 'victory') wins++;
    }
    expect(pastAct1 / N).toBeGreaterThan(0.6);
    expect(pastAct1 / N).toBeLessThan(1);
    expect(wins / N).toBeLessThan(0.25);
  }, 30_000);  // plays 40 full runs, which is slow when other suites share the machine
});
