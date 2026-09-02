import { expect, test, type Page, type Route } from '@playwright/test';

const provider = { id: 'fixture', name: 'Fixture provider' };
const observedAt = new Date().toISOString();

function logo(label: string, background: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${background}"/><text x="32" y="39" text-anchor="middle" font-family="Arial" font-size="22" font-weight="700" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const leftTeam = {
  id: 'thunder-talk',
  name: 'THUNDER TALK GAMING',
  code: 'TT',
  imageUrl: logo('TT', '#1479a8')
};

const rightTeam = {
  id: 'team-we',
  name: "Xi'an Team WE",
  code: 'WE',
  imageUrl: logo('WE', '#a3294f')
};

const games = [
  { id: 'game-1', number: 1, state: 'completed' as const },
  { id: 'game-2', number: 2, state: 'live' as const },
  { id: 'game-3', number: 3, state: 'unstarted' as const }
];

const series = {
  id: 'series-live-hero',
  esport: 'lol',
  competition: { id: 'lpl', name: 'LPL', stage: 'Week 2' },
  teams: [leftTeam, rightTeam] as const,
  bestOf: 3,
  state: 'live' as const,
  scheduledStart: new Date(Date.now() - 45 * 60 * 1_000).toISOString(),
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
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="#c8a456"/></svg>'
  }));

  await page.route('**/health', route => fulfillJson(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));

  await page.route('**/v1/lol/schedule**', route => fulfillJson(route, {
    esport: 'lol',
    events: [{ series, provider, observedAt }]
  }));

  await page.route('**/v1/lol/series/**/context**', route => fulfillJson(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    seriesId: series.id,
    provider,
    observedAt,
    rosters: [],
    standings: [],
    history: {
      bestOf: 3,
      winsRequired: 2,
      drawPossible: false,
      score: [
        { team: leftTeam, wins: 1 },
        { team: rightTeam, wins: 0 }
      ],
      games: [
        { ...games[0], blueTeam: leftTeam, redTeam: rightTeam, winner: leftTeam, durationSeconds: 2649 },
        { ...games[1], blueTeam: leftTeam, redTeam: rightTeam, winner: null, durationSeconds: null },
        { ...games[2], blueTeam: rightTeam, redTeam: leftTeam, winner: null, durationSeconds: null }
      ]
    },
    complete: true,
    reasons: []
  }));

  await page.route('**/v1/lol/games/**/live**', route => fulfillJson(route, {
    schemaVersion: '1.0',
    esport: 'lol',
    provider,
    series,
    game: games[1],
    stats: null,
    quality: {
      freshness: 'unavailable',
      sourceTimestamp: null,
      observedAt,
      ageSeconds: null,
      complete: false,
      advancing: null,
      safeForLiveAnalysis: false,
      reasons: [{ code: 'fixture', message: 'No telemetry needed for hero test' }]
    }
  }));
}

test('renders an editorial match shell with team logos, score, game canvas, and series rail', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await installFixtures(page);
  await page.goto('/match.html?series=series-live-hero');

  const hero = page.locator('#series-hero');
  await expect(hero).toBeVisible();
  await expect(page.locator('.match-route-bar')).toHaveCount(0);
  await expect(page.locator('.match-content-nav')).toHaveCount(0);
  await expect(page.locator('.match-content-shell')).toBeVisible();
  await expect(page.locator('.match-primary-column')).toBeVisible();
  await expect(page.locator('.match-series-rail')).toBeVisible();

  const gameMark = hero.locator('.series-hero-game-mark');
  await expect(gameMark.locator('img')).toHaveCount(1);
  await expect(gameMark.locator('img')).toHaveAttribute(
    'src',
    /riotgames\.com\/darkroom\/original\/.*lol-logo-rendered-hi-res\.png/
  );

  await expect(hero.locator('.series-hero-competition')).toContainText('LPL · Week 2');
  await expect(hero.locator('.series-hero-status')).toHaveText('LIVE');

  const teams = hero.locator('.series-hero-team');
  await expect(teams).toHaveCount(2);
  await expect(teams.nth(0)).toContainText('THUNDER TALK GAMING');
  await expect(teams.nth(1)).toContainText("Xi'an Team WE");
  await expect(hero.locator('.series-hero-team-logo img')).toHaveCount(2);

  const score = hero.locator('.series-hero-score strong');
  await expect(score.nth(0)).toHaveText('1');
  await expect(score.nth(1)).toHaveText('0');
  await expect(hero.locator('.series-hero-score')).toContainText('Best of 3 · First to 2');

  const footer = hero.locator('.series-hero-footer');
  await expect(footer).toContainText('Game 2 live');
  await expect(footer).toContainText('1 of 3 games completed');
  await expect(footer.locator(':scope > *')).toHaveCount(3);

  await expect(page.locator('#game-selector')).toBeVisible();
  await expect(page.locator('#game-selector .game-button')).toHaveCount(3);

  const surfaces = await hero.evaluate(element => {
    const top = element.querySelector<HTMLElement>('.series-hero-topline');
    const matchup = element.querySelector<HTMLElement>('.series-hero-matchup');
    const team = element.querySelector<HTMLElement>('.series-hero-team');
    const scorePanel = element.querySelector<HTMLElement>('.series-hero-score');
    const scoreValue = scorePanel?.querySelector<HTMLElement>('strong');
    const footerCell = element.querySelector<HTMLElement>('.series-hero-footer > *');
    const footerGrid = element.querySelector<HTMLElement>('.series-hero-footer');
    const gameButton = document.querySelector<HTMLElement>('#game-selector .game-button');
    const primary = document.querySelector<HTMLElement>('.match-primary-column');
    if (!top || !matchup || !team || !scorePanel || !scoreValue || !footerCell || !footerGrid || !gameButton || !primary) return null;
    const topStyle = getComputedStyle(top);
    const matchupStyle = getComputedStyle(matchup);
    const teamStyle = getComputedStyle(team);
    const scoreStyle = getComputedStyle(scorePanel);
    const scoreValueStyle = getComputedStyle(scoreValue);
    const footerStyle = getComputedStyle(footerCell);
    const footerGridStyle = getComputedStyle(footerGrid);
    const gameButtonStyle = getComputedStyle(gameButton);
    const primaryStyle = getComputedStyle(primary);
    return {
      topBackground: topStyle.backgroundColor,
      topBackgroundImage: topStyle.backgroundImage,
      topBorderLeftWidth: topStyle.borderLeftWidth,
      matchupBackgroundImage: matchupStyle.backgroundImage,
      teamBackground: teamStyle.backgroundColor,
      teamBorderTopWidth: teamStyle.borderTopWidth,
      teamBorderRadius: teamStyle.borderTopLeftRadius,
      scoreBackground: scoreStyle.backgroundColor,
      scoreBackgroundImage: scoreStyle.backgroundImage,
      scoreBorderTopWidth: scoreStyle.borderTopWidth,
      scoreTextShadow: scoreValueStyle.textShadow,
      footerBackground: footerStyle.backgroundColor,
      footerBorderTopWidth: footerStyle.borderTopWidth,
      footerDisplay: footerGridStyle.display,
      gameButtonRadius: gameButtonStyle.borderTopLeftRadius,
      primaryRadius: primaryStyle.borderTopLeftRadius
    };
  });
  expect(surfaces).not.toBeNull();
  expect(surfaces?.topBackground).toBe('rgba(0, 0, 0, 0)');
  expect(surfaces?.topBackgroundImage).toBe('none');
  expect(surfaces?.topBorderLeftWidth).toBe('0px');
  expect(surfaces?.matchupBackgroundImage).toBe('none');
  expect(surfaces?.teamBackground).toBe('rgba(0, 0, 0, 0)');
  expect(surfaces?.teamBorderTopWidth).toBe('0px');
  expect(surfaces?.teamBorderRadius).toBe('0px');
  expect(surfaces?.scoreBackground).toBe('rgba(0, 0, 0, 0)');
  expect(surfaces?.scoreBackgroundImage).toBe('none');
  expect(surfaces?.scoreBorderTopWidth).toBe('0px');
  expect(surfaces?.scoreTextShadow).toBe('none');
  expect(surfaces?.footerBackground).toBe('rgba(0, 0, 0, 0)');
  expect(surfaces?.footerBorderTopWidth).toBe('0px');
  expect(surfaces?.footerDisplay).toBe('flex');
  expect(surfaces?.gameButtonRadius).toBe('0px');
  expect(surfaces?.primaryRadius).toBe('0px');

  const geometry = await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.analysis-header');
    const score = document.querySelector<HTMLElement>('.series-hero-score');
    const primary = document.querySelector<HTMLElement>('.match-primary-column');
    const rail = document.querySelector<HTMLElement>('.match-series-rail');
    if (!header || !score || !primary || !rail) return null;
    const headerBox = header.getBoundingClientRect();
    const scoreBox = score.getBoundingClientRect();
    const primaryBox = primary.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    return {
      headerCenter: headerBox.left + headerBox.width / 2,
      scoreCenter: scoreBox.left + scoreBox.width / 2,
      primaryRight: primaryBox.right,
      railLeft: railBox.left,
      primaryWidth: primaryBox.width,
      railWidth: railBox.width
    };
  });
  expect(geometry).not.toBeNull();
  if (geometry) {
    expect(Math.abs(geometry.headerCenter - geometry.scoreCenter)).toBeLessThan(3);
    expect(geometry.primaryRight).toBeLessThanOrEqual(geometry.railLeft + 1);
    expect(geometry.primaryWidth).toBeGreaterThan(geometry.railWidth * 2);
  }

  expect(errors).toEqual([]);
});
