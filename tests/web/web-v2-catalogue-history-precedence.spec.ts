import { expect, test, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const left = { id: 'wbg', name: 'WeiboGaming', code: 'WBG' };
const right = { id: 'lng', name: 'Suzhou LNG Esports', code: 'LNG' };

const staleLiveSeries = {
  id: 'lpl-finished-but-stale-live',
  esport: 'lol',
  competition: { id: '98767991314006698', name: 'LPL', stage: 'Regular Season' },
  teams: [left, right],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 45 * 60 * 1_000).toISOString(),
  games: [
    { id: 'lpl-finished-game-1', number: 1, state: 'completed' },
    { id: 'lpl-finished-game-2', number: 2, state: 'completed' },
    { id: 'lpl-finished-game-3', number: 3, state: 'live' }
  ]
};

const completedSeries = {
  ...staleLiveSeries,
  state: 'completed',
  games: staleLiveSeries.games.map(game => ({ ...game, state: 'completed' }))
};

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

test('web v2 keeps a completed history copy out of Live when matches still publishes stale LPL live state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/health', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    const history = route.request().url().includes('states=completed');
    return json(route, {
      esport: 'lol',
      events: [{
        series: history ? completedSeries : staleLiveSeries,
        provider,
        observedAt: new Date().toISOString()
      }]
    });
  });

  await page.goto('/v2/');
  const card = page.locator('[data-series-id="lpl-finished-but-stale-live"]');

  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(card).toBeHidden();

  await page.getByRole('button', { name: 'Ended', exact: true }).click();
  await expect(card).toBeVisible();
  await expect(card.locator('.match-status')).toHaveText('FINAL');
  await expect(card).toHaveAttribute('data-source-view', 'history');
});
