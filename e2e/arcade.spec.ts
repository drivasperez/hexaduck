import { expect, type Page, test } from '@playwright/test';

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
  for (const [name, href] of [['Hexaduck', '/hexaduck/'], ['Runoff', '/runoff/'], ['Tailwind', '/tailwind/'], ['Flock', '/flock/'], ['Confluence', '/confluence/']]) {
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
  // Flicking costs water, so holding the arrow keys for a moment shrinks the drop.
  const before = parseInt(await pages[0].locator('#hud-len').textContent() ?? '0', 10);
  await pages[0].locator('canvas').focus();
  await pages[0].keyboard.down('ArrowLeft');
  await pages[0].waitForTimeout(600);
  await pages[0].keyboard.up('ArrowLeft');
  await expect.poll(async () => parseInt(await pages[0].locator('#hud-len').textContent() ?? '0', 10)).toBeLessThan(before);
  expect(errors).toEqual([]);
});
