import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue-route', name: 'Route Blue', code: 'RBL', imageUrl: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22/%3E' };
const red = { id: 'red-route', name: 'Route Red', code: 'RRD', imageUrl: blue.imageUrl };
const series = {
  id: 'series-routed',
  esport: 'lol',
  competition: { id: 'route-league', name: 'Route League', stage: 'Regular Season' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 30 * 60_000).toISOString(),
  games: [
    { id: 'game-routed-1', number: 1, state: 'completed' },
    { id: 'game-routed-2', number: 2, state: 'live' },
    { id: 'game-routed-3', number: 3, state: 'unstarted' }
  ]
};

function player(id: string, handle: string, championId: string, items: readonly string[]) {
  return {
    id,
    handle,
    championId,
    role: 'top',
    level: 16,
    kills: 4,
    deaths: 2,
    assists: 7,
    creepScore: 245,
    totalGold: 12_400,
    items
  };
}

function snapshot(gameId: string) {
  const game = series.games.find(item => item.id === gameId) ?? series.games[1]!;
  const completed = game.id === 'game-routed-1';
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: {
      ...series,
      state: completed ? 'live' : series.state,
      games: series.games
    },
    game,
    stats: {
      gameClockSeconds: completed ? 1_920 : 1_245,
      patch: '26.15.1',
      blue: {
        id: blue.id,
        name: blue.name,
        side: 'blue',
        gold: completed ? 47_000 : 31_200,
        kills: completed ? 12 : 7,
        objectives: { towers: 5, inhibitors: 0, dragons: ['cloud'], barons: 0, heralds: 1, grubs: null },
        players: [player('route-blue-top', 'RBL Top', 'Aatrox', ['3078'])]
      },
      red: {
        id: red.id,
        name: red.name,
        side: 'red',
        gold: completed ? 44_000 : 30_600,
        kills: completed ? 9 : 6,
        objectives: { towers: 3, inhibitors: 0, dragons: [], barons: 0, heralds: 0, grubs: null },
        players: [player('route-red-top', 'RRD Top', 'Renekton', ['3157'])]
      }
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: now,
      observedAt: now,
      ageSeconds: 1,
      complete: true,
      advancing: !completed,
      safeForLiveAnalysis: !completed,
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
      await json(route, ['16.16.1']);
      return;
    }
    if (/^\/cdn\/16\.16\.1\/img\/item\/(?:3078|3157)\.png$/.test(url.pathname)) {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#d7e4ff"/></svg>'
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
  await page.route('**/v1/lol/games/**/live**', route => {
    const match = route.request().url().match(/games\/([^/?]+)\/live/);
    return json(route, snapshot(decodeURIComponent(match?.[1] ?? 'game-routed-2')));
  });
}

test('V3 navigates from the catalogue to a shareable match route and back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  await expect(page.locator('[data-series-id="series-routed"]')).toBeVisible();
  await page.locator('[data-series-id="series-routed"]').click();

  await expect(page).toHaveURL(/\/match\/series-routed\/game-routed-2(?:\?|$)/);
  await expect(page.locator('#detail-title')).toHaveText('Route Blue vs Route Red');
  await expect(page.locator('.build-pill')).toContainText('V3 · ROUTED');
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page.locator('#quality-text')).toBeVisible();
  await expect(page.locator('#quality-text')).toHaveText('LIVE DATA · Updated just now');
  await expect(page.locator('#quality-text')).toHaveAttribute('data-status', 'live');
  await expect(page.locator('#catalogue-panel')).toHaveCount(0);
  await expect(page.locator('.detail-header > div')).toBeVisible();
  await expect(page.locator('.back-button')).toBeVisible();
  await expect(page.locator('#game-tabs')).toBeVisible();
  await expect(page.locator('#game-label')).not.toHaveAttribute('role', 'button');

  const matchLayout = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.detail-header')?.getBoundingClientRect();
    const tabs = document.querySelector<HTMLElement>('#game-tabs')?.getBoundingClientRect();
    const scoreboard = document.querySelector<HTMLElement>('#scoreboard')?.getBoundingClientRect();
    return {
      headerTop: header?.top ?? -1,
      headerBottom: header?.bottom ?? -1,
      tabsTop: tabs?.top ?? -1,
      tabsBottom: tabs?.bottom ?? -1,
      scoreboardTop: scoreboard?.top ?? -1,
      scrollY: window.scrollY
    };
  });
  expect(matchLayout.scrollY).toBe(0);
  expect(matchLayout.headerTop).toBeGreaterThanOrEqual(0);
  expect(matchLayout.tabsTop).toBeGreaterThan(matchLayout.headerBottom);
  expect(matchLayout.scoreboardTop).toBeGreaterThan(matchLayout.tabsBottom);

  await expect(page.locator('.player-items')).toHaveCount(2);
  await expect(page.locator('.player-items').first()).toBeHidden();
  await expect(page.locator('.player-item-slot img').first()).toBeHidden();

  const scoreboardScale = await page.locator('#scoreboard').evaluate(scoreboard => {
    const box = (selector: string) => scoreboard.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
    const scoreboardBox = scoreboard.getBoundingClientRect();
    const header = box('.scoreboard-header');
    const team = box('.team-banner');
    const player = box('.player-row');
    const portrait = box('.champion-portrait');
    return {
      width: scoreboardBox.width,
      headerHeight: header?.height ?? 0,
      teamHeight: team?.height ?? 0,
      playerHeight: player?.height ?? 0,
      portraitWidth: portrait?.width ?? 0
    };
  });
  expect(scoreboardScale.width).toBeGreaterThanOrEqual(370);
  expect(scoreboardScale.headerHeight).toBeGreaterThanOrEqual(40);
  expect(scoreboardScale.teamHeight).toBeGreaterThanOrEqual(66);
  expect(scoreboardScale.playerHeight).toBeGreaterThanOrEqual(76);
  expect(scoreboardScale.portraitWidth).toBeGreaterThanOrEqual(40);

  const tabsFit = await page.locator('#game-tabs').evaluate(tabs => {
    const last = tabs.querySelector<HTMLElement>('[data-game-id]:last-child');
    const outer = tabs.getBoundingClientRect();
    const inner = last?.getBoundingClientRect();
    return inner ? inner.right <= outer.right - 3 && inner.left >= outer.left + 3 : false;
  });
  expect(tabsFit).toBe(true);

  await page.locator('#game-tabs [data-game-id="game-routed-1"]').click();
  await expect(page).toHaveURL(/\/match\/series-routed\/game-routed-1(?:\?|$)/);
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');
  await expect(page.locator('#quality-text')).toHaveText('FINAL DATA · Complete snapshot');
  await expect(page.locator('#quality-text')).toHaveAttribute('data-status', 'final');
  await expect(page.locator('#game-tabs')).toBeVisible();

  await page.locator('.back-button').click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('#catalogue-panel')).toBeVisible();
  await expect(page.locator('[data-series-id="series-routed"]')).toBeVisible();
});

test('V3 opens a deep match URL directly, including the /v3 compatibility base', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);

  await page.goto('/match/series-routed/game-routed-1');
  await expect(page.locator('#detail-title')).toHaveText('Route Blue vs Route Red');
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');
  await expect(page.locator('#game-tabs')).toBeVisible();
  await expect(page.locator('#catalogue-panel')).toHaveCount(0);
  await expect(page).toHaveURL(/\/match\/series-routed\/game-routed-1$/);

  await page.goto('/v3/match/series-routed/game-routed-2');
  await expect(page.locator('#detail-title')).toHaveText('Route Blue vs Route Red');
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page.locator('#game-tabs')).toBeVisible();
  await expect(page.locator('#catalogue-panel')).toHaveCount(0);
  await expect(page).toHaveURL(/\/v3\/match\/series-routed\/game-routed-2$/);
});

test('V3 match scrolling stops at the bottom of the scoreboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 420 });
  await installFixtures(page);
  await page.goto('/match/series-routed/game-routed-2');
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page.locator('.mobile-nav')).toBeHidden();

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(50);

  const boundary = await page.locator('#scoreboard').evaluate(scoreboard => {
    const root = document.scrollingElement ?? document.documentElement;
    const box = scoreboard.getBoundingClientRect();
    return {
      scoreboardBottom: box.bottom + window.scrollY,
      documentBottom: root.scrollHeight,
      scrollY: window.scrollY,
      maxScrollY: Math.max(0, root.scrollHeight - window.innerHeight)
    };
  });

  expect(Math.abs(boundary.documentBottom - boundary.scoreboardBottom)).toBeLessThanOrEqual(2);
  expect(Math.abs(boundary.maxScrollY - boundary.scrollY)).toBeLessThanOrEqual(2);
});

test('V3 match routes preserve foreground schedule and snapshot refreshes', async ({ page }) => {
  let scheduleRequests = 0;
  let snapshotRequests = 0;
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/v1/lol/schedule')) scheduleRequests += 1;
    if (/\/v1\/lol\/games\/[^/]+\/live$/.test(url.pathname)) snapshotRequests += 1;
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/match/series-routed/game-routed-2');
  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');

  // Initial navigation can itself emit focus/pageshow. Wait past the production
  // foreground debounce before modelling a later return to the app.
  await page.waitForTimeout(300);
  const schedulesBeforeFocus = scheduleRequests;
  const snapshotsBeforeFocus = snapshotRequests;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect.poll(() => scheduleRequests).toBeGreaterThan(schedulesBeforeFocus);
  await expect.poll(() => snapshotRequests).toBeGreaterThan(snapshotsBeforeFocus);
  await expect(page.locator('#catalogue-panel')).toHaveCount(0);
});
