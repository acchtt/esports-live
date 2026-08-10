import { expect, test, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blueTeam = { id: 'blue-team', name: 'Blue Team', code: 'BLU' };
const redTeam = { id: 'red-team', name: 'Red Team', code: 'RED' };
const series = {
  id: 'series-grubs',
  esport: 'lol',
  competition: { id: 'test-league', name: 'Test League', stage: 'Week 1' },
  teams: [blueTeam, redTeam],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 5 * 60 * 1_000).toISOString(),
  games: [{ id: 'game-grubs-1', number: 1, state: 'live' }]
};

function team(side: 'blue' | 'red') {
  const ref = side === 'blue' ? blueTeam : redTeam;
  return {
    id: ref.id,
    name: ref.name,
    side,
    gold: side === 'blue' ? 31_200 : 29_800,
    kills: side === 'blue' ? 8 : 6,
    objectives: {
      towers: side === 'blue' ? 4 : 3,
      inhibitors: 0,
      dragons: side === 'blue' ? ['infernal'] : ['cloud'],
      barons: 0,
      heralds: side === 'blue' ? 1 : 0,
      grubs: side === 'blue' ? 4 : 2
    },
    players: []
  };
}

const snapshot = {
  schemaVersion: '1.0',
  esport: 'lol',
  provider,
  series,
  game: series.games[0],
  stats: {
    gameClockSeconds: 812,
    patch: '26.15.1',
    blue: team('blue'),
    red: team('red')
  },
  quality: {
    freshness: 'fresh',
    sourceTimestamp: new Date().toISOString(),
    observedAt: new Date().toISOString(),
    ageSeconds: 1,
    complete: true,
    advancing: true,
    safeForLiveAnalysis: true,
    reasons: []
  }
};

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

test('ARENA V2 renders Riot Void Grubs counts without overflowing mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.route('**/v1/lol/series/**/context**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: series.id,
    provider,
    observedAt: new Date().toISOString(),
    rosters: [],
    standings: [],
    complete: false,
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => json(route, snapshot));

  await page.goto('/v2/');
  const match = page.locator('[data-series-id="series-grubs"]');
  await expect(match).toBeVisible();
  await match.click();

  const card = page.locator('[data-objective="grubs"]');
  await expect(card).toBeVisible();
  await expect(card.locator('> span')).toHaveText('GRUBS');
  await expect(card.locator('[data-side="blue"]')).toHaveText('4');
  await expect(card.locator('[data-side="red"]')).toHaveText('2');
  await expect(page.locator('.objective-grid article')).toHaveCount(5);

  const icon = await card.locator('> span').evaluate(element => (
    getComputedStyle(element, '::before').backgroundImage
  ));
  expect(icon).toContain('grubs');

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
});
