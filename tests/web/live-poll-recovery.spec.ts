import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function series(gameTwoLive: boolean) {
  return {
    id: 'series-live',
    esport: 'lol',
    competition: { id: 'competition-live', name: 'Test League', stage: 'Week 1' },
    teams: [blue, red],
    bestOf: 3,
    state: 'live',
    scheduledStart: iso(-60 * 60 * 1_000),
    games: [
      { id: 'game-live-1', number: 1, state: gameTwoLive ? 'completed' : 'live' },
      { id: 'game-live-2', number: 2, state: gameTwoLive ? 'live' : 'unstarted' },
      { id: 'game-live-3', number: 3, state: 'unstarted' }
    ]
  };
}

function teamStats(team: typeof blue, side: 'blue' | 'red', gold: number) {
  return {
    id: team.id,
    name: team.name,
    side,
    gold,
    kills: side === 'blue' ? 8 : 5,
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
  const gameTwo = gameId === 'game-live-2';
  const currentSeries = series(gameTwo);
  const game = currentSeries.games.find(candidate => candidate.id === gameId)!;
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: currentSeries,
    game,
    stats: {
      gameClockSeconds: gameTwo ? 90 + requestNumber : 1_200 + requestNumber,
      patch: '26.15.1',
      blue: teamStats(blue, 'blue', 32_000 + requestNumber * 100),
      red: teamStats(red, 'red', 30_500 + requestNumber * 90)
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

function context(gameTwoLive: boolean) {
  const currentSeries = series(gameTwoLive);
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: currentSeries.id,
    provider,
    observedAt: iso(),
    rosters: [blue, red].map(team => ({ team, players: [] })),
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [
        { team: blue, wins: gameTwoLive ? 1 : 0 },
        { team: red, wins: 0 }
      ],
      games: currentSeries.games.map(game => ({
        ...game,
        blueTeam: blue,
        redTeam: red,
        winner: game.id === 'game-live-1' && gameTwoLive ? blue : null,
        durationSeconds: game.id === 'game-live-1' && gameTwoLive ? 2_401 : null
      }))
    },
    complete: true,
    reasons: []
  };
}

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installRaceFixtures(page: Page, contextDelayMs = 0) {
  let activeScheduleRequests = 0;
  let gameOneRequests = 0;
  let gameTwoRequests = 0;
  let releaseStaleRequest: (() => void) | null = null;
  const staleRequestGate = new Promise<void>(resolve => {
    releaseStaleRequest = resolve;
  });

  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => {
    const url = new URL(route.request().url());
    const activeRequest = url.searchParams.get('states') === 'live,paused,scheduled';
    if (activeRequest) activeScheduleRequests += 1;
    const gameTwoLive = activeScheduleRequests >= 2;
    return fulfillJson(route, {
      esport: 'lol',
      events: [{ series: series(gameTwoLive), provider, observedAt: iso() }]
    });
  });

  await page.route('**/v1/lol/series/**/context**', async route => {
    if (contextDelayMs > 0) await new Promise(resolve => setTimeout(resolve, contextDelayMs));
    await fulfillJson(route, context(activeScheduleRequests >= 2));
  });

  await page.route('**/v1/lol/games/**/live**', async route => {
    const match = new URL(route.request().url()).pathname.match(/\/games\/([^/]+)\/live$/);
    const gameId = decodeURIComponent(match?.[1] ?? 'game-live-1');
    if (gameId === 'game-live-1') {
      gameOneRequests += 1;
      if (gameOneRequests === 2) await staleRequestGate;
      return fulfillJson(route, snapshot(gameId, gameOneRequests));
    }
    gameTwoRequests += 1;
    return fulfillJson(route, snapshot(gameId, gameTwoRequests));
  });

  return {
    activeScheduleRequests: () => activeScheduleRequests,
    gameOneRequests: () => gameOneRequests,
    gameTwoRequests: () => gameTwoRequests,
    releaseStaleRequest: () => releaseStaleRequest?.()
  };
}

test('continues polling the newly selected live game after an older request finishes', async ({ page }) => {
  const requests = await installRaceFixtures(page);
  await page.goto('/');

  await page.locator('[data-series-id="series-live"]').click();
  await expect(page.locator('[data-live-history-game-id="game-live-1"]')).toBeVisible();
  await expect.poll(requests.gameOneRequests).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(requests.activeScheduleRequests).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-game-id="game-live-2"]')).toHaveClass(/active/);

  requests.releaseStaleRequest();

  await expect.poll(requests.gameTwoRequests).toBeGreaterThan(0);
  await expect(page.locator('[data-live-history-game-id="game-live-2"]')).toBeVisible();
});

test('slow series context resolves without exposing the startup prefetch timeout', async ({ page }) => {
  await installRaceFixtures(page, 900);
  await page.goto('/');

  await page.locator('[data-series-id="series-live"]').click();
  await expect(page.locator('[data-live-history-game-id="game-live-1"]')).toBeVisible();
  await expect(page.locator('#series-history')).toContainText('Game results', { timeout: 5_000 });
  await expect(page.getByText('Series context enrichment is still loading.')).toHaveCount(0);
});
