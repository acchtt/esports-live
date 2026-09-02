import { expect, test, type Route } from '@playwright/test';

const logo = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Crect width='24' height='24' rx='6' fill='white'/%3E%3C/svg%3E";
const provider = { id: 'fixture', name: 'Fixture provider' };
const left = { id: 'left', name: 'Left Dragons', code: 'LD', imageUrl: logo };
const right = { id: 'right', name: 'Right Wolves', code: 'RW', imageUrl: logo };
const upcomingLeft = { id: 'up-left', name: 'Future Foxes', code: 'FF', imageUrl: logo };
const upcomingRight = { id: 'up-right', name: 'Next Knights', code: 'NK', imageUrl: logo };

function json(route: Route, value: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

function series(id: string, state: 'live' | 'scheduled', teams: readonly [typeof left, typeof right]) {
  return {
    id,
    esport: 'lol',
    competition: { id: 'league', name: 'Test League', stage: 'Week 1' },
    teams,
    bestOf: 3,
    state,
    scheduledStart: new Date(Date.now() + (state === 'live' ? -60_000 : 3_600_000)).toISOString(),
    games: state === 'live'
      ? [{ id: 'game-live', number: 1, state: 'live' }]
      : [{ id: 'game-upcoming', number: 1, state: 'unstarted' }]
  };
}

test('renders Nexus Live League-only match rows with team logos and series scores', async ({ page }) => {
  const live = series('series-live-card', 'live', [left, right]);
  const upcoming = series('series-upcoming-card', 'scheduled', [upcomingLeft, upcomingRight] as unknown as readonly [typeof left, typeof right]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/health', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => json(route, {
    esport: 'lol',
    events: [
      { series: live, provider, observedAt: new Date().toISOString() },
      { series: upcoming, provider, observedAt: new Date().toISOString() }
    ]
  }));
  await page.route('**/v1/lol/series/series-live-card/context**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: live.id,
    provider,
    observedAt: new Date().toISOString(),
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [
        { team: left, wins: 1 },
        { team: right, wins: 0 }
      ],
      games: []
    },
    complete: true,
    reasons: []
  }));

  await page.goto('/');
  await expect(page.getByText('API connected')).toBeVisible();
  await expect(page.locator('.nexus-brand')).toContainText('NEXUS LIVE');
  await expect(page.getByText('Counter-Strike 2')).toHaveCount(0);
  await expect(page.getByText('Dota 2')).toHaveCount(0);

  const liveCard = page.locator('[data-series-id="series-live-card"]');
  const upcomingCard = page.locator('[data-series-id="series-upcoming-card"]');
  await expect(liveCard).toBeVisible();
  await expect(liveCard.locator('.index-team-logo img')).toHaveCount(2);
  await expect(liveCard.locator('.index-series-score')).toHaveText(/1\s*–\s*0/);
  await expect(upcomingCard.locator('.index-series-score')).toHaveText(/0\s*–\s*0/);

  const presentation = await liveCard.evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      radius: style.borderTopLeftRadius,
      backgroundImage: style.backgroundImage,
      boxShadow: style.boxShadow
    };
  });

  expect(presentation.height).toBeLessThan(110);
  expect(presentation.width).toBeGreaterThan(800);
  expect(presentation.radius).toBe('0px');
  expect(presentation.backgroundImage).toBe('none');
  expect(presentation.boxShadow).toBe('none');
});
