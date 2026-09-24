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
  for (const [name, href] of [['Hexaduck', '/hexaduck/'], ['Runoff', '/runoff/']]) {
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
