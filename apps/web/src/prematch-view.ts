function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const selectedCompetition = requiredElement<HTMLElement>('#selected-competition');
const selectedSeries = requiredElement<HTMLElement>('#selected-series');
const selectedMeta = requiredElement<HTMLElement>('#selected-meta');
const gameContent = requiredElement<HTMLElement>('#game-content');

const style = document.createElement('style');
style.textContent = `
  .prematch-overview {
    display: grid;
    align-content: center;
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
  .prematch-team-mark {
    display: grid;
    place-items: center;
    width: 70px;
    height: 70px;
    border: 1px solid rgba(56, 189, 248, 0.3);
    border-radius: 22px;
    color: #d9f4ff;
    background: rgba(56, 189, 248, 0.07);
    font-size: 1.15rem;
    font-weight: 900;
    letter-spacing: -0.04em;
  }
  .prematch-team:last-child .prematch-team-mark {
    border-color: rgba(251, 113, 133, 0.3);
    background: rgba(251, 113, 133, 0.06);
  }
  .prematch-team strong {
    overflow-wrap: anywhere;
    font-size: 1.05rem;
  }
  .prematch-vs {
    color: #64748b;
    font-size: 0.75rem;
    font-weight: 900;
    letter-spacing: 0.14em;
  }
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
  .prematch-fact span {
    display: block;
    margin-bottom: 5px;
    color: var(--muted);
    font-size: 0.63rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .prematch-fact strong {
    display: block;
    overflow-wrap: anywhere;
    font-size: 0.82rem;
  }
  .prematch-notice {
    padding: 16px 18px;
    border: 1px solid rgba(56, 189, 248, 0.22);
    border-radius: 13px;
    background: rgba(56, 189, 248, 0.045);
  }
  .prematch-notice strong {
    display: block;
    color: #bae6fd;
  }
  .prematch-notice p {
    margin: 7px 0 0;
    color: var(--muted);
    font-size: 0.78rem;
    line-height: 1.55;
  }
  @media (max-width: 720px) {
    .prematch-overview { min-height: 440px; padding: 22px; }
    .prematch-versus { grid-template-columns: 1fr; gap: 12px; }
    .prematch-vs { text-align: center; }
    .prematch-facts { grid-template-columns: 1fr; }
  }
`;
document.head.append(style);

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts.slice(0, 2).map(part => part[0]) : [parts[0]?.slice(0, 2)])
    .filter(Boolean)
    .join('')
    .toUpperCase();
}

function renderPrematch(): void {
  const title = selectedSeries.textContent?.trim() ?? '';
  const meta = selectedMeta.textContent?.trim() ?? '';
  const competition = selectedCompetition.textContent?.trim() ?? '';
  const selected = title.includes(' vs ') && title !== 'Live analysis workspace';
  const live = /(^|\s)(LIVE|PAUSED)(\s|$)/i.test(meta);
  const liveStatsVisible = Boolean(gameContent.querySelector('.scoreboard, .team-grid'));

  if (!selected || live || liveStatsVisible) return;

  const [left = 'Team 1', right = 'Team 2'] = title.split(/\s+vs\s+/i, 2);
  const [start = 'Scheduled', format = 'Series format pending'] = meta.split(' · ', 2);
  const signature = `${title}|${meta}|${competition}`;
  const overviewVisible = Boolean(gameContent.querySelector('[data-prematch-overview]'));
  if (overviewVisible && gameContent.dataset.prematchSignature === signature) return;

  gameContent.dataset.prematchSignature = signature;
  gameContent.innerHTML = `
    <section class="prematch-overview" data-prematch-overview>
      <div class="prematch-versus">
        <article class="prematch-team">
          <span class="prematch-team-mark">${escapeHtml(initials(left))}</span>
          <strong>${escapeHtml(left)}</strong>
        </article>
        <span class="prematch-vs">VERSUS</span>
        <article class="prematch-team">
          <span class="prematch-team-mark">${escapeHtml(initials(right))}</span>
          <strong>${escapeHtml(right)}</strong>
        </article>
      </div>
      <div class="prematch-facts">
        <div class="prematch-fact"><span>Start</span><strong>${escapeHtml(start)}</strong></div>
        <div class="prematch-fact"><span>Competition</span><strong>${escapeHtml(competition || 'Competition unavailable')}</strong></div>
        <div class="prematch-fact"><span>Format</span><strong>${escapeHtml(format)}</strong></div>
      </div>
      <div class="prematch-notice">
        <strong>Live statistics are not available yet</strong>
        <p>Riot has not published an active gameplay frame for this scheduled series. Once a game starts, this panel will switch automatically to verified gold, kills, towers, dragons, barons, player KDA, CS, items, and source-quality status.</p>
      </div>
    </section>`;
}

const observer = new MutationObserver(() => queueMicrotask(renderPrematch));
observer.observe(selectedCompetition, { childList: true, characterData: true, subtree: true });
observer.observe(selectedSeries, { childList: true, characterData: true, subtree: true });
observer.observe(selectedMeta, { childList: true, characterData: true, subtree: true });
observer.observe(gameContent, { childList: true, subtree: true });
renderPrematch();
