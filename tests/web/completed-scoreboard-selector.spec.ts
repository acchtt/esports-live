import { expect, test } from '@playwright/test';

test('aligns completed scoreboard tabs to the full series game grid', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`
    <main class="completed-match-detail" style="width:1200px">
      <section class="completed-games-panel">
        <div class="completed-games" style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px">
          <article class="completed-game">Game 1</article>
          <article class="completed-game">Game 2</article>
          <article class="completed-game">Game 3</article>
        </div>
      </section>
      <section id="completed-final-telemetry" class="completed-final-telemetry">
        <div class="completed-telemetry-heading" style="display:flex;justify-content:space-between">
          <h3>Game scoreboards</h3>
          <span>Select a completed game</span>
        </div>
        <div class="completed-game-tabs" style="display:grid">
          <button class="completed-game-tab">Game 1</button>
          <button class="completed-game-tab active">Game 2</button>
        </div>
      </section>
    </main>
  `);
  await page.addStyleTag({ path: 'apps/web/src/workspace-layout.css' });

  const layout = await page.locator('.completed-match-detail').evaluate(detail => {
    const tabs = detail.querySelector<HTMLElement>('.completed-game-tabs');
    const buttons = [...detail.querySelectorAll<HTMLElement>('.completed-game-tab')];
    const heading = detail.querySelector<HTMLElement>('.completed-telemetry-heading');
    if (!tabs || buttons.length !== 2 || !heading) return null;
    const tabsBox = tabs.getBoundingClientRect();
    const firstBox = buttons[0]!.getBoundingClientRect();
    const secondBox = buttons[1]!.getBoundingClientRect();
    return {
      columns: getComputedStyle(tabs).gridTemplateColumns.split(' ').length,
      firstRatio: firstBox.width / tabsBox.width,
      secondOffsetRatio: (secondBox.left - tabsBox.left) / tabsBox.width,
      headingItems: getComputedStyle(heading).alignItems
    };
  });

  expect(layout).not.toBeNull();
  expect(layout!.columns).toBe(3);
  expect(layout!.firstRatio).toBeGreaterThan(0.30);
  expect(layout!.firstRatio).toBeLessThan(0.35);
  expect(layout!.secondOffsetRatio).toBeGreaterThan(0.32);
  expect(layout!.secondOffsetRatio).toBeLessThan(0.36);
  expect(layout!.headingItems).toBe('baseline');
});
