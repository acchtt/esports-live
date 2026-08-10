type PlayerSide = 'blue' | 'red';
type RoleKey = 'top' | 'jungle' | 'mid' | 'bottom' | 'support' | 'player';

interface PlayerTelemetry {
  id?: string;
  handle?: string | null;
  championId?: string | null;
  role?: string | null;
  level?: number | null;
  kills?: number | null;
  deaths?: number | null;
  assists?: number | null;
  creepScore?: number | null;
  totalGold?: number | null;
}

interface TeamTelemetry {
  players?: readonly PlayerTelemetry[];
}

interface SnapshotTelemetry {
  game?: { id?: string | null } | null;
  stats?: {
    blue?: TeamTelemetry | null;
    red?: TeamTelemetry | null;
  } | null;
}

interface PlayerPair {
  role: RoleKey;
  blue: PlayerTelemetry | null;
  red: PlayerTelemetry | null;
}

const ROLE_ORDER: readonly Exclude<RoleKey, 'player'>[] = ['top', 'jungle', 'mid', 'bottom', 'support'];
const CHAMPION_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  AurelionSol: 'Aurelion Sol',
  Belveth: "Bel'Veth",
  Chogath: "Cho'Gath",
  DrMundo: 'Dr. Mundo',
  JarvanIV: 'Jarvan IV',
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  KSante: "K'Sante",
  LeeSin: 'Lee Sin',
  MasterYi: 'Master Yi',
  MissFortune: 'Miss Fortune',
  MonkeyKing: 'Wukong',
  Nunu: 'Nunu & Willump',
  RekSai: "Rek'Sai",
  Renata: 'Renata Glasc',
  TahmKench: 'Tahm Kench',
  TwistedFate: 'Twisted Fate',
  Velkoz: "Vel'Koz",
  XinZhao: 'Xin Zhao'
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function snapshotTelemetry(value: unknown): SnapshotTelemetry | null {
  const source = object(value);
  if (!source) return null;
  const game = object(source.game);
  const gameId = typeof game?.id === 'string' ? game.id.trim() : '';
  if (!gameId) return null;
  return value as SnapshotTelemetry;
}

function roleKey(value: string | null | undefined): RoleKey {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.includes('top')) return 'top';
  if (normalized.includes('jung')) return 'jungle';
  if (normalized.includes('mid')) return 'mid';
  if (normalized.includes('bot') || normalized.includes('adc') || normalized.includes('carry')) return 'bottom';
  if (normalized.includes('sup') || normalized.includes('utility')) return 'support';
  return 'player';
}

function playerPairs(
  blue: readonly PlayerTelemetry[],
  red: readonly PlayerTelemetry[]
): readonly PlayerPair[] {
  const blueRemaining = [...blue];
  const redRemaining = [...red];
  const pairs: PlayerPair[] = [];

  ROLE_ORDER.forEach(role => {
    const blueIndex = blueRemaining.findIndex(player => roleKey(player.role) === role);
    const redIndex = redRemaining.findIndex(player => roleKey(player.role) === role);
    if (blueIndex < 0 && redIndex < 0) return;
    pairs.push({
      role,
      blue: blueIndex >= 0 ? blueRemaining.splice(blueIndex, 1)[0] ?? null : null,
      red: redIndex >= 0 ? redRemaining.splice(redIndex, 1)[0] ?? null : null
    });
  });

  const remainder = Math.max(blueRemaining.length, redRemaining.length);
  for (let index = 0; index < remainder; index += 1) {
    pairs.push({
      role: 'player',
      blue: blueRemaining[index] ?? null,
      red: redRemaining[index] ?? null
    });
  }
  return pairs;
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString();
}

function formatKda(player: PlayerTelemetry | null): string {
  if (!player) return '—/—/—';
  return `${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)}`;
}

function compactLead(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10_000) return `${Math.round(absolute / 1_000)}K`;
  if (absolute >= 1_000) return `${(absolute / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(absolute);
}

function laneGoldDifference(blue: PlayerTelemetry | null, red: PlayerTelemetry | null): number | null {
  if (blue?.totalGold === null || blue?.totalGold === undefined) return null;
  if (red?.totalGold === null || red?.totalGold === undefined) return null;
  return blue.totalGold - red.totalGold;
}

function decorateLaneGold(row: HTMLElement, blue: PlayerTelemetry | null, red: PlayerTelemetry | null): void {
  const lead = row.querySelector<HTMLElement>('.lane-gold');
  if (!lead) return;
  const difference = laneGoldDifference(blue, red);
  const text = difference === null ? '—' : difference === 0 ? 'EVEN' : `+${compactLead(difference)}`;
  if (lead.textContent !== text) lead.textContent = text;
  lead.dataset.side = difference === null || difference === 0
    ? 'neutral'
    : difference > 0 ? 'blue' : 'red';
}

function championDisplayName(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Champion pending';
  const key = raw.replace(/[^a-z0-9]/gi, '');
  if (!key) return raw;
  const mapped = CHAMPION_DISPLAY_NAMES[key];
  if (mapped) return mapped;
  if (/^\d+$/.test(key)) return `Champion ${key}`;
  return raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isSnapshotRequest(input: RequestInfo | URL): boolean {
  try {
    const path = new URL(requestUrl(input), window.location.href).pathname;
    return /\/v1\/lol\/games\/[^/]+\/live$/.test(path);
  } catch {
    return false;
  }
}

function ensureChampionLine(copy: HTMLElement): HTMLElement {
  let meta = copy.querySelector<HTMLElement>('.player-champion-meta');
  let line = copy.querySelector<HTMLElement>('.player-champion');

  if (!meta) {
    meta = document.createElement('div');
    meta.className = 'player-champion-meta';
    if (line) {
      const name = line.querySelector<HTMLElement>('.player-champion-name')?.textContent
        ?? line.textContent
        ?? '';
      line.textContent = name.trim();
      meta.append(line);
    } else {
      line = document.createElement('small');
      line.className = 'player-champion';
      meta.append(line);
    }
    copy.append(meta);
  } else if (!line) {
    line = document.createElement('small');
    line.className = 'player-champion';
    meta.prepend(line);
  }

  return line;
}

function normalizedLevel(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : null;
}

function decorateChampionLevel(champion: HTMLElement, player: PlayerTelemetry | null): void {
  const meta = champion.closest<HTMLElement>('.player-champion-meta');
  if (!meta) return;

  const level = normalizedLevel(player?.level);
  const existing = meta.querySelector<HTMLElement>('.champion-level');
  if (level === null) {
    existing?.remove();
    return;
  }

  const badge = existing ?? document.createElement('b');
  const text = `Lv ${level}`;
  const label = `Level ${level}`;
  badge.className = 'champion-level';
  if (badge.textContent !== text) badge.textContent = text;
  if (badge.getAttribute('aria-label') !== label) badge.setAttribute('aria-label', label);
  if (!existing) meta.append(badge);
}

function decorateSide(row: HTMLElement, side: PlayerSide, player: PlayerTelemetry | null): void {
  const copy = row.querySelector<HTMLElement>(`.${side}-player .player-copy`);
  if (!copy) return;

  const statLine = copy.querySelector<HTMLElement>('span');
  if (statLine) {
    statLine.classList.add('player-statline');
    const text = `${formatKda(player)} · ${formatNumber(player?.creepScore)} CS`;
    if (statLine.textContent !== text) statLine.textContent = text;
  }

  const champion = ensureChampionLine(copy);
  const championName = championDisplayName(player?.championId);
  if (champion.textContent !== championName) champion.textContent = championName;
  decorateChampionLevel(champion, player);
}

export function installPlayerBoardCopy(root: HTMLElement): () => void {
  const snapshots = new Map<string, SnapshotTelemetry>();
  const nativeFetch = window.fetch.bind(window);

  const scan = (): void => {
    const scoreboard = root.querySelector<HTMLElement>('#scoreboard');
    const gameId = scoreboard?.dataset.gameId?.trim() ?? '';
    if (!gameId) return;
    const snapshot = snapshots.get(gameId);
    const stats = snapshot?.stats;
    if (!stats) return;

    const pairs = playerPairs(stats.blue?.players ?? [], stats.red?.players ?? []);
    root.querySelectorAll<HTMLElement>('.player-board .player-row').forEach((row, index) => {
      const pair = pairs[index];
      if (!pair) return;
      decorateSide(row, 'blue', pair.blue);
      decorateSide(row, 'red', pair.red);
      decorateLaneGold(row, pair.blue, pair.red);
    });
  };

  const wrappedFetch: typeof window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (response.ok && isSnapshotRequest(args[0])) {
      void response.clone().json().then(value => {
        const snapshot = snapshotTelemetry(value);
        const gameId = snapshot?.game?.id?.trim() ?? '';
        if (!snapshot || !gameId) return;
        snapshots.set(gameId, snapshot);
        queueMicrotask(scan);
      }).catch(() => undefined);
    }
    return response;
  };

  window.fetch = wrappedFetch;

  const observer = new MutationObserver(scan);
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-game-id']
  });
  scan();

  return () => {
    observer.disconnect();
    if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
  };
}
