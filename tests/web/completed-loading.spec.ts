import { expect, test } from '@playwright/test';

test('keeps the final scoreboard shell hidden until content is ready', async ({ page }) => {
  await page.setContent(`
    <main class="completed-match-detail">
      <section id="completed-final-telemetry" class="completed-final-telemetry">
        <div class="completed-telemetry-heading">
          <h3>Game scoreboards</h3>
          <span>Select a completed game</span>
        </div>
        <div class="completed-telemetry-loading">Loading the final scoreboard…</div>
      </section>
    </main>
  `);
  await page.addStyleTag({ path: 'apps/web/src/workspace-layout.css' });

  const host = page.locator('#completed-final-telemetry');
  await expect(host).toBeHidden();

  await host.evaluate(element => {
    element.innerHTML = `
      <div class="completed-telemetry-heading">
        <h3>Game scoreboards</h3>
        <span>Select a completed game</span>
      </div>
      <article class="completed-final-game" data-final-game-id="game-1">Final scoreboard</article>
    `;
  });
  await expect(host).toBeVisible();

  await host.evaluate(element => {
    element.innerHTML = '<div class="completed-telemetry-empty">Final telemetry unavailable</div>';
  });
  await expect(host).toBeVisible();
});
