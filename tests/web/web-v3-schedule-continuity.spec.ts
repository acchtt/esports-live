import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };

function team(id: string, name: string, code: string) {
  return { id, name, code };
}

function scheduledEvent(id: string, start: string) {
  return {
    series: {
      id,
      esport: 'lol',
      competition: { id: 'lec', name: 'LEC', stage: 'Regular Season' },
      teams: [
        team(`${id}-blue`, 'Team Heretics', 'TH'),
        team(`${id}-red`, 'Natus Vincere', 'NAVI')
      ],
      bestOf: 3,
      state: 'scheduled',
      scheduledStart: start,
      games: [{ id: `${id}-game-1`, number: 1, state: 'unstarted' }]
    },
    provider,
    observedAt: new Date().toISOString()
  } as const;
}

function completedEvent(id: string, start: string) {
  const blue = team(`${id}-blue`, 'Team Heretics', 'TH');
  const red = team(`${id}-red`, 'Natus Vincere', 'NAVI');
  return {
    series: {
      id,
      esport: 'lol',
      competition: { id: 'lec', name: 'LEC', stage: 'Regular Season' },
      teams: [blue, red],
      bestOf: 3,
      state: 'completed',
      scheduledStart: start,
      games: [
        { id: `${id}-game-1`, number: 1, state: 'completed' },
        { id: `${id}-game-2`, number: 2, state: 'completed' }
      ],
      score: [
        { team: blue, wins: 0 },
        { team: red, wins: 2 }
      ]
    },
    provider,
    observedAt: new Date().toISOString()
  } as const;
}

function otherScheduledEvent(start: string) {
  return {
    series: {
      id: 'other-series',
      esport: 'lol',
      competition: { id: 'lcs', name: 'LCS', stage: 'Regular Season' },
      teams: [
        team('other-blue', 'Other Blue', 'OB'),
        team('other-red', 'Other Red', 'OR')
      ],
      bestOf: 3,
      state: 'scheduled',
      scheduledStart: start,
      games: [{ id: 'other-game-1', number: 1, state: 'unstarted' }]
    },
    provider,
    observedAt: new Date().toISOString()
  } as const;
}

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}

async function installFixtures(
  page: Page,
  state: { omitTarget: boolean; targetCompleted: boolean; activeRequests: number }
): Promise<void> {
  const targetStart = new Date(Date.now() + 5 * 60_000).toISOString();
  const otherStart = new Date(Date.now() + 3 * 60 * 60_000).toISOString();
  const target = scheduledEvent('handoff-series', targetStart);
  const other = otherScheduledEvent(otherStart);
  const final = completedEvent('handoff-series', targetStart);

  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('states') === 'completed') {
      return json(route, {
        esport: 'lol',
        events: state.targetCompleted ? [final] : []
      });
    }

    state.activeRequests += 1;
    return json(route, {
      esport: 'lol',
      events: state.omitTarget ? [other] : [target, other]
    });
  });
}

test('V3 keeps a near-start match visible when one active schedule refresh omits it', async ({ page }) => {
  const state = { omitTarget: false, targetCompleted: false, activeRequests: 0 };
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, state);
  await page.goto('/');

  const target = page.locator('[data-series-id="handoff-series"]');
  await expect(target).toBeVisible();
  await expect(target.locator('.match-status')).toHaveText('UPCOMING');

  await page.locator('[data-league-filter="lec"]').click();
  await expect(target).toBeVisible();

  const beforeRefresh = state.activeRequests;
  state.omitTarget = true;
  await page.locator('#refresh-data').click();
  await expect.poll(() => state.activeRequests).toBeGreaterThan(beforeRefresh);
  await expect(target).toBeVisible();
  await expect(target.locator('.match-status')).toHaveText('UPCOMING');

  // Reload while the provider is still omitting the match. The recent schedule
  // cache must seed continuity so the card does not disappear during handoff.
  await page.reload();
  await expect(target).toBeVisible();
  await expect(target.locator('.match-status')).toHaveText('UPCOMING');

  state.targetCompleted = true;
  const beforeFinalRefresh = state.activeRequests;
  await page.locator('#refresh-data').click();
  await expect.poll(() => state.activeRequests).toBeGreaterThan(beforeFinalRefresh);
  await expect(page.locator('[data-home-section="upcoming"] [data-series-id="handoff-series"]')).toHaveCount(0);
  await expect(target).toBeVisible();
  await expect(target.locator('.match-status')).toHaveText('FINAL');
});
