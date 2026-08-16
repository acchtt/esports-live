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

  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute('href', /manifest\.webmanifest$/);
  await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#06090d');

  const manifestHref = await manifestLink.getAttribute('href');
  expect(manifestHref).toBeTruthy();
  const manifest = await page.evaluate(async href => {
    const response = await fetch(href);
    if (!response.ok) throw new Error(`Manifest returned ${response.status}`);
    return await response.json() as {
      name: string;
      short_name: string;
      start_url: string;
      scope: string;
      display: string;
      icons: Array<{ src: string; type: string }>;
    };
  }, manifestHref!);

  expect(manifest.name).toBe('ARENA Esports Live');
  expect(manifest.short_name).toBe('ARENA');
  expect(manifest.start_url).toBe('/');
  expect(manifest.scope).toBe('/');
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.some(icon => icon.src === '/pwa/arena-icon.svg' && icon.type === 'image/svg+xml')).toBe(true);

  await expect(page.locator('#arena-startup-fallback')).toBeHidden();
});

test('V3 service worker keeps the routed app shell and runtime images available offline', async ({ page, context }) => {
  await mockEmptyApi(page);
  await page.goto('/');

  const serviceWorkerSource = await page.evaluate(async () => {
    const response = await fetch('/sw.js');
    if (!response.ok) throw new Error(`Service worker returned ${response.status}`);
    return await response.text();
  });
  expect(serviceWorkerSource).toContain('arena-v3-shell-');
  expect(serviceWorkerSource).toContain('arena-v3-runtime-images-v1');
  expect(serviceWorkerSource).toContain("response.type === 'opaque'");

  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js?v=pwa-test', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  const cachedAssets = await page.evaluate(async () => {
    const cache = await window.caches.open('arena-v3-static-pwa-test');
    return (await cache.keys()).map(request => new URL(request.url).pathname);
  });
  expect(cachedAssets.some(path => path.endsWith('.js'))).toBe(true);
  expect(cachedAssets.some(path => path.endsWith('.css'))).toBe(true);
  expect(cachedAssets).toContain('/manifest.webmanifest');
  expect(cachedAssets).toContain('/pwa/arena-icon.svg');

  await context.setOffline(true);
  await page.goto('/match/offline-series/offline-game', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.brand-lockup')).toBeVisible();
  await expect(page.locator('meta[name="arena-version"]')).toHaveAttribute('content', 'v3');
  expect(new URL(page.url()).pathname).toBe('/match/offline-series/offline-game');
});

test('V3 restores durable completed results after transient caches are cleared', async ({ page }) => {
  let scheduleOnline = true;
  const blue = { id: 'pwa-blue', name: 'PWA Blue', code: 'PWB' };
  const red = { id: 'pwa-red', name: 'PWA Red', code: 'PWR' };
  const completedSeries = {
    id: 'series-pwa-history',
    esport: 'lol',
    competition: { id: 'lck', name: 'LCK', stage: 'Playoffs' },
    teams: [blue, red],
    bestOf: 3,
    state: 'completed',
    scheduledStart: new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString(),
    score: [
      { team: blue, wins: 2 },
      { team: red, wins: 0 }
    ],
    games: [
      { id: 'pwa-game-1', number: 1, state: 'completed' },
      { id: 'pwa-game-2', number: 2, state: 'completed' }
    ]
  };
  const provider = { id: 'fixture', name: 'Fixture provider' };

  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', async route => {
    if (!scheduleOnline) {
      await route.abort('failed');
      return;
    }
    const url = new URL(route.request().url());
    const history = url.searchParams.get('states') === 'completed';
    await json(route, {
      esport: 'lol',
      events: history
        ? [{ series: completedSeries, provider, observedAt: new Date().toISOString() }]
        : []
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const card = page.locator('[data-series-id="series-pwa-history"]');
  await expect(card).toBeVisible();
  await expect(card.locator('.match-series-score')).toHaveText('2 – 0');

  await expect.poll(() => page.evaluate(async () => {
    try {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('arena-v3-pwa-history', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const count = await new Promise<number>((resolve, reject) => {
        const request = database.transaction('completed-series', 'readonly')
          .objectStore('completed-series')
          .count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return count;
    } catch {
      return 0;
    }
  })).toBeGreaterThanOrEqual(1);

  await page.evaluate(async () => {
    window.localStorage.clear();
    await window.caches.delete('arena-v3-api-last-good-v1');
  });
  scheduleOnline = false;
  await page.reload();

  const restored = page.locator('[data-series-id="series-pwa-history"]');
  await expect(restored).toBeVisible();
  await expect(restored.locator('.match-status')).toHaveText('FINAL');
  await expect(restored.locator('.match-series-score')).toHaveText('2 – 0');
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.v3DataSource)).toBe('cache');
});

test('V3 treats a Capacitor Android bridge as native and skips the browser service worker', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    (window as Window & { androidBridge?: Record<string, never> }).androidBridge = {};
  });
  await mockEmptyApi(page);
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '31px');
  });

  await expect(page.locator('html')).toHaveAttribute('data-v3-runtime', 'android');
  await expect(page.locator('html')).toHaveAttribute('data-v3-display-mode', 'standalone');
  await expect(page.locator('html')).toHaveAttribute('data-v3-pwa', 'native');

  await expect.poll(async () => page.locator('.app-header').evaluate(header => (
    Number.parseFloat(getComputedStyle(header).paddingTop)
  ))).toBeGreaterThanOrEqual(42);
  await expect.poll(async () => page.locator('.app-header').evaluate(header => (
    Number.parseFloat(getComputedStyle(header).minHeight)
  ))).toBeGreaterThanOrEqual(103);

  const registrations = await page.evaluate(async () => (
    'serviceWorker' in navigator
      ? (await navigator.serviceWorker.getRegistrations()).length
      : 0
  ));
  expect(registrations).toBe(0);

  await page.evaluate(async () => {
    await window.caches.open('arena-v3-shell-stale-native-build');
    await window.caches.open('arena-v3-static-stale-native-build');
    await window.caches.open('arena-v3-api-last-good-v1');
  });
  await page.reload();

  await expect.poll(async () => page.evaluate(async () => await window.caches.keys())).toEqual([
    'arena-v3-api-last-good-v1'
  ]);
});
