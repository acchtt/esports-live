import { expect, test, type Route } from '@playwright/test';

const FALLBACK_API = 'https://mobile-demo-esports-live-api.acchtt.workers.dev';
const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue-reliable', name: 'Reliable Blue', code: 'RBL' };
const red = { id: 'red-reliable', name: 'Reliable Red', code: 'RRD' };
const scheduledSeries = {
  id: 'series-api-failover',
  esport: 'lol',
  competition: { id: 'reliability-league', name: 'Reliability League', stage: 'Week 1' },
  teams: [blue, red],
  bestOf: 3,
  state: 'scheduled',
  scheduledStart: new Date(Date.now() + 60 * 60_000).toISOString(),
  games: [{ id: 'game-api-failover-1', number: 1, state: 'unstarted' }]
};

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

test('V3 keeps the catalogue usable when the primary API has a network failure', async ({ page }) => {
  let primaryScheduleRequests = 0;
  let fallbackScheduleRequests = 0;
  const fallbackOrigin = new URL(FALLBACK_API).origin;

  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== fallbackOrigin) {
      primaryScheduleRequests += 1;
      await route.abort('failed');
      return;
    }

    fallbackScheduleRequests += 1;
    const history = url.searchParams.get('states') === 'completed';
    await json(route, {
      esport: 'lol',
      events: history ? [] : [{ series: scheduledSeries, provider, observedAt: new Date().toISOString() }]
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'commit' });

  await expect(page.locator('[data-series-id="series-api-failover"]')).toBeVisible();
  await expect(page.locator('#catalogue-meta')).not.toContainText('Failed to fetch');
  await expect.poll(() => fallbackScheduleRequests).toBeGreaterThanOrEqual(2);
  expect(primaryScheduleRequests).toBeGreaterThanOrEqual(1);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.v3ApiEndpoint)).toBe('fallback');
});

test('V3 uses recent last-good schedules when both network APIs are unavailable', async ({ page }) => {
  let scheduleOnline = true;

  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', async route => {
    if (!scheduleOnline) {
      await route.abort('failed');
      return;
    }
    const url = new URL(route.request().url());
    const history = url.searchParams.get('states') === 'completed';
    await json(route, {
      esport: 'lol',
      events: history ? [] : [{ series: scheduledSeries, provider, observedAt: new Date().toISOString() }]
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.locator('[data-series-id="series-api-failover"]')).toBeVisible();

  await expect.poll(() => page.evaluate(async () => {
    const cache = await window.caches.open('arena-v3-api-last-good-v1');
    return (await cache.keys()).length;
  })).toBeGreaterThanOrEqual(2);

  scheduleOnline = false;
  await page.locator('#refresh-data').click();

  await expect(page.locator('[data-series-id="series-api-failover"]')).toBeVisible();
  await expect(page.locator('#catalogue-meta')).not.toContainText('Failed to fetch');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.v3DataSource)).toBe('cache');
  await expect(page.locator('.connection-pill')).toHaveAttribute('aria-label', 'Cached data; reconnecting');
});
