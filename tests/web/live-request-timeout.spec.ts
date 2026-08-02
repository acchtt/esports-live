import { expect, test, type Page, type Route } from '@playwright/test';

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installShellFixtures(page: Page): Promise<void> {
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
}

test('gives cold live snapshots a longer deadline without relaxing other API calls', async ({ page }) => {
  await installShellFixtures(page);
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

test('accepts a cold live response that arrives after the former ten-second deadline', async ({ page }) => {
  test.setTimeout(20_000);
  await installShellFixtures(page);
  await page.route('**/v1/lol/games/cold-game/live', async route => {
    await new Promise(resolve => setTimeout(resolve, 10_500));
    await fulfillJson(route, { ready: true });
  });
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { apiJson } = await import('/src/api-client.ts');
    return apiJson<{ ready: boolean }>('', '/v1/lol/games/cold-game/live');
  });

  expect(result).toEqual({ ready: true });
});
