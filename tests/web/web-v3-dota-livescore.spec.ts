import { expect, test, type Page, type Route } from '@playwright/test';

function json(route: Route, body: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body)
  });
}

const event = {
  series: {
    id: 'opendota-series:1130024',
    esport: 'dota2',
    competition: {
      id: 'opendota-league:19719',
      name: 'Dota 2 League 19719',
      stage: 'Live series'
    },
    teams: [
      { id: 'falcons', name: 'Team Falcons' },
      { id: 'lgd', name: 'LGD Gaming' }
    ],
    bestOf: 1,
    state: 'live',
    scheduledStart: '2026-08-13T10:00:00.000Z',
    games: [
      { id: 'game-one', number: 1, state: 'completed' },
      { id: 'game-two', number: 2, state: 'live' }
    ]
  },
  provider: { id: 'opendota-live', name: 'OpenDota Live' },
  observedAt: '2026-08-13T10:30:10.000Z'
};

const snapshot = {
  schemaVersion: '1.0',
  esport: 'dota2',
  provider: { id: 'opendota-live', name: 'OpenDota Live' },
  series: event.series,
  game: { id: 'game-two', number: 2, state: 'live' },
  stats: {
    gameClockSeconds: 725,
    radiant: {
      id: 'falcons',
      name: 'Team Falcons',
      side: 'radiant',
      kills: 3,
      players: [{
        accountId: '1',
        heroId: 1,
        heroName: 'Anti-Mage',
        heroImageUrl: null,
        side: 'radiant',
        position: 1
      }]
    },
    dire: {
      id: 'lgd',
      name: 'LGD Gaming',
      side: 'dire',
      kills: 1,
      players: [{
        accountId: '2',
        heroId: 2,
        heroName: 'Axe',
        heroImageUrl: null,
        side: 'dire',
        position: 1
      }]
    },
    radiantNetWorthLead: 3_204,
    spectators: 6_873,
    broadcastDelaySeconds: 120
  },
  quality: {
    freshness: 'fresh',
    sourceTimestamp: '2026-08-13T10:30:00.000Z',
    observedAt: '2026-08-13T10:30:10.000Z',
    ageSeconds: 10,
    complete: true,
    advancing: true,
    safeForLiveAnalysis: true,
    reasons: []
  }
};

async function mockApis(page: Page): Promise<void> {
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
  await page.route('**/v1/dota2/schedule**', route => json(route, {
    esport: 'dota2',
    events: [event],
    page: { total: 1, offset: 0, limit: 1, nextCursor: null, previousCursor: null }
  }));
  await page.route('**/v1/dota2/games/game-two/live**', route => json(route, snapshot));
}

test('V3 adds Dota livescore without replacing the LoL surface', async ({ page }) => {
  await mockApis(page);
  await page.goto('/?commit=dota-test');

  const lolMain = page.locator('.app-main');
  const dotaMain = page.locator('.dota-live-main');
  await expect(lolMain).toBeVisible();
  await expect(dotaMain).toBeHidden();
  await expect(page.getByRole('button', { name: 'League of Legends' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Dota 2' }).click();
  await expect(lolMain).toBeHidden();
  await expect(dotaMain).toBeVisible();
  await expect(page.locator('.dota-match-card')).toContainText('Team Falcons');
  await expect(page.locator('.dota-match-card')).toContainText('LGD Gaming');
  await expect(page.locator('.dota-match-card')).toContainText('12:05');
  await expect(page.locator('.dota-scoreboard')).toContainText('3');
  await expect(page.locator('.dota-scoreboard')).toContainText('1');
  await expect(page.locator('.dota-score-center')).toContainText('Team Falcons +3.2K');
  await expect(page.locator('.dota-lineups')).toContainText('Anti-Mage');
  await expect(page.locator('.dota-lineups')).toContainText('Axe');

  await page.getByRole('button', { name: 'League of Legends' }).click();
  await expect(lolMain).toBeVisible();
  await expect(dotaMain).toBeHidden();
  await expect(page.locator('.catalogue-header')).toContainText('LEAGUE OF LEGENDS');
});
