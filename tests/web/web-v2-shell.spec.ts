import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const alpha = { id: 'alpha', name: 'Alpha Five', code: 'ALP' };
const bravo = { id: 'bravo', name: 'Bravo Core', code: 'BRV' };
const delta = { id: 'delta', name: 'Delta Club', code: 'DLC' };
const echo = { id: 'echo', name: 'Echo Squad', code: 'ECH' };

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

const historySeries = {
  id: 'series-v2-history',
  esport: 'lol',
  competition: { id: 'competition-history', name: 'V2 History League', stage: 'Final' },
  teams: [delta, echo],
  bestOf: 1,
  state: 'completed',
  scheduledStart: iso(-2 * 60 * 60 * 1_000),
  games: [{ id: 'game-v2-history-1', number: 1, state: 'completed' }]
};

function team(teamRef: typeof alpha, side: 'blue' | 'red', live: boolean) {
  return {
    id: teamRef.id,
    name: teamRef.name,
    side,
    gold: side === 'blue' ? (live ? 31_400 : 38_500) : (live ? 29_100 : 31_200),
    kills: side === 'blue' ? (live ? 10 : 16) : (live ? 7 : 9),
    objectives: {
      towers: side === 'blue' ? 6 : 3,
      inhibitors: side === 'blue' ? 1 : 0,
      dragons: side === 'blue' ? ['infernal', 'cloud'] : ['mountain'],
      barons: side === 'blue' ? 1 : 0,
      heralds: 1,
      grubs: 3
    },
    players: []
  };
}

function snapshot(gameId: string) {
  const historical = gameId !== 'game-v2-2';
  const series = gameId === 'game-v2-history-1' ? historySeries : activeSeries;
  const game = series.games.find(item => item.id === gameId) ?? series.games[0];
  const left = series.teams[0];
  const right = series.teams[1];
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game,
    stats: {
      gameClockSeconds: historical ? 1_945 : 1_322,
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
      events: [{
        series: history ? historySeries : activeSeries,
        provider,
        observedAt: iso()
      }]
    });
  });
  await page.route('**/v1/lol/games/**/live**', route => {
    const match = route.request().url().match(/games\/([^/]+)\/live/);
    return json(route, snapshot(decodeURIComponent(match?.[1] ?? 'game-v2-2')));
  });
}

test('web v2 keeps one scoreboard mounted while views and games change', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installFixtures(page);
  await page.goto('/v2/');

  await expect(page).toHaveTitle('Esports Live V2');
  await expect(page.getByRole('link', { name: 'Current site' })).toHaveAttribute('href', '../');
  await expect(page.locator('[data-series-id="series-v2-live"]')).toBeVisible();
  await expect(page.locator('#stage-title')).toHaveText('Alpha Five vs Bravo Core');
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page.locator('#game-clock')).toHaveText('22:02');

  const scoreboard = page.locator('#scoreboard');
  await scoreboard.evaluate(element => { element.dataset.identity = 'persistent'; });

  await page.getByRole('button', { name: /Game 1 Final/i }).click();
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');
  await expect(page.locator('#game-clock')).toHaveText('32:25');
  await expect(scoreboard).toHaveAttribute('data-identity', 'persistent');

  await page.getByRole('button', { name: 'History', exact: true }).first().click();
  await expect(page.locator('[data-series-id="series-v2-history"]')).toBeVisible();
  await expect(page.locator('#stage-title')).toHaveText('Delta Club vs Echo Squad');
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');
  await expect(scoreboard).toHaveAttribute('data-identity', 'persistent');

  await page.getByRole('button', { name: 'Standings', exact: true }).first().click();
  await expect(page.locator('#standings-panel')).toBeVisible();
  await expect(scoreboard).toBeHidden();
  expect(errors).toEqual([]);
});

test('web v2 mobile navigation changes mounted panels without layout replacement', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/v2/');

  const mobileNav = page.locator('.mobile-nav');
  await expect(mobileNav).toBeVisible();
  await expect(page.locator('#scoreboard')).toBeVisible();
  await mobileNav.getByRole('button', { name: /History/ }).click();
  await expect(page.locator('[data-series-id="series-v2-history"]')).toBeVisible();
  await mobileNav.getByRole('button', { name: /Standings/ }).click();
  await expect(page.locator('#standings-panel')).toBeVisible();
});
