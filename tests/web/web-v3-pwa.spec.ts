import { expect, test, type Route } from '@playwright/test';

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function mockEmptyApi(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/health**', route => json(route, {
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

test('V3 exposes installable PWA metadata', async ({ page }) => {
  await mockEmptyApi(page);
  await page.goto('/');

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');

  const manifest = await page.evaluate(async () => {
    const response = await fetch('/manifest.webmanifest');
    if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
    return await response.json() as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      icons: Array<{ src: string; type: string }>;
    };
  });

  expect(manifest.name).toBe('ARENA Esports Live');
  expect(manifest.short_name).toBe('ARENA');
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some(icon => icon.src === '/pwa/arena-icon.svg' && icon.type === 'image/svg+xml')).toBe(true);
});

test('V3 service worker keeps the routed app shell available offline', async ({ page, context }) => {
  await mockEmptyApi(page);
  await page.goto('/');

  const serviceWorkerSource = await page.evaluate(async () => {
    const response = await fetch('/sw.js');
    if (!response.ok) throw new Error(`Service worker returned ${response.status}`);
    return await response.text();
  });
  expect(serviceWorkerSource).toContain('arena-v3-shell-');

  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js?v=pwa-test', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.goto('/match/offline-series/offline-game', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.brand-lockup')).toBeVisible();
  await expect(page.locator('meta[name="arena-version"]')).toHaveAttribute('content', 'v3');
  expect(new URL(page.url()).pathname).toBe('/match/offline-series/offline-game');
});
