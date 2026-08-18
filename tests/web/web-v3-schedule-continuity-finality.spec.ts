import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'continuity-blue', name: 'Continuity Blue', code: 'CB' };
const red = { id: 'continuity-red', name: 'Continuity Red', code: 'CR' };
const seriesId = 'continuity-live-series';

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

function activeEvent() {
  return {
    series: {
      id: seriesId,
      esport: 'lol',
      competition: { id: 'continuity', name: 'Continuity League' },
      teams: [blue, red],
      bestOf: 3,
      state: 'live',
      scheduledStart: new Date(Date.now() - 20 * 60 * 1_000).toISOString(),
      games: [
        { id: 'continuity-game-1', number: 1, state: 'live' },
        { id: 'continuity-game-2', number: 2, state: 'unstarted' },
        { id: 'continuity-game-3', number: 3, state: 'unstarted' }
      ],
      score: [
        { team: blue, wins: 0 },
        { team: red, wins: 0 }
      ]
    },
    provider,
    observedAt: new Date().toISOString()
  };
}

function activeContext() {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId,
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
      games: [
        {
          id: 'continuity-game-1',
          number: 1,
          state: 'live',
          blueTeam: blue,
          redTeam: red,
          winner: null,
          durationSeconds: null
        }
      ]
    },
    complete: false,
    reasons: []
  };
}

async function installFixtures(page: Page, active: () => boolean): Promise<void> {
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    const states = new URL(route.request().url()).searchParams.get('states') ?? '';
    return json(route, {
      esport: 'lol',
      events: states === 'completed' || !active() ? [] : [activeEvent()]
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => json(route, activeContext()));
}

test('V3 drops a missing LIVE card after the short continuity grace instead of holding it ten minutes', async ({ page }) => {
  let serveActive = true;
  await page.addInitScript(() => {
    const initial = Date.now();
    (window as typeof window & { __arenaTestNow?: number }).__arenaTestNow = initial;
    Date.now = () => (
      (window as typeof window & { __arenaTestNow?: number }).__arenaTestNow ?? initial
    );
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, () => serveActive);
  await page.goto('/');

  await page.locator('.match-filters [data-match-filter="live"]').click();
  const card = page.locator(`[data-series-id="${seriesId}"]`);
  await expect(card).toBeVisible();

  serveActive = false;
  await page.evaluate(() => {
    const value = window as typeof window & { __arenaTestNow?: number };
    value.__arenaTestNow = (value.__arenaTestNow ?? Date.now()) + 30_000;
  });
  await page.locator('#refresh-data').click();
  await expect(card).toBeVisible();

  await page.evaluate(() => {
    const value = window as typeof window & { __arenaTestNow?: number };
    value.__arenaTestNow = (value.__arenaTestNow ?? Date.now()) + 70_000;
  });
  await page.locator('#refresh-data').click();
  await expect(card).toHaveCount(0);
});
