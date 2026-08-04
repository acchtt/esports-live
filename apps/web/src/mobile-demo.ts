import './mobile-demo.css';
import './mobile-demo-fixes.css';

type MobileView = 'matches' | 'live' | 'platform';

const MOBILE_QUERY = '(max-width: 760px)';
const media = window.matchMedia(MOBILE_QUERY);
const body = document.body;
const analysisPanel = document.querySelector<HTMLElement>('.analysis-panel');
const platformPanel = document.querySelector<HTMLElement>('#platform-panel');
const platformToggle = document.querySelector<HTMLButtonElement>('#platform-panel-toggle');
const selectedSeries = document.querySelector<HTMLElement>('#selected-series');
const buildVersion = document.querySelector<HTMLElement>('#build-version');

const nav = document.createElement('nav');
nav.className = 'mobile-app-nav';
nav.setAttribute('aria-label', 'Mobile navigation');
nav.innerHTML = `
  <button type="button" data-mobile-view="matches" aria-label="Show matches">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v4H5zM5 11h14v4H5zM5 17h9v2H5z"/></svg>
    <span>Matches</span>
  </button>
  <button type="button" data-mobile-view="live" aria-label="Show selected match">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V8m5 10V4m5 14v-7m5 7V6"/></svg>
    <span>Match</span>
  </button>
  <button type="button" data-mobile-view="platform" aria-label="Show platform status">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4m0 10v4M3 12h4m10 0h4M6.2 6.2l2.7 2.7m6.2 6.2 2.7 2.7m0-11.6-2.7 2.7m-6.2 6.2-2.7 2.7"/><circle cx="12" cy="12" r="3"/></svg>
    <span>Platform</span>
  </button>`;
document.body.append(nav);

const contextBar = document.createElement('div');
contextBar.className = 'mobile-context-bar';
contextBar.innerHTML = `
  <button type="button" class="mobile-context-back" aria-label="Back to matches">
    <span aria-hidden="true">‹</span>
    Matches
  </button>
  <span class="mobile-context-title">Selected match</span>`;
analysisPanel?.insertAdjacentElement('afterbegin', contextBar);

const title = contextBar.querySelector<HTMLElement>('.mobile-context-title');
const backButton = contextBar.querySelector<HTMLButtonElement>('.mobile-context-back');

function currentView(): MobileView {
  const value = body.dataset.mobileView;
  return value === 'live' || value === 'platform' ? value : 'matches';
}

function updateTitle(): void {
  if (title) title.textContent = selectedSeries?.textContent?.trim() || 'Selected match';
}

function expandPlatform(): void {
  platformPanel?.removeAttribute('hidden');
  if (platformToggle?.getAttribute('aria-expanded') !== 'true') platformToggle?.click();
}

function setView(view: MobileView, scroll = true): void {
  if (!media.matches) return;
  body.dataset.mobileView = view;
  nav.querySelectorAll<HTMLButtonElement>('[data-mobile-view]').forEach(button => {
    const active = button.dataset.mobileView === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  contextBar.hidden = view !== 'live';
  if (view === 'platform') expandPlatform();
  if (scroll) window.scrollTo({ top: 0, behavior: 'auto' });
}

function syncViewport(): void {
  body.classList.toggle('mobile-demo-active', media.matches);
  nav.hidden = !media.matches;
  if (!media.matches) {
    delete body.dataset.mobileView;
    contextBar.hidden = true;
    return;
  }
  setView(currentView(), false);
}

nav.addEventListener('click', event => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>('[data-mobile-view]');
  const view = button?.dataset.mobileView as MobileView | undefined;
  if (view) setView(view);
});

backButton?.addEventListener('click', () => setView('matches'));

document.addEventListener('click', event => {
  if (!media.matches || !event.isTrusted) return;
  const target = event.target as Element | null;
  if (target?.closest('[data-series-id], [data-completed-series-id]')) {
    queueMicrotask(() => setView('live'));
    return;
  }
  if (target?.closest('[data-mode="active"], [data-mode="results"]')) {
    queueMicrotask(() => setView('matches', false));
  }
}, { capture: true });

window.addEventListener('esports-live:selection', updateTitle);
window.addEventListener('pageshow', () => syncViewport());
media.addEventListener('change', syncViewport);

if (selectedSeries) {
  new MutationObserver(updateTitle).observe(selectedSeries, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

if (buildVersion) {
  const label = buildVersion.querySelector<HTMLElement>('span');
  if (label) label.textContent = label.textContent?.replace(/^DEMO/, 'MOBILE') ?? 'MOBILE';
  buildVersion.title = buildVersion.title.replace(/^Demo/, 'Mobile demo');
  buildVersion.setAttribute(
    'aria-label',
    buildVersion.getAttribute('aria-label')?.replace(/^Demo/, 'Mobile demo') ?? 'Mobile demo build'
  );
}

updateTitle();
syncViewport();
