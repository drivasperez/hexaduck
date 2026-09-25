import { describe, expect, it } from 'vitest';
import {
  _internal, apply, check, CLOSE, COST, DAYS, IllegalAction, legalActions, memo, newRun, NEST, nightCost, OPEN, PAY,
  replay, rulesFor, score,
} from '../../public/audit/engine.js';
import { isDiscrepancy } from '../../public/audit/rules.js';
import { clerk, playRun, randomPlayer } from './players.js';

// The engine is plain JavaScript, whose inferred types are too narrow (the case starts as null).
type State = any;
const { validCase, ctxFor, newCompany, startDay, claimTypes } = _internal;
const FLAWS: Record<string, (s: State, docs: any) => boolean> = _internal.FLAWS;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// A run standing at the desk on the given day, with nobody at the window yet.
function atDesk(day = 1, seed = 1): State {
  const s = newRun(seed);
  s.day = day;
  startDay(s);
  s.screen = 'desk';
  return s;
}
const act = (s: State, a: object) => { const events: any[] = []; apply(s, a, events); return events; };

// Calls applicants until one arrives whose claim is valid (or flawed, when asked).
function callUntil(s: State, flawed: 'valid' | 'flawed'): void {
  for (;;) {
    act(s, { type: 'next' });
    if (s.case.bribe) act(s, { type: 'bribe', take: false });
    if ((s.case.results.length > 0) === (flawed === 'flawed')) return;
    act(s, { type: 'stamp', verdict: s.case.results.length ? 'reject' : 'approve' });
  }
}

describe('Audit, Please rules', () => {
  // The generator and the checker are written independently, so check each against the other.
  it('passes every clean case, and each planted flaw breaks exactly its own rule', () => {
    let flawsChecked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (let day = 1; day <= DAYS; day++) {
        const s: State = newRun(seed);
        s.day = day;
        startDay(s);
        s.today.approvedSerials.push('VCU-5555-5555');
        for (const [claim] of claimTypes(day)) {
          const docs = validCase(s, newCompany(s), claim);
          const results = check(docs, day, ctxFor(s)).map((r: any) => r.rule);
          if (claim === 'Carbon neutral' && day >= 5) { expect(results).toEqual(['noNeutral']); continue; }
          expect(results, `${claim} on day ${day}`).toEqual([]);
          for (const rule of rulesFor(day)) {
            if (rule.id === 'noNeutral') continue;
            const flawed = clone(docs);
            if (!FLAWS[rule.id](s, flawed)) continue;
            expect(check(flawed, day, ctxFor(s)).map((r: any) => r.rule), `${rule.id} flaw on a ${claim} claim`).toEqual([rule.id]);
            flawsChecked++;
          }
        }
      }
    }
    expect(flawsChecked).toBeGreaterThan(2000);
  });

  it('only enforces rules once they have been introduced', () => {
    const s = atDesk(4);
    const docs = validCase(s, newCompany(s), 'Emissions report');
    const flawed = clone(docs);
    FLAWS.sums(s, flawed);
    expect(check(flawed, 3, ctxFor(s))).toEqual([]);
    expect(check(flawed, 4, ctxFor(s)).map((r: any) => r.rule)).toEqual(['sums']);
  });

  // Regression: serials used to start with a registry code and a year chosen separately from
  // the certificate's registry and vintage, which looked like a discrepancy but wasn't one.
  it('makes serials that cannot seem to contradict the registry or vintage', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = atDesk(6, seed);
      for (const serial of s.today.bulletin) expect(serial).toMatch(/^VCU-\d{4}-\d{4}$/);
      const docs: any[] = validCase(s, newCompany(s), 'Carbon neutral');
      expect(docs.find((d: any) => d.id === 'cert').fields.find((f: any) => f.key === 'serial').value).toMatch(/^VCU-\d{4}-\d{4}$/);
    }
  });

  it('matches discrepancies in either order', () => {
    const results = [{ rule: 'signed', pairs: [['form.signed', 'rule.signed']], why: 'unsigned' }];
    expect(isDiscrepancy(results, 'form.signed', 'rule.signed')?.rule).toBe('signed');
    expect(isDiscrepancy(results, 'rule.signed', 'form.signed')?.rule).toBe('signed');
    expect(isDiscrepancy(results, 'form.company', 'rule.signed')).toBeFalsy();
  });
});

describe('Audit, Please desk', () => {
  it('charges time for calling, inspecting and stamping, and nothing for reading', () => {
    const s = atDesk(1);
    expect(s.minute).toBe(OPEN);
    act(s, { type: 'next' });
    expect(s.minute).toBe(OPEN + COST.next);
    act(s, { type: 'inspect', a: 'form.company', b: 'statement.company' });
    expect(s.minute).toBe(OPEN + COST.next + COST.inspect);
    act(s, { type: 'stamp', verdict: 'approve' });
    expect(s.minute).toBe(OPEN + COST.next + COST.inspect + COST.stamp);
  });

  it('notes a real discrepancy once, and says so when there is none', () => {
    const s = atDesk(2);
    callUntil(s, 'flawed');
    const [pair] = s.case.results[0].pairs;
    const first = act(s, { type: 'inspect', a: pair[1], b: pair[0] });
    expect(first).toContainEqual(expect.objectContaining({ k: 'found', rule: s.case.results[0].rule }));
    expect(s.case.found).toEqual([s.case.results[0].rule]);
    expect(act(s, { type: 'inspect', a: pair[0], b: pair[1] })).toEqual([expect.objectContaining({ k: 'already' })]);
    expect(act(s, { type: 'inspect', a: 'rule.year', b: 'rule.signed' })).toEqual([expect.objectContaining({ k: 'nothing' })]);
  });

  it('refuses inspections of things that are not on the desk', () => {
    const s = atDesk(1);
    act(s, { type: 'next' });
    expect(() => act(s, { type: 'inspect', a: 'form.company', b: 'form.company' })).toThrow(IllegalAction);
    expect(() => act(s, { type: 'inspect', a: 'form.company', b: 'rule.double' })).toThrow(IllegalAction);  // not until day 6
    expect(() => act(s, { type: 'inspect', a: 'form.company', b: 'bulletin.serials' })).toThrow(IllegalAction);
    expect(() => act(s, { type: 'inspect', a: 'form.nonsense', b: 'rule.year' })).toThrow(IllegalAction);
    expect(s.minute).toBe(OPEN + COST.next);
  });

  it('pays for right answers, extra for documented rejections, and fines after two citations', () => {
    const s = atDesk(2);
    callUntil(s, 'valid');
    const pay = s.today.pay;
    act(s, { type: 'stamp', verdict: 'approve' });
    expect(s.today.pay).toBe(pay + PAY.correct);

    callUntil(s, 'flawed');
    const [pair] = s.case.results[0].pairs;
    act(s, { type: 'inspect', a: pair[0], b: pair[1] });
    const before = s.today.pay;
    act(s, { type: 'stamp', verdict: 'reject' });
    expect(s.today.pay).toBe(before + PAY.correct + PAY.documented);

    for (let i = 1; i <= 3; i++) {
      callUntil(s, 'valid');
      const events = act(s, { type: 'stamp', verdict: 'reject' });
      expect(events).toContainEqual(expect.objectContaining({ k: 'stamp', citation: true }));
      expect(s.today.citations).toBe(i);
      expect(s.today.fines).toBe(i > PAY.freeCitations ? PAY.fine : 0);
    }
  });

  it('remembers approved serials, so a second use counts as double counting', () => {
    const s = atDesk(6);
    for (;;) {
      callUntil(s, 'valid');
      if (s.case.docs.some((d: any) => d.id === 'cert')) break;
      act(s, { type: 'stamp', verdict: 'approve' });
    }
    const docs = clone(s.case.docs);
    const serial = docs.find((d: any) => d.id === 'cert').fields.find((f: any) => f.key === 'serial').value;
    act(s, { type: 'stamp', verdict: 'approve' });
    expect(s.today.approvedSerials).toContain(serial);
    expect(s.today.log.at(-1)).toEqual({ company: s.today.log.at(-1).company, serial });
    expect(check(docs, 6, ctxFor(s)).map((r: any) => r.rule)).toEqual(['double']);
  });

  it('makes you deal with an envelope before stamping', () => {
    const s = atDesk(3);
    act(s, { type: 'next' });
    s.case.bribe = { amount: 20, decided: false, taken: false };
    expect(() => act(s, { type: 'stamp', verdict: 'approve' })).toThrow(IllegalAction);
    const money = s.money;
    act(s, { type: 'bribe', take: true });
    expect(s.money).toBe(money + s.case.bribe.amount);
    expect(s.stats.bribes).toBe(1);
    expect(() => act(s, { type: 'bribe', take: true })).toThrow(IllegalAction);
    act(s, { type: 'stamp', verdict: 'approve' });
  });

  it('stops calling applicants when the window is about to close', () => {
    const s = atDesk(1);
    s.minute = CLOSE - COST.next + 1;
    expect(() => act(s, { type: 'next' })).toThrow(IllegalAction);
    expect(legalActions(s)).toEqual([{ type: 'close' }]);
    act(s, { type: 'close' });
    expect(s.screen).toBe('night');
  });
});

describe('Audit, Please nights', () => {
  function atNight(money: number, day = 1): State {
    const s = atDesk(day);
    act(s, { type: 'close' });
    s.money = money;
    return s;
  }
  const all = [true, true, true];
  const none = [false, false, false];

  it('costs rent, food, heating and medicine, with heating dearer on cold days', () => {
    const s = atNight(100);
    expect(nightCost(s, { food: all, heat: true, medicine: all })).toBe(NEST.rent + 3 * NEST.food + NEST.heat);  // nobody is sick
    s.nest[1].sick = 1;
    expect(nightCost(s, { food: all, heat: true, medicine: all })).toBe(NEST.rent + 3 * NEST.food + NEST.heat + NEST.medicine);
    expect(atNight(100, 4).night.costs.heat).toBe(NEST.coldHeat);
  });

  it('lets rent go into debt, but nothing else', () => {
    const s = atNight(5);
    expect(() => act(s, { type: 'sleep', food: all, heat: false, medicine: none })).toThrow(IllegalAction);
    act(s, { type: 'sleep', food: none, heat: false, medicine: none });
    expect(s.money).toBe(5 - NEST.rent);
  });

  it('only offers night choices you can afford', () => {
    for (const money of [-10, 0, 10, 30, 60, 200]) {
      const s = atNight(money);
      const options = legalActions(s);
      expect(options.length).toBeGreaterThan(0);
      for (const o of options) expect(() => apply(clone(s), o)).not.toThrow();
    }
  });

  it('makes ducklings sick after two nights hungry or cold, and loses them after two more untreated', () => {
    const s = atNight(200);
    const night = clone(s.night);
    const sleep = (food: boolean[], heat: boolean) => {
      apply(s, { type: 'sleep', food, heat, medicine: none });
      Object.assign(s, { screen: 'night', night: clone(night) });  // skip the day in between
      s.money = 200;
    };
    sleep([false, true, true], true);
    expect(s.nest[0]).toMatchObject({ hunger: 1, sick: 0 });
    sleep([false, true, true], true);
    expect(s.nest[0]).toMatchObject({ hunger: 2, sick: 1 });
    sleep(all, true);
    expect(s.nest[0]).toMatchObject({ sick: 2, gone: false });
    s.night = clone(night);
    const events: any[] = [];
    apply(s, { type: 'sleep', food: all, heat: true, medicine: none }, events);
    expect(s.nest[0].gone).toBe(true);
    expect(events).toContainEqual({ k: 'gone', name: s.nest[0].name });
    expect(s.nest.slice(1).every((d: any) => !d.gone && !d.sick)).toBe(true);
  });

  it('cures a sick duckling with medicine', () => {
    const s = atNight(200);
    s.nest[2].sick = 2; s.nest[2].hunger = 1;
    apply(s, { type: 'sleep', food: all, heat: true, medicine: [false, false, true] });
    expect(s.nest[2]).toMatchObject({ sick: 0, hunger: 0, gone: false });
  });

  it('evicts you when you are too far in debt', () => {
    const s = atNight(-5);
    apply(s, { type: 'sleep', food: none, heat: false, medicine: none });
    expect(s.screen).toBe('end');
    expect(s.ending).toBe('evicted');
  });
});

describe('Audit, Please story', () => {
  it('announces each day\'s new rules in the memo', () => {
    const s = atDesk(4);
    expect(memo(s).rules.map((r: any) => r.id)).toEqual(['sums', 'reduction']);
  });

  it('sends Grand Mallard Petroleum on days 3, 5, 7 and 10, flawed from day 5', () => {
    for (const [day, id, flawed] of [[3, 'gmp1', false], [5, 'gmp2', true], [7, 'gmp3', true], [10, 'gmp4', true]] as const) {
      const s = atDesk(day);
      let found = null;
      while (!found && s.today.served < s.today.queue) {
        act(s, { type: 'next' });
        if (s.case.story) found = clone(s.case);
        else { if (s.case.bribe) act(s, { type: 'bribe', take: false }); act(s, { type: 'stamp', verdict: 'approve' }); }
      }
      expect(found?.story, `day ${day}`).toBe(id);
      expect(found.company).toBe('Grand Mallard Petroleum plc');
      expect(found.results.length > 0, `${id} flawed`).toBe(flawed);
      if (id === 'gmp4') expect(found.results.map((r: any) => r.rule).sort()).toEqual(['netzero', 'scopes']);
      if (id === 'gmp3') expect(found.results.map((r: any) => r.rule)).toEqual(['double']);
    }
  });

  it('ends with the exposé for a clerk who keeps the note, makes copies and documents every flaw', () => {
    const { s } = playRun(1, clerk(1));
    expect(s.ending).toBe('expose');
    expect(s.story).toMatchObject({ reed: true, copies: true, evidence: 3 });
    expect(score(s).parts.ending).toBe(150);
  });

  it('reassigns a clerk who rejects Grand Mallard without the evidence', () => {
    const { s } = playRun(1, clerk(1, { inspect: false }));
    expect(s.ending).toBe('reassigned');
  });

  it('promotes a clerk who approves the final Grand Mallard claim', () => {
    const inner = clerk(1);
    const { s } = playRun(1, (st: State) => (st.case?.story === 'gmp4' ? { type: 'stamp', verdict: 'approve' } : inner(st)));
    expect(s.ending).toBe('promotion');
    expect(score(s).parts.ending).toBe(100);
  });

  it('usually catches a clerk who keeps taking envelopes', () => {
    const endings = Array.from({ length: 20 }, (_, i) => playRun(i + 1, clerk(i + 1, { envelopes: 'take' })).s.ending);
    expect(endings.filter(e => e === 'fired').length).toBeGreaterThan(10);
  });
});

describe('Audit, Please economy', () => {
  // Rough balance targets: a careful clerk gets through comfortably, a sloppy one struggles.
  it('keeps a perfect clerk and their ducklings safe', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const { s } = playRun(seed, clerk(seed));
      expect(s.day).toBe(DAYS);
      expect(s.nest.filter((d: any) => d.gone)).toEqual([]);
    }
  });

  it('makes an 80% accurate clerk lose some runs', () => {
    const early = Array.from({ length: 30 }, (_, i) => playRun(i + 1, clerk(i + 1, { accuracy: 0.8 })).s)
      .filter(s => s.day < DAYS || s.nest.some((d: any) => d.gone));
    expect(early.length).toBeGreaterThan(2);
  });
});

describe('Audit, Please runs', () => {
  it('finishes random runs without errors', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { s } = playRun(seed, randomPlayer(seed));
      expect(s.screen).toBe('end');
      expect(score(s).total).toBeGreaterThanOrEqual(0);
    }
  });

  it('replays to the same state', () => {
    for (const seed of [3, 9]) {
      const { s, actions } = playRun(seed, clerk(seed, { accuracy: 0.9 }));
      expect(replay(seed, actions)).toEqual(s);
    }
  });

  it('leaves the state alone after an illegal action', () => {
    const s = atDesk(1);
    act(s, { type: 'next' });
    const before = clone(s);
    expect(() => act(s, { type: 'close' })).toThrow(IllegalAction);
    expect(() => act(s, { type: 'stamp', verdict: 'maybe' })).toThrow(IllegalAction);
    expect(s).toEqual(before);
  });

  it('stays deterministic when events are collected', () => {
    const { actions } = playRun(5, clerk(5));
    const a = newRun(5), b = newRun(5);
    for (const x of actions) { apply(a, x); apply(b, x, []); }
    expect(a).toEqual(b);
  });
});
