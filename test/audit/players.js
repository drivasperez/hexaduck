// Automated players for Audit, Please, used by the tests and for tuning the economy.
import { apply, legalActions, newRun } from '../../public/audit/engine.js';

export function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Plays random legal actions. Good at finding crashes, hopeless at the job.
export function randomPlayer(seed) {
  const rand = mulberry(seed * 7 + 1);
  return s => {
    const actions = legalActions(s);
    return actions[Math.floor(rand() * actions.length)];
  };
}

// A clerk who can see the answers: works the whole day, proves each flaw once before rejecting,
// reports every envelope and buys everything it can afford at night. `accuracy` makes it
// stamp the wrong way some of the time, and `envelopes: 'take'` makes it pocket bribes.
export function clerk(seed, { accuracy = 1, inspect = true, envelopes = 'report', event = 0 } = {}) {
  const rand = mulberry(seed * 13 + 5);
  return s => {
    const actions = legalActions(s);
    if (s.screen === 'desk') {
      const c = s.case;
      if (!c) return actions[0];
      if (c.bribe && !c.bribe.decided) return { type: 'bribe', take: envelopes === 'take' };
      const flawed = c.results.length > 0;
      if (flawed && inspect && !c.found.length) return actions.find(a => a.type === 'inspect');
      const right = rand() < accuracy;
      return { type: 'stamp', verdict: flawed === right ? 'reject' : 'approve' };
    }
    if (s.screen === 'event') return actions[Math.min(event, actions.length - 1)];
    return actions[0];
  };
}

// Plays a whole run, returning the final state and the actions taken.
export function playRun(seed, player, limit = 20000) {
  const s = newRun(seed);
  const actions = [];
  while (s.screen !== 'end' && actions.length < limit) {
    const a = player(s);
    apply(s, a);
    actions.push(a);
  }
  return { s, actions };
}
