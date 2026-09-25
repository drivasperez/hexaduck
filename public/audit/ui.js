// Audit, Please: the interface. The rules live in engine.js and rules.js; this draws the desk
// and turns clicks and keys into actions. A run is saved as its seed and actions and replayed
// on load, which is also exactly what the server replays to check a score.

import * as E from './engine.js';
import { REFERENCE, rulesFor } from './rules.js';
import { createLeaderboard, savedName } from '/shared/leaderboard.js';
import { Sound } from '/scope-creep/audio.js';

const SAVE_KEY = 'audit-run';
const app = document.getElementById('app');
const tip = document.getElementById('tip');
let save = null, s = null;
const ui = { view: 'title', inspect: false, pick: null, message: null, tab: 'rules', stamped: null, posted: null, night: null, busy: false };

// ---------- saving ----------
function loadSave() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
  if (!raw) return null;
  if (raw.v !== E.VERSION) return { outdated: true };
  try { return { raw, state: E.replay(raw.seed, raw.actions) }; } catch (e) { console.warn(e); return { outdated: true }; }
}
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} };

async function startRun() {
  let runId = null;
  try {
    const res = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game: 'audit', mode: 0 }) });
    if (res.ok) runId = (await res.json()).runId;
  } catch (e) {}
  const seed = runId ? E.seedFrom(runId) : (Math.random() * 2 ** 32) >>> 0;
  save = { v: E.VERSION, runId, seed, actions: [] };
  s = E.newRun(seed);
  Object.assign(ui, { view: 'run', inspect: false, pick: null, message: null, tab: 'rules', posted: null, night: null });
  persist();
  render();
}

// ---------- actions ----------
function act(action) {
  if (ui.busy) return null;
  const events = [];
  try { E.apply(s, action, events); } catch (e) {
    if (e instanceof E.IllegalAction) { ui.message = { kind: 'warn', text: e.message[0].toUpperCase() + e.message.slice(1) + '.' }; render(); return null; }
    throw e;
  }
  save.actions.push(action);
  persist();
  for (const ev of events) react(ev);
  return events;
}

// Sounds and messages for what just happened.
function react(ev) {
  if (ev.k === 'arrive') { ui.message = null; ui.stamped = null; Sound.fx('paper'); }
  if (ev.k === 'found') { ui.message = { kind: 'found', text: `Discrepancy: ${ev.why}`, refs: [ev.a, ev.b] }; Sound.fx('found'); }
  if (ev.k === 'nothing') { ui.message = { kind: 'none', text: 'No discrepancy there.', refs: [ev.a, ev.b] }; Sound.fx('card'); }
  if (ev.k === 'already') { ui.message = { kind: 'none', text: 'You\'ve already noted that one.', refs: [ev.a, ev.b] }; }
  if (ev.k === 'bribe') { ui.message = { kind: ev.take ? 'warn' : 'found', text: ev.take ? `You pocket the £${ev.amount}.` : 'You hand the envelope to the Integrity Office. They thank you (£5).' }; Sound.fx(ev.take ? 'coin' : 'paper'); }
  if (ev.k === 'stamp') {
    if (ev.citation) {
      setTimeout(() => Sound.fx('buzz'), 250);
      ui.message = { kind: 'citation', text: `Citation: ${ev.verdict === 'approve' ? `that claim should have been rejected. ${ev.results[0] ?? ''}` : 'that claim was in order.'}` };
    } else ui.message = { kind: 'ok', text: ev.verdict === 'approve' ? 'Approved.' : 'Rejected.' };
  }
  if (ev.k === 'close') Sound.fx('coin');
}

// ---------- DOM helpers ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'tip') el.dataset.tip = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const money = n => `${n < 0 ? '−' : ''}£${Math.abs(n)}`;
const longDate = d => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// ---------- screens ----------
function render() {
  app.replaceChildren();
  Board.button.hidden = !(ui.view === 'title' || s?.screen === 'end');
  if (ui.view === 'how') { app.append(howScreen()); return; }
  if (ui.view === 'title' || !s) { app.append(titleScreen()); return; }
  const screen = { intro: introScreen, memo: memoScreen, desk: deskScreen, night: nightScreen, event: eventScreen, 'event-result': eventResultScreen, end: endScreen }[s.screen];
  app.append(topBar(), screen());
}

function topBar() {
  const t = s.today;
  return h('header', { class: 'bar' },
    h('span', { class: 'brand' }, 'Audit, Please'),
    s.day ? h('span', { class: 'when' }, `Day ${s.day}`, h('small', {}, longDate(E.dateOf(s.day)))) : null,
    s.screen === 'desk' ? h('span', { class: 'clock', tip: `The window closes at ${E.clock(E.CLOSE)}. Calling an applicant takes ${E.COST.next} minutes, inspecting ${E.COST.inspect}, stamping ${E.COST.stamp}.` }, '🕘 ', E.clock(s.minute)) : null,
    h('span', { class: 'stat', tip: 'Your savings. Rent, food and heating are due every night.' }, 'Savings ', h('b', {}, money(s.money + (s.screen === 'desk' ? t.pay - t.fines : 0)))),
    s.screen === 'desk' ? h('span', { class: 'stat', tip: `Citations today. The first ${E.PAY.freeCitations} are warnings; after that each costs £${E.PAY.fine}.` }, 'Citations ', h('span', { class: 'dots' }, [0, 1, 2].map(i => h('i', { class: i < t.citations ? 'on' : '' })), t.citations > 3 ? ` +${t.citations - 3}` : '')) : null,
    s.screen === 'desk' ? h('span', { class: 'stat', tip: 'Applicants still waiting.' }, 'Waiting ', h('b', {}, Math.max(0, t.queue - t.served))) : null,
    h('button', { type: 'button', class: 'btn small', 'aria-label': Sound.muted ? 'Unmute' : 'Mute', onclick: () => { Sound.toggle(); render(); } }, Sound.muted ? '🔇' : '🔊'),
    h('button', { type: 'button', class: 'btn small', onclick: () => { if (confirm('Leave for the title screen? Your run is saved.')) { ui.view = 'title'; render(); } } }, 'Menu'));
}

function titleScreen() {
  let existing = loadSave();
  const outdated = existing?.outdated;
  if (outdated) existing = null;
  const finished = existing && existing.state.screen === 'end';
  return h('main', { class: 'title' },
    h('div', { class: 'title-card' },
      h('div', { class: 'booth-art', 'aria-hidden': 'true' }, h('span', {}, '🦆'), h('div', { class: 'sign' }, 'WINDOW 3')),
      h('div', {},
        h('p', { class: 'tag' }, 'Pond Standards Authority'),
        h('h1', {}, 'Audit,', h('br'), 'Please'),
        h('p', { class: 'lede' }, 'Verify sustainability claims at Window 3. Spot the greenwashing, keep your ducklings fed, and decide what to do about Grand Mallard Petroleum.'),
        outdated ? h('p', { class: 'note' }, 'The game has been updated since your last shift, so that run can\'t be restored.') : null,
        h('div', { class: 'actions' },
          existing && !finished ? h('button', { type: 'button', class: 'btn primary', onclick: () => { save = existing.raw; s = existing.state; ui.view = 'run'; render(); } }, `Continue (day ${existing.state.day})`) : null,
          h('button', { type: 'button', class: existing && !finished ? 'btn' : 'btn primary', onclick: () => (existing && !finished && !confirm('Abandon your current run?') ? null : startRun()) }, 'New run'),
          finished && !existing.raw.posted ? h('button', { type: 'button', class: 'btn', onclick: () => { save = existing.raw; s = existing.state; ui.view = 'run'; render(); } }, existing.raw.runId ? 'Post your last run' : 'See how it ended') : null,
          h('button', { type: 'button', class: 'btn', onclick: () => { ui.view = 'how'; render(); } }, 'How to play')),
        h('p', { class: 'home-p' }, h('a', { class: 'home', href: '/' }, '‹ All games')))));
}

function howScreen() {
  return h('main', { class: 'screen' }, h('section', { class: 'paper memo how' },
    h('h2', {}, 'How to play'),
    h('p', {}, 'Each day, companies bring sustainability claims to your window with a stack of paperwork. Check it against the rulebook, which grows every day, and stamp the claim form Approved or Rejected.'),
    h('p', {}, `You're paid £${E.PAY.correct} for every correct decision. Wrong ones earn citations: the first ${E.PAY.freeCitations} each day are warnings, and after that each costs £${E.PAY.fine}.`),
    h('p', {}, 'Use Inspect to prove a discrepancy: click two things that disagree, such as two fields, or a field and a rule. Documented rejections pay a little extra, and some people will want evidence.'),
    h('p', {}, `Time runs on what you do, not on the clock: calling the next applicant takes ${E.COST.next} minutes, each inspection ${E.COST.inspect}, and stamping ${E.COST.stamp}. Reading is free. The window closes at ${E.clock(E.CLOSE)}.`),
    h('p', {}, 'Each night, pay the rent and decide what else you can afford: food and heating for your three ducklings, and medicine if they fall ill.'),
    h('p', {}, 'Keys: N calls the next applicant, I toggles Inspect, A approves and R rejects.'),
    h('button', { type: 'button', class: 'btn primary', onclick: () => { ui.view = s ? 'run' : 'title'; render(); } }, 'Back')));
}

function introScreen() {
  return h('main', { class: 'screen' }, h('section', { class: 'paper memo' },
    h('div', { class: 'letterhead' }, 'POND STANDARDS AUTHORITY', h('small', {}, 'Office of Claims Verification')),
    h('h2', {}, 'Letter of appointment'),
    h('p', {}, 'Congratulations. You have been appointed Junior Claims Verifier, Window 3, with effect from Monday 10 March 2031.'),
    h('p', {}, 'Your duties: to check every sustainability claim presented at your window against the rules in force, and to approve or reject it. You will be paid for accuracy. Your three ducklings will be glad of the income.'),
    h('p', { class: 'sig' }, '— Director Heron'),
    h('button', { type: 'button', class: 'btn primary', onclick: () => { act({ type: 'begin' }); render(); } }, 'Report for work')));
}

function memoScreen() {
  const m = E.memo(s);
  return h('main', { class: 'screen' }, h('section', { class: 'paper memo' },
    h('div', { class: 'letterhead' }, 'MEMORANDUM', h('small', {}, longDate(E.dateOf(s.day)))),
    h('p', {}, m.text),
    m.rules.length ? h('div', { class: 'newrules' }, h('h3', {}, 'New in the rulebook today'), h('ul', {}, m.rules.map(r => h('li', {}, h('b', {}, r.title), ': ', r.text)))) : null,
    h('button', { type: 'button', class: 'btn primary', onclick: () => { act({ type: 'start' }); render(); } }, 'Open the window')));
}

// ---------- the desk ----------
function deskScreen() {
  const c = s.case;
  return h('main', { class: `desk-screen${ui.inspect ? ' inspecting' : ''}` },
    h('section', { class: 'booth' },
      h('div', { class: 'window' + (c ? ' occupied' : '') },
        c ? h('div', { class: 'applicant' }, h('span', { class: 'face', 'aria-hidden': 'true' }, c.rep), h('div', { class: 'who' }, h('b', {}, c.repName), h('span', {}, c.company))) : h('div', { class: 'empty' }, s.today.served >= s.today.queue ? 'No one is waiting.' : `${s.today.queue - s.today.served} waiting`),
        h('div', { class: 'blinds', 'aria-hidden': 'true' })),
      c ? h('div', { class: 'speech' }, `“${c.line}”`) : null,
      controls(),
      messageView()),
    h('section', { class: 'desk', 'aria-label': 'Documents' }, c ? documents(c) : h('div', { class: 'desk-empty' }, s.minute + E.COST.next > E.CLOSE ? 'The window is closing.' : 'Call the next applicant when you\'re ready.')),
    rulebook());
}

function controls() {
  const c = s.case;
  const canNext = !c && s.today.queue > s.today.served && s.minute + E.COST.next <= E.CLOSE;
  if (!c) return h('div', { class: 'controls' },
    h('button', { type: 'button', class: 'btn primary big', disabled: !canNext, onclick: () => { act({ type: 'next' }); render(); } }, 'Call next applicant', h('kbd', {}, 'N')),
    h('button', { type: 'button', class: 'btn', onclick: () => { if (canNext && !confirm('Close the window early? The rest of the queue goes home.')) return; act({ type: 'close' }); ui.night = null; render(); } }, canNext ? 'Close early' : 'Close the window'));
  if (c.bribe && !c.bribe.decided) return h('div', { class: 'controls envelope' },
    h('p', {}, `✉️ An envelope is tucked inside the paperwork: "A small consultancy fee. £${c.bribe.amount}."`),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn', onclick: () => { act({ type: 'bribe', take: true }); render(); } }, 'Pocket it'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { act({ type: 'bribe', take: false }); render(); } }, 'Report it')));
  return h('div', { class: 'controls' },
    h('button', { type: 'button', class: `btn inspect${ui.inspect ? ' on' : ''}`, 'aria-pressed': ui.inspect ? 'true' : 'false', onclick: toggleInspect }, '🔍 Inspect', h('kbd', {}, 'I')),
    h('div', { class: 'stamps' },
      h('button', { type: 'button', class: 'stamp approve', onclick: () => stamp('approve') }, 'APPROVE', h('kbd', {}, 'A')),
      h('button', { type: 'button', class: 'stamp reject', onclick: () => stamp('reject') }, 'REJECT', h('kbd', {}, 'R'))));
}

function toggleInspect() {
  ui.inspect = !ui.inspect;
  ui.pick = null;
  if (ui.inspect) ui.message = { kind: 'hint', text: `Inspecting: click two things that disagree. Each look costs ${E.COST.inspect} minutes.` };
  render();
}

function messageView() {
  const m = ui.message;
  const found = s.case?.found || [];
  return h('div', { class: 'messages' },
    m ? h('p', { class: `msg ${m.kind}`, role: 'status' }, m.text) : null,
    found.length ? h('p', { class: 'msg noted' }, `Noted: ${found.length} discrepanc${found.length === 1 ? 'y' : 'ies'}.`) : null);
}

function stamp(verdict) {
  if (ui.busy) return;
  const form = document.querySelector('.doc[data-doc="form"]');
  ui.busy = true;
  if (form) form.append(h('div', { class: `inked ${verdict}` }, verdict === 'approve' ? 'APPROVED' : 'REJECTED'));
  Sound.fx('stamp');
  // Let the stamp land, then hand the papers back.
  setTimeout(() => {
    document.querySelector('.desk')?.classList.add('handing-back');
    setTimeout(() => { ui.busy = false; ui.inspect = false; ui.pick = null; act({ type: 'stamp', verdict }); render(); }, 320);
  }, 380);
}

// A reference the player can point at: a document field, a rule, or a list in the rulebook.
function pickable(ref, label, content, extraClass = '') {
  const refs = ui.message?.refs || [];
  const cls = `pickable ${extraClass}${ui.pick === ref ? ' picked' : ''}${refs.includes(ref) ? ` flagged ${ui.message.kind}` : ''}`;
  return h(ui.inspect ? 'button' : 'div', {
    type: ui.inspect ? 'button' : null, class: cls, 'data-ref': ref, 'aria-label': ui.inspect ? `Inspect ${label}` : null,
    onclick: ui.inspect ? () => pickRef(ref) : null,
  }, content);
}

function pickRef(ref) {
  if (!ui.pick) { ui.pick = ref; render(); return; }
  if (ui.pick === ref) { ui.pick = null; render(); return; }
  const a = ui.pick;
  ui.pick = null;
  act({ type: 'inspect', a, b: ref });
  render();
}

const DOC_STYLE = { form: 'form', statement: 'statement', cert: 'cert', letter: 'letter', baseline: 'statement', bill: 'bill', rec: 'cert' };
const DOC_ICON = { form: '📝', statement: '📊', cert: '🌳', letter: '✉️', baseline: '📈', bill: '⚡', rec: '🔋' };
function documents(c) {
  return c.docs.map((d, i) => h('article', { class: `doc ${DOC_STYLE[d.id] || ''}`, 'data-doc': d.id, style: `--tilt: ${((i * 37) % 7) - 3}deg`, 'aria-label': d.title },
    h('header', {}, h('span', { 'aria-hidden': 'true' }, DOC_ICON[d.id] || '📄'), d.title),
    h('dl', {}, d.fields.map(f => pickable(`${d.id}.${f.key}`, `${d.title}: ${f.label}`, [h('dt', {}, f.label), h('dd', {}, f.value === '' ? h('i', { class: 'blank' }, '(blank)') : f.value)])))));
}

function rulebook() {
  const tabs = [['rules', 'Rules']];
  for (const r of REFERENCE) if (r.day <= s.day) tabs.push([r.id, r.title]);
  if (s.day >= 6) tabs.push(['bulletin', 'Bulletin']);
  tabs.push(['ledger', 'Today']);
  if (!tabs.some(([id]) => id === ui.tab)) ui.tab = 'rules';
  let body;
  if (ui.tab === 'rules') body = h('ol', { class: 'rules' }, rulesFor(s.day).map(r => h('li', { class: r.day === s.day ? 'new' : '' }, pickable(`rule.${r.id}`, `Rule: ${r.title}`, [h('b', {}, r.title), ' ', r.text]))));
  else if (ui.tab === 'bulletin') body = pickable('bulletin.serials', 'Retired Serials bulletin', [h('p', { class: 'small' }, 'Retired Serials Bulletin. These serials have already been claimed:'), h('ul', { class: 'mono' }, s.today.bulletin.map(x => h('li', {}, x)))], 'block');
  else if (ui.tab === 'ledger') body = pickable('ledger.serials', 'Today\'s approvals', [h('p', { class: 'small' }, 'Claims you\'ve approved today:'), s.today.log.length ? h('ul', { class: 'mono' }, s.today.log.map(x => h('li', {}, `${x.company}${x.serial ? ` — ${x.serial}` : ''}`))) : h('p', { class: 'small' }, 'None yet.')], 'block');
  else {
    const ref = REFERENCE.find(r => r.id === ui.tab);
    body = pickable(`ref.${ref.id}`, ref.title, [h('p', { class: 'small' }, ref.title), h('ul', {}, ref.lines.map(x => h('li', {}, x)))], 'block');
  }
  return h('aside', { class: 'rulebook', 'aria-label': 'Rulebook' },
    h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(ui.tab === id), onclick: () => { ui.tab = id; render(); } }, label))),
    h('div', { class: 'page' }, body));
}

// ---------- evenings ----------
function nightScreen() {
  const n = s.night;
  if (!ui.night) ui.night = { food: s.nest.map(d => !d.gone), heat: true, medicine: s.nest.map(d => !d.gone && !!d.sick) };
  const choice = ui.night;
  const cost = E.nightCost(s, { type: 'sleep', ...choice });
  const left = s.money - cost;
  const status = d => (d.gone ? 'Flown south' : d.sick ? 'Sick' : d.hunger ? 'Hungry' : d.cold ? 'Cold' : 'Well');
  const toggle = (label, price, checked, onChange, disabled = false) => h('label', { class: `line${disabled ? ' disabled' : ''}` },
    h('input', { type: 'checkbox', checked: checked || null, disabled: disabled || null, onchange: e => { onChange(e.target.checked); render(); } }), h('span', {}, label), h('b', {}, money(price)));
  return h('main', { class: 'screen evening' },
    h('section', { class: 'paper ledger' },
      h('h2', {}, `End of day ${s.day}`),
      h('table', {}, [
        ['Claims handled', n.served], ['Correct', n.correct], ['Citations', n.citations], ['Pay', money(n.pay)], ['Fines', n.fines ? `−${money(n.fines)}` : '£0'],
      ].map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v)))),
      h('p', { class: 'savings' }, 'Savings after pay: ', h('b', {}, money(s.money)))),
    h('section', { class: 'paper nest' },
      h('h2', {}, 'At home'),
      h('div', { class: 'ducklings' }, s.nest.map(d => h('div', { class: `duckling ${status(d).toLowerCase().replace(' ', '-')}` }, h('span', { class: 'emoji', 'aria-hidden': 'true' }, d.gone ? '🕊️' : '🐤'), h('b', {}, d.name), h('small', {}, status(d))))),
      toggle('Rent', n.costs.rent, true, () => {}, true),
      toggle(`Heating${n.costs.heat > E.NEST.heat ? ' (cold snap)' : ''}`, n.costs.heat, choice.heat, v => { choice.heat = v; }),
      s.nest.map((d, i) => (d.gone ? null : toggle(`Food for ${d.name}`, n.costs.food, choice.food[i], v => { choice.food[i] = v; }))),
      s.nest.map((d, i) => (d.gone || !d.sick ? null : toggle(`Medicine for ${d.name}`, n.costs.medicine, choice.medicine[i], v => { choice.medicine[i] = v; }))),
      h('p', { class: `savings${left < 0 ? ' short' : ''}` }, 'Left after tonight: ', h('b', {}, money(left))),
      h('button', { type: 'button', class: 'btn primary', onclick: () => { const events = act({ type: 'sleep', ...choice }); if (events) { ui.night = null; render(); } } }, 'Go to sleep')),
    h('section', { class: 'paper news' }, h('p', { class: 'masthead' }, 'THE DAILY PADDLE'), h('h3', {}, n.headline), h('div', { class: 'columns', 'aria-hidden': 'true' }, h('i'), h('i'))));
}

function eventScreen() {
  const ev = E.nightEvent(s);
  return h('main', { class: 'screen' }, h('section', { class: 'paper memo note' },
    h('p', {}, ev.text),
    h('div', { class: 'options' }, ev.options.map((o, index) => h('button', { type: 'button', class: 'btn', onclick: () => { act({ type: 'choose', index }); render(); } }, o.label)))));
}

function eventResultScreen() {
  return h('main', { class: 'screen' }, h('section', { class: 'paper memo note' },
    h('p', {}, s.event.result),
    h('button', { type: 'button', class: 'btn primary', onclick: () => { act({ type: 'continue' }); render(); } }, 'Next morning')));
}

// ---------- the end ----------
const ENDINGS = {
  expose: ['The Exposé', 'Your evidence reaches the Reed Collective, and then the newspapers. Grand Mallard Petroleum\'s net zero claim collapses in public. Director Heron retires early, "to spend more time with his offsets". The Authority offers you his office.'],
  reassigned: ['Reassigned', 'You rejected Grand Mallard\'s claim, and within the week you\'re moved to the archive in the basement. It\'s quiet down there. Upstairs, someone else approves the claim.'],
  promotion: ['Promotion', 'Grand Mallard\'s claim sails through, and so do you: Senior Verifier, with a corner desk. A year later the claim unravels in the press, and nobody can quite remember who approved it.'],
  fired: ['Dismissed', 'The Integrity Office found the envelopes. You clear your desk before lunch.'],
  evicted: ['Evicted', 'The rent went unpaid once too often. You and the ducklings move in with your cousin on the far side of the pond.'],
  alone: ['An empty nest', 'The last of the ducklings has flown south. The flat is very quiet now.'],
};
function endScreen() {
  const [title, text] = ENDINGS[s.ending] || ['The end', ''];
  const sc = E.score(s);
  const nameInput = h('input', { maxlength: 16, value: ui.postName ?? savedName(), placeholder: 'Your name', 'aria-label': 'Your name' });
  const p = ui.posted;
  return h('main', { class: 'screen' }, h('section', { class: 'paper memo' },
    h('div', { class: 'letterhead' }, 'THE DAILY PADDLE', h('small', {}, 'Special edition')),
    h('h2', {}, title), h('p', {}, text),
    h('table', { class: 'score' },
      [['Savings', sc.parts.savings], ['Correct decisions', sc.parts.correct], ['Ending', sc.parts.ending], ['Family', sc.parts.family]].map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v > 0 ? `+${v}` : v))),
      h('tr', { class: 'total' }, h('td', {}, 'Score'), h('td', {}, sc.total))),
    save.runId
      ? p?.done ? h('p', { class: 'posted' }, p.error ? p.error : p.improved ? `Posted: #${p.rank} on the leaderboard.` : `Your best stands at ${p.best}, #${p.rank} on the leaderboard.`)
        : h('form', { class: 'board-row', onsubmit: e => { e.preventDefault(); post(nameInput.value); } }, nameInput, h('button', { type: 'submit', class: 'btn primary', disabled: p?.busy }, p?.busy ? 'Checking…' : 'Post score'))
      : h('p', {}, 'This run was played offline, so it can\'t go on the leaderboard.'),
    h('div', { class: 'row' },
      h('button', { type: 'button', class: 'btn primary', onclick: startRun }, 'New run'),
      h('button', { type: 'button', class: 'btn', onclick: () => { ui.view = 'title'; render(); } }, 'Title screen'))));
}

async function post(name) {
  ui.postName = name;
  ui.posted = { busy: true };
  render();
  try {
    const res = await fetch('/api/audit/finish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: save.runId, name, actions: save.actions }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'the leaderboard is unavailable');
    Board.setName(data.name);
    ui.posted = { done: true, ...data };
    save.posted = true;
    persist();
  } catch (e) {
    ui.posted = { done: true, error: `Couldn't post: ${e.message}.` };
  }
  render();
}

// ---------- tooltips and keys ----------
function showTip(el) {
  const text = el?.dataset.tip;
  if (!text) { tip.hidden = true; return; }
  tip.textContent = text; tip.hidden = false;
  const r = el.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(innerWidth - tip.offsetWidth - 8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${r.bottom + 8}px`;
}
document.addEventListener('pointerover', e => showTip(e.target.closest?.('[data-tip]')));
addEventListener('pointerdown', () => Sound.unlock(), true);
addEventListener('keydown', e => {
  Sound.unlock();
  if (e.target instanceof HTMLInputElement || Board.isOpen() || !s || s.screen !== 'desk' || ui.busy) return;
  const k = e.key.toLowerCase();
  if (k === 'n' && !s.case) { act({ type: 'next' }); render(); }
  else if (k === 'i' && s.case && !(s.case.bribe && !s.case.bribe.decided)) toggleInspect();
  else if (k === 'a' && s.case) stamp('approve');
  else if (k === 'r' && s.case) stamp('reject');
  else if (k === 'escape' && ui.inspect) toggleInspect();
});

const Board = createLeaderboard({ game: 'audit', modes: ['Score'], format: n => `${n}`, onClose: () => {} });
Board.button.addEventListener('click', () => Board.open(0));
render();
