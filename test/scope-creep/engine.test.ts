import { describe, expect, it } from 'vitest';
import {
  apply, COLS, genMap, heat, HEAT_STEP, IllegalAction, intents, legalActions, newRun, playerDamage, replay, ROWS,
  score, testCombat,
} from '../../public/scope-creep/engine.js';
import { playRun, randomPlayer } from './players.js';
import { apply as applyWithEvents } from '../../public/scope-creep/engine.js';

// The engine is plain JavaScript, whose inferred types are too narrow (combat starts as null).
type State = any;
type Enemy = any;

// A run that has picked its mandate and is standing on the map.
function onMap(seed = 1): State {
  const s = newRun(seed);
  s.mandate = null;
  s.screen = 'map';
  return s;
}

// A combat against the given enemies with exactly this hand, full energy and no draw pile.
function fight(ids: string[], hand: (string | [string, boolean])[], setup: (s: State) => void = () => {}) {
  const s = onMap();
  setup(s);
  testCombat(s, ids);
  const c = s.combat;
  c.draw = []; c.discard = [];
  c.hand = hand.map(h => {
    const [id, up] = Array.isArray(h) ? h : [h, false];
    return { uid: s.nextUid++, id, up };
  });
  c.energy = 3;
  for (const e of c.enemies) { e.st = {}; e.block = 0; }
  return s;
}
const foe = (s: State, i = 0): Enemy => s.combat.enemies[i];
const play = (s: State, index: number, target?: number) => apply(s, { type: 'play', index, target });

describe('Scope Creep damage', () => {
  it('adds Drive and Measured to each hit, then applies Exposed and Diluted', () => {
    const s = fight(['cow'], ['abate']);
    const e = foe(s);
    expect(playerDamage(s, e, 6)).toBe(6);
    e.st.measured = 2;
    expect(playerDamage(s, e, 6)).toBe(8);
    e.st.exposed = 1;
    expect(playerDamage(s, e, 6)).toBe(12);
    s.combat.p.st.diluted = 1;
    expect(playerDamage(s, e, 6)).toBe(9);
    s.combat.p.st.drive = 2;
    expect(playerDamage(s, e, 6)).toBe(11);
  });

  it('counts Measured on every hit of a multi-hit attack', () => {
    const s = fight(['cow'], ['spreadsheet']);
    foe(s).st.measured = 3;
    const before = foe(s).hp;
    play(s, 0, 0);
    expect(before - foe(s).hp).toBe(2 * (4 + 3));
  });

  it("goes through the enemy's Assurance first", () => {
    const s = fight(['cow'], ['abate']);
    foe(s).block = 4;
    const before = foe(s).hp;
    play(s, 0, 0);
    expect(foe(s).block).toBe(0);
    expect(before - foe(s).hp).toBe(2);
  });
});

describe('Scope Creep turns', () => {
  it('blocks incoming attacks with Assurance', () => {
    const s = fight(['cow'], ['hedge', 'hedge']);
    foe(s).move = 'stomp';  // 13 damage
    play(s, 0); play(s, 0);
    const hp = s.hp;
    apply(s, { type: 'end' });
    expect(hp - s.hp).toBe(13 - 10);
  });

  it('adds carbon when an enemy Emits, but not if it has been abated first', () => {
    const s = fight(['car', 'cow'], ['abate']);
    foe(s, 1).move = 'burp';  // emits 4
    foe(s, 0).move = 'idle';  // emits 1
    foe(s, 0).hp = 3;
    play(s, 0, 0);            // abate the car before it can emit
    apply(s, { type: 'end' });
    expect(s.carbon).toBe(4);
  });

  it('gives enemies Drive for Heat at the start of combat, halved by the Cooling Tower', () => {
    const hot = onMap();
    hot.carbon = HEAT_STEP * 3;
    testCombat(hot, ['cow']);
    expect(heat(hot)).toBe(3);
    expect(foe(hot).st.drive).toBe(3);
    const cooled = onMap();
    cooled.carbon = HEAT_STEP * 3;
    cooled.relics.push('coolingTower');
    testCombat(cooled, ['cow']);
    expect(foe(cooled).st.drive).toBe(1);
  });

  it('sends Retired cards out of the deck for the combat, and a Net Zero Pledge removes carbon for each', () => {
    const s = fight(['cow'], ['waddle', 'waddle']);
    s.carbon = 10;
    s.combat.powers.netZeroPledge = 1;
    play(s, 0);
    expect(s.combat.exhaust.map((c: any) => c.id)).toEqual(['waddle']);
    expect(s.combat.ducklings).toBe(1);
    expect(s.carbon).toBe(9);
  });

  it('has Ducklings peck at the end of the turn, with Measured counting on each peck', () => {
    const s = fight(['cow'], []);
    s.combat.ducklings = 3;
    foe(s).st.measured = 1;
    foe(s).move = 'burp';
    const before = foe(s).hp;
    apply(s, { type: 'end' });
    // Burp gives it Assurance after the pecks land, so all 3 × (2 + 1) come off its health.
    expect(before - foe(s).hp).toBe(9);
  });

  it('hurts an enemy with Liability at the start of its turn, then reduces the Liability', () => {
    // Class Action applies 8.
    const s = fight(['cow'], ['classAction']);
    play(s, 0, 0);
    expect(foe(s).st.liability).toBe(8);
    const before = foe(s).hp;
    apply(s, { type: 'end' });
    expect(before - foe(s).hp).toBe(8);
    expect(foe(s).st.liability).toBe(7);
  });

  it('hurts enemies that hit you while you have Regulation', () => {
    const s = fight(['cow'], []);
    s.combat.p.st.regulation = 3;
    foe(s).move = 'stomp';
    const before = foe(s).hp;
    apply(s, { type: 'end' });
    expect(before - foe(s).hp).toBe(3);
  });

  it('makes Scope Creep stronger every time it is played', () => {
    const s = fight(['cow'], ['scopeCreep']);
    const card = s.combat.hand[0];
    const hits: number[] = [];
    for (let i = 0; i < 3; i++) {
      s.combat.hand = [card]; s.combat.energy = 3;
      const before = foe(s).hp;
      play(s, 0, 0);
      hits.push(before - foe(s).hp);
    }
    expect(hits).toEqual([5, 8, 11]);
  });

  it('spends all energy on an X-cost card', () => {
    const s = fight(['cow'], ['fullValueChain']);
    const before = foe(s).hp;
    play(s, 0);
    expect(s.combat.energy).toBe(0);
    // Three hits of 5, each applying 1 Measured before it lands: 6 + 7 + 8.
    expect(before - foe(s).hp).toBe(21);
  });

  it("lets you vent the Boiler Room's Overpressure by dealing 25 damage that turn", () => {
    const s = fight(['boilerRoom'], ['coalSeam', 'coalSeam']);
    foe(s).move = 'burst';
    expect(intents(s, foe(s))).toContainEqual({ kind: 'attack', n: 32, times: 1 });
    play(s, 0, 0);
    play(s, 0, 0);  // 26 damage
    expect(intents(s, foe(s)).some(i => i.kind === 'attack')).toBe(false);
    const hp = s.hp;
    apply(s, { type: 'end' });
    expect(s.hp).toBe(hp);
  });

  it("shows the Data Centre hitting once per card in your hand", () => {
    const s = fight(['dataCentre'], ['abate', 'hedge', 'hedge']);
    foe(s).move = 'compute';
    expect(intents(s, foe(s)).find(i => i.kind === 'attack')?.times).toBe(3);
    play(s, 1);
    expect(intents(s, foe(s)).find(i => i.kind === 'attack')?.times).toBe(2);
  });
});

describe('Scope Creep offsets', () => {
  it('lowers carbon now, then audits every offset at the next boss', () => {
    const s = fight(['cow'], ['natureOffset']);
    s.carbon = 20;
    play(s, 0);
    expect(s.carbon).toBe(16);
    expect(s.offsets).toEqual([{ amount: 4, quality: 'low' }]);
    s.combat = null;
    testCombat(s, ['boilerRoom'], 'boss');
    expect(s.offsets).toEqual([]);
    expect([16, 24]).toContain(s.carbon);  // it either held or failed and came back doubled
  });

  it('always fails junk offsets, and never fails verified ones', () => {
    const s = onMap();
    s.carbon = 10;
    s.offsets = [{ amount: 5, quality: 'junk' }, { amount: 7, quality: 'high' }];
    testCombat(s, ['boilerRoom'], 'boss');
    expect(s.carbon).toBe(20);
    expect(s.combat.log[0]).toMatch(/1 of 2 offsets failed/);
  });

  it('makes offsets verified while a Verification Body is in play', () => {
    const s = fight(['cow'], ['verificationBody', 'natureOffset']);
    s.carbon = 10;
    play(s, 0);
    play(s, 0);
    expect(s.offsets).toEqual([{ amount: 4, quality: 'high' }]);
  });
});

describe('Scope Creep rules', () => {
  it('refuses illegal actions and leaves the state untouched', () => {
    const s = fight(['cow'], ['abate', 'abate', 'abate', 'abate']);
    s.combat.energy = 0;
    const before = JSON.stringify(s);
    expect(() => play(s, 0, 0)).toThrow(IllegalAction);
    expect(() => apply(s, { type: 'play', index: 9, target: 0 })).toThrow(IllegalAction);
    expect(() => apply(s, { type: 'path', col: 3 })).toThrow(IllegalAction);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('offers card rewards after a win, fewer with Greenhushing', () => {
    for (const [relics, n] of [[[], 3], [['greenhushing'], 2]] as const) {
      const s = fight(['car'], ['abate'], st => st.relics.push(...relics));
      foe(s).hp = 1;
      play(s, 0, 0);
      expect(s.screen).toBe('reward');
      expect(s.reward.cards).toHaveLength(n);
    }
  });

  it('collects unclaimed grants when leaving a reward', () => {
    const s = fight(['car'], ['abate']);
    foe(s).hp = 1;
    play(s, 0, 0);
    const gold = s.gold, reward = s.reward.gold;
    expect(reward).toBeGreaterThan(0);
    apply(s, { type: 'continue' });
    expect(s.gold).toBe(gold + reward);
  });

  it('raises the price of card removal each time at the shop', () => {
    const s = onMap();
    s.gold = 500;
    s.screen = 'shop';
    s.shop = { cards: [], relics: [], tools: [], removal: true, capture: { amount: 6, price: 60, sold: false } };
    apply(s, { type: 'buy', kind: 'removal' });
    apply(s, { type: 'select', uids: [s.deck[0].uid] });
    expect(s.gold).toBe(425);
    expect(s.removeCost).toBe(100);
    expect(s.deck).toHaveLength(9);
    expect(() => apply(s, { type: 'buy', kind: 'removal' })).toThrow(IllegalAction);
  });

  it('scores floors, elites and bosses, with a bonus for winning at net zero and a penalty for Heat', () => {
    const s = onMap();
    Object.assign(s.stats, { floors: 39, elites: 3, bosses: 3 });
    s.screen = 'victory';
    s.hp = 50;
    s.carbon = 0;
    expect(score(s)).toEqual({ total: 195 + 60 + 150 + 300 + 150, parts: { floors: 195, elites: 60, bosses: 150, victory: 300, netZero: 150, heat: -0 }, won: true });
    s.carbon = HEAT_STEP * 2;
    expect(score(s).total).toBe(195 + 60 + 150 + 300 - 20);
  });
});

describe('Scope Creep maps', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`builds a well-formed map (seed ${seed})`, () => {
      const s = newRun(seed);
      const map = genMap(s);
      expect(map).toHaveLength(ROWS);
      // Every node in row 0 fights; row 5 is treasure; the last row rests before the boss.
      for (const n of map[0]) if (n) expect(n.t).toBe('fight');
      for (const n of map[5]) if (n) expect(n.t).toBe('treasure');
      for (const n of map[ROWS - 1]) if (n) expect(n.t).toBe('rest');
      for (let r = 0; r < ROWS - 1; r++) map[r].forEach((n, c) => {
        if (!n) return;
        expect(n.n.length).toBeGreaterThan(0);
        for (const t of n.n) {
          expect(map[r + 1][t]).toBeTruthy();
          expect(Math.abs(t - c)).toBeLessThanOrEqual(1);
          // No crossing: an edge c -> t and another t -> c on the same rows can't both exist.
          if (t !== c) expect(map[r][t]?.n.includes(c) ?? false).toBe(false);
        }
      });
      // Every node can be reached from the bottom row.
      const reach = new Set(map[0].map((n, c) => (n ? c : -1)).filter(c => c >= 0));
      for (let r = 0; r < ROWS - 1; r++) {
        const next = new Set<number>();
        for (const c of reach) for (const t of map[r][c].n) next.add(t);
        for (let c = 0; c < COLS; c++) if (map[r + 1][c]) expect(next.has(c)).toBe(true);
        reach.clear(); for (const c of next) reach.add(c);
      }
      // No elites or rest ponds in the first four rows.
      for (let r = 0; r < 4; r++) for (const n of map[r]) if (n) expect(['elite', 'rest']).not.toContain(n.t);
    });
  }
});

describe('Scope Creep runs', () => {
  it('replays to exactly the same state from the seed and actions', () => {
    const { s, actions } = playRun(77, randomPlayer(77));
    expect(JSON.stringify(replay(77, actions))).toBe(JSON.stringify(s));
  });

  it('only ever offers legal actions', () => {
    const { actions } = playRun(78, randomPlayer(78));
    const s = newRun(78);
    for (const a of actions) {
      expect(legalActions(s).map((x: unknown) => JSON.stringify(x))).toContain(JSON.stringify(a));
      apply(s, a);
    }
  });
});

describe('Scope Creep events', () => {
  it('notes a fully blocked enemy hit, so it can be shown rather than looking like nothing happened', () => {
    const s = fight(['cow'], ['hedge', 'hedge', 'hedge']);
    foe(s).move = 'stomp';  // 13 damage
    play(s, 0); play(s, 0); play(s, 0);  // 15 Assurance
    const events: any[] = [];
    applyWithEvents(s, { type: 'end' }, events);
    const cow = foe(s).uid;
    expect(events).toContainEqual({ k: 'act', uid: cow, name: 'Methane Cow', move: 'Stomp' });
    expect(events).toContainEqual({ k: 'hurt', from: cow, dmg: 13, blocked: 13, lost: 0, hp: s.hp, block: 2 });
    // The enemy acts before its hit lands, and the next turn starts after.
    const kinds = events.map(e => e.k);
    expect(kinds.indexOf('act')).toBeLessThan(kinds.indexOf('hurt'));
    expect(kinds.at(-1)).toBe('turn');
  });

  it('notes the killing blow, the death and the win in order', () => {
    const s = fight(['car'], ['abate']);
    foe(s).hp = 4;
    const events: any[] = [];
    applyWithEvents(s, { type: 'play', index: 0, target: 0 }, events);
    expect(events.map(e => e.k)).toEqual(['hit', 'death', 'win']);
    expect(events[0]).toMatchObject({ lost: 4, hp: 0 });
    expect(s.screen).toBe('reward');
  });

  it('never changes the state by noting events', () => {
    const a = fight(['diesel', 'car'], ['abate', 'hedge', 'survey']);
    const b = JSON.parse(JSON.stringify(a));
    const actions = [{ type: 'play', index: 1 }, { type: 'play', index: 1, target: 0 }, { type: 'end' }];
    for (const act of actions) { apply(a, act); applyWithEvents(b, act, []); }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
