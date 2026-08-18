import { expect, test, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'prefetch-blue', name: 'Prefetch Blue', code: 'PBL' };
const red = { id: 'prefetch-red', name: 'Prefetch Red', code: 'PRD' };

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

function event(id: string, state: 'live' | 'scheduled', hoursFromNow: number) {
  return {
    series: {
      id,
      esport: 'lol',
      competition: { id: 'prefetch-league', name: 'Prefetch League' },
      teams: [blue, red],
      bestOf: 3,
      state,
      scheduledStart: new Date(Date.now() + hoursFromNow * 60 * 60_000).toISOString(),
      games: [{
        id: `${id}-game-1`,
        number: 1,
        state: state === 'live' ? 'live' : 'unstarted'
      }]
    },
    provider,
    observedAt: new Date().toISOString()
  };
}

test('V3 prefetches live and nearby match context without opening a card', async ({ page }) => {
  const prefetched = new Set<string>();
  const live = event('series-prefetch-live', 'live', 1);
  const upcoming = event('series-prefetch-upcoming', 'scheduled', 2);

  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol'],
    persistence: 'd1'
  }));

  await page.route('**/v1/lol/schedule**', async route => {
    const url = new URL(route.request().url());
    const history = url.searchParams.get('states') === 'completed';
    await json(route, {
      esport: 'lol',
      events: history ? [] : [live, upcoming]
    });
  });

  await page.route('**/v1/lol/series/*/context**', async route => {
    const url = new URL(route.request().url());
    const match = /\/series\/([^/]+)\/context$/.exec(url.pathname);
    const seriesId = decodeURIComponent(match?.[1] ?? '');
    prefetched.add(seriesId);
    await json(route, {
      schemaVersion: '1.0',
      esport: 'lol',
      seriesId,
      provider,
      observedAt: new Date().toISOString(),
      rosters: [],
      standings: [],
      complete: false,
      reasons: []
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(page.locator('[data-series-id="series-prefetch-live"]')).toBeVisible();
  await expect.poll(() => [...prefetched].sort()).toEqual([
    'series-prefetch-live',
    'series-prefetch-upcoming'
  ]);
  await expect(page).toHaveURL(/\/$/);
});
