import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';
import './live-dashboard-v2.css';

type ObjectiveKey = 'towers' | 'dragons' | 'barons' | 'inhibitors';
type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';
type Side = 'blue' | 'red';

const gameContent = document.querySelector<HTMLElement>('#game-content');
const workspace = document.querySelector<HTMLElement>('#workspace');
const platformPanel = document.querySelector<HTMLElement>('#platform-panel');

const ROLE_ORDER: readonly CanonicalRole[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const ROLE_LABELS: Record<CanonicalRole, string> = {
  top: 'Top',
  jungle: 'Jungle',
  mid: 'Mid',
  bottom: 'Bottom',
  support: 'Support'
};
const OBJECTIVE_ORDER: readonly ObjectiveKey[] = ['towers', 'dragons', 'barons', 'inhibitors'];
const OBJECTIVE_LABELS: Record<ObjectiveKey, string> = {
  towers: 'Towers',
  dragons: 'Dragons',
  barons: 'Barons',
  inhibitors: 'Inhibitors'
};

const ICONS = {
  kills: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 4 6 6 6-6 2 2-6 6 6 6-2 2-6-6-6 6-2-2 6-6-6-6 2-2Z"/></svg>',
  gold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4.4 0 8 1.8 8 4s-3.6 4-8 4-8-1.8-8-4 3.6-4 8-4Zm-8 8.2c1.7 1.2 4.6 1.8 8 1.8s6.3-.6 8-1.8V15c0 2.2-3.6 4-8 4s-8-1.8-8-4v-3.8Zm0 6c1.7 1.2 4.6 1.8 8 1.8s6.3-.6 8-1.8V19c0 2.2-3.6 4-8 4s-8-1.8-8-4v-1.8Z"/></svg>'
} as const;

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

function formatCompact(value: number | null): string {
  if (value === null) return '—';
  return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString();
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function canonicalRole(value: string | null): CanonicalRole | null {
  const role = value?.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ') ?? '';
  if (role.includes('top')) return 'top';
  if (role.includes('jung')) return 'jungle';
  if (role.includes('mid')) return 'mid';
  if (role.includes('bot') || role.includes('adc') || role.includes('carry')) return 'bottom';
  if (role.includes('sup') || role.includes('utility')) return 'support';
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

function kda(player: LolPlayerState | null): string {
  return player
    ? `${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)}`
    : '—/—/—';
}

function initials(name: string): string {
  return name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function teamLogo(name: string, imageUrl?: string): string {
  return imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} logo" />`
    : `<span aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

function objectiveValue(team: LolTeamState, key: ObjectiveKey): number | null {
  return key === 'dragons'
    ? (team.objectives.dragons === null ? null : team.objectives.dragons.length)
    : team.objectives[key];
}

function objectiveMarkup(team: LolTeamState, key: ObjectiveKey): string {
  const label = OBJECTIVE_LABELS[key];
  const value = formatNumber(objectiveValue(team, key));
  return `<div class="v3-objective-stat objective-${key}" title="${label}" aria-label="${label}: ${value}"><span class="v3-objective-label">${label}</span><strong>${value}</strong></div>`;
}

function objectiveSide(team: LolTeamState, side: Side): string {
  return `<div class="v3-objective-side ${side}" aria-label="${side === 'blue' ? 'Blue' : 'Red'} team objectives">${OBJECTIVE_ORDER.map(key => objectiveMarkup(team, key)).join('')}</div>`;
}

function playerCell(player: LolPlayerState | null, side: Side): string {
  const name = player?.handle ?? 'Player unavailable';
  const champion = player?.championId ?? 'Champion unavailable';
  const level = player?.level ?? null;
  const levelText = level === null ? '—' : String(level);
  const levelLabel = level === null ? 'Champion level unavailable' : `Champion level ${level}`;
  return `<div class="v2-player ${side}"><span class="v2-champion" aria-hidden="true">${escapeHtml(initials(champion))}<span class="champion-level-badge" aria-label="${escapeHtml(levelLabel)}">${escapeHtml(levelText)}</span></span><span class="v2-player-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(champion)}</small></span><span class="v2-player-stat kda"><small>KDA</small><strong>${kda(player)}</strong></span><span class="v2-player-stat cs"><small>CS</small><strong>${formatNumber(player?.creepScore ?? null)}</strong></span><span class="v2-player-stat gold"><small>GOLD</small><strong>${formatCompact(player?.totalGold ?? null)}</strong></span></div>`;
}

function roleGoldLead(
  bluePlayer: LolPlayerState | null,
  redPlayer: LolPlayerState | null,
  role: CanonicalRole
): string {
  const blueGold = bluePlayer?.totalGold ?? null;
  const redGold = redPlayer?.totalGold ?? null;
  if (blueGold === null || redGold === null) {
    return `<span class="v2-role-gold neutral" aria-label="${ROLE_LABELS[role]} gold lead unavailable"><small>${ROLE_LABELS[role]}</small><strong>—</strong></span>`;
  }

  const difference = blueGold - redGold;
  if (difference === 0) {
    return `<span class="v2-role-gold neutral" aria-label="${ROLE_LABELS[role]} gold is even"><small>${ROLE_LABELS[role]}</small><strong>EVEN</strong></span>`;
  }

  const side: Side = difference > 0 ? 'blue' : 'red';
  const amount = formatCompact(Math.abs(difference));
  const leader = side === 'blue' ? 'Blue' : 'Red';
  return `<span class="v2-role-gold ${side}" aria-label="${ROLE_LABELS[role]} gold lead: ${leader} by ${amount}"><small>${ROLE_LABELS[role]}</small><strong>+${amount}</strong></span>`;
}

function matchupRows(blue: LolTeamState, red: LolTeamState): string {
  const bluePlayers = orderedPlayers(blue);
  const redPlayers = orderedPlayers(red);
  return ROLE_ORDER.map((role, index) => {
    const bluePlayer = bluePlayers[index] ?? null;
    const redPlayer = redPlayers[index] ?? null;
    return `<div class="v2-matchup-row" data-role="${role}">${playerCell(bluePlayer, 'blue')}${roleGoldLead(bluePlayer, redPlayer, role)}${playerCell(redPlayer, 'red')}</div>`;
  }).join('');
}

function render(snapshot: LiveSnapshot<LolStats>): void {
  if (!gameContent || !snapshot.stats) return;
  const stats = snapshot.stats;
  const blueRef = snapshot.series.teams.find(team => team.id === stats.blue.id);
  const redRef = snapshot.series.teams.find(team => team.id === stats.red.id);
  const goldDifference = stats.blue.gold === null || stats.red.gold === null
    ? null
    : stats.blue.gold - stats.red.gold;
  const leader = goldDifference === null
    ? 'Gold unavailable'
    : goldDifference === 0
      ? 'Gold even'
      : `${goldDifference > 0 ? stats.blue.name : stats.red.name} +${formatCompact(Math.abs(goldDifference))}`;

  workspace?.classList.add('dashboard-v2-active');
  if (platformPanel) platformPanel.hidden = true;

  gameContent.innerHTML = `<section class="live-dashboard-v2" data-live-dashboard-game-id="${escapeHtml(snapshot.game.id)}" data-live-history-game-id="${escapeHtml(snapshot.game.id)}"><header class="v2-hero"><div class="v2-team blue"><span class="v2-team-logo">${teamLogo(stats.blue.name, blueRef?.imageUrl)}</span><span class="v2-team-copy"><small>BLUE SIDE</small><strong>${escapeHtml(stats.blue.name)}</strong></span><span class="v2-team-kills">${formatNumber(stats.blue.kills)}</span></div><div class="v2-clock"><small>GAME ${snapshot.game.number}</small><strong id="live-game-clock">${formatClock(stats.gameClockSeconds)}</strong><span><i></i> LIVE</span></div><div class="v2-team red"><span class="v2-team-kills">${formatNumber(stats.red.kills)}</span><span class="v2-team-copy"><small>RED SIDE</small><strong>${escapeHtml(stats.red.name)}</strong></span><span class="v2-team-logo">${teamLogo(stats.red.name, redRef?.imageUrl)}</span></div></header><div class="v2-summary-row"><article class="v2-gold-card"><span>GOLD LEAD</span><strong class="${goldDifference === null ? 'neutral' : goldDifference >= 0 ? 'blue' : 'red'}">${escapeHtml(leader)}</strong><small>${formatCompact(stats.blue.gold)} vs ${formatCompact(stats.red.gold)}</small></article><article class="v2-objectives-card objective-hud-v3 objective-text-only"><div class="v3-objective-hud">${objectiveSide(stats.blue, 'blue')}<span class="v3-objective-center" aria-hidden="true"></span>${objectiveSide(stats.red, 'red')}</div></article></div><section class="v2-board"><div class="v2-board-head compact-matchup-header"><div class="v2-board-side blue"><span class="v2-board-side-label">BLUE</span><strong>${escapeHtml(stats.blue.name)}</strong><span class="v2-board-side-stats">${ICONS.kills}${formatNumber(stats.blue.kills)} ${ICONS.gold}${formatCompact(stats.blue.gold)}</span></div><div class="v2-board-center" aria-hidden="true"><small>LIVE BOARD</small><b>VS</b></div><div class="v2-board-side red"><span class="v2-board-side-stats">${ICONS.gold}${formatCompact(stats.red.gold)} ${ICONS.kills}${formatNumber(stats.red.kills)}</span><strong>${escapeHtml(stats.red.name)}</strong><span class="v2-board-side-label">RED</span></div></div><div class="v2-matchups">${matchupRows(stats.blue, stats.red)}</div></section><footer class="v2-footer"><span>${escapeHtml(stats.patch ? `Patch ${stats.patch}` : 'Patch unavailable')}</span><i></i><span>Summoner's Rift</span><i></i><span>Best of ${snapshot.series.bestOf} · Game ${snapshot.game.number}</span><em>LIVE</em></footer></section>`;
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (snapshot?.stats) queueMicrotask(() => render(snapshot));
});

window.addEventListener('esports-live:selection', () => {
  workspace?.classList.add('dashboard-v2-active');
  if (platformPanel) platformPanel.hidden = true;
});
