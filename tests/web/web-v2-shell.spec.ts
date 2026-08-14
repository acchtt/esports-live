import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const alpha = { id: 'alpha', name: 'Alpha Five', code: 'ALP' };
const bravo = { id: 'bravo', name: 'Bravo Core', code: 'BRV' };
const delta = { id: 'delta', name: 'Delta Club', code: 'DLC' };
const echo = { id: 'echo', name: 'Echo Squad', code: 'ECH' };
const lplBlue = { id: 'lpl-blue', name: 'LPL Blue', code: 'LPB' };
const lplRed = { id: 'lpl-red', name: 'LPL Red', code: 'LPR' };
const future = { id: 'future', name: 'Future Gaming', code: 'FTR' };
const nova = { id: 'nova', name: 'Nova Prime', code: 'NVP' };

const handles = {
  blue: ['Doran', 'Oner', 'Faker', 'Peyz', 'Keria'],
  red: ['Siwoo', 'Lucid', 'ShowMaker', 'Smash', 'Career']
};
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'];
const champions = {
  blue: ['Jayce', 'Nocturne', 'Ryze', 'Lucian', 'Milio'],
  red: ['Olaf', 'JarvanIV', 'Syndra', 'Caitlyn', 'Lux']
};

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const activeSeries = {
  id: 'series-v2-live',
  esport: 'lol',
  competition: { id: 'competition-v2', name: 'V2 League', stage: 'Week 1' },
  teams: [alpha, bravo],
  bestOf: 3,
  state: 'live',
  scheduledStart: iso(-30 * 60 * 1_000),
  games: [
    { id: 'game-v2-1', number: 1, state: 'completed' },
    { id: 'game-v2-2', number: 2, state: 'live' }
  ],
  score: [{ team: alpha, wins: 1 }, { team: bravo, wins: 0 }]
};

const unknownLiveLplSeries = {
  id: 'series-v2-lpl-live',
  esport: 'lol',
  competition: { id: 'competition-lpl', name: 'LPL', stage: 'Regular Season' },
  teams: [lplBlue, lplRed],
  bestOf: 3,
  state: 'unknown',
  scheduledStart: iso(-20 * 60 * 1_000),
  games: [
    { id: 'game-v2-lpl-live-1', number: 1, state: 'live' }
  ],
  score: [{ team: lplBlue, wins: 0 }, { team: lplRed, wins: 0 }]
};

const staleCompletedLiveLplSeries = {
  ...unknownLiveLplSeries,
  state: 'completed'
};

const backgroundRecoveryLplSeries = {
  id: 'series-v2-lpl-background',
  esport: 'lol',
  competition: { id: '98767991314006698', name: 'LPL', stage: 'Regular Season' },
  teams: [lplBlue, lplRed],
  bestOf: 3,
  state: 'completed',
  scheduledStart: iso(-25 * 60 * 1_000),
  games: [
    { id: 'game-v2-lpl-background-1', number: 1, state: 'completed' }
  ],
  score: [{ team: lplBlue, wins: 1 }, { team: lplRed, wins: 0 }]
};

const futureLplSeries = {
  id: 'series-v2-lpl-future',
  esport: 'lol',
  competition: { id: 'competition-lpl', name: 'LPL', stage: 'Regular Season' },
  teams: [future, nova],
  bestOf: 3,
  state: 'scheduled',
  scheduledStart: iso(4 * 60 * 60 * 1_000),
  games: [
    { id: 'game-v2-lpl-future-1', number: 1, state: 'unstarted' }
  ],
  score: [{ team: future, wins: 0 }, { team: nova, wins: 0 }]
};

const misclassifiedFutureLplSeries = {
  ...futureLplSeries,
  state: 'completed',
  games: [
    { id: 'game-v2-lpl-future-1', number: 1, state: 'completed' }
  ]
};

const historySeries = {
  id: 'series-v2-history',
  esport: 'lol',
  competition: { id: 'competition-history', name: 'V2 History League', stage: 'Final' },
  teams: [delta, echo],
  bestOf: 3,
  state: 'completed',
  scheduledStart: iso(-2 * 60 * 60 * 1_000),
  games: [],
  score: [{ team: delta, wins: 2 }, { team: echo, wins: 0 }]
};

const canonicalHistorySeries = {
  ...historySeries,
  games: [
    { id: 'game-v2-history-1', number: 1, state: 'completed' },
    { id: 'game-v2-history-2', number: 2, state: 'completed' }
  ]
};

const recoveredBackgroundLplSeries = {
  ...backgroundRecoveryLplSeries,
  state: 'live',
  games: [
    { id: 'game-v2-lpl-background-1', number: 1, state: 'completed' },
    { id: 'game-v2-lpl-background-2', number: 2, state: 'live' },
    { id: 'game-v2-lpl-background-3', number: 3, state: 'unstarted' }
  ]
};

const historyContext = {
  schemaVersion: '1.0',
  esport: 'lol',
  seriesId: historySeries.id,
  provider,
  observedAt: iso(),
  rosters: [],
  standings: [],
  history: {
    bestOf: 3,
    winsRequired: 2,
    drawPossible: false,
    score: [
      { team: delta, wins: 2 },
      { team: echo, wins: 0 }
    ],
    games: [
      {
        id: 'game-v2-history-1',
        number: 1,
        state: 'completed',
        blueTeam: delta,
        redTeam: echo,
        winner: delta,
        durationSeconds: 2_101
      },
      {
        id: 'game-v2-history-2',
        number: 2,
        state: 'completed',
        blueTeam: delta,
        redTeam: echo,
        winner: delta,
        durationSeconds: 2_217
      }
    ]
  },
  complete: true,
  reasons: []
};

const backgroundRecoveryContext = {
  schemaVersion: '1.0',
  esport: 'lol',
  seriesId: backgroundRecoveryLplSeries.id,
  provider,
  observedAt: iso(),
  rosters: [],
  standings: [],
  history: {
    bestOf: 3,
    winsRequired: 2,
    drawPossible: false,
    score: [
      { team: lplBlue, wins: 1 },
      { team: lplRed, wins: 0 }
    ],
    games: [
      {
        id: 'game-v2-lpl-background-1',
        number: 1,
        state: 'completed',
        blueTeam: lplBlue,
        redTeam: lplRed,
        winner: lplBlue,
        durationSeconds: 2_031
      },
      {
        id: 'game-v2-lpl-background-2',
        number: 2,
        state: 'unstarted',
        blueTeam: lplRed,
        redTeam: lplBlue,
        winner: null,
        durationSeconds: null
      },
      {
        id: 'game-v2-lpl-background-3',
        number: 3,
        state: 'unstarted',
        blueTeam: lplBlue,
        redTeam: lplRed,
        winner: null,
        durationSeconds: null
      }
    ]
  },
  complete: true,
  reasons: []
};

function players(side: 'blue' | 'red', live: boolean) {
  return handles[side].map((handle, index) => ({
    id: `${side}-${index}`,
    handle,
    championId: champions[side][index]!,
    role: roles[index]!,
    level: live ? 13 + (index % 3) : 18,
    kills: side === 'blue' ? [4, 1, 1, 11, 0][index]! : [4, 0, 2, 1, 0][index]!,
    deaths: side === 'blue' ? [4, 0, 0, 2, 1][index]! : [3, 5, 2, 3, 4][index]!,
    assists: side === 'blue' ? [1, 8, 3, 3, 14][index]! : [0, 2, 0, 1, 3][index]!,
    creepScore: 190 + index * 11,
    totalGold: side === 'blue'
      ? [8_906, 8_517, 8_091, 13_168, 7_580][index]!
      : [8_000, 7_000, 8_000, 7_000, 6_000][index]!,
    items: ['1001', '2003']
  }));
}

function team(
  teamRef: typeof alpha,
  side: 'blue' | 'red',
  live: boolean
) {
  return {
    id: teamRef.id,
    name: teamRef.name,
    side,
    gold: side === 'blue' ? (live ? 41_400 : 55_000) : (live ? 38_100 : 45_000),
    kills: side === 'blue' ? (live ? 12 : 17) : (live ? 8 : 7),
    objectives: {
      towers: side === 'blue' ? 10 : 3,
      inhibitors: side === 'blue' ? 1 : 0,
      dragons: side === 'blue' ? ['infernal', 'cloud'] : ['mountain', 'ocean', 'hextech'],
      barons: side === 'blue' ? 2 : 0,
      heralds: 1,
      grubs: 3
    },
    players: players(side, live)
  };
}

function snapshot(gameId: string) {
  const historical = gameId.startsWith('game-v2-history');
  const backgroundLpl = gameId.startsWith('game-v2-lpl-background');
  const lpl = gameId.startsWith('game-v2-lpl-live');
  const series = historical
    ? canonicalHistorySeries
    : backgroundLpl
      ? recoveredBackgroundLplSeries
      : lpl
        ? { ...unknownLiveLplSeries, state: 'live' }
        : activeSeries;
  const game = series.games.find(item => item.id === gameId) ?? series.games[0]!;
  const left = series.teams[0]!;
  const right = series.teams[1]!;
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game,
    stats: {
      gameClockSeconds: historical ? 2_217 : 1_322,
      patch: '26.15.1',
      blue: team(left, 'blue', !historical),
      red: team(right, 'red', !historical)
    },
    quality: {
      freshness: historical ? 'stale' : 'fresh',
      sourceTimestamp: iso(),
      observedAt: iso(),
      ageSeconds: historical ? 4_000 : 1,
      complete: true,
      advancing: !historical,
      safeForLiveAnalysis: !historical,
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

async function installFixtures(page: Page): Promise<{ contextRequests: () => number }> {
  let contextRequestCount = 0;
  await page.route('**/health', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    const history = route.request().url().includes('states=completed');
    return json(route, {
      esport: 'lol',
      events: history
        ? [
            { series: historySeries, provider, observedAt: iso() },
            { series: staleCompletedLiveLplSeries, provider, observedAt: iso() },
            { series: misclassifiedFutureLplSeries, provider, observedAt: iso() }
          ]
        : [
            { series: activeSeries, provider, observedAt: iso() },
            { series: unknownLiveLplSeries, provider, observedAt: iso() },
            { series: futureLplSeries, provider, observedAt: iso() }
          ]
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => {
    contextRequestCount += 1;
    return json(route, historyContext);
  });
  await page.route('**/v1/lol/games/**/live**', route => {
    const match = route.request().url().match(/games\/([^/]+)\/live/);
    return json(route, snapshot(decodeURIComponent(match?.[1] ?? 'game-v2-2')));
  });
  return { contextRequests: () => contextRequestCount };
}

async function installBackgroundRecoveryFixtures(page: Page): Promise<{
  contextRequests: () => number;
  releaseContext: () => void;
}> {
  let contextRequestCount = 0;
  let releaseContext = (): void => {};
  const contextGate = new Promise<void>(resolve => {
    releaseContext = resolve;
  });

  await page.route('**/health', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    const history = route.request().url().includes('states=completed');
    return json(route, {
      esport: 'lol',
      events: history
        ? [{ series: backgroundRecoveryLplSeries, provider, observedAt: iso() }]
        : []
    });
  });
  await page.route('**/v1/lol/series/**/context**', async route => {
    contextRequestCount += 1;
    await contextGate;
    return json(route, backgroundRecoveryContext);
  });
  await page.route('**/v1/lol/games/**/live**', route => {
    const match = route.request().url().match(/games\/([^/]+)\/live/);
    return json(route, snapshot(decodeURIComponent(match?.[1] ?? 'game-v2-lpl-background-2')));
  });

  return {
    contextRequests: () => contextRequestCount,
    releaseContext
  };
}

test('web v2 renders ended immediately and recovers unknown LPL live series', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installFixtures(page);
  await page.goto('/v2/');

  await expect(page).toHaveTitle('ARENA');
  await expect(page.locator('#catalogue-meta')).toContainText('4 matches');

  await page.getByRole('button', { name: 'Live', exact: true }).click();
  const lplLiveCard = page.locator('[data-series-id="series-v2-lpl-live"]');
  await expect(lplLiveCard).toBeVisible();
  await expect(lplLiveCard).toContainText('LIVE');
  await expect(lplLiveCard).toHaveAttribute('data-source-view', 'matches');
  await expect(page.locator('[data-series-id="series-v2-live"]')).toBeVisible();

  await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
  const futureLplCard = page.locator('[data-series-id="series-v2-lpl-future"]');
  await expect(futureLplCard).toBeVisible();
  await expect(futureLplCard).toContainText('UPCOMING');
  await expect(futureLplCard).toHaveAttribute('data-source-view', 'matches');

  await page.getByRole('button', { name: 'Ended', exact: true }).click();
  const endedCard = page.locator('[data-series-id="series-v2-history"]');
  await expect(endedCard).toBeVisible();
  await expect(page.locator('[data-series-id="series-v2-lpl-live"]')).toBeHidden();
  await expect(page.locator('[data-series-id="series-v2-lpl-future"]')).toBeHidden();
  expect(fixture.contextRequests()).toBe(0);

  await endedCard.click();
  await expect(page.locator('#match-panel')).toBeVisible();
  await expect(page.locator('#game-tabs [data-game-id]')).toHaveCount(2);
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Final');
  await expect(page.locator('#game-clock')).toHaveText('36:57');
  await expect(page.locator('#player-board .player-row')).toHaveCount(5);
  await expect(page.locator('.lane-gold').first()).toHaveText('+906');
  expect(fixture.contextRequests()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('web v2 renders the catalogue before background LPL recovery completes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = await installBackgroundRecoveryFixtures(page);
  await page.goto('/v2/');

  await expect(page.locator('#catalogue-meta')).toContainText('1 matches');
  const card = page.locator('[data-series-id="series-v2-lpl-background"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('FINAL');
  await expect.poll(fixture.contextRequests).toBe(1);

  fixture.releaseContext();
  await page.getByRole('button', { name: 'Live', exact: true }).click();
  await expect(card).toBeVisible();
  await expect(card).toContainText('LIVE');
  await expect(card).toHaveAttribute('data-source-view', 'history');

  await card.click();
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page.locator('#game-clock')).toHaveText('22:02');
  await expect(page.locator('#player-board .player-row')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('web v2 mobile match detail keeps the reference board within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/v2/');

  const navigation = page.locator('.mobile-nav');
  await expect(navigation).toBeVisible();
  await page.locator('[data-series-id="series-v2-live"]').click();

  await expect(page.locator('#scoreboard')).toBeVisible();
  await expect(page.locator('.scoreboard-header')).toContainText('Game 2 · Live');
  await expect(page.locator('.objective-grid article')).toHaveCount(5);
  await expect(page.locator('.player-row')).toHaveCount(5);
  await expect(navigation.getByRole('button', { name: 'Match', exact: true })).toHaveClass(/active/);

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
});
