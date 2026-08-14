import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const hle = {
  id: 'hle-challengers',
  name: 'HLE Challengers',
  code: 'HLE',
  imageUrl: 'http://static.lolesports.com/teams/hle-test.svg'
};
const krx = {
  id: 'krx-challengers',
  name: 'KRX Challengers',
  code: 'KRX',
  imageUrl: 'http://static.lolesports.com/teams/krx-test.svg'
};

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
  ],
  score: [{ team: hle, wins: 1 }, { team: krx, wins: 0 }]
};

const roles = ['top', 'jungle', 'mid', 'bottom', 'support'];
const blueHandles = ['KRX Rich', 'KRX Willer', 'KRX AK', 'KRX LazyFeel', 'KRX Moham'];
const redHandles = ['HLE Pades', 'HLE Juhan', 'HLE Crimson', 'HLE Pyosik', 'HLE Bull'];
const blueChampions = ['Aurora', 'Wukong', 'Ahri', 'Ezreal', 'Nautilus'];
const redChampions = ['KSante', 'Vi', 'Azir', 'Kaisa', 'Rakan'];

function players(side: 'blue' | 'red') {
  const handles = side === 'blue' ? blueHandles : redHandles;
  const champions = side === 'blue' ? blueChampions : redChampions;
  return handles.map((handle, index) => ({
    id: `${side}-${index + 1}`,
    handle,
    championId: champions[index]!,
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
  telemetryName: string,
  kills: number
) {
  return {
    id: ref.id,
    name: telemetryName,
    side,
    gold: side === 'blue' ? 49_000 : 53_500,
    kills,
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

function snapshotAt(blueKills = 19, sourceTimestamp = new Date().toISOString()) {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[1],
    stats: {
      gameClockSeconds: 2_252,
      patch: '26.15.1',
      blue: { ...statsTeam(krx, 'blue', 'Blue team', blueKills), id: 'team-1' },
      red: { ...statsTeam(hle, 'red', 'Red team', 27), id: 'team-2' }
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp,
      observedAt: sourceTimestamp,
      ageSeconds: 1,
      complete: true,
      advancing: true,
      safeForLiveAnalysis: true,
      reasons: []
    }
  };
}

function context(gameTwoState: 'live' | 'completed') {
  const gameTwoWinner = gameTwoState === 'completed' ? krx : null;
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
        { team: hle, wins: 1 },
        { team: krx, wins: gameTwoWinner ? 1 : 0 }
      ],
      games: [
        {
          id: 'challengers-game-1',
          number: 1,
          state: 'completed',
          blueTeam: hle,
          redTeam: krx,
          winner: hle,
          durationSeconds: 2_101
        },
        {
          id: 'challengers-game-2',
          number: 2,
          state: gameTwoState,
          blueTeam: krx,
          redTeam: hle,
          winner: gameTwoWinner,
          durationSeconds: gameTwoWinner ? 2_252 : null
        }
      ]
    },
    complete: true,
    reasons: []
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installCommon(page: Page, gameContext = context('live')): Promise<void> {
  await page.route('https://ddragon.leagueoflegends.com/**', route => route.abort());
  await page.route('https://static.lolesports.com/teams/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#22d3ee"/></svg>'
  }));
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
  await page.route('**/v1/lol/series/**/context**', route => json(route, gameContext));
}

test('web v2 resolves side identity, team logos and champion-board copy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installCommon(page);
  await page.route('**/v1/lol/games/challengers-game-2/live**', route => json(route, snapshotAt()));

  await page.goto('/v2/');
  const card = page.locator('[data-series-id="series-challengers-side-swap"]');
  await expect(card).toBeVisible();
  const catalogueLogos = card.locator('.match-team-logo');
  await expect(catalogueLogos).toHaveCount(2);
  await expect(catalogueLogos.nth(0)).toHaveAttribute('src', hle.imageUrl.replace('http:', 'https:'));
  await expect(catalogueLogos.nth(1)).toHaveAttribute('src', krx.imageUrl.replace('http:', 'https:'));
  await expect(card.locator('.match-series-score')).toHaveText('1 – 0');
  await expect(catalogueLogos.nth(0)).toHaveAttribute('loading', 'eager');
  await expect(catalogueLogos.nth(0)).toHaveAttribute('fetchpriority', 'high');
  await card.click();

  await expect(page.locator('#game-label')).toHaveText('Game 2 · Live');
  await expect(page.locator('#blue-name')).toHaveText('KRX Challengers');
  await expect(page.locator('#red-name')).toHaveText('HLE Challengers');
  await expect(page.locator('.team-side.blue')).not.toContainText('BLUE SIDE');
  await expect(page.locator('.team-side.red')).not.toContainText('RED SIDE');
  await expect(page.locator('#blue-logo')).toBeVisible();
  await expect(page.locator('#red-logo')).toBeVisible();
  await expect(page.locator('#blue-logo')).toHaveAttribute('src', krx.imageUrl.replace('http:', 'https:'));
  await expect(page.locator('#red-logo')).toHaveAttribute('src', hle.imageUrl.replace('http:', 'https:'));

  const blueNames = page.locator('.blue-player .player-copy strong');
  const redNames = page.locator('.red-player .player-copy strong');
  await expect(blueNames).toHaveCount(5);
  await expect(redNames).toHaveCount(5);
  await expect(blueNames.first()).toHaveText('KRX Rich');
  await expect(redNames.first()).toHaveText('HLE Pades');

  const blueStats = page.locator('.blue-player .player-statline');
  const redStats = page.locator('.red-player .player-statline');
  await expect(blueStats).toHaveCount(5);
  await expect(redStats).toHaveCount(5);
  await expect(blueStats.first()).toHaveText('0/2/5 · 180 CS');
  await expect(redStats.first()).toHaveText('0/2/5 · 180 CS');

  const blueChampionNames = page.locator('.blue-player .player-champion');
  const redChampionNames = page.locator('.red-player .player-champion');
  await expect(blueChampionNames).toHaveCount(5);
  await expect(redChampionNames).toHaveCount(5);
  await expect(blueChampionNames.first()).toHaveText('Aurora');
  await expect(redChampionNames.first()).toHaveText("K'Sante");

  const labels = await page.locator('.player-copy strong').allTextContents();
  expect(labels.some(label => label.includes('HLE KRX'))).toBe(false);
  expect(labels.some(label => label.includes('KRX HLE'))).toBe(false);
});

test('web v2 forces a cursorless game refresh after page lifecycle resume', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installCommon(page);

  const staleTimestamp = new Date(Date.now() - 10_000).toISOString();
  const freshTimestamp = new Date().toISOString();
  const requestUrls: string[] = [];
  await page.route('**/v1/lol/games/challengers-game-2/live**', route => {
    const url = route.request().url();
    requestUrls.push(url);
    const cursorless = !new URL(url).searchParams.has('after');
    const refreshed = cursorless && requestUrls.length > 1;
    return json(route, snapshotAt(refreshed ? 23 : 19, refreshed ? freshTimestamp : staleTimestamp));
  });

  await page.goto('/v2/');
  await page.locator('[data-series-id="series-challengers-side-swap"]').click();
  await expect(page.locator('#blue-kills')).toHaveText('19');

  await page.evaluate(() => document.dispatchEvent(new Event('resume')));

  await expect(page.locator('#blue-kills')).toHaveText('23');
  await expect.poll(() => requestUrls.filter(url => !new URL(url).searchParams.has('after')).length)
    .toBeGreaterThanOrEqual(2);
});

test('web v2 reconciles a stale live frame to final and declares the winner', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installCommon(page, context('completed'));
  await page.route('**/v1/lol/games/challengers-game-2/live**', route => json(route, snapshotAt()));

  await page.goto('/v2/');
  await page.locator('[data-series-id="series-challengers-side-swap"]').click();

  await expect(page.locator('#game-label')).toHaveText('Game 2 · Final');
  await expect(page.locator('#scoreboard')).toHaveAttribute('data-game-state', 'completed');
  await expect(page.locator('#gold-lead-label')).toHaveText('WINNER');
  await expect(page.locator('#gold-lead')).toHaveText('KRX');
  await expect(page.locator('#scoreboard')).toHaveAttribute('data-winner-side', 'blue');
  await expect(page.locator('#scoreboard-notice')).toHaveText('KRX Challengers won Game 2.');
});

test('web v2 rejects contradictory stale catalogue finality while preserving partial series', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const now = Date.now();
  const staleLive = {
    id: 'tes-blg-stale-live',
    esport: 'lol',
    competition: { id: 'lpl', name: 'LPL' },
    teams: [hle, krx],
    bestOf: 3,
    state: 'live',
    scheduledStart: new Date(now - 4 * 60 * 60 * 1_000).toISOString(),
    games: [
      { id: 'tes-game-1', number: 1, state: 'completed' },
      { id: 'tes-game-2', number: 2, state: 'completed' },
      { id: 'tes-game-3', number: 3, state: 'live' }
    ]
  };
  const staleUpcoming = {
    id: 'ns-kt-stale-upcoming',
    esport: 'lol',
    competition: { id: 'lck-cl', name: 'LCK Challengers' },
    teams: [hle, krx],
    bestOf: 3,
    state: 'scheduled',
    scheduledStart: new Date(now - 10 * 60 * 60 * 1_000).toISOString(),
    games: [
      { id: 'ns-game-1', number: 1, state: 'unstarted' },
      { id: 'ns-game-2', number: 2, state: 'unstarted' },
      { id: 'ns-game-3', number: 3, state: 'unstarted' }
    ]
  };
  const partialLive = {
    id: 'partial-live',
    esport: 'lol',
    competition: { id: 'lck', name: 'LCK' },
    teams: [hle, krx],
    bestOf: 3,
    state: 'live',
    scheduledStart: new Date(now - 3 * 60 * 60 * 1_000).toISOString(),
    games: [
      { id: 'partial-game-1', number: 1, state: 'completed' },
      { id: 'partial-game-2', number: 2, state: 'completed' },
      { id: 'partial-game-3', number: 3, state: 'live' }
    ]
  };
  const future = {
    id: 'future-series',
    esport: 'lol',
    competition: { id: 'future', name: 'Future League' },
    teams: [hle, krx],
    bestOf: 3,
    state: 'scheduled',
    scheduledStart: new Date(now + 60 * 60 * 1_000).toISOString(),
    games: [{ id: 'future-game-1', number: 1, state: 'unstarted' }]
  };
  const contextFor = (value: typeof staleLive, leftWins: number, rightWins: number) => ({
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: value.id,
    provider,
    observedAt: new Date().toISOString(),
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [
        { team: hle, wins: leftWins },
        { team: krx, wins: rightWins }
      ],
      games: value.games.map((game, index) => ({
        ...game,
        state: index < 2 ? 'completed' : game.state,
        blueTeam: hle,
        redTeam: krx,
        winner: index === 0 ? hle : index === 1 ? krx : null,
        durationSeconds: index < 2 ? 2_000 + index * 100 : null
      }))
    },
    complete: true,
    reasons: []
  });
  const requested: string[] = [];

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
      events: history ? [] : [staleLive, partialLive, staleUpcoming, future].map(value => ({
        series: value,
        provider,
        observedAt: new Date().toISOString()
      }))
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => {
    const match = route.request().url().match(/series\/([^/]+)\/context/);
    const id = decodeURIComponent(match?.[1] ?? '');
    requested.push(id);
    if (id === staleLive.id) return json(route, contextFor(staleLive, 2, 1));
    if (id === staleUpcoming.id) return json(route, contextFor(staleUpcoming as typeof staleLive, 0, 2));
    if (id === partialLive.id) return json(route, contextFor(partialLive, 1, 1));
    return json(route, contextFor(future as typeof staleLive, 0, 0));
  });

  await page.goto('/v2/');

  await expect(page.locator(`[data-series-id="${staleLive.id}"] .match-status`)).toHaveText('LIVE');
  await expect(page.locator(`[data-series-id="${staleUpcoming.id}"] .match-status`)).toHaveText('UPCOMING');
  await expect(page.locator(`[data-series-id="${partialLive.id}"] .match-status`)).toHaveText('LIVE');
  await expect(page.locator(`[data-series-id="${future.id}"] .match-status`)).toHaveText('UPCOMING');
  expect(requested).toContain(staleLive.id);
  expect(requested).toContain(staleUpcoming.id);
  expect(requested).toContain(partialLive.id);
  expect(requested).not.toContain(future.id);
});
