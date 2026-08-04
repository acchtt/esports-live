import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };
const game = { id: 'game-levels', number: 1, state: 'live' as const };
const series = {
  id: 'series-levels',
  esport: 'lol',
  competition: { id: 'test-league', name: 'Test League', stage: 'Week 1' },
  teams: [blue, red] as const,
  bestOf: 3,
  state: 'live' as const,
  scheduledStart: new Date(Date.now() - 30 * 60 * 1_000).toISOString(),
  games: [game]
};

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

function players(side: 'blue' | 'red') {
  const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
  return roles.map((role, index) => ({
    id: String(index + (side === 'blue' ? 1 : 6)),
    handle: `${side}-${role}`,
    championId: side === 'blue' ? 'Garen' : 'Darius',
    role,
    level: side === 'blue' ? 13 - index : 12 - index,
    kills: index,
    deaths: 1,
    assists: 2,
    creepScore: 100 - index * 10,
    totalGold: 5_000 - index * 100,
    items: ['1001']
  }));
}

function teamStats(team: typeof blue, side: 'blue' | 'red') {
  return {
    id: team.id,
    name: team.name,
    side,
    gold: side === 'blue' ? 30_000 : 29_000,
    kills: side === 'blue' ? 7 : 5,
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

async function installFixtures(page: Page): Promise<void> {
  await page.route('https://www.riotgames.com/darkroom/original/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"></svg>'
  }));

  await page.route('https://ddragon.leagueoflegends.com/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>'
  }));

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
      score: [
        { team: blue, wins: 0 },
        { team: red, wins: 0 }
      ],
      games: [{ ...game, blueTeam: blue, redTeam: red, winner: null, durationSeconds: null }]
    },
    complete: true,
    reasons: []
  }));

  await page.route('**/v1/lol/games/**/live**', route => {
    const timestamp = new Date().toISOString();
    return fulfillJson(route, {
      schemaVersion: '1.0',
      esport: 'lol',
      provider,
      series,
      game,
      stats: {
        gameClockSeconds: 1_200,
        patch: '26.15.1',
        blue: teamStats(blue, 'blue'),
        red: teamStats(red, 'red')
      },
      quality: {
        freshness: 'fresh',
        sourceTimestamp: timestamp,
        observedAt: timestamp,
        ageSeconds: 1,
        complete: true,
        advancing: true,
        safeForLiveAnalysis: true,
        reasons: []
      }
    });
  });
}

test('shows live champion levels on both matchup-board portraits', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installFixtures(page);

  await page.goto('/');
  await page.locator('[data-series-id="series-levels"]').click();

  const blueLevel = page.locator('.v2-matchup-row').first().locator('.v2-player.blue .champion-level-badge');
  const redLevel = page.locator('.v2-matchup-row').first().locator('.v2-player.red .champion-level-badge');

  await expect(blueLevel).toHaveText('13');
  await expect(blueLevel).toHaveAttribute('aria-label', 'Champion level 13');
  await expect(redLevel).toHaveText('12');
  await expect(redLevel).toHaveAttribute('aria-label', 'Champion level 12');
  expect(pageErrors).toEqual([]);
});
