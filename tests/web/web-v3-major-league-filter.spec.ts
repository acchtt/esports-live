import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };

function scheduleEvent(
  id: string,
  competitionName: string,
  state: 'live' | 'scheduled',
  index: number
) {
  const blue = { id: `${id}-blue`, name: `${competitionName} Blue`, code: `B${index}` };
  const red = { id: `${id}-red`, name: `${competitionName} Red`, code: `R${index}` };
  const gameState = state === 'live' ? 'live' : 'unstarted';
  return {
    series: {
      id,
      esport: 'lol',
      competition: {
        id: `competition-${index}`,
        name: competitionName,
        stage: 'Regular Season'
      },
      teams: [blue, red],
      bestOf: 3,
      state,
      scheduledStart: new Date(Date.now() + index * 60_000).toISOString(),
      games: [{ id: `${id}-game-1`, number: 1, state: gameState }]
    },
    provider,
    observedAt: new Date().toISOString()
  };
}

const events = [
  scheduleEvent('lpl-live', 'LPL Split 3', 'live', 1),
  scheduleEvent('lec-upcoming', 'LEC', 'scheduled', 2),
  scheduleEvent('lck-challengers', 'LCK Challengers', 'scheduled', 3),
  scheduleEvent('nlc-live', 'NLC', 'live', 4)
];

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(page: Page): Promise<void> {
  await page.route('https://ddragon.leagueoflegends.com/**', route => route.abort());
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => json(route, {
    esport: 'lol',
    events: route.request().url().includes('states=completed') ? [] : events
  }));
}

test('V3 Majors filter composes with status filters and excludes challenger leagues', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  const majors = page.locator('[data-major-leagues-filter]');
  await expect(majors).toBeVisible();
  await expect(majors).toHaveText('Majors');
  await expect(majors).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.match-card:visible')).toHaveCount(4);

  await majors.click();
  await expect(majors).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.match-card:visible')).toHaveCount(2);
  await expect(page.locator('[data-series-id="lpl-live"]')).toBeVisible();
  await expect(page.locator('[data-series-id="lec-upcoming"]')).toBeVisible();
  await expect(page.locator('[data-series-id="lck-challengers"]')).toBeHidden();
  await expect(page.locator('[data-series-id="nlc-live"]')).toBeHidden();
  await expect(page.locator('#catalogue-meta')).toHaveText('4 matches · 2 shown · Majors');

  await page.locator('[data-match-filter="upcoming"]').click();
  await expect(page.locator('.match-card:visible')).toHaveCount(1);
  await expect(page.locator('[data-series-id="lec-upcoming"]')).toBeVisible();
  await expect(page.locator('[data-series-id="lck-challengers"]')).toBeHidden();
  await expect(page.locator('#catalogue-meta')).toHaveText('4 matches · 1 shown · Majors');

  await majors.click();
  await expect(majors).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.match-card:visible')).toHaveCount(2);
  await expect(page.locator('[data-series-id="lec-upcoming"]')).toBeVisible();
  await expect(page.locator('[data-series-id="lck-challengers"]')).toBeVisible();
  await expect(page.locator('#catalogue-meta')).toHaveText('4 matches · 2 shown');
});
