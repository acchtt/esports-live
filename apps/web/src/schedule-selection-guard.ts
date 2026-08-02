export {};

const scheduleList = document.querySelector<HTMLElement>('#schedule-list');

if (scheduleList) {
  let frame: number | null = null;

  const reconcile = (): void => {
    frame = null;
    if (scheduleList.hidden || !scheduleList.isConnected) return;

    const cards = [...scheduleList.querySelectorAll<HTMLButtonElement>('[data-series-id]')];
    if (!cards.length || cards.some(card => card.classList.contains('selected'))) return;

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
