import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue-layout', name: 'Unicorns of Love Sexy Edition', code: 'USE' };
const red = { id: 'red-layout', name: 'VfB Stuttgart', code: 'VFB' };
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
const champions = ['Gnar', 'LeeSin', 'Syndra', 'Ezreal', 'Nautilus'] as const;

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const series = {
  id: 'series-mobile-layout',
  esport: 'lol',
  competition: { id: 'layout-league', name: 'Layout League', stage: 'Game day' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: iso(-30 * 60 * 1_000),
  games: [
    { id: 'game-mobile-layout-1', number: 1, state: 'live' },
    { id: 'game-mobile-layout-2', number: 2, state: 'unstarted' },
    { id: 'game-mobile-layout-3', number: 3, state: 'unstarted' }
  ]
};

function players(side: 'blue' | 'red') {
  return roles.map((role, index) => ({
    id: `${side}-${role}`,
    handle: `${side === 'blue' ? 'USE' : 'VfB'} ${role}`,
    championId: champions[index],
    role,
    level: 8 + index,
    kills: index,
    deaths: side === 'blue' ? 0 : 1,
    assists: index + 1,
    creepScore: 80 + index * 22,
    totalGold: 4_900 + index * 360 + (side === 'blue' ? 220 : 0),
    items: ['1001', '2003', '1036']
  }));
}

function team(teamRef: typeof blue, side: 'blue' | 'red') {
  return {
    ...teamRef,
    side,
    gold: side === 'blue' ? 25_600 : 24_300,
    kills: side === 'blue' ? 5 : 3,
    objectives: {
      towers: 0,
      inhibitors: 0,
      dragons: [],
      barons: 0,
      heralds: 0,
      grubs: 0
    },
    players: players(side)
  };
}

function snapshot() {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[0],
    stats: {
      gameClockSeconds: 404,
      patch: '26.15.1',
      blue: team(blue, 'blue'),
      red: team(red, 'red')
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: iso(),
      observedAt: iso(500),
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
  await page.route('**/v1/lol/games/**/live**', route => json(route, snapshot()));
  await page.route('https://ddragon.leagueoflegends.com/cdn/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#334155"/></svg>'
  }));
}

test('shared mobile scoreboard keeps the compact live layout stable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');
  await page.locator('[data-series-id="series-mobile-layout"]').click();

  await expect(page.locator('#build-version')).toContainText('DEMO v0.17.9');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-scoreboard-renderer', 'shared-v1');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-scoreboard-details', 'team-kills-no-items');
  const board = page.locator('.mobile-live-history-board[data-mobile-unified-game-id="game-mobile-layout-1"]');
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-mobile-scoreboard-renderer', 'shared-v1');
  await expect(board).toHaveAttribute('data-mobile-scoreboard-mode', 'live');
  await expect(board).toHaveAttribute('data-mobile-compact-layout', 'v19');
  await expect(board).toHaveAttribute('data-mobile-live-cleanup', 'v22');

  await expect(page.locator('.series-hero-topline')).toBeHidden();
  await expect(board.locator('.mobile-unified-scoreboard-comparison')).toBeVisible();
  await expect(board.locator('.mobile-live-parity-team-strip')).toHaveCount(1);
  await expect(board.locator('.mobile-scoreboard-team.blue .mobile-scoreboard-team-kills strong')).toHaveText('5');
  await expect(board.locator('.mobile-scoreboard-team.red .mobile-scoreboard-team-kills strong')).toHaveText('3');
  await expect(board.locator('.mobile-live-parity-objectives')).toHaveCount(1);
  await expect(board.locator('.mobile-live-parity-objective')).toHaveCount(4);
  await expect(board.locator('.role-matchup-row')).toHaveCount(5);
  await expect(board.locator('.role-player-name strong')).toHaveCount(10);
  await expect(board.locator('.role-player-portrait')).toHaveCount(10);
  await expect(board.locator('.role-player-items, .telemetry-inventory, .telemetry-item-slot')).toHaveCount(0);
  await expect(board.locator(':scope > .mobile-completed-team-names')).toHaveCount(0);
  await expect(board.locator(':scope > .mobile-completed-objectives')).toHaveCount(0);

  const layout = await board.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const teamStrip = element.querySelector<HTMLElement>('.mobile-live-parity-team-strip');
    const gold = element.querySelector<HTMLElement>('.mobile-live-parity-gold');
    const objectives = element.querySelector<HTMLElement>('.mobile-live-parity-objectives');
    const firstRow = element.querySelector<HTMLElement>('.role-matchup-row');
    if (!teamStrip || !gold || !objectives || !firstRow) throw new Error('Shared board layout is incomplete.');
    return {
      width: bounds.width,
      radius: getComputedStyle(element).borderRadius,
      teamStripHeight: teamStrip.getBoundingClientRect().height,
      goldWidth: gold.getBoundingClientRect().width,
      objectiveHeight: objectives.getBoundingClientRect().height,
      firstRowHeight: firstRow.getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  expect(layout.width).toBeGreaterThanOrEqual(360);
  expect(layout.width).toBeLessThanOrEqual(380);
  expect(layout.radius).not.toBe('0px');
  expect(layout.teamStripHeight).toBeGreaterThanOrEqual(70);
  expect(layout.teamStripHeight).toBeLessThanOrEqual(100);
  expect(layout.goldWidth).toBeGreaterThanOrEqual(74);
  expect(layout.goldWidth).toBeLessThanOrEqual(82);
  expect(layout.objectiveHeight).toBeGreaterThanOrEqual(62);
  expect(layout.objectiveHeight).toBeLessThanOrEqual(82);
  expect(layout.firstRowHeight).toBeGreaterThanOrEqual(60);
  expect(layout.firstRowHeight).toBeLessThanOrEqual(82);
  expect(layout.overflow).toBeLessThanOrEqual(1);

  const nav = page.locator('.mobile-app-nav');
  await expect(nav).toHaveAttribute('data-mobile-nav-clearance', 'measured');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bottomClearance = await page.evaluate(() => {
    const lastRow = document.querySelector<HTMLElement>('.mobile-live-history-board .role-matchup-row:last-child');
    const navElement = document.querySelector<HTMLElement>('.mobile-app-nav');
    if (!lastRow || !navElement) throw new Error('Last matchup row or navigation is missing.');
    return navElement.getBoundingClientRect().top - lastRow.getBoundingClientRect().bottom;
  });
  expect(bottomClearance).toBeGreaterThanOrEqual(12);
  expect(pageErrors).toEqual([]);
});
