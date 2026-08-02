import { expect, test, type Route } from '@playwright/test';

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

test('gives cold live snapshots a longer deadline without relaxing other API calls', async ({ page }) => {
  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => fulfillJson(route, {
    esport: 'lol',
    events: []
  }));
  await page.goto('/');

  const timeouts = await page.evaluate(async () => {
    const { apiTimeoutForPath } = await import('/src/api-client.ts');
    return {
      live: apiTimeoutForPath('/v1/lol/games/game-1/live?after=2026-08-02T15%3A00%3A00.000Z'),
      schedule: apiTimeoutForPath('/v1/lol/schedule?limit=80'),
      context: apiTimeoutForPath('/v1/lol/series/series-1/context')
    };
  });

  expect(timeouts).toEqual({
    live: 25_000,
    schedule: 10_000,
    context: 10_000
  });
});
