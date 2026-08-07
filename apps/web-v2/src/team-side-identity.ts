const TEAM_WORD_STOP = new Set(['TEAM', 'THE', 'IN', 'OF', 'CLUB']);

function normalized(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function titleTeams(value: string | null | undefined): readonly string[] {
  const text = String(value ?? '').trim();
  const separator = ' vs ';
  const index = text.indexOf(separator);
  if (index <= 0) return [];
  const left = text.slice(0, index).trim();
  const right = text.slice(index + separator.length).trim();
  return left && right ? [left, right] : [];
}

function teamAliases(name: string): readonly string[] {
  const words = name
    .split(/\s+/)
    .map(word => word.replace(/[^a-z0-9]/gi, ''))
    .filter(Boolean);
  const aliases = new Set<string>();

  words.forEach(word => {
    if (
      word.length >= 2
      && word.length <= 5
      && word === word.toUpperCase()
      && !TEAM_WORD_STOP.has(word)
    ) {
      aliases.add(word.toUpperCase());
    }
  });

  const acronym = words
    .filter(word => !TEAM_WORD_STOP.has(word.toUpperCase()))
    .map(word => word[0]?.toUpperCase() ?? '')
    .join('');
  if (acronym.length >= 2 && acronym.length <= 5) aliases.add(acronym);

  return [...aliases];
}

function matchesTelemetryName(fullName: string, telemetryName: string): boolean {
  const full = normalized(fullName);
  const telemetry = normalized(telemetryName);
  if (!full || !telemetry) return false;
  if (full === telemetry || full.startsWith(telemetry) || telemetry.startsWith(full)) return true;
  return teamAliases(fullName).some(alias => normalized(alias) === telemetry);
}

function resolvedFullName(candidates: readonly string[], telemetryName: string): string | null {
  const matches = candidates.filter(candidate => matchesTelemetryName(candidate, telemetryName));
  return matches.length === 1 ? matches[0]! : null;
}

function preferredTag(fullName: string, telemetryName: string): string | null {
  const telemetryToken = telemetryName.trim().replace(/[^a-z0-9]/gi, '');
  if (/^[a-z0-9]{2,5}$/i.test(telemetryToken)) return telemetryToken.toUpperCase();
  const aliases = teamAliases(fullName);
  return aliases[0] ?? null;
}

function sameToken(value: string | undefined, tag: string | null): boolean {
  if (!value || !tag) return false;
  return normalized(value) === normalized(tag);
}

function cleanedPlayerName(value: string, ownTag: string | null, otherTag: string | null): string {
  if (!ownTag || !otherTag || normalized(ownTag) === normalized(otherTag)) return value;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return value;

  let removed = 0;
  let removedOther = false;
  while (parts.length > 1 && (sameToken(parts[0], ownTag) || sameToken(parts[0], otherTag))) {
    if (sameToken(parts[0], otherTag)) removedOther = true;
    parts.shift();
    removed += 1;
  }

  if (!removedOther && removed < 2) return value;
  const handle = parts.join(' ').trim();
  return handle ? `${ownTag} ${handle}` : value;
}

export class TeamSideIdentityController {
  readonly #root: HTMLElement;
  #observer: MutationObserver | null = null;
  #syncQueued = false;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  start(): void {
    if (this.#observer) return;
    this.#observer = new MutationObserver(() => this.#queueSync());
    this.#observer.observe(this.#root, {
      subtree: true,
      childList: true,
      characterData: true
    });
    this.#sync();
  }

  stop(): void {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  #queueSync(): void {
    if (this.#syncQueued) return;
    this.#syncQueued = true;
    queueMicrotask(() => {
      this.#syncQueued = false;
      this.#sync();
    });
  }

  #sync(): void {
    const detailTitle = this.#root.querySelector<HTMLElement>('#detail-title');
    const blueName = this.#root.querySelector<HTMLElement>('#blue-name');
    const redName = this.#root.querySelector<HTMLElement>('#red-name');
    if (!detailTitle || !blueName || !redName) return;

    const candidates = titleTeams(detailTitle.textContent);
    if (candidates.length !== 2) return;

    const blueTelemetry = blueName.dataset.telemetryName || blueName.textContent?.trim() || '';
    const redTelemetry = redName.dataset.telemetryName || redName.textContent?.trim() || '';
    if (!blueTelemetry || !redTelemetry) return;

    const blueFull = resolvedFullName(candidates, blueTelemetry);
    const redFull = resolvedFullName(candidates, redTelemetry);
    if (!blueFull || !redFull || blueFull === redFull) return;

    blueName.dataset.telemetryName = blueTelemetry;
    redName.dataset.telemetryName = redTelemetry;
    if (blueName.textContent !== blueFull) blueName.textContent = blueFull;
    if (redName.textContent !== redFull) redName.textContent = redFull;

    const blueTag = preferredTag(blueFull, blueTelemetry);
    const redTag = preferredTag(redFull, redTelemetry);
    if (!blueTag || !redTag) return;

    this.#root.querySelectorAll<HTMLElement>('.blue-player .player-copy strong').forEach(label => {
      const current = label.textContent ?? '';
      const next = cleanedPlayerName(current, blueTag, redTag);
      if (next !== current) label.textContent = next;
    });
    this.#root.querySelectorAll<HTMLElement>('.red-player .player-copy strong').forEach(label => {
      const current = label.textContent ?? '';
      const next = cleanedPlayerName(current, redTag, blueTag);
      if (next !== current) label.textContent = next;
    });
  }
}

export function installTeamSideIdentity(root: HTMLElement): TeamSideIdentityController {
  const controller = new TeamSideIdentityController(root);
  controller.start();
  window.addEventListener('beforeunload', () => controller.stop(), { once: true });
  return controller;
}
