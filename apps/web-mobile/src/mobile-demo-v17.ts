import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

type Role = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';
type Side = 'blue' | 'red';

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const gameContent = document.querySelector<HTMLElement>('#game-content');
const ROLE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const ROLE_LABELS: Record<Role, string> = {
  top: 'Top',
  jungle: 'Jungle',
  mid: 'Mid',
  bottom: 'Bottom',
  support: 'Support'
};

let latestSnapshot: LiveSnapshot<LolStats> | null = null;
let renderQueued = false;
let rendering = false;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active:not([data-mobile-context="history"]) #game-content>.mobile-live-history-board.mobile-final-recovery{
    display:grid!important;
    gap:0!important;
    width:calc(100% + 18px)!important;
    max-width:none!important;
    margin-right:-9px!important;
    margin-left:-9px!important;
    justify-self:center!important;
    padding:0!important;
    overflow:hidden!important;
    border:0!important;
    border-radius:0!important;
    background:transparent!important;
    box-shadow:none!important
  }

  body.mobile-demo-active .mobile-live-history-board .completed-final-game-header{
    min-height:34px!important;
    padding:4px 4px 9px!important;
    border:0!important;
    background:transparent!important
  }
  body.mobile-demo-active .mobile-live-history-board .completed-final-game-header strong{
    font-size:.76rem!important;
    line-height:1.2!important
  }
  body.mobile-demo-active .mobile-live-history-board .completed-final-game-header span{
    font-size:.55rem!important
  }

  body.mobile-demo-active .mobile-live-history-board .mobile-completed-team-names{
    grid-template-columns:minmax(0,1fr) 86px minmax(0,1fr)!important;
    gap:8px!important;
    min-height:88px!important;
    padding:13px 10px!important;
    border:0!important;
    border-radius:0!important;
    background:
      linear-gradient(90deg,rgba(14,165,233,.14),transparent 43%,transparent 57%,rgba(244,63,94,.14)),
      rgba(2,6,23,.54)!important
  }

  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objectives{
    gap:7px!important;
    margin:0!important;
    padding:11px 4px!important;
    border:0!important;
    border-radius:0!important;
    background:rgba(2,6,23,.30)!important
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objectives-title{
    font-size:.60rem!important
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objective>span{
    font-size:.56rem!important
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objective strong{
    font-size:.74rem!important
  }

  body.mobile-demo-active .mobile-live-history-board .completed-final-matchups{
    overflow:hidden!important;
    border:0!important;
    border-radius:0!important;
    background:transparent!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-matchup-row{
    display:grid!important;
    grid-template-columns:minmax(0,1fr) 64px minmax(0,1fr)!important;
    min-height:66px!important;
    border:0!important;
    border-bottom:1px solid rgba(148,163,184,.10)!important;
    background:transparent!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-matchup-row:last-child{
    border-bottom:0!important
  }

  body.mobile-demo-active .mobile-live-history-board .role-player,
  body.mobile-demo-active .mobile-live-history-board .role-player.red{
    display:grid!important;
    grid-template-areas:"portrait heading" "portrait stats"!important;
    grid-template-columns:38px minmax(0,1fr)!important;
    grid-template-rows:auto auto!important;
    align-items:center!important;
    gap:3px 7px!important;
    min-width:0!important;
    padding:10px 8px!important;
    border:0!important;
    background:transparent!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player.red{
    grid-template-areas:"heading portrait" "stats portrait"!important;
    grid-template-columns:minmax(0,1fr) 38px!important;
    text-align:right!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-portrait{
    grid-area:portrait!important;
    display:grid!important;
    place-items:center!important;
    width:38px!important;
    height:38px!important;
    overflow:hidden!important;
    flex:0 0 38px!important;
    border:1px solid rgba(148,163,184,.18)!important;
    border-radius:9px!important;
    background:rgba(8,17,31,.96)!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-portrait .mobile-completed-champion{
    display:block!important;
    width:100%!important;
    height:100%!important;
    border:0!important;
    border-radius:inherit!important;
    object-fit:cover!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-heading{
    grid-area:heading!important;
    min-width:0!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-name strong{
    display:block!important;
    overflow:hidden!important;
    color:#f1f5f9!important;
    font-size:.68rem!important;
    line-height:1.12!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-name small,
  body.mobile-demo-active .mobile-live-history-board .role-chip,
  body.mobile-demo-active .mobile-live-history-board .role-gold-delta small{
    display:none!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-stats{
    grid-area:stats!important;
    display:block!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-stats>span:not(:first-child){
    display:none!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player-stats strong{
    color:#d6dfec!important;
    font-size:.58rem!important;
    line-height:1.1!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-player.red .role-player-stats{
    text-align:right!important
  }

  body.mobile-demo-active .mobile-live-history-board .role-gold-delta{
    display:grid!important;
    place-items:center!important;
    min-width:60px!important;
    min-height:34px!important;
    margin:auto 2px!important;
    padding:6px 3px!important;
    border:0!important;
    border-radius:0!important;
    background:transparent!important;
    font-size:.74rem!important;
    font-weight:950!important;
    font-variant-numeric:tabular-nums!important;
    line-height:1!important;
    letter-spacing:-.015em!important;
    text-align:center!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-gold-delta strong{
    font-size:.74rem!important;
    font-weight:950!important;
    line-height:1!important
  }
  body.mobile-demo-active .mobile-live-history-board .role-gold-delta.blue strong{color:#38bdf8!important}
  body.mobile-demo-active .mobile-live-history-board .role-gold-delta.red strong{color:#fb7185!important}
  body.mobile-demo-active .mobile-live-history-board .role-gold-delta.even strong,
  body.mobile-demo-active .mobile-live-history-board .role-gold-delta.unknown strong{color:#a5b4c8!important}
}
`;
document.head.append(style);

function esc(value: unknown): string {
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

function roleOf(value: string | null): Role | null {
  const role = value?.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ') ?? '';
  if (role.includes('top')) return 'top';
  if (role.includes('jung')) return 'jungle';
  if (role.includes('mid')) return 'mid';
  if (role.includes('bot') || role.includes('adc') || role.includes('carry')) return 'bottom';
  if (role.includes('sup') || role.includes('utility')) return 'support';
  return null;
}

function orderedPlayers(team: LolTeamState): readonly (LolPlayerState | null)[] {
  const assigned = new Map<Role, LolPlayerState>();
  const extras: LolPlayerState[] = [];
  for (const player of team.players) {
    const role = roleOf(player.role);
    if (role && !assigned.has(role)) assigned.set(role, player);
    else extras.push(player);
  }
  return ROLE_ORDER.map(role => assigned.get(role) ?? extras.shift() ?? null);
}

function playerMarkup(player: LolPlayerState | null, role: Role, side: Side): string {
  const name = player?.handle ?? 'Player unavailable';
  const champion = player?.championId ?? 'Champion unavailable';
  return `<div class="role-player ${side}">
    <span class="role-player-portrait"><span class="telemetry-champion" aria-hidden="true">?</span></span>
    <div class="role-player-heading">
      <span class="role-chip">${ROLE_LABELS[role]}</span>
      <div class="role-player-name"><strong title="${esc(name)}">${esc(name)}</strong><small>${esc(champion)}</small></div>
    </div>
    <div class="role-player-stats">
      <span><small>KDA</small><strong>${formatNumber(player?.kills ?? null)}/${formatNumber(player?.deaths ?? null)}/${formatNumber(player?.assists ?? null)}</strong></span>
      <span><small>CS</small><strong>${formatNumber(player?.creepScore ?? null)}</strong></span>
      <span><small>GOLD</small><strong>${formatNumber(player?.totalGold ?? null)}</strong></span>
    </div>
  </div>`;
}

function deltaMarkup(blue: LolPlayerState | null, red: LolPlayerState | null, role: Role): string {
  const blueGold = blue?.totalGold ?? null;
  const redGold = red?.totalGold ?? null;
  const difference = blueGold === null || redGold === null ? null : blueGold - redGold;
  const side = difference === null ? 'unknown' : difference > 0 ? 'blue' : difference < 0 ? 'red' : 'even';
  const value = difference === null ? '—' : difference === 0 ? 'EVEN' : `+${Math.abs(difference).toLocaleString()}`;
  const label = difference === null
    ? `${ROLE_LABELS[role]} gold difference unavailable`
    : difference === 0
      ? `${ROLE_LABELS[role]} gold is even`
      : `${difference > 0 ? 'Blue' : 'Red'} ${ROLE_LABELS[role]} leads by ${Math.abs(difference).toLocaleString()} gold`;
  return `<div class="role-gold-delta ${side}" title="${esc(label)}" aria-label="${esc(label)}"><small>${ROLE_LABELS[role]} GOLD Δ</small><strong>${value}</strong></div>`;
}

function matchupRows(blue: LolTeamState, red: LolTeamState): string {
  const bluePlayers = orderedPlayers(blue);
  const redPlayers = orderedPlayers(red);
  return ROLE_ORDER.map((role, index) => {
    const left = bluePlayers[index] ?? null;
    const right = redPlayers[index] ?? null;
    return `<div class="role-matchup-row" data-role="${role}">
      ${playerMarkup(left, role, 'blue')}
      ${deltaMarkup(left, right, role)}
      ${playerMarkup(right, role, 'red')}
    </div>`;
  }).join('');
}

function boardMarkup(snapshot: LiveSnapshot<LolStats>): string {
  const stats = snapshot.stats!;
  const status = snapshot.game.state === 'paused' ? 'Paused' : 'Live';
  return `<article class="completed-final-game mobile-final-recovery mobile-live-history-board" data-final-game-id="${esc(snapshot.game.id)}" data-live-dashboard-game-id="${esc(snapshot.game.id)}" data-mobile-unified-game-id="${esc(snapshot.game.id)}" data-mobile-scoreboard-version="0.17">
    <div class="completed-final-game-header"><strong>Game ${snapshot.game.number} · ${status}</strong><span id="live-game-clock">${formatClock(stats.gameClockSeconds)}</span></div>
    <div class="role-matchup-list completed-final-matchups">${matchupRows(stats.blue, stats.red)}</div>
  </article>`;
}

function liveModeActive(): boolean {
  return media.matches
    && body.dataset.mobileView === 'live'
    && body.dataset.mobileContext !== 'history';
}

function renderLiveBoard(): void {
  renderQueued = false;
  const snapshot = latestSnapshot;
  if (!gameContent || !snapshot?.stats || !liveModeActive()) return;
  const key = `${snapshot.game.id}|${snapshot.quality.sourceTimestamp ?? snapshot.quality.observedAt}`;
  const existing = gameContent.querySelector<HTMLElement>('.mobile-live-history-board[data-mobile-scoreboard-version="0.17"]');
  if (existing?.dataset.mobileRenderKey === key) return;

  rendering = true;
  gameContent.innerHTML = boardMarkup(snapshot);
  const board = gameContent.querySelector<HTMLElement>('.mobile-live-history-board[data-mobile-scoreboard-version="0.17"]');
  if (board) {
    board.dataset.mobileRenderKey = key;
    window.dispatchEvent(new CustomEvent('esports-live:ended-snapshot', {
      detail: { snapshot, root: board }
    }));
  }
  rendering = false;
}

function queueLiveBoard(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(renderLiveBoard);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.stats) return;
  latestSnapshot = snapshot;
  queueLiveBoard();
});

window.addEventListener('esports-live:selection', () => {
  if (liveModeActive()) queueLiveBoard();
});
window.addEventListener('pageshow', queueLiveBoard);

if (gameContent) {
  new MutationObserver(() => {
    if (rendering || !latestSnapshot?.stats || !liveModeActive()) return;
    if (!gameContent.querySelector('.mobile-live-history-board[data-mobile-scoreboard-version="0.17"]')) queueLiveBoard();
  }).observe(gameContent, { childList: true });
}

if (typeof media.addEventListener === 'function') media.addEventListener('change', () => {
  if (media.matches) queueLiveBoard();
});
else if (typeof media.addListener === 'function') media.addListener(() => {
  if (media.matches) queueLiveBoard();
});

const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
if (nav) nav.dataset.mobileNavVersion = '0.17';

export {};
