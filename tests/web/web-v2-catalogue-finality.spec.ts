import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const red = { id: 'red', name: 'Red Team', code: 'RED' };

function iso(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function series(
  id: string,
  state: 'live' | 'scheduled',
  startOffsetMs: number,
  competition = 'Test League'
) {
  return {
    id,
    esport: 'lol',
    competition: { id: competition.toLowerCase().replace(/\s+/g, '-'), name: competition },
    teams: [
      { ...blue, id: `${id}-blue`, name: `${id} Blue` },
      { ...red, id: `${id}-red`, name: `${id} Red` }
    ],
    bestOf: 3,
    state,
    scheduledStart: iso(startOffsetMs),
    games: [
      { id: `${id}-game-1`, number: 1, state: state === 'live' ? 'live' : 'unstarted' },
      { id: `${id}-game-2`, number: 2, state: 'unstarted' },
      { id: `${id}-game-3`, number: 3, state: 'unstarted' }
    ]
  };
}

const tes = series('tes-blg-stale-live', 'live', -4 * 60 * 60 * 1_000, 'LPL');
const ns = series('ns-kt-stale-upcoming', 'scheduled', -10 * 60 * 60 * 1_000, 'LCK Challengers');
const partial = series('partial-live', 'live', -3 * 60 * 60 * 1_000, 'LCK');
const future = series('future-series', 'scheduled', 60 * 60 * 1_000, 'Future League');

function finalContext(value: ReturnType<typeof series>, score: readonly [number, number]) {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: value.id,
    provider,
    observedAt: iso(0),
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [
        { team: value.teams[0], wins: score[0] },
        { team: value.teams[1], wins: score[1] }
      ],
      games: [
        {
          id: `${value.id}-game-1`,
          number: 1,
          state: 'completed',
          blueTeam: value.teams[0],
          redTeam: value.teams[1],
          winner: score[0] > 0 ? value.teams[0] : value.teams[1],
          durationSeconds: 2_000
        },
        {
          id: `${value.id}-game-2`,
          number: 2,
          state: 'completed',
          blueTeam: value.teams[1],
          redTeam: value.teams[0],
          winner: score[0] >= 2 ? value.teams[0] : value.teams[1],
          durationSeconds: 2_100
        }
      ]
    },
    complete: true,
    reasons: []
  };
}

function partialContext() {
  return {
    ...finalContext(partial, [1, 1]),
    history: {
      ...finalContext(partial, [1, 1]).history,
      games: [
        {
          id: `${partial.id}-game-1`,
          number: 1,
          state: 'completed',
          blueTeam: partial.teams[0],
          redTeam: partial.teams[1],
          winner: partial.teams[0],
          durationSeconds: 2_000
        },
        {
          id: `${partial.id}-game-2`,
          number: 2,
          state: 'completed',
          blueTeam: partial.teams[1],
          redTeam: partial.teams[0],
          winner: partial.teams[1],
          durationSeconds: 2_100
        },
        {
          id: `${partial.id}-game-3`,
          number: 3,
          state: 'live',
          blueTeam: partial.teams[0],
          redTeam: partial.teams[1],
          winner: null,
          durationSeconds: null
        }
      ]
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

async function installFixtures(page: Page): Promise<string[]> {
  const contextRequests: string[] = [];
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
      events: history
        ? []
        : [tes, partial, ns, future].map(value => ({
            series: value,
            provider,
            observedAt: iso(0)
          }))
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => {
    const match = route.request().url().match(/series\/([^/]+)\/context/);
    const seriesId = decodeURIComponent(match?.[1] ?? '');
    contextRequests.push(seriesId);
    if (seriesId === tes.id) return json(route, finalContext(tes, [2, 1]));
    if (seriesId === ns.id) return json(route, finalContext(ns, [0, 2]));
    if (seriesId === partial.id) return json(route, partialContext());
    return json(route, finalContext(future, [0, 0]));
  });
  return contextRequests;
}

test('web v2 resolves stale live and overdue upcoming cards from fresh series context', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const contextRequests = await installFixtures(page);

  await page.goto('/v2/');

  const tesCard = page.locator(`[data-series-id="${tes.id}"]`);
  const nsCard = page.locator(`[data-series-id="${ns.id}"]`);
  const partialCard = page.locator(`[data-series-id="${partial.id}"]`);
  const futureCard = page.locator(`[data-series-id="${future.id}"]`);

  await expect(tesCard.locator('.match-status')).toHaveText('FINAL');
  await expect(nsCard.locator('.match-status')).toHaveText('FINAL');
  await expect(partialCard.locator('.match-status')).toHaveText('LIVE');
  await expect(futureCard.locator('.match-status')).toHaveText('UPCOMING');

  expect(contextRequests).toContain(tes.id);
  expect(contextRequests).toContain(ns.id);
  expect(contextRequests).toContain(partial.id);
  expect(contextRequests).not.toContain(future.id);
});
