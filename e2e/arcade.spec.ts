import { expect, type Page, test } from '@playwright/test';
import { seedFrom, VERSION } from '../public/scope-creep/engine.js';
import { plannerPlayer, playRun } from '../test/scope-creep/players.js';

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
  for (const [name, href] of [['Hexaduck', '/hexaduck/'], ['Runoff', '/runoff/'], ['Tailwind', '/tailwind/'], ['Flock', '/flock/'], ['Confluence', '/confluence/'], ['Scope Creep', '/scope-creep/']]) {
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
