import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';
import './live-dashboard-v2.css';

type ObjectiveKey = 'towers' | 'dragons' | 'heralds' | 'barons' | 'inhibitors';
type CanonicalRole = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';

const gameContent = document.querySelector<HTMLElement>('#game-content');
const workspace = document.querySelector<HTMLElement>('#workspace');
const platformPanel = document.querySelector<HTMLElement>('#platform-panel');

const ROLE_ORDER: readonly CanonicalRole[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const ROLE_LABELS: Record<CanonicalRole, string> = { top: 'Top', jungle: 'Jungle', mid: 'Mid', bottom: 'Bottom', support: 'Support' };
const OBJECTIVE_LABELS: Record<ObjectiveKey, string> = { towers: 'Towers', dragons: 'Dragons', heralds: 'Heralds', barons: 'Barons', inhibitors: 'Inhibitors' };

const ICONS: Record<ObjectiveKey | 'kills' | 'gold' | CanonicalRole, string> = {
  towers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h2v3h6V3h2v5l2 2v11H5V10l2-2V3Zm2 7-2 2v7h10v-7l-2-2H9Zm2 2h2v5h-2v-5Z"/></svg>',
  dragons: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13c1.2-4.8 5.2-8.4 10.2-8.8L12.5 2l4.8.8 1.5 4.6-2.5-1.2c1.8 1.6 3 4 3 6.7 0 4.4-3.3 8-7.5 8S4.3 17.7 4 13Zm4.2-.8c.6 3.3 2.5 5.2 4.8 5.2 2.4 0 4.2-1.9 4.6-4.5-2.6 1.2-5.5 1-7.8-.7l-1.6 2v-2Zm1.7-3.6 2.1 1.7 2.4-.4 1.5 1c-.8-2.5-2.4-3.7-4.6-3.7-.5 0-1 .1-1.4.2v1.2Z"/></svg>',
  heralds: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 7 5v8l-7 7-7-7V7l7-5Zm0 4.1L8 9v4.4l4 4 4-4V9l-4-2.9Zm0 2.4 2.5 2.5L12 15l-2.5-4L12 8.5Z"/></svg>',
  barons: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8 6 3l2 4 4-5 4 5 2-4 3 5-2 10-7 4-7-4L3 8Zm4.2 2 1 5 3.8 2.2 3.8-2.2 1-5-2.3 1.5L12 7.8l-2.5 3.7L7.2 10Z"/></svg>',
  inhibitors: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l3 4-2 2v12H7V9L5 7l3-4Zm1.2 4h5.6l-1.3-2h-3L9.2 7ZM10 10v8h4v-8h-4Z"/></svg>',
  kills: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 4 6 6 6-6 2 2-6 6 6 6-2 2-6-6-6 6-2-2 6-6-6-6 2-2Z"/></svg>',
  gold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c4.4 0 8 1.8 8 4s-3.6 4-8 4-8-1.8-8-4 3.6-4 8-4Zm-8 8.2c1.7 1.2 4.6 1.8 8 1.8s6.3-.6 8-1.8V15c0 2.2-3.6 4-8 4s-8-1.8-8-4v-3.8Zm0 6c1.7 1.2 4.6 1.8 8 1.8s6.3-.6 8-1.8V19c0 2.2-3.6 4-8 4s-8-1.8-8-4v-1.8Z"/></svg>',
  top: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v4H8v12H4V4Zm8 8h8v8h-8v-8Z"/></svg>',
  jungle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20c4-6 4-11 1-16 6 3 8 8 7 14 2-5 4-8 8-10-1 7-6 12-16 12Z"/></svg>',
  mid: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18 18 4h2v2L6 20H4v-2ZM4 4h7v3H7v4H4V4Zm9 13h4v-4h3v7h-7v-3Z"/></svg>',
  bottom: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h4v12h12v4H4V4Zm8 4h8v8h-8V8Z"/></svg>',
  support: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2h4v5h5v4h-5v11h-4V11H5V7h5V2Z"/></svg>'
};

function escapeHtml(value: unknown): string { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }
function formatNumber(value: number | null): string { return value === null ? '—' : value.toLocaleString(); }
function formatCompact(value: number | null): string { if (value === null) return '—'; return Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString(); }
function formatClock(seconds: number | null): string { if (seconds === null) return '--:--'; const safe = Math.max(0, Math.floor(seconds)); return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`; }
function canonicalRole(value: string | null): CanonicalRole | null { const role = value?.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ') ?? ''; if (role.includes('top')) return 'top'; if (role.includes('jung')) return 'jungle'; if (role.includes('mid')) return 'mid'; if (role.includes('bot') || role.includes('adc') || role.includes('carry')) return 'bottom'; if (role.includes('sup') || role.includes('utility')) return 'support'; return null; }
function orderedPlayers(team: LolTeamState): readonly (LolPlayerState | null)[] { const assigned = new Map<CanonicalRole, LolPlayerState>(); const unassigned: LolPlayerState[] = []; for (const player of team.players) { const role = canonicalRole(player.role); if (role && !assigned.has(role)) assigned.set(role, player); else unassigned.push(player); } return ROLE_ORDER.map(role => assigned.get(role) ?? unassigned.shift() ?? null); }
function kda(player: LolPlayerState | null): string { return player ? `${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)}` : '—/—/—'; }
function initials(name: string): string { return name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?'; }
function teamLogo(name: string, imageUrl?: string): string { return imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} logo" />` : `<span aria-hidden="true">${escapeHtml(initials(name))}</span>`; }
function objectiveValue(team: LolTeamState, key: ObjectiveKey): number | null { return key === 'dragons' ? (team.objectives.dragons === null ? null : team.objectives.dragons.length) : team.objectives[key]; }
function objectiveStrip(blue: LolTeamState, red: LolTeamState): string { return (Object.keys(OBJECTIVE_LABELS) as ObjectiveKey[]).map(key => `<div class="v2-objective ${key}"><span class="v2-objective-icon">${ICONS[key]}</span><span class="v2-objective-label">${OBJECTIVE_LABELS[key]}</span><span class="v2-objective-score"><strong class="blue">${formatNumber(objectiveValue(blue, key))}</strong><i aria-hidden="true"></i><strong class="red">${formatNumber(objectiveValue(red, key))}</strong></span></div>`).join(''); }
function playerCell(player: LolPlayerState | null, role: CanonicalRole, side: 'blue' | 'red'): string { const name = player?.handle ?? 'Player unavailable'; const champion = player?.championId ?? 'Champion unavailable'; return `<div class="v2-player ${side}"><span class="v2-player-role" title="${ROLE_LABELS[role]}">${ICONS[role]}</span><span class="v2-champion" aria-hidden="true">${escapeHtml(initials(champion))}</span><span class="v2-player-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(champion)}</small></span><span class="v2-player-stat"><small>KDA</small><strong>${kda(player)}</strong></span><span class="v2-player-stat"><small>CS</small><strong>${formatNumber(player?.creepScore ?? null)}</strong></span><span class="v2-player-stat"><small>GOLD</small><strong>${formatCompact(player?.totalGold ?? null)}</strong></span></div>`; }
function matchupRows(blue: LolTeamState, red: LolTeamState): string { const bluePlayers = orderedPlayers(blue); const redPlayers = orderedPlayers(red); return ROLE_ORDER.map((role, index) => `<div class="v2-matchup-row">${playerCell(bluePlayers[index] ?? null, role, 'blue')}<span class="v2-lane-icon" title="${ROLE_LABELS[role]}">${ICONS[role]}</span>${playerCell(redPlayers[index] ?? null, role, 'red')}</div>`).join(''); }

function render(snapshot: LiveSnapshot<LolStats>): void {
  if (!gameContent || !snapshot.stats) return;
  const stats = snapshot.stats;
  const blueRef = snapshot.series.teams.find(team => team.id === stats.blue.id);
  const redRef = snapshot.series.teams.find(team => team.id === stats.red.id);
  const goldDifference = stats.blue.gold === null || stats.red.gold === null ? null : stats.blue.gold - stats.red.gold;
  const leader = goldDifference === null ? 'Gold unavailable' : goldDifference === 0 ? 'Gold even' : `${goldDifference > 0 ? stats.blue.name : stats.red.name} +${formatCompact(Math.abs(goldDifference))}`;
  workspace?.classList.add('dashboard-v2-active');
  if (platformPanel) platformPanel.hidden = true;
  gameContent.innerHTML = `<section class="live-dashboard-v2" data-live-dashboard-game-id="${escapeHtml(snapshot.game.id)}"><header class="v2-hero"><div class="v2-team blue"><span class="v2-team-logo">${teamLogo(stats.blue.name, blueRef?.imageUrl)}</span><span class="v2-team-copy"><small>BLUE SIDE</small><strong>${escapeHtml(stats.blue.name)}</strong></span><span class="v2-team-kills">${formatNumber(stats.blue.kills)}</span></div><div class="v2-clock"><small>GAME ${snapshot.game.number}</small><strong id="live-game-clock">${formatClock(stats.gameClockSeconds)}</strong><span><i></i> LIVE</span></div><div class="v2-team red"><span class="v2-team-kills">${formatNumber(stats.red.kills)}</span><span class="v2-team-copy"><small>RED SIDE</small><strong>${escapeHtml(stats.red.name)}</strong></span><span class="v2-team-logo">${teamLogo(stats.red.name, redRef?.imageUrl)}</span></div></header><div class="v2-summary-row"><article class="v2-gold-card"><span>GOLD LEAD</span><strong class="${goldDifference === null ? 'neutral' : goldDifference >= 0 ? 'blue' : 'red'}">${escapeHtml(leader)}</strong><div class="v2-gold-bars" aria-label="Team gold comparison"><i class="blue"></i><i class="red"></i></div><small>${formatCompact(stats.blue.gold)} vs ${formatCompact(stats.red.gold)}</small></article><article class="v2-objectives-card"><span class="v2-card-title">OBJECTIVES</span><div class="v2-objective-grid">${objectiveStrip(stats.blue, stats.red)}</div></article></div><section class="v2-board"><nav class="v2-board-tabs" aria-label="Live board views"><button type="button" class="active">LIVE BOARD</button><button type="button" disabled>GOLD GRAPHS</button><button type="button" disabled>XP GRAPH</button><button type="button" disabled>VISION CONTROL</button><button type="button" disabled>PLAYER STATS</button></nav><div class="v2-board-head"><strong>${escapeHtml(stats.blue.name)}</strong><span class="blue">${ICONS.kills}${formatNumber(stats.blue.kills)} ${ICONS.gold}${formatCompact(stats.blue.gold)}</span><span class="red">${ICONS.gold}${formatCompact(stats.red.gold)} ${ICONS.kills}${formatNumber(stats.red.kills)}</span><strong>${escapeHtml(stats.red.name)}</strong></div><div class="v2-matchups">${matchupRows(stats.blue, stats.red)}</div></section><footer class="v2-footer"><span>${escapeHtml(stats.patch ? `Patch ${stats.patch}` : 'Patch unavailable')}</span><i></i><span>Summoner's Rift</span><i></i><span>Best of ${snapshot.series.bestOf} · Game ${snapshot.game.number}</span><em>LIVE</em></footer></section>`;
}

window.addEventListener('esports-live:snapshot', event => { const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail; if (snapshot?.stats) queueMicrotask(() => render(snapshot)); });
window.addEventListener('esports-live:selection', () => { workspace?.classList.add('dashboard-v2-active'); if (platformPanel) platformPanel.hidden = true; });
