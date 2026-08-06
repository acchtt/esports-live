import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blueTeam = { id: 'blue-team', name: "Anyone's Legend", code: 'AL' };
const redTeam = { id: 'red-team', name: "Xi'an Team WE", code: 'WE' };
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'];
const champions = ['Ornn', 'Vi', 'Syndra', 'Jinx', 'Rakan'];

function players(side: 'blue' | 'red') {
  return roles.map((role, index) => ({
    id: `${side}-${role}`,
    handle: `${side === 'blue' ? 'AL' : 'WE'}Player${index + 1}`,
    championId: champions[index],
    role,
    level: 16,
    kills: side === 'blue' ? 5 - Math.min(index, 3) : 4 - Math.min(index, 3),
    deaths: 2 + (index % 3),
    assists: 6 + index,
    creepScore: 180 + index * 12,
    totalGold: side === 'blue' ? 10_400 + index * 420 : 9_700 + index * 310,
    items: ['1001', '2003']
  }));
}

const series = {
  id: 'series-density',
  esport: 'lol',
  competition: { id: 'lpl', name: 'LPL', stage: 'Regular Season' },
  teams: [blueTeam, redTeam],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 30 * 60 * 1_000).toISOString(),
  games: [{ id: 'game-density-2', number: 2, state: 'live' }]
};

const snapshot = {
  schemaVersion: '1.0',
  esport: 'lol',
  provider,
  series,
  game: series.games[0],
  stats: {
    gameClockSeconds: 2_117,
    patch: '26.15.1',
    blue: {
      id: blueTeam.id,
      name: blueTeam.name,
      side: 'blue',
      gold: 51_400,
      kills: 23,
      objectives: {
        towers: 4,
        inhibitors: 0,
        dragons: ['infernal', 'cloud'],
        barons: 0,
        heralds: 1,
        grubs: 3
      },
      players: players('blue')
    },
    red: {
      id: redTeam.id,
      name: redTeam.name,
      side: 'red',
      gold: 48_300,
      kills: 20,
      objectives: {
        towers: 7,
        inhibitors: 1,
        dragons: ['mountain', 'ocean'],
        barons: 2,
        heralds: 0,
        grubs: 2
      },
      players: players('red')
    }
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

async function installFixtures(page: Page): Promise<void> {
  await page.route('**/health', route => json(route, {
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
  await page.route('**/v1/lol/games/**/live**', route => json(route, snapshot));
}

test('V2 mobile statboard matches the compact legacy density and clears the nav', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/v2/');
  await page.locator('[data-series-id="series-density"]').click();

  const rows = page.locator('.player-row');
  await expect(rows).toHaveCount(5);
  await expect(page.locator('.scoreboard-footer')).toBeHidden();

  const teamBanner = await page.locator('.team-banner').boundingBox();
  const objectiveCard = await page.locator('.objective-grid article').first().boundingBox();
  const firstRow = await rows.first().boundingBox();
  const portrait = await page.locator('.champion-portrait').first().boundingBox();
  expect(teamBanner?.height).toBeLessThanOrEqual(86);
  expect(objectiveCard?.height).toBeLessThanOrEqual(66);
  expect(firstRow?.height).toBeLessThanOrEqual(78);
  expect(portrait?.height).toBeLessThanOrEqual(42);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(50);
  const lastRow = await rows.last().boundingBox();
  const navigation = await page.locator('.mobile-nav').boundingBox();
  expect(lastRow).not.toBeNull();
  expect(navigation).not.toBeNull();
  expect((lastRow?.y ?? 0) + (lastRow?.height ?? 0)).toBeLessThanOrEqual((navigation?.y ?? 0) - 8);

  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
});
