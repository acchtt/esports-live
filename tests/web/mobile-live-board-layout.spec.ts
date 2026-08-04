import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue-layout', name: 'Movistar KOI Fénix', code: 'KOI' };
const red = { id: 'red-layout', name: 'UB Alma Mater', code: 'UBAM' };
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
    handle: `${side === 'blue' ? 'KOI' : 'Alma'} ${role}`,
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
  await page.route('https://ddragon.leagueoflegends.com/api/versions.json', route => json(route, ['26.15.1']));
  await page.route('https://ddragon.leagueoflegends.com/cdn/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#334155"/></svg>'
  }));
}

test('mobile live board keeps the pre-board chrome compact and matchup rows readable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');
  await page.locator('[data-series-id="series-mobile-layout"]').click();

  await expect(page.locator('#build-version')).toContainText('DEMO v0.17.3');
  const board = page.locator('.mobile-live-history-board[data-mobile-unified-game-id="game-mobile-layout-1"]');
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-mobile-scoreboard-layout', 'identity-items');
  await expect(board).toHaveAttribute('data-mobile-compact-layout', 'v19');

  await expect(page.locator('.series-hero-topline')).toBeHidden();
  const chromeLayout = await page.evaluate(() => {
    const matchup = document.querySelector<HTMLElement>('.series-hero-matchup');
    const selector = document.querySelector<HTMLElement>('#game-selector');
    const context = document.querySelector<HTMLElement>('.series-hero-live-context');
    if (!matchup || !selector || !context) throw new Error('Compact live series chrome is incomplete.');
    return {
      matchupHeight: matchup.getBoundingClientRect().height,
      selectorHeight: selector.getBoundingClientRect().height,
      contextHeight: context.getBoundingClientRect().height
    };
  });
  expect(chromeLayout.matchupHeight).toBeLessThanOrEqual(112);
  expect(chromeLayout.selectorHeight).toBeLessThanOrEqual(54);
  expect(chromeLayout.contextHeight).toBeLessThanOrEqual(34);

  const names = board.locator('.role-player-name strong');
  await expect(names).toHaveCount(10);
  await expect(names.first()).toHaveText('KOI top');
  const nameLayout = await names.first().evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: bounds.width,
      height: bounds.height,
      display: style.display,
      visibility: style.visibility,
      opacity: Number(style.opacity)
    };
  });
  expect(nameLayout.width).toBeGreaterThan(42);
  expect(nameLayout.height).toBeGreaterThan(8);
  expect(nameLayout.display).not.toBe('none');
  expect(nameLayout.visibility).toBe('visible');
  expect(nameLayout.opacity).toBeGreaterThan(0.9);

  const portraits = board.locator('.role-player-portrait');
  await expect(portraits).toHaveCount(10);
  const portraitLayout = await portraits.first().evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  });
  expect(portraitLayout.width).toBeGreaterThanOrEqual(32);
  expect(portraitLayout.height).toBeGreaterThanOrEqual(32);

  const itemRows = board.locator('.role-player-items');
  await expect(itemRows).toHaveCount(10);
  const slots = board.locator('.role-player-items .telemetry-item-slot');
  await expect(slots).toHaveCount(70);
  const slotWidth = await slots.first().evaluate(element => element.getBoundingClientRect().width);
  expect(slotWidth).toBeGreaterThanOrEqual(12);

  const firstRowHeight = await board.locator('.role-matchup-row').first().evaluate(
    element => element.getBoundingClientRect().height
  );
  expect(firstRowHeight).toBeGreaterThanOrEqual(72);
  expect(firstRowHeight).toBeLessThanOrEqual(84);

  const toolbar = board.locator('.player-board-toolbar');
  await expect(toolbar).toBeVisible();
  const toolbarLayout = await toolbar.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const button = element.querySelector<HTMLElement>('.player-board-refresh-button');
    if (!button) throw new Error('Refresh button is missing.');
    return {
      display: getComputedStyle(element).display,
      height: bounds.height,
      buttonHeight: button.getBoundingClientRect().height,
      buttonWidth: button.getBoundingClientRect().width
    };
  });
  expect(toolbarLayout.display).toBe('grid');
  expect(toolbarLayout.height).toBeLessThanOrEqual(50);
  expect(toolbarLayout.buttonHeight).toBeGreaterThanOrEqual(32);
  expect(toolbarLayout.buttonHeight).toBeLessThanOrEqual(40);
  expect(toolbarLayout.buttonWidth).toBeLessThanOrEqual(40);

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

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});
