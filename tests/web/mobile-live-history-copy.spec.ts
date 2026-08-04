import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue-history-copy', name: 'Blue History Copy', code: 'BHC' };
const red = { id: 'red-history-copy', name: 'Red History Copy', code: 'RHC' };
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
const champions = ['Jayce', 'Maokai', 'Orianna', 'Ashe', 'Alistar'] as const;

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const series = {
  id: 'series-history-copy',
  esport: 'lol',
  competition: { id: 'competition-history-copy', name: 'History Copy League', stage: 'Week 4' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: iso(-45 * 60 * 1_000),
  games: [
    { id: 'game-history-copy-1', number: 1, state: 'live' },
    { id: 'game-history-copy-2', number: 2, state: 'unstarted' },
    { id: 'game-history-copy-3', number: 3, state: 'unstarted' }
  ]
};

function players(side: 'blue' | 'red') {
  return roles.map((role, index) => ({
    id: `${side}-${index + 1}`,
    handle: `${side === 'blue' ? 'Blue' : 'Red'} ${role}`,
    championId: champions[index],
    role,
    level: 9 + index,
    kills: side === 'blue' ? index + 1 : index,
    deaths: index % 2,
    assists: 4 + index,
    creepScore: 96 + index * 18,
    totalGold: (side === 'blue' ? 5_500 : 5_100) + index * 430,
    items: ['1001', '2003', '1036']
  }));
}

function team(teamRef: typeof blue, side: 'blue' | 'red') {
  return {
    id: teamRef.id,
    name: teamRef.name,
    side,
    gold: side === 'blue' ? 33_400 : 30_900,
    kills: side === 'blue' ? 11 : 7,
    objectives: {
      towers: side === 'blue' ? 5 : 2,
      inhibitors: 0,
      dragons: side === 'blue' ? ['infernal', 'cloud'] : ['mountain'],
      barons: side === 'blue' ? 1 : 0,
      heralds: 1,
      grubs: 3
    },
    players: players(side)
  };
}

function snapshot(withStats: boolean) {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[0],
    stats: withStats ? {
      gameClockSeconds: 1_372,
      patch: '26.15.1',
      blue: team(blue, 'blue'),
      red: team(red, 'red')
    } : null,
    quality: {
      freshness: withStats ? 'fresh' : 'stale',
      sourceTimestamp: iso(withStats ? 0 : -25 * 60 * 1_000),
      observedAt: iso(1_000),
      ageSeconds: withStats ? 1 : 1_500,
      complete: withStats,
      advancing: withStats,
      safeForLiveAnalysis: withStats,
      reasons: withStats ? [] : [{ code: 'stale_source', message: 'Telemetry is stale and still awaiting verification.' }]
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

async function installFixtures(page: Page, withStats: boolean): Promise<void> {
  await page.route('**/health', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => json(route, {
    esport: 'lol',
    events: [{ series, provider, observedAt: iso() }]
  }));

  await page.route('**/v1/lol/series/**/context**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: series.id,
    provider,
    observedAt: iso(),
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
      games: series.games.map(game => ({
        ...game,
        blueTeam: blue,
        redTeam: red,
        winner: null,
        durationSeconds: null
      }))
    },
    complete: true,
    reasons: []
  }));

  await page.route('**/v1/lol/games/**/live**', route => json(route, snapshot(withStats)));
  await page.route('https://ddragon.leagueoflegends.com/api/versions.json', route => json(route, ['26.15.1']));
}

async function openLiveMatch(page: Page, withStats: boolean): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, withStats);
  await page.goto('/');
  await page.locator('[data-series-id="series-history-copy"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'live');
}

test('mobile live matches reuse the completed-history board and keep navigation inside the app frame', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await openLiveMatch(page, true);

  await expect(page.locator('#build-version')).toContainText('DEMO v0.17.3');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-live-board-owner', 'history-copy');
  const board = page.locator('.mobile-live-history-board[data-mobile-history-copy="true"]');
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-live-board-state', 'verified');
  await expect(board).toHaveAttribute('data-mobile-compact-layout', 'v19');
  await expect(board.locator('.completed-team-comparison.completed-history-dashboard-v2')).toBeVisible();
  await expect(board.locator('.history-v2-team-header.mobile-completed-team-names')).toBeVisible();
  await expect(board.locator('.history-v2-summary')).toBeVisible();
  await expect(board.locator('.history-v2-objectives.mobile-completed-objectives')).toBeVisible();
  await expect(board.locator('.completed-final-matchups .role-matchup-row')).toHaveCount(5);
  await expect(board.locator('.role-player-name strong')).toHaveCount(10);
  await expect(board.locator('.role-player-portrait')).toHaveCount(10);
  await expect(board.locator('.telemetry-item-slot')).toHaveCount(70);
  await expect(board.locator('.history-v2-team.blue strong')).toHaveText(blue.name);
  await expect(board.locator('.history-v2-team.red strong')).toHaveText(red.name);
  await expect(page.locator('#game-content > .completed-final-game:not(.mobile-live-history-board)')).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('.app-frame');
    const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
    if (!frame || !nav) throw new Error('Mobile frame or navigation is missing.');
    const frameBounds = frame.getBoundingClientRect();
    const navBounds = nav.getBoundingClientRect();
    const buttons = [...nav.querySelectorAll<HTMLElement>('button')].map(button => button.getBoundingClientRect().width);
    return {
      frameLeft: frameBounds.left,
      frameRight: frameBounds.right,
      navLeft: navBounds.left,
      navRight: navBounds.right,
      bottomGap: window.innerHeight - navBounds.bottom,
      buttonSpread: Math.max(...buttons) - Math.min(...buttons),
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  expect(layout.navLeft).toBeGreaterThanOrEqual(layout.frameLeft + 6);
  expect(layout.navRight).toBeLessThanOrEqual(layout.frameRight - 6);
  expect(layout.bottomGap).toBeGreaterThanOrEqual(6);
  expect(layout.buttonSpread).toBeLessThanOrEqual(1);
  expect(layout.overflow).toBeLessThanOrEqual(1);

  const nav = page.locator('.mobile-app-nav');
  await expect(nav).toHaveAttribute('data-mobile-nav-layout', 'app-frame');
  await expect(nav).toHaveAttribute('data-mobile-nav-clearance', 'measured');
  await nav.getByRole('button', { name: 'Show matches' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'matches');
  await expect(nav.getByRole('button', { name: 'Show matches' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('button', { name: 'Show platform status' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'platform');
  await expect(nav.getByRole('button', { name: 'Show platform status' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('button', { name: 'Show selected match' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'live');
  await expect(nav.getByRole('button', { name: 'Show selected match' })).toHaveAttribute('aria-current', 'page');

  expect(pageErrors).toEqual([]);
});

test('mobile live matches keep the history board shell while verified telemetry is pending', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await openLiveMatch(page, false);

  const board = page.locator('.mobile-live-history-board[data-mobile-history-copy="true"]');
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-live-board-state', 'pending');
  await expect(board).toHaveAttribute('data-mobile-compact-layout', 'v19');
  await expect(board.locator('.completed-team-comparison.completed-history-dashboard-v2')).toBeVisible();
  await expect(board.locator('.completed-final-matchups .role-matchup-row')).toHaveCount(5);
  await expect(board.locator('.history-v2-team.blue strong')).toHaveText(blue.name);
  await expect(board.locator('.history-v2-team.red strong')).toHaveText(red.name);
  await expect(board.locator('.mobile-live-board-notice')).toContainText('Waiting for Riot');
  await expect(page.getByRole('heading', { name: 'Waiting for verified gameplay' })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});
