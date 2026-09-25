// Scope Creep's rules engine. Pure and deterministic: a run is a seed plus a list of actions,
// so the browser can save and resume it and the server can replay it to check a score (see
// src/scopecreep.ts). Nothing here touches the DOM.
//
//   const s = newRun(seed);  apply(s, action);  legalActions(s);  score(s)
//
// The state is plain JSON. `s.screen` says what the player is doing, and the actions each
// screen accepts are listed in `apply` below.

import { CARDS, canUpgrade, cardCost, cardName, cardRetires, pool } from './cards.js';
import { ACT_NAMES, ENCOUNTERS, FOES } from './foes.js';
import { EVENTS, MANDATES, RELICS, TOOLS } from './extras.js';

// Bump whenever the rules change in a way that would make an existing run replay differently.
export const VERSION = 2;
export const START_HP = 72;
export const HAND_SIZE = 5;
export const MAX_HAND = 10;
export const BASE_ENERGY = 3;
export const HEAT_STEP = 15;         // carbon per point of Heat
export const ROWS = 12;              // map rows per act, before the boss
export const COLS = 7;
export const ACTS = 3;
export const MAX_DUCKLINGS = 12;

export class IllegalAction extends Error {}
const illegal = msg => { throw new IllegalAction(msg); };

// ---------- randomness ----------
// Separate streams, so that (for example) which cards a reward offers doesn't depend on how
// many times combat shuffled.
function next(s, stream) {
  let a = (s.rng[stream] + 0x6d2b79f5) | 0;
  s.rng[stream] = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (s, stream, n) => Math.floor(next(s, stream) * n);
const pick = (s, stream, arr) => arr[randInt(s, stream, arr.length)];
function shuffle(s, stream, arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = randInt(s, stream, i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function weighted(s, stream, pairs) {
  const total = pairs.reduce((n, [, w]) => n + w, 0);
  let r = next(s, stream) * total;
  for (const [v, w] of pairs) { if ((r -= w) < 0) return v; }
  return pairs[pairs.length - 1][0];
}

// A 32-bit seed from any string (such as a run id).
export function seedFrom(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// ---------- run ----------
export function heat(s) { return Math.floor(s.carbon / HEAT_STEP); }
const has = (s, relic) => s.relics.includes(relic);

function newCard(s, id, up = false) { return { uid: s.nextUid++, id, up }; }

export function newRun(seed) {
  seed >>>= 0;
  const s = {
    v: VERSION, seed,
    rng: { map: seed ^ 0x9e3779b9, cards: seed ^ 0x85ebca6b, combat: seed ^ 0xc2b2ae35, misc: seed ^ 0x27d4eb2f },
    screen: 'mandate', act: 1, floor: 0,
    hp: START_HP, maxHp: START_HP, gold: 99, carbon: 0, offsets: [],
    deck: [], relics: ['clipboard'], potions: [null, null, null],
    map: null, pos: null, path: [], combat: null, reward: null, shop: null, event: null, select: null, result: null,
    rest: null, bossRelics: null, mandate: null,
    stats: { floors: 0, fights: 0, elites: 0, bosses: 0, fightsThisAct: 0, cardsPlayed: 0, emitted: 0, removed: 0 },
    seen: { events: [], encounters: [] },
    nextUid: 1, removeCost: 75, lifeJacketUsed: false, lastEncounter: null,
  };
  for (const [id, n] of [['abate', 4], ['hedge', 4], ['survey', 1], ['diesel', 1]]) for (let i = 0; i < n; i++) s.deck.push(newCard(s, id));
  s.map = genMap(s);
  s.mandate = shuffle(s, 'misc', MANDATES.map((_, i) => i)).slice(0, 4);
  return s;
}

// ---------- map ----------
// Six paths climb from the bottom row to the top, moving at most one column per row and never
// crossing. Row 5 is always treasure and the last row always a rest pond; the boss is beyond.
export function genMap(s) {
  const rows = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const edge = (r, c) => rows[r][c] || (rows[r][c] = { t: null, n: [] });
  const starts = [];
  for (let p = 0; p < 6; p++) {
    let c = randInt(s, 'map', COLS);
    if (p === 1) while (c === starts[0]) c = randInt(s, 'map', COLS);
    starts.push(c);
    for (let r = 0; r < ROWS - 1; r++) {
      let d = randInt(s, 'map', 3) - 1;
      let nc = Math.max(0, Math.min(COLS - 1, c + d));
      // Don't cross an existing path diagonally.
      if (nc !== c && rows[r][nc] && rows[r][nc].n.includes(c)) nc = c;
      const node = edge(r, c);
      if (!node.n.includes(nc)) node.n.push(nc);
      edge(r + 1, nc);
      c = nc;
    }
  }
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const node = rows[r][c];
    if (!node) continue;
    node.n.sort((a, b) => a - b);
    if (r === 0) node.t = 'fight';
    else if (r === 5) node.t = 'treasure';
    else if (r === ROWS - 1) node.t = 'rest';
    else {
      const parents = r > 0 ? rows[r - 1].filter(p => p && p.n.includes(c)).map(p => p.t) : [];
      for (let tries = 0; tries < 20; tries++) {
        const t = weighted(s, 'map', [['fight', 45], ['event', 22], ['elite', r >= 4 ? 10 : 0], ['rest', r >= 4 && r !== ROWS - 2 ? 12 : 0], ['shop', r >= 2 ? 7 : 0]]);
        // Don't put two of the same special node back to back.
        if (t !== 'fight' && t !== 'event' && parents.includes(t)) continue;
        node.t = t;
        break;
      }
      node.t ||= 'fight';
    }
  }
  return rows;
}

// Columns you can move to next: any node on the bottom row to start, then along edges.
export function reachable(s) {
  if (s.pos === null) return s.map[0].map((n, c) => (n ? c : -1)).filter(c => c >= 0);
  if (s.pos.row === ROWS - 1) return ['boss'];
  return s.map[s.pos.row][s.pos.col].n;
}

function enterNode(s, col) {
  const row = s.pos === null ? 0 : s.pos.row + 1;
  s.floor++;
  s.stats.floors = (s.act - 1) * (ROWS + 1) + row;
  if (col === 'boss') { s.pos = { row: ROWS, col: 'boss' }; return startCombat(s, 'boss'); }
  s.pos = { row, col };
  s.path.push(col);
  const t = s.map[row][col].t;
  if (t === 'fight' || t === 'elite') return startCombat(s, t);
  if (t === 'event') return startEvent(s);
  if (t === 'shop') return openShop(s);
  if (t === 'rest') { s.screen = 'rest'; s.rest = {}; return; }
  if (t === 'treasure') {
    const name = runApi(s).relic('random');
    return showResult(s, 'Treasure', `Inside the chest you find ${name}.`);
  }
}

function showResult(s, title, text, then = 'map') {
  s.result = { title, text, then };
  s.screen = 'result';
}

// ---------- run-level helpers, used by events, mandates and relics ----------
function runApi(s) {
  const r = {
    s,
    gold: n => { s.gold = Math.max(0, s.gold + n); },
    heal: n => { s.hp = Math.min(s.maxHp, s.hp + n); },
    hurt: n => { s.hp = Math.max(1, s.hp - n); },
    maxHp: n => { s.maxHp += n; s.hp = Math.max(1, Math.min(s.maxHp, s.hp + Math.max(0, n))); },
    carbon: n => addCarbon(s, n),
    removeCarbon: n => removeCarbon(s, n),
    offset: n => offset(s, n, false),
    addCard: (id, up = false) => { s.deck.push(newCard(s, id, up)); return cardName({ id, up }); },
    randomCard: rarity => r.addCard(pick(s, 'cards', pool(rarity))),
    upgradeRandom: n => {
      const names = [];
      for (const card of shuffle(s, 'misc', s.deck.filter(canUpgrade)).slice(0, n)) { card.up = true; names.push(cardName(card)); }
      return names;
    },
    transformRandom: n => {
      const names = [];
      const candidates = s.deck.filter(c => CARDS[c.id].rarity !== 'special');
      for (const card of shuffle(s, 'misc', candidates).slice(0, n)) {
        const rarity = CARDS[card.id].rarity === 'starter' ? 'common' : CARDS[card.id].rarity;
        const before = cardName(card);
        card.id = pick(s, 'cards', pool(rarity).filter(id => id !== card.id));
        card.up = false;
        names.push(`${before} (now ${cardName(card)})`);
      }
      return names;
    },
    loseRandomCard: () => {
      if (!s.deck.length) return null;
      const i = randInt(s, 'misc', s.deck.length);
      return cardName(s.deck.splice(i, 1)[0]);
    },
    relic: which => {
      const id = RELICS[which] ? which : randomRelic(s, which === 'random' ? null : which);
      if (!id) { s.gold += 50; return '50 grants'; }
      gainRelic(s, id);
      return RELICS[id].name;
    },
    select: (purpose, count, text) => { s.select = { purpose, count, text, then: 'result' }; s.screen = 'select'; return null; },
    offerCards: rarity => {
      s.reward = { gold: 0, tool: null, relic: null, cards: cardChoices(s, 3, [[rarity, 1]]), cardsTaken: false, after: 'map' };
      s.screen = 'reward';
      return null;
    },
  };
  return r;
}

function randomRelic(s, rarity) {
  rarity ||= weighted(s, 'misc', [['common', 50], ['uncommon', 33], ['rare', 17]]);
  const options = Object.keys(RELICS).filter(id => RELICS[id].rarity === rarity && !s.relics.includes(id));
  return options.length ? pick(s, 'misc', options) : null;
}

function gainRelic(s, id) {
  if (s.relics.includes(id)) return;
  s.relics.push(id);
  RELICS[id].pickup?.(runApi(s));
}

function addCarbon(s, n) {
  if (n <= 0) return;
  s.carbon += n;
  s.stats.emitted += n;
}
function removeCarbon(s, n) {
  const cut = Math.min(n, s.carbon);
  s.carbon -= cut;
  s.stats.removed += cut;
}
// An offset lowers carbon now; unless it's verified, the audit at the next boss decides whether
// it sticks. `junk` offsets (sold by the Offset Broker) always fail.
function offset(s, n, junk) {
  const cut = Math.min(n, s.carbon);
  if (cut <= 0 && !junk) return;
  s.carbon -= cut;
  const verified = has(s, 'voluntaryStandard') || (s.combat && s.combat.powers.verified);
  s.offsets.push({ amount: junk ? n : cut, quality: junk ? 'junk' : verified ? 'high' : 'low' });
}

// Checks every offset: low-quality ones fail half the time, and a failed offset comes back doubled.
function audit(s) {
  let failed = 0, added = 0;
  for (const o of s.offsets) {
    if (o.quality === 'high') continue;
    if (o.quality === 'junk' || next(s, 'misc') < 0.5) { failed++; added += o.amount * 2; }
  }
  const total = s.offsets.length;
  s.offsets = [];
  if (added) addCarbon(s, added);
  return { total, failed, added };
}

// ---------- combat ----------
function makeEnemy(s, id) {
  const def = FOES[id];
  const hp = def.hp[0] + randInt(s, 'combat', def.hp[1] - def.hp[0] + 1);
  return {
    uid: s.nextUid++, id, name: def.name, hp, maxHp: hp, block: 0, st: { ...(def.start || {}) },
    move: null, turn: 0, history: [], flags: {}, damageThisTurn: 0, gone: false,
  };
}

function pickEncounter(s, kind) {
  const acts = ENCOUNTERS[s.act];
  const list = kind === 'fight' ? (s.stats.fightsThisAct < 2 ? acts.easy : acts.normal) : acts[kind === 'elite' ? 'elite' : 'boss'];
  let options = list.filter(e => e.join() !== s.lastEncounter);
  if (!options.length) options = list;
  const chosen = pick(s, 'combat', options);
  s.lastEncounter = chosen.join();
  return chosen;
}

// For tests: start a combat against particular enemies.
export function testCombat(s, ids, kind = 'fight') {
  s.forceEncounter = ids;
  startCombat(s, kind);
  delete s.forceEncounter;
  return s.combat;
}

function startCombat(s, kind) {
  const c = {
    kind, enemies: [], draw: [], hand: [], discard: [], exhaust: [], energy: 0, turn: 0,
    p: { block: 0, st: {} }, pending: {}, ducklings: 0, powers: {}, turnFlags: {}, creep: {},
    playedThisTurn: 0, handAtEnd: 0, log: [], audit: null, over: false,
  };
  s.combat = c;
  s.screen = 'combat';
  if (kind === 'boss') {
    c.audit = audit(s);
    if (c.audit.total) c.log.push(`Audit: ${c.audit.failed} of ${c.audit.total} offsets failed${c.audit.added ? `, adding ${c.audit.added} carbon` : ''}.`);
  }
  for (const id of s.forceEncounter || pickEncounter(s, kind)) c.enemies.push(makeEnemy(s, id));
  const h = heat(s);
  const drive = (has(s, 'coolingTower') ? Math.floor(h / 2) : h) + (has(s, 'offsetPortfolio') ? 1 : 0);
  for (const e of c.enemies) if (drive) e.st.drive = (e.st.drive || 0) + drive;
  if (h >= 4 && kind !== 'fight') for (const e of c.enemies) { e.maxHp = Math.round(e.maxHp * 1.1); e.hp = e.maxHp; }

  const cards = s.deck.map(card => ({ ...card }));
  shuffle(s, 'combat', cards);
  const innate = cards.filter(card => card.up && CARDS[card.id].upInnate);
  c.draw = [...cards.filter(card => !innate.includes(card)), ...innate];  // the end of the pile is drawn first
  const g = api(s);
  for (const id of s.relics) RELICS[id].combatStart?.(g);
  for (const e of c.enemies) chooseMove(s, e);
  startTurn(s);
}

const alive = c => c.enemies.filter(e => e.hp > 0 && !e.gone);

function chooseMove(s, e) {
  e.move = FOES[e.id].next(e, api(s));
}

// The combat helpers cards, relics, tools and enemies use.
function api(s) {
  const c = s.combat;
  const g = {
    s, c, p: c.p,
    rand: () => next(s, 'combat'),
    alive: () => alive(c),
    enemies: () => alive(c),
    randomEnemy: () => { const a = alive(c); return a.length ? a[randInt(s, 'combat', a.length)] : null; },
    heat: () => heat(s),
    ducklings: () => c.ducklings,
    log: text => c.log.push(text),
    hit: (t, base, times = 1) => { for (let i = 0; i < times; i++) if (t && t.hp > 0 && !t.gone) hitEnemy(s, t, playerDamage(s, t, base)); },
    hitAll: (base, times = 1, attack = true) => {
      for (let i = 0; i < times; i++) for (const e of alive(c)) hitEnemy(s, e, attack ? playerDamage(s, e, base) : base);
    },
    block: n => { c.p.block += Math.max(0, n + (c.p.st.rigour || 0)); },
    draw: n => drawCards(s, n),
    energy: n => { c.energy += n; },
    apply: (target, key, n, boosted = true) => {
      if (n <= 0) return;
      const targets = target === 'all' ? alive(c) : target === 'self' ? [c.p] : [target];
      for (const t of targets) {
        if (!t) continue;
        let amount = n;
        if (key === 'measured' && t !== c.p) {
          if (boosted && has(s, 'pocketCalculator')) amount++;
          if (c.powers.auditTrail) c.p.block += amount;
        }
        t.st[key] = (t.st[key] || 0) + amount;
        if (key === 'measured' && t !== c.p) FOES[t.id].onMeasured?.(t, g);
      }
    },
    carbon: n => { addCarbon(s, n); if (has(s, 'carbonLedger')) c.p.block += n; },
    offset: n => offset(s, n, false),
    removeCarbon: n => removeCarbon(s, n),
    hatch: (n, fromCard = true) => {
      if (n <= 0) return;
      c.ducklings = Math.min(MAX_DUCKLINGS, c.ducklings + n + (fromCard && has(s, 'eggCarton') ? 1 : 0));
    },
    peck: times => peck(s, times),
    heal: n => { s.hp = Math.min(s.maxHp, s.hp + n); },
    loseHp: n => loseHp(s, n),
    addCard: (id, pile) => addToPile(s, newCard(s, id), pile),
    power: (key, n) => { c.powers[key] = (c.powers[key] || 0) + n; },
    retireHand: filter => {
      const going = c.hand.filter(card => filter({ ...card, def: CARDS[card.id] }));
      c.hand = c.hand.filter(card => !going.includes(card));
      for (const card of going) retire(s, card);
      return going.length;
    },
  };
  return g;
}

function addToPile(s, card, pile) {
  const c = s.combat;
  if (pile === 'draw') c.draw.splice(randInt(s, 'combat', c.draw.length + 1), 0, card);
  else if (pile === 'hand' && c.hand.length < MAX_HAND) c.hand.push(card);
  else c.discard.push(card);
}

function retire(s, card) {
  s.combat.exhaust.push(card);
  if (s.combat.powers.netZeroPledge) removeCarbon(s, 1);
}

// How much a player's attack does to an enemy, before its Assurance.
export function playerDamage(s, e, base) {
  const c = s.combat;
  let dmg = base + (c.p.st.drive || 0) + (e.st.measured || 0);
  if (c.p.st.diluted) dmg *= 0.75;
  if (e.st.exposed) dmg *= 1.5;
  if (c.powers.sbti && e.st.measured) dmg *= 1.5;
  if (FOES[e.id].halfUnlessMeasured && !e.st.measured) dmg *= 0.5;
  return Math.max(0, Math.floor(dmg));
}

// How much an enemy's attack does to the player, before Assurance.
export function enemyDamage(s, e, base) {
  const c = s.combat;
  let dmg = base + (e.st.drive || 0);
  if (e.st.diluted) dmg *= 0.75;
  if (c.p.st.exposed) dmg *= 1.5;
  return Math.max(0, Math.floor(dmg));
}

function hitEnemy(s, e, dmg) {
  const c = s.combat;
  const blocked = Math.min(e.block, dmg);
  e.block -= blocked;
  const lost = Math.min(e.hp, dmg - blocked);
  e.hp -= lost;
  // Everything it was hit for this turn, blocked or not (the Boiler Room vents at 25).
  e.damageThisTurn += dmg;
  // Hitting something with Regulation hurts.
  if (e.st.regulation && e.hp > 0) hurtPlayer(s, e.st.regulation, null);
  if (e.hp <= 0) onEnemyDeath(s, e);
}

function onEnemyDeath(s, e) {
  const c = s.combat;
  c.log.push(`${e.name} is abated.`);
  for (const other of alive(c)) FOES[other.id].onAllyDeath?.(other, api(s), e);
}

function peck(s, times) {
  const c = s.combat;
  const each = has(s, 'megaflock') ? 3 : 2;
  for (let t = 0; t < times; t++) for (let i = 0; i < c.ducklings; i++) {
    const a = alive(c);
    if (!a.length) return;
    const e = a[randInt(s, 'combat', a.length)];
    hitEnemy(s, e, each + (e.st.measured || 0));
  }
}

// Damage to the player from an enemy (or a thorn); `attacker` takes Regulation damage back.
function hurtPlayer(s, dmg, attacker) {
  const c = s.combat;
  const blocked = Math.min(c.p.block, dmg);
  c.p.block -= blocked;
  if (dmg - blocked > 0) loseHp(s, dmg - blocked);
  if (attacker && c.p.st.regulation && attacker.hp > 0) hitEnemy(s, attacker, c.p.st.regulation);
}

function loseHp(s, n) {
  s.hp -= n;
  if (s.hp <= 0) {
    if (has(s, 'lifeJacket') && !s.lifeJacketUsed) { s.lifeJacketUsed = true; s.hp = Math.ceil(s.maxHp * 0.3); s.combat?.log.push('Your Life Jacket keeps you afloat.'); }
    else { s.hp = 0; s.screen = 'gameover'; if (s.combat) s.combat.over = true; }
  }
}

function drawCards(s, n) {
  const c = s.combat;
  for (let i = 0; i < n; i++) {
    if (!c.draw.length) {
      if (!c.discard.length) return;
      c.draw = shuffle(s, 'combat', c.discard);
      c.discard = [];
    }
    const card = c.draw.pop();
    if (c.hand.length >= MAX_HAND) { c.discard.push(card); continue; }
    c.hand.push(card);
    CARDS[card.id].onDraw?.(api(s));
  }
}

function relicEnergy(s) { return s.relics.reduce((n, id) => n + (RELICS[id].energy || 0), 0); }

function startTurn(s) {
  const c = s.combat;
  c.turn++;
  c.p.block = 0;
  c.turnFlags = {};
  c.playedThisTurn = 0;
  for (const e of c.enemies) e.damageThisTurn = 0;
  const st = c.p.st;
  c.energy = Math.max(0, (c.turn === 1 ? c.energy : 0) + BASE_ENERGY + relicEnergy(s) + (st.nextEnergy || 0) - (st.drained || 0));
  let draw = HAND_SIZE + (st.nextDraw || 0) - (st.jammed || 0);
  if (c.turn === 1) draw += s.relics.reduce((n, id) => n + (RELICS[id].firstTurnDraw || 0), 0);
  st.nextEnergy = 0; st.drained = 0; st.nextDraw = 0; st.jammed = 0;
  if (st.nextBlock) { c.p.block += st.nextBlock; st.nextBlock = 0; }
  if (st.liability) { loseHp(s, st.liability); st.liability--; if (s.screen === 'gameover') return; }
  const g = api(s);
  if (c.powers.flightFormation) c.p.block += c.ducklings * c.powers.flightFormation;
  if (c.powers.litigationHold) g.apply('all', 'liability', c.powers.litigationHold);
  for (const id of s.relics) RELICS[id].turnStart?.(g);
  drawCards(s, Math.max(0, draw));
  checkWin(s);
}

function endTurn(s) {
  const c = s.combat;
  const g = api(s);
  for (const card of c.hand) CARDS[card.id].endOfTurnInHand?.(g);
  if (s.screen === 'gameover') return;
  if (c.ducklings) peck(s, c.powers.flockTogether ? 2 : 1);
  if (c.powers.imprinting) g.hatch(c.powers.imprinting, false);
  for (const id of s.relics) RELICS[id].turnEnd?.(g);
  c.handAtEnd = c.hand.length;
  const kept = c.hand.filter(card => CARDS[card.id].retain);
  c.discard.push(...c.hand.filter(card => !kept.includes(card)));
  c.hand = kept;
  if (checkWin(s)) return;

  // The enemies' turn.
  for (const e of [...c.enemies]) {
    if (e.hp <= 0 || e.gone) continue;
    e.block = 0;
    if (e.st.liability) {
      const lost = Math.min(e.hp, e.st.liability);
      e.hp -= lost; e.st.liability--;
      if (e.hp <= 0) { onEnemyDeath(s, e); continue; }
    }
    FOES[e.id].onTurnStart?.(e, api(s));
    enemyAct(s, e);
    if (s.screen === 'gameover') return;
  }
  // Exposed and Diluted wear off at the end of each round; ones enemies applied this round last
  // until the next.
  for (const t of [c.p, ...c.enemies]) for (const k of ['exposed', 'diluted']) if (t.st[k]) t.st[k]--;
  for (const [k, v] of Object.entries(c.pending)) c.p.st[k] = (c.p.st[k] || 0) + v;
  c.pending = {};
  c.p.st.capAndTrade = 0;
  if (checkWin(s)) return;
  for (const e of alive(c)) chooseMove(s, e);
  startTurn(s);
}

// Resolves which move an enemy will really make (some change their mind at the last moment).
function resolveMove(s, e) {
  const move = FOES[e.id].moves[e.move];
  return move.unless?.(e, s.combat) || e.move;
}

function timesFor(s, times) {
  const c = s.combat;
  if (times === 'hand') return c.screen === 'enemy' ? c.handAtEnd : c.hand.length;
  if (times === 'played') return c.playedThisTurn;
  return times || 1;
}

function enemyAct(s, e) {
  const c = s.combat;
  const def = FOES[e.id];
  const id = resolveMove(s, e);
  const move = def.moves[id];
  c.screen = 'enemy';
  for (const step of move.steps) {
    if (e.hp <= 0 || e.gone || s.screen === 'gameover') break;
    if (step.attack !== undefined) {
      const n = timesFor(s, step.times);
      const base = step.attack + (def.attackBonus ? def.attackBonus(e) : 0);
      for (let i = 0; i < n && e.hp > 0 && s.screen !== 'gameover'; i++) hurtPlayer(s, enemyDamage(s, e, base), e);
    }
    if (step.block) e.block += step.block;
    if (step.emit) emit(s, e, step.emit);
    if (step.buff) for (const [k, v] of Object.entries(step.buff)) e.st[k] = (e.st[k] || 0) + v;
    if (step.debuff) for (const [k, v] of Object.entries(step.debuff)) {
      if (k === 'liability') c.p.st.liability = (c.p.st.liability || 0) + v;
      else c.pending[k] = (c.pending[k] || 0) + v;
    }
    if (step.drain) c.p.st.drained = (c.p.st.drained || 0) + step.drain;
    if (step.jam) c.p.st.jammed = (c.p.st.jammed || 0) + step.jam;
    if (step.scare) c.ducklings = Math.max(0, c.ducklings - step.scare);
    if (step.addCard) for (let i = 0; i < (step.count || 1); i++) addToPile(s, newCard(s, step.addCard), step.pile);
    if (step.heal) e.hp = Math.min(e.maxHp, e.hp + step.heal);
    if (step.spawn && c.enemies.filter(x => x.hp > 0 && !x.gone).length < 5) {
      const minion = makeEnemy(s, step.spawn);
      c.enemies.splice(c.enemies.indexOf(e), 0, minion);
      chooseMove(s, minion);
    }
    if (step.junkOffset) { offset(s, step.junkOffset, true); c.log.push(`${e.name} sells you ${step.junkOffset} tonnes of offsets. They look suspiciously cheap.`); }
    if (step.escape) { e.gone = true; c.log.push(`${e.name} takes off, and its emissions go with it.`); }
  }
  c.screen = null;
  e.history.push(id);
  e.turn++;
}

function emit(s, e, n) {
  const c = s.combat;
  if (c.p.st.capAndTrade) { c.p.block += n; return; }
  addCarbon(s, n);
  if (has(s, 'carbonLedger')) c.p.block += n;
  if (has(s, 'methaneDetector')) e.st.measured = (e.st.measured || 0) + 1;
}

// What an enemy is about to do, as the player sees it: [{ kind, n, times }].
export function intents(s, e) {
  if (has(s, 'bigFour')) return [{ kind: 'unknown' }];
  const def = FOES[e.id];
  // Shows what it would do if its turn came now, so a move that can be averted (the Boiler
  // Room's Overpressure) changes as soon as you've done enough.
  const move = def.moves[resolveMove(s, e)];
  const out = [];
  for (const step of move.steps) {
    if (step.attack !== undefined) {
      out.push({ kind: 'attack', n: enemyDamage(s, e, step.attack + (def.attackBonus ? def.attackBonus(e) : 0)), times: timesFor(s, step.times) });
    }
    if (step.emit) out.push({ kind: 'emit', n: step.emit });
    if (step.block) out.push({ kind: 'block', n: step.block });
    if (step.buff) out.push({ kind: 'buff' });
    if (step.debuff || step.drain || step.jam || step.scare || step.addCard || step.junkOffset) out.push({ kind: 'debuff' });
    if (step.spawn) out.push({ kind: 'summon' });
    if (step.escape) out.push({ kind: 'escape' });
  }
  return out;
}
export const moveName = (s, e) => FOES[e.id].moves[resolveMove(s, e)]?.name ?? '';

function checkWin(s) {
  const c = s.combat;
  if (!c || c.over || s.screen === 'gameover') return c?.over;
  if (alive(c).length) return false;
  c.over = true;
  winCombat(s);
  return true;
}

function cardChoices(s, n, rarities) {
  const out = [];
  for (let tries = 0; out.length < n && tries < 50; tries++) {
    const rarity = weighted(s, 'cards', rarities);
    const id = pick(s, 'cards', pool(rarity));
    if (out.some(c => c.id === id)) continue;
    out.push({ id, up: s.act >= 2 && next(s, 'cards') < (s.act === 2 ? 0.1 : 0.2) });
  }
  return out;
}

function winCombat(s) {
  const c = s.combat;
  const r = runApi(s);
  if (c.powers.netZeroPledge) removeCarbon(s, 2);
  for (const id of s.relics) RELICS[id].combatEnd?.(r);
  s.stats.fights++;
  if (c.kind === 'fight') s.stats.fightsThisAct++;
  if (c.kind === 'elite') s.stats.elites++;
  if (c.kind === 'boss') s.stats.bosses++;
  const goldRange = { fight: [10, 20], elite: [25, 35], boss: [75, 90] }[c.kind];
  const count = has(s, 'greenhushing') ? 2 : 3;
  const rarities = c.kind === 'boss' ? [['rare', 1]] : c.kind === 'elite' ? [['common', 45], ['uncommon', 42], ['rare', 13]] : [['common', 60], ['uncommon', 35], ['rare', 5]];
  s.reward = {
    gold: goldRange[0] + randInt(s, 'misc', goldRange[1] - goldRange[0] + 1),
    tool: c.kind !== 'fight' || next(s, 'misc') < 0.4 ? pick(s, 'misc', Object.keys(TOOLS)) : null,
    relic: c.kind === 'elite' ? randomRelic(s) : null,
    cards: cardChoices(s, count, rarities),
    cardsTaken: false,
    after: c.kind === 'boss' ? 'boss' : 'map',
  };
  s.lastCombat = { kind: c.kind, turns: c.turn, log: c.log.slice(-6) };
  s.combat = null;
  s.screen = 'reward';
}

// ---------- events, shops and rest ----------
function startEvent(s) {
  const options = Object.keys(EVENTS).filter(id => !s.seen.events.includes(id) && (EVENTS[id].minAct || 1) <= s.act);
  const id = options.length ? pick(s, 'misc', options) : pick(s, 'misc', Object.keys(EVENTS));
  s.seen.events.push(id);
  s.event = { id };
  s.screen = 'event';
}
export function eventOptions(s) { return EVENTS[s.event.id].options(runApi(s)); }

const PRICES = { common: [45, 55], uncommon: [68, 82], rare: [135, 165] };
function openShop(s) {
  const cards = cardChoices(s, 5, [['common', 55], ['uncommon', 35], ['rare', 10]]).map(card => {
    const [lo, hi] = PRICES[CARDS[card.id].rarity];
    return { ...card, price: lo + randInt(s, 'misc', hi - lo + 1), sold: false };
  });
  cards[randInt(s, 'misc', cards.length)].price = Math.floor(cards[0].price / 2) || 20;
  const relics = [];
  for (let i = 0; i < 2; i++) {
    const id = randomRelic(s);
    if (id && !relics.some(r => r.id === id)) relics.push({ id, price: { common: 150, uncommon: 220, rare: 280 }[RELICS[id].rarity] + randInt(s, 'misc', 21) - 10, sold: false });
  }
  const tools = shuffle(s, 'misc', Object.keys(TOOLS)).slice(0, 2).map(id => ({ id, price: 50 + randInt(s, 'misc', 21), sold: false }));
  s.shop = { cards, relics, tools, removal: true, capture: { amount: 6, price: 60, sold: false } };
  s.screen = 'shop';
}
export function removalPrice(s) { return has(s, 'recycledPaper') ? Math.floor(s.removeCost / 2) : s.removeCost; }

export function restOptions(s) {
  const heal = Math.floor(s.maxHp * 0.3) + (has(s, 'breadBag') ? 10 : 0);
  return [
    { id: 'heal', label: 'Rest', detail: `Recover ${heal} Credibility.`, heal },
    { id: 'upgrade', label: 'Train', detail: 'Upgrade a card.', enabled: s.deck.some(canUpgrade) },
    { id: 'wetland', label: 'Restore a wetland', detail: 'Remove 8 carbon.' },
  ];
}

export function selectable(s) {
  const p = s.select?.purpose;
  if (p === 'upgrade') return s.deck.filter(canUpgrade);
  if (p === 'duplicate') return s.deck.filter(c => CARDS[c.id].type !== 'curse');
  return s.deck;
}

function finishSelect(s) {
  const { then, text } = s.select;
  s.select = null;
  if (then === 'shop') s.screen = 'shop';
  else if (then === 'map') s.screen = 'map';
  else showResult(s, '', text);
}

function nextAct(s) {
  s.act++;
  s.pos = null;
  s.path = [];
  s.hp = s.maxHp;
  s.stats.fightsThisAct = 0;
  s.map = genMap(s);
  s.screen = 'map';
}

// ---------- actions ----------
// Applies one action to the state (changing it) and returns it. Throws IllegalAction if the
// action isn't allowed right now, leaving the state as it was.
export function apply(s, a) {
  if (s.screen === 'gameover' || s.screen === 'victory') illegal('the run is over');
  switch (s.screen) {
    case 'mandate': {
      if (a.type !== 'choose' || !s.mandate.includes(a.index)) illegal('choose a mandate');
      s.mandate = null;
      const text = MANDATES[a.index].do(runApi(s));
      if (text !== null) showResult(s, 'Your mandate', text);
      return s;
    }
    case 'map': {
      if (a.type !== 'path' || !reachable(s).includes(a.col)) illegal('you can\'t go there');
      enterNode(s, a.col);
      return s;
    }
    case 'result': {
      if (a.type !== 'continue') illegal('continue');
      const then = s.result.then;
      s.result = null;
      s.screen = then;
      return s;
    }
    case 'event': {
      const options = eventOptions(s);
      const o = options[a.index];
      if (a.type !== 'choose' || !o || o.enabled === false) illegal('choose an option');
      const title = EVENTS[s.event.id].title;
      s.event = null;
      const text = o.do(runApi(s));
      if (text !== null) showResult(s, title, text);
      return s;
    }
    case 'rest': {
      const o = restOptions(s).find(r => r.id === a.choice);
      if (a.type !== 'rest' || !o || o.enabled === false) illegal('choose how to rest');
      s.rest = null;
      if (o.id === 'heal') { s.hp = Math.min(s.maxHp, s.hp + o.heal); s.screen = 'map'; }
      if (o.id === 'wetland') { removeCarbon(s, 8); s.screen = 'map'; }
      if (o.id === 'upgrade') { s.select = { purpose: 'upgrade', count: 1, text: '', then: 'map' }; s.screen = 'select'; }
      return s;
    }
    case 'select': {
      if (a.type === 'cancel' && s.select.then === 'shop') { s.select = null; s.screen = 'shop'; return s; }
      const options = selectable(s);
      const want = Math.min(s.select.count, options.length);
      if (a.type !== 'select' || !Array.isArray(a.uids) || a.uids.length !== want || new Set(a.uids).size !== want) illegal(`select ${want} card${want === 1 ? '' : 's'}`);
      const chosen = a.uids.map(uid => options.find(c => c.uid === uid));
      if (chosen.some(c => !c)) illegal('that card can\'t be chosen');
      const p = s.select.purpose;
      for (const card of chosen) {
        if (p === 'upgrade') card.up = true;
        if (p === 'remove') s.deck.splice(s.deck.indexOf(card), 1);
        if (p === 'duplicate') s.deck.push(newCard(s, card.id, card.up));
      }
      if (p === 'remove' && s.select.then === 'shop') { s.gold -= removalPrice(s); s.removeCost += 25; s.shop.removal = false; }
      finishSelect(s);
      return s;
    }
    case 'reward': return rewardAction(s, a);
    case 'boss': {
      if (a.type !== 'choose' || !s.bossRelics.includes(a.id)) illegal('choose a boss relic');
      gainRelic(s, a.id);
      s.bossRelics = null;
      if (s.act >= ACTS) s.screen = 'victory'; else nextAct(s);
      return s;
    }
    case 'shop': return shopAction(s, a);
    case 'combat': return combatAction(s, a);
  }
  illegal(`nothing to do on ${s.screen}`);
}

function rewardAction(s, a) {
  const r = s.reward;
  if (a.type === 'take' && a.what === 'gold' && r.gold) { s.gold += r.gold; r.gold = 0; return s; }
  if (a.type === 'take' && a.what === 'tool' && r.tool) {
    const slot = s.potions.indexOf(null);
    if (slot < 0) illegal('your tools are full');
    s.potions[slot] = r.tool; r.tool = null; return s;
  }
  if (a.type === 'take' && a.what === 'relic' && r.relic) { gainRelic(s, r.relic); r.relic = null; return s; }
  if (a.type === 'take' && a.what === 'card' && !r.cardsTaken && r.cards[a.index]) {
    const card = r.cards[a.index];
    s.deck.push(newCard(s, card.id, card.up));
    r.cardsTaken = true;
    return s;
  }
  if (a.type === 'discardTool' && s.potions[a.slot]) { s.potions[a.slot] = null; return s; }
  if (a.type === 'continue') {
    // Grants are collected on the way out; anything else left behind is forfeited.
    s.gold += r.gold;
    s.reward = null;
    if (r.after === 'boss' && s.act >= ACTS) { s.screen = 'victory'; return s; }
    if (r.after === 'boss') {
      const options = Object.keys(RELICS).filter(id => RELICS[id].rarity === 'boss' && !s.relics.includes(id));
      s.bossRelics = shuffle(s, 'misc', options).slice(0, 3);
      s.screen = s.bossRelics.length ? 'boss' : s.act >= ACTS ? 'victory' : (nextAct(s), 'map');
    } else s.screen = 'map';
    return s;
  }
  illegal('not a reward action');
}

function shopAction(s, a) {
  const shop = s.shop;
  const buy = (item, price) => {
    if (!item || item.sold) illegal('not for sale');
    if (s.gold < price) illegal('not enough grants');
    s.gold -= price;
    item.sold = true;
  };
  if (a.type === 'buy' && a.kind === 'card') { const item = shop.cards[a.index]; buy(item, item?.price); s.deck.push(newCard(s, item.id, item.up)); return s; }
  if (a.type === 'buy' && a.kind === 'relic') { const item = shop.relics[a.index]; buy(item, item?.price); gainRelic(s, item.id); return s; }
  if (a.type === 'buy' && a.kind === 'tool') {
    const item = shop.tools[a.index];
    const slot = s.potions.indexOf(null);
    if (slot < 0) illegal('your tools are full');
    buy(item, item?.price);
    s.potions[slot] = item.id;
    return s;
  }
  if (a.type === 'buy' && a.kind === 'capture') { buy(shop.capture, shop.capture.price); removeCarbon(s, shop.capture.amount); return s; }
  if (a.type === 'buy' && a.kind === 'removal') {
    if (!shop.removal) illegal('you\'ve already removed a card here');
    if (s.gold < removalPrice(s)) illegal('not enough grants');
    s.select = { purpose: 'remove', count: 1, text: '', then: 'shop' };
    s.screen = 'select';
    return s;
  }
  if (a.type === 'discardTool' && s.potions[a.slot]) { s.potions[a.slot] = null; return s; }
  if (a.type === 'leave') { s.shop = null; s.screen = 'map'; return s; }
  illegal('not a shop action');
}

function combatAction(s, a) {
  const c = s.combat;
  if (a.type === 'end') { endTurn(s); return s; }
  if (a.type === 'tool') {
    const id = s.potions[a.slot];
    if (!id) illegal('no tool in that slot');
    const tool = TOOLS[id];
    const target = tool.target === 'enemy' ? alive(c)[a.target] : null;
    if (tool.target === 'enemy' && !target) illegal('choose a target');
    s.potions[a.slot] = null;
    tool.use(api(s), target);
    checkWin(s);
    return s;
  }
  if (a.type === 'discardTool' && s.potions[a.slot]) { s.potions[a.slot] = null; return s; }
  if (a.type !== 'play') illegal('not a combat action');
  const card = c.hand[a.index];
  if (!card) illegal('no such card');
  const def = CARDS[card.id];
  if (def.unplayable) illegal(`${def.name} can't be played`);
  const cost = cardCost(card);
  const x = cost === 'X' ? c.energy : 0;
  const pay = cost === 'X' ? c.energy : cost;
  if (pay > c.energy) illegal('not enough energy');
  const target = def.target === 'enemy' ? alive(c)[a.target] : null;
  if (def.target === 'enemy' && !target) illegal('choose a target');

  c.hand.splice(a.index, 1);
  c.energy -= pay;
  c.playedThisTurn++;
  s.stats.cardsPlayed++;
  if (def.fossil) c.turnFlags.fossil = true;
  const g = api(s);
  def.play(g, card.up, target, card, x);
  for (const e of alive(c)) FOES[e.id].onPlayerPlay?.(e, g, { ...card, def });
  if (s.screen === 'gameover') return s;
  if (def.type === 'power') { /* powers stay in play */ }
  else if (cardRetires(card)) retire(s, card);
  else c.discard.push(card);
  checkWin(s);
  return s;
}

// Whether a card in hand can be played right now, and why not if not.
export function playable(s, card) {
  const c = s.combat;
  const def = CARDS[card.id];
  if (def.unplayable) return false;
  const cost = cardCost(card);
  return cost === 'X' || cost <= c.energy;
}

// Every action the player could take right now (used by tests and the practice bot).
export function legalActions(s) {
  switch (s.screen) {
    case 'mandate': return s.mandate.map(index => ({ type: 'choose', index }));
    case 'map': return reachable(s).map(col => ({ type: 'path', col }));
    case 'result': return [{ type: 'continue' }];
    case 'event': return eventOptions(s).map((o, index) => (o.enabled === false ? null : { type: 'choose', index })).filter(Boolean);
    case 'rest': return restOptions(s).filter(o => o.enabled !== false).map(o => ({ type: 'rest', choice: o.id }));
    case 'select': {
      const options = selectable(s);
      const want = Math.min(s.select.count, options.length);
      const out = options.map(c => ({ type: 'select', uids: [c.uid] })).filter(() => want === 1);
      if (want !== 1) out.push({ type: 'select', uids: options.slice(0, want).map(c => c.uid) });
      if (s.select.then === 'shop') out.push({ type: 'cancel' });
      return out;
    }
    case 'reward': {
      const r = s.reward, out = [{ type: 'continue' }];
      if (r.gold) out.push({ type: 'take', what: 'gold' });
      if (r.tool && s.potions.includes(null)) out.push({ type: 'take', what: 'tool' });
      if (r.relic) out.push({ type: 'take', what: 'relic' });
      if (!r.cardsTaken) r.cards.forEach((_, index) => out.push({ type: 'take', what: 'card', index }));
      return out;
    }
    case 'boss': return s.bossRelics.map(id => ({ type: 'choose', id }));
    case 'shop': {
      const out = [{ type: 'leave' }];
      s.shop.cards.forEach((it, index) => { if (!it.sold && s.gold >= it.price) out.push({ type: 'buy', kind: 'card', index }); });
      s.shop.relics.forEach((it, index) => { if (!it.sold && s.gold >= it.price) out.push({ type: 'buy', kind: 'relic', index }); });
      if (s.potions.includes(null)) s.shop.tools.forEach((it, index) => { if (!it.sold && s.gold >= it.price) out.push({ type: 'buy', kind: 'tool', index }); });
      if (!s.shop.capture.sold && s.gold >= s.shop.capture.price) out.push({ type: 'buy', kind: 'capture' });
      if (s.shop.removal && s.gold >= removalPrice(s)) out.push({ type: 'buy', kind: 'removal' });
      return out;
    }
    case 'combat': {
      const c = s.combat, out = [{ type: 'end' }];
      const targets = alive(c).map((_, i) => i);
      c.hand.forEach((card, index) => {
        if (!playable(s, card)) return;
        if (CARDS[card.id].target === 'enemy') for (const target of targets) out.push({ type: 'play', index, target });
        else out.push({ type: 'play', index });
      });
      s.potions.forEach((id, slot) => {
        if (!id) return;
        if (TOOLS[id].target === 'enemy') for (const target of targets) out.push({ type: 'tool', slot, target });
        else out.push({ type: 'tool', slot });
      });
      return out;
    }
  }
  return [];
}

// ---------- score ----------
export function score(s) {
  const won = s.screen === 'victory';
  const parts = {
    floors: s.stats.floors * 5,
    elites: s.stats.elites * 20,
    bosses: s.stats.bosses * 50,
    victory: won ? 250 + s.hp : 0,
    netZero: won && s.carbon === 0 ? 150 : 0,
    heat: -heat(s) * 10,
  };
  return { total: Math.max(0, Object.values(parts).reduce((a, b) => a + b, 0)), parts, won };
}

// Replays a run from its seed and actions, as the server does to check a score.
export function replay(seed, actions) {
  const s = newRun(seed);
  for (const a of actions) apply(s, a);
  return s;
}

export { ACT_NAMES, CARDS, FOES, RELICS, TOOLS, EVENTS, MANDATES, cardCost, cardName, canUpgrade };
