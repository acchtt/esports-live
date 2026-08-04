const nav = document.querySelector<HTMLElement>('.mobile-app-nav');
if (nav) nav.dataset.mobileNavVersion = '0.16';

const media = window.matchMedia('(max-width: 760px)');
const gameContent = document.querySelector<HTMLElement>('#game-content');
const PENDING_NOTICE_MS = 1_500;
let pendingTimer: number | null = null;

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active [data-selection-snapshot-pending]{
    gap:12px;
    min-height:280px;
    padding:36px 24px!important;
    text-align:center
  }
  body.mobile-demo-active [data-selection-snapshot-pending] .analysis-empty-icon{
    color:#55c4ff
  }
  body.mobile-demo-active [data-selection-snapshot-pending] small{
    display:block;
    max-width:330px;
    color:#8290a5;
    font-size:.7rem;
    font-weight:700;
    line-height:1.45
  }
}`;
document.head.append(style);

function clearPendingTimer(): void {
  if (pendingTimer !== null) window.clearTimeout(pendingTimer);
  pendingTimer = null;
}

function applyPendingPresentation(element: HTMLElement, fromLoading = false): void {
  if (!media.matches || !element.isConnected) return;
  element.removeAttribute('data-selection-snapshot-loading');
  element.removeAttribute('data-selection-snapshot-waiting');
  element.setAttribute('data-selection-snapshot-pending', '');

  const icon = element.querySelector<HTMLElement>('.analysis-empty-icon');
  const heading = element.querySelector<HTMLElement>('h3');
  const paragraph = element.querySelector<HTMLElement>('p');
  if (icon) icon.textContent = '◷';
  if (heading) heading.textContent = 'Live telemetry pending';
  if (fromLoading && paragraph) {
    paragraph.textContent = 'The game is listed as live, but a verified gameplay frame has not arrived yet.';
  }
  if (!element.querySelector('small')) {
    const note = document.createElement('small');
    note.textContent = 'Riot can mark a game live before publishing a verified gameplay frame. Retrying automatically.';
    element.append(note);
  }
}

function syncPendingPresentation(): void {
  clearPendingTimer();
  if (!gameContent || !media.matches) return;

  const waiting = gameContent.querySelector<HTMLElement>('[data-selection-snapshot-waiting]');
  if (waiting) {
    applyPendingPresentation(waiting);
    return;
  }

  const loading = gameContent.querySelector<HTMLElement>('[data-selection-snapshot-loading]');
  if (!loading) return;
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    if (loading.isConnected && loading.matches('[data-selection-snapshot-loading]')) {
      applyPendingPresentation(loading, true);
    }
  }, PENDING_NOTICE_MS);
}

if (gameContent) {
  new MutationObserver(syncPendingPresentation).observe(gameContent, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'data-selection-snapshot-loading',
      'data-selection-snapshot-waiting',
      'data-selection-snapshot-pending'
    ]
  });
}

if (typeof media.addEventListener === 'function') media.addEventListener('change', syncPendingPresentation);
else if (typeof media.addListener === 'function') media.addListener(syncPendingPresentation);
window.addEventListener('pageshow', syncPendingPresentation);
window.addEventListener('beforeunload', clearPendingTimer);
syncPendingPresentation();

export {};
