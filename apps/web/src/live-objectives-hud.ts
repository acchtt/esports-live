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

const outlineIcon = (paths: string): string => `
  <svg viewBox="0 0 32 32" style="fill:none" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    ${paths}
  </svg>`;

const OBJECTIVE_ICONS: Record<ObjectiveKey, string> = {
  towers: outlineIcon(`
    <path d="M8 5v7l3 3v12h10V15l3-3V5h-4v4h-8V5H8Z" />
    <path d="M11 13h10M13 18h6v9M9 27h14" />
  `),
  dragons: outlineIcon(`
    <path d="M6 22c1-8 6-14 15-15l-3-4 8 2-2 8-3-3" />
    <path d="M22 9c4 3 5 8 3 13-2 5-8 8-13 6-5-2-7-7-5-11 2-4 7-5 10-2l4 3-5 1" />
    <path d="M13 17c-2 0-3 1-3 3 0 2 2 4 5 4 3 0 5-2 5-5" />
  `),
  barons: outlineIcon(`
    <path d="m5 9 5-5 3 5 3-6 3 6 3-5 5 5-3 16-8 5-8-5L5 9Z" />
    <path d="M11 16c3-3 7-3 10 0-3 4-7 4-10 0Z" />
    <circle cx="16" cy="16" r="1.5" />
  `),
  inhibitors: outlineIcon(`
    <path d="m16 3 8 8-3 14-5 4-5-4-3-14 8-8Z" />
    <path d="m16 8 4 5-4 9-4-9 4-5Z" />
    <path d="M10 25h12" />
  `)
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
      <span class="v3-objective-label">${label}</span>
      <strong>${formatted}</strong>
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
