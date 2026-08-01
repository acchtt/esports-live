export {};

const historyPanel = document.querySelector<HTMLElement>('#series-history');

if (historyPanel) {
  const style = document.createElement('style');
  style.textContent = `
    #series-history.live-results-parity {
      display: grid;
      gap: 13px;
      margin: 0 24px 20px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }
    #series-history.live-results-parity .live-results-heading {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
    }
    #series-history.live-results-parity .live-results-heading h3 {
      margin-top: 4px;
      font-size: 1rem;
    }
    #series-history.live-results-parity .live-results-heading > span {
      color: #91a0b5;
      font-size: 0.72rem;
    }
    #series-history.live-results-parity .history-games.completed-games {
      gap: 13px;
    }
    #series-history.live-results-parity .history-game.completed-game {
      appearance: none;
      width: 100%;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
    }
    #series-history.live-results-parity .history-game.completed-game:hover {
      border-color: rgba(148, 163, 184, 0.28);
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.038), rgba(255, 255, 255, 0.016));
      transform: translateY(-1px);
    }
    #series-history.live-results-parity .history-game.completed-game:focus-visible {
      outline: 2px solid rgba(56, 189, 248, 0.58);
      outline-offset: 2px;
    }
    #series-history.live-results-parity .history-game.completed-game.live,
    #series-history.live-results-parity .history-game.completed-game.draft,
    #series-history.live-results-parity .history-game.completed-game.paused,
    #series-history.live-results-parity .history-game.completed-game.active {
      border-color: rgba(56, 189, 248, 0.46);
    }
    #series-history.live-results-parity .history-game.completed-game.active {
      background: linear-gradient(145deg, rgba(56, 189, 248, 0.075), rgba(56, 189, 248, 0.025));
      box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.09);
    }
    #series-history.live-results-parity .history-sides {
      display: contents;
    }
    #series-history.live-results-parity .history-game-state.completed-game-state {
      color: #a7b4c6;
    }
    @media (max-width: 720px) {
      #series-history.live-results-parity {
        margin: 0 14px 16px;
      }
      #series-history.live-results-parity .live-results-heading {
        align-items: flex-start;
        flex-direction: column;
        gap: 4px;
      }
    }
  `;
  document.head.append(style);

  function applyResultsParity(): void {
    const games = historyPanel.querySelector<HTMLElement>(':scope > .history-games');
    if (!games) {
      historyPanel.classList.remove('live-results-parity', 'completed-games-panel');
      return;
    }

    historyPanel.classList.add('live-results-parity', 'completed-games-panel');
    games.classList.add('completed-games');

    const cards = [...games.querySelectorAll<HTMLElement>(':scope > .history-game')];
    const completed = cards.filter(card => card.classList.contains('completed')).length;
    let heading = historyPanel.querySelector<HTMLElement>(':scope > .live-results-heading');
    if (!heading) {
      heading = document.createElement('div');
      heading.className = 'live-results-heading completed-section-heading';
      heading.innerHTML = `
        <div><span class="eyebrow">SERIES</span><h3>Game results</h3></div>
        <span data-live-results-count></span>`;
      historyPanel.insertBefore(heading, games);
    }
    const count = heading.querySelector<HTMLElement>('[data-live-results-count]');
    const countLabel = `${completed} of ${cards.length} games played`;
    if (count && count.textContent !== countLabel) count.textContent = countLabel;

    for (const card of cards) {
      card.classList.add('completed-game');
      card.querySelector<HTMLElement>('.history-game-top')?.classList.add('completed-game-top');
      card.querySelector<HTMLElement>('.history-game-state')?.classList.add('completed-game-state');
      card.querySelectorAll<HTMLElement>('.history-side').forEach(side => side.classList.add('completed-side'));
      card.querySelector<HTMLElement>('.history-result')?.classList.add('completed-result');
    }
  }

  const observer = new MutationObserver(() => queueMicrotask(applyResultsParity));
  observer.observe(historyPanel, { childList: true, subtree: true });
  applyResultsParity();
}
