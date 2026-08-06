import { expect, test, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blueTeam = { id: 'we', name: "Xi'an Team WE", code: 'WE' };
const redTeam = { id: 'al', name: "Anyone's Legend", code: 'AL' };
const observedAt = new Date().toISOString();

const sparseLiveSeries = {
  id: 'series-v2-sparse-lpl-live',
  esport: 'lol',
  competition: { id: '98767991314006698', name: 'LPL', stage: 'Week 3' },
  teams: [blueTeam, redTeam],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 45 * 60 * 1_000).toISOString(),
  games: []
};

const canonicalGames = [
  { id: 'game-v2-sparse-lpl-1', number: 1, state: 'completed' },
  { id: 'game-v2-sparse-lpl-2', number: 2, state: 'unstarted' }
] as const;

function players(side: 'blue' | 'red') {
  const handles = side === 'blue'
    ? ['Cube', 'Heng', 'Shanks', 'LP', 'Iwandy']
    : ['Flandre', 'Tarzan', 'Shanks2', 'Hope', 'Kael'];
  return handles.map((handle, index) => ({
    id: `${side}-${index}`,
    handle,
    championId: ['Gnar', 'XinZhao', 'Orianna', 'Jinx', 'Nautilus'][index]!,
    role: ['top', 'jungle', 'mid', 'bottom', 'support'][index]!,
    level: 15,
    kills: side === 'blue' ? [3, 4, 5, 8, 1][index]! : [2, 3, 4, 5, 1][index]!,
    deaths: side === 'blue' ? [2, 3, 1, 2, 4][index]! : [3, 4, 2, 4, 5][index]!,
    assists: side === 'blue' ? [5, 9, 7, 6, 13][index]! : [6, 8, 5, 4, 10][index]!,
    creepScore: 180 + index * 20,
    totalGold: side === 'blue' ? 9_000 + index * 700 : 8_400 + index * 600,
    items: []
  }));
}

function team(teamRef: typeof blueTeam, side: 'blue' | 'red') {
  return {
    id: teamRef.id,
    name: teamRef.name,
    side,
    gold: side === 'blue' ? 48_300 : 45_200,
    kills: side === 'blue' ? 21 : 15,
    objectives: {
      towers: side === 'blue' ? 8 : 5,
      inhibitors: side === 'blue' ? 1 : 0,
      dragons: side === 'blue' ? ['infernal', 'cloud', 'hextech'] : ['mountain'],
      barons: side === 'blue' ? 1 : 0,
      heralds: 1,
      grubs: 3
    },
    players: players(side)
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

test('web v2 hydrates a live LPL series whose schedule has no game IDs', async ({ page }) => {
  let contextRequests = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

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
      events: history ? [] : [{ series: sparseLiveSeries, provider, observedAt }]
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => {
    contextRequests += 1;
    return json(route, {
      schemaVersion: '1.0',
      esport: 'lol',
      seriesId: sparseLiveSeries.id,
      provider,
      observedAt,
      rosters: [],
      standings: [],
      history: {
        bestOf: 3,
        winsRequired: 2,
        drawPossible: false,
        score: [
          { team: blueTeam, wins: 1 },
          { team: redTeam, wins: 0 }
        ],
        games: [
          {
            ...canonicalGames[0],
            blueTeam,
            redTeam,
            winner: blueTeam,
            durationSeconds: 2_034
          },
          {
            ...canonicalGames[1],
            blueTeam: redTeam,
            redTeam: blueTeam,
            winner: null,
            durationSeconds: null
          }
        ]
      },
      complete: true,
      reasons: []
    });
  });
  await page.route('**/v1/lol/games/**/live**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: {
      ...sparseLiveSeries,
      games: [canonicalGames[0], { ...canonicalGames[1], state: 'live' }]
    },
    game: { id: canonicalGames[1].id, number: 2, state: 'live' },
    stats: {
      gameClockSeconds: 1_847,
      patch: '26.15.1',
      blue: team(blueTeam, 'blue'),
      red: team(redTeam, 'red')
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: observedAt,
      observedAt,
      ageSeconds: 1,
      complete: true,
      advancing: true,
      safeForLiveAnalysis: true,
      reasons: []
    }
  }));

  await page.goto('/v2/');
  const card = page.locator(`[data-series-id="${sparseLiveSeries.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText('LIVE');

  await card.click();
  await expect(page.locator('#game-label')).not.toHaveText('No game selected');
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page.locator('#game-clock')).toHaveText('30:47');
  await expect(page.locator('#game-tabs [data-game-id]')).toHaveCount(2);
  await expect(page.locator('#player-board .player-row')).toHaveCount(5);
  await expect(page.locator('#blue-kills')).toHaveText('21');
  await expect(page.locator('#red-kills')).toHaveText('15');
  expect(contextRequests).toBe(1);
  expect(errors).toEqual([]);
});
