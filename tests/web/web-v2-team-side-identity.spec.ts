import { expect, test, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const hle = { id: 'hle-challengers', name: 'HLE Challengers', code: 'HLE' };
const krx = { id: 'krx-challengers', name: 'KRX Challengers', code: 'KRX' };

const series = {
  id: 'series-challengers-side-swap',
  esport: 'lol',
  competition: { id: 'challengers', name: 'LCK Challengers', stage: 'Regular Season' },
  teams: [hle, krx],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 45 * 60 * 1_000).toISOString(),
  games: [
    { id: 'challengers-game-1', number: 1, state: 'completed' },
    { id: 'challengers-game-2', number: 2, state: 'live' }
  ]
};

const roles = ['top', 'jungle', 'mid', 'bottom', 'support'];
const blueHandles = ['KRX Rich', 'KRX Willer', 'KRX AK', 'KRX LazyFeel', 'KRX Moham'];
const redHandles = ['HLE Pades', 'HLE Juhan', 'HLE Crimson', 'HLE Pyosik', 'HLE Bull'];

function players(side: 'blue' | 'red') {
  const handles = side === 'blue' ? blueHandles : redHandles;
  return handles.map((handle, index) => ({
    id: `${side}-${index + 1}`,
    handle,
    championId: null,
    role: roles[index]!,
    level: 16,
    kills: index,
    deaths: 2,
    assists: 5,
    creepScore: 180 + index * 10,
    totalGold: 9_000 + index * 200,
    items: []
  }));
}

function statsTeam(
  ref: typeof hle,
  side: 'blue' | 'red',
  telemetryName: string
) {
  return {
    id: ref.id,
    name: telemetryName,
    side,
    gold: side === 'blue' ? 49_000 : 53_500,
    kills: side === 'blue' ? 19 : 27,
    objectives: {
      towers: side === 'blue' ? 5 : 9,
      inhibitors: side === 'blue' ? 0 : 1,
      dragons: side === 'blue' ? ['cloud', 'infernal'] : ['ocean', 'mountain', 'hextech', 'elder'],
      barons: side === 'blue' ? 0 : 2,
      heralds: 1,
      grubs: 3
    },
    players: players(side)
  };
}

const snapshot = {
  schemaVersion: '1.0',
  esport: 'lol',
  provider,
  series,
  game: series.games[1],
  stats: {
    gameClockSeconds: 2_252,
    patch: '26.15.1',
    blue: statsTeam(krx, 'blue', 'KRX'),
    red: statsTeam(hle, 'red', 'HLE')
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

test('web v2 resolves live team names and player prefixes by side identity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
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
      events: history ? [] : [{ series, provider, observedAt: new Date().toISOString() }]
    });
  });
  await page.route('**/v1/lol/games/challengers-game-2/live**', route => json(route, snapshot));

  await page.goto('/v2/');
  const card = page.locator('[data-series-id="series-challengers-side-swap"]');
  await expect(card).toBeVisible();
  await card.click();

  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page.locator('#blue-name')).toHaveText('KRX Challengers');
  await expect(page.locator('#red-name')).toHaveText('HLE Challengers');

  const blueNames = page.locator('.blue-player .player-copy strong');
  const redNames = page.locator('.red-player .player-copy strong');
  await expect(blueNames).toHaveCount(5);
  await expect(redNames).toHaveCount(5);
  await expect(blueNames.first()).toHaveText('KRX Rich');
  await expect(redNames.first()).toHaveText('HLE Pades');

  const labels = await page.locator('.player-copy strong').allTextContents();
  expect(labels.some(label => label.includes('HLE KRX'))).toBe(false);
  expect(labels.some(label => label.includes('KRX HLE'))).toBe(false);
});
