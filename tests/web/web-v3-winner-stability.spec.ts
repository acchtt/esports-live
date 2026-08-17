import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'winner-blue', name: 'Winner Blue', code: 'WBL' };
const red = { id: 'winner-red', name: 'Winner Red', code: 'WRD' };
const series = {
  id: 'series-winner-cache',
  esport: 'lol',
  competition: { id: 'winner-league', name: 'Winner League', stage: 'Regular Season' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 45 * 60_000).toISOString(),
  games: [
    { id: 'game-winner-final', number: 1, state: 'completed' },
    { id: 'game-winner-live', number: 2, state: 'live' },
    { id: 'game-winner-next', number: 3, state: 'unstarted' }
  ]
};

function teamStats(id: string, name: string, side: 'blue' | 'red', gold: number, kills: number) {
  return {
    id,
    name,
    side,
    gold,
    kills,
    objectives: { towers: 3, inhibitors: 0, dragons: [], barons: 0, heralds: 0, grubs: null },
    players: []
  };
}

function snapshot(gameId: string) {
  const final = gameId === 'game-winner-final';
  const game = series.games.find(candidate => candidate.id === gameId) ?? series.games[1]!;
  const timestamp = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game,
    stats: {
      gameClockSeconds: final ? 2_020 : 1_240,
      patch: '26.15.1',
      blue: teamStats(blue.id, blue.name, 'blue', final ? 48_500 : 31_200, final ? 13 : 7),
      red: teamStats(red.id, red.name, 'red', final ? 43_700 : 30_800, final ? 8 : 6)
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: timestamp,
      observedAt: timestamp,
      ageSeconds: 1,
      complete: true,
      advancing: !final,
      safeForLiveAnalysis: !final,
      reasons: []
    }
  };
}

function context() {
  return {
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
      score: [
        { team: blue, wins: 1 },
        { team: red, wins: 0 }
      ],
      games: [
        {
          id: 'game-winner-final',
          number: 1,
          state: 'completed',
          blueTeam: blue,
          redTeam: red,
          winner: blue
        },
        {
          id: 'game-winner-live',
          number: 2,
          state: 'live',
          blueTeam: blue,
          redTeam: red
        },
        {
          id: 'game-winner-next',
          number: 3,
          state: 'unstarted',
          blueTeam: blue,
          redTeam: red
        }
      ]
    },
    complete: false,
    reasons: []
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

async function installFixtures(page: Page) {
  let winnerProbeRequests = 0;
  let slowNormalFinal = false;
  let winnerBackendAvailable = true;

  await page.route('https://ddragon.leagueoflegends.com/**', route => route.abort());
  await page.route('https://raw.communitydragon.org/**', route => route.abort());
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => json(route, {
    esport: 'lol',
    events: route.request().url().includes('states=completed')
      ? []
      : [{ series, provider, observedAt: new Date().toISOString() }]
  }));
  await page.route('**/v1/lol/series/**/context**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('final')?.startsWith('winner-')) {
      if (!winnerBackendAvailable) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        return;
      }
    }
    await json(route, context());
  });
  await page.route('**/v1/lol/games/**/live**', async route => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/games\/([^/]+)\/live$/);
    const gameId = decodeURIComponent(match?.[1] ?? 'game-winner-live');
    const winnerProbe = url.searchParams.get('final')?.startsWith('winner-') ?? false;
    if (winnerProbe) {
      winnerProbeRequests += 1;
      if (!winnerBackendAvailable) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
        return;
      }
    }
    if (gameId === 'game-winner-final' && !winnerProbe && slowNormalFinal) {
      await new Promise(resolve => setTimeout(resolve, 800));
    }
    await json(route, snapshot(gameId));
  });

  return {
    winnerProbeRequests: () => winnerProbeRequests,
    resetWinnerProbeRequests: () => { winnerProbeRequests = 0; },
    setSlowNormalFinal: (value: boolean) => { slowNormalFinal = value; },
    setWinnerBackendAvailable: (value: boolean) => { winnerBackendAvailable = value; }
  };
}

test('V3 prefetches final winners, keeps them visible during loading, and restores them after reload', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await installFixtures(page);
  await page.goto('/match/series-winner-cache/game-winner-live');

  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect.poll(fixture.winnerProbeRequests, { timeout: 5_000 }).toBeGreaterThan(0);
  await expect.poll(async () => page.evaluate(() => Boolean(
    localStorage.getItem('arena-v3:final-winner:game-winner-final')
  )), { timeout: 5_000 }).toBe(true);

  fixture.resetWinnerProbeRequests();
  fixture.setSlowNormalFinal(true);
  await page.locator('#game-tabs [data-game-id="game-winner-final"]').click();

  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');
  await expect(page.locator('#scoreboard')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#gold-lead-label')).toHaveText('WINNER');
  await expect(page.locator('#gold-lead')).toHaveText('WBL');
  await page.waitForTimeout(300);
  await expect(page.locator('#scoreboard')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#gold-lead-label')).toHaveText('WINNER');
  await expect(page.locator('#gold-lead')).toHaveText('WBL');
  expect(fixture.winnerProbeRequests()).toBe(0);

  await expect(page.locator('#scoreboard')).toHaveAttribute('aria-busy', 'false', { timeout: 3_000 });
  await expect(page.locator('#gold-lead-label')).toHaveText('WINNER');
  await expect(page.locator('#scoreboard-notice')).toContainText('Winner Blue won Game 1');

  fixture.resetWinnerProbeRequests();
  fixture.setSlowNormalFinal(false);
  fixture.setWinnerBackendAvailable(false);
  await page.reload();

  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');
  await expect(page.locator('#gold-lead-label')).toHaveText('WINNER');
  await expect(page.locator('#gold-lead')).toHaveText('WBL');
  await page.waitForTimeout(500);
  expect(fixture.winnerProbeRequests()).toBe(0);
});
