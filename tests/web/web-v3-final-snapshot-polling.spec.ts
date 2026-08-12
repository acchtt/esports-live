import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'lpl-blue', name: 'LPL Blue', code: 'LPB' };
const red = { id: 'lpl-red', name: 'LPL Red', code: 'LPR' };
const series = {
  id: 'lpl-final-series',
  esport: 'lol',
  competition: {
    id: '98767991314006698',
    name: 'LPL',
    stage: 'Regular Season'
  },
  teams: [blue, red],
  bestOf: 3,
  state: 'completed',
  scheduledStart: new Date(Date.now() - 90 * 60_000).toISOString(),
  games: [
    { id: 'lpl-final-game-1', number: 1, state: 'completed' },
    { id: 'lpl-final-game-2', number: 2, state: 'completed' }
  ]
} as const;

function completedSnapshot(blueKills: number, sourceTimestamp: string) {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[1],
    stats: {
      gameClockSeconds: blueKills >= 11 ? 2_088 : 2_020,
      patch: '26.15.1',
      blue: {
        id: blue.id,
        name: blue.name,
        side: 'blue',
        gold: blueKills >= 11 ? 54_200 : 51_800,
        kills: blueKills,
        objectives: {
          towers: 9,
          inhibitors: 2,
          dragons: ['cloud', 'infernal', 'mountain'],
          barons: 1,
          heralds: 1,
          grubs: null
        },
        players: []
      },
      red: {
        id: red.id,
        name: red.name,
        side: 'red',
        gold: 46_100,
        kills: 6,
        objectives: {
          towers: 3,
          inhibitors: 0,
          dragons: ['ocean'],
          barons: 0,
          heralds: 0,
          grubs: null
        },
        players: []
      }
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp,
      observedAt: sourceTimestamp,
      ageSeconds: 1,
      complete: true,
      advancing: false,
      safeForLiveAnalysis: false,
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

async function installFixtures(page: Page, onSnapshot: (url: string) => unknown): Promise<void> {
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
      ? [{ series, provider, observedAt: new Date().toISOString() }]
      : []
  }));
  await page.route('**/v1/lol/series/**/context**', route => json(route, {
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
      score: [],
      games: series.games
    },
    complete: true,
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => json(route, onSnapshot(route.request().url())));
}

test('V3 keeps refreshing a selected LPL Final game until newer final telemetry arrives', async ({ page }) => {
  let snapshotRequests = 0;
  const snapshotUrls: string[] = [];
  const firstTimestamp = new Date(Date.now() - 15_000).toISOString();
  const settledTimestamp = new Date().toISOString();

  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, url => {
    snapshotRequests += 1;
    snapshotUrls.push(url);
    return completedSnapshot(
      snapshotRequests >= 2 ? 11 : 7,
      snapshotRequests >= 2 ? settledTimestamp : firstTimestamp
    );
  });

  await page.goto('/');
  await expect(page.locator('[data-series-id="lpl-final-series"]')).toBeVisible();
  await page.locator('[data-series-id="lpl-final-series"]').click();

  await expect(page.locator('#game-label')).toHaveText('Game 2 · Final');
  await expect(page.locator('#blue-kills')).toHaveText('7');

  await expect.poll(() => snapshotRequests, { timeout: 7_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#blue-kills')).toHaveText('11');

  const firstTwo = snapshotUrls.slice(0, 2).map(url => new URL(url));
  expect(firstTwo).toHaveLength(2);
  expect(firstTwo.every(url => !url.searchParams.has('after'))).toBe(true);
  expect(firstTwo.every(url => url.searchParams.has('final'))).toBe(true);
});
