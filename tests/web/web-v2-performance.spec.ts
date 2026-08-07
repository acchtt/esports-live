import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Fast Blue', code: 'FB' };
const red = { id: 'red', name: 'Fast Red', code: 'FR' };
const liveSeries = {
  id: 'series-fast-live',
  esport: 'lol',
  competition: { id: 'fast-league', name: 'Fast League', stage: 'Week 1' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 30 * 60 * 1_000).toISOString(),
  games: [{ id: 'game-fast-live-1', number: 1, state: 'live' }]
};
const endedSeries = {
  id: 'series-fast-ended',
  esport: 'lol',
  competition: { id: 'fast-history', name: 'Fast History', stage: 'Final' },
  teams: [blue, red],
  bestOf: 3,
  state: 'completed',
  scheduledStart: new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString(),
  games: [{ id: 'game-fast-ended-1', number: 1, state: 'completed' }]
};

function liveSnapshot() {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: liveSeries,
    game: liveSeries.games[0],
    stats: {
      gameClockSeconds: 1_337,
      patch: '26.15.1',
      blue: {
        id: blue.id,
        name: blue.name,
        side: 'blue',
        gold: 35_000,
        kills: 8,
        objectives: { towers: 3, inhibitors: 0, dragons: ['cloud'], barons: 0, heralds: 1, grubs: 3 },
        players: []
      },
      red: {
        id: red.id,
        name: red.name,
        side: 'red',
        gold: 33_000,
        kills: 5,
        objectives: { towers: 2, inhibitors: 0, dragons: [], barons: 0, heralds: 0, grubs: 0 },
        players: []
      }
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: now,
      observedAt: now,
      ageSeconds: 1,
      complete: true,
      advancing: true,
      safeForLiveAnalysis: true,
      reasons: []
    }
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

test('V2 renders data without waiting for health and reuses recent caches during slow refreshes', async ({ page }) => {
  let releaseHealth = (): void => {};
  let releaseSchedules = (): void => {};
  let releaseSnapshot = (): void => {};
  let holdHealth = true;
  let holdSchedules = false;
  let holdSnapshot = false;
  const healthGate = new Promise<void>(resolve => { releaseHealth = resolve; });
  let scheduleGate = new Promise<void>(resolve => { releaseSchedules = resolve; });
  let snapshotGate = new Promise<void>(resolve => { releaseSnapshot = resolve; });

  await page.route('**/health', async route => {
    if (holdHealth) await healthGate;
    return json(route, {
      ok: true,
      service: 'esports-live-api',
      schemaVersion: '1.0',
      adapters: ['lol']
    });
  });
  await page.route('**/v1/lol/schedule**', async route => {
    if (holdSchedules) await scheduleGate;
    const history = route.request().url().includes('states=completed');
    return json(route, {
      esport: 'lol',
      events: [{
        series: history ? endedSeries : liveSeries,
        provider,
        observedAt: new Date().toISOString()
      }]
    });
  });
  await page.route('**/v1/lol/games/**/live**', async route => {
    if (holdSnapshot) await snapshotGate;
    return json(route, liveSnapshot());
  });

  await page.goto('/v2/');

  // Health is still blocked, but schedules must already be visible.
  await expect(page.locator('#catalogue-meta')).toContainText('2 matches', { timeout: 1_500 });
  await expect(page.locator('[data-series-id="series-fast-live"]')).toBeVisible();
  await expect(page.locator('[data-series-id="series-fast-ended"]')).toBeVisible();
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-status', 'connecting');

  releaseHealth();
  holdHealth = false;
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-status', 'online');

  // Prime the snapshot cache with one successful live board.
  await page.locator('[data-series-id="series-fast-live"]').click();
  await expect(page.locator('#game-clock')).toHaveText('22:17');
  await expect(page.locator('#blue-kills')).toHaveText('8');

  // Reload while both schedule and snapshot refreshes are intentionally stalled.
  holdSchedules = true;
  holdSnapshot = true;
  scheduleGate = new Promise<void>(resolve => { releaseSchedules = resolve; });
  snapshotGate = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  await page.reload();

  await expect(page.locator('#catalogue-meta')).toContainText('2 matches', { timeout: 1_000 });
  await expect(page.locator('[data-series-id="series-fast-live"]')).toBeVisible();
  await page.locator('[data-series-id="series-fast-live"]').click();
  await expect(page.locator('#game-clock')).toHaveText('22:17', { timeout: 1_000 });
  await expect(page.locator('#blue-kills')).toHaveText('8');

  releaseSchedules();
  releaseSnapshot();
});
