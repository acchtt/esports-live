import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blueLogo = 'https://logos.example.test/startup-blue.svg';
const redLogo = 'https://logos.example.test/startup-red.svg';
const blue = {
  id: 'startup-blue',
  name: 'Startup Blue',
  code: 'STB',
  imageUrl: blueLogo
};
const red = {
  id: 'startup-red',
  name: 'Startup Red',
  code: 'STR',
  imageUrl: redLogo
};

function activeEvent() {
  return {
    series: {
      id: 'startup-series',
      esport: 'lol',
      competition: { id: 'lck', name: 'LCK', stage: 'Regular Season' },
      teams: [blue, red],
      bestOf: 3,
      state: 'scheduled',
      scheduledStart: new Date(Date.now() + 30 * 60_000).toISOString(),
      games: [{ id: 'startup-game-1', number: 1, state: 'unstarted' }]
    },
    provider,
    observedAt: new Date().toISOString()
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installLogoRoutes(page: Page): Promise<void> {
  await page.route('https://logos.example.test/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    headers: { 'cache-control': 'public, max-age=3600' },
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="22" fill="white"/></svg>'
  }));
}

test('V3 paints cached matches and team logos before a delayed startup schedule response', async ({ page }) => {
  let holdSchedules = false;
  let heldRequests = 0;
  const releases: Array<() => void> = [];

  await page.setViewportSize({ width: 390, height: 844 });
  await installLogoRoutes(page);
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', async route => {
    if (holdSchedules) {
      heldRequests += 1;
      await new Promise<void>(resolve => releases.push(resolve));
    }
    const url = new URL(route.request().url());
    const history = url.searchParams.get('states') === 'completed';
    await json(route, {
      esport: 'lol',
      events: history ? [] : [activeEvent()]
    });
  });

  await page.goto('/');
  const card = page.locator('[data-series-id="startup-series"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.match-team-logo')).toHaveCount(2);
  await expect(card.locator('.match-team-logo').first()).toBeVisible();
  await expect(card.locator('.match-team-logo').last()).toBeVisible();

  // Make the cache old enough that the former 15-minute policy would have
  // discarded it, while keeping it inside the new bootstrap window.
  await page.evaluate(() => {
    for (const view of ['matches', 'history']) {
      const key = `esports-live:v2:schedule:${view}`;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const value = JSON.parse(raw) as { savedAt?: number };
      value.savedAt = Date.now() - 60 * 60_000;
      window.localStorage.setItem(key, JSON.stringify(value));
    }
  });

  holdSchedules = true;
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect.poll(() => heldRequests).toBeGreaterThanOrEqual(2);

  // Fresh active/history requests are still blocked here. The visible card and
  // logos therefore have to come from the synchronous startup cache path.
  const cachedCard = page.locator('[data-series-id="startup-series"]');
  await expect(cachedCard).toBeVisible();
  const cachedLogos = cachedCard.locator('.match-team-logo');
  await expect(cachedLogos).toHaveCount(2);
  await expect(cachedLogos.first()).toBeVisible();
  await expect(cachedLogos.last()).toBeVisible();
  await expect(cachedLogos.first()).toHaveAttribute('src', blueLogo);
  await expect(cachedLogos.last()).toHaveAttribute('src', redLogo);

  releases.splice(0).forEach(release => release());
  holdSchedules = false;
  await expect(cachedCard).toBeVisible();
});
