export {};

const scheduleList = document.querySelector<HTMLElement>('#schedule-list');
const requestedSeriesId = new URLSearchParams(window.location.search).get('series')?.trim() || null;

if (scheduleList) {
  let frame: number | null = null;

  const showUnavailable = (): void => {
    const heading = document.querySelector<HTMLElement>('#selected-series');
    const meta = document.querySelector<HTMLElement>('#selected-meta');
    const content = document.querySelector<HTMLElement>('#game-content');
    if (heading) heading.textContent = 'Match unavailable';
    if (meta) meta.textContent = 'This series is not present in the active match schedule.';
    if (content) {
      content.innerHTML = `
        <div class="analysis-empty">
          <span class="analysis-empty-icon" aria-hidden="true">⌁</span>
          <h3>Match not found</h3>
          <p>Return to the match list and choose an active or upcoming series.</p>
          <p><a href="/">Back to matches</a></p>
        </div>`;
    }
  };

  const reconcile = (): void => {
    frame = null;
    if (scheduleList.hidden || !scheduleList.isConnected) return;

    const cards = [...scheduleList.querySelectorAll<HTMLButtonElement>('[data-series-id]')];
    if (cards.some(card => card.classList.contains('selected'))) return;

    if (requestedSeriesId) {
      const requested = cards.find(card => card.dataset.seriesId === requestedSeriesId);
      if (requested) {
        requested.click();
        return;
      }
      if (scheduleList.children.length > 0) showUnavailable();
      return;
    }

    if (!cards.length) return;
    const active = cards.find(card => (
      card.querySelector('.match-state.live, .match-state.paused') !== null
    ));
    (active ?? cards[0])?.click();
  };

  const queue = (): void => {
    if (frame !== null) return;
    frame = window.requestAnimationFrame(reconcile);
  };

  new MutationObserver(queue).observe(scheduleList, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden']
  });

  window.addEventListener('pageshow', queue);
  queue();
}
