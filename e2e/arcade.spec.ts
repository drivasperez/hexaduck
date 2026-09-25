import { expect, type Page, test } from '@playwright/test';
import { apply as applyEngine, newRun, seedFrom, VERSION } from '../public/scope-creep/engine.js';
import { plannerPlayer, playRun } from '../test/scope-creep/players.js';
import * as Audit from '../public/audit/engine.js';
import { clerk, playRun as playAudit } from '../test/audit/players.js';

// Each test posts under its own name, since tests share one database.
const uniqueName = () => `e2e ${Math.random().toString(36).slice(2, 8)}`;

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  return errors;
}

// Starts a run, leaves the duck alone until it dies, then posts the run under `name`.
async function playAndPost(page: Page, name: string, start: () => Promise<void>) {
  await start();
  const button = page.locator('#board-btn');
  await expect(button).toBeHidden();
  await expect(button).toBeVisible({ timeout: 45_000 });
  await button.click();
  await page.locator('#board-input').fill(name);
  const posted = page.waitForResponse(r => r.url().endsWith('/api/scores') && r.request().method() === 'POST');
  await page.locator('#board-input').press('Enter');
  const res = await posted;
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ name, improved: true });
  await expect(page.locator('#board-who')).toContainText(name);
  // Idle runs all score about the same, so the new row may sit below older ties in the top 10.
  await expect(page.locator('#board-list li.me').or(page.locator('#board-note', { hasText: 'You are #' }))).toBeVisible();
}

const start = (page: Page) => async () => {
  const mobile = test.info().project.name === 'mobile';
  // Tapping the middle of the canvas starts both games on touch screens.
  if (mobile) await page.locator('canvas').tap();
  else { await page.locator('canvas').focus(); await page.keyboard.press('Space'); }
};

test('the arcade links to every game', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Duck Arcade' })).toBeVisible();
  for (const [name, href] of [['Hexaduck', '/hexaduck/'], ['Runoff', '/runoff/'], ['Tailwind', '/tailwind/'], ['Flock', '/flock/'], ['Confluence', '/confluence/'], ['Scope Creep', '/scope-creep/'], ['Audit, Please', '/audit/']]) {
    await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', href);
  }
  expect(errors).toEqual([]);
});

test('a Hexaduck run can be posted to its leaderboard', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/hexaduck/');
  const name = uniqueName();
  await playAndPost(page, name, start(page));
  await expect(page.getByRole('tab', { name: 'Scope 1' })).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('a Runoff run can be posted, and the next run posts on its own', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/runoff/');
  const name = uniqueName();
  await playAndPost(page, name, start(page));
  await expect(page.locator('#board-list li').first()).toContainText(/\d+ m$/);
  await expect(page.getByRole('tab')).toHaveCount(0);

  // The saved name is shared across games and used for the next run without asking.
  await page.locator('.board-close').click();
  const posted = page.waitForResponse(r => r.url().endsWith('/api/scores') && r.request().method() === 'POST');
  // Restarting is ignored for half a second after dying, which a test can easily beat.
  await expect(async () => {
    await start(page)();
    await expect(page.locator('#board-btn')).toBeHidden({ timeout: 300 });
  }).toPass();
  expect((await posted).status()).toBe(200);
  expect(errors).toEqual([]);
});

test('the name chosen in one game carries over to the other', async ({ page }) => {
  await page.goto('/runoff/');
  const name = uniqueName();
  await playAndPost(page, name, start(page));
  await page.goto('/hexaduck/');
  await page.locator('#board-btn').click();
  await expect(page.locator('#board-who')).toContainText(name);
  await expect(page.locator('#board-form')).toBeHidden();
});

test('a Tailwind flight ends at sunset and can be posted', async ({ page }) => {
  const errors = collectErrors(page);
  // A short day so the test doesn't wait 45 seconds for the sun to set.
  await page.goto('/tailwind/?day=3');
  const name = uniqueName();
  await playAndPost(page, name, start(page));
  await expect(page.locator('#board-list li').first()).toContainText(/\d+ m$/);
  expect(errors).toEqual([]);
});

test('two players in the same Flock pond see each other', async ({ browser }) => {
  // A room of its own, so other tests and bots in the default ponds don't interfere.
  const room = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  const errors = pages.flatMap(collectErrors);
  for (const [i, page] of pages.entries()) {
    await page.goto(`/flock/?room=${room}`);
    await page.locator('#join-name').fill(`Swimmer ${i + 1}`);
    await page.locator('#join button').click();
    await expect(page.locator('#hud-len')).toHaveText('4 ducklings');
  }
  for (const page of pages) await expect(page.locator('#room-count')).toHaveText('2 people swimming', { timeout: 5000 });
  await pages[0].close();
  await expect(pages[1].locator('#room-count')).toHaveText('1 person swimming', { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('a Confluence drop moves when its player flicks, and others in the basin see it', async ({ browser }) => {
  const room = `e2e-${Math.random().toString(36).slice(2, 8)}`;
  const pages = await Promise.all([browser.newPage(), browser.newPage()]);
  const errors = pages.flatMap(collectErrors);
  for (const [i, page] of pages.entries()) {
    await page.goto(`/confluence/?room=${room}`);
    await page.locator('#join-name').fill(`Drop ${i + 1}`);
    await page.locator('#join button').click();
    await expect(page.locator('#hud-len')).toHaveText(/\d+ ml/);
  }
  for (const page of pages) await expect(page.locator('#room-count')).toHaveText('2 people drifting', { timeout: 5000 });
  // Holding an arrow key keeps flicking. (Its size isn't a reliable check: the drop may absorb
  // raindrops faster than flicking costs it.)
  const flicks: string[] = [];
  pages[0].on('websocket', ws => ws.on('framesent', f => { if (String(f.payload).includes('"t":"push"')) flicks.push(String(f.payload)); }));
  await pages[0].reload();
  await pages[0].locator('#join button').click();
  await expect(pages[0].locator('#hud-len')).toHaveText(/\d+ ml/);
  await pages[0].locator('canvas').focus();
  await pages[0].keyboard.down('ArrowLeft');
  await pages[0].waitForTimeout(600);
  await pages[0].keyboard.up('ArrowLeft');
  // Moving left means flicking right, at angle 0.
  await expect.poll(() => flicks.length).toBeGreaterThan(2);
  expect(JSON.parse(flicks[0])).toEqual({ t: 'push', a: 0 });
  expect(errors).toEqual([]);
});

test('a Scope Creep run can be started, fought through and resumed after a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/scope-creep/');
  await page.getByRole('button', { name: 'New run' }).click();
  // Take the first mandate, then whatever it asks for.
  await page.locator('.option').first().click();
  if (await page.locator('.card').count()) {
    await page.locator('.card').first().click();
    const confirm = page.getByRole('button', { name: 'Confirm' });
    if (await confirm.count()) await confirm.click();
  }
  const cont = page.getByRole('button', { name: /^Continue$/ });
  if (await cont.count()) await cont.click();
  await page.locator('.node.open').first().click();
  await expect(page.locator('.hand .card').first()).toBeVisible();

  // Play the first playable card, on the first enemy if it needs one.
  // Cards differ (some cost nothing, powers leave play), so check the move was recorded.
  const moves = () => page.evaluate(() => JSON.parse(localStorage.getItem('scope-creep-run') ?? '{"actions":[]}').actions.length);
  const before = await moves();
  // Play from the keyboard: the fanned cards are rotated and overlap, which makes pointer
  // positions fiddly, and this checks keyboard play works too.
  await page.locator('.hand .card:not(.disabled)').first().focus();
  await page.keyboard.press('Enter');
  if (await page.locator('.foe.targetable').count()) await page.locator('.foe.targetable').first().click();
  await expect.poll(moves).toBe(before + 1);
  await page.getByRole('button', { name: 'End turn' }).click();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('scope-creep-run') ?? 'null'));
  expect(saved.runId).toBeTruthy();
  expect(saved.actions.length).toBeGreaterThan(2);
  await page.reload();
  await page.getByRole('button', { name: /Continue \(Act 1/ }).click();
  await expect(page.locator('.hand .card').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a finished Scope Creep run can be posted after a reload, and the server checks it', async ({ page, request }) => {
  const errors = collectErrors(page);
  // Get a real run id, then play the whole run on its seed ahead of time.
  const { runId } = await (await request.post('/api/runs', { data: { game: 'scopecreep', mode: 0 } })).json();
  const { s, actions } = playRun(seedFrom(runId), plannerPlayer(3));
  expect(['gameover', 'victory']).toContain(s.screen);
  await page.goto('/scope-creep/');
  await page.evaluate(save => localStorage.setItem('scope-creep-run', JSON.stringify(save)), { v: VERSION, runId, seed: seedFrom(runId), actions });
  await page.reload();
  await page.getByRole('button', { name: 'Post your last run' }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill(uniqueName());
  await page.getByRole('button', { name: 'Post score' }).click();
  await expect(page.getByText(/Posted: #\d+ on the leaderboard|Your best stands at/)).toBeVisible();
  // Posting again is refused: each run counts once.
  const again = await request.post('/api/scope-creep/finish', { data: { runId, name: 'Again', actions } });
  expect(again.status()).toBe(409);
  expect(errors).toEqual([]);
});

test('a Scope Creep save from older rules is explained rather than silently lost', async ({ page }) => {
  await page.goto('/scope-creep/');
  await page.evaluate(v => localStorage.setItem('scope-creep-run', JSON.stringify({ v, runId: null, seed: 1, actions: [] })), VERSION - 1);
  await page.reload();
  await expect(page.getByText(/has been updated since your last run/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New run' })).toBeVisible();
});

test('Scope Creep cards can be dragged: onto an enemy to target, or up out of the hand to play', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'mouse dragging is a desktop interaction; touch uses the same pointer code');
  const errors = collectErrors(page);
  await page.goto('/scope-creep/');
  await page.getByRole('button', { name: 'New run' }).click();
  await page.locator('.option').first().click();
  if (await page.locator('.card').count()) {
    await page.locator('.card').first().click();
    const confirm = page.getByRole('button', { name: 'Confirm' });
    if (await confirm.count()) await confirm.click();
  }
  const cont = page.getByRole('button', { name: /^Continue$/ });
  if (await cont.count()) await cont.click();
  await page.locator('.node.open').first().click();
  await expect(page.locator('.hand .card').first()).toBeVisible();

  const moves = () => page.evaluate(() => JSON.parse(localStorage.getItem('scope-creep-run') ?? '{"actions":[]}').actions.length);
  // The fanned cards are rotated and overlap (and grow when hovered), so find a point where this
  // card really is the one on top before pressing it.
  const grab = async (card: import('@playwright/test').Locator) => {
    const label = await card.getAttribute('aria-label');
    await page.mouse.move(5, 5);
    // Let the cards finish dealing into the hand (up to about a second) and settle.
    await page.waitForFunction(() => !document.querySelector('.hand.deal') || document.getAnimations().every(a => a.playState !== 'running' || !(a.effect as KeyframeEffect)?.target?.closest?.('.hand')));
    await page.waitForTimeout(250);
    const b = (await card.boundingBox())!;
    const point = await page.evaluate(({ b, label }) => {
      for (const fy of [0.6, 0.5, 0.7, 0.4, 0.8]) for (const fx of [0.2, 0.3, 0.12, 0.06, 0.4, 0.5, 0.7]) {
        const x = b.x + b.width * fx, y = b.y + b.height * fy;
        if (document.elementFromPoint(x, y)?.closest('.card')?.getAttribute('aria-label') === label) return { x, y };
      }
      return null;
    }, { b, label });
    expect(point).not.toBeNull();
    return point!;
  };
  const drag = async (card: import('@playwright/test').Locator, to: { x: number; y: number }) => {
    const at = await grab(card);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, at.y - 60, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };

  // An attack dragged onto the last enemy damages it.
  const attack = page.locator('.hand .card.attack:not(.disabled)').first();
  if (await attack.count()) {
    const foe = page.locator('.foe:not(.dead)').last();
    const hp = await foe.locator('.hpbar span').textContent();
    const fb = (await foe.boundingBox())!;
    const before = await moves();
    await drag(attack, { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 });
    await expect.poll(moves).toBe(before + 1);
    await expect(page.locator('.foe').last().locator('.hpbar span')).not.toHaveText(hp ?? '');
  }
  // An untargeted skill dragged up out of the hand plays; one dropped back on the hand doesn't.
  const hedges = () => page.locator('.hand .card.skill:not(.disabled)', { hasText: 'Hedge' });
  const skill = hedges().first();
  if (await skill.count()) {
    const before = await moves();
    const sb = (await skill.boundingBox())!;
    await drag(skill, { x: sb.x + sb.width / 2 + 20, y: sb.y + 40 });
    expect(await moves()).toBe(before);
    await drag(hedges().first(), { x: 700, y: 250 });
    await expect.poll(moves).toBe(before + 1);
  }
  expect(errors).toEqual([]);
});

// Regression: from the title screen, with no run loaded, How to play just redrew the title.
test('Scope Creep shows How to play from the title screen, and Back returns there', async ({ page }) => {
  await page.goto('/scope-creep/');
  await page.evaluate(() => localStorage.removeItem('scope-creep-run'));
  await page.reload();
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible();
  await expect(page.getByText('Carbon and Heat')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'New run' })).toBeVisible();
});

// Regression for player feedback: fully blocked enemy hits looked like nothing happened, and
// winning jumped straight to the reward screen. The moments are found by simulating a run first,
// so the test is exact rather than hoping a random fight produces them.
function findMoments() {
  let blocked: any = null, winning: any = null;
  for (let seed = 1; seed < 60 && !(blocked && winning); seed++) {
    const player = plannerPlayer(seed);
    const st: any = newRun(seed);
    const actions: any[] = [];
    while (!['gameover', 'victory'].includes(st.screen) && !(blocked && winning)) {
      const a = player(st);
      const events: any[] = [];
      const before = actions.length;
      applyEngine(st, a, events);
      actions.push(a);
      const save = { v: VERSION, runId: null, seed, actions: actions.slice(0, before) };
      if (!blocked && a.type === 'end' && events.some(e => e.k === 'hurt' && e.lost === 0 && e.blocked > 0)) blocked = save;
      if (!winning && a.type === 'play' && events.some(e => e.k === 'win')) winning = { save, action: a };
    }
  }
  return { blocked, winning };
}

test('Scope Creep shows blocked hits and plays out the end of a fight', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'the same code runs on both; one run is enough');
  const errors = collectErrors(page);
  const { blocked, winning } = findMoments();
  expect(blocked && winning).toBeTruthy();
  const load = async (save: unknown) => {
    await page.goto('/scope-creep/');
    await page.evaluate(sv => localStorage.setItem('scope-creep-run', JSON.stringify(sv)), save);
    await page.reload();
    await page.getByRole('button', { name: /Continue \(/ }).click();
    await expect(page.locator('.hand .card').first()).toBeVisible();
  };

  // An enemy hit that's fully blocked is named and shown as blocked.
  await load(blocked);
  await page.getByRole('button', { name: 'End turn' }).click();
  await expect(page.locator('.banner-line')).toContainText(':');
  await expect(page.locator('.hero .pop', { hasText: 'Blocked' }).first()).toBeVisible();

  // The winning blow plays out over the fight, with a banner, before the rewards appear.
  await load(winning.save);
  await page.evaluate(() => {
    new MutationObserver(() => {
      const f = document.querySelector('.finale');
      if (f && !(window as any).finale) (window as any).finale = { text: f.textContent, overFight: !!document.querySelector('.stage') };
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.locator('.hand .card').nth(winning.action.index).focus();
  await page.keyboard.press('Enter');
  if (await page.locator('.foe.targetable').count()) await page.locator(`.foe.targetable[data-index="${winning.action.target}"]`).click();
  await expect.poll(() => page.evaluate(() => (window as any).finale ?? null)).toMatchObject({ text: expect.stringMatching(/Abated|defeated/), overFight: true });
  await expect(page.getByRole('heading', { name: /Abated|Boss defeated/ })).toBeVisible({ timeout: 5000 });
  expect(errors).toEqual([]);
});

// Player feedback: cards drawn mid-turn just appeared in the hand, easy to miss.
test('Scope Creep flies drawn cards out of the draw pile into the hand', async ({ page }) => {
  test.skip(test.info().project.name === 'mobile', 'the same code runs on both; one run is enough');
  const errors = collectErrors(page);
  // Find, in a simulated run, a card play in combat that draws a card.
  let moment: any = null;
  for (let seed = 1; seed < 40 && !moment; seed++) {
    const player = plannerPlayer(seed);
    const st: any = newRun(seed);
    const actions: any[] = [];
    while (!['gameover', 'victory'].includes(st.screen) && !moment) {
      const a = player(st);
      const events: any[] = [];
      const n = actions.length;
      const drawBefore = st.combat?.draw.length;
      applyEngine(st, a, events);
      actions.push(a);
      if (a.type === 'play' && st.screen === 'combat' && events.some(e => e.k === 'draw') && !events.some(e => e.k === 'shuffle') && drawBefore > 0) {
        moment = { save: { v: VERSION, runId: null, seed, actions: actions.slice(0, n) }, action: a, drawBefore };
      }
    }
  }
  expect(moment).toBeTruthy();
  await page.goto('/scope-creep/');
  await page.evaluate(sv => localStorage.setItem('scope-creep-run', JSON.stringify(sv)), moment.save);
  await page.reload();
  await page.getByRole('button', { name: /Continue \(/ }).click();
  await expect(page.locator('.hand .card').first()).toBeVisible();
  await page.waitForTimeout(700);
  const pile = page.locator('.pile.draw span');
  await expect(pile).toHaveText(String(moment.drawBefore));
  await page.evaluate(() => {
    new MutationObserver(() => { if (document.querySelector('.card.flying')) (window as any).flew = true; })
      .observe(document.body, { childList: true, subtree: true });
  });
  await page.locator('.hand .card').nth(moment.action.index).focus();
  await page.keyboard.press('Enter');
  if (moment.action.target !== undefined && await page.locator('.foe.targetable').count()) {
    await page.locator(`.foe.targetable[data-index="${moment.action.target}"]`).click();
  }
  await expect.poll(() => page.evaluate(() => !!(window as any).flew)).toBe(true);
  // It lands: nothing is left flying or hidden, and the pile has counted down.
  await expect(page.locator('.card.flying')).toHaveCount(0);
  await expect(page.locator('.hand .card.incoming')).toHaveCount(0);
  await expect(pile).not.toHaveText(String(moment.drawBefore));
  expect(errors).toEqual([]);
});

// ---------- Audit, Please ----------
const auditMoves = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('audit-run') ?? '{"actions":[]}').actions.length);

test('an Audit, Please shift: call an applicant, inspect a discrepancy, stamp, and resume after a reload', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/audit/');
  await page.getByRole('button', { name: 'New run' }).click();
  await page.getByRole('button', { name: 'Report for work' }).click();
  await expect(page.getByText('New in the rulebook today')).toBeVisible();
  await page.getByRole('button', { name: 'Open the window' }).click();
  await page.getByRole('button', { name: /Call next applicant/ }).click();
  await expect(page.locator('.doc[data-doc="form"]')).toBeVisible();
  await expect(page.locator('.bar .clock')).toHaveText(/09:18/);

  // Compare the form's company with the rule on signatures: no discrepancy, and 5 minutes gone.
  await page.getByRole('button', { name: /Inspect/ }).click();
  await page.getByRole('button', { name: 'Inspect Claim form: Company' }).click();
  await page.getByRole('button', { name: 'Inspect Rule: Signatures' }).click();
  await expect(page.getByText(/No discrepancy there|Discrepancy:/)).toBeVisible();
  await expect(page.locator('.bar .clock')).toHaveText(/09:23/);

  // Then a pair the checker knows to be wrong, if this claim has one.
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('audit-run')!));
  const s = Audit.replay(save.seed, save.actions);
  const flaw = s.case.results[0];
  if (flaw) {
    const [a, b] = flaw.pairs[0];
    await page.locator(`[data-ref="${a}"]`).click();
    await page.locator(`[data-ref="${b}"]`).click();
    await expect(page.getByText(/^Discrepancy:/)).toBeVisible();
    await expect(page.getByText('Noted: 1 discrepancy.')).toBeVisible();
  }

  // Stamp the right way, with the keyboard.
  const before = await auditMoves(page);
  await page.keyboard.press(flaw ? 'r' : 'a');
  await expect.poll(() => auditMoves(page)).toBe(before + 1);
  await expect(page.getByText(/^(Approved|Rejected)\.$/)).toBeVisible();
  await expect(page.locator('.doc')).toHaveCount(0);

  await page.reload();
  await page.getByRole('button', { name: 'Continue (day 1)' }).click();
  await expect(page.getByRole('button', { name: /Call next applicant/ })).toBeVisible();
  await expect(page.locator('.bar .clock')).toHaveText(/09:(27|32)/);
  expect(errors).toEqual([]);
});

test('an Audit, Please evening: pay the rent, feed the ducklings, and wake up to the next memo', async ({ page }) => {
  const errors = collectErrors(page);
  // A save standing at the end of day 1, played by the test clerk.
  const seed = 11;
  const s = Audit.newRun(seed), actions: object[] = [];
  const p = clerk(seed);
  while (s.screen !== 'night') { const a = p(s); Audit.apply(s, a); actions.push(a); }
  await page.goto('/audit/');
  await page.evaluate(save => localStorage.setItem('audit-run', JSON.stringify(save)), { v: Audit.VERSION, runId: null, seed, actions });
  await page.reload();
  await page.getByRole('button', { name: 'Continue (day 1)' }).click();
  await expect(page.getByRole('heading', { name: 'End of day 1' })).toBeVisible();
  await expect(page.locator('.duckling')).toHaveCount(3);
  // Skipping Pip's dinner saves £5.
  const left = async () => Number((await page.locator('.nest .savings b').textContent())!.replace(/[^\d-]/g, ''));
  const full = await left();
  await page.getByLabel(/Food for Pip/).uncheck();
  expect(await left()).toBe(full + Audit.NEST.food);
  await page.getByRole('button', { name: 'Go to sleep' }).click();
  // Day 2 has a night event afterwards, not day 1: straight to the next memo.
  await expect(page.getByText('MEMORANDUM')).toBeVisible();
  await expect(page.locator('.bar .when')).toContainText('Day 2');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('audit-run')!));
  expect(Audit.replay(seed, saved.actions).nest[0].hunger).toBe(1);
  expect(errors).toEqual([]);
});

test('a finished Audit, Please run can be posted, and the server checks it', async ({ page, request }) => {
  const errors = collectErrors(page);
  const { runId } = await (await request.post('/api/runs', { data: { game: 'audit', mode: 0 } })).json();
  const { s, actions } = playAudit(Audit.seedFrom(runId), clerk(2));
  expect(s.screen).toBe('end');
  await page.goto('/audit/');
  await page.evaluate(save => localStorage.setItem('audit-run', JSON.stringify(save)), { v: Audit.VERSION, runId, seed: Audit.seedFrom(runId), actions });
  await page.reload();
  await page.getByRole('button', { name: 'Post your last run' }).click();
  await expect(page.getByRole('heading', { name: 'The Exposé' })).toBeVisible();
  await expect(page.locator('.score .total')).toContainText(String(Audit.score(s).total));
  await page.getByRole('textbox', { name: 'Your name' }).fill(uniqueName());
  await page.getByRole('button', { name: 'Post score' }).click();
  await expect(page.getByText(/Posted: #\d+ on the leaderboard|Your best stands at/)).toBeVisible();
  const again = await request.post('/api/audit/finish', { data: { runId, name: 'Again', actions } });
  expect(again.status()).toBe(409);
  expect(errors).toEqual([]);
});

test('Audit, Please shows How to play from the title screen, and Back returns there', async ({ page }) => {
  await page.goto('/audit/');
  await page.getByRole('button', { name: 'How to play' }).click();
  await expect(page.getByRole('heading', { name: 'How to play' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('button', { name: 'New run' })).toBeVisible();
});
