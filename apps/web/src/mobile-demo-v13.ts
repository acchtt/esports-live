import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

type Role = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';

interface ChampionCatalogEntry {
  id?: unknown;
  key?: unknown;
  name?: unknown;
}

interface ChampionCatalogResponse {
  data?: Record<string, ChampionCatalogEntry>;
}

const media = window.matchMedia('(max-width: 760px)');
const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
const ROLE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const DDRAGON_CDN = 'https://ddragon.leagueoflegends.com/cdn';
const COMMUNITY_DRAGON_ICONS = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-icons';
const championCatalogPromises = new Map<string, Promise<ReadonlyMap<string, string>>>();

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active .mobile-app-nav{
    position:fixed!important;
    top:auto!important;
    right:0!important;
    bottom:var(--mobile-demo-visual-bottom,0px)!important;
    left:0!important;
    width:auto!important;
    max-width:none!important;
    margin:0!important;
    transform:none!important;
    translate:none!important
  }

  body.mobile-demo-active .workspace>.panel{
    box-sizing:border-box!important;
    padding-bottom:calc(var(--mobile-demo-nav-height,68px) + 22px + env(safe-area-inset-bottom))!important
  }

  body.mobile-demo-active #completed-match-detail .role-player-portrait{
    display:grid!important;
    place-items:center!important;
    overflow:hidden!important;
    background:rgba(8,17,31,.96)!important
  }
  body.mobile-demo-active #completed-match-detail .role-player-portrait .mobile-completed-champion{
    display:block!important;
    width:100%!important;
    height:100%!important;
    border:0!important;
    border-radius:inherit!important;
    object-fit:cover!important
  }
}`;
document.head.append(style);

function canonicalRole(value: string | null): Role | null {
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
    const role = canonicalRole(player.role);
    if (role && !assigned.has(role)) assigned.set(role, player);
    else extras.push(player);
  }
  return ROLE_ORDER.map(role => assigned.get(role) ?? extras.shift() ?? null);
}

function namedChampionKey(value: unknown): string | null {
  const key = String(value ?? '').replace(/[^a-z0-9]/gi, '');
  if (!key || /^\d+$/.test(key)) return null;
  return ({
    Wukong: 'MonkeyKing',
    NunuWillump: 'Nunu',
    RenataGlasc: 'Renata'
  } as Record<string, string>)[key] ?? key;
}

function championCatalog(version: string): Promise<ReadonlyMap<string, string>> {
  const existing = championCatalogPromises.get(version);
  if (existing) return existing;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  const request = fetch(`${DDRAGON_CDN}/${encodeURIComponent(version)}/data/en_US/champion.json`, {
    cache: 'force-cache',
    signal: controller.signal
  })
    .then(async (response): Promise<ChampionCatalogResponse> => response.ok
      ? await response.json() as ChampionCatalogResponse
      : {})
    .then(payload => {
      const catalog = new Map<string, string>();
      for (const entry of Object.values(payload.data ?? {})) {
        const id = typeof entry.id === 'string' ? entry.id.trim() : '';
        const key = typeof entry.key === 'string' ? entry.key.trim() : '';
        if (!id) continue;
        if (key) catalog.set(key, id);
        catalog.set(id.toLowerCase(), id);
      }
      return catalog;
    })
    .catch(() => new Map<string, string>())
    .finally(() => window.clearTimeout(timeout));

  championCatalogPromises.set(version, request);
  return request;
}

async function championAsset(
  player: LolPlayerState | null,
  version: string
): Promise<{ src: string; fallback: string | null; alt: string } | null> {
  if (!player) return null;
  const raw = String(player.championId ?? '').trim();
  if (!raw) return null;

  const namedKey = namedChampionKey(raw);
  if (namedKey) {
    return {
      src: `${DDRAGON_CDN}/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(namedKey)}.png`,
      fallback: null,
      alt: `${raw} portrait`
    };
  }

  if (!/^\d+$/.test(raw)) return null;
  const catalog = await championCatalog(version);
  const resolved = catalog.get(raw) ?? null;
  const fallback = `${COMMUNITY_DRAGON_ICONS}/${encodeURIComponent(raw)}.png`;
  return {
    src: resolved
      ? `${DDRAGON_CDN}/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(resolved)}.png`
      : fallback,
    fallback: resolved ? fallback : null,
    alt: `${resolved ?? 'Champion'} portrait`
  };
}

async function installPortrait(
  target: HTMLElement | null,
  player: LolPlayerState | null,
  version: string
): Promise<void> {
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

async function hydrateNumericPortraits(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): Promise<void> {
  if (!media.matches || !snapshot.stats) return;
  const rows = [...root.querySelectorAll<HTMLElement>('.completed-final-matchups .role-matchup-row')];
  if (!rows.length) return;

  const version = snapshot.stats.patch?.trim();
  if (!version) return;
  const bluePlayers = orderedPlayers(snapshot.stats.blue);
  const redPlayers = orderedPlayers(snapshot.stats.red);

  await Promise.all(rows.flatMap((row, index) => [
    installPortrait(
      row.querySelector<HTMLElement>('.role-player.blue .role-player-portrait'),
      bluePlayers[index] ?? null,
      version
    ),
    installPortrait(
      row.querySelector<HTMLElement>('.role-player.red .role-player-portrait'),
      redPlayers[index] ?? null,
      version
    )
  ]));
}

function syncNavigationGeometry(): void {
  if (!nav || !media.matches) {
    document.documentElement.style.removeProperty('--mobile-demo-nav-height');
    document.documentElement.style.removeProperty('--mobile-demo-visual-bottom');
    return;
  }

  const height = Math.ceil(nav.getBoundingClientRect().height);
  const viewport = window.visualViewport;
  const visualBottom = viewport
    ? Math.max(0, Math.round(window.innerHeight - viewport.offsetTop - viewport.height))
    : 0;
  document.documentElement.style.setProperty('--mobile-demo-nav-height', `${height}px`);
  document.documentElement.style.setProperty('--mobile-demo-visual-bottom', `${visualBottom}px`);
}

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot && detail.root) void hydrateNumericPortraits(detail.snapshot, detail.root);
});

if (nav) {
  nav.dataset.mobileNavVersion = '0.13';
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncNavigationGeometry).observe(nav);
}

if (typeof media.addEventListener === 'function') media.addEventListener('change', syncNavigationGeometry);
else if (typeof media.addListener === 'function') media.addListener(syncNavigationGeometry);
window.visualViewport?.addEventListener('resize', syncNavigationGeometry);
window.visualViewport?.addEventListener('scroll', syncNavigationGeometry);
window.addEventListener('resize', syncNavigationGeometry);
window.addEventListener('orientationchange', syncNavigationGeometry);
window.addEventListener('pageshow', syncNavigationGeometry);
syncNavigationGeometry();

export {};
