import type { ScheduleEvent, SeriesContext, StandingRef, TeamRosterRef } from '@esports-live/core';
import { apiJson } from './api-client.ts';

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const CONTEXT_LOADING_MESSAGE = 'Series context enrichment is still loading.';
const CONTEXT_RETRY_MS = 900;
const selectedCompetition = requiredElement<HTMLElement>('#selected-competition');
const selectedSeries = requiredElement<HTMLElement>('#selected-series');
const selectedMeta = requiredElement<HTMLElement>('#selected-meta');
const gameContent = requiredElement<HTMLElement>('#game-content');

let activeSignature = '';
let activeSeriesId: string | null = null;
let activeContext: SeriesContext | null = null;
let contextError: string | null = null;
let contextLoading = false;
let contextRequest = 0;
let contextController: AbortController | null = null;
let contextRetryTimer: number | null = null;
let selectedEvent: ScheduleEvent | null = null;

const style = document.createElement('style');
style.textContent = `
  .prematch-overview {
    display: grid;
    align-content: start;
    gap: 22px;
    min-height: 520px;
    padding: 34px;
  }
  .prematch-versus {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 22px;
  }
  .prematch-team {
    display: grid;
    justify-items: center;
    gap: 12px;
    min-width: 0;
    padding: 28px 18px;
    border: 1px solid var(--border);
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.025);
    text-align: center;
  }
  .prematch-team-mark,
  .prematch-team-logo {
    display: grid;
    place-items: center;
    width: 70px;
    height: 70px;
    border: 1px solid rgba(56, 189, 248, 0.3);
    border-radius: 22px;
    background: rgba(56, 189, 248, 0.07);
  }
  .prematch-team-mark {
    color: #d9f4ff;
    font-size: 1.15rem;
    font-weight: 900;
    letter-spacing: -0.04em;
  }
  .prematch-team-logo { object-fit: contain; padding: 8px; }
  .prematch-team:last-child .prematch-team-mark,
  .prematch-team:last-child .prematch-team-logo {
    border-color: rgba(251, 113, 133, 0.3);
    background: rgba(251, 113, 133, 0.06);
  }
  .prematch-team strong { overflow-wrap: anywhere; font-size: 1.05rem; }
  .prematch-vs { color: #64748b; font-size: 0.75rem; font-weight: 900; letter-spacing: 0.14em; }
  .prematch-facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }
  .prematch-fact {
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.02);
  }
  .prematch-fact span,
  .prematch-section-title {
    display: block;
    margin-bottom: 5px;
    color: var(--muted);
    font-size: 0.63rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .prematch-fact strong { display: block; overflow-wrap: anywhere; font-size: 0.82rem; }
  .prematch-context { display: grid; gap: 18px; }
  .prematch-rosters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .prematch-roster,
  .prematch-standings {
    min-width: 0;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.02);
  }
  .prematch-roster h4 { margin: 0 0 12px; font-size: 0.88rem; }
  .prematch-player {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-top: 1px solid rgba(148, 163, 184, 0.1);
    font-size: 0.76rem;
  }
  .prematch-player:first-of-type { border-top: 0; }
  .prematch-player span { color: var(--muted); text-transform: capitalize; }
  .prematch-table { width: 100%; border-collapse: collapse; font-size: 0.73rem; }
  .prematch-table th,
  .prematch-table td { padding: 8px 7px; border-top: 1px solid rgba(148, 163, 184, 0.1); text-align: left; }
  .prematch-table th { color: var(--muted); font-size: 0.6rem; letter-spacing: 0.06em; text-transform: uppercase; }
  .prematch-table tr.selected-team td { color: #bae6fd; background: rgba(56, 189, 248, 0.035); }
  .prematch-record { white-space: nowrap; }
  .prematch-notice {
    padding: 16px 18px;
    border: 1px solid rgba(56, 189, 248, 0.22);
    border-radius: 13px;
    background: rgba(56, 189, 248, 0.045);
  }
  .prematch-notice.warning { border-color: rgba(251, 191, 36, 0.24); background: rgba(251, 191, 36, 0.045); }
  .prematch-notice strong { display: block; color: #bae6fd; }
  .prematch-notice.warning strong { color: #fcd34d; }
  .prematch-notice p { margin: 7px 0 0; color: var(--muted); font-size: 0.78rem; line-height: 1.55; }
  @media (max-width: 720px) {
    .prematch-overview { min-height: 440px; padding: 22px; }
    .prematch-versus,
    .prematch-rosters { grid-template-columns: 1fr; gap: 12px; }
    .prematch-vs { text-align: center; }
    .prematch-facts { grid-template-columns: 1fr; }
    .prematch-standings { overflow-x: auto; }
  }
`;
document.head.append(style);

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function clearContextRetry(): void {
  if (contextRetryTimer !== null) window.clearTimeout(contextRetryTimer);
  contextRetryTimer = null;
}

function isContextStillLoading(message: string): boolean {
  return message.includes(CONTEXT_LOADING_MESSAGE);
}

function scheduleContextRetry(seriesId: string, signature: string): void {
  clearContextRetry();
  contextRetryTimer = window.setTimeout(() => {
    contextRetryTimer = null;
    if (activeSeriesId !== seriesId || activeSignature !== signature) return;
    void loadContext(seriesId, signature);
  }, CONTEXT_RETRY_MS);
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts.slice(0, 2).map(part => part[0]) : [parts[0]?.slice(0, 2)])
    .filter(Boolean)
    .join('')
    .toUpperCase();
}

function teamVisual(name: string, roster: TeamRosterRef | undefined): string {
  const image = roster?.team.imageUrl;
  return image
    ? `<img class="prematch-team-logo" src="${escapeHtml(image)}" alt="" />`
    : `<span class="prematch-team-mark">${escapeHtml(initials(name))}</span>`;
}

function rosterMarkup(roster: TeamRosterRef | undefined, fallbackName: string): string {
  const players = roster?.players ?? [];
  return `
    <article class="prematch-roster">
      <span class="prematch-section-title">Available five-player lineup</span>
      <h4>${escapeHtml(roster?.team.name ?? fallbackName)}</h4>
      ${players.length
        ? players.map(player => `
          <div class="prematch-player">
            <strong>${escapeHtml(player.handle)}</strong>
            <span>${escapeHtml(player.role ?? 'role unavailable')}</span>
          </div>`).join('')
        : '<div class="prematch-player"><span>Roster unavailable</span></div>'}
    </article>`;
}

function standingRow(standing: StandingRef, selectedNames: ReadonlySet<string>): string {
  const selected = selectedNames.has(standing.team.name.toLowerCase());
  const record = standing.wins === null && standing.losses === null
    ? '—'
    : `${standing.wins ?? '—'}–${standing.losses ?? '—'}`;
  return `
    <tr class="${selected ? 'selected-team' : ''}">
      <td>${escapeHtml(standing.rank ?? '—')}</td>
      <td>${escapeHtml(standing.team.name)}</td>
      <td class="prematch-record">${escapeHtml(record)}</td>
      <td>${escapeHtml(standing.group ?? '')}</td>
    </tr>`;
}

function contextMarkup(context: SeriesContext | null, left: string, right: string): string {
  if (contextLoading) {
    return '<div class="prematch-notice"><strong>Loading team context</strong><p>Fetching current rosters and competition standings from Riot.</p></div>';
  }
  if (contextError) {
    return `<div class="prematch-notice warning"><strong>Pre-match context unavailable</strong><p>${escapeHtml(contextError)}</p></div>`;
  }
  if (!context) return '';

  const leftRoster = context.rosters.find(roster => roster.team.name.toLowerCase() === left.toLowerCase())
    ?? context.rosters[0];
  const rightRoster = context.rosters.find(roster => roster.team.name.toLowerCase() === right.toLowerCase())
    ?? context.rosters.find(roster => roster.team.id !== leftRoster?.team.id)
    ?? context.rosters[1];
  const selectedNames = new Set([left.toLowerCase(), right.toLowerCase()]);
  const standings = context.standings.slice(0, 16);
  const reason = context.reasons[0]?.message;
  const verifiedHistoricalLineup = context.reasons.some(item => (
    item.code === 'roster_from_recent_verified_lineup'
  ));

  return `
    <section class="prematch-context">
      <div class="prematch-rosters">
        ${rosterMarkup(leftRoster, left)}
        ${rosterMarkup(rightRoster, right)}
      </div>
      ${verifiedHistoricalLineup ? `
        <div class="prematch-notice warning">
          <strong>Last verified gameplay lineup</strong>
          <p>These five-player lineups come from each team's most recent available Riot gameplay frame. They are not confirmed starters for this match.</p>
        </div>` : ''}
      <section class="prematch-standings">
        <span class="prematch-section-title">Competition standings</span>
        ${standings.length ? `
          <table class="prematch-table">
            <thead><tr><th>#</th><th>Team</th><th>W–L</th><th>Stage</th></tr></thead>
            <tbody>${standings.map(row => standingRow(row, selectedNames)).join('')}</tbody>
          </table>` : `<p>${escapeHtml(reason ?? 'Standings are unavailable for this stage.')}</p>`}
      </section>
    </section>`;
}

async function loadContext(seriesId: string, signature: string): Promise<void> {
  const requestId = ++contextRequest;
  clearContextRetry();
  contextController?.abort();
  const controller = new AbortController();
  contextController = controller;
  contextLoading = true;
  contextError = null;
  activeContext = null;
  renderPrematch();
  let retryScheduled = false;

  try {
    const body = await apiJson<SeriesContext>(
      API_BASE,
      `/v1/lol/series/${encodeURIComponent(seriesId)}/context`,
      { signal: controller.signal }
    );
    if (requestId !== contextRequest || activeSignature !== signature) return;
    activeContext = body;
  } catch (error) {
    if (controller.signal.aborted) return;
    if (requestId !== contextRequest || activeSignature !== signature) return;
    const message = error instanceof Error ? error.message : 'Unknown context error.';
    if (isContextStillLoading(message)) {
      retryScheduled = true;
      contextLoading = true;
      contextError = null;
      scheduleContextRetry(seriesId, signature);
    } else {
      contextError = message;
    }
  } finally {
    if (requestId === contextRequest && activeSignature === signature) {
      if (!retryScheduled) contextLoading = false;
      renderPrematch();
    }
  }
}

function renderPrematch(): void {
  if (!selectedEvent) return;
  const title = selectedSeries.textContent?.trim() ?? '';
  const meta = selectedMeta.textContent?.trim() ?? '';
  const competition = selectedCompetition.textContent?.trim() ?? '';
  const selected = title.includes(' vs ') && title !== 'Live analysis workspace';
  const live = /(^|\s)(LIVE|PAUSED)(\s|$)/i.test(meta);
  const liveStatsVisible = Boolean(gameContent.querySelector('.scoreboard, .team-grid'));

  if (!selected || live || liveStatsVisible) return;

  const [left = 'Team 1', right = 'Team 2'] = title.split(/\s+vs\s+/i, 2);
  const [start = 'Scheduled', format = 'Series format pending'] = meta.split(' · ', 2);
  const seriesId = selectedEvent.series.id;
  const signature = `${seriesId ?? 'unknown'}|${title}|${meta}|${competition}`;

  if (activeSignature !== signature) {
    activeSignature = signature;
    activeSeriesId = seriesId;
    activeContext = null;
    contextError = null;
    contextLoading = false;
    contextRequest += 1;
    clearContextRetry();
    if (seriesId) void loadContext(seriesId, signature);
  }

  const renderKey = `${signature}|${contextLoading}|${contextError ?? ''}|${activeContext?.observedAt ?? ''}`;
  if (gameContent.dataset.prematchRenderKey === renderKey
    && gameContent.querySelector('[data-prematch-overview]')) return;

  const leftRoster = activeContext?.rosters.find(roster => roster.team.name.toLowerCase() === left.toLowerCase())
    ?? activeContext?.rosters[0];
  const rightRoster = activeContext?.rosters.find(roster => roster.team.name.toLowerCase() === right.toLowerCase())
    ?? activeContext?.rosters.find(roster => roster.team.id !== leftRoster?.team.id)
    ?? activeContext?.rosters[1];

  gameContent.dataset.prematchRenderKey = renderKey;
  gameContent.innerHTML = `
    <section class="prematch-overview" data-prematch-overview data-series-id="${escapeHtml(activeSeriesId ?? '')}">
      <div class="prematch-versus">
        <article class="prematch-team">
          ${teamVisual(left, leftRoster)}
          <strong>${escapeHtml(left)}</strong>
        </article>
        <span class="prematch-vs">VERSUS</span>
        <article class="prematch-team">
          ${teamVisual(right, rightRoster)}
          <strong>${escapeHtml(right)}</strong>
        </article>
      </div>
      <div class="prematch-facts">
        <div class="prematch-fact"><span>Start</span><strong>${escapeHtml(start)}</strong></div>
        <div class="prematch-fact"><span>Competition</span><strong>${escapeHtml(competition || 'Competition unavailable')}</strong></div>
        <div class="prematch-fact"><span>Format</span><strong>${escapeHtml(format)}</strong></div>
      </div>
      ${contextMarkup(activeContext, left, right)}
      <div class="prematch-notice">
        <strong>Live statistics are not available yet</strong>
        <p>Riot has not published an active gameplay frame for this scheduled series. Once a game starts, this panel will switch automatically to verified gold, kills, towers, dragons, barons, player KDA, CS, items, and source-quality status.</p>
      </div>
    </section>`;
}

window.addEventListener('esports-live:selection', event => {
  selectedEvent = (event as CustomEvent<ScheduleEvent>).detail;
  activeSignature = '';
  clearContextRetry();
  contextController?.abort();
  contextController = null;
  renderPrematch();
});

window.addEventListener('beforeunload', clearContextRetry);
