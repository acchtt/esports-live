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
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
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
      score: [{ team: blue, wins: 0 }, { team: red, wins: 0 }],
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
  await page.route('https://ddragon.leagueoflegends.com/cdn/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#334155"/></svg>'
  }));
}

async function openLiveMatch(page: Page, withStats: boolean): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, withStats);
  await page.goto('/');
  await page.locator('[data-series-id="series-history-copy"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'live');
}

test('live matches use the shared mobile scoreboard renderer', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await openLiveMatch(page, true);

  await expect(page.locator('#build-version')).toContainText('DEMO v0.17.9');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-scoreboard-renderer', 'shared-v1');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-scoreboard-details', 'team-kills-no-items');

  const board = page.locator('.mobile-live-history-board[data-mobile-history-copy="true"]');
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-mobile-scoreboard-renderer', 'shared-v1');
  await expect(board).toHaveAttribute('data-mobile-scoreboard-mode', 'live');
  await expect(board).toHaveAttribute('data-live-board-state', 'verified');
  await expect(board.locator('.mobile-unified-scoreboard-comparison')).toBeVisible();
  await expect(board.locator('.mobile-live-parity-team-strip')).toHaveCount(1);
  await expect(board.locator('.mobile-scoreboard-team.blue .mobile-scoreboard-team-kills strong')).toHaveText('11');
  await expect(board.locator('.mobile-scoreboard-team.red .mobile-scoreboard-team-kills strong')).toHaveText('7');
  await expect(board.locator('.mobile-live-parity-gold strong')).toHaveText('+2.5K');
  await expect(board.locator('.mobile-live-parity-objective')).toHaveCount(4);
  await expect(board.locator('.completed-final-matchups .role-matchup-row')).toHaveCount(5);
  await expect(board.locator('.role-player-portrait')).toHaveCount(10);
  await expect(board.locator('.role-player-items, .telemetry-inventory, .telemetry-item-slot')).toHaveCount(0);
  await expect(board.locator(':scope > .mobile-completed-team-names')).toHaveCount(0);
  await expect(board.locator(':scope > .mobile-completed-objectives')).toHaveCount(0);
  await expect(board.locator('.history-v2-summary')).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('.app-frame');
    const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
    const boardElement = document.querySelector<HTMLElement>(
      '.mobile-live-history-board[data-mobile-scoreboard-renderer="shared-v1"]'
    );
    if (!frame || !nav || !boardElement) throw new Error('Mobile frame, board, or navigation is missing.');
    const frameBounds = frame.getBoundingClientRect();
    const navBounds = nav.getBoundingClientRect();
    const boardBounds = boardElement.getBoundingClientRect();
    return {
      boardLeft: boardBounds.left,
      boardRight: boardBounds.right,
      frameLeft: frameBounds.left,
      frameRight: frameBounds.right,
      navLeft: navBounds.left,
      navRight: navBounds.right,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  expect(layout.boardLeft).toBeGreaterThanOrEqual(layout.frameLeft + 4);
  expect(layout.boardRight).toBeLessThanOrEqual(layout.frameRight - 4);
  expect(layout.navLeft).toBeGreaterThanOrEqual(layout.frameLeft + 6);
  expect(layout.navRight).toBeLessThanOrEqual(layout.frameRight - 6);
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});

test('pending live matches keep the same shared scoreboard shell', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await openLiveMatch(page, false);

  const board = page.locator('.mobile-live-history-board[data-mobile-history-copy="true"]');
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-mobile-scoreboard-renderer', 'shared-v1');
  await expect(board).toHaveAttribute('data-mobile-scoreboard-mode', 'live');
  await expect(board).toHaveAttribute('data-live-board-state', 'pending');
  await expect(board.locator('.mobile-scoreboard-team-kills strong')).toHaveText(['—', '—']);
  await expect(board.locator('.mobile-live-parity-gold strong')).toHaveText('—');
  await expect(board.locator('.mobile-live-parity-objective')).toHaveCount(4);
  await expect(board.locator('.completed-final-matchups .role-matchup-row')).toHaveCount(5);
  await expect(board.locator('.role-player-items, .telemetry-inventory, .telemetry-item-slot')).toHaveCount(0);
  await expect(board.locator('.mobile-live-board-notice')).toContainText('Waiting for Riot');
  await expect(page.getByRole('heading', { name: 'Waiting for verified gameplay' })).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});
