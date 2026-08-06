import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

type Side = 'blue' | 'red';
type Role = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';
type ObjectiveKey = 'towers' | 'dragons' | 'barons' | 'inhibitors';

export type MobileScoreboardMode = 'live' | 'history';

export interface MobileScoreboardOptions {
  mode: MobileScoreboardMode;
}

const ROLE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const ROLE_LABELS: Record<Role, string> = {
  top: 'Top',
  jungle: 'Jungle',
  mid: 'Mid',
  bottom: 'Bottom',
  support: 'Support'
};
const OBJECTIVES: readonly [ObjectiveKey, string][] = [
  ['towers', 'Towers'],
  ['dragons', 'Dragons'],
  ['barons', 'Barons'],
  ['inhibitors', 'Inhibitors']
];
const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const DDRAGON_CDN = 'https://ddragon.leagueoflegends.com/cdn';
const CHAMPION_ASSET_VERSION = 'ddragon-version-fallback-v27';
const CHAMPION_ALIASES: Record<string, string> = {
  aurelionsol: 'AurelionSol',
  belveth: 'Belveth',
  chogath: 'Chogath',
  drmundo: 'DrMundo',
  jarvaniv: 'JarvanIV',
  kaisa: 'Kaisa',
  ksante: 'KSante',
  khazix: 'Khazix',
  leblanc: 'Leblanc',
  leesin: 'LeeSin',
  masteryi: 'MasterYi',
  missfortune: 'MissFortune',
  monkeyking: 'MonkeyKing',
  nunu: 'Nunu',
  nunuandwillump: 'Nunu',
  nunuwillump: 'Nunu',
  reksai: 'RekSai',
  renata: 'Renata',
  renataglasc: 'Renata',
  tahmkench: 'TahmKench',
  twistedfate: 'TwistedFate',
  velkoz: 'Velkoz',
  wukong: 'MonkeyKing',
  xinzhao: 'XinZhao'
};

let ddragonVersionsPromise: Promise<readonly string[]> | null = null;

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

function compact(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${Math.round(absolute / 1_000)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
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

function orderedPlayers(team: LolTeamState | null): readonly (LolPlayerState | null)[] {
  if (!team) return ROLE_ORDER.map(() => null);
  const assigned = new Map<Role, LolPlayerState>();
  const extras: LolPlayerState[] = [];
  for (const player of team.players) {
    const role = roleOf(player.role);
    if (role && !assigned.has(role)) assigned.set(role, player);
    else extras.push(player);
  }
  return ROLE_ORDER.map(role => assigned.get(role) ?? extras.shift() ?? null);
}

function championKey(value: string | null): string | null {
  const key = value?.replace(/[^a-z0-9]/gi, '') ?? '';
  if (!key || /^\d+$/.test(key)) return null;
  return CHAMPION_ALIASES[key.toLowerCase()] ?? key;
}

function availableDdragonVersions(): Promise<readonly string[]> {
  if (ddragonVersionsPromise) return ddragonVersionsPromise;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4_000);
  ddragonVersionsPromise = fetch(DDRAGON_VERSIONS, {
    cache: 'force-cache',
    signal: controller.signal
  })
    .then(response => response.ok ? response.json() : [])
    .then(value => Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : [])
    .catch(() => [])
    .finally(() => window.clearTimeout(timeout));
  return ddragonVersionsPromise;
}

async function ddragonVersionCandidates(patch: string | null): Promise<readonly string[]> {
  const versions = await availableDdragonVersions();
  const prefix = patch?.match(/^(\d+\.\d+)/)?.[1] ?? null;
  const candidates = [
    patch && versions.includes(patch) ? patch : null,
    prefix ? versions.find(version => version === prefix || version.startsWith(`${prefix}.`)) ?? null : null,
    versions[0] ?? null,
    patch
  ].filter((version): version is string => Boolean(version));
  return [...new Set(candidates)];
}

function championMarkup(player: LolPlayerState | null): string {
  const champion = player?.championId ?? 'Champion unavailable';
  const key = championKey(player?.championId ?? null);
  const image = key
    ? `<img class="telemetry-champion-image" data-champion-key="${esc(key)}" data-asset-state="pending" alt="" aria-hidden="true" decoding="async" style="display:none">`
    : '';
  const initials = champion.split(/\s+/).filter(Boolean).slice(0, 2)
    .map(word => word[0]?.toUpperCase() ?? '').join('') || '?';
  return `<div class="role-player-portrait"><div class="telemetry-champion">${image}<span class="telemetry-champion-fallback">${esc(initials)}</span></div></div>`;
}

function tryChampionVersion(image: HTMLImageElement, version: string, key: string): Promise<boolean> {
  return new Promise(resolve => {
    if (!image.isConnected) {
      resolve(false);
      return;
    }
    const finish = (loaded: boolean): void => {
      image.onload = null;
      image.onerror = null;
      resolve(loaded);
    };
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = `${DDRAGON_CDN}/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(key)}.png`;
  });
}

async function loadChampionPortrait(image: HTMLImageElement, versions: readonly string[]): Promise<void> {
  const key = image.dataset.championKey;
  if (!key) return;
  const fallback = image.parentElement?.querySelector<HTMLElement>('.telemetry-champion-fallback') ?? null;
  for (const version of versions) {
    if (!image.isConnected) return;
    image.dataset.assetState = 'loading';
    image.dataset.assetVersion = version;
    if (await tryChampionVersion(image, version, key)) {
      image.dataset.assetState = 'loaded';
      image.style.removeProperty('display');
      if (fallback) fallback.hidden = true;
      return;
    }
    image.style.setProperty('display', 'none');
  }
  image.dataset.assetState = 'fallback';
  image.removeAttribute('src');
  image.removeAttribute('data-asset-version');
  image.style.setProperty('display', 'none');
  if (fallback) fallback.hidden = false;
}

async function hydrateChampionPortraits(root: HTMLElement, patch: string | null): Promise<void> {
  const images = [...root.querySelectorAll<HTMLImageElement>('.telemetry-champion-image[data-champion-key]')]
    .filter(image => image.dataset.assetState === 'pending');
  if (!images.length) return;
  images.forEach(image => { image.dataset.assetState = 'resolving'; });
  const versions = await ddragonVersionCandidates(patch);
  if (!versions.length) {
    images.forEach(image => { image.dataset.assetState = 'fallback'; });
    return;
  }
  await Promise.all(images.map(image => loadChampionPortrait(image, versions)));
  document.documentElement.dataset.mobileChampionAssets = CHAMPION_ASSET_VERSION;
}

function playerMarkup(player: LolPlayerState | null, role: Role, side: Side): string {
  const name = player?.handle ?? 'Player unavailable';
  const champion = player?.championId ?? 'Champion unavailable';
  return `<div class="role-player ${side}">
    ${championMarkup(player)}
    <div class="role-player-heading">
      <span class="role-chip">${ROLE_LABELS[role]}</span>
      <div class="role-player-name"><strong title="${esc(name)}">${esc(name)}</strong><small>${esc(champion)}</small></div>
    </div>
    <div class="role-player-stats">
      <span><small>KDA</small><strong>${number(player?.kills ?? null)}/${number(player?.deaths ?? null)}/${number(player?.assists ?? null)}</strong></span>
      <span><small>CS</small><strong>${number(player?.creepScore ?? null)}</strong></span>
      <span><small>GOLD</small><strong>${number(player?.totalGold ?? null)}</strong></span>
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

function matchupMarkup(stats: LolStats | null): string {
  const blue = orderedPlayers(stats?.blue ?? null);
  const red = orderedPlayers(stats?.red ?? null);
  return ROLE_ORDER.map((role, index) => `<div class="role-matchup-row" data-role="${role}">
    ${playerMarkup(blue[index] ?? null, role, 'blue')}
    ${deltaMarkup(blue[index] ?? null, red[index] ?? null, role)}
    ${playerMarkup(red[index] ?? null, role, 'red')}
  </div>`).join('');
}

function objectiveValue(team: LolTeamState | null, key: ObjectiveKey): number | null {
  if (!team) return null;
  if (key === 'dragons') return Array.isArray(team.objectives.dragons) ? team.objectives.dragons.length : null;
  return team.objectives[key] as number | null;
}

function fallbackName(root: HTMLElement, snapshot: LiveSnapshot<LolStats> | null, side: Side): string {
  const statsName = snapshot?.stats?.[side].name;
  if (statsName) return statsName;
  const seriesTeam = snapshot?.series?.teams?.[side === 'blue' ? 0 : 1]?.name;
  if (seriesTeam) return seriesTeam;
  return root.querySelector<HTMLElement>(
    `.mobile-live-parity-team.${side} .mobile-scoreboard-team-name, .history-v2-team.${side} strong, .mobile-completed-team-name.${side} strong, .completed-comparison-team.${side} strong`
  )?.textContent?.trim() || (side === 'blue' ? 'Blue team' : 'Red team');
}

function teamMarkup(name: string, kills: number | null, side: Side): string {
  return `<div class="mobile-live-parity-team mobile-scoreboard-team ${side}">
    <span>${side === 'blue' ? 'BLUE SIDE' : 'RED SIDE'}</span>
    <strong class="mobile-scoreboard-team-name" title="${esc(name)}">${esc(name)}</strong>
    <small class="mobile-scoreboard-team-kills" aria-label="${esc(name)} kills: ${number(kills)}"><b>KILLS</b><strong>${number(kills)}</strong></small>
  </div>`;
}

function comparisonMarkup(root: HTMLElement, snapshot: LiveSnapshot<LolStats> | null): string {
  const stats = snapshot?.stats ?? null;
  const blueName = fallbackName(root, snapshot, 'blue');
  const redName = fallbackName(root, snapshot, 'red');
  const difference = !stats || stats.blue.gold === null || stats.red.gold === null
    ? null
    : stats.blue.gold - stats.red.gold;
  const leadClass = difference === null || difference === 0 ? 'neutral' : difference > 0 ? 'blue' : 'red';
  const leadSide = difference === null || difference === 0 ? 'none' : difference > 0 ? 'blue' : 'red';
  const lead = difference === null ? '—' : difference === 0 ? 'EVEN' : `+${compact(difference)}`;
  const leadLabel = difference === null
    ? 'Gold lead unavailable'
    : difference === 0
      ? 'Gold is even'
      : `${difference > 0 ? blueName : redName} leads by ${Math.abs(difference).toLocaleString()} gold`;

  return `<header class="mobile-live-parity-team-strip mobile-scoreboard-team-strip">
    ${teamMarkup(blueName, stats?.blue.kills ?? null, 'blue')}
    <div class="mobile-live-parity-gold mobile-scoreboard-gold ${leadClass}" data-leading-side="${leadSide}" aria-label="${esc(leadLabel)}"><span>GOLD LEAD</span><strong>${lead}</strong></div>
    ${teamMarkup(redName, stats?.red.kills ?? null, 'red')}
  </header>
  <section class="mobile-live-parity-objectives mobile-scoreboard-objectives" aria-label="Objectives, blue versus red">
    <div class="mobile-live-parity-objective-title mobile-scoreboard-objective-title">OBJECTIVES · BLUE – RED</div>
    <div class="mobile-live-parity-objective-grid mobile-scoreboard-objective-grid">
      ${OBJECTIVES.map(([key, label]) => {
        const blueValue = objectiveValue(stats?.blue ?? null, key);
        const redValue = objectiveValue(stats?.red ?? null, key);
        return `<div class="mobile-live-parity-objective mobile-scoreboard-objective objective-${key}" aria-label="${label}: blue ${number(blueValue)}, red ${number(redValue)}"><span>${label}</span><div class="mobile-live-parity-objective-values mobile-scoreboard-objective-values"><strong class="blue">${number(blueValue)}</strong><i>–</i><strong class="red">${number(redValue)}</strong></div></div>`;
      }).join('')}
    </div>
  </section>`;
}

function renderKey(root: HTMLElement, snapshot: LiveSnapshot<LolStats> | null, mode: MobileScoreboardMode): string {
  const stats = snapshot?.stats ?? null;
  return JSON.stringify({
    mode,
    gameId: snapshot?.game?.id ?? root.dataset.finalGameId ?? root.dataset.mobileUnifiedGameId ?? '',
    state: root.dataset.liveBoardState ?? snapshot?.game?.state ?? '',
    patch: stats?.patch ?? null,
    teams: [fallbackName(root, snapshot, 'blue'), fallbackName(root, snapshot, 'red')],
    blue: stats ? {
      gold: stats.blue.gold,
      kills: stats.blue.kills,
      objectives: stats.blue.objectives,
      players: stats.blue.players.map(player => [player.id, player.handle, player.championId, player.role, player.kills, player.deaths, player.assists, player.creepScore, player.totalGold])
    } : null,
    red: stats ? {
      gold: stats.red.gold,
      kills: stats.red.kills,
      objectives: stats.red.objectives,
      players: stats.red.players.map(player => [player.id, player.handle, player.championId, player.role, player.kills, player.deaths, player.assists, player.creepScore, player.totalGold])
    } : null
  });
}

function directChild(root: HTMLElement, selector: string): HTMLElement | null {
  return [...root.children].find(child => child instanceof HTMLElement && child.matches(selector)) as HTMLElement | undefined ?? null;
}

function comparisonHost(root: HTMLElement): HTMLElement {
  const existing = directChild(root, '.completed-team-comparison');
  if (existing) return existing;
  const element = document.createElement('section');
  const header = directChild(root, '.completed-final-game-header');
  if (header) header.insertAdjacentElement('afterend', element);
  else root.prepend(element);
  return element;
}

function matchupHost(root: HTMLElement): HTMLElement {
  const existing = directChild(root, '.completed-final-matchups');
  if (existing) return existing;
  const element = document.createElement('div');
  root.append(element);
  return element;
}

function removeLegacyLayers(root: HTMLElement, comparison: HTMLElement, matchups: HTMLElement): void {
  root.querySelectorAll<HTMLElement>(
    ':scope > .mobile-completed-team-names, :scope > .mobile-completed-objectives, :scope > .history-v2-team-header, :scope > .history-v2-summary, :scope > .history-v2-objectives, :scope > .mobile-final-recovery-summary, :scope > .mobile-recovery-matchups'
  ).forEach(element => {
    if (element !== comparison && element !== matchups) element.remove();
  });
}

export function applyMobileScoreboard(
  root: HTMLElement,
  snapshot: LiveSnapshot<LolStats> | null,
  options: MobileScoreboardOptions
): void {
  const key = renderKey(root, snapshot, options.mode);
  const comparison = comparisonHost(root);
  const matchups = matchupHost(root);
  const complete = root.dataset.mobileSharedRenderKey === key
    && comparison.querySelector('.mobile-live-parity-team-strip')
    && comparison.querySelectorAll('.mobile-scoreboard-team-kills').length === 2
    && comparison.querySelectorAll('.mobile-live-parity-objective').length === 4
    && matchups.querySelectorAll('.role-matchup-row').length === 5
    && matchups.querySelectorAll('.role-player-items, .telemetry-item-slot').length === 0;

  root.classList.add('completed-final-game', 'mobile-final-recovery', 'mobile-live-history-board');
  root.dataset.mobileHistoryCopy = 'true';
  root.dataset.mobileLiveDesign = 'history-current';
  root.dataset.mobileScoreboardRenderer = 'shared-v1';
  root.dataset.mobileScoreboardMode = options.mode;
  root.dataset.mobileChampionAssets = CHAMPION_ASSET_VERSION;
  root.dataset.mobileSharedRenderKey = key;
  root.dataset.mobileLiveDesignKey = key;

  comparison.className = 'completed-team-comparison completed-history-dashboard-v2 objective-text-only mobile-live-parity-comparison mobile-unified-scoreboard-comparison';
  comparison.dataset.historyDashboardV2 = 'true';
  comparison.dataset.mobileLiveParity = 'current-history';
  matchups.className = 'role-matchup-list completed-final-matchups mobile-unified-scoreboard-matchups';

  if (!complete) {
    comparison.innerHTML = comparisonMarkup(root, snapshot);
    matchups.innerHTML = matchupMarkup(snapshot?.stats ?? null);
  }

  removeLegacyLayers(root, comparison, matchups);
  void hydrateChampionPortraits(matchups, snapshot?.stats?.patch ?? null);
  root.querySelector<HTMLElement>('.player-board-toolbar')?.setAttribute('data-mobile-live-toolbar', 'hidden');
  document.documentElement.dataset.mobileScoreboardRenderer = 'shared-v1';
  document.documentElement.dataset.mobileScoreboardDetails = 'team-kills-no-items';
  document.documentElement.dataset.mobileChampionAssets = CHAMPION_ASSET_VERSION;
  window.dispatchEvent(new CustomEvent('esports-live:mobile-scoreboard-rendered', {
    detail: { root, snapshot, mode: options.mode }
  }));
}
