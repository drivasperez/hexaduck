import { defineConfig, devices } from '@playwright/test';

const PORT = 8799;
// A separate local D1, wiped at the start of each run, so e2e runs don't touch the `npm run dev` database.
const STATE = '.wrangler/e2e';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Set PW_CHANNEL=chrome to use an installed Chrome instead of `npx playwright install chromium`.
    channel: process.env.PW_CHANNEL,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL } },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL } },
  ],
  webServer: {
    command: `rm -rf ${STATE} && wrangler d1 migrations apply hexaduck --local --persist-to ${STATE} && wrangler dev --port ${PORT} --persist-to ${STATE} --show-interactive-dev-session=false`,
    url: `http://localhost:${PORT}/api/scores?game=hexaduck&mode=0`,
    reuseExistingServer: !process.env.CI,
    env: { CI: '1' },
  },
});
