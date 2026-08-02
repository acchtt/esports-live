import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const left = { id: 'left', name: 'Top Esports', code: 'TES' };
const right = { id: 'right', name: 'Beijing JDG Esports', code: 'JDG' };

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const series = {
  id: 'series-completed',
  esport: 'lol',
  competition: { id: 'competition-lpl', name: 'LPL', stage: 'Week 2' },
  teams: [left, right],
  bestOf: 3,
  state: 'completed',
  scheduledStart: iso(-2 * 60 * 60 * 1_000),
  games: [
    { id: 'game-completed-1', number: 1, state: 'completed' },
    { id: 'game-completed-2', number: 2, state: 'completed' },
    { id: 'game-completed-3', number: 3, state: 'unstarted' }
  ]
};

const history = {
  bestOf: 3,
  winsRequired: 2,
  drawPossible: false,
  score: [
    { team: left, wins: 2 },
    { team: right, wins: 0 }
  ],
  games: [
    { id: 'game-completed-1', number: 1, state: 'completed', blueTeam: left, redTeam: right, winner: left, durationSeconds: 2_401 },
    { id: 'game-completed-2', number: 2, state: 'completed', blueTeam: right, redTeam: left, winner: left, durationSeconds: 2_188 },
    { id: 'game-completed-3', number: 3, state: 'unstarted', blueTeam: left, redTeam: right, winner: null, durationSeconds: null }
  ]
};

function teamStats(team: typeof left, side: 'blue' | 'red', gold: number, kills: number) {
  return {
    id: team.id,
    name: team.name,
    side,
    gold,
    kills,
    objectives: {
      towers: side === 'blue' ? 7 : 3,
      inhibitors: side === 'blue' ? 1 : 0,
      dragons: side === 'blue' ? ['infernal', 'mountain'] : ['cloud'],
      barons: side === 'blue' ? 1 : 0,
      heralds: 1,
      grubs: 3
    },
    players: []
  };
}

function snapshot(gameId: string) {
  const secondGame = gameId === 'game-completed-2';
  const blueTeam = secondGame ? right : left;
  const redTeam = secondGame ? left : right;
  const game = series.games.find(candidate => candidate.id === gameId) ?? series.games[0];
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game,
    stats: {
      gameClockSeconds: secondGame ? 2_188 : 2_401,
      patch: '26.15.1',
      blue: teamStats(blueTeam, 'blue', secondGame ? 29_500 : 34_000, secondGame ? 4 : 12),
      red: teamStats(redTeam, 'red', secondGame ? 35_200 : 27_800, secondGame ? 13 : 3)
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: iso(-30_000),
      observedAt: iso(),
      ageSeconds: 30,
      complete: true,
      advancing: false,
      safeForLiveAnalysis: false,
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

async function installFixtures(page: Page): Promise<void> {
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
    rosters: [left, right].map(team => ({ team, players: [] })),
    standings: [
      { rank: 1, team: left, wins: 2, losses: 0 },
      { rank: 2, team: right, wins: 0, losses: 2 }
    ],
    history,
    complete: true,
    reasons: []
  }));

  await page.route('**/v1/lol/games/**/live**', route => {
    const match = new URL(route.request().url()).pathname.match(/\/games\/([^/]+)\/live$/);
    return fulfillJson(route, snapshot(decodeURIComponent(match?.[1] ?? 'game-completed-1')));
  });
}

test('uses game result cards as the only completed-scoreboard selector', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installFixtures(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Open match history' }).click();

  const detail = page.locator('#completed-match-detail');
  const cards = detail.locator('.completed-games > .completed-game');
  const telemetry = detail.locator('#completed-final-telemetry');
  await expect(cards).toHaveCount(3);
  await expect(telemetry.locator('.completed-final-game')).toHaveCount(2);
  await expect(detail).toHaveAttribute('data-completed-board-merged', 'true');

  await expect(telemetry.locator('.completed-telemetry-heading')).toBeHidden();
  await expect(telemetry.locator('.completed-game-tabs')).toBeHidden();
  await expect(detail.getByRole('button', { name: 'Show Game 1 scoreboard' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Show Game 2 scoreboard' })).toBeVisible();
  await expect(cards.nth(2)).toHaveAttribute('aria-disabled', 'true');

  const gameOneCard = detail.getByRole('button', { name: 'Show Game 1 scoreboard' });
  const gameTwoCard = detail.getByRole('button', { name: 'Show Game 2 scoreboard' });
  const gameOneBoard = telemetry.locator('[data-final-game-id="game-completed-1"]');
  const gameTwoBoard = telemetry.locator('[data-final-game-id="game-completed-2"]');

  await expect(gameTwoCard).toHaveAttribute('aria-pressed', 'true');
  await expect(gameTwoBoard).toBeVisible();
  await expect(gameOneBoard).toBeHidden();

  await gameOneCard.click();
  await expect(gameOneCard).toHaveAttribute('aria-pressed', 'true');
  await expect(gameOneBoard).toBeVisible();
  await expect(gameTwoBoard).toBeHidden();

  const joinedGap = await detail.evaluate(root => {
    const results = root.querySelector<HTMLElement>('.completed-games-panel');
    const scoreboards = root.querySelector<HTMLElement>('#completed-final-telemetry');
    if (!results || !scoreboards) return Number.POSITIVE_INFINITY;
    return Math.abs(scoreboards.getBoundingClientRect().top - results.getBoundingClientRect().bottom);
  });
  expect(joinedGap).toBeLessThan(2);
  expect(pageErrors).toEqual([]);
});
