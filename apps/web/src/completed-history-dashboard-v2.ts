import './completed-history-dashboard-v2.css';

type ObjectiveKey = 'towers' | 'dragons' | 'barons' | 'inhibitors';
type Side = 'blue' | 'red';

interface MetricPair {
  blue: number | null;
  red: number | null;
}

const OBJECTIVES: readonly ObjectiveKey[] = ['towers', 'dragons', 'barons', 'inhibitors'];
const LABELS: Record<ObjectiveKey, string> = {
  towers: 'Towers',
  dragons: 'Dragons',
  barons: 'Barons',
  inhibitors: 'Inhibitors'
};

const ICONS: Record<ObjectiveKey, string> = {
  towers: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 4v6M13 4v6M19 4v6M25 4v6M6 10h20l-3 5v13H9V15l-3-5Z"/><path d="M13 19h6v9h-6v-9ZM10 15h12"/></svg>',
  dragons: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 20c1-7 6-12 14-13l-2-4 7 2-1 7-3-3"/><path d="M22 9c4 3 5 9 2 14-3 5-10 7-15 4-4-2-5-7-3-11 2-3 6-4 9-2 2 1 3 4 1 6-1 2-4 2-5 0"/><path d="m19 12 4 3-5 1"/></svg>',
  barons: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M5 7 10 3l2 5 4-6 4 6 2-5 5 4-2 8-2-3-2 5v7l-5 6-5-6v-7l-2-5-2 3-2-8Z"/><path d="m11 18 3 2M21 18l-3 2M13 25h6M16 20v3"/></svg>',
  inhibitors: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="m16 3 8 8-3 14-5 4-5-4-3-14 8-8Z"/><path d="m16 8 4 5-4 9-4-9 4-5ZM10 25h12"/></svg>'
};

let scanQueued = false;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseNumber(value: string | null): number | null {
  const raw = value?.trim();
  if (!raw || raw === '—' || raw.toLowerCase() === 'unavailable') return null;
  const normalized = raw.replaceAll(',', '').replace(/[+−-]/g, '');
  const multiplier = /k$/i.test(normalized) ? 1000 : 1;
  const parsed = Number(normalized.replace(/k$/i, ''));
  return Number.isFinite(parsed) ? parsed * multiplier : null;
}

function metricPair(root: ParentNode, label: string): MetricPair {
  const metric = [...root.querySelectorAll<HTMLElement>('.completed-team-metric')]
    .find(element => element.querySelector('.completed-team-metric-label')?.textContent?.trim().toLowerCase() === label.toLowerCase());
  const values = metric?.querySelectorAll<HTMLElement>('.completed-team-values strong');
  if (!values || values.length < 2) return { blue: null, red: null };
  return {
    blue: parseNumber(values[0]?.getAttribute('title') ?? values[0]?.textContent ?? null),
    red: parseNumber(values[1]?.getAttribute('title') ?? values[1]?.textContent ?? null)
  };
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function formatCompact(value: number | null): string {
  if (value === null) return '—';
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
}

function selectedSeriesTeams(): [string, string] | null {
  const candidates = [
    document.querySelector<HTMLElement>('.completed-result-card.selected strong'),
    document.querySelector<HTMLElement>('#completed-match-list .selected strong'),
    document.querySelector<HTMLElement>('.completed-scoreboard')
  ];
  for (const candidate of candidates) {
    const text = candidate?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const match = text.match(/^(.+?)\s+vs\s+(.+)$/i);
    if (match?.[1] && match[2]) return [match[1].trim(), match[2].trim()];
  }
  return null;
}

function usableTeamName(value: string, fallback: string): string {
  const normalized = value.trim();
  return !normalized || /^team\s*[12]$/i.test(normalized) || /^unavailable$/i.test(normalized)
    ? fallback
    : normalized;
}

function objectiveMarkup(side: Side, values: Record<ObjectiveKey, number | null>): string {
  return `
    <div class="history-v2-objective-side ${side}" aria-label="${side === 'blue' ? 'Blue' : 'Red'} team objectives">
      ${OBJECTIVES.map(key => `
        <div class="history-v2-objective-stat" aria-label="${LABELS[key]}: ${formatNumber(values[key])}">
          <span class="history-v2-objective-icon">${ICONS[key]}</span>
          <span class="history-v2-objective-label">${LABELS[key]}</span>
          <strong>${formatNumber(values[key])}</strong>
        </div>`).join('')}
    </div>`;
}

function redesignComparison(comparison: HTMLElement): void {
  if (comparison.querySelector('.history-v2-team-header')) return;

  const selectedTeams = selectedSeriesTeams();
  const rawBlueName = comparison.querySelector<HTMLElement>('.completed-comparison-team.blue strong')?.textContent?.trim() ?? '';
  const rawRedName = comparison.querySelector<HTMLElement>('.completed-comparison-team.red strong')?.textContent?.trim() ?? '';
  const blueName = usableTeamName(rawBlueName, selectedTeams?.[0] ?? 'Blue team');
  const redName = usableTeamName(rawRedName, selectedTeams?.[1] ?? 'Red team');

  const gold = metricPair(comparison, 'Gold');
  const kills = metricPair(comparison, 'Kills');
  const towers = metricPair(comparison, 'Towers');
  const dragons = metricPair(comparison, 'Dragons');
  const barons = metricPair(comparison, 'Barons');
  const inhibitors = metricPair(comparison, 'Inhibitors');

  const totalGold = (gold.blue ?? 0) + (gold.red ?? 0);
  const rawBlueShare = totalGold > 0 ? (gold.blue ?? 0) / totalGold : 0.5;
  const blueShare = Math.min(0.92, Math.max(0.08, rawBlueShare));
  const difference = gold.blue === null || gold.red === null ? null : gold.blue - gold.red;
  const leader = difference === null
    ? 'Gold unavailable'
    : difference === 0
      ? 'Gold even'
      : `${difference > 0 ? blueName : redName} +${formatCompact(Math.abs(difference))}`;
  const leaderClass = difference === null || difference === 0 ? 'neutral' : difference > 0 ? 'blue' : 'red';

  const blueObjectives: Record<ObjectiveKey, number | null> = {
    towers: towers.blue,
    dragons: dragons.blue,
    barons: barons.blue,
    inhibitors: inhibitors.blue
  };
  const redObjectives: Record<ObjectiveKey, number | null> = {
    towers: towers.red,
    dragons: dragons.red,
    barons: barons.red,
    inhibitors: inhibitors.red
  };

  comparison.dataset.historyDashboardV2 = 'true';
  comparison.classList.add('completed-history-dashboard-v2');
  comparison.innerHTML = `
    <header class="history-v2-team-header">
      <div class="history-v2-team blue"><span>BLUE SIDE</span><strong>${escapeHtml(blueName)}</strong></div>
      <div class="history-v2-final">FINAL</div>
      <div class="history-v2-team red"><span>RED SIDE</span><strong>${escapeHtml(redName)}</strong></div>
    </header>
    <div class="history-v2-summary">
      <article class="history-v2-gold-card" style="--history-blue-share:${(blueShare * 100).toFixed(2)}%">
        <span>GOLD LEAD</span>
        <strong class="${leaderClass}">${escapeHtml(leader)}</strong>
        <div class="history-v2-gold-bar" role="img" aria-label="${escapeHtml(`${blueName} ${formatCompact(gold.blue)} versus ${redName} ${formatCompact(gold.red)}`)}">
          <i class="blue"></i><i class="red"></i><b aria-hidden="true"></b>
        </div>
        <small>${formatCompact(gold.blue)} vs ${formatCompact(gold.red)}</small>
      </article>
      <article class="history-v2-quick-stats">
        <div><span>KILLS</span><strong class="blue">${formatNumber(kills.blue)}</strong><i>–</i><strong class="red">${formatNumber(kills.red)}</strong></div>
        <div><span>TOWERS</span><strong class="blue">${formatNumber(towers.blue)}</strong><i>–</i><strong class="red">${formatNumber(towers.red)}</strong></div>
      </article>
    </div>
    <section class="history-v2-objectives">
      <div class="history-v2-objective-title"><i></i><span>OBJECTIVES</span><i></i></div>
      <div class="history-v2-objective-hud">
        ${objectiveMarkup('blue', blueObjectives)}
        <span class="history-v2-objective-center" aria-hidden="true"></span>
        ${objectiveMarkup('red', redObjectives)}
      </div>
    </section>`;
}

function scanCompletedHistory(): void {
  scanQueued = false;
  document.querySelectorAll<HTMLElement>('.completed-team-comparison')
    .forEach(redesignComparison);
}

function queueScan(): void {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(scanCompletedHistory);
}

document.documentElement.dataset.demoHistoryDashboardV2 = 'loaded';
new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', event => {
  const target = event.target as Element | null;
  if (!target?.closest('[data-completed-series-id], .completed-game')) return;
  [0, 50, 200, 600].forEach(delay => window.setTimeout(queueScan, delay));
}, true);
window.addEventListener('load', queueScan);
queueScan();

export {};
