import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const series = {
  id: 'series-pending',
  esport: 'lol',
  competition: { id: 'competition-pending', name: 'Test League', stage: 'Week 1' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: iso(-30 * 60 * 1_000),
  games: [{ id: 'game-pending-1', number: 1, state: 'live' }]
};

function teamStats(team: typeof blue, side: 'blue' | 'red', gold: number) {
  return {
    id: team.id,
    name: team.name,
    side,
    gold,
    kills: side === 'blue' ? 3 : 2,
    objectives: {
      towers: 0,
      inhibitors: 0,
      dragons: [],
      barons: 0,
      heralds: 0,
      grubs: 0
    },
    players: []
  };
}

function pendingSnapshot() {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[0],
    stats: null,
    quality: {
      freshness: 'unknown',
      sourceTimestamp: null,
      observedAt: iso(),
      ageSeconds: null,
      complete: false,
      advancing: null,
      safeForLiveAnalysis: false,
      reasons: [{
        code: 'pregame_or_unknown',
        message: 'Progressing gameplay has not been verified.'
      }]
    }
  };
}

function liveSnapshot() {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[0],
    stats: {
      gameClockSeconds: 45,
      patch: '26.15.1',
      blue: teamStats(blue, 'blue', 4_200),
      red: teamStats(red, 'red', 4_000)
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: iso(),
      observedAt: iso(),
      ageSeconds: 1,
      complete: true,
      advancing: true,
      safeForLiveAnalysis: true,
      reasons: []
    }
  };
}

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(page: Page) {
  let liveRequests = 0;
  let telemetryAvailableAt = 0;

  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => fulfillJson(route, {
    esport: 'lol',
    events: [{ series, provider, observedAt: iso() }]
  }));

  await page.route('**/v1/lol/series/**/context**', route => fulfillJson(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: series.id,
    provider,
    observedAt: iso(),
    rosters: [],
    standings: [],
    history: null,
    complete: false,
    reasons: []
  }));

  await page.route('**/v1/lol/games/**/live**', async route => {
    liveRequests += 1;
    if (telemetryAvailableAt === 0) telemetryAvailableAt = Date.now() + 2_800;
    await new Promise(resolve => setTimeout(resolve, 250));
    return fulfillJson(
      route,
      Date.now() < telemetryAvailableAt ? pendingSnapshot() : liveSnapshot()
    );
  });

  return { liveRequests: () => liveRequests };
}

test('explains Riot telemetry delay and recovers when gameplay frames arrive', async ({ page }) => {
  const requests = await installFixtures(page);
  await page.goto('/');

  await page.locator('[data-series-id="series-pending"]').click();

  await expect(page.locator('[data-selection-snapshot-pending]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Live telemetry pending' })).toBeVisible();
  await expect(page.locator('[data-selection-snapshot-pending]')).toContainText('Retrying automatically');

  await expect.poll(requests.liveRequests).toBeGreaterThan(2);
  await expect(page.locator('[data-live-dashboard-game-id="game-pending-1"]'), {
    message: 'The unified live board should replace the pending telemetry message.'
  }).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-selection-snapshot-loading]')).toHaveCount(0);
  await expect(page.locator('[data-selection-snapshot-pending]')).toHaveCount(0);
});
