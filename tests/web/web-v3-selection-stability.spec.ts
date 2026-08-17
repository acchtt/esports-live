import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const selectedBlue = { id: 'selected-blue', name: 'Selected Blue', code: 'SBL', imageUrl: null };
const selectedRed = { id: 'selected-red', name: 'Selected Red', code: 'SRD', imageUrl: null };
const otherBlue = { id: 'other-blue', name: 'Other Blue', code: 'OBL', imageUrl: null };
const otherRed = { id: 'other-red', name: 'Other Red', code: 'ORD', imageUrl: null };

const selectedLiveSeries = {
  id: 'selected-series',
  esport: 'lol',
  competition: { id: 'selection-league', name: 'Selection League', stage: 'Regular Season' },
  teams: [selectedBlue, selectedRed],
  bestOf: 1,
  state: 'live',
  scheduledStart: new Date(Date.now() - 40 * 60_000).toISOString(),
  games: [{ id: 'selected-game', number: 1, state: 'live' }]
};

const selectedFinalSeries = {
  ...selectedLiveSeries,
  state: 'completed',
  games: [{ id: 'selected-game', number: 1, state: 'completed' }],
  score: [
    { team: selectedBlue, wins: 1 },
    { team: selectedRed, wins: 0 }
  ]
};

const otherLiveSeries = {
  id: 'other-series',
  esport: 'lol',
  competition: { id: 'selection-league', name: 'Selection League', stage: 'Regular Season' },
  teams: [otherBlue, otherRed],
  bestOf: 1,
  state: 'live',
  scheduledStart: new Date(Date.now() - 15 * 60_000).toISOString(),
  games: [{ id: 'other-game', number: 1, state: 'live' }]
};

function snapshot(finalized: boolean) {
  const now = new Date().toISOString();
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series: finalized ? selectedFinalSeries : selectedLiveSeries,
    game: finalized ? selectedFinalSeries.games[0] : selectedLiveSeries.games[0],
    stats: {
      gameClockSeconds: 2_105,
      patch: '26.15.1',
      blue: {
        id: selectedBlue.id,
        name: selectedBlue.name,
        side: 'blue',
        gold: finalized ? 53_200 : 49_800,
        kills: finalized ? 18 : 15,
        objectives: { towers: 9, inhibitors: 2, dragons: ['cloud', 'infernal'], barons: 1, heralds: 1, grubs: null },
        players: []
      },
      red: {
        id: selectedRed.id,
        name: selectedRed.name,
        side: 'red',
        gold: finalized ? 46_100 : 45_900,
        kills: finalized ? 11 : 10,
        objectives: { towers: 4, inhibitors: 0, dragons: ['mountain'], barons: 0, heralds: 0, grubs: null },
        players: []
      }
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: now,
      observedAt: now,
      ageSeconds: 1,
      complete: true,
      advancing: !finalized,
      safeForLiveAnalysis: !finalized,
      reasons: []
    }
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

async function installFixtures(page: Page, isFinalized: () => boolean): Promise<void> {
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => {
    const completed = route.request().url().includes('states=completed');
    const finalized = isFinalized();
    return json(route, {
      esport: 'lol',
      events: completed
        ? finalized
          ? [{ series: selectedFinalSeries, provider, observedAt: new Date().toISOString() }]
          : []
        : finalized
          ? [{ series: otherLiveSeries, provider, observedAt: new Date().toISOString() }]
          : [
              { series: selectedLiveSeries, provider, observedAt: new Date().toISOString() },
              { series: otherLiveSeries, provider, observedAt: new Date().toISOString() }
            ]
    });
  });

  await page.route('**/v1/lol/series/**/context**', route => {
    const selected = route.request().url().includes('selected-series');
    const finalized = selected && isFinalized();
    return json(route, {
      schemaVersion: '1.0',
      esport: 'lol',
      seriesId: selected ? selectedLiveSeries.id : otherLiveSeries.id,
      provider,
      observedAt: new Date().toISOString(),
      rosters: [],
      standings: [],
      history: finalized
        ? {
            bestOf: 1,
            winsRequired: 1,
            drawPossible: false,
            score: [
              { team: selectedBlue, wins: 1 },
              { team: selectedRed, wins: 0 }
            ],
            games: [{ id: 'selected-game', number: 1, state: 'completed', winner: selectedBlue }]
          }
        : { bestOf: 1, winsRequired: 1, drawPossible: false, score: [], games: [] },
      complete: finalized,
      reasons: []
    });
  });

  await page.route('**/v1/lol/games/**/live**', route => {
    const url = route.request().url();
    if (url.includes('selected-game')) return json(route, snapshot(isFinalized()));
    return json(route, {
      ...snapshot(false),
      series: otherLiveSeries,
      game: otherLiveSeries.games[0],
      stats: {
        ...snapshot(false).stats,
        blue: { ...snapshot(false).stats.blue, id: otherBlue.id, name: otherBlue.name },
        red: { ...snapshot(false).stats.red, id: otherRed.id, name: otherRed.name }
      }
    });
  });
}

test('V3 keeps the open match selected when it finishes and another match stays live', async ({ page }) => {
  let finalized = false;
  let scheduleRequests = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/v1/lol/schedule')) scheduleRequests += 1;
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, () => finalized);
  await page.goto('/match/selected-series/selected-game');

  await expect(page.locator('#detail-title')).toHaveText('Selected Blue vs Selected Red');
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Live');
  await expect(page).toHaveURL(/\/match\/selected-series\/selected-game$/);

  await page.waitForTimeout(300);
  finalized = true;
  const schedulesBeforeFinalRefresh = scheduleRequests;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect.poll(() => scheduleRequests).toBeGreaterThan(schedulesBeforeFinalRefresh);
  await expect(page.locator('#game-label')).toHaveText('Game 1 · Final');
  await expect(page.locator('#detail-title')).toHaveText('Selected Blue vs Selected Red');
  await expect(page).toHaveURL(/\/match\/selected-series\/selected-game$/);
  await expect(page.locator('#detail-title')).not.toHaveText('Other Blue vs Other Red');
});
