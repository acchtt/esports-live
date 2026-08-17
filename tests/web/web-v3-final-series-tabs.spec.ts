import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = {
  id: 'final-tabs-blue',
  name: 'Final Tabs Blue',
  code: 'FTB',
  imageUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22/%3E'
};
const red = { ...blue, id: 'final-tabs-red', name: 'Final Tabs Red', code: 'FTR' };

function series(state: 'live' | 'completed') {
  return {
    id: `series-final-tabs-${state}`,
    esport: 'lol',
    competition: { id: 'lec', name: 'LEC', stage: 'Regular Season' },
    teams: [blue, red],
    bestOf: 3,
    state,
    scheduledStart: new Date(Date.now() - 60 * 60_000).toISOString(),
    score: state === 'completed'
      ? [{ team: blue, wins: 2 }, { team: red, wins: 0 }]
      : [{ team: blue, wins: 1 }, { team: red, wins: 1 }],
    games: [
      { id: `game-final-tabs-${state}-1`, number: 1, state: 'completed' },
      { id: `game-final-tabs-${state}-2`, number: 2, state: 'completed' },
      { id: `game-final-tabs-${state}-3`, number: 3, state: 'unstarted' }
    ]
  };
}

function snapshot(seriesState: 'live' | 'completed') {
  const value = series(seriesState);
  const game = value.games[1]!;
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: value,
    game,
    stats: {
      gameClockSeconds: 1_872,
      patch: '26.15.1',
      blue: {
        id: blue.id,
        name: blue.name,
        side: 'blue',
        gold: 51_000,
        kills: 14,
        objectives: { towers: 8, inhibitors: 1, dragons: ['cloud', 'infernal'], barons: 1, heralds: 1, grubs: null },
        players: []
      },
      red: {
        id: red.id,
        name: red.name,
        side: 'red',
        gold: 43_000,
        kills: 7,
        objectives: { towers: 3, inhibitors: 0, dragons: ['ocean'], barons: 0, heralds: 0, grubs: null },
        players: []
      }
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: now,
      observedAt: now,
      ageSeconds: 1,
      complete: true,
      advancing: false,
      safeForLiveAnalysis: false,
      reasons: []
    }
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

async function installFixtures(page: Page, seriesState: 'live' | 'completed'): Promise<void> {
  const eventSeries = series(seriesState);

  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => json(route, {
    esport: 'lol',
    events: [{ series: eventSeries, provider, observedAt: new Date().toISOString() }]
  }));
  await page.route('**/v1/lol/series/**/context**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: eventSeries.id,
    provider,
    observedAt: new Date().toISOString(),
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: eventSeries.score,
      games: eventSeries.games.slice(0, 2)
    },
    complete: seriesState === 'completed',
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => json(route, snapshot(seriesState)));
}

test('V3 hides unused placeholder games after a series is final', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, 'completed');
  await page.goto('/match/series-final-tabs-completed/game-final-tabs-completed-2');

  await expect(page.locator('#game-label')).toHaveText('Game 2 · Final');
  await expect(page.locator('#game-tabs [data-game-id="game-final-tabs-completed-1"]')).toBeVisible();
  await expect(page.locator('#game-tabs [data-game-id="game-final-tabs-completed-2"]')).toBeVisible();
  await expect(page.locator('#game-tabs [data-game-id="game-final-tabs-completed-3"]')).toBeHidden();
  await expect(page.locator('#game-tabs [data-game-id]:visible')).toHaveCount(2);
  await expect.poll(() => page.locator('#game-tabs').evaluate(tabs => (
    getComputedStyle(tabs).getPropertyValue('--game-tab-count').trim()
  ))).toBe('2');
});

test('V3 keeps the deciding placeholder visible while a series is unfinished', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, 'live');
  await page.goto('/match/series-final-tabs-live/game-final-tabs-live-2');

  await expect(page.locator('#game-label')).toHaveText('Game 2 · Final');
  await expect(page.locator('#game-tabs [data-game-id="game-final-tabs-live-3"]')).toBeVisible();
  await expect(page.locator('#game-tabs [data-game-id]:visible')).toHaveCount(3);
});
