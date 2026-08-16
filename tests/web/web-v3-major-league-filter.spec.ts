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
  scheduleEvent('lck-upcoming', 'LCK', 'scheduled', 1),
  scheduleEvent('lpl-live', 'LPL Split 3', 'live', 2),
  scheduleEvent('lec-upcoming', 'LEC', 'scheduled', 3),
  scheduleEvent('lcs-live', 'LCS', 'live', 4),
  scheduleEvent('lck-challengers', 'LCK Challengers', 'scheduled', 5),
  scheduleEvent('nlc-live', 'NLC', 'live', 6)
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

test('V3 league pills are multi-select and compose with status tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const statusTabs = page.locator('.match-filters [data-match-filter]');
  const pillGroup = page.locator('.catalogue-filter-pills');
  const pills = pillGroup.locator('[data-league-filter]');
  const lck = pillGroup.locator('[data-league-filter="lck"]');
  const lpl = pillGroup.locator('[data-league-filter="lpl"]');
  const lec = pillGroup.locator('[data-league-filter="lec"]');
  const lcs = pillGroup.locator('[data-league-filter="lcs"]');

  await expect(statusTabs).toHaveCount(4);
  await expect(page.locator('[data-major-leagues-filter]')).toHaveCount(0);
  await expect(pillGroup).toBeVisible();
  await expect(pillGroup).toHaveAttribute('role', 'group');
  await expect(pillGroup).toHaveAttribute('aria-label', 'League filters');
  await expect(pills).toHaveCount(4);
  await expect(pills).toHaveText(['LCK', 'LPL', 'LEC', 'LCS']);
  await expect(pillGroup).not.toContainText('Majors');

  for (const pill of [lck, lpl, lec, lcs]) {
    await expect(pill).toHaveClass(/filter-pill/);
    await expect(pill).toHaveAttribute('aria-pressed', 'false');
  }

  const allBox = await page.locator('[data-match-filter="all"]').boundingBox();
  const lckBox = await lck.boundingBox();
  expect(allBox).not.toBeNull();
  expect(lckBox).not.toBeNull();
  expect(lckBox!.height).toBeLessThan(allBox!.height);

  await expect(page.locator('.match-card:visible')).toHaveCount(6);

  await lck.click();
  await expect(lck).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.match-card:visible')).toHaveCount(1);
  await expect(page.locator('[data-series-id="lck-upcoming"]')).toBeVisible();
  await expect(page.locator('[data-series-id="lck-challengers"]')).toBeHidden();
  await expect(page.locator('#catalogue-meta')).toHaveText('6 matches · 1 shown · LCK');

  await lpl.click();
  await lec.click();
  await lcs.click();
  await expect(page.locator('.match-card:visible')).toHaveCount(4);
  await expect(page.locator('[data-series-id="lpl-live"]')).toBeVisible();
  await expect(page.locator('[data-series-id="lec-upcoming"]')).toBeVisible();
  await expect(page.locator('[data-series-id="lcs-live"]')).toBeVisible();
  await expect(page.locator('[data-series-id="nlc-live"]')).toBeHidden();
  await expect(page.locator('[data-series-id="lck-challengers"]')).toBeHidden();
  await expect(page.locator('#catalogue-meta')).toHaveText('6 matches · 4 shown · LCK + LPL + LEC + LCS');

  await page.locator('[data-match-filter="upcoming"]').click();
  await expect(page.locator('.match-card:visible')).toHaveCount(2);
  await expect(page.locator('[data-series-id="lck-upcoming"]')).toBeVisible();
  await expect(page.locator('[data-series-id="lec-upcoming"]')).toBeVisible();
  await expect(page.locator('[data-series-id="lck-challengers"]')).toBeHidden();
  await expect(page.locator('#catalogue-meta')).toHaveText('6 matches · 2 shown · LCK + LPL + LEC + LCS');

  await lck.click();
  await lpl.click();
  await lec.click();
  await lcs.click();
  await expect(page.locator('.match-card:visible')).toHaveCount(3);
  await expect(page.locator('[data-series-id="lck-challengers"]')).toBeVisible();
  await expect(page.locator('#catalogue-meta')).toHaveText('6 matches · 3 shown');
});
