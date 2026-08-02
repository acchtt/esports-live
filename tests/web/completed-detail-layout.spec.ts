import { expect, test } from '@playwright/test';

test('keeps the merged completed result card content-height before telemetry arrives', async ({ page }) => {
  await page.setContent(`
    <main class="completed-match-detail" style="display:grid;min-height:800px;padding:0">
      <section class="completed-series-hero" style="height:120px"></section>
      <section class="completed-games-panel" style="height:180px"></section>
      <section id="completed-final-telemetry" class="completed-final-telemetry">
        <div class="completed-telemetry-heading"><h3>Game scoreboards</h3></div>
        <div class="completed-telemetry-loading">Loading the final scoreboard…</div>
      </section>
    </main>
  `);
  await page.addStyleTag({ path: 'apps/web/src/workspace-layout.css' });

  await expect(page.locator('#completed-final-telemetry')).toBeHidden();

  const spacing = await page.locator('.completed-match-detail').evaluate(detail => {
    const hero = detail.querySelector<HTMLElement>('.completed-series-hero');
    const games = detail.querySelector<HTMLElement>('.completed-games-panel');
    if (!hero || !games) return Number.POSITIVE_INFINITY;
    const heroBox = hero.getBoundingClientRect();
    const gamesBox = games.getBoundingClientRect();
    return gamesBox.top - heroBox.bottom;
  });

  expect(Math.abs(spacing)).toBeLessThan(2);
});
