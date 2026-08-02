import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;

const series = {
  id: 'series-cold',
  esport: 'lol',
  competition: { id: 'test-league', name: 'Test League', stage: 'Week 2' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 30 * 60 * 1_000).toISOString(),
  games: [
    { id: 'cold-game', number: 1, state: 'live' },
    { id: 'cold-game-2', number: 2, state: 'unstarted' },
    { id: 'cold-game-3', number: 3, state: 'unstarted' }
  ]
};

function players(side: 'blue' | 'red') {
  const offset = side === 'blue' ? 0 : 5;
  return roles.map((role, index) => ({
    id: String(offset + index + 1),
    handle: `${side === 'blue' ? 'Blue' : 'Red'} Player ${index + 1}`,
    championId: `Champion${offset + index + 1}`,
    role,
    level: 11,
    kills: index === 2 ? 2 : 0,
    deaths: index === 2 ? 0 : 1,
    assists: 3,
    creepScore: 120 + index,
    totalGold: 7_000 + index * 100,
    items: ['1001', '2003']
  }));
}

function teamStats(team: typeof blue, side: 'blue' | 'red') {
  return {
    id: team.id,
    name: team.name,
    side,
    gold: side === 'blue' ? 36_000 : 34_500,
    kills: side === 'blue' ? 7 : 4,
    objectives: {
      towers: side === 'blue' ? 4 : 2,
      inhibitors: 0,
      dragons: side === 'blue' ? ['infernal'] : [],
      barons: 0,
      heralds: 1,
      grubs: 3
    },
    players: players(side)
  };
}

function snapshot() {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[0],
    stats: {
      gameClockSeconds: 1_234,
      patch: '26.15.1',
      blue: teamStats(blue, 'blue'),
      red: teamStats(red, 'red')
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

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(page: Page): Promise<() => number> {
  let liveRequests = 0;
  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => fulfillJson(route, {
    esport: 'lol',
    events: [{ series, provider, observedAt: new Date().toISOString() }]
  }));
  await page.route('**/v1/lol/series/**/context**', route => fulfillJson(route, {
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
      score: [{ team: blue, wins: 0 }, { team: red, wins: 0 }],
      games: [
        { id: 'cold-game', number: 1, state: 'live', blueTeam: blue, redTeam: red, winner: null, durationSeconds: null },
        { id: 'cold-game-2', number: 2, state: 'unstarted', blueTeam: red, redTeam: blue, winner: null, durationSeconds: null },
        { id: 'cold-game-3', number: 3, state: 'unstarted', blueTeam: blue, redTeam: red, winner: null, durationSeconds: null }
      ]
    },
    complete: true,
    reasons: []
  }));
  await page.route('**/v1/lol/games/cold-game/live**', async route => {
    liveRequests += 1;
    if (liveRequests === 1) await new Promise(resolve => setTimeout(resolve, 10_500));
    await fulfillJson(route, snapshot());
  });
  return () => liveRequests;
}

test('renders a cold live response that arrives after the former ten-second deadline', async ({ page }) => {
  test.setTimeout(25_000);
  const liveRequests = await installFixtures(page);
  await page.goto('/');

  await expect(page.locator('.role-scoreboard-board')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Live feed unavailable')).toHaveCount(0);
  await expect(page.getByText('Blue Player 1')).toBeVisible();
  expect(liveRequests()).toBeGreaterThanOrEqual(1);
});
