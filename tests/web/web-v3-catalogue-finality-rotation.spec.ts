import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };

function team(id: string, side: 'blue' | 'red') {
  const suffix = side === 'blue' ? 'B' : 'R';
  return {
    id: `${id}-${side}`,
    name: `${id} ${side === 'blue' ? 'Blue' : 'Red'}`,
    code: `${suffix}${id.slice(-1)}`.toUpperCase()
  };
}

function staleSeries(id: string, hoursAgo: number) {
  const blue = team(id, 'blue');
  const red = team(id, 'red');
  return {
    id,
    esport: 'lol',
    competition: { id: 'rotation', name: 'Rotation League', stage: 'Regular Season' },
    teams: [blue, red],
    bestOf: 3,
    state: 'live',
    scheduledStart: new Date(Date.now() - hoursAgo * 60 * 60 * 1_000).toISOString(),
    games: [
      { id: `${id}-game-1`, number: 1, state: 'completed' },
      { id: `${id}-game-2`, number: 2, state: 'live' },
      { id: `${id}-game-3`, number: 3, state: 'unstarted' }
    ]
  };
}

const staleFinalSeries = Array.from(
  { length: 7 },
  (_, index) => staleSeries(`stale-final-${index + 1}`, 8 - index)
);
const genuineLiveSeries = staleSeries('genuine-live-8', 1.75);
const activeEvents = [...staleFinalSeries, genuineLiveSeries].map(series => ({
  series,
  provider,
  observedAt: new Date().toISOString()
}));

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

function completedContext(series: ReturnType<typeof staleSeries>) {
  const [blue, red] = series.teams;
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
        { team: blue, wins: 2 },
        { team: red, wins: 0 }
      ],
      games: [
        {
          id: `${series.id}-game-1`,
          number: 1,
          state: 'completed',
          blueTeam: blue,
          redTeam: red,
          winner: blue,
          durationSeconds: 1_800
        },
        {
          id: `${series.id}-game-2`,
          number: 2,
          state: 'completed',
          blueTeam: blue,
          redTeam: red,
          winner: blue,
          durationSeconds: 1_900
        },
        {
          id: `${series.id}-game-3`,
          number: 3,
          state: 'unstarted',
          blueTeam: null,
          redTeam: null,
          winner: null,
          durationSeconds: null
        }
      ]
    },
    complete: true,
    reasons: []
  };
}

function liveContext(series: ReturnType<typeof staleSeries>) {
  const [blue, red] = series.teams;
  return {
    ...completedContext(series),
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [
        { team: blue, wins: 1 },
        { team: red, wins: 0 }
      ],
      games: [
        {
          id: `${series.id}-game-1`,
          number: 1,
          state: 'completed',
          blueTeam: blue,
          redTeam: red,
          winner: blue,
          durationSeconds: 1_800
        },
        {
          id: `${series.id}-game-2`,
          number: 2,
          state: 'live',
          blueTeam: red,
          redTeam: blue,
          winner: null,
          durationSeconds: null
        },
        {
          id: `${series.id}-game-3`,
          number: 3,
          state: 'unstarted',
          blueTeam: null,
          redTeam: null,
          winner: null,
          durationSeconds: null
        }
      ]
    }
  };
}

async function installFixtures(page: Page, finalityRequests: string[]): Promise<void> {
  const seriesById = new Map(
    [...staleFinalSeries, genuineLiveSeries].map(series => [series.id, series] as const)
  );

  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    const url = new URL(route.request().url());
    return json(route, {
      esport: 'lol',
      events: url.searchParams.get('states') === 'completed' ? [] : activeEvents
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => {
    const url = new URL(route.request().url());
    const match = url.pathname.match(/\/series\/([^/]+)\/context$/);
    const id = match ? decodeURIComponent(match[1] ?? '') : '';
    const series = seriesById.get(id);
    if (!series) return json(route, { error: 'unknown series' });
    if (url.searchParams.has('catalogue-final')) finalityRequests.push(id);
    return json(route, id === genuineLiveSeries.id ? liveContext(series) : completedContext(series));
  });
}

test('V3 rotates stale live finality probes without starving ended series', async ({ page }) => {
  const finalityRequests: string[] = [];
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, finalityRequests);
  await page.goto('/');

  await page.locator('.match-filters [data-match-filter="live"]').click();
  await expect(page.locator('.match-card:visible')).toHaveCount(2);
  await expect(page.locator('[data-series-id="stale-final-7"]')).toBeVisible();
  await expect(page.locator('[data-series-id="genuine-live-8"]')).toBeVisible();
  expect(new Set(finalityRequests).size).toBe(6);
  expect(finalityRequests).not.toContain('stale-final-7');
  expect(finalityRequests).not.toContain('genuine-live-8');

  await page.locator('#refresh-data').click();

  await expect.poll(() => new Set(finalityRequests).has('stale-final-7')).toBe(true);
  await expect.poll(() => new Set(finalityRequests).has('genuine-live-8')).toBe(true);
  await expect(page.locator('.match-card:visible')).toHaveCount(1);
  await expect(page.locator('[data-series-id="stale-final-7"]')).toHaveCount(0);
  const liveCard = page.locator('[data-series-id="genuine-live-8"]');
  await expect(liveCard).toBeVisible();
  await expect(liveCard.locator('.match-status')).toHaveText('LIVE');
});
