// Scope Creep's enemies and encounters. Each move is a list of steps the engine carries out in
// order, and the same steps become the intent shown above the enemy:
//   { attack: n, times }   hit the player          { block: n }         gain Assurance
//   { emit: n }            add carbon to the run   { buff: { drive } }  raise its own statuses
//   { debuff: { exposed, diluted, liability } }     apply statuses to the player
//   { drain: n }           the player gets n less energy next turn
//   { jam: n }             the player draws n fewer cards next turn
//   { scare: n }           n of the player's Ducklings flee
//   { addCard: id, count, pile }  shuffle status cards into the player's deck
//   { heal: n } { spawn: id } { escape: true } { junkOffset: n }
// `next(e, g)` picks the move for the coming turn; `e.history` holds earlier moves.

const cycle = (...ids) => e => ids[e.turn % ids.length];
// Picks at random, but never the same move three times running.
const mix = (weights) => (e, g) => {
  const [a, b] = e.history.slice(-2);
  for (let tries = 0; tries < 10; tries++) {
    const r = g.rand() * weights.reduce((s, [, w]) => s + w, 0);
    let acc = 0;
    for (const [id, w] of weights) {
      acc += w;
      if (r < acc) { if (!(a === id && b === id)) return id; break; }
    }
  }
  return weights[0][0];
};

export const FOES = {
  // ---------- Act 1: Scope 1, direct emissions ----------
  car: {
    name: 'Company Car', hp: [18, 22],
    moves: {
      ram: { name: 'Ram', steps: [{ attack: 5 }] },
      idle: { name: 'Idle', steps: [{ emit: 1 }, { block: 4 }] },
    },
    next: mix([['ram', 2], ['idle', 1]]),
  },
  chiller: {
    name: 'Leaky Chiller', hp: [30, 34],
    moves: {
      leak: { name: 'F-Gas Leak', steps: [{ emit: 3 }, { debuff: { exposed: 1 } }] },
      rattle: { name: 'Rattle', steps: [{ attack: 9 }] },
    },
    next: cycle('leak', 'rattle', 'rattle'),
  },
  forklift: {
    name: 'Forklift', hp: [24, 28],
    moves: {
      lift: { name: 'Lift', steps: [{ attack: 7 }] },
      beep: { name: 'Reversing Beep', steps: [{ debuff: { diluted: 2 } }, { block: 5 }] },
    },
    next: mix([['lift', 2], ['beep', 1]]),
  },
  diesel: {
    name: 'Diesel Generator', hp: [44, 48],
    moves: {
      rev: { name: 'Rev Up', steps: [{ emit: 2 }, { buff: { drive: 2 } }] },
      chug: { name: 'Chug', steps: [{ attack: 11 }] },
      sputter: { name: 'Sputter', steps: [{ attack: 5, times: 2 }] },
    },
    next: cycle('rev', 'chug', 'sputter'),
  },
  cow: {
    name: 'Methane Cow', hp: [52, 56],
    moves: {
      burp: { name: 'Burp', steps: [{ emit: 4 }, { block: 8 }] },
      stomp: { name: 'Stomp', steps: [{ attack: 13 }] },
      moo: { name: 'Moo', steps: [{ attack: 6 }, { scare: 1 }] },
    },
    next: mix([['stomp', 2], ['burp', 2], ['moo', 1]]),
  },
  boiler: {
    name: 'Gas Boiler', hp: [40, 44],
    moves: {
      heat: { name: 'Heat Cycle', steps: [{ attack: 7 }, { block: 6 }] },
      pilot: { name: 'Pilot Light', steps: [{ buff: { drive: 3 } }, { emit: 2 }] },
    },
    next: cycle('heat', 'heat', 'pilot'),
  },
  // elites
  greenwasher: {
    name: 'Greenwasher', hp: [82, 86], elite: true,
    passive: 'Rebrand: whenever it is Measured 4 or more times, it sheds all Measured and gains 10 Assurance.',
    moves: {
      spin: { name: 'Spin', steps: [{ block: 12 }, { attack: 6 }] },
      claim: { name: 'Bold Claim', steps: [{ attack: 15 }] },
      ad: { name: 'Glossy Advert', steps: [{ debuff: { diluted: 2 } }, { addCard: 'scandal', count: 1, pile: 'discard' }] },
    },
    next: cycle('spin', 'claim', 'ad'),
    onMeasured: (e, g) => { if ((e.st.measured || 0) >= 4) { e.st.measured = 0; e.block += 10; g.log(`${e.name} rebrands, shedding its Measured.`); } },
  },
  flare: {
    name: 'Flare Stack', hp: [66, 70], elite: true,
    passive: 'Emits every turn. Abate it quickly.',
    moves: {
      roar: { name: 'Roar', steps: [{ emit: 5 }, { attack: 10 }] },
      flare: { name: 'Flare', steps: [{ emit: 5 }, { attack: 4, times: 3 }] },
    },
    next: cycle('roar', 'flare'),
  },
  foreman: {
    name: 'Refinery Foreman', hp: [84, 88], elite: true,
    passive: 'Whenever you play a Power, it gains 3 Drive.',
    moves: {
      shout: { name: 'Shift Change', steps: [{ attack: 5, times: 3 }] },
      overtime: { name: 'Overtime', steps: [{ attack: 16 }] },
      memo: { name: 'Memo', steps: [{ buff: { drive: 2 } }, { block: 10 }] },
    },
    next: mix([['shout', 2], ['overtime', 2], ['memo', 1]]),
    onPlayerPlay: (e, g, card) => { if (card.def.type === 'power') { e.st.drive = (e.st.drive || 0) + 3; } },
  },
  // boss
  boilerRoom: {
    name: 'The Boiler Room', hp: [150, 150], boss: true,
    passive: 'Below half health it builds pressure: deal 25 damage to it the next turn to vent it, or it blasts you for 32.',
    moves: {
      stoke: { name: 'Stoke', steps: [{ buff: { drive: 2 } }, { emit: 3 }] },
      blast: { name: 'Boiler Blast', steps: [{ attack: 16 }] },
      steam: { name: 'Steam Jets', steps: [{ attack: 5, times: 3 }, { debuff: { exposed: 1 } }] },
      pressure: { name: 'Building Pressure', steps: [{ block: 10 }, { emit: 2 }] },
      // Telegraphed a turn ahead; if you deal 25 damage to it that turn, it vents instead.
      burst: { name: 'Overpressure', steps: [{ attack: 32 }], unless: e => (e.damageThisTurn >= 25 ? 'vented' : null) },
      vented: { name: 'Vented', steps: [{ debuff: { diluted: 1 } }] },
    },
    next: (e) => {
      if (e.history.at(-1) === 'pressure') return 'burst';
      if (e.hp < e.maxHp / 2 && !e.flags.pressured) { e.flags.pressured = true; return 'pressure'; }
      return ['stoke', 'blast', 'steam'][e.turn % 3];
    },
  },

  // ---------- Act 2: Scope 2, purchased energy ----------
  coalPlant: {
    name: 'Coal Plant', hp: [78, 84],
    moves: {
      burn: { name: 'Burn', steps: [{ emit: 3 }, { attack: 14 }] },
      stack: { name: 'Smokestack', steps: [{ emit: 3 }, { buff: { drive: 3 } }] },
    },
    next: cycle('stack', 'burn', 'burn'),
  },
  line: {
    name: 'Transmission Line', hp: [42, 46],
    moves: {
      zap: { name: 'Arc', steps: [{ attack: 9 }] },
      loss: { name: 'Line Loss', steps: [{ attack: 4 }, { drain: 1 }] },
    },
    next: mix([['zap', 2], ['loss', 1]]),
  },
  peakDemand: {
    name: 'Peak Demand', hp: [64, 68],
    passive: 'Hits harder every turn.',
    moves: { surge: { name: 'Surge', steps: [{ attack: 6 }] } },
    next: () => 'surge',
    // Each turn's surge is 3 stronger than the last.
    attackBonus: e => 3 * e.turn,
  },
  broker: {
    name: 'Certificate Broker', hp: [56, 60],
    moves: {
      sell: { name: 'Sell Certificates', steps: [{ addCard: 'junkCredit', count: 2, pile: 'draw' }, { block: 6 }] },
      pitch: { name: 'Hard Sell', steps: [{ attack: 11 }] },
    },
    next: cycle('sell', 'pitch', 'pitch'),
  },
  dataCentre: {
    name: 'Data Centre', hp: [68, 72],
    passive: 'Its attack hits once for every card in your hand.',
    moves: {
      compute: { name: 'Compute', steps: [{ emit: 2 }, { attack: 3, times: 'hand' }] },
      cool: { name: 'Cooling Cycle', steps: [{ block: 14 }, { emit: 2 }] },
    },
    next: cycle('compute', 'compute', 'cool'),
  },
  peaker: {
    name: 'Gas Peaker', hp: [38, 42],
    moves: {
      standby: { name: 'Standby', steps: [{ block: 5 }] },
      fire: { name: 'Fire Up', steps: [{ emit: 4 }, { attack: 22 }] },
    },
    // Peakers in the same fight fire on different turns.
    next: (e, g) => ['standby', 'standby', 'fire'][(e.turn + g.alive().filter(x => x.id === 'peaker').indexOf(e)) % 3],
  },
  gridOperator: {
    name: 'Grid Operator', hp: [128, 134], elite: true,
    moves: {
      blackout: { name: 'Rolling Blackout', steps: [{ attack: 10 }, { jam: 2 }] },
      dispatch: { name: 'Dispatch', steps: [{ attack: 19 }] },
      balance: { name: 'Load Balancing', steps: [{ block: 15 }, { buff: { drive: 2 } }] },
    },
    next: cycle('blackout', 'dispatch', 'balance'),
  },
  offsetBroker: {
    name: 'Offset Broker', hp: [108, 114], elite: true,
    passive: 'Sells you junk offsets that fail at the next audit.',
    moves: {
      junk: { name: 'Junk Portfolio', steps: [{ junkOffset: 6 }, { attack: 8 }] },
      invoice: { name: 'Invoice', steps: [{ attack: 7, times: 2 }, { debuff: { diluted: 1 } }] },
      hedgeFund: { name: 'Hedge Fund', steps: [{ block: 18 }] },
    },
    next: cycle('junk', 'invoice', 'hedgeFund'),
  },
  merger: {
    name: 'Utility Merger', hp: [62, 66], elite: true,
    passive: 'When one half falls, the other recovers 15 and gains 3 Drive.',
    moves: {
      synergy: { name: 'Synergies', steps: [{ attack: 8 }, { block: 5 }] },
      layoffs: { name: 'Layoffs', steps: [{ attack: 11 }] },
    },
    next: mix([['synergy', 1], ['layoffs', 1]]),
    onAllyDeath: (e) => { e.hp = Math.min(e.maxHp, e.hp + 15); e.st.drive = (e.st.drive || 0) + 3; },
  },
  substation: {
    name: 'Substation', hp: [22, 24], minion: true,
    moves: { feed: { name: 'Feed the Grid', steps: [{ attack: 4 }] } },
    next: () => 'feed',
  },
  grid: {
    name: 'The Grid', hp: [240, 240], boss: true,
    passive: 'Substations feed it Assurance each turn while they stand.',
    moves: {
      baseload: { name: 'Baseload', steps: [{ emit: 4 }, { block: 12 }] },
      surge: { name: 'Surge', steps: [{ attack: 7, times: 3 }] },
      brownout: { name: 'Brownout', steps: [{ drain: 1 }, { debuff: { diluted: 2 } }, { attack: 10 }] },
      expand: { name: 'Grid Expansion', steps: [{ spawn: 'substation' }, { spawn: 'substation' }, { emit: 2 }] },
    },
    next: (e, g) => {
      if (e.turn % 4 === 2 && g.alive().length < 3) return 'expand';
      return ['baseload', 'surge', 'brownout'][e.turn % 3];
    },
    onTurnStart: (e, g) => { const subs = g.alive().filter(x => x.id === 'substation').length; if (subs) e.block += 4 * subs; },
  },

  // ---------- Act 3: Scope 3, the value chain ----------
  supplier: {
    name: 'Tier 2 Supplier', hp: [34, 38],
    passive: 'When another supplier falls, it gains 3 Drive.',
    moves: {
      ship: { name: 'Ship', steps: [{ attack: 8 }, { emit: 1 }] },
      subcontract: { name: 'Subcontract', steps: [{ block: 8 }, { emit: 1 }] },
    },
    next: mix([['ship', 2], ['subcontract', 1]]),
    onAllyDeath: (e, g, dead) => { if (dead.id === 'supplier') e.st.drive = (e.st.drive || 0) + 3; },
  },
  ship: {
    name: 'Container Ship', hp: [118, 124],
    moves: {
      steam: { name: 'Full Steam', steps: [{ emit: 5 }, { block: 10 }] },
      ram: { name: 'Ram', steps: [{ attack: 24 }] },
      wake: { name: 'Wake', steps: [{ attack: 7 }, { scare: 2 }] },
    },
    next: cycle('steam', 'wake', 'ram'),
  },
  fashion: {
    name: 'Fast Fashion', hp: [62, 66],
    moves: {
      haul: { name: 'Haul', steps: [{ attack: 3, times: 5 }] },
      drop: { name: 'New Drop', steps: [{ addCard: 'impulseBuy', count: 2, pile: 'draw' }, { emit: 2 }] },
    },
    next: cycle('haul', 'drop'),
  },
  jet: {
    name: 'Private Jet', hp: [76, 80],
    passive: 'After four turns it takes off, emitting 15 as it goes.',
    moves: {
      taxi: { name: 'Taxi', steps: [{ emit: 4 }, { attack: 12 }] },
      cruise: { name: 'Cruise', steps: [{ emit: 4 }, { block: 12 }] },
      takeoff: { name: 'Take Off', steps: [{ emit: 15 }, { escape: true }] },
    },
    next: e => (e.turn >= 3 ? 'takeoff' : e.turn % 2 ? 'cruise' : 'taxi'),
  },
  landfill: {
    name: 'Landfill', hp: [90, 96],
    moves: {
      leach: { name: 'Leachate', steps: [{ debuff: { liability: 4 } }, { emit: 3 }] },
      tip: { name: 'Tip', steps: [{ attack: 14 }] },
    },
    next: cycle('leach', 'tip', 'tip'),
  },
  plantation: {
    name: 'Palm Plantation', hp: [98, 104],
    passive: 'Starts with 3 Regulation: hitting it hurts.',
    start: { regulation: 3 },
    moves: {
      clear: { name: 'Clearance', steps: [{ attack: 15 }, { emit: 2 }] },
      grow: { name: 'Monoculture', steps: [{ buff: { regulation: 1, drive: 2 } }, { block: 10 }] },
    },
    next: cycle('clear', 'grow'),
  },
  consultant: {
    name: 'The Consultant', hp: [150, 158], elite: true,
    passive: 'Billable hours: its attack hits once for every card you played last turn.',
    moves: {
      bill: { name: 'Billable Hours', steps: [{ attack: 4, times: 'played' }] },
      deck: { name: 'Slide Deck', steps: [{ block: 20 }, { debuff: { exposed: 2 } }] },
      scope: { name: 'Scope Change', steps: [{ attack: 18 }, { addCard: 'paperwork', count: 1, pile: 'discard' }] },
    },
    next: cycle('bill', 'deck', 'scope'),
  },
  deforestation: {
    name: 'Deforestation Front', hp: [196, 204], elite: true,
    passive: 'Grows stronger every turn.',
    moves: {
      advance: { name: 'Advance', steps: [{ attack: 12 }, { emit: 4 }, { buff: { drive: 2 } }] },
      burn: { name: 'Slash and Burn', steps: [{ attack: 6, times: 3 }, { emit: 4 }, { buff: { drive: 2 } }] },
    },
    next: cycle('advance', 'burn'),
  },
  shadow: {
    name: 'Shadow Emissions', hp: [118, 124], elite: true,
    passive: 'Unreported: takes half damage while it has no Measured.',
    halfUnlessMeasured: true,
    moves: {
      creep: { name: 'Creep', steps: [{ emit: 4 }, { attack: 10 }] },
      hide: { name: 'Hide', steps: [{ block: 16 }, { emit: 3 }] },
      lurk: { name: 'Lurk', steps: [{ attack: 7, times: 2 }] },
    },
    next: mix([['creep', 2], ['hide', 1], ['lurk', 2]]),
  },
  upstream: {
    name: 'Upstream', hp: [130, 130], boss: true,
    passive: 'When a link of the chain falls, the others gain 3 Drive.',
    moves: {
      extract: { name: 'Extract', steps: [{ emit: 5 }, { attack: 10 }] },
      stockpile: { name: 'Stockpile', steps: [{ block: 14 }, { emit: 3 }] },
    },
    // The three links take turns to lead, so they don't all strike at once.
    next: cycle('stockpile', 'extract'),
    onAllyDeath: e => { e.st.drive = (e.st.drive || 0) + 3; },
  },
  operations: {
    name: 'Operations', hp: [150, 150], boss: true,
    passive: 'When a link of the chain falls, the others gain 3 Drive.',
    moves: {
      scale: { name: 'Scale Up', steps: [{ buff: { drive: 2 } }, { block: 12 }] },
      crunch: { name: 'Crunch', steps: [{ attack: 8, times: 2 }] },
      restructure: { name: 'Restructure', steps: [{ attack: 14 }, { jam: 1 }] },
    },
    next: cycle('crunch', 'scale', 'restructure', 'scale'),
    onAllyDeath: e => { e.st.drive = (e.st.drive || 0) + 3; },
  },
  downstream: {
    name: 'Downstream', hp: [130, 130], boss: true,
    passive: 'When a link of the chain falls, the others gain 3 Drive.',
    moves: {
      endOfLife: { name: 'End of Life', steps: [{ debuff: { liability: 5 } }, { emit: 4 }] },
      useCase: { name: 'Use Phase', steps: [{ attack: 13 }] },
    },
    next: cycle('endOfLife', 'useCase'),
    onAllyDeath: e => { e.st.drive = (e.st.drive || 0) + 3; },
  },
};

// Encounters by act: `easy` for the first two fights, then `normal`, `elite` and `boss`.
export const ENCOUNTERS = {
  1: {
    easy: [['car', 'car'], ['chiller'], ['forklift', 'car']],
    normal: [['diesel'], ['cow'], ['boiler'], ['car', 'car', 'car'], ['chiller', 'forklift'], ['boiler', 'car']],
    elite: [['greenwasher'], ['flare'], ['foreman']],
    boss: [['boilerRoom']],
  },
  2: {
    easy: [['line', 'line'], ['peakDemand'], ['broker']],
    normal: [['coalPlant'], ['line', 'line'], ['peakDemand'], ['broker', 'line'], ['dataCentre'], ['peaker', 'line'], ['peaker', 'peaker']],
    elite: [['gridOperator'], ['offsetBroker'], ['merger', 'merger']],
    boss: [['grid']],
  },
  3: {
    easy: [['supplier', 'supplier'], ['fashion'], ['landfill']],
    normal: [['supplier', 'supplier', 'supplier'], ['ship'], ['fashion', 'supplier'], ['jet'], ['landfill'], ['plantation'], ['jet', 'supplier']],
    elite: [['consultant'], ['deforestation'], ['shadow']],
    boss: [['upstream', 'operations', 'downstream']],
  },
};

export const ACT_NAMES = { 1: 'Scope 1: Direct Emissions', 2: 'Scope 2: Purchased Energy', 3: 'Scope 3: The Value Chain' };
