import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import './live-gold-lead-bar.css';

const gameContent = document.querySelector<HTMLElement>('#game-content');

let latestSnapshot: LiveSnapshot<LolStats> | null = null;
let animationFrame: number | null = null;

function formatCompact(value: number | null): string {
  if (value === null) return '—';
  return Math.abs(value) >= 1000
    ? `${(value / 1000).toFixed(1)}K`
    : value.toLocaleString();
}

function sourceTime(snapshot: LiveSnapshot<LolStats>): number | null {
  const parsed = Date.parse(snapshot.quality.sourceTimestamp ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function acceptsSnapshot(incoming: LiveSnapshot<LolStats>): boolean {
  const previous = latestSnapshot;
  if (!previous || previous.game.id !== incoming.game.id) return true;

  const previousSource = sourceTime(previous);
  const incomingSource = sourceTime(incoming);
  if (previousSource !== null && incomingSource !== null && incomingSource < previousSource) {
    return false;
  }

  const previousClock = previous.stats?.gameClockSeconds ?? null;
  const incomingClock = incoming.stats?.gameClockSeconds ?? null;
  return !(
    previousClock !== null
    && incomingClock !== null
    && incomingClock + 2 < previousClock
  );
}

function goldLeadRatio(blueGold: number | null, redGold: number | null): number | null {
  if (blueGold === null || redGold === null) return null;
  const blue = Math.max(0, blueGold);
  const red = Math.max(0, redGold);
  const trailingGold = Math.max(10_000, Math.min(blue, red));
  return Math.abs(blue - red) / trailingGold;
}

function goldShare(blueGold: number | null, redGold: number | null): number {
  if (blueGold === null || redGold === null) return 50;
  const difference = blueGold - redGold;
  if (difference === 0) return 50;

  const relativeLead = goldLeadRatio(blueGold, redGold) ?? 0;
  const visualShift = Math.tanh(relativeLead * 5) * 36;
  return Math.min(86, Math.max(14, 50 + Math.sign(difference) * visualShift));
}

function leadIntensity(ratio: number | null): 'unknown' | 'close' | 'clear' | 'major' | 'dominant' {
  if (ratio === null) return 'unknown';
  if (ratio >= 0.2) return 'dominant';
  if (ratio >= 0.1) return 'major';
  if (ratio >= 0.05) return 'clear';
  return 'close';
}

function applyGoldLeadBar(): void {
  animationFrame = null;
  const snapshot = latestSnapshot;
  if (!snapshot?.stats) return;

  const dashboard = [...document.querySelectorAll<HTMLElement>('.live-dashboard-v2')]
    .find(element => element.dataset.liveDashboardGameId === snapshot.game.id);
  const card = dashboard?.querySelector<HTMLElement>('.v2-gold-card');
  const leaderElement = card?.querySelector<HTMLElement>(':scope > strong');
  const comparisonElement = card?.querySelector<HTMLElement>(':scope > small');
  const bar = card?.querySelector<HTMLElement>('.v2-gold-bars');
  if (!card || !leaderElement || !comparisonElement || !bar) return;

  const { blue, red } = snapshot.stats;
  const difference = blue.gold === null || red.gold === null
    ? null
    : blue.gold - red.gold;
  const ratio = goldLeadRatio(blue.gold, red.gold);
  const blueShare = goldShare(blue.gold, red.gold);
  const redShare = 100 - blueShare;
  const leader = difference === null
    ? 'Gold unavailable'
    : difference === 0
      ? 'Gold even'
      : `${difference > 0 ? blue.name : red.name} +${formatCompact(Math.abs(difference))}`;
  const leaderClass = difference === null
    ? 'neutral'
    : difference > 0
      ? 'blue'
      : difference < 0
        ? 'red'
        : 'neutral';
  const intensity = leadIntensity(ratio);
  const comparison = `${formatCompact(blue.gold)} vs ${formatCompact(red.gold)}`;
  const context = ratio === null || difference === 0
    ? comparison
    : `${comparison} · ${(ratio * 100).toFixed(1)}% lead`;
  const signature = JSON.stringify([
    snapshot.game.id,
    blue.gold,
    red.gold,
    blue.name,
    red.name,
    intensity
  ]);
  if (card.dataset.dynamicGoldSignature === signature) return;

  card.classList.remove(
    'lead-unknown',
    'lead-close',
    'lead-clear',
    'lead-major',
    'lead-dominant'
  );
  card.classList.add('dynamic-gold-v3', `lead-${intensity}`);
  card.dataset.dynamicGoldSignature = signature;
  card.style.setProperty('--blue-gold-share', `${blueShare.toFixed(3)}%`);
  card.style.setProperty('--red-gold-share', `${redShare.toFixed(3)}%`);

  leaderElement.classList.remove('blue', 'red', 'neutral');
  leaderElement.classList.add(leaderClass);
  leaderElement.textContent = leader;
  comparisonElement.textContent = context;
  bar.setAttribute('role', 'img');
  bar.setAttribute(
    'aria-label',
    `${blue.name} ${formatCompact(blue.gold)} versus ${red.name} ${formatCompact(red.gold)}. ${leader}.`
  );
}

function queueGoldLeadBar(): void {
  if (animationFrame !== null) return;
  animationFrame = window.requestAnimationFrame(applyGoldLeadBar);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.stats || !acceptsSnapshot(snapshot)) return;
  latestSnapshot = snapshot;
  queueGoldLeadBar();
});

window.addEventListener('esports-live:selection', () => {
  latestSnapshot = null;
  if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
  animationFrame = null;
});

if (gameContent) {
  const observer = new MutationObserver(queueGoldLeadBar);
  observer.observe(gameContent, { childList: true });
}

export {};
