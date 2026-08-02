import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';
import './live-gold-lead-bar.css';

const gameContent = document.querySelector<HTMLElement>('#game-content');

let latestSnapshot: LiveSnapshot<LolStats> | null = null;
let renderQueued = false;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatCompact(value: number | null): string {
  if (value === null) return '—';
  return Math.abs(value) >= 1000
    ? `${(value / 1000).toFixed(1)}K`
    : value.toLocaleString();
}

function goldShare(blueGold: number | null, redGold: number | null): number {
  if (blueGold === null || redGold === null) return 50;
  const blue = Math.max(0, blueGold);
  const red = Math.max(0, redGold);
  const total = blue + red;
  if (total <= 0) return 50;

  // Keep both teams visible while preserving the live proportional movement.
  return Math.min(92, Math.max(8, (blue / total) * 100));
}

function applyGoldLeadBar(): void {
  renderQueued = false;
  const snapshot = latestSnapshot;
  if (!snapshot?.stats) return;

  const dashboard = [...document.querySelectorAll<HTMLElement>('.live-dashboard-v2')]
    .find(element => element.dataset.liveDashboardGameId === snapshot.game.id);
  const card = dashboard?.querySelector<HTMLElement>('.v2-gold-card');
  if (!card) return;

  const { blue, red } = snapshot.stats;
  const difference = blue.gold === null || red.gold === null
    ? null
    : blue.gold - red.gold;
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
  const signature = JSON.stringify([
    snapshot.game.id,
    blue.gold,
    red.gold,
    blue.name,
    red.name
  ]);
  if (card.dataset.dynamicGoldSignature === signature) return;

  card.classList.add('dynamic-gold-v3');
  card.dataset.dynamicGoldSignature = signature;
  card.style.setProperty('--blue-gold-share', `${blueShare.toFixed(3)}%`);
  card.style.setProperty('--red-gold-share', `${redShare.toFixed(3)}%`);
  card.innerHTML = `
    <span>GOLD LEAD</span>
    <strong class="${leaderClass}">${escapeHtml(leader)}</strong>
    <div
      class="v3-gold-comparison"
      role="img"
      aria-label="${escapeHtml(`${blue.name} ${formatCompact(blue.gold)} versus ${red.name} ${formatCompact(red.gold)}`)}"
    >
      <span class="v3-gold-segment blue" aria-hidden="true"></span>
      <span class="v3-gold-segment red" aria-hidden="true"></span>
      <span class="v3-gold-seam" aria-hidden="true"></span>
    </div>
    <small>${escapeHtml(`${formatCompact(blue.gold)} vs ${formatCompact(red.gold)}`)}</small>`;
}

function queueGoldLeadBar(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(applyGoldLeadBar);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.stats) return;
  latestSnapshot = snapshot;
  queueGoldLeadBar();
});

window.addEventListener('esports-live:selection', () => {
  latestSnapshot = null;
});

if (gameContent) {
  const observer = new MutationObserver(queueGoldLeadBar);
  observer.observe(gameContent, { childList: true, subtree: true });
}

export {};
