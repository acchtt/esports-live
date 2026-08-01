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
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 13px;
    }
    #series-history.live-results-parity .history-game.completed-game {
      appearance: none;
      display: grid;
      gap: 12px;
      width: 100%;
      min-height: 154px;
      padding: 17px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 14px;
      color: inherit;
      font: inherit;
      text-align: left;
      background: linear-gradient(145deg, rgba(255, 255, 255, 0.026), rgba(255, 255, 255, 0.01));
      cursor: pointer;
      transition: border-color 0.16s ease, background 0.16s ease, transform 0.16s ease;
    }
    #series-history.live-results-parity .history-game.completed-game.completed {
      border-color: rgba(52, 211, 153, 0.16);
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
    #series-history.live-results-parity .completed-game-top,
    #series-history.live-results-parity .completed-side,
    #series-history.live-results-parity .completed-result {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    #series-history.live-results-parity .completed-game-top strong {
      font-size: 0.92rem;
    }
    #series-history.live-results-parity .completed-game-state {
      padding: 3px 7px;
      border: 1px solid rgba(148, 163, 184, 0.14);
      border-radius: 999px;
      color: #a7b4c6;
      background: rgba(148, 163, 184, 0.055);
      font-size: 0.58rem;
      font-weight: 850;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    #series-history.live-results-parity .history-sides {
      display: contents;
    }
    #series-history.live-results-parity .completed-side span,
    #series-history.live-results-parity .completed-result span {
      color: var(--muted);
      font-size: 0.7rem;
    }
    #series-history.live-results-parity .completed-side b {
      min-width: 0;
      overflow: hidden;
      font-size: 0.8rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #series-history.live-results-parity .completed-side.blue span { color: #7dd3fc; }
    #series-history.live-results-parity .completed-side.red span { color: #fda4af; }
    #series-history.live-results-parity .completed-result {
      margin-top: auto;
      padding-top: 10px;
      border-top: 1px solid rgba(148, 163, 184, 0.1);
    }
    #series-history.live-results-parity .completed-result strong {
      color: #bbf7d0;
      font-size: 0.76rem;
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
      #series-history.live-results-parity .history-games.completed-games {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.append(style);

  function directChildWithClass(parent: HTMLElement, className: string): HTMLElement | null {
    return Array.from(parent.children).find(child => child.classList.contains(className)) as HTMLElement | undefined ?? null;
  }

  function resetParity(): void {
    historyPanel.classList.remove('live-results-parity', 'completed-games-panel');
    for (const property of ['display', 'gap', 'margin', 'padding', 'border', 'border-radius', 'background']) {
      historyPanel.style.removeProperty(property);
    }
  }

  function applyResultsParity(): void {
    const games = directChildWithClass(historyPanel, 'history-games');
    if (!games) {
      resetParity();
      return;
    }

    historyPanel.classList.add('live-results-parity', 'completed-games-panel');
    historyPanel.style.display = 'grid';
    historyPanel.style.gap = '13px';
    historyPanel.style.margin = '0 24px 20px';
    historyPanel.style.padding = '0';
    historyPanel.style.border = '0';
    historyPanel.style.borderRadius = '0';
    historyPanel.style.background = 'transparent';
    games.classList.add('completed-games');

    const cards = Array.from(games.children)
      .filter(child => child.classList.contains('history-game')) as HTMLElement[];
    const completed = cards.filter(card => card.classList.contains('completed')).length;
    let heading = directChildWithClass(historyPanel, 'live-results-heading');
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

  let applyScheduled = false;
  function scheduleApply(): void {
    if (applyScheduled) return;
    applyScheduled = true;
    queueMicrotask(() => {
      applyScheduled = false;
      applyResultsParity();
    });
  }

  const observer = new MutationObserver(scheduleApply);
  observer.observe(historyPanel, { childList: true, subtree: true });
  window.addEventListener('esports-live:snapshot', scheduleApply);
  window.addEventListener('load', scheduleApply, { once: true });
  scheduleApply();
  window.setTimeout(scheduleApply, 250);
  window.setTimeout(scheduleApply, 1_000);
}
