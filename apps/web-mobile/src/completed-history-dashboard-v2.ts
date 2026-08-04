import '../../web/src/completed-history-dashboard-v2.css';

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
        <div class="history-v2-objective-stat objective-${key}" aria-label="${LABELS[key]}: ${formatNumber(values[key])}">
          <span class="history-v2-objective-label">${LABELS[key]}</span>
          <strong>${formatNumber(values[key])}</strong>
        </div>`).join('')}
    </div>`;
}

function isV20LiveComparison(comparison: HTMLElement): boolean {
  const board = comparison.closest<HTMLElement>('.mobile-live-history-board[data-mobile-history-copy="true"]');
  return Boolean(
    board
    && document.documentElement.dataset.mobileLiveHistoryDesign === 'v20'
    && document.body.dataset.mobileContext !== 'history'
  );
}

function redesignComparison(comparison: HTMLElement): void {
  if (isV20LiveComparison(comparison)) return;
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
  comparison.classList.add('completed-history-dashboard-v2', 'objective-text-only');
  comparison.classList.remove('objective-emblems-v2');
  comparison.innerHTML = `
    <header class="history-v2-team-header">
      <div class="history-v2-team blue"><span>BLUE SIDE</span><strong>${escapeHtml(blueName)}</strong></div>
      <div class="history-v2-final">FINAL</div>
      <div class="history-v2-team red"><span>RED SIDE</span><strong>${escapeHtml(redName)}</strong></div>
    </header>
    <div class="history-v2-summary">
      <article class="history-v2-gold-card">
        <span>GOLD LEAD</span>
        <strong class="${leaderClass}">${escapeHtml(leader)}</strong>
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
document.documentElement.dataset.mobileHistoryDashboardOwner = 'mobile-v20-aware';
new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
document.addEventListener('click', event => {
  const target = event.target as Element | null;
  if (!target?.closest('[data-completed-series-id], .completed-game')) return;
  [0, 50, 200, 600].forEach(delay => window.setTimeout(queueScan, delay));
}, true);
window.addEventListener('load', queueScan);
queueScan();

export {};
