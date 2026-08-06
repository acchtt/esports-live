import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const alpha = { id: 'alpha', name: 'Alpha Five', code: 'ALP' };
const bravo = { id: 'bravo', name: 'Bravo Core', code: 'BRV' };
const delta = { id: 'delta', name: 'Delta Club', code: 'DLC' };
const echo = { id: 'echo', name: 'Echo Squad', code: 'ECH' };
const future = { id: 'future', name: 'Future Gaming', code: 'FTR' };
const nova = { id: 'nova', name: 'Nova Prime', code: 'NVP' };

const blueHandles = ['Doran', 'Oner', 'Faker', 'Peyz', 'Keria'];
const redHandles = ['Siwoo', 'Lucid', 'ShowMaker', 'Smash', 'Career'];
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'];
const blueChampions = ['Jayce', 'Nocturne', 'Ryze', 'Lucian', 'Milio'];
const redChampions = ['Olaf', 'JarvanIV', 'Syndra', 'Caitlyn', 'Lux'];

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
  ]
};

const upcomingSeries = {
  id: 'series-v2-upcoming',
  esport: 'lol',
  competition: { id: 'competition-upcoming', name: 'V2 League', stage: 'Week 1' },
  teams: [future, nova],
  bestOf: 3,
  state: 'scheduled',
  scheduledStart: iso(2 * 60 * 60 * 1_000),
  games: [
    { id: 'game-v2-upcoming-1', number: 1, state: 'unstarted' },
    { id: 'game-v2-upcoming-2', number: 2, state: 'unstarted' }
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
  games: []
};

const canonicalHistorySeries = {
  ...historySeries,
  games: [
    { id: 'game-v2-history-1', number: 1, state: 'completed' },
    { id: 'game-v2-history-2', number: 2, state: 'completed' }
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

function players(side: 'blue' | 'red', live: boolean) {
  const handles = side === 'blue' ? blueHandles : redHandles;
  const champions = side === 'blue' ? blueChampions : redChampions;
  return handles.map((handle, index) => ({
    id: `${side}-${index}`,
    handle,
    championId: champions[index]!,
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

function team(teamRef: typeof alpha, side: 'blue' | 'red', live: boolean) {
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

function blankHistorySnapshot(gameId: string) {
  const game = canonicalHistorySeries.games.find(item => item.id === gameId)
    ?? canonicalHistorySeries.games[0]!;
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: canonicalHistorySeries,
    game,
    stats: null,
    quality: {
      freshness: 'unavailable',
      sourceTimestamp: null,
      observedAt: iso(),
      ageSeconds: null,
      complete: false,
      advancing: false,
      safeForLiveAnalysis: false,
      reasons: [{ code: 'final-frame-missing', message: 'Schedule slot has no final frame.' }]
    }
  };
}

function snapshot(gameId: string) {
  if (gameId.startsWith('slot-v2-history')) return blankHistorySnapshot(gameId);
  const historical = gameId !== 'game-v2-2';
  const series = gameId.startsWith('game-v2-history') ? canonicalHistorySeries : activeSeries;
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

async function installFixtures(page: Page): Promise<void> {
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
        ? [{ series: historySeries, provider, observedAt: iso() }]
        : [
            { series: activeSeries, provider, observedAt: iso() },
            { series: upcomingSeries, provider, observedAt: iso() }
          ]
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => json(route, historyContext));
  await page.route('**/v1/lol/games/**/live**', route => {
    const match = route.request().url().match(/games\/([^/]+)\/live/);
    return json(route, snapshot(decodeURIComponent(match?.[1] ?? 'game-v2-2')));
  });
}

test('web v2 hydrates ended game tabs and opens the full stats board', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installFixtures(page);
  await page.goto('/v2/');

  await expect(page).toHaveTitle('Esports Live V2');
  await expect(page.getByRole('link', { name: 'Current site' })).toHaveAttribute('href', '../');
  await expect(page.locator('[data-series-id="series-v2-live"]')).toBeVisible();
  await expect(page.locator('[data-series-id="series-v2-upcoming"]')).toBeVisible();
  await expect(page.locator('[data-series-id="series-v2-history"]')).toBeVisible();
  await expect(page.locator('#catalogue-meta')).toContainText('3 matches');

  await page.getByRole('button', { name: 'Ended', exact: true }).click();
  await expect(page.locator('[data-series-id="series-v2-history"]')).toBeVisible();
  await expect(page.locator('[data-series-id="series-v2-live"]')).toBeHidden();
  await expect(page.locator('[data-series-id="series-v2-upcoming"]')).toBeHidden();

  await page.locator('[data-series-id="series-v2-history"]').click();
  await expect(page.locator('#match-panel')).toBeVisible();
  await expect(page.locator('#detail-title')).toHaveText('Delta Club vs Echo Squad');
  await expect(page.locator('#game-tabs [data-game-id]')).toHaveCount(2);
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Final');
  await expect(page.locator('#game-clock')).toHaveText('36:57');
  await expect(page.locator('.objective-grid article')).toHaveCount(4);
  await expect(page.locator('#player-board .player-row')).toHaveCount(5);
  await expect(page.locator('.blue-player .player-copy').first()).toContainText('DLC Doran');
  await expect(page.locator('.red-player .player-copy').first()).toContainText('ECH Siwoo');
  await expect(page.locator('.lane-gold').first()).toHaveText('+906');
  await expect(page.locator('#quality-text')).toContainText('complete');

  const scoreboard = page.locator('#scoreboard');
  await scoreboard.evaluate(element => { element.dataset.identity = 'persistent'; });
  await page.getByRole('button', { name: 'Matches', exact: true }).last().click();
  await expect(page.locator('#catalogue-panel')).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.locator('[data-series-id="series-v2-live"]').click();
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page.locator('#game-clock')).toHaveText('22:02');
  await expect(scoreboard).toHaveAttribute('data-identity', 'persistent');

  await page.getByRole('button', { name: /Game 1 Final/i }).click();
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');
  await expect(scoreboard).toHaveAttribute('data-identity', 'persistent');

  await page.getByRole('button', { name: 'Platform', exact: true }).click();
  await expect(page.locator('#platform-panel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('web v2 mobile match detail follows the reference board without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/v2/');

  const navigation = page.locator('.mobile-nav');
  await expect(navigation).toBeVisible();
  await expect(page.locator('[data-series-id="series-v2-history"]')).toBeVisible();
  await page.locator('[data-series-id="series-v2-live"]').click();

  await expect(page.locator('#scoreboard')).toBeVisible();
  await expect(page.locator('.scoreboard-header')).toContainText('Game 2 · Live');
  await expect(page.locator('.team-banner')).toBeVisible();
  await expect(page.locator('.objective-grid article')).toHaveCount(4);
  await expect(page.locator('.player-row')).toHaveCount(5);
  await expect(navigation.getByRole('button', { name: 'Match', exact: true })).toHaveClass(/active/);

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);

  await navigation.getByRole('button', { name: 'Matches', exact: true }).click();
  await expect(page.locator('#catalogue-panel')).toBeVisible();
});
