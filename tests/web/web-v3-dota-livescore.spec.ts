import { expect, test, type Page, type Route } from '@playwright/test';

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

async function mockApis(page: Page): Promise<() => number> {
  let dotaRequests = 0;
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol', 'dota2']
  }));
  await page.route('**/v1/lol/schedule**', route => json(route, {
    esport: 'lol',
    events: [],
    page: { total: 0, offset: 0, limit: 0, nextCursor: null, previousCursor: null }
  }));
  await page.route('**/v1/dota2/live**', route => {
    dotaRequests += 1;
    return json(route, {
      esport: 'dota2',
      events: [],
      snapshots: [],
      partial: false
    });
  });
  return () => dotaRequests;
}

test('V3 temporarily runs LoL-only without requesting Dota data', async ({ page }) => {
  const dotaRequests = await mockApis(page);
  await page.goto('/?commit=lol-only-test');

  await expect(page.locator('.app-main')).toBeVisible();
  await expect(page.locator('.catalogue-header')).toContainText('LEAGUE OF LEGENDS');
  await expect(page.locator('.esport-switcher')).toHaveCount(0);
  await expect(page.locator('.dota-live-main')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Dota 2' })).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(dotaRequests()).toBe(0);
});
