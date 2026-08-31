import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const left = { id: 'ns', name: 'NS Challengers', code: 'NS' };
const right = { id: 'dns', name: 'DNS Challengers', code: 'DNS' };
const games = Array.from({ length: 5 }, (_, index) => ({
  id: `game-${index + 1}`,
  number: index + 1,
  state: 'completed' as const
}));
const series = {
  id: 'series-score-stability',
  esport: 'lol',
  competition: { id: 'lck-cl', name: 'LCK Challengers', stage: 'Playoffs' },
  teams: [left, right] as const,
  bestOf: 5,
  state: 'live' as const,
  scheduledStart: new Date().toISOString(),
  games
};

async function fulfillJson(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(page: Page): Promise<void> {
  await page.route('https://www.riotgames.com/darkroom/original/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"></svg>'
  }));

  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => fulfillJson(route, {
    esport: 'lol',
    events: [{ series, provider, observedAt: new Date().toISOString() }]
  }));

  await page.route('**/v1/lol/series/**/context**', route => fulfillJson(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: series.id,
    provider,
    observedAt: new Date().toISOString(),
    rosters: [],
    standings: [],
    history: {
      bestOf: 5,
      winsRequired: 3,
      drawPossible: false,
      score: [
        { team: left, wins: 3 },
        { team: right, wins: 2 }
      ],
      games: games.map((game, index) => ({
        ...game,
        blueTeam: index % 2 === 0 ? left : right,
        redTeam: index % 2 === 0 ? right : left,
        winner: index < 3 ? left : right,
        durationSeconds: 1800 + index * 60
      }))
    },
    complete: true,
    reasons: []
  }));
}

test('does not regress a resolved 3-2 series score to 0-0 during schedule refreshes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installFixtures(page);

  await page.goto('/match.html?series=series-score-stability');

  const hero = page.locator('#series-hero');
  const score = hero.locator('.series-hero-score strong');
  await expect(score.nth(0)).toHaveText('3');
  await expect(score.nth(1)).toHaveText('2');
  await expect(hero.locator('.series-hero-status')).toHaveText('FINAL');
  await expect(hero.locator('.series-hero-live-context')).toContainText('Series completed');

  await page.evaluate(({ series, provider }) => {
    const selectedSeries = document.querySelector<HTMLElement>('#selected-series');
    const selectedMeta = document.querySelector<HTMLElement>('#selected-meta');
    if (selectedSeries) selectedSeries.textContent = 'NS Challengers vs DNS Challengers';
    if (selectedMeta) selectedMeta.textContent = 'LIVE · Best of 5';

    window.dispatchEvent(new CustomEvent('esports-live:selection', {
      detail: {
        series: {
          ...series,
          state: 'scheduled'
        },
        provider,
        observedAt: new Date().toISOString()
      }
    }));
  }, { series, provider });

  await expect(score.nth(0)).toHaveText('3');
  await expect(score.nth(1)).toHaveText('2');
  await expect(hero.locator('.series-hero-status')).toHaveText('FINAL');
  await expect(hero.locator('.series-hero-live-context')).toContainText('Series completed');
  expect(errors).toEqual([]);
});
