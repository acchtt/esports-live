from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_index = text.find(start)
    if start_index < 0:
        raise RuntimeError(f"{label}: start marker not found")
    end_index = text.find(end, start_index)
    if end_index < 0:
        raise RuntimeError(f"{label}: end marker not found")
    return text[:start_index] + replacement + text[end_index:]


# Provider: retain Riot's opening frame timestamp as the authoritative game-clock anchor.
provider_path = Path("packages/adapter-lol/src/riot-provider.ts")
provider = provider_path.read_text()
provider = replace_once(
    provider,
    "function frameTeam(frame: Json, side: LolSide): Json {",
    """function earliestFrameTime(value: unknown): number | null {
  let earliest: number | null = null;
  for (const frame of frames(value)) {
    const timestamp = frameTime(frame);
    const timestampMs = timestamp ? parseTime(timestamp) : null;
    if (timestampMs === null) continue;
    if (earliest === null || timestampMs < earliest) earliest = timestampMs;
  }
  return earliest;
}

function frameTeam(frame: Json, side: LolSide): Json {""",
    "insert earliest frame helper",
)
provider = replace_once(
    provider,
    "  const now = options.now ?? (() => new Date());\n",
    "  const now = options.now ?? (() => new Date());\n  const gameStartTimes = new Map<string, number>();\n",
    "add game start cache",
)
provider = replace_once(
    provider,
    """  const bestWindow = async (gameId: string, after?: string): Promise<Candidate | null> => {
    const observedMs = now().getTime();
    const first = windowCandidate(await live(`window/${encodeURIComponent(gameId)}`, {}));
""",
    """  const bestWindow = async (gameId: string, after?: string): Promise<Candidate | null> => {
    const observedMs = now().getTime();
    const openingPayload = await live(`window/${encodeURIComponent(gameId)}`, {});
    const openingTime = earliestFrameTime(openingPayload);
    if (openingTime !== null) {
      const previous = gameStartTimes.get(gameId);
      if (previous === undefined || openingTime < previous) gameStartTimes.set(gameId, openingTime);
    }
    const first = windowCandidate(openingPayload);
""",
    "capture opening timestamp",
)
provider = replace_once(
    provider,
    """function gameClock(frame: Json, event: Json, gameId: string, metadata: Json, sourceMs: number): number | null {
  const direct = firstNumber(frame, ['gameClockSeconds', 'gameTimeSeconds', 'gameTime']);
  if (direct !== null) return Math.max(0, Math.round(direct));
  const start = startTime(event, gameId, metadata);
  return start !== null && sourceMs >= start ? Math.round((sourceMs - start) / 1000) : null;
}
""",
    """function gameClock(
  frame: Json,
  event: Json,
  gameId: string,
  metadata: Json,
  sourceMs: number,
  openingFrameMs: number | null
): number | null {
  const direct = firstNumber(frame, ['gameClockSeconds', 'gameTimeSeconds', 'gameTime']);
  if (direct !== null) return Math.max(0, Math.round(direct));
  const start = startTime(event, gameId, metadata) ?? openingFrameMs;
  return start !== null && sourceMs >= start ? Math.round((sourceMs - start) / 1000) : null;
}
""",
    "extend game clock fallback",
)
provider = replace_once(
    provider,
    "        gameClockSeconds: gameClock(effectiveCandidate.frame, event, gameId, metadata, effectiveCandidate.timestampMs),",
    "        gameClockSeconds: gameClock(\n          effectiveCandidate.frame,\n          event,\n          gameId,\n          metadata,\n          effectiveCandidate.timestampMs,\n          gameStartTimes.get(gameId) ?? null\n        ),",
    "pass opening frame to game clock",
)
provider_path.write_text(provider)

# Provider regression: no VOD/start field, opening window still produces a reliable clock.
test_path = Path("packages/adapter-lol/src/riot-provider.test.ts")
test_text = test_path.read_text()
if "uses the opening Riot window frame as a game-clock fallback" not in test_text:
    test_text += r'''

test('uses the opening Riot window frame as a game-clock fallback', async () => {
  const opening = '2026-07-31T08:00:00.000Z';
  const current = '2026-07-31T08:09:50.000Z';
  const customFetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/getEventDetails')) {
      const payload = eventPayload();
      payload.data.event.match.games[0]!.vods = [];
      return json(payload);
    }
    if (url.pathname.includes('/window/game-1')) {
      const payload = windowPayload();
      if (!url.searchParams.has('startingTime')) {
        const frame = structuredClone(payload.frames[0]!);
        frame.rfc460Timestamp = opening;
        frame.blueTeam.totalGold = 0;
        frame.redTeam.totalGold = 0;
        frame.blueTeam.participants = frame.blueTeam.participants.map(player => ({ ...player, creepScore: 0, level: 1 }));
        frame.redTeam.participants = frame.redTeam.participants.map(player => ({ ...player, creepScore: 0, level: 1 }));
        payload.frames = [frame];
      } else {
        payload.frames[0]!.rfc460Timestamp = current;
      }
      return json(payload);
    }
    if (url.pathname.includes('/details/game-1')) return json(detailsPayload());
    return json({ error: 'unexpected_url', url: url.toString() }, 500);
  };

  const adapter = new LolAdapter(createRiotLolProvider({
    apiKey: 'test-key',
    fetcher: customFetcher,
    now: () => new Date(NOW)
  }));
  const snapshot = await adapter.getLiveSnapshot('game-1');
  assert.equal(snapshot.stats?.gameClockSeconds, 590);
});
'''
test_path.write_text(test_text)

# Web: smooth clock, richer team/player data, gold differential, and snapshot events for history reconciliation.
main_path = Path("apps/web/src/main.ts")
main = main_path.read_text()
main = replace_once(
    main,
    "let scheduleTimer: ReturnType<typeof setInterval> | null = null;\n",
    """let scheduleTimer: ReturnType<typeof setInterval> | null = null;
let liveClockTimer: ReturnType<typeof setInterval> | null = null;
let liveClockBaseSeconds: number | null = null;
let liveClockBaseAt = 0;
let liveClockAdvancing = false;
""",
    "add live clock state",
)
main = replace_once(
    main,
    """function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}
""",
    """function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

function formatSigned(value: number | null): string {
  if (value === null) return '—';
  return `${value > 0 ? '+' : ''}${value.toLocaleString()}`;
}

function sumPlayerField(team: LolTeamState, field: 'creepScore' | 'level'): number | null {
  const values = team.players.map(player => player[field]);
  if (!values.length || values.some(value => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function clearLiveClock(): void {
  if (liveClockTimer !== null) clearInterval(liveClockTimer);
  liveClockTimer = null;
  liveClockBaseSeconds = null;
  liveClockBaseAt = 0;
  liveClockAdvancing = false;
}

function updateLiveClock(): void {
  const element = document.querySelector<HTMLElement>('#live-game-clock');
  if (!element || liveClockBaseSeconds === null) return;
  const elapsed = liveClockAdvancing ? Math.max(0, Math.floor((Date.now() - liveClockBaseAt) / 1000)) : 0;
  element.textContent = formatClock(liveClockBaseSeconds + elapsed);
}

function startLiveClock(snapshot: LiveSnapshot<LolStats>): void {
  clearLiveClock();
  const seconds = snapshot.stats?.gameClockSeconds ?? null;
  if (seconds === null) return;
  const sourceMs = snapshot.quality.sourceTimestamp ? Date.parse(snapshot.quality.sourceTimestamp) : Number.NaN;
  const sourceAgeSeconds = Number.isFinite(sourceMs)
    ? Math.max(0, Math.min(15, Math.floor((Date.now() - sourceMs) / 1000)))
    : 0;
  liveClockBaseSeconds = seconds + (snapshot.game.state === 'live' ? sourceAgeSeconds : 0);
  liveClockBaseAt = Date.now();
  liveClockAdvancing = snapshot.game.state === 'live' && currentEvent()?.series.state === 'live';
  updateLiveClock();
  if (liveClockAdvancing) liveClockTimer = setInterval(updateLiveClock, 1_000);
}
""",
    "insert live clock helpers",
)
main = replace_between(
    main,
    "function objectiveMarkup(team: LolTeamState): string {",
    "function renderSnapshot(snapshot: LiveSnapshot<LolStats>): void {",
    r'''function objectiveMarkup(team: LolTeamState): string {
  const objectives = team.objectives;
  const dragonList = objectives.dragons?.length
    ? objectives.dragons.map(dragon => String(dragon).replaceAll('_', ' ')).join(' · ')
    : null;
  return `
    <div class="objective-grid">
      <div><span>Towers</span><strong>${formatNumber(objectives.towers)}</strong></div>
      <div class="objective-dragons"><span>Dragons</span><strong>${objectives.dragons === null ? '—' : objectives.dragons.length}</strong>${dragonList ? `<small>${escapeHtml(dragonList)}</small>` : ''}</div>
      <div><span>Barons</span><strong>${formatNumber(objectives.barons)}</strong></div>
      <div><span>Heralds</span><strong>${formatNumber(objectives.heralds)}</strong></div>
      <div><span>Inhibitors</span><strong>${formatNumber(objectives.inhibitors)}</strong></div>
    </div>`;
}

function playerRows(team: LolTeamState): string {
  if (!team.players.length) return '<div class="players-empty">Player telemetry unavailable</div>';
  return team.players.map(player => {
    const items = player.items?.length ? player.items.join(' · ') : 'Items unavailable';
    const role = player.role ? ` · ${player.role}` : '';
    return `
      <div class="player-row live-player-row">
        <div class="player-identity"><strong>${escapeHtml(player.handle ?? 'Unknown player')}</strong><span>${escapeHtml(player.championId ?? 'Champion unavailable')}${escapeHtml(role)}</span></div>
        <span>Lv ${formatNumber(player.level)}</span>
        <span>${formatNumber(player.kills)}/${formatNumber(player.deaths)}/${formatNumber(player.assists)}</span>
        <span>${formatNumber(player.creepScore)} CS</span>
        <span>${formatNumber(player.totalGold)}g</span>
        <small class="player-items">${escapeHtml(items)}</small>
      </div>`;
  }).join('');
}

function teamMarkup(team: LolTeamState, opponentGold: number | null, imageUrl?: string): string {
  const goldDifference = team.gold === null || opponentGold === null ? null : team.gold - opponentGold;
  const totalCs = sumPlayerField(team, 'creepScore');
  const totalLevel = sumPlayerField(team, 'level');
  return `
    <section class="team-card ${team.side}">
      <div class="team-heading">
        ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="" />` : '<span class="team-placeholder"></span>'}
        <div><small>${team.side.toUpperCase()} SIDE</small><h3>${escapeHtml(team.name)}</h3></div>
      </div>
      <div class="team-primary live-team-primary">
        <div><span>Total gold</span><strong>${formatNumber(team.gold)}</strong></div>
        <div><span>Gold diff</span><strong>${formatSigned(goldDifference)}</strong></div>
        <div><span>Total CS</span><strong>${formatNumber(totalCs)}</strong></div>
        <div><span>Total level</span><strong>${formatNumber(totalLevel)}</strong></div>
      </div>
      ${objectiveMarkup(team)}
      <div class="player-list">${playerRows(team)}</div>
    </section>`;
}

''',
    "replace live data markup",
)
main = replace_between(
    main,
    "function renderSnapshot(snapshot: LiveSnapshot<LolStats>): void {",
    "function renderUpcoming(event: ScheduleEvent): void {",
    r'''function renderSnapshot(snapshot: LiveSnapshot<LolStats>): void {
  const stats = snapshot.stats;
  if (!stats) {
    if (renderedGameId === snapshot.game.id) return;
    renderedGameId = null;
    clearLiveClock();
    const reason = snapshot.quality.reasons.map(item => item.message).join(' ') || 'No normalized gameplay frame is available.';
    gameContent.innerHTML = `
      <div class="analysis-empty">
        <span class="analysis-empty-icon" aria-hidden="true">⌁</span>
        <h3>Waiting for verified gameplay</h3>
        <p>${escapeHtml(reason)}</p>
      </div>`;
    return;
  }

  renderedGameId = snapshot.game.id;
  const blueRef = snapshot.series.teams.find(team => team.id === stats.blue.id);
  const redRef = snapshot.series.teams.find(team => team.id === stats.red.id);
  const goldDifference = stats.blue.gold === null || stats.red.gold === null
    ? null
    : stats.blue.gold - stats.red.gold;
  const goldLeader = goldDifference === null || goldDifference === 0
    ? 'Gold even'
    : `${goldDifference > 0 ? stats.blue.name : stats.red.name} ${formatSigned(Math.abs(goldDifference))}`;
  gameContent.innerHTML = `
    <div class="scoreboard">
      <div><span>${escapeHtml(stats.blue.name)}</span><strong>${formatNumber(stats.blue.kills)}</strong></div>
      <div class="clock"><small>GAME ${snapshot.game.number}</small><strong id="live-game-clock">${formatClock(stats.gameClockSeconds)}</strong><span>${escapeHtml(stats.patch ?? 'Patch unavailable')}</span><em>${escapeHtml(goldLeader)}</em></div>
      <div class="right"><strong>${formatNumber(stats.red.kills)}</strong><span>${escapeHtml(stats.red.name)}</span></div>
    </div>
    <div class="team-grid">
      ${teamMarkup(stats.blue, stats.red.gold, blueRef?.imageUrl)}
      ${teamMarkup(stats.red, stats.blue.gold, redRef?.imageUrl)}
    </div>`;
  startLiveClock(snapshot);
  window.dispatchEvent(new CustomEvent<LiveSnapshot<LolStats>>('esports-live:snapshot', { detail: snapshot }));
}

''',
    "replace snapshot renderer",
)
main = replace_once(
    main,
    "function renderUpcoming(event: ScheduleEvent): void {\n  renderedGameId = null;\n",
    "function renderUpcoming(event: ScheduleEvent): void {\n  renderedGameId = null;\n  clearLiveClock();\n",
    "clear clock for upcoming",
)
main = replace_once(
    main,
    """function selectGame(gameId: string): void {
  const event = currentEvent();
  if (!event?.series.games.some(game => game.id === gameId)) return;
  selectedGameId = gameId;
  lastSourceTimestamp = null;
  renderGameSelector(event);
  void refreshSnapshot();
}
""",
    """function selectGame(gameId: string): void {
  const event = currentEvent();
  if (!event?.series.games.some(game => game.id === gameId)) return;
  selectedGameId = gameId;
  lastSourceTimestamp = null;
  renderedGameId = null;
  clearLiveClock();
  renderGameSelector(event);
  void refreshSnapshot();
}
""",
    "reset selected game clock",
)
main = replace_once(
    main,
    "  lastSourceTimestamp = null;\n  renderSchedule();\n",
    "  lastSourceTimestamp = null;\n  renderedGameId = null;\n  clearLiveClock();\n  renderSchedule();\n",
    "reset selected series clock",
)
main = replace_once(
    main,
    "  clearSnapshotTimer();\n  if (scheduleTimer !== null) clearInterval(scheduleTimer);\n",
    "  clearSnapshotTimer();\n  clearLiveClock();\n  if (scheduleTimer !== null) clearInterval(scheduleTimer);\n",
    "clear clock on unload",
)
main_path.write_text(main)

# CSS additions override the compact original grid without changing the visual system.
styles_path = Path("apps/web/src/styles.css")
styles = styles_path.read_text()
marker = "/* live-data-parity */"
if marker not in styles:
    styles += r'''

/* live-data-parity */
.scoreboard .clock em {
  color: #93c5fd;
  font-size: 0.58rem;
  font-style: normal;
  font-weight: 800;
}
.live-team-primary { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.live-team-primary strong { font-size: 1rem; }
.objective-grid small {
  display: block;
  margin-top: 3px;
  overflow: hidden;
  color: #7f8da3;
  font-size: 0.5rem;
  text-overflow: ellipsis;
  text-transform: capitalize;
  white-space: nowrap;
}
.live-player-row {
  grid-template-columns: minmax(115px, 1.35fr) 0.42fr 0.64fr 0.58fr 0.66fr;
  row-gap: 4px;
}
.live-player-row .player-items {
  grid-column: 1 / -1;
  overflow: hidden;
  color: #718096;
  font-size: 0.56rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 1100px) {
  .live-team-primary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .live-player-row { grid-template-columns: minmax(105px, 1.25fr) 0.45fr 0.7fr 0.62fr; }
  .live-player-row > span:last-of-type { display: none; }
}
@media (max-width: 620px) {
  .live-player-row { grid-template-columns: minmax(100px, 1.2fr) 0.5fr 0.75fr; }
  .live-player-row > span:nth-of-type(3),
  .live-player-row > span:nth-of-type(4) { display: none; }
}
'''
styles_path.write_text(styles)

# Stable, monotonic series history with final-frame duration enrichment.
history_path = Path("apps/web/src/series-history-view.ts")
history_path.write_text(r'''import type {
  LiveSnapshot,
  SeriesContext,
  SeriesGameHistoryRef,
  SeriesHistoryRef,
  TeamRef
} from '@esports-live/core';
import type { LolStats } from '@esports-live/adapter-lol';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

interface StoredHistoryState {
  score: [number, number];
  completed: string[];
  winners: Record<string, string>;
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const LIVE_REFRESH_MS = 15_000;
const IDLE_REFRESH_MS = 60_000;
const selectedSeries = requiredElement<HTMLElement>('#selected-series');
const selectedMeta = requiredElement<HTMLElement>('#selected-meta');
const scheduleList = requiredElement<HTMLElement>('#schedule-list');
const historyPanel = requiredElement<HTMLElement>('#series-history');

let activeSeriesId: string | null = null;
let requestId = 0;
let loadingSeriesId: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const histories = new Map<string, SeriesHistoryRef>();
const liveClocks = new Map<string, number>();
const finalSnapshots = new Map<string, Promise<LiveSnapshot<LolStats> | null>>();

const style = document.createElement('style');
style.textContent = `
  .series-history { display: grid; gap: 14px; margin: 0 24px 18px; padding: 18px; border: 1px solid var(--border); border-radius: 16px; background: rgba(255,255,255,.018); }
  .series-history[hidden] { display: none; }
  .series-history-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .series-history-heading h3 { margin: 2px 0 0; font-size: .96rem; }
  .series-history-heading span, .history-game-state { color: var(--muted); font-size: .65rem; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
  .series-score { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); align-items: center; gap: 14px; padding: 14px; border: 1px solid rgba(148,163,184,.13); border-radius: 13px; background: rgba(255,255,255,.018); }
  .series-score-team { min-width: 0; }
  .series-score-team:last-child { text-align: right; }
  .series-score-team strong { display: block; overflow-wrap: anywhere; font-size: .84rem; }
  .series-score-team small { color: var(--muted); }
  .series-score-value { display: flex; align-items: center; gap: 9px; font-size: 1.55rem; font-weight: 900; }
  .series-score-value span { color: #475569; font-size: .9rem; }
  .history-games { display: grid; grid-template-columns: repeat(auto-fit,minmax(170px,1fr)); gap: 10px; }
  .history-game { display: grid; gap: 9px; min-width: 0; padding: 13px; border: 1px solid rgba(148,163,184,.13); border-radius: 12px; background: rgba(255,255,255,.016); }
  .history-game.completed { border-color: rgba(34,197,94,.2); }
  .history-game.live, .history-game.draft, .history-game.paused { border-color: rgba(56,189,248,.3); }
  .history-game-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .history-game-top strong { font-size: .8rem; }
  .history-sides { display: grid; gap: 5px; }
  .history-side { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; color: var(--muted); font-size: .7rem; }
  .history-side b { overflow: hidden; color: var(--text); text-overflow: ellipsis; white-space: nowrap; }
  .history-side.blue span { color: #7dd3fc; }
  .history-side.red span { color: #fda4af; }
  .history-result { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 8px; border-top: 1px solid rgba(148,163,184,.1); font-size: .7rem; }
  .history-result strong { overflow-wrap: anywhere; color: #bbf7d0; }
  .history-result span { color: var(--muted); white-space: nowrap; }
  .series-history-message { color: var(--muted); font-size: .76rem; line-height: 1.5; }
  .series-history-message.warning { color: #fcd34d; }
  @media (max-width:720px) { .series-history { margin:0 14px 14px; padding:14px; } .series-history-heading { display:grid; } .series-score { grid-template-columns:1fr auto 1fr; padding:12px; } .series-score-value { gap:6px; font-size:1.25rem; } .history-games { grid-template-columns:1fr; } }
`;
document.head.append(style);

function escapeHtml(value: unknown): string {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}

function selectedSeriesIdentifier(): string | null {
  return scheduleList.querySelector<HTMLButtonElement>('.match-card.selected')?.dataset.seriesId ?? null;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function teamName(team: TeamRef | null): string { return team?.name ?? 'Unavailable'; }

function stateLabel(game: SeriesGameHistoryRef): string {
  switch (game.state) {
    case 'unstarted': return 'Pending';
    case 'draft': return 'Draft';
    case 'live': return 'Live';
    case 'paused': return 'Paused';
    case 'completed': return 'Final';
    default: return 'Unknown';
  }
}

function resultLabel(game: SeriesGameHistoryRef): string {
  if (game.winner) return `Winner · ${game.winner.name}`;
  if (game.state === 'completed') return 'Winner not published';
  return 'Result pending';
}

function timeLabel(game: SeriesGameHistoryRef): string {
  if (game.durationSeconds !== null) return formatClock(game.durationSeconds);
  const live = liveClocks.get(game.id);
  if ((game.state === 'live' || game.state === 'paused') && live !== undefined) return `Elapsed ${formatClock(live)}`;
  return game.state === 'completed' ? 'Duration loading…' : 'Duration unavailable';
}

function gameMarkup(game: SeriesGameHistoryRef): string {
  return `
    <article class="history-game ${escapeHtml(game.state)}">
      <div class="history-game-top"><strong>Game ${escapeHtml(game.number)}</strong><span class="history-game-state">${escapeHtml(stateLabel(game))}</span></div>
      <div class="history-sides">
        <div class="history-side blue"><span>BLUE</span><b>${escapeHtml(teamName(game.blueTeam))}</b></div>
        <div class="history-side red"><span>RED</span><b>${escapeHtml(teamName(game.redTeam))}</b></div>
      </div>
      <div class="history-result"><strong>${escapeHtml(resultLabel(game))}</strong><span>${escapeHtml(timeLabel(game))}</span></div>
    </article>`;
}

function formatDescription(history: SeriesHistoryRef): string {
  return `Best of ${history.bestOf} · First to ${history.winsRequired}${history.drawPossible ? ' · Draw possible' : ''}`;
}

function historyMarkup(history: SeriesHistoryRef): string {
  const [left, right] = history.score;
  return `
    <div class="series-history-heading"><div><span>Series game history</span><h3>${escapeHtml(formatDescription(history))}</h3></div><span>${history.games.filter(game => game.state === 'completed').length} completed</span></div>
    <div class="series-score">
      <div class="series-score-team"><strong>${escapeHtml(left.team.name)}</strong><small>${escapeHtml(left.team.code ?? '')}</small></div>
      <div class="series-score-value"><b>${left.wins}</b><span>–</span><b>${right.wins}</b></div>
      <div class="series-score-team"><strong>${escapeHtml(right.team.name)}</strong><small>${escapeHtml(right.team.code ?? '')}</small></div>
    </div>
    <div class="history-games">${history.games.map(gameMarkup).join('')}</div>`;
}

function showMessage(message: string, warning = false): void {
  historyPanel.hidden = false;
  historyPanel.innerHTML = `<div class="series-history-message ${warning ? 'warning' : ''}">${escapeHtml(message)}</div>`;
}

function renderHistory(seriesId: string): void {
  if (activeSeriesId !== seriesId) return;
  const history = histories.get(seriesId);
  if (!history) return;
  historyPanel.hidden = false;
  historyPanel.innerHTML = historyMarkup(history);
}

const stateRank: Record<SeriesGameHistoryRef['state'], number> = {
  unknown: 0, unstarted: 1, draft: 2, live: 3, paused: 3, completed: 4
};

function mergeHistory(previous: SeriesHistoryRef | undefined, incoming: SeriesHistoryRef): SeriesHistoryRef {
  if (!previous) return incoming;
  const byId = new Map(previous.games.map(game => [game.id, game]));
  const games = incoming.games.map(game => {
    const old = byId.get(game.id) ?? previous.games.find(item => item.number === game.number);
    if (!old) return game;
    return {
      ...game,
      state: stateRank[old.state] > stateRank[game.state] ? old.state : game.state,
      blueTeam: game.blueTeam ?? old.blueTeam,
      redTeam: game.redTeam ?? old.redTeam,
      winner: game.winner ?? old.winner,
      durationSeconds: game.durationSeconds ?? old.durationSeconds
    };
  });
  return {
    ...incoming,
    score: [
      { team: incoming.score[0].team, wins: Math.max(previous.score[0].wins, incoming.score[0].wins) },
      { team: incoming.score[1].team, wins: Math.max(previous.score[1].wins, incoming.score[1].wins) }
    ],
    games
  };
}

function storageKey(seriesId: string): string { return `esports-live:history:${seriesId}`; }

function readStored(seriesId: string): StoredHistoryState | null {
  try {
    const value = localStorage.getItem(storageKey(seriesId));
    return value ? JSON.parse(value) as StoredHistoryState : null;
  } catch { return null; }
}

function writeStored(seriesId: string, value: StoredHistoryState): void {
  try { localStorage.setItem(storageKey(seriesId), JSON.stringify(value)); } catch {}
}

function applyObservedWinners(seriesId: string, history: SeriesHistoryRef): SeriesHistoryRef {
  const stored = readStored(seriesId);
  const teams = history.score.map(entry => entry.team);
  const winners = { ...(stored?.winners ?? {}) };
  const completed = history.games.filter(game => game.state === 'completed').map(game => game.id);
  const previousCompleted = new Set(stored?.completed ?? []);
  const newlyCompleted = completed.filter(id => !previousCompleted.has(id));
  const leftDelta = history.score[0].wins - (stored?.score[0] ?? history.score[0].wins);
  const rightDelta = history.score[1].wins - (stored?.score[1] ?? history.score[1].wins);
  if (newlyCompleted.length === 1 && leftDelta === 1 && rightDelta === 0) winners[newlyCompleted[0]!] = teams[0]!.id;
  if (newlyCompleted.length === 1 && rightDelta === 1 && leftDelta === 0) winners[newlyCompleted[0]!] = teams[1]!.id;

  const games = history.games.map(game => {
    if (game.winner) {
      winners[game.id] = game.winner.id;
      return game;
    }
    const winnerId = winners[game.id];
    const winner = teams.find(team => team.id === winnerId) ?? null;
    return winner ? { ...game, winner } : game;
  });
  writeStored(seriesId, {
    score: [history.score[0].wins, history.score[1].wins],
    completed,
    winners
  });
  return { ...history, games };
}

function clearTimer(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
}

function nextRefreshDelay(): number {
  return /(^|\s)(LIVE|PAUSED)(\s|$)/i.test(selectedMeta.textContent ?? '') ? LIVE_REFRESH_MS : IDLE_REFRESH_MS;
}

function scheduleRefresh(seriesId: string): void {
  clearTimer();
  refreshTimer = setTimeout(() => {
    if (activeSeriesId === seriesId) void loadHistory(seriesId);
  }, nextRefreshDelay());
}

async function snapshotFor(gameId: string): Promise<LiveSnapshot<LolStats> | null> {
  const existing = finalSnapshots.get(gameId);
  if (existing) return existing;
  const request = fetch(`${API_BASE}/v1/lol/games/${encodeURIComponent(gameId)}/live?historyFinal=${Date.now()}`, { cache: 'no-store' })
    .then(async response => response.ok ? await response.json() as LiveSnapshot<LolStats> : null)
    .catch(() => null);
  finalSnapshots.set(gameId, request);
  return request;
}

async function enrichDurations(seriesId: string): Promise<void> {
  const history = histories.get(seriesId);
  if (!history) return;
  let changed = false;
  const games: SeriesGameHistoryRef[] = [];
  for (const game of history.games) {
    if (game.state !== 'completed' || game.durationSeconds !== null) {
      games.push(game);
      continue;
    }
    const snapshot = await snapshotFor(game.id);
    const duration = snapshot?.stats?.gameClockSeconds ?? null;
    if (duration !== null) {
      games.push({ ...game, durationSeconds: duration });
      changed = true;
    } else {
      games.push(game);
    }
  }
  if (!changed) return;
  histories.set(seriesId, { ...history, games });
  renderHistory(seriesId);
}

async function loadHistory(seriesId: string): Promise<void> {
  if (loadingSeriesId === seriesId) return;
  const currentRequest = ++requestId;
  loadingSeriesId = seriesId;
  if (!histories.has(seriesId)) showMessage('Loading series score and game results…');
  try {
    const response = await fetch(`${API_BASE}/v1/lol/series/${encodeURIComponent(seriesId)}/context?history=${Date.now()}`, { cache: 'no-store' });
    const body = await response.json().catch(() => null) as SeriesContext | { message?: string } | null;
    if (!response.ok) throw new Error(body && 'message' in body ? body.message ?? `History API returned ${response.status}.` : `History API returned ${response.status}.`);
    if (currentRequest !== requestId || activeSeriesId !== seriesId) return;
    const context = body as SeriesContext;
    if (!context.history) {
      if (!histories.has(seriesId)) showMessage('Riot has not published game-history details for this series.', true);
    } else {
      const observed = applyObservedWinners(seriesId, context.history);
      histories.set(seriesId, mergeHistory(histories.get(seriesId), observed));
      renderHistory(seriesId);
      void enrichDurations(seriesId);
    }
  } catch (error) {
    if (currentRequest !== requestId || activeSeriesId !== seriesId) return;
    if (!histories.has(seriesId)) showMessage(error instanceof Error ? error.message : 'Series history is unavailable.', true);
  } finally {
    if (currentRequest === requestId && activeSeriesId === seriesId) {
      loadingSeriesId = null;
      scheduleRefresh(seriesId);
    }
  }
}

function syncSelection(): void {
  const seriesId = selectedSeriesIdentifier();
  const title = selectedSeries.textContent?.trim() ?? '';
  if (!seriesId || !title.includes(' vs ')) {
    activeSeriesId = null;
    requestId += 1;
    loadingSeriesId = null;
    clearTimer();
    historyPanel.hidden = true;
    historyPanel.replaceChildren();
    return;
  }
  if (seriesId === activeSeriesId) return;
  activeSeriesId = seriesId;
  requestId += 1;
  loadingSeriesId = null;
  clearTimer();
  if (histories.has(seriesId)) renderHistory(seriesId);
  void loadHistory(seriesId);
}

window.addEventListener('esports-live:snapshot', event => {
  const snapshot = (event as CustomEvent<LiveSnapshot<LolStats>>).detail;
  if (!snapshot?.stats || snapshot.series.id !== activeSeriesId) return;
  if (snapshot.stats.gameClockSeconds !== null) liveClocks.set(snapshot.game.id, snapshot.stats.gameClockSeconds);
  const history = histories.get(snapshot.series.id);
  if (!history) return;
  const games = history.games.map(game => game.id === snapshot.game.id
    ? { ...game, state: snapshot.game.state, durationSeconds: snapshot.game.state === 'completed' ? snapshot.stats?.gameClockSeconds ?? game.durationSeconds : game.durationSeconds }
    : game);
  histories.set(snapshot.series.id, { ...history, games });
  renderHistory(snapshot.series.id);
});

const observer = new MutationObserver(() => queueMicrotask(syncSelection));
observer.observe(selectedSeries, { childList: true, characterData: true, subtree: true });
observer.observe(selectedMeta, { childList: true, characterData: true, subtree: true });
observer.observe(scheduleList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
syncSelection();
''')

print("Applied stable series history, Riot-anchored timer, and richer live data fields.")
