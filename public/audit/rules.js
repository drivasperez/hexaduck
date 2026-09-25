// Audit, Please: the rulebook, and the checker that applies it.
//
// A case is a set of documents, each a list of fields. The checker looks at a case with fresh
// eyes (it doesn't know how the case was made) and returns every rule it breaks, with the pairs
// of things that disagree. A pair is two references: 'doc.field' for a field on a document, or
// 'rule.id' for a line of the rulebook. The player proves a discrepancy by pointing at a pair.

export const YEAR = 2030;                 // the reporting year being claimed for
export const APPROVED_REGISTRIES = ['Gold Pond Standard', 'Mallard Carbon Registry', 'Heronwood Verified'];
export const UNAPPROVED_REGISTRIES = ['EZ Offsets', 'Carbon4Less', 'PondCredits Direct', 'Budget Sequestration Co'];
export const VERIFIERS = [
  ['Crane & Partners Assurance', 'ACC-1142'], ['Bittern Verification', 'ACC-2087'], ['Swan Lake Auditors', 'ACC-3310'],
  ['Kittiwake Assurance', 'ACC-4459'], ['Egret Standards', 'ACC-5523'],
];
export const UNACCREDITED = ['Plover Checks Ltd', 'Quick Quack Verification', 'Magpie Assurance'];
export const SCOPE3_SECTORS = ['Retail', 'Apparel', 'Food', 'Tech'];
export const GRID_FACTOR = '0.19';
export const OLDEST_VINTAGE = 2025;
export const NET_ZERO_MAX = 0.1;         // net zero: at most 10% of the baseline left

// Each rule arrives on a given day. `text` is what the rulebook says.
export const RULES = [
  { id: 'year', day: 1, title: 'Reporting year', text: `Every document must be for the ${YEAR} reporting year.` },
  { id: 'signed', day: 1, title: 'Signatures', text: 'The claim form must be signed.' },
  { id: 'match', day: 1, title: 'Consistency', text: 'The company name and registration number must be the same on every document.' },
  { id: 'registry', day: 2, title: 'Registries', text: `Offsets must come from an approved registry: ${APPROVED_REGISTRIES.join(', ')}.` },
  { id: 'vintage', day: 2, title: 'Vintage', text: `Offsets must be of vintage ${OLDEST_VINTAGE} or later.` },
  { id: 'retired', day: 2, title: 'Retirement', text: 'Offsets must be retired (not just active), with the claiming company as beneficiary.' },
  { id: 'cover', day: 2, title: 'Coverage', text: 'The certificate must cover at least the tonnes the claim form says were offset.' },
  { id: 'verifier', day: 3, title: 'Verification', text: 'A verification letter is required, from an accredited verifier with its matching accreditation number, valid on today\'s date.' },
  { id: 'scopes', day: 3, title: 'Scope of verification', text: 'The letter must verify every scope included in the claim.' },
  { id: 'sums', day: 4, title: 'Arithmetic', text: 'Scope 1 + Scope 2 + Scope 3 must equal the total, and the claim form total must match the statement.' },
  { id: 'reduction', day: 4, title: 'Reductions', text: 'A reduction claim may not claim more than the actual fall from the baseline.' },
  { id: 'noNeutral', day: 5, title: 'Carbon neutral', text: 'Directive 5: "carbon neutral" claims are no longer accepted.' },
  { id: 'netzero', day: 5, title: 'Net zero', text: `Net zero claims need emissions at least ${Math.round((1 - NET_ZERO_MAX) * 100)}% below the baseline, with what remains offset.` },
  { id: 'double', day: 6, title: 'Double counting', text: 'An offset serial may only be used once. Check the Retired Serials bulletin and today\'s approvals.' },
  { id: 'renewable', day: 7, title: 'Renewable electricity', text: `Renewable electricity claims need ${YEAR} certificates (RECs), held by the company, covering all electricity on the bill.` },
  { id: 'scope3', day: 8, title: 'Scope 3', text: `${SCOPE3_SECTORS.join(', ')} companies must report Scope 3.` },
  { id: 'factor', day: 9, title: 'Emission factors', text: `Grid electricity must use the official ${YEAR} factor: ${GRID_FACTOR} kg CO₂e per kWh.` },
];
export const rulesFor = day => RULES.filter(r => r.day <= day);

// Reference pages in the rulebook, and the day each appears.
export const REFERENCE = [
  { id: 'registries', day: 2, title: 'Approved registries', lines: APPROVED_REGISTRIES },
  { id: 'verifiers', day: 3, title: 'Accredited verifiers', lines: VERIFIERS.map(([n, a]) => `${n} — ${a}`) },
  { id: 'sectors', day: 8, title: 'Scope 3 sectors', lines: SCOPE3_SECTORS },
  { id: 'factors', day: 9, title: 'Official factors', lines: [`Grid electricity ${YEAR}: ${GRID_FACTOR} kg CO₂e/kWh`] },
];

// ---------- reading documents ----------
export const field = (docs, doc, key) => docs.find(d => d.id === doc)?.fields.find(f => f.key === key)?.value;
const has = (docs, doc) => docs.some(d => d.id === doc);
const num = v => Number(String(v).replace(/[^0-9.-]/g, ''));
export const dateValue = d => Number(String(d).replace(/-/g, ''));  // '2031-03-10' -> 20310310

// ---------- the checker ----------
// Returns [{ rule, pairs: [[refA, refB], ...], why }] for every broken rule active on `day`.
// `ctx` has { date, bulletin: [serials], approvedSerials: [serials approved earlier today] }.
export function check(docs, day, ctx) {
  const out = [];
  const active = new Set(rulesFor(day).map(r => r.id));
  const add = (rule, pairs, why) => { if (active.has(rule)) out.push({ rule, pairs, why }); };
  const claim = field(docs, 'form', 'claim');

  // Reporting year on every document that states one.
  for (const d of docs) {
    const y = d.fields.find(f => f.key === 'year');
    if (y && num(y.value) !== YEAR) add('year', [[`${d.id}.year`, 'rule.year']], `${d.title} is for ${y.value}.`);
  }
  if (!String(field(docs, 'form', 'signed') || '').trim()) add('signed', [['form.signed', 'rule.signed']], 'The claim form isn\'t signed.');

  // Names and numbers must agree with the claim form.
  const company = field(docs, 'form', 'company'), reg = field(docs, 'form', 'reg');
  for (const d of docs) {
    if (d.id === 'form' || d.id === 'bulletin') continue;
    for (const f of d.fields) {
      if (['company', 'beneficiary', 'holder'].includes(f.key) && f.value !== company) {
        const rule = f.key === 'company' ? 'match' : f.key === 'beneficiary' ? 'retired' : 'renewable';
        add(rule, [[`${d.id}.${f.key}`, 'form.company']], `${d.title} names "${f.value}", not "${company}".`);
      }
      if (f.key === 'reg' && f.value !== reg) add('match', [[`${d.id}.reg`, 'form.reg']], `${d.title} has registration ${f.value}, not ${reg}.`);
    }
  }

  // Offsets.
  if (has(docs, 'cert')) {
    const registry = field(docs, 'cert', 'registry');
    if (!APPROVED_REGISTRIES.includes(registry)) add('registry', [['cert.registry', 'rule.registry'], ['cert.registry', 'ref.registries']], `${registry} isn't an approved registry.`);
    if (num(field(docs, 'cert', 'vintage')) < OLDEST_VINTAGE) add('vintage', [['cert.vintage', 'rule.vintage']], `Vintage ${field(docs, 'cert', 'vintage')} is too old.`);
    if (field(docs, 'cert', 'status') !== 'Retired') add('retired', [['cert.status', 'rule.retired']], `The offsets are only "${field(docs, 'cert', 'status')}", not retired.`);
    if (num(field(docs, 'cert', 'tonnes')) < num(field(docs, 'form', 'offsets'))) add('cover', [['cert.tonnes', 'form.offsets']], 'The certificate covers fewer tonnes than the claim says were offset.');
    const serial = field(docs, 'cert', 'serial');
    if (ctx.bulletin.includes(serial)) add('double', [['cert.serial', 'bulletin.serials']], `Serial ${serial} is on the Retired Serials bulletin.`);
    else if (ctx.approvedSerials.includes(serial)) add('double', [['cert.serial', 'ledger.serials']], `Serial ${serial} was already used by a claim you approved today.`);
  }

  // Verification.
  if (active.has('verifier')) {
    if (!has(docs, 'letter')) add('verifier', [['form.claim', 'rule.verifier']], 'There\'s no verification letter.');
    else {
      const name = field(docs, 'letter', 'verifier'), acc = field(docs, 'letter', 'accreditation');
      const listed = VERIFIERS.find(([n]) => n === name);
      if (!listed) add('verifier', [['letter.verifier', 'ref.verifiers'], ['letter.verifier', 'rule.verifier']], `${name} isn't accredited.`);
      else if (listed[1] !== acc) add('verifier', [['letter.accreditation', 'ref.verifiers']], `${name}'s accreditation number is ${listed[1]}, not ${acc}.`);
      if (dateValue(field(docs, 'letter', 'valid')) < dateValue(ctx.date)) add('verifier', [['letter.valid', 'rule.verifier']], `The letter expired on ${field(docs, 'letter', 'valid')}.`);
      const claimed = String(field(docs, 'form', 'scopes')), verified = String(field(docs, 'letter', 'scopes'));
      if (claimed.includes('3') && !verified.includes('3')) add('scopes', [['letter.scopes', 'form.scopes']], 'The claim includes Scope 3, but the letter doesn\'t verify it.');
    }
  }

  // Arithmetic.
  const s1 = num(field(docs, 'statement', 's1')), s2 = num(field(docs, 'statement', 's2'));
  const s3raw = field(docs, 'statement', 's3'), s3 = num(s3raw) || 0, total = num(field(docs, 'statement', 'total'));
  if (s1 + s2 + s3 !== total) add('sums', [['statement.total', 'statement.s1'], ['statement.total', 'statement.s2'], ['statement.total', 'statement.s3'], ['statement.total', 'rule.sums']], `${s1} + ${s2} + ${s3} is ${s1 + s2 + s3}, not ${total}.`);
  if (num(field(docs, 'form', 'total')) !== total) add('sums', [['form.total', 'statement.total']], 'The claim form total doesn\'t match the statement.');

  // Claim types.
  if (claim === 'Carbon neutral') add('noNeutral', [['form.claim', 'rule.noNeutral']], 'Carbon neutral claims are no longer accepted.');
  if (claim === 'Net zero' && has(docs, 'baseline')) {
    const base = num(field(docs, 'baseline', 'total'));
    if (total > base * NET_ZERO_MAX) add('netzero', [['statement.total', 'baseline.total'], ['statement.total', 'rule.netzero']], `${total} t is ${Math.round((1 - total / base) * 100)}% below the baseline of ${base} t, not 90%.`);
  }
  if (claim === 'Emissions reduction' && has(docs, 'baseline')) {
    const base = num(field(docs, 'baseline', 'total')), claimedPct = num(field(docs, 'form', 'reduction'));
    const actual = Math.floor((1 - total / base) * 100);
    if (claimedPct > actual) add('reduction', [['form.reduction', 'baseline.total'], ['form.reduction', 'statement.total']], `The fall from ${base} t to ${total} t is ${actual}%, not ${claimedPct}%.`);
  }
  if (claim === 'Renewable electricity') {
    if (!has(docs, 'rec')) add('renewable', [['form.claim', 'rule.renewable']], 'There are no renewable energy certificates.');
    else {
      if (num(field(docs, 'rec', 'mwh')) < num(field(docs, 'bill', 'mwh'))) add('renewable', [['rec.mwh', 'bill.mwh']], 'The certificates cover less electricity than the bill.');
      if (num(field(docs, 'rec', 'year')) !== YEAR) { /* reported by the year rule above */ }
    }
  }
  if (SCOPE3_SECTORS.includes(field(docs, 'form', 'sector')) && !s3) add('scope3', [['statement.s3', 'rule.scope3'], ['statement.s3', 'ref.sectors']], `${field(docs, 'form', 'sector')} companies must report Scope 3.`);
  if (has(docs, 'statement') && field(docs, 'statement', 'factor') !== GRID_FACTOR) add('factor', [['statement.factor', 'rule.factor'], ['statement.factor', 'ref.factors']], `The statement uses ${field(docs, 'statement', 'factor')}, not ${GRID_FACTOR}.`);

  return out;
}

// Whether two references point at a real discrepancy in these results.
export function isDiscrepancy(results, a, b) {
  for (const r of results) for (const [x, y] of r.pairs) if ((x === a && y === b) || (x === b && y === a)) return r;
  return null;
}
