function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const analysisPanel = requiredElement<HTMLElement>('.analysis-panel');
const analysisHeader = requiredElement<HTMLElement>('.analysis-header');
const selectedCompetition = requiredElement<HTMLElement>('#selected-competition');
const selectedSeries = requiredElement<HTMLElement>('#selected-series');
const selectedMeta = requiredElement<HTMLElement>('#selected-meta');
const scheduleList = requiredElement<HTMLElement>('#schedule-list');
const historyPanel = requiredElement<HTMLElement>('#series-history');
const qualityBanner = requiredElement<HTMLElement>('#quality-banner');
const gameSelector = requiredElement<HTMLElement>('#game-selector');
const gameContent = requiredElement<HTMLElement>('#game-content');
const completedDetail = requiredElement<HTMLElement>('#completed-match-detail');

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const style = document.createElement('style');
style.textContent = `
  .analysis-panel.live-detail-layout {
    min-width: 0;
  }
  .analysis-panel.live-detail-layout.live-detail-ready > .analysis-header {
    display: none !important;
  }
  .analysis-panel.live-detail-layout:not(.live-detail-ready) > #live-match-detail {
    display: none;
  }
  body[data-view-mode="match-history"] #live-match-detail {
    display: none !important;
  }
  #live-match-detail {
    min-width: 0;
  }
  #live-match-detail .completed-detail-header h2 {
    text-transform: none;
  }
  #live-match-detail .completed-final-badge.live {
    border-color: rgba(52, 211, 153, 0.3);
    color: #6ee7b7;
    background: rgba(52, 211, 153, 0.07);
  }
  #live-match-detail .completed-final-badge.paused {
    border-color: rgba(251, 191, 36, 0.3);
    color: #fcd34d;
    background: rgba(251, 191, 36, 0.07);
  }
  #live-match-detail .completed-final-badge.upcoming,
  #live-match-detail .completed-final-badge.in-progress {
    border-color: rgba(56, 189, 248, 0.28);
    color: #7dd3fc;
    background: rgba(56, 189, 248, 0.065);
  }
  #live-match-detail .completed-score-team small:empty {
    min-height: 0.85em;
  }
  #live-match-detail #series-history.live-series-results,
  #live-match-detail #series-history.completed-games-panel {
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
  }
  #live-match-detail #series-history .completed-game.active {
    border-color: rgba(56, 189, 248, 0.46);
    background: linear-gradient(145deg, rgba(56, 189, 248, 0.075), rgba(56, 189, 248, 0.025));
    box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.09);
  }
  #live-scoreboards {
    min-width: 0;
  }
  #live-scoreboards .completed-telemetry-heading {
    align-items: end;
  }
  #live-scoreboards .completed-telemetry-heading h3 {
    font-size: 1rem;
  }
  #live-scoreboards #game-selector.live-game-tabs {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    justify-content: stretch;
    gap: 6px;
    padding: 5px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 13px;
    background: rgba(2, 6, 23, 0.32);
  }
  #live-scoreboards .live-game-tabs .game-button.completed-game-tab {
    display: grid;
    gap: 3px;
    width: 100%;
    min-width: 0;
    min-height: 48px;
    padding: 8px 12px;
    border: 1px solid transparent;
    border-radius: 9px;
    color: #93a2b7;
    background: transparent;
    text-align: left;
  }
  #live-scoreboards .live-game-tabs .game-button.completed-game-tab strong {
    color: #cbd5e1;
    font-size: 0.76rem;
  }
  #live-scoreboards .live-game-tabs .game-button.completed-game-tab small {
    display: block;
    overflow: hidden;
    color: inherit;
    font-size: 0.62rem;
    font-weight: 700;
    text-overflow: ellipsis;
    text-transform: none;
    white-space: nowrap;
  }
  #live-scoreboards .live-game-tabs .game-button.completed-game-tab.active {
    border-color: rgba(56, 189, 248, 0.34);
    color: #a9e8ff;
    background: rgba(56, 189, 248, 0.1);
    box-shadow: 0 5px 18px rgba(2, 132, 199, 0.08);
    opacity: 1;
  }
  #live-scoreboards .live-game-tabs .game-button.completed-game-tab.active strong {
    color: #f0f9ff;
  }
  #live-scoreboards .live-game-tabs .game-button.unstarted,
  #live-scoreboards .live-game-tabs .game-button.unknown {
    display: none;
  }
  #live-scoreboards .game-selector-empty {
    padding: 12px;
    color: var(--muted);
    font-size: 0.72rem;
    text-align: center;
  }
  #live-scoreboards #quality-banner {
    margin: 0;
  }
  #live-scoreboards #game-content.live-final-game-content {
    min-width: 0;
    padding: 0;
  }
  #live-scoreboards #game-content .completed-final-game {
    margin: 0;
  }
  #live-scoreboards #game-content .analysis-empty {
    min-height: 240px;
    padding: 28px;
    border: 1px solid var(--border);
    border-radius: 15px;
    background: rgba(255, 255, 255, 0.015);
  }
  @media (max-width: 720px) {
    #live-match-detail {
      padding: 14px;
    }
    #live-match-detail .completed-detail-header,
    #live-match-detail .completed-scoreboard {
      padding: 16px;
    }
    #live-match-detail .completed-scoreboard {
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 10px;
    }
    #live-match-detail .completed-score-value {
      gap: 6px;
      font-size: 1.65rem;
    }
    #live-match-detail .completed-score-team strong {
      font-size: 0.86rem;
    }
    #live-scoreboards #game-selector.live-game-tabs {
      grid-template-columns: 1fr;
    }
  }
`;
document.head.append(style);

const liveDetail = document.createElement('section');
liveDetail.id = 'live-match-detail';
liveDetail.className = 'completed-match-detail live-match-detail';

const hero = document.createElement('section');
hero.className = 'completed-series-hero';
hero.innerHTML = `
  <div class="completed-detail-header">
    <div>
      <span class="eyebrow" data-live-competition>LIVE MATCH</span>
      <h2 data-live-heading>Live series</h2>
      <p data-live-meta>Waiting for series details.</p>
    </div>
    <span class="completed-final-badge live" data-live-status>LIVE</span>
  </div>
  <div class="completed-scoreboard" data-live-scoreboard>
    <div class="completed-score-team"><strong>Team unavailable</strong><small></small></div>
    <div class="completed-score-value"><b>0</b><span>–</span><b>0</b></div>
    <div class="completed-score-team"><strong>Team unavailable</strong><small></small></div>
  </div>`;

const scoreboards = document.createElement('section');
scoreboards.id = 'live-scoreboards';
scoreboards.className = 'completed-final-telemetry';
const scoreboardHeading = document.createElement('div');
scoreboardHeading.className = 'completed-telemetry-heading';
scoreboardHeading.innerHTML = '<h3>Game scoreboards</h3><span>Select a completed or live game</span>';
scoreboards.append(scoreboardHeading, gameSelector, qualityBanner, gameContent);

liveDetail.append(hero, historyPanel, scoreboards);
analysisPanel.insertBefore(liveDetail, completedDetail);
analysisPanel.classList.add('live-detail-layout');
gameSelector.classList.add('completed-game-tabs', 'live-game-tabs');
gameContent.classList.add('live-final-game-content');

function selectedSeriesId(): string | null {
  return scheduleList.querySelector<HTMLElement>('[data-series-id].selected')?.dataset.seriesId ?? null;
}

function statusLabel(): string {
  const raw = selectedMeta.textContent?.split('·')[0]?.trim().toUpperCase() ?? '';
  if (raw === 'FINAL' || raw === 'COMPLETED') return 'FINAL';
  if (raw === 'PAUSED') return 'PAUSED';
  if (raw === 'LIVE') return 'LIVE';
  if (raw === 'UPCOMING' || raw === 'SCHEDULED') return 'UPCOMING';
  return raw || 'IN PROGRESS';
}

function statusHeading(status: string): string {
  if (status === 'FINAL') return 'Final series result';
  if (status === 'PAUSED') return 'Paused live series';
  if (status === 'LIVE') return 'Live series';
  if (status === 'UPCOMING') return 'Upcoming series';
  return 'Series overview';
}

function statusClass(status: string): string {
  return status.toLowerCase().replaceAll(' ', '-');
}

function seriesTeamsAndScore(): { left: string; right: string; leftWins: number; rightWins: number } {
  const teamNodes = [...selectedSeries.querySelectorAll<HTMLElement>('.history-header-team')];
  const scoreNodes = [...selectedSeries.querySelectorAll<HTMLElement>('.history-header-score b')];
  if (teamNodes.length >= 2 && scoreNodes.length >= 2) {
    return {
      left: teamNodes[0]?.textContent?.trim() || 'Team unavailable',
      right: teamNodes[1]?.textContent?.trim() || 'Team unavailable',
      leftWins: Number.parseInt(scoreNodes[0]?.textContent ?? '0', 10) || 0,
      rightWins: Number.parseInt(scoreNodes[1]?.textContent ?? '0', 10) || 0
    };
  }

  const raw = selectedSeries.textContent?.trim() ?? '';
  const parts = raw.split(/\s+vs\s+/i);
  return {
    left: parts[0] || 'Team unavailable',
    right: parts[1] || 'Team unavailable',
    leftWins: 0,
    rightWins: 0
  };
}

function competitionParts(): { competition: string; stage: string | null } {
  const parts = (selectedCompetition.textContent ?? '')
    .split('·')
    .map(part => part.trim())
    .filter(Boolean);
  return {
    competition: parts[0] ?? 'LIVE MATCH',
    stage: parts.length > 1 ? parts.slice(1).join(' · ') : null
  };
}

function renderHero(): void {
  const active = selectedSeriesId() !== null;
  analysisPanel.classList.toggle('live-detail-ready', active);
  if (!active) return;

  const status = statusLabel();
  const teams = seriesTeamsAndScore();
  const competition = competitionParts();
  const metaParts = (selectedMeta.textContent ?? '')
    .split('·')
    .map(part => part.trim())
    .filter(Boolean)
    .filter((_, index) => index > 0);
  if (competition.stage) metaParts.unshift(competition.stage);

  const competitionNode = hero.querySelector<HTMLElement>('[data-live-competition]');
  const headingNode = hero.querySelector<HTMLElement>('[data-live-heading]');
  const metaNode = hero.querySelector<HTMLElement>('[data-live-meta]');
  const badgeNode = hero.querySelector<HTMLElement>('[data-live-status]');
  const scoreboardNode = hero.querySelector<HTMLElement>('[data-live-scoreboard]');

  if (competitionNode) competitionNode.textContent = competition.competition;
  if (headingNode) headingNode.textContent = statusHeading(status);
  if (metaNode) metaNode.textContent = metaParts.join(' · ') || 'Series details unavailable';
  if (badgeNode) {
    badgeNode.textContent = status;
    badgeNode.className = `completed-final-badge ${statusClass(status)}`;
  }

  const leftLeads = teams.leftWins > teams.rightWins;
  const rightLeads = teams.rightWins > teams.leftWins;
  const leftLabel = status === 'FINAL'
    ? leftLeads ? 'Series winner' : ''
    : leftLeads ? 'Series leader' : teams.leftWins === teams.rightWins ? 'Series tied' : '';
  const rightLabel = status === 'FINAL'
    ? rightLeads ? 'Series winner' : ''
    : rightLeads ? 'Series leader' : teams.leftWins === teams.rightWins ? 'Series tied' : '';

  if (scoreboardNode) {
    scoreboardNode.innerHTML = `
      <div class="completed-score-team ${leftLeads ? 'winner' : ''}">
        <strong>${escapeHtml(teams.left)}</strong><small>${escapeHtml(leftLabel)}</small>
      </div>
      <div class="completed-score-value"><b>${teams.leftWins}</b><span>–</span><b>${teams.rightWins}</b></div>
      <div class="completed-score-team ${rightLeads ? 'winner' : ''}">
        <strong>${escapeHtml(teams.right)}</strong><small>${escapeHtml(rightLabel)}</small>
      </div>`;
  }
}

function historyCardFor(gameId: string): HTMLElement | null {
  return [...historyPanel.querySelectorAll<HTMLElement>('[data-history-game-id]')]
    .find(card => card.dataset.historyGameId === gameId) ?? null;
}

function enhanceGameTabs(): void {
  gameSelector.classList.add('completed-game-tabs', 'live-game-tabs');
  const buttons = [...gameSelector.querySelectorAll<HTMLButtonElement>('[data-game-id]')];
  const activeGameId = buttons.find(button => button.classList.contains('active'))?.dataset.gameId ?? null;

  for (const button of buttons) {
    button.classList.add('completed-game-tab');
    const gameId = button.dataset.gameId ?? '';
    const card = historyCardFor(gameId);
    const number = card?.querySelector('.completed-game-top strong')?.textContent?.match(/\d+/)?.[0]
      ?? button.textContent?.match(/\d+/)?.[0]
      ?? '?';
    const result = card?.querySelector('.completed-result strong')?.textContent?.trim();
    const state = card?.querySelector('.completed-game-state')?.textContent?.trim()
      ?? [...button.classList].find(value => ['live', 'paused', 'draft', 'completed', 'unstarted', 'unknown'].includes(value))
      ?? 'Game';
    const summary = result && result !== 'Result pending' && result !== 'Not played'
      ? result
      : state.charAt(0).toUpperCase() + state.slice(1);
    const signature = `${number}|${summary}`;
    if (button.dataset.liveTabSignature !== signature) {
      button.dataset.liveTabSignature = signature;
      button.innerHTML = `<strong>Game ${escapeHtml(number)}</strong><small>${escapeHtml(summary)}</small>`;
      button.setAttribute('aria-label', `Open Game ${number} scoreboard`);
    }
  }

  historyPanel.querySelectorAll<HTMLElement>('[data-history-game-id]').forEach(card => {
    card.classList.toggle('active', Boolean(activeGameId) && card.dataset.historyGameId === activeGameId);
  });
}

let queued = false;
function queueRender(): void {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    renderHero();
    enhanceGameTabs();
  });
}

for (const element of [selectedCompetition, selectedSeries, selectedMeta]) {
  new MutationObserver(queueRender).observe(element, {
    childList: true,
    characterData: true,
    subtree: true
  });
}
new MutationObserver(queueRender).observe(scheduleList, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class']
});
new MutationObserver(queueRender).observe(historyPanel, {
  childList: true,
  subtree: true
});
new MutationObserver(queueRender).observe(gameSelector, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class']
});
window.addEventListener('esports-live:snapshot', queueRender);
window.addEventListener('load', queueRender, { once: true });
queueRender();
