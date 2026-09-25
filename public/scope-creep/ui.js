// Scope Creep's interface. The rules live in engine.js; this draws the state and turns clicks
// and keys into actions. A run is saved as its seed and the list of actions taken, and loading
// replays them, so a save is also exactly what the server replays to check a score.

import * as E from './engine.js';
import { KEYWORDS } from './cards.js';
import { createLeaderboard, savedName } from '/shared/leaderboard.js';
import { Sound } from './audio.js';
import { duckSVG, ducklingSVG, sceneSVG } from './art.js';

const SAVE_KEY = 'scope-creep-run';
const app = document.getElementById('app');
const tip = document.getElementById('tip');
const ICON = { fight: '🏭', elite: '🔥', event: '❓', shop: '🛒', rest: '🌿', treasure: '🎁', boss: '👑' };
const TOOL_ICON = { espresso: '☕', fireDrill: '🧯', drone: '🛸', eggBox: '🥚', legalLetter: '✉️', swiftReport: '📄', dacVoucher: '🌬️', firstAid: '🩹' };
// A symbol for each card and enemy, drawn large and faint as its "art".
const ART = {
  abate: '🎯', hedge: '🛡️', survey: '📋', diesel: '⛽', siteVisit: '🏗️', spreadsheet: '📊', dataRequest: '📨', emissionFactor: '🧮',
  matrix: '🔲', hatch: '🥚', peckOrder: '🐤', nestEgg: '🪺', waddle: '🦆', coalSeam: '⛏️', gasFlare: '🔥', treePlanting: '🌳',
  retrofit: '🔧', compliance: '✅', pressure: '📣', carbonTax: '💸', doubleMateriality: '⚖️', quickWin: '⚡', greenwash: '🎨',
  dueDiligence: '🔎', fullInventory: '🗂️', disclosure: '📢', auditTrail: '🧾', limitedAssurance: '🔏', scopeCreep: '📈',
  variance: '📉', clutch: '🥚', flightFormation: '🪽', vFormation: '✈️', migration: '🧭', imprinting: '💛', fracking: '🛢️',
  strandedAsset: '🏚️', carbonCapture: '🏭', natureOffset: '🌿', adaptation: '🌡️', heatDome: '☀️', regulation: '📜',
  classAction: '👩‍⚖️', capAndTrade: '♻️', justTransition: '🤝', litigationHold: '🗄️', netZeroPledge: '🎯', sbti: '🔬',
  fullValueChain: '🔗', flockTogether: '🦆', motherDuck: '🦢', tippingPoint: '🌋', moonshot: '🚀', crossCheck: '✔️',
  reforestation: '🌲', verificationBody: '🏛️', emergencyBrake: '🛑', ductTape: '🩹', scandal: '📰', junkCredit: '🗑️',
  impulseBuy: '🛍️', paperwork: '📑', redTape: '🎀', legacy: '⛓️', consentDecree: '📝', enforcement: '🚨',
};
const FOE_ART = {
  car: '🚗', chiller: '❄️', forklift: '🚜', diesel: '⚙️', cow: '🐄', boiler: '♨️', greenwasher: '🧴', flare: '🔥', foreman: '👷',
  boilerRoom: '🏭', coalPlant: '🏭', line: '🗼', peakDemand: '📈', broker: '💼', dataCentre: '🖥️', peaker: '⛽', gridOperator: '🎛️',
  offsetBroker: '🤝', merger: '🏢', substation: '🔌', grid: '⚡', supplier: '📦', ship: '🚢', fashion: '👗', jet: '🛩️',
  landfill: '🗑️', plantation: '🌴', consultant: '🧑‍💼', deforestation: '🪓', shadow: '👤', upstream: '⛏️', operations: '🏗️', downstream: '🚚',
};
const NODE_NAME = { fight: 'Emitter', elite: 'Elite', event: 'Unknown', shop: 'Shop', rest: 'Rest pond', treasure: 'Treasure', boss: 'Boss' };

let save = null;   // { v, runId, seed, actions }
let s = null;      // the replayed state
const ui = { view: 'title', selected: null, tool: null, picks: [], overlay: null, posted: null, hint: '' };

// ---------- saving ----------
// Returns the saved run replayed, or { outdated: true } if it was saved under older rules.
function loadSave() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; }
  if (!raw) return null;
  if (raw.v !== E.VERSION) return { outdated: true };
  try {
    return { raw, state: E.replay(raw.seed, raw.actions) };
  } catch (e) {
    console.warn('could not restore the saved run', e);
    return { outdated: true };
  }
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

async function startRun() {
  let runId = null;
  try {
    const res = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game: 'scopecreep', mode: 0 }) });
    if (res.ok) runId = (await res.json()).runId;
  } catch (e) {}
  // Offline, play on a random seed; the run just can't go on the leaderboard.
  const seed = runId ? E.seedFrom(runId) : (Math.random() * 2 ** 32) >>> 0;
  save = { v: E.VERSION, runId, seed, actions: [] };
  s = E.newRun(seed);
  ui.view = 'run'; ui.posted = null; ui.selected = null;
  persist();
  render();
}

// ---------- actions ----------
function act(action, from = null) {
  ui.pendingPlay = action.type === 'play' ? action.index : undefined;
  const before = snapshot();
  const ghost = from ? { rect: from.getBoundingClientRect(), node: from.cloneNode(true) } : null;
  try {
    E.apply(s, action);
  } catch (e) {
    if (e instanceof E.IllegalAction) { flash(e.message); return; }
    throw e;
  }
  save.actions.push(action);
  persist();
  ui.selected = null; ui.tool = null; ui.hint = '';
  if (s.screen !== 'select') ui.picks = [];
  render();
  pops(before);
  sounds(before, action);
  if (action.type === 'play' && s.combat && before.attack) jolt(document.querySelector('.hero'), 'strike');
  if (ghost) flyAway(ghost);
}

// A played card lifts off from where it was and fades.
function flyAway({ rect, node }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  node.classList.remove('held', 'ready', 'returning', 'lifted', 'selected');
  node.classList.add('ghost');
  node.style.transform = '';
  Object.assign(node.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.append(node);
  requestAnimationFrame(() => node.classList.add('go'));
  setTimeout(() => node.remove(), 450);
}

function sounds(before, action) {
  if (s.screen === 'gameover') return Sound.fx('gameover');
  if (s.screen === 'victory') return Sound.fx('victory');
  if (s.screen === 'reward' && before.screen === 'combat') return Sound.fx('reward');
  if (action.type === 'play' || action.type === 'tool') Sound.fx('card');
  const c = s.combat;
  if (c && [...before.foes].some(([uid, was]) => { const e = c.enemies.find(x => x.uid === uid); return e && e.hp + e.block < was; })) Sound.fx('hit');
  if (s.hp < before.hp) Sound.fx('hurt');
  else if (s.hp > before.hp) Sound.fx('heal');
  if (c && c.p.block > before.block && action.type !== 'end') Sound.fx('block');
  if (E.heat(s) > before.heat) Sound.fx('heat');
  else if (s.carbon > before.carbon) Sound.fx('emit');
  if (c && c.ducklings > before.ducklings) Sound.fx('duck');
}

function flash(text) {
  ui.hint = text[0].toUpperCase() + text.slice(1) + '.';
  render();
  setTimeout(() => { if (ui.hint) { ui.hint = ''; render(); } }, 1800);
}

// Floating numbers for what the last action changed.
function snapshot() {
  const c = s.combat;
  const played = s.combat && ui.pendingPlay !== undefined ? s.combat.hand[ui.pendingPlay] : null;
  return { attack: played && E.CARDS[played.id].type === 'attack', hp: s.hp, carbon: s.carbon, heat: E.heat(s), screen: s.screen, block: c?.p.block ?? 0, ducklings: c?.ducklings ?? 0, foes: new Map((c?.enemies || []).map(e => [e.uid, e.hp + e.block])) };
}
function pops(before) {
  const c = s.combat;
  if (!c) return;
  for (const e of c.enemies) {
    const was = before.foes.get(e.uid);
    if (was === undefined) continue;
    const lost = was - (e.hp + e.block);
    const el = document.querySelector(`[data-uid="${e.uid}"]`);
    if (lost > 0) { pop(el, `−${lost}`); jolt(el, 'shake'); }
  }
  const me = document.querySelector('.me');
  if (s.hp < before.hp) { pop(me, `−${before.hp - s.hp}`); jolt(me, 'ouch'); }
  if (s.carbon > before.carbon) pop(document.querySelector('.heat'), `+${s.carbon - before.carbon} CO₂`, 'smoke');
  if (s.carbon < before.carbon) pop(document.querySelector('.heat'), `−${before.carbon - s.carbon} CO₂`, 'green');
}
function jolt(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
function pop(el, text, cls = '') {
  if (!el) return;
  const p = h('span', { class: `pop ${cls}` }, text);
  el.append(p);
  setTimeout(() => p.remove(), 1600);
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

// Text with keywords picked out, each explained on hover.
const KW_RE = new RegExp(`\\b(${[...Object.keys(KEYWORDS), 'Duckling', 'Offsets'].join('|')})\\b`, 'g');
function rich(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(KW_RE)) {
    out.push(text.slice(last, m.index));
    const key = m[1] === 'Duckling' ? 'Ducklings' : m[1] === 'Offsets' ? 'Offset' : m[1];
    out.push(h('b', { class: 'kw', tip: `${key}: ${KEYWORDS[key]}` }, m[1]));
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

function cardView(card, { onClick, disabled, selected, price, extra, preview } = {}) {
  const def = E.CARDS[card.id];
  const cost = E.cardCost(card);
  const typeName = def.type[0].toUpperCase() + def.type.slice(1);
  return h('button', {
    type: 'button',
    class: `card ${def.type} r-${def.rarity}${def.fossil ? ' fossil' : ''}${card.up ? ' up' : ''}${disabled ? ' disabled' : ''}${selected ? ' selected' : ''}${extra ? ` ${extra}` : ''}`,
    'aria-label': `${E.cardName(card)}, ${cost === null ? 'unplayable' : `costs ${cost}`}. ${def.text(card.up)}`,
    'aria-pressed': selected ? 'true' : null,
    onclick: onClick,
  },
  cost !== null ? h('span', { class: `gem${card.up && def.upCost !== undefined ? ' cheaper' : ''}` }, cost) : null,
  h('span', { class: 'banner' }, h('span', { class: 'name' }, E.cardName(card))),
  h('span', { class: 'window', 'aria-hidden': 'true' }, h('span', { class: 'art' }, ART[card.id] || ''),
    def.fossil ? h('span', { class: 'stamp', tip: `Fossil: ${KEYWORDS.Fossil}` }, 'Fossil') : null),
  h('span', { class: 'ribbon' }, typeName),
  // One wrapper, so the text flows as a paragraph inside the centred box.
  h('span', { class: 'text' }, h('span', {}, rich(def.text(card.up)))),
  preview ? h('span', { class: 'preview', tip: 'What this card would do right now, with every modifier counted.' }, preview) : null,
  price !== undefined ? h('span', { class: 'price' }, `${price} £`) : null);
}

// ---------- top bar ----------
function topBar() {
  const heat = E.heat(s);
  const into = s.carbon % E.HEAT_STEP;
  const where = s.act ? `Act ${s.act}` : '';
  const bar = h('header', { class: 'bar' },
    h('span', { class: 'where' }, E.ACT_NAMES[s.act] || where, h('small', {}, `floor ${s.floor}`)),
    h('span', { class: 'stat', tip: 'Credibility: your health. Lose it all and the run ends.' }, h('span', { class: 'ico' }, '❤️'), `${s.hp}/${s.maxHp}`),
    h('span', { class: 'stat', tip: 'Grants: spend them at shops.' }, h('span', { class: 'ico' }, '💷'), s.gold),
    h('span', {
      class: `heat${heat ? ' hot' : ''}`,
      tip: `Carbon ${s.carbon}. Every ${E.HEAT_STEP} carbon is a point of Heat, and every enemy gains 1 Drive per Heat. ${s.offsets.length ? `${s.offsets.length} offset${s.offsets.length === 1 ? '' : 's'} awaiting audit.` : ''}`,
      style: 'position: relative',
    }, '🌡️', h('span', {}, `${s.carbon} CO₂`), h('span', { class: 'meter' }, h('i', { style: `width: ${(into / E.HEAT_STEP) * 100}%` })),
    h('span', { class: 'lvl' }, `Heat ${heat}`), s.offsets.length ? h('span', { class: 'chip', tip: 'Unaudited offsets. Each boss audits them: half fail and come back doubled.' }, `${s.offsets.length} ⚖️`) : null),
    h('span', { class: 'tools' }, s.potions.map((id, slot) => h('button', {
      type: 'button', class: `tool${id ? ' full' : ''}`, 'aria-label': id ? E.TOOLS[id].name : 'Empty tool slot',
      tip: id ? `${E.TOOLS[id].name}: ${E.TOOLS[id].text}${s.combat ? ' Click to use.' : ''}` : 'Empty tool slot',
      onclick: () => id && useTool(slot),
    }, id ? TOOL_ICON[id] : ''))),
    h('button', { type: 'button', class: 'btn small', onclick: () => { ui.overlay = 'deck'; render(); } }, `Deck ${s.deck.length}`),
    h('button', { type: 'button', class: 'btn small', 'aria-label': Sound.muted ? 'Unmute' : 'Mute', tip: 'Sound on or off (M)', onclick: () => { Sound.toggle(); render(); } }, Sound.muted ? '🔇' : '🔊'),
    h('button', { type: 'button', class: 'btn small', onclick: () => { ui.overlay = 'menu'; render(); } }, 'Menu'),
  );
  const relics = h('div', { class: 'relics', 'aria-label': 'Relics' }, s.relics.map(id => h('span', { class: `relic${E.RELICS[id].rarity === 'boss' ? ' boss' : ''}`, tip: E.RELICS[id].text, tabindex: 0 }, E.RELICS[id].name)));
  return [bar, relics];
}

function useTool(slot) {
  const id = s.potions[slot];
  if (!s.combat) { ui.overlay = { tool: slot }; render(); return; }
  if (E.TOOLS[id].target === 'enemy') { ui.tool = slot; ui.selected = null; ui.hint = 'Choose a target.'; render(); return; }
  act({ type: 'tool', slot });
}

// ---------- screens ----------
function render() {
  const scrollY = window.scrollY;
  app.replaceChildren();
  Board.button.hidden = !(ui.view === 'title' || s?.screen === 'gameover' || s?.screen === 'victory');
  Sound.mood(!s || ui.view === 'title' ? 'map' : s.screen === 'combat' ? s.combat.kind === 'fight' ? 'fight' : s.combat.kind : ['gameover', 'victory'].includes(s.screen) ? 'quiet' : 'map');
  // How to play is reachable from the title screen too, where no run is loaded.
  if (ui.view === 'how') { app.append(h('div', { class: 'app-bg', 'aria-hidden': 'true' }, sceneEl(s?.act || 1, false, s ? E.heat(s) : 0)), howScreen()); return; }
  if (ui.view === 'title' || !s) { app.append(titleScreen()); return; }
  if (s.screen !== 'combat') app.append(h('div', { class: 'app-bg', 'aria-hidden': 'true' }, sceneEl(s.act, false, E.heat(s))));
  app.append(...topBar());
  const screen = {
    mandate: mandateScreen, event: eventScreen, result: resultScreen, rest: restScreen, map: mapScreen, combat: combatScreen,
    reward: rewardScreen, shop: shopScreen, select: selectScreen, boss: bossScreen, gameover: endScreen, victory: endScreen,
  }[s.screen];
  app.append(screen());
  if (ui.overlay) app.append(overlay());
  if (s.screen !== 'map') window.scrollTo(0, scrollY);
}

function titleScreen() {
  let existing = loadSave();
  const outdated = existing?.outdated;
  if (outdated) existing = null;
  const finished = existing && ['gameover', 'victory'].includes(existing.state.screen);
  const duck = h('div', { class: 'duckart', 'aria-hidden': 'true' });
  duck.innerHTML = duckSVG();
  return h('main', { class: 'title' },
    sceneEl(1),
    h('div', { class: 'hero-card' }, duck, h('div', {},
      h('p', { class: 'tag' }, 'A duck deckbuilder'),
      h('h1', {}, 'Scope', h('br'), 'Creep'),
      h('p', { class: 'lede' }, 'Climb three scopes of emissions, keep your Credibility, and watch your carbon: power now makes every later fight harder.'),
      outdated ? h('p', { class: 'note' }, 'Scope Creep has been updated since your last run, so that run can\'t be restored. Sorry! A new run awaits.') : null,
      h('div', { class: 'actions' },
        existing && !finished
          ? h('button', { type: 'button', class: 'btn primary', onclick: () => { save = existing.raw; s = existing.state; ui.view = 'run'; render(); } }, `Continue (Act ${existing.state.act}, floor ${existing.state.floor})`)
          : null,
        h('button', { type: 'button', class: existing && !finished ? 'btn' : 'btn primary', onclick: () => (existing && !finished && !confirm('Abandon your current run and start a new one?') ? null : startRun()) }, 'New run'),
        // A finished run stays saved until the next one starts, so its score can still be posted.
        finished && existing.raw.runId && !existing.raw.posted
          ? h('button', { type: 'button', class: 'btn', onclick: () => { save = existing.raw; s = existing.state; ui.view = 'run'; ui.posted = null; render(); } }, 'Post your last run')
          : null,
        h('button', { type: 'button', class: 'btn', onclick: () => { ui.view = 'how'; render(); } }, 'How to play')),
      h('p', { style: 'margin-top: 26px' }, h('a', { class: 'home', href: '/' }, '‹ All games')))));
}

function howScreen() {
  const kw = Object.entries(KEYWORDS).map(([k, v]) => h('li', {}, h('b', {}, k), `: ${v}`));
  return h('main', { class: 'screen' }, h('div', { class: 'panel how' },
    h('h2', {}, 'How to play'),
    h('p', {}, 'You are a duck in charge of sustainability. Climb three acts (Scope 1, Scope 2 and Scope 3), choosing your path on each act\'s map, and defeat the boss at the top of each.'),
    h('h3', {}, 'Combat'),
    h('p', {}, 'Each turn you have 3 energy and draw 5 cards. Drag a card onto an enemy to play it on them, or drag it up out of your hand if it doesn\'t need a target. (Clicking works too: click a card, then its target.) While you aim, the enemy shows exactly how much damage it would take. Attacks lower an enemy\'s health; Assurance blocks damage until your next turn. Above each enemy is its intent: what it will do when you end your turn.'),
    h('h3', {}, 'Carbon and Heat'),
    h('p', {}, `Your carbon lasts the whole run. Enemies that Emit add to it every turn they're left standing, and Fossil cards add to it when you play them. Every ${E.HEAT_STEP} carbon is a point of Heat, and every enemy you meet afterwards gains 1 Drive (1 more damage per hit) for each point. Offsets lower carbon cheaply, but each boss audits them and half fail, coming back doubled. Removals are permanent. At rest ponds you can heal, upgrade a card, or restore a wetland to remove carbon.`),
    h('h3', {}, 'Building a deck'),
    h('p', {}, 'After each fight, choose a card to add (or skip it: a lean deck draws its best cards more often). Cards lean towards four styles: Measure enemies and spend the marks on big hits; hatch a flock of Ducklings that peck every turn; burn Fossil power and manage the carbon; or stack slow, inevitable Policy powers.'),
    h('h3', {}, 'Keywords'), h('ul', {}, kw),
    h('h3', {}, 'Keys'),
    h('p', {}, 'In combat: 1 to 9 pick a card, then 1 to 5 pick its target. E ends your turn. Escape cancels.'),
    h('button', { type: 'button', class: 'btn primary', onclick: () => { ui.view = s ? 'run' : 'title'; render(); } }, 'Back')));
}

const EVENT_ART = {
  salesman: '🧑‍💼', pond: '🦆', dataGap: '📉', campaign: '📺', supplier: '🏭', keynote: '🎤', flood: '🌊', spreadsheet: '📊',
  regulator: '🕵️', migration: '🦢', innovation: '💡', heatwave: '🥵',
};
function panel(title, text, ...rest) {
  return artPanel(null, title, text, ...rest);
}
function artPanel(icon, title, text, ...rest) {
  return h('main', { class: 'screen' }, h('section', { class: `panel${icon ? ' with-art' : ''}` },
    icon ? h('div', { class: 'medallion', 'aria-hidden': 'true' }, icon) : null,
    title ? h('h2', {}, title) : null, text ? h('p', {}, rich(text)) : null, ...rest));
}

function optionButtons(options, onPick) {
  return h('div', { class: 'options' }, options.map((o, i) => h('button', {
    type: 'button', class: 'btn option', disabled: o.enabled === false, onclick: () => onPick(i, o),
  }, o.label, o.detail ? h('span', {}, rich(o.detail)) : null)));
}

function mandateScreen() {
  return artPanel('📜', 'Your mandate', 'The board has given you a mandate to get the company\'s emissions under control. Before you start, choose how to begin.',
    optionButtons(s.mandate.map(i => E.MANDATES[i]), i => act({ type: 'choose', index: s.mandate[i] })));
}

function eventScreen() {
  const ev = E.EVENTS[s.event.id];
  return artPanel(EVENT_ART[s.event.id] || '❓', ev.title, ev.text, optionButtons(E.eventOptions(s), i => act({ type: 'choose', index: i })));
}

function resultScreen() {
  const icon = s.result.title === 'Treasure' ? '🎁' : s.result.title === 'Your mandate' ? '📜' : Object.entries(E.EVENTS).find(([, ev]) => ev.title === s.result.title)?.[0];
  return artPanel(EVENT_ART[icon] || (icon?.length <= 2 ? icon : '✅'), s.result.title, s.result.text, h('button', { type: 'button', class: 'btn primary', onclick: () => act({ type: 'continue' }) }, 'Continue'));
}

function restScreen() {
  return artPanel('🌿', 'A rest pond', 'Quiet water, and a moment to think.', optionButtons(E.restOptions(s), (_, o) => act({ type: 'rest', choice: o.id })));
}

function mapScreen() {
  const W = 80, PAD = 50, TOP = 60, rows = E.ROWS;
  const width = PAD * 2 + (E.COLS - 1) * W, height = PAD * 2 + TOP + rows * W;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Map');
  const X = col => (col === 'boss' ? width / 2 : PAD + col * W);
  const Y = row => height - PAD - row * W;
  const ns = (tag, attrs) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const open = new Set(E.reachable(s).map(String));
  const walked = s.path;
  for (let r = 0; r < rows; r++) s.map[r].forEach((node, c) => {
    if (!node) return;
    const targets = r === rows - 1 ? ['boss'] : node.n;
    for (const t of targets) {
      const isWalked = walked[r] === c && (t === 'boss' ? s.pos?.row === rows : walked[r + 1] === t);
      const x1 = X(c), y1 = Y(r), x2 = X(t), y2 = t === 'boss' ? Y(rows) + 30 : Y(r + 1);
      const bend = ((r * 7 + c * 13 + (t === 'boss' ? 5 : t) * 3) % 5 - 2) * 6;
      svg.append(ns('path', { d: `M ${x1} ${y1} Q ${(x1 + x2) / 2 + bend} ${(y1 + y2) / 2} ${x2} ${y2}`, class: `edge${isWalked ? ' walked' : ''}` }));
    }
  });
  const title = ns('text', { x: width / 2, y: 44, class: 'actname' });
  title.textContent = E.ACT_NAMES[s.act];
  svg.append(title);
  const rings = ns('g', { class: 'rings' });
  svg.append(rings);
  const nodes = [];
  for (let r = 0; r < rows; r++) s.map[r].forEach((node, c) => { if (node) nodes.push({ r, c, t: node.t }); });
  nodes.push({ r: rows, c: 'boss', t: 'boss' });
  const nextRow = s.pos === null ? 0 : s.pos.row + 1;
  for (const n of nodes) {
    const isOpen = n.r === nextRow && open.has(String(n.c));
    const visited = n.r < walked.length && walked[n.r] === n.c;
    const here = s.pos && s.pos.row === n.r && s.pos.col === n.c;
    const g = ns('g', { class: `node${isOpen ? ' open' : ''}${visited ? ' visited' : ''}${here ? ' here' : ''}`, transform: `translate(${X(n.c)} ${Y(n.r)})` });
    if (isOpen) {
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `Go to ${NODE_NAME[n.t]}`);
      g.addEventListener('click', () => act({ type: 'path', col: n.c }));
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act({ type: 'path', col: n.c }); } });
    }
    // The pulsing ring lives in its own layer, so the node itself keeps a steady size.
    if (isOpen) rings.append(ns('circle', { r: n.t === 'boss' ? 30 : 22, cx: X(n.c), cy: Y(n.r), class: 'ring' }));
    g.append(ns('circle', { r: n.t === 'boss' ? 30 : 22 }));
    const label = ns('text', { style: n.t === 'boss' ? 'font-size: 30px' : '' });
    label.textContent = ICON[n.t];
    g.append(label);
    const title = ns('title', {});
    title.textContent = NODE_NAME[n.t];
    g.append(title);
    svg.append(g);
  }
  const wrap = h('div', { class: 'mapwrap map' }, svg);
  requestAnimationFrame(() => {
    // Keep the next choices in view.
    const target = wrap.querySelector('.node.open');
    if (target) wrap.scrollTop = Math.max(0, target.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop - wrap.clientHeight * 0.6);
  });
  return h('main', { class: 'screen' },
    h('div', { class: 'legend' }, Object.entries(ICON).map(([k, v]) => h('span', {}, `${v} ${NODE_NAME[k]}`))),
    wrap);
}

// ---------- combat ----------
const STATUS = {
  measured: ['📏', 'Measured', 'bad'], drive: ['💪', 'Drive', ''], exposed: ['🎯', 'Exposed', 'bad'], diluted: ['💧', 'Diluted', 'bad'],
  liability: ['⚖️', 'Liability', 'bad'], regulation: ['📜', 'Regulation', 'good'],
};
function statusChips(st, forPlayer) {
  const chips = [];
  for (const [k, [icon, name, cls]] of Object.entries(STATUS)) {
    if (!st[k]) continue;
    chips.push(h('span', { class: `chip ${forPlayer && cls === 'bad' ? 'bad' : !forPlayer && cls === 'bad' ? 'good' : cls}`, tip: `${name}: ${KEYWORDS[name]}` }, `${icon} ${st[k]}`));
  }
  if (forPlayer) {
    if (st.drained) chips.push(h('span', { class: 'chip bad', tip: 'You will have less energy next turn.' }, `🔌 −${st.drained} energy next turn`));
    if (st.jammed) chips.push(h('span', { class: 'chip bad', tip: 'You will draw fewer cards next turn.' }, `📵 −${st.jammed} cards next turn`));
    if (st.nextBlock) chips.push(h('span', { class: 'chip good', tip: 'Assurance at the start of your next turn.' }, `🛡 +${st.nextBlock} next turn`));
    if (st.nextEnergy) chips.push(h('span', { class: 'chip good', tip: 'Extra energy next turn.' }, `⚡ +${st.nextEnergy} next turn`));
    if (st.capAndTrade) chips.push(h('span', { class: 'chip good', tip: 'Enemy emissions become Assurance until your next turn.' }, '♻️ Cap and Trade'));
  }
  return chips;
}

const INTENT = { attack: '⚔️', emit: '🏭', block: '🛡', buff: '▲', debuff: '✦', summon: '➕', escape: '✈️', unknown: '❓' };
function intentView(e) {
  const list = E.intents(s, e);
  const name = s.relics.includes('bigFour') ? 'Unknown' : E.moveName(s, e);
  const describe = i => ({
    attack: `Attacks for ${i.n}${i.times > 1 ? `, ${i.times} times` : ''}`,
    emit: `Emits ${i.n} carbon`, block: `Gains ${i.n} Assurance`, buff: 'Strengthens itself', debuff: 'Hinders you',
    summon: 'Summons help', escape: 'Escapes', unknown: 'Unknown',
  }[i.kind]);
  return h('div', { class: 'intent', tip: `${name}: ${list.map(describe).join('. ')}.` },
    list.map(i => h('span', { class: `i ${i.kind}` }, INTENT[i.kind],
      i.kind === 'attack' ? ` ${i.n}${i.times > 1 ? `×${i.times}` : ''}` : i.kind === 'emit' ? ` +${i.n}` : i.kind === 'block' ? ` ${i.n}` : '')));
}

const sceneCache = new Map();
function sceneEl(act, boss = false, heat = 0) {
  const key = `${act}:${boss}:${heat}`;
  if (!sceneCache.has(key)) sceneCache.set(key, sceneSVG(act, { boss, heat }));
  const el = h('div', { class: 'backdrop' });
  el.innerHTML = sceneCache.get(key);
  return el;
}
const backdrop = boss => sceneEl(s.act, boss, E.heat(s));

function combatScreen() {
  const c = s.combat;
  const living = c.enemies.filter(e => e.hp > 0 && !e.gone);
  const picking = ui.selected !== null || ui.tool !== null;

  // Enemies, standing on the right.
  const foes = h('div', { class: 'foes' }, c.enemies.filter(e => !e.gone).map(e => {
    const dead = e.hp <= 0;
    const index = living.indexOf(e);
    const def = E.FOES[e.id];
    const size = def.boss ? 'boss' : def.elite ? 'elite' : def.minion ? 'minion' : '';
    return h(picking && !dead ? 'button' : 'div', {
      class: `foe ${size}${dead ? ' dead' : ''}${picking && !dead ? ' targetable' : ''}`, 'data-uid': e.uid, 'data-index': dead ? null : index,
      type: picking && !dead ? 'button' : null,
      'aria-label': `${e.name}, ${e.hp} of ${e.maxHp} health${picking && !dead ? `. Target ${index + 1}` : ''}`,
      onclick: picking && !dead ? () => target(index) : null,
      onpointerenter: picking && !dead ? ev => previewOn(ev.currentTarget, index) : null,
      onfocus: picking && !dead ? ev => previewOn(ev.currentTarget, index) : null,
    },
    dead ? h('div', { class: 'intent' }) : intentView(e),
    h('div', { class: 'plate' },
      h('div', { class: 'fname', tip: def.passive || null }, picking && !dead ? h('span', { class: 'num' }, index + 1) : null, e.name, def.passive ? h('span', { class: 'info' }, 'ⓘ') : null),
      h('div', { class: 'bars' },
        e.block ? h('span', { class: 'shield', tip: 'Assurance: blocks damage until its next turn.' }, e.block) : null,
        h('div', { class: 'hpbar' }, h('i', { style: `width: ${(e.hp / e.maxHp) * 100}%` }), h('span', {}, dead ? 'Abated' : `${e.hp} / ${e.maxHp}`))),
      h('div', { class: 'chips' }, statusChips(e.st, false))),
    h('div', { class: 'figure', 'aria-hidden': 'true' }, h('span', {}, FOE_ART[e.id] || '🏭')));
  }));

  // You, on the left.
  const p = c.p;
  const powers = Object.entries(c.powers).map(([k, n]) => h('span', { class: 'chip good', tip: powerText(k) }, `${powerName(k)}${n > 1 ? ` ×${n}` : ''}`));
  const figure = h('div', { class: 'figure duck', 'aria-hidden': 'true' });
  figure.innerHTML = duckSVG();
  const flock = h('div', { class: 'flock', tip: c.ducklings ? `${c.ducklings} Ducklings: ${KEYWORDS.Ducklings}` : null, 'aria-label': c.ducklings ? `${c.ducklings} ducklings` : null });
  flock.innerHTML = ducklingSVG().repeat(Math.min(c.ducklings, 12));
  const hero = h('section', { class: 'hero me', 'aria-label': 'You' },
    h('div', { class: 'plate' },
      h('div', { class: 'fname' }, 'You', c.ducklings > 12 ? ` · ${c.ducklings} ducklings` : ''),
      h('div', { class: 'bars' },
        p.block ? h('span', { class: 'shield', tip: KEYWORDS.Assurance }, p.block) : null,
        h('div', { class: 'hpbar me' }, h('i', { style: `width: ${(s.hp / s.maxHp) * 100}%` }), h('span', {}, `${s.hp} / ${s.maxHp}`))),
      h('div', { class: 'chips' }, statusChips(p.st, true), powers)),
    h('div', { class: 'hero-body' }, figure, flock));

  // The hand, fanned along the bottom.
  const dealt = ui.lastTurn !== `${s.floor}:${c.turn}`;
  ui.lastTurn = `${s.floor}:${c.turn}`;
  const n = c.hand.length;
  const hand = h('div', { class: `hand${dealt ? ' deal' : ''}`, 'aria-label': 'Your hand', style: `--n: ${n}` }, c.hand.map((card, i) => {
    const el = cardView(card, {
      disabled: !E.playable(s, card), selected: ui.selected === i, preview: previewText(i),
      // Keyboard activation; pointer presses are handled as drags (see startDrag).
      onClick: ev => { if (ev.detail === 0) pickCard(i, ev.currentTarget); },
    });
    const k = i - (n - 1) / 2;
    el.style.setProperty('--k', k);
    el.style.setProperty('--k2', k * k);
    el.style.setProperty('--i', i);
    el.addEventListener('pointerdown', ev => startDrag(ev, i));
    return el;
  }));

  const energyMax = 3 + s.relics.reduce((a, id) => a + (E.RELICS[id].energy || 0), 0);
  return h('main', { class: `stage act${s.act} ${c.kind}` },
    backdrop(c.kind === 'boss'),
    h('div', { class: 'banner-line', role: 'status' }, ui.hint || c.log.slice(-1)[0] || ''),
    h('div', { class: 'arena' }, hero, foes),
    h('div', { class: 'hud' },
      h('div', { class: 'left' },
        h('div', { class: `orb${c.energy ? '' : ' empty'}`, tip: 'Energy: cards cost energy to play. It refills each turn.', 'aria-label': `${c.energy} energy` }, h('b', {}, c.energy), h('small', {}, `/${energyMax}`)),
        h('button', { type: 'button', class: 'pile draw', 'aria-label': `Draw pile, ${c.draw.length} cards`, onclick: () => { ui.overlay = 'draw'; render(); } }, h('span', {}, c.draw.length), h('small', {}, 'Draw'))),
      hand,
      h('div', { class: 'right' },
        h('button', { type: 'button', class: 'endturn', onclick: () => act({ type: 'end' }) }, 'End turn'),
        h('div', { class: 'piles' },
          h('button', { type: 'button', class: 'pile discard', 'aria-label': `Discard pile, ${c.discard.length} cards`, onclick: () => { ui.overlay = 'discard'; render(); } }, h('span', {}, c.discard.length), h('small', {}, 'Discard')),
          c.exhaust.length ? h('button', { type: 'button', class: 'pile retired', 'aria-label': `Retired, ${c.exhaust.length} cards`, onclick: () => { ui.overlay = 'exhaust'; render(); } }, h('span', {}, c.exhaust.length), h('small', {}, 'Retired')) : null))),
    aimLayer());
}

function aimLayer() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'aim');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

// ---------- drag to play ----------
// Press a card and drag. Targeted cards stay above the hand and draw an arrow to the enemy under
// the pointer; other cards follow the pointer and play when let go above the hand. A press
// without a drag works like a click: it plays the card, or picks it for targeting.
let drag = null;
const living = () => s.combat.enemies.filter(e => e.hp > 0 && !e.gone);

function startDrag(ev, i) {
  if (ev.button !== 0 || drag || !s.combat) return;
  const el = ev.currentTarget;
  const card = s.combat.hand[i];
  const def = E.CARDS[card.id];
  drag = { i, el, x0: ev.clientX, y0: ev.clientY, moved: false, targeted: def.target === 'enemy', playable: E.playable(s, card), ghost: null, aim: null, over: null };
  try { el.setPointerCapture(ev.pointerId); } catch (e) {}
  el.addEventListener('pointermove', moveDrag);
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', cancelDrag);
}

function moveDrag(ev) {
  const d = drag;
  if (!d) return;
  if (!d.moved) {
    if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 8) return;
    d.moved = true;
    if (!d.playable) { const def = E.CARDS[s.combat.hand[d.i].id]; flash(def.unplayable ? `${def.name} can't be played` : 'not enough energy'); cancelDrag(); return; }
    ui.selected = null; ui.tool = null;
    const r = d.el.getBoundingClientRect();
    d.ghost = d.el.cloneNode(true);
    d.ghost.classList.add('held');
    d.ghost.style.width = `${d.el.offsetWidth}px`;
    d.ghost.style.height = `${d.el.offsetHeight}px`;
    d.offset = [ev.clientX - r.left, ev.clientY - r.top];
    document.body.append(d.ghost);
    d.line = playLine();
    d.el.classList.add('lifted');
    d.aim = document.querySelector('.stage .aim');
  }
  const W = d.el.offsetWidth, H = d.el.offsetHeight;
  if (d.targeted) {
    // Hold the card above the middle of the hand and aim with an arrow.
    const hand = document.querySelector('.hand').getBoundingClientRect();
    const hx = hand.left + hand.width / 2 - W / 2, hy = hand.top - H * 0.55;
    d.ghost.style.transform = `translate(${hx}px, ${hy}px) scale(1.05)`;
    const sx = hx + W / 2, sy = hy + 6;
    const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.foe:not(.dead)');
    if (over !== d.over) {
      d.over?.classList.remove('aimed');
      document.querySelectorAll('.foe .preview-hit').forEach(n => n.remove());
      d.over = over;
      if (over) { over.classList.add('aimed'); showPreview(over, d.i, Number(over.dataset.index)); }
    }
    drawArrow(d.aim, sx, sy, ev.clientX, ev.clientY, !!over);
  } else {
    d.ghost.style.transform = `translate(${ev.clientX - d.offset[0]}px, ${ev.clientY - d.offset[1]}px) rotate(${Math.max(-8, Math.min(8, (ev.clientX - d.x0) / 30))}deg)`;
    d.ghost.classList.toggle('ready', ev.clientY < d.line);
  }
}

// Where a dragged card has to be let go to play: clearly above the resting tops of the cards.
function playLine() {
  const cards = [...document.querySelectorAll('.hand .card:not(.lifted)')].map(c => c.getBoundingClientRect().top);
  const top = cards.length ? Math.min(...cards) : document.querySelector('.hand').getBoundingClientRect().top;
  return top - 10;
}

function endDrag(ev) {
  const d = drag;
  if (!d) return;
  if (!d.moved) { cleanupDrag(); pickCard(d.i, d.el); return; }
  const aboveHand = ev.clientY < d.line;
  let action = null;
  if (d.targeted) {
    if (d.over) action = { type: 'play', index: d.i, target: Number(d.over.dataset.index) };
    else if (aboveHand && living().length === 1) action = { type: 'play', index: d.i, target: 0 };
  } else if (aboveHand) action = { type: 'play', index: d.i };
  const ghost = d.ghost;
  cleanupDrag(action ? null : ghost);
  if (action) act(action, ghost);
  ghost?.remove();
}

function cancelDrag() { cleanupDrag(drag?.ghost); }

function cleanupDrag(returning) {
  const d = drag;
  if (!d) return;
  drag = null;
  d.el.removeEventListener('pointermove', moveDrag);
  d.el.removeEventListener('pointerup', endDrag);
  d.el.removeEventListener('pointercancel', cancelDrag);
  d.over?.classList.remove('aimed');
  document.querySelectorAll('.foe .preview-hit').forEach(n => n.remove());
  if (d.aim) d.aim.replaceChildren();
  if (returning) {
    // Glide back into the hand.
    const r = d.el.getBoundingClientRect();
    returning.classList.add('returning');
    returning.style.transform = `translate(${r.left}px, ${r.top}px)`;
    setTimeout(() => { returning.remove(); d.el.classList.remove('lifted'); }, 180);
  } else d.el.classList.remove('lifted');
}

// A curved arrow, drawn as a trail of chevrons, from the held card to the pointer.
function drawArrow(svg, x1, y1, x2, y2, locked) {
  if (!svg) return;
  const ns = 'http://www.w3.org/2000/svg';
  const cx = x1 + (x2 - x1) * 0.2, cy = Math.min(y1, y2) - Math.abs(x2 - x1) * 0.25 - 60;
  const at = t => [(1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t * t * x2, (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t * t * y2];
  const parts = [];
  const steps = 16;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps, [x, y] = at(t), [px, py] = at(t - 0.02);
    const a = Math.atan2(y - py, x - px) * 180 / Math.PI;
    const size = k === steps ? 16 : 5 + k * 0.45;
    const el = document.createElementNS(ns, 'path');
    el.setAttribute('d', k === steps ? `M ${-size} ${-size * 0.8} L ${size * 0.6} 0 L ${-size} ${size * 0.8} Z` : `M ${-size} ${-size} L 0 0 L ${-size} ${size}`);
    el.setAttribute('transform', `translate(${x} ${y}) rotate(${a})`);
    el.setAttribute('class', `${k === steps ? 'head' : 'chev'}${locked ? ' locked' : ''}`);
    parts.push(el);
  }
  svg.replaceChildren(...parts);
}

function showPreview(el, cardIndex, index) {
  const sim = simulate(cardIndex, index);
  if (!sim) return;
  el.append(h('span', { class: `preview-hit${sim.kills ? ' lethal' : ''}` }, sim.kills ? `Abates it (${sim.onTarget})` : `−${sim.onTarget}`));
}

// What playing a card would do right now, found by playing it on a copy of the state. Returns
// the damage it deals (to `target`, or to everyone for cards that hit several enemies) and the
// Assurance it gives.
function simulate(index, target) {
  const card = s.combat.hand[index];
  if (!card || !E.playable(s, card)) return null;
  const copy = JSON.parse(JSON.stringify(s));
  const before = copy.combat.enemies.map(e => (e.hp > 0 && !e.gone ? e.hp + e.block : 0));
  const block = copy.combat.p.block;
  try { E.apply(copy, { type: 'play', index, target }); } catch (e) { return null; }
  const after = copy.combat ? copy.combat.enemies.map(e => (e.hp > 0 && !e.gone ? e.hp + e.block : 0)) : before.map(() => 0);
  const living = s.combat.enemies.filter(e => e.hp > 0 && !e.gone);
  const perEnemy = before.map((b, i) => Math.max(0, b - (after[i] ?? 0)));
  const t = living[target ?? 0];
  const onTarget = t ? perEnemy[s.combat.enemies.indexOf(t)] : 0;
  return { total: perEnemy.reduce((a, b) => a + b, 0), onTarget, block: copy.combat ? Math.max(0, copy.combat.p.block - block) : 0, kills: t && onTarget >= t.hp + t.block };
}

function previewText(index) {
  const card = s.combat.hand[index];
  const def = E.CARDS[card.id];
  if (def.unplayable || !E.playable(s, card)) return null;
  const living = s.combat.enemies.filter(e => e.hp > 0 && !e.gone);
  // A targeted card can do different things to different enemies (Measured, Exposed...).
  const sims = def.target === 'enemy' ? living.map((_, t) => simulate(index, t)).filter(Boolean) : [simulate(index)].filter(Boolean);
  if (!sims.length) return null;
  const sim = sims[0];
  const parts = [];
  if (def.target === 'enemy') {
    const lo = Math.min(...sims.map(x => x.onTarget)), hi = Math.max(...sims.map(x => x.onTarget));
    if (hi) parts.push(lo === hi ? `⚔ ${hi}` : `⚔ ${lo}–${hi}`);
  } else if (sim.total) parts.push(`⚔ ${sim.total}${def.target === 'all' ? ' total' : ''}`);
  if (sim.block) parts.push(`🛡 ${sim.block}`);
  return parts.length ? parts.join('  ') : null;
}

// With a card chosen, hovering an enemy shows exactly what it would take.
function previewOn(el, index) {
  document.querySelectorAll('.foe .preview-hit').forEach(n => n.remove());
  if (ui.selected === null || index === null) return;
  showPreview(el, ui.selected, index);
}

const POWER_NAMES = {
  auditTrail: 'Audit Trail', flightFormation: 'Flight Formation', imprinting: 'Imprinting', litigationHold: 'Litigation Hold',
  netZeroPledge: 'Net Zero Pledge', sbti: 'Science-Based Target', flockTogether: 'Birds of a Feather', verified: 'Verification Body',
};
const POWER_CARD = { auditTrail: 'auditTrail', flightFormation: 'flightFormation', imprinting: 'imprinting', litigationHold: 'litigationHold', netZeroPledge: 'netZeroPledge', sbti: 'sbti', flockTogether: 'flockTogether', verified: 'verificationBody' };
const powerName = k => POWER_NAMES[k] || k;
const powerText = k => (POWER_CARD[k] ? E.CARDS[POWER_CARD[k]].text(false) : '');

function pickCard(i, el = document.querySelectorAll('.hand .card')[i]) {
  const card = s.combat.hand[i];
  const def = E.CARDS[card.id];
  ui.tool = null;
  if (!E.playable(s, card)) { flash(def.unplayable ? `${def.name} can't be played` : 'not enough energy'); return; }
  if (def.target !== 'enemy') { act({ type: 'play', index: i }, el); return; }
  const living = s.combat.enemies.filter(e => e.hp > 0 && !e.gone);
  if (living.length === 1) { act({ type: 'play', index: i, target: 0 }, el); return; }
  ui.selected = ui.selected === i ? null : i;
  ui.hint = ui.selected === null ? '' : `Choose a target for ${E.cardName(card)}.`;
  render();
}

function target(index) {
  if (ui.tool !== null) act({ type: 'tool', slot: ui.tool, target: index });
  else if (ui.selected !== null) act({ type: 'play', index: ui.selected, target: index }, document.querySelectorAll('.hand .card')[ui.selected]);
}

// ---------- rewards, shop, selection ----------
function rewardScreen() {
  const r = s.reward;
  const full = !s.potions.includes(null);
  const rows = [];
  if (r.gold) rows.push(h('div', { class: 'reward' }, `💷 ${r.gold} grants`, h('button', { type: 'button', class: 'btn small', onclick: () => act({ type: 'take', what: 'gold' }) }, 'Take')));
  if (r.tool) rows.push(h('div', { class: 'reward' }, h('span', { tip: E.TOOLS[r.tool].text }, `${TOOL_ICON[r.tool]} ${E.TOOLS[r.tool].name}: `, h('small', {}, E.TOOLS[r.tool].text)),
    h('button', { type: 'button', class: 'btn small', disabled: full, onclick: () => act({ type: 'take', what: 'tool' }) }, full ? 'Tools full' : 'Take')));
  if (r.relic) rows.push(h('div', { class: 'reward' }, h('span', {}, `🏅 ${E.RELICS[r.relic].name}: `, h('small', {}, E.RELICS[r.relic].text)), h('button', { type: 'button', class: 'btn small', onclick: () => act({ type: 'take', what: 'relic' }) }, 'Take')));
  const title = s.lastCombat ? { fight: 'Abated', elite: 'Elite abated', boss: 'Boss defeated' }[s.lastCombat.kind] : 'Choose a card';
  return h('main', { class: 'screen' },
    h('section', { class: 'panel with-art' }, h('div', { class: 'medallion', 'aria-hidden': 'true' }, s.lastCombat?.kind === 'boss' ? '👑' : s.lastCombat?.kind === 'elite' ? '🔥' : '🏆'), h('h2', {}, title), rows.length ? h('div', { class: 'rewards' }, rows) : null,
      !r.cardsTaken && r.cards.length ? h('p', { style: 'margin-top: 16px' }, 'Add a card to your deck, or skip it to keep your deck lean.') : null),
    !r.cardsTaken ? h('div', { class: 'cards' }, r.cards.map((card, i) => cardView(card, { onClick: () => act({ type: 'take', what: 'card', index: i }) }))) : null,
    h('button', { type: 'button', class: 'btn primary', onclick: () => act({ type: 'continue' }) }, !r.cardsTaken && r.cards.length ? 'Skip and continue' : 'Continue'));
}

function shopScreen() {
  const sh = s.shop;
  const full = !s.potions.includes(null);
  return h('main', { class: 'screen' }, h('div', { class: 'shopgrid' },
    h('section', { class: 'panel', style: 'width: 100%' }, h('h2', {}, 'The Sustainability Supplies Shop'), h('p', {}, 'A duck behind the counter polishes a carbon calculator.')),
    h('section', {}, h('h3', {}, 'Cards'), h('div', { class: 'shoprow' }, sh.cards.map((card, i) => cardView(card, {
      price: card.price, extra: card.sold ? 'sold' : '', disabled: s.gold < card.price, onClick: () => act({ type: 'buy', kind: 'card', index: i }),
    })))),
    h('section', {}, h('h3', {}, 'Relics and tools'), h('div', { class: 'shoprow' },
      sh.relics.map((r, i) => h('button', { type: 'button', class: 'ware', disabled: r.sold || s.gold < r.price, onclick: () => act({ type: 'buy', kind: 'relic', index: i }) },
        h('b', {}, `🏅 ${E.RELICS[r.id].name}`), h('small', {}, E.RELICS[r.id].text), h('span', { class: 'p' }, r.sold ? 'Sold' : `${r.price} £`))),
      sh.tools.map((t, i) => h('button', { type: 'button', class: 'ware', disabled: t.sold || s.gold < t.price || full, onclick: () => act({ type: 'buy', kind: 'tool', index: i }) },
        h('b', {}, `${TOOL_ICON[t.id]} ${E.TOOLS[t.id].name}`), h('small', {}, E.TOOLS[t.id].text), h('span', { class: 'p' }, t.sold ? 'Sold' : full ? 'Tools full' : `${t.price} £`))))),
    h('section', {}, h('h3', {}, 'Services'), h('div', { class: 'shoprow' },
      h('button', { type: 'button', class: 'ware', disabled: !sh.removal || s.gold < E.removalPrice(s), onclick: () => act({ type: 'buy', kind: 'removal' }) },
        h('b', {}, '✂️ Remove a card'), h('small', {}, 'Take a card out of your deck for good.'), h('span', { class: 'p' }, sh.removal ? `${E.removalPrice(s)} £` : 'Done')),
      h('button', { type: 'button', class: 'ware', disabled: sh.capture.sold || s.gold < sh.capture.price, onclick: () => act({ type: 'buy', kind: 'capture' }) },
        h('b', {}, '🌬️ Direct Air Capture'), h('small', {}, rich(`Remove ${sh.capture.amount} carbon.`)), h('span', { class: 'p' }, sh.capture.sold ? 'Sold' : `${sh.capture.price} £`)))),
    h('button', { type: 'button', class: 'btn primary', style: 'align-self: center', onclick: () => act({ type: 'leave' }) }, 'Leave the shop')));
}

function selectScreen() {
  const sel = s.select;
  const options = E.selectable(s);
  const want = Math.min(sel.count, options.length);
  const verb = { upgrade: 'upgrade', remove: 'remove', duplicate: 'duplicate' }[sel.purpose];
  return h('main', { class: 'screen' },
    h('section', { class: 'panel' }, h('h2', {}, `Choose ${want === 1 ? 'a card' : `${want} cards`} to ${verb}`),
      sel.purpose === 'upgrade' && ui.picks.length === 1 ? h('p', {}, 'Upgraded: ', rich(E.CARDS[options.find(c => c.uid === ui.picks[0]).id].text(true))) : null,
      h('div', { style: 'display: flex; gap: 10px; flex-wrap: wrap' },
        h('button', { type: 'button', class: 'btn primary', disabled: ui.picks.length !== want, onclick: () => act({ type: 'select', uids: ui.picks }) }, 'Confirm'),
        sel.then === 'shop' ? h('button', { type: 'button', class: 'btn', onclick: () => act({ type: 'cancel' }) }, 'Cancel') : null)),
    h('div', { class: 'cards' }, sortCards(options).map(card => cardView(card, {
      selected: ui.picks.includes(card.uid),
      onClick: () => {
        if (ui.picks.includes(card.uid)) ui.picks = ui.picks.filter(u => u !== card.uid);
        else ui.picks = want === 1 ? [card.uid] : [...ui.picks, card.uid].slice(-want);
        render();
      },
    }))));
}

function bossScreen() {
  return artPanel('👑', 'Boss relic', 'Choose one. Each is powerful, and each has a cost.',
    h('div', { class: 'shoprow' }, s.bossRelics.map(id => h('button', { type: 'button', class: 'ware', onclick: () => act({ type: 'choose', id }) },
      h('b', {}, `🏅 ${E.RELICS[id].name}`), h('small', {}, E.RELICS[id].text)))));
}

// ---------- the end ----------
function endScreen() {
  const won = s.screen === 'victory';
  const sc = E.score(s);
  const rows = [
    ['Floors climbed', sc.parts.floors], ['Elites abated', sc.parts.elites], ['Bosses defeated', sc.parts.bosses],
    won ? ['Victory, plus Credibility left', sc.parts.victory] : null, sc.parts.netZero ? ['Net zero bonus', sc.parts.netZero] : null,
    ['Heat penalty', sc.parts.heat],
  ].filter(Boolean);
  const nameInput = h('input', { id: 'sc-name', maxlength: 16, value: ui.postName ?? savedName(), placeholder: 'Your name', 'aria-label': 'Your name' });
  const posting = ui.posted;
  return h('main', { class: 'screen' }, h('section', { class: 'panel with-art' },
    h('div', { class: 'medallion', 'aria-hidden': 'true' }, won ? (s.carbon === 0 ? '🌍' : '🏆') : '📉'),
    h('h2', {}, won ? (s.carbon === 0 ? 'Net zero. A remarkable run.' : 'You made it through Scope 3') : 'Your credibility ran out'),
    h('p', {}, won ? `You reached the end with ${s.carbon} carbon and Heat ${E.heat(s)}.` : `On floor ${s.floor} of ${E.ACT_NAMES[s.act]}, with ${s.carbon} carbon and Heat ${E.heat(s)}.`),
    h('table', { class: 'score' }, rows.map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v > 0 ? `+${v}` : v))), h('tr', { class: 'total' }, h('td', {}, 'Score'), h('td', {}, sc.total))),
    save.runId
      ? posting?.done
        ? h('p', { style: 'color: var(--duck); font-weight: 700' }, posting.error ? posting.error : posting.improved ? `Posted: #${posting.rank} on the leaderboard.` : `Your best stands at ${posting.best}, #${posting.rank} on the leaderboard.`)
        : h('form', { class: 'board-row', onsubmit: e => { e.preventDefault(); postScore(nameInput.value); } }, nameInput, h('button', { type: 'submit', class: 'btn primary', disabled: posting?.busy }, posting?.busy ? 'Checking…' : 'Post score'))
      : h('p', {}, 'This run was played offline, so it can\'t go on the leaderboard.'),
    h('div', { style: 'display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap' },
      h('button', { type: 'button', class: 'btn primary', onclick: startRun }, 'New run'),
      h('button', { type: 'button', class: 'btn', onclick: () => { ui.view = 'title'; render(); } }, 'Title screen'))));
}

// The server replays the whole run from its seed to check the score before recording it.
async function postScore(name) {
  ui.postName = name;
  ui.posted = { busy: true };
  render();
  try {
    const res = await fetch('/api/scope-creep/finish', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: save.runId, name, actions: save.actions }) });
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

// ---------- overlays ----------
const sortCards = cards => [...cards].sort((a, b) => E.cardName(a).localeCompare(E.cardName(b)));
function overlay() {
  const close = () => { ui.overlay = null; render(); };
  let title = '', body = null;
  if (ui.overlay === 'deck') { title = `Your deck (${s.deck.length})`; body = h('div', { class: 'cards' }, sortCards(s.deck).map(c => cardView(c, {}))); }
  if (['draw', 'discard', 'exhaust'].includes(ui.overlay)) {
    const pile = s.combat[ui.overlay];
    title = { draw: 'Draw pile (in no particular order)', discard: 'Discard pile', exhaust: 'Retired this combat' }[ui.overlay];
    body = h('div', { class: 'cards' }, sortCards(pile).map(c => cardView(c, {})));
  }
  if (ui.overlay === 'menu') {
    title = 'Menu';
    body = h('div', { class: 'options', style: 'width: min(420px, 100%)' },
      h('button', { type: 'button', class: 'btn', onclick: () => { ui.overlay = null; ui.view = 'how'; render(); } }, 'How to play'),
      h('button', { type: 'button', class: 'btn', onclick: () => { ui.overlay = null; ui.view = 'title'; render(); } }, 'Title screen (your run is saved)'),
      h('button', { type: 'button', class: 'btn', onclick: () => { if (confirm('Abandon this run? It will end here.')) { clearSave(); s = null; save = null; ui.overlay = null; ui.view = 'title'; render(); } } }, 'Abandon run'));
  }
  if (ui.overlay?.tool !== undefined) {
    const id = s.potions[ui.overlay.tool];
    title = E.TOOLS[id].name;
    body = h('div', { class: 'panel' }, h('p', {}, rich(E.TOOLS[id].text), ' Tools can only be used in combat.'),
      h('button', { type: 'button', class: 'btn', onclick: () => act({ type: 'discardTool', slot: ui.overlay.tool }) || close() }, 'Throw it away'));
  }
  return h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, onclick: e => { if (e.target.classList.contains('overlay')) close(); } },
    h('button', { type: 'button', class: 'btn close', onclick: close }, 'Close'), h('h2', {}, title), body);
}

// ---------- tooltips and keys ----------
function showTip(el) {
  const text = el?.dataset.tip;
  if (!text) { tip.hidden = true; return; }
  tip.textContent = text;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth, hgt = tip.offsetHeight;
  tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${r.top - hgt - 8 > 8 ? r.top - hgt - 8 : r.bottom + 8}px`;
}
document.addEventListener('pointerover', e => showTip(e.target.closest?.('[data-tip]')));
document.addEventListener('focusin', e => showTip(e.target.closest?.('[data-tip]')));
document.addEventListener('scroll', () => { tip.hidden = true; }, true);

addEventListener('pointerdown', () => Sound.unlock(), true);
addEventListener('keydown', e => {
  Sound.unlock();
  if (e.target instanceof HTMLInputElement || Board.isOpen()) return;
  if (e.key === 'm' || e.key === 'M') { Sound.toggle(); if (s) render(); return; }
  if (e.key === 'Escape') {
    if (ui.overlay) { ui.overlay = null; render(); }
    else if (ui.selected !== null || ui.tool !== null) { ui.selected = null; ui.tool = null; ui.hint = ''; render(); }
    return;
  }
  if (!s || s.screen !== 'combat' || ui.overlay) return;
  if (e.key === 'e' || e.key === 'E') { act({ type: 'end' }); return; }
  const n = Number(e.key);
  if (!Number.isInteger(n) || n < 1) return;
  if (ui.selected !== null || ui.tool !== null) target(n - 1);
  else if (n <= s.combat.hand.length) pickCard(n - 1);
});

const Board = createLeaderboard({ game: 'scopecreep', modes: ['Score'], format: n => `${n}`, onClose: () => {} });
Board.button.addEventListener('click', () => Board.open(0));

render();
