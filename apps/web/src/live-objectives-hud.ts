import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats, LolTeamState } from '@esports-live/adapter-lol';
import { objectiveIcon, type ObjectiveIconKey } from './objective-icons.ts';
import './live-objectives-hud.css';
import './objective-emblems.css';

type ObjectiveKey = ObjectiveIconKey;
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
    <div class="v3-objective-stat objective-${key}" title="${label}" aria-label="${label}: ${formatted}">
      <span class="v3-objective-icon ${key}">${objectiveIcon(key)}</span>
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
  const signature = JSON.stringify(['objective-emblems-v2', snapshot.game.id, ...values]);
  if (card.dataset.objectiveHudSignature === signature) return;

  card.classList.add('objective-hud-v3', 'objective-emblems-v2');
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
