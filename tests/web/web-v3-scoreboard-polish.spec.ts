import { expect, test, type Route } from '@playwright/test';

async function json(route: Route, value: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
}

test('V3 keeps split data status and fits a five-player scoreboard in one phone view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/health**', route => json(route, {
    ok: true,
    service: 'esports-live-api',
    schemaVersion: '1.0',
    adapters: ['lol']
  }));
  await page.route('**/v1/lol/schedule**', route => json(route, { esport: 'lol', events: [] }));
  await page.goto('/');
  await expect(page.locator('#catalogue-meta')).toContainText('0 matches');

  const scoreboard = page.locator('#scoreboard');
  const freshness = page.locator('#quality-text');
  expect(await scoreboard.evaluate(element => element.firstElementChild?.id)).toBe('quality-text');

  await freshness.evaluate(element => {
    element.textContent = 'FINAL DATA · Partial snapshot';
  });
  await expect(freshness.locator('.telemetry-freshness-primary')).toHaveText('FINAL DATA');
  await expect(freshness.locator('.telemetry-freshness-detail')).toHaveText('Partial snapshot');
  await expect(freshness).toHaveText('FINAL DATA · Partial snapshot');

  const layout = await page.evaluate(() => {
    document.documentElement.dataset.arenaRoute = 'match';

    const makeItems = (side: 'blue' | 'red'): HTMLDivElement => {
      const items = document.createElement('div');
      items.className = `player-items ${side}`;
      for (let index = 0; index < 7; index += 1) {
        const slot = document.createElement('span');
        slot.className = 'player-item-slot';
        items.append(slot);
      }
      return items;
    };

    const makeSide = (side: 'blue' | 'red'): HTMLDivElement => {
      const playerSide = document.createElement('div');
      playerSide.className = `player-side ${side}-player`;
      const portrait = document.createElement('div');
      portrait.className = 'champion-portrait';
      const copy = document.createElement('div');
      copy.className = `player-copy ${side}`;
      const name = document.createElement('strong');
      name.textContent = side === 'blue' ? 'MKOI Player' : 'NAVI Player';
      const statline = document.createElement('span');
      statline.className = 'player-statline';
      statline.textContent = '1/1/0 · 145 CS';
      const championMeta = document.createElement('div');
      championMeta.className = 'player-champion-meta';
      const champion = document.createElement('small');
      champion.className = 'player-champion';
      champion.textContent = 'Champion';
      const level = document.createElement('b');
      level.className = 'champion-level';
      level.textContent = 'Lv 12';
      championMeta.append(champion, level);
      copy.append(name, statline, championMeta);
      const items = makeItems(side);
      if (side === 'blue') playerSide.append(portrait, copy, items);
      else playerSide.append(copy, portrait, items);
      return playerSide;
    };

    const makePlayerRow = (): HTMLElement => {
      const row = document.createElement('article');
      row.className = 'player-row';
      const laneGold = document.createElement('div');
      laneGold.className = 'lane-gold';
      laneGold.textContent = '+967 →';
      row.append(makeSide('blue'), laneGold, makeSide('red'));
      return row;
    };

    const sample = document.createElement('article');
    sample.className = 'scoreboard';
    sample.style.width = '374px';

    const status = document.createElement('div');
    status.className = 'telemetry-freshness';
    status.innerHTML = '<span class="telemetry-freshness-primary">LIVE DATA</span><span class="telemetry-freshness-detail">Updated 2s ago</span>';

    const header = document.createElement('header');
    header.className = 'scoreboard-header';
    header.innerHTML = '<strong>18:22</strong><span>Game 2 · Live</span>';

    const teams = document.createElement('section');
    teams.className = 'team-banner';
    teams.innerHTML = '<article class="team-side blue"><strong>Movistar KOI</strong><p><small>KILLS</small><b>1</b></p></article><article class="gold-card"><span>GOLD LEAD</span><strong>+106</strong></article><article class="team-side red"><strong>Natus Vincere</strong><p><small>KILLS</small><b>4</b></p></article>';

    const objectives = document.createElement('section');
    objectives.className = 'objective-grid';
    for (const label of ['TOWERS', 'DRAGONS', 'BARONS', 'INHIBITORS']) {
      const objective = document.createElement('article');
      objective.innerHTML = `<span>${label}</span><strong>0 − 0</strong>`;
      objectives.append(objective);
    }

    const players = document.createElement('section');
    players.className = 'player-board';
    for (let index = 0; index < 5; index += 1) players.append(makePlayerRow());

    sample.append(status, header, teams, objectives, players);
    document.body.append(sample);

    const firstItems = sample.querySelector('.player-items');
    const firstSlot = firstItems?.firstElementChild as HTMLElement | null;
    const lastSlot = firstItems?.lastElementChild as HTMLElement | null;
    const slotStyle = firstSlot ? getComputedStyle(firstSlot) : null;
    const result = {
      scoreboardHeight: sample.getBoundingClientRect().height,
      itemWidth: slotStyle ? Number.parseFloat(slotStyle.width) : 0,
      itemHeight: slotStyle ? Number.parseFloat(slotStyle.height) : 0,
      itemWrap: firstItems ? getComputedStyle(firstItems).flexWrap : '',
      sameItemRow: Boolean(firstSlot && lastSlot && Math.abs(firstSlot.getBoundingClientRect().top - lastSlot.getBoundingClientRect().top) < 1),
      lanePosition: getComputedStyle(sample.querySelector('.lane-gold') as Element).position
    };
    sample.remove();
    return result;
  });

  expect(layout.itemWidth).toBeGreaterThanOrEqual(24);
  expect(layout.itemHeight).toBeGreaterThanOrEqual(24);
  expect(layout.itemWrap).toBe('nowrap');
  expect(layout.sameItemRow).toBe(true);
  expect(layout.lanePosition).toBe('absolute');
  expect(layout.scoreboardHeight).toBeLessThanOrEqual(640);
});
