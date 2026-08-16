import { expect, test, type Route } from '@playwright/test';

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

test('V3 puts split data status first and enlarges mobile item slots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => json(route, { esport: 'lol', events: [] }));
  await page.goto('/');
  await expect(page.locator('#catalogue-meta')).toContainText('0 matches');

  const scoreboard = page.locator('#scoreboard');
  const freshness = page.locator('#quality-text');
  expect(await scoreboard.evaluate(element => element.firstElementChild?.id)).toBe('quality-text');

  await freshness.evaluate(element => {
    element.textContent = 'FINAL DATA · Partial snapshot';
  });
  await expect(freshness.locator('.telemetry-freshness-primary')).toHaveText('FINAL DATA');
  await expect(freshness.locator('.telemetry-freshness-detail')).toHaveText('Partial snapshot');
  await expect(freshness).toHaveText('FINAL DATA · Partial snapshot');

  const itemLayout = await page.evaluate(() => {
    const items = document.createElement('div');
    items.className = 'player-items';
    const slot = document.createElement('span');
    slot.className = 'player-item-slot';
    items.append(slot);
    document.body.append(items);
    const slotStyle = getComputedStyle(slot);
    const itemsStyle = getComputedStyle(items);
    const result = {
      width: Number.parseFloat(slotStyle.width),
      height: Number.parseFloat(slotStyle.height),
      wrap: itemsStyle.flexWrap
    };
    items.remove();
    return result;
  });

  expect(itemLayout.width).toBeGreaterThanOrEqual(24);
  expect(itemLayout.height).toBeGreaterThanOrEqual(24);
  expect(itemLayout.wrap).toBe('wrap');
});
