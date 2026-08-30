import { expect, test, type Page, type Route } from '@playwright/test';

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(page: Page): Promise<void> {
  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => fulfillJson(route, {
    esport: 'lol',
    events: []
  }));
}

async function seedLiveHistoryBoard(page: Page, delayMs = 0): Promise<void> {
  await page.evaluate(delay => {
    window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>('#series-history');
      if (!panel) return;
      panel.className = 'completed-games-panel live-series-results';
      panel.hidden = false;
      panel.innerHTML = `
        <div class="completed-section-heading">
          <div><span class="eyebrow">SERIES</span><h3>Game results</h3></div>
          <span>0 of 3 games played</span>
        </div>`;
    }, delay);
  }, delayMs);
}

test('keeps the live series board hidden while Match History owns the analysis panel', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installFixtures(page);
  await page.goto('/match.html');

  const liveHistoryPanel = page.locator('#series-history');
  const completedDetail = page.locator('#completed-match-detail');
  const matchHistoryMode = page.locator('.schedule-mode[data-mode="results"]');
  const activeMode = page.locator('.schedule-mode[data-mode="active"]');

  await expect(matchHistoryMode).toHaveCount(1);
  await expect(activeMode).toHaveCount(1);
  await seedLiveHistoryBoard(page);
  await expect(liveHistoryPanel).toBeVisible();

  await matchHistoryMode.evaluate(button => (button as HTMLButtonElement).click());
  await expect(completedDetail).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-view-mode', 'match-history');
  await expect(liveHistoryPanel).toBeHidden();

  await seedLiveHistoryBoard(page, 50);
  await page.waitForTimeout(250);
  await expect(liveHistoryPanel).toBeHidden();

  await activeMode.evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('body')).toHaveAttribute('data-view-mode', 'active');
  await expect(liveHistoryPanel).toBeVisible();

  await matchHistoryMode.evaluate(button => (button as HTMLButtonElement).click());
  await seedLiveHistoryBoard(page, 50);
  await page.waitForTimeout(250);
  await expect(completedDetail).toBeVisible();
  await expect(liveHistoryPanel).toBeHidden();

  expect(pageErrors).toEqual([]);
});
