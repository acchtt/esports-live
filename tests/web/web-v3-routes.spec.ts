import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue-route', name: 'Route Blue', code: 'RBL', imageUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22/%3E' };
const red = { id: 'red-route', name: 'Route Red', code: 'RRD', imageUrl: blue.imageUrl };
const series = {
  id: 'series-routed',
  esport: 'lol',
  competition: { id: 'route-league', name: 'Route League', stage: 'Regular Season' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 30 * 60_000).toISOString(),
  games: [
    { id: 'game-routed-1', number: 1, state: 'completed' },
    { id: 'game-routed-2', number: 2, state: 'live' }
  ]
};

function snapshot(gameId: string) {
  const game = series.games.find(item => item.id === gameId) ?? series.games[1];
  const completed = game.id === 'game-routed-1';
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: {
      ...series,
      state: completed ? 'live' : series.state,
      games: series.games
    },
    game,
    stats: {
      gameClockSeconds: completed ? 1_920 : 1_245,
      patch: '26.15.1',
      blue: {
        id: blue.id,
        name: blue.name,
        side: 'blue',
        gold: completed ? 47_000 : 31_200,
        kills: completed ? 12 : 7,
        objectives: { towers: 5, inhibitors: 0, dragons: ['cloud'], barons: 0, heralds: 1, grubs: null },
        players: []
      },
      red: {
        id: red.id,
        name: red.name,
        side: 'red',
        gold: completed ? 44_000 : 30_600,
        kills: completed ? 9 : 6,
        objectives: { towers: 3, inhibitors: 0, dragons: [], barons: 0, heralds: 0, grubs: null },
        players: []
      }
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: now,
      observedAt: now,
      ageSeconds: 1,
      complete: true,
      advancing: !completed,
      safeForLiveAnalysis: !completed,
      reasons: []
    }
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

async function installFixtures(page: Page): Promise<void> {
  await page.route('https://ddragon.leagueoflegends.com/**', route => route.abort());
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => json(route, {
    esport: 'lol',
    events: route.request().url().includes('states=completed')
      ? []
      : [{ series, provider, observedAt: new Date().toISOString() }]
  }));
  await page.route('**/v1/lol/series/**/context**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: series.id,
    provider,
    observedAt: new Date().toISOString(),
    rosters: [],
    standings: [],
    history: { bestOf: 3, winsRequired: 2, drawPossible: false, score: [], games: [] },
    complete: false,
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => {
    const match = route.request().url().match(/games\/([^/?]+)\/live/);
    return json(route, snapshot(decodeURIComponent(match?.[1] ?? 'game-routed-2')));
  });
}

test('V3 navigates from the catalogue to a shareable match route and back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  await expect(page.locator('[data-series-id="series-routed"]')).toBeVisible();
  await page.locator('[data-series-id="series-routed"]').click();

  await expect(page).toHaveURL(/\/match\/series-routed\/game-routed-2(?:\?|$)/);
  await expect(page.locator('#detail-title')).toHaveText('Route Blue vs Route Red');
  await expect(page.locator('.build-pill')).toContainText('V3 · ROUTED');
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');

  await page.locator('#game-tabs [data-game-id="game-routed-1"]').click();
  await expect(page).toHaveURL(/\/match\/series-routed\/game-routed-1(?:\?|$)/);
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');

  await page.locator('.back-button').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('[data-series-id="series-routed"]')).toBeVisible();
});

test('V3 opens a deep match URL directly, including the /v3 compatibility base', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);

  await page.goto('/match/series-routed/game-routed-1');
  await expect(page.locator('#detail-title')).toHaveText('Route Blue vs Route Red');
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');
  await expect(page).toHaveURL(/\/match\/series-routed\/game-routed-1$/);

  await page.goto('/v3/match/series-routed/game-routed-2');
  await expect(page.locator('#detail-title')).toHaveText('Route Blue vs Route Red');
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page).toHaveURL(/\/v3\/match\/series-routed\/game-routed-2$/);
});
