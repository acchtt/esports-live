import type { LiveSnapshot, ScheduleEvent } from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

const gameContent = document.querySelector<HTMLElement>('#game-content');
const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');

let historyRendererActive = false;
let lastAssignedHtml: string | null = null;

if (gameContent && innerHtmlDescriptor?.get && innerHtmlDescriptor.set) {
  const nativeGet = innerHtmlDescriptor.get;
  const nativeSet = innerHtmlDescriptor.set;

  Object.defineProperty(gameContent, 'innerHTML', {
    configurable: true,
    enumerable: innerHtmlDescriptor.enumerable ?? false,
    get(): string {
      return nativeGet.call(this) as string;
    },
    set(value: string) {
      const html = String(value);
      const isHistoryBoard = html.includes('data-live-history-game-id=');
      const isLegacyLiveBoard = html.includes('class="role-scoreboard-board"');

      if (isHistoryBoard) historyRendererActive = true;

      // main.ts renders a full board immediately before the history-style renderer
      // replaces it in the same snapshot dispatch. Once the replacement renderer
      // has proved it is active, skip that redundant first DOM rebuild.
      if (historyRendererActive && isLegacyLiveBoard) return;
      if (html === lastAssignedHtml) return;

      nativeSet.call(this, html);
      lastAssignedHtml = html;
    }
  });
}

function snapshotSignature(snapshot: LiveSnapshot<LolStats>): string {
  return JSON.stringify({
    gameId: snapshot.game.id,
    gameNumber: snapshot.game.number,
    gameState: snapshot.game.state,
    sourceTimestamp: snapshot.quality.sourceTimestamp,
    freshness: snapshot.quality.freshness,
    complete: snapshot.quality.complete,
    safeForLiveAnalysis: snapshot.quality.safeForLiveAnalysis,
    reasons: snapshot.quality.reasons,
    stats: snapshot.stats
  });
}

let lastSnapshotSignature = '';
let selectedSeriesId = '';

window.addEventListener('esports-live:selection', event => {
  const selection = (event as CustomEvent<ScheduleEvent>).detail;
  const nextSeriesId = selection?.series?.id ?? '';
  if (nextSeriesId === selectedSeriesId) return;
  selectedSeriesId = nextSeriesId;
  lastSnapshotSignature = '';
}, { capture: true });

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.game?.id) return;
  const signature = snapshotSignature(snapshot);
  if (signature !== lastSnapshotSignature) {
    lastSnapshotSignature = signature;
    return;
  }

  // Riot commonly returns the same frame over several 500 ms polls. Prevent all
  // downstream view modules from rebuilding and redecorating identical markup.
  event.stopImmediatePropagation();
}, { capture: true });
