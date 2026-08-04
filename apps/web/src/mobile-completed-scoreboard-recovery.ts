import type { LiveSnapshot, SeriesContext, SeriesGameHistoryRef } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';
import { apiJson } from './api-client.ts';

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const MOBILE_QUERY = '(max-width: 760px)';
const RECOVERY_DELAY_MS = 4_000;
const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const DDRAGON_CDN = 'https://ddragon.leagueoflegends.com/cdn';
const ROLE_ORDER = ['top', 'jungle', 'mid', 'bottom', 'support'] as const;
type Role = typeof ROLE_ORDER[number];

const media = window.matchMedia(MOBILE_QUERY);
const completedDetail = document.querySelector<HTMLElement>('#completed-match-detail');
let selectedSeriesId: string | null = null;
let generation = 0;
let recoveryTimer: number | null = null;
let ddragonVersionPromise: Promise<string | null> | null = null;

const style = document.createElement('style');
style.textContent = `
@media (max-width:760px){
  body.mobile-demo-active #completed-final-telemetry:has(>.completed-telemetry-loading){display:grid!important}
  body.mobile-demo-active .completed-telemetry-loading{display:grid;gap:7px;place-items:center;min-height:92px;padding:16px}
  body.mobile-demo-active .completed-telemetry-loading:before{width:22px;height:22px;border:2px solid rgba(56,189,248,.2);border-top-color:#38bdf8;border-radius:50%;content:"";animation:mobile-final-spin .8s linear infinite}
  body.mobile-demo-active .mobile-final-recovery{display:grid;gap:8px}
  body.mobile-demo-active .mobile-final-recovery-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;padding:8px;border:1px solid rgba(148,163,184,.14);border-radius:10px;background:rgba(2,6,23,.5)}
  body.mobile-demo-active .mobile-final-recovery-summary div{min-width:0;text-align:center}
  body.mobile-demo-active .mobile-final-recovery-summary span{display:block;color:#8290a5;font-size:.47rem;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
  body.mobile-demo-active .mobile-final-recovery-summary strong{display:block;margin-top:2px;font-size:.64rem}
  body.mobile-demo-active .mobile-recovery-matchups{overflow:hidden;border:1px solid rgba(148,163,184,.14);border-radius:11px}
  body.mobile-demo-active .mobile-recovery-row{display:grid;grid-template-columns:minmax(0,1fr) 34px minmax(0,1fr);min-height:64px;border-bottom:1px solid rgba(148,163,184,.1)}
  body.mobile-demo-active .mobile-recovery-row:last-child{border-bottom:0}
  body.mobile-demo-active .mobile-recovery-player{display:grid;grid-template-areas:"portrait identity" "items items";grid-template-columns:28px minmax(0,1fr);grid-template-rows:30px 18px;gap:2px 5px;min-width:0;padding:6px;background:linear-gradient(90deg,rgba(14,165,233,.065),transparent)}
  body.mobile-demo-active .mobile-recovery-player.red{grid-template-areas:"identity portrait" "items items";grid-template-columns:minmax(0,1fr) 28px;text-align:right;background:linear-gradient(270deg,rgba(244,63,94,.065),transparent)}
  body.mobile-demo-active .mobile-recovery-portrait{grid-area:portrait;width:28px;height:28px;overflow:hidden;border:1px solid rgba(148,163,184,.18);border-radius:6px;background:#0b1728}
  body.mobile-demo-active .mobile-recovery-portrait img{width:100%;height:100%;object-fit:cover}
  body.mobile-demo-active .mobile-recovery-identity{grid-area:identity;min-width:0;align-self:center}
  body.mobile-demo-active .mobile-recovery-identity strong,.mobile-recovery-identity small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  body.mobile-demo-active .mobile-recovery-identity strong{font-size:.56rem;line-height:1.05}
  body.mobile-demo-active .mobile-recovery-identity small{margin-top:2px;color:#8fa0b5;font-size:.45rem}
  body.mobile-demo-active .mobile-recovery-stats{display:flex;gap:4px;color:#dce7f5;font-size:.48rem;font-weight:800}
  body.mobile-demo-active .mobile-recovery-player.red .mobile-recovery-stats{justify-content:flex-end}
  body.mobile-demo-active .mobile-recovery-items{grid-area:items;display:flex;gap:2px;min-width:0;overflow:hidden}
  body.mobile-demo-active .mobile-recovery-player.red .mobile-recovery-items{justify-content:flex-end}
  body.mobile-demo-active .mobile-recovery-item{width:15px;height:15px;overflow:hidden;flex:0 0 15px;border:1px solid rgba(148,163,184,.12);border-radius:3px;background:rgba(15,23,42,.72)}
  body.mobile-demo-active .mobile-recovery-item img{width:100%;height:100%;object-fit:cover}
  body.mobile-demo-active .mobile-recovery-role{display:grid;place-items:center;padding:2px;color:#8fa0b5;font-size:.42rem;font-weight:900;text-align:center;text-transform:uppercase}
  body.mobile-demo-active .mobile-final-retry{justify-self:center;min-height:34px;padding:0 13px;border:1px solid rgba(56,189,248,.35);border-radius:9px;color:#d8f4ff;background:rgba(56,189,248,.08);font:inherit;font-size:.62rem;font-weight:850}
}
@keyframes mobile-final-spin{to{transform:rotate(360deg)}}
`;
document.head.append(style);

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function canonicalRole(value: string | null): Role | null {
  const normalized = value?.trim().toLowerCase().replaceAll('_', ' ').replaceAll('-', ' ') ?? '';
  if (normalized.includes('top')) return 'top';
  if (normalized.includes('jung')) return 'jungle';
  if (normalized.includes('mid')) return 'mid';
  if (normalized.includes('bot') || normalized.includes('adc') || normalized.includes('carry')) return 'bottom';
  if (normalized.includes('sup') || normalized.includes('utility')) return 'support';
  return null;
}

function orderedPlayers(team: LolTeamState): readonly (LolPlayerState | null)[] {
  const assigned = new Map<Role, LolPlayerState>();
  const unassigned: LolPlayerState[] = [];
  for (const player of team.players) {
    const role = canonicalRole(player.role);
    if (role && !assigned.has(role)) assigned.set(role, player);
    else unassigned.push(player);
  }
  return ROLE_ORDER.map(role => assigned.get(role) ?? unassigned.shift() ?? null);
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function formatClock(value: number | null): string {
  if (value === null) return '—';
  const safe = Math.max(0, Math.round(value));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function championKey(value: string | null): string | null {
  const key = value?.replace(/[^a-z0-9]/gi, '') ?? '';
  if (!key || /^\d+$/.test(key)) return null;
  return ({ Wukong: 'MonkeyKing', NunuWillump: 'Nunu', RenataGlasc: 'Renata' } as Record<string, string>)[key] ?? key;
}

function ddragonVersion(): Promise<string | null> {
  if (ddragonVersionPromise) return ddragonVersionPromise;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4_000);
  ddragonVersionPromise = fetch(DDRAGON_VERSIONS, { cache: 'force-cache', signal: controller.signal })
    .then(response => response.ok ? response.json() : [])
    .then(value => Array.isArray(value) && typeof value[0] === 'string' ? value[0] : null)
    .catch(() => null)
    .finally(() => window.clearTimeout(timeout));
  return ddragonVersionPromise;
}

function itemMarkup(player: LolPlayerState | null, version: string | null): string {
  return Array.from({ length: 7 }, (_, index) => {
    const id = player?.items?.[index];
    const image = id && version
      ? `<img src="${DDRAGON_CDN}/${encodeURIComponent(version)}/img/item/${encodeURIComponent(id)}.png" alt="Item ${escapeHtml(id)}">`
      : '';
    return `<span class="mobile-recovery-item">${image}</span>`;
  }).join('');
}

function playerMarkup(player: LolPlayerState | null, side: 'blue' | 'red', version: string | null): string {
  const champion = player?.championId ?? 'Champion unavailable';
  const key = championKey(player?.championId ?? null);
  const portrait = key && version
    ? `<img src="${DDRAGON_CDN}/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(key)}.png" alt="${escapeHtml(champion)}">`
    : '';
  return `
    <div class="mobile-recovery-player ${side}">
      <span class="mobile-recovery-portrait">${portrait}</span>
      <div class="mobile-recovery-identity">
        <strong>${escapeHtml(player?.handle ?? 'Player unavailable')}</strong>
        <small>${escapeHtml(champion)}</small>
        <span class="mobile-recovery-stats">
          <b>${formatNumber(player?.kills ?? null)}/${formatNumber(player?.deaths ?? null)}/${formatNumber(player?.assists ?? null)}</b>
          <b>${formatNumber(player?.creepScore ?? null)} CS</b>
          <b>${formatNumber(player?.totalGold ?? null)}g</b>
        </span>
      </div>
      <div class="mobile-recovery-items">${itemMarkup(player, version)}</div>
    </div>`;
}

function matchupMarkup(blue: LolTeamState, red: LolTeamState, version: string | null): string {
  const bluePlayers = orderedPlayers(blue);
  const redPlayers = orderedPlayers(red);
  return ROLE_ORDER.map((role, index) => `
    <div class="mobile-recovery-row">
      ${playerMarkup(bluePlayers[index] ?? null, 'blue', version)}
      <span class="mobile-recovery-role">${escapeHtml(role)}</span>
      ${playerMarkup(redPlayers[index] ?? null, 'red', version)}
    </div>`).join('');
}

function summaryMarkup(stats: LolStats): string {
  const goldDiff = stats.blue.gold === null || stats.red.gold === null ? null : stats.blue.gold - stats.red.gold;
  return `
    <div class="mobile-final-recovery-summary">
      <div><span>Gold</span><strong>${formatNumber(stats.blue.gold)} – ${formatNumber(stats.red.gold)}</strong></div>
      <div><span>Kills</span><strong>${formatNumber(stats.blue.kills)} – ${formatNumber(stats.red.kills)}</strong></div>
      <div><span>Lead</span><strong>${goldDiff === null ? '—' : `${goldDiff > 0 ? '+' : ''}${goldDiff.toLocaleString()}`}</strong></div>
    </div>`;
}

function gameMarkup(history: SeriesGameHistoryRef, snapshot: LiveSnapshot<LolStats>, version: string | null): string {
  const stats = snapshot.stats!;
  const duration = history.durationSeconds ?? stats.gameClockSeconds;
  const winner = history.winner?.name ? `${history.winner.name} won` : 'Final scoreboard';
  return `
    <article class="completed-final-game mobile-final-recovery" data-final-game-id="${escapeHtml(snapshot.game.id)}">
      <div class="completed-final-game-header">
        <strong>Game ${escapeHtml(history.number)} · ${escapeHtml(winner)}</strong>
        <span>${escapeHtml(formatClock(duration))}</span>
      </div>
      ${summaryMarkup(stats)}
      <div class="mobile-recovery-matchups">${matchupMarkup(stats.blue, stats.red, version)}</div>
    </article>`;
}

function telemetryHost(): HTMLElement | null {
  if (!completedDetail) return null;
  let host = completedDetail.querySelector<HTMLElement>('#completed-final-telemetry');
  if (!host) {
    host = document.createElement('section');
    host.id = 'completed-final-telemetry';
    host.className = 'completed-final-telemetry';
    completedDetail.append(host);
  }
  return host;
}

function hasBoard(): boolean {
  return Boolean(completedDetail?.querySelector('.completed-final-game[data-final-game-id]'));
}

function showLoading(): void {
  const host = telemetryHost();
  if (!host || hasBoard()) return;
  host.innerHTML = `
    <div class="completed-telemetry-heading"><h3>Game scoreboard</h3><span>Loading final telemetry</span></div>
    <div class="completed-telemetry-loading">Loading the final scoreboard…</div>`;
}

async function recover(seriesId: string, force = false): Promise<void> {
  if (!media.matches || !completedDetail || seriesId !== selectedSeriesId) return;
  if (hasBoard() && !force) return;
  const currentGeneration = ++generation;
  showLoading();
  try {
    const context = await apiJson<SeriesContext>(
      API_BASE,
      `/v1/lol/series/${encodeURIComponent(seriesId)}/context?mobileFinal=${Date.now()}`
    );
    const games = context.history?.games.filter(game => game.state === 'completed') ?? [];
    if (!games.length) throw new Error('No completed game IDs were published for this series.');
    const snapshots = await Promise.all(games.map(async game => ({
      game,
      snapshot: await apiJson<LiveSnapshot<LolStats>>(
        API_BASE,
        `/v1/lol/games/${encodeURIComponent(game.id)}/live?mobileFinal=${Date.now()}`
      )
    })));
    if (currentGeneration !== generation || seriesId !== selectedSeriesId || hasBoard()) return;
    const usable = snapshots.filter(entry => entry.snapshot.stats);
    if (!usable.length) throw new Error('Riot returned no final gameplay frame for this series.');
    const version = await ddragonVersion();
    if (currentGeneration !== generation || seriesId !== selectedSeriesId || hasBoard()) return;
    const host = telemetryHost();
    if (!host) return;
    host.innerHTML = `
      <div class="completed-telemetry-heading"><h3>Game scoreboards</h3><span>Recovered mobile view</span></div>
      ${usable.map(entry => gameMarkup(entry.game, entry.snapshot, version)).join('')}`;
    for (const entry of usable) {
      const root = host.querySelector<HTMLElement>(`[data-final-game-id="${CSS.escape(entry.snapshot.game.id)}"]`);
      if (root) window.dispatchEvent(new CustomEvent('esports-live:ended-snapshot', { detail: { snapshot: entry.snapshot, root } }));
    }
  } catch (error) {
    if (currentGeneration !== generation || seriesId !== selectedSeriesId || hasBoard()) return;
    const host = telemetryHost();
    if (!host) return;
    host.innerHTML = `
      <div class="completed-telemetry-heading"><h3>Game scoreboard</h3><span>Final telemetry unavailable</span></div>
      <div class="completed-telemetry-empty">
        <p>${escapeHtml(error instanceof Error ? error.message : 'Unable to load the final scoreboard.')}</p>
        <button class="mobile-final-retry" type="button">Retry scoreboard</button>
      </div>`;
  }
}

function scheduleRecovery(seriesId: string): void {
  if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
  showLoading();
  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = null;
    void recover(seriesId);
  }, RECOVERY_DELAY_MS);
}

window.addEventListener('esports-live:completed-selection', event => {
  const seriesId = (event as CustomEvent<{ seriesId?: string }>).detail?.seriesId ?? null;
  if (!seriesId || !media.matches) return;
  selectedSeriesId = seriesId;
  generation += 1;
  scheduleRecovery(seriesId);
});

completedDetail?.addEventListener('click', event => {
  const retry = event.target instanceof Element ? event.target.closest('.mobile-final-retry') : null;
  if (!retry || !selectedSeriesId) return;
  void recover(selectedSeriesId, true);
});

const observer = completedDetail ? new MutationObserver(() => {
  if (hasBoard() && recoveryTimer !== null) {
    window.clearTimeout(recoveryTimer);
    recoveryTimer = null;
  }
}) : null;
observer?.observe(completedDetail!, { childList: true, subtree: true });
window.addEventListener('beforeunload', () => {
  observer?.disconnect();
  if (recoveryTimer !== null) window.clearTimeout(recoveryTimer);
});

export {};
