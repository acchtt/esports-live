interface MomentumPoint {
  clock: number;
  gold: number;
}

const MAX_POINTS = 60;
const MOMENTUM_STORAGE_PREFIX = 'arena-v3-momentum:';

function isV2BaselinePath(pathname = window.location.pathname): boolean {
  return pathname === '/v2' || pathname.startsWith('/v2/');
}

function gameClockSeconds(value: string): number | null {
  const match = value.trim().match(/^(\d+):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function compactValue(value: string): number | null {
  const normalized = value.trim().toUpperCase().replace(/,/g, '');
  if (!normalized || normalized === '—' || normalized === 'EVEN') return normalized === 'EVEN' ? 0 : null;
  const match = normalized.match(/^\+?([0-9]+(?:\.[0-9]+)?)([KM])?$/);
  if (!match) return null;
  const multiplier = match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1_000 : 1;
  return Number(match[1]) * multiplier;
}

function signedGold(element: HTMLElement): number | null {
  const amount = compactValue(element.textContent ?? '');
  if (amount === null || amount === 0) return amount;
  if (element.dataset.side === 'red') return -Math.abs(amount);
  if (element.dataset.side === 'blue') return Math.abs(amount);
  return 0;
}

function loadMomentum(gameId: string): MomentumPoint[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(`${MOMENTUM_STORAGE_PREFIX}${gameId}`) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((point): point is MomentumPoint => (
        Boolean(point)
        && typeof point === 'object'
        && Number.isFinite((point as MomentumPoint).clock)
        && Number.isFinite((point as MomentumPoint).gold)
      ))
      .slice(-MAX_POINTS);
  } catch {
    return [];
  }
}

function saveMomentum(gameId: string, points: readonly MomentumPoint[]): void {
  try {
    sessionStorage.setItem(`${MOMENTUM_STORAGE_PREFIX}${gameId}`, JSON.stringify(points.slice(-MAX_POINTS)));
  } catch {
    // Session storage is optional; the live chart still works in-memory.
  }
}

function sparkPath(points: readonly MomentumPoint[]): string {
  if (!points.length) return '';
  const max = Math.max(1_000, ...points.map(point => Math.abs(point.gold)));
  const startClock = points[0]?.clock ?? 0;
  const endClock = points[points.length - 1]?.clock ?? startClock + 1;
  const span = Math.max(1, endClock - startClock);
  return points.map((point, index) => {
    const x = ((point.clock - startClock) / span) * 100;
    const y = 16 - (point.gold / max) * 13;
    return `${index ? 'L' : 'M'}${x.toFixed(2)},${Math.max(2, Math.min(30, y)).toFixed(2)}`;
  }).join(' ');
}

function sideCopy(value: number | null): string {
  if (value === null) return 'Gold trend waiting';
  if (value === 0) return 'Gold even';
  const amount = Math.abs(value);
  const compact = amount >= 10_000
    ? `${Math.round(amount / 1_000)}K`
    : amount >= 1_000
      ? `${(amount / 1_000).toFixed(1).replace(/\.0$/, '')}K`
      : Math.round(amount).toLocaleString();
  return `${value > 0 ? 'BLUE' : 'RED'} +${compact}`;
}

function meaningfulText(value: string): boolean {
  const text = value.trim();
  return Boolean(text && text !== '—' && text !== '--:--');
}

export function installMatchExperience(root: HTMLElement): () => void {
  if (isV2BaselinePath()) return () => undefined;
  const matchPanel = root.querySelector<HTMLElement>('#match-panel');
  const detailHeader = root.querySelector<HTMLElement>('.detail-header');
  const scoreboard = root.querySelector<HTMLElement>('#scoreboard');
  const teamBanner = scoreboard?.querySelector<HTMLElement>('.team-banner');
  const gold = root.querySelector<HTMLElement>('#gold-lead');
  const clock = root.querySelector<HTMLElement>('#game-clock');
  if (!matchPanel || !detailHeader || !scoreboard || !teamBanner || !gold || !clock) return () => undefined;

  const momentum = document.createElement('section');
  momentum.className = 'arena-momentum';
  momentum.hidden = true;
  momentum.innerHTML = `
    <div class="arena-momentum-copy">
      <span>MOMENTUM</span>
      <strong data-momentum-current>Collecting live trend…</strong>
      <small data-momentum-range>Gold lead over this game session</small>
    </div>
    <svg class="arena-momentum-chart" viewBox="0 0 100 32" preserveAspectRatio="none" aria-label="Gold lead momentum">
      <path class="arena-momentum-zero" d="M0,16 L100,16"></path>
      <path class="arena-momentum-line" data-momentum-line d=""></path>
    </svg>`;
  teamBanner.after(momentum);

  const mini = document.createElement('aside');
  mini.className = 'arena-mini-match';
  mini.dataset.visible = 'false';
  mini.setAttribute('aria-hidden', 'true');
  mini.innerHTML = `
    <div class="arena-mini-score">
      <strong data-mini-blue>Blue</strong>
      <b data-mini-kills>—–—</b>
      <strong data-mini-red>Red</strong>
    </div>
    <div class="arena-mini-meta">
      <span data-mini-game>Game</span>
      <span data-mini-clock>--:--</span>
      <b data-mini-gold>Gold even</b>
    </div>`;
  root.querySelector<HTMLElement>('.v2-shell')?.append(mini);

  const pointsByGame = new Map<string, MomentumPoint[]>();
  const previousValues = new Map<string, string>();
  const flashTimers = new WeakMap<HTMLElement, number>();
  let currentGameId = '';
  let syncQueued = false;
  let scrollFrame: number | null = null;

  const flash = (element: HTMLElement, side: 'blue' | 'red' | 'neutral'): void => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const existing = flashTimers.get(element);
    if (existing) window.clearTimeout(existing);
    element.classList.remove('arena-stat-changed', 'arena-stat-blue', 'arena-stat-red');
    element.classList.add('arena-stat-changed');
    if (side === 'blue') element.classList.add('arena-stat-blue');
    if (side === 'red') element.classList.add('arena-stat-red');
    const timer = window.setTimeout(() => {
      element.classList.remove('arena-stat-changed', 'arena-stat-blue', 'arena-stat-red');
      flashTimers.delete(element);
    }, 520);
    flashTimers.set(element, timer);
  };

  const watchMeaningfulChanges = (): void => {
    const gameId = scoreboard.dataset.gameId ?? '';
    if (gameId !== currentGameId) {
      currentGameId = gameId;
      previousValues.clear();
    }
    const targets: Array<{ key: string; element: HTMLElement | null; side: 'blue' | 'red' | 'neutral' }> = [
      { key: 'blue-kills', element: root.querySelector<HTMLElement>('#blue-kills'), side: 'blue' },
      { key: 'red-kills', element: root.querySelector<HTMLElement>('#red-kills'), side: 'red' },
      { key: 'gold', element: root.querySelector<HTMLElement>('.gold-card'), side: gold.dataset.side === 'blue' ? 'blue' : gold.dataset.side === 'red' ? 'red' : 'neutral' }
    ];
    scoreboard.querySelectorAll<HTMLElement>('[data-objective]').forEach(card => {
      const objective = card.dataset.objective ?? 'objective';
      targets.push(
        { key: `${objective}-blue`, element: card.querySelector<HTMLElement>('[data-side="blue"]'), side: 'blue' },
        { key: `${objective}-red`, element: card.querySelector<HTMLElement>('[data-side="red"]'), side: 'red' }
      );
    });

    targets.forEach(({ key, element, side }) => {
      if (!element) return;
      const value = key === 'gold' ? gold.textContent ?? '' : element.textContent ?? '';
      const previous = previousValues.get(key);
      previousValues.set(key, value);
      if (previous === undefined || previous === value || !meaningfulText(previous) || !meaningfulText(value)) return;
      flash(element, side);
    });
  };

  const renderMomentum = (): void => {
    const gameId = scoreboard.dataset.gameId?.trim() ?? '';
    const state = scoreboard.dataset.gameState ?? '';
    const live = state === 'live' || state === 'draft' || state === 'paused';
    momentum.hidden = !live || !gameId;
    if (!live || !gameId) return;

    let points = pointsByGame.get(gameId);
    if (!points) {
      points = loadMomentum(gameId);
      pointsByGame.set(gameId, points);
    }
    const seconds = gameClockSeconds(clock.textContent ?? '');
    const difference = signedGold(gold);
    if (seconds !== null && difference !== null) {
      const last = points[points.length - 1];
      if (!last || seconds > last.clock) {
        points.push({ clock: seconds, gold: difference });
        if (points.length > MAX_POINTS) points.splice(0, points.length - MAX_POINTS);
        saveMomentum(gameId, points);
      } else if (last.clock === seconds && last.gold !== difference) {
        last.gold = difference;
        saveMomentum(gameId, points);
      }
    }

    const latest = points[points.length - 1]?.gold ?? difference;
    momentum.dataset.side = latest === null || latest === 0 ? 'neutral' : latest > 0 ? 'blue' : 'red';
    momentum.dataset.points = String(points.length);
    const current = momentum.querySelector<HTMLElement>('[data-momentum-current]');
    const range = momentum.querySelector<HTMLElement>('[data-momentum-range]');
    const path = momentum.querySelector<SVGPathElement>('[data-momentum-line]');
    if (current) current.textContent = points.length < 2 ? 'Collecting live trend…' : sideCopy(latest);
    if (range) {
      const firstClock = points[0]?.clock;
      const lastClock = points[points.length - 1]?.clock;
      range.textContent = firstClock !== undefined && lastClock !== undefined && lastClock > firstClock
        ? `Gold movement across ${Math.max(1, Math.round((lastClock - firstClock) / 60))} min observed`
        : 'Gold lead over this game session';
    }
    path?.setAttribute('d', sparkPath(points));
  };

  const updateMiniContent = (): void => {
    const blueName = root.querySelector<HTMLElement>('#blue-name')?.textContent?.trim() || 'Blue';
    const redName = root.querySelector<HTMLElement>('#red-name')?.textContent?.trim() || 'Red';
    const blueKills = root.querySelector<HTMLElement>('#blue-kills')?.textContent?.trim() || '—';
    const redKills = root.querySelector<HTMLElement>('#red-kills')?.textContent?.trim() || '—';
    const game = root.querySelector<HTMLElement>('#game-label')?.textContent?.trim() || 'Game';
    const gameClock = clock.textContent?.trim() || '--:--';
    mini.querySelector<HTMLElement>('[data-mini-blue]')!.textContent = blueName;
    mini.querySelector<HTMLElement>('[data-mini-red]')!.textContent = redName;
    mini.querySelector<HTMLElement>('[data-mini-kills]')!.textContent = `${blueKills}–${redKills}`;
    mini.querySelector<HTMLElement>('[data-mini-game]')!.textContent = game;
    mini.querySelector<HTMLElement>('[data-mini-clock]')!.textContent = gameClock;
    mini.querySelector<HTMLElement>('[data-mini-gold]')!.textContent = sideCopy(signedGold(gold));
  };

  const updateMiniVisibility = (): void => {
    scrollFrame = null;
    const visible = !matchPanel.hidden && detailHeader.getBoundingClientRect().bottom < 6;
    mini.dataset.visible = String(visible);
    mini.setAttribute('aria-hidden', String(!visible));
  };

  const scheduleMiniVisibility = (): void => {
    if (scrollFrame !== null) return;
    scrollFrame = window.requestAnimationFrame(updateMiniVisibility);
  };

  const sync = (): void => {
    syncQueued = false;
    watchMeaningfulChanges();
    renderMomentum();
    updateMiniContent();
    scheduleMiniVisibility();
  };

  const queueSync = (): void => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(sync);
  };

  const scoreboardObserver = new MutationObserver(queueSync);
  scoreboardObserver.observe(scoreboard, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-game-id', 'data-game-state', 'data-side']
  });
  const panelObserver = new MutationObserver(queueSync);
  panelObserver.observe(matchPanel, { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('scroll', scheduleMiniVisibility, { passive: true });
  window.addEventListener('resize', scheduleMiniVisibility, { passive: true });
  queueSync();

  return () => {
    scoreboardObserver.disconnect();
    panelObserver.disconnect();
    window.removeEventListener('scroll', scheduleMiniVisibility);
    window.removeEventListener('resize', scheduleMiniVisibility);
    if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
    mini.remove();
    momentum.remove();
  };
}
