import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const lng = { id: 'lng', name: 'Suzhou LNG Esports', code: 'LNG' };
const wbg = { id: 'wbg', name: 'WeiboGaming', code: 'WBG' };
const series = {
  id: 'lpl-live-finality-recovery',
  esport: 'lol',
  competition: { id: 'lpl', name: 'LPL', stage: 'Regular Season' },
  teams: [lng, wbg],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 3 * 60 * 60 * 1_000).toISOString(),
  games: [
    { id: 'lpl-game-1', number: 1, state: 'completed' },
    { id: 'lpl-game-2', number: 2, state: 'live' },
    { id: 'lpl-game-3', number: 3, state: 'unstarted' }
  ]
};

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installSchedule(page: Page): Promise<void> {
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
}

function context(games: readonly unknown[]) {
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
        { team: lng, wins: 2 },
        { team: wbg, wins: 0 }
      ],
      games
    },
    complete: true,
    reasons: []
  };
}

const completedGame = (id: string, number: number) => ({
  id,
  number,
  state: 'completed',
  blueTeam: lng,
  redTeam: wbg,
  winner: lng,
  durationSeconds: 1_800
});

test('V2 does not declare a live catalogue series final from contradictory active context', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installSchedule(page);
  await page.route('**/v1/lol/series/**/context**', route => json(route, context([
    completedGame('lpl-game-1', 1),
    completedGame('lpl-game-2', 2),
    {
      id: 'lpl-game-3',
      number: 3,
      state: 'live',
      blueTeam: wbg,
      redTeam: lng,
      winner: null,
      durationSeconds: null
    }
  ])));

  await page.goto('/v2/');
  const card = page.locator('[data-series-id="lpl-live-finality-recovery"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.match-status')).toHaveText('LIVE');
  await expect(card).toContainText('Game 2 in progress');
});

test('V2 does not use an aggregate score without enough completed game winners', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installSchedule(page);
  await page.route('**/v1/lol/series/**/context**', route => json(route, context([
    completedGame('lpl-game-1', 1),
    { id: 'lpl-game-2', number: 2, state: 'unstarted', blueTeam: null, redTeam: null, winner: null, durationSeconds: null },
    { id: 'lpl-game-3', number: 3, state: 'unstarted', blueTeam: null, redTeam: null, winner: null, durationSeconds: null }
  ])));

  await page.goto('/v2/');
  const card = page.locator('[data-series-id="lpl-live-finality-recovery"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.match-status')).toHaveText('LIVE');
  await expect(card).toContainText('Game 2 in progress');
});

test('V2 still corrects a stale live schedule from coherent completed game history', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installSchedule(page);
  await page.route('**/v1/lol/series/**/context**', route => json(route, context([
    completedGame('lpl-game-1', 1),
    completedGame('lpl-game-2', 2),
    { id: 'lpl-game-3', number: 3, state: 'unstarted', blueTeam: null, redTeam: null, winner: null, durationSeconds: null }
  ])));

  await page.goto('/v2/');
  const card = page.locator('[data-series-id="lpl-live-finality-recovery"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.match-status')).toHaveText('FINAL');
});
