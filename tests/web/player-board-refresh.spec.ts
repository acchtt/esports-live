import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };
const game = { id: 'game-live-refresh', number: 1, state: 'live' as const };
const series = {
  id: 'series-live-refresh',
  esport: 'lol',
  competition: { id: 'test-league', name: 'Test League', stage: 'Week 1' },
  teams: [blue, red] as const,
  bestOf: 3,
  state: 'live' as const,
  scheduledStart: new Date(Date.now() - 30 * 60 * 1_000).toISOString(),
  games: [game]
};

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

function teamStats(team: typeof blue, side: 'blue' | 'red', request: number) {
  return {
    id: team.id,
    name: team.name,
    side,
    gold: side === 'blue' ? 30_000 + request * 100 : 29_000 + request * 80,
    kills: side === 'blue' ? 7 : 5,
    objectives: {
      towers: side === 'blue' ? 4 : 2,
      inhibitors: 0,
      dragons: side === 'blue' ? ['infernal'] : [],
      barons: 0,
      heralds: 1,
      grubs: 3
    },
    players: []
  };
}

async function installFixtures(page: Page): Promise<() => number> {
  let liveRequests = 0;

  await page.route('https://www.riotgames.com/darkroom/original/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="#c8a456"/></svg>'
  }));

  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => fulfillJson(route, {
    esport: 'lol',
    events: [{ series, provider, observedAt: new Date().toISOString() }]
  }));

  await page.route('**/v1/lol/series/**/context**', route => fulfillJson(route, {
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
        { team: blue, wins: 0 },
        { team: red, wins: 0 }
      ],
      games: [{ ...game, blueTeam: blue, redTeam: red, winner: null, durationSeconds: null }]
    },
    complete: true,
    reasons: []
  }));

  await page.route('**/v1/lol/games/**/live**', route => {
    liveRequests += 1;
    const timestamp = new Date(Date.now() + liveRequests * 1_000).toISOString();
    return fulfillJson(route, {
      schemaVersion: '1.0',
      esport: 'lol',
      provider,
      series,
      game,
      stats: {
        gameClockSeconds: 1_200 + liveRequests * 5,
        patch: '26.15.1',
        blue: teamStats(blue, 'blue', liveRequests),
        red: teamStats(red, 'red', liveRequests)
      },
      quality: {
        freshness: 'fresh',
        sourceTimestamp: timestamp,
        observedAt: timestamp,
        ageSeconds: 1,
        complete: true,
        advancing: true,
        safeForLiveAnalysis: true,
        reasons: []
      }
    });
  });

  return () => liveRequests;
}

test('refreshes the selected live player board on demand', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const liveRequests = await installFixtures(page);

  await page.goto('/');
  const liveCard = page.locator('[data-series-id="series-live-refresh"]');
  await expect(liveCard).toBeVisible();
  await liveCard.click();
  await expect(page.locator('[data-live-history-game-id="game-live-refresh"]')).toBeVisible();
  await expect.poll(liveRequests).toBeGreaterThan(0);

  const summary = page.locator('[data-player-board-summary]');
  await expect(summary).toBeVisible();
  await expect(summary.locator('.player-board-summary-cell')).toHaveCount(5);
  const summaryMutations = await page.evaluate(async () => {
    const element = document.querySelector('[data-player-board-summary]');
    if (!element) return Number.POSITIVE_INFINITY;
    let mutations = 0;
    const observer = new MutationObserver(records => {
      mutations += records.length;
    });
    observer.observe(element, { childList: true, subtree: true });
    await new Promise(resolve => window.setTimeout(resolve, 250));
    observer.disconnect();
    return mutations;
  });
  expect(summaryMutations).toBeLessThanOrEqual(1);

  await expect(page.locator('.v2-team-logo-fallback')).toHaveCount(2);
  await expect(page.locator('.v2-item-slot')).toHaveCount(70);

  const layout = await page.locator('.analysis-panel').evaluate(panel => {
    const hero = panel.querySelector<HTMLElement>('.v2-hero');
    const row = panel.querySelector<HTMLElement>('.v2-matchup-row');
    const item = panel.querySelector<HTMLElement>('.v2-item-slot');
    const panelStyle = getComputedStyle(panel);
    if (!hero || !row || !item) return null;
    return {
      panelPadding: Number.parseFloat(panelStyle.paddingLeft),
      heroMinHeight: Number.parseFloat(getComputedStyle(hero).minHeight),
      rowMinHeight: Number.parseFloat(getComputedStyle(row).minHeight),
      itemWidth: item.getBoundingClientRect().width,
      overflow: panel.scrollWidth - panel.clientWidth
    };
  });
  expect(layout).not.toBeNull();
  expect(layout?.panelPadding).toBeGreaterThanOrEqual(10);
  expect(layout?.heroMinHeight).toBeGreaterThanOrEqual(110);
  expect(layout?.rowMinHeight).toBeGreaterThanOrEqual(90);
  expect(layout?.itemWidth).toBeGreaterThanOrEqual(27);
  expect(layout?.overflow).toBeLessThanOrEqual(2);

  const refreshButton = page.getByRole('button', { name: 'Refresh', exact: true });
  await expect(refreshButton).toBeVisible();
  const requestCount = liveRequests();
  await refreshButton.click();

  await expect.poll(liveRequests).toBeGreaterThan(requestCount);
  await expect(refreshButton).toBeEnabled();
  await expect(page.locator('#game-selector [data-game-id="game-live-refresh"]')).toHaveClass(/active/);
  expect(pageErrors).toEqual([]);
});
