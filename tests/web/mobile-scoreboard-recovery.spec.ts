import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'recovery-blue', name: 'Recovery Blue Academy', code: 'RBL' };
const red = { id: 'recovery-red', name: 'Recovery Red Esports', code: 'RRD' };
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
const champions = ['Jayce', 'Maokai', 'Orianna', 'Ashe', 'Alistar'] as const;

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

const series = {
  id: 'series-mobile-recovery',
  esport: 'lol',
  competition: { id: 'competition-recovery', name: 'Recovery League', stage: 'Final' },
  teams: [blue, red],
  bestOf: 1,
  state: 'completed',
  scheduledStart: iso(-2 * 60 * 60 * 1_000),
  games: [{ id: 'game-mobile-recovery-1', number: 1, state: 'completed' }]
};

function players(side: 'blue' | 'red') {
  return roles.map((role, index) => ({
    id: `${side}-${index}`,
    handle: `${side === 'blue' ? 'RBL' : 'RRD'} ${role}`,
    championId: champions[index],
    role,
    level: 12,
    kills: side === 'blue' ? 2 : 1,
    deaths: side === 'blue' ? 1 : 2,
    assists: 5,
    creepScore: 120 + index * 20,
    totalGold: 6_000 + index * 350 + (side === 'blue' ? 500 : 0),
    items: ['1001', '2003', '1036']
  }));
}

function snapshot(blueGold = 35_000, redGold = 31_000) {
  return {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: series.games[0],
    stats: {
      gameClockSeconds: 1_800,
      patch: '16.15.1',
      blue: {
        ...blue,
        side: 'blue',
        gold: blueGold,
        kills: 12,
        objectives: { towers: 8, inhibitors: 1, dragons: ['infernal'], barons: 1, heralds: 1, grubs: 3 },
        players: players('blue')
      },
      red: {
        ...red,
        side: 'red',
        gold: redGold,
        kills: 7,
        objectives: { towers: 3, inhibitors: 0, dragons: ['cloud'], barons: 0, heralds: 0, grubs: 1 },
        players: players('red')
      }
    },
    quality: {
      freshness: 'historical',
      sourceTimestamp: iso(-60 * 60 * 1_000),
      observedAt: iso(),
      ageSeconds: 3_600,
      complete: true,
      advancing: false,
      safeForLiveAnalysis: false,
      reasons: []
    }
  };
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

async function installFixtures(page: Page): Promise<void> {
  await page.route('**/health', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    const activeOnly = route.request().url().includes('states=live,paused,scheduled');
    return json(route, { esport: 'lol', events: activeOnly ? [] : [{ series, provider, observedAt: iso() }] });
  });
  await page.route('**/v1/lol/series/**/context**', route => json(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: series.id,
    provider,
    observedAt: iso(),
    rosters: [],
    standings: [],
    history: {
      bestOf: 1,
      winsRequired: 1,
      drawPossible: false,
      score: [{ team: blue, wins: 1 }, { team: red, wins: 0 }],
      games: [{ ...series.games[0], blueTeam: blue, redTeam: red, winner: blue, durationSeconds: 1_800 }]
    },
    complete: true,
    reasons: []
  }));
  await page.route('**/v1/lol/games/**/live**', route => json(route, snapshot()));
  await page.route('https://ddragon.leagueoflegends.com/cdn/**', route => route.fulfill({
    status: 200,
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#334155"/></svg>'
  }));
}

async function installFixtureBoard(page: Page, value: ReturnType<typeof snapshot>): Promise<void> {
  await page.evaluate(snapshotValue => {
    const detail = document.querySelector<HTMLElement>('#completed-match-detail');
    if (!detail) throw new Error('Completed detail host is missing.');
    const gameId = snapshotValue.game?.id;
    if (!gameId) throw new Error('Fixture game ID is missing.');
    document.body.dataset.mobileView = 'live';
    document.body.dataset.mobileContext = 'history';
    detail.hidden = false;

    const root = document.createElement('article');
    root.className = 'completed-final-game';
    root.dataset.finalGameId = gameId;
    root.innerHTML = `
      <div class="completed-final-game-header"><strong>Game 1 · Recovery Blue Academy won</strong><span>30:00</span></div>
      <section class="completed-team-comparison">
        <div class="completed-comparison-team blue"><strong>Recovery Blue Academy</strong></div>
        <div class="completed-comparison-team red"><strong>Recovery Red Esports</strong></div>
      </section>`;
    detail.replaceChildren(root);
    window.dispatchEvent(new CustomEvent('esports-live:ended-snapshot', {
      detail: { snapshot: snapshotValue, root }
    }));
  }, value);
}

test('mobile demo starts when ResizeObserver is unavailable', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: undefined });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  await expect(page.locator('#build-version')).toContainText('DEMO v0.17.10');
  await expect(page.locator('.mobile-app-nav')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'matches');
  expect(pageErrors).toEqual([]);
});

test('recovered history boards use the same shared renderer as live matches', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');
  await installFixtureBoard(page, snapshot());

  const board = page.locator('[data-final-game-id="game-mobile-recovery-1"]');
  await expect(board).toBeVisible();
  await expect(board).toHaveAttribute('data-mobile-scoreboard-renderer', 'shared-v1');
  await expect(board).toHaveAttribute('data-mobile-scoreboard-mode', 'history');
  await expect(board).toHaveAttribute('data-mobile-scoreboard-readability', 'v24');
  await expect(board.locator('.completed-final-game-header .mobile-scoreboard-game-clock')).toHaveText('30:00');
  await expect(board.locator('.mobile-unified-scoreboard-comparison')).toBeVisible();
  await expect(board.locator('.mobile-scoreboard-team.blue .mobile-scoreboard-team-name')).toHaveText(blue.name);
  await expect(board.locator('.mobile-scoreboard-team.red .mobile-scoreboard-team-name')).toHaveText(red.name);
  await expect(board.locator('.mobile-scoreboard-team.blue .mobile-scoreboard-team-kills strong')).toHaveText('12');
  await expect(board.locator('.mobile-scoreboard-team.red .mobile-scoreboard-team-kills strong')).toHaveText('7');
  await expect(board.locator('.mobile-live-parity-gold')).toHaveAttribute('data-leading-side', 'blue');
  await expect(board.locator('.mobile-live-parity-gold strong')).toHaveText('+4K');
  await expect(board.locator('.mobile-scoreboard-objective-title, .mobile-live-parity-objective-title')).toHaveCount(0);
  await expect(board.locator('.mobile-live-parity-objective')).toHaveCount(4);
  await expect(board.locator('.role-matchup-row')).toHaveCount(5);
  await expect(board.locator('.role-player-portrait')).toHaveCount(10);
  await expect(board.locator('.role-player-items, .telemetry-inventory, .telemetry-item-slot')).toHaveCount(0);
  await expect(board.locator(':scope > .mobile-completed-team-names')).toHaveCount(0);
  await expect(board.locator(':scope > .mobile-completed-objectives')).toHaveCount(0);
  await expect(board.locator('.history-v2-summary')).toHaveCount(0);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});

test('shared renderer follows the red leading side for history boards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');
  await installFixtureBoard(page, snapshot(31_000, 38_800));

  const board = page.locator('[data-final-game-id="game-mobile-recovery-1"]');
  await expect(board).toHaveAttribute('data-mobile-scoreboard-renderer', 'shared-v1');
  await expect(board.locator('.mobile-live-parity-gold')).toHaveAttribute('data-leading-side', 'red');
  await expect(board.locator('.mobile-live-parity-gold strong')).toHaveText('+7.8K');
});
