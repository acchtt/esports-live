const STATUS_SEPARATOR = ' · ';

function splitStatusText(value: string): { primary: string; detail: string | null } {
  const parts = value
    .split(/\s+·\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  const primary = parts.shift() ?? value.trim();
  return {
    primary,
    detail: parts.length ? parts.join(STATUS_SEPARATOR) : null
  };
}

function visuallyHiddenSeparator(): HTMLSpanElement {
  const separator = document.createElement('span');
  separator.className = 'telemetry-freshness-separator';
  separator.setAttribute('aria-hidden', 'true');
  separator.textContent = STATUS_SEPARATOR;
  return separator;
}

function splitFreshness(freshness: HTMLElement): void {
  if (freshness.querySelector(':scope > .telemetry-freshness-primary')) return;
  const text = freshness.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (!text) return;

  const { primary, detail } = splitStatusText(text);
  const primaryElement = document.createElement('span');
  primaryElement.className = 'telemetry-freshness-primary';
  primaryElement.textContent = primary;

  freshness.setAttribute('aria-label', text);
  if (!detail) {
    freshness.replaceChildren(primaryElement);
    return;
  }

  const detailElement = document.createElement('span');
  detailElement.className = 'telemetry-freshness-detail';
  detailElement.textContent = detail;
  freshness.replaceChildren(primaryElement, visuallyHiddenSeparator(), detailElement);
}

export function installScoreboardStatus(root: HTMLElement): () => void {
  const scoreboard = root.querySelector<HTMLElement>('#scoreboard');
  const freshness = root.querySelector<HTMLElement>('#quality-text');
  if (!scoreboard || !freshness) return () => {};

  if (scoreboard.firstElementChild !== freshness) scoreboard.prepend(freshness);
  splitFreshness(freshness);

  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      splitFreshness(freshness);
    });
  });
  observer.observe(freshness, { childList: true, characterData: true, subtree: true });

  return () => observer.disconnect();
}
