import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };

function scheduleEvent(
  id: string,
  state: 'live' | 'scheduled' | 'completed',
  index: number
) {
  const competition = index % 4 === 0 ? 'LCK' : index % 4 === 1 ? 'LPL' : index % 4 === 2 ? 'LEC' : 'LCS';
  const gameState = state === 'live' ? 'live' : state === 'completed' ? 'completed' : 'unstarted';
  const offsetMinutes = state === 'completed' ? -index : index;
  return {
    series: {
      id,
      esport: 'lol',
      competition: { id: `${competition.toLowerCase()}-${index}`, name: competition, stage: 'Regular Season' },
      teams: [
        { id: `${id}-blue`, name: `${competition} Blue ${index}`, code: `B${index}` },
        { id: `${id}-red`, name: `${competition} Red ${index}`, code: `R${index}` }
      ],
      bestOf: 3,
      state,
      scheduledStart: new Date(Date.now() + offsetMinutes * 60_000).toISOString(),
      games: [{ id: `${id}-game-1`, number: 1, state: gameState }],
      ...(state === 'completed' ? {
        score: [
          { team: { id: `${id}-blue`, name: `${competition} Blue ${index}` }, wins: 2 },
          { team: { id: `${id}-red`, name: `${competition} Red ${index}` }, wins: 0 }
        ]
      } : {})
    },
    provider,
    observedAt: new Date().toISOString()
  };
}

const activeEvents = [
  ...Array.from({ length: 3 }, (_, index) => scheduleEvent(`live-${index + 1}`, 'live', index + 1)),
  ...Array.from({ length: 9 }, (_, index) => scheduleEvent(`upcoming-${index + 1}`, 'scheduled', index + 10))
];
const historyEvents = Array.from(
  { length: 30 },
  (_, index) => scheduleEvent(`result-${index + 1}`, 'completed', index + 1)
);

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(page: Page, counters: { bounded: number; full: number }): Promise<void> {
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => {
    const url = new URL(route.request().url());
    const history = url.searchParams.get('states') === 'completed';
    if (!history) return json(route, { esport: 'lol', events: activeEvents });

    const limit = url.searchParams.get('limit');
    if (limit === '24') counters.bounded += 1;
    else counters.full += 1;
    const events = limit === '24' ? historyEvents.slice(0, 24) : historyEvents;
    return json(route, { esport: 'lol', events });
  });
}

test('V3 home is curated and only loads the full results archive on demand', async ({ page }) => {
  const counters = { bounded: 0, full: 0 };
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, counters);
  await page.goto('/');

  await expect(page.locator('.catalogue-header h1')).toHaveText('Match center');
  await expect(page.locator('.match-filters [data-match-filter]')).toHaveText([
    'Home',
    'Live',
    'Upcoming',
    'Results'
  ]);
  await expect(page.locator('[data-home-dashboard]')).toBeVisible();
  await expect(page.locator('[data-home-section="live"] .match-card')).toHaveCount(3);
  await expect(page.locator('[data-home-section="upcoming"] .match-card')).toHaveCount(6);
  await expect(page.locator('[data-home-section="recent"] .match-card')).toHaveCount(4);
  await expect(page.locator('#catalogue-grid .match-card')).toHaveCount(13);
  await expect(page.locator('#catalogue-meta')).toHaveText('36 matches · 13 shown');
  await expect.poll(() => counters.bounded).toBeGreaterThanOrEqual(1);
  expect(counters.full).toBe(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.v3HistoryMode)).toBe('recent');

  const transientDisplay = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('#catalogue-grid');
    if (!grid) throw new Error('Missing catalogue grid');
    const card = document.createElement('article');
    card.className = 'match-card';
    grid.append(card);
    const display = getComputedStyle(card).display;
    card.remove();
    return display;
  });
  expect(transientDisplay).toBe('none');

  const spacing = await page.evaluate(() => {
    const tabs = document.querySelector<HTMLElement>('.match-filters');
    const pills = document.querySelector<HTMLElement>('.catalogue-filter-pills');
    const firstSection = document.querySelector<HTMLElement>('[data-home-section="live"]');
    if (!tabs || !pills || !firstSection) throw new Error('Missing homepage spacing elements');
    const tabRect = tabs.getBoundingClientRect();
    const pillRect = pills.getBoundingClientRect();
    const sectionRect = firstSection.getBoundingClientRect();
    return {
      tabGap: pillRect.top - tabRect.bottom,
      sectionGap: sectionRect.top - pillRect.bottom
    };
  });
  expect(spacing.tabGap).toBeGreaterThanOrEqual(8);
  expect(spacing.sectionGap).toBeGreaterThanOrEqual(16);

  const header = page.locator('.app-header');
  const expandedHeaderHeight = await header.evaluate(element => element.getBoundingClientRect().height);
  expect(expandedHeaderHeight).toBeGreaterThanOrEqual(70);
  expect(await header.getAttribute('data-compact')).toBeNull();

  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(240);
  expect(await header.getAttribute('data-compact')).toBeNull();
  const scrolledHeaderHeight = await header.evaluate(element => element.getBoundingClientRect().height);
  expect(Math.abs(scrolledHeaderHeight - expandedHeaderHeight)).toBeLessThanOrEqual(1);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(240);
  expect(await header.getAttribute('data-compact')).toBeNull();
  const topHeaderHeight = await header.evaluate(element => element.getBoundingClientRect().height);
  expect(Math.abs(topHeaderHeight - expandedHeaderHeight)).toBeLessThanOrEqual(1);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  await page.locator('.match-filters [data-match-filter="ended"]').click();
  await expect.poll(() => counters.full).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.match-card:visible')).toHaveCount(30);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.v3HistoryMode)).toBe('full');

  const boundedBeforeHome = counters.bounded;
  await page.locator('.match-filters [data-match-filter="all"]').click();
  await expect(page.locator('[data-home-dashboard]')).toBeVisible();
  await expect(page.locator('#catalogue-grid .match-card')).toHaveCount(13);
  await expect.poll(() => counters.bounded).toBeGreaterThan(boundedBeforeHome);
  await expect(page.locator('#catalogue-meta')).toHaveText('36 matches · 13 shown');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.v3HistoryMode)).toBe('recent');
});
