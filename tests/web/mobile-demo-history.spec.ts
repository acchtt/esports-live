import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'history-blue', name: 'History Blue', code: 'HBL' };
const red = { id: 'history-red', name: 'History Red', code: 'HRD' };
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
const champions = ['Gnar', 'LeeSin', 'Syndra', 'Ezreal', 'Nautilus'] as const;

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const completedSeries = {
  id: 'series-mobile-history',
  esport: 'lol',
  competition: { id: 'competition-history', name: 'Mobile History League', stage: 'Week 3' },
  teams: [blue, red],
  bestOf: 1,
  state: 'completed',
  scheduledStart: iso(-2 * 60 * 60 * 1_000),
  games: [{ id: 'game-mobile-history-1', number: 1, state: 'completed' }]
};

function players(side: 'blue' | 'red') {
  return roles.map((role, index) => ({
    id: `${side}-${index + 1}`,
    handle: `${side === 'blue' ? 'Blue' : 'Red'} ${role}`,
    championId: champions[index],
    role,
    level: 11 + index,
    kills: side === 'blue' ? 2 + index : index,
    deaths: side === 'blue' ? index % 2 : 2,
    assists: 4 + index,
    creepScore: 100 + index * 21,
    totalGold: 5_600 + index * 470,
    items: ['1001', '2003', '1036']
  }));
}

function team(teamRef: typeof blue, side: 'blue' | 'red') {
  return {
    id: teamRef.id,
    name: teamRef.name,
    side,
    gold: side === 'blue' ? 34_800 : 30_100,
    kills: side === 'blue' ? 14 : 7,
    objectives: {
      towers: side === 'blue' ? 8 : 3,
      inhibitors: side === 'blue' ? 1 : 0,
      dragons: side === 'blue' ? ['infernal', 'mountain'] : ['cloud'],
      barons: side === 'blue' ? 1 : 0,
      heralds: 1,
      grubs: 3
    },
    players: players(side)
  };
}

function completedSnapshot() {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: completedSeries,
    game: completedSeries.games[0],
    stats: {
      gameClockSeconds: 1_902,
      patch: '26.15.1',
      blue: team(blue, 'blue'),
      red: team(red, 'red')
    },
    quality: {
      freshness: 'historical',
      sourceTimestamp: iso(-90 * 60 * 1_000),
      observedAt: iso(),
      ageSeconds: 5_400,
      complete: true,
      advancing: false,
      safeForLiveAnalysis: false,
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
  await page.route('**/v1/lol/schedule**', route => {
    const activeOnly = route.request().url().includes('states=live,paused,scheduled');
    return json(route, {
      esport: 'lol',
      events: activeOnly ? [] : [{ series: completedSeries, provider, observedAt: iso() }]
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: completedSeries.id,
    provider,
    observedAt: iso(),
    rosters: [],
    standings: [],
    history: {
      bestOf: 1,
      winsRequired: 1,
      drawPossible: false,
      score: [{ team: blue, wins: 1 }, { team: red, wins: 0 }],
      games: [{
        ...completedSeries.games[0],
        blueTeam: blue,
        redTeam: red,
        winner: blue,
        durationSeconds: 1_902
      }]
    },
    complete: true,
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => json(route, completedSnapshot()));
  await page.route('https://ddragon.leagueoflegends.com/cdn/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#334155"/></svg>'
  }));
}

test('mobile match history stays on the list until selected and then uses the shared scoreboard', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  await expect(page.locator('#build-version')).toContainText('DEMO v0.17.9');
  await page.getByRole('button', { name: 'Open match history' }).click();

  const historyCard = page.locator('[data-completed-series-id="series-mobile-history"]');
  await expect(historyCard).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'matches');
  await expect(page.locator('.schedule-panel')).toBeVisible();
  await expect(page.locator('.analysis-panel')).toBeHidden();
  await expect(page.locator('#completed-match-list')).toBeVisible();

  await historyCard.click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'live');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-context', 'history');
  await expect(page.locator('#completed-match-detail')).toBeVisible();
  await expect(page.locator('.analysis-header')).toBeHidden();

  const board = page.locator('#completed-match-detail [data-final-game-id="game-mobile-history-1"]');
  await expect(board).toBeVisible({ timeout: 15_000 });
  await expect(board).toHaveAttribute('data-mobile-scoreboard-renderer', 'shared-v1');
  await expect(board).toHaveAttribute('data-mobile-scoreboard-mode', 'history');
  await expect(board.locator('.mobile-unified-scoreboard-comparison')).toBeVisible();
  await expect(board.locator('.mobile-live-parity-team-strip')).toHaveCount(1);
  await expect(board.locator('.mobile-scoreboard-team.blue .mobile-scoreboard-team-kills strong')).toHaveText('14');
  await expect(board.locator('.mobile-scoreboard-team.red .mobile-scoreboard-team-kills strong')).toHaveText('7');
  await expect(board.locator('.mobile-live-parity-gold strong')).toHaveText('+4.7K');
  await expect(board.locator('.mobile-live-parity-objective')).toHaveCount(4);
  await expect(board.locator('.completed-final-matchups .role-matchup-row')).toHaveCount(5);
  await expect(board.locator('.role-player-portrait')).toHaveCount(10);
  await expect(board.locator('.role-player-items, .telemetry-inventory, .telemetry-item-slot')).toHaveCount(0);
  await expect(board.locator('.history-v2-summary')).toHaveCount(0);
  await expect(board.locator(':scope > .mobile-completed-team-names')).toHaveCount(0);
  await expect(board.locator(':scope > .mobile-completed-objectives')).toHaveCount(0);

  const historyChrome = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.analysis-panel');
    const topbar = document.querySelector<HTMLElement>('.topbar');
    const context = document.querySelector<HTMLElement>('.mobile-context-bar');
    if (!panel || !topbar || !context) throw new Error('History chrome is incomplete.');
    const topbarBounds = topbar.getBoundingClientRect();
    const contextBounds = context.getBoundingClientRect();
    return {
      contextIsFirst: panel.firstElementChild === context,
      gap: contextBounds.top - topbarBounds.bottom,
      contextHeight: contextBounds.height,
      overflow: document.documentElement.scrollWidth - window.innerWidth
    };
  });
  expect(historyChrome.contextIsFirst).toBe(true);
  expect(Math.abs(historyChrome.gap)).toBeLessThanOrEqual(2);
  expect(historyChrome.contextHeight).toBeLessThanOrEqual(50);
  expect(historyChrome.overflow).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});
