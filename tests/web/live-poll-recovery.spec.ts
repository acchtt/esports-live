import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };
type LiveGameNumber = 1 | 2 | 3;

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function series(liveGame: LiveGameNumber) {
  const stateFor = (number: LiveGameNumber) => (
    number < liveGame ? 'completed' : number === liveGame ? 'live' : 'unstarted'
  );
  return {
    id: 'series-live',
    esport: 'lol',
    competition: { id: 'competition-live', name: 'Test League', stage: 'Week 1' },
    teams: [blue, red],
    bestOf: 3,
    state: 'live',
    scheduledStart: iso(-60 * 60 * 1_000),
    games: [
      { id: 'game-live-1', number: 1, state: stateFor(1) },
      { id: 'game-live-2', number: 2, state: stateFor(2) },
      { id: 'game-live-3', number: 3, state: stateFor(3) }
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

function snapshot(gameId: string, requestNumber: number, liveGame: LiveGameNumber) {
  const currentSeries = series(liveGame);
  const game = currentSeries.games.find(candidate => candidate.id === gameId)!;
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: currentSeries,
    game,
    stats: {
      gameClockSeconds: game.number * 600 + requestNumber,
      patch: '26.15.1',
      blue: teamStats(blue, 'blue', 32_000 + requestNumber * 100),
      red: teamStats(red, 'red', 30_500 + requestNumber * 90)
    },
    quality: {
      freshness: game.state === 'completed' ? 'historical' : 'fresh',
      sourceTimestamp: iso(requestNumber * 1_000),
      observedAt: iso(),
      ageSeconds: game.state === 'completed' ? 60 : 1,
      complete: true,
      advancing: game.state !== 'completed',
      safeForLiveAnalysis: game.state !== 'completed',
      reasons: []
    }
  };
}

function context(liveGame: LiveGameNumber) {
  const currentSeries = series(liveGame);
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
        { team: blue, wins: liveGame - 1 },
        { team: red, wins: 0 }
      ],
      games: currentSeries.games.map(game => ({
        ...game,
        blueTeam: blue,
        redTeam: red,
        winner: game.number < liveGame ? blue : null,
        durationSeconds: game.number < liveGame ? 2_401 + game.number : null
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

async function installRaceFixtures(page: Page) {
  let activeScheduleRequests = 0;
  let gameOneRequests = 0;
  let gameTwoRequests = 0;
  let gameThreeRequests = 0;
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
    const liveGame: LiveGameNumber = activeScheduleRequests >= 3 ? 3 : activeScheduleRequests >= 2 ? 2 : 1;
    return fulfillJson(route, {
      esport: 'lol',
      events: [{ series: series(liveGame), provider, observedAt: iso() }]
    });
  });

  await page.route('**/v1/lol/series/**/context**', route => (
    fulfillJson(route, context(activeScheduleRequests >= 2 ? 2 : 1))
  ));

  await page.route('**/v1/lol/games/**/live**', async route => {
    const match = new URL(route.request().url()).pathname.match(/\/games\/([^/]+)\/live$/);
    const gameId = decodeURIComponent(match?.[1] ?? 'game-live-1');
    if (gameId === 'game-live-1') {
      gameOneRequests += 1;
      if (gameOneRequests === 2) await staleRequestGate;
      return fulfillJson(route, snapshot(gameId, gameOneRequests, activeScheduleRequests >= 2 ? 2 : 1));
    }
    if (gameId === 'game-live-2') {
      gameTwoRequests += 1;
      return fulfillJson(route, snapshot(gameId, gameTwoRequests, 2));
    }
    gameThreeRequests += 1;
    return fulfillJson(route, snapshot(gameId, gameThreeRequests, 3));
  });

  return {
    activeScheduleRequests: () => activeScheduleRequests,
    gameOneRequests: () => gameOneRequests,
    gameTwoRequests: () => gameTwoRequests,
    gameThreeRequests: () => gameThreeRequests,
    releaseStaleRequest: () => releaseStaleRequest?.()
  };
}

test('keeps visible game cards and the rendered board on the same explicitly selected game', async ({ page }) => {
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

  await page.locator('[data-history-game-id="game-live-1"]').click();
  await expect(page.locator('[data-game-id="game-live-1"]')).toHaveClass(/active/);
  await expect(page.locator('[data-history-game-id="game-live-1"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-live-history-game-id="game-live-1"]')).toBeVisible();

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(requests.activeScheduleRequests).toBeGreaterThanOrEqual(3);
  await expect(page.locator('[data-game-id="game-live-1"]')).toHaveClass(/active/);
  await expect(page.locator('[data-game-id="game-live-3"]')).not.toHaveClass(/active/);
  await expect(page.locator('[data-live-history-game-id="game-live-1"]')).toBeVisible();

  await page.locator('[data-history-game-id="game-live-2"]').click();
  await expect(page.locator('[data-game-id="game-live-2"]')).toHaveClass(/active/);
  await expect(page.locator('[data-history-game-id="game-live-2"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-history-game-id="game-live-2"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-live-history-game-id="game-live-2"]')).toBeVisible();

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(requests.activeScheduleRequests).toBeGreaterThanOrEqual(4);
  await expect(page.locator('[data-game-id="game-live-2"]')).toHaveClass(/active/);
  await expect(page.locator('[data-game-id="game-live-3"]')).not.toHaveClass(/active/);
  await expect(page.locator('[data-history-game-id="game-live-2"]')).toHaveClass(/selected/);
  await expect(page.locator('[data-live-history-game-id="game-live-2"]')).toBeVisible();
  await expect(page.locator('[data-live-history-game-id="game-live-3"]')).toHaveCount(0);

  expect(requests.gameThreeRequests()).toBeGreaterThanOrEqual(0);
});

test('rapid switching keeps the last explicit game when another game snapshot arrives late', async ({ page }) => {
  const requests = await installRaceFixtures(page);
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute(
    'data-mobile-game-switch-owner',
    'active-selector-v27'
  );
  await page.locator('[data-series-id="series-live"]').click();
  await expect(page.locator('[data-live-history-game-id="game-live-1"]')).toBeVisible();
  await expect.poll(requests.gameOneRequests).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(requests.activeScheduleRequests).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-game-id="game-live-2"]')).toHaveClass(/active/);
  requests.releaseStaleRequest();

  await page.locator('[data-history-game-id="game-live-1"]').click();
  await page.locator('[data-history-game-id="game-live-2"]').click();
  await page.locator('[data-history-game-id="game-live-1"]').click();

  await expect(page.locator('[data-game-id="game-live-1"]')).toHaveClass(/active/);
  await expect(page.locator('[data-history-game-id="game-live-1"]')).toHaveAttribute('aria-current', 'true');
  await expect(page.locator('[data-live-history-game-id="game-live-1"]')).toBeVisible();

  await page.evaluate(staleSnapshot => {
    window.dispatchEvent(new CustomEvent('esports-live:snapshot', { detail: staleSnapshot }));
  }, snapshot('game-live-2', 99, 2));

  await page.waitForTimeout(100);
  await expect(page.locator('[data-game-id="game-live-1"]')).toHaveClass(/active/);
  await expect(page.locator('[data-live-history-game-id="game-live-1"]')).toBeVisible();
  await expect(page.locator('[data-live-history-game-id="game-live-2"]')).toHaveCount(0);
});
