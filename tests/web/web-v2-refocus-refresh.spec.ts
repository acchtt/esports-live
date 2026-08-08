import { expect, test, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };
const series = {
  id: 'series-v2-refocus',
  esport: 'lol',
  competition: { id: 'refocus-league', name: 'Refocus League', stage: 'Week 1' },
  teams: [blue, red],
  bestOf: 3,
  state: 'live',
  scheduledStart: new Date(Date.now() - 20 * 60 * 1_000).toISOString(),
  games: [{ id: 'game-v2-refocus-1', number: 1, state: 'live' }]
};

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

test('V2 refreshes schedules and the selected live snapshot when the app regains focus', async ({ page }) => {
  let scheduleRequests = 0;
  let snapshotRequests = 0;

  await page.route('**/health', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    scheduleRequests += 1;
    const history = route.request().url().includes('states=completed');
    return json(route, {
      esport: 'lol',
      events: history ? [] : [{ series, provider, observedAt: new Date().toISOString() }]
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => json(route, {
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
      games: [{
        id: series.games[0]!.id,
        number: 1,
        state: 'live',
        blueTeam: blue,
        redTeam: red,
        winner: null,
        durationSeconds: null
      }]
    },
    complete: true,
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => {
    snapshotRequests += 1;
    const refreshed = snapshotRequests > 1;
    const observedAt = new Date().toISOString();
    return json(route, {
      schemaVersion: '1.0',
      esport: 'lol',
      provider,
      series,
      game: series.games[0],
      stats: {
        gameClockSeconds: refreshed ? 610 : 600,
        patch: '26.15.1',
        blue: {
          id: blue.id,
          name: blue.name,
          side: 'blue',
          gold: refreshed ? 31_000 : 30_000,
          kills: refreshed ? 4 : 3,
          objectives: {
            towers: 1,
            inhibitors: 0,
            dragons: [],
            barons: 0,
            heralds: 0,
            grubs: 0
          },
          players: []
        },
        red: {
          id: red.id,
          name: red.name,
          side: 'red',
          gold: 29_000,
          kills: 2,
          objectives: {
            towers: 0,
            inhibitors: 0,
            dragons: [],
            barons: 0,
            heralds: 0,
            grubs: 0
          },
          players: []
        }
      },
      quality: {
        freshness: 'fresh',
        sourceTimestamp: observedAt,
        observedAt,
        ageSeconds: 0,
        complete: true,
        advancing: true,
        safeForLiveAnalysis: true,
        reasons: []
      }
    });
  });

  await page.goto('/v2/');
  await page.locator('[data-series-id="series-v2-refocus"]').click();
  await expect(page.locator('#game-clock')).toHaveText('10:00');
  await expect(page.locator('#blue-kills')).toHaveText('3');
  await expect.poll(() => snapshotRequests).toBeGreaterThanOrEqual(1);

  // Browser focus/pageshow can fire during initial navigation. Wait past the
  // lifecycle debounce so this event models returning to the app later.
  await page.waitForTimeout(300);
  const schedulesBeforeFocus = scheduleRequests;
  const snapshotsBeforeFocus = snapshotRequests;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect.poll(() => scheduleRequests).toBeGreaterThan(schedulesBeforeFocus);
  await expect.poll(() => snapshotRequests).toBeGreaterThan(snapshotsBeforeFocus);
  await expect(page.locator('#game-clock')).toHaveText('10:10');
  await expect(page.locator('#blue-kills')).toHaveText('4');
});
