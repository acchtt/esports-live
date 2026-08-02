import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const observedAt = new Date().toISOString();

const liveSeries = {
  id: 'series-live-pending',
  esport: 'lol',
  competition: { id: 'league-live', name: 'Live League', stage: 'Week 1' },
  teams: [
    { id: 'live-blue', name: 'Live Blue', code: 'LBL' },
    { id: 'live-red', name: 'Live Red', code: 'LRD' }
  ],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 30 * 60 * 1_000).toISOString(),
  games: []
};

const upcomingSeries = {
  id: 'series-upcoming-fallback',
  esport: 'lol',
  competition: { id: 'league-upcoming', name: 'Upcoming League', stage: 'Week 2' },
  teams: [
    { id: 'upcoming-blue', name: 'Upcoming Blue', code: 'UBL' },
    { id: 'upcoming-red', name: 'Upcoming Red', code: 'URD' }
  ],
  bestOf: 3,
  state: 'scheduled',
  scheduledStart: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  games: []
};

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(page: Page): Promise<() => number> {
  let scheduleRequests = 0;

  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => {
    scheduleRequests += 1;
    const series = scheduleRequests === 1
      ? [liveSeries, upcomingSeries]
      : [upcomingSeries];
    return fulfillJson(route, {
      esport: 'lol',
      events: series.map(item => ({ series: item, provider, observedAt }))
    });
  });

  await page.route('**/v1/lol/series/**/context**', route => {
    const match = new URL(route.request().url()).pathname.match(/\/series\/([^/]+)\/context$/);
    return fulfillJson(route, {
      schemaVersion: '1.0',
      esport: 'lol',
      seriesId: decodeURIComponent(match?.[1] ?? ''),
      provider,
      observedAt,
      rosters: [],
      standings: [],
      history: null,
      complete: false,
      reasons: ['provider_partial']
    });
  });

  return () => scheduleRequests;
}

test('keeps a valid active selection when schedule entries change', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  const scheduleRequests = await installFixtures(page);
  await page.goto('/');

  await expect(page.locator('#selected-series')).toHaveText('Live Blue vs Live Red');
  await expect(page.locator('[data-series-id="series-live-pending"]')).toHaveClass(/selected/);
  await expect(page.locator('#schedule-list .match-card.selected')).toHaveCount(1);
  await expect(page.getByText('Game feed pending')).toBeVisible();

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(scheduleRequests).toBeGreaterThanOrEqual(2);

  await expect(page.locator('[data-series-id="series-live-pending"]')).toHaveCount(0);
  await expect(page.locator('#selected-series')).toHaveText('Upcoming Blue vs Upcoming Red');
  await expect(page.locator('[data-series-id="series-upcoming-fallback"]')).toHaveClass(/selected/);
  await expect(page.locator('#schedule-list .match-card.selected')).toHaveCount(1);
  await expect(page.getByText('Match scheduled')).toBeVisible();
  expect(errors).toEqual([]);
});
