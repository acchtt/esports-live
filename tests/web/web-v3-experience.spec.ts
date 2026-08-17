import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const now = Date.now();

function team(id: string, name: string, code: string) {
  return { id, name, code };
}

function seriesEvent(
  id: string,
  state: 'live' | 'scheduled' | 'completed',
  start: number,
  competition: string,
  blueName: string,
  redName: string
) {
  const blue = team(`${id}-blue`, blueName, blueName.split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase());
  const red = team(`${id}-red`, redName, redName.split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase());
  const games = state === 'completed'
    ? [
        { id: `${id}-game-1`, number: 1, state: 'completed' },
        { id: `${id}-game-2`, number: 2, state: 'completed' }
      ]
    : state === 'live'
      ? [
          { id: `${id}-game-1`, number: 1, state: 'live' },
          { id: `${id}-game-2`, number: 2, state: 'unstarted' },
          { id: `${id}-game-3`, number: 3, state: 'unstarted' }
        ]
      : [
          { id: `${id}-game-1`, number: 1, state: 'unstarted' },
          { id: `${id}-game-2`, number: 2, state: 'unstarted' },
          { id: `${id}-game-3`, number: 3, state: 'unstarted' }
        ];
  return {
    series: {
      id,
      esport: 'lol',
      competition: { id: `${id}-competition`, name: competition, stage: 'Regular Season' },
      teams: [blue, red],
      bestOf: 3,
      state,
      scheduledStart: new Date(start).toISOString(),
      games,
      ...(state === 'completed' ? {
        score: [
          { team: blue, wins: 2 },
          { team: red, wins: 0 }
        ]
      } : {})
    },
    provider,
    observedAt: new Date().toISOString()
  };
}

const liveEvent = seriesEvent('live-feature', 'live', now - 30 * 60_000, 'LCK', 'Feature Blue', 'Feature Red');
const upcomingEvents = [
  seriesEvent('upcoming-today', 'scheduled', now + 4 * 60 * 60_000, 'LEC', 'Soon Blue', 'Soon Red'),
  seriesEvent('upcoming-later', 'scheduled', now + 52 * 60 * 60_000, 'LPL', 'Later Blue', 'Later Red')
];
const historyEvents = [
  seriesEvent('result-recent', 'completed', now - 2 * 86_400_000, 'LCK', 'Recent Blue', 'Recent Red'),
  seriesEvent('result-mid', 'completed', now - 12 * 86_400_000, 'LEC', 'Mid Blue', 'Mid Red'),
  seriesEvent('result-old', 'completed', now - 45 * 86_400_000, 'LPL', 'Old Blue', 'Old Red')
];

function player(id: string, handle: string, gold: number) {
  return {
    id,
    handle,
    championId: 'Aatrox',
    role: 'top',
    level: 15,
    kills: 2,
    deaths: 1,
    assists: 5,
    creepScore: 210,
    totalGold: gold,
    items: []
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

async function installFixtures(page: Page): Promise<void> {
  let liveTick = 0;
  await page.route('https://ddragon.leagueoflegends.com/**', route => route.abort());
  await page.route('https://raw.communitydragon.org/**', route => route.abort());
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    const url = new URL(route.request().url());
    const history = url.searchParams.get('states') === 'completed';
    return json(route, {
      esport: 'lol',
      events: history ? historyEvents : [liveEvent, ...upcomingEvents]
    });
  });
  await page.route('**/v1/lol/series/**/context**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: liveEvent.series.id,
    provider,
    observedAt: new Date().toISOString(),
    rosters: [],
    standings: [],
    history: { bestOf: 3, winsRequired: 2, drawPossible: false, score: [], games: [] },
    complete: false,
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => {
    liveTick += 1;
    const blueGold = 31_500 + liveTick * 650;
    const redGold = 31_000;
    const bluePlayers = Array.from({ length: 5 }, (_, index) => player(`blue-${index}`, `Blue ${index + 1}`, 10_000 + index * 500));
    const redPlayers = Array.from({ length: 5 }, (_, index) => player(`red-${index}`, `Red ${index + 1}`, 9_700 + index * 480));
    const timestamp = new Date().toISOString();
    return json(route, {
      schemaVersion: '1.0',
      esport: 'lol',
      provider,
      series: liveEvent.series,
      game: liveEvent.series.games[0],
      stats: {
        gameClockSeconds: 1_200 + liveTick * 5,
        patch: '26.15.1',
        blue: {
          id: liveEvent.series.teams[0]!.id,
          name: liveEvent.series.teams[0]!.name,
          side: 'blue',
          gold: blueGold,
          kills: 6 + liveTick,
          objectives: { towers: 3 + (liveTick > 1 ? 1 : 0), inhibitors: 0, dragons: ['cloud'], barons: 0, heralds: 1, grubs: null },
          players: bluePlayers
        },
        red: {
          id: liveEvent.series.teams[1]!.id,
          name: liveEvent.series.teams[1]!.name,
          side: 'red',
          gold: redGold,
          kills: 5,
          objectives: { towers: 2, inhibitors: 0, dragons: [], barons: 0, heralds: 0, grubs: null },
          players: redPlayers
        }
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
}

test('V3 upgrades schedule and results browsing without flooding Home', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  await expect(page.locator('[data-home-dashboard]')).toBeVisible();
  await expect(page.locator('.arena-data-status').first()).toContainText('Live data');

  await page.locator('.match-filters [data-match-filter="upcoming"]').click();
  await expect(page.locator('.catalogue-date-group')).toHaveCount(2);
  await expect(page.locator('.match-countdown')).toHaveCount(2);
  await expect(page.locator('.calendar-action:not(:disabled)')).toHaveCount(2);
  await expect(page.locator('.match-countdown').first()).toContainText('Starts in');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('.calendar-action').first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.ics$/);

  await page.locator('.match-filters [data-match-filter="ended"]').click();
  await expect(page.locator('.results-tools')).toBeVisible();
  await expect(page.locator('.match-card:visible')).toHaveCount(3);

  await page.locator('[data-results-days]').selectOption('7');
  await expect(page.locator('.match-card[data-results-match="true"]:visible')).toHaveCount(1);
  await expect(page.locator('[data-results-summary]')).toHaveText('1 result');

  await page.locator('[data-results-days]').selectOption('all');
  await page.locator('[data-results-search]').fill('Old Red');
  await expect(page.locator('.match-card[data-results-match="true"]:visible')).toHaveCount(1);
  await expect(page.locator('.match-card[data-results-match="true"]:visible')).toContainText('Old Red');
});

test('V3 adds live momentum, a non-layout mini score, change cues and offline status', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');
  await page.locator('[data-series-id="live-feature"]').click();

  await expect(page.locator('#game-label')).toContainText('Live');
  await expect(page.locator('.arena-momentum')).toBeVisible();
  await expect.poll(async () => Number(await page.locator('.arena-momentum').getAttribute('data-points') ?? '0'), { timeout: 6_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('[data-momentum-current]')).toContainText('BLUE +');
  await expect(page.locator('[data-momentum-line]')).toHaveAttribute('d', /L/);
  await expect(page.locator('.detail-header .arena-data-status')).toContainText('Live');

  await expect(page.locator('.arena-stat-changed').first()).toBeVisible({ timeout: 5_000 });

  await expect(page.locator('.arena-mini-match')).toHaveAttribute('data-visible', 'false');
  await page.evaluate(() => window.scrollTo(0, 650));
  await expect(page.locator('.arena-mini-match')).toHaveAttribute('data-visible', 'true');
  await expect(page.locator('[data-mini-kills]')).toContainText('–');
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.arena-mini-match')).toHaveAttribute('data-visible', 'false');

  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.detail-header .arena-data-status')).toHaveText('Offline • showing saved data');
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.detail-header .arena-data-status')).toContainText('Live');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
