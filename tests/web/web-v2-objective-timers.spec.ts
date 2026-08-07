import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blueTeam = { id: 'blue', name: 'Blue Team', code: 'BLU' };
const redTeam = { id: 'red', name: 'Red Team', code: 'RED' };

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const series = {
  id: 'series-objective-timers',
  esport: 'lol',
  competition: { id: 'timer-league', name: 'Timer League', stage: 'Week 1' },
  teams: [blueTeam, redTeam],
  bestOf: 3,
  state: 'live',
  scheduledStart: iso(-10 * 60 * 1_000),
  games: [{ id: 'game-objective-timers', number: 1, state: 'live' }]
};

function team(
  ref: typeof blueTeam,
  side: 'blue' | 'red',
  dragons: readonly string[],
  barons: number
) {
  return {
    id: ref.id,
    name: ref.name,
    side,
    gold: side === 'blue' ? 18_000 : 17_500,
    kills: side === 'blue' ? 4 : 3,
    objectives: {
      towers: side === 'blue' ? 2 : 1,
      inhibitors: 0,
      dragons,
      barons,
      heralds: 0,
      grubs: 3
    },
    players: []
  };
}

function snapshot(clock: number, dragonCount: number, baronCount: number) {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[0],
    stats: {
      gameClockSeconds: clock,
      patch: '26.15.1',
      blue: team(
        blueTeam,
        'blue',
        Array.from({ length: dragonCount }, (_, index) => `dragon-${index + 1}`),
        baronCount
      ),
      red: team(redTeam, 'red', [], 0)
    },
    quality: {
      freshness: 'fresh',
      sourceTimestamp: iso(),
      observedAt: iso(),
      ageSeconds: 1,
      complete: false,
      advancing: true,
      safeForLiveAnalysis: true,
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

async function installBaseRoutes(
  page: Page,
  liveSnapshot: (requestNumber: number) => ReturnType<typeof snapshot>
): Promise<() => number> {
  let snapshotRequests = 0;

  await page.route('**/health', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => {
    const completed = route.request().url().includes('states=completed');
    return json(route, {
      esport: 'lol',
      events: completed ? [] : [{ series, provider, observedAt: iso() }]
    });
  });

  await page.route('**/v1/lol/games/**/live**', route => {
    snapshotRequests += 1;
    return json(route, liveSnapshot(snapshotRequests));
  });

  return () => snapshotRequests;
}

test('web v2 shows exact dragon and Baron first-spawn countdowns', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installBaseRoutes(page, () => snapshot(60, 0, 0));
  await page.goto('/v2/');
  await page.locator('[data-series-id="series-objective-timers"]').click();

  const dragonTimer = page.locator('[data-objective="dragons"] [data-objective-timer]');
  const baronTimer = page.locator('[data-objective="barons"] [data-objective-timer]');
  await expect(dragonTimer).toBeVisible();
  await expect(baronTimer).toBeVisible();
  await expect(dragonTimer).toHaveAttribute('data-status', 'spawn');
  await expect(baronTimer).toHaveAttribute('data-status', 'spawn');
  await expect(dragonTimer).toHaveText(/SPAWN (3:5[7-9]|4:00)/);
  await expect(baronTimer).toHaveText(/SPAWN (18:5[7-9]|19:00)/);
});

test('web v2 infers objective respawns from adjacent live polls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests = await installBaseRoutes(page, requestNumber => (
    requestNumber === 1 ? snapshot(400, 0, 0) : snapshot(402, 1, 1)
  ));
  await page.goto('/v2/');
  await page.locator('[data-series-id="series-objective-timers"]').click();

  const dragonCard = page.locator('[data-objective="dragons"]');
  const baronCard = page.locator('[data-objective="barons"]');
  const dragonTimer = dragonCard.locator('[data-objective-timer]');
  const baronTimer = baronCard.locator('[data-objective-timer]');

  await expect.poll(requests).toBeGreaterThanOrEqual(2);
  await expect(dragonTimer).toHaveAttribute('data-status', 'respawn');
  await expect(baronTimer).toHaveAttribute('data-status', 'respawn');
  await expect(dragonTimer).toHaveAttribute('data-estimated', 'true');
  await expect(baronTimer).toHaveAttribute('data-estimated', 'true');
  await expect(dragonTimer).toHaveText(/RESPAWN ~(4:5[7-9]|5:00)/);
  await expect(baronTimer).toHaveText(/RESPAWN ~(5:5[7-9]|6:00)/);

  const heights = await page.evaluate(() => ({
    dragon: document.querySelector<HTMLElement>('[data-objective="dragons"]')?.getBoundingClientRect().height ?? 0,
    baron: document.querySelector<HTMLElement>('[data-objective="barons"]')?.getBoundingClientRect().height ?? 0
  }));
  expect(heights.dragon).toBeLessThanOrEqual(68);
  expect(heights.baron).toBeLessThanOrEqual(68);
});
