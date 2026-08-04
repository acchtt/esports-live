import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

type Role = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';
type Side = 'blue' | 'red';

interface ChampionCatalogEntry {
  id?: unknown;
  key?: unknown;
}

interface ChampionCatalogResponse {
  data?: Record<string, ChampionCatalogEntry>;
}

const media = window.matchMedia('(max-width: 760px)');
const body = document.body;
const gameContent = document.querySelector<HTMLElement>('#game-content');
const ROLE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const DDRAGON_CDN = 'https://ddragon.leagueoflegends.com/cdn';
const COMMUNITY_DRAGON_ICONS = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons';

let versionsPromise: Promise<readonly string[]> | null = null;
const catalogPromises = new Map<string, Promise<ReadonlyMap<string, string>>>();
let latestSnapshot: LiveSnapshot<LolStats> | null = null;
let renderQueued = false;
let rendering = false;
let historyResetUntil = 0;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active[data-mobile-context="history"] .analysis-panel,
  body.mobile-demo-active[data-mobile-context="history"] #completed-match-detail{
    overflow-anchor:none!important
  }

  body.mobile-demo-active:not([data-mobile-context="history"]) #game-content{
    padding:0 12px 12px!important
  }

  body.mobile-demo-active .mobile-live-history-board{
    display:grid;
    gap:0;
    width:100%;
    overflow:hidden;
    border:1px solid rgba(112,151,196,.2);
    border-radius:18px;
    background:linear-gradient(180deg,rgba(8,18,34,.98),rgba(5,14,27,.98));
    box-shadow:0 20px 60px rgba(0,0,0,.22)
  }

  body.mobile-demo-active .mobile-live-history-board .completed-final-game-header{
    display:flex;
    align-items:center;
    justify-content:space-between;
    gap:10px;
    min-height:40px;
    padding:7px 10px;
    border:0;
    border-bottom:1px solid rgba(112,151,196,.12);
    background:rgba(4,11,23,.72)
  }
  body.mobile-demo-active .mobile-live-history-board .completed-final-game-header strong{
    min-width:0;
    overflow:hidden;
    font-size:.72rem;
    line-height:1.2;
    text-overflow:ellipsis;
    white-space:nowrap
  }
  body.mobile-demo-active .mobile-live-history-board .completed-final-game-header span{
    flex:0 0 auto;
    color:#9aabc1;
    font-size:.62rem;
    font-weight:850;
    font-variant-numeric:tabular-nums
  }

  body.mobile-demo-active .mobile-live-history-board .mobile-completed-team-names{
    display:grid;
    grid-template-columns:minmax(0,1fr) 86px minmax(0,1fr);
    align-items:center;
    gap:8px;
    min-height:88px;
    padding:13px 10px;
    border:0;
    border-radius:0;
    background:
      linear-gradient(90deg,rgba(14,165,233,.14),transparent 43%,transparent 57%,rgba(244,63,94,.14)),
      rgba(2,6,23,.54)
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-team-name{
    display:flex;
    flex-direction:column;
    justify-content:center;
    align-items:flex-start;
    gap:4px;
    min-width:0
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-team-name.red{
    align-items:flex-end;
    text-align:right
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-team-name small{
    color:#8191a8;
    font-size:.48rem;
    font-weight:900;
    line-height:1;
    letter-spacing:.1em;
    text-transform:uppercase
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-team-name strong{
    display:-webkit-box;
    overflow:hidden;
    color:#dce9f7;
    font-size:.78rem;
    line-height:1.18;
    overflow-wrap:anywhere;
    -webkit-box-orient:vertical;
    -webkit-line-clamp:2
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-team-name.blue.leading strong{color:#8bd4ff}
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-team-name.red.leading strong{color:#ff9cad}

  body.mobile-demo-active .mobile-live-history-board .mobile-completed-gold-lead{
    display:grid;
    place-items:center;
    align-content:center;
    gap:4px;
    min-height:56px;
    padding:7px 4px;
    border:1px solid rgba(148,163,184,.15);
    border-radius:11px;
    background:rgba(7,16,30,.82);
    text-align:center
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-gold-lead small{
    color:#8797ad;
    font-size:.42rem;
    font-weight:900;
    line-height:1;
    letter-spacing:.09em;
    text-transform:uppercase
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-gold-lead strong{
    font-size:.88rem;
    font-weight:950;
    font-variant-numeric:tabular-nums;
    line-height:1
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-gold-lead.blue{
    border-color:rgba(56,189,248,.28);
    color:#55c4ff;
    background:rgba(14,116,144,.14)
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-gold-lead.red{
    border-color:rgba(251,113,133,.28);
    color:#ff7f95;
    background:rgba(159,18,57,.13)
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-gold-lead.even,
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-gold-lead.unknown{color:#c2cedc}

  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objectives{
    display:grid;
    gap:7px;
    margin:0;
    padding:11px 4px;
    border:0;
    border-radius:0;
    background:rgba(2,6,23,.3)
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objectives-title{
    color:#8290a5;
    font-size:.6rem;
    font-weight:900;
    letter-spacing:.08em;
    text-align:center;
    text-transform:uppercase
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objectives-grid{
    display:grid;
    grid-template-columns:repeat(4,minmax(0,1fr));
    gap:3px
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objective{
    min-width:0;
    padding:4px 2px;
    border-left:1px solid rgba(148,163,184,.1);
    text-align:center
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objective:first-child{border-left:0}
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objective>span{
    display:block;
    overflow:hidden;
    color:#8290a5;
    font-size:.56rem;
    font-weight:800;
    text-overflow:ellipsis;
    text-transform:uppercase;
    white-space:nowrap
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objective strong{
    display:grid;
    grid-template-columns:1fr auto 1fr;
    align-items:center;
    gap:2px;
    margin-top:3px;
    font-size:.74rem;
    font-variant-numeric:tabular-nums
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objective b:first-child{color:#7dd3fc;text-align:right}
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objective b:last-child{color:#fda4af;text-align:left}
  body.mobile-demo-active .mobile-live-history-board .mobile-completed-objective i{color:#526177;font-style:normal}

  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-matchups{
    overflow:hidden;
    border:0;
    border-radius:0;
    background:transparent
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-row{
    display:grid;
    grid-template-columns:minmax(0,1fr) 64px minmax(0,1fr);
    min-height:74px;
    border:0;
    border-bottom:1px solid rgba(148,163,184,.1);
    background:transparent
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-row:last-child{border-bottom:0}
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-player{
    display:grid;
    grid-template-areas:"portrait identity";
    grid-template-columns:38px minmax(0,1fr);
    align-items:center;
    gap:7px;
    min-width:0;
    padding:10px 8px;
    border:0;
    background:transparent
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-player.red{
    grid-template-areas:"identity portrait";
    grid-template-columns:minmax(0,1fr) 38px;
    text-align:right
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-portrait{
    grid-area:portrait;
    display:grid;
    place-items:center;
    width:38px;
    height:38px;
    overflow:hidden;
    border:1px solid rgba(148,163,184,.18);
    border-radius:9px;
    color:#8393aa;
    background:#0b1728;
    font-size:.62rem;
    font-weight:900
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-portrait img{
    display:block;
    width:100%;
    height:100%;
    object-fit:cover
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-identity{
    grid-area:identity;
    display:grid;
    gap:4px;
    min-width:0
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-identity>strong{
    overflow:hidden;
    color:#f1f5f9;
    font-size:.68rem;
    line-height:1.12;
    text-overflow:ellipsis;
    white-space:nowrap
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-stats{
    display:grid;
    gap:1px;
    color:#d6dfec;
    font-size:.58rem;
    font-weight:800;
    line-height:1.08
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-player.red .mobile-recovery-stats{text-align:right}
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-gold-delta{
    display:grid;
    place-items:center;
    min-width:60px;
    min-height:34px;
    margin:auto 2px;
    padding:6px 3px;
    border:1px solid rgba(148,163,184,.12);
    border-radius:8px;
    background:rgba(15,23,42,.62);
    font-size:.74rem;
    font-weight:950;
    font-variant-numeric:tabular-nums;
    line-height:1;
    letter-spacing:-.015em;
    text-align:center
  }
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-gold-delta.blue{color:#38bdf8}
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-gold-delta.red{color:#fb7185}
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-gold-delta.even,
  body.mobile-demo-active .mobile-live-history-board .mobile-recovery-gold-delta.unknown{color:#a5b4c8}
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

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function formatClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function compactGold(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${(absolute / 1_000).toFixed(0)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
}

function versions(): Promise<readonly string[]> {
  if (versionsPromise) return versionsPromise;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  versionsPromise = fetch(DDRAGON_VERSIONS, { cache: 'force-cache', signal: controller.signal })
    .then(response => response.ok ? response.json() : [])
    .then(value => Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : [])
    .catch(() => [])
    .finally(() => window.clearTimeout(timeout));
  return versionsPromise;
}

async function resolvedVersion(patch: string | null): Promise<string | null> {
  const entries = await versions();
  const exact = patch?.trim() ?? '';
  if (exact && entries.includes(exact)) return exact;
  const prefix = exact.match(/^(\d+\.\d+)/)?.[1];
  return entries.find(version => prefix && version.startsWith(`${prefix}.`)) ?? entries[0] ?? null;
}

function catalog(version: string): Promise<ReadonlyMap<string, string>> {
  const existing = catalogPromises.get(version);
  if (existing) return existing;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  const request = fetch(`${DDRAGON_CDN}/${encodeURIComponent(version)}/data/en_US/champion.json`, {
    cache: 'force-cache',
    signal: controller.signal
  })
    .then(async response => response.ok ? await response.json() as ChampionCatalogResponse : {})
    .then(payload => {
      const result = new Map<string, string>();
      for (const entry of Object.values(payload.data ?? {})) {
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        const key = typeof entry.key === 'string' ? entry.key.trim() : '';
        if (!id) continue;
        if (key) result.set(key, id);
        result.set(id.toLowerCase(), id);
      }
      return result;
    })
    .catch(() => new Map<string, string>())
    .finally(() => window.clearTimeout(timeout));
  catalogPromises.set(version, request);
  return request;
}

function namedChampionKey(value: string): string | null {
  const key = value.replace(/[^a-z0-9]/gi, '');
  if (!key || /^\d+$/.test(key)) return null;
  return ({ Wukong: 'MonkeyKing', NunuWillump: 'Nunu', RenataGlasc: 'Renata' } as Record<string, string>)[key] ?? key;
}

async function championAsset(player: LolPlayerState | null, version: string): Promise<{ src: string; fallback: string | null; alt: string } | null> {
  if (!player) return null;
  const raw = String(player.championId ?? '').trim();
  if (!raw) return null;
  const named = namedChampionKey(raw);
  if (named) {
    return {
      src: `${DDRAGON_CDN}/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(named)}.png`,
      fallback: null,
      alt: `${raw} portrait`
    };
  }
  if (!/^\d+$/.test(raw)) return null;
  const resolved = (await catalog(version)).get(raw) ?? null;
  const fallback = `${COMMUNITY_DRAGON_ICONS}/${encodeURIComponent(raw)}.png`;
  return {
    src: resolved
      ? `${DDRAGON_CDN}/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(resolved)}.png`
      : fallback,
    fallback: resolved ? fallback : null,
    alt: `${resolved ?? 'Champion'} portrait`
  };
}

async function installPortrait(target: HTMLElement | null, player: LolPlayerState | null, version: string): Promise<void> {
  if (!target) return;
  const asset = await championAsset(player, version);
  if (!asset || !target.isConnected) return;
  const image = document.createElement('img');
  image.className = 'mobile-completed-champion';
  image.src = asset.src;
  image.alt = asset.alt;
  image.loading = 'eager';
  image.decoding = 'async';
  if (asset.fallback) {
    image.addEventListener('error', () => {
      if (image.src !== asset.fallback) image.src = asset.fallback!;
    }, { once: true });
  }
  target.replaceChildren(image);
}

async function hydratePortraits(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): Promise<void> {
  if (!media.matches || !snapshot.stats) return;
  const version = await resolvedVersion(snapshot.stats.patch ?? null);
  if (!version || !root.isConnected) return;
  const bluePlayers = orderedPlayers(snapshot.stats.blue);
  const redPlayers = orderedPlayers(snapshot.stats.red);
  const rows = [...root.querySelectorAll<HTMLElement>('.mobile-recovery-row,.role-matchup-row')];
  await Promise.all(rows.flatMap((row, index) => [
    installPortrait(
      row.querySelector<HTMLElement>('.mobile-recovery-player.blue .mobile-recovery-portrait,.role-player.blue .role-player-portrait'),
      bluePlayers[index] ?? null,
      version
    ),
    installPortrait(
      row.querySelector<HTMLElement>('.mobile-recovery-player.red .mobile-recovery-portrait,.role-player.red .role-player-portrait'),
      redPlayers[index] ?? null,
      version
    )
  ]));
}

function overallLead(blueGold: number | null, redGold: number | null): { side: Side | null; className: string; value: string; label: string } {
  if (blueGold === null || redGold === null) return { side: null, className: 'unknown', value: '—', label: 'Gold lead unavailable' };
  const difference = blueGold - redGold;
  if (difference === 0) return { side: null, className: 'even', value: 'EVEN', label: 'Gold is even' };
  const side: Side = difference > 0 ? 'blue' : 'red';
  const amount = compactGold(difference);
  return { side, className: side, value: `+${amount}`, label: `${side === 'blue' ? 'Blue' : 'Red'} side leads by ${amount} gold` };
}

function objectiveCount(team: LolTeamState, key: 'towers' | 'dragons' | 'barons' | 'inhibitors'): number | null {
  return key === 'dragons' ? team.objectives.dragons?.length ?? null : team.objectives[key];
}

function objectiveMetric(label: string, blue: number | null, red: number | null): string {
  return `<div class="mobile-completed-objective"><span>${esc(label)}</span><strong><b>${formatNumber(blue)}</b><i>–</i><b>${formatNumber(red)}</b></strong></div>`;
}

function playerDelta(blue: LolPlayerState | null, red: LolPlayerState | null): { side: string; text: string; label: string } {
  const blueGold = blue?.totalGold ?? null;
  const redGold = red?.totalGold ?? null;
  if (blueGold === null || redGold === null) return { side: 'unknown', text: '—', label: 'Gold comparison unavailable' };
  const difference = blueGold - redGold;
  if (difference === 0) return { side: 'even', text: 'EVEN', label: 'Gold is even' };
  const side = difference > 0 ? 'blue' : 'red';
  const amount = Math.abs(difference).toLocaleString();
  return { side, text: `+${amount}`, label: `${side === 'blue' ? 'Blue' : 'Red'} leads by ${amount} gold` };
}

function playerMarkup(player: LolPlayerState | null, side: Side): string {
  return `<div class="mobile-recovery-player ${side}">
    <span class="mobile-recovery-portrait" aria-label="${esc(player?.championId ?? 'Champion portrait unavailable')}">?</span>
    <div class="mobile-recovery-identity">
      <strong title="${esc(player?.handle ?? 'Player unavailable')}">${esc(player?.handle ?? 'Player unavailable')}</strong>
      <span class="mobile-recovery-stats" aria-label="KDA ${esc(formatNumber(player?.kills ?? null))}/${esc(formatNumber(player?.deaths ?? null))}/${esc(formatNumber(player?.assists ?? null))}, ${esc(formatNumber(player?.creepScore ?? null))} CS, ${esc(formatNumber(player?.totalGold ?? null))} gold">
        <b>${formatNumber(player?.kills ?? null)}/${formatNumber(player?.deaths ?? null)}/${formatNumber(player?.assists ?? null)}</b>
        <b>${formatNumber(player?.creepScore ?? null)}</b>
        <b>${formatNumber(player?.totalGold ?? null)}</b>
      </span>
    </div>
  </div>`;
}

function matchupRows(blue: LolTeamState, red: LolTeamState): string {
  const bluePlayers = orderedPlayers(blue);
  const redPlayers = orderedPlayers(red);
  return ROLE_ORDER.map((role, index) => {
    const left = bluePlayers[index] ?? null;
    const right = redPlayers[index] ?? null;
    const delta = playerDelta(left, right);
    return `<div class="mobile-recovery-row" data-role="${role}">
      ${playerMarkup(left, 'blue')}
      <span class="mobile-recovery-gold-delta ${delta.side}" title="${esc(role)} · ${esc(delta.label)}" aria-label="${esc(role)} ${esc(delta.label)}">${delta.text}</span>
      ${playerMarkup(right, 'red')}
    </div>`;
  }).join('');
}

function liveBoardMarkup(snapshot: LiveSnapshot<LolStats>): string {
  const stats = snapshot.stats!;
  const lead = overallLead(stats.blue.gold, stats.red.gold);
  const status = snapshot.game.state === 'paused' ? 'Paused' : 'Live';
  return `<article class="mobile-live-history-board" data-live-dashboard-game-id="${esc(snapshot.game.id)}" data-mobile-unified-game-id="${esc(snapshot.game.id)}">
    <div class="completed-final-game-header"><strong>Game ${snapshot.game.number} · ${status}</strong><span id="live-game-clock">${formatClock(stats.gameClockSeconds)}</span></div>
    <section class="mobile-completed-team-names" data-leading-side="${lead.side ?? lead.className}" aria-label="Teams and overall gold comparison. ${esc(lead.label)}.">
      <div class="mobile-completed-team-name blue${lead.side === 'blue' ? ' leading' : ''}"><small>Blue side</small><strong title="${esc(stats.blue.name)}">${esc(stats.blue.name)}</strong></div>
      <span class="mobile-completed-gold-lead ${lead.className}" aria-label="${esc(lead.label)}"><small>Gold lead</small><strong>${lead.value}</strong></span>
      <div class="mobile-completed-team-name red${lead.side === 'red' ? ' leading' : ''}"><small>Red side</small><strong title="${esc(stats.red.name)}">${esc(stats.red.name)}</strong></div>
    </section>
    <section class="mobile-completed-objectives" aria-label="Objective counts">
      <span class="mobile-completed-objectives-title">Objectives · Blue – Red</span>
      <div class="mobile-completed-objectives-grid">
        ${objectiveMetric('Towers', objectiveCount(stats.blue, 'towers'), objectiveCount(stats.red, 'towers'))}
        ${objectiveMetric('Dragons', objectiveCount(stats.blue, 'dragons'), objectiveCount(stats.red, 'dragons'))}
        ${objectiveMetric('Barons', objectiveCount(stats.blue, 'barons'), objectiveCount(stats.red, 'barons'))}
        ${objectiveMetric('Inhibitors', objectiveCount(stats.blue, 'inhibitors'), objectiveCount(stats.red, 'inhibitors'))}
      </div>
    </section>
    <div class="mobile-recovery-matchups">${matchupRows(stats.blue, stats.red)}</div>
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
  const existing = gameContent.querySelector<HTMLElement>('.mobile-live-history-board');
  if (existing?.dataset.mobileRenderKey === key) return;
  rendering = true;
  gameContent.innerHTML = liveBoardMarkup(snapshot);
  const board = gameContent.querySelector<HTMLElement>('.mobile-live-history-board');
  if (board) {
    board.dataset.mobileRenderKey = key;
    void hydratePortraits(snapshot, board);
  }
  rendering = false;
}

function queueLiveBoard(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(renderLiveBoard);
}

function historyModeActive(): boolean {
  return media.matches
    && body.dataset.mobileView === 'live'
    && body.dataset.mobileContext === 'history';
}

function resetHistoryScroll(): void {
  if (!historyModeActive()) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest('[data-completed-series-id]')) active.blur();
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

function scheduleHistoryReset(): void {
  historyResetUntil = Date.now() + 6_000;
  queueMicrotask(resetHistoryScroll);
  requestAnimationFrame(() => {
    resetHistoryScroll();
    requestAnimationFrame(resetHistoryScroll);
  });
  window.setTimeout(resetHistoryScroll, 120);
}

window.addEventListener('esports-live:completed-selection', scheduleHistoryReset);
window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot && detail.root) void hydratePortraits(detail.snapshot, detail.root);
  if (Date.now() <= historyResetUntil) resetHistoryScroll();
});

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.stats) return;
  latestSnapshot = snapshot;
  queueLiveBoard();
});

window.addEventListener('esports-live:selection', () => {
  if (liveModeActive()) queueLiveBoard();
});
window.addEventListener('pageshow', () => {
  if (historyModeActive()) scheduleHistoryReset();
  else queueLiveBoard();
});

if (gameContent) {
  new MutationObserver(() => {
    if (rendering || !latestSnapshot?.stats || !liveModeActive()) return;
    if (!gameContent.querySelector('.mobile-live-history-board')) queueLiveBoard();
  }).observe(gameContent, { childList: true });
}

if (typeof media.addEventListener === 'function') media.addEventListener('change', () => {
  if (media.matches) queueLiveBoard();
});
else if (typeof media.addListener === 'function') media.addListener(() => {
  if (media.matches) queueLiveBoard();
});

const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
if (nav) nav.dataset.mobileNavVersion = '0.15';

export {};
