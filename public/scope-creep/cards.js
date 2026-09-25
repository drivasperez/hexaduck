// Scope Creep's cards. Each card's `play(g, up, target)` uses the combat helpers in engine.js
// (`g`); `up` is whether the card is upgraded and `target` is the chosen enemy, if any.
// `text(up)` describes the card. Numbers that differ when upgraded are written u(up, base, upgraded).
//
// Keywords (see KEYWORDS below): Measured, Ducklings, Fossil, Offset, Remove, Retire, Retain,
// Liability, Regulation, Exposed, Diluted, Drive, Heat.

export const u = (up, a, b) => (up ? b : a);

export const KEYWORDS = {
  Assurance: 'Blocks damage until the start of your next turn.',
  Measured: 'Each hit on a Measured enemy deals 1 extra damage per stack. Measured lasts all combat.',
  Ducklings: 'At the end of your turn, each Duckling pecks a random enemy for 2.',
  Fossil: 'Adds carbon to your run. Every 15 carbon raises Heat.',
  Heat: 'Every enemy you meet gains 1 Drive per Heat. Heat rises with every 15 carbon.',
  Offset: 'Lowers carbon now. Offsets are checked at each boss: half fail, and come back doubled.',
  Remove: 'Lowers carbon for good.',
  Retire: 'Removed from your deck for the rest of this combat.',
  Retain: 'Stays in your hand at the end of your turn.',
  Liability: 'Loses that much health at the start of its turn, then Liability falls by 1.',
  Regulation: 'Whenever an enemy hits you, it takes this much damage.',
  Exposed: 'Takes 50% more damage from attacks. Falls by 1 each turn.',
  Diluted: 'Deals 25% less damage with attacks. Falls by 1 each turn.',
  Drive: 'Each hit deals 1 more damage per stack.',
  Emit: 'Adds carbon to your run at the end of the enemy\'s turn, unless it has been abated.',
};

export const CARDS = {
  // ---------- starter ----------
  abate: {
    name: 'Abate', cost: 1, type: 'attack', rarity: 'starter', target: 'enemy',
    text: up => `Deal ${u(up, 6, 9)} damage.`,
    play: (g, up, t) => g.hit(t, u(up, 6, 9)),
  },
  hedge: {
    name: 'Hedge', cost: 1, type: 'skill', rarity: 'starter', target: 'none',
    text: up => `Gain ${u(up, 5, 8)} Assurance.`,
    play: (g, up) => g.block(u(up, 5, 8)),
  },
  survey: {
    name: 'Quick Survey', cost: 0, type: 'skill', rarity: 'starter', target: 'enemy',
    text: up => `Apply ${u(up, 1, 2)} Measured. Draw 1 card.`,
    play: (g, up, t) => { g.apply(t, 'measured', u(up, 1, 2)); g.draw(1); },
  },
  diesel: {
    name: 'Diesel Backup', cost: 0, type: 'attack', rarity: 'starter', target: 'enemy', fossil: true,
    text: up => `Deal ${u(up, 7, 10)} damage. Fossil: +2 carbon.`,
    play: (g, up, t) => { g.hit(t, u(up, 7, 10)); g.carbon(2); },
  },

  // ---------- common ----------
  siteVisit: {
    name: 'Site Visit', cost: 1, type: 'skill', rarity: 'common', target: 'enemy',
    text: up => `Apply ${u(up, 2, 3)} Measured. Gain ${u(up, 4, 6)} Assurance.`,
    play: (g, up, t) => { g.apply(t, 'measured', u(up, 2, 3)); g.block(u(up, 4, 6)); },
  },
  spreadsheet: {
    name: 'Spreadsheet Strike', cost: 1, type: 'attack', rarity: 'common', target: 'enemy',
    text: up => `Deal ${u(up, 4, 6)} damage twice.`,
    play: (g, up, t) => g.hit(t, u(up, 4, 6), 2),
  },
  dataRequest: {
    name: 'Data Request', cost: 1, type: 'skill', rarity: 'common', target: 'none',
    text: up => `Draw ${u(up, 2, 3)} cards. If any enemy has 3 or more Measured, gain 1 energy.`,
    play: (g, up) => { g.draw(u(up, 2, 3)); if (g.enemies().some(e => (e.st.measured || 0) >= 3)) g.energy(1); },
  },
  emissionFactor: {
    name: 'Emission Factor', cost: 1, type: 'attack', rarity: 'common', target: 'enemy',
    text: up => `${u(up, 2, 3)} times: deal 3 damage, then apply 1 Measured.`,
    play: (g, up, t) => { for (let i = 0; i < u(up, 2, 3); i++) { g.hit(t, 3); g.apply(t, 'measured', 1); } },
  },
  matrix: {
    name: 'Materiality Matrix', cost: 1, type: 'skill', rarity: 'common', target: 'none',
    text: up => `Apply ${u(up, 1, 2)} Measured to ALL enemies. Draw 1 card.`,
    play: (g, up) => { g.apply('all', 'measured', u(up, 1, 2)); g.draw(1); },
  },
  hatch: {
    name: 'Hatch', cost: 1, type: 'skill', rarity: 'common', target: 'none',
    text: up => `Gain ${u(up, 2, 3)} Ducklings.`,
    play: (g, up) => g.hatch(u(up, 2, 3)),
  },
  peckOrder: {
    name: 'Pecking Order', cost: 1, type: 'attack', rarity: 'common', target: 'enemy',
    text: up => `Deal ${u(up, 5, 7)} damage. Your Ducklings peck once now.`,
    play: (g, up, t) => { g.hit(t, u(up, 5, 7)); g.peck(1); },
  },
  nestEgg: {
    name: 'Nest Egg', cost: 1, type: 'skill', rarity: 'common', target: 'none',
    text: up => `Gain 4 Assurance, plus ${u(up, 1, 2)} for each Duckling.`,
    play: (g, up) => g.block(4 + u(up, 1, 2) * g.ducklings()),
  },
  waddle: {
    name: 'Waddle', cost: 0, type: 'skill', rarity: 'common', target: 'none', retire: true,
    text: up => `Gain ${u(up, 1, 2)} Duckling${up ? 's' : ''}. Retire.`,
    play: (g, up) => g.hatch(u(up, 1, 2)),
  },
  coalSeam: {
    name: 'Coal Seam', cost: 1, type: 'attack', rarity: 'common', target: 'enemy', fossil: true,
    text: up => `Deal ${u(up, 13, 17)} damage. Fossil: +3 carbon.`,
    play: (g, up, t) => { g.hit(t, u(up, 13, 17)); g.carbon(3); },
  },
  gasFlare: {
    name: 'Gas Flare', cost: 1, type: 'attack', rarity: 'common', target: 'all', fossil: true,
    text: up => `Deal ${u(up, 6, 9)} damage to ALL enemies. Fossil: +2 carbon.`,
    play: (g, up) => { g.hitAll(u(up, 6, 9)); g.carbon(2); },
  },
  treePlanting: {
    name: 'Tree Planting', cost: 1, type: 'skill', rarity: 'common', target: 'none',
    text: up => `Gain ${u(up, 5, 7)} Assurance. Offset ${u(up, 3, 4)} carbon.`,
    play: (g, up) => { g.block(u(up, 5, 7)); g.offset(u(up, 3, 4)); },
  },
  retrofit: {
    name: 'Retrofit', cost: 1, type: 'skill', rarity: 'common', target: 'none',
    text: up => `Gain ${u(up, 7, 9)} Assurance. If you played a Fossil card this turn, Remove ${u(up, 1, 2)} carbon.`,
    play: (g, up) => { g.block(u(up, 7, 9)); if (g.c.turnFlags.fossil) g.removeCarbon(u(up, 1, 2)); },
  },
  compliance: {
    name: 'Compliance Check', cost: 1, type: 'skill', rarity: 'common', target: 'none',
    text: up => `Gain ${u(up, 8, 11)} Assurance.`,
    play: (g, up) => g.block(u(up, 8, 11)),
  },
  pressure: {
    name: 'Stakeholder Pressure', cost: 1, type: 'attack', rarity: 'common', target: 'enemy',
    text: up => `Deal ${u(up, 8, 10)} damage. Apply ${u(up, 1, 2)} Diluted.`,
    play: (g, up, t) => { g.hit(t, u(up, 8, 10)); g.apply(t, 'diluted', u(up, 1, 2)); },
  },
  carbonTax: {
    name: 'Carbon Tax', cost: 1, type: 'attack', rarity: 'common', target: 'enemy',
    text: up => `Deal 6 damage, plus ${u(up, 3, 4)} for each Heat.`,
    play: (g, up, t) => g.hit(t, 6 + u(up, 3, 4) * g.heat()),
  },
  doubleMateriality: {
    name: 'Double Materiality', cost: 2, type: 'attack', rarity: 'common', target: 'enemy',
    text: up => `Deal ${u(up, 12, 15)} damage. Apply ${u(up, 2, 3)} Exposed.`,
    play: (g, up, t) => { g.hit(t, u(up, 12, 15)); g.apply(t, 'exposed', u(up, 2, 3)); },
  },
  quickWin: {
    name: 'Quick Win', cost: 0, type: 'attack', rarity: 'common', target: 'enemy',
    text: up => `Deal ${u(up, 3, 5)} damage. Draw 1 card.`,
    play: (g, up, t) => { g.hit(t, u(up, 3, 5)); g.draw(1); },
  },
  greenwash: {
    name: 'Greenwash', cost: 0, type: 'skill', rarity: 'common', target: 'none',
    text: up => `Gain ${u(up, 7, 10)} Assurance. Shuffle a Scandal into your draw pile.`,
    play: (g, up) => { g.block(u(up, 7, 10)); g.addCard('scandal', 'draw'); },
  },
  consentDecree: {
    name: 'Consent Decree', cost: 1, type: 'skill', rarity: 'common', target: 'enemy',
    text: up => `Apply ${u(up, 4, 6)} Liability. Gain ${u(up, 4, 6)} Assurance.`,
    play: (g, up, t) => { g.apply(t, 'liability', u(up, 4, 6)); g.block(u(up, 4, 6)); },
  },
  dueDiligence: {
    name: 'Due Diligence', cost: 1, type: 'skill', rarity: 'common', target: 'none',
    text: up => `Gain ${u(up, 6, 8)} Assurance now and at the start of your next turn.`,
    play: (g, up) => { g.block(u(up, 6, 8)); g.p.st.nextBlock = (g.p.st.nextBlock || 0) + u(up, 6, 8); },
  },

  // ---------- uncommon ----------
  fullInventory: {
    name: 'Full Inventory', cost: 2, upCost: 1, type: 'skill', rarity: 'uncommon', target: 'none',
    text: () => 'Apply 3 Measured to ALL enemies.',
    play: g => g.apply('all', 'measured', 3),
  },
  disclosure: {
    name: 'Disclosure', cost: 1, type: 'attack', rarity: 'uncommon', target: 'enemy',
    text: up => `Deal 2 damage, plus ${u(up, 3, 4)} for each Measured on the enemy. It loses all Measured.`,
    play: (g, up, t) => { const m = t.st.measured || 0; g.hit(t, 2 + u(up, 3, 4) * m); t.st.measured = 0; },
  },
  auditTrail: {
    name: 'Audit Trail', cost: 1, upCost: 0, type: 'power', rarity: 'uncommon', target: 'none',
    text: () => 'Whenever you apply Measured, gain 1 Assurance per stack.',
    play: g => g.power('auditTrail', 1),
  },
  limitedAssurance: {
    name: 'Limited Assurance', cost: 1, type: 'skill', rarity: 'uncommon', target: 'none',
    text: up => `Gain ${u(up, 2, 3)} Assurance for each Measured across all enemies.`,
    play: (g, up) => g.block(u(up, 2, 3) * g.enemies().reduce((n, e) => n + (e.st.measured || 0), 0)),
  },
  scopeCreep: {
    name: 'Scope Creep', cost: 1, type: 'attack', rarity: 'uncommon', target: 'enemy',
    text: up => `Deal 5 damage, plus ${u(up, 3, 4)} for every earlier play of this card this combat.`,
    play: (g, up, t, card) => {
      const n = g.c.creep[card.uid] || 0;
      g.hit(t, 5 + u(up, 3, 4) * n);
      g.c.creep[card.uid] = n + 1;
    },
  },
  variance: {
    name: 'Variance Analysis', cost: 1, type: 'attack', rarity: 'uncommon', target: 'enemy',
    text: up => `Deal ${u(up, 7, 9)} damage. If the enemy has 3 or more Measured, deal it again.`,
    play: (g, up, t) => { const again = (t.st.measured || 0) >= 3; g.hit(t, u(up, 7, 9)); if (again && t.hp > 0) g.hit(t, u(up, 7, 9)); },
  },
  clutch: {
    name: 'Clutch of Eggs', cost: 2, type: 'skill', rarity: 'uncommon', target: 'none', retire: true,
    text: up => `Gain ${u(up, 4, 5)} Ducklings. Retire.`,
    play: (g, up) => g.hatch(u(up, 4, 5)),
  },
  flightFormation: {
    name: 'Flight Formation', cost: 2, upCost: 1, type: 'power', rarity: 'uncommon', target: 'none',
    text: () => 'At the start of your turn, gain 1 Assurance for each Duckling.',
    play: g => g.power('flightFormation', 1),
  },
  vFormation: {
    name: 'V Formation', cost: 1, type: 'attack', rarity: 'uncommon', target: 'all',
    text: up => `Deal ${u(up, 2, 3)} damage to ALL enemies for each Duckling.`,
    play: (g, up) => g.hitAll(u(up, 2, 3) * g.ducklings()),
  },
  migration: {
    name: 'Migration', cost: 1, type: 'attack', rarity: 'uncommon', target: 'enemy',
    text: up => `Lose all Ducklings. Deal ${u(up, 7, 9)} damage for each one.`,
    play: (g, up, t) => { const n = g.ducklings(); g.c.ducklings = 0; if (n) g.hit(t, u(up, 7, 9) * n); },
  },
  imprinting: {
    name: 'Imprinting', cost: 1, type: 'power', rarity: 'uncommon', target: 'none', upInnate: true,
    text: up => `At the end of your turn, gain 1 Duckling.${up ? ' Innate.' : ''}`,
    play: g => g.power('imprinting', 1),
  },
  fracking: {
    name: 'Fracking', cost: 0, type: 'attack', rarity: 'uncommon', target: 'enemy', fossil: true,
    text: up => `Deal ${u(up, 9, 12)} damage. Draw 1 card. Fossil: +3 carbon.`,
    play: (g, up, t) => { g.hit(t, u(up, 9, 12)); g.draw(1); g.carbon(3); },
  },
  strandedAsset: {
    name: 'Stranded Asset', cost: 0, type: 'skill', rarity: 'uncommon', target: 'none', fossil: true, retire: true,
    text: up => `Gain ${u(up, 2, 3)} energy. Fossil: +4 carbon. Retire.`,
    play: (g, up) => { g.energy(u(up, 2, 3)); g.carbon(4); },
  },
  carbonCapture: {
    name: 'Carbon Capture', cost: 2, upCost: 1, type: 'skill', rarity: 'uncommon', target: 'none', retire: true,
    text: () => 'Remove 5 carbon. Retire.',
    play: g => g.removeCarbon(5),
  },
  natureOffset: {
    name: 'Nature-Based Offset', cost: 0, type: 'skill', rarity: 'uncommon', target: 'none',
    text: up => `Offset ${u(up, 4, 6)} carbon.`,
    play: (g, up) => g.offset(u(up, 4, 6)),
  },
  adaptation: {
    name: 'Adaptation', cost: 1, type: 'skill', rarity: 'uncommon', target: 'none',
    text: up => `Gain 5 Assurance, plus ${u(up, 3, 4)} for each Heat.`,
    play: (g, up) => g.block(5 + u(up, 3, 4) * g.heat()),
  },
  heatDome: {
    name: 'Heat Dome', cost: 1, type: 'attack', rarity: 'uncommon', target: 'all',
    text: up => `Deal 4 damage to ALL enemies, plus ${u(up, 2, 3)} for each Heat.`,
    play: (g, up) => g.hitAll(4 + u(up, 2, 3) * g.heat()),
  },
  regulation: {
    name: 'Regulation', cost: 1, type: 'power', rarity: 'uncommon', target: 'none',
    text: up => `Gain ${u(up, 4, 6)} Regulation.`,
    play: (g, up) => g.apply('self', 'regulation', u(up, 4, 6)),
  },
  classAction: {
    name: 'Class Action', cost: 1, type: 'skill', rarity: 'uncommon', target: 'enemy',
    text: up => `Apply ${u(up, 8, 11)} Liability.`,
    play: (g, up, t) => g.apply(t, 'liability', u(up, 8, 11)),
  },
  enforcement: {
    name: 'Enforcement Notice', cost: 1, type: 'attack', rarity: 'uncommon', target: 'enemy',
    text: up => `Deal ${u(up, 5, 8)} damage. Double the enemy's Liability.`,
    play: (g, up, t) => { g.hit(t, u(up, 5, 8)); if (t.hp > 0 && t.st.liability) t.st.liability *= 2; },
  },
  capAndTrade: {
    name: 'Cap and Trade', cost: 1, upCost: 0, type: 'skill', rarity: 'uncommon', target: 'none',
    text: () => 'Until your next turn, enemies that Emit give you Assurance instead of carbon.',
    play: g => { g.p.st.capAndTrade = 1; },
  },
  justTransition: {
    name: 'Just Transition', cost: 1, upCost: 0, type: 'skill', rarity: 'uncommon', target: 'none',
    text: () => 'Retire every Fossil card in your hand. Draw a card for each, plus 1.',
    play: g => { const n = g.retireHand(c => c.def.fossil); g.draw(n + 1); },
  },
  litigationHold: {
    name: 'Litigation Hold', cost: 2, upCost: 1, type: 'power', rarity: 'uncommon', target: 'none',
    text: () => 'At the start of your turn, apply 3 Liability to ALL enemies.',
    play: g => g.power('litigationHold', 3),
  },

  // ---------- rare ----------
  netZeroPledge: {
    name: 'Net Zero Pledge', cost: 2, upCost: 1, type: 'power', rarity: 'rare', target: 'none',
    text: () => 'Whenever you Retire a card, Remove 1 carbon. At the end of combat, Remove 2 carbon.',
    play: g => g.power('netZeroPledge', 1),
  },
  sbti: {
    name: 'Science-Based Target', cost: 2, upCost: 1, type: 'power', rarity: 'rare', target: 'none',
    text: () => 'Your attacks deal 50% more damage to Measured enemies.',
    play: g => g.power('sbti', 1),
  },
  fullValueChain: {
    name: 'Full Value Chain', cost: 'X', type: 'attack', rarity: 'rare', target: 'none',
    text: up => `X times: deal ${u(up, 5, 7)} damage to a random enemy and apply 1 Measured to it.`,
    play: (g, up, _t, _c, x) => {
      for (let i = 0; i < x; i++) { const e = g.randomEnemy(); if (!e) break; g.apply(e, 'measured', 1); g.hit(e, u(up, 5, 7)); }
    },
  },
  flockTogether: {
    name: 'Birds of a Feather', cost: 3, upCost: 2, type: 'power', rarity: 'rare', target: 'none',
    text: () => 'Your Ducklings peck twice.',
    play: g => g.power('flockTogether', 1),
  },
  motherDuck: {
    name: 'Mother Duck', cost: 1, type: 'skill', rarity: 'rare', target: 'none', retire: true, upRetire: false,
    text: up => `Double your Ducklings.${up ? '' : ' Retire.'}`,
    play: g => g.hatch(g.ducklings(), false),
  },
  tippingPoint: {
    name: 'Tipping Point', cost: 0, type: 'attack', rarity: 'rare', target: 'enemy', fossil: true, retire: true,
    text: up => `Deal ${u(up, 30, 40)} damage. Fossil: +8 carbon. Retire.`,
    play: (g, up, t) => { g.hit(t, u(up, 30, 40)); g.carbon(8); },
  },
  moonshot: {
    name: 'Moonshot', cost: 2, type: 'skill', rarity: 'rare', target: 'none',
    text: up => `Next turn, gain ${u(up, 2, 3)} energy and draw ${u(up, 2, 3)} extra cards.`,
    play: (g, up) => { g.p.st.nextEnergy = (g.p.st.nextEnergy || 0) + u(up, 2, 3); g.p.st.nextDraw = (g.p.st.nextDraw || 0) + u(up, 2, 3); },
  },
  crossCheck: {
    name: 'Cross-Check', cost: 1, upCost: 0, type: 'skill', rarity: 'rare', target: 'enemy',
    text: () => 'Double the enemy\'s Measured.',
    play: (g, _up, t) => g.apply(t, 'measured', t.st.measured || 0, false),
  },
  reforestation: {
    name: 'Reforestation', cost: 2, type: 'skill', rarity: 'rare', target: 'none', retire: true,
    text: up => `Remove ${u(up, 8, 11)} carbon. Recover 5 Credibility. Retire.`,
    play: (g, up) => { g.removeCarbon(u(up, 8, 11)); g.heal(5); },
  },
  verificationBody: {
    name: 'Verification Body', cost: 1, upCost: 0, type: 'power', rarity: 'rare', target: 'none',
    text: () => 'Your Offsets can no longer fail an audit.',
    play: g => g.power('verified', 1),
  },
  emergencyBrake: {
    name: 'Emergency Brake', cost: 1, upCost: 0, type: 'skill', rarity: 'rare', target: 'none', retire: true,
    text: () => 'ALL enemies lose all Drive. Retire.',
    play: g => { for (const e of g.enemies()) e.st.drive = 0; },
  },
  ductTape: {
    name: 'Duck Tape', cost: 0, type: 'skill', rarity: 'rare', target: 'none', retain: true,
    text: up => `Gain ${u(up, 4, 6)} Assurance. Draw 1 card. Retain.`,
    play: (g, up) => { g.block(u(up, 4, 6)); g.draw(1); },
  },

  // ---------- statuses and curses ----------
  scandal: {
    name: 'Scandal', cost: null, type: 'status', rarity: 'special', target: 'none', unplayable: true,
    text: () => 'Unplayable. Goes away after combat.',
  },
  junkCredit: {
    name: 'Junk Credit', cost: null, type: 'status', rarity: 'special', target: 'none', unplayable: true,
    text: () => 'Unplayable. When drawn, +1 carbon. Goes away after combat.',
    onDraw: g => g.carbon(1),
  },
  impulseBuy: {
    name: 'Impulse Buy', cost: 1, type: 'status', rarity: 'special', target: 'none', retire: true,
    text: () => 'Does nothing. Retire. Goes away after combat.',
    play: () => {},
  },
  paperwork: {
    name: 'Paperwork', cost: null, type: 'status', rarity: 'special', target: 'none', unplayable: true,
    text: () => 'Unplayable. At the end of your turn, if this is in your hand, lose 1 Credibility. Goes away after combat.',
    endOfTurnInHand: g => g.loseHp(1),
  },
  redTape: {
    name: 'Red Tape', cost: null, type: 'curse', rarity: 'special', target: 'none', unplayable: true,
    text: () => 'Unplayable. At the end of your turn, if this is in your hand, lose 2 Credibility.',
    endOfTurnInHand: g => g.loseHp(2),
  },
  legacy: {
    name: 'Legacy Liability', cost: null, type: 'curse', rarity: 'special', target: 'none', unplayable: true,
    text: () => 'Unplayable.',
  },
};

export const cardCost = (card) => {
  const def = CARDS[card.id];
  return card.up && def.upCost !== undefined ? def.upCost : def.cost;
};
export const cardName = card => CARDS[card.id].name + (card.up ? '+' : '');
export const cardRetires = card => {
  const def = CARDS[card.id];
  return card.up && def.upRetire !== undefined ? def.upRetire : !!def.retire;
};
export const canUpgrade = card => !card.up && ['starter', 'common', 'uncommon', 'rare'].includes(CARDS[card.id].rarity);
export const pool = rarity => Object.keys(CARDS).filter(id => CARDS[id].rarity === rarity);
