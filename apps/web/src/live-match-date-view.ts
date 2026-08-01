import type { ScheduleEvent } from '@esports-live/core';

interface ScheduleResponse {
  esport: string;
  events: ScheduleEvent[];
}

const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
const REFRESH_MS = 30_000;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const scheduleList = requiredElement<HTMLElement>('#schedule-list');
const metaNode = requiredElement<HTMLElement>('#live-match-detail [data-live-meta]');

const scheduledStarts = new Map<string, string>();
let activeSeriesId: string | null = null;
let appliedLabel: string | null = null;
let lastRefreshAt = 0;
let refreshRequest: Promise<void> | null = null;
let renderFrame: number | null = null;

function selectedSeriesId(): string | null {
  return scheduleList.querySelector<HTMLElement>('[data-series-id].selected')?.dataset.seriesId ?? null;
}

function formatDate(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function metaWithoutAppliedDate(): string {
  const text = metaNode.textContent?.trim() ?? '';
  if (!appliedLabel) return text;
  const prefix = `${appliedLabel} · `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function applyDateLabel(label: string | null): void {
  const base = metaWithoutAppliedDate();
  const next = label && base ? `${label} · ${base}` : label ?? base;
  appliedLabel = label;
  if (metaNode.textContent !== next) metaNode.textContent = next;
}

async function refreshSchedule(): Promise<void> {
  if (refreshRequest) return refreshRequest;
  lastRefreshAt = Date.now();
  refreshRequest = (async () => {
    try {
      const response = await fetch(`${API_BASE}/v1/lol/schedule?states=live,paused,scheduled`, {
        cache: 'no-store'
      });
      if (!response.ok) return;
      const payload = await response.json() as ScheduleResponse;
      for (const event of payload.events) {
        scheduledStarts.set(event.series.id, event.series.scheduledStart);
      }
    } catch {
      // The main schedule renderer reports connection failures; retry this optional date lookup later.
    } finally {
      refreshRequest = null;
      queueRender();
    }
  })();
  return refreshRequest;
}

function renderDate(): void {
  const seriesId = selectedSeriesId();
  if (seriesId !== activeSeriesId) {
    activeSeriesId = seriesId;
    applyDateLabel(null);
  }
  if (!seriesId) return;

  const scheduledStart = scheduledStarts.get(seriesId);
  const label = scheduledStart ? formatDate(scheduledStart) : null;
  if (label) {
    applyDateLabel(label);
    return;
  }

  if (Date.now() - lastRefreshAt >= REFRESH_MS) void refreshSchedule();
}

function queueRender(): void {
  if (renderFrame !== null) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = null;
    renderDate();
  });
}

new MutationObserver(queueRender).observe(scheduleList, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class']
});
new MutationObserver(queueRender).observe(metaNode, {
  childList: true,
  characterData: true,
  subtree: true
});
window.addEventListener('esports-live:snapshot', queueRender);
window.addEventListener('load', queueRender, { once: true });
void refreshSchedule();
queueRender();
