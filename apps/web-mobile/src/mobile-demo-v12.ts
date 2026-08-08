import type { LiveSnapshot } from '@esports-live/core';
import type { LolPlayerState, LolStats, LolTeamState } from '@esports-live/adapter-lol';

type Side = 'blue' | 'red';
type Role = 'top' | 'jungle' | 'mid' | 'bottom' | 'support';

const media = window.matchMedia('(max-width: 760px)');
const ROLE_ORDER: readonly Role[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const DDRAGON_CDN = 'https://ddragon.leagueoflegends.com/cdn';
let ddragonVersionsPromise: Promise<readonly string[]> | null = null;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active #completed-match-detail .completed-team-comparison{
    display:none!important
  }
  body.mobile-demo-active #completed-match-detail .role-player-portrait{
    overflow:hidden!important
  }
  body.mobile-demo-active #completed-match-detail .mobile-completed-champion{
    display:block!important;
    width:100%!important;
    height:100%!important;
    object-fit:cover!important
  }
}`;
document.head.append(style);

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function compactGold(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${(absolute / 1_000).toFixed(0)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return absolute.toLocaleString();
}

function isPlaceholderTeamName(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return /^(team ?[12]|blue( side| team)?|red( side| team)?|unknown|tbd|—)$/.test(normalized);
}

function resolvedTeamName(
  snapshot: LiveSnapshot<LolStats>,
  root: HTMLElement,
  side: Side
): string {
  const statsTeam = snapshot.stats?.[side];
  if (!statsTeam) return side === 'blue' ? 'Blue side' : 'Red side';

  const seriesName = snapshot.series.teams.find(team => team.id === statsTeam.id)?.name?.trim() ?? '';
  const comparisonName = root
    .querySelector<HTMLElement>(`.completed-comparison-team.${side} strong`)
    ?.textContent?.trim() ?? '';
  const statsName = statsTeam.name.trim();
  const candidates = [seriesName, comparisonName, statsName].filter(Boolean);
  return candidates.find(name => !isPlaceholderTeamName(name)) ?? candidates[0] ?? statsName;
}

function renderCompactHeader(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!snapshot.stats) return;
  const strip = root.querySelector<HTMLElement>('.mobile-completed-team-names');
  if (!strip) return;

  const blueName = resolvedTeamName(snapshot, root, 'blue');
  const redName = resolvedTeamName(snapshot, root, 'red');
  const blueGold = snapshot.stats.blue.gold;
  const redGold = snapshot.stats.red.gold;
  const difference = blueGold === null || redGold === null ? null : blueGold - redGold;
  const leadingSide: Side | null = difference === null || difference === 0
    ? null
    : difference > 0 ? 'blue' : 'red';
  const amount = difference === null ? '—' : difference === 0 ? 'EVEN' : `+${compactGold(difference)}`;
  const className = difference === null ? 'unknown' : difference === 0 ? 'even' : leadingSide!;
  const stateLabel = difference === null
    ? 'Gold lead unavailable'
    : difference === 0
      ? 'Gold is even'
      : `${leadingSide === 'blue' ? blueName : redName} leads by ${compactGold(difference)} gold`;

  strip.removeAttribute('data-trailing-side');
  strip.dataset.leadingSide = leadingSide ?? className;
  strip.setAttribute('aria-label', `Teams and overall gold comparison. ${stateLabel}.`);
  strip.innerHTML = `
    <div class="mobile-completed-team-name blue${leadingSide === 'blue' ? ' leading' : ''}">
      <small>Blue side</small>
      <strong title="${escapeHtml(blueName)}">${escapeHtml(blueName)}</strong>
    </div>
    <span class="mobile-completed-gold-lead ${className}" aria-label="${escapeHtml(stateLabel)}">
      <small>Gold lead</small>
      <strong>${amount}</strong>
    </span>
    <div class="mobile-completed-team-name red${leadingSide === 'red' ? ' leading' : ''}">
      <small>Red side</small>
      <strong title="${escapeHtml(redName)}">${escapeHtml(redName)}</strong>
    </div>`;
}

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

function championKey(value: string | null): string | null {
  const key = value?.replace(/[^a-z0-9]/gi, '') ?? '';
  if (!key || /^\d+$/.test(key)) return null;
  return ({ Wukong: 'MonkeyKing', NunuWillump: 'Nunu', RenataGlasc: 'Renata' } as Record<string, string>)[key] ?? key;
}

function ddragonVersions(): Promise<readonly string[]> {
  if (ddragonVersionsPromise) return ddragonVersionsPromise;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4_000);
  ddragonVersionsPromise = fetch(DDRAGON_VERSIONS, { cache: 'force-cache', signal: controller.signal })
    .then(response => response.ok ? response.json() : [])
    .then(value => Array.isArray(value) ? value.filter(entry => typeof entry === 'string') : [])
    .catch(() => [])
    .finally(() => window.clearTimeout(timeout));
  return ddragonVersionsPromise;
}

async function ddragonVersion(patch: string | null): Promise<string | null> {
  const versions = await ddragonVersions();
  const patchPrefix = patch?.match(/^(\d+\.\d+)\./)?.[1];
  return versions.find(version => patchPrefix && version.startsWith(`${patchPrefix}.`))
    ?? versions[0]
    ?? null;
}

function installPortrait(
  target: HTMLElement | null,
  player: LolPlayerState | null,
  version: string
): void {
  if (!target || !player) return;
  const key = championKey(player.championId);
  if (!key) return;
  const champion = player.championId ?? 'Champion';
  target.innerHTML = `<img class="mobile-completed-champion" src="${DDRAGON_CDN}/${encodeURIComponent(version)}/img/champion/${encodeURIComponent(key)}.png" alt="${escapeHtml(champion)} portrait">`;
}

async function hydratePrimaryPortraits(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): Promise<void> {
  if (!snapshot.stats) return;
  const rows = [...root.querySelectorAll<HTMLElement>('.completed-final-matchups .role-matchup-row')];
  if (!rows.length) return;
  const version = await ddragonVersion(snapshot.stats.patch);
  if (!version || !root.isConnected) return;

  const bluePlayers = orderedPlayers(snapshot.stats.blue);
  const redPlayers = orderedPlayers(snapshot.stats.red);
  rows.forEach((row, index) => {
    installPortrait(
      row.querySelector<HTMLElement>('.role-player.blue .role-player-portrait'),
      bluePlayers[index] ?? null,
      version
    );
    installPortrait(
      row.querySelector<HTMLElement>('.role-player.red .role-player-portrait'),
      redPlayers[index] ?? null,
      version
    );
  });
}

function refinePrimaryBoard(snapshot: LiveSnapshot<LolStats>, root: HTMLElement): void {
  if (!media.matches || !snapshot.stats || !root.closest('#completed-match-detail')) return;
  renderCompactHeader(snapshot, root);
  root.querySelector('.completed-team-comparison')?.remove();
  void hydratePrimaryPortraits(snapshot, root);
}

window.addEventListener('esports-live:ended-snapshot', event => {
  const detail = (event as CustomEvent<{ snapshot?: LiveSnapshot<LolStats>; root?: HTMLElement }>).detail;
  if (detail?.snapshot && detail.root) refinePrimaryBoard(detail.snapshot, detail.root);
});

const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
if (nav) nav.dataset.mobileNavVersion = '0.12';

export {};
