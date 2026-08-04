import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'history-blue', name: 'History Blue', code: 'HBL' };
const red = { id: 'history-red', name: 'History Red', code: 'HRD' };
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;

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
    championId: `${role} champion`,
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
      score: [
        { team: blue, wins: 1 },
        { team: red, wins: 0 }
      ],
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
}

test('mobile match history stays on the list until a result is selected', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Open match history' }).click();

  const historyCard = page.locator('[data-completed-series-id="series-mobile-history"]');
  await expect(historyCard).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'matches');
  await expect(page.locator('.schedule-panel')).toBeVisible();
  await expect(page.locator('.analysis-panel')).toBeHidden();
  await expect(page.locator('#completed-match-list')).toBeVisible();

  await historyCard.click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'live');
  await expect(page.locator('#completed-match-detail')).toBeVisible();

  const normalRows = page.locator('.completed-final-matchups .role-matchup-row');
  const recoveryRows = page.locator('.mobile-recovery-matchups .mobile-recovery-row');
  await expect.poll(async () => (
    await normalRows.count() + await recoveryRows.count()
  ), { timeout: 15_000 }).toBe(5);

  const normalBoardReady = await normalRows.count() === 5;
  const board = normalBoardReady
    ? page.locator('.completed-final-matchups')
    : page.locator('.mobile-recovery-matchups');
  const boardHeight = await board.evaluate(element => element.getBoundingClientRect().height);
  expect(boardHeight).toBeLessThanOrEqual(340);

  const horizontalOverflow = await page.evaluate(() => (
    document.documentElement.scrollWidth - window.innerWidth
  ));
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});
