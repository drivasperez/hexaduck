// Automated players for Scope Creep, used by the tests and for tuning the game's balance.
import { apply, CARDS, heat, legalActions, newRun, RELICS, restOptions, selectable } from '../../public/scope-creep/engine.js';

export function mulberry(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Plays random legal actions. Good at finding crashes, terrible at the game.
export function randomPlayer(seed) {
  const rand = mulberry(seed * 7 + 1);
  return s => {
    const actions = legalActions(s);
    // Ending the turn too eagerly makes random runs very short; prefer playing cards.
    if (s.screen === 'combat' && actions.length > 1 && rand() < 0.8) return actions[1 + Math.floor(rand() * (actions.length - 1))];
    return actions[Math.floor(rand() * actions.length)];
  };
}

const clone = s => JSON.parse(JSON.stringify(s));
const alive = s => s.combat ? s.combat.enemies.filter(e => e.hp > 0 && !e.gone) : [];

// How good a combat position looks: little enemy health left, few enemies, our health and
// Assurance against what's coming, and not much carbon.
function evaluate(s, before) {
  if (s.screen === 'gameover') return -1e6;
  if (!s.combat) return 1e5 + s.hp * 10 - s.carbon * 3;
  const enemies = alive(s);
  const incoming = s.combat.turn === before.combat.turn
    ? enemies.reduce((n, e) => n + incomingFrom(s, e), 0) : 0;
  const block = Math.min(s.combat.p.block, incoming);
  let v = 0;
  v -= enemies.reduce((n, e) => n + e.hp, 0) * 1.0;
  v -= enemies.length * 12;
  v += s.hp * 3 + block * 2.6;
  v -= s.carbon * 1.2;
  v += s.combat.ducklings * 4;
  v += Object.values(s.combat.powers).reduce((a, b) => a + b, 0) * 6;
  for (const e of enemies) v += (e.st.measured || 0) * 1.5 - (e.st.drive || 0) * 2 + delayedDamage(e);
  v += (s.combat.p.st.regulation || 0) * 2 * enemies.length;
  return v;
}

// Liability keeps ticking down (L, then L-1, ...), so it's worth most of that total damage.
function delayedDamage(e) {
  const l = e.st.liability || 0;
  return Math.min(e.hp, (l * (l + 1)) / 2) * 0.8;
}

function incomingFrom(s, e) {
  const FOES_MOVE = e.move;
  if (!FOES_MOVE) return 0;
  return intentsTotal(s, e);
}
import { intents } from '../../public/scope-creep/engine.js';
function intentsTotal(s, e) {
  return intents(s, e).reduce((n, i) => n + (i.kind === 'attack' ? i.n * i.times : 0), 0);
}

// A greedy player: in combat it tries every action one step ahead and takes the best, and out
// of combat it follows simple rules of thumb. Roughly a careful beginner.
// Options: `ratings` overrides the card ratings (to favour a style), and `careful` makes the
// player look after its carbon: no Fossil cards, wetlands and carbon capture when it's high.
export function greedyPlayer(seed, { ratings = {}, careful = false } = {}) {
  const rand = mulberry(seed * 13 + 5);
  // A rough rating of how much each card improves a typical deck, like a player's gut feel.
  const RATING = {
    sbti: 4, fullValueChain: 3, netZeroPledge: 3, flockTogether: 2.5, motherDuck: 2, tippingPoint: 3.5, moonshot: 3,
    crossCheck: 2.5, reforestation: 3, verificationBody: 2, emergencyBrake: 3, ductTape: 3,
    fullInventory: 3, disclosure: 3, auditTrail: 2.5, limitedAssurance: 2, scopeCreep: 3, variance: 3, clutch: 2.5,
    flightFormation: 2.5, vFormation: 2.5, migration: 2.5, imprinting: 3, fracking: 3.5, strandedAsset: 2.5,
    carbonCapture: 3, natureOffset: 2, adaptation: 2.5, heatDome: 3, regulation: 3, classAction: 3, capAndTrade: 2,
    justTransition: 1.5, litigationHold: 3.5, siteVisit: 2.5, spreadsheet: 2.5, dataRequest: 2, emissionFactor: 2.5,
    matrix: 2, hatch: 2, peckOrder: 2, nestEgg: 2, waddle: 1.5, coalSeam: 3, gasFlare: 3, treePlanting: 2, retrofit: 2,
    compliance: 2.5, consentDecree: 2.5, enforcement: 3, pressure: 2.5, carbonTax: 2, doubleMateriality: 3, quickWin: 2.5, greenwash: 1.5, dueDiligence: 2.5,
  };
  const cardValue = id => (careful && CARDS[id].fossil ? 0 : ratings[id] ?? RATING[id] ?? 1);
  return s => {
    const actions = legalActions(s);
    switch (s.screen) {
      case 'combat': {
        let best = null, bestV = -Infinity;
        for (const a of actions) {
          const t = clone(s);
          apply(t, a);
          let v = evaluate(t, s);
          if (a.type === 'end') v -= 1;  // only end the turn when nothing helps
          if (a.type === 'tool') v -= s.hp > s.maxHp * 0.5 && s.combat.kind === 'fight' ? 40 : 5;
          if (v > bestV) { bestV = v; best = a; }
        }
        return best;
      }
      case 'map': {
        const types = actions.map(a => (a.col === 'boss' ? 'boss' : s.map[s.pos ? s.pos.row + 1 : 0][a.col].t));
        const want = s.hp < s.maxHp * 0.45 ? ['rest', 'shop', 'event', 'treasure', 'fight', 'elite'] : ['elite', 'fight', 'treasure', 'rest', 'event', 'shop'];
        for (const w of [...want, 'boss']) { const i = types.indexOf(w); if (i >= 0) return actions[i]; }
        return actions[0];
      }
      case 'reward': {
        const r = s.reward;
        for (const a of actions) if (a.type === 'take' && a.what !== 'card') return a;
        const cards = actions.filter(a => a.what === 'card');
        if (cards.length) {
          const bestCard = cards.reduce((b, a) => (cardValue(r.cards[a.index].id) > cardValue(r.cards[b.index].id) ? a : b));
          // Take good cards; take decent ones while the deck is still small.
          const v = cardValue(r.cards[bestCard.index].id);
          if (v >= 3 || (v >= 2.5 && s.deck.length < 22) || (v >= 2 && s.deck.length < 14)) return bestCard;
        }
        return { type: 'continue' };
      }
      case 'rest': {
        if (s.hp < s.maxHp * 0.55) return { type: 'rest', choice: 'heal' };
        if (s.carbon >= (careful ? 12 : 25)) return { type: 'rest', choice: 'wetland' };
        return actions.find(a => a.choice === 'upgrade') || { type: 'rest', choice: 'heal' };
      }
      case 'select': {
        const options = selectable(s);
        if (s.select.count !== 1) return actions.find(a => a.type === 'select');
        const order = s.select.purpose === 'remove' ? ['redTape', 'legacy', 'diesel', 'abate', 'hedge'] : ['survey', 'abate', 'hedge'];
        if (careful && s.select.purpose === 'remove') order.unshift(...options.filter(c => CARDS[c.id].fossil).map(c => c.id));
        for (const id of order) { const c = options.find(c => c.id === id); if (c) return { type: 'select', uids: [c.uid] }; }
        return actions[0];
      }
      case 'shop': {
        const buyRemoval = actions.find(a => a.kind === 'removal');
        if (buyRemoval) return buyRemoval;
        const cards = actions.filter(a => a.kind === 'card' && cardValue(s.shop.cards[a.index].id) >= 3);
        if (cards.length) return cards[0];
        if (s.carbon >= (careful ? 6 : 20)) { const cap = actions.find(a => a.kind === 'capture'); if (cap) return cap; }
        return actions.find(a => a.kind === 'relic') || { type: 'leave' };
      }
      case 'boss': return actions[Math.floor(rand() * actions.length)];
      default: return actions[Math.floor(rand() * actions.length)];
    }
  };
}

// A planner: in combat it searches over whole turns. It keeps the best few partial sequences
// of plays by a quick heuristic, then simulates the enemies' response to the most promising
// finished turns and commits to the best one. Out of combat it uses the greedy player's rules.
// Closer to a competent human than the greedy player, so better for judging difficulty.
export function plannerPlayer(seed, { beam = 5, finalists = 6, ...style } = {}) {
  const greedy = greedyPlayer(seed, style);
  let plan = [];
  return s => {
    if (s.screen !== 'combat') { plan = []; return greedy(s); }
    if (plan.length) return plan.shift();
    let frontier = [{ t: s, seq: [] }];
    const done = [];
    for (let depth = 0; depth < 10 && frontier.length; depth++) {
      const children = [];
      for (const node of frontier) {
        done.push(node);
        for (const a of legalActions(node.t)) {
          if (a.type === 'end') continue;
          if (a.type === 'tool' && !(node.t.hp < node.t.maxHp * 0.4 || node.t.combat.kind !== 'fight')) continue;
          const t = clone(node.t);
          apply(t, a);
          const child = { t, seq: [...node.seq, a], v: evaluate(t, s) };
          if (!t.combat) { child.v += 1e6; done.push(child); continue; }  // wins the fight
          children.push(child);
        }
      }
      children.sort((a, b) => b.v - a.v);
      frontier = children.slice(0, beam);
    }
    // Look ahead through the enemies' turn for the best few.
    done.sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
    let best = null, bestV = -Infinity;
    for (const node of done.slice(0, finalists)) {
      const t = clone(node.t);
      if (t.screen === 'combat') apply(t, { type: 'end' });
      const v = t.screen === 'gameover' ? -1e7 : !t.combat ? 1e7 + t.hp : evaluateAfterEnemies(t);
      if (v > bestV) { bestV = v; best = node; }
    }
    plan = best && best.seq.length ? [...best.seq, { type: 'end' }] : [{ type: 'end' }];
    return plan.shift();
  };
}

function evaluateAfterEnemies(s) {
  const enemies = alive(s);
  let v = s.hp * 3 - s.carbon * 1.5;
  v -= enemies.reduce((n, e) => n + e.hp, 0) * 1.0 + enemies.length * 12;
  v += s.combat.ducklings * 4 + Object.values(s.combat.powers).reduce((a, b) => a + b, 0) * 6;
  for (const e of enemies) v += (e.st.measured || 0) * 1.5 - (e.st.drive || 0) * 2.5 + delayedDamage(e);
  v += (s.combat.p.st.regulation || 0) * 2 * enemies.length;
  return v;
}

// Plays a whole run and returns the final state. Stops (and reports) if the run goes on far
// longer than any real run could, which would mean something is stuck.
export function playRun(seed, player, maxSteps = 20000) {
  const s = newRun(seed);
  const actions = [];
  for (let i = 0; i < maxSteps; i++) {
    if (s.screen === 'gameover' || s.screen === 'victory') return { s, actions, steps: i };
    const a = player(s);
    actions.push(a);
    apply(s, a);
  }
  return { s, actions, steps: maxSteps, stuck: true };
}

export { heat };
