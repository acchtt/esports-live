import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats, LolTeamState } from '@esports-live/adapter-lol';
import './live-objectives-hud.css';

type ObjectiveKey = 'towers' | 'dragons' | 'barons' | 'inhibitors';
type Side = 'blue' | 'red';

const OBJECTIVE_ORDER: readonly ObjectiveKey[] = [
  'towers',
  'dragons',
  'barons',
  'inhibitors'
];

const OBJECTIVE_LABELS: Record<ObjectiveKey, string> = {
  towers: 'Towers',
  dragons: 'Dragons',
  barons: 'Barons',
  inhibitors: 'Inhibitors'
};

const OBJECTIVE_ICONS: Record<ObjectiveKey, string> = {
  towers: `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 4v6M13 4v6M19 4v6M25 4v6M6 10h20l-3 5v13H9V15l-3-5Z" />
      <path d="M13 19h6v9h-6v-9ZM10 15h12" />
    </svg>`,
  dragons: `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M7 20c1-7 6-12 14-13l-2-4 7 2-1 7-3-3" />
      <path d="M22 9c4 3 5 9 2 14-3 5-10 7-15 4-4-2-5-7-3-11 2-3 6-4 9-2 2 1 3 4 1 6-1 2-4 2-5 0" />
      <path d="m19 12 4 3-5 1" />
    </svg>`,
  barons: `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M5 7 10 3l2 5 4-6 4 6 2-5 5 4-2 8-2-3-2 5v7l-5 6-5-6v-7l-2-5-2 3-2-8Z" />
      <path d="m11 18 3 2M21 18l-3 2M13 25h6M16 20v3" />
    </svg>`,
  inhibitors: `
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="m16 3 8 8-3 14-5 4-5-4-3-14 8-8Z" />
      <path d="m16 8 4 5-4 9-4-9 4-5ZM10 25h12" />
    </svg>`
};

const gameContent = document.querySelector<HTMLElement>('#game-content');
let latestSnapshot: LiveSnapshot<LolStats> | null = null;
let renderQueued = false;

function formatObjective(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function objectiveValue(team: LolTeamState, key: ObjectiveKey): number | null {
  if (key === 'dragons') {
    return team.objectives.dragons === null ? null : team.objectives.dragons.length;
  }
  return team.objectives[key];
}

function objectiveMarkup(team: LolTeamState, key: ObjectiveKey): string {
  const label = OBJECTIVE_LABELS[key];
  const value = objectiveValue(team, key);
  const formatted = formatObjective(value);
  return `
    <div class="v3-objective-stat" title="${label}" aria-label="${label}: ${formatted}">
      <span class="v3-objective-icon">${OBJECTIVE_ICONS[key]}</span>
      <strong>${formatted}</strong>
      <span class="v3-visually-hidden">${label}</span>
    </div>`;
}

function sideMarkup(team: LolTeamState, side: Side): string {
  return `
    <div class="v3-objective-side ${side}" aria-label="${side === 'blue' ? 'Blue' : 'Red'} team objectives">
      ${OBJECTIVE_ORDER.map(key => objectiveMarkup(team, key)).join('')}
    </div>`;
}

function applyObjectiveHud(): void {
  renderQueued = false;
  const snapshot = latestSnapshot;
  if (!snapshot?.stats) return;

  const dashboard = [...document.querySelectorAll<HTMLElement>('.live-dashboard-v2')]
    .find(element => element.dataset.liveDashboardGameId === snapshot.game.id);
  const card = dashboard?.querySelector<HTMLElement>('.v2-objectives-card');
  if (!card) return;

  const values = OBJECTIVE_ORDER.flatMap(key => [
    objectiveValue(snapshot.stats!.blue, key),
    objectiveValue(snapshot.stats!.red, key)
  ]);
  const signature = JSON.stringify([snapshot.game.id, ...values]);
  if (card.dataset.objectiveHudSignature === signature) return;

  card.classList.add('objective-hud-v3');
  card.dataset.objectiveHudSignature = signature;
  card.innerHTML = `
    <div class="v3-objective-title" aria-hidden="true">
      <i></i><span>OBJECTIVES</span><i></i>
    </div>
    <div class="v3-objective-hud">
      ${sideMarkup(snapshot.stats.blue, 'blue')}
      <span class="v3-objective-center" aria-hidden="true"></span>
      ${sideMarkup(snapshot.stats.red, 'red')}
    </div>`;
}

function queueObjectiveHud(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(applyObjectiveHud);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.stats) return;
  latestSnapshot = snapshot;
  queueObjectiveHud();
});

window.addEventListener('esports-live:selection', () => {
  latestSnapshot = null;
});

if (gameContent) {
  const observer = new MutationObserver(queueObjectiveHud);
  observer.observe(gameContent, { childList: true, subtree: true });
}

export {};
