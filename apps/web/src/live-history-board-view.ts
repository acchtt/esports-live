import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';

const ROLE_ORDER: readonly CanonicalRole[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const gameContent = document.querySelector<HTMLElement>('#game-content');

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function patchLabel(value: string | null): string {
  const match = value?.match(/^(\d+)\.(\d+)/);
  return match ? `Patch ${match[1]}.${match[2]}` : 'Patch unavailable';
}

function gameStateLabel(value: string): string {
  switch (value) {
    case 'draft': return 'Draft';
    case 'live': return 'Live';
    case 'paused': return 'Paused';
    case 'completed': return 'Final';
    default: return value ? value[0]!.toUpperCase() + value.slice(1) : 'Live';
  }
}

function canonicalRole(value: string | null): CanonicalRole | null {
  const normalized = value?.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ') ?? '';
  if (normalized.includes('top')) return 'top';
  if (normalized.includes('jung')) return 'jungle';
  if (normalized.includes('mid')) return 'mid';
  if (normalized.includes('bot') || normalized.includes('adc') || normalized.includes('carry')) return 'bottom';
  if (normalized.includes('sup') || normalized.includes('utility')) return 'support';
  return null;
}

function orderedPlayers(team: LolTeamState): readonly (LolPlayerState | null)[] {
  const assigned = new Map<CanonicalRole, LolPlayerState>();
  const unassigned: LolPlayerState[] = [];
  for (const player of team.players) {
    const role = canonicalRole(player.role);
    if (role && !assigned.has(role)) assigned.set(role, player);
    else unassigned.push(player);
  }
  return ROLE_ORDER.map(role => assigned.get(role) ?? unassigned.shift() ?? null);
}

function playerIdentityMarkup(player: LolPlayerState | null, side: 'blue' | 'red'): string {
  return `
    <div class="role-player ${side}">
      <div class="role-player-heading">
        <div class="role-player-name">
          <strong>${escapeHtml(player?.handle ?? 'Player unavailable')}</strong>
          <small>${escapeHtml(player?.championId ?? 'Champion unavailable')}</small>
        </div>
      </div>
      <div class="role-player-stats">
        <span aria-label="KDA"><strong>${formatNumber(player?.kills ?? null)}/${formatNumber(player?.deaths ?? null)}/${formatNumber(player?.assists ?? null)}</strong></span>
        <span aria-label="Creep score"><strong>${formatNumber(player?.creepScore ?? null)}</strong></span>
        <span aria-label="Gold"><strong>${formatNumber(player?.totalGold ?? null)}</strong></span>
      </div>
    </div>`;
}

function roleGoldDeltaMarkup(blue: LolPlayerState | null, red: LolPlayerState | null): string {
  const blueGold = blue?.totalGold ?? null;
  const redGold = red?.totalGold ?? null;
  const difference = blueGold === null || redGold === null ? null : blueGold - redGold;
  const side = difference === null ? 'unknown' : difference > 0 ? 'blue' : difference < 0 ? 'red' : 'even';
  const magnitude = difference === null ? null : Math.abs(difference);
  const edge = magnitude === null ? 0 : Math.min(50, Math.round((magnitude / 2500) * 50));
  const lead = magnitude === null
    ? 'No data'
    : magnitude === 0
      ? 'Even'
      : `+${magnitude.toLocaleString()}`;
  return `
    <div class="role-gold-delta ${side}" style="--role-edge: ${edge}%">
      <strong>${lead}</strong>
      <span class="role-edge-track" aria-hidden="true"><i></i></span>
    </div>`;
}

function roleMatchupRows(blue: LolTeamState, red: LolTeamState): string {
  const bluePlayers = orderedPlayers(blue);
  const redPlayers = orderedPlayers(red);
  return ROLE_ORDER.map((_, index) => `
    <div class="role-matchup-row">
      ${playerIdentityMarkup(bluePlayers[index] ?? null, 'blue')}
      ${roleGoldDeltaMarkup(bluePlayers[index] ?? null, redPlayers[index] ?? null)}
      ${playerIdentityMarkup(redPlayers[index] ?? null, 'red')}
    </div>`).join('');
}

function comparisonMetric(label: string, blueValue: number | string | null, redValue: number | string | null): string {
  const displayValue = (value: number | string | null): string => {
    if (value === null) return '—';
    if (label === 'Gold' && typeof value === 'number') return `${(Math.abs(value) / 1000).toFixed(1)}K`;
    return typeof value === 'number' ? value.toLocaleString() : value;
  };
  const title = (value: number | string | null): string => (
    typeof value === 'number' ? value.toLocaleString() : value ?? '—'
  );
  return `
    <div class="completed-team-metric">
      <span class="completed-team-metric-label">${escapeHtml(label)}</span>
      <div class="completed-team-values">
        <strong title="${escapeHtml(title(blueValue))}">${escapeHtml(displayValue(blueValue))}</strong>
        <i aria-hidden="true">–</i>
        <strong class="red" title="${escapeHtml(title(redValue))}">${escapeHtml(displayValue(redValue))}</strong>
      </div>
    </div>`;
}

function goldDifferenceMetric(blueGold: number | null, redGold: number | null): string {
  const difference = blueGold === null || redGold === null ? null : blueGold - redGold;
  const side = difference === null || difference === 0 ? 'even' : difference > 0 ? 'blue' : 'red';
  const value = difference === null
    ? '—'
    : difference === 0
      ? 'Even'
      : `+${(Math.abs(difference) / 1000).toFixed(1)}K`;
  const title = difference === null ? 'Unavailable' : `${Math.abs(difference).toLocaleString()} gold lead`;
  return `
    <div class="completed-team-metric gold-diff ${side}">
      <span class="completed-team-metric-label">Gold diff</span>
      <strong class="completed-team-single-value" title="${escapeHtml(title)}">${escapeHtml(value)}</strong>
    </div>`;
}

function teamComparisonMarkup(blue: LolTeamState, red: LolTeamState): string {
  return `
    <section class="completed-team-comparison">
      <div class="completed-team-scoreline">
        <div class="completed-comparison-team blue"><strong>${escapeHtml(blue.name)}</strong></div>
        ${comparisonMetric('Gold', blue.gold, red.gold)}
        ${comparisonMetric('Kills', blue.kills, red.kills)}
        ${comparisonMetric('Towers', blue.objectives.towers, red.objectives.towers)}
        <div class="completed-comparison-team red"><strong>${escapeHtml(red.name)}</strong></div>
      </div>
      <div class="completed-team-objectives">
        ${goldDifferenceMetric(blue.gold, red.gold)}
        ${comparisonMetric('Dragons', blue.objectives.dragons?.length ?? null, red.objectives.dragons?.length ?? null)}
        ${comparisonMetric('Barons', blue.objectives.barons, red.objectives.barons)}
        ${comparisonMetric('Inhibitors', blue.objectives.inhibitors, red.objectives.inhibitors)}
      </div>
    </section>`;
}

function renderSnapshot(snapshot: LiveSnapshot<LolStats>): void {
  if (!gameContent || !snapshot.stats) return;
  const stats = snapshot.stats;
  gameContent.innerHTML = `
    <article class="completed-final-game" data-live-history-game-id="${escapeHtml(snapshot.game.id)}">
      <div class="completed-final-game-header">
        <strong>Game ${escapeHtml(snapshot.game.number)} · ${escapeHtml(gameStateLabel(snapshot.game.state))}</strong>
        <span><span id="live-game-clock">${escapeHtml(formatClock(stats.gameClockSeconds))}</span> · ${escapeHtml(patchLabel(stats.patch ?? null))}</span>
      </div>
      ${teamComparisonMarkup(stats.blue, stats.red)}
      <div class="role-matchup-list completed-final-matchups">${roleMatchupRows(stats.blue, stats.red)}</div>
    </article>`;
}

window.addEventListener('esports-live:snapshot', event => {
  renderSnapshot((event as CustomEvent<LiveSnapshot<LolStats>>).detail);
});
