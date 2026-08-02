import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };
const completedBlue = { id: 'completed-blue', name: 'History Blue', code: 'HBL' };
const completedRed = { id: 'completed-red', name: 'History Red', code: 'HRD' };
const upcomingBlue = { id: 'upcoming-blue', name: 'Upcoming Blue', code: 'UBL' };
const upcomingRed = { id: 'upcoming-red', name: 'Upcoming Red', code: 'URD' };

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const liveSeries = {
  id: 'series-live',
  esport: 'lol',
  competition: { id: 'competition-live', name: 'Test League', stage: 'Week 1' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: iso(-60 * 60 * 1_000),
  games: [
    { id: 'game-live-1', number: 1, state: 'live' },
    { id: 'game-live-2', number: 2, state: 'unstarted' },
    { id: 'game-live-3', number: 3, state: 'unstarted' }
  ]
};

const completedSeries = {
  id: 'series-completed',
  esport: 'lol',
  competition: { id: 'competition-history', name: 'History League', stage: 'Final' },
  teams: [completedBlue, completedRed],
  bestOf: 3,
  state: 'completed',
  scheduledStart: iso(-2 * 60 * 60 * 1_000),
  games: [
    { id: 'game-completed-1', number: 1, state: 'completed' },
    { id: 'game-completed-2', number: 2, state: 'completed' },
    { id: 'game-completed-3', number: 3, state: 'unstarted' }
  ]
};

const upcomingSeries = {
  id: 'series-upcoming',
  esport: 'lol',
  competition: { id: 'competition-upcoming', name: 'Upcoming League', stage: 'Week 2' },
  teams: [upcomingBlue, upcomingRed],
  bestOf: 3,
  state: 'scheduled',
  scheduledStart: iso(60 * 60 * 1_000),
  games: [
    { id: 'game-upcoming-1', number: 1, state: 'unstarted' },
    { id: 'game-upcoming-2', number: 2, state: 'unstarted' },
    { id: 'game-upcoming-3', number: 3, state: 'unstarted' }
  ]
};

const liveHistory = {
  bestOf: 3,
  winsRequired: 2,
  drawPossible: false,
  score: [
    { team: blue, wins: 0 },
    { team: red, wins: 0 }
  ],
  games: [
    { id: 'game-live-1', number: 1, state: 'live', blueTeam: blue, redTeam: red, winner: null, durationSeconds: null },
    { id: 'game-live-2', number: 2, state: 'unstarted', blueTeam: red, redTeam: blue, winner: null, durationSeconds: null },
    { id: 'game-live-3', number: 3, state: 'unstarted', blueTeam: blue, redTeam: red, winner: null, durationSeconds: null }
  ]
};

const completedHistory = {
  bestOf: 3,
  winsRequired: 2,
  drawPossible: false,
  score: [
    { team: completedBlue, wins: 2 },
    { team: completedRed, wins: 0 }
  ],
  games: [
    { id: 'game-completed-1', number: 1, state: 'completed', blueTeam: completedBlue, redTeam: completedRed, winner: completedBlue, durationSeconds: 2_401 },
    { id: 'game-completed-2', number: 2, state: 'completed', blueTeam: completedRed, redTeam: completedBlue, winner: completedBlue, durationSeconds: 2_188 },
    { id: 'game-completed-3', number: 3, state: 'unstarted', blueTeam: completedBlue, redTeam: completedRed, winner: null, durationSeconds: null }
  ]
};

function context(seriesId: string) {
  const isCompleted = seriesId === completedSeries.id;
  const teams = isCompleted ? [completedBlue, completedRed] : [blue, red];
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId,
    provider,
    observedAt: iso(),
    rosters: teams.map(team => ({ team, players: [] })),
    standings: teams.map((team, index) => ({ rank: index + 1, team, wins: 1, losses: 0 })),
    history: isCompleted ? completedHistory : liveHistory,
    complete: true,
    reasons: []
  };
}

function teamStats(team: typeof blue, side: 'blue' | 'red', gold: number, kills: number) {
  return {
    id: team.id,
    name: team.name,
    side,
    gold,
    kills,
    objectives: {
      towers: side === 'blue' ? 4 : 2,
      inhibitors: 0,
      dragons: side === 'blue' ? ['infernal'] : [],
      barons: 0,
      heralds: 1,
      grubs: 3
    },
    players: []
  };
}

function snapshot(gameId: string, requestNumber: number) {
  const completed = gameId.startsWith('game-completed');
  const series = completed ? completedSeries : liveSeries;
  const game = series.games.find(candidate => candidate.id === gameId) ?? series.games[0];
  const left = completed ? completedBlue : blue;
  const right = completed ? completedRed : red;
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game,
    stats: {
      gameClockSeconds: completed ? 2_401 : 1_200 + requestNumber * 5,
      patch: '26.15.1',
      blue: teamStats(left, 'blue', 32_000 + requestNumber * 100, 8),
      red: teamStats(right, 'red', 30_500 + requestNumber * 90, 5)
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: iso(requestNumber * 1_000),
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

async function installApiFixtures(page: Page): Promise<{ scheduleRequests: () => number; liveRequests: () => number }> {
  let scheduleRequestCount = 0;
  let liveRequestCount = 0;

  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => {
    scheduleRequestCount += 1;
    return fulfillJson(route, {
      esport: 'lol',
      events: [
        { series: liveSeries, provider, observedAt: iso() },
        { series: upcomingSeries, provider, observedAt: iso() },
        { series: completedSeries, provider, observedAt: iso() }
      ]
    });
  });

  await page.route('**/v1/lol/series/**/context**', route => {
    const match = new URL(route.request().url()).pathname.match(/\/series\/([^/]+)\/context$/);
    return fulfillJson(route, context(decodeURIComponent(match?.[1] ?? liveSeries.id)));
  });

  await page.route('**/v1/lol/games/**/live**', route => {
    liveRequestCount += 1;
    const match = new URL(route.request().url()).pathname.match(/\/games\/([^/]+)\/live$/);
    return fulfillJson(route, snapshot(decodeURIComponent(match?.[1] ?? 'game-live-1'), liveRequestCount));
  });

  return {
    scheduleRequests: () => scheduleRequestCount,
    liveRequests: () => liveRequestCount
  };
}

test('stays visible and interactive through polling and view changes', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  const requests = await installApiFixtures(page);
  await page.goto('/');

  await expect(page.getByText('API connected')).toBeVisible();
  const liveCard = page.locator('[data-series-id="series-live"]');
  await expect(liveCard).toBeVisible();
  await liveCard.click();

  const selectedSeries = page.locator('#selected-series');
  await expect(selectedSeries).toContainText('Blue Team');
  await expect(selectedSeries).toContainText('Red Team');
  await expect(page.locator('.role-scoreboard-board')).toBeVisible();
  await expect(page.locator('#live-game-clock')).toHaveText(/\d+:\d{2}/);

  const refresh = page.getByRole('button', { name: 'Refresh' });
  await refresh.click();
  await expect.poll(requests.scheduleRequests).toBeGreaterThanOrEqual(2);
  await expect(refresh).toBeEnabled();

  await page.getByRole('button', { name: 'Open match history' }).click();
  await expect(page.locator('#completed-match-list')).toBeVisible();
  await expect(page.locator('[data-completed-series-id="series-completed"]')).toBeVisible();

  await page.getByRole('button', { name: 'Active' }).click();
  await expect(page.locator('#schedule-list')).toBeVisible();
  await page.locator('[data-series-id="series-upcoming"]').click();
  await expect(selectedSeries).toContainText('Upcoming Blue');
  await expect(selectedSeries).toContainText('Upcoming Red');
  await expect(page.getByText('Match scheduled')).toBeVisible();

  await liveCard.click();
  await expect(page.locator('.role-scoreboard-board')).toBeVisible();
  const liveRequestsBeforePolling = requests.liveRequests();
  await page.waitForTimeout(6_000);
  await expect.poll(requests.liveRequests).toBeGreaterThan(liveRequestsBeforePolling);

  await expect(page.locator('.app-frame')).toBeVisible();
  await expect(page.locator('.topbar')).toBeVisible();
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(page.locator('[data-series-id="series-live"]')).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
