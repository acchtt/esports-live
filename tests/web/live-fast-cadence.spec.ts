import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };
const game = { id: 'game-fast-cadence', number: 1, state: 'live' as const };
const series = {
  id: 'series-fast-cadence',
  esport: 'lol',
  competition: { id: 'test-league', name: 'Test League', stage: 'Week 1' },
  teams: [blue, red] as const,
  bestOf: 3,
  state: 'live' as const,
  scheduledStart: new Date(Date.now() - 30 * 60 * 1_000).toISOString(),
  games: [game]
};

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(page: Page): Promise<() => number> {
  let liveRequests = 0;

  await page.route('https://www.riotgames.com/darkroom/original/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
  }));
  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => fulfillJson(route, {
    esport: 'lol',
    events: [{ series, provider, observedAt: new Date().toISOString() }]
  }));
  await page.route('**/v1/lol/series/**/context**', route => fulfillJson(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: series.id,
    provider,
    observedAt: new Date().toISOString(),
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [{ team: blue, wins: 0 }, { team: red, wins: 0 }],
      games: [{ ...game, blueTeam: blue, redTeam: red, winner: null, durationSeconds: null }]
    },
    complete: true,
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => {
    liveRequests += 1;
    const timestamp = new Date(Date.now() + liveRequests * 1_000).toISOString();
    return fulfillJson(route, {
      schemaVersion: '1.0',
      esport: 'lol',
      provider,
      series,
      game,
      stats: {
        gameClockSeconds: 1_200 + liveRequests,
        patch: '26.15.1',
        blue: {
          id: blue.id,
          name: blue.name,
          side: 'blue',
          gold: 30_000 + liveRequests,
          kills: 7,
          objectives: { towers: 4, inhibitors: 0, dragons: [], barons: 0, heralds: 1, grubs: 3 },
          players: []
        },
        red: {
          id: red.id,
          name: red.name,
          side: 'red',
          gold: 29_000,
          kills: 5,
          objectives: { towers: 2, inhibitors: 0, dragons: [], barons: 0, heralds: 1, grubs: 3 },
          players: []
        }
      },
      quality: {
        freshness: 'fresh',
        sourceTimestamp: timestamp,
        observedAt: timestamp,
        ageSeconds: 0,
        complete: true,
        advancing: true,
        safeForLiveAnalysis: true,
        reasons: []
      }
    });
  });

  return () => liveRequests;
}

test('polls the selected live game at sub-second cadence', async ({ page }) => {
  const liveRequests = await installFixtures(page);
  await page.goto('/');
  await page.locator('[data-series-id="series-fast-cadence"]').click();
  await expect.poll(liveRequests, { timeout: 3_500, intervals: [100] }).toBeGreaterThanOrEqual(3);
});
