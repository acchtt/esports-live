import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'recovery-blue', name: 'Recovery Blue', code: 'RBL' };
const red = { id: 'recovery-red', name: 'Recovery Red', code: 'RRD' };
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const series = {
  id: 'series-mobile-recovery',
  esport: 'lol',
  competition: { id: 'competition-recovery', name: 'Recovery League', stage: 'Final' },
  teams: [blue, red],
  bestOf: 1,
  state: 'completed',
  scheduledStart: iso(-2 * 60 * 60 * 1_000),
  games: [{ id: 'game-mobile-recovery-1', number: 1, state: 'completed' }]
};

function players(side: 'blue' | 'red') {
  return roles.map((role, index) => ({
    id: `${side}-${index}`,
    handle: `${side} ${role}`,
    championId: ['Jayce', 'Maokai', 'Orianna', 'Ashe', 'Alistar'][index],
    role,
    level: 12,
    kills: side === 'blue' ? 2 : 1,
    deaths: side === 'blue' ? 1 : 2,
    assists: 5,
    creepScore: 120 + index * 20,
    totalGold: 6_000 + index * 350,
    items: ['1001', '2003', '1036']
  }));
}

function snapshot() {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[0],
    stats: {
      gameClockSeconds: 1_800,
      patch: '26.15.1',
      blue: {
        ...blue,
        side: 'blue',
        gold: 35_000,
        kills: 12,
        objectives: { towers: 8, inhibitors: 1, dragons: ['infernal'], barons: 1, heralds: 1, grubs: 3 },
        players: players('blue')
      },
      red: {
        ...red,
        side: 'red',
        gold: 31_000,
        kills: 7,
        objectives: { towers: 3, inhibitors: 0, dragons: ['cloud'], barons: 0, heralds: 0, grubs: 1 },
        players: players('red')
      }
    },
    quality: {
      freshness: 'historical',
      sourceTimestamp: iso(-60 * 60 * 1_000),
      observedAt: iso(),
      ageSeconds: 3_600,
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
    return json(route, { esport: 'lol', events: activeOnly ? [] : [{ series, provider, observedAt: iso() }] });
  });
  await page.route('**/v1/lol/series/**/context**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: series.id,
    provider,
    observedAt: iso(),
    rosters: [],
    standings: [],
    history: {
      bestOf: 1,
      winsRequired: 1,
      drawPossible: false,
      score: [{ team: blue, wins: 1 }, { team: red, wins: 0 }],
      games: [{ ...series.games[0], blueTeam: blue, redTeam: red, winner: blue, durationSeconds: 1_800 }]
    },
    complete: true,
    reasons: []
  }));

  let finalRequests = 0;
  await page.route('**/v1/lol/games/**/live**', async route => {
    finalRequests += 1;
    if (finalRequests === 1) {
      await route.abort('failed');
      return;
    }
    await json(route, snapshot());
  });
}

test('mobile fallback recovers when the first final scoreboard request fails', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Open match history' }).click();
  const card = page.locator('[data-completed-series-id="series-mobile-recovery"]');
  await expect(card).toBeVisible();
  await card.click();

  await expect(page.locator('.completed-telemetry-loading')).toBeVisible();
  await expect(page.locator('.mobile-recovery-matchups .mobile-recovery-row')).toHaveCount(5, { timeout: 15_000 });
  await expect(page.locator('#build-version')).toContainText('DEMO v0.4');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'live');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
