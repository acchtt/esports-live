import type { LiveSnapshot, ScheduleEvent } from '@esports-live/core';
import type { LolPlayerState, LolStats } from '@esports-live/adapter-lol';

type Role = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';
type Side = 'blue' | 'red';
type BoardState = 'verified' | 'stale' | 'pending';

interface BoardObjectives {
  towers: number | null;
  dragons: number | null;
  barons: number | null;
  inhibitors: number | null;
}

interface BoardTeam {
  id: string;
  name: string;
  side: Side;
  gold: number | null;
  kills: number | null;
  objectives: BoardObjectives;
  players: readonly LolPlayerState[];
}

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const gameContent = document.querySelector<HTMLElement>('#game-content');
const appFrame = document.querySelector<HTMLElement>('.app-frame');
const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
const ROLE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const ROLE_LABELS: Record<Role, string> = {
  top: 'Top',
  jungle: 'Jungle',
  mid: 'Mid',
  bottom: 'Bottom',
  support: 'Support'
};
const OBJECTIVE_LABELS: ReadonlyArray<[keyof BoardObjectives, string]> = [
  ['towers', 'Towers'],
  ['dragons', 'Dragons'],
  ['barons', 'Barons'],
  ['inhibitors', 'Inhibitors']
];

let selection: ScheduleEvent | null = null;
let latestSnapshot: LiveSnapshot<LolStats> | null = null;
let renderQueued = false;
let rendering = false;
const verifiedSnapshots = new Map<string, LiveSnapshot<LolStats>>();

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active{
    padding-bottom:calc(84px + env(safe-area-inset-bottom))!important
  }

  body.mobile-demo-active:not([data-mobile-context="history"]) #game-content>.mobile-live-history-board[data-mobile-history-copy="true"]{
    display:grid!important;
    gap:0!important;
    width:calc(100% + 18px)!important;
    max-width:none!important;
    margin:0 -9px!important;
    justify-self:center!important;
    padding:0!important;
    overflow:hidden!important;
    border:0!important;
    border-radius:0!important;
    background:transparent!important;
    box-shadow:none!important
  }

  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .completed-final-game-header{
    min-height:34px!important;
    padding:5px 10px 8px!important
  }

  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .completed-team-comparison.completed-history-dashboard-v2{
    display:grid!important;
    gap:0!important;
    min-width:0!important;
    padding:0!important;
    overflow:hidden!important;
    border:0!important;
    border-radius:0!important;
    background:
      linear-gradient(90deg,rgba(14,165,233,.08),transparent 42%,transparent 58%,rgba(244,63,94,.08)),
      rgba(2,6,23,.42)!important;
    box-shadow:none!important
  }

  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-team-header,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-summary,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-objectives{
    width:100%!important;
    min-width:0!important
  }

  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-team-header{
    grid-template-columns:minmax(0,1fr) 58px minmax(0,1fr)!important;
    gap:7px!important;
    min-height:58px!important;
    padding:8px 10px!important;
    border-bottom:1px solid rgba(148,163,184,.10)!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-team span{
    font-size:.45rem!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-team strong{
    font-size:.72rem!important;
    line-height:1.12!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-final{
    display:grid!important;
    place-items:center!important;
    min-width:54px!important;
    min-height:25px!important;
    padding:3px 6px!important;
    font-size:.47rem!important;
    text-align:center!important
  }

  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-summary{
    grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr)!important;
    gap:6px!important;
    padding:7px 8px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-gold-card,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-quick-stats{
    min-height:64px!important;
    border-radius:8px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-gold-card{
    gap:3px!important;
    padding:8px 9px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-gold-card>span,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-quick-stats span{
    font-size:.43rem!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-gold-card>strong{
    font-size:.82rem!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-gold-card>small{
    font-size:.52rem!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-quick-stats>div{
    gap:3px!important;
    padding:7px 4px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-quick-stats strong{
    font-size:.72rem!important
  }

  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-objectives.mobile-completed-objectives{
    min-height:76px!important;
    margin:0!important;
    padding:7px 8px 8px!important;
    border-radius:0!important;
    background:rgba(2,6,23,.24)!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-objective-title{
    width:min(180px,58%)!important;
    margin-bottom:2px!important;
    font-size:.46rem!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-objective-hud{
    grid-template-columns:minmax(0,1fr) 10px minmax(0,1fr)!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-objective-side{
    grid-template-columns:repeat(4,minmax(0,1fr))!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-objective-stat{
    gap:2px!important;
    min-height:42px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-objective-label{
    overflow:hidden!important;
    width:100%!important;
    font-size:.40rem!important;
    text-align:center!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-objective-stat strong{
    font-size:.68rem!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .history-v2-objective-center{
    height:30px!important
  }

  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .mobile-live-board-notice{
    display:flex!important;
    align-items:center!important;
    gap:6px!important;
    min-height:32px!important;
    padding:6px 10px!important;
    border-top:1px solid rgba(148,163,184,.08)!important;
    border-bottom:1px solid rgba(148,163,184,.08)!important;
    color:#9eacc0!important;
    background:rgba(15,23,42,.52)!important;
    font-size:.51rem!important;
    font-weight:750!important;
    line-height:1.25!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .mobile-live-board-notice:before{
    width:6px!important;
    height:6px!important;
    flex:0 0 6px!important;
    border-radius:50%!important;
    background:#f59e0b!important;
    box-shadow:0 0 0 3px rgba(245,158,11,.10)!important;
    content:""!important
  }

  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .completed-final-matchups{
    overflow:hidden!important;
    border:0!important;
    border-radius:0!important;
    background:transparent!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-matchup-row{
    grid-template-columns:minmax(0,1fr) 64px minmax(0,1fr)!important;
    min-height:88px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player.red{
    grid-template-columns:38px minmax(0,1fr)!important;
    grid-template-rows:auto auto 17px!important;
    grid-template-areas:
      "portrait heading"
      "portrait stats"
      "items items"!important;
    gap:2px 6px!important;
    min-width:0!important;
    min-height:88px!important;
    padding:8px 6px!important;
    overflow:hidden!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player.red{
    grid-template-columns:minmax(0,1fr) 38px!important;
    grid-template-areas:
      "heading portrait"
      "stats portrait"
      "items items"!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-name strong{
    display:block!important;
    overflow:hidden!important;
    width:100%!important;
    color:#f1f5f9!important;
    font-size:.66rem!important;
    line-height:1.12!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-stats{
    display:block!important;
    overflow:hidden!important;
    width:100%!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-stats>span:first-child{
    display:block!important;
    width:100%!important;
    padding:0!important;
    border:0!important;
    background:transparent!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-stats>span:not(:first-child),
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-chip,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-name small,
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-stats small{
    display:none!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-stats strong{
    display:block!important;
    overflow:hidden!important;
    font-size:.56rem!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player.red .role-player-stats{
    text-align:right!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-items{
    display:block!important;
    width:100%!important;
    min-width:0!important;
    overflow:hidden!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-items .telemetry-inventory{
    display:flex!important;
    align-items:center!important;
    justify-content:flex-start!important;
    gap:2px!important;
    width:100%!important;
    min-width:0!important;
    min-height:15px!important;
    padding:0!important;
    overflow:hidden!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player.red .role-player-items .telemetry-inventory{
    justify-content:flex-end!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-items .telemetry-inventory-label{
    display:none!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-player-items .telemetry-item-slot{
    width:15px!important;
    height:15px!important;
    flex:0 0 15px!important;
    border-radius:3px!important
  }
  body.mobile-demo-active .mobile-live-history-board[data-mobile-history-copy="true"] .role-gold-delta{
    min-width:60px!important;
    margin:auto 2px!important
  }

  body.mobile-demo-active .mobile-app-nav{
    right:auto!important;
    left:var(--mobile-nav-left,8px)!important;
    bottom:calc(8px + env(safe-area-inset-bottom))!important;
    width:var(--mobile-nav-width,calc(100vw - 16px))!important;
    max-width:none!important;
    min-height:60px!important;
    box-sizing:border-box!important;
    padding:5px!important;
    overflow:hidden!important;
    border:1px solid rgba(112,151,196,.24)!important;
    border-radius:17px!important;
    background:rgba(7,16,30,.97)!important;
    box-shadow:0 16px 42px rgba(0,0,0,.42)!important;
    transform:none!important
  }
  body.mobile-demo-active .mobile-app-nav button{
    width:100%!important;
    min-width:0!important;
    min-height:48px!important;
    margin:0!important;
    padding:4px!important;
    border-radius:12px!important
  }
  body.mobile-demo-active .mobile-app-nav button.active{
    color:#d7f3ff!important;
    background:linear-gradient(180deg,rgba(56,189,248,.18),rgba(56,189,248,.07))!important;
    box-shadow:inset 0 0 0 1px rgba(56,189,248,.28)!important
  }
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

function number(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function compact(value: number | null): string {
  if (value === null) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${Math.round(absolute / 1_000)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
}

function clock(seconds: number | null): string {
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

function orderedPlayers(team: BoardTeam): readonly (LolPlayerState | null)[] {
  const assigned = new Map<Role, LolPlayerState>();
  const extras: LolPlayerState[] = [];
  for (const player of team.players) {
    const role = roleOf(player.role);
    if (role && !assigned.has(role)) assigned.set(role, player);
    else extras.push(player);
  }
  return ROLE_ORDER.map(role => assigned.get(role) ?? extras.shift() ?? null);
}

function emptyInventory(): string {
  return `<div class="role-player-items"><div class="telemetry-inventory"><span class="telemetry-inventory-label">BUILD</span>${Array.from({ length: 7 }, () => '<span class="telemetry-item-slot empty" aria-hidden="true"></span>').join('')}</div></div>`;
}

function portraitPlaceholder(champion: string): string {
  const initials = champion.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase() ?? '').join('') || '?';
  return `<div class="role-player-portrait"><div class="telemetry-champion"><span class="telemetry-champion-fallback">${esc(initials)}</span></div></div>`;
}

function playerMarkup(player: LolPlayerState | null, role: Role, side: Side): string {
  const name = player?.handle ?? 'Player unavailable';
  const champion = player?.championId ?? 'Champion unavailable';
  return `<div class="role-player ${side}">
    ${portraitPlaceholder(champion)}
    <div class="role-player-heading">
      <span class="role-chip">${ROLE_LABELS[role]}</span>
      <div class="role-player-name"><strong title="${esc(name)}">${esc(name)}</strong><small>${esc(champion)}</small></div>
    </div>
    <div class="role-player-stats">
      <span><small>KDA</small><strong>${number(player?.kills ?? null)}/${number(player?.deaths ?? null)}/${number(player?.assists ?? null)}</strong></span>
      <span><small>CS</small><strong>${number(player?.creepScore ?? null)}</strong></span>
      <span><small>GOLD</small><strong>${number(player?.totalGold ?? null)}</strong></span>
    </div>
    ${emptyInventory()}
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

function matchupRows(blue: BoardTeam, red: BoardTeam): string {
  const left = orderedPlayers(blue);
  const right = orderedPlayers(red);
  return ROLE_ORDER.map((role, index) => `<div class="role-matchup-row" data-role="${role}">
    ${playerMarkup(left[index] ?? null, role, 'blue')}
    ${deltaMarkup(left[index] ?? null, right[index] ?? null, role)}
    ${playerMarkup(right[index] ?? null, role, 'red')}
  </div>`).join('');
}

function objectiveSide(side: Side, values: BoardObjectives): string {
  return `<div class="history-v2-objective-side ${side}" aria-label="${side === 'blue' ? 'Blue' : 'Red'} team objectives">
    ${OBJECTIVE_LABELS.map(([key, label]) => `<div class="history-v2-objective-stat objective-${key}" aria-label="${label}: ${number(values[key])}"><span class="history-v2-objective-label">${label}</span><strong>${number(values[key])}</strong></div>`).join('')}
  </div>`;
}

function teamFromStats(stats: LolStats, side: Side): BoardTeam {
  const team = stats[side];
  return {
    id: team.id,
    name: team.name,
    side,
    gold: team.gold,
    kills: team.kills,
    objectives: {
      towers: team.objectives.towers,
      dragons: team.objectives.dragons?.length ?? null,
      barons: team.objectives.barons,
      inhibitors: team.objectives.inhibitors
    },
    players: team.players
  };
}

function pendingTeam(side: Side): BoardTeam {
  const fallback = side === 'blue' ? 'Blue team' : 'Red team';
  const team = selection?.series.teams[side === 'blue' ? 0 : 1];
  return {
    id: team?.id ?? side,
    name: team?.name ?? fallback,
    side,
    gold: null,
    kills: null,
    objectives: { towers: null, dragons: null, barons: null, inhibitors: null },
    players: []
  };
}

function goldSummary(blue: BoardTeam, red: BoardTeam): { className: string; leader: string; pair: string } {
  if (blue.gold === null || red.gold === null) return { className: 'neutral', leader: 'Gold unavailable', pair: '— vs —' };
  const difference = blue.gold - red.gold;
  const leader = difference === 0 ? 'Gold even' : `${difference > 0 ? blue.name : red.name} +${compact(Math.abs(difference))}`;
  return {
    className: difference === 0 ? 'neutral' : difference > 0 ? 'blue' : 'red',
    leader,
    pair: `${compact(blue.gold)} vs ${compact(red.gold)}`
  };
}

function selectedGame(): ScheduleEvent['series']['games'][number] | null {
  const games = selection?.series.games ?? [];
  return games.find(game => game.state === 'live')
    ?? games.find(game => game.state === 'draft')
    ?? games.find(game => game.state === 'unstarted' || game.state === 'unknown')
    ?? games[0]
    ?? null;
}

function liveModeActive(): boolean {
  return media.matches
    && body.dataset.mobileView === 'live'
    && body.dataset.mobileContext !== 'history';
}

function boardInput(): {
  gameId: string;
  gameNumber: number;
  clock: number | null;
  blue: BoardTeam;
  red: BoardTeam;
  state: BoardState;
  notice: string | null;
  sourceSnapshot: LiveSnapshot<LolStats> | null;
} | null {
  const selected = selectedGame();
  const selectedId = selected?.id ?? latestSnapshot?.game.id ?? null;
  if (!selectedId) return null;

  const current = latestSnapshot?.game.id === selectedId ? latestSnapshot : null;
  if (current?.stats) {
    verifiedSnapshots.set(selectedId, current);
    return {
      gameId: selectedId,
      gameNumber: current.game.number,
      clock: current.stats.gameClockSeconds,
      blue: teamFromStats(current.stats, 'blue'),
      red: teamFromStats(current.stats, 'red'),
      state: 'verified',
      notice: null,
      sourceSnapshot: current
    };
  }

  const verified = verifiedSnapshots.get(selectedId) ?? null;
  if (verified?.stats) {
    const reason = current?.quality.reasons.map(item => item.message).filter(Boolean).join(' ')
      || 'The latest verified board is being kept visible while live telemetry refreshes.';
    return {
      gameId: selectedId,
      gameNumber: verified.game.number,
      clock: verified.stats.gameClockSeconds,
      blue: teamFromStats(verified.stats, 'blue'),
      red: teamFromStats(verified.stats, 'red'),
      state: 'stale',
      notice: reason,
      sourceSnapshot: verified
    };
  }

  const reason = current?.quality.reasons.map(item => item.message).filter(Boolean).join(' ')
    || 'Waiting for Riot to publish the first verified gameplay frame. The history board will fill automatically.';
  return {
    gameId: selectedId,
    gameNumber: selected?.number ?? current?.game.number ?? 1,
    clock: null,
    blue: pendingTeam('blue'),
    red: pendingTeam('red'),
    state: 'pending',
    notice: reason,
    sourceSnapshot: null
  };
}

function boardMarkup(input: NonNullable<ReturnType<typeof boardInput>>): string {
  const gold = goldSummary(input.blue, input.red);
  const centerLabel = input.state === 'verified' ? 'LIVE' : input.state === 'stale' ? 'UPDATING' : 'PENDING';
  const headerState = input.state === 'verified' ? 'Live' : input.state === 'stale' ? 'Last verified' : 'Telemetry pending';
  return `<article class="completed-final-game mobile-final-recovery mobile-live-history-board" data-final-game-id="${esc(input.gameId)}" data-live-dashboard-game-id="${esc(input.gameId)}" data-live-history-game-id="${esc(input.gameId)}" data-mobile-unified-game-id="${esc(input.gameId)}" data-mobile-scoreboard-version="0.17" data-mobile-history-copy="true" data-live-board-state="${input.state}">
    <div class="completed-final-game-header"><strong>Game ${input.gameNumber} · ${headerState}</strong><span id="live-game-clock">${clock(input.clock)}</span></div>
    <section class="completed-team-comparison completed-history-dashboard-v2 objective-text-only" data-history-dashboard-v2="true">
      <header class="history-v2-team-header mobile-completed-team-names">
        <div class="history-v2-team blue"><span>BLUE SIDE</span><strong title="${esc(input.blue.name)}">${esc(input.blue.name)}</strong></div>
        <div class="history-v2-final">${centerLabel}</div>
        <div class="history-v2-team red"><span>RED SIDE</span><strong title="${esc(input.red.name)}">${esc(input.red.name)}</strong></div>
      </header>
      <div class="history-v2-summary">
        <article class="history-v2-gold-card"><span>GOLD LEAD</span><strong class="${gold.className}">${esc(gold.leader)}</strong><small>${gold.pair}</small></article>
        <article class="history-v2-quick-stats">
          <div><span>KILLS</span><strong class="blue">${number(input.blue.kills)}</strong><i>–</i><strong class="red">${number(input.red.kills)}</strong></div>
          <div><span>TOWERS</span><strong class="blue">${number(input.blue.objectives.towers)}</strong><i>–</i><strong class="red">${number(input.red.objectives.towers)}</strong></div>
        </article>
      </div>
      <section class="history-v2-objectives mobile-completed-objectives" aria-label="Objective counts">
        <div class="history-v2-objective-title"><i></i><span>OBJECTIVES</span><i></i></div>
        <div class="history-v2-objective-hud">${objectiveSide('blue', input.blue.objectives)}<span class="history-v2-objective-center" aria-hidden="true"></span>${objectiveSide('red', input.red.objectives)}</div>
      </section>
    </section>
    ${input.notice ? `<div class="mobile-live-board-notice" role="status">${esc(input.notice)}</div>` : ''}
    <div class="role-matchup-list completed-final-matchups">${matchupRows(input.blue, input.red)}</div>
  </article>`;
}

function renderLiveBoard(): void {
  renderQueued = false;
  if (!gameContent || !liveModeActive()) return;
  const input = boardInput();
  if (!input) return;
  const key = JSON.stringify({
    gameId: input.gameId,
    state: input.state,
    timestamp: input.sourceSnapshot?.quality.sourceTimestamp ?? input.sourceSnapshot?.quality.observedAt ?? null,
    notice: input.notice,
    teams: [input.blue.name, input.red.name]
  });
  const existing = gameContent.querySelector<HTMLElement>('.mobile-live-history-board[data-mobile-history-copy="true"]');
  if (existing?.dataset.mobileRenderKey === key) return;

  rendering = true;
  gameContent.innerHTML = boardMarkup(input);
  const board = gameContent.querySelector<HTMLElement>('.mobile-live-history-board[data-mobile-history-copy="true"]');
  if (board) {
    board.dataset.mobileRenderKey = key;
    if (input.sourceSnapshot?.stats) {
      window.dispatchEvent(new CustomEvent('esports-live:ended-snapshot', {
        detail: { snapshot: input.sourceSnapshot, root: board }
      }));
    }
  }
  rendering = false;
}

function queueLiveBoard(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(renderLiveBoard);
}

function syncNavigationFrame(): void {
  if (!nav || !media.matches) return;
  const viewportWidth = document.documentElement.clientWidth;
  const bounds = appFrame?.getBoundingClientRect();
  const frameLeft = bounds && bounds.width > 0 ? bounds.left : 0;
  const frameRight = bounds && bounds.width > 0 ? bounds.right : viewportWidth;
  const left = Math.max(8, Math.round(frameLeft + 8));
  const right = Math.min(viewportWidth - 8, Math.round(frameRight - 8));
  const width = Math.max(240, right - left);
  nav.style.setProperty('--mobile-nav-left', `${left}px`);
  nav.style.setProperty('--mobile-nav-width', `${width}px`);
  nav.dataset.mobileNavVersion = '0.17';
  nav.dataset.mobileNavLayout = 'app-frame';
}

function syncNavigationState(): void {
  if (!nav || !media.matches) return;
  const view = body.dataset.mobileView === 'platform' || body.dataset.mobileView === 'live'
    ? body.dataset.mobileView
    : 'matches';
  nav.querySelectorAll<HTMLButtonElement>('[data-mobile-view]').forEach(button => {
    const active = button.dataset.mobileView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

window.addEventListener('esports-live:selection', event => {
  selection = (event as CustomEvent<ScheduleEvent>).detail;
  latestSnapshot = null;
  queueLiveBoard();
});

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.game?.id) return;
  latestSnapshot = snapshot;
  if (snapshot.stats) verifiedSnapshots.set(snapshot.game.id, snapshot);
  queueLiveBoard();
});

if (gameContent) {
  new MutationObserver(() => {
    if (rendering || !liveModeActive()) return;
    if (!gameContent.querySelector('.mobile-live-history-board[data-mobile-history-copy="true"]')) queueLiveBoard();
  }).observe(gameContent, { childList: true });
}

if (nav) {
  nav.addEventListener('click', () => queueMicrotask(syncNavigationState));
}

new MutationObserver(() => {
  syncNavigationState();
  if (liveModeActive()) queueLiveBoard();
}).observe(body, { attributes: true, attributeFilter: ['data-mobile-view', 'data-mobile-context'] });

window.addEventListener('resize', syncNavigationFrame, { passive: true });
window.visualViewport?.addEventListener('resize', syncNavigationFrame, { passive: true });
window.visualViewport?.addEventListener('scroll', syncNavigationFrame, { passive: true });
window.addEventListener('pageshow', () => {
  syncNavigationFrame();
  syncNavigationState();
  queueLiveBoard();
});
if (typeof ResizeObserver === 'function' && appFrame) {
  new ResizeObserver(syncNavigationFrame).observe(appFrame);
}
if (typeof media.addEventListener === 'function') media.addEventListener('change', () => {
  syncNavigationFrame();
  syncNavigationState();
  queueLiveBoard();
});
else if (typeof media.addListener === 'function') media.addListener(() => {
  syncNavigationFrame();
  syncNavigationState();
  queueLiveBoard();
});

syncNavigationFrame();
syncNavigationState();
queueLiveBoard();

export {};
