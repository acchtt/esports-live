import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Mobile', code: 'BLU' };
const red = { id: 'red', name: 'Red Mobile', code: 'RED' };

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const series = {
  id: 'series-mobile',
  esport: 'lol',
  competition: { id: 'competition-mobile', name: 'Mobile League', stage: 'Week 1' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: iso(-45 * 60 * 1_000),
  games: [
    { id: 'game-mobile-1', number: 1, state: 'live' },
    { id: 'game-mobile-2', number: 2, state: 'unstarted' },
    { id: 'game-mobile-3', number: 3, state: 'unstarted' }
  ]
};

const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
const champions = ['Jayce', 'Maokai', 'Orianna', 'Ashe', 'Alistar'] as const;

function players(side: 'blue' | 'red') {
  return roles.map((role, index) => ({
    id: String(index + (side === 'blue' ? 1 : 6)),
    handle: `${side === 'blue' ? 'Blue' : 'Red'} ${role}`,
    championId: champions[index],
    role,
    level: 9 + index,
    kills: index === 0 ? 2 : 1,
    deaths: index % 2,
    assists: 3 + index,
    creepScore: 90 + index * 17,
    totalGold: 5_200 + index * 420,
    items: ['1001', '2003']
  }));
}

function team(teamRef: typeof blue, side: 'blue' | 'red') {
  return {
    id: teamRef.id,
    name: teamRef.name,
    side,
    gold: side === 'blue' ? 31_200 : 29_800,
    kills: side === 'blue' ? 8 : 5,
    objectives: {
      towers: side === 'blue' ? 3 : 1,
      inhibitors: 0,
      dragons: side === 'blue' ? ['infernal'] : [],
      barons: 0,
      heralds: 1,
      grubs: 3
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
      gameClockSeconds: 1_245,
      patch: '26.15.1',
      blue: team(blue, 'blue'),
      red: team(red, 'red')
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: iso(),
      observedAt: iso(1_000),
      ageSeconds: 1,
      complete: true,
      advancing: true,
      safeForLiveAnalysis: true,
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

  await page.route('**/v1/lol/games/**/live**', route => json(route, snapshot()));
  await page.route('https://ddragon.leagueoflegends.com/api/versions.json', route => json(route, ['26.15.1']));
}

test('mobile demo switches surfaces and uses the history board design for live matches', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  const nav = page.locator('.mobile-app-nav');
  const schedule = page.locator('.schedule-panel');
  const analysis = page.locator('.analysis-panel');
  const platform = page.locator('#platform-panel');

  await expect(page.locator('#build-version')).toContainText('DEMO v0.16');
  await expect(nav).toBeVisible();
  await expect(nav).toHaveAttribute('data-mobile-nav-version', '0.16');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'matches');
  await expect(schedule).toBeVisible();
  await expect(analysis).toBeHidden();

  await page.locator('[data-series-id="series-mobile"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'live');
  await expect(page.locator('body')).not.toHaveAttribute('data-mobile-context', 'history');
  await expect(analysis).toBeVisible();
  await expect(schedule).toBeHidden();

  const board = page.locator('.mobile-live-history-board[data-mobile-unified-game-id="game-mobile-1"]');
  await expect(board).toBeVisible();
  await expect(board.locator('.mobile-completed-team-names')).toBeVisible();
  await expect(board.locator('.mobile-completed-objectives')).toBeVisible();
  await expect(board.locator('.mobile-recovery-row')).toHaveCount(5);
  await expect(page.locator('.v2-matchup-row')).toHaveCount(0);
  await expect(page.locator('.role-scoreboard-board')).toHaveCount(0);

  const deltaTypography = await board.locator('.mobile-recovery-gold-delta').first().evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return {
      width: bounds.width,
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize)
    };
  });
  expect(deltaTypography.width).toBeGreaterThanOrEqual(60);
  expect(deltaTypography.fontSize).toBeGreaterThanOrEqual(11);

  const horizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - window.innerWidth
  ));
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  await nav.getByRole('button', { name: 'Show matches' }).click();
  await expect(schedule).toBeVisible();
  await expect(analysis).toBeHidden();

  await nav.getByRole('button', { name: 'Show platform status' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'platform');
  await expect(platform).toBeVisible();
  await expect(page.locator('#platform-panel-content')).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(nav).toBeHidden();
  await expect(page.locator('body')).not.toHaveAttribute('data-mobile-view', /.+/);
  await expect(page.locator('.workspace')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
