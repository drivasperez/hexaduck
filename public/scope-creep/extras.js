// Scope Creep's relics, consumables ("tools"), events and starting mandates.
//
// Relic hooks: pickup(r) once when gained; combatStart(g), turnStart(g), turnEnd(g) during
// combat; combatEnd(r) after a win. `energy` adds to each turn's energy. Other effects are flags
// the engine checks by name (see engine.js).

export const RELICS = {
  // starter
  clipboard: { name: 'Clipboard', rarity: 'starter', text: 'At the start of each combat, apply 1 Measured to ALL enemies.', combatStart: g => g.apply('all', 'measured', 1) },
  // common
  rubberDuck: { name: 'Rubber Duck', rarity: 'common', text: 'At the start of each combat, gain 1 Duckling.', combatStart: g => g.hatch(1, false) },
  thermos: { name: 'Thermos', rarity: 'common', text: 'Gain 1 extra energy on the first turn of each combat.', combatStart: g => g.energy(1) },
  duckBlind: { name: 'Duck Blind', rarity: 'common', text: 'At the start of each combat, gain 8 Assurance.', combatStart: g => g.block(8) },
  wetlandCredits: { name: 'Wetland Credits', rarity: 'common', text: 'After each combat, Remove 1 carbon.', combatEnd: r => r.removeCarbon(1) },
  breadCrumbs: { name: 'Bread Crumbs', rarity: 'common', text: 'After each combat, recover 4 Credibility.', combatEnd: r => r.heal(4) },
  spareFeathers: { name: 'Spare Feathers', rarity: 'common', text: 'Raise your maximum Credibility by 8.', pickup: r => r.maxHp(8) },
  bicycle: { name: 'Bicycle', rarity: 'common', text: 'Draw 2 extra cards on the first turn of each combat.', firstTurnDraw: 2 },
  breadBag: { name: 'Bread Bag', rarity: 'common', text: 'Resting recovers 10 more Credibility.' },
  heatPump: { name: 'Heat Pump', rarity: 'common', text: 'At the end of your turn, if you have no Assurance, gain 4.', turnEnd: g => { if (g.p.block === 0) g.block(4); } },
  // uncommon
  solarPanel: { name: 'Solar Panel', rarity: 'uncommon', text: 'Every third turn, gain 1 energy.', turnStart: g => { if (g.c.turn % 3 === 0) g.energy(1); } },
  methaneDetector: { name: 'Methane Detector', rarity: 'uncommon', text: 'Whenever an enemy Emits, apply 1 Measured to it.' },
  pocketCalculator: { name: 'Pocket Calculator', rarity: 'uncommon', text: 'Whenever you apply Measured, apply 1 more.' },
  eggCarton: { name: 'Egg Carton', rarity: 'uncommon', text: 'Cards that give Ducklings give 1 more.' },
  carbonLedger: { name: 'Carbon Ledger', rarity: 'uncommon', text: 'Whenever carbon is added during combat, gain that much Assurance.' },
  recycledPaper: { name: 'Recycled Paper', rarity: 'uncommon', text: 'Removing cards at shops costs half as much.' },
  toolbelt: { name: 'Toolbelt', rarity: 'uncommon', text: 'Carry 1 more tool.', pickup: r => { r.s.potions.push(null); } },
  // rare
  voluntaryStandard: { name: 'Gold Standard', rarity: 'rare', text: 'Your Offsets can never fail an audit.' },
  coolingTower: { name: 'Cooling Tower', rarity: 'rare', text: 'Heat gives enemies half as much Drive.' },
  lifeJacket: { name: 'Life Jacket', rarity: 'rare', text: 'The first time you would lose your last Credibility, recover to 30% instead.' },
  windTurbine: { name: 'Wind Turbine', rarity: 'rare', text: 'At the start of your turn, deal 3 damage to ALL enemies.', turnStart: g => g.hitAll(3, 1, false) },
  // boss (choose one of three after each boss)
  coalContract: { name: 'Coal Contract', rarity: 'boss', energy: 1, text: '+1 energy each turn. At the start of each combat, +3 carbon.', combatStart: g => g.carbon(3) },
  bigFour: { name: 'Big Four Auditor', rarity: 'boss', energy: 1, text: '+1 energy each turn. You can no longer see enemy intents.' },
  greenhushing: { name: 'Greenhushing', rarity: 'boss', energy: 1, text: '+1 energy each turn. Card rewards offer 2 cards instead of 3.' },
  offsetPortfolio: { name: 'Offset Portfolio', rarity: 'boss', energy: 1, text: '+1 energy each turn. Enemies start each combat with 1 more Drive.' },
  megaflock: { name: 'Megaflock', rarity: 'boss', text: 'Start each combat with 3 Ducklings. Ducklings peck for 3 instead of 2.', combatStart: g => g.hatch(3, false) },
  materialityEngine: { name: 'Materiality Engine', rarity: 'boss', text: 'At the start of your turn, apply 1 Measured to ALL enemies.', turnStart: g => g.apply('all', 'measured', 1) },
};

export const TOOLS = {
  espresso: { name: 'Espresso', text: 'Gain 2 energy.', use: g => g.energy(2) },
  fireDrill: { name: 'Fire Drill', text: 'Gain 12 Assurance.', use: g => g.block(12) },
  drone: { name: 'Survey Drone', text: 'Apply 3 Measured to ALL enemies.', use: g => g.apply('all', 'measured', 3) },
  eggBox: { name: 'Egg Box', text: 'Gain 3 Ducklings.', use: g => g.hatch(3, false) },
  legalLetter: { name: 'Legal Letter', text: 'Apply 8 Liability to an enemy.', target: 'enemy', use: (g, t) => g.apply(t, 'liability', 8) },
  swiftReport: { name: 'Swift Report', text: 'Draw 4 cards.', use: g => g.draw(4) },
  dacVoucher: { name: 'Direct Air Capture Voucher', text: 'Remove 4 carbon.', use: g => g.removeCarbon(4) },
  firstAid: { name: 'First Aid Kit', text: 'Recover 15 Credibility.', use: g => g.heal(15) },
};

// Events. `options(r)` lists choices; each `do(r)` changes the run through the run helpers and
// returns the text shown afterwards. An option can instead start a card selection by calling
// r.select(...), which returns its own follow-up text.
export const EVENTS = {
  salesman: {
    title: 'The Offset Salesman',
    text: 'A duck in a very sharp suit is selling forest credits by the tonne. "Every one of them triple-checked," he says, not quite meeting your eye.',
    options: r => [
      { label: 'Buy the bargain bundle', detail: 'Pay 30 grants. Offset 10 carbon.', enabled: r.s.gold >= 30, do: r => { r.gold(-30); r.offset(10); return 'He counts the money twice. The credits look fine. For now.'; } },
      { label: 'Buy verified removals', detail: 'Pay 80 grants. Remove 6 carbon.', enabled: r.s.gold >= 80, do: r => { r.gold(-80); r.removeCarbon(6); return 'Expensive, but the paperwork is immaculate.'; } },
      { label: 'Walk away', detail: '', do: () => 'You leave him to his next mark.' },
    ],
  },
  pond: {
    title: 'A Quiet Pond',
    text: 'Between meetings you find a pond, perfectly still. A small duckling paddles over and looks at you expectantly.',
    options: r => [
      { label: 'Rest by the water', detail: 'Recover 12 Credibility.', do: r => { r.heal(12); return 'You feel almost human again. Almost duck.'; } },
      r.s.relics.includes('rubberDuck')
        ? { label: 'Feed the ducks', detail: 'Raise your maximum Credibility by 5.', do: r => { r.maxHp(5); return 'They follow you halfway back to the office.'; } }
        : { label: 'Adopt the duckling', detail: 'Gain the Rubber Duck relic.', do: r => { r.relic('rubberDuck'); return 'It hops into your briefcase and refuses to leave.'; } },
    ],
  },
  dataGap: {
    title: 'The Data Gap',
    text: 'Half your supplier data is missing. The report is due tomorrow.',
    options: r => [
      { label: 'Use an industry average', detail: 'Gain a random rare card. +6 carbon.', do: r => { const c = r.randomCard('rare'); r.carbon(6); return `The numbers are... plausible. You gain ${c}.`; } },
      { label: 'Measure it properly', detail: 'Lose 8 Credibility. Upgrade 2 random cards.', enabled: r.s.hp > 8, do: r => { r.hurt(8); const names = r.upgradeRandom(2); return names.length ? `A long night, but you upgrade ${names.join(' and ')}.` : 'A long night, and nothing to show for it.'; } },
      { label: 'Leave it for next year', detail: 'Gain 60 grants and the Legacy Liability curse.', do: r => { r.gold(60); r.addCard('legacy'); return 'Future you will deal with it.'; } },
    ],
  },
  campaign: {
    title: 'A Tempting Campaign',
    text: 'The marketing team has a new campaign: a leaf, a sunrise, the word "natural" in green. It would bring in funding.',
    options: r => [
      { label: 'Run the campaign', detail: 'Gain 120 grants and the Red Tape curse.', do: r => { r.gold(120); r.addCard('redTape'); return 'The complaints start arriving the next morning.'; } },
      { label: 'Refuse', detail: 'Remove 3 carbon. Your honesty inspires the team.', do: r => { r.removeCarbon(3); return 'The team brings in a real efficiency project instead.'; } },
    ],
  },
  supplier: {
    title: 'Supplier Engagement',
    text: 'A key supplier wants to decarbonise, but needs help.',
    options: r => [
      { label: 'Fund their transition', detail: 'Pay 50 grants. Remove 10 carbon.', enabled: r.s.gold >= 50, do: r => { r.gold(-50); r.removeCarbon(10); return 'Their furnaces go electric. Your Scope 3 thanks you.'; } },
      { label: 'Share your methodology', detail: 'Upgrade a card of your choice.', do: r => r.select('upgrade', 1, 'You teach them, and learn something yourself.') },
      { label: 'Skip the meeting', detail: '', do: () => 'Maybe next quarter.' },
    ],
  },
  keynote: {
    title: 'Conference Keynote',
    text: 'You\'ve been asked to give a keynote. The lights are very bright.',
    options: r => [
      { label: 'Give the talk', detail: 'Lose 7 Credibility. Gain a random relic.', enabled: r.s.hp > 7, do: r => { r.hurt(7); const name = r.relic('random'); return `A heckler asks about Scope 3. Afterwards, a sponsor gives you ${name}.`; } },
      { label: 'Network at the bar', detail: 'Gain a random uncommon card.', do: r => `You swap business cards and ideas, and gain ${r.randomCard('uncommon')}.` },
      { label: 'Stay in your room', detail: '', do: () => 'You order room service and sleep for eleven hours.' },
    ],
  },
  flood: {
    title: 'Flooded Office',
    text: 'The river has come up through the car park. You have time to save one thing.',
    options: r => [
      { label: 'Save the servers', detail: 'Lose 12 Credibility.', enabled: r.s.hp > 12, do: r => { r.hurt(12); return 'You wade out, soaked, with the data intact.'; } },
      { label: 'Save yourself', detail: 'Lose a random card from your deck.', do: r => { const name = r.loseRandomCard(); return name ? `${name} is washed away.` : 'Nothing is lost.'; } },
    ],
  },
  spreadsheet: {
    title: 'A Mysterious Spreadsheet',
    text: 'An email from an unknown sender: "final_FINAL_v7.xlsx". It contains some very good formulas.',
    options: r => [
      { label: 'Copy a formula', detail: 'Duplicate a card in your deck.', do: r => r.select('duplicate', 1, 'You paste it into your own workbook.') },
      { label: 'Delete a tab', detail: 'Lose 6 Credibility. Remove a card from your deck.', enabled: r.s.hp > 6, do: r => { r.hurt(6); return r.select('remove', 1, 'Much tidier.'); } },
      { label: 'Close it', detail: '', do: () => 'Probably a phishing test anyway.' },
    ],
  },
  regulator: {
    title: 'The Regulator Visits',
    text: 'An inspector arrives unannounced and asks to see your carbon accounts.',
    options: r => r.s.carbon < 15
      ? [{ label: 'Show them your books', detail: 'Your carbon is under 15. Gain 100 grants.', do: r => { r.gold(100); return '"Exemplary," they say, and leave a grant application behind.'; } }]
      : [
        { label: 'Pay the fine', detail: 'Lose 60 grants, or all you have.', do: r => { r.gold(-Math.min(60, r.s.gold)); return 'You pay up.'; } },
        { label: 'Accept a formal warning', detail: 'Gain the Red Tape curse.', do: r => { r.addCard('redTape'); return 'It goes on your record.'; } },
      ],
  },
  migration: {
    title: 'A Migrating Flock',
    text: 'A great skein of ducks passes overhead. A few drop down to see what you\'re doing.',
    options: r => [
      { label: 'Join them for a while', detail: 'Add Clutch of Eggs and an upgraded Hatch to your deck.', do: r => { r.addCard('clutch'); r.addCard('hatch', true); return 'When you leave, some of them follow.'; } },
      { label: 'Wave', detail: 'Recover 6 Credibility.', do: r => { r.heal(6); return 'They honk back.'; } },
    ],
  },
  innovation: {
    title: 'Innovation Fund',
    text: 'A fund is looking for bold ideas. Bold ideas are, by definition, risky.',
    options: r => [
      { label: 'Pitch everything', detail: 'Transform 2 random cards into other cards of the same rarity.', do: r => { const names = r.transformRandom(2); return names.length ? `Out go ${names.join(' and ')}.` : 'You have nothing to pitch.'; } },
      { label: 'Keep your powder dry', detail: '', do: () => 'You leave the brochure on the table.' },
    ],
  },
  heatwave: {
    title: 'Heatwave',
    minAct: 2,
    text: 'The office is thirty-eight degrees. The air conditioning roars.',
    options: r => [
      { label: 'Install proper cooling', detail: 'Pay 40 grants.', enabled: r.s.gold >= 40, do: r => { r.gold(-40); return 'A heat pump, finally.'; } },
      { label: 'Plant shade trees', detail: 'Lose 5 Credibility. Remove 4 carbon.', enabled: r.s.hp > 5, do: r => { r.hurt(5); r.removeCarbon(4); return 'Hot work, but they will grow.'; } },
      { label: 'Crank the AC', detail: '+5 carbon. Recover 8 Credibility.', do: r => { r.carbon(5); r.heal(8); return 'Cool, at last. At a cost.'; } },
    ],
  },
};

// The first choice of the run.
export const MANDATES = [
  { label: 'Stronger mandate', detail: 'Raise your maximum Credibility by 10.', do: r => { r.maxHp(10); return 'The board is behind you.'; } },
  { label: 'Cut the dead wood', detail: 'Remove a card from your deck.', do: r => r.select('remove', 1, 'A leaner deck.') },
  { label: 'Training budget', detail: 'Upgrade a card.', do: r => r.select('upgrade', 1, 'Well trained.') },
  { label: 'Ambitious hire', detail: 'Choose one of three rare cards. +8 carbon.', do: r => { r.carbon(8); return r.offerCards('rare'); } },
  { label: 'Seed funding', detail: 'Start with 100 extra grants.', do: r => { r.gold(100); return 'Money in the bank.'; } },
  { label: 'Fresh start', detail: 'Transform 2 random cards.', do: r => { const names = r.transformRandom(2); return `Out go ${names.join(' and ')}.`; } },
  { label: 'Sponsor', detail: 'Gain a random common relic. Lose 8 Credibility.', do: r => { r.hurt(8); return `You gain ${r.relic('common')}.`; } },
];
