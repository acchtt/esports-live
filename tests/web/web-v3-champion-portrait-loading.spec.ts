import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blueTeam = { id: 'hle', name: 'HLE Challengers', code: 'HLE', imageUrl: null };
const redTeam = { id: 'krx', name: 'KRX Challengers', code: 'KRX', imageUrl: null };
const game = { id: 'portrait-game', number: 1, state: 'live' };
const series = {
  id: 'portrait-series',
  esport: 'lol',
  competition: { id: 'lck-cl', name: 'LCK Challengers', stage: 'Regular Season' },
  teams: [blueTeam, redTeam],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 30 * 60_000).toISOString(),
  games: [game]
};

const bluePlayers = [
  ['top', 'Panther', 'Olaf'],
  ['jungle', 'Jackal', 'Naafiri'],
  ['mid', 'Cracker', 'Akali'],
  ['bottom', 'Pyeonsik', 'Jhin'],
  ['support', 'Bluffing', 'Camille']
] as const;

const redPlayers = [
  ['top', 'Rich', 'Ambessa'],
  ['jungle', 'Winner', 'Wukong'],
  ['mid', 'AKaJe', 'Orianna'],
  ['bottom', 'LazyFeel', 'Lucian'],
  ['support', 'Minous', 'Milio']
] as const;

function player(team: string, entry: readonly [string, string, string], index: number) {
  const [role, handle, championId] = entry;
  return {
    id: `${team}-${role}`,
    handle,
    championId,
    role,
    level: 16,
    kills: index + 1,
    deaths: 2,
    assists: 5,
    creepScore: 220 + index * 10,
    totalGold: 10_000 + index * 500,
    items: []
  };
}

function snapshot() {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game,
    stats: {
      gameClockSeconds: 1_917,
      patch: '26.15.1',
      blue: {
        id: blueTeam.id,
        name: blueTeam.name,
        side: 'blue',
        gold: 45_000,
        kills: 12,
        objectives: { towers: 2, inhibitors: 0, dragons: ['cloud', 'infernal', 'ocean'], barons: 0, heralds: 1, grubs: null },
        players: bluePlayers.map((entry, index) => player('blue', entry, index))
      },
      red: {
        id: redTeam.id,
        name: redTeam.name,
        side: 'red',
        gold: 50_200,
        kills: 16,
        objectives: { towers: 10, inhibitors: 2, dragons: ['mountain'], barons: 2, heralds: 0, grubs: null },
        players: redPlayers.map((entry, index) => player('red', entry, index))
      }
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

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

async function installFixtures(page: Page): Promise<void> {
  await page.route('https://ddragon.leagueoflegends.com/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/versions.json') {
      await route.abort();
      return;
    }
    if (/^\/cdn\/16\.15\.1\/img\/champion\/[A-Za-z0-9]+\.png$/.test(url.pathname)) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#9cc8ff"/></svg>'
      });
      return;
    }
    await route.abort();
  });

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
    history: { bestOf: 3, winsRequired: 2, drawPossible: false, score: [], games: [] },
    complete: false,
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => json(route, snapshot()));
}

test('V3 champion portraits load immediately without waiting for version metadata', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/match/portrait-series/portrait-game');

  const portraits = page.locator('.champion-portrait img');
  await expect(portraits).toHaveCount(10);
  await expect(portraits).toHaveAttribute('loading', 'eager');
  await expect(portraits).toHaveAttribute('fetchpriority', 'high');

  await expect.poll(async () => portraits.evaluateAll(images => images.every(image => {
    const portrait = image as HTMLImageElement;
    return portrait.complete
      && portrait.naturalWidth > 0
      && portrait.dataset.championPortraitSource === 'square'
      && /\/cdn\/16\.15\.1\/img\/champion\/[A-Za-z0-9]+\.png$/.test(new URL(portrait.src).pathname);
  }))).toBe(true);

  const loadingArtStillDisplayed = await portraits.evaluateAll(images => images.some(image => (
    (image as HTMLImageElement).src.includes('/img/champion/loading/')
  )));
  expect(loadingArtStillDisplayed).toBe(false);
});
