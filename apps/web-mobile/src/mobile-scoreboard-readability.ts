import type { LiveSnapshot } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

interface MobileScoreboardRenderedDetail {
  root: HTMLElement;
  snapshot: LiveSnapshot<LolStats> | null;
  mode: 'live' | 'history';
}

const style = document.createElement('style');
style.textContent = `
@media(max-width:760px){
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .completed-final-game-header{
    display:flex!important;
    align-items:center!important;
    justify-content:space-between!important;
    gap:12px!important;
    min-height:42px!important;
    padding:8px 12px!important;
    color:#dce8f7!important;
    background:rgba(6,18,34,.82)!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .completed-final-game-header strong{
    overflow:hidden!important;
    min-width:0!important;
    color:#f4f8ff!important;
    font-size:.72rem!important;
    font-weight:900!important;
    line-height:1.15!important;
    text-overflow:ellipsis!important;
    white-space:nowrap!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-game-clock{
    display:block!important;
    flex:0 0 auto!important;
    min-width:42px!important;
    color:#9fcaf4!important;
    font-size:.74rem!important;
    font-weight:900!important;
    font-variant-numeric:tabular-nums!important;
    letter-spacing:.02em!important;
    text-align:right!important
  }

  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-title,
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-live-parity-objective-title{
    display:none!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objectives{
    padding:11px 9px 12px!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-grid{
    display:grid!important;
    grid-template-columns:repeat(4,minmax(0,1fr))!important;
    gap:6px!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective{
    display:grid!important;
    align-content:center!important;
    justify-items:center!important;
    gap:6px!important;
    min-width:0!important;
    min-height:58px!important;
    padding:8px 3px!important;
    border:1px solid rgba(126,165,209,.12)!important;
    border-radius:8px!important;
    background:rgba(11,26,45,.56)!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective>span{
    overflow:visible!important;
    width:100%!important;
    color:#a9bad0!important;
    font-size:.56rem!important;
    font-weight:900!important;
    line-height:1.05!important;
    letter-spacing:.02em!important;
    text-align:center!important;
    text-overflow:clip!important;
    white-space:normal!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-values{
    display:flex!important;
    align-items:baseline!important;
    justify-content:center!important;
    gap:4px!important;
    width:100%!important;
    font-variant-numeric:tabular-nums!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-values strong{
    font-size:.92rem!important;
    font-weight:950!important;
    line-height:1!important
  }
  body.mobile-demo-active [data-mobile-scoreboard-renderer="shared-v1"] .mobile-scoreboard-objective-values i{
    color:#617188!important;
    font-size:.62rem!important;
    font-style:normal!important;
    font-weight:800!important
  }
}
`;
document.head.append(style);

function formatClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function stateLabel(detail: MobileScoreboardRenderedDetail): string {
  if (detail.mode === 'history' || detail.snapshot?.game.state === 'completed') return 'Final';
  if (detail.snapshot?.game.state === 'paused') return 'Paused';
  if (detail.snapshot?.game.state === 'draft') return 'Draft';
  const boardState = detail.root.dataset.liveBoardState;
  if (boardState === 'pending') return 'Telemetry pending';
  if (boardState === 'stale') return 'Last verified';
  return 'Live';
}

function directHeader(root: HTMLElement): HTMLElement {
  const existing = [...root.children].find(
    child => child instanceof HTMLElement && child.matches('.completed-final-game-header')
  );
  if (existing instanceof HTMLElement) return existing;
  const header = document.createElement('div');
  header.className = 'completed-final-game-header';
  root.prepend(header);
  return header;
}

function applyReadability(detail: MobileScoreboardRenderedDetail): void {
  const { root, snapshot, mode } = detail;
  const header = directHeader(root);
  const gameNumber = snapshot?.game.number;
  const heading = header.querySelector<HTMLElement>('strong') ?? document.createElement('strong');
  const clock = header.querySelector<HTMLElement>('span') ?? document.createElement('span');

  if (!heading.isConnected) header.append(heading);
  if (!clock.isConnected) header.append(clock);
  if (gameNumber !== undefined) heading.textContent = `Game ${gameNumber} · ${stateLabel(detail)}`;
  clock.className = 'mobile-scoreboard-game-clock';
  if (mode === 'live') clock.id = 'live-game-clock';
  else clock.removeAttribute('id');
  clock.textContent = formatClock(snapshot?.stats?.gameClockSeconds);
  clock.setAttribute('aria-label', `Game time ${clock.textContent}`);

  root.querySelectorAll<HTMLElement>(
    '.mobile-scoreboard-objective-title, .mobile-live-parity-objective-title'
  ).forEach(element => element.remove());
  root.dataset.mobileScoreboardReadability = 'v24';
}

window.addEventListener('esports-live:mobile-scoreboard-rendered', event => {
  const detail = (event as CustomEvent<MobileScoreboardRenderedDetail>).detail;
  if (!detail?.root) return;
  applyReadability(detail);
});

function cleanExistingBoards(): void {
  document.querySelectorAll<HTMLElement>('[data-mobile-scoreboard-renderer="shared-v1"]').forEach(root => {
    root.querySelectorAll<HTMLElement>(
      '.mobile-scoreboard-objective-title, .mobile-live-parity-objective-title'
    ).forEach(element => element.remove());
    root.dataset.mobileScoreboardReadability = 'v24';
  });
}

queueMicrotask(cleanExistingBoards);
window.addEventListener('pageshow', cleanExistingBoards);
document.documentElement.dataset.mobileScoreboardReadability = 'game-clock-objectives-v24';

export {};
