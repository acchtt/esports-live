import { defineConfig } from '@playwright/test';

const webAppRoot = process.env.WEB_APP_ROOT ?? 'apps/web';
const desktopTestIgnore = webAppRoot === 'apps/web'
  ? [/mobile-.*\.spec\.ts/, /web-v2-.*\.spec\.ts/]
  : [];

export default defineConfig({
  testDir: './tests/web',
  testIgnore: desktopTestIgnore,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 6_000
  },
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: `npx vite preview ${webAppRoot} --host 127.0.0.1 --port 4173`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});
