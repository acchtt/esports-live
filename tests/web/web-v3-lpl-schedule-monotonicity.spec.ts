import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'jdg', name: 'Beijing JDG Intel Esports Club', code: 'JDG' };
const red = { id: 'blg', name: 'Bilibili Gaming Pingan Bank', code: 'BLG' };
const game = { id: 'lpl-live-game-1', number: 1, state: 'live' } as const;
const scheduledGame = { ...game, state: 'unknown' } as const;
const scheduledStart = new Date(Date.now() - 4 * 60 * 60_000).toISOString();

const liveSeries = {
  id: 'lpl-live-series',
  esport: 'lol',
  competition: {
    id: '98767991314006698',
    name: 'LPL',
    stage: 'Regular Season'
  },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart,
  games: [game]
} as const;

const staleScheduledSeries = {
  ...liveSeries,
  state: 'scheduled',
  games: [scheduledGame]
} as const;

function liveSnapshot() {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: liveSeries,
    game,
    stats: {
      gameClockSeconds: 1_220,
      patch: '26.15.1',
      blue: {
        id: blue.id,
        name: blue.name,
        side: 'blue',
        gold: 32_400,
        kills: 5,
        objectives: {
          towers: 2,
          inhibitors: 0,
          dragons: ['cloud'],
          barons: 0,
          heralds: 1,
          grubs: null
        },
        players: []
      },
      red: {
        id: red.id,
        name: red.name,
        side: 'red',
        gold: 30_900,
        kills: 3,
        objectives: {
          towers: 1,
          inhibitors: 0,
          dragons: [],
          barons: 0,
          heralds: 0,
          grubs: null
        },
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

async function installFixtures(
  page: Page,
  staleSchedule: () => boolean,
  onMatchesSchedule: () => void
): Promise<void> {
  await page.route('https://ddragon.leagueoflegends.com/**', route => route.abort());
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    const url = route.request().url();
    if (url.includes('states=completed')) {
      return json(route, { esport: 'lol', events: [] });
    }
    onMatchesSchedule();
    return json(route, {
      esport: 'lol',
      events: [{
        series: staleSchedule() ? staleScheduledSeries : liveSeries,
        provider,
        observedAt: new Date().toISOString()
      }]
    });
  });
  await page.route('**/v1/lol/games/**/live**', route => json(route, liveSnapshot()));
}

test('V3 never regresses an observed live LPL game back to Upcoming or Pending', async ({ page }) => {
  let useStaleSchedule = false;
  let matchesScheduleRequests = 0;

  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(
    page,
    () => useStaleSchedule,
    () => { matchesScheduleRequests += 1; }
  );

  await page.goto('/', { waitUntil: 'commit' });

  const card = page.locator('[data-series-id="lpl-live-series"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.match-status')).toHaveText('LIVE');
  await card.click();

  await expect(page.locator('#game-label')).toHaveText('Game 1 · Live');
  await expect(page.locator('#blue-kills')).toHaveText('5');

  useStaleSchedule = true;
  await page.locator('.back-button').click();
  await expect(card).toBeVisible();
  await page.locator('#refresh-data').click();

  await expect.poll(() => matchesScheduleRequests).toBeGreaterThanOrEqual(2);
  await expect(card.locator('.match-status')).toHaveText('LIVE');
  await expect(card.locator('.match-card-bottom small')).toContainText('Game 1 in progress');

  await card.click();
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Live');
  await expect(page.locator('#game-tabs [data-game-id] span')).toHaveText('Live');
});
