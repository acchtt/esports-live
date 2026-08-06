import { expect, test, type Page, type Route } from '@playwright/test';

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(page: Page): Promise<void> {
  await page.route('**/health', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => json(route, {
    esport: 'lol',
    events: []
  }));
}

test('V2 header shrinks while scrolling and expands again at the top', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/v2/');
  await page.addStyleTag({ content: '.v2-shell { min-height: 2200px !important; }' });

  const header = page.locator('.app-header');
  await expect(header).toHaveAttribute('data-compact', 'false');
  const expanded = await header.boundingBox();
  expect(expanded).not.toBeNull();
  expect(expanded?.height ?? 0).toBeGreaterThanOrEqual(70);

  await page.evaluate(() => window.scrollTo(0, 240));
  await expect(header).toHaveAttribute('data-compact', 'true');
  await expect.poll(async () => (await header.boundingBox())?.height ?? 999).toBeLessThanOrEqual(58);

  const compact = await header.boundingBox();
  expect(compact).not.toBeNull();
  expect(compact?.y ?? 999).toBeLessThanOrEqual(1);
  expect(compact?.height ?? 999).toBeLessThan(expanded?.height ?? 0);

  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(header).toHaveAttribute('data-compact', 'false');
  await expect.poll(async () => (await header.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(70);
});
