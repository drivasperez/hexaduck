// Audit, Please: the rules engine. Pure and deterministic, like Scope Creep's: a run is a seed
// and a list of actions, so the browser saves it that way and the server replays it to check a
// score (src/replayed.ts). Nothing here touches the DOM.
//
//   const s = newRun(seed);  apply(s, action, events?);  score(s)
//
// Time runs on actions, not seconds: calling an applicant, inspecting and stamping each cost
// minutes of the working day. Reading the paperwork is free.

import {
  APPROVED_REGISTRIES, check, dateValue, field, GRID_FACTOR, isDiscrepancy, NET_ZERO_MAX, OLDEST_VINTAGE, RULES,
  rulesFor, SCOPE3_SECTORS, UNACCREDITED, UNAPPROVED_REGISTRIES, VERIFIERS, YEAR,
} from './rules.js';

// Bump whenever the rules change in a way that would make an existing run replay differently.
export const VERSION = 1;
export const DAYS = 10;
export const OPEN = 9 * 60, CLOSE = 17 * 60;
export const COST = { next: 18, inspect: 5, stamp: 4 };
export const PAY = { correct: 3, documented: 1, fine: 5, freeCitations: 2 };
export const NEST = { rent: 20, food: 5, heat: 8, coldHeat: 12, medicine: 15 };
const DATES = ['2031-03-10', '2031-03-11', '2031-03-12', '2031-03-13', '2031-03-14', '2031-03-17', '2031-03-18', '2031-03-19', '2031-03-20', '2031-03-21'];
const COLD_DAYS = [4, 5, 6, 7];

export class IllegalAction extends Error {}
const illegal = msg => { throw new IllegalAction(msg); };
let sink = null;
const note = ev => { if (sink) sink.push(ev); };

// ---------- randomness ----------
function next(s, stream) {
  let a = (s.rng[stream] + 0x6d2b79f5) | 0;
  s.rng[stream] = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (s, st, lo, hi) => lo + Math.floor(next(s, st) * (hi - lo + 1));
const pick = (s, st, arr) => arr[Math.floor(next(s, st) * arr.length)];
function weighted(s, st, pairs) {
  const total = pairs.reduce((n, [, w]) => n + w, 0);
  let r = next(s, st) * total;
  for (const [v, w] of pairs) if ((r -= w) < 0) return v;
  return pairs[pairs.length - 1][0];
}
export function seedFrom(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---------- the world ----------
const FIRST = ['Mallard', 'Heron', 'Kingfisher', 'Otter', 'Reed', 'Willow', 'Marsh', 'Pike', 'Teal', 'Coot', 'Grebe', 'Moorhen', 'Alder', 'Sedge', 'Bramble'];
const TRADES = [
  ['Logistics', 'Transport'], ['Foods', 'Food'], ['Energy', 'Energy'], ['Apparel', 'Apparel'], ['Cement', 'Materials'],
  ['Airways', 'Transport'], ['Bank', 'Finance'], ['Plastics', 'Materials'], ['Dairy', 'Food'], ['Steel', 'Materials'],
  ['Stores', 'Retail'], ['Digital', 'Tech'], ['Shipping', 'Transport'], ['Chemicals', 'Materials'], ['Outfitters', 'Apparel'], ['Software', 'Tech'],
];
const SUFFIX = ['Ltd', 'plc', 'Group', '& Co'];
const REPS = ['🦆', '🦢', '🦉', '🦊', '🐸', '🦫', '🦦', '🐿️', '🦡', '🐧', '🦩', '🐢'];
const REP_NAMES = ['Ms. Teal', 'Mr. Pintail', 'Dr. Eider', 'Ms. Wigeon', 'Mr. Scaup', 'Mx. Garganey', 'Ms. Shoveler', 'Mr. Goldeneye', 'Dr. Smew', 'Ms. Pochard'];
const PROJECTS = ['Peatland restoration', 'Mangrove protection', 'Cookstove distribution', 'Wind farm', 'Reforestation', 'Methane capture', 'Seagrass meadow'];
const SUPPLIERS = ['PondPower', 'Riverside Electric', 'Estuary Energy', 'Marsh Grid Co'];
const SIGNERS = ['A. Drake, CFO', 'B. Mallard, CEO', 'C. Heron, Head of ESG', 'D. Teal, Company Secretary', 'E. Coot, CSO'];

const OPENERS = [
  'Morning. Everything should be in order.', 'Our sustainability team worked very hard on this.', 'We\'re quite proud of this one.',
  'The board would like this approved today.', 'I think you\'ll find it all adds up.', 'First time filing. Be gentle.',
  'Same as last year, more or less.', 'Our consultants assured me it\'s fine.', 'Busy day? Let\'s make this quick.',
];
const EXCUSES = [
  'Ah. That must be a typo.', 'Our consultants handled that part.', 'Is that really a problem?', 'I\'m sure it rounds up.',
  'Nobody checked that last year.', 'Can\'t we just fix it later?', 'That was the old template.',
];
const GMP = { company: 'Grand Mallard Petroleum plc', reg: 'PS-100001', sector: 'Energy', rep: '🦚', repName: 'Mr. Peacock, Group Director' };

const clone = x => JSON.parse(JSON.stringify(x));

export function newRun(seed) {
  seed >>>= 0;
  const s = {
    v: VERSION, seed,
    rng: { cases: seed ^ 0x9e3779b9, story: seed ^ 0x85ebca6b, misc: seed ^ 0xc2b2ae35 },
    screen: 'intro', day: 1, minute: OPEN, money: 30,
    nest: ['Pip', 'Dot', 'Wren'].map(name => ({ name, hunger: 0, cold: 0, sick: 0, gone: false })),
    today: null, case: null, night: null, event: null, ending: null, over: null,
    stats: { correct: 0, wrong: 0, citations: 0, bribes: 0, reported: 0, cases: 0 },
    story: { reed: false, evidence: 0, copies: false, gmp: {} },
    usedNames: [], nextSerial: 1,
  };
  return s;
}

function startDay(s) {
  const bulletin = [];
  for (let i = 0; i < (s.day >= 6 ? 6 : 0); i++) bulletin.push(serial(s));
  s.today = { queue: 10 + s.day, served: 0, correct: 0, citations: 0, pay: 0, fines: 0, documented: 0, approvedSerials: [], bulletin, log: [] };
  s.minute = OPEN;
  s.case = null;
  s.screen = 'memo';
}

// Serials say nothing about the registry or vintage, so they can't seem to contradict either.
function serial(s) {
  return `VCU-${randInt(s, 'cases', 1000, 9999)}-${randInt(s, 'cases', 1000, 9999)}`;
}

// ---------- making cases ----------
function newCompany(s) {
  for (let tries = 0; tries < 30; tries++) {
    const [trade, sector] = pick(s, 'cases', TRADES);
    const name = `${pick(s, 'cases', FIRST)} ${trade} ${pick(s, 'cases', SUFFIX)}`;
    if (s.usedNames.includes(name)) continue;
    s.usedNames.push(name);
    return { company: name, reg: `PS-${randInt(s, 'cases', 200000, 999999)}`, sector };
  }
  return { company: `Coot Holdings ${s.usedNames.length} Ltd`, reg: `PS-${randInt(s, 'cases', 200000, 999999)}`, sector: 'Finance' };
}

const docOf = (id, title, fields) => ({ id, title, fields: Object.entries(fields).map(([key, [label, value]]) => ({ key, label, value })) });

// Builds a case that satisfies every rule, for a company and claim type.
function validCase(s, co, claim) {
  const big = co.sector === 'Materials' || co.sector === 'Energy' ? 8 : 1;
  const s1 = randInt(s, 'cases', 80, 900) * big, s2 = randInt(s, 'cases', 40, 600) * big;
  const s3 = randInt(s, 'cases', 200, 4000) * big;
  const withS3 = SCOPE3_SECTORS.includes(co.sector) || next(s, 'cases') < 0.6;
  const total = s1 + s2 + (withS3 ? s3 : 0);
  const scopes = withS3 ? '1, 2 and 3' : '1 and 2';
  const docs = [];
  const form = {
    company: ['Company', co.company], reg: ['Registration no.', co.reg], sector: ['Sector', co.sector], claim: ['Claim', claim],
    year: ['Reporting year', String(YEAR)], scopes: ['Scopes claimed', scopes], total: ['Total emissions (t CO₂e)', String(total)],
  };
  const needsOffsets = claim === 'Carbon neutral' || claim === 'Net zero';
  let baseline = null;
  if (claim === 'Net zero') baseline = Math.ceil(total / (0.03 + next(s, 'cases') * (NET_ZERO_MAX - 0.035)));
  if (claim === 'Emissions reduction') baseline = Math.ceil(total / (0.35 + next(s, 'cases') * 0.5));
  if (needsOffsets) form.offsets = ['Offsets retired (t)', String(total)];
  if (claim === 'Emissions reduction') {
    const actual = Math.floor((1 - total / baseline) * 100);
    form.reduction = ['Reduction claimed (%)', String(Math.max(1, actual - randInt(s, 'cases', 0, 6)))];
  }
  form.signed = ['Signed', pick(s, 'cases', SIGNERS)];
  docs.push(docOf('form', 'Claim form', form));
  docs.push(docOf('statement', 'Emissions statement', {
    company: ['Company', co.company], reg: ['Registration no.', co.reg], year: ['Year', String(YEAR)],
    s1: ['Scope 1 (t)', String(s1)], s2: ['Scope 2 (t)', String(s2)], s3: ['Scope 3 (t)', withS3 ? String(s3) : 'Not reported'],
    total: ['Total (t)', String(total)], factor: ['Grid factor (kg/kWh)', GRID_FACTOR],
  }));
  if (needsOffsets) {
    docs.push(docOf('cert', 'Offset certificate', {
      registry: ['Registry', pick(s, 'cases', APPROVED_REGISTRIES)], serial: ['Serial', serial(s)], project: ['Project', pick(s, 'cases', PROJECTS)],
      vintage: ['Vintage', String(randInt(s, 'cases', OLDEST_VINTAGE, YEAR))], tonnes: ['Tonnes', String(total + randInt(s, 'cases', 0, 3) * 50)],
      status: ['Status', 'Retired'], beneficiary: ['Beneficiary', co.company],
    }));
  }
  if (baseline) docs.push(docOf('baseline', 'Baseline report', { company: ['Company', co.company], baseyear: ['Baseline year', String(randInt(s, 'cases', 2018, 2022))], total: ['Baseline total (t)', String(baseline)] }));
  if (claim === 'Renewable electricity') {
    const mwh = randInt(s, 'cases', 800, 20000);
    docs.push(docOf('bill', 'Energy bill', { supplier: ['Supplier', pick(s, 'cases', SUPPLIERS)], company: ['Customer', co.company], year: ['Period', String(YEAR)], mwh: ['Electricity used (MWh)', String(mwh)] }));
    docs.push(docOf('rec', 'Renewable certificates', { holder: ['Holder', co.company], year: ['Year', String(YEAR)], mwh: ['Covered (MWh)', String(mwh + randInt(s, 'cases', 0, 4) * 100)] }));
  }
  if (s.day >= 3) {
    const [verifier, acc] = pick(s, 'cases', VERIFIERS);
    const valid = addDays(DATES[s.day - 1], randInt(s, 'cases', 20, 300));
    docs.push(docOf('letter', 'Verification letter', { verifier: ['Verifier', verifier], accreditation: ['Accreditation no.', acc], company: ['Company', co.company], scopes: ['Scopes verified', scopes], valid: ['Valid until', valid] }));
  }
  return docs;
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const set = (docs, doc, key, value) => { const f = docs.find(d => d.id === doc)?.fields.find(x => x.key === key); if (f) f.value = value; return !!f; };

// Ways to break each rule. Each returns false if it doesn't apply to this case.
const FLAWS = {
  year: (s, d) => set(d, pick(s, 'cases', ['form', 'statement']), 'year', String(pick(s, 'cases', [YEAR - 1, YEAR + 1]))),
  signed: (s, d) => set(d, 'form', 'signed', ''),
  match: (s, d) => {
    const target = pick(s, 'cases', d.filter(x => x.id !== 'form' && x.fields.some(f => f.key === 'company')).map(x => x.id));
    if (next(s, 'cases') < 0.5) {
      const name = field(d, 'form', 'company');
      return set(d, target, 'company', name.includes(' & Co') ? name.replace(' & Co', ' and Co') : name.replace(/ (Ltd|plc|Group)$/, m => ({ ' Ltd': ' Limited', ' plc': ' PLC', ' Group': ' Grp' }[m])));
    }
    const reg = field(d, 'form', 'reg');
    const digits = reg.slice(3).split('');
    const i = randInt(s, 'cases', 0, 4);
    [digits[i], digits[i + 1]] = digits[i] === digits[i + 1] ? [digits[i], String((Number(digits[i + 1]) + 1) % 10)] : [digits[i + 1], digits[i]];
    return set(d, 'statement', 'reg', `PS-${digits.join('')}`);
  },
  registry: (s, d) => set(d, 'cert', 'registry', pick(s, 'cases', UNAPPROVED_REGISTRIES)),
  vintage: (s, d) => set(d, 'cert', 'vintage', String(randInt(s, 'cases', 2016, OLDEST_VINTAGE - 1))),
  retired: (s, d) => (next(s, 'cases') < 0.6 ? set(d, 'cert', 'status', 'Active') : set(d, 'cert', 'beneficiary', `${pick(s, 'cases', FIRST)} Holdings Ltd`)),
  cover: (s, d) => { const t = Number(field(d, 'form', 'offsets')); return t > 0 && set(d, 'cert', 'tonnes', String(Math.floor(t * (0.5 + next(s, 'cases') * 0.4)))); },
  verifier: (s, d) => {
    if (!d.some(x => x.id === 'letter')) return false;
    const how = randInt(s, 'cases', 0, 2);
    if (how === 0) return set(d, 'letter', 'verifier', pick(s, 'cases', UNACCREDITED));
    if (how === 1) { const acc = field(d, 'letter', 'accreditation'); return set(d, 'letter', 'accreditation', acc.slice(0, -2) + String((Number(acc.slice(-2)) + 11) % 100).padStart(2, '0')); }
    return set(d, 'letter', 'valid', addDays(DATES[s.day - 1], -randInt(s, 'cases', 1, 60)));
  },
  scopes: (s, d) => field(d, 'form', 'scopes') === '1, 2 and 3' && set(d, 'letter', 'scopes', '1 and 2'),
  sums: (s, d) => {
    const total = Number(field(d, 'statement', 'total'));
    const off = randInt(s, 'cases', 1, 9) * (next(s, 'cases') < 0.5 ? 10 : 100);
    // Changing the statement's total would also change reduction and net zero percentages, so
    // for those claims only the claim form gets the wrong total.
    const claim = field(d, 'form', 'claim');
    if (claim !== 'Emissions reduction' && claim !== 'Net zero' && next(s, 'cases') < 0.5) return set(d, 'statement', 'total', String(total + off)) && set(d, 'form', 'total', String(total + off)) && (!d.some(x => x.id === 'cert') || (set(d, 'form', 'offsets', String(total + off)), set(d, 'cert', 'tonnes', String(total + off))));
    return set(d, 'form', 'total', String(total - off));
  },
  reduction: (s, d) => { const r = field(d, 'form', 'reduction'); return r !== undefined && set(d, 'form', 'reduction', String(Math.min(99, Number(r) + randInt(s, 'cases', 8, 20)))); },
  netzero: (s, d) => { const base = Number(field(d, 'baseline', 'total')); return field(d, 'form', 'claim') === 'Net zero' && base > 0 && set(d, 'baseline', 'total', String(Math.floor(Number(field(d, 'statement', 'total')) / (0.15 + next(s, 'cases') * 0.3)))); },
  double: (s, d) => { if (!d.some(x => x.id === 'cert')) return false; const pool = [...s.today.bulletin, ...s.today.approvedSerials]; return pool.length > 0 && set(d, 'cert', 'serial', pick(s, 'cases', pool)); },
  renewable: (s, d) => { const m = Number(field(d, 'bill', 'mwh')); return m > 0 && set(d, 'rec', 'mwh', String(Math.floor(m * (0.4 + next(s, 'cases') * 0.45)))); },
  scope3: (s, d) => SCOPE3_SECTORS.includes(field(d, 'form', 'sector')) && field(d, 'statement', 's3') !== 'Not reported' && (() => {
    const s3 = Number(field(d, 'statement', 's3'));
    set(d, 'statement', 's3', 'Not reported');
    const total = Number(field(d, 'statement', 'total')) - s3;
    set(d, 'statement', 'total', String(total)); set(d, 'form', 'total', String(total)); set(d, 'form', 'scopes', '1 and 2'); set(d, 'letter', 'scopes', '1 and 2');
    if (field(d, 'form', 'offsets')) { set(d, 'form', 'offsets', String(total)); set(d, 'cert', 'tonnes', String(total)); }
    return true;
  })(),
  factor: (s, d) => set(d, 'statement', 'factor', pick(s, 'cases', ['0.12', '0.09', '0.15', '0.11'])),
};

function claimTypes(day) {
  const out = [['Emissions report', day === 1 ? 1 : 2]];
  if (day >= 2) out.push(['Carbon neutral', day >= 5 ? 1 : 3], ['Emissions reduction', 2]);
  if (day >= 5) out.push(['Net zero', 3]);
  if (day >= 7) out.push(['Renewable electricity', 3]);
  return out;
}

function ctxFor(s) {
  return { date: DATES[s.day - 1], bulletin: s.today.bulletin, approvedSerials: s.today.approvedSerials };
}

function makeCase(s) {
  const scripted = STORY_CASES[s.day];
  const n = s.today.served;
  let co, docs, rep, repName, bribe = null, story = null;
  if (scripted && n === scripted.at) {
    co = GMP; rep = GMP.rep; repName = GMP.repName; story = scripted.id;
    docs = validCase(s, GMP, scripted.claim);
    scripted.tweak?.(s, docs);
    bribe = scripted.bribe || null;
  } else {
    co = newCompany(s);
    rep = pick(s, 'cases', REPS); repName = pick(s, 'cases', REP_NAMES);
    const claim = weighted(s, 'cases', claimTypes(s.day));
    docs = validCase(s, co, claim);
    const flawChance = Math.min(0.55, 0.35 + s.day * 0.03);
    if (claim !== 'Carbon neutral' || s.day < 5) {
      if (next(s, 'cases') < flawChance) {
        // Newer rules turn up more often on the days they arrive.
        const options = rulesFor(s.day).filter(r => r.id !== 'noNeutral').map(r => [r.id, r.day === s.day ? 4 : r.day >= s.day - 1 ? 2 : 1]);
        for (let tries = 0; tries < 8; tries++) {
          const id = weighted(s, 'cases', options);
          const trial = clone(docs);
          if (FLAWS[id](s, trial) && check(trial, s.day, ctxFor(s)).length) { docs = trial; break; }
        }
      }
    }
    if (next(s, 'cases') < 0.08 && s.day >= 3) bribe = randInt(s, 'cases', 2, 6) * 5;
  }
  const results = check(docs, s.day, ctxFor(s));
  s.case = {
    n, company: co.company, rep, repName, docs, results, found: [], story, line: pick(s, 'cases', OPENERS),
    bribe: bribe ? { amount: bribe, decided: false, taken: false } : null,
  };
  s.today.served++;
}

// The Grand Mallard Petroleum storyline: a case on given days, and what's wrong with it.
const STORY_CASES = {
  3: { id: 'gmp1', at: 2, claim: 'Carbon neutral' },
  5: { id: 'gmp2', at: 1, claim: 'Carbon neutral', bribe: 30 },
  7: { id: 'gmp3', at: 3, claim: 'Net zero', bribe: 50, tweak: (s, d) => set(d, 'cert', 'serial', s.today.bulletin[0]) },
  10: { id: 'gmp4', at: 2, claim: 'Net zero', tweak: (s, d) => { set(d, 'baseline', 'total', String(Math.floor(Number(field(d, 'statement', 'total')) / 0.78))); set(d, 'letter', 'scopes', '1 and 2'); set(d, 'form', 'scopes', '1, 2 and 3'); } },
};

// ---------- memos and nights ----------
export function memo(s) {
  const fresh = RULES.filter(r => r.day === s.day);
  const texts = {
    1: 'Welcome to the Pond Standards Authority. You\'ll be verifying sustainability claims at Window 3. Check each claim against the rulebook, stamp it Approved or Rejected, and don\'t hold up the queue. You\'re paid for every claim you get right. Mistakes earn citations; after two in a day, each one costs you £5. — Director Heron',
    2: 'Offsets are now in scope. Check certificates carefully: registry, vintage, status and tonnes. — Director Heron',
    3: 'Every claim now needs a verification letter. Also: Grand Mallard Petroleum files today. They are a valued client of this Authority. — Director Heron',
    4: 'Arithmetic is now your responsibility. You would be amazed how often it goes wrong. A cold snap is forecast; heating costs are up. — Director Heron',
    5: 'Directive 5 takes effect today: "carbon neutral" claims are banned outright. Net zero claims must meet the new standard. — Director Heron',
    6: 'Double counting is now the Authority\'s top priority. Consult the Retired Serials bulletin, and remember what you approved today. — Director Heron',
    7: 'We now verify renewable electricity claims. Grand Mallard files again today. I trust there will be no difficulties. — Director Heron',
    8: 'Scope 3 reporting is mandatory for the sectors listed. — Director Heron',
    9: 'Some filers have been using out-of-date emission factors. Only the official factor is acceptable. — Director Heron',
    10: s.story.gmp.gmp3 === 'reject' || s.story.gmp.gmp2 === 'reject'
      ? 'Grand Mallard Petroleum files its net zero claim today. It will be approved. That is not a request. — Director Heron'
      : 'Grand Mallard Petroleum files its net zero claim today. I expect the usual efficiency. — Director Heron',
  };
  return { text: texts[s.day], rules: fresh };
}

const NIGHT_EVENTS = {
  2: {
    text: 'A note is tucked under your door: "Keep an eye on Grand Mallard Petroleum. Note every discrepancy in their paperwork. We\'ll be in touch. — The Reed Collective"',
    options: [
      { label: 'Keep the note', do: s => { s.story.reed = true; return 'You tuck it inside your rulebook.'; } },
      { label: 'Hand it to Director Heron', do: s => { s.money += 10; return 'The Director thanks you for your loyalty, and adds £10 to your pay.'; } },
    ],
  },
  6: {
    text: s => (s.story.reed ? 'The Reed Collective asks for copies of Grand Mallard\'s paperwork. The office copier charges £5.' : 'The office copier is free for once. You make a few copies of nothing in particular.'),
    options: s => (s.story.reed
      ? [
        { label: 'Make copies (£5)', do: s => { s.money -= 5; s.story.copies = true; return 'You slip the copies to a duck in a reed-green scarf.'; } },
        { label: 'Decline', do: () => 'You decide it\'s none of your business.' },
      ]
      : [{ label: 'Go home', do: () => 'You go home.' }]),
  },
};

const HEADLINES = [
  'Pond levels hit a record low', 'Heatwave warnings extended', 'Grand Mallard Petroleum posts record profits', 'Estuary floods again',
  'New offset scandal rocks registry', 'Ducklings protest outside the Authority', 'Scope 3 "the hardest problem", say experts', 'Coal plant closes early',
  'Sea wall contract awarded', 'Authority praised for rigour',
];

// ---------- endings ----------
function finish(s, reason) {
  s.screen = 'end';
  s.ending = reason;
  const bonus = { expose: 150, reassigned: 40, promotion: 100 }[reason] || 0;
  s.money += bonus;
  note({ k: 'end', reason });
}

// ---------- actions ----------
// Applies one action (changing the state). Throws IllegalAction if it isn't allowed right now,
// leaving the state as it was. Pass an array as `events` to have what happened noted in it.
/** @param {object[] | null} [events] */
export function apply(s, a, events = null) {
  sink = events;
  try { applyAction(s, a); return s; } finally { sink = null; }
}

function applyAction(s, a) {
  if (!a || typeof a !== 'object') illegal('not an action');
  if (s.screen === 'end') illegal('the run is over');
  switch (s.screen) {
    case 'intro':
      if (a.type !== 'begin') illegal('begin');
      startDay(s);
      return;
    case 'memo':
      if (a.type !== 'start') illegal('start the day');
      s.screen = 'desk';
      return;
    case 'desk': return deskAction(s, a);
    case 'night': return nightAction(s, a);
    case 'event': {
      const ev = NIGHT_EVENTS[s.day];
      const options = typeof ev.options === 'function' ? ev.options(s) : ev.options;
      const o = options[a.index];
      if (a.type !== 'choose' || !o) illegal('choose an option');
      s.event = { result: o.do(s) };
      s.screen = 'event-result';
      return;
    }
    case 'event-result':
      if (a.type !== 'continue') illegal('continue');
      s.event = null;
      nextDay(s);
      return;
  }
  illegal(`nothing to do on ${s.screen}`);
}

function deskAction(s, a) {
  const c = s.case;
  if (a.type === 'next') {
    if (c) illegal('finish this claim first');
    if (s.today.queue <= s.today.served) illegal('the queue is empty');
    if (s.minute + COST.next > CLOSE) illegal('the window is closing');
    s.minute += COST.next;
    makeCase(s);
    note({ k: 'arrive', company: s.case.company });
    return;
  }
  if (a.type === 'inspect') {
    if (!c) illegal('there\'s no claim on the desk');
    if (typeof a.a !== 'string' || typeof a.b !== 'string' || a.a === a.b) illegal('pick two different things');
    if (!refExists(s, a.a) || !refExists(s, a.b)) illegal('that isn\'t on the desk');
    s.minute += COST.inspect;
    const hit = isDiscrepancy(c.results, a.a, a.b);
    if (hit && !c.found.includes(hit.rule)) {
      c.found.push(hit.rule);
      c.line = pick(s, 'misc', EXCUSES);
      note({ k: 'found', rule: hit.rule, why: hit.why, a: a.a, b: a.b });
    } else note({ k: hit ? 'already' : 'nothing', a: a.a, b: a.b });
    return;
  }
  if (a.type === 'bribe') {
    if (!c?.bribe || c.bribe.decided) illegal('there\'s no envelope');
    c.bribe.decided = true;
    if (a.take) { c.bribe.taken = true; s.money += c.bribe.amount; s.stats.bribes++; }
    else { s.stats.reported++; s.today.pay += 5; }
    note({ k: 'bribe', take: !!a.take, amount: c.bribe.amount });
    return;
  }
  if (a.type === 'stamp') {
    if (!c) illegal('there\'s no claim on the desk');
    if (a.verdict !== 'approve' && a.verdict !== 'reject') illegal('approve or reject');
    if (c.bribe && !c.bribe.decided) illegal('deal with the envelope first');
    s.minute += COST.stamp;
    const valid = c.results.length === 0;
    const right = (a.verdict === 'approve') === valid;
    s.stats.cases++;
    if (right) {
      s.today.correct++; s.stats.correct++;
      s.today.pay += PAY.correct;
      if (a.verdict === 'reject' && c.found.length) { s.today.pay += PAY.documented; s.today.documented++; }
    } else {
      s.today.citations++; s.stats.wrong++; s.stats.citations++;
      if (s.today.citations > PAY.freeCitations) s.today.fines += PAY.fine;
    }
    if (a.verdict === 'approve') {
      const serial = field(c.docs, 'cert', 'serial');
      if (serial) s.today.approvedSerials.push(serial);
      s.today.log.push({ company: c.company, serial: serial || null });
    }
    if (c.story) {
      s.story.gmp[c.story] = a.verdict;
      if (c.found.length) s.story.evidence++;
    }
    note({ k: 'stamp', verdict: a.verdict, right, citation: !right, results: c.results.map(r => r.why) });
    s.case = null;
    return;
  }
  if (a.type === 'close') {
    if (c) illegal('finish this claim first');
    closeDay(s);
    return;
  }
  illegal('not a desk action');
}

// Things the player can point at while inspecting.
export function refExists(s, ref) {
  const [kind, key] = ref.split('.');
  if (kind === 'rule') return rulesFor(s.day).some(r => r.id === key);
  if (kind === 'ref') return ['registries', 'verifiers', 'sectors', 'factors'].includes(key);
  if (kind === 'bulletin') return s.day >= 6 && key === 'serials';
  if (kind === 'ledger') return key === 'serials';
  return !!s.case?.docs.find(d => d.id === kind)?.fields.some(f => f.key === key);
}

function closeDay(s) {
  const t = s.today;
  s.money += t.pay - t.fines;
  const cold = COLD_DAYS.includes(s.day);
  s.night = {
    pay: t.pay, fines: t.fines, correct: t.correct, served: t.served, citations: t.citations,
    costs: { rent: NEST.rent, food: NEST.food, heat: cold ? NEST.coldHeat : NEST.heat, medicine: NEST.medicine },
    headline: HEADLINES[(s.day - 1) % HEADLINES.length],
  };
  s.screen = 'night';
  note({ k: 'close' });
}

// What a night's choices cost. Rent is always due, even into debt.
export function nightCost(s, a) {
  const costs = s.night.costs;
  const food = Array.isArray(a.food) ? a.food : [], medicine = Array.isArray(a.medicine) ? a.medicine : [];
  let spend = costs.rent + (a.heat ? costs.heat : 0);
  s.nest.forEach((d, i) => { if (!d.gone && food[i]) spend += costs.food; if (!d.gone && d.sick && medicine[i]) spend += costs.medicine; });
  return spend;
}

function nightAction(s, a) {
  if (a.type !== 'sleep') illegal('decide on your spending');
  const living = s.nest.filter(d => !d.gone);
  const food = Array.isArray(a.food) ? a.food : [], medicine = Array.isArray(a.medicine) ? a.medicine : [];
  const costs = s.night.costs;
  const spend = nightCost(s, a);
  if (spend > Math.max(0, s.money) + costs.rent) illegal('you can\'t afford all that');
  s.money -= spend;
  s.nest.forEach((d, i) => {
    if (d.gone) return;
    if (d.sick) {
      if (medicine[i]) { d.sick = 0; d.hunger = 0; d.cold = 0; }
      else if (++d.sick > 2) { d.gone = true; note({ k: 'gone', name: d.name }); return; }
    }
    d.hunger = food[i] ? 0 : d.hunger + 1;
    d.cold = a.heat ? 0 : d.cold + 1;
    if (!d.sick && (d.hunger >= 2 || d.cold >= 2)) d.sick = 1;
  });
  // Taking envelopes catches up with you.
  if (s.stats.bribes && next(s, 'story') < 0.12 * s.stats.bribes) return finish(s, 'fired');
  if (s.money < -20) return finish(s, 'evicted');
  if (!s.nest.some(d => !d.gone)) return finish(s, 'alone');
  s.night = null;
  if (NIGHT_EVENTS[s.day]) { s.screen = 'event'; return; }
  nextDay(s);
  void living;
}

function nextDay(s) {
  if (s.day >= DAYS) {
    const gmp = s.story.gmp.gmp4;
    return finish(s, gmp === 'approve' ? 'promotion' : s.story.reed && s.story.copies && s.story.evidence >= 3 ? 'expose' : 'reassigned');
  }
  s.day++;
  startDay(s);
}

export function nightEvent(s) {
  const ev = NIGHT_EVENTS[s.day];
  if (!ev) return null;
  return { text: typeof ev.text === 'function' ? ev.text(s) : ev.text, options: typeof ev.options === 'function' ? ev.options(s) : ev.options };
}

// Every action the player could take right now (for tests and bots). Inspections list only the
// true discrepancies plus one miss, since every pair of things would be far too many.
export function legalActions(s) {
  switch (s.screen) {
    case 'intro': return [{ type: 'begin' }];
    case 'memo': return [{ type: 'start' }];
    case 'event': return nightEvent(s).options.map((_, index) => ({ type: 'choose', index }));
    case 'event-result': return [{ type: 'continue' }];
    case 'night': {
      // Everything, food and heat, food only, or just the rent: whichever can be afforded.
      const living = s.nest.map(d => !d.gone), none = [false, false, false];
      const options = [
        { type: 'sleep', food: living, heat: true, medicine: s.nest.map(d => !d.gone && !!d.sick) },
        { type: 'sleep', food: living, heat: true, medicine: none },
        { type: 'sleep', food: living, heat: false, medicine: none },
        { type: 'sleep', food: none, heat: false, medicine: none },
      ];
      return options.filter(o => nightCost(s, o) <= Math.max(0, s.money) + s.night.costs.rent);
    }
    case 'desk': {
      const c = s.case;
      if (!c) {
        const out = [{ type: 'close' }];
        if (s.today.queue > s.today.served && s.minute + COST.next <= CLOSE) out.unshift({ type: 'next' });
        return out;
      }
      if (c.bribe && !c.bribe.decided) return [{ type: 'bribe', take: true }, { type: 'bribe', take: false }];
      const out = [{ type: 'stamp', verdict: 'approve' }, { type: 'stamp', verdict: 'reject' }];
      for (const r of c.results) out.push({ type: 'inspect', a: r.pairs[0][0], b: r.pairs[0][1] });
      out.push({ type: 'inspect', a: 'form.company', b: 'rule.signed' });
      return out;
    }
  }
  return [];
}

export function score(s) {
  const lost = s.nest.filter(d => d.gone).length;
  const bonus = { expose: 150, reassigned: 40, promotion: 100 }[s.ending] || 0;
  const parts = { savings: Math.max(0, s.money - bonus), correct: s.stats.correct * 3, ending: bonus, family: -lost * 25 };
  return { total: Math.max(0, Object.values(parts).reduce((a, b) => a + b, 0)), parts, ending: s.ending };
}
export const finished = s => s.screen === 'end';

export function replay(seed, actions) {
  const s = newRun(seed);
  for (const a of actions) apply(s, a);
  return s;
}

export const dateOf = day => DATES[day - 1];
export const clock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export { RULES, rulesFor, check, dateValue };

// For tests: the case builder and the flaws, so they can be checked against the checker directly.
export const _internal = { validCase, FLAWS, ctxFor, newCompany, startDay, claimTypes };
