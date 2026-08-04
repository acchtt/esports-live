import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const blue = { id: 'recovery-blue', name: 'Recovery Blue Academy', code: 'RBL' };
const red = { id: 'recovery-red', name: 'Recovery Red Esports', code: 'RRD' };
const roles = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;

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
    handle: `${side} ${role}`,
    championId: ['Jayce', 'Maokai', 'Orianna', 'Ashe', 'Alistar'][index],
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
      patch: '26.15.1',
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

async function installFixtures(page: Page, finalSnapshot = snapshot()): Promise<void> {
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
  await page.route('https://ddragon.leagueoflegends.com/api/versions.json', route => json(route, ['16.15.1']));

  let finalRequests = 0;
  await page.route('**/v1/lol/games/**/live**', async route => {
    finalRequests += 1;
    if (finalRequests === 1) {
      await route.abort('failed');
      return;
    }
    await json(route, finalSnapshot);
  });
}

async function openRecoveryBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open match history' }).click();
  const card = page.locator('[data-completed-series-id="series-mobile-recovery"]');
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('.mobile-recovery-matchups .mobile-recovery-row')).toHaveCount(5, { timeout: 15_000 });
}

test('mobile fallback shows a readable blue gold lead and keeps the bottom navigation clear', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page);
  await openRecoveryBoard(page);

  await expect(page.locator('#build-version')).toContainText('DEMO v0.10');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-view', 'live');
  await expect(page.locator('body')).toHaveAttribute('data-mobile-context', 'history');
  await expect(page.locator('.mobile-context-title')).toHaveText('Match History');
  await expect(page.locator('.mobile-app-nav [data-mobile-view="live"] span')).toHaveText('History');

  const teams = page.locator('.mobile-completed-team-names');
  await expect(teams).toContainText('Recovery Blue Academy');
  await expect(teams).toContainText('Recovery Red Esports');
  await expect(teams).toHaveAttribute('data-leading-side', 'blue');
  await expect(teams.locator('.mobile-completed-team-gold')).toHaveCount(0);

  const goldLead = teams.locator('.mobile-completed-gold-lead.blue');
  await expect(goldLead).toHaveCount(1);
  await expect(goldLead.locator('small')).toHaveText('Gold lead');
  await expect(goldLead.locator('strong')).toHaveText('+4K');
  await expect(goldLead).toHaveAttribute('aria-label', 'Recovery Blue Academy leads by 4K gold');
  await expect(teams.locator('.mobile-completed-team-name.blue')).toHaveClass(/leading/);
  await expect(teams.locator('.mobile-completed-team-name.red')).not.toHaveClass(/leading/);

  const teamNameLayout = await teams.locator('.mobile-completed-team-name.blue strong').evaluate(element => {
    const style = getComputedStyle(element);
    return { whiteSpace: style.whiteSpace, lineHeight: Number.parseFloat(style.lineHeight) };
  });
  expect(teamNameLayout.whiteSpace).toBe('normal');
  expect(teamNameLayout.lineHeight).toBeGreaterThan(13);

  const objectives = page.locator('.mobile-completed-objectives');
  await expect(objectives).toContainText('Towers');
  await expect(objectives).toContainText('8');
  await expect(objectives).toContainText('3');
  await expect(objectives).toContainText('Dragons');
  await expect(objectives).toContainText('Barons');
  await expect(objectives).toContainText('Inhibitors');

  const objectiveFontSizes = await objectives.evaluate(element => {
    const title = element.querySelector<HTMLElement>('.mobile-completed-objectives-title');
    const label = element.querySelector<HTMLElement>('.mobile-completed-objective > span');
    const value = element.querySelector<HTMLElement>('.mobile-completed-objective strong');
    if (!title || !label || !value) throw new Error('Objective typography is incomplete.');
    return {
      title: Number.parseFloat(getComputedStyle(title).fontSize),
      label: Number.parseFloat(getComputedStyle(label).fontSize),
      value: Number.parseFloat(getComputedStyle(value).fontSize)
    };
  });
  expect(objectiveFontSizes.title).toBeGreaterThanOrEqual(9);
  expect(objectiveFontSizes.label).toBeGreaterThanOrEqual(8.3);
  expect(objectiveFontSizes.value).toBeGreaterThanOrEqual(11);

  const deltas = page.locator('.mobile-recovery-gold-delta');
  await expect(deltas).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    await expect(deltas.nth(index)).toHaveText('+500');
  }

  await expect(page.locator('.mobile-final-recovery-summary')).toHaveCount(0);
  await expect(page.locator('.mobile-recovery-portrait:visible')).toHaveCount(10);
  await expect(page.locator('.mobile-recovery-portrait img')).toHaveCount(10);
  await expect(page.locator('.mobile-recovery-identity small:visible')).toHaveCount(0);
  await expect(page.locator('.mobile-recovery-stats b')).toHaveCount(10);
  await expect(page.locator('.mobile-recovery-matchups')).not.toContainText(' CS');
  await expect(page.locator('.mobile-recovery-items:visible')).toHaveCount(0);
  await expect(page.locator('.role-player-items:visible')).toHaveCount(0);
  await expect(page.locator('.mobile-recovery-role:visible')).toHaveCount(0);

  const boardBounds = await page.locator('.mobile-final-recovery').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, left: bounds.left, right: bounds.right };
  });
  expect(boardBounds.width).toBeGreaterThanOrEqual(360);
  expect(boardBounds.left).toBeGreaterThanOrEqual(-0.5);
  expect(boardBounds.right).toBeLessThanOrEqual(390.5);

  const nav = page.locator('.mobile-app-nav');
  await expect(nav).toHaveAttribute('data-mobile-nav-version', '0.10');
  const navLayout = await nav.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      position: style.position,
      borderRadius: style.borderRadius,
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      height: bounds.height,
      bodyPaddingBottom: Number.parseFloat(getComputedStyle(document.body).paddingBottom)
    };
  });
  expect(navLayout.position).toBe('fixed');
  expect(navLayout.borderRadius).toBe('0px');
  expect(navLayout.left).toBeLessThanOrEqual(0.5);
  expect(navLayout.right).toBeGreaterThanOrEqual(389.5);
  expect(navLayout.bottom).toBeGreaterThanOrEqual(843.5);
  expect(navLayout.bodyPaddingBottom).toBeGreaterThan(navLayout.height + 8);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const clearance = await page.evaluate(() => {
    const navElement = document.querySelector<HTMLElement>('.mobile-app-nav');
    const lastRow = document.querySelector<HTMLElement>('.mobile-recovery-row:last-child');
    if (!navElement || !lastRow) throw new Error('Navigation clearance targets are missing.');
    return {
      navTop: navElement.getBoundingClientRect().top,
      lastRowBottom: lastRow.getBoundingClientRect().bottom
    };
  });
  expect(clearance.lastRowBottom).toBeLessThanOrEqual(clearance.navTop - 4);

  const frameBorders = await page.locator('.mobile-final-recovery').evaluate(element => {
    const style = getComputedStyle(element);
    return [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
  });
  expect(frameBorders).toEqual(['0px', '0px', '0px', '0px']);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('mobile completed gold lead follows the red leading side', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixtures(page, snapshot(31_000, 35_000));
  await openRecoveryBoard(page);

  const teams = page.locator('.mobile-completed-team-names');
  await expect(teams).toHaveAttribute('data-leading-side', 'red');
  await expect(teams.locator('.mobile-completed-team-gold')).toHaveCount(0);
  await expect(teams.locator('.mobile-completed-gold-lead.red strong')).toHaveText('+4K');
  await expect(teams.locator('.mobile-completed-gold-lead.red')).toHaveAttribute(
    'aria-label',
    'Recovery Red Esports leads by 4K gold'
  );
  await expect(teams.locator('.mobile-completed-team-name.red')).toHaveClass(/leading/);
  await expect(teams.locator('.mobile-completed-team-name.blue')).not.toHaveClass(/leading/);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
