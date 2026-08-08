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
  await page.goto('/');

  const liveHistoryPanel = page.locator('#series-history');
  const completedDetail = page.locator('#completed-match-detail');
  const matchHistoryMode = page.getByRole('button', { name: 'Open match history' });
  const activeMode = page.getByRole('button', { name: 'Active' });

  await seedLiveHistoryBoard(page);
  await expect(liveHistoryPanel).toBeVisible();

  await matchHistoryMode.click();
  await expect(completedDetail).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-view-mode', 'match-history');
  await expect(liveHistoryPanel).toBeHidden();

  await seedLiveHistoryBoard(page, 50);
  await page.waitForTimeout(250);
  await expect(liveHistoryPanel).toBeHidden();

  await activeMode.click();
  await expect(page.locator('body')).toHaveAttribute('data-view-mode', 'active');
  await expect(liveHistoryPanel).toBeVisible();

  await matchHistoryMode.click();
  await seedLiveHistoryBoard(page, 50);
  await page.waitForTimeout(250);
  await expect(completedDetail).toBeVisible();
  await expect(liveHistoryPanel).toBeHidden();

  expect(pageErrors).toEqual([]);
});

test('shared mobile scoreboard exposes one game label, a larger clock, and readable objectives', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  await page.evaluate(() => {
    const root = document.createElement('article');
    root.className = 'completed-final-game mobile-live-history-board';
    root.dataset.mobileScoreboardRenderer = 'shared-v1';
    root.dataset.liveBoardState = 'verified';
    root.innerHTML = `
      <div class="completed-final-game-header"><span>20:34</span><span>Game 2 · Live</span><strong>Game 2 · Live</strong></div>
      <section class="completed-team-comparison mobile-unified-scoreboard-comparison">
        <section class="mobile-scoreboard-objectives">
          <div class="mobile-scoreboard-objective-title">OBJECTIVES · BLUE – RED</div>
          <div class="mobile-scoreboard-objective-grid">
            ${['Towers', 'Dragons', 'Barons', 'Inhibitors'].map(label => `
              <div class="mobile-scoreboard-objective">
                <span>${label}</span>
                <div class="mobile-scoreboard-objective-values"><strong class="blue">2</strong><i>–</i><strong class="red">1</strong></div>
              </div>`).join('')}
          </div>
        </section>
      </section>`;
    document.body.append(root);

    window.dispatchEvent(new CustomEvent('esports-live:mobile-scoreboard-rendered', {
      detail: {
        root,
        mode: 'live',
        snapshot: {
          game: { id: 'game-readability-2', number: 2, state: 'live' },
          stats: { gameClockSeconds: 1_234 }
        }
      }
    }));
  });

  const board = page.locator('[data-mobile-scoreboard-readability="v25"]');
  const header = board.locator('.completed-final-game-header');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-demo-version', '0.17.16');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-scoreboard-readability', 'large-clock-single-game-label-v25');
  await expect(header.locator(':scope > *')).toHaveCount(2);
  await expect(header.locator('.mobile-scoreboard-game-clock')).toHaveText('20:34');
  await expect(header.locator('.mobile-scoreboard-game-label')).toHaveText('Game 2 · Live');
  await expect(board.locator('.mobile-scoreboard-objective-title, .mobile-live-parity-objective-title')).toHaveCount(0);
  await expect(board.locator('.mobile-scoreboard-objective')).toHaveCount(4);

  const readability = await board.locator('.mobile-scoreboard-objective').first().evaluate(element => {
    const label = element.querySelector<HTMLElement>(':scope > span');
    const value = element.querySelector<HTMLElement>('.mobile-scoreboard-objective-values strong');
    const clock = element.closest<HTMLElement>('[data-mobile-scoreboard-readability]')
      ?.querySelector<HTMLElement>('.mobile-scoreboard-game-clock');
    if (!label || !value || !clock) throw new Error('Scoreboard typography is incomplete.');
    return {
      height: element.getBoundingClientRect().height,
      labelSize: Number.parseFloat(getComputedStyle(label).fontSize),
      valueSize: Number.parseFloat(getComputedStyle(value).fontSize),
      clockSize: Number.parseFloat(getComputedStyle(clock).fontSize)
    };
  });
  expect(readability.height).toBeGreaterThanOrEqual(54);
  expect(readability.labelSize).toBeGreaterThanOrEqual(8);
  expect(readability.valueSize).toBeGreaterThanOrEqual(14);
  expect(readability.clockSize).toBeGreaterThanOrEqual(20);
  expect(pageErrors).toEqual([]);
});

test('ended games remain final when stale live telemetry arrives and the header shares one baseline', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await page.goto('/');

  await page.evaluate(() => {
    const gameId = 'game-terminal-1';
    window.dispatchEvent(new CustomEvent('esports-live:selection', {
      detail: {
        provider: { id: 'fixture', name: 'Fixture provider' },
        observedAt: new Date().toISOString(),
        series: {
          id: 'series-terminal',
          esport: 'lol',
          competition: { id: 'terminal-league', name: 'Terminal League' },
          teams: [
            { id: 'terminal-blue', name: 'Terminal Blue', code: 'TBL' },
            { id: 'terminal-red', name: 'Terminal Red', code: 'TRD' }
          ],
          bestOf: 3,
          state: 'live',
          scheduledStart: new Date().toISOString(),
          games: [
            { id: gameId, number: 1, state: 'completed' },
            { id: 'game-terminal-2', number: 2, state: 'live' }
          ]
        }
      }
    }));

    const root = document.createElement('article');
    root.className = 'completed-final-game mobile-live-history-board';
    root.dataset.mobileScoreboardRenderer = 'shared-v1';
    root.dataset.mobileUnifiedGameId = gameId;
    root.dataset.liveBoardState = 'verified';
    root.innerHTML = `
      <div class="completed-final-game-header">
        <span class="mobile-scoreboard-game-clock">34:12</span>
        <strong class="mobile-scoreboard-game-label">Game 1 · Live</strong>
      </div>`;
    document.body.append(root);

    window.dispatchEvent(new CustomEvent('esports-live:ended-snapshot', {
      detail: {
        root,
        snapshot: {
          game: { id: gameId, number: 1, state: 'completed' },
          stats: null
        }
      }
    }));

    const label = root.querySelector<HTMLElement>('.mobile-scoreboard-game-label');
    if (label) label.textContent = 'Game 1 · Live';
    window.dispatchEvent(new CustomEvent('esports-live:mobile-scoreboard-rendered', {
      detail: {
        root,
        mode: 'live',
        snapshot: {
          game: { id: gameId, number: 1, state: 'live' },
          stats: { gameClockSeconds: 2_052 }
        }
      }
    }));
  });

  const board = page.locator('[data-mobile-unified-game-id="game-terminal-1"]');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-ended-game-status', 'terminal-state-v28');
  await expect(page.locator('html')).toHaveAttribute('data-mobile-game-header-alignment', 'baseline-v28');
  await expect(board).toHaveAttribute('data-mobile-scoreboard-game-state', 'completed');
  await expect(board).toHaveAttribute('data-mobile-ended-state', 'final-v28');
  await expect(board).toHaveAttribute('data-mobile-game-header-alignment', 'baseline-v28');
  await expect(board.locator('.mobile-scoreboard-game-label')).toHaveText('Game 1 · Final');

  const alignment = await board.locator('.completed-final-game-header').evaluate(element => {
    const clock = element.querySelector<HTMLElement>('.mobile-scoreboard-game-clock');
    const label = element.querySelector<HTMLElement>('.mobile-scoreboard-game-label');
    if (!clock || !label) throw new Error('Game header is incomplete.');
    const clockBounds = clock.getBoundingClientRect();
    const labelBounds = label.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      display: style.display,
      alignItems: style.alignItems,
      clockTop: clockBounds.top,
      labelTop: labelBounds.top,
      clockSize: Number.parseFloat(getComputedStyle(clock).fontSize),
      labelSize: Number.parseFloat(getComputedStyle(label).fontSize)
    };
  });
  expect(alignment.display).toBe('grid');
  expect(alignment.alignItems).toBe('baseline');
  expect(Math.abs(alignment.clockTop - alignment.labelTop)).toBeLessThanOrEqual(2);
  expect(alignment.clockSize).toBeCloseTo(alignment.labelSize, 1);
  expect(pageErrors).toEqual([]);
});
